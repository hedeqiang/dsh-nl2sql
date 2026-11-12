// channels/dingtalk.js: signing, rendering, webhook push/errors, robot API push, Stream bot — against local fakes.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
import { fakeHttp, fakeWs, waitFor } from '../fixtures/channels/fake-servers.mjs'

const dt = await plugin('channels/dingtalk.js')
const adapter = dt.default
const webhook = adapter.kinds.find(k => k.id === 'dingtalk_webhook')
const app = adapter.kinds.find(k => k.id === 'dingtalk_app')
const TOKEN = 'a'.repeat(32) + 'test'
const WEBHOOK = `https://oapi.dingtalk.com/robot/send?access_token=${TOKEN}`
const SIGN_SECRET = 'SEC' + '0123456789abcdef'.repeat(4)
const CLIENT_ID = 'dingtestclient01'
const CLIENT_SECRET = ['fake', 'client', 'secret', 'for', 'tests'].join('-') // not a real credential
const WRONG_SECRET = ['wrong', 'client', 'secret', 'value'].join('-')

// ------------------------------------------------------------- fake HTTP
let webhookReply = () => ({ json: { errcode: 0, errmsg: 'ok' } })
let tokens = 0
const state = { endpoint: null, openCalls: [] }
const http = await fakeHttp((call) => {
  const u = new URL(call.url, 'http://x')
  if (u.pathname === '/robot/send') return webhookReply(call)
  if (u.pathname === '/robot/sendBySession') return { json: { errcode: 0, errmsg: 'ok' } }
  if (u.pathname === '/v1.0/oauth2/accessToken') {
    if (call.json?.appKey !== CLIENT_ID || call.json?.appSecret !== CLIENT_SECRET) return { status: 400, json: { code: 'invalidClientIdOrSecret', message: '无效的clientId或者clientSecret' } }
    tokens++
    return { json: { accessToken: `tok-${tokens}`, expireIn: 7200 } }
  }
  if (u.pathname === '/v1.0/robot/groupMessages/send') {
    if (call.json?.openConversationId === 'cidBADBADBAD') return { status: 400, json: { code: 'invalid.openConversationId', message: '无效的openConversationId' } }
    return { json: { processQueryKey: 'pqk-1' } }
  }
  if (u.pathname === '/v1.0/robot/oToMessages/batchSend') return { json: { processQueryKey: 'pqk-2' } }
  if (u.pathname === '/v1.0/gateway/connections/open') {
    state.openCalls.push(call)
    if (call.json?.clientSecret !== CLIENT_SECRET) return { status: 401, json: { code: 'InvalidAuthentication', message: 'bad' } }
    return { json: { endpoint: state.endpoint, ticket: `ticket-${state.openCalls.length}` } }
  }
  return { status: 404, json: { code: 'notfound' } }
})
const hookChannel = { id: 'ch_dt', type: 'dingtalk_webhook', apiBase: http.url, config: {} }

// ------------------------------------------------------------- signing
await test('sign: HMAC-SHA256 vector (docs sample secret) and URL composition', () => {
  // Docs: stringToSign = timestamp + "\n" + secret; HMAC-SHA256 with the secret; Base64; urlEncode.
  // Expected value computed independently with the docs' Python sample.
  assert.equal(dt.dingSign('this is secret', '1577262236757'), 'hmPWwU%2B7lVdm3ZZz0r9tSfx0L4Q26jWOZr9%2BGs6EZQM%3D')
  assert.equal(dt.signedUrl(WEBHOOK, 'SEC0123456789abcdef', 1700000000000), `${WEBHOOK}&timestamp=1700000000000&sign=TSZbRFUuvaSQaRKUpF970OPCb2%2FLcQAP3wOvwZIzBZk%3D`)
  assert.equal(dt.signedUrl(WEBHOOK, '', 1), WEBHOOK)
})

// ------------------------------------------------------------- rendering
await test('render: no Markdown tables (rows as numbered lines), KPI, @所有人, Lark tags stripped', () => {
  const r = { title: '明细', columns: [{ name: '城市', kind: 'text' }, { name: '销售额', kind: 'number' }], rows: [['北京', 12345], ['上|海', 2]], rowCount: 30, chart: { type: 'table' } }
  const out = dt.renderMarkdown({ title: '日报', text: "<font color='red'>注意</font>\n\n| a | b |\n| --- | --- |\n| 1 | 2 |", results: [r], mentionAll: true })
  const text = out.chunks.join('')
  assert.equal(out.title, '日报'); assert.equal(out.atAll, true)
  assert.ok(!/\|\s*---/.test(text), 'no table separators')
  assert.match(text, /\*\*城市 ｜ 销售额\*\*\n\n1\. 北京 ｜ 1\.23万\n2\. 上｜海 ｜ 2/)
  assert.match(text, /共 30 行，仅显示前 2 行/)
  assert.match(text, /\*\*a ｜ b\*\*\n\n1\. 1 ｜ 2/)
  assert.ok(text.includes('注意') && !text.includes('<font'))
  assert.ok(text.trim().endsWith('@所有人'))
  const kpi = dt.renderMarkdown({ title: 'k', results: [{ title: 'K', columns: [{ name: '总数', kind: 'number' }], rows: [[42]], rowCount: 1, chart: { type: 'kpi' } }] })
  assert.match(kpi.chunks[0], /\*\*总数\*\*：42/)
})

// ------------------------------------------------------------- webhook
await test('webhook validate: URL / SEC secret formats', () => {
  assert.throws(() => webhook.validate({ secrets: {} }), /请填写 Webhook/)
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: WEBHOOK, signSecret: 'nope' } }), e => e.field === 'signSecret')
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: 'https://oapi.dingtalk.com/robot/send?token=x' } }), /格式不正确/)
  assert.throws(() => webhook.validate({ secrets: { webhookUrl: WEBHOOK, signSecret: 'abc' } }), /SEC 开头/)
  assert.deepEqual(webhook.validate({ secrets: { webhookUrl: WEBHOOK, signSecret: SIGN_SECRET } }), { config: {}, secrets: { webhookUrl: WEBHOOK, signSecret: SIGN_SECRET } })
  assert.deepEqual(webhook.validate({ secrets: {} }, { secrets: { webhookUrl: WEBHOOK } }), { config: {}, secrets: {} })
})

await test('webhook send: markdown with title/text, at.isAtAll, signed query', async () => {
  http.calls.length = 0
  const t0 = Date.now()
  await webhook.send(hookChannel, { webhookUrl: WEBHOOK, signSecret: SIGN_SECRET }, { title: '告警', text: '**CPU** 高', mentionAll: true })
  const c = http.calls[0]
  const u = new URL(c.url, 'http://x')
  assert.equal(u.searchParams.get('access_token'), TOKEN)
  const ts = u.searchParams.get('timestamp')
  assert.ok(Number(ts) >= t0 && Number(ts) <= Date.now())
  assert.equal(encodeURIComponent(u.searchParams.get('sign')), dt.dingSign(SIGN_SECRET, ts))
  assert.equal(c.json.msgtype, 'markdown')
  assert.equal(c.json.markdown.title, '告警')
  assert.match(c.json.markdown.text, /### 告警\n\n\*\*CPU\*\* 高/)
  assert.deepEqual(c.json.at, { isAtAll: true })
})

await test('webhook errors: keyword / sign / timestamp (310000), rate limit, token missing', async () => {
  const s = { webhookUrl: WEBHOOK }
  const cases = [
    [{ errcode: 310000, errmsg: '错误描述:关键词不匹配;解决方案:请联系群管理员查看此机器人的关键词' }, 'channel/dingtalk-keyword', /关键词/],
    [{ errcode: 310000, errmsg: 'sign not match, more: [https://ding-doc.dingtalk.com/doc#/serverapi2/qf2nxq]' }, 'channel/dingtalk-sign', /签名不匹配/],
    [{ errcode: 310000, errmsg: 'invalid timestamp' }, 'channel/dingtalk-sign', /时间/],
    [{ errcode: 410100, errmsg: 'send too fast' }, 'channel/rate-limit', /20 条/],
    [{ errcode: 400101, errmsg: 'access_token不存在' }, 'channel/auth', /access_token/],
  ]
  for (const [json, code, re] of cases) {
    webhookReply = () => ({ json })
    await assert.rejects(webhook.send(hookChannel, s, { title: 'x' }), e => e.code === code && re.test(e.message), JSON.stringify(json))
  }
  webhookReply = () => ({ json: { errcode: 0, errmsg: 'ok' } })
})

// ------------------------------------------------------------- app push
const appChannel = (extra = {}) => ({ id: 'ch_dta', type: 'dingtalk_app', clientId: CLIENT_ID, apiBase: http.url, gatewayBase: http.url, botName: 'DataBot', config: {}, ...extra })
const appSecrets = { clientSecret: CLIENT_SECRET }

await test('app validate: client id / secret / openConversationId formats', () => {
  assert.throws(() => app.validate({ config: {}, secrets: {} }), /Client ID/)
  assert.throws(() => app.validate({ config: { clientId: CLIENT_ID }, secrets: {} }), /Client Secret/)
  assert.throws(() => app.validate({ config: { clientId: CLIENT_ID, openConversationId: 'oc_123' }, secrets: appSecrets }), /cid 开头/)
  assert.deepEqual(app.validate({ config: { clientId: CLIENT_ID, openConversationId: 'cidAbc123==' }, secrets: appSecrets }), { config: { clientId: CLIENT_ID, openConversationId: 'cidAbc123==' }, secrets: appSecrets })
})

await test('app test()/send(): accessToken then groupMessages/send (sampleMarkdown); token cached; errors mapped', async () => {
  dt.clearTokenCache(); tokens = 0; http.calls.length = 0
  assert.equal((await app.test(appChannel(), appSecrets)).ok, true)
  await assert.rejects(app.test(appChannel(), { clientSecret: WRONG_SECRET }), e => e.code === 'channel/auth' && /Client ID/.test(e.message))
  dt.clearTokenCache(); tokens = 0; http.calls.length = 0
  const out = await app.send(appChannel({ openConversationId: 'cidGroup1==' }), appSecrets, { title: '日报', text: 'hi' })
  assert.equal(out.messageId, 'pqk-1')
  await app.send(appChannel({ openConversationId: 'cidGroup1==' }), appSecrets, { title: '日报2' })
  assert.equal(tokens, 1, 'token cached')
  const send = http.calls.find(c => c.url === '/v1.0/robot/groupMessages/send')
  assert.equal(send.headers['x-acs-dingtalk-access-token'], 'tok-1')
  assert.equal(send.json.msgKey, 'sampleMarkdown'); assert.equal(send.json.robotCode, CLIENT_ID); assert.equal(send.json.openConversationId, 'cidGroup1==')
  assert.deepEqual(JSON.parse(send.json.msgParam), { title: '日报', text: '### 日报\n\nhi' })
  await app.send(appChannel({ userId: 'user001' }), appSecrets, { title: 'p' })
  const oto = http.calls.find(c => c.url === '/v1.0/robot/oToMessages/batchSend')
  assert.deepEqual(oto.json.userIds, ['user001'])
  await assert.rejects(app.send(appChannel({ openConversationId: 'cidBADBADBAD' }), appSecrets, { title: 'x' }), e => e.code === 'channel/config' && /群会话 ID/.test(e.message))
  await assert.rejects(app.send(appChannel(), appSecrets, { title: 'x' }), /推送目标/)
})

// ------------------------------------------------------------- Stream bot
const ws = await fakeWs((conn) => {
  conn.send({ specVersion: '1.0', type: 'SYSTEM', headers: { topic: 'CONNECTED', messageId: 'c0', contentType: 'application/json' }, data: '{}' })
})
state.endpoint = `${ws.url}/connect`
const live = () => ws.connections.filter(c => !c.closed)
const botFrame = (id, data) => ({ specVersion: '1.0', type: 'CALLBACK', headers: { appId: 'app', contentType: 'application/json', messageId: id, time: String(Date.now()), topic: '/v1.0/im/bot/messages/get' }, data: JSON.stringify(data) })
const groupMsg = (extra = {}) => ({ conversationId: 'cidGroup1==', atUsers: [{ dingtalkId: '$:bot' }], chatbotCorpId: 'ding1', chatbotUserId: '$:bot', msgId: 'msg1', senderNick: '张三', isAdmin: false, senderStaffId: 'user001', sessionWebhookExpiredTime: Date.now() + 3600000, createAt: Date.now(), senderCorpId: 'ding1', conversationType: '2', senderId: '$:sender', conversationTitle: '测试群', isInAtList: true, sessionWebhook: `${http.url}/robot/sendBySession?session=s1`, text: { content: ' @DataBot 上月销售额' }, robotCode: CLIENT_ID, msgtype: 'text', ...extra })

await test('stream bot: open connection (subscriptions), ping echo, ack, group @ → onMessage, reply via sessionWebhook', async () => {
  state.openCalls.length = 0; http.calls.length = 0
  const got = []
  const bot = adapter.createBot(appChannel({ bot: { allowP2p: true } }), appSecrets, { onMessage: async (m) => { got.push(m) } }, {})
  bot.start()
  await waitFor(() => bot.status().state === 'connected', 3000, 'connected')
  const open = state.openCalls[0]
  assert.deepEqual(open.json.subscriptions, [{ type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' }])
  assert.equal(open.json.clientId, CLIENT_ID); assert.equal(open.headers.accept, 'application/json')
  const conn = live().at(-1)
  assert.equal(conn.url, '/connect?ticket=ticket-1')
  conn.send({ specVersion: '1.0', type: 'SYSTEM', headers: { topic: 'ping', messageId: 'p1', contentType: 'application/json' }, data: '{"opaque":"abc-123"}' })
  conn.send(botFrame('m1', groupMsg()))
  conn.send(botFrame('m2', groupMsg({ msgId: 'msg2', conversationType: '1', conversationId: 'cidP2P', text: { content: '你好' } })))
  await waitFor(() => got.length === 2 && conn.messages.length >= 3, 3000, 'messages + acks')
  const pong = conn.messages.find(m => m.headers?.messageId === 'p1')
  assert.deepEqual(pong, { code: 200, headers: { contentType: 'application/json', messageId: 'p1' }, message: 'OK', data: '{"opaque":"abc-123"}' })
  assert.deepEqual(conn.messages.find(m => m.headers?.messageId === 'm1'), { code: 200, headers: { contentType: 'application/json', messageId: 'm1' }, message: 'OK', data: '{"response":null}' })
  const m = got[0]
  assert.equal(m.platform, 'dingtalk'); assert.equal(m.chatType, 'group'); assert.equal(m.chatId, 'cidGroup1=='); assert.equal(m.text, '上月销售额'); assert.equal(m.mentionedBot, true)
  assert.deepEqual(m.sender, { id: 'user001', name: '张三' })
  assert.equal(got[1].chatType, 'p2p')
  await m.replyText('正在查询…')
  await m.reply({ title: '结果', text: 'ok' })
  const sess = http.calls.filter(c => c.url.startsWith('/robot/sendBySession'))
  assert.deepEqual(sess[0].json, { msgtype: 'text', text: { content: '正在查询…' } })
  assert.equal(sess[1].json.msgtype, 'markdown'); assert.equal(sess[1].json.markdown.title, '结果')
  await bot.stop()
  assert.equal(bot.status().state, 'stopped')
})

await test('stream bot: ignores group messages without @ and p2p when disabled; expired session falls back to robot API', async () => {
  const got = []
  const bot = adapter.createBot(appChannel({ bot: { allowP2p: false } }), appSecrets, { onMessage: async (m) => { got.push(m) } }, {})
  bot.start()
  await waitFor(() => bot.status().state === 'connected')
  const conn = live().at(-1)
  conn.send(botFrame('a', groupMsg({ msgId: 'a', isInAtList: false })))
  conn.send(botFrame('b', groupMsg({ msgId: 'b', conversationType: '1' })))
  conn.send(botFrame('c', groupMsg({ msgId: 'c', sessionWebhookExpiredTime: Date.now() - 1000 })))
  await waitFor(() => got.length === 1)
  await new Promise(r => setTimeout(r, 50))
  assert.equal(got.length, 1)
  dt.clearTokenCache(); http.calls.length = 0
  await got[0].reply({ title: '迟到的结果' })
  const api = http.calls.find(c => c.url === '/v1.0/robot/groupMessages/send')
  assert.ok(api, 'robot API used when the session webhook expired')
  assert.equal(api.json.openConversationId, 'cidGroup1==')
  await bot.stop()
})

await test('stream bot: SYSTEM disconnect and dropped socket → new ticket + reconnect with back-off; auth error state', async () => {
  state.openCalls.length = 0
  const bot = adapter.createBot(appChannel(), appSecrets, { onMessage: async () => {} }, { backoffMs: 20, maxBackoffMs: 100 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected')
  live().at(-1).send({ specVersion: '1.0', type: 'SYSTEM', headers: { topic: 'disconnect', messageId: 'd', contentType: 'application/json' }, data: '{"reason":"connection is expired"}' })
  await waitFor(() => state.openCalls.length === 2 && bot.status().state === 'connected', 3000, 'reconnect after disconnect')
  live().at(-1).drop()
  await waitFor(() => state.openCalls.length === 3 && bot.status().state === 'connected', 3000, 'reconnect after drop')
  assert.equal(live().at(-1).url, '/connect?ticket=ticket-3')
  await bot.stop()
  const n = state.openCalls.length
  await new Promise(r => setTimeout(r, 120))
  assert.equal(state.openCalls.length, n, 'stop() prevents reconnects')
  const bad = adapter.createBot(appChannel(), { clientSecret: WRONG_SECRET }, {}, { backoffMs: 20 })
  bad.start()
  await waitFor(() => bad.status().state === 'error')
  assert.match(bad.status().error, /Client ID|鉴权|accessToken/)
  await bad.stop()
})

await ws.close()
await http.close()
summary('channel dingtalk')
