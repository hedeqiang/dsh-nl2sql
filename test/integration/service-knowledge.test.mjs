// Service (MySQL): business knowledge in schema/knowledge tools, notes drafts, EXPLAIN,
// scan guard, query history and dashboard widgets. Ported from an earlier standalone script
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'svc-knowledge' })
const { call, tool } = app
let ds
try {
  await test('save datasource + analyze schema', async () => {
    ds = await call('saveDatasource', { name: 't' + Date.now(), ...MYSQL })
    assert.match(ds.id, /^ds-/)
    assert.equal(ds.hasPassword, true)
    assert.ok(!('password' in ds), 'password must not be returned')
    const schema = await call('analyzeSchema', { id: ds.id, refresh: true })
    assert.ok(schema.tables.some((t) => t.name === 'blockchain_transactions'))
  })

  await test('knowledge items show up in nl2sql_schema overview and detail', async () => {
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'glossary', item: { term: '交易量', synonyms: '成交笔数,交易笔数', definition: 'blockchain_transactions 中的记录数', sql: 'COUNT(*)' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '日交易笔数', expression: 'COUNT(*)', table: 'blockchain_transactions', timeColumn: 'created_at' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'note', item: { key: 'blockchain_transactions.status', text: '0 待确认 1 成功 2 失败' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'example', item: { question: '每天的交易笔数趋势', sql: 'SELECT DATE(created_at) d, COUNT(*) n FROM blockchain_transactions GROUP BY d' } })
    const ov = (await tool('nl2sql_schema', {})).text
    assert.match(ov, /- 交易量 \(成交笔数\/交易笔数\) => blockchain_transactions 中的记录数 \[SQL: COUNT\(\*\)\]/)
    assert.match(ov, /- 日交易笔数: COUNT\(\*\) FROM blockchain_transactions; time column created_at/)
    assert.match(ov, /1 verified question→SQL examples exist/)
    const det = (await tool('nl2sql_schema', { tables: ['blockchain_transactions'] })).text
    assert.match(det, /- status .*\(note: 0 待确认 1 成功 2 失败\)/)
  })

  await test('nl2sql_knowledge search returns the example and glossary', async () => {
    const r = await tool('nl2sql_knowledge', { action: 'search', question: '最近每天交易笔数' })
    const j = JSON.stringify(r)
    assert.match(j, /每天的交易笔数趋势/)
    assert.match(j, /交易量/)
  })

  await test('draftNotes proposes notes for enum columns', async () => {
    const drafts = await call('draftNotes', { datasourceId: ds.id })
    assert.ok(Array.isArray(drafts) && drafts.length > 0)
    for (const d of drafts) { assert.match(d.key, /^[\w]+\.[\w]+$/); assert.match(d.text, /取值/) }
  })

  await test('explain returns a MySQL plan', async () => {
    const ex = await call('explain', { datasourceId: ds.id, sql: 'select * from blockchain_transactions' })
    assert.equal(ex.plan[0].table, 'blockchain_transactions')
    assert.equal(ex.plan[0].type, 'ALL')
  })

  await test('scan guard blocks full scans above threshold unless confirmed', async () => {
    await call('saveSettings', { scanGuardRows: 10 })
    await assert.rejects(call('runQuery', { datasourceId: ds.id, sql: 'select * from blockchain_transactions' }), /全表扫描大表：blockchain_transactions/)
    const ok = await call('runQuery', { datasourceId: ds.id, sql: 'select * from blockchain_transactions', confirmScan: true })
    assert.ok(ok.rowCount > 10)
  })

  await test('SQL errors are surfaced', async () => {
    await assert.rejects(call('runQuery', { datasourceId: ds.id, sql: 'select nope from blockchain_transactions' }), /Unknown column 'nope'/)
  })

  await test('history records ok / error / blocked and filters by status', async () => {
    const hist = await call('listHistory', {})
    assert.deepEqual(hist.slice(0, 3).map((h) => h.status), ['error', 'ok', 'blocked'])
    const errs = await call('listHistory', { status: 'error' })
    assert.equal(errs.length, 1)
    assert.ok(errs.every((h) => h.status === 'error'))
  })

  await test('dashboard pin / update / move', async () => {
    const w = await call('pinWidget', { title: 'a', sql: 'select 1 as n', datasourceId: ds.id, chart: { type: 'kpi', y: ['n'] } })
    await call('pinWidget', { title: 'b', sql: 'select 2 as n', datasourceId: ds.id })
    await call('updateWidget', { id: w.id, width: 'full', title: 'A2' })
    const moved = await call('moveWidget', { id: w.id, delta: 1 })
    assert.deepEqual(moved.map((x) => `${x.title}:${x.width}`), ['b:half', 'A2:full'])
  })
} finally {
  await app.close()
}
summary('service knowledge')
