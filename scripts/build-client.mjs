// Concatenate client-src/*.js (in file-name order) into lib/client.js.
// The browser half must be one module-loader factory, so sections share one
// closure scope; each section file is a slice of that factory body.
//   node scripts/build-client.mjs           build
//   node scripts/build-client.mjs --check   verify lib/client.js is up to date
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'client-src')
const files = readdirSync(dir).filter(f => /^\d\d[a-z]?-.*\.js$/.test(f)).sort()
const out = files.map(f => readFileSync(join(dir, f), 'utf8').replace(/\n$/, '')).join('\n') + '\n'
const target = join(root, 'lib', 'client.js')
if (process.argv.includes('--check')) {
  const cur = readFileSync(target, 'utf8')
  if (cur !== out) { console.error('lib/client.js is out of date: run node scripts/build-client.mjs'); process.exit(1) }
  console.log(`lib/client.js up to date (${files.length} sections)`)
} else {
  writeFileSync(target, out)
  console.log(`built lib/client.js from ${files.length} sections (${out.split('\n').length} lines)`)
}
