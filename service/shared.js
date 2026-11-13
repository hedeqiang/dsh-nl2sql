/**
 * Shared helpers, constants and record storage used by the service modules.
 */
import { createHash, randomBytes } from 'node:crypto'
import { DIALECTS, describeError } from '../drivers.js'
import { sqliteDialectHints } from '../sqlite-driver.js'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-call context for long requests (MCP tools/call): { signal?: AbortSignal, phase?(name, info) }.
 * runQuery reports phases and passes the signal to drivers that can cancel a running statement.
 */
export const callContext = new AsyncLocalStorage()

export const SUPPORTED_TYPES = Object.keys(DIALECTS)

export const RPC_PATH = '/api/nl2sql.rpc'
export const ROLE_RANK = { viewer: 0, analyst: 1, admin: 2 }
export const PRESET_ID = 'nl2sql'
/** Agent preset of IM bot conversations (cordis.patch.yml): the core rules plus bot rules, no ask_user tool. */
export const BOT_PRESET_ID = 'nl2sql-bot'
export const CREDENTIAL_SCOPE = 'nl2sql'
export const RESULT_CACHE_LIMIT = 300

export const DEFAULT_SETTINGS = {
  maxRows: 500,
  timeoutMs: 15000,
  sampleMode: 'enum', // off | enum | all
  resultToModel: 'summary', // none | summary | rows
  modelRows: 20,
  maskSensitive: true,
  scanGuardRows: 1000000, // EXPLAIN rows above which a full scan needs confirmation (0 = off)
  cacheTtlSec: 300, // identical query reuse window for dashboards / reruns (0 = off)
  schemaWatch: true, // detect schema changes on re-analysis
  botDefaultRole: 'none', // role for unknown IM bot users: none | viewer | analyst (legacy name: larkDefaultRole)
  // Default "who may ask in a group" policy for newly registered groups (service/access.js normalizeChatPolicy).
  chatPolicyDefault: { askers: 'members', listed: [], blocked: [], perUserPerMinute: 0, perChatPerHour: 0, noAttachments: false, readOnly: false },
  schemaOverviewMax: 80, // above this many tables the schema overview lists names only, plus the most relevant tables in full
  schemaOverviewTop: 15, // tables described in full in a large-schema overview
  retention: { history: 20000, feedback: 5000, delivery: 5000, alertEvent: 5000, admin: 5000, evalRun: 200, schemaChange: 1000 }, // records kept per log kind
}

/** Clamp bounds for settings.retention values. */
export const RETENTION_MIN = 100
export const RETENTION_MAX = 200000

// ---------------------------------------------------------------- utilities

export const newId = (prefix) => `${prefix}-${randomBytes(5).toString('hex')}`

export class UserError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

// "token" alone is ambiguous: in crypto / payment schemas it is the currency (USDT, BTC…), so a
// bare `token` column is NOT sensitive by name. Credential-like names (access_token, api_token,
// token_hash, …) are; a bare `token` counts only in credential tables or with a credential comment
// (see isCredentialToken). Mask anything else explicitly with the access policy's masked columns.
export const SENSITIVE_NAME = /(phone|(?:^|_)mobile(?:_?(?:no|num|number))?(?:_|$)|(?:^|_)tel(?:ephone)?(?:_?(?:no|num|number))?(?:_|$)|e_?mail|(?:^|_)mail(?:_?addr(?:ess)?)?(?:_|$)|id_?card|idno|identity_?(?:no|num|number|card)|passport|password|passwd|pwd|secret|(?:access|auth|api|refresh|session|bearer|csrf|jwt|push|device)_?token|token_?(?:hash|secret|key)$|bank_?card|card_?no|身份证|手机|电话|邮箱|密码)/i
const CREDENTIAL_TABLE = /(session|oauth|auth|login|credential|api_?key|access_?key|personal_?access|user_?token|refresh_?token|jwt|sso)/i
const CREDENTIAL_COMMENT = /(令牌|凭证|凭据|密钥|访问码|登录态|credential|access token|auth token|bearer|jwt)/i
/** A bare `token` column that holds a credential (by table name or comment), not a currency. */
export function isCredentialToken(name, table, comment) {
  return /^token$/i.test(String(name ?? '')) && (CREDENTIAL_TABLE.test(String(table ?? '')) || CREDENTIAL_COMMENT.test(String(comment ?? '')))
}
/** Bumped whenever the sensitive-column rules change (part of result cache keys). */
export const SENSITIVE_RULES_VERSION = 3

export function maskValue(column, value) {
  if (value === null || value === undefined) return value
  const s = String(value)
  if (/(password|passwd|pwd|secret|密码)/i.test(column) || /(?:access|auth|api|refresh|session|bearer|csrf|jwt|push|device)_?token|token_?(?:hash|secret|key)$|^token$/i.test(column)) return '******'
  if (/(email|mail|邮箱)/i.test(column) && s.includes('@')) {
    const [u, d] = s.split('@')
    return `${u.slice(0, 1)}***@${d}`
  }
  if (s.length <= 4) return '****'
  const keep = Math.min(3, Math.floor(s.length / 4))
  return `${s.slice(0, keep)}${'*'.repeat(Math.max(4, s.length - keep * 2))}${s.slice(-keep)}`
}

/**
 * Value labels from a column comment or a knowledge note, e.g.
 *   '交易状态: 0=交易开始，10=处理中，11=交易失败'   → { '0': '交易开始', '10': '处理中', '11': '交易失败' }
 *   '订单类型: 1withdraw,2deposit'                → { '1': 'withdraw', '2': 'deposit' }
 *   '资产类型, 0: crypto, 1: rwa'                  → { '0': 'crypto', '1': 'rwa' }
 * Only short codes (≤ 6 chars, digits or letters) mapped to short labels; needs ≥ 2 pairs.
 */
export function parseValueLabels(text) {
  const src = String(text ?? '')
  if (!src) return null
  const out = {}
  // A code is digits (or one letter); the label may follow directly ("1withdraw", "0内扣").
  const re = /(?:^|[\s,，;；、:：(（/|])(-?\d{1,6})(?![0-9])\s*(?:=|:|：|-|→|\s)?\s*([^\s,，;；、:：()（）/|=0-9][^\s,，;；、:：()（）/|=]{0,23})/g
  let m
  while ((m = re.exec(src))) {
    const [, code, label] = m
    if (/^-?\d+$/.test(label) || label === code) continue
    out[code] = label.replace(/[。.]$/, '')
  }
  // Prose like "version 2 of api 3" is not a mapping: require ≥ 2 pairs and most labels not plain English stop words.
  const labels = Object.values(out)
  if (labels.length < 2 || labels.filter(l => /^(of|and|or|to|in|on|the|a|an|is|for|at|by|with|位|个|天|次|分)$/i.test(l)).length * 2 >= labels.length) return null
  return out
}

// ---------------------------------------------------------- schema analysis

export const NUMERIC_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'])
export const TIME_TYPES = new Set(['date', 'datetime', 'timestamp', 'time', 'year'])
export const TEXT_TYPES = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'])
export const ENUM_NAME = /(status|state|type|kind|level|category|gender|sex|channel|source|platform|stage|grade|flag|mode|tag|role|class|状态|类型)/i
export const GEO_NAME = /^(province|city|district|region|country|area|county|town|street|prov|省|市|区|县|地区)(_?(name|code))?$|(_province|_city|_district|_region|_country)$/i

export function classifyColumn(col, table) {
  const name = col.name.toLowerCase()
  const t = col.dataType
  const roles = []
  if (col.key === 'PRI' || name === 'id' || /_id$|^id_/.test(name)) roles.push('id')
  if (TIME_TYPES.has(t) || /(_at|_time|_date|^date|^time|^dt$|_dt$|日期|时间)/.test(name) && (TIME_TYPES.has(t) || t === 'int' || t === 'bigint' || t === 'varchar')) roles.push('time')
  if (t === 'enum' || t === 'set' || (ENUM_NAME.test(name) && (t === 'tinyint' || t === 'smallint' || t === 'char' || t === 'varchar' || t === 'int'))) roles.push('enum')
  if (NUMERIC_TYPES.has(t) && !roles.includes('id') && !roles.includes('enum') && !roles.includes('time') && !/^is_|^has_/.test(name)) roles.push('measure')
  if (TEXT_TYPES.has(t) && GEO_NAME.test(name)) roles.push('geo')
  if (SENSITIVE_NAME.test(name) || SENSITIVE_NAME.test(col.comment ?? '') || isCredentialToken(name, typeof table === 'string' ? table : table?.name, col.comment)) roles.push('sensitive')
  if (/^is_|^has_/.test(name) || col.columnType === 'tinyint(1)' || t === 'bit') roles.push('flag')
  if (roles.length === 0 && TEXT_TYPES.has(t)) roles.push('text')
  return roles
}

export function singular(word) {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ses')) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

export function inferRelations(tables, declared) {
  const byName = new Map(tables.map(t => [t.name.toLowerCase(), t]))
  const declaredKey = new Set(declared.map(r => `${r.from.table}.${r.from.column}`))
  const out = []
  for (const table of tables) {
    for (const col of table.columns) {
      const m = col.name.toLowerCase().match(/^(.*)_id$/)
      if (!m || declaredKey.has(`${table.name}.${col.name}`)) continue
      const base = m[1]
      const candidates = [base, `${base}s`, `${base}es`, base.replace(/y$/, 'ies'), singular(base)]
      const prefixes = ['', ...new Set(tables.map(t => t.name.toLowerCase().match(/^([a-z0-9]+_)/)?.[1]).filter(Boolean))]
      let target
      for (const p of prefixes) {
        for (const c of candidates) {
          const hit = byName.get(`${p}${c}`)
          if (hit && hit !== table) { target = hit; break }
        }
        if (target) break
      }
      if (!target) continue
      const pk = target.columns.find(c => c.key === 'PRI') ?? target.columns.find(c => c.name.toLowerCase() === 'id')
      if (!pk) continue
      const sameType = pk.dataType === col.dataType
      out.push({
        from: { table: table.name, column: col.name },
        to: { table: target.name, column: pk.name },
        kind: 'inferred',
        confidence: sameType ? 0.8 : 0.55,
      })
    }
  }
  return out
}

export function classifyTable(table, relations) {
  const name = table.name.toLowerCase()
  const roles = table.columns.flatMap(c => c.roles)
  const referencedBy = relations.filter(r => r.to.table === table.name).length
  const references = relations.filter(r => r.from.table === table.name).length
  if (table.type === 'VIEW') return 'view'
  if (/(log|logs|history|audit|trace|record)s?$|^log_/.test(name)) return 'log'
  if (/(config|setting|dict|dictionary|option|param|enum)s?$/.test(name)) return 'config'
  const hasTime = roles.includes('time')
  const measures = roles.filter(r => r === 'measure').length
  if (hasTime && measures >= 1 && (references >= 1 || (table.rows ?? 0) > 10000)) return 'fact'
  if (referencedBy >= 1) return 'dimension'
  if (hasTime && measures >= 1) return 'fact'
  return 'other'
}

// -------------------------------------------------------------- chart advice

export function suggestChart(columns, rows) {
  const time = columns.filter(c => c.kind === 'time')
  const num = columns.filter(c => c.kind === 'number')
  const cat = columns.filter(c => c.kind === 'text')
  if (rows.length === 1 && num.length >= 1 && columns.length <= 4) return { type: 'kpi', y: num.map(c => c.name) }
  if (time.length >= 1 && num.length >= 1) {
    return { type: 'line', x: time[0].name, y: num.slice(0, 4).map(c => c.name), ...(cat.length >= 1 && num.length === 1 ? { series: cat[0].name } : {}) }
  }
  if (cat.length >= 1 && num.length >= 1) {
    if (num.length === 1 && rows.length <= 8 && cat.length === 1) return { type: 'pie', x: cat[0].name, y: [num[0].name] }
    if (cat.length >= 2 && num.length === 1) return { type: 'bar', x: cat[0].name, y: [num[0].name], series: cat[1].name }
    return { type: 'bar', x: cat[0].name, y: num.slice(0, 4).map(c => c.name) }
  }
  if (num.length >= 2) return { type: 'scatter', x: num[0].name, y: [num[1].name] }
  return { type: 'table' }
}

export function columnKind(field, rows, index) {
  // Numeric codes such as status/type/level are categories, not measures.
  if (field.kind === 'number' && ENUM_NAME.test(field.name) && new Set(rows.map(r => r[index])).size <= 20) return 'text'
  if (field.kind && field.kind !== 'auto') return field.kind
  const values = rows.map(r => r[index]).filter(v => v !== null && v !== undefined).slice(0, 50)
  if (values.length && values.every(v => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?)?/.test(v))) return 'time'
  if (values.length && values.every(v => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16)) && !/(^id$|_id$|code$|no$)/i.test(field.name)) return 'number'
  return 'text'
}

export const DIALECT_HINTS = {
  mysql: 'MySQL: quote identifiers with backticks; MySQL 5.7 has no CTE or window functions; respect ONLY_FULL_GROUP_BY; DATE_FORMAT/DATE() for time buckets.',
  postgres: 'PostgreSQL: quote identifiers with double quotes when they contain upper case or special characters; schema-qualified names appear as schema.table; use date_trunc(), to_char(), ::date casts, FILTER (WHERE ...), CTEs and window functions freely; ILIKE for case-insensitive match.',
  elasticsearch: 'Elasticsearch SQL: each index is a table (quote names containing - or * with double quotes); nested object fields use dot paths; text fields are not aggregatable — group/filter on keyword fields or the .keyword sub-field; no JOINs and no sub-selects in FROM; use HISTOGRAM(ts, INTERVAL 1 DAY) or DATE_TRUNC for time buckets; LIMIT is required for large indices; MATCH(field, \'text\') for full-text search.',
  sqlite: sqliteDialectHints,
}

/** The column that labels each row of a result (chart x, else the first time column, else the first text column), or -1. */
export function labelColumnIndex(columns, x) {
  const usable = (c) => c && !c.masked && c.kind !== 'number'
  const byName = x ? columns.findIndex(c => c.name === x) : -1
  if (byName >= 0 && usable(columns[byName])) return byName
  const time = columns.findIndex(c => usable(c) && c.kind === 'time')
  if (time >= 0) return time
  return columns.findIndex(usable)
}

const round = (n) => Number(Number(n).toFixed(4))

/**
 * Per-column statistics of a result, for models that may not see its rows.
 * Numbers: min / max / sum / avg; with a label column (time or category) the
 * labels of the max and min rows; for time series also the first and last
 * point and the change between them — so trends and leaders can be stated
 * without the rows. Text: distinct count and the most frequent values, or the
 * first values in result order when every value is distinct (GROUP BY labels).
 */
export function summarize(columns, rows, { x } = {}) {
  const li = labelColumnIndex(columns, x)
  const label = (r) => (li >= 0 && r[li] !== null && r[li] !== undefined ? String(r[li]).slice(0, 60) : undefined)
  // Time series (one row per time label) are summarised in time order; long-format multi-series results are not.
  const isSeries = li >= 0 && columns[li].kind === 'time' && new Set(rows.map(r => String(r[li]))).size === rows.length
  const ordered = isSeries ? [...rows].sort((a, b) => String(a[li] ?? '').localeCompare(String(b[li] ?? ''))) : rows
  return columns.map((c, i) => {
    const values = rows.map(r => r[i]).filter(v => v !== null && v !== undefined)
    const s = { name: c.name, kind: c.kind, nonNull: values.length }
    if (c.kind === 'number') {
      const points = ordered.filter(r => r[i] !== null && r[i] !== undefined && r[i] !== '').map(r => ({ v: Number(r[i]), at: label(r) })).filter(p => Number.isFinite(p.v))
      if (points.length) {
        const nums = points.map(p => p.v)
        s.min = Math.min(...nums)
        s.max = Math.max(...nums)
        s.sum = round(nums.reduce((a, b) => a + b, 0))
        s.avg = round(s.sum / nums.length)
        if (li >= 0) {
          s.maxAt = points.find(p => p.v === s.max).at
          s.minAt = points.find(p => p.v === s.min).at
        }
        // Trend only for time series: between categories, first → last means nothing.
        if (points.length >= 2 && isSeries) {
          const first = points[0]
          const last = points[points.length - 1]
          s.first = { at: first.at, value: first.v }
          s.last = { at: last.at, value: last.v }
          s.change = round(last.v - first.v)
          if (first.v !== 0) s.changePct = round(((last.v - first.v) / Math.abs(first.v)) * 100)
        }
      }
    } else if (c.kind === 'time') {
      const sorted = values.map(String).sort()
      if (sorted.length) { s.min = sorted[0]; s.max = sorted[sorted.length - 1] }
    } else {
      const counts = new Map()
      for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
      s.distinct = counts.size
      if (counts.size === values.length && values.length > 1) s.firstValues = [...counts.keys()].slice(0, 5).map(v => v.slice(0, 60))
      else s.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value: value.slice(0, 60), count }))
    }
    return s
  })
}


// ------------------------------------------------------------------ service

/** state key → record kind, for the one-time migration out of state.json. */
export const RECORD_KINDS = [['history', 'history'], ['feedback', 'feedback'], ['delivery', 'deliveries'], ['alertEvent', 'alertEvents'], ['admin', 'adminLog'], ['evalRun', 'evalRuns'], ['schemaChange', 'schemaChanges']]
export const RECORD_LIMITS = { history: 20000, feedback: 5000, delivery: 5000, alertEvent: 5000, admin: 5000, evalRun: 200, schemaChange: 1000 }
/** Record kinds and the field used as their filter key. */
export const RECORD_REF = { history: 'datasourceId', feedback: 'datasourceId', delivery: 'channelId', alertEvent: 'alertId', admin: 'action', evalRun: 'datasourceId', schemaChange: 'datasourceId' }
// Reconciliation runs (service/reconcile.js): summary + first 200 differences per run.
RECORD_LIMITS.reconcileRun = 2000
RECORD_REF.reconcileRun = 'reconcileId'
// Freshness stale / recovered events and data quality runs (service/freshness.js).
RECORD_LIMITS.freshnessEvent = 5000
RECORD_REF.freshnessEvent = 'datasourceId'
RECORD_LIMITS.qualityRun = 1000
RECORD_REF.qualityRun = 'datasourceId'
// Lark Bitable sync runs (service/present.js).
RECORD_LIMITS.bitableRun = 2000
RECORD_REF.bitableRun = 'syncId'
// Daily digest runs (service/proactive.js).
RECORD_LIMITS.digestRun = 1000
RECORD_REF.digestRun = 'digestId'
// Milestone checks (service/milestones.js): one per rule and day, with the events found.
RECORD_LIMITS.milestoneRun = 2000
RECORD_REF.milestoneRun = 'ruleId'
// MCP per-token call log (service/mcp.js): time, method/tool, data source, ms, status, rows.
RECORD_LIMITS.mcpCall = 5000
RECORD_REF.mcpCall = 'tokenId'

/**
 * Growing logs (audit history, feedback, push deliveries, alert events, admin
 * log, evaluation runs, schema changes) live in SQLite, newest first. Falls
 * back to memory when SQLite is unavailable.
 */
export class Records {
  /** @param {object} store ResultStore or undefined; @param {() => object} [limits] current retention per kind. */
  constructor(store, limits) {
    this.store = store
    this.mem = new Map()
    this.puts = 0
    this.limitsOf = typeof limits === 'function' ? limits : () => limits ?? RECORD_LIMITS
  }

  limits() {
    return { ...RECORD_LIMITS, ...(this.limitsOf() ?? {}) }
  }

  /** Apply the retention limits now (all kinds, or one). */
  trim(kind) {
    const limits = this.limits()
    for (const [k, n] of Object.entries(limits)) {
      if (kind && k !== kind) continue
      if (this.store) this.store.trimRecords(k, n)
      else if (this.mem.has(k)) this.mem.set(k, this.mem.get(k).slice(0, n))
    }
  }

  put(kind, rec) {
    const ref = rec[RECORD_REF[kind]] ?? null
    if (this.store) {
      this.store.putRecord(kind, rec, { ref: ref === null ? null : String(ref), status: rec.status ?? null })
      if (++this.puts % 500 === 0) this.trim()
      return
    }
    const list = this.mem.get(kind) ?? []
    const i = list.findIndex(x => x.id === rec.id)
    if (i >= 0) list[i] = rec
    else list.unshift(rec)
    this.mem.set(kind, list.slice(0, this.limits()[kind] ?? 1000))
  }

  /** Record count per kind. */
  counts() {
    const out = {}
    for (const kind of Object.keys(RECORD_LIMITS)) out[kind] = this.count(kind)
    return out
  }

  get(kind, id) {
    return this.store ? this.store.getRecord(kind, id) : (this.mem.get(kind) ?? []).find(x => x.id === id)
  }

  list(kind, { ref, status, limit = 100, since, filter } = {}) {
    if (this.store) return this.store.listRecords(kind, { ref: ref === undefined || ref === null || ref === '' ? undefined : String(ref), status, limit, since, filter })
    return (this.mem.get(kind) ?? []).filter(r => (!ref || String(r[RECORD_REF[kind]]) === String(ref)) && (!status || r.status === status) && (!since || (r.at ?? 0) >= since) && (!filter || filter(r))).slice(0, limit)
  }

  count(kind, opts = {}) {
    return this.store ? this.store.countRecords(kind, opts) : this.list(kind, { ...opts, limit: 1e9 }).length
  }

  delete(kind, id) {
    if (this.store) this.store.deleteRecord(kind, id)
    else this.mem.set(kind, (this.mem.get(kind) ?? []).filter(x => x.id !== id))
  }

  clear(kind) {
    if (this.store) this.store.clearRecords(kind)
    else this.mem.delete(kind)
  }
}


/** Pick representative charts for one table: trend, composition, top N, distribution, KPI. */
export function dayExpr(dialect, C) {
  return dialect === 'mysql' ? `DATE(${C})` : dialect === 'postgres' ? `date_trunc('day', ${C})::date` : dialect === 'sqlite' ? `date(${C})` : `HISTOGRAM(${C}, INTERVAL 1 DAY)`
}

export function overviewPlans(dialect, t, knowledge) {
  const q = (n) => dialect === 'mysql' ? `\`${n.replace(/`/g, '``')}\`` : dialect === 'postgres' ? n.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.') : `"${n.replace(/"/g, '""')}"`
  // Aliases: one identifier even when the column name contains dots.
  const a = (n) => dialect === 'mysql' ? q(n) : `"${n.replace(/"/g, '""')}"`
  const T = q(t.name)
  const time = t.columns.find(c => c.roles.includes('time') && /date|time|stamp/.test(c.dataType) && !/update|modif/i.test(c.name)) ?? t.columns.find(c => c.roles.includes('time') && /date|time|stamp/.test(c.dataType))
  const measures = t.columns.filter(c => c.roles.includes('measure') && !c.roles.includes('flag')).slice(0, 2)
  const enums = t.columns.filter(c => c.roles.includes('enum') && !c.roles.includes('sensitive')).slice(0, 2)
  const label = t.comment ? t.comment.replace(/表.*$/, '') || t.name : t.name
  const metric = knowledge.metrics.find(m => m.table === t.name)
  const plans = []
  const agg = measures.map(m => `, SUM(${q(m.name)}) AS ${q(`${m.name}_sum`)}`).join('')
  const kpiAgg = measures.map(m => `, SUM(${q(m.name)}) AS ${q(`${m.name}_sum`)}, AVG(${q(m.name)}) AS ${q(`${m.name}_avg`)}`).join('')
  const days = 30
  if (time) {
    const C = q(time.name)
    const day = dayExpr(dialect, C)
    const since = dialect === 'mysql' ? `${C} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)` : dialect === 'postgres' ? `${C} >= current_date - interval '${days} days'` : dialect === 'sqlite' ? `${C} >= date('now', '-${days} days')` : `${C} >= NOW() - INTERVAL ${days} DAYS`
    plans.push({ title: `${label} · 近 ${days} 天总览`, sql: `SELECT COUNT(*) AS ${q('total')}${kpiAgg} FROM ${T} WHERE ${since}`, chart: { type: 'kpi' }, width: 'full' })
    plans.push({ title: `${label} · 每日趋势`, sql: `SELECT ${day} AS ${q('day')}, COUNT(*) AS ${q('cnt')}${agg} FROM ${T} WHERE ${since} GROUP BY ${dialect === 'elasticsearch' ? q('day') : day} ORDER BY ${q('day')}`, chart: { type: 'line' }, width: 'full' })
    if (dialect !== 'elasticsearch') {
      const week = dialect === 'mysql' ? `DATE_FORMAT(${C}, '%x-W%v')` : dialect === 'sqlite' ? `strftime('%Y-W%W', ${C})` : `to_char(date_trunc('week', ${C}), 'IYYY-"W"IW')`
      const since84 = dialect === 'mysql' ? `${C} >= DATE_SUB(CURDATE(), INTERVAL 84 DAY)` : dialect === 'sqlite' ? `${C} >= date('now', '-84 days')` : `${C} >= current_date - interval '84 days'`
      plans.push({ title: `${label} · 近 12 周（周环比）`, sql: `SELECT ${week} AS ${q('week')}, COUNT(*) AS ${q('cnt')}${agg} FROM ${T} WHERE ${since84} GROUP BY ${week} ORDER BY ${q('week')}`, chart: { type: 'bar' }, width: 'half' })
    }
  } else {
    plans.push({ title: `${label} · 总览`, sql: `SELECT COUNT(*) AS ${q('total')}${kpiAgg} FROM ${T}`, chart: { type: 'kpi' }, width: 'full' })
  }
  for (const e of enums) {
    const E = q(e.name)
    plans.push({ title: `${label} · 按${e.comment ? e.comment.split(/[\s:：(（]/)[0] : e.name}分布`, sql: `SELECT ${E} AS ${a(e.name)}, COUNT(*) AS ${q('cnt')}${measures[0] ? `, SUM(${q(measures[0].name)}) AS ${q(`${measures[0].name}_sum`)}` : ''} FROM ${T} GROUP BY ${E} ORDER BY ${q('cnt')} DESC LIMIT 12`, chart: { type: 'pie' }, width: 'half' })
  }
  const dim = t.columns.find(c => (c.roles.includes('geo') || (c.roles.includes('text') && /name|title|city|region|channel|source|category/i.test(c.name))) && !c.roles.includes('sensitive'))
  if (dim && measures[0]) {
    plans.push({ title: `${label} · ${dim.comment || dim.name} Top 10`, sql: `SELECT ${q(dim.name)} AS ${a(dim.name)}, SUM(${q(measures[0].name)}) AS ${a(`${measures[0].name}_sum`)} FROM ${T} GROUP BY ${q(dim.name)} ORDER BY ${a(`${measures[0].name}_sum`)} DESC LIMIT 10`, chart: { type: 'barh' }, width: 'half' })
  }
  if (metric && time) {
    const C = q(metric.timeColumn || time.name)
    const day = dayExpr(dialect, C)
    plans.push({ title: `${metric.name} · 每日`, sql: `SELECT ${day} AS ${q('day')}, ${metric.expression} AS ${q(metric.name)} FROM ${T}${metric.filter ? ` WHERE ${metric.filter}` : ''} GROUP BY ${dialect === 'elasticsearch' ? q('day') : day} ORDER BY ${q('day')} DESC LIMIT 30`, chart: { type: 'line' }, width: 'half' })
  }
  return plans.slice(0, 6)
}

export function upsert(list, entry) {
  const i = list.findIndex(x => x.id === entry.id)
  if (i < 0) return [...list, entry]
  const next = [...list]
  next[i] = entry
  return next
}

// ------------------------------------------------------------------ helpers


export function clampInt(v, min, max, field) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError('nl2sql/invalid', `${field} 必须是 ${min}–${max} 之间的整数`)
  return n
}

export function oneOf(v, values, field) {
  if (!values.includes(v)) throw new UserError('nl2sql/invalid', `${field} 必须是 ${values.join(' / ')} 之一`)
  return v
}

export function requireText(v, field, max) {
  const s = String(v ?? '').trim()
  if (s === '' || s.length > max) throw new UserError('nl2sql/invalid', `${field} 不能为空且不超过 ${max} 个字符`)
  return s
}

export function toUserError(error) {
  if (error instanceof UserError) return error
  const e = describeError(error)
  return new UserError(e.code, e.message)
}

export const CHART_TYPES = ['line', 'bar', 'barh', 'stacked', 'area', 'pie', 'scatter', 'kpi', 'table', 'funnel']

export function normalizeChart(chart, columns) {
  if (!chart || typeof chart !== 'object') return undefined
  const type = CHART_TYPES.includes(chart.type) ? chart.type : undefined
  if (!type) return undefined
  const names = new Set(columns.map(c => c.name))
  const y = (Array.isArray(chart.y) ? chart.y : chart.y ? [chart.y] : []).filter(n => names.has(n))
  const out = { type }
  if (chart.x && names.has(chart.x)) out.x = chart.x
  if (y.length) out.y = y
  if (chart.series && names.has(chart.series)) out.series = chart.series
  if (type !== 'table' && type !== 'kpi' && (!out.x || !out.y)) return undefined
  if (type === 'kpi' && !out.y) return undefined
  return out
}

/** Complete a type-only chart hint (e.g. { type: 'pie' }) from the column kinds. */
export function fillChartHint(chart, columns, suggested) {
  if (!chart?.type || !CHART_TYPES.includes(chart.type)) return undefined
  const nums = columns.filter(c => c.kind === 'number').map(c => c.name)
  const cats = columns.filter(c => c.kind !== 'number').map(c => c.name)
  if (chart.type === 'table') return { type: 'table' }
  if (chart.type === 'kpi') return nums.length ? { type: 'kpi', y: nums.slice(0, 6) } : undefined
  if (chart.type === 'scatter') return nums.length >= 2 ? { type: 'scatter', x: nums[0], y: [nums[1]] } : undefined
  const x = (suggested?.x && suggested.type !== 'scatter' ? suggested.x : undefined) ?? cats[0]
  if (!x || !nums.length) return undefined
  if (chart.type === 'pie' || chart.type === 'funnel') return { type: chart.type, x, y: [nums.filter(n => n !== x)[0] ?? nums[0]] }
  return { type: chart.type, x, y: nums.filter(n => n !== x).slice(0, 4) }
}

// -------------------------------------------------------------------- tools

// -------------------------------------------------------------------- apply

export function hashText(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 10)
}

export function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)
}


/**
 * Daily slot helper for scheduler jobs: the most recent local `HH:MM` slot at or
 * before `now` (yesterday's when today's is still ahead). A job is due when its
 * last run is older than that slot (catches up once after downtime).
 */
export function lastDailySlot(hhmm, now = new Date()) {
  const [hh, mm] = String(hhmm || '09:00').split(':').map(Number)
  const slot = new Date(now)
  slot.setHours(hh || 0, mm || 0, 0, 0)
  if (slot > now) slot.setDate(slot.getDate() - 1)
  return slot.getTime()
}
