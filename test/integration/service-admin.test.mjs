// Settings page / Ask page / onboarding RPCs: retention, storageStats, purgeRecords,
// resetSettings, aboutInfo, exportConfig / importConfig, askSuggestions, onboardingStatus,
// widget widths + reorderWidgets, and the large-schema overview. Local file data sources only.
import { test, summary, assert } from '../lib/assert.mjs'
import { boot, fakeSchedule } from '../lib/harness.mjs'

const app = await boot({ label: 'svc-admin' })
const { call, tool, service } = app
const b64 = (s) => Buffer.from(s).toString('base64')
const csv = `order_date,status,amount,city\n${Array.from({ length: 60 }, (_, i) => `2026-01-${String(1 + (i % 28)).padStart(2, '0')},s${i % 3},${i * 1.5},c${i % 4}`).join('\n')}\n`

let ds
try {
  await test('onboardingStatus starts empty; dismissOnboarding toggles', async () => {
    const s = await call('onboardingStatus')
    assert.deepEqual(s, { hasDatasource: false, analyzed: false, hasKnowledge: false, askedQuestion: false, hasChannel: false, dismissed: false })
    assert.equal((await call('dismissOnboarding', { dismissed: true })).dismissed, true)
    assert.equal((await call('dismissOnboarding', { dismissed: false })).dismissed, false)
  })

  await test('upload a file data source (fact table) for the rest of the file', async () => {
    const st = await call('stageUpload', { fileName: '订单表.csv', base64: b64(csv) })
    const imp = await call('importUpload', { uploadId: st.uploadId, newName: 'shop', sheets: [{ sheet: st.sheets[0].sheet, table: 'orders' }] })
    assert.equal(imp.results[0].ok, true, JSON.stringify(imp))
    ds = (await call('listDatasources')).find(d => d.id === imp.datasourceId)
    const s = await call('onboardingStatus')
    assert.equal(s.hasDatasource, true)
    assert.equal(s.analyzed, true)
  })

  // ---------------------------------------------------------------- settings
  await test('getSettings includes defaults; resetSettings resets given keys or all', async () => {
    const s0 = await call('getSettings')
    assert.equal(s0.defaults.maxRows, 500)
    assert.equal(s0.defaults.retention.history, 20000)
    assert.equal(s0.schemaOverviewMax, 80)
    await call('saveSettings', { maxRows: 77, timeoutMs: 9000 })
    let s = await call('resetSettings', { keys: ['maxRows'] })
    assert.equal(s.maxRows, 500)
    assert.equal(s.timeoutMs, 9000)
    s = await call('resetSettings', {})
    assert.equal(s.timeoutMs, 15000)
    await assert.rejects(call('resetSettings', { keys: ['nope'] }), /未知/)
    assert.ok(service.records.list('admin', { limit: 5 }).some(a => a.action === 'settings.reset'))
  })

  await test('retention: validated, clamped 100..200000, lowering trims immediately', async () => {
    for (let i = 0; i < 150; i++) service.records.put('admin', { id: `ad-t${i}`, at: Date.now() - i, action: 'test', detail: String(i) })
    assert.ok(service.records.count('admin') >= 150)
    const s = await call('saveSettings', { retention: { admin: 5, history: 999999999 } })
    assert.equal(s.retention.admin, 100)
    assert.equal(s.retention.history, 200000)
    assert.equal(s.retention.feedback, 5000)
    assert.equal(service.records.count('admin'), 100)
    await assert.rejects(call('saveSettings', { retention: { bogus: 10 } }), /未知/)
    await assert.rejects(call('saveSettings', { retention: { admin: 'x' } }), /数字/)
  })

  await test('storageStats and purgeRecords', async () => {
    const st = await call('storageStats')
    assert.ok(st.resultsDb.bytes > 0)
    assert.equal(typeof st.resultsDb.results, 'number')
    assert.equal(typeof st.resultsDb.cacheEntries, 'number')
    assert.ok(st.records.admin >= 100)
    assert.ok(st.stateBytes > 0)
    assert.equal(st.dataDir, app.dir)
    service.records.put('delivery', { id: 'dl-x', at: Date.now(), channelId: 'c', title: 't', status: 'ok' })
    const r = await call('purgeRecords', { kind: 'delivery' })
    assert.equal(r.purged, 1)
    assert.equal(r.records.delivery, 0)
    assert.ok(service.records.list('admin', { limit: 3 }).some(a => a.action === 'records.purge'))
    await assert.rejects(call('purgeRecords', { kind: 'state' }), /未知/)
  })

  await test('aboutInfo', async () => {
    const a = await call('aboutInfo')
    assert.match(a.version, /^\d+\.\d+\.\d+/)
    assert.equal(a.dataDir, app.dir)
    assert.match(a.nodeVersion, /^\d+\./)
    assert.match(a.sqliteVersion, /^3\./)
    assert.equal(typeof a.testsCommand, 'string')
  })

  // --------------------------------------------------------------- Ask page
  await test('askSuggestions: metrics, 👍 questions, schema examples (zh/en), recent agent questions', async () => {
    let r = await call('askSuggestions', { datasourceId: ds.id })
    assert.equal(r.tableCount, 1)
    assert.ok(r.examples.some(q => /^最近 30 天每天的.+数量趋势$/.test(q)), JSON.stringify(r.examples))
    assert.ok(r.examples.some(q => /按status的分布$/.test(q)), JSON.stringify(r.examples))
    assert.deepEqual(r.recent, [])
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '销售额', expression: 'SUM(amount)', table: 'orders', timeColumn: 'order_date' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '订单数', expression: 'COUNT(*)', table: 'orders', dimensions: 'city' } })
    await call('submitFeedback', { datasourceId: ds.id, rating: 'up', question: '每个城市的销售额', sql: 'SELECT city, SUM(amount) FROM orders GROUP BY city' })
    await call('submitFeedback', { datasourceId: ds.id, rating: 'down', question: '不该出现', sql: 'SELECT 1' })
    // Agent-sourced history.
    await tool('nl2sql_query', { datasource: ds.id, sql: 'SELECT COUNT(*) AS n FROM orders', title: '订单总数' })
    await tool('nl2sql_query', { datasource: ds.id, sql: 'SELECT COUNT(*) AS n FROM orders', title: '订单总数' })
    await tool('nl2sql_query', { datasource: ds.id, sql: 'SELECT city, COUNT(*) AS n FROM orders GROUP BY city', title: '按城市' })
    await call('runQuery', { datasourceId: ds.id, sql: 'SELECT 1', title: 'ui query' })
    r = await call('askSuggestions', { datasourceId: ds.id })
    // Pool interleaves sources: metric, 👍 question, (verified examples), schema ×2, then the next metric template …
    assert.deepEqual(r.examples.slice(0, 2), ['最近 30 天每天的销售额', '每个城市的销售额'])
    const all = []; let off = 0
    for (let i = 0; i < 10; i++) { const p = await call('askSuggestions', { datasourceId: ds.id, offset: off }); all.push(...p.examples); off = p.nextOffset; if (!off) break }
    assert.ok(all.includes('订单数按city分布') && all.includes('订单数是多少'), JSON.stringify(all))
    assert.ok(!r.examples.includes('不该出现'))
    assert.deepEqual(r.recent.map(x => x.question), ['按城市', '订单总数'])
    assert.ok(r.recent[0].resultId && r.recent[0].sql && r.recent[0].status === 'ok' && r.recent[0].at)
    const en = await call('askSuggestions', { datasourceId: ds.id, locale: 'en' })
    assert.deepEqual(en.examples.slice(0, 2), ['Daily 销售额 over the last 30 days', '每个城市的销售额'])
    const enAll = []; off = 0
    for (let i = 0; i < 10; i++) { const p = await call('askSuggestions', { datasourceId: ds.id, locale: 'en', offset: off }); enAll.push(...p.examples); off = p.nextOffset; if (!off) break }
    assert.ok(enAll.includes('orders trend per day over the last 30 days'), JSON.stringify(enAll))
    assert.ok(enAll.includes('What are the core business tables and how are they related?'))
    const s = await call('onboardingStatus')
    assert.equal(s.hasKnowledge, true)
    assert.equal(s.askedQuestion, true)
  })

  // -------------------------------------------------------------- dashboards
  await test('widget width third/half/full and reorderWidgets', async () => {
    const d = (await call('saveDashboard', { name: '排序' })).current
    const ids = []
    for (const [i, width] of ['third', 'full', 'weird'].entries()) ids.push((await call('pinWidget', { title: `w${i}`, sql: 'SELECT 1', datasourceId: ds.id, width, dashboardId: d })).id)
    let list = await call('listDashboard', { dashboardId: d })
    assert.deepEqual(list.map(w => w.width), ['third', 'full', 'half'])
    assert.equal((await call('updateWidget', { id: ids[2], width: 'third' })).width, 'third')
    assert.equal((await call('updateWidget', { id: ids[2], width: 'half' })).width, 'half')
    list = await call('reorderWidgets', { dashboardId: d, ids: [ids[2], ids[0], ids[1]] })
    assert.deepEqual(list.map(w => w.id), [ids[2], ids[0], ids[1]])
    assert.deepEqual((await call('listDashboard', { dashboardId: d })).map(w => w.id), [ids[2], ids[0], ids[1]])
    await assert.rejects(call('reorderWidgets', { dashboardId: d, ids: [ids[0], ids[1]] }), /全部组件/)
    await assert.rejects(call('reorderWidgets', { dashboardId: d, ids: [ids[0], ids[0], ids[1]] }), /全部组件/)
    await assert.rejects(call('reorderWidgets', { dashboardId: d, ids: [ids[0], ids[1], 'w-x'] }), /全部组件/)
  })

  // ---------------------------------------------------------- large schema
  await test('large schema: names-only list + top-N relevant tables; small schema unchanged', async () => {
    const small = (await tool('nl2sql_schema', { datasource: ds.id })).text
    assert.match(small, /table \| role \| ~rows \| comment \| columns/)
    assert.ok(!/large schema/.test(small))
    // Synthetic 120-table schema through schemaForModel.
    const col = (name, dataType, roles, comment = '') => ({ name, dataType, columnType: dataType, nullable: true, key: '', comment, roles })
    const tables = Array.from({ length: 120 }, (_, i) => ({ name: `misc_table_${i}`, type: 'TABLE', rows: i, comment: '', role: 'other', columns: [col('id', 'int', ['id']), col(`field_${i}`, 'varchar', ['text'])], indexes: [] }))
    tables.push({ name: 'pay_refund', type: 'TABLE', rows: 10, comment: '退款记录', role: 'fact', columns: [col('id', 'int', ['id']), col('refund_amount', 'decimal', ['measure'], '退款金额'), col('created_at', 'datetime', ['time'])], indexes: [] })
    tables.push({ name: 'crm_customer', type: 'TABLE', rows: 10, comment: '客户', role: 'dimension', columns: [col('id', 'int', ['id']), col('customer_name', 'varchar', ['text'], '客户名称')], indexes: [] })
    tables.push({ name: 'wh_stock', type: 'TABLE', rows: 10, comment: '', role: 'other', columns: [col('id', 'int', ['id']), col('qty', 'int', ['measure'])], indexes: [] })
    const schema = { database: 'big', version: '1', analyzedAt: Date.now(), tables, relations: [{ from: { table: 'pay_refund', column: 'customer_id' }, to: { table: 'crm_customer', column: 'id' }, kind: 'inferred', confidence: 0.8 }] }
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'example', item: { question: '每个仓库的库存', sql: 'SELECT SUM(qty) FROM wh_stock' } })
    const dsObj = service.requireDatasource(ds.id)
    const text = service.schemaForModel(schema, dsObj, undefined, { question: '上个月每个客户的退款金额' })
    assert.match(text, /large schema \(123 tables > 80\)/)
    const lines = text.split('\n')
    for (const t of tables) assert.ok(lines.includes(`${t.name} | ${t.role} | ${t.rows}`) || lines.some(l => l.startsWith(`${t.name} | `)), t.name)
    const detailStart = lines.findIndex(l => l.startsWith('table | role | ~rows | comment | columns'))
    const detailed = lines.slice(detailStart + 1).filter(l => / \| .* \| .* \| .* \| /.test(l)).map(l => l.split(' | ')[0])
    assert.equal(detailed.length, 15)
    assert.equal(detailed[0], 'pay_refund')
    assert.ok(detailed.includes('crm_customer'))
    assert.match(text, /Call nl2sql_schema with `tables`/)
    // Knowledge: verified example SQL mentions wh_stock.
    const t2 = service.schemaForModel(schema, dsObj, undefined, { question: '每个仓库的库存是多少' })
    const l2 = t2.split('\n')
    const d2 = l2.slice(l2.findIndex(l => l.startsWith('table | role | ~rows | comment')) + 1).map(l => l.split(' | ')[0])
    assert.equal(d2[0], 'wh_stock')
    // Threshold is a setting; through the tool with `question`.
    await call('saveSettings', { schemaOverviewMax: 0 + 1, schemaOverviewTop: 1 })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'note', item: { key: 'orders', text: '订单' } })
    const viaTool = (await tool('nl2sql_schema', { datasource: ds.id, question: '订单' })).text
    assert.ok(!/large schema/.test(viaTool), 'one table is not above the threshold of 1')
    const params = app.tools.get('nl2sql_schema').parameters
    assert.equal(params.properties.question.type, 'string')
    await call('resetSettings', { keys: ['schemaOverviewMax', 'schemaOverviewTop'] })
  })

  // ---------------------------------------------------------- config export
  let exported
  await test('exportConfig: all sections, no secrets, no runtime state', async () => {
    await call('saveAlert', { name: '销售额告警', datasourceId: ds.id, source: 'metric', metric: '销售额', condition: { type: 'threshold', op: '>', value: 1 }, every: 'day' })
    const a = service.state.alerts[0]
    a.lastValue = 5; a.lastFiredAt = 1; a.state = 'firing'
    await call('saveUser', { name: '张三', email: 'z@example.com', role: 'viewer', datasourceIds: [ds.id], rowRules: [{ datasourceId: ds.id, column: 'city', values: ['c1'] }] })
    service.state.reports.push({ id: 'rp-legacy', title: '日报', datasourceId: ds.id, scope: 'question', question: '销售额', period: 'daily', time: '09:00:00', weekdays: [1], timeZone: 'Asia/Shanghai', target: 'new_once', scheduleId: 'sch-secret' })
    service.state.datasources.push({ id: 'ds-remote', name: 'remote-pg', type: 'postgres', host: 'db', port: 5432, database: 'x', user: 'u', hasPassword: true, createdAt: 1 })
    service.state.channels.push({ id: 'ch-1', name: '群', type: 'lark_webhook', domain: 'feishu', hasSecret: true, isDefault: true })
    await app.creds.set('nl2sql/ds-remote', { kind: 'grant', payload: { password: 'TOPSECRET' } })
    exported = await call('exportConfig')
    assert.equal(exported.format, 'dsh-nl2sql-config')
    assert.equal(exported.version, 1)
    for (const k of ['settings', 'datasources', 'knowledge', 'dashboards', 'alerts', 'reports', 'channels', 'users']) assert.ok(k in exported, k)
    const text = JSON.stringify(exported)
    assert.ok(!text.includes('TOPSECRET'))
    assert.ok(!text.includes('sch-secret'))
    const remote = exported.datasources.find(d => d.name === 'remote-pg')
    assert.equal(remote.hasPassword, true)
    assert.ok(!('password' in remote))
    assert.ok(!('lastValue' in exported.alerts[0]) && !('state' in exported.alerts[0]))
    assert.equal(exported.alerts[0].datasourceName, 'shop')
    assert.equal(exported.reports[0].datasourceName, 'shop')
    assert.ok(!('scheduleId' in exported.reports[0]))
    assert.equal(exported.users[0].datasources[0], 'shop')
    assert.ok(exported.dashboards.some(d => d.widgets.some(w => w.datasourceName === 'shop')))
  })

  await test('importConfig into a fresh instance: dryRun counts, needsSecret, paused reports without schedule service', async () => {
    const other = await boot({ label: 'svc-admin-import' })
    try {
      const dry = await other.call('importConfig', { data: exported, mode: 'merge', dryRun: true })
      assert.equal(dry.dryRun, true)
      assert.equal(dry.report.datasources.add, 2, JSON.stringify(dry.report))
      assert.deepEqual(dry.report.datasources.needsSecret, ['remote-pg'])
      assert.equal(dry.report.reports.add, 1)
      assert.equal(dry.report.reports.paused, true)
      assert.deepEqual(dry.report.channels.needsSecret, ['群'])
      assert.equal(dry.report.alerts.add, 1)
      assert.equal(dry.report.users.add, 1)
      assert.equal((await other.call('listDatasources')).length, 0, 'dry run writes nothing')
      const res = await other.call('importConfig', { data: JSON.stringify(exported), mode: 'merge' })
      assert.equal(res.report.datasources.add, 2)
      const list = await other.call('listDatasources')
      const remote = list.find(d => d.name === 'remote-pg')
      assert.equal(remote.needsSecret, true)
      assert.equal(remote.hasPassword, false)
      const reports = await other.call('listReports')
      assert.equal(reports[0].status, 'paused')
      assert.equal(reports[0].datasourceId, list.find(d => d.name === 'shop').id)
      const alerts = await other.call('listAlerts')
      assert.equal(alerts[0].datasourceName, 'shop')
      assert.equal(alerts[0].state, 'ok')
      const users = await other.call('listUsers')
      assert.deepEqual(users[0].datasourceNames, ['shop'])
      const k = await other.call('getKnowledge', { datasourceId: list.find(d => d.name === 'shop').id })
      assert.ok(k.metrics.some(m => m.name === '销售额'))
      const chans = await other.call('listChannels')
      assert.equal(chans[0].needsSecret, true)
      // Re-import (merge) updates instead of duplicating.
      const again = await other.call('importConfig', { data: exported, mode: 'merge' })
      assert.equal(again.report.datasources.update, 2)
      assert.equal((await other.call('listDatasources')).length, 2)
      assert.equal((await other.call('listAlerts')).length, 1)
    } finally { await other.close() }
  })

  await test('importConfig with a schedule service creates schedules; ids remapped on conflicts; replace mode', async () => {
    const schedule = fakeSchedule()
    const other = await boot({ label: 'svc-admin-import2', services: { schedule } })
    try {
      // A pre-existing data source that owns the exported id under another name.
      const shopId = exported.datasources.find(d => d.name === 'shop').id
      other.service.state.datasources.push({ id: shopId, name: 'occupied', type: 'sqlite', host: 'local', port: 0, database: 'x', file: '/tmp/none.sqlite', createdAt: 1 })
      const res = await other.call('importConfig', { data: exported, mode: 'merge' })
      assert.equal(res.report.reports.paused, false)
      const list = await other.call('listDatasources')
      const shop = list.find(d => d.name === 'shop')
      assert.notEqual(shop.id, shopId, 'id remapped on conflict')
      assert.equal(schedule.sched.size, 1)
      const reports = await other.call('listReports')
      assert.equal(reports[0].status, 'active')
      assert.equal(reports[0].datasourceId, shop.id)
      // replace: dashboards replaced by the file's set.
      await other.call('saveDashboard', { name: '本地独有' })
      await other.call('importConfig', { data: exported, mode: 'replace', sections: ['dashboards'] })
      const names = (await other.call('listDashboards')).dashboards.map(d => d.name)
      assert.ok(!names.includes('本地独有'))
      assert.deepEqual(names.sort(), exported.dashboards.map(d => d.name).sort())
      await assert.rejects(other.call('importConfig', { data: { format: 'x' } }), /format/)
      await assert.rejects(other.call('importConfig', { data: exported, mode: 'bogus' }), /mode/)
    } finally { await other.close() }
  })
} finally {
  await app.close()
}
summary('service admin')
