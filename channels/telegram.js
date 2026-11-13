/**
 * Telegram channel adapter (platform 'telegram', kind 'telegram_bot').
 *
 * Official documentation followed (read 2026-11):
 *   - Bot API reference ............ https://core.telegram.org/bots/api
 *     · Making requests / ResponseParameters (ok, description, error_code, parameters.retry_after)
 *     · getUpdates (offset, limit, timeout, allowed_updates; "will not work if an outgoing webhook is set up")
 *     · getWebhookInfo / deleteWebhook (drop_pending_updates)
 *     · sendMessage (text 1-4096 characters, parse_mode, link_preview_options, reply_parameters, reply_markup)
 *     · sendPhoto (multipart/form-data upload, caption 0-1024 characters)
 *     · HTML style formatting (only b/i/u/s/code/pre/a/blockquote...; escape & < >)
 *     · InlineKeyboardButton.callback_data (1-64 bytes), CallbackQuery, answerCallbackQuery (text 0-200)
 *     · MessageEntity (mention / text_mention / bot_command, offsets in UTF-16 code units)
 *     · setMessageReaction + ReactionTypeEmoji (👀 👍 👎 are in the allowed emoji list)
 *   - Privacy mode (groups: bots receive commands, replies and mentions) — https://core.telegram.org/bots/features#privacy-mode
 *
 * No SDK: plain fetch (via ./http.js request, every call has a timeout).
 */
import { randomBytes } from 'node:crypto'
import { ChannelError, request } from './http.js'
import { renderChartPng as defaultRenderChartPng, chartable, oneLine, resultMeta, isKpi, kpiText, resultAsMarkdownTable, toPlainMarkdown } from './message.js'

export const DEFAULT_API_BASE = 'https://api.telegram.org'
export const TEXT_LIMIT = 4096
const CHUNK = 4000
const CAPTION_LIMIT = 1024
const REACTIONS = { working: '👀', done: '👍', failed: '👎' }

const cfg = (channel, key) => channel?.[key] ?? channel?.config?.[key]
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve()
  const timer = setTimeout(done, ms)
  function done() { clearTimeout(timer); signal?.removeEventListener?.('abort', done); resolve() }
  signal?.addEventListener?.('abort', done, { once: true })
})

// ------------------------------------------------------------------ API

export function apiBaseOf(channel) {
  return String(cfg(channel, 'apiBase') || DEFAULT_API_BASE).replace(/\/+$/, '')
}

/** Map a Bot API error to a ChannelError with a Chinese message. */
export function telegramError(json, status) {
  const code = json?.error_code ?? status
  const desc = String(json?.description ?? json?.raw ?? '').slice(0, 300)
  const retryAfter = json?.parameters?.retry_after
  let err
  if (code === 401 || code === 404 && /not found/i.test(desc) && !/chat/i.test(desc)) err = new ChannelError('channel/auth', 'Telegram Bot Token 无效或已被撤销，请在 @BotFather 重新获取')
  else if (code === 429) err = new ChannelError('channel/rate-limit', `Telegram 限流，请在 ${retryAfter ?? '几'} 秒后重试`)
  else if (code === 409) err = new ChannelError('channel/rejected', /webhook/i.test(desc) ? 'Telegram 已设置 Webhook，无法使用长轮询（将自动删除 Webhook 后重试）' : '同一个 Bot Token 正在别处轮询消息（getUpdates 冲突），请停止其他实例')
  else if (json?.parameters?.migrate_to_chat_id) err = new ChannelError('channel/config', `该群已升级为超级群，请把 Chat ID 改为 ${json.parameters.migrate_to_chat_id}`)
  else if (code === 403) err = new ChannelError('channel/rejected', /blocked/i.test(desc) ? '用户已屏蔽机器人' : /kicked|not a member|no rights|not enough rights/i.test(desc) ? '机器人不在该聊天中或没有发言权限，请先把机器人加入群/频道（频道需设为管理员）' : `Telegram 拒绝了请求：${desc}`)
  else if (code === 400 && /chat not found/i.test(desc)) err = new ChannelError('channel/config', '找不到该聊天：请确认 Chat ID 正确，并已把机器人加入该群/频道（私聊需用户先给机器人发消息）')
  else if (code === 400 && /can't parse entities/i.test(desc)) err = new ChannelError('channel/telegram-parse', `消息格式解析失败：${desc}`)
  else err = new ChannelError('channel/rejected', `Telegram 返回错误（${code ?? '未知'}）：${desc || '未知错误'}`)
  err.status = status
  err.platformCode = code
  err.description = desc
  if (retryAfter) err.retryAfter = retryAfter
  return err
}

function withSignal(fetchImpl, signal) {
  if (!signal) return fetchImpl
  return (url, init = {}) => fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal })
}

/**
 * Call a Bot API method. `params` is sent as JSON, or pass `form` (FormData) for uploads.
 * Returns `result`; throws ChannelError on `ok: false`.
 */
export async function callApi({ base, token, fetch: fetchImpl = globalThis.fetch }, method, params, { form, timeoutMs = 15000, signal } = {}) {
  if (!token) throw new ChannelError('channel/config', '缺少 Telegram Bot Token')
  const url = `${base}/bot${token}/${method}`
  const res = await request(url, {
    method: 'POST',
    ...(form ? { body: form } : { json: params ?? {} }),
    timeoutMs,
    label: 'Telegram ',
    fetch: withSignal(fetchImpl, signal),
  })
  if (res.json?.ok === true) return res.json.result
  throw telegramError(res.json, res.status)
}

// ------------------------------------------------------- Markdown → HTML

export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;')

/** Telegram HTML back to plain text (fallback when the HTML is rejected). */
export function htmlToPlain(html) {
  return String(html ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function emphasis(escaped) {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
}

/** Inline Markdown (code, links, bold, italic, strike) → Telegram HTML. Everything else is escaped. */
export function inlineToHtml(raw) {
  const s = String(raw ?? '')
  let out = ''
  let last = 0
  for (const m of s.matchAll(/`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    out += emphasis(escapeHtml(s.slice(last, m.index)))
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`
    else if (/^(https?:\/\/|tg:\/\/|mailto:)/i.test(m[3])) out += `<a href="${escapeAttr(m[3])}">${emphasis(escapeHtml(m[2]))}</a>`
    else out += emphasis(escapeHtml(m[0]))
    last = m.index + m[0].length
  }
  return out + emphasis(escapeHtml(s.slice(last)))
}

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/
function displayWidth(s) {
  let w = 0
  for (const ch of String(s)) w += WIDE.test(ch) || ch.codePointAt(0) > 0x1F000 ? 2 : 1
  return w
}
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|').replace(/\*\*/g, ''))
}

/** A Markdown table (array of lines, 2nd is the separator) as aligned monospace text. */
export function tableToText(lines) {
  const sep = splitRow(lines[1] ?? '')
  const rows = [lines[0], ...lines.slice(2)].map(splitRow)
  const n = Math.max(...rows.map(r => r.length))
  const widths = Array.from({ length: n }, (_, i) => Math.max(...rows.map(r => displayWidth(r[i] ?? ''))))
  const right = Array.from({ length: n }, (_, i) => /-:$/.test(sep[i] ?? ''))
  const pad = (v, i) => {
    const gap = ' '.repeat(Math.max(0, widths[i] - displayWidth(v)))
    return right[i] ? gap + v : v + gap
  }
  const fmt = (r) => Array.from({ length: n }, (_, i) => pad(r[i] ?? '', i)).join('  ').replace(/\s+$/, '')
  return [fmt(rows[0]), widths.map(w => '─'.repeat(w)).join('  '), ...rows.slice(1).map(fmt)].join('\n')
}

/**
 * Markdown → list of self-contained Telegram HTML blocks ({ html, text, pre? }).
 * Headings become bold, lists text bullets, tables and code fences <pre>,
 * quotes <blockquote>. Joining blocks with '\n' gives the full message.
 */
export function markdownToBlocks(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const push = (html, text, pre) => blocks.push({ html, text, ...(pre ? { pre } : {}) })
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const body = []
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i])
      const text = body.join('\n')
      const lang = fence[1]
      push(lang ? `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(text)}</code></pre>` : `<pre>${escapeHtml(text)}</pre>`, text, { lang, text })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('|')) {
      const tbl = [line, lines[i + 1]]
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) tbl.push(lines[i])
      i--
      const text = tableToText(tbl)
      push(`<pre>${escapeHtml(text)}</pre>`, text, { lang: '', text })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>+\s?/, ''))
      i--
      push(`<blockquote>${body.map(inlineToHtml).join('\n')}</blockquote>`, body.join('\n'))
      continue
    }
    let m
    if ((m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line))) { push(`<b>${inlineToHtml(m[1])}</b>`, m[1]); continue }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { push('──────────', '──────────'); continue }
    if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(line))) { const ind = '  '.repeat(Math.floor(m[1].length / 2)); push(`${ind}• ${inlineToHtml(m[2])}`, `${ind}• ${m[2]}`); continue }
    if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) { const ind = '  '.repeat(Math.floor(m[1].length / 2)); push(`${ind}${m[2]}. ${inlineToHtml(m[3])}`, `${ind}${m[2]}. ${m[3]}`); continue }
    push(inlineToHtml(line), line)
  }
  // Collapse runs of blank lines.
  return blocks.filter((b, i) => b.html !== '' || (i > 0 && blocks[i - 1].html !== ''))
}

function cutText(text, max) {
  const out = []
  let piece = ''
  for (const ch of String(text)) {
    if ((piece + ch).length > max) { out.push(piece); piece = '' }
    piece += ch
  }
  if (piece) out.push(piece)
  return out
}

/** Pack blocks into HTML messages of at most `max` characters without breaking tags. */
export function packBlocks(blocks, max = CHUNK) {
  const parts = []
  for (const b of blocks) {
    if (b.html.length <= max) { parts.push(b.html); continue }
    if (b.pre) {
      // Split a long <pre> on line boundaries; each piece is its own <pre>.
      let cur = []
      const flush = () => { if (cur.length) parts.push(`<pre>${escapeHtml(cur.join('\n'))}</pre>`); cur = [] }
      for (const ln of b.pre.text.split('\n')) {
        for (const seg of cutText(ln, Math.floor((max - 20) / 5))) {
          if (escapeHtml([...cur, seg].join('\n')).length + 11 > max) flush()
          cur.push(seg)
        }
      }
      flush()
      continue
    }
    for (const seg of cutText(b.text, Math.floor(max / 5))) parts.push(escapeHtml(seg))
  }
  const chunks = []
  let cur = ''
  for (const p of parts) {
    const next = cur === '' ? p : `${cur}\n${p}`
    if (next.length <= max) { cur = next; continue }
    if (cur.trim()) chunks.push(cur)
    cur = p
  }
  if (cur.trim()) chunks.push(cur)
  return chunks.length ? chunks : ['']
}

/** Markdown (with Lark-flavoured extensions) → Telegram HTML chunks ≤ 4000 characters. */
export function markdownToTelegram(md, max = CHUNK) {
  return packBlocks(markdownToBlocks(toPlainMarkdown(md, { mentionAll: '' })), max)
}

// ------------------------------------------------------- inline keyboard

const callbackCache = new Map()
const CALLBACK_CACHE_MAX = 5000

/**
 * Encode an opaque action value ({ a, t }) and optional option into callback_data (≤ 64 bytes).
 * Compact form `a|t[|option]`; anything longer is kept in a process-local cache under `k:<id>`.
 */
export function encodeCallback(value, option) {
  if (value && typeof value.a === 'string' && typeof value.t === 'string' && /^[\w-]+$/.test(value.a) && !value.t.includes('|') && Object.keys(value).length === 2) {
    const s = option === undefined ? `${value.a}|${value.t}` : `${value.a}|${value.t}|${option}`
    if (Buffer.byteLength(s) <= 64) return s
  }
  const key = `k:${randomBytes(9).toString('base64url')}`
  callbackCache.set(key, { value, option })
  while (callbackCache.size > CALLBACK_CACHE_MAX) callbackCache.delete(callbackCache.keys().next().value)
  return key
}

/** Inverse of encodeCallback; null when unknown/expired. */
export function decodeCallback(data) {
  const s = String(data ?? '')
  if (s.startsWith('k:')) return callbackCache.get(s) ?? null
  const i = s.indexOf('|')
  if (i <= 0) return null
  const j = s.indexOf('|', i + 1)
  return j < 0 ? { value: { a: s.slice(0, i), t: s.slice(i + 1) } } : { value: { a: s.slice(0, i), t: s.slice(i + 1, j) }, option: s.slice(j + 1) }
}

/** ActionSpec → InlineKeyboardMarkup (select options become one button each). */
export function inlineKeyboard(spec) {
  if (!spec) return undefined
  const rows = []
  const buttons = (spec.buttons ?? []).slice(0, 9).map(b => ({ text: String(b.text).slice(0, 40), callback_data: encodeCallback(b.value) }))
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3))
  if (spec.select?.options?.length) {
    const opts = spec.select.options.slice(0, 10).map(o => ({ text: `🔎 ${String(o.text).slice(0, 36)}`, callback_data: encodeCallback(spec.select.value, String(o.value)) }))
    for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2))
  }
  return rows.length ? { inline_keyboard: rows } : undefined
}

// ------------------------------------------------------------ rendering

/**
 * Data-derived text in Telegram Markdown: HTML is escaped by the converter anyway, so only
 * link syntax and line breaks are neutralized (`[x](url)` must not become a link).
 */
const defangMd = (s) => oneLine(s).replace(/[[\]]/g, ch => (ch === '[' ? '［' : '］'))

function resultMarkdown(r, { includeSql, maxRows = 20 } = {}) {
  // Data-derived text (title, error, values) is defanged: no links / tags / mentions from data.
  const head = `**${defangMd(r.title || '查询结果')}**  ${resultMeta(r)}`
  if (r.error) return `${head}\n${defangMd(r.error)}`
  const lines = [head]
  if (!r.rows?.length) lines.push('无数据')
  else if (isKpi(r)) lines.push(kpiText(r, { separator: '\n', escape: defangMd }))
  else lines.push(resultAsMarkdownTable(r, maxRows, { maxCols: 6 }))
  if (r.sql && includeSql) lines.push('```sql\n' + r.sql.slice(0, 1500) + '\n```')
  return lines.join('\n')
}

/**
 * Plan an OutboundMessage as Telegram segments:
 * [{ kind:'text', md, keyboard? } | { kind:'photo', result, caption, keyboard?, sqlMd? }]
 */
export function planMessage(message, { buttons = true } = {}) {
  const segs = []
  const head = [message.title ? `**${defangMd(message.title)}**` : '', message.text ?? ''].filter(Boolean).join('\n\n')
  let text = head
  const flush = (keyboard) => { if (text.trim() || keyboard) segs.push({ kind: 'text', md: text, ...(keyboard ? { keyboard } : {}) }); text = '' }
  for (const r of (message.results ?? []).slice(0, 10)) {
    const keyboard = buttons ? inlineKeyboard(r.actions) : undefined
    if (message.chartMode !== 'table' && !r.error && chartable(r)) {
      flush()
      segs.push({ kind: 'photo', result: r, caption: `<b>${escapeHtml(r.title || '查询结果')}</b>\n${escapeHtml(resultMeta(r))}`.slice(0, CAPTION_LIMIT), ...(keyboard ? { keyboard } : {}), ...(r.sql && message.includeSql ? { sqlMd: '```sql\n' + r.sql.slice(0, 1500) + '\n```' } : {}) })
      continue
    }
    text = [text, resultMarkdown(r, { includeSql: message.includeSql })].filter(s => s.trim()).join('\n\n')
    if (keyboard) flush(keyboard)
  }
  if (message.footer) text = [text, defangMd(toPlainMarkdown(message.footer, { mentionAll: '' }))].filter(s => s.trim()).join('\n\n')
  flush()
  return segs
}

function createSender(api) {
  async function sendText(chatId, chunks, { replyTo, threadId, keyboard } = {}) {
    let first
    for (let i = 0; i < chunks.length; i++) {
      const params = {
        chat_id: chatId,
        text: chunks[i] || '​',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(threadId ? { message_thread_id: threadId } : {}),
        ...(i === 0 && replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}),
        ...(i === chunks.length - 1 && keyboard ? { reply_markup: keyboard } : {}),
      }
      let msg
      try {
        msg = await api.call('sendMessage', params)
      } catch (error) {
        if (error.code !== 'channel/telegram-parse') throw error
        const { parse_mode, ...plain } = params
        msg = await api.call('sendMessage', { ...plain, text: htmlToPlain(params.text) || '​' })
      }
      first ??= msg?.message_id
    }
    return first
  }

  async function sendPhoto(chatId, png, { caption, replyTo, threadId, keyboard } = {}) {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png')
    if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML') }
    if (threadId) form.append('message_thread_id', String(threadId))
    if (replyTo) form.append('reply_parameters', JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }))
    if (keyboard) form.append('reply_markup', JSON.stringify(keyboard))
    const msg = await api.call('sendPhoto', undefined, { form, timeoutMs: 60000 })
    return msg?.message_id
  }

  async function sendDocument(chatId, buf, fileName, { caption, threadId } = {}) {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('document', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName)
    if (caption) form.append('caption', caption.slice(0, 1024))
    if (threadId) form.append('message_thread_id', String(threadId))
    const msg = await api.call('sendDocument', undefined, { form, timeoutMs: 60000 })
    return msg?.message_id
  }

  /** Deliver an OutboundMessage. Returns { messageId, images }. */
  async function deliver(chatId, message, { replyTo, threadId, renderChartPng = defaultRenderChartPng, logger, buttons = true } = {}) {
    let images = 0
    let messageId
    let reply = replyTo
    for (const seg of planMessage(message, { buttons })) {
      let id
      if (seg.kind === 'photo') {
        let png
        try { png = await renderChartPng(seg.result) } catch (error) { logger?.warn?.(`telegram: chart render failed: ${error?.message}`) }
        if (png) {
          id = await sendPhoto(chatId, png, { caption: seg.caption, replyTo: reply, threadId, keyboard: seg.keyboard })
          images++
          if (seg.sqlMd) await sendText(chatId, markdownToTelegram(seg.sqlMd), { threadId })
        } else {
          id = await sendText(chatId, markdownToTelegram(resultMarkdown(seg.result, { includeSql: message.includeSql })), { replyTo: reply, threadId, keyboard: seg.keyboard })
        }
      } else {
        id = await sendText(chatId, markdownToTelegram(seg.md), { replyTo: reply, threadId, keyboard: seg.keyboard })
      }
      messageId ??= id
      reply = undefined
    }
    // Full data as an Excel document (Bot API sendDocument, ≤ 50 MB).
    let files = 0
    let warning
    if (message.attachment?.buffer) {
      try { await sendDocument(chatId, message.attachment.buffer, message.attachment.fileName, { caption: '完整数据', threadId }); files++ } catch (error) { warning = `完整数据附件发送失败：${error.message}` }
    }
    return { messageId: messageId === undefined ? undefined : String(messageId), images, files, ...(warning ? { warning } : {}) }
  }

  return { sendText, sendPhoto, sendDocument, deliver }
}

// ------------------------------------------------------------ validate

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/

function validate(input = {}, existing = {}) {
  const config = { ...(input.config ?? input) }
  const given = input.secrets ?? input
  const secrets = {}
  const token = String(given.botToken ?? '').trim()
  if (token) {
    if (!TOKEN_RE.test(token)) throw new ChannelError('channel/config', 'Bot Token 格式不正确，应形如 123456789:AAH…（在 @BotFather 中获取）', { field: 'botToken' })
    secrets.botToken = token
  } else if (!existing?.secrets?.botToken) {
    throw new ChannelError('channel/config', '请填写 Bot Token', { field: 'botToken' })
  }
  const out = {}
  const chatId = String(config.chatId ?? '').trim()
  if (chatId) {
    if (!CHAT_RE.test(chatId)) throw new ChannelError('channel/config', 'Chat ID 格式不正确：应为数字（群组通常以 -100 开头）或 @频道用户名', { field: 'chatId' })
    out.chatId = chatId
  }
  const base = String(config.apiBase ?? '').trim()
  if (base) {
    let u
    try { u = new URL(base) } catch { throw new ChannelError('channel/config', 'API 地址格式不正确，应为 http(s):// 开头的 URL', { field: 'apiBase' }) }
    if (!/^https?:$/.test(u.protocol)) throw new ChannelError('channel/config', 'API 地址必须以 http:// 或 https:// 开头', { field: 'apiBase' })
    if (u.search || u.hash) throw new ChannelError('channel/config', 'API 地址不能包含查询参数', { field: 'apiBase' })
    out.apiBase = base.replace(/\/+$/, '')
  }
  return { config: out, secrets }
}

function apiFor(channel, secrets, ctx = {}) {
  const conn = { base: apiBaseOf(channel), token: secrets?.botToken, fetch: ctx.fetch ?? globalThis.fetch }
  return { call: (method, params, opts) => callApi(conn, method, params, opts) }
}

async function send(channel, secrets, message, ctx = {}) {
  const chatId = cfg(channel, 'chatId')
  if (!chatId) throw new ChannelError('channel/config', '缺少 Chat ID：请填写推送目标（数字 ID 或 @频道用户名）')
  const sender = createSender(apiFor(channel, secrets, ctx))
  return sender.deliver(chatId, message, { renderChartPng: ctx.renderChartPng ?? defaultRenderChartPng, logger: ctx.logger, buttons: true })
}

async function test(channel, secrets, ctx = {}) {
  const me = await apiFor(channel, secrets, ctx).call('getMe', {})
  return { ok: true, detail: `已连接机器人 @${me?.username ?? '?'}（${me?.first_name ?? ''}）` }
}

/**
 * Helper (capabilities.listTargets is false): chats seen in the bot's pending
 * updates. Only works while the bot is NOT long-polling and no webhook is set;
 * getUpdates without an offset does not confirm (consume) updates.
 */
export async function recentChats(channel, secrets, ctx = {}) {
  let updates
  try {
    updates = await apiFor(channel, secrets, ctx).call('getUpdates', { timeout: 0, limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] })
  } catch (error) {
    if (error.platformCode === 409) throw new ChannelError('channel/rejected', '机器人正在运行（或设置了 Webhook），无法读取最近会话；请暂停机器人后重试，或直接填写 Chat ID')
    throw error
  }
  const seen = new Map()
  for (const u of updates ?? []) {
    const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat
    if (!chat) continue
    const name = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : String(chat.id)))
    seen.set(String(chat.id), { id: String(chat.id), name, type: chat.type === 'private' ? 'user' : chat.type })
  }
  return [...seen.values()]
}

// ------------------------------------------------------------------ bot

/** Detect a bot mention in a group message; returns { mentioned, text } with the mention removed. */
export function detectMention(msg, me) {
  const text = msg.text ?? msg.caption ?? ''
  const entities = msg.entities ?? msg.caption_entities ?? []
  const uname = me?.username ? `@${me.username}`.toLowerCase() : null
  const cuts = []
  let mentioned = false
  for (const e of entities) {
    const seg = text.slice(e.offset, e.offset + e.length)
    if (e.type === 'mention' && uname && seg.toLowerCase() === uname) { mentioned = true; cuts.push([e.offset, e.offset + e.length]) }
    else if (e.type === 'text_mention' && me?.id !== undefined && e.user?.id === me.id) { mentioned = true; cuts.push([e.offset, e.offset + e.length]) }
    else if (e.type === 'bot_command' && uname && seg.toLowerCase().endsWith(uname)) { mentioned = true; cuts.push([e.offset + e.length - uname.length, e.offset + e.length]) }
  }
  if (me?.id !== undefined && msg.reply_to_message?.from?.id === me.id) mentioned = true
  let clean = text
  for (const [a, b] of cuts.sort((x, y) => y[0] - x[0])) clean = clean.slice(0, a) + clean.slice(b)
  return { mentioned, text: clean.replace(/[ \t]{2,}/g, ' ').trim() }
}

function createBot(channel, secrets, handlers = {}, opts = {}) {
  const logger = opts.logger
  const api = apiFor(channel, secrets, opts)
  const sender = createSender(api)
  const pollTimeout = opts.pollTimeoutSec ?? 30
  const backoffBase = opts.backoffMs ?? 1000
  const backoffMax = opts.maxBackoffMs ?? 60000
  const actionWaitMs = opts.actionWaitMs ?? 8000
  const renderChartPng = opts.renderChartPng ?? defaultRenderChartPng
  let state = 'idle'
  let error
  let since = Date.now()
  let me = null
  let controller = null
  let loop = null
  const set = (s, e) => { state = s; error = e; since = Date.now() }

  const deliverTo = (chatId, om, extra = {}) => sender.deliver(chatId, om, { renderChartPng, logger, buttons: true, ...extra })

  function handleMessage(msg) {
    if (!msg || msg.from?.is_bot) return
    const raw = msg.text ?? msg.caption
    if (!raw) return
    const t = msg.chat?.type
    const chatType = t === 'private' ? 'p2p' : (t === 'group' || t === 'supergroup') ? 'group' : null
    if (!chatType) return
    const { mentioned, text } = detectMention(msg, me)
    if (chatType === 'group' && !mentioned) return
    if (chatType === 'p2p' && channel?.bot?.allowP2p === false) return
    const chatId = String(msg.chat.id)
    const threadId = msg.is_topic_message ? msg.message_thread_id : undefined
    const from = msg.from ?? {}
    const inbound = {
      platform: 'telegram',
      channelId: channel?.id,
      messageId: String(msg.message_id),
      chatId,
      chatType,
      text,
      mentionedBot: mentioned,
      sender: { id: String(from.id ?? ''), name: [from.first_name, from.last_name].filter(Boolean).join(' ') || (from.username ? `@${from.username}` : undefined), ...(from.username ? { username: from.username } : {}) },
      raw: msg,
      reply: (om) => deliverTo(chatId, om, { replyTo: msg.message_id, threadId }),
      replyText: async (s) => { await sender.sendText(chatId, packBlocks([{ html: escapeHtml(s), text: String(s ?? '') }]), { replyTo: msg.message_id, threadId }) },
      react: async (kind) => {
        const emoji = REACTIONS[kind]
        if (!emoji) return
        try { await api.call('setMessageReaction', { chat_id: chatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji }] }) } catch (e) { logger?.debug?.(`telegram: reaction failed: ${e.message}`) }
      },
    }
    Promise.resolve(handlers.onMessage?.(inbound)).catch(e => logger?.warn?.(`telegram: onMessage failed: ${e?.message ?? e}`))
  }

  async function handleCallback(cq) {
    const decoded = decodeCallback(cq.data)
    let toast
    if (!decoded) toast = { type: 'error', content: '按钮已过期，请重新提问。' }
    else if (handlers.onAction) {
      const chatId = cq.message?.chat?.id !== undefined ? String(cq.message.chat.id) : ''
      const messageId = cq.message?.message_id
      const threadId = cq.message?.is_topic_message ? cq.message.message_thread_id : undefined
      const action = {
        platform: 'telegram',
        channelId: channel?.id,
        operator: { id: String(cq.from?.id ?? ''), name: [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || undefined },
        chatId,
        messageId: messageId === undefined ? '' : String(messageId),
        value: decoded.value,
        ...(decoded.option !== undefined ? { option: decoded.option } : {}),
        raw: cq,
        reply: (om) => deliverTo(chatId, om, { replyTo: messageId, threadId }),
      }
      const work = Promise.resolve().then(() => handlers.onAction(action)).catch(e => ({ toast: { type: 'error', content: e?.message ?? String(e) } }))
      let timer
      const res = await Promise.race([work, new Promise(r => { timer = setTimeout(() => r(null), actionWaitMs) })])
      clearTimeout(timer)
      toast = res?.toast
    }
    try {
      await api.call('answerCallbackQuery', { callback_query_id: cq.id, ...(toast?.content ? { text: String(toast.content).slice(0, 200), show_alert: toast.type === 'error' } : {}) })
    } catch (e) { logger?.debug?.(`telegram: answerCallbackQuery failed: ${e.message}`) }
  }

  async function run(signal) {
    let delay = backoffBase
    let offset
    let ready = false
    while (!signal.aborted) {
      try {
        if (!ready) {
          set('connecting')
          me = await api.call('getMe', {}, { signal })
          const hook = await api.call('getWebhookInfo', {}, { signal })
          if (hook?.url) {
            logger?.info?.('telegram: removing webhook to use long polling')
            await api.call('deleteWebhook', { drop_pending_updates: false }, { signal })
          }
          ready = true
          set('connected')
        }
        const updates = await api.call('getUpdates', { ...(offset !== undefined ? { offset } : {}), timeout: pollTimeout, allowed_updates: ['message', 'callback_query'] }, { signal, timeoutMs: (pollTimeout + 15) * 1000 })
        if (state !== 'connected') set('connected')
        delay = backoffBase
        for (const u of updates ?? []) {
          if (typeof u.update_id === 'number') offset = Math.max(offset ?? 0, u.update_id + 1)
          try {
            if (u.message) handleMessage(u.message)
            else if (u.callback_query) handleCallback(u.callback_query).catch(e => logger?.warn?.(`telegram: callback failed: ${e?.message}`))
          } catch (e) { logger?.warn?.(`telegram: update ${u.update_id} failed: ${e?.message}`) }
        }
      } catch (e) {
        if (signal.aborted) break
        if (e.platformCode === 409 && /webhook/i.test(e.description ?? '')) ready = false
        set('error', e.message)
        logger?.warn?.(`telegram: polling error: ${e.message}`)
        const wait = e.retryAfter ? e.retryAfter * 1000 : e.code === 'channel/auth' ? backoffMax : delay
        await sleep(wait, signal)
        delay = Math.min(delay * 2, backoffMax)
      }
    }
  }

  return {
    start() {
      if (controller && !controller.signal.aborted) return
      controller = new AbortController()
      loop = run(controller.signal).catch(e => set('error', e?.message ?? String(e)))
    },
    async stop() {
      controller?.abort()
      set('stopped')
      await loop
      loop = null
    },
    status() { return { state, ...(error ? { error } : {}), since } },
    info() { return me ? { name: me.username ? `@${me.username}` : me.first_name, id: String(me.id) } : null },
  }
}

// ------------------------------------------------------------------ kind

const telegramBot = {
  id: 'telegram_bot',
  platform: 'telegram',
  label: { zh: 'Telegram 机器人', en: 'Telegram bot' },
  description: { zh: '通过 Bot API 推送到群组、频道或私聊；长轮询接收提问，无需公网地址。', en: 'Push to groups, channels or private chats via the Bot API; receives questions by long polling, no public URL needed.' },
  fields: [
    { key: 'botToken', type: 'secret', secret: true, required: true, label: { zh: 'Bot Token', en: 'Bot token' }, placeholder: '123456789:AAH…', help: { zh: '在 @BotFather 发送 /newbot 创建机器人后获得', en: 'From @BotFather (/newbot)' } },
    { key: 'chatId', type: 'text', required: false, target: true, label: { zh: 'Chat ID（推送目标）', en: 'Chat ID (push target)' }, placeholder: '-1001234567890 / @mychannel', pattern: CHAT_RE.source, help: { zh: '群组/超级群为负数（通常以 -100 开头），公开频道可填 @用户名；仅作机器人使用时可留空', en: 'Negative number for groups (usually -100…), or @username for public channels; may be empty for bot-only use' } },
    { key: 'apiBase', type: 'url', required: false, label: { zh: 'API 地址（可选）', en: 'API base URL (optional)' }, placeholder: DEFAULT_API_BASE, help: { zh: '自建 Bot API 服务器或反向代理地址；留空使用官方 api.telegram.org', en: 'Self-hosted Bot API server or proxy; empty = api.telegram.org' } },
  ],
  capabilities: { push: true, markdown: 'basic', charts: 'image', chartModes: ['image', 'table'], tables: 'text', tableRows: 20, files: true, buttons: false, bot: true, listTargets: false, mentionAll: false, maxMessageBytes: TEXT_LIMIT },
  setupSteps: {
    zh: [
      '在 Telegram 中打开 @BotFather，发送 /newbot 按提示创建机器人，复制 Bot Token。',
      '群聊中使用：把机器人拉入群；默认隐私模式下机器人只收到 @它 的消息、回复它的消息和命令（本插件也只响应这些）。',
      '频道推送：把机器人加为频道管理员，Chat ID 填 @频道用户名 或 -100 开头的数字 ID。',
      '获取 Chat ID：先在群里 @机器人 发一条消息（机器人未运行时），浏览器打开 https://api.telegram.org/bot<Token>/getUpdates，查看 message.chat.id。',
      '开启机器人后使用长轮询（getUpdates）收消息，无需公网地址；若该 Token 之前设置过 Webhook，会自动调用 deleteWebhook 删除。同一 Token 只能有一个实例轮询。',
      '图表以 PNG 图片发送（sendPhoto）。',
    ],
    en: [
      'Open @BotFather in Telegram, send /newbot and copy the bot token.',
      'Groups: add the bot; with privacy mode on it only receives mentions, replies to it and commands (the plugin answers only those).',
      'Channels: make the bot a channel admin; use @channelusername or the -100… numeric id as Chat ID.',
      'Finding a Chat ID: mention the bot in the chat while the bot is stopped, then open https://api.telegram.org/bot<token>/getUpdates and read message.chat.id.',
      'The bot uses long polling (getUpdates), no public URL needed; an existing webhook is removed with deleteWebhook. Only one instance may poll per token.',
      'Charts are sent as PNG photos (sendPhoto).',
    ],
  },
  validate,
  send,
  test,
  // capabilities.listTargets stays false (the Bot API cannot list a bot's chats). This helper only
  // returns chats seen in pending getUpdates, and only while the bot is not polling / no webhook is set.
  listTargets: recentChats,
  recentChats,
}

export default {
  id: 'telegram',
  name: { zh: 'Telegram', en: 'Telegram' },
  kinds: [telegramBot],
  createBot,
}
