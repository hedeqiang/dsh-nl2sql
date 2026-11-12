// 管理 → 群订阅 (client-src/23a-subscriptions.js) rendered in jsdom against canned RPCs.
// Bootstrap copied from client-dom.test.cjs.
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
  const React = req('react'); const ReactDOM = req('react-dom'); const { createRoot } = req('react-dom/client'); const { act } = React
  const errors = []
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)) }
  dom.window.onerror = (m) => errors.push('window ' + m)

  const ds = { id: 'd1', name: '本地', database: 'testdb', host: 'h', port: 3306, user: 'u', current: true, schemaAnalyzedAt: 1, hasPassword: true }
  let groups = [{ key: 'ch1:g1', channelId: 'ch1', chatId: 'g1', chatName: '运营群', platform: 'lark', channelName: '飞书机器人', items: [
    { kind: 'subscription', id: 'sub-1', title: '日报', schedule: '每天 09:00', nextAt: Date.now() + 3600000, status: 'active', datasourceName: '本地', createdBy: { name: '甲' }, lastDeliveredAt: Date.now() },
    { kind: 'alert', id: 'al-1', title: '笔数告警', schedule: '每小时检查', conditionText: '> 100', status: 'suspended', lastError: '成员「甲」已被移除或停用', datasourceName: '本地', createdBy: { name: '甲' } },
  ] }]
  const calls = []
  const responses = {
    listDatasources: [ds], listChatSubscriptions: () => groups,
    setChatSubscription: (p) => { if (p.action === 'delete') groups = groups.map(g => ({ ...g, items: g.items.filter(i => i.id !== p.id) })); return {} },
    onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: true, askedQuestion: true, hasChannel: true, dismissed: true },
    getSettings: { maxRows: 500, defaults: {} }, listDashboards: { current: 'db', dashboards: [{ id: 'db', name: '默认', widgets: 0 }] }, listDashboard: [],
  }
  global.fetch = async (url, init) => {
    const { method, payload } = JSON.parse(init.body); calls.push({ method, payload })
    const r = responses[method]; return { status: 200, json: async () => ({ ok: true, value: typeof r === 'function' ? r(payload) : (r ?? null) }) }
  }
  let plugin
  window.__ModuleLoader__ = { load(r) { plugin = r.factory(Object.assign((n) => ({ react: React, 'react-dom': ReactDOM, 'react-dom/client': req('react-dom/client') })[n], { async: () => new Promise(() => {}) })) } }
  require(path.join(PLUGIN_DIR, 'lib', 'client.js'))
  const LOCALE_SNAPSHOT = Object.freeze({ active: 'zh', locales: [], revision: 1 })
  const regs = {}; let dict; let enDict
  const ctx = {
    effect(fn) { return fn() },
    locale: { register(ns, d) { dict = d.zh; enDict = d.en; return () => {} }, bind() { return (k) => dict[k] ?? `!!${k}` }, subscribe() { return () => {} }, getSnapshot() { return LOCALE_SNAPSHOT } },
    slots: { inject(k, f) { f() }, register(opt, C) { regs[opt.name + ':' + (opt.key ?? opt.id)] = C } }, layout: {}, uiWorkspace: { startSession() {}, openSession() {} },
  }
  plugin.apply(ctx)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const rootEl = document.getElementById('root')
  const text = () => rootEl.textContent
  const settle = (ms = 30) => act(() => sleep(ms))
  const clickEl = async (el) => { assert.ok(el, 'element exists'); await act(async () => { el.click() }); await settle() }
  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(50)

  await test('locale: sub.* keys exist in zh and en', () => {
    const z = Object.keys(dict).filter(k => k.startsWith('sub.')).sort()
    const e = Object.keys(enDict).filter(k => k.startsWith('sub.')).sort()
    assert.ok(z.length > 10); assert.deepEqual(z, e)
  })

  await test('admin nav shows 群订阅; section lists items grouped by chat', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    const nav = [...document.querySelectorAll('.n2s-adminnav-item')]
    const item = nav.find(b => b.textContent.includes('群订阅'))
    await clickEl(item)
    assert.deepEqual(text().match(/!![\w.]+/g) ?? [], [])
    assert.match(text(), /运营群/)
    assert.match(text(), /飞书机器人/)
    assert.match(text(), /日报/); assert.match(text(), /每天 09:00/); assert.match(text(), /甲/)
    assert.match(text(), /已停用/); assert.match(text(), /已被移除或停用/)
  })

  await test('pause / resume / delete call setChatSubscription', async () => {
    const btn = (label) => [...document.querySelectorAll('.n2s-sub button')].find(b => b.textContent.trim() === label)
    await clickEl(btn('暂停'))
    assert.deepEqual(calls.filter(c => c.method === 'setChatSubscription').at(-1).payload, { id: 'sub-1', action: 'pause' })
    await clickEl(btn('恢复'))
    assert.deepEqual(calls.filter(c => c.method === 'setChatSubscription').at(-1).payload, { id: 'al-1', action: 'resume' })
    const del = [...document.querySelectorAll('.n2s-sub button[aria-label="删除"]')][0]
    await clickEl(del)
    const ok = [...document.querySelectorAll('button')].find(b => /^(删除|确定|确认)$/.test(b.textContent.trim()) && !b.closest('.n2s-sub'))
    await clickEl(ok)
    await settle(50)
    assert.deepEqual(calls.filter(c => c.method === 'setChatSubscription').at(-1).payload, { id: 'sub-1', action: 'delete' })
    assert.doesNotMatch(text(), /日报/)
  })

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })
  summary('subscriptions ui')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
