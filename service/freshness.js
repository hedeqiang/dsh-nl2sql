/**
 * Feature: data freshness + data quality patrol ("health").
 *
 * Freshness: for every analyzed table with a time column, MAX(time column) via runQuery
 * (source 'freshness'), stored per data source in state.freshness[dsId][table]; a scheduler
 * job refreshes it (default every 30 min) and pushes once per stale episode (and once on
 * recovery) to the configured channel (record kind 'freshnessEvent').
 *
 * Quality: bounded aggregate queries per table (row count, null rates, duplicate keys on
 * unique indexes, mean ± 4σ outliers, future timestamps, negative amounts) → health score
 * 0–100 per table and per data source with zh/en explanations (record kind 'qualityRun');
 * optional daily job and a push when the data source score drops by more than N points.
 *
 * Every statement goes through runQuery (admission, access policy, row rules, masking, audit).
 */
import { quoteIdent, quoteName } from '../analysis.js'
import { referencedTables } from '../policy.js'
import { UserError, lastDailySlot, newId } from './shared.js'

// ------------------------------------------------------------------ constants

// enabled: scheduled checks + notifications + the agent tool; showInUi: warning bars under results and the schema panel.
export const FRESHNESS_DEFAULTS = { enabled: true, showInUi: true, intervalMin: 30, staleHours: 24, overrides: {}, channelId: null }
export const QUALITY_DEFAULTS = { enabled: false, time: '06:30', channelId: null, dropPoints: 10, maxTableRows: 5000000, maxTables: 60 }
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp', 'timestamptz'])
const NUM_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'])
/** Time columns that legitimately point at the future or are not "data arrival" times. */
const NOT_ARRIVAL = /(deleted|next_|expire|expir|due|deadline|schedul|plan|valid|until|_end|end_|retry|birth|start_date|effective)/i
const FUTURE_OK = /(next_|expire|expir|due|deadline|schedul|plan|valid|until|_end|end_|retry|effective)/i
const AMOUNT_LIKE = /(amount|amt|price|fee|cost|balance|total|qty|quantity|money|revenue|gmv|pay|paid|salary|income|金额|价格|余额|费用|数量)/i
/** Columns that are legitimately empty most of the time: null rates are reported but not scored. */
const OPTIONAL_NAME = /(deleted|remark|note|comment|memo|desc|extra|ext_|_ext|reason|error|err_|msg|message|parent|avatar|url|tag|attach|image|img|icon|_at$|_time$|_date$)/i

// ------------------------------------------------------------------ pure helpers

/** Best "data arrival" time column of a table: created_at > updated_at > timestamp-like > other *_at. */
export function pickTimeColumn(table) {
  const cands = (table?.columns ?? []).filter(c => c.roles?.includes('time') && !c.roles.includes('sensitive') && DATE_TYPES.has(String(c.dataType).toLowerCase()) && !NOT_ARRIVAL.test(c.name))
  if (!cands.length) return undefined
  const rank = (c) => {
    const n = c.name.toLowerCase()
    if (/^(created_at|create_time|created_time|gmt_create|created|creation_time|insert_time|inserted_at)$/.test(n)) return 0
    if (/^(updated_at|update_time|updated_time|gmt_modified|modified_at|modify_time|last_modified)$/.test(n)) return 1
    if (/^(@?timestamp|ts|event_time|event_at|log_time|occurred_at|time|datetime|dt)$/.test(n)) return 2
    if (/(creat|insert)/.test(n)) return 3
    if (/(updat|modif)/.test(n)) return 4
    if (/(timestamp|time|date|_at$)/.test(n)) return 5
    return 6
  }
  return [...cands].sort((a, b) => rank(a) - rank(b))[0]
}

/** Whether the column is the first column of some index (MAX can use it). */
export function isIndexed(table, column) {
  return (table?.indexes ?? []).some(i => i.columns?.[0] === column)
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * Parse a database time value into epoch ms. Strings without an offset are local wall time
 * (MySQL dateStrings, SQLite); a date-only value means "data through that day" (end of day).
 */
export function parseTime(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000
  const s = String(v).trim()
  if (/^\d{10}(\d{3})?$/.test(s)) return Number(s) * (s.length === 10 ? 1000 : 1)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i)
  if (!m) { const t = Date.parse(s); return Number.isFinite(t) ? t : null }
  const [, y, mo, d, hh, mi, ss, frac, tz] = m
  if (hh === undefined) return new Date(Number(y), Number(mo) - 1, Number(d) + 1, 0, 0, 0, 0).getTime() - 1
  const ms = frac ? Math.round(Number(frac) * 1000) : 0
  if (tz) {
    const off = tz.toUpperCase() === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.slice(3).replace(':', '') || '00'}`
    return Date.parse(`${y}-${mo}-${d}T${hh}:${mi}:${ss ?? '00'}.${String(ms).padStart(3, '0')}${off}`)
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss ?? 0), ms).getTime()
}

/** Local wall time "YYYY-MM-DD HH:mm". */
export function localStamp(ms) {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "23 小时" / "23 hours". */
export function lagText(min, lang = 'zh') {
  if (!Number.isFinite(min)) return lang === 'zh' ? '未知' : 'unknown'
  const m = Math.max(0, Math.round(min))
  if (m < 60) return lang === 'zh' ? `${m} 分钟` : `${m} min`
  if (m < 48 * 60) { const h = Math.round(m / 60); return lang === 'zh' ? `${h} 小时` : `${h} hour${h === 1 ? '' : 's'}` }
  const d = Math.round(m / 1440)
  return lang === 'zh' ? `${d} 天` : `${d} days`
}

/** Human "停在昨天 17:55" style location of a timestamp relative to now. */
export function whenText(ms, now = Date.now(), lang = 'zh') {
  if (!Number.isFinite(ms)) return '—'
  const d = new Date(ms)
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff === 0) return lang === 'zh' ? `今天 ${hm}` : `today ${hm}`
  if (diff === 1) return lang === 'zh' ? `昨天 ${hm}` : `yesterday ${hm}`
  if (diff === 2 && lang === 'zh') return `前天 ${hm}`
  return `${d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}-`}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

/** Threshold (hours) for one table; 0 means "not monitored". */
export function thresholdFor(settings, dsId, table) {
  const o = settings?.overrides?.[dsId]?.[table]
  if (o !== undefined && o !== null && o !== '' && Number.isFinite(Number(o))) return Math.max(0, Number(o))
  return Number(settings?.staleHours ?? FRESHNESS_DEFAULTS.staleHours)
}

/** Status of one freshness entry: ok / warn (> 50 % of threshold) / stale / empty / error / off. */
export function freshnessStatus(entry, thresholdHours) {
  if (!entry) return 'unknown'
  if (entry.error) return 'error'
  if (entry.latestAt === null || entry.latestAt === undefined) return 'empty'
  if (!thresholdHours) return 'off'
  const lag = entry.lagMinutes ?? 0
  if (lag > thresholdHours * 60) return 'stale'
  if (lag > thresholdHours * 30) return 'warn'
  return 'ok'
}

/** SQL fragment producing MAX(col) as a string-ish value, per dialect. */
function maxExpr(dialect, C, forUnion) {
  if (!forUnion) return `MAX(${C})`
  if (dialect === 'mysql') return `CAST(MAX(${C}) AS CHAR)`
  if (dialect === 'postgres') return `MAX(${C})::text`
  return `MAX(${C})`
}

/** "Now + 1 hour" in the database's own clock: rows dated further ahead are typos, not freshness. */
export function nowPlusHour(dialect) {
  if (dialect === 'mysql') return 'NOW() + INTERVAL 1 HOUR'
  if (dialect === 'postgres') return "now() + interval '1 hour'"
  if (dialect === 'sqlite') return "datetime('now', 'localtime', '+1 hour')"
  return 'NOW() + INTERVAL 1 HOUR'
}

/** One statement computing MAX(time) of a single table (ignoring future-dated rows). */
export function freshnessSql(dialect, table, column) {
  const C = quoteIdent(column, dialect)
  return `SELECT ${maxExpr(dialect, C, false)} AS latest_at FROM ${quoteName(table, dialect)} WHERE ${C} <= ${nowPlusHour(dialect)}`
}

/** One UNION ALL statement for several tables (mysql / postgres / sqlite). */
export function freshnessUnionSql(dialect, items) {
  return items.map(({ table, column }, i) => { const C = quoteIdent(column, dialect); return `SELECT ${i} AS k, ${maxExpr(dialect, C, true)} AS latest_at FROM ${quoteName(table, dialect)} WHERE ${C} <= ${nowPlusHour(dialect)}` }).join(' UNION ALL ')
}

/** Plain decimal literal (no exponent) for a finite number. */
export function numLiteral(n) {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) < 1e15 && Math.abs(n) > 1e-6) return String(Number(n.toPrecision(15)))
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 })
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/**
 * Health score of one table from its check results. Returns { score, issues[] } where each
 * issue has { kind, column?, deduct, zh, en }.
 */
export function scoreTable(r) {
  const issues = []
  const add = (kind, deduct, zh, en, extra = {}) => issues.push({ kind, deduct, zh, en, ...extra })
  const pct = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`
  if (r.rowCount === 0) return { score: null, issues: [{ kind: 'empty', deduct: 0, zh: '表为空，未评分', en: 'Empty table, not scored' }] }
  // Null rates (core columns weigh more; optional-looking columns are not scored).
  let nullDeduct = 0
  for (const c of r.nulls ?? []) {
    if (c.optional || c.rate <= 0.2) continue
    const w = c.core ? 2 : 1
    const d = (c.rate > 0.9 ? 4 : c.rate > 0.5 ? 2 : 1) * w
    const take = Math.min(d, 20 - nullDeduct)
    if (take <= 0) break
    nullDeduct += take
    add('nulls', take, `字段 ${c.column} 空值率 ${pct(c.rate)}`, `Column ${c.column} is ${pct(c.rate)} NULL`, { column: c.column })
  }
  let dupDeduct = 0
  for (const k of r.duplicates ?? []) {
    if (!(k.duplicates > 0)) continue
    const take = Math.min(20, 30 - dupDeduct)
    if (take <= 0) break
    dupDeduct += take
    add('duplicates', take, `唯一键 ${k.columns.join(', ')} 有 ${k.duplicates} 行重复${k.approximate ? '（近似）' : ''}`, `Unique key ${k.columns.join(', ')} has ${k.duplicates} duplicate row(s)${k.approximate ? ' (approximate)' : ''}`, { column: k.columns.join(',') })
  }
  let outDeduct = 0
  for (const o of r.outliers ?? []) {
    if (!(o.count > 0)) continue
    const rate = o.count / Math.max(1, r.rowCount)
    const take = Math.min(rate > 0.01 ? 8 : rate > 0.001 ? 4 : 2, 15 - outDeduct)
    if (take <= 0) break
    outDeduct += take
    add('outliers', take, `字段 ${o.column} 有 ${o.count} 个异常值（超出均值 ±4σ：${numLiteral(o.low)} ~ ${numLiteral(o.high)}）`, `Column ${o.column} has ${o.count} outlier(s) (beyond mean ± 4σ: ${numLiteral(o.low)} – ${numLiteral(o.high)})`, { column: o.column })
  }
  let futDeduct = 0
  for (const f of r.future ?? []) {
    if (!(f.count > 0)) continue
    const rate = f.count / Math.max(1, r.rowCount)
    const take = Math.min(rate > 0.001 ? 10 : 5, 20 - futDeduct)
    if (take <= 0) break
    futDeduct += take
    add('future', take, `时间字段 ${f.column} 有 ${f.count} 行晚于当前时间`, `Time column ${f.column} has ${f.count} row(s) in the future`, { column: f.column })
  }
  let negDeduct = 0
  for (const n of r.negatives ?? []) {
    if (!(n.count > 0)) continue
    const rate = n.count / Math.max(1, r.rowCount)
    const take = Math.min(rate > 0.01 ? 10 : 5, 20 - negDeduct)
    if (take <= 0) break
    negDeduct += take
    add('negative', take, `金额类字段 ${n.column} 有 ${n.count} 个负值`, `Amount-like column ${n.column} has ${n.count} negative value(s)`, { column: n.column })
  }
  if (r.freshness?.stale) add('stale', 15, `数据已 ${lagText(r.freshness.lagMinutes, 'zh')} 未更新（阈值 ${r.freshness.thresholdHours} 小时）`, `No new data for ${lagText(r.freshness.lagMinutes, 'en')} (threshold ${r.freshness.thresholdHours} h)`)
  for (const e of r.errors ?? []) add('error', 0, `检查未完成：${e}`, `Check failed: ${e}`)
  const score = Math.max(0, 100 - issues.reduce((s, i) => s + i.deduct, 0))
  return { score, issues }
}

/** Data source score: average of table scores weighted by log10(rows + 10). */
export function scoreDatasource(tables) {
  let w = 0
  let s = 0
  for (const t of tables) {
    if (t.score === null || t.score === undefined) continue
    const wt = Math.log10((t.rowCount ?? 0) + 10)
    w += wt
    s += wt * t.score
  }
  return w ? Math.round(s / w) : null
}

// ------------------------------------------------------------------ service methods

export const methods = {
  // ---------------------------------------------------------------- settings

  freshnessState() {
    this.state.freshness ??= {}
    const f = this.state.freshness
    f.settings = { ...FRESHNESS_DEFAULTS, ...(f.settings ?? {}) }
    f.settings.overrides ??= {}
    return f
  },

  qualityState() {
    this.state.quality ??= {}
    const q = this.state.quality
    q.settings = { ...QUALITY_DEFAULTS, ...(q.settings ?? {}) }
    q.latest ??= {}
    return q
  },

  healthSettings() {
    return { freshness: structuredClone(this.freshnessState().settings), quality: structuredClone(this.qualityState().settings) }
  },

  async saveHealthSettings({ freshness, quality } = {}) {
    const intIn = (v, min, max, field) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < min || n > max) throw new UserError('nl2sql/invalid', `${field} 必须在 ${min}–${max} 之间`)
      return n
    }
    const channel = (v) => (v === undefined ? undefined : v && this.state.channels.some(c => c.id === v) ? v : null)
    if (freshness) {
      const s = this.freshnessState().settings
      if (freshness.enabled !== undefined) s.enabled = Boolean(freshness.enabled)
      if (freshness.showInUi !== undefined) s.showInUi = Boolean(freshness.showInUi)
      if (freshness.intervalMin !== undefined) s.intervalMin = Math.round(intIn(freshness.intervalMin, 5, 1440, 'intervalMin'))
      if (freshness.staleHours !== undefined) s.staleHours = intIn(freshness.staleHours, 0.25, 24 * 90, 'staleHours')
      if (freshness.channelId !== undefined) s.channelId = channel(freshness.channelId)
      if (freshness.overrides !== undefined) {
        if (!freshness.overrides || typeof freshness.overrides !== 'object') throw new UserError('nl2sql/invalid', 'overrides 必须是对象')
        const out = {}
        for (const [dsId, tables] of Object.entries(freshness.overrides)) {
          if (!this.findDatasource(dsId) || !tables || typeof tables !== 'object') continue
          for (const [table, hours] of Object.entries(tables)) {
            if (hours === null || hours === '' || hours === undefined) continue
            ;(out[dsId] ??= {})[String(table).slice(0, 200)] = intIn(hours, 0, 24 * 90, `overrides.${table}`)
          }
        }
        s.overrides = out
      }
    }
    if (quality) {
      const s = this.qualityState().settings
      if (quality.enabled !== undefined) s.enabled = Boolean(quality.enabled)
      if (quality.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(quality.time))) throw new UserError('nl2sql/invalid', 'time 必须是 HH:MM')
        s.time = String(quality.time)
      }
      if (quality.channelId !== undefined) s.channelId = channel(quality.channelId)
      if (quality.dropPoints !== undefined) s.dropPoints = Math.round(intIn(quality.dropPoints, 1, 100, 'dropPoints'))
      if (quality.maxTableRows !== undefined) s.maxTableRows = Math.round(intIn(quality.maxTableRows, 1000, 1e10, 'maxTableRows'))
      if (quality.maxTables !== undefined) s.maxTables = Math.round(intIn(quality.maxTables, 1, 500, 'maxTables'))
    }
    await this.save()
    return this.healthSettings()
  },

  // ---------------------------------------------------------------- freshness

  /**
   * Run MAX(time) for the given tables of `ds` (visible schema). Returns { [table]: entry }.
   * Unrestricted callers batch tables into UNION ALL statements (one audit line per batch,
   * per-table fallback on failure); restricted actors run one statement per table.
   */
  async measureFreshness(ds, tables, { actor, sessionId } = {}) {
    const dialect = ds.type ?? 'mysql'
    const out = {}
    const items = tables.map(t => ({ table: t.name, column: pickTimeColumn(t)?.name, indexed: false, t })).filter(x => x.column)
    for (const x of items) x.indexed = isIndexed(x.t, x.column)
    const restricted = Boolean(actor && actor.kind !== 'owner' && (this.rowRulesFor(actor, ds).length || actor.role === 'viewer'))
    const run = (sql, title, confirmScan) => this.runQuery({ sql, datasourceId: ds.id, title, source: 'freshness', actor, sessionId, confirmScan, governed: true })
    const record = (x, value, error) => {
      const checkedAt = Date.now()
      const latestAt = error ? null : parseTime(value)
      out[x.table] = { column: x.column, latestAt, latestRaw: value === undefined || value === null ? null : String(value), checkedAt, lagMinutes: latestAt === null ? null : Math.round((checkedAt - latestAt) / 60000), ...(latestAt !== null && latestAt > checkedAt + 60000 ? { future: true } : {}), ...(error ? { error: String(error).slice(0, 300) } : {}) }
    }
    const single = async (x) => {
      try {
        const r = await run(freshnessSql(dialect, x.table, x.column), `数据新鲜度 · ${x.table}`, x.indexed)
        record(x, r.rows[0]?.[0])
      } catch (error) { record(x, null, error.message) }
    }
    if (!restricted && dialect !== 'elasticsearch' && items.length > 1) {
      for (let i = 0; i < items.length; i += 50) {
        const batch = items.slice(i, i + 50)
        try {
          const r = await run(freshnessUnionSql(dialect, batch), `数据新鲜度 · ${batch.length} 张表`, batch.every(x => x.indexed))
          const seen = new Set()
          for (const row of r.rows) { const k = Number(row[0]); if (batch[k]) { record(batch[k], row[1]); seen.add(k) } }
          for (let k = 0; k < batch.length; k++) if (!seen.has(k)) await single(batch[k])
        } catch {
          for (const x of batch) await single(x)
        }
      }
    } else {
      for (const x of items) await single(x)
    }
    return out
  },

  /** Refresh stored freshness of one data source (all or some tables) and notify episodes. */
  async refreshFreshness(ds, { tables: only, notify = true } = {}) {
    const schema = await this.cachedVisibleSchema(ds)
    if (!schema) return {}
    const f = this.freshnessState()
    const wanted = only?.length ? schema.tables.filter(t => only.includes(t.name)) : schema.tables
    const measured = await this.measureFreshness(ds, wanted.slice(0, 300))
    const store = (f[ds.id] ??= {})
    // Tables gone from the schema (or without a time column now) drop out on a full refresh.
    if (!only?.length) for (const k of Object.keys(store)) if (!measured[k]) delete store[k]
    const changes = []
    for (const [table, m] of Object.entries(measured)) {
      const prev = store[table]
      const thresholdHours = thresholdFor(f.settings, ds.id, table)
      const stale = freshnessStatus(m, thresholdHours) === 'stale'
      const entry = { ...m, thresholdHours, stale }
      if (m.error && prev?.stale) {
        // A failed check does not end a stale episode.
        Object.assign(entry, { stale: true, staleSince: prev.staleSince, notified: prev.notified, latestAt: prev.latestAt, lagMinutes: prev.latestAt === null ? null : Math.round((m.checkedAt - prev.latestAt) / 60000) })
      } else if (stale) {
        entry.staleSince = prev?.stale ? (prev.staleSince ?? m.checkedAt) : m.checkedAt
        entry.notified = Boolean(prev?.stale && prev.notified)
        if (!entry.notified) changes.push({ kind: 'stale', table, entry })
      } else if (prev?.stale && prev.notified && !m.error) {
        changes.push({ kind: 'recovered', table, entry })
      }
      store[table] = entry
    }
    if (notify && changes.length) await this.notifyFreshness(ds, changes)
    await this.save()
    return store
  },

  /** Record + push stale / recovered events (one message per kind per data source). */
  async notifyFreshness(ds, changes) {
    const f = this.freshnessState()
    const channelId = f.settings.channelId && this.state.channels.some(c => c.id === f.settings.channelId) ? f.settings.channelId : null
    for (const kind of ['stale', 'recovered']) {
      const list = changes.filter(c => c.kind === kind)
      if (!list.length) continue
      const events = list.map(c => ({ id: newId('fe'), at: Date.now(), datasourceId: ds.id, datasourceName: ds.name, table: c.table, column: c.entry.column, kind, latestAt: c.entry.latestAt, lagMinutes: c.entry.lagMinutes, thresholdHours: c.entry.thresholdHours }))
      let pushed = false
      let pushError
      if (channelId) {
        const lines = list.map(c => kind === 'stale'
          ? `- **${c.table}** 最新数据停在 ${whenText(c.entry.latestAt)}（滞后 ${lagText(c.entry.lagMinutes)}，阈值 ${c.entry.thresholdHours} 小时）`
          : `- **${c.table}** 已恢复，最新数据 ${whenText(c.entry.latestAt)}`)
        try {
          await this.sendToChannel({
            channelId,
            title: kind === 'stale' ? `⚠️ 数据延迟：${ds.name}` : `✅ 数据已恢复更新：${ds.name}`,
            text: `${lines.join('\n')}\n\n<font color='grey'>数据源：${ds.name} · 检查时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</font>`,
            source: 'freshness',
            template: kind === 'stale' ? 'orange' : 'green',
          })
          pushed = true
        } catch (error) { pushError = error.message }
      }
      for (const e of events) this.records.put('freshnessEvent', { ...e, pushed, ...(pushError ? { pushError } : {}) })
      // Mark the episode notified (even without a channel: the event is recorded once per episode).
      for (const c of list) if (kind === 'stale') c.entry.notified = true
    }
  },

  /** Public view of the stored freshness of one data source. */
  freshnessView(ds, store) {
    const f = this.freshnessState()
    const tables = Object.entries(store ?? {}).map(([table, e]) => {
      const thresholdHours = thresholdFor(f.settings, ds.id, table)
      return { table, column: e.column, latestAt: e.latestAt, latestLocal: localStamp(e.latestAt), checkedAt: e.checkedAt, lagMinutes: e.lagMinutes, thresholdHours, status: freshnessStatus(e, thresholdHours), stale: freshnessStatus(e, thresholdHours) === 'stale', ...(e.future ? { future: true } : {}), ...(e.error ? { error: e.error } : {}), ...(e.staleSince ? { staleSince: e.staleSince } : {}) }
    }).sort((a, b) => (b.lagMinutes ?? -1) - (a.lagMinutes ?? -1))
    const checkedAt = tables.reduce((m, t) => Math.max(m, t.checkedAt ?? 0), 0) || null
    return { datasourceId: ds.id, datasourceName: ds.name, analyzed: Boolean(ds.schemaAnalyzedAt), checkedAt, staleCount: tables.filter(t => t.stale).length, tables }
  },

  /** RPC: stored freshness (computed on first use or when refresh); `sql` narrows to referenced tables. */
  async freshnessFor({ datasourceId, refresh = false, sql, panel = false } = {}) {
    const ds = this.requireDatasource(datasourceId ?? this.state.current)
    const f = this.freshnessState()
    // Page panels (result bars, schema panel) ask with panel: true; when the feature or its
    // page display is off they get nothing and no query runs.
    if (panel && (!f.settings.enabled || f.settings.showInUi === false)) return { datasourceId: ds.id, disabled: true, tables: [] }
    let store = f[ds.id]
    if (refresh || !store) {
      if (refresh) store = await this.withJobLock(`freshness:${ds.id}`, () => this.refreshFreshness(ds))
      else store = await this.refreshFreshness(ds)
    }
    const view = this.freshnessView(ds, store)
    if (typeof sql === 'string' && sql.trim()) {
      const schema = await this.cachedVisibleSchema(ds)
      let refs = []
      try { refs = schema ? referencedTables(sql, schema.tables, { dialect: ds.type ?? 'mysql' }) : [] } catch {}
      view.referenced = refs
      view.tables = view.tables.filter(t => refs.includes(t.table))
      view.staleCount = view.tables.filter(t => t.stale).length
    }
    return view
  },

  freshnessEvents({ datasourceId, limit = 50 } = {}) {
    return this.records.list('freshnessEvent', { ref: datasourceId || undefined, limit: Math.min(500, Number(limit) || 50) })
  },

  /** Scheduler body: refresh every analyzed data source. */
  async runFreshnessAll() {
    const f = this.freshnessState()
    f.lastRunAt = Date.now()
    const out = []
    for (const ds of this.state.datasources) {
      if (!ds.schemaAnalyzedAt) continue
      try { await this.withJobLock(`freshness:${ds.id}`, () => this.refreshFreshness(ds)); out.push({ id: ds.id, ok: true }) } catch (error) { if (error.code !== 'nl2sql/busy') out.push({ id: ds.id, ok: false, error: error.message }) }
    }
    f.lastRun = { at: f.lastRunAt, ms: Date.now() - f.lastRunAt, results: out }
    await this.save()
    return out
  },

  /**
   * Agent tool body: freshness of some tables for a session actor. Owner sessions reuse
   * stored values younger than 10 minutes; restricted actors (row rules, viewers) always
   * measure live under their own rules and nothing is stored.
   */
  async freshnessForSession({ sessionId, datasource, tables }) {
    const ds = this.datasourceForSession(sessionId, datasource)
    const actor = this.actorFor(sessionId)
    this.assertAccess(actor, ds)
    const schema = await this.visibleSchema(ds)
    const names = Array.isArray(tables) && tables.length ? tables.map(String) : null
    const pickTables = names ? schema.tables.filter(t => names.some(n => n.toLowerCase() === t.name.toLowerCase())) : schema.tables
    const unknown = names ? names.filter(n => !schema.tables.some(t => t.name.toLowerCase() === n.toLowerCase())) : []
    const f = this.freshnessState()
    const restricted = Boolean(actor && actor.kind !== 'owner' && (this.rowRulesFor(actor, ds).length || actor.role === 'viewer'))
    let entries
    if (restricted) {
      entries = await this.measureFreshness(ds, pickTables, { actor, sessionId })
    } else {
      const store = f[ds.id] ?? {}
      const old = pickTables.filter(t => pickTimeColumn(t) && !(store[t.name]?.checkedAt > Date.now() - 10 * 60000))
      if (old.length) await this.refreshFreshness(ds, { tables: old.map(t => t.name) })
      entries = f[ds.id] ?? {}
    }
    const now = Date.now()
    const rows = []
    for (const t of pickTables) {
      const e = entries[t.name]
      if (!e) { rows.push({ table: t.name, note: 'no time column; freshness unknown' }); continue }
      const thresholdHours = thresholdFor(f.settings, ds.id, t.name)
      const status = freshnessStatus(e, thresholdHours)
      rows.push({ table: t.name, column: e.column, latestAt: localStamp(e.latestAt), lag: e.latestAt === null ? null : lagText(e.lagMinutes), lagMinutes: e.lagMinutes, thresholdHours, status, ...(e.error ? { error: e.error } : {}), ...(e.future ? { note: 'latest timestamp is in the future' } : {}) })
    }
    const stale = rows.filter(r => r.status === 'stale' || r.status === 'warn')
    const warnings = stale.map(r => `⚠️ ${r.table} 最新数据停在${whenText(parseTime(r.latestAt), now)}（滞后 ${r.lag}）`)
    return { datasource: ds.name, now: localStamp(now), tables: rows.slice(0, 100), ...(unknown.length ? { unknown } : {}), ...(warnings.length ? { warnings } : {}) }
  },

  // ---------------------------------------------------------------- quality

  /** Count rows matching each condition: one SUM(CASE) statement, or one per condition on ES. */
  async countConditions(ds, table, conds, run) {
    if (!conds.length) return []
    const dialect = ds.type ?? 'mysql'
    const T = quoteName(table, dialect)
    if (dialect === 'elasticsearch') {
      const out = []
      for (const c of conds) {
        try { const r = await run(`SELECT COUNT(*) AS n FROM ${T} WHERE ${c}`); out.push(num(r.rows[0]?.[0]) ?? 0) } catch (error) { out.push({ error: error.message }) }
      }
      return out
    }
    const r = await run(`SELECT ${conds.map((c, i) => `SUM(CASE WHEN ${c} THEN 1 ELSE 0 END) AS q${i}`).join(', ')} FROM ${T}`)
    return conds.map((_, i) => num(r.rows[0]?.[i]) ?? 0)
  },

  /** Quality checks of one table (bounded aggregate statements). */
  async scanTableQuality(ds, t, { settings, freshness }) {
    const dialect = ds.type ?? 'mysql'
    const q = (c) => quoteIdent(c, dialect)
    const T = quoteName(t.name, dialect)
    const errors = []
    const run = (sql) => this.runQuery({ sql, datasourceId: ds.id, title: `数据质量 · ${t.name}`, source: 'quality', confirmScan: true, governed: true })
    const out = { table: t.name, rowsEstimate: t.rows ?? null, rowCount: null, nulls: [], duplicates: [], outliers: [], future: [], negatives: [], errors }
    if ((t.rows ?? 0) > settings.maxTableRows) {
      // Huge table: only a row count estimate from the schema, no scans.
      out.skipped = true
      out.score = null
      out.issues = [{ kind: 'skipped', deduct: 0, zh: `表过大（约 ${t.rows} 行，阈值 ${settings.maxTableRows}），已跳过`, en: `Table too large (~${t.rows} rows, limit ${settings.maxTableRows}), skipped` }]
      return out
    }
    const cols = t.columns.filter(c => !(dialect === 'elasticsearch' && /^(text|match_only_text|object|nested|geo_point|geo_shape)$/.test(String(c.dataType))) && c.name !== '_id')
    const nullCols = cols.filter(c => c.nullable !== false).slice(0, 40)
    const measures = cols.filter(c => c.roles?.includes('measure') && !c.roles.includes('flag') && NUM_TYPES.has(String(c.dataType))).slice(0, 6)
    // 1. profile: row count, non-null counts, measure moments.
    // SQLite has no STDDEV_POP: AVG(x²) − AVG(x)² instead (s holds the second moment there).
    const sdExpr = (C) => (dialect === 'sqlite' ? `AVG((${C} + 0.0) * (${C} + 0.0))` : `STDDEV_POP(${C})`)
    const parts = ['COUNT(*) AS n', ...nullCols.map((c, i) => `COUNT(${q(c.name)}) AS c${i}`), ...measures.flatMap((c, i) => [`AVG(${q(c.name)}) AS m${i}`, `${sdExpr(q(c.name))} AS s${i}`, `MIN(${q(c.name)}) AS lo${i}`, `MAX(${q(c.name)}) AS hi${i}`])]
    let row
    try {
      row = (await run(`SELECT ${parts.join(', ')} FROM ${T}`)).rows[0] ?? []
    } catch (error) {
      try { row = [(await run(`SELECT COUNT(*) AS n FROM ${T}`)).rows[0]?.[0]] } catch (e2) { errors.push(e2.message); out.score = null; out.issues = [{ kind: 'error', deduct: 0, zh: `检查失败：${e2.message}`, en: `Check failed: ${e2.message}` }]; return out }
      errors.push(error.message)
    }
    const n = num(row[0]) ?? 0
    out.rowCount = n
    if (n > 0 && row.length > 1) {
      nullCols.forEach((c, i) => {
        const nonNull = num(row[1 + i])
        if (nonNull === null) return
        const rate = (n - nonNull) / n
        if (rate > 0) out.nulls.push({ column: c.name, nulls: n - nonNull, rate: Number(rate.toFixed(4)), optional: OPTIONAL_NAME.test(c.name) && !/^(created|create_time|gmt_create)/i.test(c.name), core: Boolean(c.roles?.includes('measure') || (c.roles?.includes('id') && c.key !== 'PRI')) })
      })
      out.nulls.sort((a, b) => b.rate - a.rate)
      out.nulls = out.nulls.slice(0, 12)
    }
    if (n === 0) { Object.assign(out, scoreTable(out)); return out }
    // 2. conditions: outliers (mean ± 4σ), negatives on amount-like measures, future timestamps.
    const conds = []
    const base = 1 + nullCols.length
    measures.forEach((c, i) => {
      if (row.length <= base) return
      const mean = num(row[base + i * 4]); const sq = num(row[base + i * 4 + 1]); const lo = num(row[base + i * 4 + 2]); const hi = num(row[base + i * 4 + 3])
      if (mean === null || sq === null) return
      const sd = dialect === 'sqlite' ? Math.sqrt(Math.max(0, sq - mean * mean)) : sq
      if (sd > 0 && n >= 30) {
        const low = mean - 4 * sd; const high = mean + 4 * sd
        if ((lo !== null && lo < low) || (hi !== null && hi > high)) conds.push({ kind: 'outliers', column: c.name, low, high, sql: `(${q(c.name)} < ${numLiteral(low)} OR ${q(c.name)} > ${numLiteral(high)})` })
      }
      if (AMOUNT_LIKE.test(c.name) && lo !== null && lo < 0) conds.push({ kind: 'negatives', column: c.name, sql: `${q(c.name)} < 0` })
    })
    const nowLit = nowPlusHour(dialect)
    for (const c of cols.filter(c => c.roles?.includes('time') && DATE_TYPES.has(String(c.dataType)) && !FUTURE_OK.test(c.name)).slice(0, 4)) {
      conds.push({ kind: 'future', column: c.name, sql: `${q(c.name)} > ${nowLit}` })
    }
    if (conds.length) {
      try {
        const counts = await this.countConditions(ds, t.name, conds.map(c => c.sql), run)
        conds.forEach((c, i) => {
          const v = counts[i]
          if (v && typeof v === 'object') { errors.push(v.error); return }
          if (!(v > 0)) return
          if (c.kind === 'outliers') out.outliers.push({ column: c.column, count: v, low: c.low, high: c.high })
          else out[c.kind].push({ column: c.column, count: v })
        })
      } catch (error) { errors.push(error.message) }
    }
    // 3. duplicate keys on unique indexes (non-primary; ES/SQLite: id-like candidate keys).
    let keys = (t.indexes ?? []).filter(i => i.unique && !/^(primary|.*_pkey)$/i.test(i.name)).map(i => i.columns)
    if (!keys.length && (dialect === 'elasticsearch' || dialect === 'sqlite')) keys = cols.filter(c => /^(id|uuid)$|(_no|_uuid|_hash|_code)$/i.test(c.name) && !c.roles?.includes('sensitive')).slice(0, 2).map(c => [c.name])
    const visible = new Set(cols.map(c => c.name))
    for (const k of keys.filter(k => k.every(c => visible.has(c))).slice(0, 3)) {
      try {
        let dup
        if (k.length === 1) {
          const r = await run(`SELECT COUNT(${q(k[0])}) - COUNT(DISTINCT ${q(k[0])}) AS d FROM ${T}`)
          dup = num(r.rows[0]?.[0]) ?? 0
        } else if (dialect !== 'elasticsearch') {
          const cl = k.map(q).join(', ')
          const r = await run(`SELECT COALESCE(SUM(c - 1), 0) AS d FROM (SELECT COUNT(*) AS c FROM ${T} WHERE ${k.map(c => `${q(c)} IS NOT NULL`).join(' AND ')} GROUP BY ${cl} HAVING COUNT(*) > 1) dup`)
          dup = num(r.rows[0]?.[0]) ?? 0
        } else continue
        out.duplicates.push({ columns: k, duplicates: Math.max(0, dup), ...(dialect === 'elasticsearch' ? { approximate: true } : {}) })
      } catch (error) { errors.push(error.message) }
    }
    out.freshness = freshness ? { stale: freshness.stale, lagMinutes: freshness.lagMinutes, thresholdHours: freshness.thresholdHours } : undefined
    Object.assign(out, scoreTable(out))
    return out
  },

  /** RPC: run the quality patrol for a data source (all or some tables) and store the run. */
  async qualityScan({ datasourceId, tables, trigger = 'manual' } = {}) {
    const ds = this.requireDatasource(datasourceId ?? this.state.current)
    return this.withJobLock(`quality:${ds.id}`, async () => {
      const schema = await this.visibleSchema(ds)
      const qs = this.qualityState()
      const settings = qs.settings
      const fstore = this.freshnessState()[ds.id] ?? {}
      const fset = this.freshnessState().settings
      const list = (Array.isArray(tables) && tables.length ? schema.tables.filter(t => tables.includes(t.name)) : schema.tables).filter(t => t.type !== 'VIEW' || (Array.isArray(tables) && tables.length)).slice(0, settings.maxTables)
      const started = Date.now()
      const results = []
      for (const t of list) {
        const fe = fstore[t.name]
        const freshness = fe ? { ...fe, thresholdHours: thresholdFor(fset, ds.id, t.name), stale: freshnessStatus(fe, thresholdFor(fset, ds.id, t.name)) === 'stale' } : undefined
        try { results.push(await this.scanTableQuality(ds, t, { settings, freshness })) } catch (error) { results.push({ table: t.name, score: null, errors: [error.message], issues: [{ kind: 'error', deduct: 0, zh: `检查失败：${error.message}`, en: `Check failed: ${error.message}` }] }) }
      }
      const score = scoreDatasource(results)
      const prev = qs.latest[ds.id]
      const partial = Boolean(Array.isArray(tables) && tables.length)
      const run = { id: newId('qr'), at: Date.now(), datasourceId: ds.id, datasourceName: ds.name, trigger, partial, score, previousScore: prev?.score ?? null, durationMs: Date.now() - started, tableCount: results.length, issueCount: results.reduce((s, r) => s + (r.issues ?? []).filter(i => i.deduct > 0).length, 0), tables: results.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)), summary: summarizeRun(results, score) }
      // Score-drop push (full runs only).
      if (!partial && prev?.score !== null && prev?.score !== undefined && score !== null && prev.score - score > settings.dropPoints && settings.channelId && this.state.channels.some(c => c.id === settings.channelId)) {
        const worst = results.filter(r => r.score !== null).slice(0, 5)
        const lines = worst.map(r => `- **${r.table}** ${r.score} 分：${(r.issues ?? []).filter(i => i.deduct > 0).slice(0, 2).map(i => i.zh).join('；') || '—'}`)
        try {
          await this.sendToChannel({ channelId: settings.channelId, title: `📉 数据健康分下降：${ds.name} ${prev.score} → ${score}`, text: `${lines.join('\n')}\n\n<font color='grey'>数据源：${ds.name} · 检查时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</font>`, source: 'quality', template: 'orange' })
          run.pushed = true
        } catch (error) { run.pushError = error.message }
      }
      this.records.put('qualityRun', run)
      if (!partial) qs.latest[ds.id] = { runId: run.id, at: run.at, score }
      await this.save()
      return run
    })
  },

  /** RPC: latest run (full detail) + score history of a data source. */
  qualityResults({ datasourceId, limit = 30 } = {}) {
    const ds = this.requireDatasource(datasourceId ?? this.state.current)
    const runs = this.records.list('qualityRun', { ref: ds.id, limit: Math.min(200, Number(limit) || 30) })
    return { datasourceId: ds.id, latest: runs[0] ?? null, history: runs.map(r => ({ id: r.id, at: r.at, score: r.score, partial: r.partial, trigger: r.trigger, tableCount: r.tableCount, issueCount: r.issueCount })) }
  },

  /** Daily patrol: every analyzed data source. */
  async runQualityAll() {
    const qs = this.qualityState()
    qs.lastRunAt = Date.now()
    await this.save()
    const out = []
    for (const ds of this.state.datasources) {
      if (!ds.schemaAnalyzedAt) continue
      try { const r = await this.qualityScan({ datasourceId: ds.id, trigger: 'schedule' }); out.push({ id: ds.id, ok: true, score: r.score }) } catch (error) { if (error.code !== 'nl2sql/busy') out.push({ id: ds.id, ok: false, error: error.message }) }
    }
    return out
  },

  healthStatus() {
    const f = this.freshnessState()
    const q = this.qualityState()
    const fDue = (f.lastRunAt ?? 0) + f.settings.intervalMin * 60000
    return { freshness: { enabled: f.settings.enabled, lastRunAt: f.lastRunAt ?? null, nextAt: f.settings.enabled ? Math.max(fDue, Date.now()) : null }, quality: { enabled: q.settings.enabled, lastRunAt: q.lastRunAt ?? null, time: q.settings.time } }
  },

  /** Scheduler jobs (service/alerts.js tickAlerts). */
  jobs_freshness(now) {
    const f = this.freshnessState()
    const q = this.qualityState()
    return [
      { id: 'freshness', due: (n = now) => f.settings.enabled && (n.getTime?.() ?? Number(n)) - (f.lastRunAt ?? 0) >= f.settings.intervalMin * 60000, run: () => this.runFreshnessAll() },
      { id: 'quality', due: (n = now) => q.settings.enabled && (q.lastRunAt ?? 0) < lastDailySlot(q.settings.time, n instanceof Date ? n : new Date(n)), run: () => this.runQualityAll() },
    ]
  },
}

/** One-line zh/en summary of a run. */
function summarizeRun(results, score) {
  const scored = results.filter(r => r.score !== null && r.score !== undefined)
  const bad = scored.filter(r => r.score < 80)
  const counts = {}
  for (const r of results) for (const i of r.issues ?? []) if (i.deduct > 0) counts[i.kind] = (counts[i.kind] ?? 0) + 1
  const names = { nulls: ['空值', 'nulls'], duplicates: ['重复键', 'duplicate keys'], outliers: ['异常值', 'outliers'], future: ['未来时间', 'future timestamps'], negative: ['负值', 'negative amounts'], stale: ['数据滞后', 'stale data'] }
  const zhParts = Object.entries(counts).map(([k, v]) => `${names[k]?.[0] ?? k} ${v}`)
  const enParts = Object.entries(counts).map(([k, v]) => `${names[k]?.[1] ?? k} ${v}`)
  return {
    zh: score === null ? '没有可评分的表' : `健康分 ${score}：${scored.length} 张表已评分，${bad.length} 张低于 80 分${zhParts.length ? `；问题：${zhParts.join('、')}` : '；未发现问题'}`,
    en: score === null ? 'No tables could be scored' : `Health score ${score}: ${scored.length} tables scored, ${bad.length} below 80${enParts.length ? `; issues: ${enParts.join(', ')}` : '; no issues found'}`,
  }
}

// ------------------------------------------------------------------ feature

export const FEATURE = {
  name: 'freshness',
  methods,
  rpc: (service) => ({
    freshnessFor: (p) => service.freshnessFor(p ?? {}),
    freshnessEvents: (p) => service.freshnessEvents(p ?? {}),
    qualityScan: (p) => service.qualityScan({ datasourceId: p?.datasourceId, tables: p?.tables }),
    qualityResults: (p) => service.qualityResults(p ?? {}),
    healthSettings: () => service.healthSettings(),
    saveHealthSettings: (p) => service.saveHealthSettings(p ?? {}),
    healthStatus: () => service.healthStatus(),
  }),
  tools: (ctx, service, { textBlock, DATASOURCE_PARAM }) => {
    ctx.tools.register({
      name: 'nl2sql_freshness',
      description: 'Data freshness of tables in the session data source: the latest timestamp (MAX of the table\'s main time column, e.g. created_at) and how far it lags behind now, plus the stale threshold and status (ok / warn / stale / empty). Call it for questions about recent periods (today, yesterday, this week, 最近, 今天, 昨天, 本周) with the tables you are going to query, and warn the user when data is stale.',
      parameters: {
        type: 'object',
        properties: {
          datasource: DATASOURCE_PARAM,
          tables: { type: 'array', items: { type: 'string' }, description: 'Tables to check (names as listed by nl2sql_schema). Omit for every table with a time column.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => textBlock(JSON.stringify(value)),
        presentationMeta: (_args, value) => JSON.parse(JSON.stringify({ freshness: { datasource: value.datasource, now: value.now, tables: (value.tables ?? []).slice(0, 30), warnings: value.warnings ?? [] } })),
      },
      isConcurrencySafe: () => true,
      timeoutMs: 300000,
      presentCall: (args) => ({ card: 'generic', title: args?.tables?.length ? `数据新鲜度 ${args.tables.join(', ')}` : '数据新鲜度', kind: 'read' }),
      execute: async (args, exec) => {
        try {
          if (!service.freshnessState().settings.enabled) return { disabled: true, message: 'Data freshness checks are turned off by the administrator (Data Q&A → Manage → Data health). Answer without freshness warnings.' }
          return await service.freshnessForSession({ sessionId: exec?.agent?.id, datasource: args?.datasource, tables: args?.tables })
        } catch (error) {
          throw error instanceof UserError ? new Error(error.message) : error
        }
      },
    })
  },
}
