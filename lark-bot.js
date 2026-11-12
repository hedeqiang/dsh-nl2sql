// Lark / Feishu inbound messages over the official long connection (WebSocket)
// plus small fetch-based OpenAPI helpers for replying.
//
// Inbound: @larksuiteoapi/node-sdk WSClient + EventDispatcher subscribed to
// `im.message.receive_v1` and the card callback `card.action.trigger`. No public
// URL is needed; the app must be configured with "使用长连接接收事件" (and the
// callback "卡片回传交互" in long-connection mode) in the developer console.
//
// Outbound helpers use plain `fetch` (no SDK) so they can be tested against a
// mock server through the optional `baseUrl` parameter.

import { createHash } from 'node:crypto'

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

export default createLarkBot
