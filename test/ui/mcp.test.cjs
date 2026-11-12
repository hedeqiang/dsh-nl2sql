// 管理 → MCP 接入 (client-src/26a-mcp.js) rendered in jsdom against canned RPCs.
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
  const copied = []
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (s) => { copied.push(s) } }, configurable: true })
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
  let status = { enabled: false, port: 47860, running: false, error: null, url: 'http://127.0.0.1:47860/mcp', protocolVersions: ['2026-07-28'], tokens: [
    { id: 'mt-1', name: '我的 Cursor', prefix: 'n2s_mcp_abcd', scope: { type: 'owner' }, createdAt: Date.now() - 86400000, lastUsedAt: null },
    { id: 'mt-2', name: '分析组', prefix: 'n2s_mcp_efgh', scope: { type: 'role', role: 'analyst', datasourceIds: ['d1'], datasourceNames: ['本地'], rowRules: [{ column: 'status', values: ['1'] }] }, createdAt: Date.now(), lastUsedAt: Date.now() },
  ] }
  const calls = []
  const responses = {
    listDatasources: [ds],
    mcpStatus: () => status,
    saveMcpSettings: (p) => { status = { ...status, ...p, running: p.enabled ?? status.enabled }; return status },
    createMcpToken: (p) => { const tok = { id: `mt-new-${status.tokens.length}`, name: p.name, prefix: 'n2s_mcp_zzzz', scope: { type: p.scope.memberId ? 'member' : p.scope.role ? 'role' : 'owner' }, createdAt: Date.now(), lastUsedAt: null }; status = { ...status, tokens: [...status.tokens, tok] }; return { ...tok, token: 'n2s_mcp_zzzzSECRETVALUE' } },
    revokeMcpToken: (p) => { status = { ...status, tokens: status.tokens.filter(t => t.id !== p.id) }; return { revoked: p.id } },
    listUsers: [{ id: 'u1', name: '张三', role: 'viewer', datasourceIds: ['d1'] }],
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
  const btn = (label, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label) ?? [...scope.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
  const setValue = async (el, value) => {
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })) })
  }
  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(50)

  await test('locale: mcp.* keys exist in zh and en (identical sets)', () => {
    const z = Object.keys(dict).filter(k => k.startsWith('mcp.')).sort()
    const e = Object.keys(enDict).filter(k => k.startsWith('mcp.')).sort()
    assert.ok(z.length > 40); assert.deepEqual(z, e)
  })

  await test('admin nav shows MCP 接入; section lists endpoint, tokens and scopes', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    await clickEl([...document.querySelectorAll('.n2s-adminnav-item')].find(b => b.textContent.includes('MCP 接入')))
    assert.deepEqual(text().match(/!![\w.]+/g) ?? [], [])
    assert.equal(document.querySelector('[data-mcp-url]').textContent, 'http://127.0.0.1:47860/mcp')
    assert.match(text(), /未启用/)
    assert.match(text(), /我的 Cursor/); assert.match(text(), /本机用户/); assert.match(text(), /从未/)
    assert.match(text(), /分析组/); assert.match(text(), /分析师/); assert.match(text(), /1 条行级规则/)
  })

  await test('enable switch and port call saveMcpSettings', async () => {
    const sw = document.querySelector('.n2s-mcp input[role=switch]')
    await clickEl(sw)
    assert.deepEqual(calls.filter(c => c.method === 'saveMcpSettings').at(-1).payload, { enabled: true })
    await settle(50)
    assert.match(text(), /运行中/)
    const portInput = document.querySelector('.n2s-mcp input[aria-label="端口"]')
    await setValue(portInput, '48000')
    await clickEl(btn('应用'))
    assert.deepEqual(calls.filter(c => c.method === 'saveMcpSettings').at(-1).payload, { port: 48000 })
  })

  await test('config snippets: Claude Desktop (stdio bridge), Cursor and VS Code (HTTP) with copy', async () => {
    const pre = () => [...document.querySelectorAll('.n2s-mcp pre[data-snippet]')].at(-1)
    assert.match(pre().textContent, /"nl2sql-mcp"/)
    assert.match(pre().textContent, /@hedeqiang\/dsh-nl2sql/)
    assert.match(pre().textContent, /NL2SQL_MCP_TOKEN/)
    const seg = pre().closest('.n2s-mcp-snippets')
    await clickEl(btn('Cursor', seg))
    assert.match(pre().textContent, /"Authorization": "Bearer <YOUR_TOKEN>"/)
    await clickEl(btn('VS Code', seg))
    assert.match(pre().textContent, /"type": "http"/)
    await clickEl(btn('复制', seg))
    assert.match(copied.at(-1), /"servers"/)
  })

  await test('create a role token: shown once with copy and filled-in snippets', async () => {
    await clickEl(btn('+ 新建令牌'))
    const form = document.querySelector('.n2s-mcp-form')
    await setValue(form.querySelector('input'), 'Claude')
    await clickEl(btn('角色 + 数据源', form))
    await clickEl(btn('本地', form))
    await setValue(form.querySelector('input[aria-label="字段名"]'), 'status')
    await setValue(form.querySelector('input[aria-label="允许的值，逗号分隔"]'), '1,2')
    await clickEl(btn('创建令牌', form))
    await settle(50)
    const p = calls.filter(c => c.method === 'createMcpToken').at(-1).payload
    assert.deepEqual(p, { name: 'Claude', scope: { role: 'analyst', datasourceIds: ['d1'], rowRules: [{ column: 'status', values: '1,2' }] } })
    assert.equal(document.querySelector('[data-mcp-token]').textContent, 'n2s_mcp_zzzzSECRETVALUE')
    const fresh = document.querySelector('.n2s-mcp-fresh')
    assert.match(fresh.querySelector('pre').textContent, /n2s_mcp_zzzzSECRETVALUE/)
    await clickEl(btn('复制', fresh))
    assert.equal(copied.at(-1), 'n2s_mcp_zzzzSECRETVALUE')
    await clickEl(btn('我已保存', fresh))
    assert.equal(document.querySelector('[data-mcp-token]'), null, 'token hidden after dismissal')
  })

  await test('member token requires a member; validation message', async () => {
    await clickEl(btn('+ 新建令牌'))
    const form = document.querySelector('.n2s-mcp-form')
    await setValue(form.querySelector('input'), 'M')
    await clickEl(btn('某个成员', form))
    await clickEl(btn('创建令牌', form))
    assert.match(form.textContent, /请选择成员/)
    const sel = form.querySelector('select')
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, 'u1'); sel.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await clickEl(btn('创建令牌', form))
    assert.deepEqual(calls.filter(c => c.method === 'createMcpToken').at(-1).payload, { name: 'M', scope: { memberId: 'u1' } })
    await clickEl(btn('我已保存'))
  })

  await test('revoke asks for confirmation then calls revokeMcpToken', async () => {
    const row = document.querySelector('tr[data-token-id="mt-1"]')
    await clickEl(btn('吊销', row))
    const ok = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '吊销' && !b.closest('tr'))
    await clickEl(ok)
    await settle(50)
    assert.deepEqual(calls.filter(c => c.method === 'revokeMcpToken').at(-1).payload, { id: 'mt-1' })
    assert.equal(document.querySelector('tr[data-token-id="mt-1"]'), null)
  })

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })
  summary('mcp ui')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
