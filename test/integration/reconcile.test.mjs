// Cross-datasource reconciliation (service/reconcile.js): MySQL vs an uploaded CSV file data source,
// saved jobs, the scheduler job, run history, IM push through a fake adapter, the agent tool,
// actor scope and row rules (queries go through runQuery).
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const { registerAdapter, unregisterAdapter } = await plugin('channels/index.js')
const sent = []
const kind = (id, caps) => ({
  id, label: { zh: '假', en: 'Fake' }, description: { zh: '', en: '' },
  fields: [{ key: 'chatId', label: { zh: '群', en: 'Chat' }, type: 'text', required: true }],
  capabilities: { push: true, markdown: 'basic', charts: 'none', tables: 'markdown', buttons: false, bot: false, listTargets: false, mentionAll: false, ...caps },
  setupSteps: { zh: [], en: [] },
  validate: (input) => ({ config: { chatId: String(input.config?.chatId ?? 'g') }, secrets: {} }),
  async send(_channel, _secrets, message) { sent.push(message); return { messageId: `m${sent.length}`, files: message.attachment ? 1 : 0 } },
})
registerAdapter({ id: 'rcfake', name: { zh: '假', en: 'Fake' }, kinds: [kind('rcfake_files', { tableRows: 2, files: true }), kind('rcfake_plain', {})] })

const app = await boot({ label: 'reconcile' })
const { call, tool, service } = app
let my, file, ch, job
const b64 = (s) => Buffer.from(s).toString('base64')
const SQL_MY = 'SELECT chain, COUNT(*) AS n, SUM(fee) AS fee FROM blockchain_transactions GROUP BY chain'
try {
  let truth
  await test('setup: MySQL + a CSV file data source with deliberate differences', async () => {
    my = await call('saveDatasource', { name: 'MySQL', ...MYSQL })
    const r = await call('runQuery', { datasourceId: my.id, sql: `${SQL_MY} ORDER BY chain` })
    truth = r.rows.map(([chain, n, fee]) => ({ chain, n: Number(n), fee: Number(fee) }))
    assert.ok(truth.length >= 2, 'need at least two chains')
    // CSV: first chain identical (upper-case + spaces, small fee rounding), second chain count off by 1, one extra chain, last chain missing.
    const rows = truth.slice(0, -1).map((x, i) => [i === 0 ? ` ${x.chain.toUpperCase()} ` : x.chain, i === 1 ? x.n + 1 : x.n, (x.fee + 0.000001).toFixed(9)])
    rows.push(['zz_extra', 3, '1.5'])
    const csv = `chain,cnt,fee_total\n${rows.map(r => r.join(',')).join('\n')}\n`
    const imp = await call('importUpload', { fileName: 'ledger.csv', base64: b64(csv), newName: 'Ledger' })
    assert.equal(imp.results[0].ok, true, JSON.stringify(imp))
    file = { id: imp.datasourceId, table: imp.results[0].table }
    ch = await call('saveChannel', { name: 'RC', type: 'rcfake_files', config: { chatId: 'g1' }, secrets: {} })
  })

  const def = () => ({
    name: '链交易对账',
    left: { datasourceId: my.id, sql: SQL_MY },
    right: { datasourceId: file.id, sql: `SELECT chain, cnt, fee_total FROM "${file.table}"` },
    keys: [{ left: 'chain', right: 'chain' }],
    compare: [{ left: 'n', right: 'cnt' }, { left: 'fee', right: 'fee_total', tolerance: 0.0001 }],
    options: { trim: true, ignoreCase: true },
  })

  await test('dry run of an unsaved definition: summary, totals, detail tables as results', async () => {
    const out = await call('runReconcile', { definition: def() })
    const s = out.summary
    assert.equal(s.leftRows, truth.length)
    assert.equal(s.matched, truth.length - 1)
    assert.equal(s.onlyLeft, 1)
    assert.equal(s.onlyRight, 1)
    assert.equal(s.mismatchedRows, 1)
    assert.equal(s.columns[0].mismatches, 1)
    assert.equal(s.columns[1].mismatches, 0, 'fee within tolerance')
    assert.equal(s.columns[0].leftTotal, truth.reduce((a, x) => a + x.n, 0))
    assert.equal(s.hasDiff, true)
    assert.equal(out.results.length, 4)
    assert.deepEqual(out.results.map(r => r.reconcilePart), ['summary', 'mismatches', 'onlyLeft', 'onlyRight'])
    const mm = await call('getResult', { resultId: out.results[1].resultId })
    assert.equal(mm.rows.length, 1)
    assert.equal(mm.rows[0][0], truth[1].chain)
    assert.equal(mm.rows[0].at(-1), 'n/cnt')
    const onlyR = await call('getResult', { resultId: out.results[3].resultId })
    assert.equal(onlyR.rows[0][0], 'zz_extra')
    assert.match(out.markdown, /发现差异/)
    // Excel export works on the detail results.
    const x = await call('exportExcel', { resultIds: out.results.map(r => r.resultId) })
    assert.ok(x.bytes > 0)
    // Both queries were audited.
    const hist = service.records.list('history', { limit: 10 }).filter(h => h.source === 'reconcile')
    assert.equal(hist.length, 2)
    assert.equal((await call('listReconciles')).length, 0, 'dry run does not save')
  })

  await test('saveReconcile validates and persists; listReconciles shows names', async () => {
    await assert.rejects(call('saveReconcile', { ...def(), keys: [] }), /键列/)
    await assert.rejects(call('saveReconcile', { ...def(), left: { datasourceId: my.id, sql: 'DELETE FROM blocks' } }), (e) => e.code !== undefined)
    job = await call('saveReconcile', { ...def(), schedule: { time: '07:30', enabled: true }, channelId: ch.id, notifyOn: 'diff' })
    assert.match(job.id, /^rc-/)
    assert.deepEqual(job.schedule, { time: '07:30', enabled: true })
    const list = await call('listReconciles')
    assert.equal(list[0].leftName, 'MySQL')
    assert.equal(list[0].rightName, 'Ledger')
    assert.equal(list[0].channelName, 'RC')
  })

  await test('runReconcile on a saved job: records a run, pushes the diff with result tables and Excel attachment', async () => {
    sent.length = 0
    const out = await call('runReconcile', { id: job.id })
    assert.equal(out.status, 'diff')
    assert.equal(out.pushed, true)
    assert.equal(sent.length, 1)
    const msg = sent[0]
    assert.match(msg.title, /对账差异/)
    assert.match(msg.text, /一致率/)
    // Summary + non-empty detail tables only.
    assert.deepEqual(msg.results.map(r => r.title.split(' · ').pop()), ['汇总', '值不一致', '仅MySQL', '仅Ledger'])
    assert.ok(msg.attachment, 'summary has more rows than the channel shows → full-data Excel attached')
    const runs = await call('reconcileRuns', { id: job.id })
    assert.equal(runs.length, 1)
    assert.equal(runs[0].status, 'diff')
    assert.equal(runs[0].diffs.length, 3)
    assert.equal(runs[0].summary.onlyLeft, 1)
    const stored = (await call('listReconciles')).find(r => r.id === job.id)
    assert.equal(stored.lastRun.status, 'diff')
    assert.equal(stored.lastRun.onlyRight, 1)
  })

  await test('notifyOn diff does not push when consistent; always does', async () => {
    const same = { ...def(), right: { datasourceId: my.id, sql: SQL_MY }, compare: [{ left: 'n' }, { left: 'fee' }] }
    const j2 = await call('saveReconcile', { ...same, name: 'self', channelId: ch.id, notifyOn: 'diff' })
    sent.length = 0
    const a = await call('runReconcile', { id: j2.id })
    assert.equal(a.status, 'ok')
    assert.equal(a.summary.matchRate, 1)
    assert.equal(sent.length, 0)
    await call('saveReconcile', { id: j2.id, notifyOn: 'always' })
    const b = await call('runReconcile', { id: j2.id })
    assert.equal(b.pushed, true)
    assert.match(sent[0].title, /对账一致/)
    await call('deleteReconcile', { id: j2.id })
  })

  await test('scheduler: due once per daily slot, runs through tickAlerts, failures recorded', async () => {
    const cur = service.state.reconciles.find(r => r.id === job.id)
    const now = new Date()
    cur.schedule.time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    cur.lastScheduledAt = now.getTime() - 2 * 86400000
    const jobs = service.schedulerJobs(now).filter(j => j.id === `reconcile:${job.id}`)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].due(now), true)
    sent.length = 0
    await service.tickAlerts(new Date(now.getTime() + 1000))
    assert.equal(sent.length, 1)
    assert.ok(service.state.scheduler.lastRan.some(r => r.id === `reconcile:${job.id}` && r.ok))
    assert.equal(service.schedulerJobs(new Date(now.getTime() + 2000)).find(j => j.id === `reconcile:${job.id}`).due(new Date(now.getTime() + 2000)), false)
    const runs = await call('reconcileRuns', { id: job.id })
    assert.equal(runs[0].source, 'schedule')
    // A broken query is recorded as an error run and pushed as a failure.
    cur.right = { ...cur.right, sql: 'SELECT nope FROM missing_table' }
    sent.length = 0
    const bad = await call('runReconcile', { id: job.id })
    assert.equal(bad.ok, false)
    assert.match(bad.error, /右侧（Ledger）查询失败/)
    assert.match(sent[0].title, /对账失败/)
    assert.equal(service.state.reconciles.find(r => r.id === job.id).lastRun.status, 'error')
  })

  await test('agent tool nl2sql_reconcile: names accepted, summary + display meta', async () => {
    service.state.settings.resultToModel = 'summary'
    const r = await tool('nl2sql_reconcile', {
      left: { datasource: 'MySQL', sql: SQL_MY }, right: { datasource: 'Ledger', sql: `SELECT chain, cnt, fee_total FROM "${file.table}"` },
      keys: [{ left: 'chain' }], compare: [{ left: 'n', right: 'cnt' }], options: { ignoreCase: true }, title: '对一下',
    })
    assert.equal(r.model.summary.onlyLeft, 1)
    assert.equal(typeof r.model.firstDiffs, 'string', 'rows hidden by privacy=summary')
    assert.equal(r.display.reconcile, true)
    assert.equal(r.display.results.length, 4)
    assert.ok(r.display.results[1].resultId)
    JSON.stringify(r.display)
    service.state.settings.resultToModel = 'rows'
    const r2 = await tool('nl2sql_reconcile', { left: { datasource: 'MySQL', sql: SQL_MY }, right: { datasource: 'Ledger', sql: `SELECT chain, cnt FROM "${file.table}"` }, keys: [{ left: 'chain' }], compare: [{ left: 'n', right: 'cnt' }], options: { ignoreCase: true } })
    assert.ok(Array.isArray(r2.model.firstDiffs) && r2.model.firstDiffs.length === 3)
    service.state.settings.resultToModel = 'summary'
  })

  await test('actor scope, viewer and row rules apply to both sides', async () => {
    service.state.sessionActors = {
      's-scope': { id: 'u1', name: 'U1', kind: 'lark', datasourceIds: [my.id], role: 'analyst' },
      's-view': { id: 'u2', name: 'U2', kind: 'lark', datasourceIds: [my.id, file.id], role: 'viewer' },
      's-row': { id: 'u3', name: 'U3', kind: 'lark', datasourceIds: [my.id], role: 'analyst', rowRules: [{ column: 'chain', values: [truth[0].chain] }] },
    }
    const args = { left: { datasource: 'MySQL', sql: SQL_MY }, right: { datasource: 'Ledger', sql: `SELECT chain, cnt FROM "${file.table}"` }, keys: [{ left: 'chain' }] }
    await assert.rejects(tool('nl2sql_reconcile', args, { agent: { id: 's-scope' } }), /权限|访问|scope|不能/)
    await assert.rejects(tool('nl2sql_reconcile', args, { agent: { id: 's-view' } }), /只读/)
    await call('analyzeSchema', { id: my.id, refresh: true })
    const r = await tool('nl2sql_reconcile', { left: { datasource: 'MySQL', sql: SQL_MY }, right: { datasource: 'MySQL', sql: 'SELECT chain, COUNT(*) AS n FROM blockchain_transactions GROUP BY chain' }, keys: [{ left: 'chain' }], compare: [{ left: 'n' }] }, { agent: { id: 's-row' } })
    assert.equal(r.model.left.rows, 1, 'row rule filtered the left side')
    assert.equal(r.model.summary.matched, 1)
  })

  await test('per-side cap: a side larger than the cap is reported as truncated', async () => {
    const out = await service.reconcile({ left: { datasourceId: my.id, sql: 'SELECT id FROM blockchain_transactions' }, right: { datasourceId: my.id, sql: 'SELECT id FROM blockchain_transactions LIMIT 5' }, keys: ['id'] })
    assert.equal(out.summary.complete, true)
    assert.equal(out.summary.onlyLeft, truth.reduce((a, x) => a + x.n, 0) - 5)
    // runQuery honours the per-call cap above settings.maxRows (default 500) and clamps it to 200k.
    const big = await service.runQuery({ sql: 'SELECT id FROM blockchain_transactions', datasourceId: my.id, maxRows: 3 })
    assert.equal(big.rows.length, 3)
    assert.equal(big.truncated, true)
  })
} finally {
  unregisterAdapter?.('rcfake')
  await app.close()
}
summary()
