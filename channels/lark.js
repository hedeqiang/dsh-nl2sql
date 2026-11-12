/**
 * Lark / Feishu channel adapter (see docs/channels.md).
 *
 * Kinds:
 *   - lark_webhook: a group custom bot (webhook URL + optional signing secret).
 *     Cards with native charts; cannot upload images or receive callbacks.
 *   - lark_app: a custom app bot (app_id + app_secret) sending to a chat, user
 *     or email through the IM API; optional PNG charts; inbound bot over the
 *     official long connection (`im.message.receive_v1`, `card.action.trigger`).
 *
 * Inbound: @larksuiteoapi/node-sdk WSClient + EventDispatcher. No public URL is
 * needed; the app must be configured with "使用长连接接收事件" (and the
 * callback "卡片回传交互" in long-connection mode) in the developer console.
 * OpenAPI helpers use plain `fetch` (no SDK) so they can be tested against a
 * mock server through the optional `baseUrl` parameter.
 */
import { createHash, createHmac } from 'node:crypto'
import { ChannelError, request } from './http.js'
import { MD_TABLE, cellText, chartOption, chartable, dualAxis, kpiText, isKpi, needsAttachment, num, omittedNote, parseMdTable, renderChartPng, resultMeta } from './message.js'

export { ChannelError, ChannelError as ImError, chartOption, chartable, dualAxis, renderChartPng }

// ===========================================================================
// OpenAPI helpers and long connection
// ===========================================================================

const HOSTS = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
}
const DEFAULT_TIMEOUT_MS = 15000
// Feishu waits 3 s for a card callback response; answer well before that.
const CARD_ACTION_TIMEOUT_MS = 2500
const APP_ID_RE = /^cli_[0-9a-fA-F]{16}$/
// Lark codes meaning "the tenant token is invalid/expired" → drop cache, retry once.
const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991664, 99991668])

// ---------------------------------------------------------------------------
// HTTP helpers (plain fetch)
// ---------------------------------------------------------------------------

export function resolveBaseUrl({ domain, baseUrl } = {}) {
  if (baseUrl) return String(baseUrl).replace(/\/+$/, '')
  return domain === 'lark' ? HOSTS.lark : HOSTS.feishu
}

function larkError(path, body, status) {
  const code = body && typeof body.code === 'number' ? body.code : undefined
  const msg = (body && body.msg) || (status ? `HTTP ${status}` : 'unknown error')
  const err = new Error(`Lark API ${path} failed: ${code !== undefined ? `code=${code} ` : ''}msg=${msg}`)
  err.code = code
  err.larkMsg = msg
  err.status = status
  return err
}

async function rawRequest(base, path, { method = 'GET', token, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: sig,
    })
  } catch (e) {
    const reason = e?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms`
      : e?.name === 'AbortError' ? 'aborted'
      : (e?.cause?.code || e?.cause?.message || e?.message || String(e))
    const err = new Error(`Lark API ${path} request failed: ${reason}`)
    err.cause = e
    throw err
  }
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = undefined }
  if (!json || typeof json !== 'object') throw larkError(path, { msg: `non-JSON response (HTTP ${res.status})` }, res.status)
  if (json.code !== 0) throw larkError(path, json, res.status)
  return json
}

const tokenCache = new Map() // key -> { token, expiresAt } | { pending: Promise }

function tokenKey(base, appId, appSecret) {
  const h = createHash('sha256').update(String(appSecret)).digest('hex').slice(0, 16)
  return `${base}|${appId}|${h}`
}

/**
 * getTenantToken({ appId, appSecret, domain, baseUrl?, signal?, force? }) → Promise<string>
 * tenant_access_token for an internal (self-built) app, cached in memory until
 * `expire - 60s`. Concurrent calls share one request.
 */
export async function getTenantToken({ appId, appSecret, domain, baseUrl, signal, force = false } = {}) {
  if (!appId || !appSecret) throw new Error('Lark appId and appSecret are required')
  const base = resolveBaseUrl({ domain, baseUrl })
  const key = tokenKey(base, appId, appSecret)
  const hit = tokenCache.get(key)
  if (!force && hit) {
    if (hit.pending) return hit.pending
    if (hit.expiresAt > Date.now()) return hit.token
  }
  const pending = (async () => {
    const json = await rawRequest(base, '/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: { app_id: appId, app_secret: appSecret },
      signal,
    })
    const token = json.tenant_access_token
    if (!token) throw larkError('/open-apis/auth/v3/tenant_access_token/internal', { msg: 'no tenant_access_token in response' })
    const expireSec = Number(json.expire) || 7200
    tokenCache.set(key, { token, expiresAt: Date.now() + Math.max(0, expireSec - 60) * 1000 })
    return token
  })()
  tokenCache.set(key, { pending })
  try {
    return await pending
  } catch (e) {
    if (tokenCache.get(key)?.pending === pending) tokenCache.delete(key)
    throw e
  }
}

/** Drop cached tenant tokens (all, or for one app). Mostly for tests. */
export function clearTenantTokenCache(appId) {
  if (!appId) return tokenCache.clear()
  for (const k of tokenCache.keys()) if (k.split('|')[1] === appId) tokenCache.delete(k)
}

/** Authenticated OpenAPI call; retries once with a fresh token on token-invalid codes. */
export async function larkApi(opts, path, { method = 'GET', body, signal } = {}) {
  const base = resolveBaseUrl(opts)
  const call = async (force) => {
    const token = await getTenantToken({ ...opts, signal: signal || opts.signal, force })
    return rawRequest(base, path, { method, token, body, signal: signal || opts.signal })
  }
  try {
    return await call(false)
  } catch (e) {
    if (TOKEN_INVALID_CODES.has(e.code)) return call(true)
    throw e
  }
}

const enc = encodeURIComponent

/**
 * replyMessage({ appId, appSecret, domain, baseUrl?, messageId, card, inThread = false, uuid? })
 * → Promise<string> reply message_id. Throws Error (err.code = Lark code) on failure.
 */
export async function replyMessage({ messageId, card, inThread = false, uuid, ...opts }) {
  if (!messageId) throw new Error('messageId is required')
  const body = { msg_type: 'interactive', content: typeof card === 'string' ? card : JSON.stringify(card), reply_in_thread: !!inThread }
  if (uuid) body.uuid = uuid
  const json = await larkApi(opts, `/open-apis/im/v1/messages/${enc(messageId)}/reply`, { method: 'POST', body })
  return json.data?.message_id
}

/** replyText({ …, messageId, text, inThread = false }) → Promise<string> reply message_id. */
export async function replyText({ messageId, text, inThread = false, uuid, ...opts }) {
  if (!messageId) throw new Error('messageId is required')
  const body = { msg_type: 'text', content: JSON.stringify({ text: String(text ?? '') }), reply_in_thread: !!inThread }
  if (uuid) body.uuid = uuid
  const json = await larkApi(opts, `/open-apis/im/v1/messages/${enc(messageId)}/reply`, { method: 'POST', body })
  return json.data?.message_id
}

/**
 * sendText({ …, chatId, text }) → Promise<string> message_id. Sends a new text
 * message to a chat. If only `messageId` is given it behaves like replyText.
 */
export async function sendText({ chatId, messageId, text, uuid, ...opts }) {
  if (!chatId && messageId) return replyText({ messageId, text, uuid, ...opts })
  if (!chatId) throw new Error('chatId (or messageId) is required')
  const body = { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: String(text ?? '') }) }
  if (uuid) body.uuid = uuid
  const json = await larkApi(opts, '/open-apis/im/v1/messages?receive_id_type=chat_id', { method: 'POST', body })
  return json.data?.message_id
}

/** sendCard({ …, chatId, card }) → Promise<string> message_id (new interactive message in a chat). */
export async function sendCard({ chatId, card, uuid, ...opts }) {
  if (!chatId) throw new Error('chatId is required')
  const body = { receive_id: chatId, msg_type: 'interactive', content: typeof card === 'string' ? card : JSON.stringify(card) }
  if (uuid) body.uuid = uuid
  const json = await larkApi(opts, '/open-apis/im/v1/messages?receive_id_type=chat_id', { method: 'POST', body })
  return json.data?.message_id
}

/**
 * updateCard({ …, messageId, card }) → Promise<void>. PATCH an interactive
 * message previously sent by this bot (e.g. replace "正在查询…" with the result).
 * The card must contain `config.update_multi: true` to be updatable for everyone.
 */
export async function updateCard({ messageId, card, ...opts }) {
  if (!messageId) throw new Error('messageId is required')
  await larkApi(opts, `/open-apis/im/v1/messages/${enc(messageId)}`, {
    method: 'PATCH',
    body: { content: typeof card === 'string' ? card : JSON.stringify(card) },
  })
}

/** addReaction({ …, messageId, emojiType }) → Promise<string|null> reaction_id. Best effort, never throws. */
export async function addReaction({ messageId, emojiType, logger, ...opts }) {
  try {
    const json = await larkApi(opts, `/open-apis/im/v1/messages/${enc(messageId)}/reactions`, {
      method: 'POST',
      body: { reaction_type: { emoji_type: emojiType } },
    })
    return json.data?.reaction_id ?? null
  } catch (e) {
    logger?.debug?.(`[lark] addReaction ${emojiType} failed: ${e.message}`)
    return null
  }
}

/** getChatInfo({ …, chatId }) → Promise<{ name? }>. Best effort ({} on failure). */
export async function getChatInfo({ chatId, logger, ...opts }) {
  try {
    const json = await larkApi(opts, `/open-apis/im/v1/chats/${enc(chatId)}`)
    const d = json.data || {}
    return d.name !== undefined ? { name: d.name } : {}
  } catch (e) {
    logger?.debug?.(`[lark] getChatInfo failed: ${e.message}`)
    return {}
  }
}

/** getUserInfo({ …, openId }) → Promise<{ name?, email? }>. Needs contact permission; {} on failure. */
export async function getUserInfo({ openId, logger, ...opts }) {
  try {
    const json = await larkApi(opts, `/open-apis/contact/v3/users/${enc(openId)}?user_id_type=open_id`)
    const u = json.data?.user || {}
    const out = {}
    if (u.name) out.name = u.name
    if (u.email || u.enterprise_email) out.email = u.email || u.enterprise_email
    return out
  } catch (e) {
    logger?.debug?.(`[lark] getUserInfo failed: ${e.message}`)
    return {}
  }
}

/** getBotInfo({ … }) → Promise<{ openId, name }>. Throws on failure. */
export async function getBotInfo(opts) {
  const json = await larkApi(opts, '/open-apis/bot/v3/info')
  const bot = json.bot || json.data?.bot || {}
  return { openId: bot.open_id, name: bot.app_name }
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

const MENTION_RE = /@_user_\d+/g

function stripMentions(s) {
  return String(s ?? '').replace(MENTION_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim()
}

function postToText(content) {
  if (!content || typeof content !== 'object') return ''
  // Received posts are { title, content: [[el…]…] }; tolerate the send-side
  // locale wrapper { zh_cn: { title, content } } too.
  let post = content
  if (!Array.isArray(post.content)) {
    const inner = Object.values(content).find((v) => v && typeof v === 'object' && Array.isArray(v.content))
    if (!inner) return ''
    post = inner
  }
  const lines = []
  if (post.title) lines.push(String(post.title))
  for (const line of post.content) {
    if (!Array.isArray(line)) continue
    let s = ''
    for (const el of line) {
      if (!el || typeof el !== 'object') continue
      if (el.tag === 'text' || el.tag === 'a' || el.tag === 'md' || el.tag === 'code_block') s += el.text ?? ''
      else if (el.tag === 'at') s += el.text ?? el.user_id ?? '' // placeholder (@_user_N) is stripped below
    }
    lines.push(s)
  }
  return stripMentions(lines.join('\n')).replace(/\n{3,}/g, '\n\n')
}

/**
 * normalizeMessageEvent(data, { botOpenId? }) → normalized message | null
 * `data` may be the flattened object the SDK EventDispatcher passes to handlers
 * ({ message, sender, event_id, … }) or a raw v2 envelope ({ schema, header, event }).
 * Returns null for events that must be ignored (sent by a bot/app, malformed).
 */
export function normalizeMessageEvent(data, { botOpenId } = {}) {
  const ev = data && data.event && !data.message ? data.event : data
  const message = ev?.message
  const sender = ev?.sender
  if (!message || !message.message_id) return null
  if (sender && (sender.sender_type === 'app' || sender.sender_type === 'bot')) return null

  const mentions = (Array.isArray(message.mentions) ? message.mentions : []).map((m) => {
    const openId = m?.id?.open_id
    const isBot = botOpenId ? openId === botOpenId : m?.mentioned_type === 'bot'
    return { key: m?.key, name: m?.name, openId, userId: m?.id?.user_id, unionId: m?.id?.union_id, isBot: !!isBot }
  })

  let content = {}
  try { content = typeof message.content === 'string' ? JSON.parse(message.content) : (message.content || {}) } catch { content = {} }

  const messageType = message.message_type
  let text = ''
  if (messageType === 'text') text = stripMentions(content.text)
  else if (messageType === 'post') text = postToText(content)

  const chatType = message.chat_type === 'p2p' ? 'p2p' : 'group'
  const sid = sender?.sender_id || {}
  const out = {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType,
    messageType,
    text,
    mentionedBot: chatType === 'p2p' || mentions.some((m) => m.isBot),
    mentions,
    sender: { openId: sid.open_id, userId: sid.user_id, unionId: sid.union_id },
    rootId: message.root_id || undefined,
    parentId: message.parent_id || undefined,
    threadId: message.thread_id || undefined,
    createTime: message.create_time ? Number(message.create_time) : undefined,
    eventId: data?.event_id ?? data?.header?.event_id,
  }
  return out
}

/**
 * normalizeCardActionEvent(data) → normalized card callback | null
 * `card.action.trigger` (card JSON 2.0 callback) as delivered over the long
 * connection: the SDK EventDispatcher flattens { schema, header, event } into
 * one object; a raw envelope is accepted too. Message/chat ids live under
 * `event.context` (older surfaces put them at the root).
 * Everything here comes from the client and is untrusted: `value`, `option`
 * and `formValue` must only be used as lookup keys, never for authorization.
 */
export function normalizeCardActionEvent(data) {
  if (!data || typeof data !== 'object') return null
  const ev = data.event && !data.action ? data.event : data
  const header = data.header ?? data
  const op = ev?.operator
  const action = ev?.action
  if (!op?.open_id || !action || typeof action !== 'object') return null
  let value = action.value
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { /* keep string */ } }
  const ctx = ev.context ?? {}
  return {
    eventId: header.event_id ?? data.event_id,
    operator: { openId: op.open_id, userId: op.user_id || undefined, unionId: op.union_id || undefined, name: op.name || undefined },
    tag: action.tag ?? 'unknown',
    name: action.name || undefined,
    value: value && typeof value === 'object' && !Array.isArray(value) ? value : (value === undefined ? {} : { raw: value }),
    option: typeof action.option === 'string' ? action.option : undefined,
    options: Array.isArray(action.options) ? action.options.map(String) : undefined,
    formValue: action.form_value && typeof action.form_value === 'object' ? action.form_value : undefined,
    inputValue: typeof action.input_value === 'string' ? action.input_value : undefined,
    messageId: ctx.open_message_id ?? ev.open_message_id,
    chatId: ctx.open_chat_id ?? ev.open_chat_id,
    host: ev.host,
  }
}

/** createDedupe(max = 500) → (id) => boolean  (true = first time seen, false = duplicate). LRU. */
export function createDedupe(max = 500) {
  const seen = new Map()
  return (id) => {
    if (!id) return true
    if (seen.has(id)) {
      seen.delete(id)
      seen.set(id, true)
      return false
    }
    seen.set(id, true)
    if (seen.size > max) seen.delete(seen.keys().next().value)
    return true
  }
}

// ---------------------------------------------------------------------------
// Bot (WebSocket long connection)
// ---------------------------------------------------------------------------

const LEVELS = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 }

function fmtArgs(args) {
  const flat = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
  return flat.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ')
}

let sdkPromise
function loadSdk() {
  sdkPromise ??= import('@larksuiteoapi/node-sdk').then((m) => (m.WSClient ? m : m.default))
  return sdkPromise
}

/**
 * createLarkBot({ appId, appSecret, domain: 'feishu'|'lark', onMessage, onStatus, logger, logLevel = 'warn', baseUrl? })
 * → { start(): Promise<void>, stop(): Promise<void>, status(): Status, botInfo(): { openId?, name? } }
 *
 * Status: { state: 'idle'|'connecting'|'connected'|'error'|'stopped', error?, since, lastEventAt? }
 *
 * start() never rejects: it resolves once the first connection attempt has
 * settled (connected, or failed → state 'error'). The SDK keeps retrying
 * transient (network) failures in the background; credential/config failures
 * are terminal until start() is called again.
 */
export function createLarkBot({ appId, appSecret, domain = 'feishu', onMessage, onCardAction, onStatus, logger, logLevel = 'warn', baseUrl, cardActionTimeoutMs = CARD_ACTION_TIMEOUT_MS } = {}) {
  const log = {
    error: (m) => logger?.error?.(m),
    warn: (m) => logger?.warn?.(m),
    info: (m) => logger?.info?.(m),
    debug: (m) => logger?.debug?.(m),
  }
  const http = { appId, appSecret, domain, baseUrl }
  const dedupe = createDedupe(500)
  const cardDedupe = createDedupe(500)
  let st = { state: 'idle', since: Date.now() }
  let lastEventAt
  let wsClient = null
  let abort = null
  let gen = 0
  let starting = null
  let settleFirst = null
  let bot = {}

  function setStatus(state, error) {
    if (st.state === state && st.error === error) return
    st = { state, since: Date.now(), ...(error ? { error } : {}) }
    try { onStatus?.(status()) } catch (e) { log.error(`[lark] onStatus threw: ${e?.message || e}`) }
  }
  function status() {
    return { ...st, ...(lastEventAt ? { lastEventAt } : {}) }
  }

  const userLevel = LEVELS[logLevel] ?? LEVELS.warn
  function sdkLogger(myGen) {
    // The SDK calls logger.<level>(argsArray). Errors logged while (re)connecting
    // are the only signal for retryable failures, so surface them in status.
    const forward = (level) => (...args) => {
      if (LEVELS[level] > userLevel && level !== 'error') return
      const msg = `[lark-sdk] ${fmtArgs(args)}`
      if (level === 'error') {
        if (myGen === gen && (st.state === 'connecting' || st.state === 'error') && /\[ws\]/.test(msg) && !/discarded socket/.test(msg)) {
          const reason = msg.replace(/^\[lark-sdk\]\s*\[ws\]\s*/, '')
          if (reason !== 'connect failed' || !st.error) setStatus('error', `Lark long connection failed: ${reason} (retrying)`)
          settleFirst?.()
        }
        if (userLevel >= LEVELS.error) log.error(msg)
      } else if (level === 'warn') log.warn(msg)
      else if (level === 'info') log.info(msg)
      else log.debug(msg)
    }
    return { error: forward('error'), warn: forward('warn'), info: forward('info'), debug: forward('debug'), trace: forward('trace') }
  }

  function handleEvent(data) {
    // Must return quickly: the SDK acks the frame after this resolves.
    try {
      lastEventAt = Date.now()
      const msg = normalizeMessageEvent(data, { botOpenId: bot.openId })
      if (!msg) return
      if (!dedupe(msg.messageId)) {
        log.debug(`[lark] duplicate event for ${msg.messageId} ignored`)
        return
      }
      if (!onMessage) return
      Promise.resolve()
        .then(() => onMessage(msg))
        .catch((e) => log.error(`[lark] onMessage handler failed: ${e?.stack || e?.message || e}`))
    } catch (e) {
      log.error(`[lark] failed to handle im.message.receive_v1: ${e?.message || e}`)
    }
  }

  /**
   * card.action.trigger: the value returned here is what the SDK sends back
   * as the callback response (WSClient.handleEventData base64-encodes the
   * handler result into the ack frame). Feishu needs it within 3 s, so the
   * handler is raced against a timeout and falls back to a neutral toast.
   */
  async function handleCardAction(data) {
    lastEventAt = Date.now()
    let evt
    try { evt = normalizeCardActionEvent(data) } catch (e) { log.error(`[lark] bad card.action.trigger: ${e?.message || e}`) }
    if (!evt) return undefined
    if (evt.eventId && !cardDedupe(evt.eventId)) return { toast: { type: 'info', content: '已收到，正在处理…' } }
    if (!onCardAction) return undefined
    let timer
    try {
      const res = await Promise.race([
        Promise.resolve().then(() => onCardAction(evt)),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ toast: { type: 'info', content: '已收到，正在处理…' } }), cardActionTimeoutMs) }),
      ])
      return res ?? undefined
    } catch (e) {
      log.error(`[lark] onCardAction handler failed: ${e?.stack || e?.message || e}`)
      return { toast: { type: 'error', content: '处理失败，请稍后重试' } }
    } finally {
      clearTimeout(timer)
    }
  }

  async function doStart(myGen) {
    setStatus('connecting')
    if (!appId || !appSecret) return setStatus('error', 'Lark App ID and App Secret are required')
    if (!APP_ID_RE.test(appId)) return setStatus('error', `Invalid Lark App ID "${appId}" (expected cli_ followed by 16 hex chars)`)
    abort = new AbortController()
    const signal = abort.signal
    try {
      // Validates credentials with a readable error before opening the socket.
      await getTenantToken({ ...http, signal })
    } catch (e) {
      if (myGen !== gen) return
      return setStatus('error', `Lark credentials check failed: ${e.message}`)
    }
    if (myGen !== gen) return
    try {
      bot = await getBotInfo({ ...http, signal })
      if (!bot.openId) log.warn('[lark] bot info has no open_id; @bot detection falls back to mentioned_type')
    } catch (e) {
      if (myGen !== gen) return
      log.warn(`[lark] could not fetch bot info (is the bot capability enabled?): ${e.message}`)
    }
    if (myGen !== gen) return

    let lark
    try {
      lark = await loadSdk()
    } catch (e) {
      return setStatus('error', `Failed to load @larksuiteoapi/node-sdk: ${e?.message || e}`)
    }
    if (myGen !== gen) return

    // The SDK must always emit errors to us (they drive status); we filter by userLevel.
    const level = Math.max(userLevel, LEVELS.error)
    const sdkLog = sdkLogger(myGen)
    const firstSettled = new Promise((resolve) => { settleFirst = resolve })
    let client
    try {
      const params = {
        appId,
        appSecret,
        domain: baseUrl || (domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu),
        loggerLevel: level,
        logger: sdkLog,
        autoReconnect: true,
        handshakeTimeoutMs: DEFAULT_TIMEOUT_MS,
        source: 'dsh-nl2sql',
        onReady: () => { if (myGen === gen) { setStatus('connected'); settleFirst?.() } },
        onReconnecting: () => { if (myGen === gen) setStatus('connecting') },
        onReconnected: () => { if (myGen === gen) setStatus('connected') },
        onError: (err) => { if (myGen === gen) { setStatus('error', `Lark long connection failed: ${err?.message || err}`); settleFirst?.() } },
      }
      client = new lark.WSClient(params)
      const dispatcher = new lark.EventDispatcher({ loggerLevel: level, logger: sdkLog }).register({
        'im.message.receive_v1': (data) => { handleEvent(data) },
        // Card callbacks arrive over the same long connection as event frames
        // whose header.event_type is card.action.trigger (requires subscribing to
        // the callback in the developer console, long-connection mode).
        'card.action.trigger': (data) => handleCardAction(data),
      })
      wsClient = client
      await client.start({ eventDispatcher: dispatcher })
    } catch (e) {
      if (client) { try { client.close({ force: true }) } catch {} }
      if (wsClient === client) wsClient = null
      if (myGen === gen) setStatus('error', `Failed to start Lark long connection: ${e?.message || e}`)
      return
    }
    await firstSettled
    settleFirst = null
  }

  function start() {
    if (starting) return starting
    if (wsClient && (st.state === 'connected' || st.state === 'connecting')) return Promise.resolve()
    if (wsClient) closeClient()
    const myGen = ++gen
    starting = doStart(myGen)
      .catch((e) => { if (myGen === gen) setStatus('error', `Lark bot start failed: ${e?.message || e}`) })
      .finally(() => { if (myGen === gen) starting = null })
    return starting
  }

  function closeClient() {
    const c = wsClient
    wsClient = null
    if (c) {
      // close({ force: true }) sets the SDK's `closed` flag, bumps its reconnect
      // generation, clears ping/reconnect/liveness timers and the fragment-cache
      // interval, and terminates the socket immediately (no 30s close handshake).
      try { c.close({ force: true }) } catch (e) { log.debug(`[lark] close failed: ${e?.message || e}`) }
    }
  }

  async function stop() {
    gen++
    starting = null
    abort?.abort()
    abort = null
    settleFirst?.()
    settleFirst = null
    closeClient()
    setStatus('stopped')
  }

  return { start, stop, status, botInfo: () => ({ ...bot }) }
}

// ===========================================================================
// Push: signing, tokens, image upload, errors
// ===========================================================================

export const RECEIVE_ID_TYPES = ['chat_id', 'open_id', 'user_id', 'union_id', 'email']
const WEBHOOK_RE = /^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[\w-]+$/

function hostFor(channel) {
  return resolveBaseUrl({ domain: channel.domain, baseUrl: channel.baseUrl })
}

function postJson(url, body, headers = {}, timeoutMs = 15000) {
  return request(url, { method: 'POST', headers, json: body, timeoutMs, label: '飞书' })
}

/** Custom-bot signature: HMAC-SHA256 keyed by `${timestamp}\n${secret}` over an empty message, base64. */
export function larkSign(secret, timestamp) {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

/** A Lark JSON error response as a ChannelError with a Chinese hint. Codes stay `im/lark-<code>` for compatibility. */
export function larkPushError(json, status) {
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
  return new ChannelError(`im/lark-${code ?? status}`, `${hints[code] ? `${hints[code]}（${msg}）` : `飞书返回错误 ${code ?? status}：${msg}`}`)
}

async function pushToken(channel, secrets) {
  if (!channel.appId || !secrets.appSecret) throw new ChannelError('im/config', '缺少 App ID 或 App Secret')
  try {
    return await getTenantToken({ appId: channel.appId, appSecret: secrets.appSecret, domain: channel.domain, baseUrl: channel.baseUrl })
  } catch (error) {
    if (error instanceof ChannelError) throw error
    if (typeof error.code === 'number') throw larkPushError({ code: error.code, msg: error.larkMsg }, error.status)
    throw new ChannelError('channel/network', `无法访问飞书接口：${error.message}`)
  }
}

async function uploadImage(channel, secrets, png) {
  const token = await pushToken(channel, secrets)
  const form = new FormData()
  form.set('image_type', 'message')
  form.set('image', new Blob([png], { type: 'image/png' }), 'chart.png')
  const { status, json } = await request(`${hostFor(channel)}/open-apis/im/v1/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, timeoutMs: 30000, label: '飞书' })
  if (json.code !== 0) throw larkPushError(json, status)
  return json.data.image_key
}

/** Upload a file (≤ 30 MB) for a file message; returns file_key. https://open.feishu.cn/document/server-docs/im-v1/file/create */
async function uploadFile(channel, secrets, buf, fileName, fileType = 'xls') {
  const token = await pushToken(channel, secrets)
  const form = new FormData()
  form.set('file_type', fileType)
  form.set('file_name', fileName)
  form.set('file', new Blob([buf], { type: 'application/octet-stream' }), fileName)
  const { status, json } = await request(`${hostFor(channel)}/open-apis/im/v1/files`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, timeoutMs: 60000, label: '飞书' })
  if (json.code !== 0) throw larkPushError(json, status)
  return json.data.file_key
}

// ===========================================================================
// Cards (JSON 2.0)
// ===========================================================================

const CARD_LIMIT = 28000

function tableElement(result, maxRows) {
  const cols = result.columns.slice(0, 8)
  return {
    tag: 'table',
    // page_size is 1..10 per the card spec; more rows are paged in the client.
    page_size: Math.min(10, Math.max(1, Math.min(maxRows, result.rows.length))),
    row_height: 'low',
    header_style: { background_style: 'grey', bold: true, text_size: 'normal' },
    columns: cols.map((c, i) => ({ name: `c${i}`, display_name: c.name, data_type: c.kind === 'number' ? 'number' : 'text', ...(c.kind === 'number' ? { format: { separator: true } } : {}), width: 'auto' })),
    rows: result.rows.slice(0, maxRows).map(r => Object.fromEntries(cols.map((c, i) => [`c${i}`, c.kind === 'number' && Number.isFinite(Number(r[i])) ? Number(r[i]) : cellText(r[i])]))),
  }
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

/** Split Markdown into card elements: text stays Markdown; large tables become table components. */
export function markdownElements(md) {
  const text = String(md ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const out = []
  let last = 0
  let mdTables = 0
  // Feishu markdown tables show at most five rows per page and four tables per
  // component; bigger tables become table components instead.
  for (const m of text.matchAll(MD_TABLE)) {
    const block = m[2]
    const start = m.index + m[1].length
    const table = parseMdTable(block)
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
 * Interactive controls under one result (card JSON 2.0, callback behaviors).
 * spec (ActionSpec): { buttons?: [{ text, value, type? }], select?: { placeholder, value, options: [{ text, value }] } }
 * `value` objects are echoed back verbatim in card.action.trigger: keep them
 * opaque (a short token) — the receiver must not trust them.
 */
export function actionElement(spec) {
  const items = []
  const plain = (s, n = 40) => ({ tag: 'plain_text', content: String(s ?? '').slice(0, n) })
  if (spec?.select?.options?.length) {
    items.push({
      tag: 'select_static',
      placeholder: plain(spec.select.placeholder),
      width: 'default',
      options: spec.select.options.slice(0, 10).map(o => ({ text: plain(o.text, 60), value: String(o.value).slice(0, 64) })),
      behaviors: [{ type: 'callback', value: spec.select.value }],
    })
  }
  for (const b of spec?.buttons ?? []) {
    items.push({ tag: 'button', text: plain(b.text, 20), type: b.type ?? 'default', size: 'small', behaviors: [{ type: 'callback', value: b.value }] })
  }
  if (!items.length) return undefined
  return { tag: 'column_set', flex_mode: 'flow', horizontal_spacing: 'small', columns: items.map(el => ({ tag: 'column', width: 'auto', vertical_align: 'center', elements: [el] })) }
}

/**
 * Build a JSON 2.0 card from an OutboundMessage.
 * Results may carry `imageKey` (uploaded PNG) and `actions` (ActionSpec; legacy name `cardActions`).
 */
export function buildCard(message, { maxRows = 50, charts = true, actions = true } = {}) {
  const elements = [...markdownElements(message.text)]
  let tables = elements.filter(e => e.tag === 'table').length
  let chartCount = 0
  for (const r of message.results ?? []) {
    if (elements.length) elements.push({ tag: 'hr' })
    if (r.error) {
      elements.push({ tag: 'markdown', content: `**${r.title || '查询'}**\n<font color='red'>${r.error}</font>` })
      continue
    }
    elements.push({ tag: 'markdown', content: [`**${r.title || '查询结果'}**`, `<font color='grey'>${resultMeta(r)}</font>`].join('  ') })
    const nativeChart = charts && chartCount < 5 && chartable(r) ? chartElement(r) : undefined
    if (r.rows.length === 0) {
      elements.push({ tag: 'markdown', content: '<font color=\'grey\'>无数据</font>' })
    } else if (isKpi(r)) {
      elements.push({ tag: 'markdown', content: kpiText(r) })
    } else if (nativeChart) {
      elements.push(nativeChart)
      chartCount++
    } else if (r.imageKey) {
      elements.push({ tag: 'img', img_key: r.imageKey, alt: { tag: 'plain_text', content: r.title || 'chart' }, scale_type: 'fit_horizontal', preview: true })
    } else if (tables < 5) {
      elements.push(tableElement(r, maxRows))
      tables++
      const note = omittedNote(r, Math.min(maxRows, r.rows.length), { attached: Boolean(r.attached) })
      if (note) elements.push({ tag: 'markdown', content: `<font color='grey'>${note}</font>`, text_size: 'notation' })
    } else {
      elements.push({ tag: 'markdown', content: r.rows.slice(0, 5).map(row => row.slice(0, 6).map(v => cellText(v)).join(' | ')).join('\n') })
      const note = omittedNote(r, Math.min(5, r.rows.length), { attached: Boolean(r.attached) })
      if (note) elements.push({ tag: 'markdown', content: `<font color='grey'>${note}</font>`, text_size: 'notation' })
    }
    const spec = r.actions ?? r.cardActions
    if (spec && actions) {
      const el = actionElement(spec)
      if (el) elements.push(el)
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
  if (size > CARD_LIMIT && maxRows > 5) return buildCard(message, { maxRows: Math.max(5, Math.floor(maxRows / 2)), charts, actions })
  if (size > CARD_LIMIT && charts) return buildCard(message, { maxRows, charts: false, actions })
  if (size > CARD_LIMIT) {
    card.body.elements = elements.filter(e => e.tag !== 'table')
    card.body.elements.push({ tag: 'markdown', content: '<font color=\'grey\'>（数据过多，表格已省略）</font>' })
  }
  return card
}

/** JSON 1.0 fallback: lark_md only, for bots/clients rejecting 2.0 components. */
export function legacyCard(card) {
  const md = card.body.elements.map(e => {
    if (e.tag === 'markdown') return e.content
    if (e.tag === 'hr') return '---'
    if (e.tag === 'table') return [e.columns.map(c => c.display_name).join(' | '), ...e.rows.slice(0, 10).map(r => e.columns.map(c => cellText(r[c.name])).join(' | '))].join('\n')
    if (e.tag === 'chart') {
      const v = e.chart_spec.data?.values ?? e.chart_spec.data?.[0]?.values ?? []
      return v.slice(0, 10).map(x => Object.values(x).map(y => cellText(y)).join(' | ')).join('\n')
    }
    return ''
  }).filter(Boolean).join('\n\n')
  return { config: { wide_screen_mode: true }, header: card.header, elements: [{ tag: 'markdown', content: md.slice(0, 20000) }] }
}

// ===========================================================================
// Send
// ===========================================================================

/**
 * Send an OutboundMessage to a Lark channel.
 * @param channel - { type: 'lark_webhook'|'lark_app', domain, appId, receiveIdType, receiveId, baseUrl? }
 * @param secrets - { webhookUrl, signSecret, appSecret }
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
        if (error instanceof ChannelError && /99991672|234007/.test(error.code)) throw error
      }
    }
    results.push(r)
  }
  if (channel.type === 'lark_app' && message.attachment?.buffer) for (let i = 0; i < results.length; i++) if (message.attachment.resultIndexes?.includes(i)) results[i] = { ...results[i], attached: true }
  const card = buildCard({ ...message, results }, { charts: message.chartMode !== 'image' && message.chartMode !== 'table' })
  if (channel.type === 'lark_webhook') {
    if (!secrets.webhookUrl) throw new ChannelError('im/config', '缺少 Webhook 地址')
    const url = secrets.webhookUrl
    if (!WEBHOOK_RE.test(url) && !channel.baseUrl) throw new ChannelError('im/config', 'Webhook 地址格式不正确，应为 https://open.feishu.cn/open-apis/bot/v2/hook/… 或 open.larksuite.com')
    const send = async (c) => {
      const timestamp = String(Math.floor(Date.now() / 1000))
      const body = { msg_type: 'interactive', card: c, ...(secrets.signSecret ? { timestamp, sign: larkSign(secrets.signSecret, timestamp) } : {}) }
      return postJson(url, body)
    }
    const fatal = [19021, 19022, 19024, 11232]
    const codeOf = (json) => json?.code ?? json?.StatusCode
    let { status, json } = await send(card)
    if (codeOf(json) !== 0 && !fatal.includes(codeOf(json)) && card.body.elements.some(e => e.tag === 'chart')) ({ status, json } = await send(buildCard({ ...message, results }, { charts: false })))
    if (codeOf(json) !== 0 && !fatal.includes(codeOf(json))) ({ status, json } = await send(legacyCard(card)))
    if (codeOf(json) !== 0) throw larkPushError(json, status)
    return { images }
  }
  if (channel.type === 'lark_app') {
    if (!channel.receiveId) throw new ChannelError('im/config', '缺少接收者 ID')
    const token = await pushToken(channel, secrets)
    const type = RECEIVE_ID_TYPES.includes(channel.receiveIdType) ? channel.receiveIdType : 'chat_id'
    const url = `${hostFor(channel)}/open-apis/im/v1/messages?receive_id_type=${type}`
    const send = (c) => postJson(url, { receive_id: channel.receiveId, msg_type: 'interactive', content: JSON.stringify(c) }, { authorization: `Bearer ${token}` })
    const fatal = [230002, 230001, 230013, 99991672, 99991663]
    let { status, json } = await send(card)
    if (json.code !== 0 && !fatal.includes(json.code) && card.body.elements.some(e => e.tag === 'chart')) ({ status, json } = await send(buildCard({ ...message, results }, { charts: false })))
    if (json.code !== 0 && !fatal.includes(json.code)) ({ status, json } = await send(legacyCard(card)))
    if (json.code !== 0) throw larkPushError(json, status)
    // Full data as an Excel file message after the card (app bots only; webhooks cannot send files).
    let files = 0
    if (message.attachment?.buffer) {
      try {
        const fileKey = await uploadFile(channel, secrets, message.attachment.buffer, message.attachment.fileName)
        const fr = await postJson(url, { receive_id: channel.receiveId, msg_type: 'file', content: JSON.stringify({ file_key: fileKey }) }, { authorization: `Bearer ${token}` })
        if (fr.json.code === 0) files++
        else message.attachmentError = larkPushError(fr.json, fr.status).message
      } catch (error) { message.attachmentError = error.message }
    }
    return { messageId: json.data?.message_id, images, files, ...(message.attachmentError ? { warning: `完整数据附件发送失败：${message.attachmentError}` } : {}) }
  }
  throw new ChannelError('im/config', `不支持的渠道类型：${channel.type}`)
}

/** Chats the app bot belongs to: [{ chatId, name, description }] (legacy shape). */
export async function listBotChats(channel, secrets) {
  const token = await pushToken(channel, secrets)
  const { status, json } = await request(`${hostFor(channel)}/open-apis/im/v1/chats?page_size=100`, { headers: { authorization: `Bearer ${token}` }, label: '飞书' })
  if (json.code !== 0) throw larkPushError(json, status)
  return (json.data?.items ?? []).map(c => ({ chatId: c.chat_id, name: c.name, description: c.description ?? '' }))
}

// ===========================================================================
// Bot: normalized Lark events → InboundMessage / InboundAction
// ===========================================================================

/**
 * Reply to a message with a card, falling back to no charts, then no buttons,
 * then plain text. Returns { messageId? } (never throws).
 */
export async function replyCard(creds, messageId, message) {
  const attempts = [{}, { charts: false }, { charts: false, actions: false }]
  let lastError
  for (const opts of attempts) {
    try { return { messageId: await replyMessage({ ...creds, messageId, card: buildCard(message, opts) }) } } catch (error) { lastError = error }
  }
  try { return { messageId: await replyText({ ...creds, messageId, text: String(message.text ?? '').slice(0, 3000) || `回复失败：${lastError?.message}` }) } } catch {}
  return {}
}

const REACTIONS = { working: 'OnIt', done: 'DONE', failed: 'CrossMark' }

/**
 * A normalized Lark message (normalizeMessageEvent) as an InboundMessage.
 * Sender name/email are looked up (best effort) only for messages addressed to the bot.
 * @param creds - { appId, appSecret, domain, baseUrl? }
 */
export async function toInboundMessage(m, creds, { channelId, lookup = true } = {}) {
  let user = {}
  if (lookup && m.mentionedBot && m.sender?.openId) { try { user = await getUserInfo({ ...creds, openId: m.sender.openId }) } catch {} }
  return {
    platform: 'lark',
    channelId,
    messageId: m.messageId,
    chatId: m.chatId,
    chatType: m.chatType === 'p2p' ? 'p2p' : 'group',
    text: m.text ?? '',
    mentionedBot: Boolean(m.mentionedBot),
    sender: { id: m.sender?.openId, ...(user.name ? { name: user.name } : {}), ...(user.email ? { email: user.email } : {}), ...(m.sender?.unionId ? { unionId: m.sender.unionId } : {}) },
    raw: m,
    reply: (message, opts = {}) => replyCard(creds, opts.replyTo ?? m.messageId, message),
    replyText: async (text) => { try { await replyText({ ...creds, messageId: m.messageId, text }) } catch {} },
    react: async (kind) => { await addReaction({ ...creds, messageId: m.messageId, emojiType: REACTIONS[kind] ?? kind }) },
    chatName: async () => (m.chatType === 'group' ? (await getChatInfo({ ...creds, chatId: m.chatId })).name : undefined),
  }
}

/** A normalized card callback (normalizeCardActionEvent) as an InboundAction. */
export async function toInboundAction(evt, creds, { channelId, lookupMs = 1200 } = {}) {
  let user = {}
  let timer
  try { user = await Promise.race([getUserInfo({ ...creds, openId: evt.operator.openId }), new Promise(r => { timer = setTimeout(() => r({}), lookupMs) })]) } catch {} finally { clearTimeout(timer) }
  const name = user.name ?? evt.operator.name
  return {
    platform: 'lark',
    channelId,
    operator: { id: evt.operator.openId, ...(name ? { name } : {}), ...(user.email ? { email: user.email } : {}) },
    chatId: evt.chatId,
    messageId: evt.messageId,
    value: evt.value,
    option: evt.option,
    raw: evt,
    reply: (message, opts = {}) => replyCard(creds, opts.replyTo ?? evt.messageId, message),
    replyText: async (text, opts = {}) => { try { await replyText({ ...creds, messageId: opts.replyTo ?? evt.messageId, text }) } catch {} },
  }
}

function credsOf(channel, secrets, opts = {}) {
  return { appId: channel.appId, appSecret: secrets.appSecret, domain: channel.domain === 'lark' ? 'lark' : 'feishu', ...(opts.baseUrl ?? channel.baseUrl ? { baseUrl: opts.baseUrl ?? channel.baseUrl } : {}) }
}

/**
 * Bot over the long connection for a lark_app channel.
 * handlers: { onMessage(InboundMessage), onAction?(InboundAction) → { toast } }
 */
export function createBot(channel, secrets, handlers = {}, opts = {}) {
  const creds = credsOf(channel, secrets, opts)
  const logger = opts.logger ?? { debug() {}, info() {}, warn: (...a) => console.warn('nl2sql lark:', ...a), error: (...a) => console.warn('nl2sql lark:', ...a) }
  const bot = createLarkBot({
    ...creds,
    logger,
    onMessage: async (m) => {
      // Group messages not addressed to the bot are dropped early (no user lookup).
      if (m.chatType === 'group' && !m.mentionedBot) return
      await handlers.onMessage?.(await toInboundMessage(m, creds, { channelId: channel.id }))
    },
    onCardAction: handlers.onAction ? async (evt) => handlers.onAction(await toInboundAction(evt, creds, { channelId: channel.id })) : undefined,
  })
  return {
    start: () => bot.start(),
    stop: () => bot.stop(),
    status: () => bot.status(),
    info: () => { const i = bot.botInfo(); return i.openId || i.name ? { id: i.openId, name: i.name } : null },
    creds,
  }
}

// ===========================================================================
// Adapter
// ===========================================================================

const DOMAIN_FIELD = { key: 'domain', label: { zh: '版本', en: 'Edition' }, type: 'select', options: [{ value: 'feishu', label: { zh: '飞书（中国）', en: 'Feishu (China)' } }, { value: 'lark', label: { zh: 'Lark（国际版）', en: 'Lark (international)' } }] }

const APP_SETUP = {
  zh: [
    '在开发者后台创建企业自建应用，记下 App ID / App Secret，并在这里添加为应用机器人渠道。',
    '「添加应用能力」开启机器人。',
    '「权限管理」开通：im:message、im:message.p2p_msg:readonly、im:message.group_at_msg:readonly、im:message:send_as_bot、im:resource、im:chat:readonly、contact:user.base:readonly（需要按邮箱识别成员时再加 contact:user.email:readonly）。',
    '在「机器人」中启用该渠道使长连接在线，然后到「事件与回调 → 事件配置」选择「使用长连接接收事件」并保存。',
    '添加事件「接收消息 v2.0（im.message.receive_v1）」，创建版本并发布。',
    '「事件与回调 → 回调配置」同样选择「使用长连接接收回调」，并添加回调「卡片回传交互（card.action.trigger）」，否则回答卡片上的「按维度拆分 / 为什么变化 / 明细 / 固定到看板」按钮点击无效。',
    '把机器人拉进群；群里需要 @机器人 才会响应。发送「帮助」查看命令（数据源、切换 <名称>、新对话）。',
  ],
  en: [
    'Create a custom app, note App ID / Secret, and add it here as an app bot channel.',
    'Enable the bot capability.',
    'Grant im:message, im:message.p2p_msg:readonly, im:message.group_at_msg:readonly, im:message:send_as_bot, im:resource, im:chat:readonly, contact:user.base:readonly (plus contact:user.email:readonly to match by email).',
    'Enable the bot for this channel so the long connection is online, then choose "Receive events through persistent connection" in Events & Callbacks.',
    'Subscribe to im.message.receive_v1, create and publish a version.',
    'In Events & Callbacks → Callback configuration, also choose the persistent connection and add the callback "card.action.trigger" (card interaction); otherwise the Breakdown / Why / Details / Pin buttons on answer cards do nothing.',
    'Add the bot to groups; @ it to ask. Send "help" for commands.',
  ],
}

const WEBHOOK_SETUP = {
  zh: [
    '在飞书群「设置 → 群机器人 → 添加机器人」中选择「自定义机器人」。',
    '复制 Webhook 地址填到这里；如开启了「签名校验」，把签名密钥一并填入。',
    '如设置了关键词校验，消息标题或正文需要包含该关键词。',
  ],
  en: [
    'In the Lark group: Settings → Bots → Add bot → Custom bot.',
    'Paste the webhook URL here; if signature verification is on, also paste the signing secret.',
    'If keyword verification is on, titles or bodies must contain the keyword.',
  ],
}

const str = (v, max = 300) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max))

export const kinds = [
  {
    id: 'lark_webhook',
    platform: 'lark',
    label: { zh: '飞书群机器人（Webhook）', en: 'Lark group bot (webhook)' },
    description: { zh: '群自定义机器人，粘贴 Webhook 地址即可推送；不能上传图片，不能接收消息。', en: 'Custom group bot: paste the webhook URL to push; no image upload, no inbound messages.' },
    fields: [
      { key: 'webhookUrl', label: { zh: 'Webhook 地址', en: 'Webhook URL' }, type: 'secret', secret: true, required: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', pattern: WEBHOOK_RE.source },
      { key: 'signSecret', label: { zh: '签名密钥', en: 'Signing secret' }, type: 'secret', secret: true, help: { zh: '机器人开启「签名校验」时填写', en: 'Only when signature verification is enabled' } },
    ],
    capabilities: { push: true, markdown: 'full', charts: 'native', chartModes: ['native', 'table'], tables: 'native', tableRows: 50, files: false, buttons: false, bot: false, listTargets: false, mentionAll: true, maxMessageBytes: 28000 },
    setupSteps: WEBHOOK_SETUP,
    validate(input, existing) {
      const config = {}
      const secrets = { ...(input.secrets ?? {}) }
      const url = str(secrets.webhookUrl, 500)
      if (url) {
        if (!WEBHOOK_RE.test(url)) throw new ChannelError('channel/config', 'Webhook 地址格式不正确，应为 https://open.feishu.cn/open-apis/bot/v2/hook/… （Lark 国际版为 open.larksuite.com）', { field: 'webhookUrl' })
        secrets.webhookUrl = url
        config.domain = url.includes('larksuite') ? 'lark' : 'feishu'
      } else {
        config.domain = input.config?.domain === 'lark' ? 'lark' : existing?.config?.domain ?? 'feishu'
      }
      if (typeof secrets.signSecret === 'string') secrets.signSecret = secrets.signSecret.trim() || null
      if (!secrets.webhookUrl) throw new ChannelError('channel/config', '请填写 Webhook 地址', { field: 'webhookUrl' })
      return { config, secrets }
    },
    send: (channel, secrets, message) => sendMessage({ ...channel, type: 'lark_webhook' }, secrets, message),
  },
  {
    id: 'lark_app',
    platform: 'lark',
    label: { zh: '飞书应用机器人', en: 'Lark app bot' },
    description: { zh: '企业自建应用（App ID / Secret）：推送到群、个人或邮箱，可上传图片；可开启机器人，在群里 @ 提问（长连接，无需公网地址），回答卡片带交互按钮。', en: 'Custom app (App ID / Secret): push to a chat, user or email, upload images; optional bot answering @ mentions over the long connection (no public URL) with interactive buttons.' },
    fields: [
      DOMAIN_FIELD,
      { key: 'appId', label: { zh: 'App ID', en: 'App ID' }, type: 'text', required: true, placeholder: 'cli_xxxxxxxxxxxxxxxx' },
      { key: 'appSecret', label: { zh: 'App Secret', en: 'App Secret' }, type: 'secret', secret: true, required: true },
      { key: 'receiveIdType', label: { zh: '接收者类型', en: 'Receiver type' }, type: 'select', options: [
        { value: 'chat_id', label: { zh: '群（chat_id）', en: 'Chat (chat_id)' } },
        { value: 'open_id', label: { zh: '用户（open_id）', en: 'User (open_id)' } },
        { value: 'user_id', label: { zh: '用户（user_id）', en: 'User (user_id)' } },
        { value: 'union_id', label: { zh: '用户（union_id）', en: 'User (union_id)' } },
        { value: 'email', label: { zh: '邮箱', en: 'Email' } },
      ] },
      { key: 'receiveId', label: { zh: '接收者 ID', en: 'Receiver ID' }, type: 'text', required: true, placeholder: 'oc_…', target: true, help: { zh: '推送目标；选择群时可点「列出群聊」', en: 'Push target; use "List chats" to pick a chat' } },
    ],
    capabilities: { push: true, markdown: 'full', charts: 'native', chartImages: true, chartModes: ['native', 'image', 'table'], tables: 'native', tableRows: 50, files: true, buttons: true, bot: true, listTargets: true, mentionAll: true, maxMessageBytes: 28000 },
    setupSteps: APP_SETUP,
    validate(input, existing) {
      const c = input.config ?? {}
      const config = {
        domain: c.domain === 'lark' ? 'lark' : c.domain === 'feishu' ? 'feishu' : existing?.config?.domain ?? 'feishu',
        appId: str(c.appId, 64),
        receiveIdType: RECEIVE_ID_TYPES.includes(c.receiveIdType) ? c.receiveIdType : c.receiveIdType ? (() => { throw new ChannelError('channel/config', `receiveIdType 必须是 ${RECEIVE_ID_TYPES.join(' / ')}`, { field: 'receiveIdType' }) })() : 'chat_id',
        receiveId: str(c.receiveId, 200),
      }
      if (!config.appId) throw new ChannelError('channel/config', '请填写 App ID', { field: 'appId' })
      if (!config.receiveId) throw new ChannelError('channel/config', '请填写接收者 ID', { field: 'receiveId' })
      const secrets = { ...(input.secrets ?? {}) }
      if (typeof secrets.appSecret === 'string') secrets.appSecret = secrets.appSecret.trim()
      if (!secrets.appSecret) throw new ChannelError('channel/config', '请填写 App Secret', { field: 'appSecret' })
      return { config, secrets }
    },
    send: (channel, secrets, message) => sendMessage({ ...channel, type: 'lark_app' }, secrets, message),
    /** Credentials check (tenant token + bot info); a test message follows when a receiver is set. */
    async test(channel, secrets) {
      await pushToken(channel, secrets)
      let bot = {}
      try { bot = await getBotInfo(credsOf(channel, secrets)) } catch {}
      return { ok: true, detail: `App 凭据有效${bot.name ? `（机器人：${bot.name}）` : ''}`, send: Boolean(channel.receiveId) }
    },
    async listTargets(channel, secrets) {
      return (await listBotChats(channel, secrets)).map(c => ({ id: c.chatId, name: c.name, type: 'group', description: c.description }))
    },
  },
]

export default {
  id: 'lark',
  name: { zh: '飞书 / Lark', en: 'Lark / Feishu' },
  kinds,
  createBot,
}
