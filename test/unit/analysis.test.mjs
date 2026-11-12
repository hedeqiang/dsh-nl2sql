// analysis.js: SELECT parsing, drill-down/breakdown/metric/attribution SQL builders, alerts, result comparison.
// Ported from an earlier standalone script
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
const {
  parseSelect, aliasExpr, buildDetailSql, buildBreakdownSql, buildMetricSql, timeBucket,
  buildAttributionSql, computeAttribution, rankDimensions, isAdditive, evaluateAlert, compareResults, scoreSql,
  quoteIdent, quoteName, quoteString, literalFor,
} = await plugin('analysis.js')

const { equal, deepEqual, ok } = assert

// ---------------------------------------------------------------- quoting
await test('quoteIdent dialects', () => {
  equal(quoteIdent('a`b', 'mysql'), '`a``b`')
  equal(quoteIdent('a"b', 'postgres'), '"a""b"')
  equal(quoteName('s.t', 'postgres'), '"s"."t"')
  equal(quoteName('s.t', 'sqlite'), '"s"."t"')
  equal(quoteName('s.t', 'mysql'), '`s`.`t`')
  equal(quoteName('logs-2024.01', 'elasticsearch'), '"logs-2024.01"')
})
await test('quoteString / literalFor', () => {
  equal(quoteString("it's \\", 'mysql'), "'it''s \\\\'")
  equal(quoteString("it's \\", 'postgres'), "'it''s \\'")
  equal(literalFor(3, 'mysql'), '3')
  equal(literalFor(1.5, 'postgres', 't.amount'), '1.5')
  equal(literalFor(2024, 'mysql', "DATE_FORMAT(c, '%Y')"), "'2024'")
  equal(literalFor(NaN, 'mysql'), "'NaN'")
  equal(literalFor(null, 'mysql'), 'NULL')
  equal(literalFor('x', 'mysql'), "'x'")
  equal(literalFor(new Date(2026, 0, 2), 'mysql'), "'2026-01-02'")
  equal(literalFor(new Date(2026, 0, 2, 3, 4, 5), 'mysql'), "'2026-01-02 03:04:05'")
})

// ---------------------------------------------------------------- parseSelect
await test('parseSelect basic grouped', () => {
  const p = parseSelect('SELECT chain, COUNT(*) AS n FROM blockchain_transactions WHERE status = 1 GROUP BY chain HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10;')
  equal(p.prefix, '')
  deepEqual(p.select, [{ expr: 'chain', isAggregate: false }, { expr: 'COUNT(*)', alias: 'n', isAggregate: true }])
  equal(p.from, 'blockchain_transactions')
  equal(p.where, 'status = 1')
  equal(p.groupBy, 'chain')
  equal(p.having, 'COUNT(*) > 1')
  equal(p.orderBy, 'n DESC')
  equal(p.limit, '10')
  equal(p.distinct, false)
})
await test('parseSelect alias without AS + quoted aliases', () => {
  const p = parseSelect('select DATE(created_at) d, COUNT(*) n, SUM(amount) AS "总额", MAX(x) `m x`, token \'tk\' from t')
  deepEqual(p.select.map(s => [s.expr, s.alias, s.isAggregate]), [
    ['DATE(created_at)', 'd', false], ['COUNT(*)', 'n', true], ['SUM(amount)', '总额', true], ['MAX(x)', 'm x', true], ['token', 'tk', false]])
})
await test('parseSelect CASE END without alias, with alias', () => {
  const p = parseSelect("SELECT CASE WHEN a > 1 THEN 'x' ELSE 'y' END, CASE WHEN b THEN 1 END AS c2, CASE a WHEN 1 THEN 2 END c3 FROM t")
  equal(p.select[0].alias, undefined)
  equal(p.select[0].expr, "CASE WHEN a > 1 THEN 'x' ELSE 'y' END")
  equal(p.select[1].alias, 'c2')
  equal(p.select[2].alias, 'c3')
  equal(p.select[2].expr, 'CASE a WHEN 1 THEN 2 END')
})
await test('parseSelect no false aliases', () => {
  const p = parseSelect("SELECT a + b, x IS NULL, x::int, NOW() - INTERVAL 1 DAY, t.col, -1, created_at AT TIME ZONE 'UTC', a DESC_not FROM t")
  deepEqual(p.select.map(s => s.alias), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'DESC_not'])
})
await test('parseSelect quotes containing keywords and commas', () => {
  const p = parseSelect("SELECT 'a, FROM b' AS s, \"we,ird\" , `x FROM` FROM `my table` WHERE c = 'GROUP BY ''x''' ORDER BY 1")
  equal(p.select.length, 3)
  equal(p.select[0].alias, 's')
  equal(p.select[1].expr, '"we,ird"')
  equal(p.from, '`my table`')
  equal(p.where, "c = 'GROUP BY ''x'''")
  equal(p.orderBy, '1')
})
await test('parseSelect comments', () => {
  const p = parseSelect('SELECT a, -- FROM x\n /* , FROM y */ b # where\nFROM t -- trailing\nWHERE a > 1 /* LIMIT 5 */')
  equal(p.select.length, 2)
  equal(p.select[1].expr, 'b')
  equal(p.from.startsWith('t'), true)
  ok(!p.limit)
})
await test('parseSelect subqueries in select list and FROM', () => {
  const p = parseSelect('SELECT u.id, (SELECT COUNT(*) FROM o WHERE o.uid = u.id) AS cnt, x.s FROM users u JOIN (SELECT uid, SUM(v) s FROM o GROUP BY uid) x ON x.uid = u.id WHERE u.id IN (SELECT id FROM vip) ORDER BY cnt')
  deepEqual(p.select.map(s => [s.alias, s.isAggregate]), [[undefined, false], ['cnt', false], [undefined, false]])
  equal(p.from, 'users u JOIN (SELECT uid, SUM(v) s FROM o GROUP BY uid) x ON x.uid = u.id')
  equal(p.where, 'u.id IN (SELECT id FROM vip)')
  equal(p.groupBy, undefined)
})
await test('parseSelect CTE prefix', () => {
  const sql = 'WITH a AS (SELECT chain, amount FROM t WHERE status = 1), b AS (SELECT * FROM a) SELECT chain, SUM(amount) total FROM b GROUP BY chain'
  const p = parseSelect(sql)
  equal(p.prefix, 'WITH a AS (SELECT chain, amount FROM t WHERE status = 1), b AS (SELECT * FROM a)')
  equal(p.from, 'b')
  equal(p.select[1].alias, 'total')
  ok(p.select[1].isAggregate)
})
await test('parseSelect DISTINCT', () => {
  const p = parseSelect('SELECT DISTINCT chain, token FROM t')
  equal(p.distinct, true)
  equal(p.select.length, 2)
  const q = parseSelect('SELECT COUNT(DISTINCT chain) AS c FROM t')
  equal(q.distinct, false)
  ok(q.select[0].isAggregate)
})
await test('parseSelect nested functions & aggregates', () => {
  const p = parseSelect('SELECT ROUND(SUM(amount) / NULLIF(COUNT(*),0), 2) avg_amt, COALESCE(MAX(x), 0) AS mx, UPPER(LEFT(name, 3)) nm, percentile_cont(0.5) WITHIN GROUP (ORDER BY v) med, stddev(v), sum(v) OVER (PARTITION BY k) w FROM t')
  deepEqual(p.select.map(s => [s.alias, s.isAggregate]), [['avg_amt', true], ['mx', true], ['nm', false], ['med', true], [undefined, true], ['w', false]])
})
await test('parseSelect EXTRACT FROM / IS DISTINCT FROM not confused', () => {
  const p = parseSelect('SELECT EXTRACT(YEAR FROM created_at) y, a IS DISTINCT FROM b AS z FROM t WHERE SUBSTRING(s FROM 1 FOR 2) = \'ab\'')
  equal(p.select[0].alias, 'y')
  equal(p.select[1].alias, 'z')
  equal(p.from, 't')
  equal(p.where, "SUBSTRING(s FROM 1 FOR 2) = 'ab'")
})
await test('parseSelect PG dotted & quoted names', () => {
  const p = parseSelect('SELECT "s"."t"."col" AS c, public.orders.amount FROM "s"."t" JOIN public.orders ON true LIMIT 5 OFFSET 10')
  equal(p.select[0].alias, 'c')
  equal(p.select[1].expr, 'public.orders.amount')
  equal(p.from, '"s"."t" JOIN public.orders ON true')
  equal(p.limit, '5 OFFSET 10')
})
await test('parseSelect ES quoting & HISTOGRAM', () => {
  const p = parseSelect('SELECT HISTOGRAM("@timestamp", INTERVAL 1 DAY) AS "day", COUNT(*) AS "n" FROM "logs-*" WHERE "status" = 500 GROUP BY "day"', { dialect: 'elasticsearch' })
  equal(p.select[0].alias, 'day')
  equal(p.from, '"logs-*"')
  equal(p.groupBy, '"day"')
})
await test('parseSelect sqlite strftime', () => {
  const p = parseSelect("SELECT strftime('%Y-%m', created_at) AS m, total(x) FROM t GROUP BY 1", { dialect: 'sqlite' })
  equal(p.select[0].expr, "strftime('%Y-%m', created_at)")
  ok(p.select[1].isAggregate)
})
await test('parseSelect rejects UNION/no FROM/garbage', () => {
  equal(parseSelect('SELECT 1'), undefined)
  equal(parseSelect('SELECT a FROM t UNION SELECT b FROM u'), undefined)
  equal(parseSelect('SELECT a FROM t INTERSECT SELECT b FROM u'), undefined)
  equal(parseSelect('SELECT a FROM t EXCEPT SELECT b FROM u'), undefined)
  equal(parseSelect('SELECT a FROM (SELECT b FROM u UNION ALL SELECT c FROM v) x').from, '(SELECT b FROM u UNION ALL SELECT c FROM v) x')
  equal(parseSelect('SELECT a FROM t WHERE (b = 1'), undefined)
  equal(parseSelect("SELECT 'abc FROM t"), undefined)
  equal(parseSelect('UPDATE t SET a = 1'), undefined)
  equal(parseSelect(''), undefined)
  equal(parseSelect(null), undefined)
  equal(parseSelect('SELECT a,, b FROM t'), undefined)
  equal(parseSelect('SELECT DISTINCT ON (a) a, b FROM t'), undefined)
})
await test('parseSelect mysql backslash in strings', () => {
  const p = parseSelect("SELECT a FROM t WHERE b = 'x\\' FROM y' LIMIT 1", { dialect: 'mysql' })
  equal(p.where, "b = 'x\\' FROM y'")
  const q = parseSelect("SELECT a FROM t WHERE b = 'x\\' LIMIT 1", { dialect: 'postgres' })
  equal(q.where, "b = 'x\\'")
  equal(q.limit, '1')
})
await test('parseSelect FOR UPDATE tail / window clause', () => {
  const p = parseSelect('SELECT a FROM t WHERE x ORDER BY a LIMIT 3 FOR UPDATE')
  equal(p.limit, '3')
  equal(p.tail, 'FOR UPDATE')
})
await test('parseSelect select *', () => {
  const p = parseSelect('SELECT t.*, u.name FROM t, u')
  equal(p.select[0].expr, 't.*')
  equal(p.from, 't, u')
})

// ---------------------------------------------------------------- aliasExpr
await test('aliasExpr matching rules', () => {
  const p = parseSelect('SELECT DATE(t.created_at) AS Day, t.`chain_type`, COUNT(*) n, "x"."Weird" FROM t')
  equal(aliasExpr(p, 'Day'), 'DATE(t.created_at)')
  equal(aliasExpr(p, 'day'), 'DATE(t.created_at)')
  equal(aliasExpr(p, 'chain_type'), 't.`chain_type`')
  equal(aliasExpr(p, 'Weird'), '"x"."Weird"')
  equal(aliasExpr(p, 'N'), 'COUNT(*)')
  equal(aliasExpr(parseSelect('SELECT COUNT(*), SUM(x) FROM t'), 'count(*)'), 'COUNT(*)')
  equal(aliasExpr(p, 'nope'), undefined)
  equal(aliasExpr(undefined, 'x'), undefined)
})
await test('aliasExpr exact alias beats case-insensitive', () => {
  const p = parseSelect('SELECT a AS X, b AS x FROM t')
  equal(aliasExpr(p, 'x'), 'b')
  equal(aliasExpr(p, 'X'), 'a')
})

// ---------------------------------------------------------------- drill
const grouped = 'SELECT DATE(created_at) AS d, chain, COUNT(*) AS n, SUM(amount) total FROM blockchain_transactions WHERE status = 1 GROUP BY DATE(created_at), chain ORDER BY d LIMIT 100'
await test('buildDetailSql with where', () => {
  const r = buildDetailSql({ sql: grouped, dialect: 'mysql', xColumn: 'd', xValue: '2026-01-02' })
  equal(r.sql, "SELECT * FROM blockchain_transactions WHERE (status = 1) AND DATE(created_at) = '2026-01-02' LIMIT 100")
})
await test('buildDetailSql no where, numeric, limit, CTE', () => {
  const r = buildDetailSql({ sql: 'WITH x AS (SELECT * FROM t) SELECT status, COUNT(*) FROM x GROUP BY status', dialect: 'postgres', xColumn: 'status', xValue: 2, limit: 5 })
  equal(r.sql, 'WITH x AS (SELECT * FROM t) SELECT * FROM x WHERE status = 2 LIMIT 5')
})
await test('buildDetailSql null → IS NULL; quoting mysql', () => {
  equal(buildDetailSql({ sql: 'SELECT token, COUNT(*) FROM t GROUP BY token', dialect: 'mysql', xColumn: 'token', xValue: null }).sql, 'SELECT * FROM t WHERE token IS NULL LIMIT 100')
  equal(buildDetailSql({ sql: 'SELECT token, COUNT(*) FROM t GROUP BY token', dialect: 'mysql', xColumn: 'token', xValue: "o'\\x" }).sql, "SELECT * FROM t WHERE token = 'o''\\\\x' LIMIT 100")
})
await test('buildDetailSql complex expr gets parens', () => {
  const r = buildDetailSql({ sql: 'SELECT a + b AS s, COUNT(*) FROM t GROUP BY a + b', dialect: 'postgres', xColumn: 's', xValue: 3 })
  equal(r.sql, 'SELECT * FROM t WHERE (a + b) = 3 LIMIT 100')
})
await test('buildDetailSql string-producing expr quotes numbers', () => {
  const r = buildDetailSql({ sql: "SELECT DATE_FORMAT(created_at, '%Y') y, COUNT(*) FROM t GROUP BY y", dialect: 'mysql', xColumn: 'y', xValue: 2026 })
  equal(r.sql, "SELECT * FROM t WHERE DATE_FORMAT(created_at, '%Y') = '2026' LIMIT 100")
})
await test('buildDetailSql errors', () => {
  ok(buildDetailSql({ sql: grouped, dialect: 'mysql', xColumn: 'n', xValue: 3 }).error.includes('聚合'))
  ok(buildDetailSql({ sql: grouped, dialect: 'mysql', xColumn: 'zzz', xValue: 3 }).error.includes('找不到'))
  ok(buildDetailSql({ sql: 'SELECT 1', dialect: 'mysql', xColumn: 'a', xValue: 3 }).error)
  ok(buildDetailSql({ sql: 'SELECT a FROM t UNION SELECT a FROM u', dialect: 'mysql', xColumn: 'a', xValue: 3 }).error)
})
await test('buildDetailSql ES', () => {
  const r = buildDetailSql({ sql: 'SELECT "service", COUNT(*) AS "n" FROM "logs" WHERE "level" = \'error\' GROUP BY "service"', dialect: 'elasticsearch', xColumn: 'service', xValue: 'api' })
  equal(r.sql, 'SELECT * FROM "logs" WHERE ("level" = \'error\') AND "service" = \'api\' LIMIT 100')
})
await test('buildBreakdownSql with point', () => {
  const r = buildBreakdownSql({ sql: grouped, dialect: 'mysql', xColumn: 'd', xValue: '2026-01-02', dimension: '`token`' })
  equal(r.sql, "SELECT `token` AS `token`, COUNT(*) AS `n`, SUM(amount) AS `total` FROM blockchain_transactions WHERE (status = 1) AND DATE(created_at) = '2026-01-02' GROUP BY `token` ORDER BY `n` DESC LIMIT 20")
  deepEqual(r.measures, ['n', 'total'])
})
await test('buildBreakdownSql no point, PG qualified dim, HAVING dropped, CTE kept', () => {
  const r = buildBreakdownSql({ sql: 'WITH b AS (SELECT * FROM t) SELECT chain, AVG(amount) FROM b t GROUP BY chain HAVING COUNT(*) > 2', dialect: 'postgres', dimension: 't."chain_type"', limit: 7 })
  equal(r.sql, 'WITH b AS (SELECT * FROM t) SELECT t."chain_type" AS "chain_type", AVG(amount) AS "AVG(amount)" FROM b t GROUP BY t."chain_type" ORDER BY "AVG(amount)" DESC LIMIT 7')
})
await test('buildBreakdownSql label clash and errors', () => {
  const r = buildBreakdownSql({ sql: 'SELECT d, COUNT(*) AS chain FROM t GROUP BY d', dialect: 'postgres', dimension: '"chain"' })
  ok(r.sql.startsWith('SELECT "chain" AS "chain（维度）", COUNT(*) AS "chain"'))
  ok(buildBreakdownSql({ sql: 'SELECT a, b FROM t', dialect: 'mysql', dimension: 'c' }).error.includes('聚合'))
  ok(buildBreakdownSql({ sql: grouped, dialect: 'mysql' }).error)
})

// ---------------------------------------------------------------- metric
const metric = { name: '交易额', expression: 'SUM(amount)', table: 'blockchain_transactions', filter: 'status = 1', timeColumn: 'created_at' }
await test('timeBucket per dialect', () => {
  equal(timeBucket('`c`', 'week', 'mysql'), "DATE_FORMAT(`c`, '%x-W%v')")
  equal(timeBucket('"c"', 'day', 'postgres'), '("c")::date')
  equal(timeBucket('"c"', 'week', 'postgres'), `to_char("c", 'IYYY-"W"IW')`)
  equal(timeBucket('"c"', 'year', 'postgres'), 'EXTRACT(YEAR FROM "c")::int')
  equal(timeBucket('"c"', 'hour', 'sqlite'), "strftime('%Y-%m-%d %H:00', \"c\")")
  equal(timeBucket('"c"', 'month', 'elasticsearch'), "DATE_TRUNC('month', \"c\")")
  equal(timeBucket('c', 'minute', 'mysql'), undefined)
})
await test('buildMetricSql day grain + range', () => {
  const r = buildMetricSql({ metric, dialect: 'mysql', grain: 'day', range: 'last7d', now: new Date(2026, 0, 10, 15) })
  equal(r.sql, "SELECT DATE(`created_at`) AS `时间`, SUM(amount) AS `交易额` FROM `blockchain_transactions` WHERE (status = 1) AND `created_at` >= '2026-01-04' AND `created_at` < '2026-01-11' GROUP BY DATE(`created_at`) ORDER BY `时间` ASC LIMIT 1000")
  deepEqual(r.columns, { time: '时间', dimensions: [], value: '交易额' })
})
await test('buildMetricSql no grain, dims, filters, PG dotted table', () => {
  const r = buildMetricSql({
    metric: { name: 'n', expression: 'COUNT(DISTINCT user_id)', table: 'public.orders' }, dialect: 'postgres',
    dimensions: ['chain', 'token'],
    filters: [{ column: 'status', op: 'in', values: [1, 2] }, { column: 'chain', op: '!=', value: "o'x" }, { column: 'amount', op: '>=', value: 10 }, { column: 'memo', op: '=', value: null }],
    limit: 50,
  })
  equal(r.sql, `SELECT "chain" AS "chain", "token" AS "token", COUNT(DISTINCT user_id) AS "n" FROM "public"."orders" WHERE "status" IN (1, 2) AND "chain" != 'o''x' AND "amount" >= 10 AND "memo" IS NULL GROUP BY "chain", "token" ORDER BY "n" DESC LIMIT 50`)
  deepEqual(r.columns, { dimensions: ['chain', 'token'], value: 'n' })
})
await test('buildMetricSql explicit from/to, ES, sqlite', () => {
  const es = buildMetricSql({ metric: { name: 'hits', expression: 'COUNT(*)', table: 'logs-2026.01', timeColumn: '@timestamp' }, dialect: 'elasticsearch', grain: 'hour', from: '2026-01-01', to: '2026-01-02' })
  equal(es.sql, `SELECT DATE_TRUNC('hour', "@timestamp") AS "时间", COUNT(*) AS "hits" FROM "logs-2026.01" WHERE "@timestamp" >= '2026-01-01' AND "@timestamp" < '2026-01-02' GROUP BY DATE_TRUNC('hour', "@timestamp") ORDER BY "时间" ASC LIMIT 1000`)
  const sl = buildMetricSql({ metric: { name: 'v', expression: 'SUM(x)', table: 't', timeColumn: 'ts' }, dialect: 'sqlite', grain: 'month', dimensions: ['k'] })
  equal(sl.sql, `SELECT strftime('%Y-%m', "ts") AS "时间", "k" AS "k", SUM(x) AS "v" FROM "t" GROUP BY strftime('%Y-%m', "ts"), "k" ORDER BY "时间" ASC, "v" DESC LIMIT 1000`)
  const only = buildMetricSql({ metric: { name: 'v', expression: 'SUM(x)', table: 't', timeColumn: 'ts' }, dialect: 'mysql' })
  equal(only.sql, 'SELECT SUM(x) AS `v` FROM `t` LIMIT 1000')
})
await test('buildMetricSql custom range uses timeBounds', () => {
  const r = buildMetricSql({ metric, dialect: 'postgres', range: 'lastMonth', now: new Date(2026, 2, 15) })
  ok(r.sql.includes(`"created_at" >= '2026-02-01' AND "created_at" < '2026-03-01'`))
})
await test('buildMetricSql errors', () => {
  ok(buildMetricSql({ metric: { name: 'x', expression: 'SUM(a)', table: 't' }, grain: 'day' }).error.includes('时间列'))
  ok(buildMetricSql({ metric: { name: 'x', table: 't' } }).error.includes('表达式'))
  ok(buildMetricSql({ metric: { name: 'x', expression: 'SUM(a)' } }).error.includes('数据表'))
  ok(buildMetricSql({ metric, grain: 'minute' }).error)
  ok(buildMetricSql({ metric, range: 'bogus' }).error)
  ok(buildMetricSql({ metric, filters: [{ column: 'a', op: 'drop', value: 1 }] }).error)
  ok(buildMetricSql({ metric: { name: 'x', expression: 'SUM(a)', table: 't' }, range: 'today' }).error)
  ok(buildMetricSql({}).error)
})

// ---------------------------------------------------------------- attribution
await test('buildAttributionSql point periods', () => {
  const r = buildAttributionSql({ dialect: 'mysql', from: 't', where: 'status = 1', timeExpr: 'DATE(created_at)', measureExpr: 'SUM(amount)', dimension: '`chain`', current: '2026-01-02', baseline: '2026-01-01' })
  equal(r.sql, "SELECT `chain` AS `dim`, CASE WHEN DATE(created_at) = '2026-01-02' THEN 'current' ELSE 'baseline' END AS `period`, SUM(amount) AS `value` FROM t WHERE (status = 1) AND DATE(created_at) IN ('2026-01-02', '2026-01-01') GROUP BY `chain`, CASE WHEN DATE(created_at) = '2026-01-02' THEN 'current' ELSE 'baseline' END ORDER BY `value` DESC LIMIT 100")
})
await test('buildAttributionSql ranges, no where', () => {
  const r = buildAttributionSql({ dialect: 'postgres', from: 't', timeExpr: 'created_at', measureExpr: 'COUNT(*)', dimension: '"chain"', current: { from: '2026-02-01', to: '2026-03-01' }, baseline: { from: '2026-01-01', to: '2026-02-01' }, limit: 10 })
  equal(r.sql, `SELECT "chain" AS "dim", CASE WHEN created_at >= '2026-02-01' AND created_at < '2026-03-01' THEN 'current' ELSE 'baseline' END AS "period", COUNT(*) AS "value" FROM t WHERE ((created_at >= '2026-02-01' AND created_at < '2026-03-01') OR (created_at >= '2026-01-01' AND created_at < '2026-02-01')) GROUP BY "chain", CASE WHEN created_at >= '2026-02-01' AND created_at < '2026-03-01' THEN 'current' ELSE 'baseline' END ORDER BY "value" DESC LIMIT 20`)
  ok(buildAttributionSql({ from: 't' }).error)
  ok(buildAttributionSql({ timeExpr: 'a', measureExpr: 'b', dimension: 'c', current: 1, baseline: 0 }).error)
})
await test('computeAttribution basics', () => {
  const rows = [
    { dim: 'a', period: 'baseline', value: 10 }, { dim: 'a', period: 'current', value: 30 },
    { dim: 'b', period: 'baseline', value: '20' }, { dim: 'b', period: 'current', value: 15 },
    { dim: null, period: 'current', value: 5 },
    ['c', 'baseline', 0], ['c', 'current', 0],
  ]
  const r = computeAttribution(rows)
  deepEqual(r.total, { baseline: 30, current: 50, delta: 20, pct: 20 / 30 })
  deepEqual(r.items.map(i => i.value), ['a', 'b', null, 'c'])
  deepEqual(r.items[0], { value: 'a', baseline: 10, current: 30, delta: 20, share: 1, pct: 2 })
  equal(r.items[1].share, -0.25)
  equal(r.items[2].pct, null)
  equal(r.concentration, 1)
  equal(r.distinct, 4)
})
await test('computeAttribution zero delta → share null, concentration 0', () => {
  const r = computeAttribution([['a', 'baseline', 5], ['a', 'current', 6], ['b', 'baseline', 6], ['b', 'current', 5]])
  equal(r.total.delta, 0)
  equal(r.items[0].share, null)
  equal(r.concentration, 0)
  equal(computeAttribution([]).total.pct, null)
})
await test('computeAttribution 其他 bucket beyond top 10', () => {
  const rows = []
  for (let i = 0; i < 15; i++) { rows.push([`d${i}`, 'baseline', 100]); rows.push([`d${i}`, 'current', 100 + i + 1]) }
  const r = computeAttribution(rows)
  equal(r.items.length, 11)
  equal(r.items[10].value, '其他')
  equal(r.items[10].delta, 1 + 2 + 3 + 4 + 5)
  equal(r.items[10].count, 5)
  equal(r.items[0].value, 'd14')
  ok(Math.abs(r.concentration - (15 + 14 + 13) / 120) < 1e-12)
})
await test('rankDimensions', () => {
  const r = rankDimensions([
    { dimension: 'a', attribution: { concentration: 0.5, distinct: 3 } },
    { dimension: 'b', attribution: { concentration: 0.9, distinct: 20 } },
    { dimension: 'c', attribution: { concentration: 0.5, distinct: 2 } },
  ])
  deepEqual(r.map(x => x.dimension), ['b', 'c', 'a'])
})
await test('isAdditive', () => {
  ok(isAdditive('SUM(amount)'))
  ok(isAdditive('count(*)'))
  ok(isAdditive('SUM(a) + SUM(b)'))
  ok(!isAdditive('COUNT(DISTINCT user_id)'))
  ok(!isAdditive('count( distinct x)'))
  ok(!isAdditive('AVG(x)'))
  ok(!isAdditive('MIN(x)'))
  ok(!isAdditive('MAX(x)'))
  ok(!isAdditive('SUM(a) / COUNT(*)'))
  ok(!isAdditive('SUM(a) / NULLIF(SUM(b), 0)'))
  ok(!isAdditive('amount'))
  ok(!isAdditive(''))
})

// ---------------------------------------------------------------- alerts
const s = (...vs) => vs.map((v, i) => ({ t: `2026-01-${String(i + 1).padStart(2, '0')}`, v }))
await test('alert threshold', () => {
  const r = evaluateAlert({ type: 'threshold', op: '>', value: 10 }, s(1, 11))
  equal(r.triggered, true); equal(r.value, 11); ok(r.message.includes('大于'))
  equal(evaluateAlert({ type: 'threshold', op: '>', value: 10 }, s(11, 10)).triggered, false)
  equal(evaluateAlert({ type: 'threshold', op: '>=', value: 10 }, s(10)).triggered, true)
  equal(evaluateAlert({ type: 'threshold', op: '<', value: 0 }, s(-1)).triggered, true)
  equal(evaluateAlert({ type: 'threshold', op: '<=', value: 0 }, s(1)).triggered, false)
  equal(evaluateAlert({ type: 'threshold', op: '==', value: 3 }, s('3')).triggered, true)
  equal(evaluateAlert({ type: 'threshold', op: '!=', value: 3 }, s(3)).triggered, false)
  equal(evaluateAlert({ type: 'threshold', op: '>', value: 1 }, []).triggered, false)
  equal(evaluateAlert({ type: 'threshold', op: '>', value: 1 }, s(5, null)).triggered, false)
  equal(evaluateAlert({ type: 'threshold', op: '~', value: 1 }, s(5)).triggered, false)
})
await test('alert change', () => {
  let r = evaluateAlert({ type: 'change', direction: 'up', pct: 20 }, s(100, 130))
  equal(r.triggered, true); equal(r.changePct, 30); equal(r.baseline, 100)
  equal(evaluateAlert({ type: 'change', direction: 'up', pct: 20 }, s(100, 50)).triggered, false)
  equal(evaluateAlert({ type: 'change', direction: 'down', pct: 20 }, s(100, 50)).triggered, true)
  equal(evaluateAlert({ type: 'change', direction: 'any', pct: 20 }, s(100, 85)).triggered, false)
  equal(evaluateAlert({ type: 'change', direction: 'any', pct: 10 }, s(100, 85)).triggered, true)
  r = evaluateAlert({ type: 'change', direction: 'up', pct: 50 }, s(0, 5))
  equal(r.triggered, true); equal(r.changePct, Infinity); ok(r.message.includes('从 0'))
  equal(evaluateAlert({ type: 'change', direction: 'any', pct: 0 }, s(0, 0)).triggered, false)
  equal(evaluateAlert({ type: 'change', pct: 10 }, s(5)).triggered, false)
  equal(evaluateAlert({ type: 'change', direction: 'down', pct: 10 }, s(-100, -150)).triggered, true)
})
await test('alert anomaly', () => {
  const hist = [10, 11, 9, 10, 12, 8, 10, 11, 9, 10]
  let r = evaluateAlert({ type: 'anomaly', z: 3 }, s(...hist, 30))
  equal(r.triggered, true); ok(r.z > 3); ok(r.expected.low < 10 && r.expected.high > 10); equal(r.baseline, 10)
  r = evaluateAlert({ type: 'anomaly' }, s(...hist, 11))
  equal(r.triggered, false); ok(r.message.includes('预期区间'))
  r = evaluateAlert({ type: 'anomaly' }, s(5, 5, 5, 5, 5, 5, 5, 5, 6))
  equal(r.triggered, true); equal(r.z, Infinity)
  equal(evaluateAlert({ type: 'anomaly' }, s(5, 5, 5, 5, 5, 5, 5, 5, 5)).triggered, false)
  r = evaluateAlert({ type: 'anomaly', minPoints: 7 }, s(1, 2, 3, 100))
  equal(r.triggered, false); ok(r.message.includes('不足'))
  // window: only last 3 history points (all 100) considered
  r = evaluateAlert({ type: 'anomaly', window: 3, minPoints: 3 }, s(1, 50, 100, 100, 100, 100))
  equal(r.triggered, false); equal(r.baseline, 100)
})
await test('alert missing', () => {
  equal(evaluateAlert({ type: 'missing' }, []).triggered, true)
  equal(evaluateAlert({ type: 'missing' }, s(1, null)).triggered, true)
  equal(evaluateAlert({ type: 'missing' }, s(1, 0)).triggered, false)
  equal(evaluateAlert({ type: 'unknown' }, s(1)).triggered, false)
})

// ---------------------------------------------------------------- compare
const cols = (...n) => n.map(name => ({ name }))
await test('compareResults reorder columns & rows, names differ, extra col', () => {
  const e = { columns: cols('chain', 'n'), rows: [['a', 1], ['b', 2]] }
  const a = { columns: cols('cnt', 'extra', 'c'), rows: [{ cnt: '2', extra: 'z', c: 'b' }, { cnt: 1, extra: 'y', c: 'a' }] }
  const r = compareResults(e, a)
  equal(r.match, true)
  deepEqual(r.detail.mapping, { chain: 'c', n: 'cnt' })
})
await test('compareResults row count', () => {
  const r = compareResults({ columns: cols('a'), rows: [[1], [2]] }, { columns: cols('a'), rows: [[1]] })
  equal(r.match, false); equal(r.reason, '行数不同：期望 2 行，实际 1 行')
})
await test('compareResults tolerance & numbers', () => {
  equal(compareResults({ columns: cols('x'), rows: [[1 / 3]] }, { columns: cols('x'), rows: [['0.3333333333']] }).match, true)
  const r = compareResults({ columns: cols('x'), rows: [[1]] }, { columns: cols('x'), rows: [[1.1]] })
  equal(r.match, false); ok(r.reason.startsWith('数值不同'))
  equal(compareResults({ columns: cols('x'), rows: [[1]] }, { columns: cols('x'), rows: [[1.1]] }, { tolerance: 0.2 }).match, true)
  equal(compareResults({ columns: cols('x'), rows: [[10n]] }, { columns: cols('x'), rows: [['10.000']] }).match, true)
})
await test('compareResults missing column reason', () => {
  const r = compareResults({ columns: cols('n'), rows: [[1]] }, { columns: cols('m'), rows: [[2]] })
  equal(r.reason, '缺少与期望列「n」一致的列')
})
await test('compareResults dates & nulls', () => {
  const e = { columns: cols('d', 'v'), rows: [[new Date(2026, 0, 2), null], ['2026-01-03', 1]] }
  const a = { columns: cols('d', 'v'), rows: [['2026-01-02 00:00:00', null], ['2026-01-03T00:00:00', '1']] }
  equal(compareResults(e, a).match, true)
})
await test('compareResults combination differs', () => {
  const e = { columns: cols('k', 'v'), rows: [['a', 1], ['b', 2]] }
  const a = { columns: cols('k', 'v'), rows: [['a', 2], ['b', 1]] }
  const r = compareResults(e, a)
  equal(r.match, false); ok(r.reason.includes('组合'))
})
await test('compareResults ambiguous mapping backtracks', () => {
  // both expected columns have same multiset; mapping must pair correctly
  const e = { columns: cols('x', 'y'), rows: [[1, 2], [2, 1]] }
  const a = { columns: cols('p', 'q'), rows: [[1, 2], [2, 1]] }
  equal(compareResults(e, a).match, true)
  const e2 = { columns: cols('x', 'y'), rows: [[1, 1], [2, 2]] }
  const a2 = { columns: cols('p', 'q'), rows: [[1, 2], [2, 1]] }
  // expected y duplicates x row-for-row, so actual p serves both (q is an extra column)
  equal(compareResults(e2, a2).match, true)
  // duplicated expected column may reuse one actual column
  equal(compareResults({ columns: cols('a', 'b'), rows: [[1, 1], [2, 2]] }, { columns: cols('z'), rows: [[2], [1]] }).match, false) // fewer columns
  equal(compareResults({ columns: cols('a', 'b'), rows: [[1, 1], [2, 2]] }, { columns: cols('z', 'w'), rows: [[2, 'x'], [1, 'y']] }).match, true)
})
await test('parseSelect typed literals are not aliases', () => {
  const p = parseSelect("SELECT DATE '2026-01-01', TIMESTAMP '2026-01-01 00:00:00', 'a' 'b', x 'al' FROM t")
  deepEqual(p.select.map(s => s.alias), [undefined, undefined, undefined, 'al'])
})
await test('compareResults ordered', () => {
  const e = { columns: cols('k'), rows: [['a'], ['b']] }
  const a = { columns: cols('k'), rows: [['b'], ['a']] }
  equal(compareResults(e, a).match, true)
  const r = compareResults(e, a, { ordered: true })
  equal(r.match, false); ok(r.reason.includes('顺序'))
  equal(compareResults(e, e, { ordered: true }).match, true)
})
await test('compareResults empty', () => {
  equal(compareResults({ columns: cols('a'), rows: [] }, { columns: cols('b'), rows: [] }).match, true)
})
await test('scoreSql', () => {
  equal(scoreSql('SELECT a FROM t', 'select A from `t`;'), 1)
  const v = scoreSql('SELECT a, COUNT(*) FROM t GROUP BY a', 'SELECT b FROM u')
  ok(v > 0 && v < 0.5)
  equal(scoreSql('', ''), 1)
  equal(scoreSql('SELECT 1', ''), 0)
})
await test('purity: deterministic', () => {
  const a = buildMetricSql({ metric, dialect: 'mysql', grain: 'week', range: 'last30d', now: new Date(2026, 5, 1) })
  const b = buildMetricSql({ metric, dialect: 'mysql', grain: 'week', range: 'last30d', now: new Date(2026, 5, 1) })
  deepEqual(a, b)
})

await test('compareResults accepts pivoted shape (long vs wide), rejects different numbers', () => {
  const long = { columns: [{ name: 'direction' }, { name: 'n' }], rows: [['credit', 22], ['debit', 19]] }
  const wide = { columns: [{ name: '调增' }, { name: '调减' }], rows: [[22, 19]] }
  assert.equal(compareResults(long, wide).match, true)
  assert.equal(compareResults(wide, long).match, true)
  assert.equal(compareResults(long, { columns: wide.columns, rows: [[22, 18]] }).match, false)
  assert.equal(compareResults({ columns: [{ name: 'a' }, { name: 'n' }], rows: [['x', 1], ['y', 2], ['z', 3]] }, wide).match, false)
})

summary('analysis unit')
