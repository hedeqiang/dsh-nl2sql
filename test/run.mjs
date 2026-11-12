#!/usr/bin/env node
// nl2sql test runner.
//
//   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" test/run.mjs [options]
//   (or: npm test / pnpm test from the plugin directory)
//
// Options:
//   --filter <substr>   only run files whose path (relative to test/) contains <substr>; repeatable
//   --fast              skip test/integration/** (real MySQL/PostgreSQL/network)
//   --timeout <sec>     per-file timeout (default 180, or $NL2SQL_TEST_TIMEOUT)
//   --verbose, -v       stream each file's output instead of printing it only on failure
//   --list              list discovered files and exit
//
// Discovers test/**/*.test.mjs and test/**/*.test.cjs, runs each in its own child process with
// the DSH Electron runtime as Node (falls back to process.execPath), parses the "@@RESULT" /
// "@@SKIP" lines printed by test/lib/assert.mjs, prints a summary table and exits non-zero on
// failure. Files listed in EXPECTED_FAILURES (see test/KNOWN_FAILURES.md) are reported as
// "xfail" instead of failing the suite; if such a file passes it is reported as "XPASS".
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = dirname(TEST_DIR)
const ELECTRON = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'

/** Whole files expected to fail because of a known source bug: relPath → reason. Keep in sync with KNOWN_FAILURES.md. */
const EXPECTED_FAILURES = {}

// ------------------------------------------------------------------ args
const args = process.argv.slice(2)
const opts = { filters: [], fast: false, timeout: Number(process.env.NL2SQL_TEST_TIMEOUT ?? 180), verbose: false, list: false }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--filter' || a === '-f') opts.filters.push(args[++i] ?? '')
  else if (a.startsWith('--filter=')) opts.filters.push(a.slice(9))
  else if (a === '--fast') opts.fast = true
  else if (a === '--timeout') opts.timeout = Number(args[++i])
  else if (a === '--verbose' || a === '-v') opts.verbose = true
  else if (a === '--list') opts.list = true
  else if (a === '--help' || a === '-h') { console.log(readHelp()); process.exit(0) }
  else { console.error(`unknown option: ${a}`); process.exit(2) }
}
function readHelp() { return 'usage: run.mjs [--filter <substr>]... [--fast] [--timeout <sec>] [--verbose] [--list]' }

// ------------------------------------------------------------------ discovery
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'fixtures' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.test\.(mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}
const toRel = (p) => relative(TEST_DIR, p).split(sep).join('/')
const isIntegration = (rel) => rel.startsWith('integration/')
let files = walk(TEST_DIR).map(toRel).sort((a, b) => {
  const rank = (r) => (r.startsWith('unit/') ? 0 : r.startsWith('ui/') ? 1 : 2)
  return rank(a) - rank(b) || a.localeCompare(b)
})
const skippedFast = opts.fast ? files.filter(isIntegration) : []
if (opts.fast) files = files.filter((f) => !isIntegration(f))
if (opts.filters.length) files = files.filter((f) => opts.filters.some((s) => f.includes(s)))
if (opts.list) { for (const f of files) console.log(f); process.exit(0) }
if (!files.length) { console.error('no test files matched'); process.exit(1) }

// ------------------------------------------------------------------ runtime
// NL2SQL_TEST_RUNTIME overrides the runtime (e.g. a Linux Harness build or plain node in CI).
const override = process.env.NL2SQL_TEST_RUNTIME
const useElectron = !override && existsSync(ELECTRON)
const runtime = override || (useElectron ? ELECTRON : process.execPath)
console.log(`nl2sql tests — runtime: ${useElectron ? 'DeepSeek Harness (Electron as Node)' : process.execPath} · ${files.length} file(s) · timeout ${opts.timeout}s${opts.fast ? ' · --fast' : ''}\n`)

function runFile(rel) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(runtime, [join(TEST_DIR, rel)], {
      cwd: PLUGIN_DIR,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const onData = (chunk) => { out += chunk; if (opts.verbose) process.stdout.write(chunk) }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, opts.timeout * 1000)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const ms = Date.now() - t0
      const resLine = out.match(/^@@RESULT (\{.*\})$/m)
      const skipLine = out.match(/^@@SKIP (.*)$/m)
      const counts = resLine ? JSON.parse(resLine[1]) : null
      let status
      if (timedOut) status = 'timeout'
      else if (skipLine && !code) status = 'skip'
      else if (code === 0 && counts && !counts.fail) status = 'pass'
      else status = 'fail'
      resolve({ rel, status, code, signal, ms, counts, skipReason: skipLine?.[1], out })
    })
  })
}

// ------------------------------------------------------------------ run
const results = []
for (const rel of files) {
  const tty = process.stdout.isTTY && !opts.verbose
  if (tty) process.stdout.write(`  … ${rel}\r`)
  else if (opts.verbose) console.log(`\n▶ ${rel}`)
  const r = await runFile(rel)
  const expected = EXPECTED_FAILURES[rel]
  if (expected) r.status = r.status === 'pass' ? 'XPASS' : r.status === 'skip' ? 'skip' : 'xfail'
  results.push(r)
  if (tty) process.stdout.write(' '.repeat(rel.length + 6) + '\r')
  if (!opts.verbose && (r.status === 'fail' || r.status === 'timeout')) {
    console.log(`\n✖ ${rel} (${r.status}${r.code ? `, exit ${r.code}` : ''}${r.signal ? `, ${r.signal}` : ''})`)
    console.log(r.out.split('\n').filter((l) => !l.startsWith('@@')).slice(-60).map((l) => '  │ ' + l).join('\n'))
  }
}

// ------------------------------------------------------------------ summary table
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const fmtCounts = (r) => {
  if (r.status === 'skip') return r.skipReason ?? ''
  if (!r.counts) return '—'
  const c = r.counts
  return [`${c.pass} passed`, `${c.fail} failed`, c.skip && `${c.skip} skipped`, c.xfail && `${c.xfail} xfail`, c.xpass && `${c.xpass} XPASS`].filter(Boolean).join(', ')
}
const rows = results.map((r) => [r.rel, r.status, fmtMs(r.ms), fmtCounts(r)])
for (const f of skippedFast) rows.push([f, 'skip', '-', '--fast'])
const head = ['file', 'status', 'time', 'tests']
const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (i === 3 ? 0 : String(r[i]).length))))
const line = (cells) => cells.map((c, i) => (i === 3 ? c : String(c).padEnd(w[i]))).join('  ')
console.log('\n' + line(head))
console.log(line(w.map((n) => '-'.repeat(n)).concat('-'.repeat(5))))
for (const r of rows) console.log(line(r))

const sum = (k) => results.reduce((s, r) => s + (r.counts?.[k] ?? 0), 0)
const by = (s) => results.filter((r) => r.status === s).length
const failed = results.filter((r) => r.status === 'fail' || r.status === 'timeout')
const total = results.reduce((s, r) => s + r.ms, 0)
console.log(`\nfiles: ${by('pass')} passed, ${failed.length} failed, ${by('skip') + skippedFast.length} skipped${by('xfail') ? `, ${by('xfail')} xfail` : ''}${by('XPASS') ? `, ${by('XPASS')} XPASS` : ''} · tests: ${sum('pass')} passed, ${sum('fail')} failed, ${sum('skip')} skipped${sum('xfail') ? `, ${sum('xfail')} xfail` : ''}${sum('xpass') ? `, ${sum('xpass')} XPASS` : ''} · ${fmtMs(total)}`)
if (by('xfail') || sum('xfail')) console.log('expected failures are documented in test/KNOWN_FAILURES.md')
if (by('XPASS') || sum('xpass')) console.log('XPASS: an expected failure now passes — update test/KNOWN_FAILURES.md and the xfail markers')
process.exit(failed.length ? 1 : 0)
