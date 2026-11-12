// analysis.js builders executed against real MySQL / PostgreSQL (results cross-checked with hand-written SQL).
// Ported from an earlier standalone script Each engine section skips if its database is unreachable.
import { test, skip, skipFile, summary, assert } from '../lib/assert.mjs'
import { plugin, pluginRequire, MYSQL, PG, mysqlUnavailable, pgUnavailable } from '../lib/env.mjs'

const mysql = pluginRequire('mysql2/promise')
const pg = pluginRequire('pg')
const { parseSelect, buildDetailSql, buildBreakdownSql, buildMetricSql, buildAttributionSql, computeAttribution, isAdditive, compareResults, evaluateAlert } = await plugin('analysis.js')
const { admitSql } = await plugin('sql-guard.js')

const myDown = await mysqlUnavailable()
const pgDown = await pgUnavailable()
if (myDown && pgDown) skipFile(`${myDown}; ${pgDown}`)

const { equal, ok } = assert
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-6 * Math.max(1, Math.abs(Number(a)))

if (myDown) await test('mysql section', () => skip(myDown))
else {
  // ------------------------------------------------------------------ MySQL
  const my = await mysql.createConnection({ ...MYSQL, dateStrings: true })
  const myq = async (sql) => {
    admitSql(sql, { dialect: 'mysql' }) // every generated statement must pass the read-only guard
    await my.query('SET SESSION TRANSACTION READ ONLY')
    const [rows, fields] = await my.query(sql)
    return { rows, columns: fields.map(f => ({ name: f.name })) }
  }
  const T = 'blockchain_transactions'
  const grouped = `SELECT DATE(created_at) AS d, chain, COUNT(*) AS n, SUM(amount) total FROM ${T} WHERE status = 1 /* ok */ GROUP BY DATE(created_at), chain ORDER BY n DESC LIMIT 50`
  const g = await myq(grouped)
  const top = g.rows[0]
  console.log('mysql top group', top)

  await test('mysql: detail rows behind a point (date x)', async () => {
    const r = buildDetailSql({ sql: grouped, dialect: 'mysql', xColumn: 'd', xValue: top.d, limit: 10000 })
    ok(r.sql, r.error)
    const rows = (await myq(r.sql)).rows
    const exp = (await myq(`SELECT COUNT(*) c FROM ${T} WHERE status = 1 AND DATE(created_at) = '${top.d}'`)).rows[0].c
    equal(rows.length, Number(exp))
    ok(rows.every(x => x.status === 1 && x.created_at.startsWith(top.d)))
  })
  await test('mysql: detail rows behind a categorical x equals n', async () => {
    const q = `SELECT chain, COUNT(*) AS n FROM ${T} t WHERE t.status = 1 GROUP BY chain`
    const res = await myq(q)
    const pick = res.rows[0]
    const rows = (await myq(buildDetailSql({ sql: q, dialect: 'mysql', xColumn: 'chain', xValue: pick.chain, limit: 1000 }).sql)).rows
    equal(rows.length, Number(pick.n))
  })
  await test('mysql: breakdown at a point sums to the point', async () => {
    const r = buildBreakdownSql({ sql: grouped, dialect: 'mysql', xColumn: 'd', xValue: top.d, dimension: '`token`' })
    ok(r.sql, r.error)
    const rows = (await myq(r.sql)).rows
    const dayTotal = (await myq(`SELECT COUNT(*) n, SUM(amount) s FROM ${T} WHERE status = 1 AND DATE(created_at) = '${top.d}'`)).rows[0]
    equal(rows.reduce((s, x) => s + Number(x.n), 0), Number(dayTotal.n))
    ok(near(rows.reduce((s, x) => s + Number(x.total), 0), dayTotal.s))
    ok('token' in rows[0])
    for (let i = 1; i < rows.length; i++) ok(Number(rows[i - 1].n) >= Number(rows[i].n))
  })
  await test('mysql: breakdown of whole query (no x) by chain_type', async () => {
    const r = buildBreakdownSql({ sql: grouped, dialect: 'mysql', dimension: '`chain_type`', limit: 100 })
    const rows = (await myq(r.sql)).rows
    const all = (await myq(`SELECT COUNT(*) n FROM ${T} WHERE status = 1`)).rows[0].n
    equal(rows.reduce((s, x) => s + Number(x.n), 0), Number(all))
  })
  await test('mysql: breakdown from CTE query', async () => {
    const q = `WITH ok AS (SELECT * FROM ${T} WHERE status = 1) SELECT chain, SUM(amount) AS vol FROM ok GROUP BY chain`
    const res = await myq(q)
    const pick = res.rows[0]
    const r = buildBreakdownSql({ sql: q, dialect: 'mysql', xColumn: 'chain', xValue: pick.chain, dimension: '`token`' })
    const rows = (await myq(r.sql)).rows
    ok(near(rows.reduce((s, x) => s + Number(x.vol), 0), pick.vol))
  })

  const metric = { name: '交易额', expression: 'SUM(amount)', table: T, filter: 'status = 1', timeColumn: 'created_at' }
  const totalAll = Number((await myq(`SELECT SUM(amount) s FROM ${T} WHERE status = 1`)).rows[0].s)
  for (const grain of ['hour', 'day', 'week', 'month', 'year']) {
    await test(`mysql: metric grain ${grain}`, async () => {
      const r = buildMetricSql({ metric, dialect: 'mysql', grain, limit: 100000 })
      ok(r.sql, r.error)
      const res = await myq(r.sql)
      ok(res.rows.length > 0)
      ok(near(res.rows.reduce((s, x) => s + Number(x['交易额']), 0), totalAll))
      const ts = res.rows.map(x => String(x['时间']))
      ok(ts.every((t, i) => i === 0 || ts[i - 1] <= t), 'ascending')
      if (grain === 'week') ok(/^\d{4}-W\d{2}$/.test(ts[0]), ts[0])
    })
  }
  await test('mysql: metric with dimensions, filters, range', async () => {
    const r = buildMetricSql({
      metric, dialect: 'mysql', grain: 'month', dimensions: ['chain_type', 'network'],
      filters: [{ column: 'chain', op: 'in', values: ['acala', 'metal', 'peaq'] }, { column: 'amount', op: '>', value: 0 }],
      from: '2025-12-01', to: '2026-07-01',
    })
    const res = await myq(r.sql)
    const exp = (await myq(`SELECT SUM(amount) s FROM ${T} WHERE status = 1 AND chain IN ('acala','metal','peaq') AND amount > 0 AND created_at >= '2025-12-01' AND created_at < '2026-07-01'`)).rows[0].s
    ok(near(res.rows.reduce((s, x) => s + Number(x['交易额']), 0), exp))
    ok(res.rows.every(x => 'chain_type' in x && 'network' in x))
  })
  await test('mysql: metric with relative range (thisYear, now=2026-10-01) & no grain', async () => {
    const r = buildMetricSql({ metric: { ...metric, name: 'n', expression: 'COUNT(*)' }, dialect: 'mysql', dimensions: ['chain'], range: 'thisYear', now: new Date(2026, 9, 1) })
    const res = await myq(r.sql)
    const exp = (await myq(`SELECT COUNT(*) c FROM ${T} WHERE status = 1 AND created_at >= '2026-01-01' AND created_at < '2026-10-02'`)).rows[0].c
    equal(res.rows.reduce((s, x) => s + Number(x.n), 0), Number(exp))
    for (let i = 1; i < res.rows.length; i++) ok(Number(res.rows[i - 1].n) >= Number(res.rows[i].n))
  })
  await test('mysql: metric COUNT(DISTINCT) by week', async () => {
    const r = buildMetricSql({ metric: { name: '活跃地址', expression: 'COUNT(DISTINCT from_address)', table: T, timeColumn: 'created_at' }, dialect: 'mysql', grain: 'week' })
    ok((await myq(r.sql)).rows.length > 0)
  })

  await test('mysql: attribution month vs month (point periods) + computeAttribution', async () => {
    const months = (await myq(`SELECT DATE_FORMAT(created_at, '%Y-%m') m, COUNT(*) c FROM ${T} GROUP BY m ORDER BY c DESC LIMIT 2`)).rows.map(x => x.m).sort()
    const [base, cur] = months
    const r = buildAttributionSql({ dialect: 'mysql', from: T, where: 'status = 1', timeExpr: "DATE_FORMAT(created_at, '%Y-%m')", measureExpr: 'COUNT(*)', dimension: '`chain`', current: cur, baseline: base, limit: 100 })
    ok(r.sql, r.error)
    const rows = (await myq(r.sql)).rows
    const att = computeAttribution(rows, { additive: isAdditive('COUNT(*)') })
    const tot = (await myq(`SELECT SUM(DATE_FORMAT(created_at,'%Y-%m') = '${cur}') c, SUM(DATE_FORMAT(created_at,'%Y-%m') = '${base}') b FROM ${T} WHERE status = 1`)).rows[0]
    equal(att.total.current, Number(tot.c))
    equal(att.total.baseline, Number(tot.b))
    ok(att.concentration >= 0 && att.concentration <= 1)
    const shareSum = att.items.reduce((s, x) => s + (x.share ?? 0), 0)
    ok(att.total.delta === 0 || near(shareSum, 1), `shares sum ${shareSum}`)
    console.log(`  attribution ${base}→${cur}: delta=${att.total.delta}, top=${att.items.slice(0, 3).map(i => `${i.value}:${i.delta}`).join(', ')}, concentration=${att.concentration.toFixed(3)}`)
  })
  await test('mysql: attribution with ranges on raw datetime', async () => {
    const r = buildAttributionSql({ dialect: 'mysql', from: `${T} t`, timeExpr: 't.created_at', measureExpr: 'SUM(t.amount)', dimension: 't.`chain_type`',
      current: { from: '2026-04-01', to: '2026-10-01' }, baseline: { from: '2025-10-01', to: '2026-04-01' } })
    const rows = (await myq(r.sql)).rows
    const att = computeAttribution(rows)
    const exp = (await myq(`SELECT SUM(CASE WHEN created_at >= '2026-04-01' THEN amount END) c, SUM(CASE WHEN created_at < '2026-04-01' THEN amount END) b FROM ${T} WHERE created_at >= '2025-10-01' AND created_at < '2026-10-01'`)).rows[0]
    ok(near(att.total.current, exp.c ?? 0)); ok(near(att.total.baseline, exp.b ?? 0))
  })
  await test('mysql: compareResults on equivalent queries with different shapes', async () => {
    const a = await myq(`SELECT chain, COUNT(*) AS n FROM ${T} GROUP BY chain`)
    const b = await myq(`SELECT COUNT(1) AS cnt, chain AS c, MAX(id) AS extra FROM ${T} GROUP BY c ORDER BY cnt`)
    equal(compareResults(a, b).match, true)
    const c = await myq(`SELECT chain, COUNT(*) AS n FROM ${T} WHERE status = 1 GROUP BY chain`)
    const r = compareResults(a, c)
    equal(r.match, false); console.log('  mismatch reason:', r.reason)
  })
  await test('mysql: alert on real daily metric series', async () => {
    const r = buildMetricSql({ metric, dialect: 'mysql', grain: 'day' })
    const series = (await myq(r.sql)).rows.map(x => ({ t: x['时间'], v: Number(x['交易额']) }))
    const res = evaluateAlert({ type: 'anomaly', z: 3, window: 14, minPoints: 7 }, series)
    ok(typeof res.triggered === 'boolean' && res.message)
    console.log('  anomaly:', res.message)
  })
  await my.end()

}

if (pgDown) await test('postgres section', () => skip(pgDown))
else {
  // ------------------------------------------------------------------ PostgreSQL
  const pgc = new pg.Client(PG)
  await pgc.connect()
  await pgc.query(`CREATE TEMP TABLE tx (id serial, chain text, chain_type text, "Token Name" text, amount numeric(20,4), status int, created_at timestamp)`)
  await pgc.query(`INSERT INTO tx (chain, chain_type, "Token Name", amount, status, created_at)
    SELECT (ARRAY['eth','bsc','sol','btc'])[1 + i % 4], (ARRAY['evm','evm','svm','utxo'])[1 + i % 4], (ARRAY['USDT','ETH','O''Brien'])[1 + i % 3],
           (i % 17) * 1.5, CASE WHEN i % 10 = 0 THEN 0 ELSE 1 END, timestamp '2026-01-01' + (i * interval '7 hours')
    FROM generate_series(1, 600) i`)
  const pgq = async (sql) => {
    admitSql(sql, { dialect: 'postgres' })
    await pgc.query('BEGIN READ ONLY')
    try { const r = await pgc.query(sql); return { rows: r.rows, columns: r.fields.map(f => ({ name: f.name })) } } finally { await pgc.query('ROLLBACK') }
  }
  const pgGrouped = `SELECT created_at::date AS "Day", "Token Name", COUNT(*) AS n, SUM(amount) AS vol FROM pg_temp.tx t WHERE t.status = 1 GROUP BY 1, 2`
  const pgG = (await pgq(pgGrouped)).rows
  const day = pgG[0].Day

  await test('pg: parse quoted alias & dotted temp table', () => {
    const p = parseSelect(pgGrouped, { dialect: 'postgres' })
    equal(p.select[0].alias, 'Day'); equal(p.from, 'pg_temp.tx t')
  })
  await test('pg: detail by quoted column with apostrophe value', async () => {
    const r = buildDetailSql({ sql: pgGrouped, dialect: 'postgres', xColumn: 'Token Name', xValue: "O'Brien", limit: 1000 })
    const rows = (await pgq(r.sql)).rows
    equal(rows.length, Number((await pgq(`SELECT COUNT(*) c FROM tx WHERE status = 1 AND "Token Name" = 'O''Brien'`)).rows[0].c))
  })
  await test('pg: detail by date x (Date object value)', async () => {
    const r = buildDetailSql({ sql: pgGrouped, dialect: 'postgres', xColumn: 'Day', xValue: day, limit: 1000 })
    const rows = (await pgq(r.sql)).rows
    const exp = pgG.filter(x => +x.Day === +day).reduce((s, x) => s + Number(x.n), 0)
    equal(rows.length, exp)
  })
  await test('pg: breakdown at a point by quoted dimension', async () => {
    const r = buildBreakdownSql({ sql: pgGrouped, dialect: 'postgres', xColumn: 'Day', xValue: day, dimension: 't."chain"' })
    const rows = (await pgq(r.sql)).rows
    const exp = pgG.filter(x => +x.Day === +day)
    equal(rows.reduce((s, x) => s + Number(x.n), 0), exp.reduce((s, x) => s + Number(x.n), 0))
    ok(near(rows.reduce((s, x) => s + Number(x.vol), 0), exp.reduce((s, x) => s + Number(x.vol), 0)))
  })
  const pgMetric = { name: '交易额', expression: 'SUM(amount)', table: 'pg_temp.tx', filter: 'status = 1', timeColumn: 'created_at' }
  const pgTotal = Number((await pgq('SELECT SUM(amount) s FROM tx WHERE status = 1')).rows[0].s)
  for (const grain of ['hour', 'day', 'week', 'month', 'year']) {
    await test(`pg: metric grain ${grain}`, async () => {
      const r = buildMetricSql({ metric: pgMetric, dialect: 'postgres', grain, limit: 100000 })
      const res = await pgq(r.sql)
      ok(near(res.rows.reduce((s, x) => s + Number(x['交易额']), 0), pgTotal))
      if (grain === 'week') ok(/^\d{4}-W\d{2}$/.test(res.rows[0]['时间']), res.rows[0]['时间'])
      if (grain === 'year') equal(res.rows[0]['时间'], 2026)
    })
  }
  await test('pg: metric with dims/filters/range', async () => {
    const r = buildMetricSql({ metric: pgMetric, dialect: 'postgres', grain: 'week', dimensions: ['chain_type', 'Token Name'],
      filters: [{ column: 'chain', op: '!=', value: 'btc' }, { column: 'Token Name', op: 'in', values: ["O'Brien", 'USDT'] }],
      range: 'lastMonth', now: new Date(2026, 2, 10) })
    const res = await pgq(r.sql)
    const exp = (await pgq(`SELECT SUM(amount) s FROM tx WHERE status = 1 AND chain <> 'btc' AND "Token Name" IN ('O''Brien','USDT') AND created_at >= '2026-02-01' AND created_at < '2026-03-01'`)).rows[0].s
    ok(near(res.rows.reduce((s, x) => s + Number(x['交易额']), 0), exp))
    ok(res.rows.length > 0 && 'Token Name' in res.rows[0])
  })
  await test('pg: attribution weeks + computeAttribution, non-additive flag', async () => {
    const r = buildAttributionSql({ dialect: 'postgres', from: 'tx', where: 'status = 1', timeExpr: `to_char(created_at, 'IYYY-"W"IW')`, measureExpr: 'SUM(amount)', dimension: '"chain"', current: '2026-W05', baseline: '2026-W04' })
    const rows = (await pgq(r.sql)).rows
    const att = computeAttribution(rows, { additive: isAdditive('SUM(amount)') })
    const exp = (await pgq(`SELECT SUM(amount) FILTER (WHERE to_char(created_at, 'IYYY-"W"IW') = '2026-W05') c, SUM(amount) FILTER (WHERE to_char(created_at, 'IYYY-"W"IW') = '2026-W04') b FROM tx WHERE status = 1`)).rows[0]
    ok(near(att.total.current, exp.c)); ok(near(att.total.baseline, exp.b))
    equal(att.items.length, 4)
    const avg = buildAttributionSql({ dialect: 'postgres', from: 'tx', timeExpr: 'created_at', measureExpr: 'AVG(amount)', dimension: '"chain_type"', current: { from: '2026-02-01', to: '2026-03-01' }, baseline: { from: '2026-01-01', to: '2026-02-01' } })
    const a2 = computeAttribution((await pgq(avg.sql)).rows, { additive: isAdditive('AVG(amount)') })
    equal(a2.additive, false); equal(a2.items.length, 3)
  })
  await test('pg: compareResults numeric strings vs numbers across engines style', async () => {
    const a = await pgq(`SELECT chain, SUM(amount) s FROM tx GROUP BY chain`)
    const b = await pgq(`SELECT SUM(amount)::float8 AS total, chain FROM tx GROUP BY chain ORDER BY 1`)
    equal(compareResults(a, b).match, true)
  })
  await pgc.end()

}

summary('analysis integration')
