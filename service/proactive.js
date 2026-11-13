/**
 * Feature "proactive": data finds people.
 *  - Daily digest (state.digests): yesterday vs 7-day mean and vs same weekday last week per
 *    metric (or dashboard time-series widget), attribution of the top movers, Markdown summary +
 *    up to 3 charts pushed to a channel at HH:MM. Record kind 'digestRun'.
 *  - Alert auto-attribution: beforeAlertPush(alert, result) → "主要来自：…" line (≤ 20 s).
 *  - Goals (state.goals): actual-to-date, run-rate projection (weekday-aware), status; optional
 *    weekly push (state.goalPush).
 *  - Forecast: forecast({ resultId, horizon }) for single-measure time series; agent tool nl2sql_forecast.
 * Every query goes through queryMetric / runWidget / explainChange (→ runQuery).
 */
import { isAdditive } from '../analysis.js'
import { forecastPoints, dailyStats, isNotable, periodBounds, projectRunRate, goalStatus, parseTimeLabel } from './forecast.js'
import { UserError, clampInt, fmtNum, lastDailySlot, newId, oneOf, requireText, upsert } from './shared.js'

const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
/** Local calendar date 'YYYY-MM-DD'. */
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
/** A time label (any driver format) → local 'YYYY-MM-DD', or null. */
export function dayKey(v) {
  const s = String(v ?? '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  // Midnight UTC ISO from a DATE column is the date itself; other ISO timestamps are converted to local.
  if (/T/.test(s) && !/T00:00:00(\.0+)?Z?$/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : ymd(d) }
  return `${m[1]}-${m[2]}-${m[3]}`
}

function timeout(ms, label) {
  return new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`${label} 超时`)), ms); t.unref?.() })
}
const withTimeout = (p, ms, label = '') => Promise.race([p, timeout(ms, label)])

function numText(v, lang) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  if (lang === 'zh') return fmtNum(v)
  const n = Number(v)
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)
}
const pctText = (p) => (p === null || p === undefined ? '—' : `${p >= 0 ? '+' : ''}${(p * 100).toFixed(0)}%`)

/** Time series view of a result: { xi, yi, points:[{x,y}] } or null (needs a time x and one measure). */
export function seriesOf(result) {
  if (!result?.columns?.length || !Array.isArray(result.rows)) return null
  const cols = result.columns
  if (result.chart?.series) return null
  let xi = cols.findIndex(c => c.name === result.chart?.x)
  if (xi < 0 || cols[xi].kind !== 'time') xi = cols.findIndex(c => c.kind === 'time')
  if (xi < 0) return null
  const ys = (result.chart?.y?.length ? result.chart.y : cols.filter(c => c.kind === 'number').map(c => c.name)).map(n => cols.findIndex(c => c.name === n)).filter(i => i >= 0 && i !== xi && cols[i].kind === 'number')
  if (ys.length !== 1) return null
  // Several rows per x (another dimension column) cannot be read as one series.
  const xsSeen = new Set(result.rows.map(r => String(r[xi])))
  if (xsSeen.size !== result.rows.length) return null
  const yi = ys[0]
  return { xi, yi, x: cols[xi].name, measure: cols[yi].name, points: result.rows.map(r => ({ x: r[xi], y: r[yi] === null ? null : Number(r[yi]) })) }
}

const T = {
  zh: {
    title: (name) => `📊 ${name}`,
    line: (m, v, avg, wk) => `**${m}** 昨天 ${v}，比 7 日均值${avg}${wk ? `，比上周同期${wk}` : ''}`,
    hi: (_p, a) => `高 ${(a * 100).toFixed(0)}%`, lo: (_p, a) => `低 ${(a * 100).toFixed(0)}%`, flat: '持平',
    from: (s) => `（主要来自 ${s}）`,
    notable: '值得关注', normal: '其他指标', none: '昨天各指标均在正常波动范围内。',
    err: (m, e) => `- ${m}：取数失败（${e}）`,
    main: '主要来自：',
    goal: '目标进度',
  },
  en: {
    title: (name) => `📊 ${name}`,
    line: (m, v, avg, wk) => `**${m}** yesterday ${v}, ${avg} vs 7-day avg${wk ? `, ${wk} vs same day last week` : ''}`,
    hi: (p) => `${p}`, lo: (p) => `${p}`, flat: 'flat',
    from: (s) => ` (mainly ${s})`,
    notable: 'Notable', normal: 'Other metrics', none: 'All metrics were within their normal range yesterday.',
    err: (m, e) => `- ${m}: query failed (${e})`,
    main: 'Mainly from: ',
    goal: 'Goal progress',
  },
}

function cmpText(p, L) {
  if (p === null || p === undefined) return '—'
  if (Math.abs(p) < 0.005) return L.flat
  return p > 0 ? L.hi(pctText(p), Math.abs(p)) : L.lo(pctText(p), Math.abs(p))
}

/** "dim=value +Δ" list for the top contributors of an explainChange result. */
function contributors(why, n, lang) {
  const top = why?.dimensions?.find(d => d.attribution)
  if (!top) return null
  const items = top.attribution.items.filter(i => i.value !== '其他' && Math.sign(i.delta) === Math.sign(top.attribution.total.delta || i.delta) && i.delta !== 0).slice(0, n)
  if (!items.length) return null
  return { dimension: top.dimension, text: items.map(i => `${i.value ?? 'NULL'} ${i.delta >= 0 ? '+' : ''}${numText(i.delta, lang)}`).join(lang === 'zh' ? '、' : ', ') }
}

export const methods = {
  // ------------------------------------------------------------ digests

  listDigests() {
    return (this.state.digests ?? []).map(d => ({ ...d, datasourceName: this.findDatasource(d.datasourceId)?.name ?? d.datasourceId, channelName: this.state.channels.find(c => c.id === d.channelId)?.name ?? null }))
  },

  async saveDigest(input = {}) {
    const existing = input.id ? (this.state.digests ?? []).find(d => d.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/invalid', '日报不存在')
    const d = existing ? { ...existing } : { id: newId('dg'), createdAt: Date.now() }
    d.name = requireText(input.name ?? d.name, 'name', 60)
    const ds = this.requireDatasource(input.datasourceId ?? d.datasourceId)
    d.datasourceId = ds.id
    const dashboardId = input.dashboardId !== undefined ? input.dashboardId : d.dashboardId
    if (dashboardId) {
      this.requireDashboard(dashboardId)
      d.dashboardId = dashboardId
      d.metrics = []
    } else {
      const metrics = Array.isArray(input.metrics) ? input.metrics : (d.metrics ?? [])
      if (!metrics.length) throw new UserError('nl2sql/invalid', '请至少选择一个指标或一个看板', 'metrics')
      d.metrics = metrics.slice(0, 20).map(ref => {
        const m = this.findMetric(ds, ref)
        if (!m) throw new UserError('nl2sql/unknown-metric', `指标库中没有「${ref}」`)
        return m.name
      })
      delete d.dashboardId
    }
    d.channelId = input.channelId !== undefined ? (input.channelId && this.state.channels.some(c => c.id === input.channelId) ? input.channelId : null) : (d.channelId ?? null)
    d.time = /^\d{2}:\d{2}$/.test(String(input.time ?? d.time ?? '')) ? (input.time ?? d.time) : '09:00'
    d.enabled = input.enabled !== undefined ? Boolean(input.enabled) : (d.enabled ?? true)
    d.language = oneOf(input.language ?? d.language ?? 'zh', ['zh', 'en'], 'language')
    d.threshold = Number.isFinite(Number(input.threshold ?? d.threshold)) ? Math.max(1, Math.min(500, Number(input.threshold ?? d.threshold ?? 30))) : 30
    d.updatedAt = Date.now()
    // Runtime fields from the stored object (a run may have finished meanwhile).
    const cur = (this.state.digests ?? []).find(x => x.id === d.id)
    if (cur) for (const k of ['lastRunAt', 'lastStatus', 'lastError']) d[k] = cur[k]
    this.state.digests = upsert(this.state.digests ?? [], d)
    await this.save()
    return d
  },

  async deleteDigest(id) {
    this.state.digests = (this.state.digests ?? []).filter(d => d.id !== id)
    await this.save()
    return { deleted: id }
  },

  listDigestRuns(digestId) {
    return this.records.list('digestRun', { ref: digestId, limit: 50 })
  },

  /** Run a digest: preview (default) or send (send: true). */
  async runDigest({ id, send = false, now = new Date() } = {}) {
    const d = (this.state.digests ?? []).find(x => x.id === id)
    if (!d) throw new UserError('nl2sql/invalid', '日报不存在')
    const run = { id: newId('dr'), digestId: d.id, name: d.name, at: Date.now(), preview: !send }
    try {
      const out = await this.computeDigest(d, now)
      Object.assign(run, { status: 'ok', title: out.title, text: out.text, items: out.items.map(({ result: _r, ...x }) => x), resultIds: out.resultIds })
      if (send) {
        if (!d.channelId) throw new UserError('nl2sql/invalid', '日报未设置推送渠道')
        await this.sendToChannel({ channelId: d.channelId, title: out.title, text: out.text, resultIds: out.resultIds, source: 'digest' })
        run.pushed = true
      }
      return { ...run, results: out.resultIds.map(r => this.lookupResult(r)).filter(Boolean) }
    } catch (error) {
      run.status = 'error'
      run.error = error.message
      throw error
    } finally {
      this.records.put('digestRun', run)
      if (send) {
        const cur = (this.state.digests ?? []).find(x => x.id === d.id)
        if (cur) { cur.lastRunAt = Date.now(); cur.lastStatus = run.status; cur.lastError = run.error }
        await this.save()
      }
    }
  },

  /** Series per metric / widget for the digest → statistics → summary. */
  async computeDigest(d, now = new Date()) {
    const lang = d.language === 'en' ? 'en' : 'zh'
    const L = T[lang]
    const today = midnight(now)
    const yesterday = ymd(addDays(today, -1))
    const days = Array.from({ length: 15 }, (_, i) => ymd(addDays(today, i - 15))) // 15 days ending yesterday
    const sources = []
    if (d.dashboardId) {
      const board = this.requireDashboard(d.dashboardId)
      for (const w of board.widgets.slice(0, 20)) sources.push({ name: w.title || w.id, load: () => this.runWidget(w.id, undefined, { useCache: false }) })
    } else {
      for (const m of d.metrics ?? []) {
        sources.push({ name: m, load: () => this.queryMetric({ datasourceId: d.datasourceId, metric: m, grain: 'day', from: days[0], to: ymd(today), title: `${m} · ${lang === 'zh' ? '近 15 天' : 'last 15 days'}`, source: 'digest', chart: { type: 'line', x: '时间', y: [m] } }) })
      }
    }
    const items = []
    for (const s of sources) {
      try {
        const result = await withTimeout(s.load(), 60000, s.name)
        const series = seriesOf(result)
        if (!series) { if (!d.dashboardId) items.push({ name: s.name, error: 'not a daily series' }); continue }
        const byDay = new Map()
        let rawLabel = {}
        for (const p of series.points) { const k = dayKey(p.x); if (!k) continue; byDay.set(k, (byDay.get(k) ?? 0) + (p.y ?? 0)); rawLabel[k] = p.x }
        if (!byDay.size) { if (!d.dashboardId) items.push({ name: s.name, error: 'no daily data' }); continue }
        // Dashboard widgets may cover other ranges: only use them when they reach yesterday's window.
        if (d.dashboardId && ![...byDay.keys()].some(k => k >= days[7])) continue
        const values = days.map(k => byDay.get(k) ?? 0)
        const st = dailyStats(values)
        items.push({ name: d.dashboardId ? s.name : s.name, measure: series.measure, stats: st, notable: isNotable(st, { z: 2, pct: (d.threshold ?? 30) / 100 }), result, labels: { current: rawLabel[yesterday], baseline: rawLabel[days[7]] ?? rawLabel[days[13]] } })
      } catch (error) {
        items.push({ name: s.name, error: error.message })
      }
    }
    // Attribution for the top 1–2 notable movers.
    const movers = items.filter(i => i.notable).sort((a, b) => Math.abs(b.stats.z ?? b.stats.vsAvg ?? 0) - Math.abs(a.stats.z ?? a.stats.vsAvg ?? 0))
    for (const it of movers.slice(0, 2)) {
      if (it.labels.current === undefined || it.labels.baseline === undefined) continue
      try {
        const why = await withTimeout(this.explainChange({ resultId: it.result.resultId, current: it.labels.current, baseline: it.labels.baseline }), 30000, 'attribution')
        const c = contributors(why, 2, lang)
        if (c) it.mainly = c.text
      } catch {}
    }
    const line = (it) => `- ${L.line(it.name, numText(it.stats.value, lang), cmpText(it.stats.vsAvg, L), it.stats.vsLastWeek === null ? null : cmpText(it.stats.vsLastWeek, L))}${it.mainly ? L.from(it.mainly) : ''}`
    const ok = items.filter(i => !i.error)
    const lines = []
    if (movers.length) lines.push(`**${L.notable}**`, ...movers.map(line))
    else lines.push(L.none)
    const rest = ok.filter(i => !i.notable)
    if (rest.length) lines.push('', `<font color='grey'>${L.normal}</font>`, ...rest.map(line))
    for (const i of items.filter(x => x.error)) lines.push(L.err(i.name, i.error))
    const charts = [...movers, ...rest].slice(0, 3).map(i => i.result.resultId)
    return {
      title: `${L.title(d.name)} · ${yesterday}`,
      text: lines.join('\n'),
      items: items.map(i => ({ name: i.name, error: i.error, notable: i.notable, mainly: i.mainly, ...(i.stats ? { stats: i.stats } : {}), resultId: i.result?.resultId })),
      resultIds: charts,
    }
  },

  // ------------------------------------------------------------ alert attribution

  /**
   * Called by checkAlertInner before pushing a fired alert: for a time series with ≥ 2 points,
   * attribute the change of the last point vs the previous one. Returns a Markdown line or null.
   */
  async beforeAlertPush(alert, result) {
    const s = seriesOf(result)
    if (!s || s.points.length < 2) return null
    // Chat-created alerts run as their creator: attribute under the same row rules.
    const actor = alert?.chatTarget && this.chatAlertActor ? await this.chatAlertActor(alert).catch(() => null) : undefined
    if (actor === null) return null
    const why = await withTimeout(this.explainChange({ resultId: result.resultId, actor }), this.config?.alertAttributionMs ?? 20000, 'attribution').catch(() => null)
    const c = contributors(why, 3, 'zh')
    return c ? `主要来自：${c.dimension} — ${c.text}` : null
  },

  // ------------------------------------------------------------ goals

  listGoals() {
    return (this.state.goals ?? []).map(g => ({ ...g, datasourceName: this.findDatasource(g.datasourceId)?.name ?? g.datasourceId }))
  },

  async saveGoal(input = {}) {
    const existing = input.id ? (this.state.goals ?? []).find(g => g.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/invalid', '目标不存在')
    const g = existing ? { ...existing } : { id: newId('gl'), createdAt: Date.now() }
    g.name = requireText(input.name ?? g.name, 'name', 60)
    const ds = this.requireDatasource(input.datasourceId ?? g.datasourceId)
    g.datasourceId = ds.id
    const m = this.findMetric(ds, input.metric ?? g.metric)
    if (!m) throw new UserError('nl2sql/unknown-metric', '指标库中没有这个指标')
    if (!m.timeColumn) throw new UserError('nl2sql/invalid', `指标「${m.name}」未配置时间列，无法按周期统计`)
    g.metric = m.name
    g.period = oneOf(input.period ?? g.period ?? 'month', ['month', 'quarter', 'year'], 'period')
    const target = Number(input.target ?? g.target)
    if (!Number.isFinite(target)) throw new UserError('nl2sql/invalid', '目标值必须是数字', 'target')
    g.target = target
    g.direction = oneOf(input.direction ?? g.direction ?? 'up', ['up', 'down'], 'direction')
    const dash = input.dashboardId !== undefined ? input.dashboardId : g.dashboardId
    if (dash) { this.requireDashboard(dash); g.dashboardId = dash } else delete g.dashboardId
    g.updatedAt = Date.now()
    this.state.goals = upsert(this.state.goals ?? [], g)
    await this.save()
    return g
  },

  async deleteGoal(id) {
    this.state.goals = (this.state.goals ?? []).filter(g => g.id !== id)
    await this.save()
    return { deleted: id }
  },

  /** Goals relevant to a dashboard (tied to it, or untied goals on its data sources); all when no dashboard. */
  goalsFor(dashboardId) {
    const goals = this.state.goals ?? []
    if (!dashboardId) return goals
    const board = this.state.dashboards.find(d => d.id === dashboardId)
    const dsIds = new Set((board?.widgets ?? []).map(w => w.datasourceId))
    return goals.filter(g => g.dashboardId === dashboardId || (!g.dashboardId && dsIds.has(g.datasourceId)))
  },

  /** Progress of one goal at `now`. */
  async goalProgressOne(g, now = new Date()) {
    const { start, end } = periodBounds(g.period, now)
    const today = midnight(now)
    const tomorrow = addDays(today, 1)
    const ds = this.requireDatasource(g.datasourceId)
    const metric = this.findMetric(ds, g.metric)
    if (!metric) throw new UserError('nl2sql/unknown-metric', `指标库中没有「${g.metric}」`)
    const base = { datasourceId: ds.id, metric: g.metric, source: 'goal' }
    const totalRes = await this.queryMetric({ ...base, from: ymd(start), to: ymd(tomorrow), title: `${g.name} · 累计` })
    const actual = Number(totalRes.rows[0]?.[totalRes.rows[0].length - 1] ?? 0) || 0
    let projected = actual
    let weekdayAware = false
    const additive = isAdditive(metric.expression)
    if (additive) {
      // Run rate from the trailing 28 complete days (independent of the period start).
      const from = addDays(today, -28)
      const daily = await this.queryMetric({ ...base, grain: 'day', from: ymd(from), to: ymd(tomorrow), title: `${g.name} · 日` })
      const s = seriesOf(daily)
      const byDay = new Map()
      for (const p of s?.points ?? []) { const k = dayKey(p.x); if (k) byDay.set(k, (byDay.get(k) ?? 0) + (p.y ?? 0)) }
      const todayValue = byDay.get(ymd(today)) ?? 0
      const hist = []
      for (let d = from; d < today; d = addDays(d, 1)) hist.push({ date: d, value: byDay.get(ymd(d)) ?? 0 })
      const p = projectRunRate({ daily: hist, actualComplete: actual - todayValue, today, end })
      projected = p.projected ?? actual
      weekdayAware = p.weekdayAware
    }
    const ended = now >= end
    const status = goalStatus({ direction: g.direction, target: g.target, actual, projected, ended })
    const ratio = (v) => (g.target ? v / g.target : null)
    const elapsed = (Math.min(now, end) - start) / (end - start)
    return { ...g, actual, projected, pct: ratio(actual), projectedPct: ratio(projected), elapsedPct: elapsed, status, additive, weekdayAware, periodStart: ymd(start), periodEnd: ymd(addDays(end, -1)) }
  },

  async goalProgress({ dashboardId, now } = {}) {
    const at = now ? new Date(now) : new Date()
    const out = []
    for (const g of this.goalsFor(dashboardId)) {
      try { out.push(await this.goalProgressOne(g, at)) } catch (error) { out.push({ ...g, status: 'error', error: error.message }) }
    }
    return out
  },

  getGoalPush() {
    return { enabled: false, channelId: null, weekday: 1, time: '09:00', ...(this.state.goalPush ?? {}) }
  },

  async saveGoalPush(input = {}) {
    const cur = this.getGoalPush()
    const next = {
      ...cur,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled,
      channelId: input.channelId !== undefined ? (input.channelId && this.state.channels.some(c => c.id === input.channelId) ? input.channelId : null) : cur.channelId,
      weekday: input.weekday !== undefined ? clampInt(input.weekday, 0, 6, 'weekday') : cur.weekday,
      time: /^\d{2}:\d{2}$/.test(String(input.time ?? '')) ? input.time : cur.time,
    }
    if (!cur.updatedAt || input.enabled) next.since = next.since ?? Date.now()
    next.updatedAt = Date.now()
    this.state.goalPush = next
    await this.save()
    return next
  },

  /** Markdown goal status report (also used by the weekly push). */
  async goalReport({ send = false, now } = {}) {
    const list = await this.goalProgress({ now })
    const icon = { 'on-track': '🟢', 'at-risk': '🟠', achieved: '✅', missed: '🔴', error: '⚠️' }
    const label = { 'on-track': '进度正常', 'at-risk': '有风险', achieved: '已达成', missed: '未达成', error: '出错' }
    const text = list.length
      ? list.map(g => g.error ? `- ${icon.error} **${g.name}**：${g.error}` : `- ${icon[g.status]} **${g.name}**（${g.metric}）：${fmtNum(g.actual)} / ${fmtNum(g.target)}（${(g.pct * 100).toFixed(0)}%），预计 ${fmtNum(g.projected)}（${(g.projectedPct * 100).toFixed(0)}%）· ${label[g.status]}`).join('\n')
      : '尚未设置目标。'
    if (send) {
      const cfg = this.getGoalPush()
      if (!cfg.channelId) throw new UserError('nl2sql/invalid', '目标周报未设置推送渠道')
      await this.sendToChannel({ channelId: cfg.channelId, title: '🎯 目标进度', text, source: 'goal' })
    }
    return { text, goals: list }
  },

  /** Scheduler jobs: due digests and the weekly goal push. */
  jobs_proactive(now) {
    const jobs = []
    for (const d of this.state.digests ?? []) {
      if (!d.enabled || !d.channelId) continue
      jobs.push({
        id: `digest:${d.id}`,
        due: (at) => (d.lastRunAt ?? d.createdAt ?? 0) < lastDailySlot(d.time, at),
        run: () => this.runDigest({ id: d.id, send: true, now }),
      })
    }
    const gp = this.state.goalPush
    if (gp?.enabled && gp.channelId && (this.state.goals ?? []).length) {
      jobs.push({
        id: 'goal-push',
        due: (at) => {
          const slot = new Date(lastDailySlot(gp.time, at))
          while (slot.getDay() !== gp.weekday) slot.setDate(slot.getDate() - 1)
          return (gp.lastRunAt ?? gp.since ?? gp.updatedAt ?? 0) < slot.getTime()
        },
        run: async () => {
          try { await this.goalReport({ send: true, now }) } finally { if (this.state.goalPush) this.state.goalPush.lastRunAt = Date.now(); await this.save() }
        },
      })
    }
    return jobs
  },

  // ------------------------------------------------------------ forecast

  /**
   * Forecast a single-measure time-series result. Returns the history, the forecast with a
   * 95% band, and `resultId` of a derived result (history + forecast columns) that can be sent or charted.
   */
  async forecast({ resultId, horizon = 7, sessionId, actor } = {}) {
    const r = this.lookupResult(resultId)
    if (!r) throw new UserError('nl2sql/result-expired', '结果已过期，请重新查询')
    this.assertResultAccess(r, actor ?? this.actorFor(sessionId))
    const s = seriesOf(r)
    if (!s) throw new UserError('nl2sql/invalid', '只能预测「时间 + 单个数值指标」的结果（不含分组系列）')
    const H = clampInt(horizon ?? 7, 1, 90, 'horizon')
    const points = s.points.filter(p => p.y !== null && Number.isFinite(p.y))
    if (points.length < 3) throw new UserError('nl2sql/invalid', '至少需要 3 个时间点才能预测')
    let fc
    try { fc = forecastPoints(points, { horizon: H }) } catch (error) { throw new UserError('nl2sql/invalid', error.message) }
    const round = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
    const cols = [{ name: s.x, kind: fc.kind === 'index' ? 'text' : 'time' }, { name: s.measure, kind: 'number' }, { name: '预测', kind: 'number' }, { name: '下限', kind: 'number' }, { name: '上限', kind: 'number' }]
    const lastHist = fc.history.at(-1)
    const rows = [
      ...fc.history.map(p => [p.x, p.y, null, null, null]),
      ...fc.forecast.map(f => [f.x, null, round(f.value), round(f.lower), round(f.upper)]),
    ]
    // Join the forecast line to the last observation.
    if (lastHist) rows[fc.history.length - 1][2] = lastHist.y
    const derived = {
      ...r,
      resultId: newId('r'),
      title: `${r.title || s.measure} · 预测 ${H}${fc.kind === 'day' ? ' 天' : ' 期'}`,
      columns: cols,
      rows,
      rowCount: rows.length,
      truncated: false,
      chart: { type: 'line', x: s.x, y: [s.measure, '预测'] },
      suggestedChart: undefined,
      forecastOf: r.resultId,
      createdAt: Date.now(),
    }
    this.remember(derived)
    const total = fc.forecast.reduce((a, f) => a + f.value, 0)
    const methodName = fc.method === 'holt-winters' ? 'Holt-Winters（周季节性）' : 'Holt 线性趋势'
    const summary = `基于 ${fc.history.length} 个历史点（${methodName}），未来 ${H} 期预测：${fc.forecast.slice(0, 3).map(f => `${f.x} ≈ ${fmtNum(f.value)}`).join('，')}${H > 3 ? ' …' : ''}；${H} 期合计约 ${fmtNum(total)}，95% 区间宽度 ±${fmtNum(1.96 * fc.sigma)}（第 1 期）。${fc.filled ? `缺失的 ${fc.filled} 天按 0 补齐。` : ''}`
    return {
      resultId: r.resultId,
      forecastResultId: derived.resultId,
      datasourceId: r.datasourceId,
      title: r.title,
      x: s.x,
      measure: s.measure,
      horizon: H,
      method: fc.method,
      params: fc.params,
      sigma: fc.sigma,
      kind: fc.kind,
      filled: fc.filled,
      history: fc.history,
      forecast: fc.forecast.map(f => ({ x: f.x, h: f.h, value: round(f.value), lower: round(f.lower), upper: round(f.upper) })),
      summary,
    }
  },
}

export const FEATURE = {
  name: 'proactive',
  methods,
  rpc: (service) => ({
    listDigests: () => service.listDigests(),
    saveDigest: (p) => service.saveDigest(p ?? {}),
    deleteDigest: (p) => service.deleteDigest(p?.id),
    runDigest: (p) => service.runDigest({ id: p?.id, send: Boolean(p?.send) }),
    listDigestRuns: (p) => service.listDigestRuns(p?.digestId),
    listGoals: () => service.listGoals(),
    saveGoal: (p) => service.saveGoal(p ?? {}),
    deleteGoal: (p) => service.deleteGoal(p?.id),
    goalProgress: (p) => service.goalProgress({ dashboardId: p?.dashboardId }),
    getGoalPush: () => service.getGoalPush(),
    saveGoalPush: (p) => service.saveGoalPush(p ?? {}),
    sendGoalReport: () => service.goalReport({ send: true }),
    forecast: (p) => service.forecast({ resultId: p?.resultId, horizon: p?.horizon ?? 7 }),
  }),
  tools(ctx, service, { textBlock }) {
    ctx.tools.register({
      name: 'nl2sql_forecast',
      description: 'Forecast the next N periods of an existing time-series result (resultId from nl2sql_query / nl2sql_metric with a time column and ONE numeric measure, no series split). Uses Holt-Winters with weekly seasonality for daily data with ≥ 21 points, else Holt linear trend; returns point forecasts with a 95% interval and shows a chart (history + dashed forecast + band) to the user. Use for "预测/forecast/下周会是多少" questions; state that it is a statistical extrapolation.',
      parameters: {
        type: 'object',
        properties: {
          resultId: { type: 'string', description: 'resultId of a time-series result.' },
          horizon: { type: 'integer', minimum: 1, maximum: 90, description: 'Periods to forecast (default 7).' },
        },
        required: ['resultId'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => textBlock(JSON.stringify(value.model)),
        presentationMeta: (_args, value) => value.display,
      },
      isConcurrencySafe: () => true,
      presentCall: (args) => ({ card: 'generic', title: `预测未来 ${args?.horizon ?? 7} 期`, kind: 'read' }),
      execute: async (args, exec) => {
        try {
          const f = await service.forecast({ resultId: args.resultId, horizon: args.horizon ?? 7, sessionId: exec.agent?.id })
          return {
            model: { summary: f.summary, method: f.method, forecastResultId: f.forecastResultId, measure: f.measure, forecast: f.forecast },
            display: JSON.parse(JSON.stringify({ forecast: { ...f, history: f.history.slice(-120) } }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))),
          }
        } catch (error) {
          throw error instanceof UserError ? new Error(error.message) : error
        }
      },
    })
  },
}
