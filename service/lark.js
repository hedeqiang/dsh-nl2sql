/**
 * Nl2SqlService methods: lark.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { addReaction, createLarkBot, getChatInfo, getUserInfo, replyText } from '../lark-bot.js'
import { PRESET_ID, UserError, hashText, oneOf, toUserError } from './shared.js'

export const methods = {
  // ------------------------------------------------------------- Lark bot

  /**
   * Inbound Lark bot: people @ the app bot in a group (or DM it); each chat
   * gets its own nl2sql session bound to a data source the sender may use.
   * Config: { enabled, channelId (lark_app channel providing credentials),
   * replyMode: 'card', sessionPerChat: true, allowP2p: true }.
   */
  larkBotConfig() {
    return { enabled: false, channelId: null, allowP2p: true, sessionScope: 'chat', ...(this.state.larkBot ?? {}) }
  },

  larkBotStatus() {
    const conf = this.larkBotConfig()
    const status = this.larkBot?.status() ?? { state: conf.enabled ? 'stopped' : 'idle', since: Date.now() }
    return { ...conf, status, bot: this.larkBot?.botInfo?.() ?? null, conversations: Object.values(this.state.larkSessions ?? {}).sort((a, b) => b.lastAt - a.lastAt).slice(0, 50) }
  },

  async saveLarkBot(input) {
    const conf = this.larkBotConfig()
    if (input.channelId !== undefined) {
      const ch = this.state.channels.find(c => c.id === input.channelId)
      if (input.channelId && (!ch || ch.type !== 'lark_app')) throw new UserError('nl2sql/invalid', '飞书机器人需要选择一个「应用机器人」类型的推送渠道（提供 App ID / Secret）')
      conf.channelId = input.channelId || null
    }
    if (input.enabled !== undefined) conf.enabled = Boolean(input.enabled)
    if (input.allowP2p !== undefined) conf.allowP2p = Boolean(input.allowP2p)
    if (input.sessionScope !== undefined) conf.sessionScope = oneOf(input.sessionScope, ['chat', 'user'], 'sessionScope')
    if (conf.enabled && !conf.channelId) throw new UserError('nl2sql/invalid', '请先选择应用机器人渠道')
    this.state.larkBot = conf
    this.auditAdmin('larkbot.save', `${conf.enabled ? '启用' : '停用'} · ${conf.channelId ?? ''}`)
    await this.save()
    await this.restartLarkBot()
    return this.larkBotStatus()
  },

  async restartLarkBot() {
    if (this.larkBot) { try { await this.larkBot.stop() } catch {} this.larkBot = undefined }
    const conf = this.larkBotConfig()
    if (!conf.enabled || this.disposed) return
    const ch = this.state.channels.find(c => c.id === conf.channelId)
    if (!ch) return
    const secrets = await this.channelSecrets(ch)
    this.larkCreds = { appId: ch.appId, appSecret: secrets.appSecret, domain: ch.domain === 'lark' ? 'lark' : 'feishu' }
    this.larkBot = createLarkBot({
      ...this.larkCreds,
      logger: { debug() {}, info() {}, warn: (...a) => console.warn('nl2sql lark:', ...a), error: (...a) => console.warn('nl2sql lark:', ...a) },
      onStatus: () => {},
      onMessage: (m) => { this.handleLarkMessage(m).catch(error => console.warn('nl2sql lark: handler failed: %s', error.message)) },
      onCardAction: (evt) => this.handleLarkCardAction(evt),
    })
    await this.larkBot.start()
  },

  /** One inbound message → permission check → session prompt → reply card. */
  async handleLarkMessage(m) {
    const conf = this.larkBotConfig()
    const creds = this.larkCreds
    if (!creds) return
    if (m.chatType === 'group' && !m.mentionedBot) return
    if (m.chatType === 'p2p' && !conf.allowP2p) return
    const text = (m.text ?? '').trim()
    if (!text) return
    const reply = (t) => replyText({ ...creds, messageId: m.messageId, text: t }).catch(() => {})
    try {
      await this.handleLarkMessageInner(m, text, conf, creds, reply)
    } catch (error) {
      console.warn('nl2sql lark: %s', error.message)
      await reply(`处理失败：${toUserError(error).message}`)
    }
  },

  async handleLarkMessageInner(m, text, conf, creds, reply) {
    let user = {}
    try { user = await getUserInfo({ ...creds, openId: m.sender.openId }) } catch {}
    const resolved = this.resolveLarkActor({ openId: m.sender.openId, email: user.email, name: user.name, chatId: m.chatId, chatType: m.chatType })
    if (resolved.refused) { await reply(resolved.refused); return }
    const actor = resolved.actor
    // Commands: 帮助 / 数据源 / 切换 <名称> / 新对话
    const cmd = text.match(/^\/?(帮助|help|数据源|切换数据源|切换|新对话|reset)\s*(.*)$/i)
    // Members with different scopes must not share a conversation: per-user sessions
    // whenever the sender's effective scope or rules differ from the chat's.
    const scopeSig = JSON.stringify([actor.datasourceIds, actor.role, actor.rowRules ?? []])
    const shared = conf.sessionScope !== 'user'
    let key = shared ? `${m.chatId}#${hashText(scopeSig)}` : `${m.chatId}:${m.sender.openId}`
    this.state.larkSessions ??= {}
    const conv = this.state.larkSessions[key] ?? { key, chatId: m.chatId, chatType: m.chatType, sessionId: null, datasourceId: actor.defaultDatasourceId, createdAt: Date.now() }
    const allowedDs = this.state.datasources.filter(d => !Array.isArray(actor.datasourceIds) || actor.datasourceIds.includes(d.id))
    if (conv.datasourceId && !allowedDs.some(d => d.id === conv.datasourceId)) conv.datasourceId = allowedDs[0]?.id ?? null
    if (cmd) {
      const verb = cmd[1].toLowerCase()
      if (verb === '帮助' || verb === 'help') { await reply(`直接 @我 提问即可，例如「上周每天的订单量」。\n命令：数据源（查看可用数据源）、切换 <名称>、新对话。\n当前数据源：${this.findDatasource(conv.datasourceId)?.name ?? '未选择'}${actor.role === 'viewer' ? '\n你是只读成员：可以查询指标库中的指标、已验证的常见问题和看板。' : ''}`); return }
      if (verb === '数据源') { await reply(`可用数据源：${allowedDs.map(d => d.name).join('、') || '无'}\n当前：${this.findDatasource(conv.datasourceId)?.name ?? '未选择'}`); return }
      if (verb === '新对话' || verb === 'reset') { conv.sessionId = null; this.state.larkSessions[key] = conv; await this.save(); await reply('已开始新对话。'); return }
      const target = allowedDs.find(d => d.name === cmd[2].trim() || d.id === cmd[2].trim())
      if (!target) { await reply(`找不到可用的数据源「${cmd[2]}」。可用：${allowedDs.map(d => d.name).join('、')}`); return }
      conv.datasourceId = target.id
      if (conv.sessionId) { this.state.sessions[conv.sessionId] = target.id }
      this.state.larkSessions[key] = conv
      await this.save()
      await reply(`已切换到数据源「${target.name}」。`)
      return
    }
    const ds = this.findDatasource(conv.datasourceId) ?? allowedDs[0]
    if (!ds) { await reply('没有可访问的数据源，请联系管理员。'); return }
    this.assertAccess(actor, ds)
    if (!this.ctx.get('sessionController')) { await reply('当前 Harness 不支持创建会话（缺少 sessionController）。'); return }
    void addReaction({ ...creds, messageId: m.messageId, emojiType: 'OnIt' })
    if (!conv.chatName && m.chatType === 'group') { try { conv.chatName = (await getChatInfo({ ...creds, chatId: m.chatId })).name } catch {} }
    // One prompt at a time per conversation, so each question gets its own answer.
    await this.serialize(`lark:${key}`, async () => {
      const started = Date.now()
      // Another message of this conversation may have created the session meanwhile.
      const latest = this.state.larkSessions[key]
      if (latest?.sessionId && !conv.sessionId) conv.sessionId = latest.sessionId
      const prepare = async (sessionId) => {
        conv.sessionId = sessionId
        conv.datasourceId = ds.id
        conv.lastAt = started
        conv.lastQuestion = text.slice(0, 200)
        conv.lastActor = actor.name
        this.state.larkSessions[key] = conv
        this.state.sessions[sessionId] = ds.id
        this.state.sessionActors ??= {}
        this.state.sessionActors[sessionId] = { id: actor.id, name: actor.name, kind: 'lark', datasourceIds: actor.datasourceIds, role: actor.role, rowRules: actor.rowRules ?? [] }
        await this.save()
      }
      const prompt = `[飞书${m.chatType === 'group' ? `群「${conv.chatName ?? m.chatId}」` : '私聊'} · ${actor.name}${actor.role === 'viewer' ? ' · 只读成员' : ''}] ${text}\n\n（回答会以飞书卡片发回该聊天：请用简洁的中文 Markdown 写结论，必要时附上查询结果；不要调用 nl2sql_send，也不要向用户提问——有歧义时说明你的假设后直接回答。${actor.role === 'viewer' ? '该成员是只读角色：只能用 nl2sql_metric 查询指标库，或复用 nl2sql_knowledge 中已验证的样例 SQL；不能自由编写 SQL。' : ''}）`
      const turn = await this.runAgentTurn({ sessionId: conv.sessionId, title: `飞书 · ${conv.chatName ?? actor.name}`, requestId: `lark-${m.messageId}`, text: prompt, prepare, timeoutMs: 600000 })
      let body = turn.text
      if (turn.reason === 'timeout') body = `${body ? `${body}\n\n` : ''}<font color='grey'>（查询超过 10 分钟仍未完成，已停止。请缩小范围后重试。）</font>`
      if (turn.reason === 'input-required') body = `${body ? `${body}\n\n` : ''}<font color='grey'>（需要在 Harness 中确认后才能继续，已取消本次回答。）</font>`
      const results = turn.resultIds.map(id => this.lookupResult(id)).filter(Boolean).filter(r => { try { this.assertResultAccess(r, { ...actor, kind: 'lark' }); return true } catch { return false } }).slice(-4)
      // Buttons (拆分 / 为什么变化 / 明细 / 固定到看板) carry opaque tokens only; see service/lark-actions.js.
      const withActions = await this.withLarkCardActions(results, { actor, sessionId: conv.sessionId, chatId: m.chatId, chatType: m.chatType, replyTo: m.messageId, depth: 0 })
      await this.replyLarkCard(creds, m.messageId, { title: text.length > 40 ? `${text.slice(0, 40)}…` : text, text: body || '（没有生成文字回答）', results: withActions, footer: `数据问答 · ${ds.name} · ${actor.name}` })
      void addReaction({ ...creds, messageId: m.messageId, emojiType: turn.reason === 'idle' ? 'DONE' : 'CrossMark' })
      this.recordDelivery({ channel: { id: 'larkbot', name: `飞书机器人 · ${conv.chatName ?? actor.name}` }, title: text.slice(0, 60), status: turn.reason === 'idle' ? 'ok' : 'error', ...(turn.reason === 'idle' ? {} : { error: turn.reason }), results: results.length, source: 'larkbot', sessionId: conv.sessionId, elapsedMs: Date.now() - started })
      await this.save()
    })
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

  /**
   * Prompt an nl2sql session and collect exactly the answer of that prompt's
   * turn. Creates (or recreates, if archived / missing) the session, handles
   * timeouts and pending questions by cancelling the turn.
   * @returns {{ sessionId, text, resultIds, reason: 'idle'|'timeout'|'input-required' }}
   */
  async runAgentTurn({ sessionId, title, requestId, text, prepare, timeoutMs = 300000 }) {
    const controller = this.ctx.get('sessionController')
    const registry = this.ctx.get('workspaceRegistry')
    const create = async () => {
      const created = await controller.create({ agentPreset: PRESET_ID, ...(this.state.settings.botCwd ? { cwd: this.state.settings.botCwd } : {}) })
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
    if (reason !== 'idle') { try { controller.cancel({ sessionId: sid }) } catch {} }
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
}
