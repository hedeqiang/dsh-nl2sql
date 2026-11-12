/**
 * Nl2SqlService methods: dashboards.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { normalizeFilters } from '../filters.js'
import { referencedTables } from '../policy.js'
import { admitSql } from '../sql-guard.js'
import { UserError, newId, overviewPlans, requireText, upsert } from './shared.js'

/** Widget width: 'third' | 'half' | 'full' (anything else → 'half'). */
export function widgetWidth(width) {
  return width === 'full' || width === 'third' ? width : 'half'
}

export const methods = {
  // ------------------------------------------------------------ dashboard

  listDashboard(dashboardId) {
    return (dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()).widgets
  },

  requireDashboard(id) {
    const d = this.state.dashboards.find(x => x.id === id)
    if (!d) throw new UserError('nl2sql/unknown-dashboard', '看板不存在')
    return d
  },

  listDashboards() {
    return { current: this.currentDashboardObj().id, dashboards: this.state.dashboards.map(d => ({ id: d.id, name: d.name, description: d.description ?? '', widgets: d.widgets.length, filters: d.filters?.length ?? 0, createdAt: d.createdAt, updatedAt: d.updatedAt })) }
  },

  async saveDashboard({ id, name, description, copyFrom }) {
    let d = id ? this.requireDashboard(id) : undefined
    const nm = requireText(name ?? d?.name, 'name', 40)
    if (this.state.dashboards.some(x => x.name === nm && x.id !== d?.id)) throw new UserError('nl2sql/duplicate', `看板名称已存在：${nm}`)
    if (!d) {
      const src = copyFrom ? this.requireDashboard(copyFrom) : undefined
      d = { id: newId('db'), name: nm, description: '', widgets: src ? src.widgets.map(w => ({ ...w, id: newId('w') })) : [], filters: src ? [...(src.filters ?? [])] : [], createdAt: Date.now() }
      this.state.dashboards.push(d)
      this.state.currentDashboard = d.id
    }
    d.name = nm
    if (description !== undefined) d.description = String(description).slice(0, 300)
    d.updatedAt = Date.now()
    this.syncLegacyDashboard()
    await this.save()
    return this.listDashboards()
  },

  async deleteDashboard(id) {
    if (this.state.dashboards.length <= 1) throw new UserError('nl2sql/invalid', '至少保留一个看板')
    this.requireDashboard(id)
    this.state.dashboards = this.state.dashboards.filter(d => d.id !== id)
    if (this.state.currentDashboard === id) this.state.currentDashboard = this.state.dashboards[0].id
    for (const r of this.state.reports) if (r.dashboardId === id) delete r.dashboardId
    this.syncLegacyDashboard()
    await this.save()
    return this.listDashboards()
  },

  async selectDashboard(id) {
    this.requireDashboard(id)
    this.state.currentDashboard = id
    this.syncLegacyDashboard()
    await this.save()
    return this.listDashboards()
  },

  /** Move or copy a widget into another dashboard. */
  async transferWidget({ id, toDashboardId, copy = false }) {
    const target = this.requireDashboard(toDashboardId)
    const from = this.state.dashboards.find(d => d.widgets.some(w => w.id === id))
    if (!from) throw new UserError('nl2sql/unknown-widget', '看板组件不存在')
    const w = from.widgets.find(x => x.id === id)
    target.widgets.push(copy ? { ...w, id: newId('w') } : w)
    if (!copy) from.widgets = from.widgets.filter(x => x.id !== id)
    this.syncLegacyDashboard()
    await this.save()
    return { ok: true }
  },

  async pinWidget({ title, sql, datasourceId, chart, width, dashboardId }) {
    const ds = this.requireDatasource(datasourceId)
    admitSql(sql, { dialect: ds.type ?? 'mysql' })
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    const widget = { id: newId('w'), title: String(title || 'Untitled').slice(0, 120), sql, datasourceId: ds.id, chart: chart ?? { type: 'table' }, width: widgetWidth(width), createdAt: Date.now() }
    d.widgets.push(widget)
    this.syncLegacyDashboard()
    await this.save()
    return widget
  },

  findWidget(id) {
    for (const d of this.state.dashboards) {
      const w = d.widgets.find(x => x.id === id)
      if (w) return { w, d }
    }
    return {}
  },

  async unpinWidget(id) {
    for (const d of this.state.dashboards) d.widgets = d.widgets.filter(w => w.id !== id)
    this.syncLegacyDashboard()
    await this.save()
    return { deleted: id }
  },

  async runWidget(id, filters, { useCache = true, actor } = {}) {
    const { w, d } = this.findWidget(id)
    if (!w) throw new UserError('nl2sql/unknown-widget', '看板组件不存在')
    return this.runQuery({ governed: true, sql: w.sql, datasourceId: w.datasourceId, title: w.title, chart: w.chart, source: 'dashboard', confirmScan: true, filters: filters ?? d.filters ?? [], useCache, actor })
  },

  async updateWidget({ id, title, chart, width, sql }) {
    const { w } = this.findWidget(id)
    if (!w) throw new UserError('nl2sql/unknown-widget', '看板组件不存在')
    if (title !== undefined) w.title = requireText(title, 'title', 120)
    if (chart !== undefined) w.chart = chart
    if (width !== undefined) w.width = widgetWidth(width)
    if (sql !== undefined) { admitSql(sql, { dialect: this.findDatasource(w.datasourceId)?.type ?? 'mysql' }); w.sql = sql }
    await this.save()
    return w
  },

  /** Set the widget order of a dashboard; `ids` must be a permutation of its widget ids. */
  async reorderWidgets({ dashboardId, ids } = {}) {
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    if (!Array.isArray(ids)) throw new UserError('nl2sql/invalid', 'ids 必须是数组')
    const byId = new Map(d.widgets.map(w => [w.id, w]))
    if (ids.length !== d.widgets.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw new UserError('nl2sql/invalid', 'ids 必须恰好包含该看板的全部组件（不能重复或缺少）')
    d.widgets = ids.map(id => byId.get(id))
    d.updatedAt = Date.now()
    this.syncLegacyDashboard()
    await this.save()
    return d.widgets
  },

  async moveWidget({ id, delta }) {
    const list = this.findWidget(id).d?.widgets ?? []
    const i = list.findIndex(x => x.id === id)
    const j = i + (delta < 0 ? -1 : 1)
    if (i < 0 || j < 0 || j >= list.length) return list
    ;[list[i], list[j]] = [list[j], list[i]]
    await this.save()
    return list
  },

  listHistory({ limit = 100, datasourceId, status, source, search, actorId } = {}) {
    const q = search ? String(search).toLowerCase() : ''
    return this.records.list('history', { limit: Math.min(limit, 1000), ref: datasourceId, filter: (h) =>
      (!actorId || h.actor?.id === actorId) &&
      (!status || h.status === status || (status === 'ok' && h.status === undefined)) &&
      (!source || h.source === source) &&
      (!q || h.sql.toLowerCase().includes(q) || (h.title ?? '').toLowerCase().includes(q)) })
  },

  /**
   * Delete history entries: one id, a list of ids, or every entry of the same
   * question (`title`) for a data source (used by "最近的提问" where one row
   * stands for repeated asks of the same question).
   */
  async deleteHistory({ id, ids, title, datasourceId } = {}) {
    const list = [...new Set([...(ids ?? []), ...(id ? [id] : [])].map(String))]
    if (!list.length && !title) throw new UserError('nl2sql/invalid', '缺少要删除的历史记录')
    let deleted = 0
    for (const x of list) {
      if (this.records.get('history', x)) { this.records.delete('history', x); deleted++ }
    }
    if (title) {
      const same = this.records.list('history', { ref: datasourceId, limit: 100000, filter: h => h.title === title && h.source === 'agent' })
      for (const h of same) { this.records.delete('history', h.id); deleted++ }
    }
    if (!deleted) throw new UserError('nl2sql/not-found', '历史记录不存在或已删除')
    this.auditAdmin('history.delete', title ? `「${String(title).slice(0, 60)}」${deleted} 条` : `${deleted} 条`)
    await this.save()
    return { deleted }
  },

  async clearHistory() {
    this.records.clear('history')
    await this.save()
    return { cleared: true }
  },

  // ----------------------------------------------------- scheduled reports

  scheduleService() {
    const schedule = this.ctx.get('schedule')
    if (!schedule) throw new UserError('nl2sql/no-schedule', '当前 Harness 没有启用定时任务服务（dsh-schedule），无法创建定时报告。')
    return schedule
  },

  reportPrompt(report, ds) {
    const dash = (report.dashboardId && this.state.dashboards.find(d => d.id === report.dashboardId)) || this.currentDashboardObj()
    const scope = report.scope === 'dashboard'
      ? `请依次执行「数据问答」看板「${dash.name}」中属于该数据源的全部图表对应的查询（SQL 见下），用 nl2sql_query 重新查询并生成图表：\n${dash.widgets.filter(w => w.datasourceId === ds.id).map((w, i) => `${i + 1}. ${w.title}\n${w.sql}`).join('\n\n') || '（看板暂无该数据源的图表，请根据下面的分析要求自行选择指标）'}`
      : `分析要求：${report.question}`
    return [
      `[数据问答定时报告] ${report.title}`,
      `先调用 nl2sql_datasource action=use datasource=${ds.id}（${ds.name}）绑定数据源，然后完成以下分析。`,
      scope,
      report.instructions ? `补充要求：${report.instructions}` : '',
      report.channelId && this.state.channels.some(c => c.id === report.channelId) ? `完成后调用 nl2sql_send，channel=${report.channelId}（${this.state.channels.find(c => c.id === report.channelId).name}），title="${report.title}"，text 为你的报告摘要（Markdown），resultIds 为本次关键查询的 resultId（最多 6 个）。` : '',
      `最后用中文写一段报告摘要：关键数字、与上一周期相比的变化（${report.period === 'weekly' ? '周环比' : '日环比'}，若可计算）、异常点和建议关注事项。不要逐行复述表格数据。`,
    ].filter(Boolean).join('\n\n')
  },

  timingFor(report) {
    const tz = report.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    if (report.period === 'weekly') return { kind: 'weekly', weekly: { time: report.time, time_zone: tz, weekdays: report.weekdays?.length ? report.weekdays : [1] } }
    return { kind: 'daily', daily: { time: report.time, time_zone: tz } }
  },

  async listReports() {
    let catalog = []
    try { catalog = await this.ctx.get('schedule')?.catalog() ?? [] } catch {}
    const byId = new Map(catalog.map(e => [e.id, e]))
    return this.state.reports.map(r => {
      const e = byId.get(r.scheduleId)
      return { ...r, channelName: this.state.channels.find(c => c.id === r.channelId)?.name ?? null, status: e?.status ?? (r.paused && !r.scheduleId ? 'paused' : 'missing'), scheduledAt: e?.scheduledAt ?? null, lastDelivery: e?.lastDelivery ?? null, datasourceName: this.findDatasource(r.datasourceId)?.name ?? r.datasourceId }
    })
  },

  async saveReport(input) {
    const ds = this.requireDatasource(input.datasourceId)
    const schedule = this.scheduleService()
    const existing = input.id ? this.state.reports.find(r => r.id === input.id) : undefined
    const report = {
      id: existing?.id ?? newId('rp'),
      title: requireText(input.title, 'title', 80),
      datasourceId: ds.id,
      scope: input.scope === 'dashboard' ? 'dashboard' : 'question',
      question: input.scope === 'dashboard' ? String(input.question ?? '') : requireText(input.question, 'question', 2000),
      instructions: String(input.instructions ?? '').slice(0, 1000),
      period: input.period === 'weekly' ? 'weekly' : 'daily',
      time: /^\d{2}:\d{2}$/.test(String(input.time)) ? `${input.time}:00` : /^\d{2}:\d{2}:\d{2}$/.test(String(input.time)) ? String(input.time) : '09:00:00',
      weekdays: Array.isArray(input.weekdays) ? [...new Set(input.weekdays.map(Number).filter(n => n >= 1 && n <= 7))].sort() : [1],
      timeZone: String(input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone),
      target: input.target === 'new' ? 'new' : 'new_once',
      channelId: input.channelId && this.state.channels.some(c => c.id === input.channelId) ? input.channelId : undefined,
      dashboardId: input.dashboardId && this.state.dashboards.some(d => d.id === input.dashboardId) ? input.dashboardId : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    const request = {
      title: `数据报告：${report.title}`.slice(0, 120),
      prompt: this.reportPrompt(report, ds),
      timing: this.timingFor(report),
    }
    let entry
    if (existing?.scheduleId) {
      entry = await schedule.edit({ id: existing.scheduleId, action: 'update', patch: { ...request, ...(existing.target !== report.target ? { target: { kind: report.target, create: { agentPreset: 'nl2sql' } } } : {}) } })
      if (entry?.code === 'schedule_not_found') entry = undefined
    }
    if (!entry) {
      entry = await schedule.create({ ...request, target: { kind: report.target, create: { agentPreset: 'nl2sql' } } })
    }
    report.scheduleId = entry.id
    this.state.reports = upsert(this.state.reports, report)
    await this.save()
    return report
  },

  async setReportActive({ id, active }) {
    const report = this.state.reports.find(r => r.id === id)
    if (!report) throw new UserError('nl2sql/unknown-report', '报告不存在')
    // Imported without a schedule service: activating creates the schedule now.
    if (!report.scheduleId) {
      if (!active) return { id: report.id, status: 'paused' }
      const { paused: _p, ...def } = report
      return this.saveReport({ ...def, time: def.time })
    }
    const res = await this.scheduleService().edit({ id: report.scheduleId, action: 'update', patch: { active: Boolean(active) } })
    if (res?.code) throw new UserError('nl2sql/schedule', `更新定时任务失败：${res.code}`)
    return res
  },

  async runReportNow(id) {
    const report = this.state.reports.find(r => r.id === id)
    if (!report) throw new UserError('nl2sql/unknown-report', '报告不存在')
    const res = await this.scheduleService().run({ id: report.scheduleId })
    if (res?.code === 'schedule_execution_pending') throw new UserError('nl2sql/schedule', '报告正在执行中，请稍后再试')
    if (res?.code) throw new UserError('nl2sql/schedule', `执行失败：${res.code}`)
    return res
  },

  async deleteReport(id) {
    const report = this.state.reports.find(r => r.id === id)
    if (!report) return { deleted: id }
    try { await this.ctx.get('schedule')?.edit({ id: report.scheduleId, action: 'delete' }) } catch {}
    this.state.reports = this.state.reports.filter(r => r.id !== id)
    await this.save()
    return { deleted: id }
  },

  // --------------------------------------------------------- auto overview

  /** Build overview widgets for one table from its column roles; runs each query and returns results. */
  async tableOverview({ datasourceId, table, pin = false, actor, sessionId, source = 'ui' }) {
    const ds = this.requireDatasource(datasourceId)
    // Agent / bot callers run as their actor: scope, row-level rules, viewer limits and audit attribution apply.
    actor ??= sessionId ? this.actorFor(sessionId) : undefined
    if (actor) this.assertAccess(actor, ds)
    const schema = await this.visibleSchema(ds)
    const t = schema.tables.find(x => x.name === table)
    if (!t) throw new UserError('nl2sql/unknown-table', `表不存在或无权访问：${table}`)
    const plans = overviewPlans(ds.type ?? 'mysql', t, this.knowledgeFor(ds.id))
    const results = []
    for (const plan of plans) {
      try {
        const r = await this.runQuery({ sql: plan.sql, datasourceId: ds.id, sessionId, actor, title: plan.title, chart: plan.chart, source, confirmScan: true })
        results.push(r)
        if (pin) await this.pinWidget({ title: plan.title, sql: plan.sql, datasourceId: ds.id, chart: r.chart, width: plan.width })
      } catch (error) {
        results.push({ title: plan.title, sql: plan.sql, error: error.message })
      }
    }
    return { table: t.name, results }
  },

  // ------------------------------------------------------ dashboard filters

  /** Columns dashboard filters can target, from the visible schema of the widgets' tables. */
  async filterCandidates(dashboardId) {
    const time = new Map()
    const dims = new Map()
    for (const w of (dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()).widgets) {
      const ds = this.findDatasource(w.datasourceId)
      if (!ds) continue
      let schema
      try { schema = await this.visibleSchema(ds) } catch { continue }
      const refs = referencedTables(w.sql, schema.tables, { dialect: ds.type ?? 'mysql' })
      for (const t of schema.tables.filter(x => refs.includes(x.name))) {
        for (const c of t.columns) {
          if (c.roles.includes('time') && /date|time|stamp/.test(c.dataType)) {
            time.set(c.name, { column: c.name, label: c.comment || c.name, tables: [...new Set([...(time.get(c.name)?.tables ?? []), t.name])] })
          } else if ((c.roles.includes('enum') || c.roles.includes('geo')) && !c.roles.includes('sensitive')) {
            const prev = dims.get(c.name)
            dims.set(c.name, {
              column: c.name, label: prev?.label || c.comment || c.name,
              tables: [...new Set([...(prev?.tables ?? []), t.name])],
              values: [...new Set([...(prev?.values ?? []), ...(c.values ?? []).map(v => String(v.value))])].slice(0, 50),
            })
          }
        }
      }
    }
    return { time: [...time.values()], dims: [...dims.values()].sort((a, b) => b.tables.length - a.tables.length).slice(0, 30) }
  },

  getDashboardFilters(dashboardId) {
    return (dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()).filters ?? []
  },

  async saveDashboardFilters(filters, dashboardId) {
    const d = dashboardId ? this.requireDashboard(dashboardId) : this.currentDashboardObj()
    d.filters = normalizeFilters(filters)
    this.syncLegacyDashboard()
    await this.save()
    return d.filters
  },
}
