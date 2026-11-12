// lark-bot.js: Open API HTTP helpers against a local mock server (token cache, retries, errors).
// Ported from the larkws/http.test.mjs scratch test.
import http from 'node:http'
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const {
  getTenantToken, replyMessage, replyText, sendText, addReaction, getChatInfo, getUserInfo, getBotInfo, clearTenantTokenCache, resolveBaseUrl,
} = await plugin('lark-bot.js')

const calls = []
let tokenCount = 0
let expireNext = 7200
let server, baseUrl, deadUrl

await (async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const json = body ? JSON.parse(body) : undefined
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, json })
      const send = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      const u = req.url
      if (u === '/open-apis/auth/v3/tenant_access_token/internal') {
        if (json.app_secret !== 'good') return send({ code: 10014, msg: 'app secret invalid' })
        tokenCount++
        return send({ code: 0, msg: 'ok', tenant_access_token: `t-${tokenCount}`, expire: expireNext })
      }
      if (u === '/open-apis/im/v1/messages/om_ok/reply') return send({ code: 0, msg: 'success', data: { message_id: 'om_reply_1' } })
      if (u === '/open-apis/im/v1/messages/om_bad/reply') return send({ code: 230011, msg: 'The message was withdrawn.' }, 400)
      if (u === '/open-apis/im/v1/messages/om_expired/reply') {
        if (req.headers.authorization === 'Bearer t-1') return send({ code: 99991663, msg: 'Invalid access token for authorization.' })
        return send({ code: 0, data: { message_id: 'om_reply_after_refresh' } })
      }
      if (u === '/open-apis/im/v1/messages?receive_id_type=chat_id') return send({ code: 0, data: { message_id: 'om_new' } })
      if (u === '/open-apis/im/v1/messages/om_ok/reactions') return send({ code: 0, data: { reaction_id: 'r_1' } })
      if (u === '/open-apis/im/v1/messages/om_bad/reactions') return send({ code: 231001, msg: 'reaction type is invalid.' })
      if (u === '/open-apis/im/v1/chats/oc_1') return send({ code: 0, data: { name: '数据分析群', owner_id: 'ou_x' } })
      if (u === '/open-apis/contact/v3/users/ou_1?user_id_type=open_id') return send({ code: 0, data: { user: { name: '张三', email: 'z@x.com' } } })
      if (u.startsWith('/open-apis/contact/v3/users/')) return send({ code: 41050, msg: 'no user authority error' }, 400)
      if (u === '/open-apis/bot/v3/info') return send({ code: 0, msg: 'ok', bot: { app_name: 'NL2SQL', open_id: 'ou_bot' } })
      if (u === '/notjson') { res.writeHead(502); return res.end('<html>bad gateway</html>') }
      send({ code: 404, msg: 'not found' }, 404)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const tmp = http.createServer(); await new Promise((r) => tmp.listen(0, '127.0.0.1', r))
  deadUrl = `http://127.0.0.1:${tmp.address().port}`; await new Promise((r) => tmp.close(r))
})()

const app = () => ({ appId: 'cli_a1b2c3d4e5f60718', appSecret: 'good', domain: 'feishu', baseUrl })

await test('resolveBaseUrl', () => {
  assert.equal(resolveBaseUrl({ domain: 'feishu' }), 'https://open.feishu.cn')
  assert.equal(resolveBaseUrl({ domain: 'lark' }), 'https://open.larksuite.com')
  assert.equal(resolveBaseUrl({}), 'https://open.feishu.cn')
  assert.equal(resolveBaseUrl({ domain: 'lark', baseUrl: 'http://x/' }), 'http://x')
})

await test('getTenantToken caches, shares concurrent requests, honours expire-60s', async () => {
  clearTenantTokenCache(); tokenCount = 0; calls.length = 0
  const [a, b] = await Promise.all([getTenantToken(app()), getTenantToken(app())])
  assert.equal(a, 't-1'); assert.equal(b, 't-1')
  assert.equal(await getTenantToken(app()), 't-1')
  assert.equal(tokenCount, 1)
  assert.deepEqual(calls[0].json, { app_id: 'cli_a1b2c3d4e5f60718', app_secret: 'good' })
  // expire <= 60s → never cached
  clearTenantTokenCache(); expireNext = 50
  await getTenantToken(app()); await getTenantToken(app())
  assert.equal(tokenCount, 3)
  expireNext = 7200
  await assert.rejects(getTenantToken({ ...app(), appSecret: 'nope' }), (e) => e.code === 10014 && /app secret invalid/.test(e.message))
})

await test('replyMessage posts interactive card and returns message_id; errors carry code/msg', async () => {
  clearTenantTokenCache(); tokenCount = 0; calls.length = 0
  const card = { header: { title: { tag: 'plain_text', content: 'hi' } }, elements: [] }
  assert.equal(await replyMessage({ ...app(), messageId: 'om_ok', card }), 'om_reply_1')
  const c = calls.find((x) => x.url.endsWith('/reply'))
  assert.equal(c.method, 'POST')
  assert.equal(c.auth, 'Bearer t-1')
  assert.deepEqual(c.json, { msg_type: 'interactive', content: JSON.stringify(card), reply_in_thread: false })
  await replyMessage({ ...app(), messageId: 'om_ok', card, inThread: true })
  assert.equal(calls.at(-1).json.reply_in_thread, true)
  await assert.rejects(replyMessage({ ...app(), messageId: 'om_bad', card }), (e) => e.code === 230011 && /withdrawn/.test(e.message))
})

await test('expired token is refreshed once and the call retried', async () => {
  clearTenantTokenCache(); tokenCount = 0
  assert.equal(await replyMessage({ ...app(), messageId: 'om_expired', card: {} }), 'om_reply_after_refresh')
  assert.equal(tokenCount, 2)
})

await test('replyText / sendText', async () => {
  calls.length = 0
  assert.equal(await replyText({ ...app(), messageId: 'om_ok', text: '正在查询…' }), 'om_reply_1')
  assert.deepEqual(calls.at(-1).json, { msg_type: 'text', content: '{"text":"正在查询…"}', reply_in_thread: false })
  assert.equal(await sendText({ ...app(), chatId: 'oc_1', text: 'hi' }), 'om_new')
  assert.deepEqual(calls.at(-1).json, { receive_id: 'oc_1', msg_type: 'text', content: '{"text":"hi"}' })
  assert.equal(await sendText({ ...app(), messageId: 'om_ok', text: 'x' }), 'om_reply_1')
})

await test('addReaction best effort', async () => {
  calls.length = 0
  assert.equal(await addReaction({ ...app(), messageId: 'om_ok', emojiType: 'OnIt' }), 'r_1')
  assert.deepEqual(calls.at(-1).json, { reaction_type: { emoji_type: 'OnIt' } })
  assert.equal(await addReaction({ ...app(), messageId: 'om_bad', emojiType: 'NOPE' }), null)
  assert.equal(await addReaction({ ...app(), baseUrl: deadUrl, messageId: 'om_ok', emojiType: 'DONE' }), null)
})

await test('getChatInfo / getUserInfo / getBotInfo', async () => {
  assert.deepEqual(await getChatInfo({ ...app(), chatId: 'oc_1' }), { name: '数据分析群' })
  assert.deepEqual(await getChatInfo({ ...app(), chatId: 'oc_missing' }), {})
  assert.deepEqual(await getUserInfo({ ...app(), openId: 'ou_1' }), { name: '张三', email: 'z@x.com' })
  assert.deepEqual(await getUserInfo({ ...app(), openId: 'ou_noperm' }), {})
  assert.deepEqual(await getBotInfo(app()), { openId: 'ou_bot', name: 'NL2SQL' })
})

await test('network failure gives a readable error', async () => {
  clearTenantTokenCache()
  await assert.rejects(getTenantToken({ ...app(), baseUrl: deadUrl }), /request failed: ECONNREFUSED/)
})

server.closeAllConnections?.()
server.close()
summary('lark http')
