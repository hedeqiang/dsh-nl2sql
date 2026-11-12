// Feature "proactive": daily digest (preview + push through a fake IM adapter + scheduler job),
// alert auto-attribution hook, goals progress, forecast RPC and nl2sql_forecast tool.
// Uses a local file (SQLite) data source with synthetic data relative to today: no external database.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const { registerAdapter } = await plugin('channels/index.js')
const sent = []
registerAdapter({
  id: 'fakepro',
  name: { zh: '假 IM', en: 'Fake IM' },
  kinds: [{
    id: 'fakepro_hook',
    label: { zh: '假 IM', en: 'Fake IM' },
    description: { zh: '测试用', en: 'for tests' },
    fields: [{ key: 'chatId', label: { zh: '群', en: 'Chat' }, type: 'text', required: true, target: true }],
    capabilities: { push: true, markdown: 'basic', charts: 'image', tables: 'markdown', buttons: false, bot: false, listTargets: false },
    setupSteps: { zh: ['一'], en: ['one'] },
    validate(input) { return { config: { chatId: String(input.config?.chatId ?? 'g') }, secrets: {} } },
    async send(_channel, _secrets, message) { sent.push(message); return { messageId: `m${sent.length}`, images: 0 } },
    async test() { return { ok: true } },
  }],
})

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date(); today.setHours(0, 0, 0, 0)
const dayAt = (k) => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + k))

// 60 days ending yesterday: ~10 rows/day split over chains A/B; yesterday +12 extra rows on chain A.
const lines = ['day,chain,amount']
for (let k = -60; k <= -1; k++) {
  const n = 10 + ((k + 60) % 3)
  for (let i = 0; i < n; i++) lines.push(`${dayAt(k)},${i % 2 ? 'A' : 'B'},${10 + i}`)
  if (k === -1) for (let i = 0; i < 12; i++) lines.push(`${dayAt(k)},A,5`)
}
// A few rows today (partial day).
for (let i = 0; i < 4; i++) lines.push(`${dayAt(0)},B,1`)
const csv = lines.join('\n') + '\n'

const app = await boot({ label: 'proactive' })
const { call, service } = app
try {
  const imp = await call('importUpload', { fileName: 'tx.csv', base64: Buffer.from(csv).toString('base64'), newName: 'tx-file' })
  assert.equal(imp.results[0].ok, true, JSON.stringify(imp))
  const dsId = imp.datasourceId
  const table = imp.results[0].table
  await call('analyzeSchema', { id: dsId, refresh: true })
  await call('saveKnowledgeItem', { datasourceId: dsId, kind: 'metric', item: { name: '交易笔数', expression: 'COUNT(*)', table, timeColumn: 'day', dimensions: 'chain' } })
  const ch = await call('saveChannel', { name: 'P', type: 'fakepro_hook', config: { chatId: 'g1' } })

  await test('digest: save validates metrics; preview flags the spike and attributes it to chain A', async () => {
    await assert.rejects(call('saveDigest', { name: 'x', datasourceId: dsId, metrics: ['不存在'] }), /指标库/)
    await assert.rejects(call('saveDigest', { name: 'x', datasourceId: dsId, metrics: [] }), /至少/)
    const d = await call('saveDigest', { name: '交易日报', datasourceId: dsId, metrics: ['交易笔数'], channelId: ch.id, time: '09:00' })
    assert.equal(d.language, 'zh')
    const before = sent.length
    const r = await call('runDigest', { id: d.id })
    assert.equal(sent.length, before, 'preview does not send')
    assert.equal(r.preview, true)
    assert.match(r.title, new RegExp(dayAt(-1)))
    const item = r.items[0]
    assert.equal(item.notable, true, JSON.stringify(item))
    assert.ok(item.stats.vsAvg > 0.5, JSON.stringify(item.stats))
    assert.match(r.text, /交易笔数\*\* 昨天 2\d，比 7 日均值高 \d+%/)
    assert.match(r.text, /主要来自 A \+\d+/, r.text)
    assert.equal(r.resultIds.length, 1)
    assert.equal(r.results[0].rows.length > 0, true)
    const runs = await call('listDigestRuns', { digestId: d.id })
    assert.equal(runs[0].status, 'ok')
    assert.equal(runs[0].preview, true)
  })

  await test('digest: scheduler job pushes once per slot; english text', async () => {
    const d = (await call('listDigests'))[0]
    await call('saveDigest', { id: d.id, language: 'en' })
    const jobs = service.jobs_proactive(new Date())
    const job = jobs.find(j => j.id === `digest:${d.id}`)
    assert.ok(job)
    // Slot = most recent 09:00; created just now → due only if created before it — force by backdating.
    service.state.digests[0].createdAt = 0
    assert.equal(service.jobs_proactive(new Date()).find(j => j.id === job.id).due(new Date()), true)
    const before = sent.length
    await service.tickAlerts(new Date())
    assert.equal(sent.length, before + 1, 'pushed by the scheduler tick')
    const msg = sent.at(-1)
    assert.match(msg.title, /交易日报/)
    assert.match(msg.text, /yesterday .* vs 7-day avg/)
    assert.equal(msg.results.length, 1)
    assert.equal(service.jobs_proactive(new Date()).find(j => j.id === job.id).due(new Date()), false, 'not due again')
    assert.equal(service.state.digests[0].lastStatus, 'ok')
  })

  await test('alert push carries the auto-attribution line', async () => {
    const al = await call('saveAlert', { name: '笔数突增', datasourceId: dsId, source: 'sql', sql: `select day as d, count(*) as n from "${table}" where day < '${dayAt(0)}' group by day order by day`, condition: { type: 'change', direction: 'up', pct: 20 }, channelId: ch.id })
    const before = sent.length
    const r = await call('checkAlert', { id: al.id })
    assert.equal(r.triggered, true, JSON.stringify(r))
    assert.equal(sent.length, before + 1)
    assert.match(sent.at(-1).text, /主要来自：chain — A \+\d+/, sent.at(-1).text)
    // Non-series result: no extra line, push still works.
    assert.equal(await service.beforeAlertPush(al, { columns: [{ name: 'v', kind: 'number' }], rows: [[1]] }), null)
  })

  await test('goals: progress, run-rate projection and status; dashboard filter', async () => {
    await assert.rejects(call('saveGoal', { name: 'g', datasourceId: dsId, metric: '交易笔数', target: 'abc' }), /数字/)
    const g = await call('saveGoal', { name: '月交易量', datasourceId: dsId, metric: '交易笔数', period: 'month', target: 100 })
    const [p] = await call('goalProgress', {})
    assert.equal(p.id, g.id)
    assert.ok(p.actual > 0, JSON.stringify(p))
    assert.ok(p.projected >= p.actual)
    assert.ok(['achieved', 'on-track'].includes(p.status), p.status)
    assert.equal(p.weekdayAware, true)
    await call('saveGoal', { id: g.id, target: 1e7 })
    const [p2] = await call('goalProgress', {})
    assert.equal(p2.status, 'at-risk')
    // Dashboard scoping: a board with no widgets of this source shows no untied goals.
    const boards = await call('saveDashboard', { name: 'empty' })
    const board = boards.dashboards.find(b => b.name === 'empty')
    assert.deepEqual(await call('goalProgress', { dashboardId: board.id }), [])
    await call('saveGoal', { id: g.id, dashboardId: board.id })
    assert.equal((await call('goalProgress', { dashboardId: board.id })).length, 1)
    const rep = await service.goalReport({})
    assert.match(rep.text, /月交易量.*有风险/)
  })

  await test('forecast RPC and nl2sql_forecast tool on a daily metric series', async () => {
    const r = await call('queryMetric', { datasourceId: dsId, metric: '交易笔数', grain: 'day', from: dayAt(-60), to: dayAt(0) })
    const f = await call('forecast', { resultId: r.resultId, horizon: 7 })
    assert.equal(f.method, 'holt-winters')
    assert.equal(f.forecast.length, 7)
    assert.equal(f.forecast[0].x, dayAt(0))
    for (const x of f.forecast) assert.ok(x.lower <= x.value && x.value <= x.upper)
    assert.ok(f.forecast.every(x => x.value > 0 && x.value < 60), JSON.stringify(f.forecast))
    const derived = await call('getResult', { resultId: f.forecastResultId })
    assert.equal(derived.rows.length, f.history.length + 7)
    const out = await app.tool('nl2sql_forecast', { resultId: r.resultId, horizon: 3 })
    assert.equal(out.display.forecast.forecast.length, 3)
    assert.match(out.model.summary, /Holt-Winters/)
    const kpi = await call('queryMetric', { datasourceId: dsId, metric: '交易笔数' })
    await assert.rejects(call('forecast', { resultId: kpi.resultId }), /时间/)
  })
} finally {
  await app.close()
}
summary('proactive')
