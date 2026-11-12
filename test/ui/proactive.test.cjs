// Feature "proactive" (client-src/24a-proactive.js) in jsdom against canned RPCs:
// goal chips on the dashboard, "预测未来 7 天" in the result menu + forecast panel,
// 管理 → 目标 and 管理 → 每日简报 (list, preview, form), nl2sql_forecast tool view.
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
  const series = { resultId: 'r1', datasourceId: 'd1', datasourceName: '本地', title: '每日笔数', sql: 'select 1', rowCount: 5, elapsedMs: 3, truncated: false, columns: [{ name: '时间', kind: 'time' }, { name: '笔数', kind: 'number' }], rows: [['2026-11-01', 10], ['2026-11-02', 12], ['2026-11-03', 11], ['2026-11-04', 13], ['2026-11-05', 14]], chart: { type: 'line', x: '时间', y: ['笔数'] } }
  const fc = { resultId: 'r1', forecastResultId: 'r2', title: '每日笔数', x: '时间', measure: '笔数', horizon: 7, method: 'holt', kind: 'day', filled: 0, sigma: 1, history: series.rows.map(r => ({ x: r[0], y: r[1] })), forecast: Array.from({ length: 7 }, (_, i) => ({ x: `2026-11-${String(6 + i).padStart(2, '0')}`, h: i + 1, value: 15 + i, lower: 13 + i, upper: 17 + i })), summary: 's' }
  const goals = [
    { id: 'gl1', name: '月交易量', metric: '交易笔数', datasourceId: 'd1', datasourceName: '本地', period: 'month', target: 1000, direction: 'up', actual: 400, projected: 1100, pct: 0.4, projectedPct: 1.1, elapsedPct: 0.4, status: 'on-track', weekdayAware: true, periodStart: '2026-11-01', periodEnd: '2026-11-30' },
    { id: 'gl2', name: '退款率', metric: '退款', datasourceId: 'd1', period: 'quarter', target: 50, direction: 'down', status: 'error', error: '指标库中没有「退款」' },
  ]
  let digests = [{ id: 'dg1', name: '交易日报', datasourceId: 'd1', datasourceName: '本地', metrics: ['交易笔数'], channelId: 'ch1', channelName: '数据群', time: '09:00', enabled: true, language: 'zh', threshold: 30 }]
  const calls = []
  const responses = {
    listDatasources: [ds],
    onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: true, askedQuestion: true, hasChannel: true, dismissed: true },
    getSettings: { maxRows: 500, defaults: {} },
    listDashboards: { current: 'db', dashboards: [{ id: 'db', name: '默认', widgets: 1 }] },
    listDashboard: [{ id: 'w1', title: '每日笔数', sql: 'select 1', datasourceId: 'd1', chart: series.chart, width: 'half' }],
    runWidget: series, getResult: series, getDashboardFilters: [], filterCandidates: { time: [], dims: [] },
    goalProgress: () => goals,
    forecast: (p) => ({ ...fc, horizon: p.horizon, forecast: fc.forecast.slice(0, p.horizon) }),
    getKnowledge: { glossary: [], metrics: [{ id: 'm1', name: '交易笔数', expression: 'COUNT(*)', table: 't' }, { id: 'm2', name: '交易金额', expression: 'SUM(a)', table: 't' }], notes: {}, examples: [] },
    saveGoal: (p) => ({ id: 'gl3', ...p }), deleteGoal: {}, getGoalPush: { enabled: false, channelId: null, weekday: 1, time: '09:00' }, saveGoalPush: (p) => p,
    listChannels: [{ id: 'ch1', name: '数据群', type: 'lark_webhook', isDefault: true }],
    listDigests: () => digests,
    saveDigest: (p) => { const d = { id: 'dg2', ...p }; digests = [...digests, d]; return d },
    runDigest: (p) => ({ id: 'run1', digestId: p.id, preview: !p.send, status: 'ok', title: '📊 交易日报 · 2026-11-11', text: '**值得关注**\n- **交易笔数** 昨天 24，比 7 日均值高 118%（主要来自 A +13）', resultIds: ['r1'], results: [series] }),
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
  const btn = (label, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label) ?? [...scope.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
  const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await settle(50); return fn() }
  const missing = () => document.body.textContent.match(/!![\w.-]+/g) ?? []
  const openAdmin = async (section) => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    await clickEl([...document.querySelectorAll('.n2s-adminnav-item')].find((b) => b.textContent.includes(section)))
    assert.deepEqual(missing(), [], 'untranslated locale keys')
  }
  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(50)

  await test('locale: pro.* keys exist in zh and en (identical sets)', () => {
    const z = Object.keys(dict).filter(k => k.startsWith('pro.')).sort()
    const e = Object.keys(enDict).filter(k => k.startsWith('pro.')).sort()
    assert.ok(z.length > 60, String(z.length)); assert.deepEqual(z, e)
  })

  await test('dashboard: goal chips with progress; widget menu → forecast panel', async () => {
    await clickEl(document.getElementById('n2s-tab-dashboard'))
    await settle(80)
    const chips = [...document.querySelectorAll('.n2s-pro-chip')]
    assert.equal(chips.length, 2, text())
    assert.match(chips[0].textContent, /月交易量.*40%/)
    assert.match(chips[0].getAttribute('title'), /进度正常/)
    assert.ok(chips[0].querySelector('.n2s-pro-bar.ok .cur').style.width === '40%')
    assert.match(chips[1].textContent, /出错/)
    assert.equal(calls.find(c => c.method === 'goalProgress').payload.dashboardId, 'db')
    assert.deepEqual(missing(), [])
  })

  await test('result menu → 预测未来 7 天 → forecast panel (ResultView in the nl2sql_query tool view)', async () => {
    const View = regs['tool.call.toolview:nl2sql_query']
    const host = document.createElement('div'); document.body.appendChild(host)
    const r2 = createRoot(host)
    await act(async () => { r2.render(React.createElement(View, { phase: 'result', block: { meta: { resultId: 'r1' }, call: { argsRaw: '{}' } } })) }); await settle(50)
    const trg = [...host.querySelectorAll('button[aria-haspopup=menu]')].find(b => b.getAttribute('aria-label') === '更多操作')
    await clickEl(trg)
    const item = [...document.querySelectorAll('.n2s-menu button')].find(b => b.textContent.includes('预测未来 7 天'))
    assert.ok(item, 'forecast menu item: ' + [...document.querySelectorAll('.n2s-menu button')].map(b => b.textContent).join('|'))
    await clickEl(item)
    await waitFor(() => /统计外推/.test(host.textContent))
    assert.deepEqual(calls.filter(c => c.method === 'forecast').at(-1).payload, { resultId: 'r1', horizon: 7 })
    assert.match(host.textContent, /未来 7 期预测/)
    assert.match(host.textContent, /Holt 线性趋势/)
    assert.match(host.textContent, /统计外推/)
    const panel = host.querySelector('.n2s-pro-fc')
    assert.ok(panel.querySelector('.n2s-chart'), 'chart container')
    await clickEl(btn('数据', panel))
    assert.equal(panel.querySelectorAll('tbody tr').length, 7)
    await clickEl(panel.querySelector('button[aria-label="关闭"]'))
    assert.ok(!host.querySelector('.n2s-pro-fc'), 'panel closed')
    await act(async () => { r2.unmount() })
    host.remove()
  })

  await test('nl2sql_forecast tool view renders the forecast from meta', async () => {
    const View = regs['tool.call.toolview:nl2sql_forecast']
    assert.equal(typeof View, 'function', 'tool view registered')
    const host = document.createElement('div'); document.body.appendChild(host)
    const r2 = createRoot(host)
    await act(async () => { r2.render(React.createElement(View, { phase: 'result', block: { meta: { forecast: fc }, call: { argsRaw: '{}' } } })) }); await settle()
    assert.match(host.textContent, /每日笔数/)
    assert.match(host.textContent, /未来 7 期预测/)
    await act(async () => { r2.unmount() })
    host.remove()
  })

  await test('管理 → 目标: list with status, form saves, weekly push settings', async () => {
    await openAdmin('目标')
    assert.match(text(), /月交易量/)
    assert.match(text(), /进度正常/)
    assert.match(text(), /按星期估算/)
    assert.match(text(), /指标库中没有「退款」/)
    assert.match(text(), /目标周报/)
    await clickEl(btn('+ 新建目标'))
    const form = document.querySelector('.n2s-card')
    const inputs = form.querySelectorAll('input')
    const setVal = async (el, v) => { await act(async () => { const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }) }
    await setVal(inputs[0], '季度金额')
    await settle()
    const metricSel = [...form.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '交易金额'))
    await setVal(metricSel, '交易金额')
    await setVal(form.querySelector('input[type=number]'), '5000')
    await clickEl(btn('保存', form))
    const saved = calls.filter(c => c.method === 'saveGoal').at(-1).payload
    assert.equal(saved.name, '季度金额'); assert.equal(saved.metric, '交易金额'); assert.equal(saved.target, 5000); assert.equal(saved.dashboardId, null)
    const sw = [...document.querySelectorAll('label.n2s-check input')].find(i => i.closest('label').textContent.includes('每周推送'))
    await clickEl(sw)
    assert.equal(calls.filter(c => c.method === 'saveGoalPush').at(-1).payload.enabled, true)
  })

  await test('管理 → 每日简报: list, preview renders Markdown + chart, new digest form', async () => {
    await openAdmin('每日简报')
    assert.match(text(), /交易日报/)
    assert.match(text(), /每天 09:00/)
    await clickEl(btn('预览'))
    await waitFor(() => /主要来自/.test(text()))
    assert.equal(calls.filter(c => c.method === 'runDigest').at(-1).payload.send, undefined)
    assert.match(text(), /主要来自 A \+13/)
    assert.match(text(), /📊 交易日报/)
    await clickEl(btn('+ 新建简报'))
    const form = document.querySelector('.n2s-card')
    await act(async () => { const el = form.querySelector('input'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '金额日报'); el.dispatchEvent(new window.Event('input', { bubbles: true })) })
    await settle()
    await clickEl([...form.querySelectorAll('.n2s-chip')].find(b => b.textContent === '交易金额'))
    await clickEl(btn('保存', form))
    const p = calls.filter(c => c.method === 'saveDigest').at(-1).payload
    assert.equal(p.name, '金额日报'); assert.deepEqual(p.metrics, ['交易金额']); assert.equal(p.dashboardId, null); assert.equal(p.threshold, 30)
    assert.deepEqual(missing(), [])
  })

  await test('no React errors', () => {
    assert.deepEqual(errors.filter(e => !/not wrapped in act|ReactDOMTestUtils/.test(e)), [])
  })

  await act(async () => { root.unmount() })
  summary('proactive ui')
})()
