// Service (MySQL): knowledge suggestions mined from query history and feedback —
// examples (👍 feedback, repeated shapes), metrics (recurring aggregates), notes (CASE
// mappings); accept / dismiss (persisted across restart); access policy hides everything.
import { cpSync } from 'node:fs'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, tempDir } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'svc-suggest' })
const { call, service } = app
let app2
let ds
const T = 'blockchain_transactions'
const agent = (sql, title) => service.runQuery({ sql, title, datasourceId: ds.id, source: 'agent' })
const list = async (a = app) => (await a.call('listKnowledgeSuggestions', { datasourceId: ds.id })).suggestions
try {
  await test('setup: data source, schema, agent queries, feedback', async () => {
    ds = await call('saveDatasource', { name: 'sg' + Date.now(), ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    // Empty at first.
    assert.equal((await call('suggestionCount', { datasourceId: ds.id })).count, 0)
    // Recurring metric: SUM(amount) WHERE status = 1 (time filters differ and are not part of the definition).
    await agent(`SELECT DATE(created_at) AS d, SUM(amount) AS 成功金额 FROM ${T} WHERE status = 1 AND created_at >= '2020-01-01' GROUP BY DATE(created_at)`, '每天的成功金额')
    await agent(`SELECT chain, SUM(amount) AS 成功金额 FROM ${T} WHERE status = 1 GROUP BY chain`, '各链成功金额')
    await agent(`SELECT SUM(t.amount) AS total FROM ${T} t WHERE t.status = 1 AND t.created_at >= '2021-01-01'`, '成功金额合计')
    // Repeated shape: only the literal differs.
    await agent(`SELECT COUNT(*) AS n FROM ${T} WHERE chain = 'eth'`, '以太坊链上交易笔数')
    await agent(`SELECT COUNT(*) AS n FROM ${T} WHERE chain = 'tron'`, '波场链上交易笔数')
    // CASE mapping of an enum column.
    await agent(`SELECT CASE status WHEN 0 THEN '待确认' WHEN 1 THEN '成功' WHEN 2 THEN '失败' END AS 状态, COUNT(*) AS n FROM ${T} GROUP BY status`, '交易状态分布')
    await agent(`SELECT SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS 成功笔数, COUNT(*) AS 总笔数 FROM ${T}`, '成功率')
    // 👍 on a UI query with a question.
    const r = await call('runQuery', { datasourceId: ds.id, sql: `SELECT direction, COUNT(*) AS n FROM ${T} GROUP BY direction` })
    await call('submitFeedback', { resultId: r.resultId, rating: 'up', question: '各方向的交易笔数' })
  })

  let sugg
  await test('suggestions: example from feedback, repeated shape, metric, note', async () => {
    sugg = await list()
    const kinds = sugg.map((s) => s.kind)
    assert.ok(kinds.includes('example') && kinds.includes('metric') && kinds.includes('note'), JSON.stringify(kinds))
    for (const s of sugg) {
      assert.match(s.id, /^sg-[0-9a-f]{10}$/)
      assert.ok(s.evidence.length >= 1 && s.evidence.length <= 5)
      assert.ok(typeof s.score === 'number' && s.reason.length > 5)
    }
    const fb = sugg.find((s) => s.kind === 'example' && s.item.question === '各方向的交易笔数')
    assert.ok(fb, 'example from 👍 feedback')
    assert.equal(fb.evidence[0].source, 'feedback')
    const shape = sugg.find((s) => s.kind === 'example' && /chain = 'tron'/.test(s.item.sql))
    assert.ok(shape, 'repeated shape → latest instance')
    assert.equal(shape.item.question, '波场链上交易笔数')
    assert.equal(shape.evidence.length, 2)
    const metric = sugg.find((s) => s.kind === 'metric' && s.item.expression === 'SUM(amount)')
    assert.ok(metric, 'metric for repeated SUM(amount)')
    assert.equal(metric.item.table, T)
    assert.equal(metric.item.filter, 'status = 1')
    assert.equal(metric.item.name, '成功金额')
    assert.equal(metric.item.timeColumn, 'created_at')
    assert.deepEqual(metric.item.dimensions, ['chain'])
    assert.equal(metric.evidence.length, 3)
    const note = sugg.find((s) => s.kind === 'note' && s.item.key === `${T}.status`)
    assert.ok(note, 'note from CASE mapping')
    assert.equal(note.item.text, '0=待确认，1=成功，2=失败')
    // Stable ids.
    assert.deepEqual((await list()).map((s) => s.id), sugg.map((s) => s.id))
    const count = await call('suggestionCount', { datasourceId: ds.id })
    assert.equal(count.count, sugg.length)
  })

  await test('accept (edited) metric → in knowledge, suggestion gone', async () => {
    const metric = sugg.find((s) => s.kind === 'metric' && s.item.expression === 'SUM(amount)')
    const r = await call('acceptSuggestion', { datasourceId: ds.id, id: metric.id, item: { name: '成功交易金额', unit: 'ETH' } })
    assert.equal(r.kind, 'metric')
    const k = await call('getKnowledge', { datasourceId: ds.id })
    const m = k.metrics.find((x) => x.name === '成功交易金额')
    assert.ok(m)
    assert.equal(m.expression, 'SUM(amount)')
    assert.equal(m.unit, 'ETH')
    assert.ok(!(await list()).some((s) => s.id === metric.id))
    await assert.rejects(call('acceptSuggestion', { datasourceId: ds.id, id: metric.id }), /不存在或已处理/)
  })

  await test('accept example re-checks the SQL', async () => {
    const ex = sugg.find((s) => s.kind === 'example' && s.item.question === '各方向的交易笔数')
    await assert.rejects(call('acceptSuggestion', { datasourceId: ds.id, id: ex.id, item: { sql: `DELETE FROM ${T}` } }), /只读|not allowed|read-only|refused/i)
    await call('acceptSuggestion', { datasourceId: ds.id, id: ex.id })
    const k = await call('getKnowledge', { datasourceId: ds.id })
    assert.ok(k.examples.some((e) => e.question === '各方向的交易笔数'))
  })

  let noteId
  await test('dismiss note → gone and stays dismissed after restart', async () => {
    noteId = sugg.find((s) => s.kind === 'note').id
    await call('dismissSuggestion', { datasourceId: ds.id, id: noteId })
    assert.ok(!(await list()).some((s) => s.id === noteId))
    await service.writing
    const dir2 = tempDir('svc-suggest-2')
    cpSync(app.dir, dir2, { recursive: true })
    app2 = await boot({ dataDir: dir2 })
    const after = await list(app2)
    assert.ok(after.length > 0, 'other suggestions survive')
    assert.ok(!after.some((s) => s.id === noteId), 'dismissal persisted')
    assert.deepEqual(app2.service.state.suggestionDismissed[ds.id].includes(noteId), true)
  })

  await test('policy-hidden tables produce no suggestions', async () => {
    await call('savePolicy', { id: ds.id, policy: { mode: 'deny', tables: [T] } })
    assert.deepEqual(await list(), [])
    assert.equal((await call('suggestionCount', { datasourceId: ds.id })).count, 0)
    await call('savePolicy', { id: ds.id, policy: { mode: 'all' } })
    assert.ok((await list()).length > 0)
  })

  await test('bad ids are rejected', async () => {
    await assert.rejects(call('dismissSuggestion', { datasourceId: ds.id, id: '../x' }), /无效/)
  })
} finally {
  if (app2) await app2.close()
  await app.close()
}
summary('service suggestions')
