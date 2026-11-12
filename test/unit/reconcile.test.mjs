// Reconciliation engine (service/reconcile.js): key normalization, tolerances, detail tables.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { compareResults, normalizeSpec, valuesEqual, normKey, summaryMarkdown } = await plugin('service/reconcile.js')

const res = (columns, rows, extra = {}) => ({ columns: columns.map(c => (typeof c === 'string' ? { name: c, kind: 'text' } : c)), rows, ...extra })

await test('valuesEqual: numbers, tolerance, relative, text options, NULL', () => {
  assert.equal(valuesEqual(1, '1.00'), true)
  assert.equal(valuesEqual(0.1 + 0.2, 0.3), true)
  assert.equal(valuesEqual(100, 100.4, { tolerance: 0.5 }), true)
  assert.equal(valuesEqual(100, 100.6, { tolerance: 0.5 }), false)
  assert.equal(valuesEqual(1000, 1001, { tolerance: 0.001, relative: true }), true)
  assert.equal(valuesEqual(1000, 1002, { tolerance: 0.001, relative: true }), false)
  assert.equal(valuesEqual(' Abc ', 'abc', {}, { trim: true, ignoreCase: true }), true)
  assert.equal(valuesEqual(' Abc ', 'abc', {}, { trim: true, ignoreCase: false }), false)
  assert.equal(valuesEqual('a ', 'a', {}, { trim: false }), false)
  assert.equal(valuesEqual(null, null), true)
  assert.equal(valuesEqual(null, 0), false)
  assert.equal(valuesEqual('2026-01-01T00:00:00.000Z', '2026-01-01'), true)
})

await test('normKey: engines agree on numeric and date keys; codes keep leading zeros', () => {
  assert.equal(normKey(42), normKey('42'))
  assert.equal(normKey('42.0'), normKey(42))
  assert.notEqual(normKey('007'), normKey(7))
  assert.equal(normKey('2026-03-01 00:00:00'), normKey('2026-03-01'))
  assert.equal(normKey(' X1 ', { trim: true, ignoreCase: true }), normKey('x1', { trim: true, ignoreCase: true }))
  assert.notEqual(normKey(null), normKey('NULL'))
})

await test('normalizeSpec: defaults and validation', () => {
  const s = normalizeSpec({ keys: ['id'], compare: [{ left: 'amt', right: 'amount', tolerance: '0.01' }] })
  assert.deepEqual(s.keys, [{ left: 'id', right: 'id' }])
  assert.deepEqual(s.compare, [{ left: 'amt', right: 'amount', tolerance: 0.01, relative: false }])
  assert.deepEqual(s.options, { trim: true, ignoreCase: false })
  assert.throws(() => normalizeSpec({ keys: [] }), /键列/)
  assert.throws(() => normalizeSpec({ keys: ['id'], compare: [{ left: 'x', tolerance: -1 }] }), /容差/)
})

await test('compareResults: matched, only-left/right, mismatches, totals, tables', () => {
  const L = res([{ name: 'id', kind: 'number' }, { name: 'amount', kind: 'number' }, 'status'], [[1, 10, 'ok'], [2, 20, 'ok'], [3, 30, 'ok'], [4, 40, 'ok']])
  const R = res([{ name: 'order_id', kind: 'text' }, { name: 'amt', kind: 'number' }, 'state'], [['1', '10.00', 'OK '], ['2', 21, 'ok'], ['3', 30.004, 'bad'], ['5', 50, 'ok']])
  const spec = normalizeSpec({ keys: [{ left: 'id', right: 'order_id' }], compare: [{ left: 'amount', right: 'amt', tolerance: 0.01 }, { left: 'status', right: 'state' }], options: { ignoreCase: true } })
  const out = compareResults(L, R, spec, { leftName: 'A', rightName: 'B' })
  const s = out.summary
  assert.equal(s.matched, 3)
  assert.equal(s.onlyLeft, 1)
  assert.equal(s.onlyRight, 1)
  assert.equal(s.mismatchedRows, 2) // id 2 amount, id 3 status
  assert.equal(s.columns[0].mismatches, 1)
  assert.equal(s.columns[1].mismatches, 1)
  assert.equal(s.columns[0].leftTotal, 100)
  assert.equal(s.columns[0].rightTotal, 111.004)
  assert.equal(s.columns[1].leftTotal, undefined)
  assert.equal(s.hasDiff, true)
  assert.equal(s.consistent, 1)
  assert.ok(Math.abs(s.matchRate - 1 / 5) < 1e-9)
  assert.ok(Math.abs(s.keyMatchRate - 3 / 5) < 1e-9)
  const mm = out.tables.mismatches
  assert.deepEqual(mm.columns.map(c => c.name), ['id', 'amount/amt [A]', 'amount/amt [B]', 'amount/amt 差值', 'status/state [A]', 'status/state [B]', '差异列'])
  assert.deepEqual(mm.rows[0], [2, 20, 21, -1, 'ok', 'ok', 'amount/amt'])
  assert.equal(mm.rows[1].at(-1), 'status/state')
  assert.deepEqual(out.tables.onlyLeft.rows, [[4, 40, 'ok']])
  assert.deepEqual(out.tables.onlyRight.rows, [['5', 50, 'ok']])
  assert.deepEqual(out.tables.onlyRight.columns.map(c => c.name), ['id', 'amt', 'state'])
  assert.equal(out.tables.summary.rows[0][0], '行数')
  assert.equal(out.diffs.length, 4)
  assert.deepEqual(out.diffs[0], { type: 'mismatch', key: { id: 2 }, columns: 'amount/amt', values: { 'amount/amt': { left: 20, right: 21 }, 'status/state': { left: 'ok', right: 'ok' } } })
  const md = summaryMarkdown({ ...out, left: { datasourceName: 'A' }, right: { datasourceName: 'B' } })
  assert.match(md, /发现差异/)
  assert.match(md, /\| amount\/amt（容差 0.01） \| 1 \|/)
})

await test('compareResults: composite keys, duplicates, truncation and masking warnings', () => {
  const L = res(['day', 'ch', { name: 'n', kind: 'number' }], [['2026-01-01', 'a', 1], ['2026-01-01', 'b', 2], ['2026-01-01', 'b', 9]], { truncated: true })
  const R = res(['day', 'ch', { name: 'n', kind: 'number' }, { name: 'phone', kind: 'text', masked: true }], [['2026-01-01T00:00:00Z', 'a', 1, 'x'], ['2026-01-01', 'b', 2, 'y']])
  const out = compareResults(L, R, normalizeSpec({ keys: ['day', 'ch'], compare: [{ left: 'n' }] }))
  assert.equal(out.summary.matched, 2)
  assert.equal(out.summary.mismatchedRows, 0)
  assert.equal(out.summary.duplicates.left, 1)
  assert.equal(out.summary.hasDiff, false)
  assert.equal(out.summary.complete, false)
  assert.ok(out.warnings.some(w => /截断/.test(w)))
  assert.ok(out.warnings.some(w => /重复/.test(w)))
  const masked = compareResults(L, R, normalizeSpec({ keys: [{ left: 'ch', right: 'phone' }] }))
  assert.ok(masked.warnings.some(w => /脱敏/.test(w)))
})

await test('compareResults: unknown column names list the available ones', () => {
  assert.throws(() => compareResults(res(['a'], []), res(['b'], []), normalizeSpec({ keys: ['a'] })), /右侧结果中没有键列「a」。可用列：b/)
})

await test('compareResults: no compare columns, large inputs and detail cap', () => {
  const n = 50000
  const L = res([{ name: 'id', kind: 'number' }], Array.from({ length: n }, (_, i) => [i]))
  const R = res([{ name: 'id', kind: 'number' }], Array.from({ length: n }, (_, i) => [i + 10]))
  const t0 = Date.now()
  const out = compareResults(L, R, normalizeSpec({ keys: ['id'] }), { detailLimit: 5 })
  assert.equal(out.summary.matched, n - 10)
  assert.equal(out.summary.onlyLeft, 10)
  assert.equal(out.tables.onlyLeft.rows.length, 5)
  assert.equal(out.tables.onlyLeft.truncated, true)
  assert.equal(out.tables.mismatches.rows.length, 0)
  assert.ok(Date.now() - t0 < 10000)
})

summary()
