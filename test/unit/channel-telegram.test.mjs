// channels/telegram.js: rendering, validate, push, bot long polling — against a fake Bot API server.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
import { fakeHttp, waitFor } from '../fixtures/channels/fake-servers.mjs'

const tg = await plugin('channels/telegram.js')
const adapter = tg.default
const kind = adapter.kinds[0]
const TOKEN = '123456789:' + 'A'.repeat(10) + 'fake_test_token_' + 'b'.repeat(9) // fake, matches the Bot API token shape

// ---------------------------------------------------------------- fake API
const state = { updates: [], getUpdatesCalls: [], failNext: [], webhook: '', me: { id: 999, is_bot: true, first_name: 'NL2SQL', username: 'nl2sql_bot' } }
let nextMsg = 100
const api = await fakeHttp(async (call) => {
  const m = /^\/bot([^/]+)\/(\w+)/.exec(call.url)
  if (!m) return { status: 404, json: { ok: false, error_code: 404, description: 'Not Found' } }
  if (m[1] !== TOKEN) return { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } }
  const method = m[2]
  const p = call.json ?? {}
  if (state.failNext.length && (state.failNext[0].method ?? method) === method) {
    const f = state.failNext.shift()
    return { status: f.status, json: f.json }
  }
  switch (method) {
    case 'getMe': return { json: { ok: true, result: state.me } }
    case 'getWebhookInfo': return { json: { ok: true, result: { url: state.webhook, pending_update_count: 0 } } }
    case 'deleteWebhook': state.webhook = ''; return { json: { ok: true, result: true } }
    case 'getUpdates': {
      state.getUpdatesCalls.push(p)
      if (p.offset !== undefined) state.updates = state.updates.filter(u => u.update_id >= p.offset)
      if (!state.updates.length) await new Promise(r => setTimeout(r, 40))
      return { json: { ok: true, result: state.updates.slice(0, 100) } }
    }
    case 'sendMessage':
      if (String(p.chat_id) === '-1') return { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } }
      if (String(p.chat_id) === '-2') return { status: 403, json: { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' } }
      if (String(p.chat_id) === '-3') return { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } } }
      if (p.parse_mode === 'HTML' && String(p.text).includes('&lt;broken')) return { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" } }
      return { json: { ok: true, result: { message_id: nextMsg++, chat: { id: p.chat_id } } } }
    case 'sendPhoto': return { json: { ok: true, result: { message_id: nextMsg++ } } }
    case 'answerCallbackQuery': case 'setMessageReaction': return { json: { ok: true, result: true } }
    default: return { status: 404, json: { ok: false, error_code: 404, description: 'Not Found: method not found' } }
  }
})
const channel = (extra = {}) => ({ id: 'ch_tg', type: 'telegram_bot', chatId: '-1001234567890', apiBase: api.url, config: {}, ...extra })
const secrets = { botToken: TOKEN }
const callsOf = (method) => api.calls.filter(c => c.url.endsWith(`/${method}`))
const fakePng = Buffer.from('89504e470d0a1a0a0000', 'hex')

// ---------------------------------------------------------------- rendering
await test('markdown → Telegram HTML: escaping, bold/italic/code/links, headings, lists', () => {
  const [html] = tg.markdownToTelegram('# 标题 <x>\n**粗** *斜* `a<b>` [链接](https://ex.com/?a=1&b="2") [js](javascript:alert(1))\n- 第一项 & more\n1. 有序\n> 引用 <b>')
  assert.match(html, /^<b>标题 &lt;x&gt;<\/b>/)
  assert.match(html, /<b>粗<\/b> <i>斜<\/i> <code>a&lt;b&gt;<\/code>/)
  assert.match(html, /<a href="https:\/\/ex\.com\/\?a=1&amp;b=&quot;2&quot;">链接<\/a>/)
  assert.ok(!html.includes('href="javascript'), 'non-http links are not turned into anchors')
  assert.match(html, /\n• 第一项 &amp; more\n1\. 有序\n<blockquote>引用 &lt;b&gt;<\/blockquote>/)
})

await test('Lark extensions stripped; tables become aligned <pre>', () => {
  const [html] = tg.markdownToTelegram("<font color='red'>红</font> <at id=all></at>\n\n| 城市 | 销售额 |\n| --- | ---: |\n| 北京 | 12 |\n| 上海<x> | 3456 |")
  assert.ok(html.startsWith('红'))
  assert.ok(!html.includes('font') && !html.includes('<at'))
  const pre = /<pre>([\s\S]*)<\/pre>/.exec(html)[1]
  const lines = pre.split('\n')
  assert.equal(lines.length, 4)
  assert.ok(lines[3].includes('上海&lt;x&gt;'))
  assert.ok(lines[2].endsWith('  12') && lines[3].endsWith('3456'), 'numeric column right aligned')
})

await test('long messages split into ≤4096-char chunks with balanced tags', () => {
  const md = Array.from({ length: 400 }, (_, i) => `**第 ${i} 行** 内容 <tag> & 更多文本`).join('\n') + '\n```\n' + 'x'.repeat(9000) + '\n```'
  const chunks = tg.markdownToTelegram(md)
  assert.ok(chunks.length >= 4)
  for (const c of chunks) {
    assert.ok(c.length <= tg.TEXT_LIMIT, `chunk ${c.length}`)
    assert.equal((c.match(/<b>/g) ?? []).length, (c.match(/<\/b>/g) ?? []).length)
    assert.equal((c.match(/<pre>/g) ?? []).length, (c.match(/<\/pre>/g) ?? []).length)
  }
})

await test('callback_data ≤ 64 bytes; compact and cached encodings round-trip', () => {
  const short = tg.encodeCallback({ a: 'drill', t: 'AbCdEfGhIjKl' }, 'region')
  assert.equal(short, 'drill|AbCdEfGhIjKl|region')
  assert.deepEqual(tg.decodeCallback(short), { value: { a: 'drill', t: 'AbCdEfGhIjKl' }, option: 'region' })
  const long = tg.encodeCallback({ a: 'drill', t: 'AbCdEfGhIjKl' }, '一个非常非常长的维度名称'.repeat(3))
  assert.ok(long.startsWith('k:') && Buffer.byteLength(long) <= 64)
  assert.equal(tg.decodeCallback(long).option, '一个非常非常长的维度名称'.repeat(3))
  assert.equal(tg.decodeCallback('k:unknown'), null)
  const kb = tg.inlineKeyboard({ buttons: [{ text: '明细', value: { a: 'detail', t: 'T1' } }], select: { placeholder: 'x', value: { a: 'drill', t: 'T1' }, options: [{ text: '地区', value: 'region' }] } })
  assert.deepEqual(kb.inline_keyboard[0], [{ text: '明细', callback_data: 'detail|T1' }])
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'drill|T1|region')
})

// ---------------------------------------------------------------- validate
await test('validate: token / chat id / api base errors in Chinese; secrets kept separate', () => {
  assert.throws(() => kind.validate({ config: {}, secrets: {} }), e => e.code === 'channel/config' && /Bot Token/.test(e.message))
  assert.throws(() => kind.validate({ config: {}, secrets: { botToken: 'abc' } }), /格式不正确/)
  assert.throws(() => kind.validate({ config: { chatId: 'my group' }, secrets }), /Chat ID 格式不正确/)
  assert.throws(() => kind.validate({ config: { apiBase: 'ftp://x' }, secrets }), /http/)
  const ok = kind.validate({ config: { chatId: '@my_channel', apiBase: 'https://tg.example.com/' }, secrets })
  assert.deepEqual(ok, { config: { chatId: '@my_channel', apiBase: 'https://tg.example.com' }, secrets: { botToken: TOKEN } })
  // Unchanged secret: existing one is kept by the core.
  assert.deepEqual(kind.validate({ config: { chatId: '-100123' }, secrets: {} }, { secrets: { botToken: TOKEN } }).secrets, {})
  assert.equal(kind.capabilities.listTargets, false)
  assert.throws(() => kind.validate({ config: { chatId: 'bad id' }, secrets }), e => e.field === 'chatId')
  assert.equal(kind.fields.find(f => f.key === 'chatId').target, true)
  assert.equal(typeof kind.listTargets, 'function')
})

// ---------------------------------------------------------------- send
await test('send: HTML text, chart via sendPhoto (multipart), table result, keyboard', async () => {
  api.calls.length = 0
  const message = {
    title: '日报 <A&B>', text: '**总计** 上涨', chartMode: 'image', includeSql: true,
    results: [
      { title: '趋势', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['1', 2], ['2', 3]], rowCount: 2, chart: { type: 'line', x: 'd', y: ['v'] }, sql: 'select 1', actions: { buttons: [{ text: '为什么变化', value: { a: 'why', t: 'TK' } }] } },
      { title: '明细', columns: [{ name: 'a', kind: 'text' }, { name: 'b', kind: 'number' }], rows: [['x', 1], ['y', 2]], rowCount: 2, chart: { type: 'table' } },
    ],
    footer: '数据问答',
  }
  let rendered = 0
  const out = await kind.send(channel(), secrets, message, { renderChartPng: () => { rendered++; return fakePng } })
  assert.equal(out.images, 1)
  assert.equal(rendered, 1)
  const sends = callsOf('sendMessage')
  assert.equal(sends[0].json.parse_mode, 'HTML')
  assert.equal(sends[0].json.chat_id, '-1001234567890')
  assert.match(sends[0].json.text, /<b>日报 &lt;A&amp;B&gt;<\/b>/)
  const photo = callsOf('sendPhoto')[0]
  assert.match(photo.headers['content-type'], /multipart\/form-data/)
  const raw = photo.raw.toString('latin1')
  assert.ok(raw.includes('filename="chart.png"') && raw.includes('-1001234567890'))
  assert.ok(raw.includes('"callback_data":"why|TK"'), 'keyboard attached to the photo')
  assert.ok(sends.some(s => s.json.text.includes('<pre>') && s.json.text.includes('select 1')), 'SQL sent after the chart')
  assert.ok(sends.some(s => /<pre>a\s+b/.test(s.json.text)), 'table result as <pre>')
  assert.equal(out.messageId, String(Number(out.messageId)))
})

await test('send: chartMode table never uploads; render failure falls back to text', async () => {
  api.calls.length = 0
  const r = { title: 'T', columns: [{ name: 'd', kind: 'text' }, { name: 'v', kind: 'number' }], rows: [['1', 2], ['2', 3]], rowCount: 2, chart: { type: 'bar', x: 'd', y: ['v'] } }
  let out = await kind.send(channel(), secrets, { title: 't', results: [r], chartMode: 'table' }, { renderChartPng: () => { throw new Error('no') } })
  assert.equal(out.images, 0); assert.equal(callsOf('sendPhoto').length, 0)
  out = await kind.send(channel(), secrets, { title: 't', results: [r], chartMode: 'native' }, { renderChartPng: () => { throw new Error('boom') } })
  assert.equal(out.images, 0); assert.equal(callsOf('sendPhoto').length, 0)
})

await test('send: error mapping (auth, chat not found, kicked, rate limit, parse fallback)', async () => {
  await assert.rejects(kind.send(channel(), { botToken: '1:bad' }, { title: 'x' }), e => e.code === 'channel/auth' && /Token/.test(e.message))
  await assert.rejects(kind.send(channel({ chatId: '-1' }), secrets, { title: 'x' }), e => e.code === 'channel/config' && /找不到该聊天/.test(e.message))
  await assert.rejects(kind.send(channel({ chatId: '-2' }), secrets, { title: 'x' }), e => e.code === 'channel/rejected' && /不在该聊天/.test(e.message))
  await assert.rejects(kind.send(channel({ chatId: '-3' }), secrets, { title: 'x' }), e => e.code === 'channel/rate-limit' && /7 秒/.test(e.message) && e.retryAfter === 7)
  await assert.rejects(kind.send(channel({ chatId: undefined }), secrets, { title: 'x' }), /Chat ID/)
  api.calls.length = 0
  // Rejected HTML is retried as plain text (simulated by a text containing "<broken").
  const out = await kind.send(channel(), secrets, { title: 'x', text: '```\n<broken\n```' })
  assert.ok(out.messageId)
  const s = callsOf('sendMessage')
  assert.equal(s.length, 2); assert.equal(s[1].json.parse_mode, undefined); assert.ok(s[1].json.text.includes('<broken'))
})

await test('test(): getMe; recentChats helper lists chats from pending updates', async () => {
  const r = await kind.test(channel(), secrets)
  assert.equal(r.ok, true); assert.match(r.detail, /@nl2sql_bot/)
  state.updates = [{ update_id: 1, message: { message_id: 1, chat: { id: -100555, type: 'supergroup', title: '数据群' }, text: 'hi' } }, { update_id: 2, message: { message_id: 2, chat: { id: 42, type: 'private', first_name: 'Ann' }, text: 'x' } }]
  const chats = await kind.recentChats(channel(), secrets)
  assert.deepEqual(chats, [{ id: '-100555', name: '数据群', type: 'supergroup' }, { id: '42', name: 'Ann', type: 'user' }])
  state.updates = []
})

// ---------------------------------------------------------------- bot
const groupMsg = (id, text, entities, extra = {}) => ({ update_id: id, message: { message_id: 500 + id, from: { id: 7, is_bot: false, first_name: '张', last_name: '三', username: 'zs' }, chat: { id: -100777, type: 'supergroup', title: 'G' }, date: 1, text, entities, ...extra } })

await test('bot: deleteWebhook first, group mention → onMessage; non-mentions ignored; offset advances', async () => {
  api.calls.length = 0
  state.webhook = 'https://old.example.com/hook'
  state.getUpdatesCalls.length = 0
  const got = []
  const bot = adapter.createBot(channel({ bot: { allowP2p: false } }), secrets, { onMessage: async (m) => { got.push(m) } }, { pollTimeoutSec: 1 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected', 3000, 'connected')
  assert.equal(callsOf('deleteWebhook').length, 1)
  assert.deepEqual(bot.info(), { name: '@nl2sql_bot', id: '999' })
  state.updates.push(
    groupMsg(10, '@nl2sql_bot 上月销售额', [{ type: 'mention', offset: 0, length: 11 }]),
    groupMsg(11, '大家好', []),
    groupMsg(12, '继续拆分', [], { reply_to_message: { message_id: 400, from: { id: 999, is_bot: true } } }),
    { update_id: 13, message: { message_id: 600, from: { id: 8, first_name: 'P' }, chat: { id: 8, type: 'private' }, text: 'p2p question' } },
  )
  await waitFor(() => got.length >= 2, 3000, 'two messages')
  await new Promise(r => setTimeout(r, 150))
  assert.equal(got.length, 2, 'plain group message and p2p (allowP2p false) ignored')
  const m = got[0]
  assert.equal(m.platform, 'telegram'); assert.equal(m.channelId, 'ch_tg'); assert.equal(m.chatId, '-100777'); assert.equal(m.chatType, 'group')
  assert.equal(m.text, '上月销售额'); assert.equal(m.mentionedBot, true); assert.equal(m.messageId, '510')
  assert.deepEqual(m.sender, { id: '7', name: '张 三', username: 'zs' })
  assert.equal(got[1].text, '继续拆分', 'reply to the bot counts as mention')
  const last = state.getUpdatesCalls.at(-1)
  assert.equal(last.offset, 14)
  assert.deepEqual(last.allowed_updates, ['message', 'callback_query'])
  assert.equal(last.timeout, 1)
  // reply / replyText / react go to the right endpoints
  api.calls.length = 0
  await m.reply({ title: '结果', text: 'ok' })
  const sent = callsOf('sendMessage').at(-1).json
  assert.equal(sent.chat_id, '-100777'); assert.deepEqual(sent.reply_parameters, { message_id: 510, allow_sending_without_reply: true })
  await m.replyText('正在查询 <1>')
  assert.equal(callsOf('sendMessage').at(-1).json.text, '正在查询 &lt;1&gt;')
  await m.react('working')
  assert.deepEqual(callsOf('setMessageReaction').at(-1).json, { chat_id: '-100777', message_id: 510, reaction: [{ type: 'emoji', emoji: '👀' }] })
  await bot.stop()
  assert.equal(bot.status().state, 'stopped')
  const n = state.getUpdatesCalls.length
  await new Promise(r => setTimeout(r, 200))
  assert.equal(state.getUpdatesCalls.length, n, 'stop() ends the polling loop')
})

await test('bot: callback_query → onAction and answerCallbackQuery with toast', async () => {
  api.calls.length = 0
  state.updates = []
  const actions = []
  const bot = adapter.createBot(channel(), secrets, { onMessage: async () => {}, onAction: async (a) => { actions.push(a); return { toast: { type: 'success', content: '已开始拆分' } } } }, { pollTimeoutSec: 1 })
  bot.start()
  await waitFor(() => bot.status().state === 'connected')
  state.updates.push({ update_id: 20, callback_query: { id: 'cq1', from: { id: 7, first_name: '张' }, message: { message_id: 321, chat: { id: -100777, type: 'supergroup' } }, chat_instance: 'x', data: 'drill|TOK|region' } })
  await waitFor(() => callsOf('answerCallbackQuery').length === 1, 3000, 'answerCallbackQuery')
  const a = actions[0]
  assert.equal(a.platform, 'telegram'); assert.deepEqual(a.value, { a: 'drill', t: 'TOK' }); assert.equal(a.option, 'region')
  assert.deepEqual(a.operator, { id: '7', name: '张' }); assert.equal(a.chatId, '-100777'); assert.equal(a.messageId, '321')
  assert.deepEqual(callsOf('answerCallbackQuery')[0].json, { callback_query_id: 'cq1', text: '已开始拆分', show_alert: false })
  await a.reply({ title: '拆分结果' })
  assert.equal(callsOf('sendMessage').at(-1).json.reply_parameters.message_id, 321)
  // Unknown / expired button
  state.updates.push({ update_id: 21, callback_query: { id: 'cq2', from: { id: 7 }, message: { message_id: 1, chat: { id: 1 } }, data: 'k:gone' } })
  await waitFor(() => callsOf('answerCallbackQuery').length === 2)
  assert.equal(callsOf('answerCallbackQuery')[1].json.show_alert, true)
  assert.equal(actions.length, 1)
  await bot.stop()
})

await test('bot: backs off and recovers after errors / dropped connection', async () => {
  state.updates = []
  state.failNext = [{ method: 'getUpdates', status: 502, json: { ok: false, error_code: 502, description: 'Bad Gateway' } }, { method: 'getUpdates', status: 502, json: { ok: false, error_code: 502, description: 'Bad Gateway' } }]
  const got = []
  const bot = adapter.createBot(channel(), secrets, { onMessage: async (m) => { got.push(m) } }, { pollTimeoutSec: 1, backoffMs: 30, maxBackoffMs: 100 })
  const t0 = Date.now()
  bot.start()
  await waitFor(() => bot.status().state === 'error', 3000, 'error state')
  assert.match(bot.status().error, /502/)
  state.updates.push(groupMsg(30, '@nl2sql_bot hi', [{ type: 'mention', offset: 0, length: 11 }]))
  await waitFor(() => got.length === 1, 3000, 'message after recovery')
  assert.ok(Date.now() - t0 >= 80, 'waited (30 + 60 ms back-off)')
  assert.equal(bot.status().state, 'connected')
  await bot.stop()
  // Dead server: stop() still ends promptly during back-off.
  const dead = adapter.createBot(channel({ apiBase: 'http://127.0.0.1:9' }), secrets, {}, { backoffMs: 5000 })
  dead.start()
  await waitFor(() => dead.status().state === 'error', 3000)
  const s0 = Date.now()
  await dead.stop()
  assert.ok(Date.now() - s0 < 500, 'stop() interrupts the back-off sleep')
})

await api.close()
summary('channel telegram')
