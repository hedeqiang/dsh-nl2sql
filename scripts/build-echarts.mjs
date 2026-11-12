// Wrap the ECharts UMD build as a package-local lazy chunk (client.echarts.js)
// that the client loads with require.async only when a chart first renders.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const umd = readFileSync(join(root, 'node_modules/echarts/dist/echarts.min.js'), 'utf8')
const out = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tchunk: "client.echarts.js",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\t(function (module, exports, define, globalThis, self, window) {
${umd}
\t\t}).call(undefined, module, exports, undefined, {}, {}, {});
\t\treturn module.exports;
\t}
});
`
writeFileSync(join(root, 'lib/client.echarts.js'), out)
console.log('wrote lib/client.echarts.js', out.length, 'bytes')
