/**
 * Platform-neutral message helpers shared by every channel adapter.
 *
 * OutboundMessage = { title, text?, results?, footer?, includeSql?, chartMode?, mentionAll?, template? }
 * ResultBlock     = { title, columns:[{name,kind}], rows, rowCount, truncated, chart, sql?, filters?, error?, actions? }
 * (see docs/CHANNELS.md)
 */
import * as echarts from 'echarts'
import { Resvg } from '@resvg/resvg-js'

// ------------------------------------------------------------ formatting

export function num(v) {
  return v === null || v === undefined || v === '' ? null : Number(v)
}

/** Compact number: 1.23亿 / 4.56万 / integers as-is / two decimals. */
export function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** A cell as display text, truncated to `max` characters. */
export function cellText(v, max = 80) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** A KPI-style result (one row) as `**col**：value ｜ …` Markdown. */
export function kpiText(result, { separator = '　｜　', bold = true } = {}) {
  const row = result.rows?.[0] ?? []
  return result.columns.map((c, i) => `${bold ? `**${c.name}**` : c.name}：${c.kind === 'number' ? fmtNum(row[i]) : cellText(row[i])}`).join(separator)
}

/** True when the result should be shown as KPI text rather than a table/chart. */
export function isKpi(result) {
  return result.chart?.type === 'kpi' || (result.rows.length === 1 && result.columns.length <= 6)
}

/** "12 行（已截断） · 已筛选：…" */
export function resultMeta(result) {
  return `${result.rowCount ?? result.rows?.length ?? 0} 行${result.truncated ? '（已截断）' : ''}${result.filters?.length ? ` · 已筛选：${result.filters.map(f => f.description).join('；')}` : ''}`
}

// ------------------------------------------------------- chart rendering

const PALETTE = ['#3370ff', '#34c724', '#ff8800', '#f54a45', '#7f3bf5', '#14c0ff', '#f14bc1', '#8f959e', '#a1d33b', '#ff7a45']

/** Move series onto a second y axis when magnitudes differ by more than 10x. Mutates series. */
export function dualAxis(series) {
  if (series.length < 2 || series.length > 4) return false
  const peak = series.map(s => Math.max(0, ...s.data.filter(v => Number.isFinite(v)).map(Math.abs)))
  const top = Math.max(...peak)
  if (!(top > 0)) return false
  const small = peak.map(p => p > 0 && top / p > 10)
  if (!small.some(Boolean) || small.every(Boolean)) return false
  series.forEach((s, i) => { if (small[i]) s.yAxisIndex = 1 })
  return true
}

/** ECharts option for a result, light theme for IM. */
export function chartOption(result) {
  const chart = result.chart ?? { type: 'table' }
  const idx = (name) => result.columns.findIndex(c => c.name === name)
  const xi = idx(chart.x)
  const ys = (chart.y ?? []).map(idx).filter(i => i >= 0)
  const si = chart.series ? idx(chart.series) : -1
  const base = { color: PALETTE, backgroundColor: '#ffffff', animation: false, textStyle: { fontFamily: 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif' } }
  if (chart.type === 'pie' || chart.type === 'funnel') {
    const data = result.rows.slice(0, 20).map(r => ({ name: String(r[xi] ?? 'NULL'), value: num(r[ys[0]]) }))
    return { ...base, legend: { bottom: 0, type: 'scroll' }, series: [chart.type === 'pie' ? { type: 'pie', radius: ['35%', '62%'], center: ['50%', '46%'], data, label: { formatter: '{b}\n{d}%' } } : { type: 'funnel', top: 20, bottom: 40, data }] }
  }
  if (chart.type === 'scatter') {
    return { ...base, grid: { left: 60, right: 30, top: 30, bottom: 40 }, xAxis: { type: 'value', name: chart.x }, yAxis: { type: 'value', name: result.columns[ys[0]]?.name }, series: [{ type: 'scatter', symbolSize: 7, data: result.rows.map(r => [num(r[xi]), num(r[ys[0]])]) }] }
  }
  const horizontal = chart.type === 'barh'
  const seriesType = chart.type === 'line' || chart.type === 'area' ? 'line' : 'bar'
  let categories
  let series
  if (si >= 0 && ys.length) {
    categories = [...new Set(result.rows.map(r => String(r[xi] ?? 'NULL')))]
    const groups = new Map()
    for (const r of result.rows) {
      const k = String(r[si] ?? 'NULL')
      if (!groups.has(k)) groups.set(k, new Map())
      groups.get(k).set(String(r[xi] ?? 'NULL'), num(r[ys[0]]))
    }
    series = [...groups.entries()].slice(0, 12).map(([name, m]) => ({ name, type: seriesType, data: categories.map(c => m.get(c) ?? null) }))
  } else {
    categories = result.rows.map(r => String(r[xi] ?? 'NULL'))
    series = ys.map(i => ({ name: result.columns[i].name, type: seriesType, data: result.rows.map(r => num(r[i])) }))
  }
  for (const s of series) {
    if (seriesType === 'line') { s.smooth = true; s.showSymbol = categories.length <= 31 }
    if (chart.type === 'area') s.areaStyle = { opacity: 0.15 }
    if (chart.type === 'stacked') s.stack = 'total'
    if (seriesType === 'bar') s.barMaxWidth = 32
  }
  const cat = { type: 'category', data: categories, axisLabel: { hideOverlap: true, color: '#646a73' } }
  const val = { type: 'value', axisLabel: { color: '#646a73', formatter: (v) => fmtNum(v) }, splitLine: { lineStyle: { color: '#eff0f1' } } }
  const dual = !horizontal && chart.type !== 'stacked' && dualAxis(series)
  return {
    ...base,
    legend: { show: series.length > 1, top: 0, type: 'scroll' },
    grid: { left: 16, right: 24, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : dual ? [val, { ...val, splitLine: { show: false } }] : val,
    series,
  }
}

/** Render a result's chart to a PNG Buffer (server-side ECharts SVG → resvg). */
export function renderChartPng(result, { width = 960, height = 480 } = {}) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    chart.setOption(chartOption(result))
    const svg = chart.renderToSVGString()
    return new Resvg(svg, { fitTo: { mode: 'width', value: width * 2 }, font: { loadSystemFonts: true, defaultFontFamily: 'PingFang SC' } }).render().asPng()
  } finally {
    chart.dispose()
  }
}

/** Whether a result can be drawn as a chart (not table/kpi, has rows and an x axis). */
export function chartable(result) {
  const t = result.chart?.type
  return Boolean(t && t !== 'table' && t !== 'kpi' && result.rows.length > 0 && (result.chart.x || t === 'scatter'))
}

// ------------------------------------------------------------- Markdown

/** A Markdown table block (header, separator, ≥ 1 row). Group 2 is the table. */
export const MD_TABLE = /(^|\n)(\|[^\n]*\|[ \t]*\n\|[ \t:|-]+\|[ \t]*\n(?:\|[^\n]*\|[ \t]*(?:\n|$))+)/g

/** Parse one Markdown table block into { columns:[{name,kind}], rows }. Numeric columns become numbers. */
export function parseMdTable(block) {
  const lines = block.trim().split('\n').map(l => l.trim())
  const split = (l) => l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
  const header = split(lines[0])
  const rows = lines.slice(2).map(split)
  const numeric = header.map((_, i) => rows.length > 0 && rows.every(r => r[i] === undefined || r[i] === '' || /^-?[\d,]+(\.\d+)?%?$/.test(r[i])))
  return {
    columns: header.map((name, i) => ({ name: name.replace(/\*\*/g, '') || ' ', kind: numeric[i] && rows.every(r => !/%$/.test(r[i] ?? '')) ? 'number' : 'text' })),
    rows: rows.map(r => header.map((_, i) => {
      const v = r[i] ?? ''
      return numeric[i] && !/%$/.test(v) && v !== '' ? Number(v.replace(/,/g, '')) : v
    })),
  }
}

/** Normalize line endings and trim. */
export function normalizeMarkdown(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n').trim()
}

/**
 * Strip the Lark-flavoured extensions for platforms with basic Markdown:
 * `<font color=…>x</font>` → `x`, `<at id=all></at>` → `@所有人` (or removed with
 * { mentionAll: '' }), `<at id=xxx>name</at>` → `@name`, other HTML tags removed.
 */
export function toPlainMarkdown(md, { mentionAll = '@所有人' } = {}) {
  return normalizeMarkdown(md)
    .replace(/<font\b[^>]*>([\s\S]*?)<\/font>/gi, '$1')
    .replace(/<at\s+id\s*=\s*["']?all["']?\s*>[\s\S]*?<\/at>/gi, mentionAll)
    .replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi, (_, name) => (name ? `@${name}` : ''))
    .replace(/<\/?(?:font|at|text_tag|span)\b[^>]*>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** True when the Markdown contains `<at id=all>`. */
export function mentionsAll(md) {
  return /<at\s+id\s*=\s*["']?all["']?\s*>/i.test(String(md ?? ''))
}

/** Remove Markdown syntax entirely (for platforms without Markdown). */
export function toPlainText(md) {
  return toPlainMarkdown(md)
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^>\s?/gm, '')
}

function mdCell(v, max = 40) {
  return cellText(v, max).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** A result as a Markdown table (≤ maxRows rows, ≤ maxCols columns), with a "… N more" note when cut. */
export function resultAsMarkdownTable(result, maxRows = 10, { maxCols = 8 } = {}) {
  const cols = (result.columns ?? []).slice(0, maxCols)
  if (!cols.length) return ''
  const rows = (result.rows ?? []).slice(0, maxRows)
  const lines = [
    `| ${cols.map(c => mdCell(c.name)).join(' | ')} |`,
    `| ${cols.map(c => (c.kind === 'number' ? '---:' : '---')).join(' | ')} |`,
    ...rows.map(r => `| ${cols.map((c, i) => mdCell(c.kind === 'number' && Number.isFinite(Number(r[i])) && r[i] !== null && r[i] !== '' ? Number(r[i]).toLocaleString('en-US', { maximumFractionDigits: 4 }) : r[i])).join(' | ')} |`),
  ]
  const total = result.rowCount ?? result.rows?.length ?? 0
  if (total > rows.length) lines.push('', `…共 ${total} 行，仅显示前 ${rows.length} 行`)
  return lines.join('\n')
}

/** A result as aligned plain text lines (for platforms without tables). */
export function resultAsText(result, maxRows = 10, { maxCols = 6 } = {}) {
  const cols = (result.columns ?? []).slice(0, maxCols)
  const rows = (result.rows ?? []).slice(0, maxRows)
  const lines = [cols.map(c => c.name).join(' | '), ...rows.map(r => cols.map((c, i) => (c.kind === 'number' ? fmtNum(r[i]) : cellText(r[i], 30))).join(' | '))]
  const total = result.rowCount ?? result.rows?.length ?? 0
  if (total > rows.length) lines.push(`…共 ${total} 行`)
  return lines.join('\n')
}

/**
 * A whole OutboundMessage as one Markdown document for platforms that render
 * Markdown but no cards. Charts become tables (adapters send PNGs separately).
 * @param {{ markdown?: 'full'|'basic'|'none', maxRows?: number, sqlMax?: number }} opts
 */
export function messageAsMarkdown(message, { markdown = 'basic', maxRows = 10, sqlMax = 1500 } = {}) {
  const clean = markdown === 'full' ? normalizeMarkdown : markdown === 'none' ? toPlainText : toPlainMarkdown
  const parts = []
  if (message.title) parts.push(markdown === 'none' ? String(message.title) : `**${message.title}**`)
  if (message.text) parts.push(clean(message.text))
  for (const r of message.results ?? []) {
    const head = markdown === 'none' ? `${r.title || '查询结果'}` : `**${r.title || '查询结果'}**`
    if (r.error) { parts.push(`${head}\n${r.error}`); continue }
    const lines = [`${head}  ${resultMeta(r)}`]
    if (!r.rows?.length) lines.push('无数据')
    else if (isKpi(r)) lines.push(kpiText(r, { bold: markdown !== 'none' }))
    else lines.push(markdown === 'none' ? resultAsText(r, maxRows) : resultAsMarkdownTable(r, maxRows))
    if (r.sql && message.includeSql) lines.push(markdown === 'none' ? r.sql.slice(0, sqlMax) : `\`\`\`sql\n${r.sql.slice(0, sqlMax)}\n\`\`\``)
    parts.push(lines.join('\n'))
  }
  if (message.footer) parts.push(clean(message.footer))
  return parts.join('\n\n')
}

/** Split text into chunks of at most `max` bytes (UTF-8), on paragraph/line boundaries when possible. */
export function splitText(text, max) {
  const s = String(text ?? '')
  if (!max || Buffer.byteLength(s) <= max) return [s]
  const out = []
  let chunk = ''
  const push = () => { if (chunk) out.push(chunk); chunk = '' }
  for (const line of s.split('\n')) {
    const next = chunk ? `${chunk}\n${line}` : line
    if (Buffer.byteLength(next) <= max) { chunk = next; continue }
    push()
    if (Buffer.byteLength(line) <= max) { chunk = line; continue }
    // A single over-long line: cut by characters.
    let piece = ''
    for (const ch of line) {
      if (Buffer.byteLength(piece + ch) > max) { out.push(piece); piece = '' }
      piece += ch
    }
    chunk = piece
  }
  push()
  return out
}
