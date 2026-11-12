// lark-bot.js: long-connection bot lifecycle against a mock Lark HTTP + WebSocket server
// (status transitions, ack, dedupe, reconnect, stop during start). Cases 2/2b reach the real
// Feishu/Lark endpoints with fake credentials and only assert that the bot ends in "error";
// they pass offline too. Ported from the larkws/smoke.src.mjs scratch test.
import http from 'node:http'
import { createRequire } from 'node:module'
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin, pluginRequire } from '../lib/env.mjs'

const { createLarkBot, clearTenantTokenCache } = await plugin('lark-bot.js')
const sdkDir = pluginRequire.resolve('@larksuiteoapi/node-sdk')
const { WebSocketServer } = createRequire(sdkDir)('ws')
const { Writer, Reader } = createRequire(sdkDir)('protobufjs/minimal')

let unhandled = 0
process.on('unhandledRejection', (e) => { unhandled++; console.error('UNHANDLED REJECTION', e) })
process.on('uncaughtException', (e) => { unhandled++; console.error('UNCAUGHT', e) })

const silent = { error() {}, warn() {}, info() {}, debug() {} }
const logs = []
const capture = { error: (m) => logs.push(['error', m]), warn: (m) => logs.push(['warn', m]), info: (m) => logs.push(['info', m]), debug: (m) => logs.push(['debug', m]) }
const t0 = Date.now()
const el = () => `${Date.now() - t0}ms`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- protobuf Frame helpers (pbbp2.Frame: 1 SeqID,2 LogID,3 service,4 method,5 headers{1 key,2 value},8 payload)
function encodeFrame({ method, service = 1, headers = [], payload }) {
  const w = Writer.create()
  w.uint32(8).uint64(0); w.uint32(16).uint64(0); w.uint32(24).int32(service); w.uint32(32).int32(method)
  for (const h of headers) w.uint32(42).fork().uint32(10).string(h.key).uint32(18).string(h.value).ldelim()
  if (payload) w.uint32(66).bytes(payload)
  return w.finish()
}
function decodeFrame(buf) {
  const r = Reader.create(buf); const f = { headers: [] }
  while (r.pos < r.len) {
    const tag = r.uint32()
    switch (tag >>> 3) {
      case 3: f.service = r.int32(); break
      case 4: f.method = r.int32(); break
      case 5: { const end = r.uint32() + r.pos; const h = {}; while (r.pos < end) { const t = r.uint32(); if (t >>> 3 === 1) h.key = r.string(); else if (t >>> 3 === 2) h.value = r.string(); else r.skipType(t & 7) } f.headers.push(h); break }
      case 8: f.payload = r.bytes(); break
      default: r.skipType(tag & 7)
    }
  }
  return f
}

// --- mock Lark server
function mockLark({ wsMode }) {
  const state = { wsConnections: 0, acks: [], sockets: new Set() }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/open-apis/auth/v3/tenant_access_token/internal') return send({ code: 0, tenant_access_token: 't-mock', expire: 7200 })
      if (req.url === '/open-apis/bot/v3/info') return send({ code: 0, bot: { open_id: 'ou_bot', app_name: 'Mock' } })
      if (req.url === '/callback/ws/endpoint') {
        if (wsMode === 'auth_failed') return send({ code: 514, msg: 'auth failed: app not enable long connection', data: {} })
        const port = wsMode === 'refused' ? state.deadPort : state.port
        return send({ code: 0, data: { URL: `ws://127.0.0.1:${port}/ws?device_id=d1&service_id=1`, ClientConfig: { PingInterval: 120, ReconnectCount: -1, ReconnectInterval: 1, ReconnectNonce: 1 } } })
      }
      send({ code: 404, msg: 'nf' })
    })
  })
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (sock) => {
    state.wsConnections++; state.sockets.add(sock)
    sock.on('close', () => state.sockets.delete(sock))
    sock.on('message', (buf) => {
      const f = decodeFrame(buf)
      const type = f.headers.find((h) => h.key === 'type')?.value
      if (f.method === 1 && type === 'event') state.acks.push(JSON.parse(Buffer.from(f.payload).toString()))
    })
  })
  state.pushEvent = (obj, mid = 'frame-' + Math.random()) => {
    const payload = Buffer.from(JSON.stringify(obj))
    for (const s of state.sockets) s.send(encodeFrame({ method: 1, headers: [{ key: 'type', value: 'event' }, { key: 'message_id', value: mid }, { key: 'sum', value: '1' }, { key: 'seq', value: '0' }, { key: 'trace_id', value: 'tr' }], payload }))
  }
  state.listen = async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); state.port = server.address().port
    const tmp = http.createServer(); await new Promise((r) => tmp.listen(0, '127.0.0.1', r)); state.deadPort = tmp.address().port; await new Promise((r) => tmp.close(r))
    return `http://127.0.0.1:${state.port}`
  }
  state.close = async () => { for (const s of wss.clients) s.terminate(); wss.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)) }
  return state
}

const VALID_ID = 'cli_a1b2c3d4e5f60718'

await test('1. cli_fake (per task) — invalid format, fails before any network.', async () => {
  const statuses = []
  const bot = createLarkBot({ appId: 'cli_fake', appSecret: 'x', domain: 'feishu', onMessage() {}, onStatus: (s) => statuses.push(s.state), logger: silent })
  await bot.start()
  assert.equal(bot.status().state, 'error'); console.log(`[1 cli_fake] ${el()} status=`, bot.status())
  await bot.stop(); assert.equal(bot.status().state, 'stopped')
  assert.deepEqual(statuses, ['connecting', 'error', 'stopped'])
})

await test('2. Well-formed but fake app id against the REAL Feishu endpoint (network permitting).', async () => {
  clearTenantTokenCache()
  const bot = createLarkBot({ appId: VALID_ID, appSecret: 'x', domain: 'feishu', logger: silent })
  await bot.start()
  console.log(`[2 real feishu, fake creds] ${el()} status=`, bot.status())
  assert.equal(bot.status().state, 'error')
  await bot.stop()
})
await test('2b. same via Lark (international) domain', async () => {
  const bot = createLarkBot({ appId: VALID_ID, appSecret: 'x', domain: 'lark', logger: silent })
  await bot.start()
  console.log(`[2b real lark, fake creds] ${el()} status=`, bot.status())
  assert.equal(bot.status().state, 'error')
  await bot.stop()
})

await test('3. Token OK, WS endpoint rejects (code 514) → SDK onError (terminal) → status error.', async () => {
  clearTenantTokenCache()
  const m = mockLark({ wsMode: 'auth_failed' }); const baseUrl = await m.listen()
  const bot = createLarkBot({ appId: VALID_ID, appSecret: 's', baseUrl, logger: silent })
  await bot.start()
  console.log(`[3 ws endpoint 514] ${el()} status=`, bot.status())
  assert.equal(bot.status().state, 'error'); assert.match(bot.status().error, /514/)
  await bot.stop(); await m.close()
})

await test('4. Endpoint OK but WS port refused → retryable; status error "(retrying)"; stop() kills reconnect loop.', async () => {
  clearTenantTokenCache()
  const m = mockLark({ wsMode: 'refused' }); const baseUrl = await m.listen()
  const bot = createLarkBot({ appId: VALID_ID, appSecret: 's', baseUrl, logger: silent })
  await bot.start()
  console.log(`[4 ws refused] ${el()} status=`, bot.status())
  assert.equal(bot.status().state, 'error'); assert.match(bot.status().error, /retrying/)
  await bot.stop(); await m.close()
})

await test('5. Full path: connect, receive event, ack, dedupe, ignore bot-sent, onMessage error isolated, then stop.', async () => {
  clearTenantTokenCache()
  const m = mockLark({ wsMode: 'ok' }); const baseUrl = await m.listen()
  const got = []; const statuses = []
  const bot = createLarkBot({
    appId: VALID_ID, appSecret: 's', baseUrl, logger: capture, onStatus: (s) => statuses.push(s.state),
    onMessage: async (msg) => { got.push(msg); if (msg.text === 'boom') throw new Error('handler exploded') },
  })
  await bot.start()
  assert.equal(bot.status().state, 'connected'); assert.equal(bot.botInfo().openId, 'ou_bot')
  const ev = (id, text, extra = {}) => ({ schema: '2.0', header: { event_id: 'e' + id, event_type: 'im.message.receive_v1', app_id: VALID_ID },
    event: { sender: { sender_id: { open_id: 'ou_u', user_id: 'u', union_id: 'on_u' }, sender_type: 'user', ...extra.sender },
      message: { message_id: id, chat_id: 'oc_1', chat_type: 'group', message_type: 'text', create_time: '1700000000000', content: JSON.stringify({ text }), mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'Mock', mentioned_type: 'bot' }] } } })
  m.pushEvent(ev('om_1', '@_user_1 上周订单数'))
  m.pushEvent(ev('om_1', '@_user_1 上周订单数')) // redelivery
  m.pushEvent(ev('om_2', 'boom'))
  m.pushEvent(ev('om_3', 'from bot', { sender: { sender_type: 'app' } }))
  await sleep(300)
  console.log(`[5 e2e] ${el()} delivered=`, got.map((g) => `${g.messageId}:${g.text}:${g.mentionedBot}`), 'acks=', m.acks.map((a) => a.code), 'status=', bot.status())
  assert.deepEqual(got.map((g) => g.messageId), ['om_1', 'om_2'])
  assert.equal(got[0].text, '上周订单数'); assert.equal(got[0].mentionedBot, true)
  assert.equal(m.acks.length, 4); assert.ok(m.acks.every((a) => a.code === 200))
  assert.ok(logs.some(([l, msg]) => l === 'error' && /handler exploded/.test(msg)))
  assert.ok(bot.status().lastEventAt)
  // server drops the connection → SDK auto-reconnects (ReconnectInterval 1s)
  for (const s of m.sockets) s.terminate()
  await sleep(2500)
  console.log(`[5 reconnect] ${el()} statuses=`, statuses.join('→'), 'wsConnections=', m.wsConnections)
  assert.equal(bot.status().state, 'connected'); assert.equal(m.wsConnections, 2)
  await bot.stop()
  await sleep(100)
  assert.equal(m.sockets.size, 0, 'socket closed by stop()')
  await m.close()
})

await test('6. stop() during an in-flight start()', async () => {
  clearTenantTokenCache()
  const bot = createLarkBot({ appId: VALID_ID, appSecret: 'x', domain: 'feishu', logger: silent })
  const p = bot.start(); await sleep(5); await bot.stop(); await p
  console.log(`[6 stop during start] ${el()} status=`, bot.status())
  assert.equal(bot.status().state, 'stopped')
})

await test('no unhandled rejections / exceptions', () => assert.equal(unhandled, 0))
summary('lark smoke')
