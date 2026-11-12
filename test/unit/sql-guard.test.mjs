// sql-guard.js: read-only admission and LIMIT/timeout injection for every dialect.
// Ported from an earlier standalone script, guard2.mjs and sqlitefile/guard/guard.test.mjs.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin, tempDir } from '../lib/env.mjs'

const { admitSql, prepareSql } = await plugin('sql-guard.js')
const admits = (sql, dialect) => { try { admitSql(sql, dialect ? { dialect } : undefined); return true } catch { return false } }

// ------------------------------------------------------------------ MySQL (default dialect)
const mysqlOk = [
  ['select * from t', "SELECT /*+ MAX_EXECUTION_TIME(15000) */ * from t\nLIMIT 501"],
  ["SELECT REPLACE(name,'a','b') FROM t;", "SELECT /*+ MAX_EXECUTION_TIME(15000) */ REPLACE(name,'a','b') FROM t\nLIMIT 501"],
  ["select 'delete from x' as s", "SELECT /*+ MAX_EXECUTION_TIME(15000) */ 'delete from x' as s\nLIMIT 501"],
  ['show tables', 'show tables'],
  ['desc users', 'desc users'],
  ['explain select 1', 'explain select 1'],
  ['select * from t limit 10', 'SELECT /*+ MAX_EXECUTION_TIME(15000) */ * from t limit 10'],
  ['SELECT CONVERT(x USING utf8) , CAST(a AS CHAR CHARACTER SET utf8mb4) from t', 'SELECT /*+ MAX_EXECUTION_TIME(15000) */ CONVERT(x USING utf8) , CAST(a AS CHAR CHARACTER SET utf8mb4) from t\nLIMIT 501'],
  ['(select 1) union (select 2)', '(SELECT /*+ MAX_EXECUTION_TIME(15000) */ 1) union (select 2)\nLIMIT 501'],
  ['select `update` from t -- drop\n', 'SELECT /*+ MAX_EXECUTION_TIME(15000) */ `update` from t -- drop\nLIMIT 501'],
  ["select insert('abc',1,1,'x')", "SELECT /*+ MAX_EXECUTION_TIME(15000) */ insert('abc',1,1,'x')\nLIMIT 501"],
]
const mysqlBad = [
  ['delete from t', /only read-only statements/],
  ['select 1; drop table t', /only one statement/],
  ["select * from t into outfile '/tmp/x'", /INTO OUTFILE/],
  ['select sleep(10)', /time-wasting/],
  ['select * from t for update', /FOR UPDATE/],
  ['/*!50000 drop table t*/ select 1', /executable comments/],
  ['update t set a=1', /got UPDATE/],
  ['select 1 into @a', /INTO @variable/],
  ['set names utf8', /got SET/],
  ['select * from t where id in (select id from t2); delete from t', /only one statement/],
]
await test('mysql: read-only statements admitted and prepared (hint + LIMIT maxRows+1)', () => {
  for (const [sql, expected] of mysqlOk) assert.equal(prepareSql(admitSql(sql), { maxRows: 500, timeoutMs: 15000 }), expected, sql)
})
await test('mysql: writes, multi-statements, locks, files and sleeps refused', () => {
  for (const [sql, msg] of mysqlBad) assert.throws(() => admitSql(sql), msg, sql)
})

// ------------------------------------------------------------------ dialect matrix
const matrix = [
  ['mysql', 'select * from t', true], ['mysql', 'select * from t for update', false],
  ['postgres', 'select * from t', true], ['postgres', 'with a as (select 1) select * from a', true],
  ['postgres', 'select pg_sleep(5)', false], ['postgres', 'select * into t2 from t', false], ['postgres', 'select * from t for share', false],
  ['postgres', 'explain analyze select 1', false], ['postgres', 'explain select 1', true], ['postgres', "select nextval('s')", false],
  ['postgres', "select date_trunc('day', created_at), count(*) filter (where status = 1) from orders group by 1", true],
  ['postgres', 'select * from t lock', false], ['postgres', "copy t to '/tmp/x'", false], ['postgres', "select set_config('a','b',false)", false],
  ['elasticsearch', 'select count(*) from "logs-*" group by status', true], ['elasticsearch', 'show tables', true], ['elasticsearch', 'delete from x', false],
  ['mysql', 'select replace(a,1,2) from t', true],
]
await test('dialect matrix: mysql / postgres / elasticsearch admission', () => {
  const wrong = matrix.filter(([d, sql, ok]) => admits(sql, d) !== ok).map(([d, sql, ok]) => `${d}: ${sql} (expected ${ok ? 'admit' : 'deny'})`)
  assert.deepEqual(wrong, [])
})
await test('postgres / elasticsearch prepareSql', () => {
  assert.equal(prepareSql(admitSql('select 1', { dialect: 'postgres' }), { maxRows: 10, timeoutMs: 1000, dialect: 'postgres' }), 'select 1\nLIMIT 11')
  assert.equal(prepareSql(admitSql('select 1', { dialect: 'elasticsearch' }), { maxRows: 10, timeoutMs: 1000, dialect: 'elasticsearch' }), 'select 1')
})

// ------------------------------------------------------------------ SQLite
const d = 'sqlite'
await test('sqlite admits reads', () => {
  for (const s of ['SELECT 1', 'WITH a AS (SELECT 1) SELECT * FROM a', 'VALUES (1),(2)', 'EXPLAIN QUERY PLAN SELECT * FROM t', "SELECT replace(name,'a','b'), strftime('%Y-%m', d) FROM t", "SELECT 'it''s # not a comment', 'a\\' FROM t", 'SELECT "insert" FROM t']) admitSql(s, { dialect: d })
})
await test('sqlite refuses writes, pragmas, attach, file functions', () => {
  for (const s of ["ATTACH 'x' AS y", 'PRAGMA writable_schema=1', 'SELECT * FROM pragma_table_info(1); PRAGMA user_version=1', "SELECT load_extension('x')", "SELECT readfile('/etc/passwd')", "SELECT writefile('/tmp/x','y')", 'SELECT edit(1)', "SELECT fts3_tokenizer('x')", 'EXPLAIN SELECT 1', 'VACUUM', "VACUUM INTO '/tmp/x'", 'DELETE FROM t', 'INSERT INTO t VALUES (1)', 'WITH a AS (SELECT 1) DELETE FROM t', 'UPDATE t SET a=1 RETURNING *', 'CREATE TABLE x(a)', 'DROP TABLE t', 'BEGIN', "SELECT 'a\\'; DROP TABLE t; --'", 'SELECT 1 # comment\n; DROP TABLE t', 'REINDEX', 'DETACH x'])
    assert.throws(() => admitSql(s, { dialect: d }), undefined, s)
})
await test('sqlite LIMIT injection like postgres', () => {
  assert.equal(prepareSql(admitSql('SELECT * FROM t', { dialect: d }), { maxRows: 100, timeoutMs: 1000, dialect: d }), 'SELECT * FROM t\nLIMIT 101')
  assert.equal(prepareSql(admitSql('WITH a AS (SELECT 1) SELECT * FROM a', { dialect: d }), { maxRows: 5, timeoutMs: 1000, dialect: d }), 'WITH a AS (SELECT 1) SELECT * FROM a\nLIMIT 6')
  assert.equal(prepareSql(admitSql('SELECT * FROM t LIMIT 3', { dialect: d }), { maxRows: 5, timeoutMs: 1000, dialect: d }), 'SELECT * FROM t LIMIT 3')
})

// Frozen decisions per dialect. PostgreSQL changed on purpose: it has no backslash
// escapes in plain strings, so `'a\';` ends the string and the `;` is a second statement.
const regression = ["SELECT 'a\\'; DROP TABLE t; --'", 'SELECT 1 # x', 'SELECT 1; SELECT 2', 'EXPLAIN SELECT 1', 'PRAGMA x', 'WITH a AS (SELECT 1) SELECT 1', 'SELECT load_extension(1)', 'SHOW TABLES', "SELECT replace(a,'x','y') FROM t", 'DELETE FROM t', 'VALUES (1)', 'SELECT * FROM t LIMIT 5']
const frozen = {
  mysql: [true, true, false, true, false, true, true, true, true, false, false, true],
  postgres: [false, true, false, true, false, true, true, true, true, false, true, true],
  elasticsearch: [false, true, false, false, false, false, true, true, true, false, false, true],
}
await test('non-sqlite dialects unchanged vs pre-sqlite guard', () => {
  for (const [dialect, want] of Object.entries(frozen)) assert.deepEqual(regression.map((c) => admits(c, dialect)), want, dialect)
})
await test('dialect lexing blocks smuggled statements (review findings)', () => {
  const deny = [
    ['postgres', "SELECT 'a\\'; COMMIT; CREATE TABLE t(x int); SELECT 'b'"],
    ['postgres', 'SELECT 1 # 1; COMMIT; DROP TABLE x'],
    ['postgres', "SELECT $$'$$; DROP TABLE x; SELECT $$'$$"],
    ['postgres', "SELECT $t$ ; $t$; DROP TABLE x"],
    ['postgres', "SELECT query_to_xml('select 1', true, false, '')"],
    ['postgres', "SELECT 'unterminated"],
    ['sqlite', "SELECT 'a\\'; DROP TABLE x"],
  ]
  for (const [d, q] of deny) assert.equal(admits(q, d), false, `${d}: ${q}`)
  const allow = [['postgres', "SELECT E'a\\'b' AS x"], ['postgres', 'SELECT $$a;b$$ AS x'], ['mysql', "SELECT 'a\\'b' AS x"], ['mysql', 'SELECT 1--1'], ['postgres', 'SELECT $1::int']]
  for (const [d, q] of allow) assert.equal(admits(q, d), true, `${d}: ${q}`)
})
await test('prepared SQL runs on the SQLite driver', async () => {
  const { SqliteDriver, importTable } = await plugin('sqlite-driver.js')
  const file = `${tempDir('guard')}/g.sqlite`
  importTable({ file, table: 't', columns: [{ name: 'a', type: 'INTEGER' }], rows: Array.from({ length: 50 }, (_, i) => [i]), mode: 'replace' })
  const drv = new SqliteDriver({ file })
  try {
    const sql = prepareSql(admitSql('WITH x AS (SELECT a FROM t) SELECT * FROM x -- trailing', { dialect: d }), { maxRows: 10, timeoutMs: 1000, dialect: d })
    const r = await drv.query(sql, { timeoutMs: 2000, maxRows: 10 })
    assert.equal(r.rows.length, 11)
  } finally { await drv.close() }
})

await test('mysql `--` starts a comment only before a char <= 0x20 or end of input', async () => {
  const { lexSql, dashDashCommentFollower } = await plugin('sql-guard.js')
  const kinds = (sql, dialect = 'mysql') => lexSql(sql, { dialect }).segments.map(s => s.kind)
  for (const ch of [' ', '\t', '\n', '\v', '\f', '\x01', '\x1f', undefined]) assert.equal(dashDashCommentFollower(ch), true, JSON.stringify(ch))
  for (const ch of ['\u00a0', '\u2000', '\u3000', '\ufeff', '1', 'a']) assert.equal(dashDashCommentFollower(ch), false, JSON.stringify(ch))
  // U+00A0 after `--` is NOT a comment in MySQL (JS \s says it is)
  assert.deepEqual(kinds('select 1 --\u00a0x'), ['code'])
  // a control char after `--` IS a comment in MySQL
  assert.deepEqual(kinds("select 1 --\x01 'x"), ['code', 'comment'])
  assert.deepEqual(kinds('select 1--1'), ['code'])
  assert.deepEqual(kinds('select 1--'), ['code', 'comment'])
  // PostgreSQL / SQLite / ES: `--` always starts a comment
  for (const d of ['postgres', 'sqlite', 'elasticsearch']) assert.deepEqual(kinds('select 1--1', d), ['code', 'comment'], d)
})
await test('control and non-ASCII whitespace refused outside literals, every dialect', () => {
  for (const d of ['mysql', 'postgres', 'sqlite', 'elasticsearch']) {
    for (const ch of ['\u00a0', '\u2028', '\u3000', '\ufeff', '\x01', '\x1f', '\x0b', '\x0c', '\x00', '\u200b']) {
      assert.throws(() => admitSql(`select 1 as a${ch}from t`, { dialect: d }), /U\+/, `${d} ${JSON.stringify(ch)}`)
    }
    // still fine inside strings and quoted identifiers, and \t \n \r are fine
    assert.equal(admits("select 'a\u00a0b\x01' as x\t\r\nfrom t", d), true, d)
  }
  assert.equal(admits('select `a\u00a0b` from t', 'mysql'), true)
  assert.equal(admits('select "a\u3000b" from t', 'postgres'), true)
  // the reported bypasses
  assert.throws(() => admitSql("SELECT 1 AS \u00a0 FROM wallets HAVING 0--\u00a0 UNION ALL SELECT count(*) FROM callback_configs"), /U\+00A0/)
  assert.throws(() => admitSql("SELECT 1 AS x --\u0001 '\nUNION ALL SELECT count(*) FROM callback_configs -- '"), /U\+0001/)
})

summary('sql-guard')
