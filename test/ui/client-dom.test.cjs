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
    askSuggestions: { examples: ['最近 30 天每天的日订单', '订单按状态的分布'], recent: [{ at: Date.now() - 120000, question: '昨天的订单量', sessionId: 's9', status: 'ok' }], tableCount: 2 },
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
  global.fetch = async (url, init) => { const { method, payload } = JSON.parse(init.body); rpcCalls.push({ method, payload }); return { status: 200, json: async () => ({ ok: true, value: responses[method] ?? null }) } }

  // ------------------------------------------------------------ load the client plugin
  let plugin
  window.__ModuleLoader__ = { load(r) { plugin = r.factory(Object.assign((n) => ({ react: React, 'react-dom': ReactDOM })[n], { async: () => new Promise(() => {}) })) } }
  require(path.join(PLUGIN_DIR, 'lib', 'client.js'))
  const regs = {}; let dict
  const ctx = {
    effect(fn) { return fn() },
    locale: { register(ns, d) { dict = d.zh; return () => {} }, bind() { return (k) => dict[k] ?? `!!${k}` }, subscribe() { return () => {} }, getSnapshot() { return 'zh' } },
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
    assert.deepEqual(nav, ['数据源', '成员与权限', '告警与报告', '推送渠道', '设置'])
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

  await test('问答: explain plan, execute, feedback form, send to Lark', async () => {
    await openTab('问答')
    await click('直接写 SQL')
    await setValue(document.querySelectorAll('textarea')[1], 'select 1')
    await click('执行计划'); assert.match(text(), /EXPLAIN/)
    await click('执行'); assert.ok(document.querySelector('.n2s-result button[aria-label="更多操作"]'), 'result toolbar')
    await clickEl(document.querySelector('button[aria-label="结果有问题"]')); assert.match(text(), /哪里不对/)
    await click('用错了表'); await click('提交'); assert.match(text(), /问题清单/)
    assert.ok(rpcCalls.some((c) => c.method === 'submitFeedback'))
    await clickEl(document.querySelector('button[aria-label="发送到飞书"]')); assert.match(document.body.textContent, /发送到飞书/)
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

  await test('推送: channel list, app-bot form, chat picker', async () => {
    await openAdmin('推送渠道')
    assert.match(text(), /数据群/); assert.match(text(), /应用机器人/); assert.match(text(), /签名校验失败/)
    await click('+ 添加渠道'); await click('应用机器人'); assert.match(text(), /App Secret/)
    await setValue([...document.querySelectorAll('input')].find((i) => i.placeholder === 'cli_xxx'), 'cli_1')
    await click('选择群聊'); assert.match(text(), /运营群/)
    await click('取消')
  })

  await test('历史: row expands', async () => {
    await openTab('历史')
    await clickEl(document.querySelector('.n2s-hist-main'))
    assert.match(text(), /打开会话|重新执行/)
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
    assert.deepEqual(groups, ['模型可见数据', '查询', '自动任务', '飞书', '数据与存储', '关于'])
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

  await test('no React / window errors', () => {
    assert.deepEqual(errors.filter((e) => !/act\(|not wrapped/.test(e)), [])
  })

  summary('client dom')
  setTimeout(() => process.exit(process.exitCode ?? 0), 50)
})().catch((e) => { console.log('FAIL (harness)', e.stack); process.exit(1) })
