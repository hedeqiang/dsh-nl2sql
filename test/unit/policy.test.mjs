// policy.js: table allow/deny lists, hidden and masked columns.
// Ported from an earlier standalone script (print-only checks turned into assertions).
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { normalizePolicy, checkAccess, filterSchema, referencedTables, analyzeIdentifiers, resultColumnPolicy } = await plugin('policy.js')

const schema = { tables: [
  { name: 'orders', columns: [{ name: 'id', roles: [] }, { name: 'amount', roles: [] }, { name: 'user_id', roles: [] }], indexes: [] },
  { name: 'users', columns: [{ name: 'id', roles: [] }, { name: 'name', roles: [] }, { name: 'salary', roles: [] }, { name: 'phone', roles: [] }], indexes: [] },
  { name: 'hr_payroll', columns: [{ name: 'id', roles: [] }], indexes: [] },
  { name: 'sales.leads', columns: [{ name: 'id', roles: [] }], indexes: [] },
  { name: 'app-logs', columns: [{ name: 'level', roles: [] }], indexes: [] },
  { name: 'secret-logs', columns: [{ name: 'level', roles: [] }], indexes: [] },
], relations: [{ from: { table: 'orders', column: 'user_id' }, to: { table: 'users', column: 'id' } }] }
const deny = normalizePolicy({ mode: 'deny', tables: 'hr_*\nsecret-*', hiddenColumns: ['users.salary'], maskedColumns: ['*.phone'] })
const allow = normalizePolicy({ mode: 'allow', tables: ['orders', 'users', 'sales.*', 'app-*'] })
const head = (sql) => sql.trim().split(/\s+/)[0].toUpperCase()

const cases = [
  [deny, 'select * from orders', true],
  [deny, 'select * from hr_payroll', false],
  [deny, 'select * from `db`.`hr_payroll` p', false],
  [deny, 'select name, salary from users', false],
  [deny, 'select u.name from users u where u.salary > 10', false],
  [deny, "select name from users where name = 'salary'", true],
  [deny, 'select * from users', true],
  [deny, 'select row_to_json(u) from users u', false],
  [deny, 'select table_name from information_schema.tables', false],
  [deny, 'select * from pg_catalog.pg_class', false],
  [deny, 'select * from pg_tables', false],
  [deny, 'select level from "secret-logs"', false, 'elasticsearch'],
  [deny, 'select level from secret-logs', false, 'elasticsearch'],
  [deny, 'select level from "*-logs"', false, 'elasticsearch'],
  [deny, 'select level from "app-logs"', true, 'elasticsearch'],
  [allow, 'select o.amount, u.name from orders o join users u on u.id = o.user_id', true],
  [allow, 'select * from hr_payroll', false],
  [allow, 'select * from sales.leads', true],
  [allow, 'select * from new_table', false],
  [allow, 'show tables', false],
  [allow, 'select * from (select id from orders) t', true],
  [allow, 'select count(*) from "app-logs"', true, 'elasticsearch'],
  // bypasses found in review: lexer must follow each dialect
  [deny, 'select 1--1, t.* from hr_payroll t', false, 'mysql'],
  [deny, 'select 1--1, table_name from information_schema.tables', false, 'mysql'],
  [deny, 'select table_name from information_schema . tables', false, 'mysql'],
  [deny, 'select 1 # 1 as z, * from hr_payroll', false, 'postgres'],
  [deny, "select 'a\\' as z, * from hr_payroll -- '", false, 'postgres'],
  [deny, "select $$'$$ as z, * from hr_payroll -- '", false, 'postgres'],
  [deny, 'select * from hr_payroll_2026', false, 'mysql'],
  [deny, 'select u::text from users u', false, 'postgres'],
  [deny, 'select cast(u as text) from users u', false, 'postgres'],
  [deny, 'select format($1, u) from users u', false, 'postgres'],
  [deny, 'select row(u.*) from users u', false, 'postgres'],
  // previously printed only
  [allow, 'with recent as (select * from orders) select * from recent', true],
  [allow, 'select * from orders o, users u where o.user_id = u.id', true],
  [allow, 'select * from orders where id in (select user_id from orders)', true],
  [allow, 'select * from generate_series(1,3)', true],
  [allow, 'select * from orders o, hr_payroll h', false],
  [allow, 'with a as (select 1), b as (select * from hr_payroll) select * from a, b', false],
  [allow, 'select * from orders o, new_table n', false],
]

await test(`checkAccess decision table (${cases.length} cases)`, () => {
  const wrong = []
  for (const [p, sql, ok, dialect = 'postgres'] of cases) {
    const r = checkAccess(sql, p, schema, head(sql), { dialect })
    if ((r === undefined) !== ok) wrong.push(`${p.mode}/${dialect}: ${sql} → ${r ?? 'allowed'} ${JSON.stringify(analyzeIdentifiers(sql, { dialect }))}`)
  }
  assert.deepEqual(wrong, [])
})
await test('denial messages name the table / explain unknown tables', () => {
  assert.match(checkAccess('select * from orders o, hr_payroll h', allow, schema, 'SELECT'), /无权查询表：hr_payroll/)
  assert.match(checkAccess('with a as (select 1), b as (select * from hr_payroll) select * from a, b', allow, schema, 'SELECT'), /hr_payroll/)
  assert.match(checkAccess('select * from orders o, new_table n', allow, schema, 'SELECT'), /未授权或未分析的表：new_table/)
})
await test('filterSchema removes denied tables, hides & marks masked columns', () => {
  const fs = filterSchema(schema, deny)
  assert.deepEqual(fs.tables.map((t) => t.name), ['orders', 'users', 'sales.leads', 'app-logs'])
  const users = fs.tables.find((t) => t.name === 'users')
  assert.deepEqual(users.columns.map((c) => c.name + (c.roles.includes('sensitive') ? '*' : '')), ['id', 'name', 'phone*'])
})
await test('referencedTables', () => {
  assert.deepEqual(referencedTables('select * from orders o join users u on 1=1', schema.tables), ['orders', 'users'])
})
await test('resultColumnPolicy: drop hidden, mask masked', () => {
  const r = resultColumnPolicy(deny, [{ name: 'id' }, { name: 'salary' }, { name: 'phone' }], ['users'], schema)
  assert.deepEqual(Object.values(r).map((s) => [...s]), [[1], [2]])
})

summary('policy')
