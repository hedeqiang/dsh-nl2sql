// sqlite-driver.js: file imports, read-only query worker, introspection shape, timeouts.
// Ported from the sqlitefile/sqlite-driver.test.mjs scratch test.
import { test, summary, assert } from '../lib/assert.mjs'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { plugin, tempDir } from '../lib/env.mjs'

const { SqliteDriver, importTable, dropTable, listTables, fileStats, sanitizeTableName, sqliteDialectHints, toCell, useErrorClass } = await plugin('sqlite-driver.js')
const { createDriver, DriverError, describeError } = await plugin('drivers.js')

useErrorClass(DriverError)
const DIR = tempDir('sqlite')
const FILE = `${DIR}/nested/data.sqlite`

const N = 20000
const cities = ['北京', '上海', '广州', '深圳']
const rows = Array.from({ length: N }, (_, i) => [
  i + 1,
  cities[i % 4],
  i % 10 === 0 ? null : Math.round((i % 100) * 1.5 * 100) / 100,
  `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  `2024-01-01 10:${String(i % 60).padStart(2, '0')}:00`,
  i % 7 === 0 ? null : `备注${i}`,
])
const columns = [
  { name: '订单号', type: 'INTEGER' }, { name: '城市', type: 'TEXT' }, { name: '金额', type: 'REAL' },
  { name: '下单日期', type: 'DATE' }, { name: '创建时间', type: 'DATETIME' }, { name: '备注', type: 'TEXT' },
]

let driver
await test('importTable create with Chinese names, 20k rows', () => {
  const t0 = Date.now()
  const r = importTable({ file: FILE, table: '销售 订单-2024', columns, rows, source: '销售.xlsx' })
  assert.equal(r.table, '销售_订单_2024')
  assert.equal(r.rows, N)
  assert.deepEqual(r.columns.map(c => c.name), columns.map(c => c.name))
  assert.ok(existsSync(FILE))
  console.log(`  import ${N} rows in ${Date.now() - t0}ms`)
  assert.throws(() => importTable({ file: FILE, table: '销售 订单-2024', columns, rows: [] }), /表已存在：销售_订单_2024/)
  driver = new SqliteDriver({ file: FILE })
})

await test('sanitizeTableName', () => {
  assert.equal(sanitizeTableName('2024 sales'), 't_2024_sales')
  assert.equal(sanitizeTableName('a.b/c'), 'a_b_c')
  assert.equal([...sanitizeTableName('表'.repeat(100))].length, 64)
  assert.throws(() => sanitizeTableName('sqlite_master'), /sqlite_/)
  assert.equal(sanitizeTableName('__nl2sql_tables'), 'nl2sql_tables')
  assert.throws(() => sanitizeTableName('SQLite_x'), /sqlite_/)
  assert.throws(() => sanitizeTableName('---'), /不能为空/)
})

await test('aggregation query + kinds', async () => {
  const r = await driver.query('SELECT "城市", COUNT(*) AS n, SUM("金额") AS total, strftime(\'%Y-%m\', "下单日期") AS m FROM "销售_订单_2024" GROUP BY 1, 4 ORDER BY 1, 4', { timeoutMs: 5000, maxRows: 1000 })
  assert.equal(r.rows.length, 12) // month determines city in the fixture
  assert.equal(r.rows.reduce((s, x) => s + x[1], 0), N)
  assert.deepEqual(r.columns.map(c => c.kind), ['text', 'number', 'number', 'auto'])
  assert.equal(r.columns[0].table, '销售_订单_2024')
  assert.equal(r.columns[0].column, '城市')
  const all = await driver.query('SELECT * FROM "销售_订单_2024" LIMIT 5', { timeoutMs: 5000, maxRows: 100 })
  assert.deepEqual(all.columns.map(c => c.kind), ['number', 'text', 'number', 'time', 'time', 'text'])
  assert.equal(all.rows[0][2], null)
  assert.equal(typeof all.rows[1][0], 'number')
})

await test('maxRows truncation returns maxRows + 1', async () => {
  const r = await driver.query('SELECT * FROM "销售_订单_2024"', { timeoutMs: 5000, maxRows: 100 })
  assert.equal(r.rows.length, 101)
})

await test('BigInt and blob handling', async () => {
  const r = await driver.query("SELECT 9007199254740993 AS big, 42 AS small, -9007199254740993 AS neg, x'0102ff' AS bin, 1.5 AS f", { timeoutMs: 5000, maxRows: 10 })
  assert.deepEqual(r.rows[0], ['9007199254740993', 42, '-9007199254740993', '<binary 3 bytes>', 1.5])
  assert.equal(toCell(5n), 5)
})

await test('read-only enforcement on query()', async () => {
  const bad = [
    'INSERT INTO "销售_订单_2024" ("订单号") VALUES (1)',
    'UPDATE "销售_订单_2024" SET "金额" = 0',
    'DELETE FROM "销售_订单_2024"',
    'DROP TABLE "销售_订单_2024"',
    `ATTACH '${DIR}/x.sqlite' AS x`,
    'CREATE TABLE x (a)',
    'CREATE TEMP TABLE x (a)',
    'PRAGMA writable_schema = ON',
    'PRAGMA user_version = 3',
    "PRAGMA journal_mode = 'delete'",
    "SELECT load_extension('/tmp/evil')",
    "SELECT readfile('/etc/passwd')",
    'SELECT 1; DROP TABLE "销售_订单_2024"',
    'BEGIN',
    'VACUUM',
    `VACUUM INTO '${DIR}/copy.sqlite'`,
    'ANALYZE',
    'REINDEX',
    "WITH x AS (SELECT 1) INSERT INTO \"销售_订单_2024\" (\"订单号\") SELECT 1",
  ]
  for (const sql of bad) {
    await assert.rejects(driver.query(sql, { timeoutMs: 5000, maxRows: 10 }), (e) => {
      assert.ok(e instanceof DriverError, `${sql}: ${e.constructor.name}`)
      assert.match(describeError(e).message, /只读|not authorized|一次只能|no such function|SQLite/, sql)
      return true
    }, sql)
  }
  assert.ok(!existsSync(`${DIR}/copy.sqlite`))
  const r = await driver.query('SELECT COUNT(*) FROM "销售_订单_2024"', { timeoutMs: 5000, maxRows: 10 })
  assert.equal(r.rows[0][0], N)
  // read PRAGMAs and table-valued pragma functions still work
  const p = await driver.query('PRAGMA table_info("销售_订单_2024")', { timeoutMs: 5000, maxRows: 100 })
  assert.equal(p.rows.length, 6)
  const p2 = await driver.query("SELECT name FROM pragma_table_info('销售_订单_2024')", { timeoutMs: 5000, maxRows: 100 })
  assert.equal(p2.rows.length, 6)
  // the file itself was not modified
  const db = new DatabaseSync(FILE, { readOnly: true })
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0)
  db.close()
})

await test('introspect shape matches the MySQL driver', async () => {
  // Reference shape from the real MysqlDriver.introspect with a stubbed objects().
  const my = await createDriver({ type: 'mysql', host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'd' })
  my.objects = async (sql) => {
    if (/information_schema\.TABLES/.test(sql)) return [{ name: 't', type: 'BASE TABLE', rows: 3, comment: 'c' }]
    if (/information_schema\.COLUMNS/.test(sql)) return [{ tableName: 't', name: 'id', dataType: 'int', columnType: 'int(11)', nullable: 'NO', key: 'PRI', extra: '', comment: '' }]
    if (/KEY_COLUMN_USAGE/.test(sql)) return [{ tableName: 't', columnName: 'u_id', refTable: 'u', refColumn: 'id' }]
    if (/STATISTICS/.test(sql)) return [{ tableName: 't', indexName: 'PRIMARY', nonUnique: 0, columnName: 'id' }]
    return [{ version: '8.0.0' }]
  }
  const ref = await my.introspect(1000)
  await my.close()

  importTable({ file: FILE, table: 'users', columns: [{ name: 'id', type: 'INTEGER' }, { name: 'name', type: 'TEXT' }], rows: [[1, 'a'], [2, 'b']], source: 'u.csv' })
  const w = new DatabaseSync(FILE)
  w.exec('CREATE UNIQUE INDEX ux_users_id ON users(id); CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amt REAL, code TEXT UNIQUE); CREATE INDEX ix_u ON orders(user_id); INSERT INTO orders VALUES (1,1,2.5,\'a\'),(2,2,3,\'b\'); CREATE VIEW v_orders AS SELECT * FROM orders')
  w.close()
  const raw = await driver.introspect(10000)

  const shape = (o) => Object.keys(o).sort().join(',')
  const deep = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, typeof v[x] === 'object' && v[x] !== null ? v[x] : typeof v[x]])) : v))
  assert.equal(shape(raw), shape(ref))
  assert.match(raw.version, /^\d+\.\d+/)
  const checks = [['tables', raw.tables], ['columns', raw.columns], ['foreignKeys', raw.foreignKeys], ['indexes', raw.indexes]]
  for (const [k, list] of checks) {
    assert.ok(list.length > 0, k)
    for (const item of list) {
      assert.equal(shape(item), shape(ref[k][0]), `${k} keys: ${JSON.stringify(item)}`)
      if (k !== 'tables') assert.equal(deep(item), deep(ref[k][0]), `${k} value types: ${JSON.stringify(item)}`)
    }
  }
  for (const t of raw.tables) {
    assert.equal(typeof t.name, 'string'); assert.ok(['TABLE', 'VIEW'].includes(t.type)); assert.equal(typeof t.comment, 'string')
    assert.ok(t.rows === null || typeof t.rows === 'number')
  }
  const names = raw.tables.map(t => t.name)
  assert.ok(!names.includes('__nl2sql_tables'))
  assert.deepEqual(names.sort(), ['orders', 'users', 'v_orders', '销售_订单_2024'].sort())
  const sales = raw.tables.find(t => t.name === '销售_订单_2024')
  assert.equal(sales.rows, N)
  assert.match(sales.comment, /来源：销售\.xlsx，导入于 /)
  assert.equal(raw.tables.find(t => t.name === 'v_orders').type, 'VIEW')
  const col = (t, c) => raw.columns.find(x => x.table === t && x.name === c)
  assert.deepEqual(col('orders', 'id'), { table: 'orders', name: 'id', dataType: 'int', columnType: 'integer', nullable: false, key: 'PRI', comment: '' })
  assert.equal(col('orders', 'user_id').key, 'MUL')
  assert.equal(col('orders', 'user_id').nullable, false)
  assert.equal(col('orders', 'code').key, 'UNI')
  assert.equal(col('销售_订单_2024', '金额').dataType, 'double')
  assert.equal(col('销售_订单_2024', '下单日期').dataType, 'date')
  assert.equal(col('销售_订单_2024', '创建时间').dataType, 'datetime')
  assert.equal(col('销售_订单_2024', '城市').dataType, 'varchar')
  assert.deepEqual(raw.foreignKeys, [{ from: { table: 'orders', column: 'user_id' }, to: { table: 'users', column: 'id' } }])
  assert.ok(raw.indexes.some(i => i.table === 'orders' && i.name === 'PRIMARY' && i.unique && i.column === 'id'))
  assert.ok(raw.indexes.some(i => i.table === 'orders' && i.name === 'ix_u' && !i.unique && i.column === 'user_id'))
})

await test('explain scans', async () => {
  const full = await driver.explain('SELECT * FROM "销售_订单_2024" WHERE "金额" > 10', { timeoutMs: 5000 })
  assert.ok(full.plan.length > 0 && typeof full.plan[0].detail === 'string')
  assert.deepEqual(full.scans, [{ table: '销售_订单_2024', rows: N }])
  const aliased = await driver.explain('SELECT * FROM "销售_订单_2024" s JOIN users u ON u.id = s."订单号"', { timeoutMs: 5000 })
  assert.ok(aliased.scans.some(s => s.table === '销售_订单_2024' && s.rows === N), JSON.stringify(aliased))
  const idx = await driver.explain('SELECT * FROM orders WHERE user_id = 1', { timeoutMs: 5000 })
  assert.deepEqual(idx.scans, [])
  await assert.rejects(driver.explain('DELETE FROM orders', { timeoutMs: 5000 }), /只读/)
})

await test('sampleColumn / previewSql / ident / test()', async () => {
  const s = await driver.sampleColumn('销售_订单_2024', '城市')
  assert.equal(s.length, 4)
  assert.deepEqual(Object.keys(s[0]), ['value', 'count'])
  assert.equal(s[0].count, N / 4)
  assert.equal(driver.ident('a"b'), '"a""b"')
  assert.equal(driver.previewSql('销售_订单_2024', 5), 'SELECT * FROM "销售_订单_2024" LIMIT 5')
  assert.equal(driver.useHint, false)
  assert.equal(driver.dialect, 'sqlite')
  const info = await driver.test()
  assert.deepEqual(Object.keys(info).sort(), ['database', 'grants', 'readOnlyGrant', 'tableCount', 'user', 'version', 'warnings'])
  assert.match(info.version, /^SQLite 3\./)
  assert.equal(info.readOnlyGrant, true)
  assert.equal(info.tableCount, 4)
})

await test('append and replace modes', async () => {
  const cols = [{ name: '名称', type: 'TEXT' }, { name: '数量', type: 'INTEGER' }]
  importTable({ file: FILE, table: '库存', columns: cols, rows: [['a', 1], ['b', null]], source: 'a.csv' })
  const a = importTable({ file: FILE, table: '库存', columns: cols, rows: [['c', 3]], mode: 'append', source: 'b.csv' })
  assert.equal(a.rows, 1)
  let r = await driver.query('SELECT COUNT(*), SUM("数量") FROM "库存"', { timeoutMs: 5000, maxRows: 10 })
  assert.deepEqual(r.rows[0], [3, 4])
  assert.throws(() => importTable({ file: FILE, table: '库存', columns: [{ name: '名称', type: 'TEXT' }], rows: [], mode: 'append' }), /不一致/)
  assert.throws(() => importTable({ file: FILE, table: '不存在', columns: cols, rows: [], mode: 'append' }), /表不存在/)
  const rep = importTable({ file: FILE, table: '库存', columns: [{ name: 'x', type: 'REAL' }], rows: [[1.5], [2.5]], mode: 'replace', source: 'c.csv' })
  assert.equal(rep.rows, 2)
  r = await driver.query('SELECT * FROM "库存"', { timeoutMs: 5000, maxRows: 10 })
  assert.deepEqual(r.columns.map(c => c.name), ['x'])
  const meta = listTables({ file: FILE }).find(t => t.name === '库存')
  assert.equal(meta.rows, 2)
  assert.equal(meta.source, 'c.csv')
  assert.equal(typeof meta.createdAt, 'number')
  // failed import rolls back
  assert.throws(() => importTable({ file: FILE, table: 'bad', columns: [{ name: 'a', type: 'BLOB' }], rows: [] }), /不支持的列类型/)
  assert.ok(!listTables({ file: FILE }).some(t => t.name === 'bad'))
})

await test('dropTable, listTables, fileStats', async () => {
  const before = listTables({ file: FILE })
  assert.deepEqual(Object.keys(before[0]).sort(), ['createdAt', 'name', 'rows', 'source', 'updatedAt'])
  dropTable({ file: FILE, table: '库存' })
  const after = listTables({ file: FILE })
  assert.equal(after.length, before.length - 1)
  assert.throws(() => dropTable({ file: FILE, table: '库存' }), /表不存在/)
  assert.throws(() => dropTable({ file: FILE, table: 'sqlite_master' }), /系统表/)
  assert.throws(() => dropTable({ file: FILE, table: '__nl2sql_tables' }), /系统表/)
  const st = fileStats({ file: FILE })
  assert.ok(st.bytes > 100000)
  assert.equal(st.tables, after.length)
  await assert.rejects(driver.query('SELECT * FROM "库存"', { timeoutMs: 5000, maxRows: 10 }), /no such table/)
  assert.deepEqual(fileStats({ file: `${DIR}/none.sqlite` }), { bytes: 0, tables: 0 })
  assert.deepEqual(listTables({ file: `${DIR}/none.sqlite` }), [])
})

await test('timeout: event loop stays free and caller gets query/timeout', async () => {
  await driver.query('SELECT 1', { timeoutMs: 2000, maxRows: 10 })
  const victim = driver.child
  assert.ok(victim?.pid)
  let ticks = 0
  const iv = setInterval(() => ticks++, 20)
  const t0 = Date.now()
  await assert.rejects(
    driver.query('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c WHERE x < 0', { timeoutMs: 400, maxRows: 10 }),
    e => e.code === 'query/timeout',
  )
  clearInterval(iv)
  const took = Date.now() - t0
  console.log(`  timeout after ${took}ms, ${ticks} timer ticks during query`)
  assert.ok(took < 2000)
  assert.ok(ticks >= 10)
  // the runaway (never-yielding, unbounded) statement was hard-killed
  await new Promise(r => setTimeout(r, 200))
  assert.notEqual(victim.exitCode === null && victim.signalCode === null, true, 'child still running')
  assert.throws(() => process.kill(victim.pid, 0), /ESRCH/)
  // a fresh child serves the next query
  const r = await driver.query('SELECT 1', { timeoutMs: 2000, maxRows: 10 })
  assert.deepEqual(r.rows, [[1]])
})

await test('missing file and in-process mode', async () => {
  const d = new SqliteDriver({ file: `${DIR}/none.sqlite` })
  await assert.rejects(d.query('SELECT 1', { timeoutMs: 1000, maxRows: 1 }), /数据文件不存在/)
  await d.close()
  const local = new SqliteDriver({ file: FILE, worker: false })
  const r = await local.query('SELECT COUNT(*) FROM "销售_订单_2024"', { timeoutMs: 1000, maxRows: 1 })
  assert.equal(r.rows[0][0], N)
  await assert.rejects(local.query('DELETE FROM users', { timeoutMs: 1000, maxRows: 1 }), /只读/)
  await local.close()
})

await test('dialect hints', () => {
  assert.match(sqliteDialectHints, /strftime\('%Y-%m', col\)/)
  assert.match(sqliteDialectHints, /RIGHT \/ FULL OUTER JOIN are supported/)
})

await test('close', async () => {
  await driver.close()
  await driver.close()
})

summary('sqlite-driver')
