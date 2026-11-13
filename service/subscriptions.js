/**
 * Feature: subscriptions and alerts created from IM chats (bot sessions).
 *
 * A bot conversation (state.botConversations[*] = { sessionId, channelId, chatId,
 * chatType, platform, chatName }) lets chat members say 「每天 9 点把这个发到群里」
 * or 「超过 X 提醒我」. The agent calls:
 *   - nl2sql_subscribe       → state.chatSubscriptions[] (own scheduler job `jobs_subscriptions`)
 *   - nl2sql_alert_create    → a normal alert (saveAlert) marked `chatTarget` so the alert
 *                              engine delivers to the originating chat and runs as the creator
 *   - nl2sql_subscriptions   → list / pause / resume / cancel what this chat created
 *
 * Delivery goes to the originating chat through the channel's own adapter with a copy of
 * the channel whose push target is replaced by the chat id (adapters are not modified).
 * Every run re-resolves the creator (resolveActor): removed / disabled members, members
 * who lost the role or the data source are skipped, the item is suspended (status +
 * lastError) and the chat is told once.
 */
import { needsAttachment, renderChartPng } from '../channels/message.js'
import { ChannelError } from '../channels/http.js'
import { kindOf, loadAdapters } from '../channels/index.js'
import { writeXlsx } from '../xlsx.js'
import { chartModesOf, clip, channelUserError } from './channels.js'
import { UserError, newId, pick } from './shared.js'

const PERIODS = ['daily', 'weekly', 'monthly']
const GRAINS = ['hour', 'day', 'week', 'month', 'year']
const RANGES = ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear']
const MAX_PER_CHAT = 30
const CREATOR_ROLES = ['admin', 'analyst']

/**
 * Per-chat target fields of a channel kind, or undefined when the kind cannot
 * address an arbitrary chat. Known kinds are explicit; other kinds (third-party
 * adapters) use the field marked `target: true`.
 */
export function chatTargetPatch(kind, chatId, { chatType, userId } = {}) {
  const id = String(chatId)
  switch (kind?.id) {
    case 'lark_app': return { receiveIdType: 'chat_id', receiveId: id }
    case 'telegram_bot': return { chatId: id }
    case 'dingtalk_app': return chatType === 'p2p' ? (userId ? { openConversationId: '', userId: String(userId) } : undefined) : { openConversationId: id, userId: '' }
    case 'wecom_aibot': return { chatId: id, chatType: chatType === 'p2p' ? 'single' : 'group' }
    case 'lark_webhook': case 'wecom_webhook': case 'dingtalk_webhook': return undefined
    default: {
      const f = (kind?.fields ?? []).find(x => x.target && !(x.secret || x.type === 'secret'))
      return f ? { [f.key]: id } : undefined
    }
  }
}

/** Most recent schedule slot (ms) at or before `now`, or undefined. */
export function lastSubscriptionSlot(sub, now = new Date()) {
  const [hh, mm] = String(sub.time ?? '09:00').split(':').map(Number)
  const base = new Date(now)
  for (let k = 0; k <= 62; k++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - k, hh, mm, 0, 0)
    if (d.getHours() !== hh || d.getMinutes() !== mm) continue // DST gap
    if (d.getTime() > base.getTime()) continue
    if (sub.period === 'weekly') {
      const wd = d.getDay() === 0 ? 7 : d.getDay()
      if (!(sub.weekdays ?? []).includes(wd)) continue
    } else if (sub.period === 'monthly') {
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      if (d.getDate() !== Math.min(sub.monthDay ?? 1, dim)) continue
    }
    return d.getTime()
  }
  return undefined
}

/** Next slot after `now` (for display). */
export function nextSubscriptionSlot(sub, now = new Date()) {
  for (let k = 1; k <= 400; k++) {
    const probe = new Date(now.getTime() + k * 86400000)
    const s = lastSubscriptionSlot(sub, probe)
    if (s !== undefined && s > now.getTime()) {
      // The earliest slot after now: walk back while an earlier slot is still after now.
      let best = s
      for (let j = k - 1; j >= 0; j--) { const e = lastSubscriptionSlot(sub, new Date(now.getTime() + j * 86400000 + 86399999)); if (e !== undefined && e > now.getTime() && e < best) best = e }
      return best
    }
  }
  return undefined
}

function scheduleText(sub) {
  const w = ['一', '二', '三', '四', '五', '六', '日']
  if (sub.period === 'weekly') return `每周${(sub.weekdays ?? []).map(d => w[d - 1]).join('、')} ${sub.time}`
  if (sub.period === 'monthly') return `每月 ${sub.monthDay} 日 ${sub.time}`
  return `每天 ${sub.time}`
}

function hhmm(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new UserError('nl2sql/invalid', '时间格式应为 HH:MM，例如 09:00')
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

export const methods = {
  // ---------------------------------------------------------------- chat context

  /** The bot conversation a session belongs to, or undefined (page / local sessions). */
  chatForSession(sessionId) {
    if (!sessionId) return undefined
    return Object.values(this.state.botConversations ?? {}).filter(c => c && c.sessionId === sessionId && c.channelId && c.chatId != null).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
  },

  /** Conversation + live actor of a bot session; throws a clear message elsewhere. */
  requireChatContext(sessionId) {
    const conv = this.chatForSession(sessionId)
    if (!conv) throw new UserError('nl2sql/not-chat', '群订阅和群告警只能在 IM 机器人的聊天中创建。页面用户请在「数据问答 → 管理 → 告警与报告」中设置定时报告和告警。')
    const sa = this.state.sessionActors?.[sessionId]
    const platform = conv.platform ?? sa?.platform ?? 'lark'
    let userId
    let memberId
    const member = sa?.id ? (this.state.users ?? []).find(u => u.id === sa.id) : undefined
    if (member) {
      memberId = member.id
      userId = (member.identities ?? []).find(i => i.platform === platform)?.id
    } else if (sa?.id && String(sa.id).startsWith(`${platform}:`)) {
      userId = String(sa.id).slice(platform.length + 1)
    }
    const createdBy = { platform, userId: userId ?? null, name: sa?.name ?? userId ?? '?', memberId: memberId ?? null, email: member?.email }
    const resolved = this.resolveCreator(createdBy, conv)
    return { conv, platform, createdBy, ...resolved }
  },

  /** Re-resolve a creator now → { actor } | { refused }. */
  resolveCreator(createdBy, chat) {
    if (!createdBy?.userId && !createdBy?.email) return { refused: '无法确认创建者身份' }
    const resolved = this.resolveActor({ platform: createdBy.platform, userId: createdBy.userId ?? undefined, email: createdBy.email, name: createdBy.name, chatId: chat?.chatId != null ? String(chat.chatId) : undefined, chatType: chat?.chatType ?? 'group' })
    if (resolved.refused) return resolved
    if (createdBy.memberId && resolved.actor.id !== createdBy.memberId) return { refused: `成员「${createdBy.name}」已被移除或停用` }
    return resolved
  },

  /** The channel kind of a chat and its target patch; throws when the kind has no per-chat target. */
  chatDeliveryTarget(channelId, chatId, opts = {}) {
    const c = this.state.channels.find(x => x.id === channelId)
    if (!c) throw new UserError('nl2sql/unknown-channel', '该聊天所属的机器人渠道已被删除')
    const found = kindOf(c.type)
    if (!found) throw new UserError('nl2sql/invalid', `不支持的渠道类型：${c.type}（对应的渠道插件未加载）`)
    const patch = chatTargetPatch(found.kind, chatId, opts)
    if (!patch) throw new UserError('nl2sql/invalid', `「${found.kind.label?.zh ?? found.kind.id}」渠道不能按聊天主动推送，无法在这里订阅或设置告警`)
    return { c, kind: found.kind, patch }
  },

  /**
   * Send an OutboundMessage-like `{ title, text, results?, footer?, mentionAll? }` to one chat
   * of a bot channel: the kind's send() with a channel copy targeting `chatId`.
   */
  async deliverToChat(channelId, chatId, message, { chatType, userId, source = 'subscription', attachFull } = {}) {
    await loadAdapters()
    const { c, kind, patch } = this.chatDeliveryTarget(channelId, chatId, { chatType, userId })
    const base = this.adapterChannel(c)
    const channel = { ...base, ...patch, config: { ...(c.config ?? {}), ...patch } }
    const modes = chartModesOf(kind)
    const caps = kind.capabilities ?? {}
    const results = (message.results ?? []).slice(0, 10)
    const body = message.text ? String(message.text).slice(0, 20000) : ''
    const out = {
      title: clip(String(message.title || results[0]?.title || '').trim() || '数据问答', 100),
      text: body,
      chartMode: modes.includes(c.chartMode) ? c.chartMode : modes[0],
      results: results.map(r => ({ ...pick(r, ['title', 'columns', 'rows', 'rowCount', 'truncated', 'chart', 'sql', 'filters', 'error']), ...(r.title ? { title: clip(String(r.title), 100) } : {}) })),
      includeSql: false,
      mentionAll: Boolean(message.mentionAll ?? /<at\s+id\s*=\s*["']?all["']?\s*>/i.test(body)),
      footer: message.footer ?? `数据问答 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    }
    // Groups that forbid full-data attachments (chat policy) get the card only.
    const chatMember = (this.state.users ?? []).find(u => u.kind === 'chat' && (u.identities ?? []).some(i => i.platform === c.platform && i.id === String(chatId)))
    const noAttach = Boolean(this.chatPolicyOf?.(chatMember)?.noAttachments)
    if (caps.files && !noAttach && (attachFull ?? c.attachFull ?? true)) {
      const shown = caps.tableRows ?? 10
      const idx = out.results.map((r, i) => (needsAttachment(r, shown) ? i : -1)).filter(i => i >= 0)
      if (idx.length) {
        const buffer = writeXlsx(idx.map(i => ({ name: out.results[i].title || `结果${i + 1}`, columns: out.results[i].columns, rows: out.results[i].rows })), { creator: 'DeepSeek Harness 数据问答' })
        const safe = String(out.title).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '数据'
        out.attachment = { buffer, fileName: `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`, resultIndexes: idx }
      }
    }
    const conv = Object.values(this.state.botConversations ?? {}).find(x => x?.channelId === channelId && String(x.chatId) === String(chatId))
    const rec = { id: c.id, name: `${c.name} · ${conv?.chatName ?? chatId}`, platform: c.platform }
    const started = Date.now()
    try {
      if (c.needsSecret) throw new ChannelError('channel/config', `渠道「${c.name}」需要重新填写密钥后才能使用`)
      const sent = await kind.send(channel, await this.channelSecrets(c), out, { renderChartPng, logger: console, fetch: globalThis.fetch })
      this.recordDelivery({ channel: rec, title: out.title, status: 'ok', results: out.results.length, images: sent?.images, files: sent?.files, ...(sent?.warning ? { error: sent.warning } : {}), source, elapsedMs: Date.now() - started })
      return { ok: true, messageId: sent?.messageId ?? null, files: sent?.files ?? 0 }
    } catch (error) {
      this.recordDelivery({ channel: rec, title: out.title, status: 'error', error: error.message, results: out.results.length, source, elapsedMs: Date.now() - started })
      throw channelUserError(error)
    }
  },

  /** A previous result of this session usable by `actor` → its reusable definition. */
  chatSourceFromResult(sessionId, resultId, actor) {
    const r = this.lookupResult(resultId)
    if (!r) throw new UserError('nl2sql/result-expired', `结果 ${resultId} 已过期，请重新查询后再订阅`)
    const ofSession = this.records.list('history', { ref: r.datasourceId, since: (r.createdAt ?? 0) - 60000, limit: 5, filter: h => h.resultId === resultId })
    if (ofSession.length && !ofSession.some(h => h.sessionId === sessionId)) throw new UserError('nl2sql/access-denied', '只能订阅本聊天中查询过的结果')
    this.assertResultAccess(r, actor)
    return { datasourceId: r.datasourceId, sql: r.baseSql ?? r.sql, chart: r.chart, title: r.title }
  },

  chatItemsOf(channelId, chatId) {
    const same = (x) => x?.channelId === channelId && String(x.chatId) === String(chatId)
    return {
      subscriptions: (this.state.chatSubscriptions ?? []).filter(s => same(s)),
      alerts: (this.state.alerts ?? []).filter(a => same(a.chatTarget)),
    }
  },

  // ---------------------------------------------------------------- create

  async createChatSubscription(sessionId, input = {}) {
    const ctx = this.requireChatContext(sessionId)
    if (ctx.refused) throw new UserError('nl2sql/access-denied', ctx.refused)
    const actor = ctx.actor
    if (!CREATOR_ROLES.includes(actor.role)) throw new UserError('nl2sql/viewer', '只有管理员或分析师可以创建订阅；只读成员可以用「我的订阅」查看本群的订阅。')
    const { conv } = ctx
    this.chatDeliveryTarget(conv.channelId, conv.chatId, { chatType: conv.chatType, userId: ctx.createdBy.userId })
    if (this.chatItemsOf(conv.channelId, conv.chatId).subscriptions.length >= MAX_PER_CHAT) throw new UserError('nl2sql/invalid', `每个聊天最多 ${MAX_PER_CHAT} 个订阅，请先取消不需要的订阅`)
    const sub = { id: newId('sub'), createdAt: Date.now(), status: 'active', channelId: conv.channelId, chatId: String(conv.chatId), chatType: conv.chatType ?? 'group', platform: ctx.platform, chatName: conv.chatName ?? null, createdBy: ctx.createdBy }
    if (input.resultId) {
      Object.assign(sub, { source: 'sql' }, this.chatSourceFromResult(sessionId, input.resultId, { ...actor, kind: ctx.platform }))
    } else if (input.metric) {
      const ds = this.datasourceForSession(sessionId, input.datasource)
      this.assertAccess(actor, ds)
      const m = this.findMetric(ds, input.metric)
      if (!m) throw new UserError('nl2sql/unknown-metric', `指标库中没有「${input.metric}」`)
      Object.assign(sub, { source: 'metric', datasourceId: ds.id, metric: m.name, grain: input.grain && GRAINS.includes(input.grain) ? input.grain : undefined, range: input.range && RANGES.includes(input.range) ? input.range : (input.grain ? 'last30d' : 'yesterday'), title: m.name })
    } else {
      throw new UserError('nl2sql/invalid', '请提供要订阅的 resultId（本聊天中之前的查询结果）或指标名 metric')
    }
    const ds = this.requireDatasource(sub.datasourceId)
    this.assertAccess(actor, ds)
    sub.title = String(input.title || sub.title || '数据订阅').slice(0, 80)
    sub.period = PERIODS.includes(input.period) ? input.period : 'daily'
    sub.time = hhmm(input.time ?? '09:00')
    if (sub.period === 'weekly') {
      sub.weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : [1]).map(Number).filter(d => d >= 1 && d <= 7))].sort()
      if (!sub.weekdays.length) throw new UserError('nl2sql/invalid', 'weekdays 应为 1（周一）到 7（周日）')
    }
    if (sub.period === 'monthly') {
      sub.monthDay = Math.trunc(Number(input.monthDay ?? 1))
      if (!(sub.monthDay >= 1 && sub.monthDay <= 31)) throw new UserError('nl2sql/invalid', 'monthDay 应为 1–31')
    }
    this.state.chatSubscriptions = [...(this.state.chatSubscriptions ?? []), sub]
    this.auditAdmin('sub.create', `${sub.title} · ${scheduleText(sub)} → ${sub.chatName ?? sub.chatId}`, actor)
    await this.save()
    return this.publicSubscription(sub)
  },

  async createChatAlert(sessionId, input = {}) {
    const ctx = this.requireChatContext(sessionId)
    if (ctx.refused) throw new UserError('nl2sql/access-denied', ctx.refused)
    const actor = ctx.actor
    if (!CREATOR_ROLES.includes(actor.role)) throw new UserError('nl2sql/viewer', '只有管理员或分析师可以设置告警；只读成员可以用「我的订阅」查看本群的告警。')
    const { conv } = ctx
    this.chatDeliveryTarget(conv.channelId, conv.chatId, { chatType: conv.chatType, userId: ctx.createdBy.userId })
    if (this.chatItemsOf(conv.channelId, conv.chatId).alerts.length >= MAX_PER_CHAT) throw new UserError('nl2sql/invalid', `每个聊天最多 ${MAX_PER_CHAT} 个告警`)
    const def = {}
    if (input.resultId) {
      const s = this.chatSourceFromResult(sessionId, input.resultId, { ...actor, kind: ctx.platform })
      Object.assign(def, { source: 'sql', datasourceId: s.datasourceId, sql: s.sql, name: input.name || s.title })
    } else if (input.metric) {
      const ds = this.datasourceForSession(sessionId, input.datasource)
      Object.assign(def, { source: 'metric', datasourceId: ds.id, metric: input.metric, grain: input.grain ?? 'day', name: input.name || input.metric })
    } else {
      throw new UserError('nl2sql/invalid', '请提供要监控的 resultId（本聊天中之前的查询结果）或指标名 metric')
    }
    this.assertAccess(actor, this.requireDatasource(def.datasourceId))
    const cond = input.condition ?? {}
    const condition = { type: cond.type ?? 'threshold' }
    if (condition.type === 'threshold') Object.assign(condition, { op: cond.op ?? '>', value: Number(cond.value ?? 0) })
    if (condition.type === 'change') Object.assign(condition, { direction: cond.direction ?? 'any', pct: Number(cond.pct ?? 20) })
    if (condition.type === 'anomaly') Object.assign(condition, { z: Number(cond.z ?? 3) })
    const saved = await this.saveAlert({
      ...def, name: String(def.name || '群告警').slice(0, 60), condition,
      every: input.every ?? 'hour', at: input.at, cooldownMin: input.cooldownMin ?? 60, channelId: null, mention: false, enabled: true,
    })
    const stored = (this.state.alerts ?? []).find(a => a.id === saved.id) ?? saved
    stored.chatTarget = { channelId: conv.channelId, chatId: String(conv.chatId), chatType: conv.chatType ?? 'group', platform: ctx.platform, chatName: conv.chatName ?? null, mentionUser: Boolean(input.mentionMe) }
    stored.createdBy = ctx.createdBy
    this.auditAdmin('sub.alert.create', `${stored.name} → ${conv.chatName ?? conv.chatId}`, actor)
    await this.save()
    return this.publicChatAlert(stored)
  },

  // ---------------------------------------------------------------- views

  publicSubscription(s) {
    const ch = this.state.channels.find(c => c.id === s.channelId)
    return {
      kind: 'subscription', ...s, schedule: scheduleText(s),
      channelName: ch?.name ?? null, datasourceName: this.findDatasource(s.datasourceId)?.name ?? s.datasourceId,
      nextAt: s.status === 'active' ? (nextSubscriptionSlot(s) ?? null) : null,
    }
  },

  publicChatAlert(a) {
    const ch = this.state.channels.find(c => c.id === a.chatTarget?.channelId)
    const cond = a.condition ?? {}
    const condText = cond.type === 'threshold' ? `${cond.op} ${cond.value}` : cond.type === 'change' ? `变化 ${cond.direction ?? 'any'} ≥ ${cond.pct}%` : cond.type === 'anomaly' ? `异常 Z ≥ ${cond.z ?? 3}` : cond.type
    return {
      kind: 'alert', id: a.id, title: a.name, channelId: a.chatTarget?.channelId, chatId: a.chatTarget?.chatId, chatName: a.chatTarget?.chatName ?? null, platform: a.chatTarget?.platform,
      createdBy: a.createdBy ?? null, createdAt: a.createdAt, datasourceId: a.datasourceId, datasourceName: this.findDatasource(a.datasourceId)?.name ?? a.datasourceId,
      schedule: { '15m': '每 15 分钟检查', hour: '每小时检查', day: `每天 ${a.at ?? '09:00'} 检查` }[a.every] ?? a.every,
      condition: a.condition, conditionText: condText, metric: a.metric ?? null,
      status: a.chatStatus === 'suspended' ? 'suspended' : a.enabled ? 'active' : 'paused', state: a.state,
      lastDeliveredAt: a.lastFiredAt ?? null, lastRunAt: a.lastCheckedAt ?? null, lastError: a.lastError ?? null, channelName: ch?.name ?? null,
    }
  },

  /** Page: everything created from chats, grouped by chat. */
  listChatSubscriptions() {
    const groups = new Map()
    const add = (item) => {
      const key = `${item.channelId}:${item.chatId}`
      const g = groups.get(key) ?? { key, channelId: item.channelId, chatId: item.chatId, chatName: item.chatName, platform: item.platform, channelName: item.channelName, items: [] }
      if (!g.chatName && item.chatName) g.chatName = item.chatName
      g.items.push(item)
      groups.set(key, g)
    }
    for (const s of this.state.chatSubscriptions ?? []) add(this.publicSubscription(s))
    for (const a of this.state.alerts ?? []) if (a.chatTarget) add(this.publicChatAlert(a))
    return [...groups.values()]
  },

  /** pause | resume | delete one chat subscription or chat-created alert. */
  async setChatSubscription({ id, action } = {}, actor) {
    const sub = (this.state.chatSubscriptions ?? []).find(s => s.id === id)
    const alert = sub ? undefined : (this.state.alerts ?? []).find(a => a.id === id && a.chatTarget)
    if (!sub && !alert) throw new UserError('nl2sql/invalid', '订阅或告警不存在')
    if (!['pause', 'resume', 'delete'].includes(action)) throw new UserError('nl2sql/invalid', 'action 应为 pause / resume / delete')
    if (sub) {
      if (action === 'delete') this.state.chatSubscriptions = this.state.chatSubscriptions.filter(s => s.id !== id)
      else if (action === 'pause') sub.status = 'paused'
      else { sub.status = 'active'; delete sub.lastError; delete sub.notifiedAt; sub.lastSlot = Math.max(sub.lastSlot ?? 0, lastSubscriptionSlot(sub, new Date()) ?? 0) }
      this.auditAdmin(`sub.${action}`, sub.title, actor)
      await this.save()
      return action === 'delete' ? { deleted: id } : this.publicSubscription(sub)
    }
    if (action === 'delete') { this.auditAdmin('sub.alert.delete', alert.name, actor); return this.deleteAlert(id) }
    alert.enabled = action === 'resume'
    if (action === 'resume') { delete alert.chatStatus; delete alert.lastError; delete alert.chatNotifiedAt }
    this.auditAdmin(`sub.alert.${action}`, alert.name, actor)
    await this.save()
    this.scheduleAlerts()
    return this.publicChatAlert(alert)
  },

  // ---------------------------------------------------------------- run

  /** Tell a chat (once per suspension) that one of its items stopped. */
  async notifyChatOnce(item, target, text) {
    if (item.notifiedAt) return
    item.notifiedAt = Date.now()
    try { await this.deliverToChat(target.channelId, target.chatId, { title: '⏸ 订阅已暂停', text }, { chatType: target.chatType, userId: item.createdBy?.userId, source: 'subscription' }) } catch (error) { console.warn('nl2sql sub: notify failed: %s', error.message) }
  },

  /** Actor allowed to run an item now, or { refused } with the reason. */
  creatorCheck(createdBy, target, datasourceId) {
    const r = this.resolveCreator(createdBy, target)
    if (r.refused) return r
    if (!CREATOR_ROLES.includes(r.actor.role)) return { refused: `成员「${createdBy.name}」已不是管理员或分析师` }
    const ds = this.findDatasource(datasourceId)
    if (!ds) return { refused: '数据源已被删除' }
    try { this.assertAccess(r.actor, ds) } catch (error) { return { refused: error.message } }
    return { actor: { ...r.actor, kind: createdBy.platform } }
  },

  async runSubscription(id, { now = new Date(), slot } = {}) {
    const sub = (this.state.chatSubscriptions ?? []).find(s => s.id === id)
    if (!sub) throw new UserError('nl2sql/invalid', '订阅不存在')
    sub.lastSlot = slot ?? lastSubscriptionSlot(sub, now) ?? now.getTime()
    sub.lastRunAt = Date.now()
    const check = this.creatorCheck(sub.createdBy, sub, sub.datasourceId)
    if (check.refused) {
      sub.status = 'suspended'
      sub.lastError = check.refused
      await this.notifyChatOnce(sub, sub, `订阅「${sub.title}」已暂停：${check.refused}。请管理员在「数据问答 → 管理 → 群订阅」中处理。`)
      await this.save()
      return { skipped: true, reason: check.refused }
    }
    const actor = check.actor
    try {
      const result = sub.source === 'metric'
        ? await this.queryMetric({ datasourceId: sub.datasourceId, metric: sub.metric, grain: sub.grain, range: sub.range, title: sub.title, source: 'subscription', actor })
        : await this.runQuery({ sql: sub.sql, datasourceId: sub.datasourceId, title: sub.title, chart: sub.chart, source: 'subscription', actor, confirmScan: true })
      await this.deliverToChat(sub.channelId, sub.chatId, {
        title: `📬 ${sub.title}`,
        text: `<font color='grey'>${scheduleText(sub)} · 数据源：${result.datasourceName ?? ''} · 订阅人：${sub.createdBy?.name ?? ''}</font>`,
        results: [result],
        footer: `数据问答 · 群订阅 · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      }, { chatType: sub.chatType, userId: sub.createdBy?.userId, source: 'subscription' })
      sub.lastDeliveredAt = Date.now()
      delete sub.lastError
      await this.save()
      return { delivered: true, resultId: result.resultId }
    } catch (error) {
      sub.lastError = error.message
      await this.save()
      throw error
    }
  },

  jobs_subscriptions(now = new Date()) {
    return (this.state.chatSubscriptions ?? []).filter(s => s.status === 'active').map(s => ({
      id: `sub:${s.id}`,
      due: (n) => {
        const slot = lastSubscriptionSlot(s, n)
        return slot !== undefined && slot >= (s.createdAt ?? 0) && slot > (s.lastSlot ?? 0)
      },
      run: () => this.runSubscription(s.id, { now, slot: lastSubscriptionSlot(s, now) }),
    }))
  },

  // ---------------------------------------------------------------- alert engine hooks

  /**
   * Called by checkAlertInner for alerts with `chatTarget`: the creator's actor now.
   * Throws (after suspending the alert and telling the chat once) when the creator
   * lost access.
   */
  async chatAlertActor(a) {
    const check = this.creatorCheck(a.createdBy ?? {}, a.chatTarget, a.datasourceId)
    if (!check.refused) return check.actor
    const cur = (this.state.alerts ?? []).find(x => x.id === a.id)
    if (cur) {
      cur.enabled = false
      cur.chatStatus = 'suspended'
      cur.lastError = check.refused
      if (!cur.chatNotifiedAt) {
        cur.chatNotifiedAt = Date.now()
        try { await this.deliverToChat(cur.chatTarget.channelId, cur.chatTarget.chatId, { title: '⏸ 告警已暂停', text: `告警「${cur.name}」已暂停：${check.refused}。请管理员在「数据问答 → 管理 → 群订阅」中处理。` }, { chatType: cur.chatTarget.chatType, userId: cur.createdBy?.userId, source: 'alert' }) } catch (error) { console.warn('nl2sql sub: notify failed: %s', error.message) }
      }
      await this.save()
    }
    throw new UserError('nl2sql/access-denied', check.refused)
  },

  /** Push of a chat-created alert: same message as a channel push, to the chat. */
  async deliverAlertToChat(a, { title, text, resultIds = [] }) {
    const t = a.chatTarget
    const who = t.mentionUser && a.createdBy?.userId ? `<at id=${a.createdBy.userId}>${a.createdBy.name ?? ''}</at> ` : ''
    const results = resultIds.map(id => this.lookupResult(id)).filter(Boolean)
    return this.deliverToChat(t.channelId, t.chatId, { title, text: `${who}${text ?? ''}`, results }, { chatType: t.chatType, userId: a.createdBy?.userId, source: 'alert' })
  },
}

// ------------------------------------------------------------------ tools

function registerTools(ctx, service, { textBlock }) {
  const fail = (fn) => async (args, exec) => {
    try { return await fn(args ?? {}, exec) } catch (error) { throw error instanceof UserError ? new Error(error.message) : error }
  }
  const out = { schema: { type: 'object' }, render: (_args, value) => textBlock(JSON.stringify(value)) }
  const short = (x) => ({ id: x.id, kind: x.kind, title: x.title, schedule: x.schedule, ...(x.conditionText ? { condition: x.conditionText } : {}), datasource: x.datasourceName, status: x.status, createdBy: x.createdBy?.name, ...(x.lastError ? { lastError: x.lastError } : {}) })
  ctx.tools.register({
    name: 'nl2sql_subscribe',
    description: 'Only in IM bot chats: subscribe the CURRENT chat to a scheduled delivery of a result ("每天 9 点把这个发到群里", "每周一早上推送周报"). Source: resultId of a previous query in this chat (its SQL, chart and title are re-run at each delivery) or a metric name from the metric library (+grain/range, relative ranges stay relative). Schedule: time HH:MM local, period daily | weekly (weekdays 1=Mon…7=Sun) | monthly (monthDay). Only admin/analyst members may create. Refused outside bot chats.',
    parameters: {
      type: 'object',
      properties: {
        resultId: { type: 'string', description: 'resultId of a previous nl2sql_query / nl2sql_metric result in this chat.' },
        metric: { type: 'string', description: 'Metric name from the metric library (instead of resultId).' },
        grain: { type: 'string', enum: GRAINS, description: 'Metric time bucket.' },
        range: { type: 'string', enum: RANGES, description: 'Metric relative time range (default yesterday, or last30d with grain).' },
        datasource: { type: 'string', description: 'Data source id or name for metric; default: this chat\'s.' },
        title: { type: 'string', description: 'Short subscription title in the user\'s language.' },
        time: { type: 'string', description: 'Delivery time HH:MM (24h, local).' },
        period: { type: 'string', enum: PERIODS },
        weekdays: { type: 'array', items: { type: 'integer' }, description: 'weekly: days 1=Mon … 7=Sun.' },
        monthDay: { type: 'integer', description: 'monthly: day of month 1–31 (clamped to month length).' },
      },
      required: ['time', 'period'],
      additionalProperties: false,
    },
    output: out,
    presentCall: (args) => ({ card: 'generic', title: `订阅：${args?.title ?? args?.metric ?? ''}`, kind: 'edit' }),
    execute: fail(async (args, exec) => {
      const s = await service.createChatSubscription(exec.agent?.id, args)
      return { created: short(s), note: `已订阅，${s.schedule} 推送到本聊天。` }
    }),
  })
  ctx.tools.register({
    name: 'nl2sql_alert_create',
    description: 'Only in IM bot chats: create a data alert delivered to the CURRENT chat ("超过 X 提醒我", "下跌 20% 告诉我"). Source: resultId of a previous time-series query in this chat (first column time, last numeric column value) or a metric name (+grain). Condition: threshold {op, value} | change {direction up/down/any, pct} | anomaly {z}. every: 15m | hour | day (+at HH:MM). mentionMe=true @-mentions the asker. Only admin/analyst members may create.',
    parameters: {
      type: 'object',
      properties: {
        resultId: { type: 'string', description: 'resultId of a previous result in this chat.' },
        metric: { type: 'string', description: 'Metric name (instead of resultId).' },
        grain: { type: 'string', enum: ['hour', 'day', 'week', 'month'] },
        datasource: { type: 'string', description: 'Data source id or name for metric.' },
        name: { type: 'string', description: 'Short alert name.' },
        condition: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['threshold', 'change', 'anomaly'] },
            op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!='] },
            value: { type: 'number' },
            direction: { type: 'string', enum: ['up', 'down', 'any'] },
            pct: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['type'],
          additionalProperties: false,
        },
        every: { type: 'string', enum: ['15m', 'hour', 'day'] },
        at: { type: 'string', description: 'every=day: check time HH:MM.' },
        cooldownMin: { type: 'integer', description: 'Minutes between repeated notifications (default 60).' },
        mentionMe: { type: 'boolean', description: '@-mention the asker when it fires.' },
      },
      required: ['condition'],
      additionalProperties: false,
    },
    output: out,
    presentCall: (args) => ({ card: 'generic', title: `告警：${args?.name ?? args?.metric ?? ''}`, kind: 'edit' }),
    execute: fail(async (args, exec) => {
      const a = await service.createChatAlert(exec.agent?.id, args)
      return { created: short(a), note: `已设置告警（${a.schedule}），触发时发到本聊天。` }
    }),
  })
  ctx.tools.register({
    name: 'nl2sql_subscriptions',
    description: 'Only in IM bot chats: list the subscriptions and alerts created from the CURRENT chat ("我的订阅", "有哪些告警"), or pause / resume / cancel one by id ("取消订阅", "暂停这个告警"). Viewers may list only.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'pause', 'resume', 'cancel'] },
        id: { type: 'string', description: 'Subscription or alert id (from list) for pause / resume / cancel.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: out,
    isConcurrencySafe: (args) => args?.action === 'list',
    presentCall: (args) => ({ card: 'generic', title: args?.action === 'list' ? '本群订阅' : `订阅 · ${args?.action ?? ''}`, kind: args?.action === 'list' ? 'read' : 'edit' }),
    execute: fail(async (args, exec) => {
      const ctxc = service.requireChatContext(exec.agent?.id)
      const { conv } = ctxc
      const mine = service.chatItemsOf(conv.channelId, conv.chatId)
      const items = [...mine.subscriptions.map(s => service.publicSubscription(s)), ...mine.alerts.map(a => service.publicChatAlert(a))]
      if (args.action === 'list') return { chat: conv.chatName ?? conv.chatId, items: items.map(short) }
      if (ctxc.refused) throw new UserError('nl2sql/access-denied', ctxc.refused)
      if (!CREATOR_ROLES.includes(ctxc.actor.role)) throw new UserError('nl2sql/viewer', '只读成员只能查看订阅，不能暂停或取消。')
      if (!args.id || !items.some(x => x.id === args.id)) throw new UserError('nl2sql/invalid', `本聊天没有 id 为「${args.id ?? ''}」的订阅或告警，请先用 action=list 查看`)
      const r = await service.setChatSubscription({ id: args.id, action: args.action === 'cancel' ? 'delete' : args.action }, ctxc.actor)
      return { done: args.action, id: args.id, ...(r.deleted ? {} : { status: r.status }) }
    }),
  })
}

export const FEATURE = {
  name: 'subscriptions',
  methods,
  rpc: (service) => ({
    listChatSubscriptions: () => service.listChatSubscriptions(),
    setChatSubscription: (p) => service.setChatSubscription(p ?? {}),
    runChatSubscription: (p) => service.runSubscription(p?.id),
  }),
  tools: registerTools,
}
