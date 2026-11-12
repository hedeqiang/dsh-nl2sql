// Tiny test helper shared by every nl2sql test file.
//
//   import { test, skip, skipFile, summary, assert } from '../lib/assert.mjs'
//   await test('name', async () => { assert.equal(1, 1) })
//   summary()
//
// Tests run sequentially in the order they are awaited. Inside a test call
// skip('reason') to mark it skipped. Use test.xfail(name, reason, fn) for a
// test that documents a known source bug (see test/KNOWN_FAILURES.md): it
// counts as "xfail" while it fails and as "XPASS" (reported, not fatal) once
// the bug is fixed.
//
// summary() prints "N passed, M failed" plus a machine-readable line
// "@@RESULT {...}" that test/run.mjs parses. skipFile(reason) skips the whole
// file (e.g. database unavailable) and exits 0 with "@@SKIP reason".
import assert from 'node:assert/strict'

export { assert }

const stats = { pass: 0, fail: 0, skip: 0, xfail: 0, xpass: 0, failures: [] }
let printed = false
const only = process.env.NL2SQL_TEST_GREP ? new RegExp(process.env.NL2SQL_TEST_GREP, 'i') : null

class SkipSignal extends Error { constructor(reason) { super(reason); this.skip = true } }

/** Skip the current test from inside its body. */
export function skip(reason = 'skipped') { throw new SkipSignal(reason) }

function describeError(e) {
  const text = e?.stack && !(e instanceof assert.AssertionError) ? e.stack : String(e?.message ?? e)
  return text.split('\n').slice(0, 14).join('\n    ')
}

/** Run one test; awaiting it keeps tests sequential. Never throws. */
export async function test(name, fn) {
  if (only && !only.test(name)) return
  const t0 = Date.now()
  try {
    await fn()
    stats.pass++
    console.log(`  ok    ${name} (${Date.now() - t0}ms)`)
  } catch (e) {
    if (e?.skip) { stats.skip++; console.log(`  skip  ${name} — ${e.message}`); return }
    stats.fail++
    stats.failures.push(name)
    console.log(`  FAIL  ${name}\n    ${describeError(e)}`)
  }
}

/** A test expected to fail because of a known, recorded source bug. */
test.xfail = async function xfail(name, reason, fn) {
  if (only && !only.test(name)) return
  try {
    await fn()
    stats.xpass++
    console.log(`  XPASS ${name} — expected failure now passes; update test/KNOWN_FAILURES.md (${reason})`)
  } catch (e) {
    if (e?.skip) { stats.skip++; console.log(`  skip  ${name} — ${e.message}`); return }
    stats.xfail++
    console.log(`  xfail ${name} — ${reason}\n    ${describeError(e).split('\n')[0]}`)
  }
}

/** Skip the whole file (prints @@SKIP for the runner) and exit cleanly. */
export function skipFile(reason) {
  printed = true
  console.log(`@@SKIP ${reason}`)
  process.exit(0)
}

/** Print totals; sets a non-zero exit code on failure. Forces exit after a grace period if handles leak. */
export function summary(label = '') {
  if (printed) return
  printed = true
  const { pass, fail, skip: skipped, xfail, xpass } = stats
  const extra = [skipped && `${skipped} skipped`, xfail && `${xfail} expected failures`, xpass && `${xpass} unexpectedly passed`].filter(Boolean)
  console.log(`\n${label ? label + ': ' : ''}${pass} passed, ${fail} failed${extra.length ? ', ' + extra.join(', ') : ''}`)
  if (fail) console.log('failed:', stats.failures.join(' | '))
  console.log('@@RESULT ' + JSON.stringify({ pass, fail, skip: skipped, xfail, xpass }))
  if (fail) process.exitCode = 1
  // Let the process exit naturally; if something keeps the loop alive, force it.
  setTimeout(() => process.exit(), Number(process.env.NL2SQL_TEST_EXIT_GRACE_MS ?? 3000)).unref()
}

// A file that crashes or forgets summary() still reports what ran.
process.on('exit', (code) => {
  if (printed) return
  if (code && !stats.fail) stats.fail++
  printed = true
  console.log('@@RESULT ' + JSON.stringify({ pass: stats.pass, fail: stats.fail, skip: stats.skip, xfail: stats.xfail, xpass: stats.xpass }))
})

export { stats }
