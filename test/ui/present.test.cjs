// Feature "present" (client-src/25a-present.js) in jsdom against canned RPCs: dashboard menu items
// (export PPT / long image, send long image, presentation mode), the presentation overlay
// (portal, clock, refresh selector, ←/→ between boards, Esc), the result menu "导出 PPT",
// and 管理 → 多维表格同步 (list, run, editor validation). Bootstrap copied from client-dom.test.cjs.
const path = require('node:path')
const fs = require('node:fs')

const PLUGIN_DIR = path.resolve(__dirname, '..', '..')
const candidates = [process.env.NL2SQL_UI_MODULES, '/tmp/node_modules', path.join(PLUGIN_DIR, 'node_modules')].filter(Boolean)
const MODS = candidates.find((d) => ['jsdom', 'react', 'react-dom'].every((m) => fs.existsSync(path.join(d, m, 'package.json'))))

;(async () => {
  const { test, skipFile, summary, assert } = await import('../lib/assert.mjs')
  if (!MODS) skipFile(`jsdom/react/react-dom not found in ${candidates.join(', ')}`)
  const req = (m) => require(path.join(MODS, m))
  const { JSDOM } = req('jsdom')
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  Object.assign(global, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle, MutationObserver: dom.window.MutationObserver, HTMLElement: dom.window.HTMLElement })
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
  global.requestAnimationFrame = (f) => setTimeout(f, 0)
  Object.defineProperty(global, 'localStorage', { value: dom.window.localStorage, configurable: true })
  global.ResizeObserver = class { observe() {} disconnect() {} }
  global.IS_REACT_ACT_ENVIRONMENT = true
  // download(): URL.createObjectURL + <a>.click()
  const downloads = []
  URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }
  const React = req('react'); const ReactDOM = req('react-dom'); const { createRoot } = req('react-dom/client'); const { act } = React
  const errors = []
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)) }
  dom.window.onerror = (m) => errors.push('window ' + m)

  const ds = [{ id: 'd1', name: '订单库', database: 'testdb', current: true, schemaAnalyzedAt: 1, policy: { mode: 'deny', tables: [], hiddenColumns: [], maskedColumns: [] } }]
  const kpi = { resultId: 'r1', datasourceId: 'd1', datasourceName: '订单库', title: 'K', sql: 'select 1', rowCount: 1, elapsedMs: 3, columns: [{ name: 'n', kind: 'number' }], rows: [[42]], chart: { type: 'kpi', y: ['n'] } }
  const boards = { current: 'db1', dashboards: [{ id: 'db1', name: '销售看板', widgets: 2 }, { id: 'db2', name: '运营看板', widgets: 1 }] }
  const widgetsOf = { db1: [{ id: 'w1', title: '订单数', sql: 'select 1', datasourceId: 'd1', chart: { type: 'kpi' }, width: 'half' }, { id: 'w2', title: '金额', sql: 'select 2', datasourceId: 'd1', chart: { type: 'kpi' }, width: 'full' }], db2: [{ id: 'w3', title: '活跃用户', sql: 'select 3', datasourceId: 'd1', chart: { type: 'kpi' }, width: 'third' }] }
  const file = { fileName: 'x.pptx', mediaType: 'application/x', base64: 'UEsDBA==' }
  const sync = { id: 'bt1', name: '渠道同步', channelId: 'ch2', channelName: '应用机器人', appToken: 'bascnAbc12345', tableId: 'tblAbc1', source: { widgetId: 'w1' }, sourceLabel: '订单数', mode: 'replace', schedule: { time: '08:00', enabled: true }, lastStatus: 'ok', lastRows: 12, lastRunAt: Date.now(), runs: [] }
  const responses = {
    listDatasources: ds, getSettings: { maxRows: 500, retention: {}, defaults: {} }, onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: true, askedQuestion: true, dismissed: true },
    askSuggestions: { examples: [], recent: [], total: 0 }, listDashboards: boards, listDashboard: (p) => widgetsOf[p?.dashboardId ?? 'db1'], getDashboardFilters: [],
    runWidget: kpi, getResult: kpi, analyzeSchema: { analyzedAt: 1, tables: [], relations: [] }, getKnowledge: { glossary: [], metrics: [], notes: {}, examples: [] }, suggestionCount: { count: 0, byKind: {} },
    listChannels: [{ id: 'ch1', name: '数据群', type: 'lark_webhook', hasSecret: true, isDefault: true }, { id: 'ch2', name: '应用机器人', type: 'lark_app', appId: 'cli_1', receiveIdType: 'chat_id', receiveId: 'oc_1', hasSecret: true }],
    exportDashboardPptx: file, exportDashboardImage: { ...file, fileName: 'x.png' }, exportResultsPptx: { ...file, fileName: 'r.pptx' }, sendDashboardImage: { ok: true, channel: '应用机器人' },
    listBitableSyncs: [sync], runBitableSync: { status: 'ok', created: 12, deleted: 3 },
    saveBitableSync: () => { throw Object.assign(new Error('table_id 格式不正确'), { field: 'tableId' }) },
    listAlerts: [], listReports: [], listUsers: [],
  }
  const rpcCalls = []
  global.fetch = async (url, init) => {
    const { method, payload } = JSON.parse(init.body); rpcCalls.push({ method, payload })
    const r = responses[method]
    let body
    try { body = { ok: true, value: typeof r === 'function' ? r(payload) : (r ?? null) } } catch (e) { body = { ok: false, error: { code: 'nl2sql/invalid', message: e.message, field: e.field } } }
    return { status: 200, json: async () => body }
  }

  let plugin
  window.__ModuleLoader__ = { load(r) { plugin = r.factory(Object.assign((n) => ({ react: React, 'react-dom': ReactDOM, 'react-dom/client': req('react-dom/client') })[n], { async: () => new Promise(() => {}) })) } }
  require(path.join(PLUGIN_DIR, 'lib', 'client.js'))
  const LOCALE_SNAPSHOT = Object.freeze({ active: 'zh', locales: [], revision: 1 })
  const regs = {}; let dict; let dicts
  const ctx = {
    effect(fn) { return fn() },
    locale: { register(ns, d) { dicts = d; dict = d.zh; return () => {} }, bind() { return (k) => dict[k] ?? `!!${k}` }, subscribe() { return () => {} }, getSnapshot() { return LOCALE_SNAPSHOT } },
    slots: { inject(k, f) { f() }, register(opt, C) { regs[opt.name + ':' + (opt.key ?? opt.id)] = C } }, layout: {}, uiWorkspace: { startSession() {}, openSession() {} },
  }
  plugin.apply(ctx)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const rootEl = document.getElementById('root')
  const settle = (ms = 30) => act(() => sleep(ms))
  const findButton = (label, scope = document) => { const b = [...scope.querySelectorAll('button')]; return b.find((x) => x.textContent.trim() === label) ?? b.find((x) => x.textContent.trim().startsWith(label)) }
  const click = async (label, scope) => { const b = findButton(label, scope); if (!b) throw new Error('no button ' + label); await act(async () => { b.click() }); await settle() }
  const clickEl = async (el, ms = 30) => { assert.ok(el, 'element exists'); await act(async () => { el.click() }); await settle(ms) }
  const menu = async (triggerLabel, item, scope = document) => {
    const trg = [...scope.querySelectorAll('button[aria-haspopup=menu]')].find((b) => (b.getAttribute('aria-label') ?? '') === triggerLabel)
    if (!trg) throw new Error('no menu ' + triggerLabel)
    await act(async () => { trg.click() }); await settle(20)
    const items = [...document.querySelectorAll('.n2s-menu button')]
    const it = items.find((b) => b.textContent.trim().startsWith(item))
    if (!it) throw new Error('no item ' + item + ' in ' + items.map((b) => b.textContent).join('|'))
    await act(async () => { it.click() }); await settle(60)
  }
  const key = async (k) => { await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })) }); await settle(60) }
  const missing = () => (document.body.textContent.match(/!![\w.]+/g) ?? [])

  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(60)

  await test('locale: pre.* keys identical in zh and en', () => {
    const zk = Object.keys(dicts.zh).filter(k => k.startsWith('pre.')).sort()
    const ek = Object.keys(dicts.en).filter(k => k.startsWith('pre.')).sort()
    assert.ok(zk.length > 40)
    assert.deepEqual(zk, ek)
  })

  await test('dashboard export menu: PPT and long image download; send long image dialog', async () => {
    await clickEl(document.getElementById('n2s-tab-dashboard'), 80)
    await menu('导出', '导出 PPT')
    await settle(30)
    assert.equal(rpcCalls.filter(c => c.method === 'exportDashboardPptx').at(-1).payload.dashboardId, 'db1')
    assert.ok(downloads.includes('x.pptx'), JSON.stringify({ downloads, toasts: document.querySelector('.n2s-toasts')?.textContent }))
    await menu('导出', '导出长图')
    assert.equal(rpcCalls.filter(c => c.method === 'exportDashboardImage').at(-1).payload.width, 1200)
    assert.ok(downloads.includes('x.png'))
    await menu('导出', '发送长图到 IM')
    const dlg = document.querySelector('.n2s-modal')
    assert.ok(dlg && /飞书应用机器人或 Telegram/.test(dlg.textContent))
    const opts = [...dlg.querySelectorAll('option')].map(o => o.textContent)
    assert.deepEqual(opts, ['应用机器人'], 'only image-capable channels')
    await click('发送', dlg)
    assert.deepEqual(rpcCalls.filter(c => c.method === 'sendDashboardImage').at(-1).payload, { dashboardId: 'db1', channelId: 'ch2' })
    assert.equal(document.querySelector('.n2s-modal'), null)
    assert.deepEqual(missing(), [])
  })

  await test('presentation mode: overlay with widgets, clock, refresh selector; ←/→ switch boards; Esc exits', async () => {
    await menu('导出', '大屏模式')
    const pre = document.querySelector('.n2s-pre')
    assert.ok(pre, 'overlay rendered')
    assert.equal(pre.parentElement, document.body, 'portal on body')
    assert.equal(pre.querySelector('h1').textContent, '销售看板')
    assert.equal(pre.querySelectorAll('.n2s-pre-card').length, 2)
    assert.ok(pre.querySelector('.n2s-pre-card.w-full'))
    assert.match(pre.querySelector('.n2s-pre-clock .time').textContent, /\d{1,2}:\d{2}:\d{2}/)
    const selects = [...pre.querySelectorAll('select')]
    assert.deepEqual([...selects[0].options].map(o => o.value), ['60', '300', '900'])
    assert.ok([...selects[1].options].some(o => o.value === '30'), 'rotation selector')
    assert.match(pre.textContent, /最后刷新/)
    assert.match(pre.textContent, /42/)
    await key('ArrowRight')
    assert.equal(document.querySelector('.n2s-pre h1').textContent, '运营看板')
    assert.equal(document.querySelectorAll('.n2s-pre-card').length, 1)
    assert.ok(rpcCalls.some(c => c.method === 'runWidget' && c.payload.id === 'w3'))
    await key('ArrowLeft')
    assert.equal(document.querySelector('.n2s-pre h1').textContent, '销售看板')
    await key('Escape')
    assert.equal(document.querySelector('.n2s-pre'), null)
    assert.deepEqual(missing(), [])
  })

  await test('result menu: 导出 PPT exports the result', async () => {
    const card = document.querySelector('.n2s-widget .n2s-result-foot')
    await menu('更多操作', '导出 PPT', card)
    assert.deepEqual(rpcCalls.filter(c => c.method === 'exportResultsPptx').at(-1).payload, { resultIds: ['r1'], title: '' })
    assert.ok(downloads.includes('r.pptx'))
  })

  await test('管理 → 多维表格同步: list, run now, editor shows field errors', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    const nav = [...document.querySelectorAll('.n2s-adminnav-item')].find(b => b.textContent.includes('多维表格同步'))
    await clickEl(nav, 60)
    assert.match(rootEl.textContent, /渠道同步/)
    assert.match(rootEl.textContent, /每天 08:00/)
    assert.match(rootEl.textContent, /成功 · 12 条/)
    await click('立即同步')
    assert.deepEqual(rpcCalls.filter(c => c.method === 'runBitableSync').at(-1).payload, { id: 'bt1' })
    await click('+ 新建同步')
    const form = rootEl.querySelector('.n2s-card')
    const inputs = [...form.querySelectorAll('input.n2s-mono')]
    const proto = window.HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(inputs[0], 'https://x.feishu.cn/base/bascnPasted123?table=tblPasted9&view=v'); inputs[0].dispatchEvent(new window.Event('input', { bubbles: true })) })
    await settle()
    assert.equal(inputs[0].value, 'bascnPasted123', 'link → app_token')
    assert.equal(form.querySelectorAll('input.n2s-mono')[1].value, 'tblPasted9', 'link → table_id')
    await click('保存', form)
    assert.match(form.textContent, /table_id 格式不正确/)
    assert.deepEqual(missing(), [])
  })

  await test('no React errors', () => {
    assert.deepEqual(errors.filter(e => !/act\(|not wrapped/.test(e)), [])
  })

  summary()
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
