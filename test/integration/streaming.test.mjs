// Large results are truncated while streaming: MySQL stops reading after maxRows + 1 rows and
// destroys the pooled connection; PostgreSQL pulls maxRows + 1 rows through a cursor.
import { test, skip, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, PG, mysqlUnavailable, pgUnavailable, plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = { mysql: await mysqlUnavailable(), postgres: await pgUnavailable() }
if (down.mysql && down.postgres) skipFile(Object.values(down).join('; '))

const { createDriver, cursorHead } = await plugin('drivers.js')

const heap = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed }
const MB = 1024 * 1024

await test('cursorHead: which PostgreSQL statements become cursors', () => {
  assert.equal(cursorHead('select 1'), 'SELECT')
  assert.equal(cursorHead('  (SELECT 1)'), 'SELECT')
  assert.equal(cursorHead('-- c\nWITH x AS (select 1) select * from x'), 'WITH')
  assert.equal(cursorHead('VALUES (1)'), 'VALUES')
  assert.equal(cursorHead('TABLE t'), 'TABLE')
  assert.equal(cursorHead('SHOW search_path'), '')
  assert.equal(cursorHead('EXPLAIN select 1'), '')
})

// ------------------------------------------------------------------ PostgreSQL
await test('postgres: 5,000,000-row generate_series stops after maxRows + 1 rows', async () => {
  if (down.postgres) skip(down.postgres)
  const d = await createDriver({ type: 'postgres', ...PG })
  try {
    const h0 = heap()
    const t0 = Date.now()
    const r = await d.query('SELECT g AS n, g::text AS label, now()::date AS day FROM generate_series(1, 5000000) g', { timeoutMs: 15000, maxRows: 100 })
    const ms = Date.now() - t0
    assert.equal(r.rows.length, 101)
    assert.ok(ms < 3000, `took ${ms}ms`)
    assert.ok(heap() - h0 < 40 * MB, `heap grew ${((heap() - h0) / MB).toFixed(1)} MB`)
    // Same shape and type parsing as before: arrays, numbers for int4, text dates.
    assert.deepEqual(r.columns.map(c => [c.name, c.kind]), [['n', 'number'], ['label', 'auto'], ['day', 'time']])
    assert.equal(r.rows[0][0], 1)
    assert.equal(typeof r.rows[0][1], 'string')
    assert.match(r.rows[0][2], /^\d{4}-\d{2}-\d{2}$/)
    // The connection is clean afterwards (transaction rolled back, cursor gone).
    const again = await d.query('SELECT 1 AS one', { timeoutMs: 5000, maxRows: 10 })
    assert.deepEqual(again.rows, [[1]])
  } finally { await d.close() }
})

await test('postgres: non-cursor statements (SHOW, EXPLAIN) still run', async () => {
  if (down.postgres) skip(down.postgres)
  const d = await createDriver({ type: 'postgres', ...PG })
  try {
    const s = await d.query('SHOW search_path', { timeoutMs: 5000, maxRows: 100 })
    assert.equal(s.rows.length, 1)
    const e = await d.query('EXPLAIN SELECT 1', { timeoutMs: 5000, maxRows: 100 })
    assert.ok(e.rows.length >= 1)
  } finally { await d.close() }
})

await test('postgres: cursor rejects a smuggled second statement and stays read-only', async () => {
  if (down.postgres) skip(down.postgres)
  const d = await createDriver({ type: 'postgres', ...PG })
  try {
    await assert.rejects(d.query('SELECT 1; SELECT 2', { timeoutMs: 5000, maxRows: 10 }))
    await assert.rejects(d.query('WITH x AS (DELETE FROM nonexistent_tbl RETURNING 1) SELECT * FROM x', { timeoutMs: 5000, maxRows: 10 }))
  } finally { await d.close() }
})

await test('postgres: statement timeout still applies through the cursor', async () => {
  if (down.postgres) skip(down.postgres)
  const d = await createDriver({ type: 'postgres', ...PG })
  try {
    // Sorting forces the whole series to be produced before the first row.
    await assert.rejects(d.query('SELECT g FROM generate_series(1, 200000000) g ORDER BY g DESC', { timeoutMs: 300, maxRows: 10 }), (e) => e.code === 'query/timeout')
  } finally { await d.close() }
})

// ---------------------------------------------------------------------- MySQL
const MYSQL_BIG = `SELECT a.n + b.n * 100 + c.n * 10000 AS n, CONCAT('row-', a.n) AS label
FROM (WITH RECURSIVE s(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 99) SELECT n FROM s) a
CROSS JOIN (WITH RECURSIVE s(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 99) SELECT n FROM s) b
CROSS JOIN (WITH RECURSIVE s(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 199) SELECT n FROM s) c`

await test('mysql: 2,000,000-row cross join stops after maxRows + 1 rows', async () => {
  if (down.mysql) skip(down.mysql)
  const d = await createDriver({ type: 'mysql', ...MYSQL })
  try {
    await d.test()
    const h0 = heap()
    const t0 = Date.now()
    const r = await d.query(`${MYSQL_BIG}\nLIMIT 10000000`, { timeoutMs: 15000, maxRows: 100 })
    const ms = Date.now() - t0
    assert.equal(r.rows.length, 101)
    assert.ok(ms < 3000, `took ${ms}ms`)
    assert.ok(heap() - h0 < 40 * MB, `heap grew ${((heap() - h0) / MB).toFixed(1)} MB`)
    assert.deepEqual(r.columns.map(c => c.name), ['n', 'label'])
    // The pool keeps working after the destroyed connection.
    for (let i = 0; i < 5; i++) {
      const again = await d.query('SELECT 1 AS one', { timeoutMs: 5000, maxRows: 10 })
      assert.equal(String(again.rows[0][0]), '1')
    }
  } finally { await d.close() }
})

await test('mysql: WITH statement (no LIMIT added) is truncated too', async () => {
  if (down.mysql) skip(down.mysql)
  const d = await createDriver({ type: 'mysql', ...MYSQL })
  try {
    await d.test()
    const t0 = Date.now()
    const r = await d.query('WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 900) SELECT a.n FROM s a CROSS JOIN s b', { timeoutMs: 15000, maxRows: 100 })
    assert.equal(r.rows.length, 101)
    assert.ok(Date.now() - t0 < 3000)
  } finally { await d.close() }
})

await test('mysql: small results, errors and timeouts behave as before', async () => {
  if (down.mysql) skip(down.mysql)
  const d = await createDriver({ type: 'mysql', ...MYSQL })
  try {
    await d.test()
    const r = await d.query('SELECT 1 AS a, NOW() AS t', { timeoutMs: 5000, maxRows: 100 })
    assert.equal(r.rows.length, 1)
    assert.equal(r.columns[1].kind, 'time')
    await assert.rejects(d.query('SELECT * FROM no_such_table_xyz', { timeoutMs: 5000, maxRows: 10 }), /no_such_table_xyz/)
    // Server-side MAX_EXECUTION_TIME (session limit for a WITH head).
    await assert.rejects(d.query('WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 3000) SELECT COUNT(*) FROM s a, s b, s c', { timeoutMs: 300, maxRows: 10 }))
    const ok = await d.query('SELECT 2 AS b', { timeoutMs: 5000, maxRows: 10 })
    assert.equal(String(ok.rows[0][0]), '2')
  } finally { await d.close() }
})

await test('service: runQuery on PG reports truncated=true with maxRows rows', async () => {
  if (down.postgres) skip(down.postgres)
  const app = await boot({ label: 'stream' })
  try {
    await app.call('saveSettings', { maxRows: 100 })
    const ds = await app.call('saveDatasource', { type: 'postgres', name: 'pg', ...PG })
    const t0 = Date.now()
    const r = await app.call('runQuery', { datasourceId: ds.id, sql: 'SELECT * FROM generate_series(1, 5000000) LIMIT 10000000' })
    assert.equal(r.rowCount, 100)
    assert.equal(r.truncated, true)
    assert.ok(Date.now() - t0 < 4000)
  } finally { await app.close() }
})

summary('streaming')
