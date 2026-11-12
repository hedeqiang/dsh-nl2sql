/**
 * WeCom 企业微信 channel adapter (platform 'wecom').
 *
 * Kinds:
 *   wecom_webhook  群机器人（消息推送）webhook
 *   wecom_aibot    智能机器人 API 模式 · 长连接 (WebSocket)
 *
 * Official documentation followed (read 2026-11):
 *   - 消息推送配置说明（群机器人 webhook）: https://developer.work.weixin.qq.com/document/path/91770
 *       msgtype text / markdown (content ≤ 4096 bytes, <font color="info|comment|warning">) /
 *       markdown_v2 (≤ 4096 bytes; tables, lists, code; NO font colors, NO <@userid> mentions) /
 *       image (base64 + md5 of raw bytes, ≤ 2 MB, JPG/PNG); text.mentioned_list ["@all"];
 *       "每个消息推送发送的消息不能超过20条/分钟"
 *   - 全局错误码: https://developer.work.weixin.qq.com/document/path/90313
 *       45009 接口调用超过限制, 93000 webhook url 不合法或已被移出群, 93004 消息推送被停用,
 *       93008 不在群里, 40058 参数不合法, 93017 内容为空, 93018 图片大小超过限制
 *   - 智能机器人长连接: https://developer.work.weixin.qq.com/document/path/101463
 *       wss://openws.work.weixin.qq.com; frames { cmd, headers:{req_id}, body };
 *       aibot_subscribe {bot_id, secret} → { headers:{req_id}, errcode, errmsg };
 *       ping every 30 s; aibot_msg_callback (chattype single|group, chatid only for groups,
 *       from.userid, msgtype text|mixed|voice|...); aibot_event_callback (disconnected_event when a
 *       newer connection takes over); aibot_respond_msg (stream: {id, finish, content ≤ 20480 bytes},
 *       same req_id as the callback, finish within 10 min); aibot_send_msg (active push, body.chatid,
 *       chat_type 1 single / 2 group, msgtype markdown|template_card; the user must have messaged the
 *       bot in that chat first); 30 msgs/min & 1000/hour per chat.
 *   - 长连接概述: https://developer.work.weixin.qq.com/document/path/101956
 *   - 被动回复消息（stream / msg_item image base64+md5）: https://developer.work.weixin.qq.com/document/path/101031
 *   - Official Node SDK @wecom/aibot-node-sdk 1.0.7 (https://github.com/WecomTeam/aibot-node-sdk) was
 *     READ (not used) to confirm: req_id format `${cmd}_${ts}_${rand}`, ack frames have no cmd and are
 *     matched by req_id, heartbeat ack resets a missed-pong counter (2 misses → reconnect),
 *     exponential back-off 1 s … 30 s, no auto-reconnect after disconnected_event.
 *
 * Not implemented (documented but out of scope / unverifiable here): template-card buttons on the AI
 * bot (template_card_event → aibot_respond_update_msg), media upload over the long connection, image
 * msg_item in stream replies. Charts on the AI bot therefore fall back to Markdown tables.
 */
import { createHash, randomBytes } from 'node:crypto'
import { ChannelError, postJson } from './http.js'
import { renderChartPng as defaultRenderChartPng, chartable, cellText, defangMd, fmtNum, resultMeta, isKpi, kpiText, resultAsMarkdownTable, toPlainMarkdown, mentionsAll, splitText } from './message.js'

export const WEBHOOK_HOST = 'https://qyapi.weixin.qq.com'
export const DEFAULT_GATEWAY = 'wss://openws.work.weixin.qq.com'
const WEBHOOK_LIMIT = 4096
const AIBOT_LIMIT = 20480
const IMAGE_LIMIT = 2 * 1024 * 1024

const cfg = (channel, key) => channel?.[key] ?? channel?.config?.[key]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const md5 = (buf) => createHash('md5').update(buf).digest('hex')
export const reqId = (cmd) => `${cmd}_${Date.now()}_${randomBytes(4).toString('hex')}`

// ------------------------------------------------------------- errors

const ERRORS = {
  45009: ['channel/rate-limit', '发送太频繁：企业微信群机器人每分钟最多 20 条消息，请稍后再试'],
  93000: ['channel/auth', 'Webhook 地址无效，或机器人已被移出群聊（errcode 93000）'],
  93001: ['channel/rejected', '当前群聊不允许推送消息'],
  93004: ['channel/rejected', '该消息推送（群机器人）已被停用'],
  93006: ['channel/config', '不合法的群 ID'],
  93008: ['channel/rejected', '机器人不在群里'],
  93017: ['channel/rejected', '消息内容不能为空'],
  93018: ['channel/rejected', '图片超过大小限制（2MB）'],
  93019: ['channel/auth', '不合法的机器人 ID'],
  40008: ['channel/rejected', '不支持的消息类型'],
  40058: ['channel/rejected', '请求参数不合法（内容可能超长或格式错误）'],
  44004: ['channel/rejected', '消息内容为空'],
  45002: ['channel/rejected', '消息内容超过长度限制'],
  40001: ['channel/auth', 'Secret 不正确'],
}

/** Map a WeCom errcode/errmsg to ChannelError. */
export function wecomError(json, status, { subscribe = false } = {}) {
  const code = json?.errcode
  const msg = String(json?.errmsg ?? json?.raw ?? '').slice(0, 200)
  const known = ERRORS[code]
  let err
  if (known) err = new ChannelError(known[0], known[1])
  else if (subscribe) err = new ChannelError('channel/auth', `智能机器人订阅失败：Bot ID 或 Secret 不正确，或未开启「API 模式 · 长连接」（errcode ${code ?? '?'}：${msg}）`)
  else if (status && status >= 400 && code === undefined) err = new ChannelError('channel/network', `企业微信接口返回 HTTP ${status}`)
  else err = new ChannelError('channel/rejected', `企业微信返回错误（errcode ${code ?? '?'}）：${msg || '未知错误'}`)
  err.platformCode = code
  return err
}

// ----------------------------------------------------------- rendering

/** Lark-style <font color> → WeCom markdown colours (info green / warning orange-red / comment grey). */
export function toWecomMarkdown(md) {
  const COLORS = { green: 'info', red: 'warning', orange: 'warning', grey: 'comment', gray: 'comment', info: 'info', warning: 'warning', comment: 'comment' }
  const withColors = String(md ?? '').replace(/<font\b[^>]*color\s*=\s*['"]?([\w-]+)['"]?[^>]*>([\s\S]*?)<\/font>/gi, (_, c, body) => {
    const w = COLORS[String(c).toLowerCase()]
    return w ? `\u0000font color="${w}"\u0001${body}\u0000/font\u0001` : body
  })
  return toPlainMarkdown(withColors, { mentionAll: '' }).replace(/\u0000/g, '<').replace(/\u0001/g, '>')
}

function resultBlock(r, { includeSql, maxRows = 10, table = true } = {}) {
  // Data-derived text (title, error, values) is defanged: no links / tags / mentions from data.
  const head = `**${defangMd(r.title || '查询结果')}**  ${resultMeta(r)}`
  if (r.error) return `${head}\n${defangMd(r.error)}`
  const lines = [head]
  if (!r.rows?.length) lines.push('无数据')
  else if (isKpi(r)) lines.push(kpiText(r, { separator: '\n' }))
  else if (table) lines.push(resultAsMarkdownTable(r, maxRows, { maxCols: 8 }))
  else lines.push(resultAsText(r, maxRows))
  if (r.sql && includeSql) lines.push('```sql\n' + r.sql.slice(0, 1500) + '\n```')
  return lines.join('\n')
}

function resultAsText(r, maxRows) {
  const cols = r.columns.slice(0, 6)
  const rows = r.rows.slice(0, maxRows)
  const out = [`> ${cols.map(c => defangMd(c.name)).join(' ｜ ')}`, ...rows.map(row => `> ${cols.map((c, i) => defangMd(c.kind === 'number' ? fmtNum(row[i]) : cellText(row[i], 60))).join(' ｜ ')}`)]
  if ((r.rowCount ?? r.rows.length) > rows.length) out.push(`<font color="comment">…共 ${r.rowCount ?? r.rows.length} 行</font>`)
  return out.join('\n')
}

/**
 * Plan a webhook delivery: [{ msgtype:'markdown'|'markdown_v2', content } | { msgtype:'image', result } | { msgtype:'text', mentionAll:true }].
 * markdown_v2 (tables) is used when the message contains tables; plain markdown (colours) otherwise.
 */
export function planWebhook(message) {
  const sections = []
  const images = []
  if (message.title) sections.push(`## ${defangMd(message.title)}`)
  if (message.text) sections.push(message.text)
  let hasTable = /(^|\n)\|[^\n]*\|\s*\n\|[\s:|-]+\|/.test(message.text ?? '')
  for (const r of (message.results ?? []).slice(0, 10)) {
    if (message.chartMode !== 'table' && !r.error && chartable(r)) {
      sections.push(`**${defangMd(r.title || '查询结果')}**  ${resultMeta(r)}（见下方图表）${r.sql && message.includeSql ? '\n```sql\n' + r.sql.slice(0, 1500) + '\n```' : ''}`)
      images.push({ msgtype: 'image', result: r })
      continue
    }
    if (r.rows?.length && !isKpi(r) && !r.error) hasTable = true
    sections.push(resultBlock(r, { includeSql: message.includeSql }))
  }
  if (message.footer) sections.push(defangMd(toPlainMarkdown(message.footer, { mentionAll: '' })))
  const md = sections.filter(Boolean).join('\n\n')
  const msgtype = hasTable ? 'markdown_v2' : 'markdown'
  const content = msgtype === 'markdown_v2' ? toPlainMarkdown(md, { mentionAll: '' }) : toWecomMarkdown(md)
  const parts = splitText(content, WEBHOOK_LIMIT - 16).map(c => ({ msgtype, content: c }))
  const plan = [...parts, ...images]
  // markdown_v2 cannot @; markdown supports <@userid> only. The documented @all is text.mentioned_list.
  if (message.mentionAll || mentionsAll(message.text) || mentionsAll(message.footer)) plan.push({ msgtype: 'text', mentionAll: true })
  return plan
}

// ------------------------------------------------------------- webhook

export const WEBHOOK_RE = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]{8,}$/

function webhookUrl(channel, secrets) {
  const url = secrets?.webhookUrl
  if (!url) throw new ChannelError('channel/config', '缺少 Webhook 地址')
  const override = cfg(channel, 'apiBase')
  if (override) return url.replace(WEBHOOK_HOST, String(override).replace(/\/+$/, ''))
  return url
}

/** Per-webhook sliding window (20 msgs / 60 s). Waits up to `maxWaitMs`, else throws rate-limit. */
const windows = new Map()
async function throttle(key, { limit = 20, windowMs = 60000, maxWaitMs = 15000 } = {}) {
  const now = Date.now()
  const list = (windows.get(key) ?? []).filter(t => now - t < windowMs)
  if (list.length >= limit) {
    const wait = windowMs - (now - list[0]) + 50
    if (wait > maxWaitMs) throw new ChannelError('channel/rate-limit', `发送太频繁：企业微信群机器人每分钟最多 ${limit} 条消息，请约 ${Math.ceil(wait / 1000)} 秒后再试`)
    await sleep(wait)
    return throttle(key, { limit, windowMs, maxWaitMs })
  }
  list.push(now)
  windows.set(key, list)
}
export function resetThrottle() { windows.clear() }

async function postWebhook(url, body, ctx, throttleOpts) {
  await throttle(url, throttleOpts)
  const { status, json } = await postJson(url, body, {}, { label: '企业微信', fetch: ctx.fetch, timeoutMs: 20000 })
  if (json?.errcode !== 0) throw wecomError(json, status)
  return json
}

async function sendWebhook(channel, secrets, message, ctx = {}) {
  const url = webhookUrl(channel, secrets)
  const render = ctx.renderChartPng ?? defaultRenderChartPng
  const throttleOpts = ctx.throttle
  let images = 0
  for (const step of planWebhook(message)) {
    if (step.msgtype === 'image') {
      let png
      try { png = await render(step.result) } catch (e) { ctx.logger?.warn?.(`wecom: chart render failed: ${e?.message}`) }
      if (png && png.length <= IMAGE_LIMIT) {
        await postWebhook(url, { msgtype: 'image', image: { base64: Buffer.from(png).toString('base64'), md5: md5(png) } }, ctx, throttleOpts)
        images++
      } else {
        await postWebhook(url, { msgtype: 'markdown_v2', markdown_v2: { content: toPlainMarkdown(resultBlock(step.result, { includeSql: false })).slice(0, 3000) } }, ctx, throttleOpts)
      }
      continue
    }
    if (step.msgtype === 'text') {
      await postWebhook(url, { msgtype: 'text', text: { content: '请查看上方消息', mentioned_list: ['@all'] } }, ctx, throttleOpts)
      continue
    }
    await postWebhook(url, { msgtype: step.msgtype, [step.msgtype]: { content: step.content } }, ctx, throttleOpts)
  }
  return { images }
}

function validateWebhook(input = {}, existing = {}) {
  const given = input.secrets ?? input
  const url = String(given.webhookUrl ?? '').trim()
  const secrets = {}
  if (url) {
    if (!WEBHOOK_RE.test(url)) throw new ChannelError('channel/config', 'Webhook 地址格式不正确，应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…（在群聊 → 消息推送 中复制）', { field: 'webhookUrl' })
    secrets.webhookUrl = url
  } else if (!existing?.secrets?.webhookUrl) {
    throw new ChannelError('channel/config', '请填写 Webhook 地址', { field: 'webhookUrl' })
  }
  return { config: {}, secrets }
}

// --------------------------------------------------------------- AI bot

/** Strip "@Bot" mentions from a group text (WeCom delivers "@RobotA hello"). */
export function stripMention(text, botName) {
  let s = String(text ?? '')
  if (botName) s = s.split(`@${botName}`).join(' ')
  // The callback only reaches us when the bot was @-mentioned in a group: drop a leading @name token.
  else s = s.replace(/^\s*@\S+\s*/, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function inboundText(body) {
  if (body.msgtype === 'text') return body.text?.content ?? ''
  if (body.msgtype === 'voice') return body.voice?.content ?? ''
  if (body.msgtype === 'mixed') return (body.mixed?.msg_item ?? []).filter(i => i.msgtype === 'text').map(i => i.text?.content ?? '').join('\n')
  return ''
}

function aibotMarkdown(message) {
  const parts = []
  if (message.title) parts.push(`**${defangMd(message.title)}**`)
  if (message.text) parts.push(toPlainMarkdown(message.text, { mentionAll: '' }))
  for (const r of (message.results ?? []).slice(0, 10)) parts.push(resultBlock(r, { includeSql: message.includeSql }))
  if (message.footer) parts.push(defangMd(toPlainMarkdown(message.footer, { mentionAll: '' })))
  return parts.join('\n\n')
}

function wsUrl(channel) {
  return String(cfg(channel, 'gatewayBase') || DEFAULT_GATEWAY)
}

/**
 * One long connection: open, subscribe, heartbeat, request/ack by req_id.
 * Used by createBot (persistent) and by test()/send() (short-lived).
 */
function openConnection(url, { botId, secret, WebSocketImpl = globalThis.WebSocket, onFrame, onClose, timeoutMs = 10000, heartbeatMs = 30000, logger } = {}) {
  return new Promise((resolve, reject) => {
    let ws
    try { ws = new WebSocketImpl(url) } catch (e) { reject(new ChannelError('channel/network', `无法连接企业微信长连接网关：${e?.message ?? e}`)); return }
    const pending = new Map()
    let subscribed = false
    let hb = null
    let missed = 0
    let closed = false
    const timer = setTimeout(() => fail(new ChannelError('channel/network', '连接企业微信长连接网关超时')), timeoutMs)

    function fail(err) {
      clearTimeout(timer)
      if (!subscribed) reject(err)
      try { ws.close() } catch {}
    }
    const conn = {
      request(cmd, body, { id = reqId(cmd), ackTimeoutMs = 10000 } = {}) {
        return new Promise((res, rej) => {
          if (closed || ws.readyState !== 1) return rej(new ChannelError('channel/network', '企业微信长连接未连接'))
          const t = setTimeout(() => { pending.delete(id); rej(new ChannelError('channel/network', `企业微信未确认请求（${cmd}）`)) }, ackTimeoutMs)
          pending.set(id, { res, rej, t, cmd })
          ws.send(JSON.stringify({ cmd, headers: { req_id: id }, ...(body !== undefined ? { body } : {}) }))
        })
      },
      close() { closed = true; clearInterval(hb); try { ws.close() } catch {} },
      get open() { return !closed && ws.readyState === 1 },
    }
    // A reply to a callback reuses the callback's req_id; several replies may share it, so queue per id.
    const queues = new Map()
    conn.reply = (id, cmd, body) => {
      const prev = queues.get(id) ?? Promise.resolve()
      const next = prev.catch(() => {}).then(() => conn.request(cmd, body, { id }))
      queues.set(id, next)
      next.finally(() => { if (queues.get(id) === next) queues.delete(id) }).catch(() => {})
      return next
    }

    ws.addEventListener('open', () => {
      const id = reqId('aibot_subscribe')
      pending.set(id, {
        cmd: 'aibot_subscribe',
        res: () => {
          subscribed = true
          clearTimeout(timer)
          hb = setInterval(() => {
            if (missed >= 2) { logger?.warn?.('wecom: heartbeat lost, reconnecting'); try { ws.close() } catch {}; return }
            missed++
            const pid = reqId('ping')
            pending.set(pid, { cmd: 'ping', res: () => { missed = 0 }, rej: () => {}, t: null })
            try { ws.send(JSON.stringify({ cmd: 'ping', headers: { req_id: pid } })) } catch {}
          }, heartbeatMs)
          resolve(conn)
        },
        rej: (e) => fail(e),
        t: null,
      })
      ws.send(JSON.stringify({ cmd: 'aibot_subscribe', headers: { req_id: id }, body: { bot_id: botId, secret } }))
    })
    ws.addEventListener('message', (ev) => {
      let frame
      try { frame = JSON.parse(String(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data)).replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '')) } catch { return }
      const id = frame?.headers?.req_id ?? ''
      if (frame.cmd) { onFrame?.(frame, conn); return }
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (p.t) clearTimeout(p.t)
      if (frame.errcode === 0 || frame.errcode === undefined) p.res(frame)
      else p.rej(wecomError(frame, undefined, { subscribe: p.cmd === 'aibot_subscribe' }))
    })
    ws.addEventListener('error', () => { if (!subscribed) fail(new ChannelError('channel/network', '无法连接企业微信长连接网关')) })
    ws.addEventListener('close', () => {
      closed = true
      clearTimeout(timer)
      clearInterval(hb)
      for (const p of pending.values()) { if (p.t) clearTimeout(p.t); p.rej(new ChannelError('channel/network', '企业微信长连接已断开')) }
      pending.clear()
      if (!subscribed) reject(new ChannelError('channel/network', '企业微信长连接在订阅完成前断开'))
      else onClose?.()
    })
  })
}

/** Live AI-bot connections by bot id so send() can reuse a running bot (the platform allows one connection per bot). */
const liveConnections = new Map()

async function withConnection(channel, secrets, ctx, fn) {
  const botId = cfg(channel, 'botId')
  if (!botId || !secrets?.secret) throw new ChannelError('channel/config', '缺少 Bot ID 或 Secret')
  const live = liveConnections.get(botId)
  if (live?.open) return fn(live)
  // NOTE: a short-lived subscribe kicks any other connection of this bot (one connection per bot).
  const conn = await openConnection(wsUrl(channel), { botId, secret: secrets.secret, WebSocketImpl: ctx.WebSocket, logger: ctx.logger })
  try { return await fn(conn) } finally { conn.close() }
}

async function sendAibot(channel, secrets, message, ctx = {}) {
  const chatId = cfg(channel, 'chatId')
  if (!chatId) throw new ChannelError('channel/config', '缺少推送目标会话 ID（群聊 chatid 或成员 userid）')
  const chatType = cfg(channel, 'chatType') === 'single' ? 1 : 2
  const chunks = splitText(aibotMarkdown(message), AIBOT_LIMIT - 64)
  await withConnection(channel, secrets, ctx, async (conn) => {
    for (const content of chunks) await conn.request('aibot_send_msg', { chatid: chatId, chat_type: chatType, msgtype: 'markdown', markdown: { content } })
  })
  return { images: 0 }
}

async function testAibot(channel, secrets, ctx = {}) {
  const botId = cfg(channel, 'botId')
  if (liveConnections.get(botId)?.open) return { ok: true, detail: '机器人长连接在线' }
  await withConnection(channel, secrets, ctx, async () => {})
  return { ok: true, detail: '订阅成功：Bot ID 与 Secret 有效（注意：测试连接会顶掉该机器人在别处的长连接）' }
}

function validateAibot(input = {}, existing = {}) {
  const config = input.config ?? input
  const given = input.secrets ?? input
  const out = {}
  const botId = String(config.botId ?? '').trim()
  if (!botId) throw new ChannelError('channel/config', '请填写智能机器人的 Bot ID', { field: 'botId' })
  if (!/^[\w-]{6,128}$/.test(botId)) throw new ChannelError('channel/config', 'Bot ID 格式不正确（在 管理后台 → 智能机器人 → API 模式 中查看）', { field: 'botId' })
  out.botId = botId
  const chatId = String(config.chatId ?? '').trim()
  if (chatId) {
    if (!/^[\w@.-]{1,128}$/.test(chatId)) throw new ChannelError('channel/config', '会话 ID 格式不正确', { field: 'chatId' })
    out.chatId = chatId
    out.chatType = config.chatType === 'single' ? 'single' : 'group'
  }
  const gw = String(config.gatewayBase ?? '').trim()
  if (gw) {
    if (!/^wss?:\/\/[^\s]+$/.test(gw)) throw new ChannelError('channel/config', '网关地址必须以 wss:// 开头', { field: 'gatewayBase' })
    out.gatewayBase = gw
  }
  const secrets = {}
  const secret = String(given.secret ?? '').trim()
  if (secret) {
    if (secret.length < 8 || /\s/.test(secret)) throw new ChannelError('channel/config', 'Secret 格式不正确', { field: 'secret' })
    secrets.secret = secret
  } else if (!existing?.secrets?.secret) {
    throw new ChannelError('channel/config', '请填写长连接 Secret', { field: 'secret' })
  }
  return { config: out, secrets }
}

function createBot(channel, secrets, handlers = {}, opts = {}) {
  const logger = opts.logger
  const botId = cfg(channel, 'botId')
  const botName = cfg(channel, 'botName')
  const backoffBase = opts.backoffMs ?? 1000
  const backoffMax = opts.maxBackoffMs ?? 30000
  let state = 'idle'
  let error
  let since = Date.now()
  let conn = null
  let stopped = true
  let attempts = 0
  let timer = null
  const seen = new Set()
  const set = (s, e) => { state = s; error = e; since = Date.now() }

  function onFrame(frame, c) {
    const body = frame.body ?? {}
    const id = frame.headers?.req_id
    if (frame.cmd === 'aibot_event_callback') {
      if (body.event?.eventtype === 'disconnected_event') {
        // A newer connection for this bot took over: do not fight it.
        logger?.warn?.('wecom: disconnected_event — another connection took over this bot')
        stopped = true
        set('error', '该智能机器人在别处建立了新的长连接，本连接已被顶下线')
        c.close()
      }
      return
    }
    if (frame.cmd !== 'aibot_msg_callback') return
    if (body.msgid) {
      if (seen.has(body.msgid)) return
      seen.add(body.msgid)
      if (seen.size > 2000) seen.delete(seen.values().next().value)
    }
    const chatType = body.chattype === 'group' ? 'group' : 'p2p'
    if (chatType === 'p2p' && channel?.bot?.allowP2p === false) return
    const raw = inboundText(body)
    const text = chatType === 'group' ? stripMention(raw, botName) : raw.trim()
    if (!text) return
    const chatId = chatType === 'group' ? body.chatid : body.from?.userid
    let streamId = null
    let replies = 0
    const stream = (content, finish) => {
      streamId ??= `s_${randomBytes(8).toString('hex')}`
      return c.reply(id, 'aibot_respond_msg', { msgtype: 'stream', stream: { id: streamId, finish, content: String(content).slice(0, AIBOT_LIMIT) } })
    }
    const inbound = {
      platform: 'wecom',
      channelId: channel?.id,
      messageId: body.msgid ?? id,
      chatId,
      chatType,
      text,
      mentionedBot: chatType === 'group',
      sender: { id: body.from?.userid ?? '' },
      raw: body,
      async reply(om) {
        const chunks = splitText(aibotMarkdown(om), AIBOT_LIMIT - 64)
        // First chunk finishes the reply stream; extras go out as active pushes.
        await stream(chunks[0], true)
        replies++
        for (const extra of chunks.slice(1)) await c.request('aibot_send_msg', { chatid: chatId, chat_type: chatType === 'group' ? 2 : 1, msgtype: 'markdown', markdown: { content: extra } })
        return { messageId: streamId }
      },
      async replyText(s) {
        if (replies === 0 && !streamId) { await stream(String(s), false); return } // progress text, finished by reply()
        await c.request('aibot_send_msg', { chatid: chatId, chat_type: chatType === 'group' ? 2 : 1, msgtype: 'markdown', markdown: { content: String(s) } })
      },
    }
    Promise.resolve(handlers.onMessage?.(inbound)).catch(e => logger?.warn?.(`wecom: onMessage failed: ${e?.message ?? e}`))
  }

  async function connect() {
    if (stopped) return
    set('connecting')
    try {
      const c = await openConnection(wsUrl(channel), { botId, secret: secrets?.secret, WebSocketImpl: opts.WebSocket, onFrame, logger, heartbeatMs: opts.heartbeatMs, onClose: () => {
        if (liveConnections.get(botId) === c) liveConnections.delete(botId)
        conn = null
        if (!stopped) { set('connecting', '连接已断开，正在重连'); schedule() }
      } })
      if (stopped) { c.close(); return }
      conn = c
      liveConnections.set(botId, c)
      attempts = 0
      set('connected')
    } catch (e) {
      if (stopped) return
      set('error', e.message)
      logger?.warn?.(`wecom: connect failed: ${e.message}`)
      schedule(e.code === 'channel/auth')
    }
  }
  function schedule(auth = false) {
    clearTimeout(timer)
    attempts++
    const delay = Math.min(backoffBase * 2 ** (attempts - 1), backoffMax) * (auth ? 2 : 1)
    timer = setTimeout(connect, delay)
  }

  return {
    start() { if (!stopped) return; stopped = false; attempts = 0; connect() },
    async stop() {
      stopped = true
      clearTimeout(timer)
      if (conn) { if (liveConnections.get(botId) === conn) liveConnections.delete(botId); conn.close(); conn = null }
      set('stopped')
    },
    status() { return { state, ...(error ? { error } : {}), since } },
    info() { return botId ? { id: botId, ...(botName ? { name: botName } : {}) } : null },
  }
}

// ---------------------------------------------------------------- kinds

const webhookKind = {
  id: 'wecom_webhook',
  platform: 'wecom',
  label: { zh: '企业微信群机器人（Webhook）', en: 'WeCom group bot (webhook)' },
  description: { zh: '向企业微信群推送 Markdown 和图表图片；仅推送，不能接收提问。', en: 'Push Markdown and chart images to a WeCom group; push only.' },
  fields: [
    { key: 'webhookUrl', type: 'secret', secret: true, required: true, label: { zh: 'Webhook 地址', en: 'Webhook URL' }, placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…', pattern: WEBHOOK_RE.source, help: { zh: '群聊 → 右上角 … → 消息推送 → 添加，复制 Webhook 地址', en: 'Group chat → … → Message push → Add, copy the webhook URL' } },
  ],
  capabilities: { push: true, markdown: 'basic', charts: 'image', chartModes: ['image', 'table'], tables: 'markdown', tableRows: 10, files: false, buttons: false, bot: false, listTargets: false, mentionAll: true, maxMessageBytes: WEBHOOK_LIMIT },
  setupSteps: {
    zh: [
      '在企业微信群聊中点击右上角「…」→「消息推送」（旧版为「群机器人」）→「添加」，创建后复制 Webhook 地址。',
      '含表格的消息使用 markdown_v2 发送（需客户端 4.1.36+），其余使用 markdown（支持绿/橙/灰三种字体颜色）。',
      '图表以 PNG 图片（base64，≤2MB）单独发送；@所有人通过一条附加的文本消息实现（markdown 不支持 @all）。',
      '每个群机器人每分钟最多 20 条消息（错误码 45009），插件会自动限速；请勿泄露 Webhook 地址。',
    ],
    en: [
      'In a WeCom group: … → Message push (formerly Group bot) → Add, then copy the webhook URL.',
      'Messages with tables use markdown_v2 (client 4.1.36+); others use markdown (three font colours).',
      'Charts are sent as separate PNG images (base64, ≤ 2 MB); @all is sent as an extra text message (markdown cannot @all).',
      'Limit: 20 messages per minute per bot (errcode 45009); the plugin throttles. Keep the URL secret.',
    ],
  },
  validate: validateWebhook,
  send: sendWebhook,
}

const aibotKind = {
  id: 'wecom_aibot',
  platform: 'wecom',
  label: { zh: '企业微信智能机器人（长连接）', en: 'WeCom AI bot (long connection)' },
  description: { zh: '智能机器人 API 模式长连接：群里 @机器人 或单聊提问，流式回复；可向已对话过的会话主动推送 Markdown。无需公网地址。', en: 'AI bot API mode over a long connection: answers @mentions and direct chats with streamed replies; can push Markdown to chats that have talked to the bot. No public URL.' },
  fields: [
    { key: 'botId', type: 'text', required: true, label: { zh: 'Bot ID', en: 'Bot ID' }, help: { zh: '管理后台 → 应用管理 → 智能机器人 → 详情 → API 模式（长连接）中查看', en: 'Admin console → AI bot → API mode (long connection)' } },
    { key: 'secret', type: 'secret', secret: true, required: true, label: { zh: '长连接 Secret', en: 'Long-connection secret' }, help: { zh: '长连接专用 Secret（不同于回调模式的 Token / EncodingAESKey）', en: 'Long-connection secret (not the callback Token/EncodingAESKey)' } },
    { key: 'botName', type: 'text', required: false, label: { zh: '机器人名称（可选）', en: 'Bot name (optional)' }, help: { zh: '用于从群消息中去掉 “@机器人名”', en: 'Used to strip "@name" from group messages' } },
    { key: 'chatId', type: 'text', required: false, label: { zh: '推送目标会话 ID（可选）', en: 'Push target chat id (optional)' }, help: { zh: '群聊 chatid（来自机器人收到的消息）或成员 userid；会话需先给机器人发过消息', en: 'Group chatid (from a received message) or member userid; the chat must have messaged the bot first' } },
    { key: 'chatType', type: 'select', required: false, label: { zh: '会话类型', en: 'Chat type' }, options: [{ value: 'group', label: { zh: '群聊', en: 'Group' } }, { value: 'single', label: { zh: '单聊', en: 'Single' } }] },
  ],
  capabilities: { push: true, markdown: 'full', charts: 'none', chartModes: ['table'], tables: 'markdown', tableRows: 10, files: false, buttons: false, bot: true, listTargets: false, mentionAll: false, maxMessageBytes: AIBOT_LIMIT },
  setupSteps: {
    zh: [
      '企业微信管理后台 → 应用管理 → 智能机器人 → 创建（或选择）机器人 → 开启「API 模式」并选择「长连接」。',
      '复制 Bot ID 与长连接专用 Secret 填入；开启后原「接收消息 URL」回调失效。',
      '每个机器人同一时间只能有一条长连接：新连接会把旧连接顶下线（包括本插件的“测试连接”和主动推送），请勿在多处同时运行。',
      '把机器人添加到群聊；群里 @机器人 或单聊发送消息即可提问，回复以流式消息呈现（24 小时内可回复）。',
      '主动推送（aibot_send_msg）只能发往曾给机器人发过消息的会话；每个会话限 30 条/分钟、1000 条/小时。',
      '暂不支持：图表图片与卡片按钮（图表以 Markdown 表格展示）。',
    ],
    en: [
      'WeCom admin console → App management → AI bot → create/select a bot → enable API mode with “long connection”.',
      'Copy the Bot ID and the long-connection secret; the callback URL mode stops working.',
      'Only one long connection per bot: a new one (including “test” and push from this plugin) kicks the old one. Run it in one place only.',
      'Add the bot to groups; @mention it or chat directly. Replies are streamed (allowed within 24 h).',
      'Active push (aibot_send_msg) only reaches chats that have messaged the bot; 30/min and 1000/hour per chat.',
      'Not supported yet: chart images and card buttons (charts become Markdown tables).',
    ],
  },
  validate: validateAibot,
  send: sendAibot,
  test: testAibot,
}

export default {
  id: 'wecom',
  name: { zh: '企业微信', en: 'WeCom' },
  kinds: [webhookKind, aibotKind],
  createBot,
}
