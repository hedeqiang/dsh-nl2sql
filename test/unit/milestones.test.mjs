// service/milestones.js: record / month record / streak / running-total detection and wording.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const M = await plugin('service/milestones.js')
const { detectMilestones, niceFloor, autoStep, markText } = M

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Map of `n` days ending at `end` ('YYYY-MM-DD'), values from f(i) (i = 0 … n-1, oldest first). */
function series(end, n, f) {
  const e = new Date(`${end}T00:00:00`)
  const m = new Map()
  for (let i = 0; i < n; i++) m.set(ymd(new Date(e.getFullYear(), e.getMonth(), e.getDate() - (n - 1 - i))), f(i))
  return m
}
const RULE = { kinds: { record: true, month: true, streak: true, total: true }, streakDays: 5, direction: 'up', totalStep: 0 }
const only = (k) => ({ record: k === 'record', month: k === 'month', streak: k === 'streak', total: k === 'total' })
const kinds = (ev) => ev.map(e => e.kind).sort()

await test('niceFloor / autoStep / markText', () => {
  assert.equal(niceFloor(1374), 1000)
  assert.equal(niceFloor(2374), 2000)
  assert.equal(niceFloor(5100), 5000)
  assert.equal(niceFloor(9), null)
  assert.equal(autoStep(1234567), 1000000)
  assert.equal(markText(100000000), '1 亿')
  assert.equal(markText(1500000), '150 万')
  assert.equal(markText(2000), '2,000')
  assert.equal(markText(1000000, 'en'), '1M')
})

await test('daily record: all-time high, crossing a round number, previous best day', () => {
  const byDay = series('2026-06-30', 60, i => 900 + (i % 7) * 10)
  byDay.set('2026-06-30', 1080)
  const ev = detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, kinds: only('record') }, additive: true })
  assert.deepEqual(kinds(ev), ['record'])
  assert.equal(ev[0].allTime, true)
  assert.equal(ev[0].previous, 960)
  assert.equal(ev[0].crossed, 1000)
  assert.match(ev[0].previousDay, /^2026-0[56]-\d\d$/)
})

await test('no record when equal to the best, when history is short, or for an empty day', () => {
  const byDay = series('2026-06-30', 60, () => 100)
  assert.deepEqual(detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, kinds: only('record') }, additive: true }), [])
  const short = series('2026-06-30', 20, i => i)
  assert.deepEqual(detectMilestones({ byDay: short, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, kinds: only('record') }, additive: true }), [])
  const zero = series('2026-06-30', 60, () => -5); zero.set('2026-06-30', 0)
  assert.deepEqual(detectMilestones({ byDay: zero, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, kinds: only('record') }, additive: true }), [])
})

await test('record is "last 12 months" when the data reaches the window start; lower-is-better rules', () => {
  const byDay = series('2026-06-30', 400, i => 50 + (i % 5))
  byDay.set('2026-06-30', 99)
  const [e] = detectMilestones({ byDay, day: '2026-06-30', historyStart: [...byDay.keys()][0], rule: { ...RULE, kinds: only('record') }, additive: true })
  assert.equal(e.allTime, false)
  const low = series('2026-06-30', 60, i => 10 + (i % 3))
  low.set('2026-06-30', 4)
  const [d] = detectMilestones({ byDay: low, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, direction: 'down', kinds: only('record') }, additive: false })
  assert.equal(d.kind, 'record'); assert.equal(d.crossed, undefined)
})

await test('streak: announced at N, 2N … consecutive days of growth only', () => {
  const base = series('2026-06-30', 40, () => 100)
  const mk = (len) => { const m = new Map(base); const keys = [...m.keys()]; for (let i = 0; i < len; i++) m.set(keys[keys.length - len + i], 101 + i); return m }
  const r = { ...RULE, kinds: only('streak') }
  assert.deepEqual(detectMilestones({ byDay: mk(5), day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true }).map(e => [e.kind, e.days]), [['streak', 5]])
  assert.deepEqual(detectMilestones({ byDay: mk(6), day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true }), [])
  assert.deepEqual(detectMilestones({ byDay: mk(10), day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true }).map(e => e.days), [10])
  assert.deepEqual(detectMilestones({ byDay: mk(4), day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true }), [])
  const [e] = detectMilestones({ byDay: mk(5), day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true })
  assert.equal(e.from, 100); assert.equal(e.value, 105)
})

await test('running total crossing a round mark (auto and fixed step); not for non-additive metrics', () => {
  const byDay = series('2026-06-30', 40, () => 100)
  const r = { ...RULE, kinds: only('total') }
  const [e] = detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true, totalAfter: 10050 })
  assert.equal(e.kind, 'total'); assert.equal(e.mark, 10000)
  assert.deepEqual(detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true, totalAfter: 10150 }), [])
  assert.equal(detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...r, totalStep: 500 }, additive: true, totalAfter: 10550 })[0].mark, 10500)
  assert.deepEqual(detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: false, totalAfter: 10050 }), [])
})

await test('month record on the last day of the month; partial first month ignored', () => {
  // Data starts mid-January: January is partial, Feb–May complete, June is the best month.
  const byDay = new Map()
  for (let d = new Date('2026-01-15T00:00:00'); ymd(d) <= '2026-06-30'; d.setDate(d.getDate() + 1)) byDay.set(ymd(d), ymd(d) < '2026-02-01' ? 500 : ymd(d) >= '2026-06-01' ? 12 : 10)
  const r = { ...RULE, kinds: only('month') }
  const [e] = detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: true })
  assert.equal(e.kind, 'month'); assert.equal(e.month, '2026-06'); assert.equal(e.value, 360)
  assert.equal(e.previousMonth, '2026-03'); assert.equal(e.previous, 310)
  assert.deepEqual(detectMilestones({ byDay, day: '2026-06-29', historyStart: '2025-06-01', rule: r, additive: true }), [], 'only on the last day')
  assert.deepEqual(detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: r, additive: false }), [], 'not for ratios')
})

await test('disabled kinds are skipped', () => {
  const byDay = series('2026-06-30', 61, i => i + 1) // 60 days of growth: a multiple of 5
  const all = detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: RULE, additive: true, totalAfter: 1830 })
  assert.ok(all.some(e => e.kind === 'record') && all.some(e => e.kind === 'streak'), JSON.stringify(all))
  const none = detectMilestones({ byDay, day: '2026-06-30', historyStart: '2025-06-01', rule: { ...RULE, kinds: { record: false, month: false, streak: false, total: false } }, additive: true, totalAfter: 1830 })
  assert.deepEqual(none, [])
})

summary('milestones')
