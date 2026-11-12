/**
 * Forecasting (pure functions, no I/O).
 *
 * - Holt-Winters additive with weekly seasonality (m = 7) for daily series with ≥ 21 points;
 * - otherwise Holt's linear trend.
 * Parameters are fitted by a small grid search minimising the one-step-ahead SSE.
 * Prediction intervals: residual stddev × 1.96 × sqrt(h).
 */

const GRID = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
const GRID_TREND = [0.01, 0.05, 0.1, 0.2, 0.3]
const GRID_SEASON = [0.05, 0.1, 0.2, 0.3, 0.5]

/** Holt's linear trend: one-step fitted values, final level/trend. */
export function holtFit(y, alpha, beta) {
  const n = y.length
  if (n < 2) return { fitted: y.map(() => null), level: y[0] ?? 0, trend: 0, sse: 0, count: 0 }
  let level = y[0]
  let trend = y[1] - y[0]
  const fitted = [null]
  let sse = 0
  let count = 0
  for (let t = 1; t < n; t++) {
    const f = level + trend
    fitted.push(f)
    if (t >= 2) { sse += (y[t] - f) ** 2; count++ }
    const prev = level
    level = alpha * y[t] + (1 - alpha) * (level + trend)
    trend = beta * (level - prev) + (1 - beta) * trend
  }
  return { fitted, level, trend, sse, count }
}

/** Holt-Winters additive with season length m (needs ≥ 2 m points). */
export function holtWintersFit(y, alpha, beta, gamma, m = 7) {
  const n = y.length
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const s1 = mean(y.slice(0, m))
  const s2 = mean(y.slice(m, 2 * m))
  let level = s1
  let trend = (s2 - s1) / m
  // Initial seasonal indices: average deviation from each full season's mean.
  const seasons = Math.floor(n / m)
  const season = new Array(m).fill(0)
  for (let k = 0; k < seasons; k++) {
    const mk = mean(y.slice(k * m, (k + 1) * m))
    for (let i = 0; i < m; i++) season[i] += (y[k * m + i] - mk) / seasons
  }
  // Level at the end of the first season: start the recursion at t = m.
  level = s1 + trend * (m - 1) / 2
  const fitted = new Array(m).fill(null)
  let sse = 0
  let count = 0
  for (let t = m; t < n; t++) {
    const si = t % m
    const f = level + trend + season[si]
    fitted.push(f)
    sse += (y[t] - f) ** 2
    count++
    const prev = level
    level = alpha * (y[t] - season[si]) + (1 - alpha) * (level + trend)
    trend = beta * (level - prev) + (1 - beta) * trend
    season[si] = gamma * (y[t] - level) + (1 - gamma) * season[si]
  }
  return { fitted, level, trend, season, sse, count, n, m }
}

/**
 * Fit and forecast `horizon` steps ahead.
 * @param {number[]} values  evenly spaced observations (no nulls)
 * @param {{ horizon?: number, seasonal?: boolean, period?: number }} opts  seasonal: allow weekly seasonality
 * @returns {{ method, params, fitted, forecast: { h, value, lower, upper }[], sigma }}
 */
export function forecastSeries(values, { horizon = 7, seasonal = true, period = 7 } = {}) {
  const y = values.map(Number)
  if (y.length < 3 || y.some(v => !Number.isFinite(v))) throw new Error('至少需要 3 个有效数值才能预测')
  const H = Math.max(1, Math.min(365, Math.floor(horizon)))
  const useHW = seasonal && y.length >= 3 * period
  let best
  if (useHW) {
    for (const a of GRID) for (const b of GRID_TREND) for (const g of GRID_SEASON) {
      const fit = holtWintersFit(y, a, b, g, period)
      if (!best || fit.sse < best.fit.sse) best = { fit, params: { alpha: a, beta: b, gamma: g } }
    }
  } else {
    for (const a of GRID) for (const b of GRID_TREND) {
      const fit = holtFit(y, a, b)
      if (!best || fit.sse < best.fit.sse) best = { fit, params: { alpha: a, beta: b } }
    }
  }
  const { fit, params } = best
  const sigma = fit.count > 1 ? Math.sqrt(fit.sse / (fit.count - 1)) : 0
  const forecast = []
  for (let h = 1; h <= H; h++) {
    const value = useHW
      ? fit.level + h * fit.trend + fit.season[(y.length + h - 1) % period]
      : fit.level + h * fit.trend
    const w = 1.96 * sigma * Math.sqrt(h)
    forecast.push({ h, value, lower: value - w, upper: value + w })
  }
  return { method: useHW ? 'holt-winters' : 'holt', params, fitted: fit.fitted, forecast, sigma }
}

// ------------------------------------------------------------ time axis

const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
const fmtDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** Parse a time label to { kind, ms } (UTC-based arithmetic, display unchanged). */
export function parseTimeLabel(v) {
  const s = String(v ?? '').trim()
  let m
  // Dates serialized as midnight ISO timestamps (driver Date → ISO) are days.
  if ((m = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?Z?$/.exec(s))) return { kind: 'day', ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s))) return { kind: 'hour', ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return { kind: 'day', ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) }
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return { kind: 'month', ms: Date.UTC(+m[1], +m[2] - 1, 1) }
  if ((m = /^(\d{4})-W(\d{2})$/.exec(s))) return { kind: 'week', ms: Date.UTC(+m[1], 0, 1) + (+m[2]) * 7 * DAY }
  if ((m = /^(\d{4})$/.exec(s))) return { kind: 'year', ms: Date.UTC(+m[1], 0, 1) }
  return null
}

/**
 * Turn [{ x, y }] (sorted or not) into an evenly spaced series. Daily series get missing days
 * filled with 0 (metrics like counts/sums have no row on days without data).
 * Returns { kind, xs, ys, filled }.
 */
export function regularize(points) {
  const parsed = points.map(p => ({ ...p, t: parseTimeLabel(p.x) })).filter(p => p.y !== null && p.y !== undefined && Number.isFinite(Number(p.y)))
  const timed = parsed.length >= 2 && parsed.every(p => p.t && p.t.kind === parsed[0].t.kind)
  if (!timed) return { kind: 'index', xs: parsed.map(p => String(p.x)), ys: parsed.map(p => Number(p.y)), filled: 0 }
  parsed.sort((a, b) => a.t.ms - b.t.ms)
  const kind = parsed[0].t.kind
  if (kind !== 'day') return { kind, xs: parsed.map(p => String(p.x)), ys: parsed.map(p => Number(p.y)), filled: 0 }
  const byDay = new Map()
  for (const p of parsed) byDay.set(p.t.ms, (byDay.get(p.t.ms) ?? 0) + Number(p.y))
  const xs = []
  const ys = []
  let filled = 0
  for (let ms = parsed[0].t.ms; ms <= parsed.at(-1).t.ms; ms += DAY) {
    xs.push(fmtDay(new Date(ms)))
    if (byDay.has(ms)) ys.push(byDay.get(ms)); else { ys.push(0); filled++ }
  }
  return { kind, xs, ys, filled }
}

/** Labels for the next `horizon` steps after the last label. */
export function futureLabels(lastLabel, kind, horizon) {
  const t = parseTimeLabel(lastLabel)
  const out = []
  for (let h = 1; h <= horizon; h++) {
    if (!t || kind === 'index' || kind === 'week') { out.push(`+${h}`); continue }
    const d = new Date(t.ms)
    if (kind === 'day') out.push(fmtDay(new Date(t.ms + h * DAY)))
    else if (kind === 'hour') { const x = new Date(t.ms + h * 3600000); out.push(`${fmtDay(x)} ${pad(x.getUTCHours())}:00`) }
    else if (kind === 'month') { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + h, 1)); out.push(`${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}`) }
    else if (kind === 'year') out.push(String(d.getUTCFullYear() + h))
  }
  return out
}

/** Forecast a labelled series: [{ x, y }] → history + labelled forecast. */
export function forecastPoints(points, { horizon = 7 } = {}) {
  const reg = regularize(points)
  const res = forecastSeries(reg.ys, { horizon, seasonal: reg.kind === 'day' })
  const labels = futureLabels(reg.xs.at(-1), reg.kind, res.forecast.length)
  return {
    method: res.method,
    params: res.params,
    sigma: res.sigma,
    kind: reg.kind,
    filled: reg.filled,
    history: reg.xs.map((x, i) => ({ x, y: reg.ys[i] })),
    forecast: res.forecast.map((f, i) => ({ ...f, x: labels[i] })),
  }
}

// ------------------------------------------------------------ digest statistics

/**
 * Daily comparison for the digest: `values` is a day-indexed array ending with the day
 * of interest. Compares the last value with the mean / stddev of the 7 days before it
 * and with the same weekday one week earlier.
 */
export function dailyStats(values) {
  const y = values.map(Number)
  const cur = y.at(-1)
  const prev = y.slice(-8, -1)
  const avg = prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : null
  const sd = prev.length > 1 ? Math.sqrt(prev.reduce((s, v) => s + (v - avg) ** 2, 0) / (prev.length - 1)) : null
  const lastWeek = y.length >= 8 ? y.at(-8) : null
  const pct = (a, b) => (b === null || b === undefined || b === 0 ? null : (a - b) / Math.abs(b))
  return {
    value: cur,
    avg7: avg,
    sd7: sd,
    z: sd ? (cur - avg) / sd : null,
    vsAvg: pct(cur, avg),
    lastWeek,
    vsLastWeek: pct(cur, lastWeek),
  }
}

/** Is a daily comparison notable? |z| > zLimit or |Δ% vs 7-day avg| > pctLimit. */
export function isNotable(stats, { z = 2, pct = 0.3 } = {}) {
  return (stats.z !== null && Math.abs(stats.z) > z) || (stats.vsAvg !== null && Math.abs(stats.vsAvg) > pct)
}

// ------------------------------------------------------------ goals

/**
 * Period bounds (local calendar) containing `now`: { start, end } as Date (end exclusive).
 */
export function periodBounds(period, now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (period === 'year') return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) }
  if (period === 'quarter') { const q = Math.floor(m / 3) * 3; return { start: new Date(y, q, 1), end: new Date(y, q + 3, 1) } }
  return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) }
}

/**
 * Run-rate projection. `daily`: [{ date: Date (local midnight), value }] for complete days
 * from the period start up to yesterday. Remaining days (today .. end-1) are projected with
 * the per-weekday mean when every weekday has a sample, else the overall daily mean.
 * Returns { projected, weekdayAware, remainingDays } (projected null without data).
 */
export function projectRunRate({ daily, actualComplete, today, end }) {
  const remaining = []
  for (let d = new Date(today); d < end; d.setDate(d.getDate() + 1)) remaining.push(new Date(d))
  if (!daily.length) return { projected: null, weekdayAware: false, remainingDays: remaining.length }
  const all = daily.reduce((s, d) => s + d.value, 0) / daily.length
  const byWd = new Map()
  for (const d of daily) { const w = d.date.getDay(); const e = byWd.get(w) ?? { s: 0, n: 0 }; e.s += d.value; e.n++; byWd.set(w, e) }
  const weekdayAware = byWd.size === 7
  let rest = 0
  for (const d of remaining) rest += weekdayAware ? byWd.get(d.getDay()).s / byWd.get(d.getDay()).n : all
  return { projected: actualComplete + rest, weekdayAware, remainingDays: remaining.length }
}

/** Goal status from actual-to-date and projection. */
export function goalStatus({ direction = 'up', target, actual, projected, ended = false }) {
  if (direction === 'down') {
    if (actual > target) return 'missed'
    if (ended) return 'achieved'
    return projected === null || projected <= target ? 'on-track' : 'at-risk'
  }
  if (actual >= target) return 'achieved'
  if (ended) return 'missed'
  return projected !== null && projected >= target ? 'on-track' : 'at-risk'
}
