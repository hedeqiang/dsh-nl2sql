// Concatenate the client-src/ sections listed in SECTIONS (in that order) into lib/client.js.
// The browser half must be one module-loader factory, so sections share one
// closure scope; each section file is a slice of that factory body. There are no
// imports between sections: order matters only for top-level `const` values used
// while the factory runs (functions are hoisted). prelude.js opens the factory
// and apply.js registers the UI and closes it; both sit at the top of client-src/
// and stay first and last (the build checks this).
//   node scripts/build-client.mjs           build
//   node scripts/build-client.mjs --check   verify lib/client.js is up to date
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SECTIONS = [
  // opens the factory: keep first
  'prelude.js',

  // core: i18n, RPC, state, styles, icons, shared helpers, charts
  'core/locale.js',
  'core/rpc.js',
  'core/store.js',
  'core/css.js',
  'core/icons.js',
  'core/utilities.js',
  'core/feedback.js',
  'core/charts.js',

  // pages: the everyday tabs and their building blocks
  'pages/datasource-form.js',
  'pages/upload.js',
  'pages/sources.js',
  'pages/schema.js',
  'pages/ask.js',
  'pages/er-graph.js',
  'pages/knowledge.js',
  'pages/history.js',
  'pages/reports.js',
  'pages/feedback-form.js',
  'pages/policy.js',
  'pages/filter-bar.js',

  // channels: IM channel helpers, Markdown preview, send dialog, channel page
  'channels/shared.js',
  'channels/markdown-preview.js',
  'channels/send-dialog.js',
  'channels/channels-page.js',

  'pages/dashboard.js',
  'pages/drill-why.js',

  // admin: sections behind the 管理 tab
  'admin/alerts.js',
  'admin/evaluation.js',
  'admin/schema-changes.js',
  'admin/knowledge-io.js',
  'admin/suggestions.js',
  'admin/members.js',
  'admin/chat-policy.js',

  'pages/dashboard-switcher.js',

  // host: UI contributed to the DSH conversation (composer control, tool views)
  'host/composer-selector.js',
  'host/tool-views.js',

  'pages/page-shell.js',
  'admin/settings.js',

  // features: self-contained modules that register through `extend` (core/utilities.js)
  'features/freshness.js',
  'features/reconcile.js',
  'features/subscriptions.js',
  'features/proactive.js',
  'features/present.js',
  'features/mcp.js',

  // registers slots and closes the factory: keep last
  'apply.js',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'client-src')

function listJs(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = join(d, e.name)
    return e.isDirectory() ? listJs(p) : e.name.endsWith('.js') ? [relative(dir, p).split('\\').join('/')] : []
  })
}

function build() {
  const onDisk = new Set(listJs(dir))
  const missing = SECTIONS.filter(f => !onDisk.has(f))
  const unlisted = [...onDisk].filter(f => !SECTIONS.includes(f)).sort()
  const dupes = SECTIONS.filter((f, i) => SECTIONS.indexOf(f) !== i)
  const problems = [
    ...missing.map(f => `listed in SECTIONS but missing: client-src/${f}`),
    ...unlisted.map(f => `not listed in SECTIONS (scripts/build-client.mjs): client-src/${f}`),
    ...dupes.map(f => `listed twice in SECTIONS: ${f}`),
    ...(SECTIONS[0] === 'prelude.js' ? [] : ['SECTIONS must start with prelude.js (it opens the factory)']),
    ...(SECTIONS.at(-1) === 'apply.js' ? [] : ['SECTIONS must end with apply.js (it closes the factory)']),
  ]
  if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
  return SECTIONS.map(f => readFileSync(join(dir, f), 'utf8').replace(/\n$/, '')).join('\n') + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build()
  const target = join(root, 'lib', 'client.js')
  if (process.argv.includes('--check')) {
    const cur = readFileSync(target, 'utf8')
    if (cur !== out) { console.error('lib/client.js is out of date: run node scripts/build-client.mjs'); process.exit(1) }
    console.log(`lib/client.js up to date (${SECTIONS.length} sections)`)
  } else {
    writeFileSync(target, out)
    console.log(`built lib/client.js from ${SECTIONS.length} sections (${out.split('\n').length} lines)`)
  }
}
