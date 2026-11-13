// 管理 → 破纪录播报 (client-src/features/milestones.js) rendered in jsdom against canned RPCs.
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
  let rules = [{ id: 'ms1', name: '充值破纪录', datasourceId: 'd1', datasourceName: '本地', metrics: ['充值订单数'], kinds: { record: true, month: true, streak: false, total: true }, direction: 'up', streakDays: 5, totalStep: 0, channelId: 'ch1', channelName: '运营群', time: '09:30', enabled: true, language: 'zh', lastRunAt: Date.now(), lastStatus: 'ok', lastEvents: 2 }]
  const calls = []
  const responses = {
    listDatasources: [ds], listMilestones: () => rules,
    saveMilestone: (p) => { const r = { id: 'ms2', ...p, channelName: null, datasourceName: '本地' }; rules = [...rules, r]; return r },
    getKnowledge: { metrics: [{ id: 'm1', name: '充值订单数', timeColumn: 'created_at' }, { id: 'm2', name: '无时间', timeColumn: '' }], glossary: [], examples: [] },
    runMilestone: (p) => (p.send ? { pushed: undefined, events: [] } : { day: '2026-11-12', title: '🎉 充值破纪录 · 2026-11-12', text: '🏆 **充值订单数** 11-12 达到 **1,800**，创历史新高', events: [{ kind: 'record' }], results: [] }),
    backtestMilestone: { days: 30, daysWithEvents: 2, events: [{ day: '2026-11-12', kind: 'record', text: '🏆 **充值订单数** 达到 **1,800**' }, { day: '2026-11-01', kind: 'total', text: '🎯 **充值订单数** 累计突破 **10 万**' }], errors: [] },
    listChannels: [{ id: 'ch1', name: '运营群', type: 'lark_app', platform: 'lark' }],
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


  await test('locale: ms.* keys exist in zh and en', () => {
    const z = Object.keys(dict).filter(k => k.startsWith('ms.')).sort()
    const e = Object.keys(enDict).filter(k => k.startsWith('ms.')).sort()
    assert.ok(z.length > 20); assert.deepEqual(z, e)
  })

  await test('admin nav: 破纪录播报 under 洞察与自动化; list shows kinds, time and last result', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    const nav = [...document.querySelectorAll('.n2s-adminnav-item')]
    const item = nav.find(b => b.textContent.includes('破纪录播报'))
    assert.ok(item, nav.map(b => b.textContent).join('|'))
    await clickEl(item)
    assert.deepEqual(text().match(/!![\w.]+/g) ?? [], [])
    assert.match(text(), /充值破纪录/); assert.match(text(), /运营群/)
    assert.match(text(), /单日新高、单月新高、累计破关口/)
    assert.doesNotMatch(text(), /连续增长 ·/)
    assert.match(text(), /每天 09:30/); assert.match(text(), /上次 2 条/)
  })

  await test('preview and 30-day backtest render', async () => {
    const btn = (label) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
    await clickEl(btn('预览昨天'))
    assert.match(text(), /创历史新高/)
    assert.deepEqual(calls.filter(c => c.method === 'runMilestone').at(-1).payload, { id: 'ms1' })
    await clickEl(btn('回看 30 天'))
    assert.match(text(), /30 天中有 2 天会播报，共 2 条/)
    assert.match(text(), /2026-11-01/); assert.match(text(), /累计突破/)
  })

  await test('new rule form: metrics without a time column are disabled; save sends kinds', async () => {
    const add = [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建播报'))
    await clickEl(add)
    const name = document.querySelector('input[placeholder="例如：充值破纪录"]')
    await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(name, '测试'); name.dispatchEvent(new window.Event('input', { bubbles: true })) })
    const chips = [...document.querySelectorAll('.n2s-chip')]
    assert.equal(chips.find(c => c.textContent === '无时间').disabled, true)
    await clickEl(chips.find(c => c.textContent === '充值订单数'))
    const streak = [...document.querySelectorAll('.n2s-ms-kind')].find(l => l.textContent.includes('连续增长')).querySelector('input')
    await clickEl(streak)
    await clickEl([...document.querySelectorAll('.n2s-card button')].find(b => b.textContent.trim() === '保存'))
    const p = calls.filter(c => c.method === 'saveMilestone').at(-1).payload
    assert.equal(p.name, '测试'); assert.deepEqual(p.metrics, ['充值订单数'])
    assert.deepEqual(p.kinds, { record: true, month: true, streak: false, total: true })
    assert.equal(p.time, '09:30'); assert.equal(p.totalStep, 0)
  })

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })
  summary('milestones ui')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
