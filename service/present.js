/**
 * Feature "present": analysis & presentation.
 *  - PowerPoint export of a dashboard or of results (service/pptx.js)
 *  - Long image of a dashboard (one tall SVG → PNG with resvg) and sending it to
 *    image-capable channels (Lark app bot, Telegram bot)
 *  - Lark Bitable (多维表格) sync of a widget / SQL result, on demand or daily
 *
 * state.bitableSyncs = [{ id, name, channelId, appToken, tableId, source: { widgetId } | { datasourceId, sql },
 *                         mode: 'replace'|'append', schedule: { time: 'HH:MM', enabled }, lastRunAt?, lastStatus?, lastError?, createdAt, updatedAt }]
 * Runs are logged as records of kind 'bitableRun' (ref: syncId).
 */
import * as echarts from 'echarts'
import { Resvg } from '@resvg/resvg-js'
import { chartOption, chartable, fmtNum, renderChartPng } from '../channels/message.js'
import { larkApi, resolveBaseUrl, getTenantToken } from '../channels/lark.js'
import { request } from '../channels/http.js'
import { admitSql } from '../sql-guard.js'
import { buildPptx, PPTX_MEDIA_TYPE } from './pptx.js'
import { UserError, lastDailySlot, newId, requireText } from './shared.js'

const MAX_WIDGETS = 30
const FONT_STACK = 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, Noto Sans SC, sans-serif'
const stamp = (t = Date.now()) => new Date(t).toLocaleString('zh-CN', { hour12: false })
const safeFile = (s) => String(s || '数据问答').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)

/** A KPI-shaped result: chart kpi, or one row with only a few numeric columns. */
function kpiOf(r) {
  if (!r?.rows?.length) return null
  const kpi = r.chart?.type === 'kpi' || (r.rows.length === 1 && r.columns.length <= 4 && r.columns.some(c => c.kind === 'number') && !chartable(r))
  if (!kpi) return null
  const names = r.chart?.y?.length ? r.chart.y : r.columns.filter(c => c.kind === 'number').map(c => c.name)
  return names.slice(0, 6).map(name => {
    const i = r.columns.findIndex(c => c.name === name)
    const v = r.rows[0][i]
    return { label: name, value: v === null || v === undefined || v === '' ? '—' : fmtNum(v) || String(v) }
  })
}

// ------------------------------------------------------------- PPTX

function slideFor(r) {
  const notes = [r.title, r.datasourceName ? `数据源：${r.datasourceName}` : '', r.rowCount !== undefined ? `${r.rowCount} 行${r.truncated ? '（已截断）' : ''}` : '', r.filters?.length ? `筛选：${r.filters.map(f => f.description).join('；')}` : '', r.sql ? `SQL:\n${r.sql}` : ''].filter(Boolean).join('\n')
  const footer = [r.datasourceName, r.rowCount !== undefined ? `${r.rowCount} 行${r.truncated ? '（已截断）' : ''}` : '', (r.rowCount ?? r.rows?.length ?? 0) > 15 && !chartable(r) && !kpiOf(r) ? '幻灯片显示前 15 行' : ''].filter(Boolean).join(' · ')
  const base = { title: r.title || '查询结果', notes, footer }
  if (r.error) return { ...base, text: `查询失败：${r.error}`, error: true }
  if (!r.rows?.length) return { ...base, text: '（无数据）' }
  if (chartable(r)) {
    try { return { ...base, image: renderChartPng(r, { width: 1200, height: 600 }), imageAspect: 2 } } catch (error) { /* fall back to a table */ base.footer = `${footer} · 图表渲染失败：${error.message}` }
  }
  const kpis = kpiOf(r)
  if (kpis) return { ...base, kpis }
  return { ...base, table: { columns: r.columns, rows: r.rows } }
}

// ------------------------------------------------------------- long image (SVG)

const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const charW = (ch, size) => (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? size : size * 0.58)
/** Truncate to fit `maxW` px at `size` px (approximate widths). */
export function fitText(s, maxW, size) {
  const str = String(s ?? '').replace(/\r\n?|\n/g, ' ')
  let w = 0
  let out = ''
  for (const ch of str) {
    w += charW(ch, size)
    if (w > maxW) return `${out.replace(/.$/u, '')}…`
    out += ch
  }
  return out
}

function chartSvg(r, w, h) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: w, height: h })
  try {
    chart.setOption(chartOption(r))
    return chart.renderToSVGString()
  } finally {
    chart.dispose()
  }
}

/** Cell body: { h, draw(x, y, w) → svg } */
function cellBody(r, w) {
  const pad = 16
  if (r.error) return { h: 60, draw: (x, y) => `<text x="${x + pad}" y="${y + 34}" font-size="14" fill="#f54a45">${esc(fitText(`查询失败：${r.error}`, w - 2 * pad, 14))}</text>` }
  if (!r.rows?.length) return { h: 60, draw: (x, y) => `<text x="${x + pad}" y="${y + 34}" font-size="14" fill="#8f959e">（无数据）</text>` }
  if (chartable(r)) {
    const ch = 320
    let inner
    try { inner = chartSvg(r, w - 2 * pad, ch) } catch { inner = null }
    if (inner) return { h: ch + 8, draw: (x, y) => inner.replace(/^<svg\b/, `<svg x="${x + pad}" y="${y}"`) }
  }
  const kpis = kpiOf(r)
  if (kpis) {
    const per = (w - 2 * pad) / kpis.length
    const size = kpis.length > 3 ? 30 : 40
    return { h: 110, draw: (x, y) => kpis.map((k, i) => {
      const cx = x + pad + per * i + per / 2
      return `<text x="${cx}" y="${y + 52}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#3370ff">${esc(fitText(k.value, per - 8, size))}</text><text x="${cx}" y="${y + 84}" text-anchor="middle" font-size="14" fill="#646a73">${esc(fitText(k.label, per - 8, 14))}</text>`
    }).join('') }
  }
  const cols = r.columns.slice(0, 6)
  const rows = r.rows.slice(0, 12)
  const rowH = 28
  const colW = (w - 2 * pad) / Math.max(1, cols.length)
  const more = (r.rowCount ?? r.rows.length) > rows.length || r.columns.length > cols.length
  return { h: rowH * (rows.length + 1) + (more ? 30 : 10), draw: (x, y) => {
    const x0 = x + pad
    let out = `<rect x="${x0}" y="${y}" width="${w - 2 * pad}" height="${rowH}" rx="4" fill="#f2f3f5"/>`
    cols.forEach((c, ci) => {
      const num = c.kind === 'number'
      const tx = num ? x0 + colW * (ci + 1) - 8 : x0 + colW * ci + 8
      out += `<text x="${tx}" y="${y + 19}" font-size="13" font-weight="600" fill="#1f2329"${num ? ' text-anchor="end"' : ''}>${esc(fitText(c.name, colW - 16, 13))}</text>`
    })
    rows.forEach((row, ri) => {
      const ry = y + rowH * (ri + 1)
      out += `<line x1="${x0}" y1="${ry + rowH}" x2="${x0 + w - 2 * pad}" y2="${ry + rowH}" stroke="#eff0f1"/>`
      cols.forEach((c, ci) => {
        const num = c.kind === 'number'
        const v = row[ci]
        const text = v === null || v === undefined ? 'NULL' : num ? fmtNum(v) : String(v)
        const tx = num ? x0 + colW * (ci + 1) - 8 : x0 + colW * ci + 8
        out += `<text x="${tx}" y="${ry + 19}" font-size="13" fill="${v === null ? '#8f959e' : '#1f2329'}"${num ? ' text-anchor="end"' : ''}>${esc(fitText(text, colW - 16, 13))}</text>`
      })
    })
    if (more) out += `<text x="${x0}" y="${y + rowH * (rows.length + 1) + 20}" font-size="12" fill="#8f959e">${esc(`共 ${r.rowCount ?? r.rows.length} 行 × ${r.columns.length} 列，图中显示前 ${rows.length} 行 × ${cols.length} 列`)}</text>`
    return out
  } }
}

/**
 * One tall SVG of a dashboard: header, then the widgets in a 2-column grid
 * (full-width widgets span both columns). items: [{ result, width }].
 */
export function dashboardSvg({ title, subtitle, items, width = 1200 }) {
  const W = Math.max(600, Math.min(2400, Math.round(Number(width) || 1200)))
  const M = 32
  const GAP = 20
  const colW = (W - 2 * M - GAP) / 2
  let y = 0
  let body = ''
  // header
  body += `<rect x="0" y="0" width="${W}" height="8" fill="#3370ff"/>`
  body += `<text x="${M}" y="${y + 64}" font-size="30" font-weight="700" fill="#1f2329">${esc(fitText(title, W - 2 * M, 30))}</text>`
  const sub = String(subtitle ?? '').split('\n').filter(Boolean)
  sub.forEach((line, i) => { body += `<text x="${M}" y="${y + 96 + i * 22}" font-size="14" fill="#646a73">${esc(fitText(line, W - 2 * M, 14))}</text>` })
  y += 96 + sub.length * 22 + 8
  // grid rows
  let row = []
  const flush = () => {
    if (!row.length) return
    const cells = row.map(c => ({ ...c, body: cellBody(c.result, c.w) }))
    const hgt = Math.max(...cells.map(c => c.body.h)) + 52
    for (const c of cells) {
      body += `<rect x="${c.x}" y="${y}" width="${c.w}" height="${hgt}" rx="10" fill="#ffffff" stroke="#dee0e3"/>`
      body += `<text x="${c.x + 16}" y="${y + 30}" font-size="16" font-weight="600" fill="#1f2329">${esc(fitText(c.result.title || '', c.w - 32, 16))}</text>`
      body += c.body.draw(c.x, y + 44, c.w)
    }
    y += hgt + GAP
    row = []
  }
  for (const it of items) {
    const full = it.width === 'full' || items.length === 1
    if (full) { flush(); row = [{ result: it.result, x: M, w: W - 2 * M }]; flush(); continue }
    row.push({ result: it.result, x: row.length ? M + colW + GAP : M, w: colW })
    if (row.length === 2) flush()
  }
  flush()
  y += M - GAP + 20
  body += `<text x="${W - M}" y="${y - 14}" text-anchor="end" font-size="12" fill="#8f959e">DeepSeek Harness · 数据问答</text>`
  const H = Math.ceil(y)
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT_STACK)}"><rect width="${W}" height="${H}" fill="#f5f6f7"/>${body}</svg>`, width: W, height: H }
}

export function rasterize(svg, width, scale = 1) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(width * scale) }, font: { loadSystemFonts: true, defaultFontFamily: 'PingFang SC' } }).render().asPng()
}

// ------------------------------------------------------------- Bitable helpers

/** Lark field types: 1 text, 2 number, 5 date. */
export const FIELD_TYPE = { text: 1, number: 2, datetime: 5 }
export function fieldTypeFor(kind) {
  return kind === 'number' ? FIELD_TYPE.number : kind === 'time' ? FIELD_TYPE.datetime : FIELD_TYPE.text
}

/** A cell as a Bitable value for a field type; undefined = leave empty. */
export function bitableValue(v, type) {
  if (v === null || v === undefined || v === '') return undefined
  if (type === FIELD_TYPE.number) { const n = Number(v); return Number.isFinite(n) ? n : undefined }
  if (type === FIELD_TYPE.datetime) {
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : undefined
    if (typeof v === 'number') return v > 1e11 ? v : v * 1000
    const s = String(v).trim()
    // Bare dates and "YYYY-MM-DD HH:MM[:SS]" are local times; ISO strings with a zone keep it.
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
    const t = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime() : Date.parse(s)
    return Number.isFinite(t) ? t : undefined
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const BITABLE_HINTS = {
  91402: '多维表格不存在或 app_token 错误',
  1254003: 'app_token 错误：请从多维表格链接（…/base/<app_token>）中复制',
  1254004: 'table_id 错误：请从链接中的 table= 参数复制',
  1254040: 'app_token 不存在',
  1254041: 'table_id 不存在',
  1254302: '应用没有该多维表格的权限：请在多维表格「… → 更多 → 添加文档应用」中添加该应用并给予可编辑权限',
  1254304: '应用没有该多维表格的权限',
  91403: '应用没有该多维表格的权限：请在多维表格中添加该文档应用',
  99991672: '应用缺少权限：请在开发者后台开通 bitable:app（查看、评论、编辑和管理多维表格）',
  1254103: '数据表记录数已达上限（20,000 条）',
  1254014: '字段名重复',
}
function bitableError(error, step) {
  if (error instanceof UserError) return error
  const code = typeof error.code === 'number' ? error.code : undefined
  const hint = code !== undefined ? BITABLE_HINTS[code] : undefined
  return new UserError('nl2sql/bitable', `${step}失败：${hint ? `${hint}（${error.larkMsg ?? error.message}）` : error.message}`)
}

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
const encP = encodeURIComponent

// ------------------------------------------------------------- service methods

export const methods = {
  /** Run every widget of a dashboard → { d, results:[{ ...result, title, width }] }. */
  async presentDashboardResults(dashboardId, filters) {
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    const results = []
    for (const w of d.widgets.slice(0, MAX_WIDGETS)) {
      try { results.push({ ...(await this.runWidget(w.id, filters ?? d.filters)), title: w.title, width: w.width }) } catch (error) { results.push({ title: w.title, width: w.width, error: error.message, columns: [], rows: [], sql: w.sql, datasourceName: this.findDatasource(w.datasourceId)?.name }) }
    }
    if (!results.length) throw new UserError('nl2sql/invalid', '看板为空，没有可导出的组件')
    return { d, results }
  },

  presentSourceNames(results) {
    return [...new Set(results.map(r => r.datasourceName).filter(Boolean))]
  },

  presentPptx(title, results, extraLines = []) {
    const sources = this.presentSourceNames(results)
    const buf = buildPptx({
      title,
      subtitle: stamp(),
      lines: [sources.length ? `数据源：${sources.join('、')}` : '', ...extraLines].filter(Boolean),
      slides: results.map(slideFor),
    })
    return { fileName: `${safeFile(title)}-${new Date().toISOString().slice(0, 10)}.pptx`, mediaType: PPTX_MEDIA_TYPE, base64: buf.toString('base64'), bytes: buf.length, slides: results.length + 1 }
  },

  async exportDashboardPptx({ dashboardId, filters } = {}) {
    const { d, results } = await this.presentDashboardResults(dashboardId, filters)
    const f = results.flatMap(r => r.filters ?? []).map(x => x.description)
    return this.presentPptx(d.name || '数据看板', results, f.length ? [`筛选：${[...new Set(f)].join('；')}`] : [])
  },

  async exportResultsPptx({ resultIds = [], title } = {}) {
    const results = (Array.isArray(resultIds) ? resultIds : [resultIds]).slice(0, 50).map(id => this.lookupResult(id)).filter(Boolean)
    if (!results.length) throw new UserError('nl2sql/result-expired', '没有可导出的结果（可能已过期），请重新查询')
    return this.presentPptx(String(title || results[0].title || '数据问答').slice(0, 120), results)
  },

  async dashboardImagePng({ dashboardId, filters, width = 1200 } = {}) {
    const { d, results } = await this.presentDashboardResults(dashboardId, filters)
    const sources = this.presentSourceNames(results)
    const f = [...new Set(results.flatMap(r => r.filters ?? []).map(x => x.description))]
    const { svg, width: W, height: H } = dashboardSvg({
      title: d.name || '数据看板',
      subtitle: [`生成时间：${stamp()}`, sources.length ? `数据源：${sources.join('、')}` : '', f.length ? `筛选：${f.join('；')}` : ''].filter(Boolean).join('\n'),
      items: results.map(r => ({ result: r, width: r.width })),
      width,
    })
    // 2x for sharpness, capped so very tall boards stay a reasonable size.
    const scale = H * 2 > 16000 ? Math.max(1, 16000 / H) : 2
    const png = rasterize(svg, W, scale)
    return { d, png, width: Math.round(W * scale), height: Math.round(H * scale), widgets: results.length }
  },

  async exportDashboardImage(input = {}) {
    const { d, png, width, height, widgets } = await this.dashboardImagePng(input)
    return { fileName: `${safeFile(d.name || '数据看板')}-${new Date().toISOString().slice(0, 10)}.png`, mediaType: 'image/png', base64: png.toString('base64'), bytes: png.length, width, height, widgets }
  },

  /** Send the dashboard long image to a channel that can carry images (Lark app bot, Telegram bot). */
  async sendDashboardImage({ dashboardId, channelId, filters, width } = {}) {
    const c = this.requireChannel(channelId)
    if (c.needsSecret) throw new UserError('nl2sql/invalid', `渠道「${c.name}」需要重新填写密钥后才能使用`)
    if (!['lark_app', 'telegram_bot'].includes(c.type)) throw new UserError('nl2sql/unsupported', `渠道「${c.name}」不支持发送图片：长图只能发送到飞书应用机器人或 Telegram 机器人渠道（群机器人 Webhook、企业微信、钉钉暂不支持图片上传）。可改用「推送看板」发送卡片。`)
    const ch = this.adapterChannel(c)
    const secrets = await this.channelSecrets(c)
    const { d, png, width: W, height: H } = await this.dashboardImagePng({ dashboardId, filters, width })
    const started = Date.now()
    const title = d.name || '数据看板'
    try {
      let messageId = null
      if (c.type === 'lark_app') messageId = await this.presentLarkImage(ch, secrets, png)
      else messageId = await this.presentTelegramImage(ch, secrets, png, { title, width: W, height: H })
      c.lastSentAt = Date.now()
      delete c.lastError
      this.recordDelivery({ channel: c, title: `${title}（长图）`, status: 'ok', results: 0, images: 1, source: 'dashboard', elapsedMs: Date.now() - started })
      await this.save()
      return { ok: true, channel: c.name, platform: c.platform, messageId, images: 1, bytes: png.length }
    } catch (error) {
      c.lastError = error.message
      this.recordDelivery({ channel: c, title: `${title}（长图）`, status: 'error', error: error.message, results: 0, source: 'dashboard', elapsedMs: Date.now() - started })
      await this.save()
      throw error instanceof UserError ? error : new UserError(error.code && /^(im|channel)\//.test(error.code) ? error.code : 'nl2sql/send-failed', error.message)
    }
  },

  /** Upload a PNG with the app's tenant token and send it as an image message. */
  async presentLarkImage(ch, secrets, png) {
    if (!ch.appId || !secrets.appSecret) throw new UserError('nl2sql/invalid', '缺少 App ID 或 App Secret')
    if (!ch.receiveId) throw new UserError('nl2sql/invalid', '渠道缺少接收者 ID')
    const base = this.config?.larkBaseUrl ?? resolveBaseUrl({ domain: ch.domain, baseUrl: ch.baseUrl })
    const token = await getTenantToken({ appId: ch.appId, appSecret: secrets.appSecret, domain: ch.domain, baseUrl: base })
    if (png.length > 10 * 1024 * 1024) throw new UserError('nl2sql/too-large', '长图超过飞书图片上限 10 MB，请减少看板组件或调小宽度')
    const form = new FormData()
    form.set('image_type', 'message')
    form.set('image', new Blob([png], { type: 'image/png' }), 'dashboard.png')
    const up = await request(`${base}/open-apis/im/v1/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, timeoutMs: 60000, label: '飞书' })
    if (up.json?.code !== 0) throw new UserError('nl2sql/send-failed', `飞书图片上传失败：${up.json?.msg ?? `HTTP ${up.status}`}${up.json?.code === 99991672 ? '（请为应用开通 im:resource 权限）' : ''}`)
    const type = ['chat_id', 'open_id', 'user_id', 'union_id', 'email'].includes(ch.receiveIdType) ? ch.receiveIdType : 'chat_id'
    const sent = await request(`${base}/open-apis/im/v1/messages?receive_id_type=${type}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, json: { receive_id: ch.receiveId, msg_type: 'image', content: JSON.stringify({ image_key: up.json.data.image_key }) }, label: '飞书' })
    if (sent.json?.code !== 0) throw new UserError('nl2sql/send-failed', `飞书发送图片失败：${sent.json?.msg ?? `HTTP ${sent.status}`}`)
    return sent.json.data?.message_id ?? null
  },

  /** sendPhoto, or sendDocument when the image exceeds Telegram's photo limits (w+h ≤ 10000, ratio ≤ 20, ≤ 10 MB). */
  async presentTelegramImage(ch, secrets, png, { title, width, height }) {
    const { callApi, apiBaseOf } = await import('../channels/telegram.js')
    const chatId = ch.chatId ?? ch.config?.chatId
    if (!chatId) throw new UserError('nl2sql/invalid', '渠道缺少 Chat ID（推送目标）')
    const asPhoto = width + height <= 10000 && Math.max(width / height, height / width) <= 20 && png.length <= 10 * 1024 * 1024
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('caption', String(title).slice(0, 1000))
    form.append(asPhoto ? 'photo' : 'document', new Blob([png], { type: 'image/png' }), `${safeFile(title)}.png`)
    const msg = await callApi({ base: apiBaseOf(ch), token: secrets.botToken }, asPhoto ? 'sendPhoto' : 'sendDocument', undefined, { form, timeoutMs: 60000 })
    return msg?.message_id !== undefined ? String(msg.message_id) : null
  },

  // ----------------------------------------------------------- Bitable sync

  listBitableSyncs() {
    const syncs = this.state.bitableSyncs ?? []
    return syncs.map(s => ({
      ...s,
      channelName: this.state.channels.find(c => c.id === s.channelId)?.name ?? null,
      sourceLabel: s.source?.widgetId ? (this.findWidget(s.source.widgetId).w?.title ?? null) : (this.findDatasource(s.source?.datasourceId)?.name ?? null),
      runs: this.records.list('bitableRun', { ref: s.id, limit: 5 }),
    }))
  },

  async saveBitableSync(input = {}) {
    this.state.bitableSyncs ??= []
    const existing = input.id ? this.state.bitableSyncs.find(s => s.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/not-found', '同步任务不存在')
    const merged = { ...(existing ?? {}), ...input }
    const name = requireText(merged.name, 'name', 80)
    const c = this.state.channels.find(x => x.id === merged.channelId)
    if (!c) throw Object.assign(new UserError('nl2sql/invalid', '请选择一个飞书应用机器人渠道（提供 App ID / Secret）'), { field: 'channelId' })
    if (c.type !== 'lark_app') throw Object.assign(new UserError('nl2sql/invalid', `渠道「${c.name}」不是飞书应用机器人：多维表格同步需要应用凭据（App ID / Secret）`), { field: 'channelId' })
    const appToken = String(merged.appToken ?? '').trim()
    const tableId = String(merged.tableId ?? '').trim()
    if (!/^[A-Za-z0-9]{8,64}$/.test(appToken)) throw Object.assign(new UserError('nl2sql/invalid', 'app_token 格式不正确：请从多维表格链接 …/base/<app_token>?table=… 中复制'), { field: 'appToken' })
    if (!/^tbl[A-Za-z0-9]{4,40}$/.test(tableId)) throw Object.assign(new UserError('nl2sql/invalid', 'table_id 格式不正确：应以 tbl 开头（链接中的 table= 参数）'), { field: 'tableId' })
    const src = merged.source ?? {}
    let source
    if (src.widgetId) {
      if (!this.findWidget(src.widgetId).w) throw Object.assign(new UserError('nl2sql/invalid', '看板组件不存在'), { field: 'source' })
      source = { widgetId: src.widgetId }
    } else {
      const ds = this.requireDatasource(src.datasourceId)
      const sql = requireText(src.sql, 'sql', 20000)
      try { admitSql(sql, { dialect: ds.type ?? 'mysql' }) } catch (error) { throw Object.assign(new UserError('nl2sql/invalid', error.message), { field: 'sql' }) }
      source = { datasourceId: ds.id, sql }
    }
    const time = /^\d{1,2}:\d{2}$/.test(String(merged.schedule?.time ?? '')) ? String(merged.schedule.time).padStart(5, '0') : '08:00'
    const sync = {
      id: existing?.id ?? newId('bt'),
      name, channelId: c.id, appToken, tableId, source,
      mode: merged.mode === 'append' ? 'append' : 'replace',
      schedule: { time, enabled: Boolean(merged.schedule?.enabled) },
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      ...(existing ? { lastRunAt: existing.lastRunAt, lastStatus: existing.lastStatus, lastError: existing.lastError, lastRows: existing.lastRows } : {}),
    }
    const i = this.state.bitableSyncs.findIndex(s => s.id === sync.id)
    if (i >= 0) this.state.bitableSyncs[i] = sync; else this.state.bitableSyncs.push(sync)
    await this.save()
    return sync
  },

  async deleteBitableSync(id) {
    const before = (this.state.bitableSyncs ?? []).length
    this.state.bitableSyncs = (this.state.bitableSyncs ?? []).filter(s => s.id !== id)
    if (this.state.bitableSyncs.length !== before) await this.save()
    return { deleted: id }
  },

  async runBitableSync(id, { trigger = 'manual' } = {}) {
    const sync = (this.state.bitableSyncs ?? []).find(s => s.id === id)
    if (!sync) throw new UserError('nl2sql/not-found', '同步任务不存在')
    return this.withJobLock(`bitable:${id}`, () => this.runBitableSyncInner(sync, trigger))
  },

  async runBitableSyncInner(sync, trigger) {
    const started = Date.now()
    const run = { id: newId('br'), at: started, syncId: sync.id, name: sync.name, trigger, mode: sync.mode, status: 'ok', rows: 0, created: 0, deleted: 0, fieldsCreated: [] }
    try {
      const c = this.state.channels.find(x => x.id === sync.channelId)
      if (!c || c.type !== 'lark_app') throw new UserError('nl2sql/invalid', '同步任务关联的飞书应用机器人渠道不存在')
      const ch = this.adapterChannel(c)
      const secrets = await this.channelSecrets(c)
      if (!ch.appId || !secrets.appSecret) throw new UserError('nl2sql/invalid', `渠道「${c.name}」缺少 App ID 或 App Secret`)
      const opts = { appId: ch.appId, appSecret: secrets.appSecret, domain: ch.domain, baseUrl: this.config?.larkBaseUrl ?? ch.baseUrl }
      // 1. data (always through runQuery: admission, policy, row rules, masking, audit)
      const r = sync.source?.widgetId
        ? await this.runWidget(sync.source.widgetId, undefined, { useCache: false })
        : await this.runQuery({ sql: sync.source.sql, datasourceId: sync.source.datasourceId, title: `多维表格同步：${sync.name}`, source: 'bitable', confirmScan: true, useCache: false })
      run.rows = r.rows.length
      run.truncated = Boolean(r.truncated)
      const base = `/open-apis/bitable/v1/apps/${encP(sync.appToken)}/tables/${encP(sync.tableId)}`
      const api = (path, init, step) => larkApi(opts, base + path, init).catch(error => { throw bitableError(error, step) })
      // 2. fields: create missing ones by column kind
      const fields = new Map()
      let pageToken = ''
      for (let page = 0; page < 20; page++) {
        const json = await api(`/fields?page_size=100${pageToken ? `&page_token=${encP(pageToken)}` : ''}`, {}, '读取字段')
        for (const f of json.data?.items ?? []) fields.set(f.field_name, f.type)
        if (!json.data?.has_more || !json.data?.page_token) break
        pageToken = json.data.page_token
      }
      const cols = r.columns.map(col => ({ name: String(col.name).trim().slice(0, 100) || 'column', kind: col.kind }))
      for (const col of cols) {
        if (fields.has(col.name)) continue
        const type = fieldTypeFor(col.kind)
        const body = { field_name: col.name, type, ...(type === FIELD_TYPE.datetime ? { property: { date_formatter: 'yyyy-MM-dd HH:mm' } } : type === FIELD_TYPE.number ? { property: { formatter: '0.00' } } : {}) }
        await api('/fields', { method: 'POST', body }, `创建字段「${col.name}」`)
        fields.set(col.name, type)
        run.fieldsCreated.push(col.name)
      }
      // 3. replace mode: delete existing records (≤ 500 per call)
      if (sync.mode === 'replace') {
        const ids = []
        let token = ''
        for (let page = 0; page < 100; page++) {
          const json = await api(`/records?page_size=500${token ? `&page_token=${encP(token)}` : ''}`, {}, '读取记录')
          for (const rec of json.data?.items ?? []) ids.push(rec.record_id ?? rec.id)
          if (!json.data?.has_more || !json.data?.page_token) break
          token = json.data.page_token
        }
        for (const part of chunk(ids.filter(Boolean), 500)) {
          await api('/records/batch_delete', { method: 'POST', body: { records: part } }, '删除旧记录')
          run.deleted += part.length
        }
      }
      // 4. insert (≤ 500 per call; values converted to each field's actual type)
      const typeOf = cols.map(col => { const t = fields.get(col.name); return t === FIELD_TYPE.number || t === FIELD_TYPE.datetime ? t : FIELD_TYPE.text })
      const records = r.rows.map(row => {
        const f = {}
        cols.forEach((col, i) => { const v = bitableValue(row[i], typeOf[i]); if (v !== undefined) f[col.name] = v })
        return { fields: f }
      })
      for (const part of chunk(records, 500)) {
        await api('/records/batch_create', { method: 'POST', body: { records: part } }, '写入记录')
        run.created += part.length
      }
    } catch (error) {
      run.status = 'error'
      run.error = String(error.message).slice(0, 500)
    }
    run.elapsedMs = Date.now() - started
    const cur = (this.state.bitableSyncs ?? []).find(s => s.id === sync.id)
    if (cur) Object.assign(cur, { lastRunAt: started, lastStatus: run.status, lastError: run.error ?? undefined, lastRows: run.created })
    this.records.put('bitableRun', run)
    await this.save()
    if (run.status === 'error' && trigger === 'manual') throw new UserError('nl2sql/bitable', run.error)
    return run
  },

  listBitableRuns({ syncId, limit = 50 } = {}) {
    return this.records.list('bitableRun', { ref: syncId, limit: Math.min(500, Number(limit) || 50) })
  },

  /** Scheduler: each enabled sync once per day at its time (catches up once after downtime). */
  jobs_present(now) {
    return (this.state.bitableSyncs ?? []).filter(s => s.schedule?.enabled).map(s => ({
      id: `bitable:${s.id}`,
      due: (n) => Math.max(s.lastRunAt ?? 0, s.createdAt ?? 0) < lastDailySlot(s.schedule.time, n),
      run: () => this.runBitableSyncInner((this.state.bitableSyncs ?? []).find(x => x.id === s.id) ?? s, 'schedule'),
    }))
  },
}

export const FEATURE = {
  name: 'present',
  methods,
  rpc: (service) => ({
    exportDashboardPptx: (p) => service.exportDashboardPptx(p ?? {}),
    exportResultsPptx: (p) => service.exportResultsPptx(p ?? {}),
    exportDashboardImage: (p) => service.exportDashboardImage(p ?? {}),
    sendDashboardImage: (p) => service.sendDashboardImage(p ?? {}),
    listBitableSyncs: () => service.listBitableSyncs(),
    saveBitableSync: (p) => service.saveBitableSync(p ?? {}),
    deleteBitableSync: (p) => service.deleteBitableSync(p?.id),
    runBitableSync: (p) => service.runBitableSync(p?.id),
    listBitableRuns: (p) => service.listBitableRuns(p ?? {}),
  }),
}
