/**
 * Nl2SqlService methods: access.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { ROLE_RANK, UserError, newId, oneOf, requireText, upsert } from './shared.js'

export const PLATFORM_LABEL = { lark: '飞书', telegram: 'Telegram', wecom: '企业微信', dingtalk: '钉钉' }
const PLATFORM_RE = /^[a-z][\w-]{0,31}$/

/** Validate and dedupe an identities array: [{ platform, id, email? }]. */
export function normalizeIdentities(list) {
  if (!Array.isArray(list)) throw new UserError('nl2sql/invalid', 'identities 必须是数组')
  const out = []
  for (const raw of list.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const platform = String(raw.platform ?? '').trim().toLowerCase()
    const id = String(raw.id ?? '').trim().slice(0, 200)
    const email = String(raw.email ?? '').trim().slice(0, 200)
    if (!id && !email) continue
    if (!PLATFORM_RE.test(platform)) throw new UserError('nl2sql/invalid', `无效的平台：${raw.platform ?? ''}`)
    if (!id) throw new UserError('nl2sql/invalid', `请填写 ${PLATFORM_LABEL[platform] ?? platform} 账号 ID`)
    if (out.some(i => i.platform === platform && i.id === id)) continue
    out.push({ platform, id, ...(email ? { email } : {}) })
  }
  return out
}

/** Keep the legacy larkOpenId / larkChatId fields mirroring the first Lark identity. */
function mirrorLegacyIds(u) {
  const lark = u.identities.find(i => i.platform === 'lark')?.id
  delete u.larkOpenId
  delete u.larkChatId
  if (lark) { if (u.kind === 'chat') u.larkChatId = lark; else u.larkOpenId = lark }
  return u
}

/** Legacy member fields → identities, in place (idempotent). */
export function normalizeUserRecord(u) {
  if (!u || typeof u !== 'object') return u
  if (!Array.isArray(u.identities)) {
    u.identities = []
    const legacy = u.kind === 'chat' ? (u.larkChatId ?? u.larkOpenId) : (u.larkOpenId ?? u.larkChatId)
    if (legacy) u.identities.push({ platform: 'lark', id: String(legacy) })
  }
  return mirrorLegacyIds(u)
}

/** Another member already owning one of u's identities (same platform + id) or its email. */
export function findIdentityClash(users, u) {
  const mail = u.email?.toLowerCase()
  return users.find(x => {
    if (x.id === u.id) return false
    const ids = normalizeUserRecord({ ...x, identities: x.identities ? [...x.identities] : undefined }).identities
    if (u.identities.some(a => ids.some(b => a.platform === b.platform && a.id === b.id))) return true
    return Boolean(mail && x.email && x.email.toLowerCase() === mail)
  })
}

export const methods = {
  // ------------------------------------------------------------ access

  /**
   * Actors (multi-user): the local page/agent owner has full access; Lark
   * users/chats are mapped to users with datasource scopes.
   */
  assertAccess(actor, ds) {
    if (!actor || actor.kind === 'owner') return
    const allowed = actor.datasourceIds
    if (Array.isArray(allowed) && !allowed.includes(ds.id)) throw new UserError('nl2sql/access-denied', `${actor.name ?? '当前用户'} 无权访问数据源「${ds.name}」`)
  },

  /** The actor a session runs as (Lark user, evaluation), or undefined for the local owner. */
  actorFor(sessionId) {
    return sessionId ? this.state.sessionActors?.[sessionId] : undefined
  },

  /** Viewer: only governed answers (metric library, verified examples, dashboards) — no free SQL. */
  assertCanWriteSql(actor, what = '自由编写 SQL') {
    if (actor?.role === 'viewer') throw new UserError('nl2sql/viewer', `当前成员是「只读」角色，不能${what}。只读成员可以：查询指标库中的指标（nl2sql_metric）、复用已验证的样例问答（nl2sql_knowledge search 后用样例 SQL 原样查询）、查看看板。请改用这些方式回答，或请管理员调整角色。`)
  },

  /** Whether a statement is (whitespace-insensitively) one of the verified example SQLs of the data source. */
  isVerifiedExample(ds, sql) {
    const norm = (q) => String(q ?? '').replace(/;\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const target = norm(sql)
    return this.knowledgeFor(ds.id).examples.some(e => norm(e.sql) === target) || this.state.dashboards.some(d => d.widgets.some(w => w.datasourceId === ds.id && norm(w.sql) === target))
  },

  /**
   * Row-level rules for an actor on a data source: [{ column, values }] combined
   * from the member and the group. Every query must be rewritable to include them.
   */
  rowRulesFor(actor, ds) {
    const rules = []
    for (const r of actor?.rowRules ?? []) if (!r.datasourceId || r.datasourceId === ds.id) rules.push({ column: r.column, values: r.values })
    return rules
  },

  /**
   * Members: people and group chats on IM platforms, each with a role
   * (admin | analyst | viewer), a data source scope and platform-scoped
   * identities [{ platform, id, email? }] (see docs/CHANNELS.md). The local
   * owner is implicit. Bot messages from unknown people fall back to
   * settings.botDefaultRole (none = refuse).
   */
  listUsers() {
    return (this.state.users ?? []).map(u => ({ ...normalizeUserRecord(u), datasourceNames: (u.datasourceIds ?? []).map(id => this.findDatasource(id)?.name ?? id) }))
  },

  async saveUser(input) {
    const existing = input.id ? (this.state.users ?? []).find(u => u.id === input.id) : undefined
    const u = existing ? normalizeUserRecord({ ...existing, identities: structuredClone(existing.identities ?? []) }) : { id: newId('u'), createdAt: Date.now(), identities: [] }
    u.kind = oneOf(input.kind ?? u.kind ?? 'person', ['person', 'chat'], 'kind')
    u.name = requireText(input.name ?? u.name, 'name', 60)
    u.role = oneOf(input.role ?? u.role ?? 'analyst', ['admin', 'analyst', 'viewer'], 'role')
    u.email = String(input.email ?? u.email ?? '').trim().slice(0, 200) || undefined
    if (input.identities !== undefined) {
      u.identities = normalizeIdentities(input.identities)
    } else {
      // Legacy single Lark ids: replace the Lark identity (an empty value removes it).
      const legacy = u.kind === 'chat' ? input.larkChatId : input.larkOpenId
      const other = u.kind === 'chat' ? input.larkOpenId : input.larkChatId
      if (legacy !== undefined || other !== undefined) {
        const value = String(legacy ?? '').trim().slice(0, 100)
        u.identities = u.identities.filter(i => i.platform !== 'lark')
        if (value) u.identities.unshift({ platform: 'lark', id: value })
      }
    }
    mirrorLegacyIds(u)
    if (u.kind === 'person' && !u.identities.length && !u.email) throw new UserError('nl2sql/invalid', '成员需要填写至少一个 IM 账号（如飞书 open_id、Telegram 用户 ID）或邮箱，用于识别身份')
    if (u.kind === 'chat' && !u.identities.length) throw new UserError('nl2sql/invalid', '群成员需要填写群 ID（如飞书 chat_id、Telegram chat id）')
    const allDs = input.allDatasources ?? (input.datasourceIds === undefined ? u.datasourceIds === null : false)
    u.datasourceIds = allDs ? null : (input.datasourceIds ?? u.datasourceIds ?? []).filter(id => this.findDatasource(id))
    u.defaultDatasourceId = input.defaultDatasourceId && this.findDatasource(input.defaultDatasourceId) ? input.defaultDatasourceId : (u.datasourceIds?.[0] ?? null)
    u.disabled = Boolean(input.disabled ?? u.disabled ?? false)
    u.note = String(input.note ?? u.note ?? '').slice(0, 300)
    if (input.rowRules !== undefined) {
      u.rowRules = (Array.isArray(input.rowRules) ? input.rowRules : []).map(r => ({
        datasourceId: r.datasourceId && this.findDatasource(r.datasourceId) ? r.datasourceId : null,
        column: requireText(r.column, 'rowRules.column', 64),
        values: (Array.isArray(r.values) ? r.values : String(r.values ?? '').split(/[,，]/)).map(v => String(v).trim()).filter(Boolean).slice(0, 200),
      })).filter(r => r.values.length).slice(0, 20)
      if (u.rowRules.some(r => !/^[A-Za-z_\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*$/.test(r.column))) throw new UserError('nl2sql/invalid', '行级规则的字段名只能包含字母、数字、下划线或中文')
    }
    const dup = findIdentityClash(this.state.users ?? [], u)
    if (dup) throw new UserError('nl2sql/duplicate', `该身份已属于成员「${dup.name}」`)
    u.updatedAt = Date.now()
    this.state.users = upsert(this.state.users ?? [], u)
    this.auditAdmin('user.save', `${u.name}（${u.role}）`)
    await this.save()
    return u
  },

  async deleteUser(id) {
    const u = (this.state.users ?? []).find(x => x.id === id)
    this.state.users = (this.state.users ?? []).filter(x => x.id !== id)
    if (u) this.auditAdmin('user.delete', u.name)
    await this.save()
    return { deleted: id }
  },

  /** Migrate legacy member fields to identities (idempotent). Returns true when something changed. */
  migrateUsers() {
    let changed = false
    for (const u of this.state.users ?? []) {
      const before = JSON.stringify(u)
      normalizeUserRecord(u)
      if (JSON.stringify(u) !== before) changed = true
    }
    return changed
  },

  /** Default role / data sources for unknown bot users (new keys, falling back to the legacy lark* keys). */
  botDefaults() {
    const s = this.state.settings
    return {
      role: s.botDefaultRole ?? s.larkDefaultRole ?? 'none',
      datasourceIds: s.botDefaultDatasourceIds !== undefined ? s.botDefaultDatasourceIds : s.larkDefaultDatasourceIds,
    }
  },

  /**
   * Resolve the effective actor for a bot message or action: the person's own
   * scope, narrowed by the chat's scope in group chats. People match by
   * (platform, userId) or email; chats by (platform, chatId).
   * Returns { actor } or { refused }.
   */
  resolveActor({ platform = 'lark', userId, email, name, chatId, chatType }) {
    const users = (this.state.users ?? []).filter(u => !u.disabled).map(u => normalizeUserRecord(u))
    const mail = email ? String(email).toLowerCase() : ''
    const person = users.find(u => u.kind === 'person' && userId && u.identities.some(i => i.platform === platform && i.id === String(userId)))
      ?? (mail ? users.find(u => u.kind === 'person' && ((u.email && u.email.toLowerCase() === mail) || u.identities.some(i => i.email && i.email.toLowerCase() === mail))) : undefined)
    const chat = chatType === 'group' && chatId ? users.find(u => u.kind === 'chat' && u.identities.some(i => i.platform === platform && i.id === String(chatId))) : undefined
    const defaults = this.botDefaults()
    const fallbackRole = defaults.role
    if (!person && !chat && fallbackRole === 'none') return { refused: `你还没有开通数据问答权限，请联系管理员在「数据问答 → 成员」中添加你的${PLATFORM_LABEL[platform] ?? platform}账号。` }
    const scopes = [person?.datasourceIds, chat?.datasourceIds].filter(x => x !== undefined)
    let datasourceIds = null
    for (const sc of scopes) if (Array.isArray(sc)) datasourceIds = datasourceIds === null ? [...sc] : datasourceIds.filter(id => sc.includes(id))
    if (!person && !chat) datasourceIds = defaults.datasourceIds ?? []
    const role = person?.role ?? chat?.role ?? fallbackRole
    if (Array.isArray(datasourceIds) && datasourceIds.length === 0) return { refused: '你在当前群里没有可访问的数据源。' }
    return {
      actor: {
        kind: platform, platform, id: person?.id ?? `${platform}:${userId}`, name: person?.name ?? name ?? userId,
        // Group chats: the narrower of the person's and the group's role.
        role: [person?.role, chat?.role, (!person && !chat) ? fallbackRole : undefined].filter(Boolean).sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b])[0] ?? role,
        userId, ...(platform === 'lark' ? { openId: userId } : {}), chatId, chatName: chat?.name, datasourceIds,
        rowRules: [...(person?.rowRules ?? []), ...(chat?.rowRules ?? [])],
        defaultDatasourceId: chat?.defaultDatasourceId ?? person?.defaultDatasourceId ?? (datasourceIds?.[0] ?? null),
      },
    }
  },

  /**
   * Remember an IM identity that talked to a bot (refused or not), so admins can
   * add it as a member with one click instead of looking up ids. Bounded list,
   * most recent first; keyed by (platform, kind, id).
   */
  noteSeenIdentity({ platform, kind, id, name, email, chatName, channelId, refused }) {
    if (!platform || !id) return
    this.state.seenIdentities ??= []
    const list = this.state.seenIdentities
    const key = `${platform}:${kind}:${id}`
    const i = list.findIndex(x => `${x.platform}:${x.kind}:${x.id}` === key)
    const prev = i >= 0 ? list.splice(i, 1)[0] : {}
    list.unshift({ ...prev, platform, kind, id: String(id), ...(name ? { name: String(name).slice(0, 60) } : {}), ...(email ? { email: String(email).slice(0, 200) } : {}), ...(chatName ? { chatName: String(chatName).slice(0, 80) } : {}), ...(channelId ? { channelId } : {}), lastAt: Date.now(), count: (prev.count ?? 0) + 1, refused: Boolean(refused) })
    if (list.length > 200) list.length = 200
  },

  /**
   * People and group chats that talked to a bot recently, for the member form:
   * [{ platform, kind:'person'|'chat', id, name?, email?, chatName?, lastAt, count, refused, memberId? }].
   * `memberId` is set when the identity already belongs to a member.
   */
  listSeenIdentities({ kind, platform } = {}) {
    const users = (this.state.users ?? []).map(u => normalizeUserRecord(u))
    // Group chats seen in bot conversations count too (older data has no seen list).
    const seen = [...(this.state.seenIdentities ?? [])]
    for (const c of Object.values(this.state.botConversations ?? {})) {
      if (c.chatType === 'group' && c.chatId && !seen.some(x => x.kind === 'chat' && x.platform === c.platform && x.id === String(c.chatId))) seen.push({ platform: c.platform ?? 'lark', kind: 'chat', id: String(c.chatId), chatName: c.chatName, name: c.chatName, lastAt: c.lastAt ?? c.createdAt, count: 1, refused: false })
    }
    return seen
      .filter(x => (!kind || x.kind === kind) && (!platform || x.platform === platform))
      .map(x => {
        const owner = users.find(u => u.kind === x.kind && u.identities.some(i => i.platform === x.platform && i.id === x.id))
        return { ...x, ...(owner ? { memberId: owner.id, memberName: owner.name } : {}) }
      })
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  },

  /** Back-compat alias of resolveActor for Lark. */
  resolveLarkActor({ openId, email, name, chatId, chatType }) {
    return this.resolveActor({ platform: 'lark', userId: openId, email, name, chatId, chatType })
  },

  auditAdmin(action, detail, actor) {
    this.records.put('admin', { id: newId('ad'), at: Date.now(), action, detail: String(detail).slice(0, 300), ...(actor ? { actor: { id: actor.id, name: actor.name, kind: actor.kind } } : {}) })
  },

  /** Per-actor usage for the members page. */
  usageByActor(days = 30) {
    const since = Date.now() - days * 86400000
    const by = new Map()
    for (const h of this.records.list('history', { since, limit: 100000 })) {
      const key = h.actor?.id ?? 'owner'
      const e = by.get(key) ?? { actorId: key, name: h.actor?.name ?? '本机', kind: h.actor?.kind ?? 'owner', queries: 0, errors: 0, blocked: 0, lastAt: 0 }
      e.queries++
      if (h.status === 'error') e.errors++
      if (h.status === 'blocked') e.blocked++
      e.lastAt = Math.max(e.lastAt, h.at)
      by.set(key, e)
    }
    return [...by.values()].sort((a, b) => b.queries - a.queries)
  },
}
