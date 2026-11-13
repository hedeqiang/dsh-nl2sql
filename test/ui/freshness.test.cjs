// Data freshness / health UI in jsdom against canned RPCs: result warning bar, schema panel,
// admin section 'health' (freshness table, quality results, run now, settings) and the
// nl2sql_freshness tool view. Bootstrap copied from client-dom.test.cjs.
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

  const now = Date.now()
  const yest = new Date(now - 86400000); yest.setHours(17, 55, 0, 0)
  const ds = { id: 'd1', name: '本地', database: 'testdb', host: 'h', port: 3306, user: 'u', current: true, schemaAnalyzedAt: 1, hasPassword: true }
  const schema = { analyzedAt: 1, version: '8.0', tables: [{ name: 'withdrawals', type: 'TABLE', role: 'fact', rows: 10, comment: '', columns: [{ name: 'id', dataType: 'bigint', columnType: 'bigint', key: 'PRI', roles: ['id'], comment: '' }, { name: 'created_at', dataType: 'datetime', columnType: 'datetime', key: '', roles: ['time'], comment: '' }], indexes: [] }, { name: 'orders', type: 'TABLE', role: 'fact', rows: 5, comment: '', columns: [{ name: 'id', dataType: 'bigint', columnType: 'bigint', key: 'PRI', roles: ['id'], comment: '' }], indexes: [] }], relations: [] }
  const fresh = {
    datasourceId: 'd1', datasourceName: '本地', analyzed: true, checkedAt: now, staleCount: 1,
    tables: [
      { table: 'withdrawals', column: 'created_at', latestAt: yest.getTime(), latestLocal: 'x', checkedAt: now, lagMinutes: Math.round((now - yest.getTime()) / 60000), thresholdHours: 2, status: 'stale', stale: true },
      { table: 'orders', column: 'created_at', latestAt: now - 600000, checkedAt: now, lagMinutes: 10, thresholdHours: 24, status: 'ok', stale: false },
    ],
  }
  const qualityRun = { id: 'qr1', at: now, datasourceId: 'd1', score: 72, summary: { zh: '健康分 72：2 张表已评分，1 张低于 80 分；问题：空值 1、负值 1', en: 'Health score 72' }, tables: [
    { table: 'withdrawals', score: 58, rowCount: 100, issues: [{ kind: 'nulls', deduct: 2, zh: '字段 user_id 空值率 40.0%', en: 'x' }, { kind: 'negative', deduct: 10, zh: '金额类字段 amount 有 1 个负值', en: 'y' }, { kind: 'future', deduct: 10, zh: '时间字段 created_at 有 1 行晚于当前时间', en: 'z' }] },
    { table: 'orders', score: 100, rowCount: 5, issues: [] },
  ] }
  const settings = { freshness: { enabled: true, intervalMin: 30, staleHours: 24, overrides: { d1: { withdrawals: 2 } }, channelId: null }, quality: { enabled: false, time: '06:30', channelId: null, dropPoints: 10, maxTableRows: 5000000, maxTables: 60 } }
  const result = { resultId: 'r1', datasourceId: 'd1', datasourceName: '本地', title: 'T', sql: 'SELECT COUNT(*) AS n FROM withdrawals', rowCount: 1, elapsedMs: 3, truncated: false, columns: [{ name: 'n', kind: 'number' }], rows: [[5]], chart: { type: 'kpi', y: ['n'] } }
  const responses = {
    listDatasources: [ds], analyzeSchema: schema, runQuery: result, getResult: result, listDashboard: [], listDashboards: { current: 'db-default', dashboards: [] },
    getKnowledge: { glossary: [], metrics: [], notes: {}, examples: [] }, listHistory: [], listChannels: [], listSchemaChanges: [],
    onboardingStatus: { hasDatasource: true, analyzed: true, hasKnowledge: true, askedQuestion: true, hasChannel: true, dismissed: true },
    askSuggestions: { examples: [], total: 0, pageSize: 2, offset: 0, nextOffset: 0, recent: [], hasMoreRecent: false, tableCount: 2 },
    freshnessFor: (p) => (p.sql ? { ...fresh, referenced: ['withdrawals'], tables: fresh.tables.filter(x => p.sql.includes(x.table)), staleCount: p.sql.includes('withdrawals') ? 1 : 0 } : fresh),
    freshnessEvents: [{ id: 'fe1', at: now, datasourceId: 'd1', table: 'withdrawals', kind: 'stale', lagMinutes: 900, pushed: true }],
    qualityResults: { datasourceId: 'd1', latest: qualityRun, history: [{ id: 'qr1', score: 72 }, { id: 'qr0', score: 80 }] },
    qualityScan: qualityRun, healthSettings: settings, saveHealthSettings: (p) => ({ freshness: { ...settings.freshness, ...(p.freshness ?? {}) }, quality: { ...settings.quality, ...(p.quality ?? {}) } }),
    healthStatus: { freshness: { enabled: true, lastRunAt: now, nextAt: now + 1800000 }, quality: { enabled: false, lastRunAt: null, time: '06:30' } },
    schedulerStatus: { running: true, lastRan: [], nextAlerts: [] }, listAlerts: [], listUsers: [], usageByActor: [],
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
  const settle = (ms = 40) => act(() => sleep(ms))
  const clickEl = async (el, ms = 40) => { assert.ok(el, 'element exists'); await act(async () => { el.click() }); await settle(ms) }
  const btn = (label) => [...rootEl.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label))
  const missingKeys = () => text().match(/!![\w.]+/g) ?? []
  const root = createRoot(rootEl)

  await test('locale: fq.* keys identical in zh and en', () => {
    const z = Object.keys(dict).filter(k => k.startsWith('fq.')).sort()
    const e = Object.keys(enDict).filter(k => k.startsWith('fq.')).sort()
    assert.ok(z.length > 40)
    assert.deepEqual(z, e)
  })

  await act(async () => { root.render(React.createElement(regs['main:nl2sql'])) }); await settle(80)

  await test('schema tab: freshness panel with green/red dots, lag, refresh', async () => {
    await clickEl([...document.querySelectorAll('.n2s-tabs [role=tab]')].find(b => b.textContent.trim() === '表结构'), 80)
    const panel = rootEl.querySelector('.n2s-fq-panel')
    assert.ok(panel, 'panel rendered')
    assert.match(panel.textContent, /1 张表数据滞后/)
    assert.ok(panel.querySelector('.n2s-fq-dot.err') && panel.querySelector('.n2s-fq-dot.ok'), 'red + green dots')
    assert.match(panel.textContent, /withdrawals/)
    assert.match(panel.textContent, /10 分钟/)
    rpcCalls.length = 0
    await clickEl([...panel.querySelectorAll('button')].find(b => b.textContent.includes('刷新')), 60)
    assert.ok(rpcCalls.some(c => c.method === 'freshnessFor' && c.payload.refresh === true))
    assert.deepEqual(missingKeys(), [])
  })

  await test('result panel: warning bar for stale referenced table, none for fresh ones', async () => {
    const C = regs['tool.call.toolview:nl2sql_query']
    assert.ok(C)
    const holder = document.createElement('div'); document.body.appendChild(holder)
    const r2 = createRoot(holder)
    const block = { meta: { ...result }, call: { argsRaw: '{}' }, content: [] }
    await act(async () => { r2.render(React.createElement(C, { phase: 'result', block, callId: 'c1' })) }); await settle(100)
    const bar = holder.querySelector('.n2s-fq-bar')
    assert.ok(bar, holder.innerHTML.slice(0, 300))
    assert.match(bar.textContent, /withdrawals 最新数据停在 昨天 17:55/)
    assert.ok(rpcCalls.some(c => c.method === 'freshnessFor' && c.payload.sql === result.sql))
    const block2 = { meta: { ...result, resultId: 'r2', sql: 'SELECT COUNT(*) FROM orders' }, call: { argsRaw: '{}' }, content: [] }
    responses.getResult = { ...result, resultId: 'r2', sql: 'SELECT COUNT(*) FROM orders' }
    await act(async () => { r2.render(React.createElement(C, { phase: 'result', block: block2, callId: 'c2' })) }); await settle(100)
    assert.equal(holder.querySelector('.n2s-fq-bar'), null)
    await act(async () => { r2.unmount() }); holder.remove()
    responses.getResult = result
  })

  await test('panels render nothing when freshness is off or hidden (server answers disabled); settings show the toggle', async () => {
    const saved = responses.freshnessFor
    responses.freshnessFor = () => ({ disabled: true, tables: [] })
    try {
    assert.ok(rpcCalls.some(c => c.method === 'freshnessFor' && c.payload.panel === true), 'panels ask with panel: true')
    const C = regs['tool.call.toolview:nl2sql_query']
    const holder = document.createElement('div'); document.body.appendChild(holder)
    const r3 = createRoot(holder)
    responses.getResult = { ...result, resultId: 'r9', sql: 'SELECT COUNT(*) AS n FROM withdrawals WHERE 1=1' }
    await act(async () => { r3.render(React.createElement(C, { phase: 'result', block: { meta: { ...result, resultId: 'r9', sql: 'SELECT COUNT(*) AS n FROM withdrawals WHERE 1=1' }, call: { argsRaw: '{}' }, content: [] }, callId: 'c9' })) }); await settle(100)
    assert.ok(!holder.querySelector('.n2s-fq-bar'), 'no warning bar')
    await act(async () => { r3.unmount() }); holder.remove()
    } finally {
      responses.freshnessFor = saved
      responses.getResult = result
    }
  })

  await test('tool view for nl2sql_freshness', async () => {
    const C = regs['tool.call.toolview:nl2sql_freshness']
    assert.ok(C, Object.keys(regs).join(','))
    const holder = document.createElement('div'); document.body.appendChild(holder)
    const r2 = createRoot(holder)
    const meta = { freshness: { datasource: '本地', now: 'x', tables: [{ table: 'withdrawals', latestAt: '2026-11-11 17:55', lag: '15 小时', lagMinutes: 900, status: 'stale' }, { table: 'misc', note: 'no time column; freshness unknown' }], warnings: ['⚠️ withdrawals 最新数据停在昨天 17:55（滞后 15 小时）'] } }
    await act(async () => { r2.render(React.createElement(C, { phase: 'result', block: { meta, call: { argsRaw: '{}' }, content: [] } })) }); await settle()
    assert.match(holder.textContent, /数据新鲜度/)
    assert.match(holder.textContent, /⚠️ withdrawals 最新数据停在昨天 17:55/)
    assert.match(holder.textContent, /无时间字段/)
    assert.ok(holder.querySelector('.n2s-fq-dot.err'))
    await act(async () => { r2.unmount() }); holder.remove()
  })

  await test('admin 数据健康: freshness table, quality results, run now, settings save', async () => {
    await clickEl(document.getElementById('n2s-tab-admin'))
    const nav = [...document.querySelectorAll('.n2s-adminnav-item')]
    const item = nav.find(b => b.textContent.includes('数据健康'))
    assert.ok(item, nav.map(b => b.textContent).join('|'))
    await clickEl(item, 120)
    assert.deepEqual(missingKeys(), [])
    const t = text()
    assert.match(t, /withdrawals/)
    assert.match(t, /昨天 17:55/)
    assert.match(t, /健康分 72/)
    assert.match(t, /字段 user_id 空值率 40\.0%/)
    assert.match(t, /还有 1 条/, 'issues collapsed after two')
    assert.match(t, /80 → 72/)
    assert.match(t, /数据滞后 15 小时 · 已推送/)
    assert.equal(rootEl.querySelector('input[aria-label="withdrawals 的滞后阈值（小时）"]').value, '2')
    rpcCalls.length = 0
    await clickEl(btn('立即巡检'), 80)
    assert.ok(rpcCalls.some(c => c.method === 'qualityScan' && c.payload.datasourceId === 'd1'))
    // settings: toggle daily patrol and save
    const settingsEl = rootEl.querySelector('.n2s-fq-settings')
    assert.ok(settingsEl, 'settings card')
    assert.match(settingsEl.textContent, /数据新鲜度[\s\S]*数据质量巡检/, 'two groups, freshness first')
    assert.ok(!settingsEl.textContent.includes('质量巡检时间'), 'quality fields hidden while patrol is off')
    const switches = [...settingsEl.querySelectorAll('input[role=switch]')]
    assert.equal(switches.length, 3, 'freshness on, show on page, quality')
    await clickEl(switches[2])
    assert.ok(settingsEl.textContent.includes('质量巡检时间'), 'quality fields appear when switched on')
    rpcCalls.length = 0
    await clickEl(btn('保存'), 60)
    const saved = rpcCalls.find(c => c.method === 'saveHealthSettings')
    assert.ok(saved, rpcCalls.map(c => c.method).join(','))
    assert.equal(saved.payload.quality.enabled, true)
    assert.equal(saved.payload.freshness.intervalMin, 30)
    assert.equal(saved.payload.freshness.overrides, undefined, 'overrides are edited in the table, not overwritten by the form')
    // switching freshness off hides its fields and, once saved, the freshness table
    await clickEl(rootEl.querySelector('.n2s-fq-settings input[role=switch]'))
    assert.ok(!rootEl.querySelector('.n2s-fq-settings').textContent.includes('新鲜度检查间隔'), 'freshness fields hidden while off')
    assert.ok(!rootEl.querySelector('.n2s-fq-settings').textContent.includes('在页面上显示'))
  })

  await test('no React errors', () => {
    assert.deepEqual(errors.filter(e => !/act\(|not wrapped in act/.test(e)), [])
  })

  await act(async () => { root.unmount() })
  summary()
  process.exit(0)
})()
