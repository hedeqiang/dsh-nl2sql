/**
 * Nl2SqlService methods: access.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { ROLE_RANK, UserError, newId, oneOf, requireText, upsert } from './shared.js'

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
   * Members: people (Lark open_id / email) and Lark chats, each with a role
   * (admin | analyst | viewer) and a data source scope. The local owner is
   * implicit. Lark messages from unknown people fall back to
   * settings.larkDefaultRole (none = refuse).
   */
  listUsers() {
    return (this.state.users ?? []).map(u => ({ ...u, datasourceNames: (u.datasourceIds ?? []).map(id => this.findDatasource(id)?.name ?? id) }))
  },

  async saveUser(input) {
    const existing = input.id ? (this.state.users ?? []).find(u => u.id === input.id) : undefined
    const u = existing ? { ...existing } : { id: newId('u'), createdAt: Date.now() }
    u.kind = oneOf(input.kind ?? u.kind ?? 'person', ['person', 'chat'], 'kind')
    u.name = requireText(input.name ?? u.name, 'name', 60)
    u.role = oneOf(input.role ?? u.role ?? 'analyst', ['admin', 'analyst', 'viewer'], 'role')
    u.larkOpenId = String(input.larkOpenId ?? u.larkOpenId ?? '').trim().slice(0, 100) || undefined
    u.email = String(input.email ?? u.email ?? '').trim().slice(0, 200) || undefined
    u.larkChatId = String(input.larkChatId ?? u.larkChatId ?? '').trim().slice(0, 100) || undefined
    if (u.kind === 'person' && !u.larkOpenId && !u.email) throw new UserError('nl2sql/invalid', '成员需要填写飞书 open_id 或邮箱，用于识别身份')
    if (u.kind === 'chat' && !u.larkChatId) throw new UserError('nl2sql/invalid', '群成员需要填写飞书 chat_id')
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
    const dup = (this.state.users ?? []).find(x => x.id !== u.id && ((u.larkOpenId && x.larkOpenId === u.larkOpenId) || (u.email && x.email === u.email) || (u.larkChatId && x.larkChatId === u.larkChatId)))
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

  /**
   * Resolve the effective actor for a Lark message: the person's own scope,
   * narrowed by the chat's scope in group chats. Returns { actor } or { refused }.
   */
  resolveLarkActor({ openId, email, name, chatId, chatType }) {
    const users = (this.state.users ?? []).filter(u => !u.disabled)
    const person = users.find(u => u.kind === 'person' && ((openId && u.larkOpenId === openId) || (email && u.email && u.email.toLowerCase() === String(email).toLowerCase())))
    const chat = chatType === 'group' ? users.find(u => u.kind === 'chat' && u.larkChatId === chatId) : undefined
    const fallbackRole = this.state.settings.larkDefaultRole ?? 'none'
    if (!person && !chat && fallbackRole === 'none') return { refused: '你还没有开通数据问答权限，请联系管理员在「数据问答 → 成员」中添加你的飞书账号。' }
    const scopes = [person?.datasourceIds, chat?.datasourceIds].filter(x => x !== undefined)
    let datasourceIds = null
    for (const sc of scopes) if (Array.isArray(sc)) datasourceIds = datasourceIds === null ? [...sc] : datasourceIds.filter(id => sc.includes(id))
    if (!person && !chat) datasourceIds = this.state.settings.larkDefaultDatasourceIds ?? []
    const role = person?.role ?? chat?.role ?? fallbackRole
    if (Array.isArray(datasourceIds) && datasourceIds.length === 0) return { refused: '你在当前群里没有可访问的数据源。' }
    return {
      actor: {
        kind: 'lark', id: person?.id ?? `lark:${openId}`, name: person?.name ?? name ?? openId,
        // Group chats: the narrower of the person's and the group's role.
        role: [person?.role, chat?.role, (!person && !chat) ? fallbackRole : undefined].filter(Boolean).sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b])[0] ?? role,
        openId, chatId, chatName: chat?.name, datasourceIds,
        rowRules: [...(person?.rowRules ?? []), ...(chat?.rowRules ?? [])],
        defaultDatasourceId: chat?.defaultDatasourceId ?? person?.defaultDatasourceId ?? (datasourceIds?.[0] ?? null),
      },
    }
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
