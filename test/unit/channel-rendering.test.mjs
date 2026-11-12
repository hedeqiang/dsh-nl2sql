// Rendering of data-derived text on every platform: NULL numbers, line breaks in cells,
// Markdown / tag injection from data (Lark, Telegram, WeCom, DingTalk); bot command parsing.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const m = await plugin('channels/message.js')
const lark = await plugin('channels/lark.js')
const tg = await plugin('channels/telegram.js')
const ding = await plugin('channels/dingtalk.js')
const wecom = await plugin('channels/wecom.js')
const { parseBotCommand } = await plugin('service/bots.js')

const EVIL = '<at id=all></at> [点我](https://evil.example) **x**'
const tbl = { title: 't', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['a', null], ['b', 5], ['c', 1]], rowCount: 3, chart: { type: 'table' } }

await test('NULL numbers are empty / — instead of 0', () => {
  assert.equal(m.fmtNum(null), '')
  assert.equal(m.fmtNum(''), '')
  assert.equal(m.fmtNum(0), '0')
  assert.equal(m.kpiText({ columns: [{ name: 'gmv', kind: 'number' }], rows: [[null]] }), '**gmv**：—')
  const card = lark.buildCard({ title: 'x', results: [tbl] })
  const rows = card.body.elements.find(e => e.tag === 'table').rows
  assert.equal(rows[0].c1, undefined, JSON.stringify(rows[0]))
  assert.equal(rows[1].c1, 5)
  assert.match(ding.resultAsDingText(tbl), /1\. a ｜ —\n/)
  assert.ok(!/\| 0 \|/.test(m.resultAsText(tbl)))
})

await test('CR / LF / CRLF inside cells do not break tables or numbered rows', () => {
  for (const br of ['\r', '\n', '\r\n']) {
    const r = { title: 'cr', columns: [{ name: 'a', kind: 'text' }, { name: 'b', kind: 'text' }], rows: [[`x${br}y`, 'z'], ['p', 'q'], ['r', 's']], rowCount: 3 }
    const md = m.resultAsMarkdownTable(r)
    assert.equal(md.split('\n').length, 5, JSON.stringify(md))
    assert.match(md, /\| x y \| z \|/)
    const html = tg.markdownToTelegram(md).join('')
    assert.match(html, /^<pre>[\s\S]*x y {2}z[\s\S]*<\/pre>$/, html)
    assert.match(ding.resultAsDingText(r), /1\. x y ｜ z\n2\. p/)
    const card = lark.buildCard({ title: 'x', results: [r] })
    assert.equal(card.body.elements.find(e => e.tag === 'table').rows[0].c0, 'x y')
  }
})

await test('Lark: data-derived text is escaped; the authored message text is not', () => {
  const kpi = { title: `标题 ${EVIL}`, columns: [{ name: 'name', kind: 'text' }], rows: [[EVIL]], rowCount: 1 }
  const err = { title: 'E', error: `失败 ${EVIL}` }
  const card = lark.buildCard({ title: 'x', text: '<at id=all></at> **作者文本**', results: [kpi, err], footer: `页脚 ${EVIL}` })
  const md = card.body.elements.filter(e => e.tag === 'markdown').map(e => e.content)
  assert.equal(md[0], '<at id=all></at> **作者文本**', 'agent text untouched')
  const data = md.slice(1).join('\n')
  assert.ok(!/<at\b/.test(data), data)
  assert.ok(!/\[点我\]\(/.test(data), data)
  assert.ok(!/\*\*x\*\*/.test(data), data)
  assert.match(data, /&#60;at id=all&#62;&#60;\/at&#62;/)
  assert.match(data, /<font color='grey'>页脚 /, 'our own font tag kept')
  assert.match(data, /<font color='red'>失败 &#60;at/)
  // more than 5 tables → text rows: escaped too
  const big = { ...tbl, title: 'b', rows: [[EVIL, 1], ['x', 2], ['y', 3]] }
  const many = lark.buildCard({ title: 'x', results: Array.from({ length: 6 }, () => big) })
  const last = many.body.elements.filter(e => e.tag === 'markdown').map(e => e.content).join('\n')
  assert.ok(!/<at\b/.test(last), last)
  // legacy JSON 1.0 fallback renders table cells as lark_md: escaped
  const legacy = lark.legacyCard(lark.buildCard({ title: 'x', results: [big] }))
  assert.ok(!/<at\b/.test(legacy.elements[0].content), legacy.elements[0].content)
})

await test('Telegram / WeCom / DingTalk: data cannot inject links, tags or mentions', () => {
  const r = { title: `T ${EVIL}`, columns: [{ name: 'n', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [[EVIL, 1], ['b', 2], ['c', 3]], rowCount: 3, chart: { type: 'table' } }
  const k = { title: 'K', columns: [{ name: 'n', kind: 'text' }], rows: [[EVIL]], rowCount: 1 }
  const message = { title: `标题 ${EVIL}`, text: '[文档](https://ok.example)', results: [r, k, { title: 'E', error: EVIL }], footer: `f ${EVIL}`, chartMode: 'table' }
  // Telegram: only the authored link becomes <a>
  const segs = tg.planMessage(message)
  const html = segs.filter(s => s.kind === 'text').flatMap(s => tg.markdownToTelegram(s.md)).join('\n')
  assert.equal((html.match(/<a href=/g) ?? []).length, 1, html)
  assert.match(html, /<a href="https:\/\/ok\.example">文档<\/a>/)
  assert.ok(!html.includes('evil.example">'), html)
  // WeCom webhook / AI bot markdown
  for (const step of wecom.planWebhook(message).filter(s => s.content)) {
    assert.ok(!/\]\(https:\/\/evil/.test(step.content), step.content)
    assert.ok(!/<at\b|<@/.test(step.content), step.content)
  }
  // DingTalk
  const { chunks } = ding.renderMarkdown(message)
  const text = chunks.join('\n')
  assert.ok(!/\]\(https:\/\/evil/.test(text), text)
  assert.ok(!/<at\b/.test(text), text)
  assert.match(text, /\[文档\]\(https:\/\/ok\.example\)/, 'authored link kept')
  // shared plain-Markdown renderer
  const md = m.messageAsMarkdown(message)
  assert.ok(!/\]\(https:\/\/evil/.test(md), md)
})

await test('bot commands: whole message only; switch needs an argument; English aliases', () => {
  for (const q of ['自动续费用户有多少', '数据源表里有几行', '切换率是多少', 'help me count orders', '帮助中心的访问量', 'new users', 'reset password count', 'user count', 'auto renewals']) assert.equal(parseBotCommand(q), null, q)
  const cases = { 帮助: 'help', '/help': 'help', 'help?': 'help', '帮助？': 'help', start: 'help', 数据源: 'sources', sources: 'sources', DataSources: 'sources', '数据源。': 'sources', 自动: 'auto', 'auto!': 'auto', 新对话: 'reset', new: 'reset', reset: 'reset' }
  for (const [t, verb] of Object.entries(cases)) assert.deepEqual(parseBotCommand(t), { verb }, t)
  assert.deepEqual(parseBotCommand('切换'), { verb: 'switch', arg: '' })
  assert.deepEqual(parseBotCommand('switch'), { verb: 'switch', arg: '' })
  assert.deepEqual(parseBotCommand('切换 销售库'), { verb: 'switch', arg: '销售库' })
  assert.deepEqual(parseBotCommand('/切换数据源  A'), { verb: 'switch', arg: 'A' })
  assert.deepEqual(parseBotCommand('switch sales db'), { verb: 'switch', arg: 'sales db' })
  assert.deepEqual(parseBotCommand('use A'), { verb: 'switch', arg: 'A' })
})

summary('channel rendering')
