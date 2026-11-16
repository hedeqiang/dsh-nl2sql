// lib/client.js must be the concatenation of client-src/ (edit client-src, then run scripts/build-client.mjs).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { join } from 'node:path'
import { test, summary, assert } from '../lib/assert.mjs'
import { PLUGIN_DIR } from '../lib/env.mjs'

await test('lib/client.js is built from client-src', () => {
  try {
    execFileSync(process.execPath, [join(PLUGIN_DIR, 'scripts', 'build-client.mjs'), '--check'], { stdio: 'pipe', env: { ...process.env } })
  } catch (e) {
    assert.fail(String(e.stderr || e.message))
  }
})
// Compiles without jsdom / React, so a syntax error fails here even when the ui/ tests are skipped.
await test('lib/client.js parses', () => {
  const file = join(PLUGIN_DIR, 'lib', 'client.js')
  new Script(readFileSync(file, 'utf8'), { filename: file })
})
summary('client build')
