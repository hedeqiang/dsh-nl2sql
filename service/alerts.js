/**
 * Nl2SqlService methods: alerts.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { evaluateAlert } from '../analysis.js'
import { admitSql } from '../sql-guard.js'
import { UserError, clampInt, newId, oneOf, requireText, upsert } from './shared.js'

export const methods = {
  // ---------------------------------------------------------------- alerts

  /**
   * Alert: a metric (from the library) or a SQL query returning a time series
   * (first column time, value column), evaluated on a schedule; triggers push
   * to a channel.
   */
  listAlerts() {
    return (this.state.alerts ?? []).map(a => ({ ...a, datasourceName: this.findDatasource(a.datasourceId)?.name ?? a.datasourceId, channelName: this.state.channels.find(c => c.id === a.channelId)?.name ?? null }))
  },

  /** Validate an alert definition (shared by save and preview). */
  async normalizeAlert(input, forceId) {
    const existing = input.id ? (this.state.alerts ?? []).find(a => a.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/invalid', '告警不存在')
    const ds = this.requireDatasource(input.datasourceId ?? existing?.datasourceId)
    const a = existing ? { ...existing } : { id: forceId ?? newId('al'), createdAt: Date.now(), state: 'ok' }
    a.name = requireText(input.name ?? a.name, 'name', 60)
    a.datasourceId = ds.id
    a.source = oneOf(input.source ?? a.source ?? 'metric', ['metric', 'sql'], 'source')
    if (a.source === 'metric') {
      const m = this.findMetric(ds, input.metric ?? a.metric)
      if (!m) throw new UserError('nl2sql/unknown-metric', '指标库中没有这个指标')
      a.metric = m.name
      a.grain = oneOf(input.grain ?? a.grain ?? 'day', ['hour', 'day', 'week', 'month'], 'grain')
      a.filters = Array.isArray(input.filters) ? input.filters : (a.filters ?? [])
      delete a.sql
    } else {
      a.sql = requireText(input.sql ?? a.sql, 'sql', 20000)
      admitSql(a.sql, { dialect: ds.type ?? 'mysql' })
      delete a.metric
    }
    const cond = input.condition ?? a.condition ?? { type: 'threshold', op: '>', value: 0 }
    a.condition = { ...cond, type: oneOf(cond.type, ['threshold', 'change', 'anomaly', 'missing'], 'condition.type') }
    a.every = oneOf(input.every ?? a.every ?? 'hour', ['15m', 'hour', 'day'], 'every')
    a.at = /^\d{2}:\d{2}$/.test(String(input.at ?? a.at ?? '')) ? (input.at ?? a.at) : '09:00'
    a.channelId = input.channelId !== undefined ? (this.state.channels.some(c => c.id === input.channelId) ? input.channelId : null) : (a.channelId ?? null)
    a.mention = input.mention !== undefined ? Boolean(input.mention) : Boolean(a.mention)
    a.cooldownMin = clampInt(input.cooldownMin ?? a.cooldownMin ?? 60, 0, 10080, 'cooldownMin')
    a.enabled = input.enabled !== undefined ? Boolean(input.enabled) : (a.enabled ?? true)
    a.updatedAt = Date.now()
    return a
  },

  async saveAlert(input) {
    const a = await this.normalizeAlert(input)
    this.state.alerts = upsert(this.state.alerts ?? [], a)
    await this.save()
    this.scheduleAlerts()
    return a
  },

  async deleteAlert(id) {
    this.state.alerts = (this.state.alerts ?? []).filter(a => a.id !== id)
    await this.save()
    return { deleted: id }
  },

  /** Evaluate one alert now; pushes when it triggers (respecting cooldown) unless dryRun. */
  async checkAlert(id, opts = {}) {
    if (opts.dryRun) return this.checkAlertInner(id, opts)
    return this.withJobLock(`alert:${id}`, () => this.checkAlertInner(id, opts))
  },

  /** Evaluate an unsaved alert definition (form "dry run"): nothing is stored or pushed. */
  async previewAlert(input) {
    const tmpId = `preview-${newId('al')}`
    const saved = this.state.alerts
    try {
      const draft = await this.normalizeAlert({ ...input, id: undefined }, tmpId)
      this.state.alerts = [...(saved ?? []), draft]
      return await this.checkAlertInner(tmpId, { dryRun: true })
    } finally {
      this.state.alerts = saved
    }
  },

  async checkAlertInner(id, { dryRun = false, force = false } = {}) {
    const a = (this.state.alerts ?? []).find(x => x.id === id)
    if (!a) throw new UserError('nl2sql/invalid', '告警不存在')
    const ds = this.requireDatasource(a.datasourceId)
    let result
    if (a.source === 'metric') {
      const range = a.grain === 'hour' ? 'last7d' : a.grain === 'month' ? 'thisYear' : a.grain === 'week' ? 'last90d' : 'last30d'
      result = await this.queryMetric({ datasourceId: ds.id, metric: a.metric, grain: a.grain, range, filters: a.filters, title: `告警 · ${a.name}`, source: 'alert' })
    } else {
      result = await this.runQuery({ sql: a.sql, datasourceId: ds.id, title: `告警 · ${a.name}`, source: 'alert', confirmScan: true })
    }
    // Series: first column = time/category, last numeric column = value.
    const vi = [...result.columns.keys()].reverse().find(i => result.columns[i].kind === 'number')
    const series = vi === undefined ? [] : result.rows.map(r => ({ t: r[0], v: r[vi] === null ? null : Number(r[vi]) }))
    if (a.condition.type !== 'missing' && result.columns.length === 1 && vi === 0) series.splice(0, series.length, ...result.rows.map((r, i) => ({ t: i, v: Number(r[0]) })))
    const ev = evaluateAlert(a.condition, series, { now: Date.now() })
    a.lastCheckedAt = Date.now()
    a.lastValue = ev.value ?? null
    a.lastResultId = result.resultId
    const cooled = !a.lastFiredAt || Date.now() - a.lastFiredAt >= a.cooldownMin * 60000
    let pushed = false
    if (ev.triggered) {
      a.state = 'firing'
      if (!dryRun && (cooled || force)) {
        a.lastFiredAt = Date.now()
        const event = { id: newId('ae'), alertId: a.id, name: a.name, at: Date.now(), value: ev.value ?? null, message: ev.message, resultId: result.resultId }
        this.records.put('alertEvent', event)
        if (a.channelId) {
          try {
            await this.sendToChannel({ channelId: a.channelId, title: `⚠️ 数据告警：${a.name}`, text: `${a.mention ? '<at id=all></at> ' : ''}**${ev.message}**\n\n<font color='grey'>数据源：${ds.name} · 检查时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</font>`, resultIds: [result.resultId], source: 'alert' })
            pushed = true
            event.pushed = true
          } catch (error) {
            event.pushError = error.message
          }
          this.records.put('alertEvent', event)
        }
      }
    } else if (a.state === 'firing') {
      a.state = 'ok'
      if (!dryRun && a.channelId && a.notifyRecovery !== false) {
        try { await this.sendToChannel({ channelId: a.channelId, title: `✅ 告警恢复：${a.name}`, text: ev.message, source: 'alert' }) } catch {}
      }
    } else {
      a.state = 'ok'
    }
    await this.save()
    return { ...ev, pushed, resultId: result.resultId, state: a.state }
  },

  listAlertEvents(alertId) {
    return this.records.list('alertEvent', { ref: alertId, limit: 200 })
  },

  /**
   * In-process scheduler (alerts + daily schema check). The Harness schedule
   * service only delivers prompts to agent sessions, so deterministic checks run
   * here. Reliability:
   *   - a first tick 20 s after start catches up on anything missed while
   *     Harness was closed (each job keeps its own last-run time, so a missed
   *     daily slot runs once, not once per missed day);
   *   - per-job in-flight locks (manual "check now" and the tick never overlap);
   *   - jobs run concurrently with a timeout, so one slow query does not block others;
   *   - every tick is recorded and shown on the page.
   */
  scheduleAlerts() {
    if (this.alertTimer || this.disposed) return
    const tick = () => { this.tickAlerts().catch(error => { this.state.scheduler = { ...(this.state.scheduler ?? {}), lastError: error.message } }) }
    this.alertTimer = setInterval(tick, 60000)
    this.alertTimer.unref?.()
    this.alertKick = setTimeout(tick, this.config.schedulerDelayMs ?? 20000)
    this.alertKick.unref?.()
  },

  /** Next due time (ms) of an alert after its last check. */
  alertDueAt(a, now = Date.now()) {
    const last = a.lastCheckedAt ?? 0
    if (a.every === '15m') return last + 15 * 60000
    if (a.every === 'hour') return last + 60 * 60000
    // daily at HH:MM local time: the most recent slot not yet covered by lastCheckedAt.
    const [hh, mm] = String(a.at ?? '09:00').split(':').map(Number)
    const slot = new Date(now)
    slot.setHours(hh, mm, 0, 0)
    if (slot.getTime() > now) slot.setDate(slot.getDate() - 1)
    return last < slot.getTime() ? slot.getTime() : (() => { const n = new Date(slot); n.setDate(n.getDate() + 1); return n.getTime() })()
  },

  async withJobLock(key, fn) {
    this.jobLocks ??= new Set()
    if (this.jobLocks.has(key)) throw new UserError('nl2sql/busy', '该任务正在执行，请稍后再试')
    this.jobLocks.add(key)
    try { return await fn() } finally { this.jobLocks.delete(key) }
  },

  async tickAlerts(now = new Date()) {
    if (this.alertBusy || this.disposed) return
    this.alertBusy = true
    const started = Date.now()
    const ran = []
    try {
      const due = (this.state.alerts ?? []).filter(a => a.enabled && this.alertDueAt(a, now.getTime()) <= now.getTime())
      const timeoutMs = this.config.alertTimeoutMs ?? 120000
      await Promise.all(due.map(async (a) => {
        try {
          await Promise.race([
            this.checkAlert(a.id),
            new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`检查超过 ${Math.round(timeoutMs / 1000)} 秒`)), timeoutMs); t.unref?.() }),
          ])
          a.lastError = undefined
          ran.push({ id: a.id, ok: true })
        } catch (error) {
          if (error.code === 'nl2sql/busy') return
          a.lastError = error.message
          a.lastCheckedAt = Date.now()
          ran.push({ id: a.id, ok: false, error: error.message })
        }
      }))
      // Daily schema watch (catches up once after downtime).
      const at = this.state.settings.schemaCheckDaily
      if (at) {
        const [hh, mm] = at.split(':').map(Number)
        const slot = new Date(now)
        slot.setHours(hh, mm, 0, 0)
        if (slot > now) slot.setDate(slot.getDate() - 1)
        if ((this.state.lastSchemaCheck ?? 0) < slot.getTime()) {
          this.state.lastSchemaCheck = Date.now()
          try { await this.withJobLock('schema-check', () => this.checkAllSchemas()); ran.push({ id: 'schema', ok: true }) } catch (error) { ran.push({ id: 'schema', ok: false, error: error.message }) }
        }
      }
      this.state.scheduler = { lastTickAt: started, lastTickMs: Date.now() - started, lastRan: ran.slice(0, 50), lastError: undefined }
      await this.save()
    } finally {
      this.alertBusy = false
    }
  },

  schedulerStatus() {
    const now = Date.now()
    return {
      ...(this.state.scheduler ?? {}),
      running: Boolean(this.alertTimer),
      nextAlerts: (this.state.alerts ?? []).filter(a => a.enabled).map(a => ({ id: a.id, name: a.name, dueAt: this.alertDueAt(a, now) })).sort((x, y) => x.dueAt - y.dueAt).slice(0, 20),
      schemaCheckDaily: this.state.settings.schemaCheckDaily || null,
      lastSchemaCheck: this.state.lastSchemaCheck ?? null,
    }
  },
}
