// Freshness / quality pure helpers: time column choice, time parsing, thresholds, SQL shapes, scoring.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const F = await plugin('service/freshness.js')
const col = (name, dataType = 'datetime', roles = ['time']) => ({ name, dataType, roles })

await test('pickTimeColumn prefers created_at, skips deleted_at / next_* / non-date types', () => {
  assert.equal(F.pickTimeColumn({ columns: [col('updated_at'), col('deleted_at'), col('created_at')] }).name, 'created_at')
  assert.equal(F.pickTimeColumn({ columns: [col('next_retry_at'), col('updated_at')] }).name, 'updated_at')
  assert.equal(F.pickTimeColumn({ columns: [col('deleted_at'), col('expire_at')] }), undefined)
  assert.equal(F.pickTimeColumn({ columns: [col('created_at', 'bigint')] }), undefined, 'epoch ints are not compared as datetimes')
  assert.equal(F.pickTimeColumn({ columns: [col('@timestamp'), col('last_seen_at')] }).name, '@timestamp')
  assert.equal(F.pickTimeColumn({ columns: [{ name: 'amount', dataType: 'decimal', roles: ['measure'] }] }), undefined)
})

await test('parseTime: local wall time, offsets, ISO Z, date-only = end of day, epoch', () => {
  assert.equal(F.parseTime('2026-11-12 17:55:00'), new Date(2026, 10, 12, 17, 55, 0).getTime())
  assert.equal(F.parseTime('2026-11-12T09:55:00.000Z'), Date.UTC(2026, 10, 12, 9, 55))
  assert.equal(F.parseTime('2026-11-12 17:55:00+08'), Date.UTC(2026, 10, 12, 9, 55))
  assert.equal(F.parseTime('2026-11-12 17:55:00+08:00'), Date.UTC(2026, 10, 12, 9, 55))
  assert.equal(F.parseTime('2026-11-12'), new Date(2026, 10, 13).getTime() - 1)
  assert.equal(F.parseTime(1700000000), 1700000000000)
  assert.equal(F.parseTime(null), null)
  assert.equal(F.parseTime('garbage'), null)
})

await test('whenText / lagText / localStamp', () => {
  const now = new Date(2026, 10, 12, 9, 0).getTime()
  assert.equal(F.whenText(new Date(2026, 10, 11, 17, 55).getTime(), now), '昨天 17:55')
  assert.equal(F.whenText(new Date(2026, 10, 12, 8, 5).getTime(), now, 'en'), 'today 08:05')
  assert.equal(F.whenText(new Date(2026, 9, 1, 8, 5).getTime(), now), '10-01 08:05')
  assert.equal(F.lagText(30), '30 分钟')
  assert.equal(F.lagText(125, 'en'), '2 hours')
  assert.equal(F.lagText(60 * 72), '3 天')
  assert.equal(F.localStamp(new Date(2026, 0, 2, 3, 4).getTime()), '2026-01-02 03:04')
})

await test('thresholds and status: overrides, 0 = off, warn at half, error / empty', () => {
  const s = { staleHours: 24, overrides: { d1: { orders: 2, logs: 0 } } }
  assert.equal(F.thresholdFor(s, 'd1', 'orders'), 2)
  assert.equal(F.thresholdFor(s, 'd1', 'logs'), 0)
  assert.equal(F.thresholdFor(s, 'd1', 'x'), 24)
  assert.equal(F.thresholdFor(s, 'd2', 'orders'), 24)
  assert.equal(F.freshnessStatus({ latestAt: 1, lagMinutes: 60 * 25 }, 24), 'stale')
  assert.equal(F.freshnessStatus({ latestAt: 1, lagMinutes: 60 * 13 }, 24), 'warn')
  assert.equal(F.freshnessStatus({ latestAt: 1, lagMinutes: 60 }, 24), 'ok')
  assert.equal(F.freshnessStatus({ latestAt: 1, lagMinutes: 6000 }, 0), 'off')
  assert.equal(F.freshnessStatus({ latestAt: null }, 24), 'empty')
  assert.equal(F.freshnessStatus({ error: 'x' }, 24), 'error')
})

await test('freshness SQL per dialect', () => {
  assert.equal(F.freshnessSql('mysql', 'orders', 'created_at'), 'SELECT MAX(`created_at`) AS latest_at FROM `orders` WHERE `created_at` <= NOW() + INTERVAL 1 HOUR')
  assert.equal(F.freshnessSql('postgres', 'sales.orders', 'created_at'), `SELECT MAX("created_at") AS latest_at FROM "sales"."orders" WHERE "created_at" <= now() + interval '1 hour'`)
  assert.equal(F.freshnessSql('elasticsearch', 'logs-2026.11', '@timestamp'), 'SELECT MAX("@timestamp") AS latest_at FROM "logs-2026.11" WHERE "@timestamp" <= NOW() + INTERVAL 1 HOUR')
  const u = F.freshnessUnionSql('mysql', [{ table: 'a', column: 'created_at' }, { table: 'b', column: 'ts' }])
  assert.equal(u, 'SELECT 0 AS k, CAST(MAX(`created_at`) AS CHAR) AS latest_at FROM `a` WHERE `created_at` <= NOW() + INTERVAL 1 HOUR UNION ALL SELECT 1 AS k, CAST(MAX(`ts`) AS CHAR) AS latest_at FROM `b` WHERE `ts` <= NOW() + INTERVAL 1 HOUR')
  assert.match(F.freshnessUnionSql('postgres', [{ table: 'a', column: 'x' }]), /MAX\("x"\)::text/)
})

await test('numLiteral never uses exponent notation', () => {
  assert.equal(F.numLiteral(1e21), '1000000000000000000000')
  assert.equal(F.numLiteral(-12.5), '-12.5')
  assert.ok(!/e/i.test(F.numLiteral(1.5e-9)))
})

await test('scoreTable: deductions, caps, explanations zh/en; empty table not scored', () => {
  const clean = F.scoreTable({ rowCount: 100, nulls: [], duplicates: [], outliers: [], future: [], negatives: [] })
  assert.equal(clean.score, 100)
  assert.deepEqual(clean.issues, [])
  const bad = F.scoreTable({
    rowCount: 1000,
    nulls: [{ column: 'user_id', rate: 0.95, core: true }, { column: 'remark', rate: 0.99, optional: true }, { column: 'city', rate: 0.3 }],
    duplicates: [{ columns: ['order_no'], duplicates: 3 }],
    outliers: [{ column: 'amount', count: 2, low: -10, high: 100 }],
    future: [{ column: 'created_at', count: 5 }],
    negatives: [{ column: 'amount', count: 20 }],
    freshness: { stale: true, lagMinutes: 3000, thresholdHours: 24 },
  })
  const kinds = bad.issues.map(i => i.kind)
  assert.deepEqual(kinds, ['nulls', 'nulls', 'duplicates', 'outliers', 'future', 'negative', 'stale'])
  assert.ok(!bad.issues.some(i => i.column === 'remark'), 'optional columns not scored')
  // 8 + 1 + 20 + 4 + 10 + 10 + 15 = 68
  assert.equal(bad.score, 32)
  assert.match(bad.issues[0].zh, /user_id 空值率 95\.0%/)
  assert.match(bad.issues[2].en, /Unique key order_no has 3 duplicate row\(s\)/)
  const empty = F.scoreTable({ rowCount: 0 })
  assert.equal(empty.score, null)
  assert.equal(F.scoreTable({ rowCount: 10, duplicates: [{ columns: ['a'], duplicates: 1 }, { columns: ['b'], duplicates: 1 }, { columns: ['c'], duplicates: 1 }] }).score, 70, 'duplicates capped at 30')
})

await test('scoreDatasource weights by size and ignores unscored tables', () => {
  assert.equal(F.scoreDatasource([{ score: 100, rowCount: 0 }, { score: null, rowCount: 5 }]), 100)
  const s = F.scoreDatasource([{ score: 100, rowCount: 10 }, { score: 50, rowCount: 1e6 }])
  assert.ok(s > 50 && s < 75, String(s))
  assert.equal(F.scoreDatasource([]), null)
})

await test('scheduler jobs: freshness interval and daily quality slot', () => {
  const svc = Object.create(F.methods)
  svc.state = { freshness: { settings: { enabled: true, intervalMin: 30 }, lastRunAt: Date.now() - 10 * 60000 }, quality: { settings: { enabled: true, time: '06:30' } } }
  const [fj, qj] = svc.jobs_freshness(new Date())
  assert.equal(fj.id, 'freshness')
  assert.equal(fj.due(new Date()), false)
  assert.equal(fj.due(new Date(Date.now() + 25 * 60000)), true)
  assert.equal(qj.due(new Date()), true, 'never ran → due')
  svc.state.quality.lastRunAt = Date.now()
  assert.equal(qj.due(new Date()), false)
  svc.state.freshness.settings.enabled = false
  assert.equal(svc.jobs_freshness(new Date())[0].due(new Date(Date.now() + 1e9)), false)
})

summary()
