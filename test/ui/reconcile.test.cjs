// 管理 → 对账 (client-src/22a-reconcile.js) rendered in jsdom against canned RPCs: job list with last
// run status, editor (two panes, key / compare mapping, options, schedule, channel), dry run with
// summary + difference tables (ResultView), run history, and the nl2sql_reconcile tool view.
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

  // ------------------------------------------------------------ canned RPC responses
  const ds = [{ id: 'd1', name: '订单库', database: 'testdb', current: true, schemaAnalyzedAt: 1, policy: { mode: 'deny', tables: [], hiddenColumns: [], maskedColumns: [] } }, { id: 'd2', name: '财务库', database: 'fin', schemaAnalyzedAt: 1, policy: { mode: 'deny', tables: [], hiddenColumns: [], maskedColumns: [] } }]
  const summaryResult = { resultId: 'rs', datasourceId: 'd1', datasourceName: '订单库 ↔ 财务库', title: 'J · 汇总', sql: '-- l\nselect 1', rowCount: 3, elapsedMs: 5, truncated: false, columns: [{ name: '项目', kind: 'text' }, { name: '订单库', kind: 'number' }, { name: '财务库', kind: 'number' }, { name: '差值', kind: 'number' }], rows: [['行数', 3, 3, 0], ['匹配的键', 2, 2, 0], ['仅一侧存在', 1, 1, 0]], chart: { type: 'table' } }
  const mmResult = { ...summaryResult, resultId: 'rm', title: 'J · 值不一致', rowCount: 1, columns: [{ name: 'id', kind: 'text' }, { name: 'amt [订单库]', kind: 'number' }, { name: 'amt [财务库]', kind: 'number' }, { name: 'amt 差值', kind: 'number' }, { name: '差异列', kind: 'text' }], rows: [['A2', 20, 21, -1, 'amt']] }
  const olResult = { ...summaryResult, resultId: 'rl', title: 'J · 仅订单库', rowCount: 1, columns: [{ name: 'id', kind: 'text' }, { name: 'amt', kind: 'number' }], rows: [['A4', 40]] }
  const orResult = { ...olResult, resultId: 'rr', title: 'J · 仅财务库', rows: [['A5', 50]] }
  const all = { rs: summaryResult, rm: mmResult, rl: olResult, rr: orResult }
  const outcome = {
    title: 'J', at: Date.now(), left: { datasourceId: 'd1', datasourceName: '订单库', label: '订单库', rows: 3 }, right: { datasourceId: 'd2', datasourceName: '财务库', label: '财务库', rows: 3 },
    summary: { leftRows: 3, rightRows: 3, matched: 2, onlyLeft: 1, onlyRight: 1, mismatchedRows: 1, matchRate: 0.25, keyMatchRate: 0.5, hasDiff: true, complete: true, truncated: { left: false, right: false }, columns: [{ left: 'amt', right: 'amt', label: 'amt', tolerance: 0.01, relative: false, mismatches: 1, leftTotal: 90, rightTotal: 101, diff: -11 }] },
    warnings: ['右侧有 1 行键重复'], results: [summaryResult, mmResult, olResult, orResult], diffs: [],
  }
  const job = { id: 'rc-1', name: '订单对账', left: { datasourceId: 'd1', sql: 'select id, amt from o' }, right: { datasourceId: 'd2', sql: 'select id, amt from f' }, keys: [{ left: 'id', right: 'id' }], compare: [{ left: 'amt', right: 'amt', tolerance: 0.01, relative: false }], options: { trim: true, ignoreCase: false }, schedule: { time: '08:30', enabled: true }, channelId: 'ch1', notifyOn: 'diff', leftName: '订单库', rightName: '财务库', channelName: '数据群', lastRun: { at: Date.now(), status: 'diff', matchRate: 0.25, onlyLeft: 1, onlyRight: 1, mismatchedRows: 1, complete: true } }
  const responses = {
    listDatasources: ds, getSettings: { maxRows: 500, retention: {}, defaults: {} }, onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: true, askedQuestion: true, dismissed: true },
    askSuggestions: { examples: [], recent: [], total: 0 }, listDashboards: { current: 'db-default', dashboards: [{ id: 'db-default', name: '默认看板', widgets: 0 }] }, listDashboard: [],
    analyzeSchema: { analyzedAt: 1, tables: [], relations: [] }, getKnowledge: { glossary: [], metrics: [], notes: {}, examples: [] }, suggestionCount: { count: 0, byKind: {} },
    listChannels: [{ id: 'ch1', name: '数据群', type: 'lark_webhook', hasSecret: true, isDefault: true }],
    listReconciles: [job], saveReconcile: job, deleteReconcile: { deleted: 'rc-1' },
    runReconcile: (p) => (p.id ? { ...outcome, runId: 'rr-2', status: 'diff', pushed: true } : outcome),
    reconcileRuns: [{ id: 'rr-1', reconcileId: 'rc-1', name: '订单对账', at: Date.now(), source: 'schedule', status: 'diff', summary: outcome.summary, left: outcome.left, right: outcome.right, warnings: [], resultIds: ['rs', 'rm', 'rl', 'rr'], pushed: true }, { id: 'rr-0', reconcileId: 'rc-1', name: '订单对账', at: Date.now() - 86400000, source: 'ui', status: 'error', error: '右侧（财务库）查询失败：boom', pushed: false }],
    getResult: (p) => all[p.resultId] ?? null,
  }
  const rpcCalls = []
  global.fetch = async (url, init) => {
    const { method, payload } = JSON.parse(init.body); rpcCalls.push({ method, payload })
    const r = responses[method]; return { status: 200, json: async () => ({ ok: true, value: typeof r === 'function' ? r(payload) : (r ?? null) }) }
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
  const text = () => rootEl.textContent
  const settle = (ms = 30) => act(() => sleep(ms))
  const findButton = (label, scope = document) => { const b = [...scope.querySelectorAll('button')]; return b.find((x) => x.textContent.trim() === label) ?? b.find((x) => x.textContent.trim().startsWith(label)) }
  const click = async (label, scope) => { const b = findButton(label, scope); if (!b) throw new Error('no button ' + label); await act(async () => { b.click() }); await settle() }
  const clickEl = async (el, ms = 30) => { assert.ok(el, 'element exists'); await act(async () => { el.click() }); await settle(ms) }
  const setValue = async (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  }
  const missingKeys = () => text().match(/!![\w.]+/g) ?? []

  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(50)

  await test('locale: rc.* keys identical in zh and en', () => {
    const z = Object.keys(dicts.zh).filter(k => k.startsWith('rc.')).sort()
    const e = Object.keys(dicts.en).filter(k => k.startsWith('rc.')).sort()
    assert.ok(z.length > 40)
    assert.deepEqual(z, e)
  })

  await test('管理 → 对账: nav item, job list with last run status and history', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    const item = [...document.querySelectorAll('.n2s-adminnav-item')].find((b) => b.textContent.includes('对账'))
    assert.ok(item, 'nav has 对账')
    await clickEl(item, 50)
    assert.deepEqual(missingKeys(), [])
    assert.match(text(), /订单对账/)
    assert.match(text(), /订单库 ⇄ 财务库/)
    assert.match(text(), /每天 08:30/)
    assert.match(text(), /有差异/)
    assert.match(text(), /一致率 25\.00%/)
    assert.match(text(), /运行记录/)
    assert.match(text(), /右侧（财务库）查询失败：boom/)
  })

  await test('history row opens the stored run: summary stats + tabs + ResultView', async () => {
    await clickEl(document.querySelector('.n2s-rc-run'), 50)
    assert.match(text(), /对账结果 · 订单对账/)
    assert.ok(document.querySelector('.n2s-rc-stats'))
    // Opens on the first non-empty difference table.
    const pressed = document.querySelector('.n2s-rc-out [role=tab][aria-pressed=true]')
    assert.match(pressed.textContent, /值不一致/)
    assert.ok(document.querySelector('.n2s-rc-out .n2s-result'), 'ResultView rendered')
    assert.match(document.querySelector('.n2s-rc-out .n2s-result').textContent, /A2/)
    await clickEl([...document.querySelectorAll('.n2s-rc-out [role=tab]')].find(b => /仅财务库/.test(b.textContent)))
    assert.match(document.querySelector('.n2s-rc-out .n2s-result').textContent, /A5/)
    assert.deepEqual(missingKeys(), [])
  })

  await test('立即运行 calls runReconcile with the id and shows the outcome', async () => {
    await click('立即运行'); await settle(40)
    const c = rpcCalls.filter(x => x.method === 'runReconcile').pop()
    assert.deepEqual(c.payload, { id: 'rc-1' })
    assert.match(text(), /发现差异，一致率 25\.00%/)
    assert.match(text(), /右侧有 1 行键重复/)
  })

  await test('editor: two panes, mappings, tolerance, schedule; dry run sends the draft definition', async () => {
    await click('+ 新建对账'); await settle(40)
    const ed = document.querySelector('.n2s-rc-editor')
    assert.ok(ed, 'editor open')
    assert.equal(ed.querySelectorAll('.n2s-rc-pane').length, 2)
    await setValue(ed.querySelector('input.n2s-input'), '新对账')
    const panes = ed.querySelectorAll('.n2s-rc-pane')
    await setValue(panes[1].querySelector('select'), 'd2')
    await setValue(panes[0].querySelector('textarea'), 'select id, amt from o')
    await setValue(panes[1].querySelector('textarea'), 'select order_id, amount from f')
    await setValue(ed.querySelector('input[aria-label="键列 1 左侧"]'), 'id')
    await setValue(ed.querySelector('input[aria-label="键列 1 右侧"]'), 'order_id')
    await click('+ 添加比较列', ed)
    await setValue(ed.querySelector('input[aria-label="比较列 1 左侧"]'), 'amt')
    await setValue(ed.querySelector('input[aria-label="比较列 1 右侧"]'), 'amount')
    await setValue(ed.querySelector('input[aria-label="容差"]'), '0.5')
    await setValue(ed.querySelector('select[aria-label="容差类型"]'), 'rel')
    const daily = [...ed.querySelectorAll('label.n2s-check')].find(l => /每天定时运行/.test(l.textContent)).querySelector('input')
    await clickEl(daily)
    await click('试运行', ed); await settle(40)
    const c = rpcCalls.filter(x => x.method === 'runReconcile').pop()
    const d = c.payload.definition
    assert.equal(d.name, '新对账')
    assert.deepEqual(d.left, { datasourceId: 'd1', sql: 'select id, amt from o' })
    assert.deepEqual(d.right, { datasourceId: 'd2', sql: 'select order_id, amount from f' })
    assert.deepEqual(d.keys, [{ left: 'id', right: 'order_id' }])
    assert.deepEqual(d.compare, [{ left: 'amt', right: 'amount', tolerance: 0.5, relative: true }])
    assert.deepEqual(d.schedule, { time: '09:00', enabled: true })
    assert.match(ed.textContent, /试运行结果（未保存）/)
    assert.ok(ed.querySelector('.n2s-rc-out .n2s-result'), 'dry run tables rendered with ResultView')
    await click('保存', ed); await settle(40)
    const s = rpcCalls.filter(x => x.method === 'saveReconcile').pop()
    assert.equal(s.payload.name, '新对账')
    assert.equal(s.payload.channelId, null)
    assert.ok(!document.querySelector('.n2s-rc-editor'), 'editor closed after save')
    assert.deepEqual(missingKeys(), [])
  })

  await test('tool view nl2sql_reconcile: running, error and result', async () => {
    const TV = regs['tool.call.toolview:nl2sql_reconcile']
    assert.equal(typeof TV, 'function', 'tool view registered via extend.toolViews')
    const el = document.createElement('div'); document.body.appendChild(el)
    const r = createRoot(el)
    await act(async () => { r.render(React.createElement(TV, { phase: 'call', block: { argsRaw: '{"title":"对一下"}' } })) }); await settle()
    assert.match(el.textContent, /正在对账/)
    await act(async () => { r.render(React.createElement(TV, { phase: 'result', block: { isError: true, content: [{ type: 'text', text: '左侧查询失败' }], call: { argsRaw: '{}' } } })) }); await settle()
    assert.match(el.textContent, /左侧查询失败/)
    const meta = { reconcile: true, title: '对一下', left: outcome.left, right: outcome.right, summary: outcome.summary, warnings: [], results: outcome.results.map(x => ({ resultId: x.resultId, title: x.title })) }
    await act(async () => { r.render(React.createElement(TV, { phase: 'result', block: { isError: false, meta, call: { argsRaw: '{}' } } })) }); await settle(50)
    assert.match(el.textContent, /订单库 ⇄ 财务库/)
    assert.match(el.textContent, /一致率/)
    assert.ok(el.querySelector('.n2s-result'))
    assert.doesNotMatch(el.textContent, /!![\w.]+/)
  })

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })

  summary('reconcile ui')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
