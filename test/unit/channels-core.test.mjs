// Channel core: registry / catalog, shared message helpers, ChannelError, Lark kinds.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const registry = await plugin('channels/index.js')
const message = await plugin('channels/message.js')
const { ChannelError, request } = await plugin('channels/http.js')
const im = await plugin('im.js')

await test('registry: lark is built in; optional adapters load without breaking it', async () => {
  const loaded = await registry.loadAdapters()
  assert.ok(Array.isArray(loaded))
  assert.ok(registry.getAdapter('lark'))
  const { adapter, kind } = registry.kindOf('lark_app')
  assert.equal(adapter.id, 'lark')
  assert.equal(kind.platform, 'lark')
  assert.equal(registry.kindOf('nope'), undefined)
  assert.throws(() => registry.requireKind('nope'), (e) => e instanceof ChannelError && e.code === 'channel/config')
  for (const id of Object.keys(registry.adapterLoadErrors())) assert.ok(['telegram', 'wecom', 'dingtalk'].includes(id))
})

await test('catalog: JSON-safe, secrets flagged, no values, localized texts', async () => {
  const cat = registry.listCatalog()
  const lark = cat.find(p => p.platform === 'lark')
  assert.deepEqual(lark.name, { zh: '飞书 / Lark', en: 'Lark / Feishu' })
  assert.deepEqual(lark.kinds.map(k => k.id), ['lark_webhook', 'lark_app'])
  const json = JSON.stringify(cat)
  assert.deepEqual(JSON.parse(json), cat, 'no functions / undefined')
  const app = lark.kinds.find(k => k.id === 'lark_app')
  assert.equal(app.fields.find(f => f.key === 'appSecret').secret, true)
  assert.equal(app.fields.find(f => f.key === 'appId').secret, false)
  assert.equal(app.fields.find(f => f.key === 'receiveId').target, true)
  assert.equal(app.capabilities.bot, true)
  assert.equal(app.capabilities.buttons, false, 'bot replies carry no buttons')
  assert.equal(app.capabilities.chartImages, true)
  assert.equal(app.setupSteps.zh.length, 6, 'no card-callback step')
  assert.equal(app.setupSteps.en.length, 6)
  assert.equal(lark.kinds[0].capabilities.bot, false)
  const zh = registry.listCatalog('zh').find(p => p.platform === 'lark')
  assert.equal(zh.nameText, '飞书 / Lark')
  assert.equal(zh.kinds[1].fields.find(f => f.key === 'appId').labelText, 'App ID')
  assert.ok(Array.isArray(zh.kinds[1].setupStepsText))
})

await test('registerAdapter / unregisterAdapter: kinds appear and disappear', () => {
  registry.registerAdapter({ id: 'fakeim', name: { zh: '假', en: 'Fake' }, kinds: [{ id: 'fakeim_bot', label: { zh: '假', en: 'Fake' }, fields: [{ key: 'token', type: 'secret', label: { zh: 'T', en: 'T' } }], capabilities: { push: true }, validate: (i) => i, send: async () => ({}) }] })
  assert.equal(registry.kindOf('fakeim_bot').kind.platform, 'fakeim')
  assert.deepEqual(registry.secretKeys(registry.kindOf('fakeim_bot').kind), ['token'])
  assert.ok(registry.listCatalog().some(p => p.platform === 'fakeim'))
  assert.equal(registry.unregisterAdapter('fakeim'), true)
  assert.equal(registry.kindOf('fakeim_bot'), undefined)
})

await test('ChannelError: code, message, optional field; ImError is an alias', () => {
  const e = new ChannelError('channel/config', '坏了', { field: 'botToken' })
  assert.equal(e.code, 'channel/config')
  assert.equal(e.field, 'botToken')
  assert.equal(new ChannelError('x', 'y').field, undefined)
  assert.equal(im.ImError, ChannelError)
  assert.ok(new im.ImError('im/config', 'z') instanceof ChannelError)
})

await test('http.request: network failure → channel/network; timeout; JSON and raw bodies', async () => {
  await assert.rejects(request('http://127.0.0.1:1/x', { label: '测试' }), (e) => e instanceof ChannelError && e.code === 'channel/network' && /测试接口/.test(e.message))
  const fakeFetch = async (_url, init) => ({ status: 201, headers: new Map(), text: async () => (init.body ? init.body : 'not json') })
  const a = await request('http://x', { json: { a: 1 }, fetch: fakeFetch })
  assert.equal(a.status, 201)
  assert.deepEqual(a.json, { a: 1 })
  const b = await request('http://x', { fetch: fakeFetch })
  assert.deepEqual(b.json, { raw: 'not json' })
  const slow = (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  await assert.rejects(request('http://x', { fetch: slow, timeoutMs: 20 }), /超时/)
})

const result = { title: '每日', columns: [{ name: 'd', kind: 'time' }, { name: 'n', kind: 'number' }], rows: [['2026-01-01', 12345], ['2026-01-02', 3], ['2026-01-03', null]], rowCount: 3, chart: { type: 'line', x: 'd', y: ['n'] } }

await test('message: toPlainMarkdown strips <font>/<at>, keeps Markdown', () => {
  const md = "## 标题\n**涨** <font color='green'>+5%</font> <at id=all></at>\n<at id=ou_1>张三</at> 你好"
  assert.equal(message.toPlainMarkdown(md), '## 标题\n**涨** +5% @所有人\n@张三 你好')
  assert.equal(message.toPlainMarkdown('<at id="all"></at>x', { mentionAll: '' }), 'x')
  assert.equal(message.mentionsAll("a <at id='all'></at>"), true)
  assert.equal(message.mentionsAll('a'), false)
  assert.equal(message.toPlainText('**a** `b` [c](http://d)\n# e'), 'a b c (http://d)\ne')
})

await test('message: resultAsMarkdownTable escapes pipes, aligns numbers, notes truncation', () => {
  const t = message.resultAsMarkdownTable({ columns: [{ name: 'a|b', kind: 'text' }, { name: 'n', kind: 'number' }], rows: [['x|y', 1234.5], [null, 2]], rowCount: 5 }, 10)
  const lines = t.split('\n')
  assert.equal(lines[0], '| a\\|b | n |')
  assert.equal(lines[1], '| --- | ---: |')
  assert.equal(lines[2], '| x\\|y | 1,234.5 |')
  assert.equal(lines[3], '|  | 2 |')
  assert.match(t, /共 5 行，仅显示前 2 行/)
  assert.equal(message.resultAsMarkdownTable({ columns: [], rows: [] }), '')
  assert.equal(message.resultAsMarkdownTable(result, 1).split('\n').filter(l => l.startsWith('|')).length, 3)
})

await test('message: fmtNum, cellText, kpiText, chartable, chartOption, messageAsMarkdown, splitText', () => {
  assert.equal(message.fmtNum(123456789), '1.23亿')
  assert.equal(message.fmtNum(12345), '1.23万')
  assert.equal(message.fmtNum(1.234), '1.23')
  assert.equal(message.cellText('x'.repeat(100)).length, 80)
  assert.equal(message.cellText(null), '')
  assert.equal(message.kpiText({ columns: [{ name: 'n', kind: 'number' }], rows: [[20000]] }), '**n**：20,000', 'messages show full numbers with separators, not 万')
  assert.equal(message.chartable(result), true)
  assert.equal(message.chartable({ ...result, chart: { type: 'table' } }), false)
  const opt = message.chartOption(result)
  assert.equal(opt.series[0].type, 'line')
  assert.deepEqual(opt.xAxis.data, ['2026-01-01', '2026-01-02', '2026-01-03'])
  const md = message.messageAsMarkdown({ title: 'T', text: "<font color='red'>x</font>", results: [result, { title: 'E', error: '失败' }], includeSql: false, footer: 'f' })
  assert.match(md, /^\*\*T\*\*\n\nx\n\n\*\*每日\*\*  3 行/)
  assert.match(md, /\| d \| n \|/)
  assert.match(md, /\*\*E\*\*\n失败/)
  const plain = message.messageAsMarkdown({ title: 'T', results: [result] }, { markdown: 'none' })
  assert.ok(!plain.includes('**') && !plain.includes('| ---'))
  const parts = message.splitText('一二三\n四五六\n七八九', 10)
  assert.ok(parts.every(p => Buffer.byteLength(p) <= 10), JSON.stringify(parts))
  assert.equal(parts.join('\n'), '一二三\n四五六\n七八九')
  assert.deepEqual(message.splitText('short', 100), ['short'])
})

await test('message: renderChartPng returns a PNG', () => {
  const png = message.renderChartPng(result, { width: 320, height: 160 })
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
})

await test('lark kinds: validate flat config/secrets with field errors', () => {
  const app = registry.kindOf('lark_app').kind
  const ok = app.validate({ config: { appId: ' cli_a ', receiveId: 'oc_1', domain: 'lark' }, secrets: { appSecret: ' s ' } })
  assert.deepEqual(ok.config, { domain: 'lark', appId: 'cli_a', receiveIdType: 'chat_id', receiveId: 'oc_1' })
  assert.equal(ok.secrets.appSecret, 's')
  assert.throws(() => app.validate({ config: { appId: 'cli_a', receiveId: 'oc' }, secrets: {} }), (e) => e.field === 'appSecret')
  assert.throws(() => app.validate({ config: { receiveId: 'oc' }, secrets: { appSecret: 's' } }), (e) => e.field === 'appId')
  const hook = registry.kindOf('lark_webhook').kind
  assert.throws(() => hook.validate({ config: {}, secrets: { webhookUrl: 'https://evil.example/x' } }), (e) => e.field === 'webhookUrl' && /格式不正确/.test(e.message))
  const v = hook.validate({ config: {}, secrets: { webhookUrl: 'https://open.larksuite.com/open-apis/bot/v2/hook/abc' } })
  assert.equal(v.config.domain, 'lark')
})

await test('im.js / lark-bot.js shims keep their exports', async () => {
  for (const k of ['buildCard', 'actionElement', 'chartElement', 'markdownElements', 'sendMessage', 'listBotChats', 'larkSign', 'renderChartPng', 'chartOption', 'chartable', 'dualAxis', 'RECEIVE_ID_TYPES', 'ImError']) assert.ok(k in im, k)
  const bot = await plugin('lark-bot.js')
  for (const k of ['createLarkBot', 'normalizeMessageEvent', 'normalizeCardActionEvent', 'createDedupe', 'getTenantToken', 'replyMessage', 'replyText', 'sendText', 'sendCard', 'updateCard', 'addReaction', 'getChatInfo', 'getUserInfo', 'getBotInfo', 'clearTenantTokenCache', 'resolveBaseUrl', 'larkApi', 'default']) assert.ok(k in bot, k)
  // `actions` (contract name) and `cardActions` (legacy) both render buttons.
  const spec = { buttons: [{ text: 'b', value: { a: 'pin', t: 'tok' } }] }
  const r = { title: 'r', columns: [{ name: 'a', kind: 'text' }, { name: 'n', kind: 'number' }], rows: [['x', 1], ['y', 2]], rowCount: 2, chart: { type: 'table' } }
  for (const k of ['actions', 'cardActions']) assert.match(JSON.stringify(im.buildCard({ title: 't', results: [{ ...r, [k]: spec }] })), /"tag":"button"/)
})

summary('channels core')
