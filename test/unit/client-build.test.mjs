// lib/client.js must be the concatenation of client-src/ (edit client-src, then run scripts/build-client.mjs).
import { execFileSync } from 'node:child_process'
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
summary('client build')
