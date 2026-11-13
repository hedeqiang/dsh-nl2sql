// Bot reply cards: which results are shown, which buttons apply, single records as field lists,
// value labels from column comments ("10（处理中）"), long ids not abbreviated.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
const { selectReplyResults, isPointLookup } = await plugin('service/bots.js')
const { parseValueLabels } = await plugin('service/shared.js')
const { kpiText, labelValue, isKpi, comparisonShape, prettyColumn, displayValue, fmtPlain } = await plugin('channels/message.js')
const { buildCard } = await plugin('channels/lark.js')

const r = (over) => ({ resultId: 'r', title: 't', columns: [{ name: 'a', kind: 'text' }], rows: [['x']], rowCount: 1, ...over })

await test('reply results: hidden and empty probes are dropped when real results exist; max 4', () => {
  const empty = r({ title: '核查入金', rows: [], rowCount: 0 })
  const hidden = r({ title: 'probe', hidden: true })
  const a = r({ title: 'A' }), b = r({ title: 'B' })
  assert.deepEqual(selectReplyResults([empty, a, hidden, b]).map(x => x.title), ['A', 'B'])
  assert.deepEqual(selectReplyResults([empty]).map(x => x.title), ['核查入金'], 'an empty answer is still shown when it is all there is')
  assert.equal(selectReplyResults([r({ error: 'boom', rows: [] }), a]).length, 2, 'errors are kept')
  assert.equal(selectReplyResults(Array.from({ length: 6 }, (_, i) => r({ title: `R${i}` }))).length, 4)
})

await test('point lookups are recognised (order no / id / hash), aggregates are not', () => {
  for (const sql of [
    "select * from order_withdraw where order_no = '227529944283258063259'",
    'select trade_no, status from order_trade where order_id = 227529944283258063259',
    "select count(*) from callback_record where order_no='2275299442832580'",
    "select * from t where tx_hash = '0xabcdef1234'",
  ]) assert.ok(isPointLookup({ sql }, 'mysql'), sql)
  for (const sql of ['select status, count(*) from order_withdraw group by status', "select count(*) from order_withdraw where created_at >= '2026-11-12'", "select * from t where status = 10"])
    assert.ok(!isPointLookup({ sql }, 'mysql'), sql)
})

await test('value labels parsed from comments; codes shown with meanings', () => {
  const labels = parseValueLabels('交易状态: 0=交易开始，10=处理中，11=交易失败，20=交易完成')
  assert.deepEqual(labels, { 0: '交易开始', 10: '处理中', 11: '交易失败', 20: '交易完成' })
  assert.deepEqual(parseValueLabels('订单类型: 1withdraw,2deposit'), { 1: 'withdraw', 2: 'deposit' })
  assert.equal(parseValueLabels('货币'), null)
  assert.equal(parseValueLabels('金额(单位: 分), 保留2位'), null)
  assert.equal(labelValue({ name: 'status', labels }, 10), '10（处理中）')
  assert.equal(labelValue({ name: 'status', labels }, 99), undefined)
})

await test('single record → one field per line, labels applied, long ids in full (no 万/亿)', () => {
  const rec = { columns: [{ name: '交易编号', kind: 'text' }, { name: '交易状态', kind: 'number', labels: { 10: '处理中' } }, { name: '交易类型', kind: 'number', labels: { 1: 'withdraw' } }, { name: '交易哈希', kind: 'text' }, { name: 'order_no', kind: 'number' }], rows: [['TR2275370601234567890123', 10, 1, null, '227529944283258063259']] }
  assert.ok(isKpi(rec))
  const text = kpiText(rec)
  const lines = text.split('\n')
  assert.equal(lines.length, 5, text)
  assert.match(text, /TR2275370601234567890123/, 'not truncated')
  assert.match(text, /交易状态\*\*：10（处理中）/)
  assert.match(text, /交易类型\*\*：1（withdraw）/)
  assert.match(text, /交易哈希\*\*：—/)
  assert.match(text, /227529944283258063259/, 'order number not shown as 2.28e+20 or 万/亿')
  // short KPI stays on one line
  assert.equal(kpiText({ columns: [{ name: 'n', kind: 'number' }, { name: 'sum', kind: 'number' }], rows: [[3, 120000]] }).includes('\n'), false)
})

await test('lark card: labelled column shows "code（label）" in a table', () => {
  const res = { title: 'x', columns: [{ name: 'status', kind: 'number', labels: { 10: '处理中', 20: '完成' } }, { name: 'n', kind: 'number' }], rows: [[10, 5], [20, 7]], rowCount: 2, chart: { type: 'table' } }
  const card = buildCard({ title: 't', results: [res] })
  const table = card.body.elements.find(e => e.tag === 'table')
  assert.equal(table.rows[0].c0, '10（处理中）')
  assert.equal(table.columns[0].data_type, 'text')
})

await test('readable values: thousands separators, percents with sign, readable column names', () => {
  assert.equal(fmtPlain(690751.94), '690,751.94')
  assert.equal(fmtPlain(1258), '1,258')
  assert.equal(displayValue({ name: '订单环比_pct', kind: 'number' }, -25.54), '-25.54%')
  assert.equal(displayValue({ name: '金额环比_pct', kind: 'number' }, 51.29), '+51.29%')
  assert.equal(displayValue({ name: '成功率', kind: 'number' }, 98.5), '98.5%', 'no + sign for non-change percents')
  assert.equal(prettyColumn('订单环比_pct'), '订单环比')
  assert.equal(prettyColumn('上周充值折算_U'), '上周充值折算（U）')
  assert.equal(prettyColumn('order_count'), 'order count')
})

await test('one row of period pairs becomes a comparison table with matched changes', () => {
  const names = ['上周成功充值记录数', '上周充值订单数', '上周充值折算_U', '上周单均折算_U', '前周成功充值记录数', '前周充值订单数', '前周充值折算_U', '前周单均折算_U', '订单环比_pct', '金额环比_pct', '单均环比_pct']
  const r = { title: 't', columns: names.map(n => ({ name: n, kind: 'number' })), rows: [[1258, 1245, 690751.94, 554.82, 1774, 1672, 456567.12, 273.06, -25.54, 51.29, 103.18]], rowCount: 1 }
  const cmp = comparisonShape(r)
  assert.deepEqual(cmp.periods, ['上周', '前周'])
  assert.deepEqual(cmp.metrics.map(m => [m.name, m.change ? m.change.col.name : null]), [['成功充值记录数', null], ['充值订单数', '订单环比_pct'], ['充值折算（U）', '金额环比_pct'], ['单均折算（U）', '单均环比_pct']])
  const md = kpiText(r)
  assert.match(md, /^\| 指标 \| 上周 \| 前周 \| 变化 \|/)
  assert.match(md, /\| 充值折算（U） \| 690,751\.94 \| 456,567\.12 \| \+51\.29% \|/)
  const card = buildCard({ title: 't', results: [r] })
  const table = card.body.elements.find(e => e.tag === 'table')
  assert.deepEqual(table.columns.map(c => c.display_name), ['指标', '上周', '前周', '变化'])
  assert.equal(table.rows.length, 4)
  // not a comparison: a single record stays a field list
  assert.equal(comparisonShape({ columns: [{ name: '交易编号' }, { name: '状态' }], rows: [['T1', 10]] }), null)
})

summary('bot reply card')
