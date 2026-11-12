/**
 * DingTalk 钉钉 channel adapter (platform 'dingtalk').
 *
 * Kinds:
 *   dingtalk_webhook  自定义机器人 webhook（可选加签）
 *   dingtalk_app      企业内部应用机器人 · Stream 模式
 *
 * Official documentation followed (read 2026-11; open.dingtalk.com pages are JS-rendered, the same
 * official docs are served as Markdown by the DingTalk Help Center):
 *   - 自定义机器人发送群消息: https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages
 *       (https://help.dingtalk.io/zh/open/development/custom-robots-send-group-messages.md)
 *       POST https://oapi.dingtalk.com/robot/send?access_token=…[&timestamp=&sign=]; msgtype text/markdown
 *       (title + text)/actionCard/link/feedCard; at.isAtAll; 20 msgs/min per robot (then throttled 10 min);
 *       errcode 310000 (keywords / invalid timestamp / sign not match / ip whitelist), 400101 token missing,
 *       400102 robot disabled, 410100 too fast, 430101-430104 content blocked.
 *   - 自定义机器人安全设置（加签）: https://open.dingtalk.com/document/robots/customize-robot-security-settings
 *       (https://help.dingtalk.io/zh/open/dingstart/customize-robot-security-settings.md)
 *       sign = urlEncode(base64(HMAC(SHA-256)(key=secret, msg=timestamp + "\n" + secret))), timestamp in ms, ±1 h.
 *   - 消息类型和数据格式: https://help.dingtalk.io/zh/open/development/robot-message-types-and-data-format.md
 *       Webhook markdown subset: headings, quote, bold, italic, links, images (URL), lists — NO tables;
 *       webhook cannot send image messages; API msgKeys sampleText / sampleMarkdown {title,text} / sampleActionCard…
 *   - 服务端 Stream 模式: https://open.dingtalk.com/document/resourcedownload/introduction-to-stream-mode
 *       topic /v1.0/im/bot/messages/get, card callback topic /v1.0/card/instances/callback
 *   - Stream 协议: https://open.dingtalk.com/document/direction/stream-mode-protocol-access-description
 *       (https://github.com/open-dingtalk/developerpedia/blob/main/docs/learn/stream/protocol.md)
 *       POST https://api.dingtalk.com/v1.0/gateway/connections/open {clientId, clientSecret, subscriptions, ua}
 *       → {endpoint, ticket} (ticket 90 s, single use); WebSocket `${endpoint}?ticket=…`;
 *       down frames {specVersion, type SYSTEM|EVENT|CALLBACK, headers{topic,messageId,…}, data: json string};
 *       ack {code:200, headers:{contentType:'application/json', messageId}, message:'OK', data:'{"response":null}'};
 *       SYSTEM ping → echo data (opaque); SYSTEM disconnect → server closes after 10 s → reconnect with new ticket.
 *   - Official Node SDK dingtalk-stream (https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs) was READ
 *     (not used) to confirm the same frame handling and exponential back-off with jitter.
 *   - 机器人接收消息 (fields): https://open.dingtalk.com/document/orgapp/receive-message
 *       (https://help.dingtalk.io/open/development/receive-message.md) conversationType "1" single / "2" group,
 *       isInAtList, senderStaffId, senderNick, sessionWebhook + sessionWebhookExpiredTime, robotCode, text.content.
 *   - 机器人回复/发送消息: https://help.dingtalk.io/zh/open/dingstart/robot-reply-and-send-messages.md
 *       (reply via sessionWebhook with the webhook message format)
 *   - 机器人发送群聊消息: https://help.dingtalk.io/zh/open/development/the-robot-sends-a-group-message.md
 *       POST https://api.dingtalk.com/v1.0/robot/groupMessages/send, header x-acs-dingtalk-access-token,
 *       {msgParam (json string ≤ 15000 bytes), msgKey, openConversationId, robotCode} → {processQueryKey}
 *   - 批量发送单聊消息: https://help.dingtalk.io/zh/open/development/chatbots-send-one-on-one-chat-messages-in-batches.md
 *       POST /v1.0/robot/oToMessages/batchSend {robotCode, userIds ≤ 20, msgKey, msgParam}
 *   - 获取企业内部应用的accessToken: https://help.dingtalk.io/zh/open/development/obtain-the-access-token-of-an-internal-app.md
 *       POST https://api.dingtalk.com/v1.0/oauth2/accessToken {appKey, appSecret} → {accessToken, expireIn: 7200}
 *
 * Not implemented: interactive cards (need a card template + /v1.0/card/instances/callback handling) →
 * buttons: false. Charts: webhook cannot upload images → tables as text (DingTalk markdown has no tables).
 */
import { createHmac } from 'node:crypto'
import { ChannelError, postJson, request } from './http.js'
import { resultMeta, isKpi, kpiText, fmtNum, cellText, defangMd, toPlainMarkdown, mentionsAll, splitText, MD_TABLE, parseMdTable } from './message.js'

export const OAPI = 'https://oapi.dingtalk.com'
export const API = 'https://api.dingtalk.com'
export const BOT_TOPIC = '/v1.0/im/bot/messages/get'
const MD_LIMIT = 15000 // msgParam limit for the robot API; webhook markdown has no documented limit → same budget
const UA = 'nl2sql-dsh/1.0'

const cfg = (channel, key) => channel?.[key] ?? channel?.config?.[key]

// --------------------------------------------------------------- signing

/** DingTalk custom robot signature: urlEncode(base64(HMAC(SHA-256)(secret, `${timestamp}\n${secret}`))). */
export function dingSign(secret, timestamp) {
  const b64 = createHmac('sha256', secret).update(`${timestamp}\n${secret}`, 'utf8').digest('base64')
  return encodeURIComponent(b64)
}

/** Webhook URL with timestamp + sign appended when a secret is configured. */
export function signedUrl(url, secret, now = Date.now()) {
  if (!secret) return url
  const ts = String(now)
  return `${url}&timestamp=${ts}&sign=${dingSign(secret, ts)}`
}

// ---------------------------------------------------------------- errors

const WEBHOOK_ERRORS = {
  310000: null, // decided by message
  400013: ['channel/rejected', '群已被解散'],
  400101: ['channel/auth', 'access_token 不存在：请检查 Webhook 地址是否完整'],
  400102: ['channel/rejected', '机器人已停用，请联系群管理员启用'],
  400105: ['channel/rejected', '不支持的消息类型'],
  400106: ['channel/rejected', '机器人不存在：请确认机器人仍在群中'],
  410100: ['channel/rate-limit', '发送太快被限流：每个机器人每分钟最多 20 条，超出后限流 10 分钟'],
  430101: ['channel/rejected', '消息含有不安全的外链'],
  430102: ['channel/rejected', '消息含有不合适的文本'],
  430103: ['channel/rejected', '消息含有不合适的图片'],
  430104: ['channel/rejected', '消息含有不合适的内容'],
  40035: ['channel/rejected', '缺少消息参数'],
  43004: ['channel/rejected', '无效的 Content-Type'],
}

export function dingWebhookError(json, status) {
  const code = Number(json?.errcode)
  const msg = String(json?.errmsg ?? json?.raw ?? '').slice(0, 300)
  let err
  if (code === 310000) {
    if (/keyword|关键词/i.test(msg)) err = new ChannelError('channel/dingtalk-keyword', '关键词校验失败：消息中不包含机器人安全设置里的自定义关键词（可在渠道标题中加入该关键词，或改用加签）')
    else if (/sign|签名/i.test(msg)) err = new ChannelError('channel/dingtalk-sign', '加签校验失败：签名不匹配，请检查加签密钥（SEC 开头）是否正确')
    else if (/timestamp/i.test(msg)) err = new ChannelError('channel/dingtalk-sign', '加签校验失败：timestamp 无效，请检查本机时间是否准确（误差需小于 1 小时）')
    else if (/ip|whitelist|白名单/i.test(msg)) err = new ChannelError('channel/rejected', 'IP 地址不在机器人安全设置的白名单中')
    else err = new ChannelError('channel/rejected', `钉钉安全设置校验失败：${msg}`)
  } else if (WEBHOOK_ERRORS[code]) {
    err = new ChannelError(...WEBHOOK_ERRORS[code])
  } else if (status >= 400 && Number.isNaN(code)) {
    err = new ChannelError('channel/network', `钉钉接口返回 HTTP ${status}`)
  } else {
    err = new ChannelError('channel/rejected', `钉钉返回错误（errcode ${json?.errcode ?? '?'}）：${msg || '未知错误'}`)
  }
  err.platformCode = json?.errcode
  return err
}

const API_ERRORS = {
  invalidClientIdOrSecret: ['channel/auth', 'Client ID（AppKey）或 Client Secret（AppSecret）不正确'],
  'invalidParameter.robotCode.auth': ['channel/auth', 'AppKey 与机器人 robotCode 不匹配，请使用机器人所属应用的凭证'],
  'invalidParameter.robotCode.notExsit': ['channel/config', '机器人不存在，请检查 robotCode'],
  'invalidParameter.robotCode.invalid': ['channel/config', '无效的 robotCode'],
  'invalidParameter.robotCode.empty': ['channel/rejected', '机器人不在该群中（robotCode 无效）'],
  'invalid.openConversationId': ['channel/config', '无效的群会话 ID（openConversationId）'],
  'miss.openConversationId': ['channel/config', '缺少群会话 ID（openConversationId）'],
  'group.disbanded': ['channel/rejected', '群已解散'],
  'bot.stopped': ['channel/rejected', '群机器人已停用'],
  'send.too.fast': ['channel/rate-limit', '发送过快被钉钉限流，请稍后再试'],
  'send.byToken.tooFast': ['channel/rate-limit', '发送过快被钉钉限流，请稍后再试'],
  'too.many.group': ['channel/rate-limit', '发送频繁被限流，请稍后再试'],
  'too.many.people': ['channel/rate-limit', '发送频繁被限流，请稍后再试'],
  'invalidParameter.msgParam.tooLong': ['channel/rejected', '消息内容太长'],
  'conversation.org.notMatch': ['channel/rejected', '会话不属于该企业，或应用无权操作该会话'],
  'resource.unavailable': ['channel/rejected', '资源不可用：机器人可能已停用或未添加到该群'],
  'session.expired': ['channel/rejected', '会话 Webhook 已过期'],
  'robot.oto.notExist': ['channel/rejected', '该用户与机器人之间没有单聊会话'],
  Forbidden: ['channel/auth', '应用缺少「企业内机器人发送消息」权限（qyapi_robot_sendmsg）'],
  'Forbidden.AccessDenied.AccessTokenPermissionDenied': ['channel/auth', '应用缺少所需接口权限（如 qyapi_robot_sendmsg），请在开发者后台 → 权限管理中申请'],
  InvalidAuthentication: ['channel/auth', 'accessToken 无效或已过期'],
}

export function dingApiError(json, status) {
  const code = json?.code ?? json?.errcode
  const msg = String(json?.message ?? json?.errmsg ?? json?.raw ?? '').slice(0, 300)
  const known = API_ERRORS[code]
  let err
  if (known) err = new ChannelError(...known)
  else if (status === 401 || status === 403) err = new ChannelError('channel/auth', `钉钉鉴权失败：${msg || code || status}`)
  else if (status === 429) err = new ChannelError('channel/rate-limit', '钉钉接口限流，请稍后再试')
  else err = new ChannelError('channel/rejected', `钉钉接口错误（${code ?? status}）：${msg || '未知错误'}`)
  err.platformCode = code
  err.status = status
  return err
}

// ------------------------------------------------------------- rendering

/** A result as text lines (DingTalk markdown has no tables). */
export function resultAsDingText(r, maxRows = 10, maxCols = 6, { escape = defangMd } = {}) {
  const cols = r.columns.slice(0, maxCols)
  const rows = r.rows.slice(0, maxRows)
  // NULL → '—' (not 0); line breaks would split a numbered row; data must not form links / tags.
  const cell = (c, v) => escape((c.kind === 'number' ? fmtNum(v) : cellText(v, 30)) || '—').replace(/\|/g, '｜')
  const out = [`**${cols.map(c => escape(c.name)).join(' ｜ ')}**`, '', ...rows.map((row, i) => `${i + 1}. ${cols.map((c, j) => cell(c, row[j])).join(' ｜ ')}`)]
  const total = r.rowCount ?? r.rows.length
  if (total > rows.length) out.push('', `> 共 ${total} 行，仅显示前 ${rows.length} 行；完整数据可在数据问答页面查看或导出 Excel`)
  return out.join('\n')
}

/** Markdown with tables → markdown without tables (rows become numbered "a ｜ b" lines). */
export function stripTables(md) {
  return String(md ?? '').replace(MD_TABLE, (m, lead, block) => {
    const t = parseMdTable(block)
    // Tables authored in the message text keep their Markdown (links etc.).
    return `${lead}${resultAsDingText({ ...t, rowCount: t.rows.length }, 50, 8, { escape: (x) => String(x ?? '') })}\n`
  })
}

/** Lark-flavoured Markdown → DingTalk markdown subset. */
export function toDingMarkdown(md) {
  return stripTables(toPlainMarkdown(md, { mentionAll: '@所有人' }))
}

/** OutboundMessage → { title, text } for msgtype markdown / sampleMarkdown. */
export function renderMarkdown(message, { maxRows = 10 } = {}) {
  const parts = []
  if (message.title) parts.push(`### ${defangMd(message.title)}`)
  if (message.text) parts.push(toDingMarkdown(message.text))
  for (const r of (message.results ?? []).slice(0, 10)) {
    const lines = [`#### ${defangMd(r.title || '查询结果')}`, `> ${resultMeta(r)}`, '']
    if (r.error) lines.push(defangMd(r.error))
    else if (!r.rows?.length) lines.push('无数据')
    else if (isKpi(r)) lines.push(kpiText(r, { separator: '\n\n' }))
    else lines.push(resultAsDingText(r, maxRows))
    if (r.sql && message.includeSql) lines.push('', '```sql\n' + r.sql.slice(0, 1500) + '\n```')
    parts.push(lines.join('\n'))
  }
  if (message.footer) parts.push(defangMd(toDingMarkdown(message.footer)))
  const all = message.mentionAll || mentionsAll(message.text) || mentionsAll(message.footer)
  if (all && !parts.some(p => p.includes('@所有人'))) parts.push('@所有人')
  const title = String(message.title || '数据问答').slice(0, 60)
  return { title, chunks: splitText(parts.join('\n\n'), MD_LIMIT), atAll: Boolean(all) }
}

// --------------------------------------------------------------- webhook

export const WEBHOOK_RE = /^https:\/\/oapi\.dingtalk\.(com|io)\/robot\/send\?access_token=[\w-]{16,}$/

async function postWebhook(url, body, ctx) {
  const { status, json } = await postJson(url, body, {}, { label: '钉钉', fetch: ctx.fetch, timeoutMs: 15000 })
  if (Number(json?.errcode) !== 0) throw dingWebhookError(json, status)
  return json
}

function webhookBase(channel, secrets) {
  const url = secrets?.webhookUrl
  if (!url) throw new ChannelError('channel/config', '缺少 Webhook 地址')
  const override = cfg(channel, 'apiBase')
  return override ? url.replace(/^https:\/\/oapi\.dingtalk\.(com|io)/, String(override).replace(/\/+$/, '')) : url
}

async function sendWebhook(channel, secrets, message, ctx = {}) {
  const base = webhookBase(channel, secrets)
  const { title, chunks, atAll } = renderMarkdown(message)
  for (let i = 0; i < chunks.length; i++) {
    await postWebhook(signedUrl(base, secrets.signSecret), {
      msgtype: 'markdown',
      markdown: { title: i ? `${title}（续）` : title, text: chunks[i] },
      at: { isAtAll: atAll && i === chunks.length - 1 },
    }, ctx)
  }
  return { images: 0 }
}

function validateWebhook(input = {}, existing = {}) {
  const given = input.secrets ?? input
  const secrets = {}
  const url = String(given.webhookUrl ?? '').trim()
  if (url) {
    if (!WEBHOOK_RE.test(url)) throw new ChannelError('channel/config', 'Webhook 地址格式不正确，应为 https://oapi.dingtalk.com/robot/send?access_token=…（群设置 → 机器人 → 自定义机器人中复制）', { field: 'webhookUrl' })
    secrets.webhookUrl = url
  } else if (!existing?.secrets?.webhookUrl) {
    throw new ChannelError('channel/config', '请填写 Webhook 地址', { field: 'webhookUrl' })
  }
  if (given.signSecret !== undefined && given.signSecret !== null) {
    const s = String(given.signSecret).trim()
    if (s && !/^SEC[0-9a-f]{20,}$/i.test(s)) throw new ChannelError('channel/config', '加签密钥格式不正确，应为机器人安全设置中以 SEC 开头的字符串', { field: 'signSecret' })
    if (s) secrets.signSecret = s
  }
  return { config: {}, secrets }
}

// ------------------------------------------------------------- app (API)

const tokenCache = new Map()

export function clearTokenCache() { tokenCache.clear() }

async function accessToken(channel, secrets, ctx = {}) {
  const appKey = cfg(channel, 'clientId')
  if (!appKey || !secrets?.clientSecret) throw new ChannelError('channel/config', '缺少 Client ID 或 Client Secret')
  const base = String(cfg(channel, 'apiBase') || API).replace(/\/+$/, '')
  const key = `${base}|${appKey}`
  const hit = tokenCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.token
  const { status, json } = await postJson(`${base}/v1.0/oauth2/accessToken`, { appKey, appSecret: secrets.clientSecret }, {}, { label: '钉钉', fetch: ctx.fetch })
  if (!json?.accessToken) throw dingApiError(json, status)
  const ttl = Number(json.expireIn ?? 7200)
  if (ttl > 120) tokenCache.set(key, { token: json.accessToken, expires: Date.now() + (ttl - 300) * 1000 })
  return json.accessToken
}

async function callRobotApi(channel, secrets, path, body, ctx = {}) {
  const base = String(cfg(channel, 'apiBase') || API).replace(/\/+$/, '')
  let token = await accessToken(channel, secrets, ctx)
  let res = await postJson(`${base}${path}`, body, { 'x-acs-dingtalk-access-token': token }, { label: '钉钉', fetch: ctx.fetch })
  if (res.status === 401 || res.json?.code === 'InvalidAuthentication') {
    clearTokenCache()
    token = await accessToken(channel, secrets, ctx)
    res = await postJson(`${base}${path}`, body, { 'x-acs-dingtalk-access-token': token }, { label: '钉钉', fetch: ctx.fetch })
  }
  if (res.status >= 300 || res.json?.code) throw dingApiError(res.json, res.status)
  return res.json
}

async function sendApp(channel, secrets, message, ctx = {}) {
  const target = cfg(channel, 'openConversationId')
  const userId = cfg(channel, 'userId')
  if (!target && !userId) throw new ChannelError('channel/config', '缺少推送目标：请填写群会话 ID（openConversationId）或成员 userId')
  const robotCode = cfg(channel, 'robotCode') || cfg(channel, 'clientId')
  const { title, chunks } = renderMarkdown(message)
  let messageId
  for (let i = 0; i < chunks.length; i++) {
    const msgParam = JSON.stringify({ title: i ? `${title}（续）` : title, text: chunks[i] })
    const json = target
      ? await callRobotApi(channel, secrets, '/v1.0/robot/groupMessages/send', { msgParam, msgKey: 'sampleMarkdown', openConversationId: target, robotCode }, ctx)
      : await callRobotApi(channel, secrets, '/v1.0/robot/oToMessages/batchSend', { robotCode, userIds: [userId], msgKey: 'sampleMarkdown', msgParam }, ctx)
    messageId ??= json?.processQueryKey
  }
  return { messageId, images: 0 }
}

async function testApp(channel, secrets, ctx = {}) {
  clearTokenCache()
  await accessToken(channel, secrets, ctx)
  return { ok: true, detail: '已获取 accessToken：Client ID / Client Secret 有效' }
}

function validateApp(input = {}, existing = {}) {
  const config = input.config ?? input
  const given = input.secrets ?? input
  const out = {}
  const clientId = String(config.clientId ?? '').trim()
  if (!clientId) throw new ChannelError('channel/config', '请填写 Client ID（原 AppKey）', { field: 'clientId' })
  if (!/^[\w-]{8,64}$/.test(clientId)) throw new ChannelError('channel/config', 'Client ID 格式不正确（开发者后台 → 应用 → 凭证与基础信息）', { field: 'clientId' })
  out.clientId = clientId
  const robotCode = String(config.robotCode ?? '').trim()
  if (robotCode) {
    if (!/^[\w-]{6,64}$/.test(robotCode)) throw new ChannelError('channel/config', 'robotCode 格式不正确', { field: 'robotCode' })
    out.robotCode = robotCode
  }
  const conv = String(config.openConversationId ?? '').trim()
  if (conv) {
    if (!/^cid[\w+/=-]{6,}$/.test(conv)) throw new ChannelError('channel/config', '群会话 ID 格式不正确，应以 cid 开头（机器人收到群消息时的 conversationId）', { field: 'openConversationId' })
    out.openConversationId = conv
  }
  const userId = String(config.userId ?? '').trim()
  if (userId) {
    if (!/^[\w-]{1,64}$/.test(userId)) throw new ChannelError('channel/config', 'userId 格式不正确', { field: 'userId' })
    out.userId = userId
  }
  for (const key of ['apiBase', 'gatewayBase']) {
    const v = String(config[key] ?? '').trim()
    if (!v) continue
    if (!/^https?:\/\/\S+$/.test(v)) throw new ChannelError('channel/config', `${key} 必须是 http(s) 地址`, { field: key })
    out[key] = v.replace(/\/+$/, '')
  }
  const secrets = {}
  const secret = String(given.clientSecret ?? '').trim()
  if (secret) {
    if (secret.length < 16 || /\s/.test(secret)) throw new ChannelError('channel/config', 'Client Secret 格式不正确', { field: 'clientSecret' })
    secrets.clientSecret = secret
  } else if (!existing?.secrets?.clientSecret) {
    throw new ChannelError('channel/config', '请填写 Client Secret（原 AppSecret）', { field: 'clientSecret' })
  }
  return { config: out, secrets }
}

// ------------------------------------------------------------ Stream bot

/** Strip @mentions from a DingTalk text (the platform leaves a leading space / "@Bot"). */
export function cleanText(text, botName) {
  let s = String(text ?? '')
  if (botName) s = s.split(`@${botName}`).join(' ')
  return s.replace(/\s+/g, ' ').trim()
}

function createBot(channel, secrets, handlers = {}, opts = {}) {
  const logger = opts.logger
  const WebSocketImpl = opts.WebSocket ?? globalThis.WebSocket
  const backoffBase = opts.backoffMs ?? 1000
  const backoffMax = opts.maxBackoffMs ?? 60000
  const gateway = String(cfg(channel, 'gatewayBase') || API).replace(/\/+$/, '')
  const clientId = cfg(channel, 'clientId')
  const botName = cfg(channel, 'botName')
  let state = 'idle'
  let error
  let since = Date.now()
  let ws = null
  let stopped = true
  let attempts = 0
  let timer = null
  let robot = null
  const set = (s, e) => { state = s; error = e; since = Date.now() }

  const send = (sock, frame) => { try { if (sock.readyState === 1) sock.send(JSON.stringify(frame)) } catch {} }
  const ack = (sock, headers, data) => send(sock, { code: 200, headers: { contentType: 'application/json', messageId: headers?.messageId }, message: 'OK', data })

  async function replyVia(msg, body) {
    const expired = Number(msg.sessionWebhookExpiredTime ?? 0) && Date.now() > Number(msg.sessionWebhookExpiredTime) - 5000
    if (msg.sessionWebhook && !expired) {
      const { status, json } = await postJson(msg.sessionWebhook, body, {}, { label: '钉钉', fetch: opts.fetch, timeoutMs: 15000 })
      if (Number(json?.errcode ?? 0) !== 0) throw dingWebhookError(json, status)
      return
    }
    // Session webhook expired: fall back to the robot API (needs qyapi_robot_sendmsg).
    const robotCode = msg.robotCode || cfg(channel, 'robotCode') || clientId
    const msgKey = body.msgtype === 'text' ? 'sampleText' : 'sampleMarkdown'
    const msgParam = JSON.stringify(body.msgtype === 'text' ? { content: body.text.content } : body.markdown)
    const ctx = { fetch: opts.fetch }
    const ch = { ...channel, apiBase: cfg(channel, 'apiBase') }
    if (msg.conversationType === '2') await callRobotApi(ch, secrets, '/v1.0/robot/groupMessages/send', { msgParam, msgKey, openConversationId: msg.conversationId, robotCode }, ctx)
    else await callRobotApi(ch, secrets, '/v1.0/robot/oToMessages/batchSend', { robotCode, userIds: [msg.senderStaffId], msgKey, msgParam }, ctx)
  }

  function onBotMessage(msg) {
    robot ??= { id: msg.chatbotUserId, robotCode: msg.robotCode }
    const chatType = msg.conversationType === '2' ? 'group' : 'p2p'
    if (chatType === 'group' && msg.isInAtList === false) return
    if (chatType === 'p2p' && channel?.bot?.allowP2p === false) return
    const raw = msg.msgtype === 'text' ? msg.text?.content : msg.content?.recognition ?? ''
    const text = cleanText(raw, botName)
    if (!text) return
    const inbound = {
      platform: 'dingtalk',
      channelId: channel?.id,
      messageId: msg.msgId,
      chatId: msg.conversationId,
      chatType,
      text,
      mentionedBot: chatType === 'group',
      sender: { id: msg.senderStaffId || msg.senderId, name: msg.senderNick, ...(msg.senderStaffId ? {} : { encryptedId: msg.senderId }) },
      raw: msg,
      async reply(om) {
        const { title, chunks } = renderMarkdown({ ...om, mentionAll: false })
        for (let i = 0; i < chunks.length; i++) await replyVia(msg, { msgtype: 'markdown', markdown: { title: i ? `${title}（续）` : title, text: chunks[i] } })
        return {}
      },
      async replyText(s) { await replyVia(msg, { msgtype: 'text', text: { content: String(s ?? '').slice(0, 5000) } }) },
    }
    Promise.resolve(handlers.onMessage?.(inbound)).catch(e => logger?.warn?.(`dingtalk: onMessage failed: ${e?.message ?? e}`))
  }

  function onFrame(sock, frame) {
    const topic = frame?.headers?.topic
    if (frame.type === 'SYSTEM') {
      if (topic === 'ping') ack(sock, frame.headers, frame.data)
      else if (topic === 'disconnect') { logger?.info?.('dingtalk: server requested disconnect; reconnecting'); try { sock.close() } catch {} }
      return
    }
    if (frame.type === 'CALLBACK' && topic === BOT_TOPIC) {
      ack(sock, frame.headers, JSON.stringify({ response: null }))
      let msg
      try { msg = JSON.parse(frame.data) } catch { return }
      try { onBotMessage(msg) } catch (e) { logger?.warn?.(`dingtalk: message failed: ${e?.message}`) }
      return
    }
    if (frame.type === 'EVENT') ack(sock, frame.headers, JSON.stringify({ status: 'SUCCESS', message: 'ignored' }))
  }

  async function connect() {
    if (stopped) return
    set('connecting')
    try {
      if (!clientId || !secrets?.clientSecret) throw new ChannelError('channel/config', '缺少 Client ID 或 Client Secret')
      const { status, json } = await request(`${gateway}/v1.0/gateway/connections/open`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        json: { clientId, clientSecret: secrets.clientSecret, ua: UA, subscriptions: [{ type: 'CALLBACK', topic: BOT_TOPIC }] },
        label: '钉钉', fetch: opts.fetch, timeoutMs: 10000,
      })
      if (!json?.endpoint || !json?.ticket) {
        throw status === 401 || status === 403 || /clientId|secret|auth/i.test(json?.code ?? json?.message ?? '') ? new ChannelError('channel/auth', `Stream 连接注册失败：Client ID / Client Secret 不正确或应用未开启 Stream 模式（${json?.code ?? status}）`) : dingApiError(json, status)
      }
      if (stopped) return
      const sock = new WebSocketImpl(`${json.endpoint}?ticket=${encodeURIComponent(json.ticket)}`)
      ws = sock
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => { reject(new ChannelError('channel/network', '连接钉钉 Stream 网关超时')); try { sock.close() } catch {} }, 10000)
        sock.addEventListener('open', () => { clearTimeout(t); resolve() })
        sock.addEventListener('error', () => { clearTimeout(t); reject(new ChannelError('channel/network', '无法连接钉钉 Stream 网关')) })
      })
      sock.addEventListener('message', (ev) => {
        let frame
        try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()) } catch { return }
        onFrame(sock, frame)
      })
      sock.addEventListener('close', () => {
        if (ws !== sock) return
        ws = null
        if (!stopped) { set('connecting', '连接已断开，正在重连'); schedule() }
      })
      if (sock.readyState !== 1) throw new ChannelError('channel/network', '钉钉 Stream 连接已关闭')
      attempts = 0
      set('connected')
    } catch (e) {
      if (stopped) return
      set('error', e.message)
      logger?.warn?.(`dingtalk: connect failed: ${e.message}`)
      schedule()
    }
  }
  function schedule() {
    clearTimeout(timer)
    const delay = Math.min(backoffBase * 2 ** attempts + Math.random() * Math.min(1000, backoffBase), backoffMax)
    attempts++
    timer = setTimeout(connect, delay)
  }

  return {
    start() { if (!stopped) return; stopped = false; attempts = 0; connect() },
    async stop() {
      stopped = true
      clearTimeout(timer)
      const s = ws
      ws = null
      try { s?.close() } catch {}
      set('stopped')
    },
    status() { return { state, ...(error ? { error } : {}), since } },
    info() { return clientId ? { id: robot?.robotCode ?? clientId, ...(botName ? { name: botName } : {}) } : null },
  }
}

// ---------------------------------------------------------------- kinds

const webhookKind = {
  id: 'dingtalk_webhook',
  platform: 'dingtalk',
  label: { zh: '钉钉自定义机器人（Webhook）', en: 'DingTalk custom robot (webhook)' },
  description: { zh: '向钉钉群推送 Markdown 消息（支持加签）；仅推送。图表以文本表格呈现。', en: 'Push Markdown to a DingTalk group (optional signing); push only. Charts become text tables.' },
  fields: [
    { key: 'webhookUrl', type: 'secret', secret: true, required: true, label: { zh: 'Webhook 地址', en: 'Webhook URL' }, placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…', pattern: WEBHOOK_RE.source, help: { zh: '群设置 → 机器人 → 添加机器人 → 自定义，完成后复制 Webhook', en: 'Group settings → Bots → Add → Custom, then copy the webhook' } },
    { key: 'signSecret', type: 'secret', secret: true, required: false, label: { zh: '加签密钥（可选）', en: 'Signing secret (optional)' }, placeholder: 'SEC…', help: { zh: '安全设置选择「加签」时显示的 SEC 开头字符串', en: 'The SEC… string shown when “Sign” is selected in security settings' } },
  ],
  capabilities: { push: true, markdown: 'basic', charts: 'none', chartModes: ['table'], tables: 'text', tableRows: 10, files: false, buttons: false, bot: false, listTargets: false, mentionAll: true, maxMessageBytes: MD_LIMIT },
  setupSteps: {
    zh: [
      '在钉钉群：群设置 → 机器人 → 添加机器人 → 自定义（通过 Webhook 接入）。',
      '安全设置至少选一项：推荐「加签」并把 SEC 开头的密钥填入；若用「自定义关键词」，消息标题或内容须包含该关键词。',
      '复制 Webhook 地址（https://oapi.dingtalk.com/robot/send?access_token=…）。',
      '钉钉 Markdown 不支持表格，结果以编号行展示；Webhook 不能上传图片，图表以文本表格代替。',
      '每个机器人每分钟最多 20 条消息，超出将被限流 10 分钟。',
    ],
    en: [
      'In a DingTalk group: Settings → Bots → Add → Custom (webhook).',
      'Pick a security setting: “Sign” recommended (paste the SEC… secret); with keywords, the title or text must contain one.',
      'Copy the webhook URL (https://oapi.dingtalk.com/robot/send?access_token=…).',
      'DingTalk Markdown has no tables (rows become numbered lines); webhooks cannot upload images, so charts become text tables.',
      'At most 20 messages per minute per robot, otherwise throttled for 10 minutes.',
    ],
  },
  validate: validateWebhook,
  send: sendWebhook,
}

const appKind = {
  id: 'dingtalk_app',
  platform: 'dingtalk',
  label: { zh: '钉钉企业内部应用机器人（Stream）', en: 'DingTalk internal app robot (Stream)' },
  description: { zh: 'Stream 模式接收群里 @机器人 和单聊提问（无需公网地址），通过会话 Webhook 回复；可通过机器人 API 主动推送到群或成员。', en: 'Receives @mentions and direct chats over Stream mode (no public URL), replies via the session webhook; can push to a group or member via the robot API.' },
  fields: [
    { key: 'clientId', type: 'text', required: true, label: { zh: 'Client ID（原 AppKey）', en: 'Client ID (AppKey)' }, help: { zh: '开发者后台 → 应用开发 → 企业内部应用 → 凭证与基础信息', en: 'Developer console → internal app → Credentials' } },
    { key: 'clientSecret', type: 'secret', secret: true, required: true, label: { zh: 'Client Secret（原 AppSecret）', en: 'Client Secret (AppSecret)' } },
    { key: 'robotCode', type: 'text', required: false, label: { zh: 'robotCode（可选）', en: 'robotCode (optional)' }, help: { zh: '机器人配置页中的 RobotCode；留空时使用 Client ID（企业内部应用机器人通常相同）', en: 'RobotCode from the bot page; defaults to the Client ID (usually identical)' } },
    { key: 'botName', type: 'text', required: false, label: { zh: '机器人名称（可选）', en: 'Bot name (optional)' }, help: { zh: '用于从群消息中去掉 “@机器人名”', en: 'Used to strip "@name" from group messages' } },
    { key: 'openConversationId', type: 'text', required: false, label: { zh: '推送目标群（openConversationId，可选）', en: 'Push target group (openConversationId, optional)' }, placeholder: 'cid…', help: { zh: '机器人收到该群消息时的 conversationId（以 cid 开头）', en: 'The conversationId (cid…) seen in a message from that group' } },
    { key: 'userId', type: 'text', required: false, label: { zh: '推送目标成员 userId（可选）', en: 'Push target member userId (optional)' }, help: { zh: '未填群会话 ID 时，推送到该成员与机器人的单聊', en: 'Used when no group is set: pushes to the member’s chat with the bot' } },
  ],
  capabilities: { push: true, markdown: 'basic', charts: 'none', chartModes: ['table'], tables: 'text', tableRows: 10, files: false, buttons: false, bot: true, listTargets: false, mentionAll: false, maxMessageBytes: MD_LIMIT },
  setupSteps: {
    zh: [
      '钉钉开发者后台（open-dev.dingtalk.com）→ 应用开发 → 企业内部应用 → 创建应用，记下 Client ID 与 Client Secret。',
      '应用能力 → 添加「机器人」，消息接收模式选择「Stream 模式」，发布机器人。',
      '权限管理中申请「企业内机器人发送消息权限」（qyapi_robot_sendmsg）以支持主动推送和会话 Webhook 过期后的回复。',
      '把机器人添加到群（群设置 → 机器人 → 添加 → 选择该应用机器人）；群里 @机器人 或单聊即可提问。',
      '主动推送需要群的 openConversationId（cid 开头，可从机器人收到的消息中获得）或成员 userId。',
      '暂不支持互动卡片按钮和图表图片（图表以文本表格展示）。',
    ],
    en: [
      'DingTalk developer console (open-dev.dingtalk.com) → internal app → create; note Client ID and Client Secret.',
      'Add the “Robot” capability, choose “Stream mode” for message receiving, publish the robot.',
      'Request the qyapi_robot_sendmsg permission for push and for replies after the session webhook expires.',
      'Add the robot to groups (Group settings → Bots → Add → your app robot); @mention it or chat directly.',
      'Push needs the group openConversationId (cid…, seen in received messages) or a member userId.',
      'Not supported: interactive card buttons and chart images (charts become text tables).',
    ],
  },
  validate: validateApp,
  send: sendApp,
  test: testApp,
}

export default {
  id: 'dingtalk',
  name: { zh: '钉钉', en: 'DingTalk' },
  kinds: [webhookKind, appKind],
  createBot,
}
