/**
 * Pure analysis helpers for the NL2SQL plugin: SELECT parsing, drill-down,
 * metric SQL, attribution, alert evaluation and result comparison.
 *
 * Every export is synchronous and side-effect free. SQL text produced here is
 * still subject to the regular read-only admission (sql-guard.js) before it
 * runs; these builders only assemble statements from already-admitted SQL,
 * quoted identifiers and escaped literals.
 */

import { timeBounds, TIME_RANGES } from './filters.js'

// ------------------------------------------------------------ quoting

/** Quote one identifier (no dot splitting). */
export function quoteIdent(name, dialect) {
  const s = String(name)
  if (dialect === 'mysql') return `\`${s.replace(/`/g, '``')}\``
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Quote a possibly dotted name: mysql/postgres/sqlite quote each part,
 * Elasticsearch quotes the whole name (dots are part of index/field names).
 */
export function quoteName(name, dialect) {
  const s = String(name)
  if (dialect === 'elasticsearch') return quoteIdent(s, dialect)
  return s.split('.').map(p => quoteIdent(p, dialect)).join('.')
}

/** Single-quoted string literal; MySQL additionally doubles backslashes. */
export function quoteString(value, dialect) {
  let s = String(value)
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\')
  return `'${s.replace(/'/g, "''")}'`
}

const pad = (n, w = 2) => String(n).padStart(w, '0')

/** Local-time 'YYYY-MM-DD' for midnight dates, else 'YYYY-MM-DD HH:MM:SS'. */
function formatDate(d, { full = false } = {}) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (!full && time === '00:00:00' && d.getMilliseconds() === 0) return date
  return `${date} ${time}`
}

const STRING_EXPR = /^\s*(DATE_FORMAT|TO_CHAR|STRFTIME|CONCAT|CONCAT_WS|LPAD|RPAD|SUBSTR|SUBSTRING|LEFT|RIGHT|UPPER|LOWER|TRIM|LTRIM|RTRIM|FORMAT|REPLACE|GROUP_CONCAT|STRING_AGG|MONTHNAME|DAYNAME)\s*\(|::\s*(text|varchar|char)\b|\bAS\s+(CHAR|VARCHAR|TEXT|NCHAR)\b/i

/**
 * SQL literal for a value compared against `expr`. Finite numbers stay bare
 * unless the expression produces a string; Dates are formatted in local time;
 * everything else is a quoted string. null/undefined → 'NULL'.
 */
export function literalFor(value, dialect, expr = '') {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'bigint') return STRING_EXPR.test(expr) ? quoteString(String(value), dialect) : String(value)
  if (typeof value === 'number') {
    if (Number.isFinite(value) && !STRING_EXPR.test(expr)) return String(value)
    return quoteString(String(value), dialect)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return quoteString(formatDate(value), dialect)
  return quoteString(String(value), dialect)
}

// ------------------------------------------------------------ tokenizer

const WORD_START = /[\p{L}_]/u
const WORD_CHAR = /[\p{L}\p{N}_$]/u

/**
 * Tokenize SQL (comments dropped). Each token: { kind, text, upper?, start, end, depth }.
 * kinds: word, ident (" or ` quoted), string ('…'), number, open, close, comma, op.
 * `depth` is the parenthesis depth the token sits at (open/close carry the outer depth).
 */
function tokenize(sql, { dialect } = {}) {
  const tokens = []
  let depth = 0
  const backslash = dialect !== 'postgres' && dialect !== 'sqlite' && dialect !== 'elasticsearch'
  for (let i = 0; i < sql.length;) {
    const c = sql[i]
    const n = sql[i + 1]
    if (/\s/.test(c)) { i++; continue }
    if ((c === '-' && n === '-') || (c === '#' && dialect !== 'postgres')) { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue }
    if (c === '\'' || c === '"' || c === '`') {
      const start = i
      i++
      while (i < sql.length) {
        if (sql[i] === '\\' && c === '\'' && backslash) { i += 2; continue }
        if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue } break }
        i++
      }
      if (i >= sql.length) return undefined // unterminated
      i++
      tokens.push({ kind: c === '\'' ? 'string' : 'ident', text: sql.slice(start, i), start, end: i, depth })
      continue
    }
    if (c === '(') { tokens.push({ kind: 'open', text: c, start: i, end: i + 1, depth }); depth++; i++; continue }
    if (c === ')') {
      depth--
      if (depth < 0) return undefined
      tokens.push({ kind: 'close', text: c, start: i, end: i + 1, depth }); i++; continue
    }
    if (c === ',') { tokens.push({ kind: 'comma', text: c, start: i, end: i + 1, depth }); i++; continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n ?? ''))) {
      const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.)/.exec(sql.slice(i))
      const len = m ? m[0].length : 1
      tokens.push({ kind: 'number', text: sql.slice(i, i + len), start: i, end: i + len, depth }); i += len; continue
    }
    if (WORD_START.test(c)) {
      let j = i
      while (j < sql.length) {
        if (WORD_CHAR.test(sql[j])) { j++; continue }
        if (sql[j] === '.' && sql[j + 1] && (WORD_START.test(sql[j + 1]) || sql[j + 1] === '*' || /[0-9]/.test(sql[j + 1]))) { j++; if (sql[j] === '*') { j++; break } continue }
        break
      }
      const text = sql.slice(i, j)
      tokens.push({ kind: 'word', text, upper: text.toUpperCase(), start: i, end: j, depth }); i = j; continue
    }
    tokens.push({ kind: 'op', text: c, start: i, end: i + 1, depth }); i++
  }
  if (depth !== 0) return undefined
  return tokens
}

function unquoteIdent(text) {
  if (/^`.*`$/s.test(text)) return text.slice(1, -1).replace(/``/g, '`')
  if (/^".*"$/s.test(text)) return text.slice(1, -1).replace(/""/g, '"')
  if (/^'.*'$/s.test(text)) return text.slice(1, -1).replace(/''/g, '\'').replace(/\\(.)/g, '$1')
  return text
}

// ------------------------------------------------------------ parseSelect

const AGG_FUNCS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'STD', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
  'MEDIAN', 'GROUP_CONCAT', 'STRING_AGG', 'ARRAY_AGG', 'JSON_AGG', 'JSONB_AGG', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'BOOL_AND', 'BOOL_OR', 'BIT_AND',
  'BIT_OR', 'BIT_XOR', 'EVERY', 'COUNT_BIG', 'APPROX_COUNT_DISTINCT', 'KURTOSIS', 'SKEWNESS', 'MAD', 'SUM_OF_SQUARES', 'FIRST', 'LAST', 'TOTAL',
  'CORR', 'COVAR_POP', 'COVAR_SAMP', 'REGR_SLOPE', 'REGR_INTERCEPT', 'REGR_COUNT', 'MODE'])

const isAggName = (word) => {
  const name = word.split('.').pop().toUpperCase()
  return AGG_FUNCS.has(name) || name.startsWith('PERCENTILE')
}

/** Aggregate call in a token run (outside nested SELECTs, not a bare window function). */
function containsAggregate(tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.kind === 'open' && tokens[k + 1]?.kind === 'word' && /^(SELECT|WITH)$/.test(tokens[k + 1].upper)) {
      // Skip the nested subquery entirely.
      const close = tokens.findIndex((x, j) => j > k && x.kind === 'close' && x.depth === t.depth)
      if (close < 0) return false
      k = close
      continue
    }
    if (t.kind === 'word' && tokens[k + 1]?.kind === 'open' && isAggName(t.text)) {
      const close = tokens.findIndex((x, j) => j > k + 1 && x.kind === 'close' && x.depth === tokens[k + 1].depth)
      let after = close + 1
      // FILTER (WHERE …) / WITHIN GROUP (…) belong to the aggregate.
      while (tokens[after]?.kind === 'word' && /^(FILTER|WITHIN)$/.test(tokens[after].upper)) {
        let o = after + 1
        while (tokens[o] && tokens[o].kind !== 'open') o++
        const c2 = tokens.findIndex((x, j) => j > o && x.kind === 'close' && x.depth === tokens[o]?.depth)
        after = c2 < 0 ? tokens.length : c2 + 1
      }
      if (tokens[after]?.kind === 'word' && tokens[after].upper === 'OVER') continue // window function, inner tokens still scanned
      return true
    }
  }
  return false
}

const PREV_BLOCK = new Set(['AS', 'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'ILIKE', 'RLIKE', 'REGEXP', 'BETWEEN', 'THEN', 'ELSE', 'WHEN', 'CASE',
  'DISTINCT', 'ALL', 'INTERVAL', 'COLLATE', 'BINARY', 'ESCAPE', 'SIMILAR', 'TO', 'DIV', 'MOD', 'XOR', 'OVER', 'ANY', 'SOME', 'EXISTS', 'SELECT',
  'AT', 'ZONE', 'DATE', 'TIMESTAMP', 'TIME', 'FROM', 'BY'])
const LAST_BLOCK = new Set(['END', 'NULL', 'TRUE', 'FALSE', 'UNKNOWN', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'CURRENT_TIME', 'LOCALTIME',
  'LOCALTIMESTAMP', 'CURRENT_USER', 'SESSION_USER', 'ASC', 'DESC', 'AND', 'OR', 'NOT'])

function splitSelectItem(sql, toks) {
  const text = sql.slice(toks[0].start, toks[toks.length - 1].end).trim()
  const top = toks.filter(t => t.depth === toks[0].depth)
  const last = toks[toks.length - 1]
  const prev = toks[toks.length - 2]
  let alias
  let exprEnd = last.end
  if (toks.length >= 3 && prev.kind === 'word' && prev.upper === 'AS' && prev.depth === last.depth && /^(word|ident|string)$/.test(last.kind)) {
    alias = last.kind === 'word' ? last.text : unquoteIdent(last.text)
    exprEnd = prev.start
  } else if (toks.length >= 2 && top.length >= 2 && /^(word|ident|string)$/.test(last.kind) && last.depth === toks[0].depth &&
    !(last.kind === 'word' && (LAST_BLOCK.has(last.upper) || last.text.includes('.'))) &&
    (prev.kind === 'close' || prev.kind === 'ident' || prev.kind === 'string' || prev.kind === 'number' ||
      (prev.kind === 'word' && !PREV_BLOCK.has(prev.upper))) &&
    !(toks[toks.length - 3]?.kind === 'word' && toks[toks.length - 3].upper === 'INTERVAL') &&
    // A trailing string is an alias only after a plain column/call, never a typed literal (DATE '…', _utf8'…').
    !(last.kind === 'string' && (prev.kind === 'string' || prev.kind === 'number' || (prev.kind === 'word' && prev.text.startsWith('_'))))) {
    alias = last.kind === 'word' ? last.text : unquoteIdent(last.text)
    exprEnd = prev.end
  }
  const expr = sql.slice(toks[0].start, exprEnd).trim()
  const exprToks = toks.filter(t => t.end <= exprEnd)
  return { expr, alias, isAggregate: containsAggregate(exprToks), text }
}

/**
 * Split the outermost SELECT into clause texts.
 * @param {string} sql
 * @param {{ dialect?: string }} [opts]
 * @returns {undefined | { prefix: string, select: { expr: string, alias?: string, isAggregate: boolean }[], distinct: boolean,
 *   from: string, where?: string, groupBy?: string, having?: string, orderBy?: string, limit?: string, tail?: string }}
 */
export function parseSelect(sql, opts = {}) {
  if (typeof sql !== 'string') return undefined
  let src = sql.trim()
  while (src.endsWith(';')) src = src.slice(0, -1).trimEnd()
  const tokens = tokenize(src, opts)
  if (!tokens || !tokens.length) return undefined
  const first = tokens[0]
  if (first.kind !== 'word' || !/^(SELECT|WITH)$/.test(first.upper)) return undefined
  const selIdx = tokens.findIndex(t => t.depth === 0 && t.kind === 'word' && t.upper === 'SELECT')
  if (selIdx < 0) return undefined
  const prefix = src.slice(0, tokens[selIdx].start).trim()
  const top = []
  for (let k = selIdx; k < tokens.length; k++) if (tokens[k].depth === 0) top.push(k)
  if (top.some(k => tokens[k].kind === 'word' && /^(UNION|INTERSECT|EXCEPT|MINUS)$/.test(tokens[k].upper))) return undefined
  // Locate clause keywords at depth 0.
  const clauses = []
  for (const k of top) {
    const t = tokens[k]
    if (t.kind !== 'word') continue
    const next = tokens[k + 1]
    let key
    if (t.upper === 'FROM') {
      // a IS [NOT] DISTINCT FROM b
      if (tokens[k - 1]?.upper === 'DISTINCT' && /^(IS|NOT)$/.test(tokens[k - 2]?.upper ?? '')) continue
      if (clauses.some(c => c.key === 'from')) continue
      key = 'from'
    } else if (!clauses.length) continue
    else if (t.upper === 'WHERE') key = 'where'
    else if (t.upper === 'GROUP' && next?.upper === 'BY') key = 'groupBy'
    else if (t.upper === 'HAVING') key = 'having'
    else if (t.upper === 'ORDER' && next?.upper === 'BY') key = 'orderBy'
    else if (t.upper === 'LIMIT') key = 'limit'
    else if (/^(WINDOW|QUALIFY|OFFSET|FETCH|FOR|LOCK)$/.test(t.upper) && !clauses.some(c => c.key === 'tail')) {
      if (t.upper === 'OFFSET' && clauses.at(-1)?.key === 'limit') continue
      key = 'tail'
    } else continue
    if (key !== 'tail' && clauses.some(c => c.key === key)) return undefined
    const kwEnd = (key === 'groupBy' || key === 'orderBy') ? next.end : t.end
    clauses.push({ key, start: t.start, bodyStart: key === 'tail' ? t.start : kwEnd })
  }
  if (!clauses.length || clauses[0].key !== 'from') return undefined
  const out = { prefix, select: [], distinct: false, from: '', where: undefined, groupBy: undefined, having: undefined, orderBy: undefined, limit: undefined }
  clauses.forEach((c, i) => {
    const end = i + 1 < clauses.length ? clauses[i + 1].start : src.length
    out[c.key] = src.slice(c.bodyStart, end).trim()
  })
  if (!out.from) return undefined
  // Select list.
  let k = selIdx + 1
  while (tokens[k]?.kind === 'word' && /^(DISTINCT|ALL|DISTINCTROW|SQL_CALC_FOUND_ROWS|SQL_NO_CACHE|SQL_CACHE|HIGH_PRIORITY|STRAIGHT_JOIN|SQL_SMALL_RESULT|SQL_BIG_RESULT|SQL_BUFFER_RESULT)$/.test(tokens[k].upper)) {
    if (/^DISTINCT/.test(tokens[k].upper)) {
      // PostgreSQL DISTINCT ON (…) stays part of the list prefix.
      if (tokens[k + 1]?.upper === 'ON') return undefined
      out.distinct = true
    }
    k++
  }
  const fromTok = tokens.findIndex(t => t.start === clauses[0].start)
  const items = []
  let cur = []
  for (; k < fromTok; k++) {
    const t = tokens[k]
    if (t.kind === 'comma' && t.depth === 0) { items.push(cur); cur = []; continue }
    cur.push(t)
  }
  items.push(cur)
  if (items.some(it => !it.length)) return undefined
  out.select = items.map(it => {
    const { expr, alias, isAggregate } = splitSelectItem(src, it)
    return alias === undefined ? { expr, isAggregate } : { expr, alias, isAggregate }
  })
  return out
}

const IDENT_PATH = /^\s*(?:(?:`(?:[^`]|``)*`|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$]*)\s*\.\s*)*(`(?:[^`]|``)*`|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$]*)\s*$/u

/** Unquoted last part of a bare column reference, or undefined if expr is not one. */
function bareColumnName(expr) {
  const m = IDENT_PATH.exec(expr)
  return m ? unquoteIdent(m[1]) : undefined
}

/**
 * The select expression producing result column `name`.
 * @returns {string | undefined}
 */
export function aliasExpr(parsed, name) {
  const item = findItem(parsed, name)
  return item?.expr
}

function findItem(parsed, name) {
  if (!parsed || name === undefined || name === null) return undefined
  const n = String(name)
  const lower = n.toLowerCase()
  const sel = parsed.select ?? []
  return sel.find(s => s.alias === n) ??
    sel.find(s => s.alias !== undefined && s.alias.toLowerCase() === lower) ??
    sel.find(s => s.alias === undefined && bareColumnName(s.expr)?.toLowerCase() === lower) ??
    sel.find(s => s.alias === undefined && s.expr.replace(/\s+/g, '').toLowerCase() === n.replace(/\s+/g, '').toLowerCase())
}

// ------------------------------------------------------------ drill-down

function needsParens(expr) {
  if (IDENT_PATH.test(expr)) return false
  const toks = tokenize(expr) ?? []
  // A single function call: word ( … ) spanning the whole expression.
  if (toks.length >= 3 && toks[0].kind === 'word' && toks[1].kind === 'open' && toks.at(-1).kind === 'close' &&
    toks.slice(2, -1).every(t => t.depth >= 1)) return false
  return true
}

function equalsPredicate(expr, value, dialect) {
  const lhs = needsParens(expr) ? `(${expr})` : expr
  if (value === null || value === undefined) return `${lhs} IS NULL`
  return `${lhs} = ${literalFor(value, dialect, expr)}`
}

function joinWhere(where, preds) {
  const parts = []
  if (where && where.trim()) parts.push(`(${where.trim()})`)
  parts.push(...preds.filter(Boolean))
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : ''
}

const withPrefix = (prefix, body) => (prefix ? `${prefix} ${body}` : body)
const clampLimit = (n, def, max = 100000) => {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(v, max) : def
}

function drillContext({ sql, dialect, xColumn, xValue }) {
  const parsed = parseSelect(sql, { dialect })
  if (!parsed) return { error: '无法解析该查询：仅支持单个 SELECT（可带 WITH），不支持 UNION 或缺少 FROM 的语句' }
  if (xColumn === undefined || xColumn === null || xColumn === '') return { parsed, pred: undefined }
  const item = findItem(parsed, xColumn)
  if (!item) return { error: `找不到结果列「${xColumn}」对应的查询表达式` }
  if (item.isAggregate) return { error: `结果列「${xColumn}」是聚合指标，无法按它下钻` }
  if (/^\*$|\.\*$/.test(item.expr.trim())) return { error: `结果列「${xColumn}」无法定位到具体表达式` }
  return { parsed, pred: equalsPredicate(item.expr, xValue, dialect) }
}

/**
 * Detail rows behind one chart point.
 * @returns {{ sql: string } | { error: string }}
 */
export function buildDetailSql({ sql, dialect, xColumn, xValue, limit = 100 } = {}) {
  const ctx = drillContext({ sql, dialect, xColumn, xValue })
  if (ctx.error) return { error: ctx.error }
  const { parsed, pred } = ctx
  return { sql: withPrefix(parsed.prefix, `SELECT * FROM ${parsed.from}${joinWhere(parsed.where, [pred])} LIMIT ${clampLimit(limit, 100)}`) }
}

function dimensionLabelOf(dimension) {
  const name = bareColumnName(dimension)
  return name ?? dimension.trim()
}

/**
 * Break the aggregates of a query (optionally at one x value) down by another dimension.
 * @returns {{ sql: string, label: string, measures: string[] } | { error: string }}
 */
export function buildBreakdownSql({ sql, dialect, xColumn, xValue, dimension, dimensionLabel, limit = 20 } = {}) {
  if (typeof dimension !== 'string' || !dimension.trim()) return { error: '缺少拆解维度' }
  const ctx = drillContext({ sql, dialect, xColumn, xValue })
  if (ctx.error) return { error: ctx.error }
  const { parsed, pred } = ctx
  const aggs = parsed.select.filter(s => s.isAggregate)
  if (!aggs.length) return { error: '该查询没有聚合指标（COUNT/SUM/AVG 等），无法按维度拆解' }
  const dim = dimension.trim()
  let label = (dimensionLabel ?? dimensionLabelOf(dim)) || '维度'
  const measures = aggs.map(a => a.alias ?? a.expr)
  if (measures.some(m => m.toLowerCase() === label.toLowerCase())) label = `${label}（维度）`
  const cols = [`${dim} AS ${quoteIdent(label, dialect)}`, ...aggs.map((a, i) => `${a.expr} AS ${quoteIdent(measures[i], dialect)}`)]
  const body = `SELECT ${cols.join(', ')} FROM ${parsed.from}${joinWhere(parsed.where, [pred])} GROUP BY ${dim} ORDER BY ${quoteIdent(measures[0], dialect)} DESC LIMIT ${clampLimit(limit, 20)}`
  return { sql: withPrefix(parsed.prefix, body), label, measures }
}

// ------------------------------------------------------------ metrics

export const GRAINS = ['hour', 'day', 'week', 'month', 'year']

/** Time bucket expression for a quoted column. */
export function timeBucket(col, grain, dialect) {
  if (!GRAINS.includes(grain)) return undefined
  switch (dialect) {
    case 'postgres':
      return {
        day: `(${col})::date`,
        week: `to_char(${col}, 'IYYY-"W"IW')`,
        month: `to_char(${col}, 'YYYY-MM')`,
        hour: `to_char(${col}, 'YYYY-MM-DD HH24:00')`,
        year: `EXTRACT(YEAR FROM ${col})::int`,
      }[grain]
    case 'sqlite':
      return {
        day: `date(${col})`,
        week: `strftime('%Y-W%W', ${col})`,
        month: `strftime('%Y-%m', ${col})`,
        hour: `strftime('%Y-%m-%d %H:00', ${col})`,
        year: `strftime('%Y', ${col})`,
      }[grain]
    case 'elasticsearch':
      return `DATE_TRUNC('${grain}', ${col})`
    default:
      return {
        day: `DATE(${col})`,
        week: `DATE_FORMAT(${col}, '%x-W%v')`,
        month: `DATE_FORMAT(${col}, '%Y-%m')`,
        hour: `DATE_FORMAT(${col}, '%Y-%m-%d %H:00')`,
        year: `YEAR(${col})`,
      }[grain]
  }
}

const FILTER_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'in', 'not in', 'like'])

/**
 * Build the SQL for a semantic metric.
 * @returns {{ sql: string, columns: { time?: string, dimensions: string[], value: string } } | { error: string }}
 */
export function buildMetricSql({ metric, dialect = 'mysql', grain, dimensions = [], range, from, to, filters = [], limit = 1000, now } = {}) {
  if (!metric || typeof metric !== 'object') return { error: '缺少指标定义' }
  const expression = typeof metric.expression === 'string' ? metric.expression.trim() : ''
  const table = typeof metric.table === 'string' ? metric.table.trim() : ''
  if (!expression) return { error: `指标「${metric.name ?? ''}」缺少计算表达式` }
  if (!table) return { error: `指标「${metric.name ?? ''}」缺少数据表` }
  const name = String(metric.name || 'value')
  if (grain !== undefined && grain !== null && grain !== '' && !GRAINS.includes(grain)) return { error: `不支持的时间粒度「${grain}」` }
  const hasGrain = !!grain
  const timeCol = metric.timeColumn ? quoteName(metric.timeColumn, dialect) : undefined
  if (hasGrain && !timeCol) return { error: `指标「${name}」未配置时间列，无法按${grain}聚合` }
  // Time range.
  let bounds
  if (from || to) bounds = { from, to }
  else if (range) {
    if (!TIME_RANGES.includes(range)) return { error: `不支持的时间范围「${range}」` }
    bounds = timeBounds({ range }, now ?? new Date())
  }
  const where = []
  if (metric.filter && String(metric.filter).trim()) where.push(`(${String(metric.filter).trim()})`)
  if (bounds && (bounds.from || bounds.to)) {
    if (!timeCol) return { error: `指标「${name}」未配置时间列，无法按时间范围过滤` }
    if (bounds.from) where.push(`${timeCol} >= ${quoteString(bounds.from, dialect)}`)
    if (bounds.to) where.push(`${timeCol} < ${quoteString(bounds.to, dialect)}`)
  }
  for (const f of Array.isArray(filters) ? filters : []) {
    if (!f || typeof f.column !== 'string' || !f.column.trim()) return { error: '过滤条件缺少列名' }
    const op = String(f.op ?? '=').toLowerCase()
    if (!FILTER_OPS.has(op)) return { error: `不支持的过滤运算符「${f.op}」` }
    const col = quoteName(f.column.trim(), dialect)
    if (op === 'in' || op === 'not in') {
      const values = Array.isArray(f.values) ? f.values : (f.value !== undefined ? [f.value] : [])
      if (!values.length) return { error: `过滤条件「${f.column}」缺少取值` }
      where.push(`${col} ${op.toUpperCase()} (${values.map(v => literalFor(v, dialect)).join(', ')})`)
    } else if (f.value === null || f.value === undefined) {
      if (op === '=') where.push(`${col} IS NULL`)
      else if (op === '!=' || op === '<>') where.push(`${col} IS NOT NULL`)
      else return { error: `过滤条件「${f.column}」缺少取值` }
    } else {
      where.push(`${col} ${op === 'like' ? 'LIKE' : op} ${literalFor(f.value, dialect)}`)
    }
  }
  const dims = (Array.isArray(dimensions) ? dimensions : []).filter(d => typeof d === 'string' && d.trim()).map(d => d.trim())
  const select = []
  const group = []
  const timeLabel = '时间'
  if (hasGrain) {
    const bucket = timeBucket(timeCol, grain, dialect)
    select.push(`${bucket} AS ${quoteIdent(timeLabel, dialect)}`)
    group.push(bucket)
  }
  for (const d of dims) {
    const col = quoteName(d, dialect)
    select.push(`${col} AS ${quoteIdent(d, dialect)}`)
    group.push(col)
  }
  select.push(`${expression} AS ${quoteIdent(name, dialect)}`)
  let sql = `SELECT ${select.join(', ')} FROM ${quoteName(table, dialect)}`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (group.length) sql += ` GROUP BY ${group.join(', ')}`
  sql += hasGrain
    ? ` ORDER BY ${quoteIdent(timeLabel, dialect)} ASC${dims.length ? `, ${quoteIdent(name, dialect)} DESC` : ''}`
    : (group.length ? ` ORDER BY ${quoteIdent(name, dialect)} DESC` : '')
  sql += ` LIMIT ${clampLimit(limit, 1000)}`
  return { sql, columns: { ...(hasGrain ? { time: timeLabel } : {}), dimensions: dims, value: name } }
}

// ------------------------------------------------------------ attribution

function periodPredicate(timeExpr, p, dialect) {
  const lhs = needsParens(timeExpr) ? `(${timeExpr})` : timeExpr
  if (p && typeof p === 'object' && !(p instanceof Date)) {
    const parts = []
    if (p.from !== undefined && p.from !== null) parts.push(`${lhs} >= ${literalFor(p.from, dialect, timeExpr)}`)
    if (p.to !== undefined && p.to !== null) parts.push(`${lhs} < ${literalFor(p.to, dialect, timeExpr)}`)
    return parts.length ? parts.join(' AND ') : undefined
  }
  return `${lhs} = ${literalFor(p, dialect, timeExpr)}`
}

const isRange = (p) => p && typeof p === 'object' && !(p instanceof Date)

/**
 * SQL producing rows (dim, period, value) with period 'current' | 'baseline'.
 * @returns {{ sql: string } | { error: string }}
 */
export function buildAttributionSql({ dialect = 'mysql', from, where, timeExpr, measureExpr, dimension, current, baseline, limit = 50 } = {}) {
  if (!from || !String(from).trim()) return { error: '缺少数据来源（FROM）' }
  if (!timeExpr || !measureExpr || !dimension) return { error: '缺少时间表达式、指标表达式或维度' }
  if (current === undefined || baseline === undefined) return { error: '缺少对比的本期或基期' }
  const curPred = periodPredicate(timeExpr, current, dialect)
  const basePred = periodPredicate(timeExpr, baseline, dialect)
  if (!curPred || !basePred) return { error: '对比时间段为空' }
  const lhs = needsParens(timeExpr) ? `(${timeExpr})` : timeExpr
  let periodFilter
  if (!isRange(current) && !isRange(baseline)) periodFilter = `${lhs} IN (${literalFor(current, dialect, timeExpr)}, ${literalFor(baseline, dialect, timeExpr)})`
  else periodFilter = `((${curPred}) OR (${basePred}))`
  const period = `CASE WHEN ${curPred} THEN 'current' ELSE 'baseline' END`
  const q = (s) => quoteIdent(s, dialect)
  const sql = `SELECT ${dimension} AS ${q('dim')}, ${period} AS ${q('period')}, ${measureExpr} AS ${q('value')} FROM ${String(from).trim()}` +
    `${joinWhere(where, [periodFilter])} GROUP BY ${dimension}, ${period} ORDER BY ${q('value')} DESC LIMIT ${clampLimit(limit, 50) * 2}`
  return { sql }
}

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const ratio = (a, b) => (b === 0 ? null : a / b)

/**
 * Attribute the change of a measure across one dimension.
 * @param {Array<{ dim, period, value } | [dim, period, value]>} rows
 * @param {{ additive?: boolean, total?: { baseline: number, current: number }, top?: number }} [opts]
 */
export function computeAttribution(rows, { additive = true, total, top = 10 } = {}) {
  const groups = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const [dim, period, value] = Array.isArray(r) ? r : [r.dim ?? r.value_dim ?? r.dimension, r.period, r.value]
    const key = dim instanceof Date ? formatDate(dim) : dim === null || dim === undefined ? null : String(dim)
    const k = key === null ? '\u0000null' : key
    if (!groups.has(k)) groups.set(k, { value: key, baseline: 0, current: 0 })
    const g = groups.get(k)
    if (period === 'current') g.current += toNum(value)
    else if (period === 'baseline') g.baseline += toNum(value)
  }
  const all = [...groups.values()]
  const sumB = all.reduce((s, g) => s + g.baseline, 0)
  const sumC = all.reduce((s, g) => s + g.current, 0)
  const tb = total && Number.isFinite(Number(total.baseline)) ? Number(total.baseline) : sumB
  const tc = total && Number.isFinite(Number(total.current)) ? Number(total.current) : sumC
  const tDelta = tc - tb
  const finish = (g) => {
    const delta = g.current - g.baseline
    return { value: g.value, baseline: g.baseline, current: g.current, delta, share: ratio(delta, tDelta), pct: ratio(delta, g.baseline) }
  }
  const sorted = all.map(finish).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || String(a.value).localeCompare(String(b.value)))
  const concentration = Math.min(1, sorted.slice(0, 3).reduce((s, it) => s + Math.abs(it.share ?? 0), 0))
  let items = sorted
  if (sorted.length > top) {
    const rest = sorted.slice(top)
    const agg = rest.reduce((s, it) => ({ baseline: s.baseline + it.baseline, current: s.current + it.current }), { baseline: 0, current: 0 })
    items = [...sorted.slice(0, top), { ...finish({ value: '其他', ...agg }), count: rest.length }]
  }
  return {
    total: { baseline: tb, current: tc, delta: tDelta, pct: ratio(tDelta, tb) },
    items,
    concentration,
    distinct: all.length,
    additive: !!additive,
  }
}

/** Sort dimension attributions by explanatory power. */
export function rankDimensions(results) {
  return [...(Array.isArray(results) ? results : [])].sort((a, b) => {
    const ca = a?.attribution?.concentration ?? 0
    const cb = b?.attribution?.concentration ?? 0
    if (cb !== ca) return cb - ca
    const da = a?.attribution?.distinct ?? a?.attribution?.items?.length ?? 0
    const db = b?.attribution?.distinct ?? b?.attribution?.items?.length ?? 0
    return da - db
  })
}

/** Whether per-dimension values of the measure sum to the total. */
export function isAdditive(measureExpr) {
  if (typeof measureExpr !== 'string' || !measureExpr.trim()) return false
  const toks = tokenize(measureExpr)
  if (!toks) return false
  let sawAgg = false
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.kind === 'op' && t.text === '/') return false
    if (t.kind === 'word' && /^(DIV|MOD)$/.test(t.upper)) return false
    if (t.kind === 'word' && toks[k + 1]?.kind === 'open') {
      const name = t.text.split('.').pop().toUpperCase()
      if (name === 'SUM') { sawAgg = true; continue }
      if (name === 'COUNT' || name === 'COUNT_BIG') {
        if (toks[k + 2]?.kind === 'word' && toks[k + 2].upper === 'DISTINCT') return false
        sawAgg = true
        continue
      }
      if (isAggName(name)) return false
    }
  }
  return sawAgg
}

// ------------------------------------------------------------ alerts

const fmt = (v) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '空'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞'
  const r = Math.round(v * 100) / 100
  return Math.abs(r) >= 1e4 ? r.toLocaleString('en-US') : String(r)
}
const fmtPct = (p) => (Number.isFinite(p) ? `${p > 0 ? '+' : ''}${fmt(p)}%` : (p > 0 ? '+∞' : '-∞'))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v) => (v === null || v === undefined || v === '' ? null : (isNum(Number(v)) ? Number(v) : null))

const OP_TEXT = { '>': '大于', '>=': '大于等于', '<': '小于', '<=': '小于等于', '==': '等于', '!=': '不等于' }

/**
 * Evaluate an alert condition against a time series.
 * @param {object} condition
 * @param {{ t: any, v: number | null }[]} series - ascending by t.
 */
export function evaluateAlert(condition, series, { now } = {}) {
  const pts = (Array.isArray(series) ? series : []).map(p => ({ t: p?.t, v: num(p?.v) }))
  const last = pts.at(-1)
  const value = last ? last.v : null
  const type = condition?.type
  if (type === 'missing') {
    if (!last) return { triggered: true, value: null, message: '没有返回任何数据' }
    if (value === null) return { triggered: true, value: null, message: `最新数据点（${String(last.t)}）的值为空` }
    const staleMs = Number(condition.staleMinutes) * 60000
    if (staleMs > 0 && now !== undefined && last.t !== undefined) {
      const lt = new Date(last.t).getTime()
      const nt = new Date(now).getTime()
      if (Number.isFinite(lt) && Number.isFinite(nt) && nt - lt > staleMs) return { triggered: true, value, message: `数据已超过 ${condition.staleMinutes} 分钟未更新（最新为 ${String(last.t)}）` }
    }
    return { triggered: false, value, message: `数据正常，最新值为 ${fmt(value)}` }
  }
  if (value === null) return { triggered: false, value: null, message: last ? '最新数据点为空，无法判断' : '没有数据，无法判断' }
  if (type === 'threshold') {
    const op = condition.op
    const target = num(condition.value)
    if (!OP_TEXT[op] || target === null) return { triggered: false, value, message: '阈值条件无效' }
    const triggered = { '>': value > target, '>=': value >= target, '<': value < target, '<=': value <= target, '==': value === target, '!=': value !== target }[op]
    return { triggered, value, baseline: target, message: triggered ? `最新值 ${fmt(value)} ${OP_TEXT[op]}阈值 ${fmt(target)}` : `最新值 ${fmt(value)}，未触发（条件：${OP_TEXT[op]} ${fmt(target)}）` }
  }
  if (type === 'change') {
    const prev = pts.length >= 2 ? pts.at(-2).v : null
    if (prev === null) return { triggered: false, value, message: '缺少上一期数据，无法计算变化' }
    const changePct = prev === 0 ? (value === 0 ? 0 : (value > 0 ? Infinity : -Infinity)) : (value - prev) / Math.abs(prev) * 100
    const pct = Math.abs(Number(condition.pct) || 0)
    const dir = condition.direction ?? 'any'
    const triggered = dir === 'up' ? changePct >= pct && changePct > 0
      : dir === 'down' ? changePct <= -pct && changePct < 0
        : Math.abs(changePct) >= pct && changePct !== 0
    const desc = prev === 0 ? `从 0 变为 ${fmt(value)}` : `较上期 ${fmt(prev)} 变化 ${fmtPct(changePct)}`
    const dirText = { up: '上涨', down: '下跌', any: '变化' }[dir] ?? '变化'
    return { triggered, value, baseline: prev, changePct, message: triggered ? `最新值 ${fmt(value)}，${desc}，超过${dirText}阈值 ${pct}%` : `最新值 ${fmt(value)}，${desc}，未触发` }
  }
  if (type === 'anomaly') {
    const z0 = Number(condition.z ?? 3) > 0 ? Number(condition.z ?? 3) : 3
    const window = Math.max(2, Math.floor(Number(condition.window ?? 14)) || 14)
    const minPoints = Math.max(2, Math.floor(Number(condition.minPoints ?? 7)) || 7)
    const hist = pts.slice(0, -1).map(p => p.v).filter(v => v !== null).slice(-window)
    if (hist.length < minPoints) return { triggered: false, value, message: `历史数据不足（${hist.length}/${minPoints} 个点），暂不判断异常` }
    const mean = hist.reduce((s, v) => s + v, 0) / hist.length
    const std = Math.sqrt(hist.reduce((s, v) => s + (v - mean) ** 2, 0) / (hist.length - 1))
    const expected = { low: mean - z0 * std, high: mean + z0 * std }
    const eps = 1e-12 * Math.max(1, Math.abs(mean))
    let z
    if (std <= eps) z = Math.abs(value - mean) <= eps ? 0 : (value > mean ? Infinity : -Infinity)
    else z = (value - mean) / std
    const dir = condition.direction ?? 'any'
    const triggered = dir === 'up' ? z >= z0 : dir === 'down' ? z <= -z0 : Math.abs(z) >= z0
    const band = `[${fmt(expected.low)}, ${fmt(expected.high)}]`
    return {
      triggered, value, baseline: mean, z, expected,
      message: triggered ? `最新值 ${fmt(value)} 偏离近 ${hist.length} 期均值 ${fmt(mean)}（z=${fmt(z)}），超出预期区间 ${band}` : `最新值 ${fmt(value)} 在预期区间 ${band} 内`,
    }
  }
  return { triggered: false, value, message: '未知的告警条件类型' }
}

// ------------------------------------------------------------ result comparison

function normCell(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : formatDate(v, { full: true })
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(v)) return v.toString('hex')
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  const t = s.trim()
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t)
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(t)
  if (m) return `${m[1]} ${m[2] ?? '00'}:${m[3] ?? '00'}:${m[4] ?? '00'}`
  return s
}

const typeRank = (v) => (v === null ? 0 : typeof v === 'number' ? 1 : 2)

function cellEq(a, b, tol) {
  if (a === null || b === null) return a === b
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return a === b
}

function cellCmp(a, b, tol) {
  const ra = typeRank(a); const rb = typeRank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return 0
  if (ra === 1) return cellEq(a, b, tol) ? 0 : a - b
  return a < b ? -1 : a > b ? 1 : 0
}

function rowsOf(result) {
  const cols = (result?.columns ?? []).map(c => (typeof c === 'string' ? { name: c } : c))
  const rows = (result?.rows ?? []).map(r => (Array.isArray(r) ? r : cols.map(c => r?.[c.name])).map(normCell))
  return { cols, rows }
}

function multisetEq(a, b, tol) {
  if (a.length !== b.length) return false
  const x = [...a].sort((p, q) => cellCmp(p, q, tol))
  const y = [...b].sort((p, q) => cellCmp(p, q, tol))
  return x.every((v, i) => cellEq(v, y[i], tol))
}

const rowCmp = (tol) => (p, q) => {
  for (let i = 0; i < p.length; i++) { const c = cellCmp(p[i], q[i], tol); if (c) return c }
  return 0
}

function rowsMatch(expRows, actRows, mapping, ordered, tol) {
  const proj = actRows.map(r => mapping.map(j => r[j]))
  if (ordered) {
    for (let i = 0; i < expRows.length; i++) if (!expRows[i].every((v, c) => cellEq(v, proj[i][c], tol))) return { ok: false, index: i }
    return { ok: true }
  }
  const x = [...expRows].sort(rowCmp(tol))
  const y = proj.sort(rowCmp(tol))
  for (let i = 0; i < x.length; i++) if (!x[i].every((v, c) => cellEq(v, y[i][c], tol))) return { ok: false, row: x[i] }
  return { ok: true }
}

/**
 * Compare two query results ignoring column names/order and (unless ordered) row order.
 * @param {{ columns: ({ name: string, kind?: string } | string)[], rows: any[][] | object[] }} expected
 * @param {typeof expected} actual
 * @returns {{ match: boolean, reason?: string, detail?: object }}
 */
/**
 * Long vs wide: one side has a single row whose numeric cells equal the
 * multiset of one numeric column of the other side (whose other columns are
 * category labels). Only for small results (≤ 12 categories).
 */
function pivotEquivalent(e, a, tolerance) {
  const tryPair = (long, wide) => {
    if (wide.rows.length !== 1 || long.rows.length < 2 || long.rows.length > 12) return false
    const wideNums = wide.rows[0].filter(v => typeof v === 'number')
    if (wideNums.length !== long.rows.length) return false
    for (let j = 0; j < long.cols.length; j++) {
      const col = long.rows.map(r => r[j])
      if (!col.every(v => typeof v === 'number')) continue
      const others = long.cols.map((_, k) => k).filter(k => k !== j)
      if (!others.every(k => long.rows.every(r => typeof r[k] !== 'number'))) continue
      if (multisetEq(col, wideNums, tolerance)) return true
    }
    return false
  }
  return tryPair(e, a) || tryPair(a, e)
}

export function compareResults(expected, actual, { tolerance = 1e-6, ordered = false } = {}) {
  const e = rowsOf(expected)
  const a = rowsOf(actual)
  if (e.rows.length !== a.rows.length) {
    // Same numbers in a pivoted shape (e.g. one row per category vs one row with a column per category).
    if (pivotEquivalent(e, a, tolerance)) return { match: true, detail: { pivot: true } }
    return { match: false, reason: `行数不同：期望 ${e.rows.length} 行，实际 ${a.rows.length} 行`, detail: { expectedRows: e.rows.length, actualRows: a.rows.length } }
  }
  if (a.cols.length < e.cols.length) return { match: false, reason: `列数不足：期望 ${e.cols.length} 列，实际 ${a.cols.length} 列` }
  const colVals = (rows, j) => rows.map(r => r[j])
  const candidates = e.cols.map((_, i) => {
    const ev = colVals(e.rows, i)
    return a.cols.map((_, j) => j).filter(j => multisetEq(ev, colVals(a.rows, j), tolerance))
  })
  const missing = candidates.findIndex(c => !c.length)
  if (missing >= 0) {
    const name = e.cols[missing].name
    const same = a.cols.findIndex(c => String(c.name).toLowerCase() === String(name).toLowerCase())
    if (same >= 0) {
      const ev = [...colVals(e.rows, missing)].sort((p, q) => cellCmp(p, q, tolerance))
      const av = [...colVals(a.rows, same)].sort((p, q) => cellCmp(p, q, tolerance))
      const k = ev.findIndex((v, i) => !cellEq(v, av[i], tolerance))
      const numeric = typeof ev[k] === 'number' || typeof av[k] === 'number'
      return { match: false, reason: `${numeric ? '数值不同' : '取值不同'}：列「${name}」期望 ${JSON.stringify(ev[k])}，实际 ${JSON.stringify(av[k])}`, detail: { column: name, expected: ev[k], actual: av[k] } }
    }
    return { match: false, reason: `缺少与期望列「${name}」一致的列`, detail: { column: name } }
  }
  if (!e.cols.length) return { match: true, detail: { mapping: {} } }
  // Backtracking over candidate mappings (prefer injective), bounded.
  // Expected columns that duplicate an earlier one row-for-row share its actual column; the rest map injectively.
  const dupOf = e.cols.map((_, i) => {
    for (let j = 0; j < i; j++) if (e.rows.every(r => cellEq(r[i], r[j], tolerance))) return j
    return -1
  })
  const order = candidates.map((c, i) => i).filter(i => dupOf[i] < 0).sort((p, q) => candidates[p].length - candidates[q].length)
  const mapping = new Array(e.cols.length)
  const fillDups = () => { dupOf.forEach((j, i) => { if (j >= 0) mapping[i] = mapping[j] }) }
  const used = new Set()
  let attempts = 0
  let lastFail
  const search = (d) => {
    if (attempts > 2000) return false
    if (d === order.length) {
      attempts++
      fillDups()
      const r = rowsMatch(e.rows, a.rows, mapping, ordered, tolerance)
      if (!r.ok) lastFail = r
      return r.ok
    }
    const i = order[d]
    for (const j of candidates[i]) {
      if (used.has(j)) continue
      mapping[i] = j
      used.add(j)
      if (search(d + 1)) return true
      used.delete(j)
    }
    return false
  }
  if (search(0)) {
    return { match: true, detail: { mapping: Object.fromEntries(e.cols.map((c, i) => [c.name, a.cols[mapping[i]].name])) } }
  }
  if (ordered && lastFail?.index !== undefined) {
    // Would the rows match ignoring order?
    const unordered = compareResults(expected, actual, { tolerance, ordered: false })
    if (unordered.match) return { match: false, reason: `行顺序不同：第 ${lastFail.index + 1} 行起不一致`, detail: { row: lastFail.index } }
  }
  return { match: false, reason: '各列取值一致，但行内组合不同', detail: lastFail?.row ? { expectedRow: lastFail.row } : undefined }
}

/** Token-level Jaccard similarity of two SQL texts (display only). */
export function scoreSql(expectedSql, actualSql) {
  const norm = (sql) => {
    const toks = tokenize(String(sql ?? '').trim().replace(/;+\s*$/, '')) ?? []
    return new Set(toks.filter(t => !/^(comma|open|close)$/.test(t.kind)).map(t => {
      if (t.kind === 'word') return t.text.toLowerCase()
      if (t.kind === 'ident') return unquoteIdent(t.text).toLowerCase()
      if (t.kind === 'number') return String(Number(t.text))
      return t.text
    }))
  }
  const x = norm(expectedSql)
  const y = norm(actualSql)
  if (!x.size && !y.size) return 1
  let inter = 0
  for (const t of x) if (y.has(t)) inter++
  return inter / (x.size + y.size - inter)
}
