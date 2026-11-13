/**
 * Feature "milestones" (破纪录播报): every morning, check yesterday's value of chosen metrics for
 *  - record: highest (or lowest, for lower-is-better metrics) day in the data or the last year,
 *    optionally "first time above" a round number;
 *  - month record: on the last day of a month, highest month total (additive metrics only);
 *  - streak: N consecutive days of growth (decline) — announced at N, 2N, 3N … days;
 *  - total: the running total crossing a round mark (additive metrics, step auto or fixed).
 * Found events go to a channel as one celebratory card with a 60-day trend; no events → no message.
 * Rules live in state.milestones; each check is a 'milestoneRun' record. Queries go through
 * queryMetric (→ runQuery), so policies, masking and audit apply.
 */
import { isAdditive } from '../analysis.js'
import { fmtPlain } from '../channels/message.js'
import { addDays, dayKey, seriesOf, ymd } from './proactive.js'
import { UserError, clampInt, lastDailySlot, newId, oneOf, requireText, upsert } from './shared.js'

const HISTORY_DAYS = 400
const MIN_HISTORY = 30
const CHART_DAYS = 60
const KINDS = ['record', 'month', 'streak', 'total']
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

function timeout(ms, label) {
  return new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`${label} 超时`)), ms); t.unref?.() })
}
const withTimeout = (p, ms, label = '') => Promise.race([p, timeout(ms, label)])

/** Largest 1 / 2 / 5 × 10^k not above v (v ≥ 10), else null. */
export function niceFloor(v) {
  if (!(v >= 10)) return null
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [5, 2, 1]) if (m * p <= v) return m * p
  return p
}

/** Step of round marks for a running total: 10^k below it (1,234,567 → 1,000,000). */
export function autoStep(total) {
  return total >= 10 ? 10 ** Math.floor(Math.log10(total)) : null
}

/** A round number as people say it: 100000000 → "1 亿" / "100M". */
export function markText(n, lang = 'zh') {
  const clean = (x) => String(Number(x.toFixed(2)))
  if (lang === 'zh') {
    if (Math.abs(n) >= 1e8 && n % 1e6 === 0) return `${clean(n / 1e8)} 亿`
    if (Math.abs(n) >= 1e4 && n % 100 === 0) return `${clean(n / 1e4)} 万`
    return fmtPlain(n)
  }
  if (Math.abs(n) >= 1e9 && n % 1e7 === 0) return `${clean(n / 1e9)}B`
  if (Math.abs(n) >= 1e6 && n % 1e4 === 0) return `${clean(n / 1e6)}M`
  if (Math.abs(n) >= 1e3 && n % 10 === 0) return `${clean(n / 1e3)}K`
  return fmtPlain(n)
}

/**
 * Milestones on `day` ('YYYY-MM-DD') for one metric.
 * byDay: Map day → number (complete days only); historyStart: first day of the queried window
 * (records are "all-time" when the data starts after it). totalAfter: running total through `day`
 * (null to skip). Returns [{ kind, ... }].
 */
export function detectMilestones({ byDay, day, historyStart, rule, additive, totalAfter = null }) {
  const down = rule.direction === 'down'
  const better = (a, b) => (down ? a < b : a > b)
  const kinds = rule.kinds ?? {}
  const value = (k) => { const v = byDay.get(k); return v === undefined || v === null || !Number.isFinite(v) ? (additive ? 0 : null) : v }
  const cur = byDay.get(day)
  const events = []
  if (cur === undefined || cur === null || !Number.isFinite(cur)) return events
  const keys = [...byDay.keys()].sort()
  const first = keys[0]
  const allTime = first > historyStart
  const prior = keys.filter(k => k < day && byDay.get(k) !== null && Number.isFinite(byDay.get(k)))

  // Daily record (needs a month of history; an empty day of an additive metric is never a record).
  if (kinds.record !== false && prior.length >= MIN_HISTORY && !(additive && cur <= 0)) {
    let bestDay = null
    for (const k of prior) if (bestDay === null || better(byDay.get(k), byDay.get(bestDay)) || byDay.get(k) === byDay.get(bestDay)) bestDay = k
    const best = byDay.get(bestDay)
    if (better(cur, best)) {
      // "First time above 1,000" is news; "above 20" is not.
      const mark = down || cur < 100 ? null : niceFloor(cur)
      events.push({ kind: 'record', day, value: cur, previous: best, previousDay: bestDay, allTime, ...(mark !== null && best < mark ? { crossed: mark } : {}) })
    }
  }

  // Month record on the month's last day (complete months inside the window only).
  const d = new Date(`${day}T00:00:00`)
  if (kinds.month !== false && additive && addDays(d, 1).getDate() === 1) {
    const month = day.slice(0, 7)
    const totals = new Map()
    for (const k of keys) if (k <= day) totals.set(k.slice(0, 7), (totals.get(k.slice(0, 7)) ?? 0) + (byDay.get(k) ?? 0))
    // Months fully inside the window (or all months, when the data starts after the window start).
    const firstFull = first.endsWith('-01') ? first.slice(0, 7) : ymd(addDays(new Date(`${first.slice(0, 7)}-01T00:00:00`), 32)).slice(0, 7)
    const priorMonths = [...totals.keys()].filter(m => m < month && m >= firstFull && (allTime || `${m}-01` >= historyStart))
    if (priorMonths.length >= 3) {
      let bestM = null
      for (const m of priorMonths) if (bestM === null || better(totals.get(m), totals.get(bestM))) bestM = m
      if (better(totals.get(month), totals.get(bestM))) events.push({ kind: 'month', day, month, value: totals.get(month), previous: totals.get(bestM), previousMonth: bestM, allTime })
    }
  }

  // Streak: consecutive days each better than the one before, announced at N, 2N, 3N …
  const n = rule.streakDays ?? 5
  if (kinds.streak !== false && n >= 2) {
    let len = 0
    let k = day
    for (;;) {
      const prev = ymd(addDays(new Date(`${k}T00:00:00`), -1))
      const a = value(k)
      const b = value(prev)
      if (a === null || b === null || prev < first || !better(a, b)) break
      len++
      k = prev
    }
    if (len >= n && len % n === 0) events.push({ kind: 'streak', day, days: len, from: value(k), value: cur })
  }

  // Running total crossing a round mark.
  if (kinds.total !== false && additive && !down && totalAfter !== null && Number.isFinite(totalAfter)) {
    const before = totalAfter - cur
    const step = rule.totalStep > 0 ? rule.totalStep : autoStep(totalAfter)
    if (step && Math.floor(before / step) < Math.floor(totalAfter / step)) events.push({ kind: 'total', day, mark: Math.floor(totalAfter / step) * step, total: totalAfter })
  }
  return events
}

const T = {
  zh: {
    title: (name, day) => `🎉 ${name} · ${day}`,
    record: (m, e, down) => `🏆 **${m}** ${e.day.slice(5)} 达到 **${fmtPlain(e.value)}**，创${e.allTime ? '历史' : '近一年'}${down ? '新低' : '新高'}${e.crossed ? `，首次突破 ${markText(e.crossed)}` : ''}（此前${down ? '最低' : '最高'} ${fmtPlain(e.previous)}，${e.previousDay}）`,
    month: (m, e, down) => `📅 **${m}** ${e.month} 月合计 **${fmtPlain(e.value)}**，创${e.allTime ? '历史' : '近一年'}单月${down ? '新低' : '新高'}（此前${down ? '最低' : '最高'} ${e.previousMonth}：${fmtPlain(e.previous)}）`,
    streak: (m, e, down) => `🔥 **${m}** 已连续 **${e.days} 天**${down ? '下降' : '增长'}：${fmtPlain(e.from)} → ${fmtPlain(e.value)}`,
    total: (m, e) => `🎯 **${m}** 累计突破 **${markText(e.mark)}**（截至 ${e.day} 累计 ${fmtPlain(e.total)}）`,
    none: (day) => `${day} 没有新纪录。`,
    err: (m, msg) => `- ${m}：取数失败（${msg}）`,
    chart: (m) => `${m} · 近 ${CHART_DAYS} 天`,
  },
  en: {
    title: (name, day) => `🎉 ${name} · ${day}`,
    record: (m, e, down) => `🏆 **${m}** hit **${fmtPlain(e.value)}** on ${e.day.slice(5)}, ${e.allTime ? 'an all-time' : 'a 12-month'} ${down ? 'low' : 'high'}${e.crossed ? `, above ${markText(e.crossed, 'en')} for the first time` : ''} (previous ${down ? 'low' : 'best'} ${fmtPlain(e.previous)} on ${e.previousDay})`,
    month: (m, e, down) => `📅 **${m}** totalled **${fmtPlain(e.value)}** in ${e.month}, ${e.allTime ? 'an all-time' : 'a 12-month'} monthly ${down ? 'low' : 'high'} (previous ${e.previousMonth}: ${fmtPlain(e.previous)})`,
    streak: (m, e, down) => `🔥 **${m}** ${down ? 'fell' : 'grew'} **${e.days} days** in a row: ${fmtPlain(e.from)} → ${fmtPlain(e.value)}`,
    total: (m, e) => `🎯 **${m}** passed **${markText(e.mark, 'en')}** in total (${fmtPlain(e.total)} through ${e.day})`,
    none: (day) => `No new milestones on ${day}.`,
    err: (m, msg) => `- ${m}: query failed (${msg})`,
    chart: (m) => `${m} · last ${CHART_DAYS} days`,
  },
}
const ORDER = { record: 0, total: 1, month: 2, streak: 3 }

export const methods = {
  listMilestones() {
    return (this.state.milestones ?? []).map(r => ({ ...r, datasourceName: this.findDatasource(r.datasourceId)?.name ?? r.datasourceId, channelName: this.state.channels.find(c => c.id === r.channelId)?.name ?? null }))
  },

  async saveMilestone(input = {}) {
    const existing = input.id ? (this.state.milestones ?? []).find(r => r.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/invalid', '播报规则不存在')
    const r = existing ? { ...existing } : { id: newId('ms'), createdAt: Date.now() }
    r.name = requireText(input.name ?? r.name, 'name', 60)
    const ds = this.requireDatasource(input.datasourceId ?? r.datasourceId)
    r.datasourceId = ds.id
    const metrics = Array.isArray(input.metrics) ? input.metrics : (r.metrics ?? [])
    if (!metrics.length) throw new UserError('nl2sql/invalid', '请至少选择一个指标', 'metrics')
    r.metrics = metrics.slice(0, 10).map(ref => {
      const m = this.findMetric(ds, ref)
      if (!m) throw new UserError('nl2sql/unknown-metric', `指标库中没有「${ref}」`)
      if (!m.timeColumn) throw new UserError('nl2sql/invalid', `指标「${m.name}」未配置时间列，无法按天检查`)
      return m.name
    })
    const kinds = { ...(r.kinds ?? { record: true, month: true, streak: true, total: true }), ...(input.kinds ?? {}) }
    r.kinds = Object.fromEntries(KINDS.map(k => [k, kinds[k] !== false]))
    if (!KINDS.some(k => r.kinds[k])) throw new UserError('nl2sql/invalid', '请至少选择一种纪录', 'kinds')
    r.direction = oneOf(input.direction ?? r.direction ?? 'up', ['up', 'down'], 'direction')
    r.streakDays = clampInt(input.streakDays ?? r.streakDays ?? 5, 2, 60, 'streakDays')
    const step = input.totalStep !== undefined ? Number(input.totalStep || 0) : (r.totalStep ?? 0)
    if (!Number.isFinite(step) || step < 0) throw new UserError('nl2sql/invalid', '累计里程碑的间隔必须是正数', 'totalStep')
    r.totalStep = step
    r.channelId = input.channelId !== undefined ? (input.channelId && this.state.channels.some(c => c.id === input.channelId) ? input.channelId : null) : (r.channelId ?? null)
    r.time = /^\d{2}:\d{2}$/.test(String(input.time ?? r.time ?? '')) ? (input.time ?? r.time) : '09:30'
    r.mentionAll = input.mentionAll !== undefined ? Boolean(input.mentionAll) : (r.mentionAll ?? false)
    r.enabled = input.enabled !== undefined ? Boolean(input.enabled) : (r.enabled ?? true)
    r.language = oneOf(input.language ?? r.language ?? 'zh', ['zh', 'en'], 'language')
    r.updatedAt = Date.now()
    const cur = (this.state.milestones ?? []).find(x => x.id === r.id)
    if (cur) for (const k of ['lastRunAt', 'lastStatus', 'lastError', 'lastEvents', 'totalBases']) r[k] = cur[k]
    this.state.milestones = upsert(this.state.milestones ?? [], r)
    await this.save()
    return r
  },

  async deleteMilestone(id) {
    this.state.milestones = (this.state.milestones ?? []).filter(r => r.id !== id)
    await this.save()
    return { deleted: id }
  },

  listMilestoneRuns(ruleId) {
    return this.records.list('milestoneRun', { ref: ruleId, limit: 50 })
  },

  /** Daily series (last HISTORY_DAYS complete days) and, if needed, the running total of one metric. */
  async milestoneSeries(rule, metricName, today) {
    const ds = this.requireDatasource(rule.datasourceId)
    const metric = this.findMetric(ds, metricName)
    if (!metric) throw new UserError('nl2sql/unknown-metric', `指标库中没有「${metricName}」`)
    const additive = isAdditive(metric.expression)
    const historyStart = ymd(addDays(today, -HISTORY_DAYS))
    const result = await withTimeout(this.queryMetric({ datasourceId: ds.id, metric: metric.name, grain: 'day', from: historyStart, to: ymd(today), title: metric.name, source: 'milestone', chart: { type: 'line', x: '时间', y: [metric.name] }, maxRows: HISTORY_DAYS + 10 }), 60000, metric.name)
    const s = seriesOf(result)
    if (!s) throw new UserError('nl2sql/invalid', '指标不是按天的单一数值序列')
    const byDay = new Map()
    for (const p of s.points) {
      const k = dayKey(p.x)
      if (!k || k >= ymd(today)) continue
      byDay.set(k, (byDay.get(k) ?? 0) + (p.y ?? 0))
    }
    let total = null
    if (additive && rule.direction !== 'down' && rule.kinds?.total !== false) {
      // Running total = (total before a fixed base day, cached on the rule) + the daily values since.
      // The base is re-read (one full-table aggregate, admin-configured so the scan guard is waived)
      // only when it is missing, the metric definition changed, or the base day left the window.
      const sig = JSON.stringify([metric.table, metric.expression, metric.filter ?? '', metric.timeColumn])
      const cur = (this.state.milestones ?? []).find(x => x.id === rule.id)
      let base = cur?.totalBases?.[metric.name]
      if (!base || base.sig !== sig || base.before < historyStart) {
        const t = await withTimeout(this.queryMetric({ datasourceId: ds.id, metric: metric.name, to: historyStart, title: `${metric.name} · 累计`, source: 'milestone', confirmScan: true }), 120000, metric.name)
        const v = Number(t.rows?.[0]?.at(-1))
        base = { before: historyStart, value: Number.isFinite(v) ? v : 0, sig, at: Date.now() }
        if (cur) { cur.totalBases = { ...(cur.totalBases ?? {}), [metric.name]: base }; await this.save() }
      }
      total = base.value + [...byDay].filter(([k]) => k >= base.before).reduce((a, [, v]) => a + v, 0)
    }
    return { metric, additive, historyStart, byDay, total, result }
  },

  /** Milestones of a rule for `day` (default yesterday): { day, items, events, text, title, resultIds }. */
  async computeMilestones(rule, { now = new Date(), day } = {}) {
    const lang = rule.language === 'en' ? 'en' : 'zh'
    const L = T[lang]
    const today = midnight(now)
    const target = day ?? ymd(addDays(today, -1))
    const down = rule.direction === 'down'
    const items = []
    for (const name of rule.metrics ?? []) {
      try {
        const s = await this.milestoneSeries(rule, name, today)
        const totalAfter = s.total === null ? null : s.total - [...s.byDay].filter(([k]) => k > target).reduce((a, [, v]) => a + v, 0)
        const events = detectMilestones({ byDay: s.byDay, day: target, historyStart: s.historyStart, rule, additive: s.additive, totalAfter })
        items.push({ name, events, series: s })
      } catch (error) {
        items.push({ name, events: [], error: error.message })
      }
    }
    const lines = []
    for (const it of items) for (const e of [...it.events].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) lines.push(L[e.kind](it.name, e, down))
    const errors = items.filter(i => i.error).map(i => L.err(i.name, i.error))
    // Trend of the last CHART_DAYS days for up to 3 metrics with events.
    const resultIds = []
    for (const it of items.filter(i => i.events.length).slice(0, 3)) {
      const r = it.series.result
      const s = seriesOf(r)
      const from = ymd(addDays(new Date(`${target}T00:00:00`), -(CHART_DAYS - 1)))
      const rows = r.rows.filter(row => { const k = dayKey(row[s.xi]); return k && k >= from && k <= target })
      const derived = { ...r, resultId: newId('r'), title: L.chart(it.name), rows, rowCount: rows.length, truncated: false, chart: { type: 'line', x: s.x, y: [s.measure] }, suggestedChart: undefined, createdAt: Date.now() }
      this.remember(derived)
      resultIds.push(derived.resultId)
    }
    const events = items.flatMap(i => i.events.map(e => ({ metric: i.name, ...e })))
    return {
      day: target,
      title: L.title(rule.name, target),
      text: lines.length ? [...lines, ...(errors.length ? ['', ...errors] : [])].join('\n') : [L.none(target), ...errors].join('\n'),
      events,
      errors: items.filter(i => i.error).map(i => ({ metric: i.name, error: i.error })),
      resultIds,
    }
  },

  /** Check a rule: preview (default) or send (send: true; sends only when there are events unless force). */
  async runMilestone({ id, send = false, force = false, now = new Date(), day } = {}) {
    const rule = (this.state.milestones ?? []).find(x => x.id === id)
    if (!rule) throw new UserError('nl2sql/invalid', '播报规则不存在')
    const run = { id: newId('mr'), ruleId: rule.id, name: rule.name, at: Date.now(), preview: !send }
    try {
      const out = await this.computeMilestones(rule, { now, day })
      Object.assign(run, { status: out.errors.length && !out.events.length ? 'error' : 'ok', day: out.day, title: out.title, text: out.text, events: out.events, errors: out.errors, resultIds: out.resultIds })
      if (out.errors.length && !out.events.length) run.error = out.errors.map(e => `${e.metric}：${e.error}`).join('；')
      if (send && (out.events.length || force)) {
        if (!rule.channelId) throw new UserError('nl2sql/invalid', '播报规则未设置推送渠道')
        await this.sendToChannel({ channelId: rule.channelId, title: out.title, text: rule.mentionAll && out.events.length ? `${out.text}\n<at id=all></at>` : out.text, resultIds: out.resultIds, source: 'milestone', template: 'carmine' })
        run.pushed = true
      }
      return { ...run, results: out.resultIds.map(r => this.lookupResult(r)).filter(Boolean) }
    } catch (error) {
      run.status = 'error'
      run.error = error.message
      throw error
    } finally {
      this.records.put('milestoneRun', run)
      if (send) {
        const cur = (this.state.milestones ?? []).find(x => x.id === rule.id)
        if (cur) { cur.lastRunAt = Date.now(); cur.lastStatus = run.status; cur.lastError = run.error; cur.lastEvents = run.events?.length ?? 0 }
        await this.save()
      }
    }
  },

  /** What the rule would have announced on each of the last `days` days (nothing is sent). */
  async backtestMilestone({ id, days = 30, now = new Date() } = {}) {
    const rule = (this.state.milestones ?? []).find(x => x.id === id)
    if (!rule) throw new UserError('nl2sql/invalid', '播报规则不存在')
    const n = clampInt(days, 1, 90, 'days')
    const lang = rule.language === 'en' ? 'en' : 'zh'
    const L = T[lang]
    const today = midnight(now)
    const out = []
    const errors = []
    for (const name of rule.metrics ?? []) {
      let s
      try { s = await this.milestoneSeries(rule, name, today) } catch (error) { errors.push({ metric: name, error: error.message }); continue }
      for (let i = n; i >= 1; i--) {
        const day = ymd(addDays(today, -i))
        const totalAfter = s.total === null ? null : s.total - [...s.byDay].filter(([k]) => k > day).reduce((a, [, v]) => a + v, 0)
        for (const e of detectMilestones({ byDay: s.byDay, day, historyStart: s.historyStart, rule, additive: s.additive, totalAfter })) out.push({ metric: name, ...e, text: L[e.kind](name, e, rule.direction === 'down') })
      }
    }
    out.sort((a, b) => (a.day === b.day ? ORDER[a.kind] - ORDER[b.kind] : a.day < b.day ? 1 : -1))
    return { days: n, events: out, errors, daysWithEvents: new Set(out.map(e => e.day)).size }
  },

  /** Scheduler: one check per rule per day at its time. */
  jobs_milestones(now) {
    const jobs = []
    for (const r of this.state.milestones ?? []) {
      if (!r.enabled || !r.channelId) continue
      jobs.push({
        id: `milestone:${r.id}`,
        due: (at) => (r.lastRunAt ?? r.createdAt ?? 0) < lastDailySlot(r.time, at),
        run: () => this.runMilestone({ id: r.id, send: true, now }),
      })
    }
    return jobs
  },
}

export const FEATURE = {
  name: 'milestones',
  methods,
  rpc: (service) => ({
    listMilestones: () => service.listMilestones(),
    saveMilestone: (p) => service.saveMilestone(p ?? {}),
    deleteMilestone: (p) => service.deleteMilestone(p?.id),
    runMilestone: (p) => service.runMilestone({ id: p?.id, send: Boolean(p?.send), force: Boolean(p?.force) }),
    backtestMilestone: (p) => service.backtestMilestone({ id: p?.id, days: p?.days ?? 30 }),
    listMilestoneRuns: (p) => service.listMilestoneRuns(p?.ruleId),
  }),
}
