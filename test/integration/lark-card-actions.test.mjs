// Lark card buttons end to end (MySQL): a bot answer card carries opaque button tokens;
// card.action.trigger frames pushed over a mock long connection (real SDK WSClient +
// EventDispatcher) are answered with a toast in the ack, the drill runs against MySQL,
// and a new reply card is posted to a fake Feishu HTTP API. Covers unknown / expired
// tokens, out-of-scope operators, viewers and the per-operator rate limit.
import http from 'node:http'
import { createRequire } from 'node:module'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin, pluginRequire, sleep } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const { createLarkBot, clearTenantTokenCache } = await plugin('lark-bot.js')
const sdkDir = pluginRequire.resolve('@larksuiteoapi/node-sdk')
const { WebSocketServer } = createRequire(sdkDir)('ws')
const { Writer, Reader } = createRequire(sdkDir)('protobufjs/minimal')

// --- protobuf frames (same layout as lark-smoke.test.mjs)
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

// --- fake Feishu: OpenAPI over HTTP + long-connection WebSocket
const lark = { replies: [], acks: new Map(), sockets: new Set() }
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const send = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    const u = req.url
    if (u === '/open-apis/auth/v3/tenant_access_token/internal') return send({ code: 0, tenant_access_token: 't-mock', expire: 7200 })
    if (u === '/open-apis/bot/v3/info') return send({ code: 0, bot: { open_id: 'ou_bot', app_name: 'Mock' } })
    if (u === '/callback/ws/endpoint') return send({ code: 0, data: { URL: `ws://127.0.0.1:${lark.port}/ws?device_id=d1&service_id=1`, ClientConfig: { PingInterval: 120, ReconnectCount: -1, ReconnectInterval: 1, ReconnectNonce: 1 } } })
    const m = /^\/open-apis\/im\/v1\/messages\/([^/]+)\/reply$/.exec(u)
    if (m) { const j = JSON.parse(body); lark.replies.push({ to: decodeURIComponent(m[1]), type: j.msg_type, content: JSON.parse(j.content) }); return send({ code: 0, data: { message_id: `om_r${lark.replies.length}` } }) }
    if (/\/reactions$/.test(u)) return send({ code: 0, data: { reaction_id: 'x' } })
    if (u.startsWith('/open-apis/im/v1/chats/')) return send({ code: 0, data: { name: '数据群' } })
    if (u.startsWith('/open-apis/contact/v3/users/')) return send({ code: 41050, msg: 'no user authority' }, 400)
    send({ code: 404, msg: 'nf' }, 404)
  })
})
const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (sock) => {
  lark.sockets.add(sock)
  sock.on('close', () => lark.sockets.delete(sock))
  sock.on('message', (buf) => {
    const f = decodeFrame(buf)
    const type = f.headers.find((h) => h.key === 'type')?.value
    const mid = f.headers.find((h) => h.key === 'message_id')?.value
    if (f.method === 1 && type === 'event') lark.acks.set(mid, JSON.parse(Buffer.from(f.payload).toString()))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
lark.port = server.address().port
const baseUrl = `http://127.0.0.1:${lark.port}`

let seq = 0
/** Push a card.action.trigger frame and wait for the SDK's ack; returns the decoded callback response. */
async function click({ openId, value, option, chatId = 'oc_g', messageId = 'om_card' }) {
  const mid = `frame-${++seq}`
  const event = { schema: '2.0', header: { event_id: `ev-${seq}`, event_type: 'card.action.trigger', app_id: 'cli_a1b2c3d4e5f60718', create_time: String(Date.now()) },
    event: { operator: { open_id: openId }, token: 'c-x', action: { tag: option ? 'select_static' : 'button', value, ...(option ? { option } : {}) }, host: 'im_message', context: { open_message_id: messageId, open_chat_id: chatId } } }
  const payload = Buffer.from(JSON.stringify(event))
  const t0 = Date.now()
  for (const s of lark.sockets) s.send(encodeFrame({ method: 1, headers: [{ key: 'type', value: 'event' }, { key: 'message_id', value: mid }, { key: 'sum', value: '1' }, { key: 'seq', value: '0' }, { key: 'trace_id', value: 'tr' }], payload }))
  while (!lark.acks.has(mid)) { if (Date.now() - t0 > 5000) throw new Error('no ack'); await sleep(10) }
  const ack = lark.acks.get(mid)
  return { ms: Date.now() - t0, code: ack.code, resp: ack.data ? JSON.parse(Buffer.from(ack.data, 'base64').toString()) : undefined }
}
async function waitReplies(n) { const t0 = Date.now(); while (lark.replies.length < n) { if (Date.now() - t0 > 15000) throw new Error(`expected ${n} replies, got ${lark.replies.length}`); await sleep(20) } }

// --- fake DSH sessions: the "agent" runs the SQL after "Q:" with a line chart
function fakeSessions(answer) {
  const sessions = new Map(); let n = 0
  const controller = {
    async create() { const id = `sess-${++n}`; const events = []; sessions.set(id, { turn: 0, events, queue: [], session: { snapshotEvents: () => events } }); return { sessionId: id } },
    async rename() {},
    async prompt(req) { sessions.get(req.sessionId).queue.push(req) },
    async wait({ sessionId }) {
      const s = sessions.get(sessionId)
      for (const req of s.queue.splice(0)) {
        const turn = ++s.turn
        s.events.push({ type: 'user/message', data: { source: { rpcId: req.requestId } } }, { type: 'turn/start', data: { turn } })
        const out = await answer(req.content[0].text, sessionId)
        for (const meta of out.metas ?? []) s.events.push({ type: 'tool/result', data: { turn, meta } })
        s.events.push({ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: out.text }] } } }, { type: 'turn/end', data: { turn } })
      }
      return { reason: 'idle' }
    },
    cancel() {},
  }
  return { controller, agents: { get: (id) => sessions.get(id) } }
}
let toolsRef
const fake = fakeSessions(async (text, sid) => {
  const m = /Q:(.+?)(?:\n|$)/.exec(text)
  const out = await toolsRef.get('nl2sql_query').execute({ sql: m[1], title: '每日笔数', chart: { type: 'line', x: 'd', y: ['n'] } }, { agent: { id: sid } })
  return { text: `共 ${out.display.rowCount} 天`, metas: [out.display] }
})

const app = await boot({ label: 'lark-actions', services: { agents: fake.agents, sessionController: fake.controller } })
toolsRef = app.tools
const { call, service } = app
const SQL = 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d'
let bot, dsA, dsB, tokens
const walk = (el, out = []) => { if (!el || typeof el !== 'object') return out; if (el.tag) out.push(el); for (const v of Object.values(el)) if (v && typeof v === 'object') walk(v, out); return out }
const controlsOf = (card) => walk(card.body).filter(e => e.tag === 'button' || e.tag === 'select_static')

try {
  await test('setup: data sources, members, bot on the mock long connection', async () => {
    dsA = await call('saveDatasource', { name: 'A', ...MYSQL })
    dsB = await call('saveDatasource', { name: 'B', ...MYSQL })
    await call('analyzeSchema', { id: dsA.id, refresh: true })
    await call('saveUser', { kind: 'chat', name: '数据群', larkChatId: 'oc_g', role: 'analyst', datasourceIds: [dsA.id, dsB.id], defaultDatasourceId: dsA.id })
    await call('saveUser', { kind: 'person', name: '甲', larkOpenId: 'ou_a', role: 'analyst', datasourceIds: [dsA.id, dsB.id], defaultDatasourceId: dsA.id })
    await call('saveUser', { kind: 'person', name: '乙', larkOpenId: 'ou_b', role: 'analyst', datasourceIds: [dsA.id] })
    await call('saveUser', { kind: 'person', name: '外', larkOpenId: 'ou_out', role: 'analyst', datasourceIds: [dsB.id] })
    await call('saveUser', { kind: 'person', name: '读', larkOpenId: 'ou_view', role: 'viewer', datasourceIds: [dsA.id] })
    clearTenantTokenCache()
    service.larkCreds = { appId: 'cli_a1b2c3d4e5f60718', appSecret: 's', domain: 'feishu', baseUrl }
    bot = createLarkBot({ ...service.larkCreds, logger: { error: (m) => console.error(m), warn() {}, info() {}, debug() {} }, onCardAction: (evt) => service.handleLarkCardAction(evt) })
    await bot.start()
    assert.equal(bot.status().state, 'connected')
  })

  await test('answer card carries buttons with opaque tokens only', async () => {
    await service.handleLarkMessage({ messageId: 'om_q1', chatId: 'oc_g', chatType: 'group', text: `Q:${SQL}`, mentionedBot: true, sender: { openId: 'ou_a' } })
    await waitReplies(1)
    const reply = lark.replies[0]
    assert.equal(reply.to, 'om_q1')
    assert.equal(reply.type, 'interactive')
    const controls = controlsOf(reply.content)
    const labels = controls.map(c => c.tag === 'button' ? c.text.content : 'select')
    assert.ok(labels.includes('select') && labels.includes('为什么变化') && labels.includes('明细') && labels.includes('固定到看板'), labels.join(','))
    const select = controls.find(c => c.tag === 'select_static')
    assert.ok(select.options.some(o => o.value === 'chain_type'), 'chain_type is a candidate dimension')
    assert.ok(select.options.length <= 6)
    for (const c of controls) assert.deepEqual(Object.keys(c.behaviors[0].value).sort(), ['a', 't'])
    assert.ok(!JSON.stringify(reply.content).includes('"r-'), 'no result ids in the card')
    tokens = { drill: select.behaviors[0].value, ...Object.fromEntries(controls.filter(c => c.tag === 'button').map(c => [c.behaviors[0].value.a, c.behaviors[0].value])) }
  })

  await test('breakdown click: toast in the ack (< 3 s), drill runs on MySQL, reply card in the thread', async () => {
    const r = await click({ openId: 'ou_a', value: tokens.drill, option: 'chain_type' })
    assert.equal(r.code, 200)
    assert.deepEqual(r.resp, { toast: { type: 'info', content: '正在分析…' } })
    assert.ok(r.ms < 3000, `ack after ${r.ms}ms`)
    await waitReplies(2)
    const reply = lark.replies[1]
    assert.equal(reply.to, 'om_q1', 'replies to the original question')
    assert.match(JSON.stringify(reply.content), /按chain_type/)
    assert.ok(walk(reply.content.body).some(e => e.tag === 'chart' || e.tag === 'table' || e.tag === 'markdown'))
    assert.ok(controlsOf(reply.content).length > 0, 'level-1 result also has buttons')
    const hist = await call('listHistory', { limit: 5 })
    const h = hist.find(x => x.source === 'larkbot')
    assert.ok(h, 'drill audited with source larkbot')
    assert.match(h.sql, /GROUP BY `?chain_type`?/i)
    assert.equal(h.actor?.name, '甲')
    const dl = await call('listDeliveries', { limit: 5 })
    assert.ok(dl.some(d => d.source === 'larkbot' && d.title === '拆分：chain_type' && d.status === 'ok'))
    // depth cap: a level-1 drill card's token → level-2 card without buttons
    const nested = controlsOf(reply.content).find(c => c.tag === 'select_static')
    await sleep(2100)
    await click({ openId: 'ou_a', value: nested.behaviors[0].value, option: nested.options[0].value })
    await waitReplies(3)
    assert.equal(controlsOf(lark.replies[2].content).length, 0, 'no buttons beyond depth 2')
  })

  await test('rate limit: a second click within 2 s is refused', async () => {
    await sleep(2100)
    const first = await click({ openId: 'ou_b', value: tokens.why })
    assert.equal(first.resp.toast.type, 'info')
    const second = await click({ openId: 'ou_b', value: tokens.why })
    assert.equal(second.resp.toast.type, 'warning')
    assert.match(second.resp.toast.content, /频繁/)
    await waitReplies(4)
    assert.match(JSON.stringify(lark.replies.at(-1).content), /为什么变化|没有找到|对比/)
  })

  await test('unknown, forged and expired tokens are refused', async () => {
    await sleep(2100)
    const bad = await click({ openId: 'ou_a', value: { a: 'drill', t: 'nope-nope-nope' }, option: 'chain_type' })
    assert.equal(bad.resp.toast.type, 'error'); assert.match(bad.resp.toast.content, /过期|无效/)
    await sleep(2100)
    const forged = await click({ openId: 'ou_a', value: { a: 'drill', t: tokens.drill.t, resultId: 'r-other' }, option: 'id' })
    assert.equal(forged.resp.toast.type, 'error', 'dimension outside the candidate list refused')
    await sleep(2100)
    const ctx = service.larkActionTokens.get(tokens.why.t)
    ctx.created = Date.now() - 8 * 24 * 3600 * 1000
    const expired = await click({ openId: 'ou_a', value: tokens.why })
    assert.equal(expired.resp.toast.type, 'error'); assert.match(expired.resp.toast.content, /过期/)
    ctx.created = Date.now()
  })

  await test('operators out of scope / unknown / viewer are refused; nothing runs', async () => {
    const n = lark.replies.length
    const out = await click({ openId: 'ou_out', value: tokens.drill, option: 'chain_type' })
    assert.equal(out.resp.toast.type, 'error', 'out ' + JSON.stringify(out.resp)); assert.match(out.resp.toast.content, /无权访问数据源/)
    // Unknown person: refused once the group itself is not a member (a member group grants access, like for messages).
    const group = (await call('listUsers')).find(u => u.kind === 'chat')
    await call('saveUser', { id: group.id, disabled: true })
    const stranger = await click({ openId: 'ou_zzz', value: tokens.drill, option: 'chain_type' })
    await call('saveUser', { id: group.id, disabled: false })
    assert.equal(stranger.resp.toast.type, 'error', 'stranger ' + JSON.stringify(stranger.resp)); assert.match(stranger.resp.toast.content, /开通/)
    const viewerPin = await click({ openId: 'ou_view', value: tokens.pin })
    assert.equal(viewerPin.resp.toast.type, 'error', 'viewerPin ' + JSON.stringify(viewerPin.resp))
    await sleep(2100)
    const viewerDrill = await click({ openId: 'ou_view', value: tokens.drill, option: 'chain_type' })
    assert.equal(viewerDrill.resp.toast.type, 'error', 'viewerDrill ' + JSON.stringify(viewerDrill.resp) + 'viewer cannot drill a free-SQL result')
    const wrongChat = await click({ openId: 'ou_b', value: tokens.drill, option: 'chain_type', chatId: 'oc_other' })
    assert.equal(wrongChat.resp.toast.type, 'error', 'wrongChat ' + JSON.stringify(wrongChat.resp))
    await sleep(300)
    assert.equal(lark.replies.length, n, 'no replies for refused clicks')
    const admin = await call('listAdminLog', { limit: 20 }).catch(() => service.records.list('admin', { limit: 20 }))
    assert.ok(admin.some(x => x.action === 'larkbot.action.denied'))
  })

  await test('pin: analyst pins to the current dashboard (toast only)', async () => {
    await sleep(2100)
    const before = service.currentDashboardObj().widgets.length
    const r = await click({ openId: 'ou_a', value: tokens.pin })
    assert.equal(r.resp.toast.type, 'success')
    const widgets = service.currentDashboardObj().widgets
    assert.equal(widgets.length, before + 1)
    assert.equal(widgets.at(-1).sql, SQL)
    assert.ok(service.records.list('admin', { limit: 10 }).some(x => x.action === 'larkbot.pin' && x.actor?.name === '甲'))
  })
} finally {
  await bot?.stop()
  await app.close()
  for (const s of wss.clients) s.terminate(); wss.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r))
}
summary('lark card actions')
