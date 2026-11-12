// lib/client.js rendered in jsdom with React: every page tab, key dialogs, tool views and the
// assistant-message "send to Lark" action, against canned RPC responses.
// Ported from an earlier standalone script (print-only checks turned into assertions).
//
// Needs jsdom, react and react-dom (not plugin dependencies). They are resolved from
// $NL2SQL_UI_MODULES, /tmp/node_modules, or the plugin's node_modules; otherwise the file is skipped.
const path = require('node:path')
const fs = require('node:fs')

const PLUGIN_DIR = path.resolve(__dirname, '..', '..')
const candidates = [process.env.NL2SQL_UI_MODULES, '/tmp/node_modules', path.join(PLUGIN_DIR, 'node_modules')].filter(Boolean)
const MODS = candidates.find((d) => ['jsdom', 'react', 'react-dom'].every((m) => fs.existsSync(path.join(d, m, 'package.json'))))

;(async () => {
  const { test, skipFile, summary, assert } = await import('../lib/assert.mjs')
  if (!MODS) skipFile(`jsdom/react/react-dom not found in ${candidates.join(', ')} (set NL2SQL_UI_MODULES or npm i jsdom react react-dom in /tmp)`)
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
  const ds = { policy: { mode: 'deny', tables: ['users'], hiddenColumns: ['orders.amount'], maskedColumns: [] }, id: 'd1', name: '本地', database: 'testdb', host: 'h', port: 3306, user: 'u', current: true, schemaAnalyzedAt: 1, hasPassword: true }
  const schema = { analyzedAt: 1, _x: 0, version: '8.0', tables: [{ name: 'orders', type: 'TABLE', role: 'fact', rows: 10, comment: '订单', columns: [{ name: 'id', columnType: 'bigint', dataType: 'bigint', key: 'PRI', roles: ['id'], comment: '' }, { name: 'status', columnType: 'tinyint', dataType: 'tinyint', key: '', roles: ['enum'], comment: '状态', values: [{ value: 1, count: 3 }] }, { name: 'created_at', columnType: 'datetime', dataType: 'datetime', key: '', roles: ['time'], comment: '' }, { name: 'amount', hidden: true, columnType: 'decimal', dataType: 'decimal', key: '', roles: ['measure'], comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }] }, { name: 'users', blocked: true, type: 'TABLE', role: 'dimension', rows: 3, comment: '', columns: [{ name: 'id', columnType: 'bigint', dataType: 'bigint', key: 'PRI', roles: ['id'], comment: '' }], indexes: [] }], relations: [{ from: { table: 'orders', column: 'user_id' }, to: { table: 'users', column: 'id' }, kind: 'inferred', confidence: 0.8 }] }
  const result = { resultId: 'r1', datasourceId: 'd1', datasourceName: '本地', title: 'T', sql: 'select 1', rowCount: 2, elapsedMs: 3, truncated: false, columns: [{ name: 'day', kind: 'time' }, { name: 'n', kind: 'number' }], rows: [['2026-01-01', 1], ['2026-01-02', 2]], chart: { type: 'kpi', y: ['n'] } }
  const responses = {
    listDatasources: [ds], analyzeSchema: schema, getKnowledge: { glossary: [{ id: 'g1', term: 'GMV', synonyms: ['成交额'], definition: '已支付金额', sql: 'SUM(x)' }], metrics: [{ id: 'm1', name: '日订单', expression: 'COUNT(*)', table: 'orders' }], notes: { 'orders.status': '1 成功' }, examples: [{ id: 'e1', question: 'q', sql: 'select 1' }] },
    listDashboard: [{ id: 'w1', title: 'W', sql: 'select 1', datasourceId: 'd1', chart: { type: 'table' }, width: 'half' }, { id: 'w2', title: 'W2', sql: 'select 2', datasourceId: 'd1', chart: { type: 'table' }, width: 'third' }], runWidget: result, runQuery: result, getResult: result,
    listHistory: [{ id: 'h1', at: Date.now(), datasourceId: 'd1', datasourceName: '本地', source: 'agent', sql: 'select 1', status: 'ok', rows: 1, elapsedMs: 2 }, { id: 'h2', at: Date.now(), datasourceId: 'd1', source: 'ui', sql: 'select x', status: 'error', error: 'bad' }],
    getSettings: { maxRows: 500, timeoutMs: 15000, sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, scanGuardRows: 1000000, cacheTtlSec: 300, retention: { history: 20000 }, defaults: { maxRows: 500, timeoutMs: 15000, sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, scanGuardRows: 1000000, cacheTtlSec: 300 } },
    saveSettings: { maxRows: 900, timeoutMs: 15000, sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, scanGuardRows: 1000000, cacheTtlSec: 300, retention: { history: 20000 } },
    resetSettings: { maxRows: 500, timeoutMs: 15000, sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, scanGuardRows: 1000000, cacheTtlSec: 300 },
    onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: false, askedQuestion: false, hasChannel: false, dismissed: false }, dismissOnboarding: {},
    askSuggestions: (p) => ({ examples: (p?.offset ?? 0) === 0 ? ['最近 30 天每天的日订单', '订单按状态的分布'] : ['第二批问题一', '第二批问题二'], total: 10, pageSize: 2, offset: p?.offset ?? 0, nextOffset: ((p?.offset ?? 0) + 2) % 10, recent: [{ id: 'h9', at: Date.now() - 120000, question: '昨天的订单量', sessionId: 's9', status: 'ok' }, { id: 'h8', at: Date.now() - 300000, question: '各状态订单', sessionId: 's8', status: 'ok' }], hasMoreRecent: (p?.recentLimit ?? 8) < 18, tableCount: 2 }),
    deleteHistory: { deleted: 1 },
    listDashboards: { current: 'db-default', dashboards: [{ id: 'db-default', name: '默认看板', widgets: 2 }] }, reorderWidgets: {}, updateWidget: {},
    schedulerStatus: { running: true, lastTickAt: Date.now(), lastRan: [], nextAlerts: [] }, storageStats: { resultsDb: { bytes: 1048576, results: 3, cacheEntries: 1 }, records: { history: 12 }, stateBytes: 2048, dataDir: '/tmp/x' }, purgeRecords: {},
    exportConfig: { format: 'dsh-nl2sql-config', version: 1 }, aboutInfo: { version: '0.9.0', dataDir: '/tmp/x', nodeVersion: '24', sqliteVersion: '3', testsCommand: 'npm test' },
    listAlerts: [], listUsers: [], larkBotStatus: { enabled: false, status: { state: 'idle' }, conversations: [], allowP2p: true, sessionScope: 'chat' }, usageByActor: [], listAlertEvents: [],
    draftNotes: [{ key: 'orders.status', text: 'x' }],
    suggestionCount: { datasourceId: 'd1', count: 2, byKind: { example: 1, metric: 1, note: 0, glossary: 0 } },
    listKnowledgeSuggestions: { datasourceId: 'd1', total: 2, suggestions: [
      { id: 'sg-0123456789', kind: 'example', item: { question: '各状态订单数', sql: 'select status, count(*) from orders group by status', note: '' }, evidence: [{ at: 1, question: '各状态订单数', sql: 'select status, count(*) from orders group by status', source: 'feedback' }], score: 0.9, reason: '用户对这条查询结果点了 👍' },
      { id: 'sg-abcdefabcd', kind: 'metric', item: { name: '成交额', expression: 'SUM(amount)', table: 'orders', filter: 'status = 1', timeColumn: 'created_at', dimensions: ['channel'], synonyms: [] }, evidence: [], score: 0.6, reason: '3 条成功的查询使用了相同的聚合口径' },
    ] },
    acceptSuggestion: { accepted: 'sg-abcdefabcd' }, dismissSuggestion: { dismissed: 'sg-0123456789' },
    listFeedback: [{ id: 'fb1', at: Date.now(), rating: 'down', datasourceId: 'd1', title: 'T', question: '各状态笔数', sql: 'select 1', comment: '口径不对', status: 'open', sessionId: 's1' }],
    feedbackStats: { up: 3, down: 1, open: 1, rate: 0.75 }, submitFeedback: {}, resolveFeedback: {}, savePolicy: {},
    filterCandidates: { time: [{ column: 'created_at', label: '创建时间', tables: ['orders'] }], dims: [{ column: 'status', label: '状态', tables: ['orders'], values: ['0', '1'] }] },
    getDashboardFilters: [{ kind: 'time', column: 'created_at', range: 'last7d' }], saveDashboardFilters: [],
    listChannels: [{ id: 'ch1', name: '数据群', type: 'lark_webhook', hasSecret: true, hasSign: true, isDefault: true, lastSentAt: Date.now() }, { id: 'ch2', name: '应用机器人', type: 'lark_app', appId: 'cli_1', receiveIdType: 'chat_id', receiveId: 'oc_1', hasSecret: true }],
    listDeliveries: [{ id: 'd1', at: Date.now(), channelName: '数据群', title: '日报', status: 'ok', results: 2, images: 1, source: 'agent' }, { id: 'd2', at: Date.now(), channelName: '数据群', title: 'x', status: 'error', error: '签名校验失败', source: 'test' }],
    sendToChannel: { ok: true, channel: '数据群', images: 0 }, previewAssistantMessage: { text: '## 昨日概况\n\n- **GMV** 128 万 <font color=\'green\'>+12%</font>\n\n| 渠道 | 订单 |\n|---|---|\n| 华东 | 1200 |', resultIds: ['r1'] }, sessionInfo: { preset: 'nl2sql', datasourceId: 'd1', datasources: [] }, sendDashboard: { ok: true, channel: '数据群', images: 0 }, testChannel: { ok: true }, saveChannel: { id: 'ch3' }, listChannelChats: [{ chatId: 'oc_9', name: '运营群' }],
    listReports: [{ id: 'rp1', title: '订单日报', datasourceId: 'd1', datasourceName: '本地', scope: 'question', question: '昨天订单', period: 'weekly', weekdays: [1, 5], time: '09:00:00', target: 'new_once', status: 'active', scheduledAt: new Date().toISOString(), lastDelivery: { deliveredAt: new Date().toISOString(), targetSessionId: 's1' } }],
    tableOverview: { table: 'orders', results: [result, { title: 'bad', sql: 'x', error: 'boom' }] }, saveReport: {}, testConnection: { ok: true, version: 'PostgreSQL 18', tableCount: 2, latencyMs: 3, viaSsh: true, warnings: [] }, explain: { plan: [{ id: 1, table: 'orders', type: 'ALL', rows: 10 }] },
  }
  const rpcCalls = []
  // 'legacy' simulates a host without the multi-platform channel RPCs (docs/CHANNELS.md).
  let hostMode = 'legacy'
  const NEW_ONLY = ['channelCatalog', 'botStatus', 'saveBot', 'restartBot', 'listChannelTargets']
  global.fetch = async (url, init) => {
    const { method, payload } = JSON.parse(init.body); rpcCalls.push({ method, payload })
    if (hostMode === 'legacy' && NEW_ONLY.includes(method)) return { status: 404, json: async () => ({ ok: false, error: { code: 'nl2sql/unknown-method', message: `unknown method ${method}` } }) }
    const r = responses[method]; return { status: 200, json: async () => ({ ok: true, value: typeof r === 'function' ? r(payload) : (r ?? null) }) }
  }

  // ------------------------------------------------------------ load the client plugin
  let plugin
  window.__ModuleLoader__ = { load(r) { plugin = r.factory(Object.assign((n) => ({ react: React, 'react-dom': ReactDOM })[n], { async: () => new Promise(() => {}) })) } }
  require(path.join(PLUGIN_DIR, 'lib', 'client.js'))
  // Same shape as dsh-client-locale's LocaleSnapshot ({ active, locales, revision }).
  const LOCALE_SNAPSHOT = Object.freeze({ active: 'zh', locales: [], revision: 1 })
  const regs = {}; let dict
  const ctx = {
    effect(fn) { return fn() },
    locale: { register(ns, d) { dict = d.zh; return () => {} }, bind() { return (k) => dict[k] ?? `!!${k}` }, subscribe() { return () => {} }, getSnapshot() { return LOCALE_SNAPSHOT } },
    slots: { inject(k, f) { f() }, register(opt, C) { regs[opt.name + ':' + (opt.key ?? opt.id)] = C } }, layout: {}, uiWorkspace: { startSession() {}, openSession() {} },
  }
  plugin.apply(ctx)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const rootEl = document.getElementById('root')
  const text = () => rootEl.textContent
  const settle = (ms = 30) => act(() => sleep(ms))
  const findButton = (label, scope = document) => { const all = [...scope.querySelectorAll('button')]; return all.find((x) => x.textContent.trim() === label) ?? all.find((x) => x.textContent.trim().startsWith(label)) }
  const click = async (label, scope) => { const b = findButton(label, scope); if (!b) throw new Error('no button ' + label); await act(async () => { b.click() }); await settle() }
  const clickEl = async (el, ms = 30) => { assert.ok(el, 'element exists'); await act(async () => { el.click() }); await settle(ms) }
  const menu = async (triggerLabel, item) => {
    const trg = [...document.querySelectorAll('button[aria-haspopup=menu]')].find((b) => (b.getAttribute('aria-label') ?? '') === triggerLabel)
    if (!trg) throw new Error('no menu ' + triggerLabel)
    await act(async () => { trg.click() }); await settle(20)
    const it = [...document.querySelectorAll('.n2s-menu button')].find((b) => b.textContent.trim().startsWith(item))
    if (!it) throw new Error('no item ' + item + ' in ' + [...document.querySelectorAll('.n2s-menu button')].map((b) => b.textContent).join('|'))
    await act(async () => { it.click() }); await settle()
  }
  const setValue = async (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })) })
  }
  const missingKeys = () => text().match(/!![\w.]+/g) ?? []
  const openTab = async (tab) => { await click(tab); assert.deepEqual(missingKeys(), [], 'untranslated locale keys'); assert.ok(text().length > 100, 'tab rendered content') }
  // Admin sections live under the 管理 tab with a left-hand nav.
  const openAdmin = async (section) => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    await clickEl([...document.querySelectorAll('.n2s-adminnav-item')].find((b) => b.textContent.includes(section)))
    assert.deepEqual(missingKeys(), [], 'untranslated locale keys')
  }

  const root = createRoot(rootEl)
  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(50)

  await test('page shell: five tabs + 管理 with section nav', async () => {
    assert.equal(typeof regs['main:nl2sql'], 'function')
    const tabs = [...document.querySelectorAll('.n2s-tabs [role=tab]')].map((b) => b.textContent.trim())
    assert.deepEqual(tabs, ['问答', '看板', '表结构', '业务知识', '历史', '管理'])
    await clickEl(document.getElementById('n2s-tab-admin'))
    const nav = [...document.querySelectorAll('.n2s-adminnav-item')].map((b) => b.textContent.replace(/\d+$/, '').trim())
    assert.deepEqual(nav, ['数据源', '成员与权限', '告警与报告', '渠道', '设置'])
    // keyboard: ArrowLeft from 管理 goes to 历史
    await act(async () => { document.getElementById('n2s-tab-admin').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) }); await settle()
    assert.equal(document.querySelector('.n2s-tabs [aria-selected=true]').textContent.trim(), '历史')
  })

  await test('问答: onboarding checklist, suggestions, recent questions', async () => {
    await openTab('问答')
    assert.match(text(), /三步开始使用/)
    assert.ok(document.querySelector('.n2s-step.current'), 'current step highlighted')
    assert.match(text(), /最近 30 天每天的日订单/)
    assert.match(text(), /昨天的订单量/)
    assert.match(text(), /正在使用「本地」· 2 张表/)
    await click('不再显示')
    assert.ok(rpcCalls.some((c) => c.method === 'dismissOnboarding'))
  })

  await test('问答: 换一批 pages suggestions; recent delete and show more', async () => {
    await click('换一批'); await settle(40)
    assert.equal(rpcCalls.filter((c) => c.method === 'askSuggestions').pop().payload.offset, 2)
    assert.match(text(), /第二批问题一/)
    assert.doesNotMatch(text(), /最近 30 天每天的日订单/)
    await clickEl(document.querySelector('button[aria-label="删除这条提问记录: 各状态订单"]'), 20)
    await clickEl([...document.querySelectorAll('.n2s-modal button')].find((b) => b.textContent === '删除'), 40)
    const del = rpcCalls.filter((c) => c.method === 'deleteHistory').pop()
    assert.deepEqual(del.payload, { title: '各状态订单', datasourceId: 'd1' })
    assert.doesNotMatch(document.querySelector('.n2s-recent').textContent, /各状态订单/)
    await click('显示更多'); await settle(40)
    assert.equal(rpcCalls.filter((c) => c.method === 'askSuggestions').pop().payload.recentLimit, 18)
  })

  await test('问答: explain plan, execute, feedback form, send to Lark', async () => {
    await openTab('问答')
    await click('直接写 SQL')
    await setValue(document.querySelectorAll('textarea')[1], 'select 1')
    await click('执行计划'); assert.match(text(), /EXPLAIN/)
    await click('执行'); assert.ok(document.querySelector('.n2s-result button[aria-label="更多操作"]'), 'result toolbar')
    await clickEl(document.querySelector('button[aria-label="结果有问题"]')); assert.match(text(), /哪里不对/)
    await click('用错了表'); await click('提交'); assert.match(text(), /问题清单/)
    assert.ok(rpcCalls.some((c) => c.method === 'submitFeedback'))
    await clickEl(document.querySelector('button[aria-label="发送到 IM"]')); assert.match(document.body.textContent, /发送到 IM 渠道/)
    await clickEl([...document.body.querySelectorAll('.n2s-modal button')].find((b) => b.textContent === '发送'), 40)
    assert.match(document.body.textContent, /已发送到 数据群/)
  })

  await test('表结构: ER view, table detail, auto overview', async () => {
    await openTab('表结构')
    await click('关系图'); await click('列表'); await click('orders')
    assert.match(text(), /状态/)
    await click('orders'); await click('自动概览')
    assert.match(text(), /boom/); assert.match(text(), /指标卡/)
  })

  await test('业务知识: feedback list, fix form, drafts, editor', async () => {
    await openTab('业务知识')
    await click('反馈'); assert.match(text(), /口径不对/); assert.match(text(), /75%/)
    await click('修正'); assert.match(text(), /正确的 SQL/)
    await click('业务词表'); for (const s of ['指标库', '样例问答', '表/字段备注']) await click(s)
    await click('根据枚举字段生成草稿'); assert.match(text(), /待补充/)
    await click('+ 新增'); assert.ok(document.querySelectorAll('textarea').length >= 1)
  })

  await test('业务知识: 建议 pill with count, cards, accept via editor, 忽略 → dismissSuggestion', async () => {
    await openTab('业务知识')
    const pill = [...document.querySelectorAll('.n2s-subtabs button')].find((b) => b.textContent.startsWith('建议'))
    assert.ok(pill, '建议 pill')
    assert.equal(pill.querySelector('.count')?.textContent, '2')
    await clickEl(pill, 40)
    assert.match(text(), /各状态订单数/); assert.match(text(), /成交额/); assert.match(text(), /SUM\(amount\) FROM orders WHERE status = 1/)
    assert.match(text(), /样例问答/); assert.match(text(), /依据（1 条）/); assert.match(text(), /置信度 90%/)
    const metricCard = document.querySelector('[data-sg="sg-abcdefabcd"]')
    await click('采纳', metricCard)
    const nameInput = [...metricCard.querySelectorAll('input')][0]
    assert.equal(nameInput.value, '成交额')
    await setValue(nameInput, '成交金额')
    await click('保存', metricCard)
    const acc = rpcCalls.filter((c) => c.method === 'acceptSuggestion').pop()
    assert.equal(acc.payload.id, 'sg-abcdefabcd'); assert.equal(acc.payload.item.name, '成交金额')
    await click('忽略', document.querySelector('[data-sg="sg-0123456789"]'))
    await clickEl([...document.querySelectorAll('.n2s-modal button')].find((b) => b.textContent === '忽略'), 40)
    const dis = rpcCalls.filter((c) => c.method === 'dismissSuggestion').pop()
    assert.deepEqual(dis?.payload, { datasourceId: 'd1', id: 'sg-0123456789' })
  })

  await test('看板: send-dashboard dialog and global filter bar structure', async () => {
    await openTab('看板')
    await click('发送看板'); assert.match(document.body.textContent, /重新查询看板/)
    await clickEl(document.querySelector('.n2s-modal button'), 20)
    // The filter bar is now an icon + selects inside .n2s-filterbar (no visible "全局筛选" label).
    const bar = document.querySelector('.n2s-filterbar')
    assert.ok(bar, '.n2s-filterbar rendered')
    assert.equal(bar.getAttribute('role'), 'group')
    assert.ok(bar.querySelector('svg'), 'filter icon')
    const range = bar.querySelector('select[aria-label="时间范围"]')
    assert.ok(range, 'time-range select')
    assert.equal(range.value, 'last7d')
    assert.ok([...range.options].some((o) => o.value === 'custom'))
    assert.match(bar.textContent, /1 个筛选已生效/)
    assert.ok(findButton('清除', bar), 'clear button')
    assert.ok(findButton('+ 筛选', bar) ?? [...bar.querySelectorAll('button[aria-haspopup=menu]')][0], 'add-filter dropdown')
  })

  await test('定时报告: report row and weekly form', async () => {
    await openAdmin('告警与报告'); await click('定时报告')
    assert.match(text(), /订单日报/); assert.match(text(), /一、五/)
    await click('+ 新建报告'); await click('每周')
    assert.match(text(), /星期/); assert.match(text(), /完成后推送到/)
    await click('取消')
  })

  const modal = () => [...document.querySelectorAll('.n2s-modal')].pop()
  const field = (key) => document.getElementById(`n2s-chf-${key}`)

  await test('渠道 (old host): legacy listChannels shape, built-in Lark catalog, add form, chat picker', async () => {
    await openAdmin('渠道')
    assert.match(text(), /数据群/); assert.match(text(), /应用机器人/)
    assert.match(text(), /oc_1/, 'target summary from legacy flat fields')
    assert.doesNotMatch(text(), /签名校验失败/, 'delivery log is collapsed')
    await click('推送记录'); assert.match(text(), /签名校验失败/)
    assert.ok(document.querySelector('.n2s-pgroup .n2s-pmark'), 'platform mark')
    await click('+ 添加渠道')
    const tiles = [...modal().querySelectorAll('[role=radio]')].map((b) => b.textContent)
    assert.equal(tiles.length, 1, 'built-in catalog has Lark only'); assert.match(tiles[0], /飞书/)
    await clickEl([...modal().querySelectorAll('.n2s-kindcard')].find((b) => b.textContent.includes('应用机器人')))
    assert.match(modal().textContent, /App Secret/); assert.match(modal().textContent, /配置步骤/)
    await setValue(field('appId'), 'cli_1')
    await click('选择群聊', modal()); assert.match(modal().textContent, /运营群/)
    assert.ok(rpcCalls.some((c) => c.method === 'listChannelChats' && c.payload.appId === 'cli_1'), 'legacy chat RPC')
    await click('取消', modal())
    assert.ok(!modal(), 'dialog closed')
  })

  await test('渠道 (old host): edit existing Lark app channel, secrets kept, flat save payload', async () => {
    await menu('「应用机器人」的操作', '编辑')
    assert.equal(field('appId').value, 'cli_1')
    assert.equal(field('appSecret').value, '')
    assert.equal(field('appSecret').placeholder, '已设置，留空不修改')
    await click('选择群聊', modal()); await click('运营群', modal())
    assert.equal(field('receiveId').value, 'oc_9')
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存'), 40)
    const save = rpcCalls.filter((c) => c.method === 'saveChannel').pop().payload
    assert.equal(save.id, 'ch2'); assert.equal(save.type, 'lark_app'); assert.equal(save.appId, 'cli_1'); assert.equal(save.receiveId, 'oc_9')
    assert.ok(!('appSecret' in save), 'unchanged secret not sent'); assert.ok(!('config' in save), 'flat payload for old host')
    assert.ok(!modal(), 'dialog closed after save')
  })

  await test('历史: row expands; single entry can be deleted', async () => {
    await openTab('历史')
    await clickEl(document.querySelector('.n2s-hist-main'))
    assert.match(text(), /打开会话|重新执行/)
    const before = document.querySelectorAll('.n2s-hist-row').length
    await clickEl(document.querySelector('.n2s-rowdel'), 20)
    await clickEl([...document.querySelectorAll('.n2s-modal button')].find((b) => b.textContent === '删除'), 40)
    assert.equal(rpcCalls.filter((c) => c.method === 'deleteHistory').pop().payload.id, 'h1')
    assert.equal(document.querySelectorAll('.n2s-hist-row').length, before - 1)
  })

  await test('数据源: policy editor, PG/ES forms, SSH & privacy sections, test connection', async () => {
    await openAdmin('数据源')
    assert.match(text(), /访问控制/)
    await menu('更多操作', '访问控制'); assert.match(text(), /可访问 1 \/ 2 张表/)
    await click('取消'); await click('+ 新建数据源')
    await click('PostgreSQL'); assert.match(text(), /Schema/)
    await click('Elasticsearch'); assert.match(text(), /API Key/)
    const det = document.querySelectorAll('details')
    assert.ok(det.length >= 2)
    await act(async () => { det[0].open = true; det[0].querySelector('input[type=checkbox]').click() }); await settle(20)
    assert.match(text(), /私钥|SSH 主机/)
    await act(async () => { det[1].querySelector('input[type=checkbox]').click() }); await settle(20)
    assert.match(text(), /统计摘要/)
    await click('测试连接'); assert.match(text(), /经 SSH 隧道/)
    await click('取消')
  })

  await test('设置: groups, unsaved bar, save, restore defaults, storage', async () => {
    await openAdmin('设置')
    const groups = [...document.querySelectorAll('.n2s-setgroups button')].map((b) => b.textContent.trim())
    assert.deepEqual(groups, ['模型可见数据', '查询', '自动任务', '渠道与机器人', '数据与存储', '关于'])
    assert.ok(!document.querySelector('.n2s-savebar'), 'no save bar initially')
    await click('查询')
    await setValue(document.getElementById('set-maxRows'), '900')
    assert.ok(document.querySelector('.n2s-savebar'), 'save bar appears')
    assert.match(document.querySelector('.n2s-savebar').textContent, /1 项修改未保存/)
    await click('放弃修改')
    assert.ok(!document.querySelector('.n2s-savebar'), 'discard hides bar')
    await setValue(document.getElementById('set-maxRows'), '900')
    await clickEl([...document.querySelectorAll('.n2s-savebar button')].find((b) => b.textContent.includes('保存')), 40)
    const saveCall = rpcCalls.filter((c) => c.method === 'saveSettings').pop()
    assert.deepEqual(saveCall.payload, { maxRows: 900 }, 'only changed keys are saved')
    assert.ok(!document.querySelector('.n2s-savebar'), 'bar hidden after save')
    assert.match(document.body.textContent, /已保存/)
    await click('恢复默认')
    const ok = [...document.querySelectorAll('.n2s-modal button')].find((b) => b.textContent === '确定')
    assert.ok(ok, 'confirm dialog shown (no window.confirm)')
    await clickEl(ok, 40)
    assert.ok(rpcCalls.some((c) => c.method === 'resetSettings'))
    await click('数据与存储'); assert.match(text(), /查询历史 \/ 审计/); assert.match(text(), /导出全部配置/)
    await click('关于'); assert.match(text(), /0\.9\.0/)
  })

  await test('看板: widths, keyboard reorder, refresh summary', async () => {
    await openTab('看板')
    const ws = document.querySelectorAll('.n2s-widget')
    assert.ok(ws[0].classList.contains('w-half') && ws[1].classList.contains('w-third'), 'width classes')
    assert.match(text(), /最后刷新/)
    const handle = document.querySelector('.n2s-draghandle')
    await act(async () => { handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) }); await settle(40)
    const call = rpcCalls.filter((c) => c.method === 'reorderWidgets').pop()
    assert.deepEqual(call?.payload?.ids, ['w2', 'w1'])
    await menu('更多操作', '宽度：整行')
    assert.equal(rpcCalls.filter((c) => c.method === 'updateWidget').pop()?.payload?.width, 'full')
  })

  await test('看板: mixed data sources are labelled, can be scoped to the current one; reorder keeps hidden widgets', async () => {
    const saved = responses.listDashboard
    responses.listDashboard = [
      { id: 'w1', title: 'A1', sql: 'select 1', datasourceId: 'd1', chart: { type: 'table' }, width: 'half' },
      { id: 'w9', title: 'ES 图', sql: 'select 9', datasourceId: 'dx', chart: { type: 'table' }, width: 'half' },
      { id: 'w2', title: 'A2', sql: 'select 2', datasourceId: 'd1', chart: { type: 'table' }, width: 'half' },
    ]
    try { window.localStorage.removeItem('nl2sql:dashScope') } catch {}
    await openTab('问答'); await openTab('看板')
    const badges = [...document.querySelectorAll('.n2s-srcbadge')].map((b) => b.textContent)
    assert.deepEqual(badges, ['本地', '数据源已删除', '本地'], 'each widget shows its source; unknown source flagged')
    assert.match(text(), /包含数据源：本地、数据源已删除/)
    await click('仅 本地')
    assert.equal(document.querySelectorAll('.n2s-widget').length, 2)
    assert.equal(window.localStorage.getItem('nl2sql:dashScope'), 'current')
    const handle = document.querySelector('.n2s-draghandle')
    await act(async () => { handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) }); await settle(40)
    assert.deepEqual(rpcCalls.filter((c) => c.method === 'reorderWidgets').pop().payload.ids, ['w2', 'w9', 'w1'], 'hidden w9 keeps its slot')
    await click('全部数据源')
    assert.equal(document.querySelectorAll('.n2s-widget').length, 3)
    responses.listDashboard = saved
    try { window.localStorage.removeItem('nl2sql:dashScope') } catch {}
    await openTab('问答')
  })

  await test('tool views: nl2sql_query and nl2sql_overview results', async () => {
    const tv = document.body.appendChild(document.createElement('div'))
    await act(async () => { createRoot(tv).render(React.createElement(regs['tool.call.toolview:nl2sql_query'], { phase: 'result', block: { isError: false, meta: { resultId: 'r1' }, call: { argsRaw: '{"title":"x"}' } } })) }); await settle()
    assert.match(tv.textContent, /^T2 行·3 ms·本地/)
    assert.match(tv.textContent, /指标卡/)
    const ov = document.body.appendChild(document.createElement('div'))
    await act(async () => { createRoot(ov).render(React.createElement(regs['tool.call.toolview:nl2sql_overview'], { phase: 'result', block: { isError: false, meta: { overview: true, table: 'orders', results: [{ resultId: 'r1', title: 'T' }, { title: 'bad', sql: 'x', error: 'boom' }] }, call: { argsRaw: '{"table":"orders"}' } } })) }); await settle()
    assert.match(ov.textContent, /^orders · 自动概览2 个图表/)
    assert.match(ov.textContent, /boom/)
  })

  await test('assistant reply action: markdown dialog, preview, snippet, send', async () => {
    const ra = document.body.appendChild(document.createElement('div'))
    await act(async () => { createRoot(ra).render(React.createElement(regs['conversation.chat.assistant-actions:nl2sql-send'], { messageId: 'm1', sessionId: 's1' })) }); await settle(40)
    await clickEl(ra.querySelector('.n2s-reply-send'), 60)
    const modal = document.querySelector('.n2s-modal')
    assert.ok(modal)
    assert.match(modal.querySelector('textarea')?.value ?? '', /昨日概况/)
    assert.equal(modal.querySelector('input')?.value, '昨日概况')
    await clickEl([...modal.querySelectorAll('button')].find((b) => b.textContent === '预览'), 20)
    assert.ok(modal.querySelector('.n2s-md strong'))
    assert.ok(modal.querySelector('.n2s-md table'))
    assert.equal(modal.querySelector('.n2s-md span[style]')?.style?.color, 'rgb(52, 199, 36)')
    await clickEl([...modal.querySelectorAll('button')].find((b) => b.textContent === '编辑'), 20)
    await clickEl([...modal.querySelectorAll('button')].find((b) => b.textContent === '加粗'), 20)
    assert.match(modal.querySelector('textarea').value, /\*\*加粗\*\*/)
    assert.match(modal.textContent, /原生图表/); assert.match(modal.textContent, /跟随渠道/)
    await clickEl([...modal.querySelectorAll('button')].find((b) => b.textContent === '发送'), 40)
    assert.match(document.body.textContent, /已发送到/)
  })

  // ------------------------------------------------ new host (docs/CHANNELS.md)
  // English differs from Chinese on purpose: the UI must pick the active locale (zh here).
  const tx = (zh, en) => ({ zh, en: en ?? `EN:${zh}` })
  const newCatalog = [
    { platform: 'lark', name: tx('飞书', 'Lark'), kinds: [
      { id: 'lark_webhook', label: tx('群机器人（Webhook）'), description: tx('群自定义机器人'), fields: [{ key: 'webhookUrl', label: tx('Webhook 地址'), type: 'secret', secret: true, required: true }], capabilities: { push: true, charts: 'native', buttons: false, bot: false, listTargets: false }, setupSteps: tx(['添加自定义机器人']) },
      { id: 'lark_app', label: tx('应用机器人'), description: tx('企业自建应用'), fields: [{ key: 'appId', label: tx('App ID'), type: 'text', required: true }, { key: 'appSecret', label: tx('App Secret'), type: 'secret', secret: true, required: true }, { key: 'receiveId', label: tx('接收者'), type: 'text', required: true }], capabilities: { push: true, charts: 'native', buttons: true, bot: true, listTargets: true }, setupSteps: tx(['创建应用']) },
    ] },
    { platform: 'telegram', name: tx('Telegram'), kinds: [
      { id: 'telegram_bot', label: tx('Telegram 机器人'), description: tx('通过 @BotFather 创建的机器人'), fields: [
        { key: 'botToken', label: tx('Bot Token'), type: 'secret', secret: true, required: true, help: tx('从 @BotFather 获取') },
        { key: 'chatId', label: tx('Chat ID'), type: 'text', required: true, pattern: '^-?\\d+$' },
        { key: 'parseMode', label: tx('格式'), type: 'select', options: [{ value: 'html', label: tx('HTML') }, { value: 'plain', label: tx('纯文本') }] },
        { key: 'threadId', label: tx('话题 ID'), type: 'text', showIf: { key: 'parseMode', equals: 'html' } },
      ], capabilities: { push: true, charts: 'image', buttons: true, bot: true, listTargets: true }, setupSteps: tx(['找 @BotFather 创建机器人', '把机器人拉进群']) },
    ] },
    { platform: 'dingtalk', name: tx('钉钉', 'DingTalk'), kinds: [
      { id: 'dingtalk_webhook', label: tx('自定义机器人'), description: tx('群 Webhook'), fields: [{ key: 'webhookUrl', label: tx('Webhook 地址'), type: 'secret', secret: true, required: true }], capabilities: { push: true, charts: 'none', buttons: false, bot: false, listTargets: false }, setupSteps: tx([]) },
    ] },
  ]
  const newChannels = [
    { id: 'ch1', name: '数据群', type: 'lark_webhook', platform: 'lark', isDefault: true, chartMode: 'native', config: {}, secretsSet: { webhookUrl: true }, capabilities: newCatalog[0].kinds[0].capabilities, lastSentAt: Date.now() },
    { id: 'ch2', name: '应用机器人', type: 'lark_app', platform: 'lark', config: { appId: 'cli_1', receiveId: 'oc_1' }, secretsSet: { appSecret: true }, capabilities: newCatalog[0].kinds[1].capabilities, bot: { enabled: true, allowP2p: true, sessionScope: 'chat', status: { state: 'connected' } } },
    { id: 'ch4', name: '钉钉群', type: 'dingtalk_webhook', platform: 'dingtalk', config: {}, secretsSet: { webhookUrl: true }, capabilities: newCatalog[2].kinds[0].capabilities, lastError: '签名不匹配' },
    { id: 'ch5', name: 'TG 运营', type: 'telegram_bot', platform: 'telegram', config: { chatId: '-1001' }, secretsSet: { botToken: true }, capabilities: newCatalog[1].kinds[0].capabilities, bot: { enabled: false, allowP2p: false, sessionScope: 'user', status: { state: 'idle' } } },
  ]
  const enterNewHost = async () => {
    hostMode = 'new'
    Object.assign(responses, {
      channelCatalog: newCatalog, listChannels: newChannels,
      botStatus: [{ channelId: 'ch2', channelName: '应用机器人', platform: 'lark', enabled: true, status: { state: 'connected' }, info: { name: 'DataBot' }, conversations: [{ key: 'ch2:oc_1', chatName: '运营群', lastQuestion: '昨天 GMV', lastAt: Date.now() }] }, { channelId: 'ch5', channelName: 'TG 运营', platform: 'telegram', enabled: false, status: { state: 'idle' }, conversations: [] }],
      saveBot: { channelId: 'ch5', enabled: true, status: { state: 'connecting' } },
      listChannelTargets: [{ id: '-100777', name: 'Ops group', type: 'group' }],
      testChannel: { ok: true, detail: '@data_bot' },
      saveChannel: { id: 'ch9' },
      getSettings: { ...responses.getSettings, botDefaultRole: 'viewer', larkDefaultRole: 'viewer' },
      listUsers: [{ id: 'u1', kind: 'person', name: '张三', role: 'analyst', datasourceIds: null, identities: [{ platform: 'lark', id: 'ou_1', email: 'z@x.com' }, { platform: 'telegram', id: '42' }] }, { id: 'u2', kind: 'person', name: '李四', role: 'viewer', datasourceIds: [], datasourceNames: [], larkOpenId: 'ou_legacy' }],
    })
    await openAdmin('数据源')
  }

  await test('渠道 (new host): grouped by platform, capability chips, bot status, tables-only kind', async () => {
    await sleep(1300) // let the earlier send dialog auto-close
    await enterNewHost()
    await openAdmin('渠道')
    const groups = [...document.querySelectorAll('.n2s-pgroup-head')].map((g) => g.textContent.replace(/\d+$/, ''))
    assert.deepEqual(groups, ['飞飞书', 'TGTelegram', '钉钉钉'])
    const tg = document.querySelector('[data-channel="ch5"]')
    assert.match(tg.textContent, /-1001/); assert.match(tg.textContent, /图片图表/); assert.match(tg.textContent, /按钮/); assert.match(tg.textContent, /机器人 · 未启用/)
    assert.match(document.querySelector('[data-channel="ch2"]').textContent, /机器人 · 已连接/)
    const dd = document.querySelector('[data-channel="ch4"]')
    assert.match(dd.textContent, /仅表格/); assert.match(dd.textContent, /签名不匹配/); assert.match(dd.textContent, /Webhook 地址已加密保存/)
    assert.doesNotMatch(document.querySelector('.n2s-pgroups').textContent, /botToken|appSecret/)
    // Catalog text follows the active locale (LocaleSnapshot.active = 'zh'), never the English variant.
    assert.doesNotMatch(document.querySelector('.n2s-pgroups').textContent, /EN:/)
    assert.match(document.querySelector('.n2s-pgroups').textContent, /群机器人（Webhook）|应用机器人/)
  })

  await test('渠道 (new host): picker → Telegram form from fields → validation → save {type, config, secrets, bot}', async () => {
    await click('+ 添加渠道')
    const radios = [...modal().querySelectorAll('[role=radio]')]
    assert.equal(radios.length, 3)
    // keyboard: ArrowRight moves to and selects Telegram
    radios[0].focus()
    await act(async () => { radios[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) }); await settle()
    assert.equal(document.activeElement.textContent.includes('Telegram'), true, 'focus moved')
    assert.equal(modal().querySelector('[role=radio][aria-checked=true]').textContent.includes('Telegram'), true, 'selected')
    const card = [...modal().querySelectorAll('.n2s-kindcard')].find((b) => b.textContent.includes('Telegram 机器人'))
    assert.match(card.textContent, /无需公网地址/); assert.match(card.textContent, /机器人/)
    await clickEl(card)
    assert.ok(field('botToken') && field('chatId') && field('parseMode'), 'fields rendered from schema')
    assert.equal(field('parseMode').value, 'html', 'select defaults to its first option')
    assert.ok(field('threadId'), 'showIf shows threadId for html')
    assert.equal(document.querySelector('label[for="n2s-chf-botToken"]').textContent.includes('Bot Token'), true, 'labelled')
    assert.equal(field('botToken').type, 'password')
    const seg = [...modal().querySelectorAll('.n2s-seg button')].map((b) => b.textContent)
    assert.deepEqual(seg, ['图片', '表格'], 'chart modes limited by capabilities.charts=image')
    // required validation
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存'))
    assert.equal(field('name').getAttribute('aria-invalid'), 'true'); assert.equal(field('botToken').getAttribute('aria-invalid'), 'true')
    assert.ok(!rpcCalls.some((c) => c.method === 'saveChannel' && c.payload.type === 'telegram_bot'), 'not saved while invalid')
    await setValue(field('chatId'), 'abc')
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存'))
    assert.match(modal().textContent, /格式不正确/)
    await act(async () => { const sel = field('parseMode'); sel.value = 'plain'; sel.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle()
    assert.ok(!field('threadId'), 'showIf hides threadId')
    await setValue(field('name'), 'TG 数据')
    await setValue(field('botToken'), '123:abc')
    // target picker with unsaved credentials
    await click('选择群聊', modal())
    const lt = rpcCalls.filter((c) => c.method === 'listChannelTargets').pop().payload
    assert.deepEqual(lt, { type: 'telegram_bot', config: { chatId: 'abc', parseMode: 'plain' }, secrets: { botToken: '123:abc' } })
    await click('Ops group', modal())
    assert.equal(field('chatId').value, '-100777')
    // bot section
    await clickEl([...modal().querySelectorAll('input[role=switch]')].find((i) => i.closest('.n2s-botbox')))
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存并发送测试'), 40)
    const save = rpcCalls.filter((c) => c.method === 'saveChannel').pop().payload
    assert.deepEqual(save, { name: 'TG 数据', type: 'telegram_bot', description: '', isDefault: false, chartMode: 'image', config: { chatId: '-100777', parseMode: 'plain' }, secrets: { botToken: '123:abc' }, bot: { enabled: true, allowP2p: true, sessionScope: 'chat' } })
    assert.equal(rpcCalls.filter((c) => c.method === 'testChannel').pop().payload.id, 'ch9')
    assert.ok(!modal(), 'closed'); assert.match(document.body.textContent, /测试成功 · @data_bot/)
  })

  await test('渠道 (new host): server ChannelError is shown on the field; Escape closes', async () => {
    const saveBefore = responses.saveChannel
    responses.saveChannel = undefined
    const origFetch = global.fetch
    global.fetch = async (url, init) => { const b = JSON.parse(init.body); if (b.method === 'saveChannel') { rpcCalls.push(b); return { status: 200, json: async () => ({ ok: false, error: { code: 'channel/auth', message: 'Bot Token 无效（401）' } }) } } return origFetch(url, init) }
    await menu('「TG 运营」的操作', '编辑')
    assert.equal(field('botToken').placeholder, '已设置，留空不修改')
    await setValue(field('botToken'), 'bad')
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存'), 40)
    assert.equal(field('botToken').getAttribute('aria-invalid'), 'true')
    assert.match(modal().textContent, /Bot Token 无效/)
    global.fetch = origFetch; responses.saveChannel = saveBefore
    await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }); await settle()
    assert.ok(!modal(), 'Escape closes the dialog')
  })

  await test('渠道 (new host): edit without changes sends no secret; DingTalk webhook tables only', async () => {
    await menu('「钉钉群」的操作', '编辑')
    assert.deepEqual([...modal().querySelectorAll('.n2s-seg button')].map((b) => b.textContent), ['表格'])
    assert.match(modal().textContent, /该渠道只能发送表格/)
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '测试连接'), 40)
    assert.equal(rpcCalls.filter((c) => c.method === 'testChannel').pop().payload.id, 'ch4')
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '保存'), 40)
    const save = rpcCalls.filter((c) => c.method === 'saveChannel').pop().payload
    assert.deepEqual(save.secrets, {}); assert.equal(save.chartMode, 'table'); assert.equal(save.id, 'ch4')
  })

  await test('send dialog (new host): platform mark and chart modes follow the channel', async () => {
    const sd = document.body.appendChild(document.createElement('div'))
    await act(async () => { createRoot(sd).render(React.createElement(regs['conversation.chat.assistant-actions:nl2sql-send'], { messageId: 'm2', sessionId: 's1' })) }); await settle(40)
    await clickEl(sd.querySelector('.n2s-reply-send'), 60)
    const sel = document.getElementById('n2s-send-channel')
    assert.ok(sel.closest('.n2s-chpick').querySelector('.n2s-pmark'), 'platform mark')
    assert.match([...sel.options].map((o) => o.textContent).join('|'), /钉钉群 · 钉钉 · 自定义机器人/)
    await act(async () => { sel.value = 'ch4'; sel.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle()
    const segs = () => [...modal().querySelectorAll('.n2s-seg[aria-label="图表形式"] button')].map((b) => b.textContent)
    assert.deepEqual(segs(), ['跟随渠道', '表格'])
    await act(async () => { sel.value = 'ch2'; sel.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle()
    assert.deepEqual(segs(), ['跟随渠道', '原生图表', '图片', '表格'], 'Lark app bot: native charts or PNG')
    await clickEl([...modal().querySelectorAll('button')].find((b) => b.textContent === '取消'))
  })

  await test('成员与权限 (new host): bot overview toggles call saveBot; links to bot settings', async () => {
    await openAdmin('成员与权限')
    const rows = [...document.querySelectorAll('[data-bot]')].map((r) => r.getAttribute('data-bot'))
    assert.deepEqual(rows, ['ch2', 'ch5'])
    assert.match(document.querySelector('[data-bot="ch2"]').textContent, /DataBot/); assert.match(document.querySelector('[data-bot="ch2"]').textContent, /已连接/)
    await clickEl(document.querySelector('input[aria-label="启用「TG 运营」的机器人"]'), 40)
    assert.deepEqual(rpcCalls.filter((c) => c.method === 'saveBot').pop().payload, { channelId: 'ch5', enabled: true })
    await click('最近对话 1', document.querySelector('[data-bot="ch2"]'))
    assert.match(text(), /昨天 GMV/)
    assert.match(text(), /未登记的用户： 允许，只读/)
    await click('机器人设置', document.querySelector('[data-bot="ch2"]'))
    assert.ok(modal()?.querySelector('.n2s-botbox.focus'), 'channel editor opened at bot section')
    await click('取消', modal())
  })

  await test('成员与权限 (new host): identity chips; editor produces identities in saveUser', async () => {
    await openAdmin('成员与权限')
    const chips = [...document.querySelectorAll('.n2s-idchip')].map((c) => c.textContent)
    assert.deepEqual(chips, ['飞ou_1', 'TG42', '飞ou_legacy'], 'new identities and legacy larkOpenId')
    await click('+ 添加成员')
    const form = document.querySelector('.n2s-card')
    await setValue(form.querySelector('input'), '王五')
    const platformSel = form.querySelector('select[aria-label="身份 1 的平台"]')
    assert.deepEqual([...platformSel.options].map((o) => o.value), ['lark', 'telegram'], 'only bot-capable platforms')
    await act(async () => { platformSel.value = 'telegram'; platformSel.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle()
    assert.match(form.textContent, /@userinfobot/, 'per-platform help')
    await setValue(form.querySelector('input[aria-label="身份 1 的 ID"]'), ' 777 ')
    await click('+ 添加身份', form)
    const p2 = form.querySelector('select[aria-label="身份 2 的平台"]')
    await act(async () => { p2.value = 'lark'; p2.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle()
    await setValue(form.querySelector('input[aria-label="身份 2 的 ID"]'), 'ou_5')
    await setValue(form.querySelector('input[aria-label="身份 2 的邮箱（可选）"]'), 'w@x.com')
    await click('保存', form); await settle(30)
    const su = rpcCalls.filter((c) => c.method === 'saveUser').pop().payload
    assert.deepEqual(su.identities, [{ platform: 'telegram', id: '777' }, { platform: 'lark', id: 'ou_5', email: 'w@x.com' }])
    assert.equal(su.larkOpenId, 'ou_5'); assert.equal(su.email, 'w@x.com'); assert.equal(su.kind, 'person'); assert.equal(su.role, 'analyst')
  })

  await test('设置 (new host): 渠道与机器人 group uses botDefaultRole, default channel, bot summary', async () => {
    await openAdmin('设置')
    await click('渠道与机器人')
    assert.equal(document.getElementById('set-defchannel').value, 'ch1')
    assert.match(text(), /飞书1 \/ 1 个已启用/); assert.match(text(), /Telegram0 \/ 1 个已启用/)
    const radio = [...document.querySelectorAll('.n2s-radio')].find((r) => r.textContent.includes('允许，分析师')).querySelector('input')
    await clickEl(radio)
    await clickEl([...document.querySelectorAll('.n2s-savebar button')].find((b) => b.textContent.includes('保存')), 40)
    assert.deepEqual(rpcCalls.filter((c) => c.method === 'saveSettings').pop().payload, { botDefaultRole: 'analyst' })
    const sel = document.getElementById('set-defchannel')
    await act(async () => { sel.value = 'ch5'; sel.dispatchEvent(new window.Event('change', { bubbles: true })) }); await settle(40)
    const save = rpcCalls.filter((c) => c.method === 'saveChannel').pop().payload
    assert.equal(save.id, 'ch5'); assert.equal(save.isDefault, true); assert.deepEqual(save.secrets, {}); assert.deepEqual(save.config, { chatId: '-1001' })
  })

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })

  summary('client dom')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
