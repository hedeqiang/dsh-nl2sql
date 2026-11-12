// service/forecast.js: Holt / Holt-Winters fitting, intervals, time axis, digest stats, goal projection.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const F = await plugin('service/forecast.js')

// Deterministic pseudo-random noise (LCG + Box-Muller).
function rng(seed = 42) {
  let s = seed >>> 0
  const u = () => ((s = (1664525 * s + 1013904223) >>> 0) + 1) / 4294967297
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u())
}

await test('linear trend: Holt extrapolates within 1% and intervals widen with sqrt(h)', () => {
  const y = Array.from({ length: 30 }, (_, i) => 100 + 5 * i)
  const r = F.forecastSeries(y, { horizon: 7, seasonal: false })
  assert.equal(r.method, 'holt')
  r.forecast.forEach((f, i) => {
    const truth = 100 + 5 * (30 + i)
    assert.ok(Math.abs(f.value - truth) / truth < 0.01, `h=${f.h}: ${f.value} vs ${truth}`)
  })
  // Exact line: residuals ~ 0.
  assert.ok(r.sigma < 1e-6, String(r.sigma))
})

await test('linear trend + noise: forecast error small, truth inside the 95% band', () => {
  const n = rng(7)
  const y = Array.from({ length: 60 }, (_, i) => 200 + 3 * i + n() * 4)
  const r = F.forecastSeries(y, { horizon: 10, seasonal: false })
  let inside = 0
  r.forecast.forEach((f, i) => {
    const truth = 200 + 3 * (60 + i)
    assert.ok(Math.abs(f.value - truth) < 25, `h=${f.h}: ${f.value} vs ${truth}`)
    if (truth >= f.lower && truth <= f.upper) inside++
    assert.ok(f.upper > f.lower)
  })
  assert.ok(inside >= 9, `inside ${inside}/10`)
  const w1 = r.forecast[0].upper - r.forecast[0].lower
  const w4 = r.forecast[3].upper - r.forecast[3].lower
  assert.ok(Math.abs(w4 / w1 - 2) < 1e-9, 'width ∝ sqrt(h)')
  assert.ok(Math.abs(w1 - 2 * 1.96 * r.sigma) < 1e-9)
})

await test('weekly seasonality + noise: Holt-Winters chosen; MAPE < 5% and beats Holt', () => {
  const n = rng(11)
  const pattern = [0, 10, 20, 15, 5, -25, -30]
  const gen = (i) => 300 + 1.5 * i + pattern[i % 7] * 2
  const y = Array.from({ length: 56 }, (_, i) => gen(i) + n() * 3)
  const hw = F.forecastSeries(y, { horizon: 14, seasonal: true })
  assert.equal(hw.method, 'holt-winters')
  const holt = F.forecastSeries(y, { horizon: 14, seasonal: false })
  const mape = (r) => r.forecast.reduce((s, f, i) => s + Math.abs(f.value - gen(56 + i)) / gen(56 + i), 0) / r.forecast.length
  assert.ok(mape(hw) < 0.05, `hw MAPE ${mape(hw)}`)
  assert.ok(mape(hw) < mape(holt) / 2, `hw ${mape(hw)} vs holt ${mape(holt)}`)
  // Weekly shape kept: the forecast for the weekday with the lowest pattern is the lowest of its week.
  const week = hw.forecast.slice(0, 7)
  const lowIdx = week.reduce((b, f, i) => (f.value < week[b].value ? i : b), 0)
  assert.equal((56 + lowIdx) % 7, 6)
})

await test('fewer than 21 daily points → Holt; < 3 points throws', () => {
  assert.equal(F.forecastSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { seasonal: true }).method, 'holt')
  assert.throws(() => F.forecastSeries([1, 2]), /至少/)
})

await test('regularize: days sorted, gaps filled with 0; future labels per grain', () => {
  const r = F.regularize([{ x: '2026-01-03', y: 3 }, { x: '2026-01-01', y: 1 }, { x: '2026-01-05', y: '5' }])
  assert.deepEqual(r.xs, ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'])
  assert.deepEqual(r.ys, [1, 0, 3, 0, 5])
  assert.equal(r.filled, 2)
  assert.deepEqual(F.futureLabels('2026-12-30', 'day', 3), ['2026-12-31', '2027-01-01', '2027-01-02'])
  assert.deepEqual(F.futureLabels('2026-11', 'month', 2), ['2026-12', '2027-01'])
  assert.deepEqual(F.futureLabels('2026-01-01 23:00', 'hour', 1), ['2026-01-02 00:00'])
  const p = F.forecastPoints(Array.from({ length: 5 }, (_, i) => ({ x: `2026-0${i + 1}`, y: i })), { horizon: 2 })
  assert.equal(p.kind, 'month')
  assert.deepEqual(p.forecast.map(f => f.x), ['2026-06', '2026-07'])
})

await test('dailyStats / isNotable', () => {
  const s = F.dailyStats([10, 10, 11, 9, 10, 10, 11, 9, 20])
  assert.equal(s.value, 20)
  assert.ok(Math.abs(s.avg7 - 10) < 0.2)
  assert.ok(s.z > 5)
  assert.ok(Math.abs(s.vsLastWeek - 1) < 1e-9, String(s.vsLastWeek)) // vs y.at(-8) = 10
  assert.equal(F.isNotable(s), true)
  assert.equal(F.isNotable(F.dailyStats([10, 10, 11, 9, 10, 10, 11, 9, 10.2])), false)
})

await test('goal projection: weekday-aware run rate and status', () => {
  const { start, end } = F.periodBounds('month', new Date(2026, 10, 15, 12))
  assert.equal(start.getDate(), 1)
  assert.equal(end.getMonth(), 11)
  // 14 complete days: weekdays 10, weekends 0.
  const daily = []
  for (let d = new Date(start); d.getDate() < 15; d.setDate(d.getDate() + 1)) daily.push({ date: new Date(d), value: [0, 6].includes(d.getDay()) ? 0 : 10 })
  const actual = daily.reduce((s, d) => s + d.value, 0)
  const p = F.projectRunRate({ daily, actualComplete: actual, today: new Date(2026, 10, 15), end })
  assert.equal(p.weekdayAware, true)
  // Nov 2026 has 21 weekdays → 210.
  assert.equal(p.projected, 210)
  assert.equal(F.goalStatus({ target: 200, actual, projected: p.projected }), 'on-track')
  assert.equal(F.goalStatus({ target: 250, actual, projected: p.projected }), 'at-risk')
  assert.equal(F.goalStatus({ target: 50, actual, projected: p.projected }), 'achieved')
  assert.equal(F.goalStatus({ target: 250, actual, projected: actual, ended: true }), 'missed')
  assert.equal(F.goalStatus({ direction: 'down', target: 300, actual, projected: p.projected }), 'on-track')
  assert.equal(F.goalStatus({ direction: 'down', target: 50, actual, projected: p.projected }), 'missed')
  assert.equal(F.goalStatus({ direction: 'down', target: 200, actual, projected: p.projected }), 'at-risk')
})

summary('forecast')
