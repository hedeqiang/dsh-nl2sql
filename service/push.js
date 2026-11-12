/**
 * Nl2SqlService methods: sending assistant replies and dashboards to IM
 * channels, dashboard snapshots, and result feedback. Channel management and
 * delivery live in service/channels.js.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { UserError, newId } from './shared.js'

export const methods = {
  // ------------------------------------------- assistant replies → IM

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
