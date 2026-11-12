// service/suggestions.js: SQL shape normalization and metric / note / glossary / example
// mining on synthetic history (no database).
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const S = await plugin('service/suggestions.js')

const tables = [
  { name: 'orders', comment: '订单', columns: [
    { name: 'id', dataType: 'bigint', roles: ['id'] },
    { name: 'status', dataType: 'tinyint', roles: ['enum'], comment: '状态' },
    { name: 'amount', dataType: 'decimal', roles: ['measure'] },
    { name: 'channel', dataType: 'varchar', roles: ['enum'], comment: '渠道' },
    { name: 'created_at', dataType: 'datetime', roles: ['time'] },
    { name: 'phone', dataType: 'varchar', roles: ['sensitive'] },
  ] },
  { name: 'users', comment: '用户', columns: [{ name: 'id', dataType: 'bigint', roles: ['id'] }, { name: 'level', dataType: 'tinyint', roles: ['enum'] }] },
]
const empty = () => ({ glossary: [], metrics: [], notes: {}, examples: [] })
let at = 1000
const H = (sql, title, extra = {}) => ({ id: `h${at}`, at: at++, status: 'ok', source: 'agent', title, sql, datasourceId: 'd', ...extra })
const metricHistory = [
  H("SELECT DATE(created_at) d, SUM(amount) AS 成交金额 FROM orders WHERE status = 1 AND created_at >= '2026-01-01' GROUP BY d", '每天成交金额'),
  H('SELECT channel, SUM(amount) AS 成交金额 FROM orders WHERE status=1 GROUP BY channel', '各渠道成交金额'),
  H("SELECT SUM(o.amount) gmv FROM `orders` o WHERE o.status = 1 AND o.created_at >= '2026-02-01'", '本月成交金额'),
]

await test('sqlShape: literals → ?, lists collapsed, case/quotes/whitespace normalized', () => {
  assert.equal(S.sqlShape("SELECT * FROM orders WHERE status IN (1, 2,3) AND amount > -5 AND name='x'"), 'select * from orders where status in ( ? ) and amount > ? and name = ?')
  assert.equal(S.sqlShape('select  COUNT(*) from `Orders` where id = 7;'), S.sqlShape('SELECT count(*) FROM orders WHERE id=12'))
  assert.notEqual(S.sqlShape('SELECT a FROM t WHERE x = 1'), S.sqlShape('SELECT a FROM t WHERE y = 1'))
  // Comments and string contents never leak into the shape.
  assert.equal(S.sqlShape("SELECT 1 -- note\n FROM t WHERE s = 'a''b'"), 'select ? from t where s = ?')
  assert.equal(S.sqlCanonical("select A from T where s='x'"), S.sqlCanonical("SELECT a FROM t WHERE s = 'x'"))
})

await test('helpers: labels, metric names, title terms, question similarity', () => {
  assert.equal(S.labelFromAlias('成功笔数'), '成功')
  assert.equal(S.labelFromAlias('total_count'), undefined)
  assert.equal(S.cleanMetricName('最近30天每天成交金额趋势'), '成交金额')
  assert.ok(S.titleTerms('APP 渠道订单量').has('渠道'))
  assert.ok(S.titleTerms('APP 渠道订单量').has('APP'))
  assert.ok(!S.titleTerms('每天的统计').has('统计'))
  assert.ok(S.questionSimilarity('每天的订单量', '每天订单量') > 0.5)
  assert.ok(S.questionSimilarity('每天的订单量', '用户等级分布') < 0.2)
})

await test('metric: recurring SUM with same filter, alias name, time column, dimensions', () => {
  const r = S.mineSuggestions({ history: metricHistory, tables, knowledge: empty() })
  const m = r.filter((s) => s.kind === 'metric')
  assert.equal(m.length, 1)
  assert.deepEqual(m[0].item, { name: '成交金额', expression: 'SUM(amount)', table: 'orders', filter: 'status = 1', timeColumn: 'created_at', dimensions: ['channel'], synonyms: [], unit: '', description: '' })
  assert.equal(m[0].evidence.length, 3)
  assert.match(m[0].reason, /3 条成功的查询/)
  // Below the threshold → nothing; already in the library → nothing.
  assert.equal(S.mineSuggestions({ history: metricHistory.slice(0, 2), tables, knowledge: empty() }).filter((s) => s.kind === 'metric').length, 0)
  const lib = { ...empty(), metrics: [{ name: 'GMV', expression: 'sum(amount)', table: 'orders', filter: 'orders.status = 1' }] }
  assert.equal(S.mineSuggestions({ history: metricHistory, tables, knowledge: lib }).filter((s) => s.kind === 'metric').length, 0)
  // A different filter is a different metric.
  const other = metricHistory.map((h) => ({ ...h, sql: h.sql.replace(/status ?= ?1/, 'status = 2') }))
  const both = S.mineSuggestions({ history: [...metricHistory, ...other], tables, knowledge: empty() }).filter((s) => s.kind === 'metric')
  assert.equal(both.length, 2)
  assert.notEqual(both[0].item.name, both[1].item.name)
  // Failed / UI-cached queries are ignored.
  assert.equal(S.mineSuggestions({ history: metricHistory.map((h) => ({ ...h, status: 'error' })), tables, knowledge: empty() }).length, 0)
})

await test('note: CASE WHEN and aggregate-alias mappings on enum columns', () => {
  const history = [
    H("SELECT CASE status WHEN 0 THEN '待支付' WHEN 1 THEN '已支付' ELSE '其他' END s, COUNT(*) n FROM orders GROUP BY s", '订单状态分布'),
    H('SELECT SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS 退款笔数, COUNT(*) FROM orders', '退款订单数'),
    H("SELECT CASE WHEN o.status IN (3, 4) THEN '关闭' ELSE '其他' END k FROM orders o", '关闭订单'),
  ]
  const notes = S.mineSuggestions({ history, tables, knowledge: empty() }).filter((s) => s.kind === 'note')
  assert.equal(notes.length, 1)
  assert.deepEqual(notes[0].item, { key: 'orders.status', text: '0=待支付，1=已支付，2=退款，3=关闭，4=关闭' })
  // Column already has a note → nothing; sensitive / non-enum columns are never mapped.
  assert.equal(S.mineSuggestions({ history, tables, knowledge: { ...empty(), notes: { 'orders.status': 'x' } } }).filter((s) => s.kind === 'note').length, 0)
  const sens = [H("SELECT CASE phone WHEN '1' THEN '甲' END FROM orders", 'a'), H("SELECT CASE phone WHEN '2' THEN '乙' END FROM orders", 'b')]
  assert.equal(S.mineSuggestions({ history: sens, tables, knowledge: empty() }).filter((s) => s.kind === 'note').length, 0)
})

await test('glossary: recurring title term mapped to a column (with a consistent value)', () => {
  const history = [
    ...metricHistory,
    H("SELECT COUNT(*) FROM orders WHERE channel = 'app'", 'APP 渠道订单量'),
    H("SELECT DATE(created_at), COUNT(*) FROM orders WHERE channel = 'app' GROUP BY 1", 'APP 渠道每日订单'),
    H("SELECT status, COUNT(*) FROM orders WHERE channel = 'app' GROUP BY status", 'APP 渠道订单状态'),
  ]
  const g = S.mineSuggestions({ history, tables, knowledge: empty() }).filter((s) => s.kind === 'glossary')
  const app = g.find((s) => s.item.term === 'APP')
  assert.ok(app, JSON.stringify(g.map((x) => x.item.term)))
  assert.equal(app.item.definition, "指 orders.channel（渠道） = 'app' 的记录")
  assert.equal(app.item.sql, "channel = 'app'")
  assert.ok(g.every((s) => /^指 /.test(s.item.definition)))
  // Already in the glossary (as a synonym) → not suggested.
  const known = { ...empty(), glossary: [{ term: 'App 渠道', synonyms: ['APP'], definition: 'x' }] }
  assert.ok(!S.mineSuggestions({ history, tables, knowledge: known }).some((s) => s.kind === 'glossary' && s.item.term === 'APP'))
})

await test('examples: 👍 / corrected feedback, repeated shapes, dedupe against existing examples', () => {
  const history = [
    H("SELECT COUNT(*) FROM orders WHERE channel = 'app'", 'APP 订单量'),
    H("SELECT COUNT(*) FROM orders WHERE channel = 'web'", 'Web 订单量'),
    H("SELECT COUNT(*) FROM orders WHERE channel = 'mini'", '小程序订单量', { source: 'ui' }),
  ]
  const feedback = [
    { id: 'f1', at: 50, rating: 'up', question: '各渠道订单数', sql: 'SELECT channel, COUNT(*) FROM orders GROUP BY channel' },
    { id: 'f2', at: 60, rating: 'down', status: 'resolved', question: '用户等级', sql: 'SELECT 1', correctedSql: 'SELECT level, COUNT(*) FROM users GROUP BY level', comment: '口径' },
    { id: 'f3', at: 70, rating: 'down', status: 'open', question: '未处理', sql: 'SELECT 2 FROM orders' },
    { id: 'f4', at: 80, rating: 'up', question: '写操作', sql: 'DELETE FROM orders' },
  ]
  const ex = S.mineSuggestions({ history, feedback, tables, knowledge: empty() }).filter((s) => s.kind === 'example')
  assert.deepEqual(ex.map((s) => s.item.question).sort(), ['Web 订单量', '各渠道订单数', '用户等级'].sort())
  const corrected = ex.find((s) => s.item.question === '用户等级')
  assert.equal(corrected.item.sql, 'SELECT level, COUNT(*) FROM users GROUP BY level')
  assert.match(corrected.item.note, /修正自反馈/)
  const shape = ex.find((s) => s.item.question === 'Web 订单量')
  assert.equal(shape.evidence.length, 2, 'ui query of the same shape does not count')
  // Existing example (same SQL modulo case/whitespace, or similar question) → deduped.
  const k = { ...empty(), examples: [{ question: '各个渠道的订单数', sql: 'select 1' }, { question: 'x', sql: 'select level, count(*) from users group by level' }, { question: 'y', sql: "SELECT COUNT(*) FROM orders WHERE channel = 'zzz'" }] }
  assert.equal(S.mineSuggestions({ history, feedback, tables, knowledge: k }).filter((s) => s.kind === 'example').length, 0)
})

await test('stable ids, access filter and sensitive values', () => {
  const a = S.mineSuggestions({ history: metricHistory, tables, knowledge: empty() })
  const b = S.mineSuggestions({ history: [...metricHistory].reverse(), tables, knowledge: empty() })
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id))
  assert.equal(S.mineSuggestions({ history: metricHistory, tables, knowledge: empty(), accessOk: () => false }).length, 0)
  // Hidden table (not in the visible schema) → nothing about it.
  assert.equal(S.mineSuggestions({ history: metricHistory, tables: tables.filter((t) => t.name !== 'orders'), knowledge: empty() }).length, 0)
  const sens = [H("SELECT * FROM orders WHERE phone = '13800000000'", '查手机号'), H("SELECT * FROM orders WHERE phone = '13900000000'", '查手机号')]
  const r = S.mineSuggestions({ history: sens, feedback: [{ id: 'f', at: 1, rating: 'up', question: '查号码', sql: "SELECT id FROM orders WHERE phone = '13700000000'" }], tables, knowledge: empty() })
  assert.ok(!JSON.stringify(r).includes('138000') && !JSON.stringify(r).includes('137000'), JSON.stringify(r))
})

summary('suggestions')
