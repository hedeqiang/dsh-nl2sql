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
  status.toolNames = ['list_datasources', 'get_schema', 'query', 'list_metrics', 'explain_sql']
  status.tokens[1] = { ...status.tokens[1], expiresAt: Date.now() + 86400000 * 3, tools: ['query'], rateLimit: 30 }
  const callLog = [
    { id: 'mc-1', at: Date.now() - 1000, tokenId: 'mt-2', tokenName: '分析组', method: 'tools/call', tool: 'query', datasource: '本地', ms: 42, status: 'ok', rows: 3 },
    { id: 'mc-2', at: Date.now() - 2000, tokenId: 'mt-2', tokenName: '分析组', method: 'tools/call', tool: 'get_schema', datasource: '本地', ms: 7, status: 'error', error: 'denied' },
    { id: 'mc-3', at: Date.now() - 3000, tokenId: 'mt-1', tokenName: '我的 Cursor', method: 'tools/list', ms: 1, status: 'cancelled' },
  ]
  let selfTest = { ok: true, url: 'http://127.0.0.1:47860/mcp', tools: ['a', 'b', 'c'], steps: [{ step: 'server/discover', ok: true, ms: 3, detail: 'versions 2026-07-28' }, { step: 'tools/list', ok: true, ms: 2, detail: '3 tools' }] }
  const calls = []
  const responses = {
    listDatasources: [ds],
    mcpStatus: () => status,
    saveMcpSettings: (p) => { status = { ...status, ...p, running: p.enabled ?? status.enabled }; return status },
    createMcpToken: (p) => { const tok = { id: `mt-new-${status.tokens.length}`, name: p.name, prefix: 'n2s_mcp_zzzz', scope: p.scope.memberId ? { type: 'member', memberId: p.scope.memberId, memberName: '张三' } : p.scope.role ? { type: 'role', role: p.scope.role, datasourceIds: p.scope.datasourceIds, datasourceNames: ['本地'], rowRules: p.scope.rowRules ?? [] } : { type: 'owner' }, tools: p.tools ?? null, rateLimit: p.rateLimit ?? null, expiresAt: p.expiresAt ?? null, createdAt: Date.now(), lastUsedAt: null }; status = { ...status, tokens: [...status.tokens, tok] }; return { ...tok, token: 'n2s_mcp_zzzzSECRETVALUE' } },
    updateMcpToken: (p) => { status = { ...status, tokens: status.tokens.map(t => (t.id === p.id ? { ...t, name: p.name, expiresAt: p.expiresAt, tools: p.tools, rateLimit: p.rateLimit } : t)) }; return status.tokens.find(t => t.id === p.id) },
    rotateMcpToken: (p) => ({ ...status.tokens.find(t => t.id === p.id), token: 'n2s_mcp_ROTATED_SECRET' }),
    mcpCallLog: (p) => callLog.filter(r => (!p.tokenId || r.tokenId === p.tokenId) && (!p.status || r.status === p.status)),
    mcpSelfTest: () => selfTest,
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


  await test('setup wizard: ten client tabs, each with its own snippet filled with the URL and placeholder', async () => {
    const seg = [...document.querySelectorAll('.n2s-mcp-snippets')].at(-1)
    const tabs = [...seg.querySelectorAll('[role=tab]')].map(b => b.getAttribute('data-client'))
    assert.deepEqual(tabs, ['claude', 'claudeCode', 'cursor', 'vscode', 'cline', 'windsurf', 'codex', 'gemini', 'zed', 'continue'])
    const pre = () => seg.querySelector('pre[data-snippet]')
    const url = 'http://127.0.0.1:47860/mcp'
    const expect = {
      claudeCode: [/claude mcp add --transport http nl2sql http:\/\/127\.0\.0\.1:47860\/mcp/, /--header "Authorization: Bearer <YOUR_TOKEN>"/, /--transport stdio .* -- npx -y -p @hedeqiang\/dsh-nl2sql nl2sql-mcp/],
      cursor: [/"mcpServers"/, /"url": "http:\/\/127\.0\.0\.1:47860\/mcp"/],
      vscode: [/"servers"/, /"type": "http"/],
      cline: [/"type": "streamableHttp"/, /"mcpServers"/],
      windsurf: [/"serverUrl": "http:\/\/127\.0\.0\.1:47860\/mcp"/],
      codex: [/^\[mcp_servers\.nl2sql\]/, /url = "http:\/\/127\.0\.0\.1:47860\/mcp"/, /http_headers = \{ "Authorization" = "Bearer <YOUR_TOKEN>" \}/],
      gemini: [/"httpUrl": "http:\/\/127\.0\.0\.1:47860\/mcp"/],
      zed: [/"context_servers"/],
      continue: [/type: streamable-http/, /requestOptions:/, /Authorization: Bearer <YOUR_TOKEN>/],
      claude: [/"command": "npx"/, /NL2SQL_MCP_TOKEN/],
    }
    for (const k of tabs) {
      await clickEl(seg.querySelector(`[data-client="${k}"]`))
      assert.equal(pre().getAttribute('data-snippet'), k)
      assert.ok(pre().textContent.includes(url), `${k} snippet contains the URL`)
      for (const re of expect[k]) assert.match(pre().textContent, re, k)
      if (/^[{]/.test(pre().textContent)) JSON.parse(pre().textContent)
      assert.deepEqual(text().match(/!![\w.]+/g) ?? [], [], k)
    }
    await clickEl(seg.querySelector('[data-client="codex"]'))
    await clickEl(seg.querySelector('.n2s-mcp-codeact button'))
    assert.match(copied.at(-1), /mcp_servers\.nl2sql/)
  })

  await test('test connection: calls mcpSelfTest and shows the steps; failure shows the error', async () => {
    await clickEl(btn('测试连接'))
    await settle(30)
    assert.ok(calls.some(c => c.method === 'mcpSelfTest'))
    const box = document.querySelector('[data-selftest]')
    assert.equal(box.getAttribute('data-selftest'), 'ok')
    assert.match(box.textContent, /发现 3 个工具/); assert.match(box.textContent, /server\/discover/)
    selfTest = { ok: false, error: 'MCP server is not running', steps: [] }
    await clickEl(btn('测试连接'))
    await settle(30)
    assert.equal(document.querySelector('[data-selftest]').getAttribute('data-selftest'), 'fail')
    assert.match(document.querySelector('[data-selftest]').textContent, /not running/)
  })

  await test('token row shows limits; editor sends expiry / allowlist / rate limit payload', async () => {
    const row = document.querySelector('tr[data-token-id="mt-2"]')
    assert.match(row.textContent, /到期/); assert.match(row.textContent, /1 个工具/); assert.match(row.textContent, /30 次\/分/)
    await clickEl(btn('编辑', row))
    const ed = document.querySelector('.n2s-mcp-editor')
    assert.ok(ed)
    assert.equal(ed.querySelector('input[data-tool="query"]').checked, true)
    await clickEl(ed.querySelector('input[data-tool="list_metrics"]'))
    await setValue(ed.querySelector('input[aria-label="频率限制（可选）"]'), '60')
    await setValue(ed.querySelector('input[type=date]'), '2031-01-15')
    await clickEl(btn('保存', ed))
    await settle(50)
    const p = calls.filter(c => c.method === 'updateMcpToken').at(-1).payload
    assert.equal(p.id, 'mt-2'); assert.equal(p.name, '分析组')
    assert.deepEqual(p.tools, ['query', 'list_metrics'])
    assert.equal(p.rateLimit, 60)
    assert.equal(new Date(p.expiresAt).getFullYear(), 2031)
    assert.equal(document.querySelector('.n2s-mcp-editor'), null)
    // all tools + no expiry → nulls
    await clickEl(btn('编辑', document.querySelector('tr[data-token-id="mt-2"]')))
    const ed2 = document.querySelector('.n2s-mcp-editor')
    await clickEl([...ed2.querySelectorAll('label.n2s-check')].find(l => l.textContent.includes('全部工具')).querySelector('input'))
    await clickEl(btn('不过期', ed2))
    await setValue(ed2.querySelector('input[aria-label="频率限制（可选）"]'), '')
    await clickEl(btn('保存', ed2))
    const p2 = calls.filter(c => c.method === 'updateMcpToken').at(-1).payload
    assert.equal(p2.tools, null); assert.equal(p2.expiresAt, null); assert.equal(p2.rateLimit, null)
  })

  await test('call log table renders per token rows and filters by status / token / text', async () => {
    const tbl = () => document.querySelector('.n2s-mcp-logtable')
    assert.equal(tbl().querySelectorAll('tbody tr').length, 3)
    assert.match(tbl().textContent, /query/); assert.match(tbl().textContent, /42/); assert.match(tbl().textContent, /失败/); assert.match(tbl().textContent, /已取消/)
    const logCard = document.querySelector('.n2s-mcp-log')
    await clickEl(btn('失败', logCard))
    await settle(30)
    assert.deepEqual(calls.filter(c => c.method === 'mcpCallLog').at(-1).payload, { status: 'error', limit: 200 })
    assert.equal(tbl().querySelectorAll('tbody tr').length, 1)
    await clickEl(btn('全部', logCard))
    const sel = logCard.querySelector('select')
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, 'mt-1'); sel.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await settle(30)
    assert.deepEqual(calls.filter(c => c.method === 'mcpCallLog').at(-1).payload, { tokenId: 'mt-1', limit: 200 })
    assert.equal(tbl().querySelectorAll('tbody tr').length, 1)
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, ''); sel.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await settle(30)
    await setValue(logCard.querySelector('input[aria-label="按工具或数据源筛选"]'), 'schema')
    await settle(20)
    assert.equal(tbl().querySelectorAll('tbody tr').length, 1)
  })

  await test('rotate secret: confirmation, then the new secret is shown once', async () => {
    await clickEl(btn('轮换密钥', document.querySelector('tr[data-token-id="mt-2"]')))
    const ok = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '轮换密钥' && !b.closest('tr'))
    await clickEl(ok)
    await settle(50)
    assert.deepEqual(calls.filter(c => c.method === 'rotateMcpToken').at(-1).payload, { id: 'mt-2' })
    assert.equal(document.querySelector('[data-mcp-token]').textContent, 'n2s_mcp_ROTATED_SECRET')
    assert.match(document.querySelector('.n2s-mcp-fresh pre').textContent, /ROTATED_SECRET/)
    await clickEl(btn('我已保存'))
  })

  await test('create with limits: expiry, allowlist and rate limit in the createMcpToken payload', async () => {
    await clickEl(btn('+ 新建令牌'))
    const form = document.querySelector('.n2s-mcp-form')
    await setValue(form.querySelector('input'), 'Limited')
    await clickEl([...form.querySelectorAll('label.n2s-check')].find(l => l.textContent.includes('全部工具')).querySelector('input'))
    await clickEl(btn('创建令牌', form))
    assert.match(form.textContent, /请至少勾选一个工具/)
    await clickEl(form.querySelector('input[data-tool="query"]'))
    await setValue(form.querySelector('input[aria-label="频率限制（可选）"]'), '10')
    await clickEl(btn('创建令牌', form))
    await settle(50)
    const p = calls.filter(c => c.method === 'createMcpToken').at(-1).payload
    assert.deepEqual(p, { name: 'Limited', scope: { kind: 'owner' }, tools: ['query'], rateLimit: 10 })
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
