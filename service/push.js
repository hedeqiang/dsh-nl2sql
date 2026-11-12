/**
 * Nl2SqlService methods: push.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { ImError, RECEIVE_ID_TYPES, listBotChats, sendMessage } from '../im.js'
import { CREDENTIAL_SCOPE, UserError, newId, oneOf, pick, requireText, upsert } from './shared.js'

export const methods = {
  // ---------------------------------------------------------- IM channels

  publicChannel(c) {
    return { ...pick(c, ['id', 'name', 'type', 'domain', 'appId', 'receiveIdType', 'receiveId', 'description', 'isDefault', 'createdAt', 'updatedAt', 'lastSentAt', 'lastError', 'chartMode']), hasSecret: Boolean(c.hasSecret), hasSign: Boolean(c.hasSign), ...(c.needsSecret ? { needsSecret: true } : {}) }
  },

  listChannels() {
    return this.state.channels.map(c => this.publicChannel(c))
  },

  findChannel(ref) {
    if (!ref) return this.state.channels.find(c => c.isDefault) ?? (this.state.channels.length === 1 ? this.state.channels[0] : undefined)
    return this.state.channels.find(c => c.id === ref) ?? this.state.channels.find(c => c.name === ref)
  },

  requireChannel(ref) {
    const c = this.findChannel(ref)
    if (!c) throw new UserError('nl2sql/unknown-channel', ref ? `推送渠道不存在：${ref}` : `没有可用的推送渠道。${this.state.channels.length ? `可用渠道：${this.state.channels.map(x => x.name).join('、')}` : '请用户在「数据问答 → 推送」页面添加飞书/Lark 渠道。'}`)
    return c
  },

  channelSecretKey(id) {
    return `${CREDENTIAL_SCOPE}/${id}`
  },

  async saveChannel(input) {
    const existing = input.id ? this.state.channels.find(c => c.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/unknown-channel', '推送渠道不存在')
    const c = existing ? { ...existing } : { id: newId('ch'), createdAt: Date.now() }
    c.name = requireText(input.name ?? c.name, 'name', 64)
    if (this.state.channels.some(x => x.name === c.name && x.id !== c.id)) throw new UserError('nl2sql/duplicate', `渠道名称已存在：${c.name}`)
    c.type = oneOf(input.type ?? c.type ?? 'lark_webhook', ['lark_webhook', 'lark_app'], 'type')
    c.domain = input.domain === 'lark' ? 'lark' : input.domain === 'feishu' ? 'feishu' : (c.domain ?? 'feishu')
    c.description = String(input.description ?? c.description ?? '').slice(0, 300)
    c.chartMode = ['native', 'image', 'table'].includes(input.chartMode) ? input.chartMode : (c.chartMode ?? 'native')
    if (c.chartMode === 'image' && c.type !== 'lark_app') c.chartMode = 'native'
    if (c.type === 'lark_app') {
      c.appId = requireText(input.appId ?? c.appId, 'appId', 64)
      c.receiveIdType = oneOf(input.receiveIdType ?? c.receiveIdType ?? 'chat_id', RECEIVE_ID_TYPES, 'receiveIdType')
      c.receiveId = requireText(input.receiveId ?? c.receiveId, 'receiveId', 200)
    } else {
      delete c.appId; delete c.receiveIdType; delete c.receiveId
    }
    const patch = {}
    if (c.type === 'lark_webhook') {
      if (typeof input.webhookUrl === 'string' && input.webhookUrl.trim()) {
        const url = input.webhookUrl.trim()
        if (!/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(url)) throw new UserError('nl2sql/invalid', 'Webhook 地址格式不正确，应为 https://open.feishu.cn/open-apis/bot/v2/hook/… （Lark 国际版为 open.larksuite.com）')
        patch.webhookUrl = url
        c.domain = url.includes('larksuite') ? 'lark' : 'feishu'
      }
      if (typeof input.signSecret === 'string' && (input.signSecret !== '' || input.clearSign)) patch.signSecret = input.signSecret.trim()
    } else if (typeof input.appSecret === 'string' && input.appSecret !== '') {
      patch.appSecret = input.appSecret.trim()
    }
    const id = `ch-${c.id.replace(/^ch-/, '')}`
    const secrets = Object.keys(patch).length ? await this.writeSecrets(id, patch) : await this.readSecrets(id)
    c.hasSecret = Boolean(c.type === 'lark_webhook' ? secrets.webhookUrl : secrets.appSecret)
    c.hasSign = Boolean(secrets.signSecret)
    if (!c.hasSecret) throw new UserError('nl2sql/invalid', c.type === 'lark_webhook' ? '请填写 Webhook 地址' : '请填写 App Secret')
    delete c.needsSecret
    if (input.isDefault || !this.state.channels.some(x => x.isDefault && x.id !== c.id)) {
      for (const x of this.state.channels) x.isDefault = false
      c.isDefault = true
    }
    c.updatedAt = Date.now()
    this.state.channels = upsert(this.state.channels, c)
    await this.save()
    return this.publicChannel(c)
  },

  async deleteChannel(id) {
    const c = this.state.channels.find(x => x.id === id)
    if (!c) return { deleted: id }
    this.state.channels = this.state.channels.filter(x => x.id !== id)
    if (c.isDefault && this.state.channels[0]) this.state.channels[0].isDefault = true
    for (const r of this.state.reports) if (r.channelId === id) delete r.channelId
    try { await this.ctx.get('credentials')?.deleteRecord(this.credentialKey(`ch-${id.replace(/^ch-/, '')}`)) } catch {}
    await this.save()
    return { deleted: id }
  },

  async channelSecrets(c) {
    return this.readSecrets(`ch-${c.id.replace(/^ch-/, '')}`)
  },

  /** Chats of an app bot: a saved channel, or unsaved credentials from the form (nothing is stored). */
  async listChannelChats({ id, appId, appSecret, domain }) {
    const saved = id ? this.state.channels.find(c => c.id === id) : undefined
    const c = saved ?? { type: 'lark_app', appId: requireText(appId, 'appId', 64), domain: domain === 'lark' ? 'lark' : 'feishu' }
    if (c.type !== 'lark_app') throw new UserError('nl2sql/invalid', '只有应用机器人渠道可以列出群聊')
    const secrets = appSecret ? { appSecret } : saved ? await this.channelSecrets(saved) : {}
    if (!secrets.appSecret) throw new UserError('nl2sql/invalid', '请先填写 App Secret')
    try {
      return await listBotChats({ ...c, ...(appId ? { appId } : {}) }, secrets)
    } catch (error) {
      throw error instanceof ImError ? new UserError(error.code, error.message) : error
    }
  },

  /**
   * Send to an IM channel. Results are referenced by resultId (from this
   * process' cache) or given inline; each is re-checked against privacy:
   * masked values stay masked because results are stored masked.
   */
  async sendToChannel({ channelId, title, text, resultIds = [], results = [], includeSql = false, source = 'ui', sessionId, footer, chartMode }) {
    const c = this.requireChannel(channelId)
    const resolved = []
    const sender = this.actorFor(sessionId)
    for (const id of resultIds.slice(0, 10)) {
      const r = this.lookupResult(id)
      if (!r) throw new UserError('nl2sql/result-expired', `结果 ${id} 已过期，请重新查询后再发送。`)
      if (source === 'agent') this.assertResultAccess(r, sender)
      resolved.push(r)
    }
    resolved.push(...results.slice(0, 10))
    if (!text && resolved.length === 0) throw new UserError('nl2sql/invalid', '没有可发送的内容')
    const message = {
      title: requireText(title || resolved[0]?.title || '数据问答', 'title', 100),
      text: text ? String(text).slice(0, 20000) : '',
      chartMode: ['native', 'image', 'table'].includes(chartMode) ? chartMode : (c.chartMode ?? 'native'),
      results: resolved.map(r => pick(r, ['title', 'columns', 'rows', 'rowCount', 'truncated', 'chart', 'sql', 'filters', 'error'])),
      includeSql: Boolean(includeSql),
      footer: footer ?? `数据问答 · ${new Date().toLocaleString('zh-CN', { hour12: false })}${resolved[0]?.datasourceName ? ` · ${resolved[0].datasourceName}` : ''}`,
    }
    const started = Date.now()
    try {
      const sent = await sendMessage(c, await this.channelSecrets(c), message)
      c.lastSentAt = Date.now()
      delete c.lastError
      this.recordDelivery({ channel: c, title: message.title, status: 'ok', results: resolved.length, images: sent.images, source, sessionId, elapsedMs: Date.now() - started })
      await this.save()
      return { ok: true, channel: c.name, messageId: sent.messageId ?? null, images: sent.images, results: resolved.length }
    } catch (error) {
      c.lastError = error.message
      this.recordDelivery({ channel: c, title: message.title, status: 'error', error: error.message, results: resolved.length, source, sessionId, elapsedMs: Date.now() - started })
      await this.save()
      throw error instanceof ImError ? new UserError(error.code, error.message) : error
    }
  },

  /** Text of one assistant message of a session, for "send this reply to IM". */
  async assistantMessageText(sessionId, messageId) {
    const read = (session) => {
      for (const e of session.snapshotEvents()) {
        if (e.type !== 'assistant/message' || e.data.message?.id !== messageId) continue
        return e.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim()
      }
      return undefined
    }
    const live = this.ctx.get('agents')?.get(sessionId)
    let text = live ? read(live.session) : undefined
    if (text === undefined) {
      const q = this.ctx.get('sessionQuery')
      if (!q) throw new UserError('nl2sql/unavailable', '无法读取会话内容')
      text = await q.inspectSession(sessionId, read)
    }
    if (!text) throw new UserError('nl2sql/invalid', '这条回复没有文字内容')
    return text
  },

  /** resultIds of nl2sql tool results in the same turn as an assistant message. */
  async turnResultIds(sessionId, messageId) {
    const read = (session) => {
      const events = session.snapshotEvents()
      const at = events.findIndex(e => e.type === 'assistant/message' && e.data.message?.id === messageId)
      if (at < 0) return []
      const turn = events[at].data.turn
      const ids = []
      for (const e of events) {
        if (e.type !== 'tool/result' || e.data.turn !== turn) continue
        const meta = e.data.meta
        if (meta?.resultId) ids.push(meta.resultId)
        for (const r of meta?.results ?? []) if (r.resultId) ids.push(r.resultId)
      }
      return ids
    }
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live) return read(live.session)
    return (await this.ctx.get('sessionQuery')?.inspectSession(sessionId, read)) ?? []
  },

  async sendAssistantMessage({ channelId, sessionId, messageId, title, withResults = true }) {
    const text = await this.assistantMessageText(sessionId, messageId)
    const resultIds = withResults ? (await this.turnResultIds(sessionId, messageId)).filter(id => this.lookupResult(id)).slice(-6) : []
    const firstLine = text.split('\n').map(l => l.replace(/^#+\s*|\*\*/g, '').trim()).find(Boolean) ?? '数据问答'
    return this.sendToChannel({ channelId, title: title || firstLine.slice(0, 60), text, resultIds, source: 'ui', sessionId })
  },

  async previewAssistantMessage({ sessionId, messageId }) {
    const text = await this.assistantMessageText(sessionId, messageId)
    const resultIds = (await this.turnResultIds(sessionId, messageId)).filter(id => this.lookupResult(id)).slice(-6)
    return { text, resultIds, titles: resultIds.map(id => this.lookupResult(id)?.title ?? '') }
  },

  recordDelivery({ channel, title, status, error, results, images, source, sessionId, elapsedMs }) {
    this.records.put('delivery', { id: newId('dl'), at: Date.now(), channelId: channel.id, channelName: channel.name, title, status, ...(error ? { error: String(error).slice(0, 500) } : {}), results, images: images ?? 0, source, sessionId: sessionId ?? null, elapsedMs })

  },

  listDeliveries(limit = 100) {
    return this.records.list('delivery', { limit })
  },

  async testChannel(id) {
    return this.sendToChannel({ channelId: id, title: '数据问答 · 推送测试', text: `这是一条测试消息。\n发送时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`, source: 'test' })
  },

  /** Send the current dashboard (with saved global filters) to a channel. */
  async sendDashboard({ channelId, title, filters, dashboardId, chartMode }) {
    const results = []
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    for (const w of d.widgets.slice(0, 10)) {
      try {
        const r = await this.runWidget(w.id, filters ?? d.filters)
        results.push({ ...r, title: w.title })
      } catch (error) {
        results.push({ title: w.title, error: error.message, columns: [], rows: [] })
      }
    }
    if (!results.length) throw new UserError('nl2sql/invalid', '看板为空')
    const sent = await this.sendToChannel({ channelId, title: title || d.name || '数据看板', results, source: 'dashboard', chartMode })
    await this.saveDashboardSnapshot(d, results, 'push')
    return sent
  },

  /** Run every widget of a dashboard and keep a snapshot (for history / export). */
  async snapshotDashboard({ dashboardId, filters, reason = 'manual' } = {}) {
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    const results = []
    for (const w of d.widgets.slice(0, 30)) {
      try { results.push({ ...(await this.runWidget(w.id, filters ?? d.filters)), title: w.title }) } catch (error) { results.push({ title: w.title, error: error.message, columns: [], rows: [] }) }
    }
    return this.saveDashboardSnapshot(d, results, reason)
  },

  async saveDashboardSnapshot(d, results, reason) {
    const snap = { id: newId('snap'), dashboardId: d.id, name: d.name, reason, at: Date.now(), filters: d.filters ?? [], resultIds: results.map(r => r.resultId).filter(Boolean), widgets: results.map(r => ({ title: r.title, resultId: r.resultId ?? null, error: r.error ?? null, rowCount: r.rowCount ?? 0 })) }
    try { this.store?.putSnapshot({ id: snap.id, kind: 'dashboard', ref: d.id, createdAt: snap.at, body: snap }) } catch {}
    return snap
  },

  listDashboardSnapshots(dashboardId) {
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    return (this.store?.listSnapshots('dashboard', d.id, 30) ?? []).map(s => s.body)
  },

  // -------------------------------------------------------------- feedback

  async submitFeedback({ resultId, rating, comment, question, sql, datasourceId, sessionId, title }) {
    const r = resultId ? this.lookupResult(resultId) : undefined
    const ds = this.requireDatasource(r?.datasourceId ?? datasourceId)
    const entry = {
      id: newId('fb'),
      at: Date.now(),
      rating: rating === 'up' ? 'up' : 'down',
      datasourceId: ds.id,
      datasourceName: ds.name,
      resultId: resultId ?? null,
      sessionId: sessionId ?? null,
      title: String(title ?? r?.title ?? '').slice(0, 120),
      question: String(question ?? '').slice(0, 1000),
      sql: String(sql ?? r?.baseSql ?? r?.sql ?? '').slice(0, 20000),
      comment: String(comment ?? '').slice(0, 2000),
      status: rating === 'up' ? 'resolved' : 'open',
    }
    if (!entry.sql) throw new UserError('nl2sql/invalid', '缺少 SQL')
    // A newer rating of the same result replaces the earlier one.
    if (resultId) for (const old of this.records.list('feedback', { limit: 5, filter: (f) => f.resultId === resultId })) this.records.delete('feedback', old.id)
    this.records.put('feedback', entry)
    await this.save()
    return entry
  },

  listFeedback({ status, datasourceId, rating } = {}) {
    return this.records.list('feedback', { ref: datasourceId, status, limit: 1000, filter: (f) => !rating || f.rating === rating })
  },

  feedbackStats(datasourceId) {
    const list = this.records.list('feedback', { ref: datasourceId, limit: 100000 })
    const up = list.filter(f => f.rating === 'up').length
    return { up, down: list.length - up, open: list.filter(f => f.status === 'open').length, rate: list.length ? Number((up / list.length).toFixed(3)) : null }
  },

  async resolveFeedback({ id, status, resolution, saveExample, correctedSql, question }) {
    const f = this.records.get('feedback', id)
    if (!f) throw new UserError('nl2sql/unknown-feedback', '反馈不存在')
    if (saveExample) {
      await this.saveKnowledgeItem({ datasourceId: f.datasourceId, kind: 'example', item: { question: question || f.question || f.title, sql: correctedSql || f.sql, note: f.rating === 'down' && f.comment ? `修正自反馈：${f.comment}`.slice(0, 500) : '' } })
      f.savedAsExample = true
    }
    f.status = status === 'open' ? 'open' : status === 'ignored' ? 'ignored' : 'resolved'
    if (resolution !== undefined) f.resolution = String(resolution).slice(0, 1000)
    if (correctedSql) f.correctedSql = String(correctedSql).slice(0, 20000)
    f.resolvedAt = Date.now()
    this.records.put('feedback', f)
    await this.save()
    return f
  },

  async deleteFeedback(id) {
    this.records.delete('feedback', id)
    await this.save()
    return { deleted: id }
  },
}
