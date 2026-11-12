// channels/wecom.js: webhook rendering/push/errors and the AI-bot long connection — against local fakes.
import { createHash } from 'node:crypto'
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
import { fakeHttp, fakeWs, waitFor } from '../fixtures/channels/fake-servers.mjs'

const wc = await plugin('channels/wecom.js')
const adapter = wc.default
const webhook = adapter.kinds.find(k => k.id === 'wecom_webhook')
const aibot = adapter.kinds.find(k => k.id === 'wecom_aibot')
const KEY = 'k-' + '0'.repeat(8) + '-test-key'
const WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${KEY}`

// ------------------------------------------------------------ webhook fake
let reply = () => ({ json: { errcode: 0, errmsg: 'ok' } })
const http = await fakeHttp((call) => reply(call))
const hookChannel = { id: 'ch_wc', type: 'wecom_webhook', apiBase: http.url, config: {} }
const hookSecrets = { webhookUrl: WEBHOOK }
const noThrottle = { limit: 1000 }
const fakePng = Buffer.from('89504e470d0a1a0a0001020304', 'hex')

await test('markdown: Lark font colours → WeCom colours; mentions removed', () => {
  const md = wc.toWecomMarkdown("<font color='green'>涨</font> <font color='red'>跌</font> <font color='grey'>注</font> <font color='blue'>蓝</font> <at id=all></at>")
  assert.equal(md, '<font color="info">涨</font> <font color="warning">跌</font> <font color="comment">注</font> 蓝')
})

await test('planWebhook: markdown vs markdown_v2 (tables), images for charts, @all as text, split ≤4096 bytes', () => {
  let plan = wc.planWebhook({ title: '告警', text: "<font color='red'>CPU 高</font>" })
  assert.deepEqual(plan.map(p => p.msgtype), ['markdown'])
  assert.ok(plan[0].content.includes('<font color="warning">CPU 高</font>'))
  const table = { title: '明细', columns: [{ name: 'a', kind: 'text' }, { name: 'b', kind: 'number' }], rows: [['x', 1], ['y', 2]], rowCount: 2, chart: { type: 'table' } }
  const chart = { title: '趋势', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['1', 2], ['2', 3]], rowCount: 2, chart: { type: 'line', x: 'd', y: ['v'] } }
  plan = wc.planWebhook({ title: '日报', text: '**ok**', results: [table, chart], mentionAll: true })
  assert.deepEqual(plan.map(p => p.msgtype), ['markdown_v2', 'image', 'text'])
  assert.match(plan[0].content, /\| a \| b \|\n\| --- \| ---: \|\n\| x \| 1 \|/)
  assert.ok(!plan[0].content.includes('<font'), 'markdown_v2 has no colours')
  assert.equal(wc.planWebhook({ title: 't', results: [chart], chartMode: 'table' })[0].msgtype, 'markdown_v2')
  const big = wc.planWebhook({ title: 'big', text: Array.from({ length: 600 }, (_, i) => `第 ${i} 行中文内容`).join('\n') })
  assert.ok(big.length >= 2)
  for (const p of big) assert.ok(Buffer.byteLength(p.content) <= 4096)
})

await test('webhook validate: URL format, required, keeps existing secret', () => {
  assert.throws(() => webhook.validate({ secrets: {} }), e => e.code === 'channel/config' && /请填写/.test(e.message))
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: 'x' } }), e => e.field === 'webhookUrl')
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: 'https://example.com/hook?key=abc' } }), /qyapi\.weixin\.qq\.com/)
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=12345678' } }), /格式不正确/)
  assert.deepEqual(webhook.validate({ secrets: hookSecrets }), { config: {}, secrets: hookSecrets })
  assert.deepEqual(webhook.validate({ secrets: {} }, { secrets: hookSecrets }), { config: {}, secrets: {} })
})

await test('webhook send: markdown + image (base64 + md5) + @all text, to the right URL', async () => {
  http.calls.length = 0
  const chart = { title: '趋势', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['1', 2], ['2', 3]], rowCount: 2, chart: { type: 'bar', x: 'd', y: ['v'] } }
  const out = await webhook.send(hookChannel, hookSecrets, { title: '日报', text: 'hi', results: [chart], chartMode: 'image', mentionAll: true }, { renderChartPng: () => fakePng, throttle: noThrottle })
  assert.equal(out.images, 1)
  assert.equal(http.calls.length, 3)
  for (const c of http.calls) assert.equal(c.url, `/cgi-bin/webhook/send?key=${KEY}`)
  assert.equal(http.calls[0].json.msgtype, 'markdown')
  assert.deepEqual(http.calls[1].json, { msgtype: 'image', image: { base64: fakePng.toString('base64'), md5: createHash('md5').update(fakePng).digest('hex') } })
  assert.deepEqual(http.calls[2].json.text.mentioned_list, ['@all'])
})

await test('webhook send: images over 2 MB fall back to a table', async () => {
  http.calls.length = 0
  const chart = { title: '趋势', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['1', 2]], rowCount: 1, chart: { type: 'bar', x: 'd', y: ['v'] } }
  const out = await webhook.send(hookChannel, hookSecrets, { title: 't', results: [chart, { ...chart, rows: [['1', 2], ['2', 3]], rowCount: 2 }] }, { renderChartPng: () => Buffer.alloc(2 * 1024 * 1024 + 1), throttle: noThrottle })
  assert.equal(out.images, 0)
  assert.ok(http.calls.every(c => c.json.msgtype !== 'image'))
})

await test('webhook errors: 45009 rate limit, 93000 invalid key, unknown code', async () => {
  reply = () => ({ json: { errcode: 45009, errmsg: 'api freq out of limit' } })
  await assert.rejects(webhook.send(hookChannel, hookSecrets, { title: 'x' }, { throttle: noThrottle }), e => e.code === 'channel/rate-limit' && /20 条/.test(e.message) && e.platformCode === 45009)
  reply = () => ({ json: { errcode: 93000, errmsg: 'invalid webhook url' } })
  await assert.rejects(webhook.send(hookChannel, hookSecrets, { title: 'x' }, { throttle: noThrottle }), e => e.code === 'channel/auth' && /Webhook 地址无效/.test(e.message))
  reply = () => ({ json: { errcode: 12345, errmsg: 'weird' } })
  await assert.rejects(webhook.send(hookChannel, hookSecrets, { title: 'x' }, { throttle: noThrottle }), /12345/)
  reply = () => ({ json: { errcode: 0, errmsg: 'ok' } })
})

await test('webhook: local 20/min throttle surfaces a rate-limit error instead of hitting 45009', async () => {
  wc.resetThrottle()
  const opts = { throttle: { limit: 2, windowMs: 60000, maxWaitMs: 10 } }
  await webhook.send(hookChannel, hookSecrets, { title: 'a' }, opts)
  await webhook.send(hookChannel, hookSecrets, { title: 'b' }, opts)
  await assert.rejects(webhook.send(hookChannel, hookSecrets, { title: 'c' }, opts), e => e.code === 'channel/rate-limit' && /每分钟最多 2 条/.test(e.message))
  wc.resetThrottle()
})

// ------------------------------------------------------------ AI bot fake
const BOT_ID = 'aib_test_bot'
const SECRET = 'fake-long-connection-secret-' + 'x'.repeat(8)
const WRONG = 'wrong-secret-' + 'y'.repeat(8)
let behaviour = { authOk: true, ackPing: true }
const ws = await fakeWs((conn) => {
  conn.on((m) => {
    if (m.cmd === 'aibot_subscribe') {
      const ok = behaviour.authOk && m.body?.bot_id === BOT_ID && m.body?.secret === SECRET
      conn.send({ headers: { req_id: m.headers.req_id }, errcode: ok ? 0 : 40001, errmsg: ok ? 'ok' : 'invalid secret' })
    } else if (m.cmd === 'ping') {
      if (behaviour.ackPing) conn.send({ headers: { req_id: m.headers.req_id }, errcode: 0, errmsg: 'ok' })
    } else if (m.cmd) {
      conn.send({ headers: { req_id: m.headers.req_id }, errcode: 0, errmsg: 'ok' })
    }
  })
})
const botChannel = (extra = {}) => ({ id: 'ch_ai', type: 'wecom_aibot', botId: BOT_ID, botName: 'DataBot', gatewayBase: ws.url, config: {}, ...extra })
const botSecrets = { secret: SECRET }
const live = () => ws.connections.filter(c => !c.closed)

await test('aibot validate: bot id / secret required, gateway must be ws(s)', () => {
  assert.throws(() => aibot.validate({ config: {}, secrets: {} }), /Bot ID/)
  assert.throws(() => aibot.validate({ config: { botId: BOT_ID }, secrets: {} }), /Secret/)
  assert.throws(() => aibot.validate({ config: { botId: BOT_ID, gatewayBase: 'http://x' }, secrets: botSecrets }), /wss/)
  assert.deepEqual(aibot.validate({ config: { botId: BOT_ID, chatId: 'wrkSFfCgAA' }, secrets: botSecrets }), { config: { botId: BOT_ID, chatId: 'wrkSFfCgAA', chatType: 'group' }, secrets: botSecrets })
})

await test('aibot test(): subscribe frame format; auth failure mapped', async () => {
  const r = await aibot.test(botChannel(), botSecrets)
  assert.equal(r.ok, true)
  const sub = ws.connections.at(-1).messages[0]
  assert.equal(sub.cmd, 'aibot_subscribe')
  assert.match(sub.headers.req_id, /^aibot_subscribe_\d+_[0-9a-f]{8}$/)
  assert.deepEqual(sub.body, { bot_id: BOT_ID, secret: SECRET })
  await assert.rejects(aibot.test(botChannel(), { secret: WRONG }), e => e.code === 'channel/auth' && /Secret/.test(e.message))
})

await test('aibot send(): active push via aibot_send_msg (markdown, chat_type)', async () => {
  const before = ws.connections.length
  await aibot.send(botChannel({ chatId: 'wrkGroup1', chatType: 'group' }), botSecrets, { title: '日报', text: 'hello' })
  const conn = ws.connections[before]
  const push = conn.messages.find(m => m.cmd === 'aibot_send_msg')
  assert.equal(push.body.chatid, 'wrkGroup1'); assert.equal(push.body.chat_type, 2); assert.equal(push.body.msgtype, 'markdown')
  assert.match(push.body.markdown.content, /\*\*日报\*\*\n\nhello/)
  await waitFor(() => conn.closed, 2000, 'short-lived connection closed')
  await assert.rejects(aibot.send(botChannel(), botSecrets, { title: 'x' }), /会话 ID/)
})

await test('aibot bot: group @ → onMessage (mention stripped); reply streams with the callback req_id; heartbeat', async () => {
  const got = []
  const bot = adapter.createBot(botChannel({ bot: { allowP2p: true } }), botSecrets, { onMessage: async (m) => { got.push(m) } }, { heartbeatMs: 50 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected', 3000, 'connected')
  const conn = live().at(-1)
  conn.send({ cmd: 'aibot_msg_callback', headers: { req_id: 'cb_1' }, body: { msgid: 'm1', aibotid: BOT_ID, chatid: 'wrkGroup1', chattype: 'group', from: { userid: 'zhangsan' }, msgtype: 'text', text: { content: '@DataBot 上月销售额' } } })
  conn.send({ cmd: 'aibot_msg_callback', headers: { req_id: 'cb_1b' }, body: { msgid: 'm1', aibotid: BOT_ID, chatid: 'wrkGroup1', chattype: 'group', from: { userid: 'zhangsan' }, msgtype: 'text', text: { content: '@DataBot 上月销售额' } } })
  conn.send({ cmd: 'aibot_msg_callback', headers: { req_id: 'cb_2' }, body: { msgid: 'm2', aibotid: BOT_ID, chattype: 'single', from: { userid: 'lisi' }, msgtype: 'text', text: { content: ' 你好 ' } } })
  await waitFor(() => got.length === 2, 3000, 'two messages')
  await new Promise(r => setTimeout(r, 60))
  assert.equal(got.length, 2, 'duplicate msgid ignored')
  const g = got[0]
  assert.equal(g.platform, 'wecom'); assert.equal(g.chatType, 'group'); assert.equal(g.chatId, 'wrkGroup1'); assert.equal(g.text, '上月销售额'); assert.equal(g.mentionedBot, true); assert.deepEqual(g.sender, { id: 'zhangsan' })
  assert.equal(got[1].chatType, 'p2p'); assert.equal(got[1].chatId, 'lisi'); assert.equal(got[1].text, '你好')
  await g.replyText('正在查询…')
  await g.reply({ title: '结果', results: [{ title: 'T', columns: [{ name: 'a', kind: 'text' }, { name: 'b', kind: 'number' }], rows: [['x', 1], ['y', 2]], rowCount: 2, chart: { type: 'table' } }] })
  const replies = conn.messages.filter(m => m.cmd === 'aibot_respond_msg')
  assert.equal(replies.length, 2)
  assert.ok(replies.every(r => r.headers.req_id === 'cb_1'), 'same req_id as the callback')
  assert.equal(replies[0].body.stream.finish, false); assert.equal(replies[1].body.stream.finish, true)
  assert.equal(replies[0].body.stream.id, replies[1].body.stream.id)
  assert.match(replies[1].body.stream.content, /\| a \| b \|/)
  await waitFor(() => conn.messages.some(m => m.cmd === 'ping'), 2000, 'heartbeat ping')
  // send() reuses the live connection instead of opening (and kicking) a new one
  const n = ws.connections.length
  await aibot.send(botChannel({ chatId: 'wrkGroup1' }), botSecrets, { title: 'push' })
  assert.equal(ws.connections.length, n)
  assert.ok(conn.messages.some(m => m.cmd === 'aibot_send_msg'))
  await bot.stop()
  assert.equal(bot.status().state, 'stopped')
  await waitFor(() => conn.closed, 2000)
})

await test('aibot bot: p2p ignored when allowP2p false; reconnects with back-off after a drop and missed heartbeats', async () => {
  const got = []
  const bot = adapter.createBot(botChannel({ bot: { allowP2p: false } }), botSecrets, { onMessage: async (m) => { got.push(m) } }, { backoffMs: 20, heartbeatMs: 40 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected')
  let conn = live().at(-1)
  conn.send({ cmd: 'aibot_msg_callback', headers: { req_id: 'p' }, body: { msgid: 'p1', chattype: 'single', from: { userid: 'u' }, msgtype: 'text', text: { content: 'hi' } } })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(got.length, 0)
  const count = ws.connections.length
  conn.drop()
  await waitFor(() => ws.connections.length > count && bot.status().state === 'connected', 3000, 'reconnected')
  conn = live().at(-1)
  conn.send({ cmd: 'aibot_msg_callback', headers: { req_id: 'g' }, body: { msgid: 'g9', chatid: 'c', chattype: 'group', from: { userid: 'u' }, msgtype: 'mixed', mixed: { msg_item: [{ msgtype: 'text', text: { content: '@DataBot 图文' } }, { msgtype: 'image', image: { url: 'x' } }] } } })
  await waitFor(() => got.length === 1)
  assert.equal(got[0].text, '图文')
  // Heartbeats unanswered → connection considered dead → reconnect
  behaviour.ackPing = false
  const c2 = ws.connections.length
  await waitFor(() => ws.connections.length > c2, 3000, 'reconnect after missed pongs')
  behaviour.ackPing = true
  await bot.stop()
})

await test('aibot bot: disconnected_event stops reconnecting; auth failure → error state', async () => {
  const bot = adapter.createBot(botChannel(), botSecrets, { onMessage: async () => {} }, { backoffMs: 20 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected')
  const n = ws.connections.length
  live().at(-1).send({ cmd: 'aibot_event_callback', headers: { req_id: 'e' }, body: { msgid: 'e1', aibotid: BOT_ID, msgtype: 'event', event: { eventtype: 'disconnected_event' } } })
  await waitFor(() => bot.status().state === 'error')
  assert.match(bot.status().error, /顶下线/)
  await new Promise(r => setTimeout(r, 150))
  assert.equal(ws.connections.length, n, 'no reconnect')
  await bot.stop()
  const bad = adapter.createBot(botChannel(), { secret: WRONG }, {}, { backoffMs: 20 })
  bad.start()
  await waitFor(() => bad.status().state === 'error')
  assert.match(bad.status().error, /Secret/)
  await bad.stop()
})

await ws.close()
await http.close()
summary('channel wecom')
