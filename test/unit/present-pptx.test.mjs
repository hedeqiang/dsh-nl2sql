// service/pptx.js (dependency-free PowerPoint writer) and service/present.js rendering helpers:
// OOXML package structure, relationship consistency, python-pptx round trip (when available),
// long-image SVG composition and Bitable value mapping.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, summary, assert, skip } from '../lib/assert.mjs'
import { plugin, tempDir } from '../lib/env.mjs'

const { buildPptx, unzip, PPTX_MEDIA_TYPE } = await plugin('service/pptx.js')
const { dashboardSvg, rasterize, fitText, bitableValue, fieldTypeFor, FIELD_TYPE, methods } = await plugin('service/present.js')
const { renderChartPng } = await plugin('channels/message.js')

const lineResult = { title: '每日交易笔数', datasourceName: '本地 MySQL', sql: 'SELECT d, n FROM t', rowCount: 3, columns: [{ name: 'd', kind: 'time' }, { name: 'n', kind: 'number' }], rows: [['2026-01-01', 10], ['2026-01-02', 12], ['2026-01-03', 8]], chart: { type: 'line', x: 'd', y: ['n'] } }
const tableResult = { title: '明细 <&> "x"', datasourceName: '本地 MySQL', sql: 'SELECT * FROM t WHERE a < 3 & b', rowCount: 40, columns: Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, kind: i % 2 ? 'number' : 'text' })), rows: Array.from({ length: 40 }, (_, r) => Array.from({ length: 10 }, (_, i) => (i % 2 ? r * i : `值${r}-${i}\u0001`))), chart: { type: 'table' } }
const kpiResult = { title: '总额', datasourceName: 'PG', sql: 'SELECT sum(x) total, count(*) n FROM t', rowCount: 1, columns: [{ name: 'total', kind: 'number' }, { name: 'n', kind: 'number' }], rows: [[123456789, 42]], chart: { type: 'kpi', y: ['total', 'n'] } }
const errResult = { title: '坏组件', error: 'Unknown column', columns: [], rows: [], sql: 'select x' }

/** Every relationship target of every .rels part must exist in the package. */
function checkRels(parts) {
  for (const [name, buf] of parts) {
    if (!name.endsWith('.rels')) continue
    const dir = name.replace(/_rels\/[^/]*\.rels$/, '')
    const xml = buf.toString('utf8')
    const ids = new Set()
    for (const m of xml.matchAll(/<Relationship Id="([^"]+)" Type="[^"]+" Target="([^"]+)"/g)) {
      assert.ok(!ids.has(m[1]), `duplicate rId ${m[1]} in ${name}`)
      ids.add(m[1])
      const segs = (dir + m[2]).split('/')
      const out = []
      for (const s of segs) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s) }
      assert.ok(parts.has(out.join('/')), `${name}: target ${m[2]} → ${out.join('/')} missing`)
    }
  }
}

function deck() {
  const slides = methods.presentPptx.call({ presentSourceNames: methods.presentSourceNames }, '测试看板', [lineResult, tableResult, kpiResult, errResult])
  return slides
}

let file
await test('presentPptx: file metadata and package structure', async () => {
  const out = deck()
  assert.equal(out.mediaType, PPTX_MEDIA_TYPE)
  assert.match(out.fileName, /^测试看板-\d{4}-\d{2}-\d{2}\.pptx$/)
  assert.equal(out.slides, 5)
  const buf = Buffer.from(out.base64, 'base64')
  file = join(tempDir('pptx'), 'deck.pptx')
  writeFileSync(file, buf)
  const parts = unzip(buf)
  const ct = parts.get('[Content_Types].xml').toString()
  assert.match(ct, /Default Extension="png" ContentType="image\/png"/)
  assert.match(ct, /PartName="\/ppt\/presentation.xml" ContentType="application\/vnd.openxmlformats-officedocument.presentationml.presentation.main\+xml"/)
  for (let i = 1; i <= 5; i++) assert.match(ct, new RegExp(`/ppt/slides/slide${i}.xml`))
  const pres = parts.get('ppt/presentation.xml').toString()
  assert.match(pres, /<p:sldSz cx="12192000" cy="6858000"\/>/, '16:9')
  assert.equal((pres.match(/<p:sldId /g) ?? []).length, 5)
  assert.equal([...parts.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length, 5)
  // one chart image (the line chart); table/kpi/error slides have none
  const media = [...parts.keys()].filter(k => k.startsWith('ppt/media/'))
  assert.deepEqual(media, ['ppt/media/image1.png'])
  assert.equal(parts.get('ppt/media/image1.png').subarray(1, 4).toString(), 'PNG')
  // every override part exists
  for (const m of ct.matchAll(/PartName="\/([^"]+)"/g)) assert.ok(parts.has(m[1]), `override ${m[1]} missing`)
  checkRels(parts)
  // table: ≤ 8 columns, ≤ 15 rows (+ header); escaped text; illegal chars dropped
  const s3 = parts.get('ppt/slides/slide3.xml').toString()
  assert.equal((s3.match(/<a:gridCol /g) ?? []).length, 8)
  assert.equal((s3.match(/<a:tr /g) ?? []).length, 16)
  assert.match(s3, /明细 &lt;&amp;&gt; &quot;x&quot;/)
  assert.ok(!s3.includes('\u0001'))
  // KPI slide shows the big formatted numbers
  assert.match(parts.get('ppt/slides/slide4.xml').toString(), /1\.23亿/)
  assert.match(parts.get('ppt/slides/slide5.xml').toString(), /查询失败：Unknown column/)
  // notes with SQL for each widget slide
  const notes = [...parts.keys()].filter(k => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(k))
  assert.equal(notes.length, 4)
  assert.match(parts.get('ppt/notesSlides/notesSlide2.xml').toString(), /SELECT \* FROM t WHERE a &lt; 3 &amp; b/)
  // title slide: name, date, data sources
  const s1 = parts.get('ppt/slides/slide1.xml').toString()
  assert.match(s1, /测试看板/)
  assert.match(s1, /数据源：本地 MySQL、PG/)
})

await test('python-pptx opens the generated deck', async () => {
  const py = ['/opt/homebrew/Caskroom/miniconda/base/bin/python3', 'python3'].find(p => spawnSync(p, ['-c', 'import pptx'], { stdio: 'ignore' }).status === 0)
  if (!py) skip('python3 with python-pptx not available')
  const script = `
import sys, json
from pptx import Presentation
p = Presentation(sys.argv[1])
out = {"w": p.slide_width, "h": p.slide_height, "slides": []}
for s in p.slides:
    texts = [sh.text_frame.text for sh in s.shapes if sh.has_text_frame]
    pics = sum(1 for sh in s.shapes if sh.shape_type == 13)
    tables = [ (len(sh.table.rows), len(sh.table.columns)) for sh in s.shapes if sh.has_table ]
    notes = s.notes_slide.notes_text_frame.text if s.has_notes_slide else None
    out["slides"].append({"texts": texts, "pics": pics, "tables": tables, "notes": notes})
print(json.dumps(out, ensure_ascii=False))
`
  const r = spawnSync(py, ['-c', script, file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const info = JSON.parse(r.stdout)
  assert.equal(info.w, 12192000)
  assert.equal(info.h, 6858000)
  assert.equal(info.slides.length, 5)
  assert.ok(info.slides[0].texts.includes('测试看板'))
  assert.equal(info.slides[1].pics, 1)
  assert.match(info.slides[1].notes, /SELECT d, n FROM t/)
  assert.deepEqual(info.slides[2].tables, [[16, 8]])
  assert.equal(info.slides[0].notes, null)
})

await test('buildPptx with no content slides is still a valid package', () => {
  const parts = unzip(buildPptx({ title: 'x' }))
  assert.ok(parts.has('ppt/slides/slide1.xml'))
  assert.ok(!parts.has('ppt/slides/slide2.xml'))
  checkRels(parts)
})

await test('dashboardSvg: 2-column grid, full-width rows, tables, KPI, escaping; rasterizes to PNG', () => {
  const items = [{ result: lineResult, width: 'half' }, { result: kpiResult, width: 'third' }, { result: tableResult, width: 'full' }, { result: errResult, width: 'half' }]
  const { svg, width, height } = dashboardSvg({ title: '看板 <x>', subtitle: '生成时间：now\n数据源：A', items, width: 1000 })
  assert.equal(width, 1000)
  assert.ok(height > 900, `tall image (${height})`)
  assert.match(svg, /看板 &lt;x&gt;/)
  assert.match(svg, /1\.23亿/)
  assert.match(svg, /共 40 行 × 10 列/)
  assert.match(svg, /查询失败：Unknown column/)
  assert.ok((svg.match(/<svg/g) ?? []).length >= 2, 'embedded echarts svg')
  const png = rasterize(svg, width, 1)
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 1000)
  assert.equal(png.readUInt32BE(20), height)
})

await test('fitText truncates by approximate width', () => {
  assert.equal(fitText('abc', 100, 10), 'abc')
  assert.ok(fitText('中'.repeat(50), 100, 10).endsWith('…'))
  assert.ok(fitText('中'.repeat(50), 100, 10).length <= 11)
})

await test('Bitable field type and value mapping', () => {
  assert.equal(fieldTypeFor('number'), FIELD_TYPE.number)
  assert.equal(fieldTypeFor('time'), FIELD_TYPE.datetime)
  assert.equal(fieldTypeFor('text'), FIELD_TYPE.text)
  assert.equal(bitableValue('12.5', 2), 12.5)
  assert.equal(bitableValue('abc', 2), undefined)
  assert.equal(bitableValue(null, 1), undefined)
  assert.equal(bitableValue(7, 1), '7')
  assert.equal(bitableValue('2026-01-02', 5), new Date(2026, 0, 2).getTime())
  assert.equal(bitableValue('2026-01-02 03:04:05', 5), new Date(2026, 0, 2, 3, 4, 5).getTime())
  assert.equal(bitableValue('2026-01-02T00:00:00Z', 5), Date.UTC(2026, 0, 2))
  assert.equal(bitableValue(1700000000, 5), 1700000000000)
  assert.equal(bitableValue('nope', 5), undefined)
})

await test('renderChartPng still works for slides (sanity)', () => {
  assert.equal(renderChartPng(lineResult).subarray(1, 4).toString(), 'PNG')
})

summary()
