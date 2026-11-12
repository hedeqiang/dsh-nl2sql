// Service per engine (MySQL / PostgreSQL / Elasticsearch): test connection, analyze, schema tool,
// query tool, getResult, preview, explain, write blocking, PG scan guard, SSH failure path.
// Ported from an earlier standalone script Each engine is skipped when unreachable (Elasticsearch is
// normally not running). PostgreSQL uses a throwaway schema created by createPgFixture().
import { test, skip, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, PG, ES, mysqlUnavailable, pgUnavailable, esUnavailable, createPgFixture } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = { mysql: await mysqlUnavailable(), postgres: await pgUnavailable(), elasticsearch: await esUnavailable() }
if (down.mysql && down.postgres && down.elasticsearch) skipFile(Object.values(down).join('; '))

const pgFix = down.postgres ? null : await createPgFixture()
const app = await boot({ label: 'svc-engines' })
const { call, tool } = app
const engines = [
  ['mysql', { ...MYSQL }, 'select status, count(*) n from blockchain_transactions group by status', 'delete from x'],
  ['postgres', { ...PG, schemas: pgFix?.schema }, `select date_trunc('day', created_at)::date as day, count(*) as orders, sum(amount) as gmv from ${pgFix?.schema}.orders group by 1 order by 1`, `delete from ${pgFix?.schema}.orders`],
  ['elasticsearch', { host: ES.host, port: ES.port, database: 'app-*' }, 'SELECT level, COUNT(*) AS n FROM "app-logs" GROUP BY level', 'delete from x'],
]
const saved = {}
try {
  for (const [type, form, q, write] of engines) {
    if (down[type]) { await test(`${type}: engine tests`, () => skip(down[type])); continue }
    await test(`${type}: testConnection`, async () => {
      const r = await call('testConnection', { type, name: 'x', ...form })
      assert.equal(r.ok, true, JSON.stringify(r))
      assert.equal(typeof r.version, 'string')
      assert.ok(r.tableCount > 0)
    })
    let ds, schema
    await test(`${type}: save + analyze`, async () => {
      ds = await call('saveDatasource', { type, name: `${type}-${Date.now()}`, ...form })
      saved[type] = ds
      schema = await call('analyzeSchema', { id: ds.id, refresh: true })
      assert.ok(schema.tables.length > 0)
      for (const t of schema.tables) { assert.equal(typeof t.name, 'string'); assert.equal(typeof t.role, 'string') }
      if (type === 'postgres') {
        const names = schema.tables.map((t) => t.name).sort()
        assert.deepEqual(names, [`${pgFix.schema}.customers`, `${pgFix.schema}.orders`])
        assert.ok(schema.relations.some((r) => r.from.table.endsWith('.orders') && r.from.column === 'customer_id' && r.to.table.endsWith('.customers')), JSON.stringify(schema.relations))
      }
    })
    if (!ds) continue
    await test(`${type}: nl2sql_schema overview + detail`, async () => {
      const ov = await tool('nl2sql_schema', { datasource: ds.id }, app.exec('s-' + type))
      assert.ok(ov.text.includes(schema.tables[0].name))
      const tname = type === 'postgres' ? `${pgFix.schema}.orders` : schema.tables[0].name
      const det = await tool('nl2sql_schema', { datasource: ds.id, tables: [tname] }, app.exec('s-' + type))
      assert.ok(det.text.includes(tname))
    })
    let resultId
    await test(`${type}: nl2sql_query + getResult`, async () => {
      const r = await tool('nl2sql_query', { datasource: ds.id, sql: q, title: 't' }, app.exec('s-' + type))
      assert.ok(r.model.rowCount > 0)
      assert.ok(r.display.columns.length >= 2)
      assert.ok(r.display.chart?.type)
      resultId = r.display.resultId
      const full = await call('getResult', { resultId })
      assert.equal(full.rows.length, r.model.rowCount)
    })
    await test(`${type}: preview + explain`, async () => {
      const tname = schema.tables[0].name
      const quoted = type === 'mysql' ? '`' + tname + '`' : type === 'postgres' ? tname : '"' + tname + '"'
      const pv = await call('runQuery', { datasourceId: ds.id, sql: `SELECT * FROM ${quoted} LIMIT 3` })
      assert.ok(pv.rowCount <= 3)
      const ex = await call('explain', { datasourceId: ds.id, sql: q })
      assert.ok(Array.isArray(ex.plan) && ex.plan.length > 0)
    })
    await test(`${type}: writes are blocked`, async () => {
      await assert.rejects(call('runQuery', { datasourceId: ds.id, sql: write }), /read-only|只读|only/i)
    })
  }

  await test('postgres: scan guard on a large full scan', async () => {
    if (!saved.postgres) skip(down.postgres ?? 'postgres datasource not saved')
    await call('saveSettings', { scanGuardRows: 100 })
    await assert.rejects(call('runQuery', { datasourceId: saved.postgres.id, sql: `select * from ${pgFix.schema}.orders` }), /全表扫描/)
    await call('saveSettings', { scanGuardRows: 1000000 })
  })

  await test('SSH tunnel failure is reported, not thrown', async () => {
    if (down.postgres) skip(down.postgres)
    const r = await call('testConnection', { type: 'postgres', name: 's', ...PG, ssh: { enabled: true, host: '127.0.0.1', port: 2, user: 'x', password: 'y' } })
    assert.equal(r.ok, false)
    assert.ok(r.error || r.message, JSON.stringify(r))
  })
} finally {
  await app.close()
  await pgFix?.drop()
}
summary('service engines')
