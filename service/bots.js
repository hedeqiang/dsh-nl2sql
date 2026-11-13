/**
 * Nl2SqlService methods: inbound IM bots (see docs/channels.md).
 * Mixed into the service prototype by index.js; `this` is the service.
 *
 * Every channel whose kind has `capabilities.bot` may carry
 * `channel.bot = { enabled, allowP2p, sessionScope: 'chat'|'user' }`. Enabled
 * bots run their adapter's `createBot(channel, secrets, { onMessage, onAction })`.
 * This module owns lifecycle, conversations (`state.botConversations`, keyed
 * `<channelId>:<chatId>#<scopeHash>` per chat or `<channelId>:<chatId>:<userId>`
 * per user), the per-conversation queue, the agent turn, actor resolution,
 * interactive actions (opaque tokens, rate limit, re-authorization), delivery
 * log and audit.
 *
 * Buttons carry only an opaque token ({ a: <action>, t: <token> }); the token
 * maps server-side to { resultId, sessionId, channelId, platform, chatId,
 * replyTo, depth, ownerRole }. Every click re-resolves the clicking operator and
 * re-checks data source scope, row-level rules and role before anything runs.
 */
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSelect } from '../analysis.js'
import { getAdapter, kindOf, loadAdapters } from '../channels/index.js'
import { toInboundAction, toInboundMessage } from '../channels/lark.js'
import { PLATFORM_LABEL } from './access.js'
import { BOT_PRESET_ID, PRESET_ID, UserError, hashText, oneOf, toUserError } from './shared.js'

export const ACTION_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000
const ACTION_TOKEN_MAX = 5000
export const ACTION_RATE_MS = 2000
/** Messages produced by actions get buttons up to this depth (0 = answer message). */
export const ACTION_MAX_DEPTH = 2
const ACTIONS = new Set(['drill', 'why', 'detail', 'pin'])
const CONVERSATIONS_MAX = 500

const toast = (type, content) => ({ toast: { type, content } })
const label = (platform) => PLATFORM_LABEL[platform] ?? platform ?? 'IM'
const SOURCE = (platform) => `${platform ?? 'im'}bot`

const BARE_COMMANDS = {
  帮助: 'help', help: 'help', start: 'help',
  数据源: 'sources', sources: 'sources', datasources: 'sources',
  自动: 'auto', auto: 'auto',
  新对话: 'reset', new: 'reset', reset: 'reset',
}

/**
 * A bot command, or null for a question. Argument-less commands must be the whole
 * message (optionally `/`-prefixed, trailing punctuation ignored), so questions like
 * 「自动续费用户有多少」 reach the agent. `切换` / `切换数据源` / `switch` / `use` take an
 * argument after whitespace; alone they ask for usage.
 * → { verb: 'help'|'sources'|'auto'|'reset'|'switch', arg? }
 */
export function parseBotCommand(text) {
  const s = String(text ?? '').trim().replace(/^\//, '').replace(/[\s?？。.!！~～]+$/u, '')
  const bare = BARE_COMMANDS[s.toLowerCase()]
  if (bare) return { verb: bare }
  const m = /^(切换数据源|切换|switch|use)(?:\s+([\s\S]+))?$/i.exec(s)
  if (m) return { verb: 'switch', arg: (m[2] ?? '').trim() }
  return null
}

/**
 * Results shown in a bot reply: drop ones the agent marked as intermediate (`show: false`),
 * drop empty results when the answer has non-empty ones (an empty probe of the wrong table
 * reads like "no such order"), keep at most the last 4.
 */
export function selectReplyResults(results) {
  let list = results.filter(r => !r.hidden)
  if (list.some(r => !r.error && r.rows?.length)) list = list.filter(r => r.error || r.rows?.length)
  return list.slice(-4)
}

/**
 * A point lookup: the WHERE pins a key column to one value (order no, id, hash…) and there is
 * no GROUP BY. Splitting or pinning such a result to a dashboard makes no sense.
 */
export function isPointLookup(r, dialect) {
  const parsed = parseSelect(r.baseSql ?? r.sql, { dialect })
  if (!parsed || parsed.groupBy) return false
  const where = String(parsed.where ?? '')
  const keyEq = /(?:^|[^\w])`?(?:\w+\.)?`?(\w*(?:id|_no|no|order_?no|trade_?no|code|hash|uuid|sn|number)|id)`?\s*(?:=\s*'?[\w-]{4,}'?|in\s*\(\s*'?[\w-]{4,}'?\s*\))/i
  return keyEq.test(where) || /'\d{10,}'|\b\d{12,}\b/.test(where)
}

function hasAggregate(r, dialect) {
  const parsed = parseSelect(r.baseSql ?? r.sql, { dialect })
  return Boolean(parsed?.select?.some(i => i.isAggregate))
}

export const methods = {
  // ------------------------------------------------------------- config

  normalizeBotConfig(input = {}, prev = {}) {
    const conf = { enabled: false, allowP2p: true, sessionScope: 'chat', ...(prev ?? {}) }
    if (input.enabled !== undefined) conf.enabled = Boolean(input.enabled)
    if (input.allowP2p !== undefined) conf.allowP2p = Boolean(input.allowP2p)
    if (input.sessionScope !== undefined) conf.sessionScope = oneOf(input.sessionScope, ['chat', 'user'], 'sessionScope')
    return { enabled: conf.enabled, allowP2p: conf.allowP2p, sessionScope: conf.sessionScope }
  },

  /** Channels whose kind can run a bot. */
  botChannels() {
    return this.state.channels.filter(c => kindOf(c.type)?.kind.capabilities?.bot)
  },

  /** Bot settings of a channel (or the legacy / default settings for unknown ids). */
  botConfigFor(channelId) {
    const c = channelId ? this.state.channels.find(x => x.id === channelId) : undefined
    if (c?.bot) return this.normalizeBotConfig({}, c.bot)
    if (this.state.larkBot) return this.normalizeBotConfig({}, this.state.larkBot)
    return this.normalizeBotConfig({}, {})
  },

  /**
   * One-time migration (idempotent): legacy `state.larkBot` → `channel.bot` on
   * the referenced channel, `state.larkSessions` → `state.botConversations`.
   */
  migrateLegacyBot() {
    let changed = false
    const legacy = this.state.larkBot
    let legacyChannelId = legacy?.channelId ?? null
    if (legacy && typeof legacy === 'object') {
      const c = legacyChannelId ? this.state.channels.find(x => x.id === legacyChannelId) : undefined
      if (c && c.type === 'lark_app' && !c.bot) c.bot = this.normalizeBotConfig(legacy, {})
      changed = true
    }
    if ('larkBot' in this.state) { delete this.state.larkBot; changed = true }
    const old = Object.getOwnPropertyDescriptor(this.state, 'larkSessions')
    if (old && 'value' in old) {
      legacyChannelId ??= this.state.channels.find(c => c.type === 'lark_app' && c.bot)?.id ?? 'lark'
      this.state.botConversations ??= {}
      for (const conv of Object.values(old.value ?? {})) {
        if (!conv || typeof conv !== 'object') continue
        const key = `${legacyChannelId}:${conv.key ?? conv.chatId}`
        if (!this.state.botConversations[key]) this.state.botConversations[key] = { ...conv, key, channelId: legacyChannelId, platform: 'lark' }
      }
      delete this.state.larkSessions
      changed = true
    }
    this.state.botConversations ??= {}
    // `state.larkSessions` stays readable (not persisted) for older callers.
    if (!Object.getOwnPropertyDescriptor(this.state, 'larkSessions')) {
      Object.defineProperty(this.state, 'larkSessions', { get: () => this.state.botConversations, enumerable: false, configurable: true })
    }
    return changed
  },

  // ------------------------------------------------------------- lifecycle

  botRuntimeStatus(c) {
    const running = this.bots?.get(c.id)
    if (running) return running.bot.status()
    return { state: c.bot?.enabled ? 'stopped' : 'idle', since: Date.now() }
  },

  conversationsFor(channelId, limit = 50) {
    return Object.values(this.state.botConversations ?? {}).filter(v => !channelId || v.channelId === channelId).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, limit)
  },

  /** Status of every bot-capable channel. */
  async botStatus() {
    await loadAdapters()
    return this.botChannels().map(c => this.botStatusFor(c))
  },

  botStatusFor(c) {
    const conf = this.normalizeBotConfig({}, c.bot)
    return {
      channelId: c.id, channelName: c.name, platform: c.platform ?? kindOf(c.type)?.adapter.id, type: c.type,
      ...conf,
      status: this.botRuntimeStatus(c),
      info: this.bots?.get(c.id)?.bot.info?.() ?? null,
      conversations: this.conversationsFor(c.id),
    }
  },

  async saveBot({ channelId, ...input } = {}) {
    await loadAdapters()
    const c = this.state.channels.find(x => x.id === channelId)
    if (!c) throw new UserError('nl2sql/unknown-channel', '推送渠道不存在')
    if (!kindOf(c.type)?.kind.capabilities?.bot) throw new UserError('nl2sql/invalid', `渠道「${c.name}」不支持机器人`)
    c.bot = this.normalizeBotConfig(input, c.bot)
    this.auditAdmin('bot.save', `${c.name} · ${c.bot.enabled ? '启用' : '停用'}`)
    await this.save()
    await this.restartBot({ channelId: c.id })
    return this.botStatusFor(c)
  },

  async stopBot(channelId) {
    const running = this.bots?.get(channelId)
    if (!running) return
    this.bots.delete(channelId)
    try { await running.bot.stop() } catch {}
  },

  async stopAllBots() {
    await Promise.allSettled([...(this.bots?.keys() ?? [])].map(id => this.stopBot(id)))
  },

  /** (Re)start the bot of one channel; stops it when disabled. Returns its status. */
  async restartBot({ channelId } = {}) {
    await loadAdapters()
    this.bots ??= new Map()
    await this.stopBot(channelId)
    const c = this.state.channels.find(x => x.id === channelId)
    if (!c) return undefined
    const found = kindOf(c.type)
    const adapter = found ? getAdapter(found.adapter.id) : undefined
    if (!c.bot?.enabled || this.disposed || !found?.kind.capabilities?.bot || !adapter?.createBot || c.needsSecret) return this.botStatusFor(c)
    const secrets = await this.channelSecrets(c)
    const bot = adapter.createBot(this.adapterChannel(c), secrets, {
      onMessage: (m) => this.handleBotMessage({ ...m, channelId: c.id, platform: m.platform ?? adapter.id }),
      onAction: (a) => this.handleBotAction({ ...a, channelId: c.id, platform: a.platform ?? adapter.id }),
    }, { logger: { debug() {}, info() {}, warn: (...a) => console.warn(`nl2sql ${adapter.id}:`, ...a), error: (...a) => console.warn(`nl2sql ${adapter.id}:`, ...a) } })
    this.bots.set(c.id, { bot, platform: adapter.id })
    if (adapter.id === 'lark' && bot.creds && this.larkBotChannel()?.id === c.id) this.larkCreds = bot.creds
    try { await bot.start() } catch (error) { console.warn('nl2sql bot: %s start failed: %s', c.name, error.message) }
    return this.botStatusFor(c)
  },

  /** Start every enabled bot (on apply). */
  async startBots() {
    await loadAdapters()
    for (const c of this.botChannels()) {
      if (!c.bot?.enabled) continue
      await this.restartBot({ channelId: c.id }).catch(error => console.warn('nl2sql bot: %s: %s', c.name, error.message))
    }
  },

  // ------------------------------------------------------------- legacy Lark RPCs

  /** The Lark app channel the legacy single-bot RPCs operate on. */
  larkBotChannel() {
    const apps = this.state.channels.filter(c => c.type === 'lark_app')
    return apps.find(c => c.bot?.enabled) ?? apps.find(c => c.bot) ?? undefined
  },

  larkBotConfig() {
    if (this.state.larkBot) return { enabled: false, channelId: null, allowP2p: true, sessionScope: 'chat', ...this.state.larkBot }
    const c = this.larkBotChannel()
    return { ...this.normalizeBotConfig({}, c?.bot), channelId: c?.id ?? null }
  },

  larkBotStatus() {
    const conf = this.larkBotConfig()
    const c = conf.channelId ? this.state.channels.find(x => x.id === conf.channelId) : undefined
    const info = c ? this.bots?.get(c.id)?.bot.info?.() : null
    return {
      ...conf,
      status: c ? this.botRuntimeStatus(c) : { state: conf.enabled ? 'stopped' : 'idle', since: Date.now() },
      bot: info ? { openId: info.id, name: info.name } : null,
      conversations: this.conversationsFor(undefined).filter(v => (v.platform ?? 'lark') === 'lark'),
    }
  },

  async saveLarkBot(input = {}) {
    const conf = this.larkBotConfig()
    let target = conf.channelId
    if (input.channelId !== undefined) {
      const ch = this.state.channels.find(c => c.id === input.channelId)
      if (input.channelId && (!ch || ch.type !== 'lark_app')) throw new UserError('nl2sql/invalid', '飞书机器人需要选择一个「应用机器人」类型的推送渠道（提供 App ID / Secret）')
      target = input.channelId || null
    }
    const next = this.normalizeBotConfig(input, conf)
    if (next.enabled && !target) throw new UserError('nl2sql/invalid', '请先选择应用机器人渠道')
    delete this.state.larkBot
    // One legacy Lark bot: moving it disables it on the previous channel.
    const restart = new Set()
    for (const c of this.state.channels) {
      if (c.type !== 'lark_app') continue
      if (c.id === target) { c.bot = next; restart.add(c.id) } else if (c.bot && conf.channelId === c.id) { c.bot = { ...c.bot, enabled: false }; restart.add(c.id) }
    }
    this.auditAdmin('larkbot.save', `${next.enabled ? '启用' : '停用'} · ${target ?? ''}`)
    await this.save()
    for (const id of restart) await this.restartBot({ channelId: id })
    return this.larkBotStatus()
  },

  async restartLarkBot() {
    const c = this.larkBotChannel()
    if (c) await this.restartBot({ channelId: c.id })
  },

  /** Legacy entry: a normalized Lark message (lark-bot.js shape) handled with `this.larkCreds`. */
  async handleLarkMessage(m) {
    const creds = this.larkCreds
    if (!creds) return
    if (m.chatType === 'group' && !m.mentionedBot) return
    const inbound = await toInboundMessage(m, creds, { channelId: this.larkBotChannel()?.id })
    return this.handleBotMessage(inbound)
  },

  /** Legacy signature (m: normalized Lark message, creds: Lark credentials). */
  async handleLarkMessageInner(m, text, conf, creds, reply) {
    const inbound = await toInboundMessage(m, creds, { channelId: this.larkBotChannel()?.id })
    return this.handleBotMessageInner(inbound, text, conf, reply)
  },

  /** Legacy entry: a normalized Lark card callback handled with `this.larkCreds`. */
  async handleLarkCardAction(evt) {
    const creds = this.larkCreds
    if (!creds || !evt?.operator?.openId) return undefined
    return this.handleBotAction(await toInboundAction(evt, creds, { channelId: this.larkBotChannel()?.id }))
  },

  // ------------------------------------------------------------- messages

  /** One inbound message → permission check → session prompt → reply. */
  async handleBotMessage(m) {
    const conf = this.botConfigFor(m.channelId)
    if (m.chatType === 'group' && !m.mentionedBot) return
    if (m.chatType === 'p2p' && !conf.allowP2p) return
    const text = String(m.text ?? '').trim()
    if (!text) return
    const reply = (t) => Promise.resolve(m.replyText?.(t)).catch(() => {})
    try {
      await this.handleBotMessageInner(m, text, conf, reply)
    } catch (error) {
      console.warn('nl2sql bot: %s', error.message)
      await reply(`处理失败：${toUserError(error).message}`)
    }
  },

  async handleBotMessageInner(m, text, conf, reply) {
    const platform = m.platform ?? 'lark'
    const name = label(platform)
    const userId = m.sender?.id != null ? String(m.sender.id) : undefined
    const resolved = this.resolveActor({ platform, userId, email: m.sender?.email, name: m.sender?.name, chatId: m.chatId != null ? String(m.chatId) : m.chatId, chatType: m.chatType })
    // Remember who/which group talked to the bot: the member form offers them as one-click picks.
    let chatName
    if (m.chatType === 'group') { try { chatName = typeof m.chatName === 'function' ? await m.chatName() : m.chatName } catch {} }
    if (userId) this.noteSeenIdentity({ platform, kind: 'person', id: userId, name: m.sender?.name, email: m.sender?.email, channelId: m.channelId, refused: Boolean(resolved.refused) })
    if (m.chatType === 'group' && m.chatId) this.noteSeenIdentity({ platform, kind: 'chat', id: String(m.chatId), name: chatName, chatName, channelId: m.channelId, refused: Boolean(resolved.refused) })
    if (resolved.refused) { await this.save(); await reply(resolved.refused); return }
    const actor = resolved.actor
    // Commands: 帮助 / 数据源 / 切换 <名称> / 自动 / 新对话 (and English aliases).
    const cmd = parseBotCommand(text)
    // Members with different scopes must not share a conversation: per-user sessions
    // whenever the sender's effective scope or rules differ from the chat's.
    const scopeSig = JSON.stringify([actor.datasourceIds, actor.role, actor.rowRules ?? []])
    const shared = conf.sessionScope !== 'user'
    const prefix = m.channelId ?? platform
    const key = shared ? `${prefix}:${m.chatId}#${hashText(scopeSig)}` : `${prefix}:${m.chatId}:${userId}`
    this.state.botConversations ??= {}
    const convs = this.state.botConversations
    const conv = convs[key] ?? { key, channelId: m.channelId ?? null, platform, chatId: m.chatId, chatType: m.chatType, sessionId: null, datasourceId: actor.defaultDatasourceId, createdAt: Date.now() }
    if (chatName && !conv.chatName) conv.chatName = chatName
    const allowedDs = this.state.datasources.filter(d => !Array.isArray(actor.datasourceIds) || actor.datasourceIds.includes(d.id))
    if (conv.datasourceId && !allowedDs.some(d => d.id === conv.datasourceId)) conv.datasourceId = allowedDs[0]?.id ?? null
    if (cmd) {
      const { verb } = cmd
      if (verb === 'help') { await reply(`直接${m.chatType === 'group' ? ' @我 ' : ''}提问即可，例如「上周每天的订单量」。\n命令（单独发送）：\n· 数据源 / sources — 查看可用数据源\n· 切换 <名称> / switch <name> — 固定使用某个数据源\n· 自动 / auto — 按问题自动选择数据源\n· 新对话 / new — 开始新对话\n· 帮助 / help — 显示本说明\n当前数据源：${this.findDatasource(conv.datasourceId)?.name ?? '未选择'}${conv.datasourcePinned ? '（已指定）' : allowedDs.length > 1 ? '（按问题自动选择）' : ''}${actor.role === 'viewer' ? '\n你是只读成员：可以查询指标库中的指标、已验证的常见问题和看板。' : ''}`); return }
      if (verb === 'sources') { await reply(`可用数据源：\n${allowedDs.map(d => `· ${d.name}${d.description ? ` — ${d.description}` : ''}`).join('\n') || '无'}\n当前：${this.findDatasource(conv.datasourceId)?.name ?? '未选择'}${conv.datasourcePinned ? '（已指定，发送「自动」恢复按问题自动选择）' : allowedDs.length > 1 ? '（按问题自动选择；发送「切换 <名称>」固定）' : ''}`); return }
      if (verb === 'auto') { delete conv.datasourcePinned; convs[key] = conv; await this.save(); await reply(`已改为按问题自动选择数据源（可用：${allowedDs.map(d => d.name).join('、')}）。`); return }
      if (verb === 'reset') { conv.sessionId = null; convs[key] = conv; await this.save(); await reply('已开始新对话。'); return }
      if (!cmd.arg) { await reply(`用法：切换 <数据源名称>（或 switch <name>）。可用：${allowedDs.map(d => d.name).join('、') || '无'}`); return }
      const want = cmd.arg.toLowerCase()
      const target = allowedDs.find(d => d.name.toLowerCase() === want || d.id === cmd.arg) ?? allowedDs.filter(d => d.name.toLowerCase().includes(want) || (d.database ?? '').toLowerCase() === want).find((_, __, arr) => arr.length === 1)
      if (!target) { await reply(`找不到可用的数据源「${cmd.arg}」。可用：${allowedDs.map(d => d.name).join('、')}`); return }
      conv.datasourceId = target.id
      conv.datasourcePinned = true
      if (conv.sessionId) { this.state.sessions[conv.sessionId] = target.id }
      convs[key] = conv
      await this.save()
      await reply(`已切换到数据源「${target.name}」。之后的提问都会查询这个数据源；发送「自动」恢复按问题自动选择。`)
      return
    }
    // Which data source answers: an explicit 切换 wins; otherwise the question picks the most
    // relevant one among those the member may use (schema + business knowledge), so people
    // don't need to know data source names. The agent can still switch with nl2sql_datasource.
    let ds = this.findDatasource(conv.datasourceId) ?? allowedDs[0]
    let routed = null
    if (!conv.datasourcePinned && allowedDs.length > 1) {
      routed = await this.routeDatasource(text, allowedDs).catch(() => null)
      if (routed?.ds) ds = routed.ds
    }
    if (!ds) { await reply('没有可访问的数据源，请联系管理员。'); return }
    this.assertAccess(actor, ds)
    if (!this.ctx.get('sessionController')) { await reply('当前 Harness 不支持创建会话（缺少 sessionController）。'); return }
    void Promise.resolve(m.react?.('working')).catch(() => {})
    if (!conv.chatName && m.chatType === 'group') {
      try { conv.chatName = typeof m.chatName === 'function' ? await m.chatName() : m.chatName ?? undefined } catch {}
      if (!conv.chatName) delete conv.chatName
    }
    const channel = m.channelId ? this.state.channels.find(c => c.id === m.channelId) : undefined
    // Group rate limits (per asker per minute, per chat per hour), questions only.
    if (actor.chatPolicy) {
      const limited = this.checkChatRate(actor.chatPolicy, { chatKey: `${platform}:${m.chatId}`, userKey: `${platform}:${m.chatId}:${userId ?? actor.id}` })
      if (limited) { this.auditAdmin('bot.rate.limited', `${actor.name} @ ${actor.chatName ?? m.chatId}: ${limited}`, actor); await reply(limited); return }
    }
    // Reply cards carry no buttons (split / why / details / pin): those are done in Harness conversations.
    // Clicks on buttons of cards sent by older versions are still handled (handleBotAction).
    const buttons = false
    // One prompt at a time per conversation, so each question gets its own answer.
    await this.serialize(`bot:${key}`, async () => {
      const started = Date.now()
      // Another message of this conversation may have created the session meanwhile.
      const latest = convs[key]
      if (latest?.sessionId && !conv.sessionId) { conv.sessionId = latest.sessionId; if (latest.group) conv.group = latest.group; if (latest.preset) conv.preset = latest.preset }
      const prepare = async (sessionId) => {
        conv.sessionId = sessionId
        conv.datasourceId = ds.id
        conv.lastAt = started
        conv.lastQuestion = text.slice(0, 200)
        conv.lastActor = actor.name
        convs[key] = conv
        this.state.sessions[sessionId] = ds.id
        this.state.sessionActors ??= {}
        this.state.sessionActors[sessionId] = { id: actor.id, name: actor.name, kind: platform, platform, datasourceIds: actor.datasourceIds, role: actor.role, rowRules: actor.rowRules ?? [] }
        await this.save()
      }
      const where = m.chatType === 'group' ? `群「${conv.chatName ?? m.chatId}」` : '私聊'
      const dsLine = allowedDs.length > 1
        ? (conv.datasourcePinned
          ? `数据源：${ds.name}（群内已用「切换」指定，请只查询这个数据源）。`
          : `当前数据源：${ds.name}${routed?.ds ? '（按问题自动选择）' : ''}。该成员可用的数据源：\n${await this.datasourceCatalog(allowedDs)}`)
        : `数据源：${ds.name}。`
      // Card layout, the no-questions rule and viewer limits live in the bot preset (cordis.patch.yml, nl2sql-bot);
      // the message carries only who asks where and the data source note, which change per message.
      const prompt = `[${name}${where} · ${actor.name}${actor.role === 'viewer' ? ' · 只读成员' : ''}] ${text}\n\n（${dsLine}）`
      const requestId = platform === 'lark' ? `lark-${m.messageId}` : `${platform}-${m.chatId}-${m.messageId}`
      if (conv.sessionId && this.state.sessions[conv.sessionId] !== ds.id) { this.state.sessions[conv.sessionId] = ds.id; await this.save() }
      const group = { key: `bot-${m.channelId ?? platform}`, title: channel ? `${name} · ${channel.name}` : `${name}机器人` }
      // Conversations started before sessions were grouped by channel move to a new session in the group once.
      if (conv.sessionId && conv.group !== group.key && !this.state.settings.botCwd) conv.sessionId = null
      conv.group = group.key
      // Sessions created before the bot preset existed run the page preset (no card rules): start a new one once.
      if (conv.sessionId && conv.preset !== BOT_PRESET_ID) conv.sessionId = null
      conv.preset = BOT_PRESET_ID
      // The turn outlasts the data source's query time limit (up to 10 min) by two minutes, and is at least 10 minutes.
      const turnTimeoutMs = Math.min(720000, Math.max(600000, (this.settingsFor(ds).timeoutMs ?? 15000) + 120000))
      const turn = await this.runAgentTurn({ sessionId: conv.sessionId, title: `${name} · ${conv.chatName ?? actor.name}`, requestId, text: prompt, prepare, timeoutMs: turnTimeoutMs, group, preset: BOT_PRESET_ID })
      const usedDs = this.findDatasource(this.state.sessions[conv.sessionId]) ?? ds
      if (usedDs.id !== conv.datasourceId) { conv.datasourceId = usedDs.id; convs[key] = conv }
      let body = turn.text
      if (turn.reason === 'timeout') body = `${body ? `${body}\n\n` : ''}<font color='grey'>（查询超过 ${Math.round(turnTimeoutMs / 60000)} 分钟仍未完成，已停止。请缩小范围后重试。）</font>`
      if (turn.reason === 'input-required') body = `${body ? `${body}\n\n` : ''}<font color='grey'>（需要在 Harness 中确认后才能继续，已取消本次回答。）</font>`
      const results = selectReplyResults(turn.resultIds.map(id => this.lookupResult(id)).filter(Boolean).filter(r => { try { this.assertResultAccess(r, { ...actor, kind: platform }); return true } catch { return false } }))
      // Buttons (拆分 / 为什么变化 / 明细 / 固定到看板) carry opaque tokens only.
      const shown = buttons ? await this.withResultActions(results, { actor, sessionId: conv.sessionId, channelId: m.channelId, platform, chatId: m.chatId, chatType: m.chatType, replyTo: m.messageId, depth: 0 }) : results
      let status = turn.reason === 'idle' ? 'ok' : 'error'
      let error = turn.reason === 'idle' ? undefined : turn.reason
      try {
        await m.reply({ title: text.length > 40 ? `${text.slice(0, 40)}…` : text, text: body || '（没有生成文字回答）', results: shown, footer: `数据问答 · ${usedDs.name} · ${actor.name}` })
      } catch (e) {
        status = 'error'
        error = e.message
        await reply(String(body || e.message).slice(0, 3000))
      }
      void Promise.resolve(m.react?.(status === 'ok' ? 'done' : 'failed')).catch(() => {})
      this.recordDelivery({ channel: { id: m.channelId ?? SOURCE(platform), name: `${name}机器人 · ${conv.chatName ?? actor.name}`, platform }, title: text.slice(0, 60), status, ...(error ? { error } : {}), results: results.length, source: SOURCE(platform), sessionId: conv.sessionId, elapsedMs: Date.now() - started })
      await this.save()
    })
  },

  /**
   * Pick the data source a question is about, among `candidates`, only on
   * strong evidence: the question names the source (name / database /
   * description), or it matches that source's business knowledge (verified
   * examples, metrics, glossary). Schema keyword overlap alone is too weak
   * (English table names vs Chinese questions), so otherwise returns null and
   * the agent chooses from the catalog in the prompt.
   */
  async routeDatasource(question, candidates) {
    const q = String(question ?? '').toLowerCase()
    const scored = candidates.map(d => {
      const named = [d.name, d.database, d.description].filter(x => x && String(x).length >= 2).some(x => q.includes(String(x).toLowerCase()))
      let know = 0
      try {
        const f = this.searchKnowledge(d.id, question, 5)
        know = Math.max(0, ...f.examples.map(x => x.score), ...f.metrics.map(x => x.score), ...f.glossary.map(x => x.score))
      } catch {}
      return { ds: d, score: (named ? 2 : 0) + know }
    }).sort((a, b) => b.score - a.score)
    const [top, second] = scored
    if (!top || top.score < 0.5) return null
    return top.score - (second?.score ?? 0) >= 0.3 ? { ds: top.ds, score: top.score } : null
  },

  /** One line per data source for the bot prompt: name, type, description and main tables. */
  async datasourceCatalog(list) {
    const lines = []
    for (const d of list) {
      let tables = ''
      try {
        // Policy-filtered, like nl2sql_schema: hidden tables never reach the bot prompt.
        const schema = await this.cachedVisibleSchema(d)
        if (schema?.tables?.length) {
          const rank = { fact: 0, dimension: 1, view: 2, other: 3, log: 4, config: 5 }
          const top = [...schema.tables].sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3) || (b.rows ?? 0) - (a.rows ?? 0)).slice(0, 12)
          tables = `；主要表：${top.map(t => `${t.name}${t.comment ? `(${String(t.comment).split(/[\s,，。;；(（]/)[0].slice(0, 12)})` : ''}`).join(', ')}${schema.tables.length > 12 ? ` 等 ${schema.tables.length} 张` : ''}`
        }
      } catch {}
      lines.push(`- ${d.name}（${d.type ?? 'mysql'}${d.database ? ` · ${d.database}` : ''}）${d.description ? `：${d.description.slice(0, 60)}` : ''}${tables}`)
    }
    return lines.join('\n')
  },

  /** Run tasks with the same key one after another. */
  serialize(key, task) {
    this.queues ??= new Map()
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(task)
    this.queues.set(key, next)
    next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key) }).catch(() => {})
    return next
  },

  /** Bound the conversation map (most recent first). */
  pruneBotConversations() {
    const convs = Object.values(this.state.botConversations ?? {}).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
    if (convs.length > CONVERSATIONS_MAX) for (const c of convs.slice(CONVERSATIONS_MAX)) delete this.state.botConversations[c.key]
  },

  /**
   * Prompt an nl2sql session and collect exactly the answer of that prompt's
   * turn. Creates (or recreates, if archived / missing) the session, handles
   * timeouts and pending questions by cancelling the turn.
   * @returns {{ sessionId, text, resultIds, reason: 'idle'|'timeout'|'input-required' }}
   */
  /**
   * The Harness workspace (sidebar group) bot conversations of one channel live in:
   * a directory under the plugin's data dir per group, registered with the channel's
   * name as title (kept in sync on rename). Returns { workspaceId } or {} when the
   * workspace registry is unavailable or registration fails (sessions then stay ungrouped).
   */
  async sessionGroup(group) {
    const registry = this.ctx.get('workspaceRegistry')
    if (!group?.key || !registry?.create) return {}
    try {
      const dir = join(this.dir, 'workspaces', String(group.key).replace(/[^\w.-]+/g, '_').slice(0, 80))
      await mkdir(dir, { recursive: true })
      const ws = await registry.create(dir, group.title)
      if (group.title && ws.title !== group.title) { try { await ws.setTitle(group.title) } catch {} }
      return { workspaceId: ws.id }
    } catch (error) {
      console.warn('nl2sql bot: cannot register workspace group %s: %s', group.key, error.message)
      return {}
    }
  },

  async runAgentTurn({ sessionId, title, requestId, text, prepare, timeoutMs = 300000, group, preset = PRESET_ID }) {
    const controller = this.ctx.get('sessionController')
    const registry = this.ctx.get('workspaceRegistry')
    const create = async () => {
      // An explicit bot working directory (settings.botCwd) wins; otherwise sessions go to the group's workspace.
      const where = this.state.settings.botCwd ? { cwd: this.state.settings.botCwd } : await this.sessionGroup(group)
      const created = await controller.create({ agentPreset: preset, ...where })
      try { await controller.rename?.({ sessionId: created.sessionId, title }) } catch {}
      return created.sessionId
    }
    let sid = sessionId
    if (sid && (registry?.archivedSessionIds?.includes?.(sid))) sid = null
    if (!sid) sid = await create()
    await prepare?.(sid)
    const send = (id) => controller.prompt({ requestId, sessionId: id, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
    try {
      await send(sid)
    } catch (error) {
      const code = error?.code ?? ''
      if (!/not-found|archived|writer-held/.test(code) && !/not found|archived/i.test(error?.message ?? '')) throw error
      sid = await create()
      await prepare?.(sid)
      await send(sid)
    }
    const waited = await controller.wait({ sessionId: sid, timeoutMs, maxMessages: 1 }, new AbortController().signal)
    const reason = waited?.reason ?? 'idle'
    // cancel() is async on DSH controllers: a rejection must not become unhandled.
    if (reason !== 'idle') void Promise.resolve().then(() => controller.cancel({ sessionId: sid })).catch(() => {})
    const answer = await this.collectTurnByRequest(sid, requestId)
    return { sessionId: sid, reason, ...answer }
  },

  /** Session events (live or persisted). */
  async sessionEvents(sessionId) {
    const live = this.ctx.get('agents')?.get(sessionId)?.session
    const read = (session) => session.snapshotEvents()
    if (live) return read(live)
    const q = this.ctx.get('sessionQuery')
    return q ? q.inspectSession(sessionId, read) : []
  },

  /**
   * Answer of the turn started by the user message carrying `requestId`:
   * the last assistant text of that turn and the nl2sql resultIds it produced.
   */
  async collectTurnByRequest(sessionId, requestId) {
    const events = await this.sessionEvents(sessionId)
    const at = events.findIndex(e => e.type === 'user/message' && (e.data?.source?.rpcId === requestId || e.data?.source?.requestId === requestId))
    if (at < 0) return { text: '', resultIds: [] }
    let turn
    for (let i = at + 1; i < events.length; i++) {
      const e = events[i]
      if (e.type === 'turn/start') { turn = e.data.turn; break }
      if (e.data?.turn !== undefined) { turn = e.data.turn; break }
    }
    if (turn === undefined) return { text: '', resultIds: [] }
    let text = ''
    const resultIds = []
    for (const e of events.slice(at + 1)) {
      if (e.data?.turn !== undefined && e.data.turn !== turn) { if (e.data.turn > turn) break; continue }
      if (e.type === 'assistant/message') {
        const t = (e.data.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim()
        if (t) text = t
      }
      if (e.type === 'tool/result') {
        const meta = e.data.meta
        if (meta?.resultId) resultIds.push(meta.resultId)
        for (const r of meta?.results ?? []) if (r.resultId) resultIds.push(r.resultId)
      }
      if (e.type === 'turn/end' && e.data.turn === turn) break
    }
    return { text, resultIds: [...new Set(resultIds)] }
  },

  /** Back-compat for callers that only have the live session and a seq anchor. */
  collectTurnAnswer(sessionId, afterSeq) {
    const session = this.ctx.get('agents')?.get(sessionId)?.session
    if (!session) return { text: '', resultIds: [] }
    let text = ''
    const resultIds = []
    for (const e of session.snapshotEvents().filter(x => x.seq > afterSeq)) {
      if (e.type === 'assistant/message') { const t = (e.data.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim(); if (t) text = t }
      if (e.type === 'tool/result') { const meta = e.data.meta; if (meta?.resultId) resultIds.push(meta.resultId); for (const r of meta?.results ?? []) if (r.resultId) resultIds.push(r.resultId) }
    }
    return { text, resultIds: [...new Set(resultIds)] }
  },

  // ------------------------------------------------------------- action tokens

  /** In-memory token cache (legacy name kept for callers/tests). */
  get larkActionTokens() {
    return this.actionTokens
  },

  /** Store context for a message's buttons; returns the opaque token. */
  createActionToken(ctx) {
    const token = randomBytes(9).toString('base64url')
    const now = Date.now()
    const body = { resultId: ctx.resultId, sessionId: ctx.sessionId ?? null, channelId: ctx.channelId ?? null, platform: ctx.platform ?? 'lark', chatId: ctx.chatId ?? null, chatType: ctx.chatType === 'p2p' ? 'p2p' : 'group', replyTo: ctx.replyTo ?? null, depth: ctx.depth ?? 0, ownerRole: ctx.ownerRole ?? null }
    this.actionTokens ??= new Map()
    this.actionTokens.set(token, { ...body, created: now })
    while (this.actionTokens.size > ACTION_TOKEN_MAX) this.actionTokens.delete(this.actionTokens.keys().next().value)
    try {
      this.store?.putActionToken(token, body, now)
      if ((this.actionTokenWrites = (this.actionTokenWrites ?? 0) + 1) % 200 === 0) this.store?.pruneActionTokens(ACTION_TOKEN_TTL_MS, ACTION_TOKEN_MAX)
    } catch {}
    return token
  },

  /** Context for a token, or undefined when unknown / expired. */
  lookupActionToken(token, now = Date.now()) {
    if (typeof token !== 'string' || !/^[\w-]{8,32}$/.test(token)) return undefined
    let ctx = this.actionTokens?.get(token)
    if (!ctx) { try { ctx = this.store?.getActionToken(token) } catch {} }
    if (!ctx || now - ctx.created > ACTION_TOKEN_TTL_MS) return undefined
    return ctx
  },

  createLarkActionToken(ctx) { return this.createActionToken({ platform: 'lark', ...ctx }) },
  lookupLarkActionToken(token, now) { return this.lookupActionToken(token, now) },

  // ------------------------------------------------------------- building actions

  /**
   * ActionSpec for one result shown to `actor` in a chat, or undefined when
   * nothing applies. Never throws.
   */
  async resultActions(result, { actor, sessionId, channelId, platform, chatId, chatType, replyTo, depth = 0 } = {}) {
    try {
      if (!result?.resultId || result.error || depth >= ACTION_MAX_DEPTH) return undefined
      const ds = this.findDatasource(result.datasourceId)
      if (!ds) return undefined
      const dialect = ds.type ?? 'mysql'
      const role = actor?.role ?? 'analyst'
      const token = this.createActionToken({ resultId: result.resultId, sessionId, channelId, platform, chatId, chatType, replyTo, depth, ownerRole: role })
      const aggregate = hasAggregate(result, dialect)
      const rows = result.rows?.length ?? 0
      // Nothing to analyse in empty results; point lookups (one order / one id) and single rows
      // are not dashboard material and have no dimension to split by.
      if (rows === 0) return undefined
      const lookup = isPointLookup(result, dialect)
      const buttons = []
      let select
      if (aggregate && rows > 1 && !lookup) {
        let dims = []
        try { dims = (await this.drillDimensions(result.resultId)).dimensions } catch {}
        const xName = result.chart?.x
        dims = dims.filter(d => d.column !== xName && d.column.split('.').pop() !== xName).slice(0, 6)
        if (dims.length) select = { placeholder: '按维度拆分', value: { a: 'drill', t: token }, options: dims.map(d => ({ text: d.label && d.label !== d.column ? `${d.label}（${d.column}）` : d.column, value: d.column })) }
      }
      const xi = result.chart?.x ? result.columns.findIndex(c => c.name === result.chart.x) : -1
      const points = xi >= 0 ? result.rows.filter(r => r[xi] !== null && r[xi] !== undefined).length : 0
      const timeLike = xi >= 0 && (result.columns[xi].kind === 'time' || ['line', 'area'].includes(result.chart?.type))
      if (aggregate && timeLike && points >= 2) buttons.push({ text: '为什么变化', value: { a: 'why', t: token } })
      if (aggregate && !lookup && xi >= 0 && points >= 1 && role !== 'viewer') buttons.push({ text: '明细', value: { a: 'detail', t: token } })
      if ((role === 'admin' || role === 'analyst') && !lookup && (aggregate || rows > 1)) buttons.push({ text: '固定到看板', value: { a: 'pin', t: token } })
      if (!select && !buttons.length) return undefined
      return { ...(select ? { select } : {}), buttons }
    } catch (error) {
      console.warn('nl2sql bot: cannot build actions: %s', error.message)
      return undefined
    }
  },

  /** Results with their ActionSpec attached as `actions`. */
  async withResultActions(results, ctx) {
    const out = []
    for (const r of results) {
      const actions = await this.resultActions(r, ctx)
      out.push(actions ? { ...r, actions } : r)
    }
    return out
  },

  larkCardActions(result, ctx) { return this.resultActions(result, { platform: 'lark', ...ctx }) },
  withLarkCardActions(results, ctx) { return this.withResultActions(results, { platform: 'lark', ...ctx }) },

  // ------------------------------------------------------------- clicks

  /**
   * An InboundAction. Authorizes synchronously and returns a toast quickly
   * (Lark waits at most 3 s); the analysis runs in the background and replies
   * in the chat with a new message.
   */
  async handleBotAction(a) {
    if (!a?.operator?.id) return undefined
    const platform = a.platform ?? 'lark'
    const operatorId = String(a.operator.id)
    const verb = a.value?.a
    const ctx = this.lookupActionToken(a.value?.t)
    const deny = (msg, detail) => { this.auditAdmin(`${SOURCE(platform)}.action.denied`, `${operatorId} · ${verb ?? '?'} · ${detail ?? msg}`); return toast('error', msg) }
    // Per-operator rate limit.
    this.actionRate ??= new Map()
    const now = Date.now()
    const rateKey = `${platform}:${operatorId}`
    const last = this.actionRate.get(rateKey) ?? 0
    if (now - last < ACTION_RATE_MS) return toast('warning', '操作太频繁，请稍后再试。')
    this.actionRate.set(rateKey, now)
    if (this.actionRate.size > 2000) for (const [k, t] of this.actionRate) if (now - t > ACTION_RATE_MS) this.actionRate.delete(k)

    if (!ACTIONS.has(verb) || !ctx) return deny('该按钮已过期或无效，请重新提问。', 'unknown/expired token')
    if ((ctx.platform ?? 'lark') !== platform || (ctx.channelId && a.channelId && ctx.channelId !== a.channelId)) return deny('该按钮不属于当前机器人。', 'channel mismatch')
    if (ctx.chatId && a.chatId && String(ctx.chatId) !== String(a.chatId)) return deny('该按钮不属于当前聊天。', 'chat mismatch')
    // Who clicked: resolved from our member list, never from the callback value.
    const chatId = ctx.chatId ?? a.chatId
    const resolved = this.resolveActor({ platform, userId: operatorId, email: a.operator.email, name: a.operator.name, chatId: chatId != null ? String(chatId) : chatId, chatType: ctx.chatType ?? 'group' })
    if (resolved.refused) return deny(resolved.refused, 'actor refused')
    const actor = { ...resolved.actor, kind: platform }
    const r = this.lookupResult(ctx.resultId)
    if (!r) return deny('结果已过期，请重新提问。', 'result expired')
    try { this.assertResultAccess(r, actor) } catch (error) { return deny(toUserError(error).message, `${actor.name}: ${error.message}`) }
    if (actor.role === 'viewer') {
      // Viewers may only act on governed results (produced under viewer rules, or a verified example / dashboard SQL).
      const ds = this.findDatasource(r.datasourceId)
      const governed = ctx.ownerRole === 'viewer' || (ds && this.isVerifiedExample(ds, r.baseSql ?? r.sql))
      if (!governed || verb === 'detail' || verb === 'pin') return deny(verb === 'pin' ? '只读成员不能固定到看板。' : verb === 'detail' ? '只读成员不能查看明细数据。' : '只读成员只能分析指标库或已验证问答的结果。', `${actor.name}: viewer`)
    }
    if (verb === 'pin' && actor.role !== 'admin' && actor.role !== 'analyst') return deny('只有管理员或分析师可以固定到看板。', `${actor.name}: role ${actor.role}`)
    let dimension
    if (verb === 'drill') {
      dimension = typeof a.option === 'string' ? a.option : undefined
      let allowed = []
      try { allowed = (await this.drillDimensions(r.resultId)).dimensions.map(d => d.column) } catch {}
      if (!dimension || !allowed.includes(dimension)) return deny('请选择一个有效的拆分维度。', `invalid dimension ${String(dimension).slice(0, 40)}`)
    }
    const deliveryChannel = { id: a.channelId ?? SOURCE(platform), name: `${label(platform)}机器人 · ${actor.name}`, platform }

    if (verb === 'pin') {
      try {
        const widget = await this.pinWidget({ title: r.title || `${label(platform)}结果`, sql: r.baseSql ?? r.sql, datasourceId: r.datasourceId, chart: r.chart })
        const board = this.currentDashboardObj()
        this.auditAdmin(`${SOURCE(platform)}.pin`, `${actor.name} · ${widget.title} → ${board.name}`, actor)
        this.recordDelivery({ channel: deliveryChannel, title: `固定：${widget.title}`.slice(0, 60), status: 'ok', results: 0, source: SOURCE(platform), sessionId: ctx.sessionId, elapsedMs: Date.now() - now })
        await this.save()
        return toast('success', `已固定到看板「${board.name}」`)
      } catch (error) {
        return toast('error', `固定失败：${toUserError(error).message}`.slice(0, 200))
      }
    }

    const job = this.runBotAction({ verb, ctx, r, actor, dimension, a, deliveryChannel })
    this.botActionJobs ??= new Set()
    this.botActionJobs.add(job)
    job.finally(() => this.botActionJobs.delete(job)).catch(() => {})
    return toast('info', '正在分析…')
  },

  async runBotAction({ verb, ctx, r, actor, dimension, a, deliveryChannel }) {
    const platform = a.platform ?? 'lark'
    const started = Date.now()
    const replyTo = ctx.replyTo ?? a.messageId
    const what = verb === 'drill' ? `拆分：${dimension}` : verb === 'why' ? '为什么变化' : `明细：${r.chart?.x ?? ''}`
    const footer = `数据问答 · ${r.datasourceName ?? ''} · ${actor.name}`
    let status = 'ok'
    let error
    let resultsCount = 0
    try {
      let message
      if (verb === 'drill' || verb === 'detail') {
        let xValue
        if (verb === 'detail') {
          const xi = r.columns.findIndex(c => c.name === r.chart?.x)
          xValue = r.rows.map(row => row[xi]).filter(v => v !== null && v !== undefined).at(-1)
        }
        const out = await this.drill({ resultId: r.resultId, mode: verb === 'drill' ? 'breakdown' : 'detail', dimension, xValue, sessionId: ctx.sessionId ?? undefined, actor, source: SOURCE(platform) })
        const results = [out] // replies carry no buttons
        resultsCount = 1
        message = { title: out.title || what, text: verb === 'detail' ? `「${r.title || '结果'}」在 ${r.chart?.x}=${xValue} 的明细（最多 200 行）。` : `「${r.title || '结果'}」按 ${dimension} 拆分。`, results, footer }
      } else {
        const out = await this.explainChange({ resultId: r.resultId, sessionId: ctx.sessionId ?? undefined, actor })
        const top = out.dimensions.find(d => d.attribution)
        const rows = (top?.attribution.items ?? []).slice(0, 8)
        const table = rows.length ? `\n\n| ${top.dimension} | ${out.baseline} | ${out.current} | 变化 |\n|---|---|---|---|\n${rows.map(i => `| ${i.value ?? 'NULL'} | ${i.baseline} | ${i.current} | ${i.delta >= 0 ? '+' : ''}${i.delta} |`).join('\n')}` : ''
        message = { title: `为什么变化 · ${r.title || ''}`.slice(0, 80), text: `${out.summary}${table}`, results: [], footer }
      }
      await a.reply(message, { replyTo })
    } catch (e) {
      status = 'error'
      error = toUserError(e).message
      const text = `${what} 失败：${error}`.slice(0, 1000)
      try { if (a.replyText) await a.replyText(text, { replyTo }); else await a.reply({ title: what, text }, { replyTo }) } catch {}
    }
    this.auditAdmin(`${SOURCE(platform)}.action`, `${actor.name} · ${what} · ${r.resultId}${error ? ` · ${error}` : ''}`, actor)
    this.recordDelivery({ channel: deliveryChannel, title: what.slice(0, 60), status, ...(error ? { error } : {}), results: resultsCount, source: SOURCE(platform), sessionId: ctx.sessionId, elapsedMs: Date.now() - started })
    await this.save()
  },
}
