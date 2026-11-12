// filters.js: dashboard filters injected into widget SQL.
// Ported from an earlier standalone script (which only printed) with assertions on the generated SQL.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { applyFilters, normalizeFilters } = await plugin('filters.js')

const schema = { tables: [
  { name: 'orders', role: 'fact', columns: [{ name: 'id' }, { name: 'created_at' }, { name: 'status' }, { name: 'amount' }, { name: 'user_id' }] },
  { name: 'users', role: 'dimension', columns: [{ name: 'id' }, { name: 'created_at' }, { name: 'city' }] },
  { name: 'nl.orders', role: 'fact', columns: [{ name: 'created_at' }, { name: 'status' }] },
  { name: 'app-logs', role: 'log', columns: [{ name: '@timestamp' }, { name: 'level' }] },
] }
const now = new Date(2026, 10, 11, 12) // local time → last7d = [11-05, 11-12)
const f = normalizeFilters([{ kind: 'time', column: 'created_at', range: 'last7d' }, { kind: 'in', column: 'status', values: ['1', "o'k"] }, { kind: 'in', column: 'city', values: ['北京'] }])
const run = (dialect, sql) => {
  const r = applyFilters(sql, f, { dialect, schema, now })
  return { sql: r.sql, applied: r.applied.map((a) => `${a.column}@${a.table}`), skipped: r.skipped.map((s) => `${s.column}:${s.reason}`) }
}
const MY_TIME = "`orders`.`created_at` >= '2026-11-05 00:00:00' AND `orders`.`created_at` < '2026-11-12 00:00:00'"
const MY_STATUS = "`orders`.`status` IN ('1', 'o''k')"

await test('mysql: WHERE inserted before GROUP BY, quotes escaped, foreign column skipped', () => {
  const r = run('mysql', 'SELECT DATE(created_at) d, COUNT(*) n FROM orders GROUP BY d ORDER BY d')
  assert.equal(r.sql, `SELECT DATE(created_at) d, COUNT(*) n FROM orders WHERE ${MY_TIME} AND ${MY_STATUS} GROUP BY d ORDER BY d`)
  assert.deepEqual(r.applied, ['created_at@orders', 'status@orders'])
  assert.deepEqual(r.skipped, ['city:column not in query tables'])
})
await test('mysql: join uses aliases, fact table wins for shared column, existing WHERE parenthesised', () => {
  const r = run('mysql', 'select o.status, count(*) from orders o join users u on u.id = o.user_id where o.amount > 0 group by o.status limit 10')
  assert.ok(r.sql.includes("WHERE (`o`.`created_at` >= '2026-11-05 00:00:00' AND `o`.`created_at` < '2026-11-12 00:00:00' AND `o`.`status` IN ('1', 'o''k') AND `u`.`city` IN ('北京')) AND (o.amount > 0) group by o.status limit 10"), r.sql)
  assert.deepEqual(r.applied, ['created_at@orders', 'status@orders', 'city@users'])
  assert.deepEqual(r.skipped, [])
})
await test('mysql: OR in existing WHERE is wrapped', () => {
  const r = run('mysql', 'select * from orders where amount > 1 or amount < 0')
  assert.equal(r.sql, `select * from orders WHERE (${MY_TIME} AND ${MY_STATUS}) AND (amount > 1 or amount < 0)`)
})
await test('postgres: schema-qualified table', () => {
  const r = run('postgres', 'select status, count(*) from nl.orders group by 1')
  assert.equal(r.sql, `select status, count(*) from nl.orders WHERE "nl"."orders"."created_at" >= '2026-11-05 00:00:00' AND "nl"."orders"."created_at" < '2026-11-12 00:00:00' AND "nl"."orders"."status" IN ('1', 'o''k') group by 1`)
  assert.deepEqual(r.applied, ['created_at@nl.orders', 'status@nl.orders'])
})
await test('postgres: CTE body untouched, outer query filtered', () => {
  const r = run('postgres', 'with x as (select * from orders where amount > 5) select count(*) from orders o where o.id in (select id from x)')
  assert.ok(r.sql.startsWith('with x as (select * from orders where amount > 5) select count(*) from orders o WHERE ("o"."created_at" >='), r.sql)
  assert.ok(r.sql.endsWith(`"o"."status" IN ('1', 'o''k')) AND (o.id in (select id from x))`), r.sql)
})
await test('unsupported shapes (UNION, derived table) are left unchanged and reported', () => {
  for (const [d, sql] of [['postgres', 'select 1 union select 2'], ['mysql', 'select count(*) from (select * from orders) t']]) {
    const r = run(d, sql)
    assert.equal(r.sql, sql)
    assert.deepEqual(r.applied, [])
    assert.deepEqual(r.skipped, ['created_at:unsupported query shape', 'status:unsupported query shape', 'city:unsupported query shape'])
  }
})
await test('elasticsearch: date-only bounds, quoted index & columns', () => {
  const es = applyFilters('SELECT level, COUNT(*) AS n FROM "app-logs" GROUP BY level', normalizeFilters([{ kind: 'time', column: '@timestamp', range: 'yesterday' }, { kind: 'in', column: 'level', values: ['ERROR'] }]), { dialect: 'elasticsearch', schema, now })
  assert.equal(es.sql, `SELECT level, COUNT(*) AS n FROM "app-logs" WHERE "@timestamp" >= '2026-11-10' AND "@timestamp" < '2026-11-11' AND "level" IN ('ERROR') GROUP BY level`)
})
await test('normalizeFilters drops junk', () => {
  const n = normalizeFilters([{ kind: 'nope' }, null, { kind: 'in', column: 'a', values: [] }, { kind: 'time', column: 'c', range: 'last7d' }])
  assert.ok(Array.isArray(n))
  assert.ok(n.some((x) => x.kind === 'time' && x.column === 'c'))
  assert.ok(!n.some((x) => x?.kind === 'nope'))
})

summary('filters')
