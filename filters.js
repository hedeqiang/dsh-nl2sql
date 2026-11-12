/**
 * Dashboard global filters, injected into a widget's SQL.
 *
 * Filter shapes:
 *   { kind: 'time', column, range: 'today'|'yesterday'|'last7d'|'last30d'|'last90d'|'thisMonth'|'lastMonth'|'thisYear'|'custom', from?, to? }
 *   { kind: 'in', column, values: string[] }
 *
 * A filter applies to a query when the column belongs to a table in the
 * outermost query's FROM clause; the predicate is ANDed into that query's
 * WHERE clause, qualified with the table's alias. Queries the injector cannot
 * place safely (top-level UNION, no FROM) run unfiltered and report so.
 */

export const TIME_RANGES = ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear', 'custom']

export function normalizeFilters(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const f of input.slice(0, 10)) {
    if (!f || typeof f !== 'object' || typeof f.column !== 'string' || !f.column.trim()) continue
    const column = f.column.trim().slice(0, 200)
    if (f.kind === 'time') {
      const range = TIME_RANGES.includes(f.range) ? f.range : 'last30d'
      const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : undefined)
      if (range === 'custom' && !date(f.from) && !date(f.to)) continue
      out.push({ kind: 'time', column, range, ...(range === 'custom' ? { from: date(f.from), to: date(f.to) } : {}) })
    } else if (f.kind === 'in') {
      const values = (Array.isArray(f.values) ? f.values : []).map(v => String(v)).filter(v => v.length <= 200).slice(0, 100)
      if (values.length) out.push({ kind: 'in', column, values })
    }
  }
  return out
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Half-open local date interval [from, to) for a time filter. */
export function timeBounds(filter, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const add = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  switch (filter.range) {
    case 'today': return { from: ymd(today), to: ymd(add(today, 1)) }
    case 'yesterday': return { from: ymd(add(today, -1)), to: ymd(today) }
    case 'last7d': return { from: ymd(add(today, -6)), to: ymd(add(today, 1)) }
    case 'last30d': return { from: ymd(add(today, -29)), to: ymd(add(today, 1)) }
    case 'last90d': return { from: ymd(add(today, -89)), to: ymd(add(today, 1)) }
    case 'thisMonth': return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(add(today, 1)) }
    case 'lastMonth': return { from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 1)) }
    case 'thisYear': return { from: ymd(new Date(today.getFullYear(), 0, 1)), to: ymd(add(today, 1)) }
    case 'custom': {
      const to = filter.to ? ymd(add(new Date(`${filter.to}T00:00:00`), 1)) : undefined
      return { from: filter.from, to }
    }
    default: return {}
  }
}

export function describeFilter(f) {
  if (f.kind === 'time') {
    const b = timeBounds(f)
    return `${f.column} ∈ [${b.from ?? '…'}, ${b.to ?? '…'})`
  }
  return `${f.column} IN (${f.values.join(', ')})`
}

// ------------------------------------------------------------ SQL scanning

const CLAUSE_END = /^(WHERE|GROUP|HAVING|ORDER|LIMIT|WINDOW|QUALIFY|FETCH|OFFSET|UNION|INTERSECT|EXCEPT|FOR|PIVOT)$/i

/** Top-level (depth 0) word tokens of the outermost SELECT, with offsets. */
function topLevelWords(sql) {
  const words = []
  let depth = 0
  for (let i = 0; i < sql.length;) {
    const c = sql[i]
    const n = sql[i + 1]
    if ((c === '-' && n === '-') || c === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c
      const start = i
      i++
      while (i < sql.length) {
        if (sql[i] === '\\' && q === '\'') { i += 2; continue }
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue } break }
        i++
      }
      i++
      if (depth === 0) words.push({ kind: 'quoted', text: sql.slice(start, i), start, end: i })
      continue
    }
    if (c === '(') { depth++; if (depth === 1) words.push({ kind: 'open', start: i, end: i + 1 }); i++; continue }
    if (c === ')') { depth--; if (depth === 0) words.push({ kind: 'close', start: i, end: i + 1 }); i++; continue }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < sql.length && /[\w$.\-*]/.test(sql[j]) && !(sql[j] === '-' && sql[j + 1] === '-')) j++
      if (depth === 0) words.push({ kind: 'word', text: sql.slice(i, j), upper: sql.slice(i, j).toUpperCase(), start: i, end: j })
      i = j
      continue
    }
    if (c === ',' && depth === 0) words.push({ kind: 'comma', start: i, end: i + 1 })
    i++
  }
  return words
}

function unquote(t) {
  return t.replace(/^[`"]|[`"]$/g, '').replace(/``/g, '`').replace(/""/g, '"')
}

/** Parse the outermost query: FROM items with aliases, WHERE span, insertion point. */
export function parseOuterQuery(sql) {
  const words = topLevelWords(sql)
  // Skip a leading WITH ... list: the main SELECT is the first top-level SELECT after the CTE bodies.
  let selectIdx = words.findIndex(w => w.kind === 'word' && w.upper === 'SELECT')
  if (words[0]?.upper === 'WITH') {
    selectIdx = -1
    for (let k = 1; k < words.length; k++) if (words[k].kind === 'word' && words[k].upper === 'SELECT' && words[k - 1]?.kind === 'close') { selectIdx = k; break }
  }
  if (selectIdx < 0) return undefined
  const rest = words.slice(selectIdx)
  if (rest.some(w => w.kind === 'word' && /^(UNION|INTERSECT|EXCEPT)$/.test(w.upper))) return undefined
  const fromIdx = rest.findIndex(w => w.kind === 'word' && w.upper === 'FROM')
  if (fromIdx < 0) return undefined
  let endIdx = rest.findIndex((w, k) => k > fromIdx && w.kind === 'word' && CLAUSE_END.test(w.upper))
  if (endIdx < 0) endIdx = rest.length
  // FROM items: split by commas and JOIN keywords; skip ON/USING conditions.
  const items = []
  let current = []
  let inCondition = false
  const flush = () => { if (current.length) items.push(current); current = [] }
  for (let k = fromIdx + 1; k < endIdx; k++) {
    const w = rest[k]
    if (w.kind === 'comma' && !inCondition) { flush(); continue }
    if (w.kind === 'word' && /^(JOIN|INNER|LEFT|RIGHT|FULL|CROSS|OUTER|NATURAL|STRAIGHT_JOIN|LATERAL)$/.test(w.upper)) { flush(); inCondition = false; continue }
    if (w.kind === 'word' && /^(ON|USING)$/.test(w.upper)) { flush(); inCondition = true; continue }
    if (!inCondition) current.push(w)
  }
  flush()
  const tables = []
  for (const item of items) {
    if (item[0]?.kind === 'open') continue // derived table
    const nameTok = item[0]
    if (!nameTok || (nameTok.kind !== 'word' && nameTok.kind !== 'quoted')) continue
    let name = nameTok.kind === 'quoted' ? unquote(nameTok.text) : nameTok.text
    // Quoted dotted names: "schema"."table" arrive as one quoted token followed by a word starting with '.'.
    let k = 1
    while (item[k] && ((item[k].kind === 'word' && item[k].text.startsWith('.')) || (item[k].kind === 'quoted' && item[k - 1] && sql[item[k].start - 1] === '.'))) {
      name += item[k].kind === 'quoted' ? `.${unquote(item[k].text)}` : item[k].text
      k++
    }
    let alias
    const aliasTok = item[k]?.kind === 'word' && item[k].upper === 'AS' ? item[k + 1] : item[k]
    if (aliasTok && (aliasTok.kind === 'word' || aliasTok.kind === 'quoted') && !/^(WHERE|GROUP|ORDER|LIMIT|USE|FORCE|IGNORE|TABLESAMPLE|PARTITION)$/i.test(aliasTok.text)) {
      alias = aliasTok.kind === 'quoted' ? unquote(aliasTok.text) : aliasTok.text
    }
    tables.push({ name, alias })
  }
  const whereIdx = rest.findIndex((w, k) => k > fromIdx && w.kind === 'word' && w.upper === 'WHERE')
  let where
  if (whereIdx >= 0) {
    let whereEnd = rest.findIndex((w, k) => k > whereIdx && w.kind === 'word' && CLAUSE_END.test(w.upper) && w.upper !== 'WHERE')
    where = { keywordStart: rest[whereIdx].start, keywordEnd: rest[whereIdx].end, end: whereEnd < 0 ? sql.length : rest[whereEnd].start }
  }
  const insertAt = endIdx < rest.length ? rest[endIdx].start : sql.length
  return { tables, where, insertAt }
}

function quoteIdent(name, dialect) {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function literal(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function literalFor(value, dialect) {
  // MySQL treats backslash as an escape in string literals; PostgreSQL/ES do not.
  return dialect === 'mysql' ? literal(value) : `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Inject filters into a SELECT.
 * @param {string} sql
 * @param {object[]} filters - normalized filters.
 * @param {{ dialect: string, schema: { tables: { name: string, role?: string, columns: { name: string }[] }[] } }} ctx
 * @returns {{ sql: string, applied: object[], skipped: object[] }}
 */
export function applyFilters(sql, filters, { dialect, schema, now }) {
  if (!filters.length) return { sql, applied: [], skipped: [] }
  const outer = parseOuterQuery(sql)
  if (!outer || !outer.tables.length) return { sql, applied: [], skipped: filters.map(f => ({ ...f, reason: 'unsupported query shape' })) }
  const tables = schema?.tables ?? []
  const resolve = (ref) => {
    const n = ref.name.toLowerCase()
    return tables.find(t => t.name.toLowerCase() === n) ?? tables.find(t => t.name.toLowerCase().split('.').pop() === n.split('.').pop())
  }
  const refs = outer.tables.map(ref => ({ ref, table: resolve(ref) })).filter(x => x.table)
  const predicates = []
  const applied = []
  const skipped = []
  for (const f of filters) {
    const candidates = refs.filter(x => x.table.columns.some(c => c.name.toLowerCase() === f.column.toLowerCase()))
    if (!candidates.length) { skipped.push({ ...f, reason: 'column not in query tables' }); continue }
    const pick = candidates.find(x => x.table.role === 'fact') ?? candidates[0]
    const colName = pick.table.columns.find(c => c.name.toLowerCase() === f.column.toLowerCase()).name
    const qualifier = pick.ref.alias
      ? quoteIdent(pick.ref.alias, dialect)
      : (dialect === 'elasticsearch' ? null : pick.ref.name.split('.').map(p => quoteIdent(p, dialect)).join('.'))
    const col = dialect === 'elasticsearch' && !pick.ref.alias ? quoteIdent(colName, dialect) : `${qualifier}.${quoteIdent(colName, dialect)}`
    if (f.kind === 'time') {
      const b = timeBounds(f, now)
      const parts = []
      if (b.from) parts.push(`${col} >= ${literalFor(`${b.from}${dialect === 'elasticsearch' ? '' : ' 00:00:00'}`, dialect)}`)
      if (b.to) parts.push(`${col} < ${literalFor(`${b.to}${dialect === 'elasticsearch' ? '' : ' 00:00:00'}`, dialect)}`)
      if (!parts.length) { skipped.push({ ...f, reason: 'empty range' }); continue }
      predicates.push(parts.join(' AND '))
    } else {
      predicates.push(`${col} IN (${f.values.map(v => literalFor(v, dialect)).join(', ')})`)
    }
    applied.push({ ...f, table: pick.table.name, description: describeFilter(f) })
  }
  if (!predicates.length) return { sql, applied, skipped }
  const pred = predicates.join(' AND ')
  let out
  if (outer.where) {
    const existing = sql.slice(outer.where.keywordEnd, outer.where.end).trim()
    out = `${sql.slice(0, outer.where.keywordStart)}WHERE (${pred}) AND (${existing})${outer.where.end < sql.length ? ' ' : ''}${sql.slice(outer.where.end)}`
  } else {
    const before = sql.slice(0, outer.insertAt).replace(/\s+$/, '')
    const after = sql.slice(outer.insertAt)
    out = `${before} WHERE ${pred}${after ? ` ${after}` : ''}`
  }
  return { sql: out, applied, skipped }
}
