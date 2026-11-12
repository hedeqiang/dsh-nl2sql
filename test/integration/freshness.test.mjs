// Freshness + quality patrol against a local SQLite (uploaded CSV) data source — no external DB —
// plus a MySQL section (testdb) when it is reachable. Notifications use a fake IM adapter.
import { test, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const { registerAdapter } = await plugin('channels/index.js')
const sent = []
registerAdapter({
  id: 'fakefq',
  name: { zh: '假 IM', en: 'Fake IM' },
  kinds: [{
    id: 'fakefq_push', label: { zh: '假', en: 'fake' }, description: { zh: '', en: '' },
    fields: [{ key: 'chatId', label: { zh: '群', en: 'chat' }, type: 'text', required: true }],
    capabilities: { push: true, markdown: 'basic', charts: 'none', tables: 'markdown', buttons: false, bot: false, listTargets: false, mentionAll: false },
    setupSteps: { zh: [], en: [] },
    validate(input) { return { config: { chatId: String(input.config?.chatId ?? 'g') }, secrets: {} } },
    async send(_c, _s, message) { sent.push(message); return { messageId: `m${sent.length}` } },
  }],
})

const pad = (n) => String(n).padStart(2, '0')
const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const now = Date.now()
// orders: 60 rows, newest 3 hours ago; one negative amount, one 1000× outlier, one future row,
// a duplicated order_no, user_id 40 % NULL.
const rows = Array.from({ length: 60 }, (_, i) => {
  const amount = i === 5 ? -8 : i === 7 ? 100000 : 10 + (i % 7)
  const at = i === 9 ? stamp(now + 400 * 86400000) : stamp(now - 3 * 3600000 - i * 3600000)
  return `${i === 11 ? 'O10' : `O${i}`},${i % 5 < 2 ? '' : i},${amount},${at}`
})
const csv = `order_no,user_id,amount,created_at\n${rows.join('\n')}\n`
// logs: no time column at all.
const csv2 = 'name,value\na,1\nb,2\n'

const app = await boot({ label: 'freshness' })
const { call, service, tool } = app
try {
  const up = await call('stageUpload', { fileName: 'orders.csv', base64: Buffer.from(csv).toString('base64') })
  const imp = await call('importUpload', { uploadId: up.uploadId, newName: 'shop' })
  const dsId = imp.datasourceId
  const up2 = await call('stageUpload', { fileName: 'misc.csv', base64: Buffer.from(csv2).toString('base64') })
  await call('importUpload', { uploadId: up2.uploadId, datasourceId: dsId, mode: 'create' })
  await call('analyzeSchema', { id: dsId, refresh: true })
  const ch = await call('saveChannel', { name: 'FQ', type: 'fakefq_push', config: { chatId: 'g1' }, secrets: {} })

  await test('freshnessFor: MAX(created_at) ignoring future rows, lag, status; tables without time column skipped', async () => {
    const v = await call('freshnessFor', { datasourceId: dsId })
    assert.equal(v.tables.length, 1, JSON.stringify(v.tables))
    const o = v.tables[0]
    assert.equal(o.table, 'orders')
    assert.equal(o.column, 'created_at')
    assert.ok(Math.abs(o.lagMinutes - 180) <= 2, `lag ${o.lagMinutes}`)
    assert.equal(o.status, 'ok')
    assert.equal(o.thresholdHours, 24)
    const audit = service.records.list('history', { ref: dsId, limit: 20 }).filter(h => h.source === 'freshness')
    assert.ok(audit.length >= 1, 'freshness queries are audited through runQuery')
    assert.ok(service.state.freshness[dsId].orders.checkedAt > 0, 'stored in state.freshness')
  })

  await test('freshnessFor with sql narrows to the referenced tables', async () => {
    const v = await call('freshnessFor', { datasourceId: dsId, sql: 'SELECT COUNT(*) FROM orders o' })
    assert.deepEqual(v.referenced, ['orders'])
    assert.equal(v.tables.length, 1)
    const none = await call('freshnessFor', { datasourceId: dsId, sql: 'SELECT * FROM misc' })
    assert.equal(none.tables.length, 0)
  })

  await test('stale episode: pushed once, recorded, not repeated; recovery pushed once', async () => {
    await call('saveHealthSettings', { freshness: { channelId: ch.id, overrides: { [dsId]: { orders: 1 } } } })
    sent.length = 0
    await service.runFreshnessAll()
    assert.equal(sent.length, 1, 'one push for the stale episode')
    assert.match(sent[0].title, /数据延迟/)
    assert.match(sent[0].text, /orders\*\* 最新数据停在/)
    await service.runFreshnessAll()
    assert.equal(sent.length, 1, 'no repeat while still stale')
    let ev = await call('freshnessEvents', { datasourceId: dsId })
    assert.deepEqual(ev.map(e => e.kind), ['stale'])
    assert.equal(ev[0].pushed, true)
    const v = await call('freshnessFor', { datasourceId: dsId })
    assert.equal(v.staleCount, 1)
    assert.equal(v.tables[0].status, 'stale')
    await call('saveHealthSettings', { freshness: { overrides: { [dsId]: { orders: 24 } } } })
    await service.runFreshnessAll()
    assert.equal(sent.length, 2)
    assert.match(sent[1].title, /恢复/)
    ev = await call('freshnessEvents', { datasourceId: dsId })
    assert.deepEqual(ev.map(e => e.kind), ['recovered', 'stale'])
    await service.runFreshnessAll()
    assert.equal(sent.length, 2, 'recovery pushed once')
  })

  await test('scheduler: freshness job registered and due by interval', async () => {
    const jobs = service.schedulerJobs(new Date())
    const fj = jobs.find(j => j.id === 'freshness')
    assert.ok(fj && jobs.some(j => j.id === 'quality'))
    assert.equal(fj.due(new Date()), false, 'just ran')
    assert.equal(fj.due(new Date(Date.now() + 31 * 60000)), true)
  })

  await test('nl2sql_freshness tool: tables, lag, warnings for stale tables, unknown names', async () => {
    let r = await tool('nl2sql_freshness', { datasource: dsId, tables: ['orders', 'misc', 'nope'] })
    assert.equal(r.tables.find(t => t.table === 'orders').status, 'ok')
    assert.match(r.tables.find(t => t.table === 'misc').note, /no time column/)
    assert.deepEqual(r.unknown, ['nope'])
    assert.equal(r.warnings, undefined)
    await call('saveHealthSettings', { freshness: { channelId: null, overrides: { [dsId]: { orders: 2 } } } })
    r = await tool('nl2sql_freshness', { datasource: dsId, tables: ['orders'] })
    assert.equal(r.tables[0].status, 'stale')
    assert.match(r.warnings[0], /⚠️ orders 最新数据停在/)
    const meta = app.tools.get('nl2sql_freshness').output.presentationMeta({}, r)
    assert.equal(meta.freshness.tables[0].table, 'orders')
    await call('saveHealthSettings', { freshness: { overrides: {} } })
  })

  await test('access policy: denied tables are neither measured nor reported', async () => {
    await call('savePolicy', { id: dsId, policy: { mode: 'deny', tables: ['orders'] } })
    try {
      const v = await call('freshnessFor', { datasourceId: dsId, refresh: true })
      assert.equal(v.tables.length, 0)
      const r = await tool('nl2sql_freshness', { datasource: dsId, tables: ['orders'] })
      assert.deepEqual(r.unknown, ['orders'])
    } finally { await call('savePolicy', { id: dsId, policy: { mode: 'all' } }) }
  })

  await test('row-level actor: freshness measured live under its rules, not stored', async () => {
    service.state.sessionActors = { ...(service.state.sessionActors ?? {}), 'fq-row': { id: 'r', name: 'R', kind: 'lark', datasourceIds: [dsId], role: 'analyst', rowRules: [{ column: 'user_id', values: ['59'] }] } }
    await call('freshnessFor', { datasourceId: dsId, refresh: true })
    const before = service.state.freshness[dsId].orders.checkedAt
    const r = await tool('nl2sql_freshness', { datasource: dsId, tables: ['orders'] }, { agent: { id: 'fq-row' } })
    // user_id 59 is the oldest row (59 + 3 hours ago).
    assert.ok(r.tables[0].lagMinutes > 60 * 60, `lag ${r.tables[0].lagMinutes}`)
    assert.equal(service.state.freshness[dsId].orders.checkedAt, before, 'shared store untouched')
    const h = service.records.list('history', { ref: dsId, limit: 5 }).find(x => x.source === 'freshness')
    assert.equal(h.actor?.id, 'r')
  })

  await test('qualityScan: nulls, duplicates, outliers, future timestamps, negatives; scores + explanations', async () => {
    const run = await call('qualityScan', { datasourceId: dsId })
    const o = run.tables.find(t => t.table === 'orders')
    assert.equal(o.rowCount, 60)
    assert.ok(o.nulls.some(n => n.column === 'user_id' && n.rate === 0.4), JSON.stringify(o.nulls))
    assert.deepEqual(o.duplicates.find(d => d.columns[0] === 'order_no')?.duplicates, 1)
    assert.ok(o.outliers.some(x => x.column === 'amount' && x.count === 1), JSON.stringify(o.outliers))
    assert.deepEqual(o.future, [{ column: 'created_at', count: 1 }])
    assert.deepEqual(o.negatives, [{ column: 'amount', count: 1 }])
    assert.ok(o.score < 70 && o.score > 0, String(o.score))
    assert.ok(o.issues.every(i => i.zh && i.en))
    const misc = run.tables.find(t => t.table === 'misc')
    assert.equal(misc.score, 100)
    assert.ok(run.score > o.score && run.score < 100)
    assert.match(run.summary.zh, /^健康分 \d+/)
    assert.match(run.summary.en, /^Health score \d+/)
    const res = await call('qualityResults', { datasourceId: dsId })
    assert.equal(res.latest.id, run.id)
    assert.equal(res.history.length, 1)
    assert.ok(service.records.list('history', { ref: dsId, limit: 50 }).some(h => h.source === 'quality'))
  })

  await test('score drop above threshold pushes a summary; partial scans neither push nor move the baseline', async () => {
    await call('saveHealthSettings', { quality: { channelId: ch.id, dropPoints: 5 } })
    service.state.quality.latest[dsId].score = 100
    sent.length = 0
    const run = await call('qualityScan', { datasourceId: dsId })
    assert.equal(run.previousScore, 100)
    assert.equal(run.pushed, true)
    assert.equal(sent.length, 1)
    assert.match(sent[0].title, /数据健康分下降/)
    service.state.quality.latest[dsId].score = 100
    const part = await call('qualityScan', { datasourceId: dsId, tables: ['orders'] })
    assert.equal(part.partial, true)
    assert.equal(sent.length, 1)
    assert.equal(service.state.quality.latest[dsId].score, 100)
  })

  await test('settings validation', async () => {
    await assert.rejects(call('saveHealthSettings', { freshness: { intervalMin: 1 } }), /intervalMin/)
    await assert.rejects(call('saveHealthSettings', { quality: { time: '25:00' } }), /HH:MM/)
    const s = await call('saveHealthSettings', { freshness: { intervalMin: 60, staleHours: 6, channelId: 'missing' }, quality: { enabled: true, time: '07:15' } })
    assert.equal(s.freshness.intervalMin, 60)
    assert.equal(s.freshness.channelId, null)
    assert.equal(s.quality.time, '07:15')
    const st = await call('healthStatus')
    assert.equal(st.quality.enabled, true)
  })
} finally {
  await app.close()
}

// ------------------------------------------------------------ MySQL (testdb, read-only)
const down = await mysqlUnavailable()
if (!down) {
  const my = await boot({ label: 'freshness-my' })
  try {
    const ds = await my.call('saveDatasource', { name: 'M', ...MYSQL })
    await my.call('analyzeSchema', { id: ds.id, refresh: true })
    await test('MySQL: freshness batches tables in UNION ALL, values parsed', async () => {
      const v = await my.call('freshnessFor', { datasourceId: ds.id })
      const bt = v.tables.find(t => t.table === 'blockchain_transactions')
      assert.ok(bt, JSON.stringify(v.tables.map(t => t.table)))
      assert.equal(bt.column, 'created_at')
      assert.ok(bt.latestAt === null || Number.isFinite(bt.latestAt))
      assert.ok(v.tables.every(t => !t.error), JSON.stringify(v.tables.filter(t => t.error)))
      const audits = my.service.records.list('history', { ref: ds.id, limit: 50 }).filter(h => h.source === 'freshness')
      assert.equal(audits.length, 1, 'one batched statement')
    })
    await test('MySQL: quality scan runs on testdb without errors', async () => {
      const run = await my.call('qualityScan', { datasourceId: ds.id, tables: ['blockchain_transactions', 'wallets', 'collections'] })
      assert.equal(run.tables.length, 3)
      for (const t of run.tables) assert.deepEqual(t.errors, [], `${t.table}: ${t.errors}`)
      assert.ok(run.tables.every(t => t.score === null || (t.score >= 0 && t.score <= 100)))
    })
  } finally { await my.close() }
} else {
  await test('MySQL section', () => { console.log(`  (skipped: ${down})`) })
}

summary()
