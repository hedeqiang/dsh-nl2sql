/**
 * IM delivery: Lark / Feishu.
 *
 * Two channel kinds:
 *   - lark_webhook: a group custom bot (webhook URL + optional signing secret).
 *     Cannot upload images, so charts are sent as tables.
 *   - lark_app: a custom app bot (app_id + app_secret) sending to a chat,
 *     user or email through the IM API; charts are rendered to PNG on the
 *     Host and uploaded as images.
 *
 * Messages are interactive cards (JSON 2.0) built from a title, Markdown text
 * and query results.
 */
import { createHmac } from 'node:crypto'
import * as echarts from 'echarts'
import { Resvg } from '@resvg/resvg-js'

export class ImError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const HOSTS = { feishu: 'https://open.feishu.cn', lark: 'https://open.larksuite.com' }
export const RECEIVE_ID_TYPES = ['chat_id', 'open_id', 'user_id', 'union_id', 'email']

function hostFor(channel) {
  return HOSTS[channel.domain === 'lark' ? 'lark' : 'feishu']
}

async function postJson(url, body, headers = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
    return { status: res.status, json }
  } catch (error) {
    throw new ImError('im/network', error.name === 'AbortError' ? '请求飞书接口超时' : `无法访问飞书接口：${error.cause?.code ?? error.message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** Custom-bot signature: HMAC-SHA256 keyed by `${timestamp}\n${secret}` over an empty message, base64. */
export function larkSign(secret, timestamp) {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

function larkError(json, status) {
  const code = json?.code ?? json?.StatusCode
  const msg = json?.msg ?? json?.StatusMessage ?? json?.raw ?? `HTTP ${status}`
  const hints = {
    19021: '签名校验失败：请检查签名密钥，以及本机时间是否准确',
    19024: '关键词校验失败：消息中没有包含机器人设置的关键词',
    19022: 'IP 不在机器人白名单中',
    9499: '请求格式错误',
    11232: '发送频率过高，请稍后再试',
    99991663: 'tenant_access_token 无效',
    99991672: '应用缺少权限，请在开发者后台为应用开通 im:message:send_as_bot 和 im:resource 权限',
    230002: '机器人不在该群中，请先把应用机器人拉进群',
    230001: '接收者 ID 无效',
    230013: '接收者不在应用的可用范围内',
    10003: 'app_id 或 app_secret 错误',
  }
  return new ImError(`im/lark-${code ?? status}`, `${hints[code] ? `${hints[code]}（${msg}）` : `飞书返回错误 ${code ?? status}：${msg}`}`)
}

// ----------------------------------------------------------- app tokens

const tokenCache = new Map()

async function tenantToken(channel, secrets) {
  const key = `${hostFor(channel)}|${channel.appId}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token
  if (!channel.appId || !secrets.appSecret) throw new ImError('im/config', '缺少 App ID 或 App Secret')
  const { status, json } = await postJson(`${hostFor(channel)}/open-apis/auth/v3/tenant_access_token/internal`, { app_id: channel.appId, app_secret: secrets.appSecret })
  if (json.code !== 0 || !json.tenant_access_token) throw larkError(json, status)
  tokenCache.set(key, { token: json.tenant_access_token, expiresAt: Date.now() + (json.expire ?? 7200) * 1000 })
  return json.tenant_access_token
}

async function uploadImage(channel, secrets, png) {
  const token = await tenantToken(channel, secrets)
  const form = new FormData()
  form.set('image_type', 'message')
  form.set('image', new Blob([png], { type: 'image/png' }), 'chart.png')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(`${hostFor(channel)}/open-apis/im/v1/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: controller.signal })
    const json = await res.json().catch(() => ({}))
    if (json.code !== 0) throw larkError(json, res.status)
    return json.data.image_key
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------- chart rendering

const PALETTE = ['#3370ff', '#34c724', '#ff8800', '#f54a45', '#7f3bf5', '#14c0ff', '#f14bc1', '#8f959e', '#a1d33b', '#ff7a45']

function num(v) {
  return v === null || v === undefined || v === '' ? null : Number(v)
}

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

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

export function chartable(result) {
  const t = result.chart?.type
  return Boolean(t && t !== 'table' && t !== 'kpi' && result.rows.length > 0 && (result.chart.x || t === 'scatter'))
}

// ------------------------------------------------------------ card build

const CARD_LIMIT = 28000

function cellText(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return s.length > 80 ? `${s.slice(0, 79)}…` : s
}

function tableElement(result, maxRows) {
  const cols = result.columns.slice(0, 8)
  return {
    tag: 'table',
    page_size: Math.min(10, Math.max(1, Math.min(maxRows, result.rows.length))),
    row_height: 'low',
    header_style: { background_style: 'grey', bold: true, text_size: 'normal' },
    columns: cols.map((c, i) => ({ name: `c${i}`, display_name: c.name, data_type: c.kind === 'number' ? 'number' : 'text', ...(c.kind === 'number' ? { format: { separator: true } } : {}), width: 'auto' })),
    rows: result.rows.slice(0, maxRows).map(r => Object.fromEntries(cols.map((c, i) => [`c${i}`, c.kind === 'number' && Number.isFinite(Number(r[i])) ? Number(r[i]) : cellText(r[i])]))),
  }
}

function kpiMarkdown(result) {
  const row = result.rows[0] ?? []
  return result.columns.map((c, i) => `**${c.name}**：${c.kind === 'number' ? fmtNum(row[i]) : cellText(row[i])}`).join('　｜　')
}

/**
 * A native card chart (VChart spec) for a result. Works for webhook and app
 * bots alike and stays interactive in the client.
 */
export function chartElement(result, { maxPoints = 200 } = {}) {
  const chart = result.chart ?? {}
  const idx = (name) => result.columns.findIndex(c => c.name === name)
  const xi = idx(chart.x)
  const ys = (chart.y ?? []).map(idx).filter(i => i >= 0)
  const si = chart.series ? idx(chart.series) : -1
  if (xi < 0 || !ys.length) return undefined
  const rows = result.rows.slice(0, maxPoints)
  const label = (v) => (v === null || v === undefined ? 'NULL' : String(v))
  let spec
  if (chart.type === 'pie' || chart.type === 'funnel') {
    const values = rows.slice(0, 20).map(r => ({ type: label(r[xi]), value: num(r[ys[0]]) }))
    spec = chart.type === 'pie'
      ? { type: 'pie', data: { values }, valueField: 'value', categoryField: 'type', outerRadius: 0.85, innerRadius: 0.45, label: { visible: true }, legends: { visible: true, orient: 'bottom' } }
      : { type: 'funnel', data: { values }, categoryField: 'type', valueField: 'value', isTransform: true, label: { visible: true }, transformLabel: { visible: true }, outerLabel: { visible: false } }
  } else if (chart.type === 'scatter') {
    spec = { type: 'scatter', data: { values: rows.map(r => ({ x: num(r[xi]), y: num(r[ys[0]]) })) }, xField: 'x', yField: 'y', axes: [{ orient: 'bottom', type: 'linear', title: { visible: true, text: chart.x } }, { orient: 'left', type: 'linear', title: { visible: true, text: result.columns[ys[0]].name } }] }
  } else {
    // Long format: one row per (x, series) so one spec covers multi-measure and series charts.
    const values = []
    if (si >= 0) {
      for (const r of rows) values.push({ x: label(r[xi]), s: label(r[si]), v: num(r[ys[0]]) })
    } else {
      for (const r of rows) for (const i of ys) values.push({ x: label(r[xi]), s: result.columns[i].name, v: num(r[i]) })
    }
    const multi = si >= 0 || ys.length > 1
    const type = chart.type === 'line' ? 'line' : chart.type === 'area' ? 'area' : 'bar'
    const horizontal = chart.type === 'barh'
    // Second axis when magnitudes differ by more than 10x (two-measure line/area/bar).
    if (!horizontal && chart.type !== 'stacked' && si < 0 && ys.length === 2) {
      const peaks = ys.map(i => Math.max(0, ...rows.map(r => Math.abs(num(r[i]) ?? 0))))
      const [hi, lo] = peaks[0] >= peaks[1] ? [0, 1] : [1, 0]
      if (peaks[lo] > 0 && peaks[hi] / peaks[lo] > 10) {
        const name = (k) => result.columns[ys[k]].name
        spec = {
          type: 'common',
          data: [{ id: 'a', values: rows.map(r => ({ x: label(r[xi]), v: num(r[ys[hi]]), s: name(hi) })) }, { id: 'b', values: rows.map(r => ({ x: label(r[xi]), v: num(r[ys[lo]]), s: name(lo) })) }],
          series: [
            { type: type === 'bar' ? 'bar' : type, dataIndex: 0, xField: 'x', yField: 'v', seriesField: 's' },
            { type: 'line', dataIndex: 1, xField: 'x', yField: 'v', seriesField: 's' },
          ],
          axes: [{ orient: 'left', seriesIndex: [0] }, { orient: 'right', seriesIndex: [1], grid: { visible: false } }, { orient: 'bottom', type: 'band' }],
          legends: { visible: true, orient: 'bottom' },
        }
      }
    }
    spec ??= horizontal
      ? { type: 'bar', direction: 'horizontal', data: { values }, xField: 'v', yField: multi ? ['x', 's'] : 'x', ...(multi ? { seriesField: 's' } : {}), axes: [{ orient: 'left', type: 'band', inverse: true }] }
      : {
          type, data: { values },
          xField: type === 'bar' && multi && chart.type !== 'stacked' ? ['x', 's'] : 'x',
          yField: 'v',
          ...(multi ? { seriesField: 's', legends: { visible: true, orient: 'bottom' } } : {}),
          ...(chart.type === 'stacked' ? { stack: true } : {}),
          ...(type !== 'bar' ? { point: { visible: rows.length <= 31 } } : {}),
        }
  }
  return { tag: 'chart', aspect_ratio: chart.type === 'pie' || chart.type === 'funnel' ? '4:3' : '16:9', chart_spec: { ...spec, title: { visible: false } } }
}

// Feishu markdown tables show at most five rows per page and four tables per
// component; bigger tables become table components instead.
const MD_TABLE = /(^|\n)(\|[^\n]*\|[ \t]*\n\|[ \t:|-]+\|[ \t]*\n(?:\|[^\n]*\|[ \t]*(?:\n|$))+)/g

function parseMdTable(block) {
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

/** Split Markdown into card elements: text stays Markdown; large tables become table components. */
export function markdownElements(md) {
  const text = String(md ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const out = []
  let last = 0
  let mdTables = 0
  for (const m of text.matchAll(MD_TABLE)) {
    const block = m[2]
    const start = m.index + m[1].length
    const table = parseMdTable(block)
    // Small tables render fine inline (≤ 5 rows, ≤ 4 per component); keep them in the Markdown.
    if (table.rows.length <= 5 && mdTables < 4 && table.columns.length <= 8) { mdTables++; continue }
    const before = text.slice(last, start).trim()
    if (before) out.push({ tag: 'markdown', content: before })
    out.push(tableElement(table, 50))
    last = start + block.length
  }
  const rest = text.slice(last).trim()
  if (rest) {
    // A component holds at most ~10k characters comfortably; split long text on paragraph boundaries.
    let chunk = ''
    for (const para of rest.split(/\n{2,}/)) {
      if (chunk && chunk.length + para.length > 6000) { out.push({ tag: 'markdown', content: chunk }); chunk = '' }
      chunk = chunk ? `${chunk}\n\n${para}` : para
    }
    if (chunk) out.push({ tag: 'markdown', content: chunk })
  }
  return out
}

/**
 * Build a JSON 2.0 card.
 * @param {{ title: string, text?: string, results?: object[], footer?: string, template?: string, includeSql?: boolean }} message
 *   text is Markdown (headings, lists, code, tables, links, <font>, <at> ...).
 *   results may carry imageKey when a PNG was uploaded (app bots, fallback).
 */
export function buildCard(message, { maxRows = 10, charts = true } = {}) {
  const elements = [...markdownElements(message.text)]
  let tables = elements.filter(e => e.tag === 'table').length
  let chartCount = 0
  for (const r of message.results ?? []) {
    if (elements.length) elements.push({ tag: 'hr' })
    if (r.error) {
      elements.push({ tag: 'markdown', content: `**${r.title || '查询'}**\n<font color='red'>${r.error}</font>` })
      continue
    }
    const head = [`**${r.title || '查询结果'}**`, `<font color='grey'>${r.rowCount ?? r.rows.length} 行${r.truncated ? '（已截断）' : ''}${r.filters?.length ? ` · 已筛选：${r.filters.map(f => f.description).join('；')}` : ''}</font>`].join('  ')
    elements.push({ tag: 'markdown', content: head })
    const nativeChart = charts && chartCount < 5 && chartable(r) ? chartElement(r) : undefined
    if (r.rows.length === 0) {
      elements.push({ tag: 'markdown', content: '<font color=\'grey\'>无数据</font>' })
    } else if (r.chart?.type === 'kpi' || (r.rows.length === 1 && r.columns.length <= 6)) {
      elements.push({ tag: 'markdown', content: kpiMarkdown(r) })
    } else if (nativeChart) {
      elements.push(nativeChart)
      chartCount++
    } else if (r.imageKey) {
      elements.push({ tag: 'img', img_key: r.imageKey, alt: { tag: 'plain_text', content: r.title || 'chart' }, scale_type: 'fit_horizontal', preview: true })
    } else if (tables < 5) {
      elements.push(tableElement(r, maxRows))
      tables++
    } else {
      elements.push({ tag: 'markdown', content: r.rows.slice(0, 5).map(row => row.slice(0, 6).map(cellText).join(' | ')).join('\n') })
    }
    if (r.sql && message.includeSql) elements.push({ tag: 'markdown', content: `\`\`\`sql\n${r.sql.slice(0, 1500)}\n\`\`\`` })
  }
  if (message.footer) elements.push({ tag: 'markdown', content: `<font color='grey'>${message.footer}</font>`, text_size: 'notation' })
  const card = {
    schema: '2.0',
    config: { wide_screen_mode: true, summary: { content: String(message.title).slice(0, 60) } },
    header: { template: message.template ?? 'blue', title: { tag: 'plain_text', content: String(message.title).slice(0, 100) } },
    body: { elements },
  }
  // Card bodies are limited to ~30 KB: shrink tables/charts until it fits.
  const size = Buffer.byteLength(JSON.stringify(card))
  if (size > CARD_LIMIT && maxRows > 3) return buildCard(message, { maxRows: Math.max(3, Math.floor(maxRows / 2)), charts })
  if (size > CARD_LIMIT && charts) return buildCard(message, { maxRows, charts: false })
  if (size > CARD_LIMIT) {
    card.body.elements = elements.filter(e => e.tag !== 'table')
    card.body.elements.push({ tag: 'markdown', content: '<font color=\'grey\'>（数据过多，表格已省略）</font>' })
  }
  return card
}

/** JSON 1.0 fallback: lark_md only, for bots/clients rejecting 2.0 components. */
function legacyCard(card) {
  const md = card.body.elements.map(e => {
    if (e.tag === 'markdown') return e.content
    if (e.tag === 'hr') return '---'
    if (e.tag === 'table') return [e.columns.map(c => c.display_name).join(' | '), ...e.rows.slice(0, 10).map(r => e.columns.map(c => cellText(r[c.name])).join(' | '))].join('\n')
    if (e.tag === 'chart') {
      const v = e.chart_spec.data?.values ?? e.chart_spec.data?.[0]?.values ?? []
      return v.slice(0, 10).map(x => Object.values(x).map(cellText).join(' | ')).join('\n')
    }
    return ''
  }).filter(Boolean).join('\n\n')
  return { config: { wide_screen_mode: true }, header: card.header, elements: [{ tag: 'markdown', content: md.slice(0, 20000) }] }
}

// ------------------------------------------------------------------ send

/**
 * Send a message to a channel.
 * @param channel - channel record ({ type, domain, appId, receiveIdType, receiveId }).
 * @param secrets - { webhookUrl, signSecret, appSecret }.
 * @param message - { title, text, results, footer, includeSql, template }.
 * @returns { messageId?, images }
 */
export async function sendMessage(channel, secrets, message) {
  let images = 0
  const results = []
  // Native card charts are the default. Images are only uploaded when the
  // caller asks for them (app bots; e.g. clients that cannot render charts).
  for (const r of message.results ?? []) {
    if (channel.type === 'lark_app' && message.chartMode === 'image' && chartable(r)) {
      try {
        const png = renderChartPng(r)
        results.push({ ...r, imageKey: await uploadImage(channel, secrets, png), chart: { ...r.chart, nativeDisabled: true } })
        images++
        continue
      } catch (error) {
        if (error instanceof ImError && /99991672|234007/.test(error.code)) throw error
      }
    }
    results.push(r)
  }
  const card = buildCard({ ...message, results }, { charts: message.chartMode !== 'image' && message.chartMode !== 'table' })
  if (channel.type === 'lark_webhook') {
    if (!secrets.webhookUrl) throw new ImError('im/config', '缺少 Webhook 地址')
    const url = secrets.webhookUrl
    if (!/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(url)) throw new ImError('im/config', 'Webhook 地址格式不正确，应为 https://open.feishu.cn/open-apis/bot/v2/hook/… 或 open.larksuite.com')
    const send = async (c) => {
      const timestamp = String(Math.floor(Date.now() / 1000))
      const body = { msg_type: 'interactive', card: c, ...(secrets.signSecret ? { timestamp, sign: larkSign(secrets.signSecret, timestamp) } : {}) }
      return postJson(url, body)
    }
    let { status, json } = await send(card)
    const code = json?.code ?? json?.StatusCode
    if (code !== 0 && ![19021, 19022, 19024, 11232].includes(code) && card.body.elements.some(e => e.tag === 'chart')) ({ status, json } = await send(buildCard({ ...message, results }, { charts: false })))
    if ((json?.code ?? json?.StatusCode) !== 0 && ![19021, 19022, 19024, 11232].includes(json?.code ?? json?.StatusCode)) ({ status, json } = await send(legacyCard(card)))
    if ((json?.code ?? json?.StatusCode) !== 0) throw larkError(json, status)
    return { images }
  }
  if (channel.type === 'lark_app') {
    if (!channel.receiveId) throw new ImError('im/config', '缺少接收者 ID')
    const token = await tenantToken(channel, secrets)
    const type = RECEIVE_ID_TYPES.includes(channel.receiveIdType) ? channel.receiveIdType : 'chat_id'
    const url = `${hostFor(channel)}/open-apis/im/v1/messages?receive_id_type=${type}`
    const send = (c) => postJson(url, { receive_id: channel.receiveId, msg_type: 'interactive', content: JSON.stringify(c) }, { authorization: `Bearer ${token}` })
    const fatal = [230002, 230001, 230013, 99991672, 99991663]
    let { status, json } = await send(card)
    if (json.code !== 0 && !fatal.includes(json.code) && card.body.elements.some(e => e.tag === 'chart')) ({ status, json } = await send(buildCard({ ...message, results }, { charts: false })))
    if (json.code !== 0 && !fatal.includes(json.code)) ({ status, json } = await send(legacyCard(card)))
    if (json.code !== 0) throw larkError(json, status)
    return { messageId: json.data?.message_id, images }
  }
  throw new ImError('im/config', `不支持的渠道类型：${channel.type}`)
}

/** List chats the app bot belongs to (helps pick a chat_id). */
export async function listBotChats(channel, secrets) {
  const token = await tenantToken(channel, secrets)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`${hostFor(channel)}/open-apis/im/v1/chats?page_size=100`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal })
    const json = await res.json().catch(() => ({}))
    if (json.code !== 0) throw larkError(json, res.status)
    return (json.data?.items ?? []).map(c => ({ chatId: c.chat_id, name: c.name, description: c.description ?? '' }))
  } finally {
    clearTimeout(timer)
  }
}
