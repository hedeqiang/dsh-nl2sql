import { lexSql } from './sql-guard.js'
/**
 * Table/column access policy and SQL identifier analysis.
 *
 * Policy shape (per data source):
 *   { mode: 'all' | 'allow' | 'deny', tables: string[], hiddenColumns: string[], maskedColumns: string[] }
 * Patterns are case-insensitive globs: `orders`, `ods_*`, `sales.*`; column
 * patterns are `table.column` (`*.salary`, `hr_*.id_card`).
 *
 * Enforcement is syntactic and conservative: a statement is refused when it
 * names a table the policy excludes, a system catalog, or a hidden column of a
 * referenced table; hidden columns that arrive anyway (SELECT *) are dropped
 * from the result. Database grants remain the strict boundary.
 */

export const EMPTY_POLICY = Object.freeze({ mode: 'all', tables: [], hiddenColumns: [], maskedColumns: [] })

export function normalizePolicy(input) {
  if (!input || typeof input !== 'object') return { ...EMPTY_POLICY }
  const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,，]/))
    .map(x => String(x).trim()).filter(Boolean).slice(0, 2000).map(x => x.slice(0, 200))
  const mode = ['all', 'allow', 'deny'].includes(input.mode) ? input.mode : 'all'
  return { mode, tables: [...new Set(list(input.tables))], hiddenColumns: [...new Set(list(input.hiddenColumns))], maskedColumns: [...new Set(list(input.maskedColumns))] }
}

export function policyActive(policy) {
  return Boolean(policy) && (policy.mode !== 'all' || policy.hiddenColumns.length > 0 || policy.maskedColumns.length > 0)
}

const globCache = new Map()
export function glob(pattern) {
  const key = pattern.toLowerCase()
  let re = globCache.get(key)
  if (!re) {
    re = new RegExp(`^${key.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    globCache.set(key, re)
  }
  return re
}

function matchAny(patterns, name) {
  const n = name.toLowerCase()
  const last = n.split('.').pop()
  return patterns.some(p => {
    const re = glob(p)
    return re.test(n) || (!p.includes('.') && re.test(last))
  })
}

/** Whether the policy lets the model see / query this table. */
export function tableAllowed(policy, table) {
  if (!policy || policy.mode === 'all') return true
  const hit = matchAny(policy.tables, table)
  return policy.mode === 'allow' ? hit : !hit
}

function columnMatches(patterns, table, column) {
  const t = table.toLowerCase()
  const tl = t.split('.').pop()
  const c = column.toLowerCase()
  return patterns.some(p => {
    const i = p.lastIndexOf('.')
    if (i < 0) return glob(p).test(c)
    const tp = glob(p.slice(0, i))
    return (tp.test(t) || tp.test(tl)) && glob(p.slice(i + 1)).test(c)
  })
}

export function columnHidden(policy, table, column) {
  return Boolean(policy) && columnMatches(policy.hiddenColumns, table, column)
}

export function columnMasked(policy, table, column) {
  return Boolean(policy) && columnMatches(policy.maskedColumns, table, column)
}

/** Schema as the model may see it: excluded tables and hidden columns removed. */
export function filterSchema(schema, policy) {
  if (!policyActive(policy)) return schema
  const tables = schema.tables
    .filter(t => tableAllowed(policy, t.name))
    .map(t => ({
      ...t,
      columns: t.columns.filter(c => !columnHidden(policy, t.name, c.name)).map(c => (columnMasked(policy, t.name, c.name) ? { ...c, values: undefined, roles: [...new Set([...c.roles, 'sensitive'])] } : c)),
      indexes: t.indexes.filter(i => i.columns.every(c => !columnHidden(policy, t.name, c))),
    }))
  const visible = new Set(tables.map(t => t.name))
  const hiddenCol = (tbl, col) => columnHidden(policy, tbl, col)
  const relations = schema.relations.filter(r => visible.has(r.from.table) && visible.has(r.to.table) && !hiddenCol(r.from.table, r.from.column) && !hiddenCol(r.to.table, r.to.column))
  return { ...schema, tables, relations }
}

/** Annotate (not filter) a schema for the page: blocked tables and hidden/masked columns. */
export function annotateSchema(schema, policy) {
  if (!policyActive(policy)) return schema
  return {
    ...schema,
    tables: schema.tables.map(t => ({
      ...t,
      blocked: !tableAllowed(policy, t.name),
      columns: t.columns.map(c => ({ ...c, hidden: columnHidden(policy, t.name, c.name), policyMasked: columnMasked(policy, t.name, c.name) })),
    })),
  }
}

// ------------------------------------------------------------ SQL analysis

/**
 * Identifiers of a statement, lower-cased, with dotted parts joined
 * (`db`.`t` → db.t), string literals and comments skipped. Also returns the
 * raw tokens that follow FROM/JOIN, which may contain `-` and `*` in
 * Elasticsearch index names.
 */
export function analyzeIdentifiers(sql, { dialect = 'mysql' } = {}) {
  const ids = []
  const fromTargets = []
  const src = normalizeForScan(String(sql), dialect)
  let i = 0
  let prevWord = ''
  let inFromList = false // after FROM target: `t alias, next` keeps listing tables
  let depth = 0
  let fromDepth = -1
  const pushId = (parts) => { if (parts.length) ids.push(parts.join('.').toLowerCase()) }
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    void n
    // Input is normalized by normalizeForScan: comments are gone and every string literal is exactly ''.
    if (c === '\'') { i += 2; prevWord = ''; continue }
    if (c === '`' || c === '"' || /[A-Za-z_]/.test(c)) {
      // A possibly dotted identifier chain.
      const parts = []
      const start = i
      for (;;) {
        if (src[i] === '`' || src[i] === '"') {
          const q = src[i]
          let j = i + 1
          let text = ''
          while (j < src.length) {
            if (src[j] === q) { if (src[j + 1] === q) { text += q; j += 2; continue } break }
            text += src[j]
            j++
          }
          parts.push(text)
          i = j + 1
        } else if (/[A-Za-z_]/.test(src[i] ?? '')) {
          let j = i
          while (j < src.length && /[\w$]/.test(src[j])) j++
          parts.push(src.slice(i, j))
          i = j
        } else if (src[i] === '*' && parts.length) {
          parts.push('*')
          i++
          break
        } else {
          break
        }
        if (src[i] === '.' && /[`"A-Za-z_*]/.test(src[i + 1] ?? '')) { i++; continue }
        break
      }
      const word = parts.length === 1 ? parts[0].toUpperCase() : ''
      if (/^(WHERE|GROUP|ORDER|HAVING|LIMIT|ON|USING|UNION|SELECT|WINDOW|FETCH|OFFSET|SET|RETURNING)$/.test(word) && depth === fromDepth) inFromList = false
      if (/^(FROM|JOIN)$/.test(prevWord)) {
        inFromList = true
        fromDepth = depth
        // Raw target, including hyphens/wildcards that bare identifiers stop at.
        let j = i
        while (j < src.length && /[\w\-*.:]/.test(src[j])) j++
        const raw = (parts.length === 1 && !/[`"]/.test(src[start]) ? src.slice(start, j) : parts.join('.')).toLowerCase()
        fromTargets.push(raw)
        if (j > i && !/[`"]/.test(src[start])) i = j
      }
      pushId(parts)
      prevWord = word
      continue
    }
    if (c === '(') depth++
    if (c === ')') { depth--; if (depth < fromDepth) inFromList = false }
    if (c === ',' && inFromList && depth === fromDepth) { prevWord = 'FROM'; i++; continue }
    if (!/\s/.test(c)) prevWord = ''
    i++
  }
  return { ids, fromTargets }
}

/**
 * Rewrite SQL for identifier scanning using the dialect's exact lexical rules:
 * comments become a space, string literals become '' (so nothing inside them is
 * read as code), quoted identifiers are kept as "name", and whitespace around
 * dots in name chains is removed (`information_schema . tables`).
 */
export function normalizeForScan(sql, dialect = 'mysql') {
  const { segments } = lexSql(sql, { dialect })
  const out = segments.map(sg => {
    if (sg.kind === 'comment') return ' '
    if (sg.kind === 'string') return "''"
    if (sg.kind === 'ident') {
      const t = sg.text
      const inner = t[0] === '[' ? t.slice(1, -1) : t.slice(1, -1).split(t[0] + t[0]).join(t[0])
      return `"${inner.replace(/"/g, '""')}"`
    }
    return sg.text
  }).join('')
  return out.replace(/\s*\.\s*(?=["A-Za-z_*])/g, '.').replace(/(["\w])\s+\./g, '$1.')
}

const SYSTEM_PREFIX = /^(information_schema|mysql|performance_schema|sys|pg_catalog|pg_toast)\./
const SYSTEM_BARE = /^pg_(class|namespace|attribute|tables|views|user|shadow|roles|authid|stat\w*|settings|proc|database|index|indexes|constraint|description|type|matviews|policies|sequence\w*)$/

/** Tables of the schema that a statement references. */
export function referencedTables(sql, tables, { dialect = 'mysql' } = {}) {
  const { ids, fromTargets } = analyzeIdentifiers(sql, { dialect })
  const names = tables.map(t => t.name)
  const lower = new Map(names.map(n => [n.toLowerCase(), n]))
  const byLast = new Map()
  for (const n of names) {
    const last = n.toLowerCase().split('.').pop()
    if (!byLast.has(last)) byLast.set(last, [])
    byLast.get(last).push(n)
  }
  const out = new Set()
  for (const id of [...ids, ...fromTargets]) {
    if (lower.has(id)) { out.add(lower.get(id)); continue }
    // db.table / schema.table / alias.column: try the last two and last parts.
    const parts = id.split('.')
    if (parts.length >= 2) {
      const two = parts.slice(-2).join('.')
      if (lower.has(two)) { out.add(lower.get(two)); continue }
    }
    // A bare name, or db.table where the last part names a table (MySQL database prefix).
    const last = parts[parts.length - 1]
    if ((parts.length === 1 || fromTargets.includes(id)) && byLast.has(last)) for (const n of byLast.get(last)) out.add(n)
    // Elasticsearch wildcard targets: every matching index.
    if (id.includes('*') && fromTargets.includes(id)) for (const n of names) if (glob(id).test(n.toLowerCase())) out.add(n)
  }
  return [...out]
}

/**
 * Refuse a statement the policy does not admit.
 * @returns undefined when admitted, otherwise a refusal message.
 */
export function checkAccess(sql, policy, schema, head, { dialect = 'mysql' } = {}) {
  if (!policyActive(policy)) return undefined
  const { ids, fromTargets } = analyzeIdentifiers(sql, { dialect })
  const scan = normalizeForScan(String(sql), dialect)
  if (policy.mode !== 'all' && head === 'SHOW') return '当前数据源启用了表访问控制，不允许执行 SHOW 语句；请使用 nl2sql_schema 查看可访问的表。'
  for (const id of [...ids, ...fromTargets]) {
    if (SYSTEM_PREFIX.test(id) || SYSTEM_BARE.test(id) || (fromTargets.includes(id) && id.startsWith('.'))) return `当前数据源启用了访问控制，不允许查询系统目录（${id}）。`
  }
  const tables = schema?.tables ?? []
  const refs = referencedTables(sql, tables, { dialect })
  const blocked = refs.filter(t => !tableAllowed(policy, t))
  if (blocked.length) return `无权查询表：${blocked.join('、')}（数据源访问控制）。`
  if (policy.mode === 'deny') {
    // Deny patterns also cover FROM/JOIN targets not (yet) in the analyzed schema.
    const raw = fromTargets.filter(t => t && !tableAllowed(policy, t.replace(/^"|"$/g, '')))
    if (raw.length) return `无权查询表：${raw.join('、')}（数据源访问控制）。`
  }
  if (policy.mode === 'allow') {
    // FROM/JOIN targets that resolve to no analyzed table (new tables, unanalyzed views) are refused too.
    const resolves = (target) => referencedTables(`SELECT 1 FROM ${/[^\w.]/.test(target) ? `"${target}"` : target}`, tables, { dialect: 'postgres' }).length > 0
    const ctes = new Set([...scan.matchAll(/(?:\bWITH(?:\s+RECURSIVE)?|,)\s*[`"]?([A-Za-z_][\w$]*)[`"]?\s*(?:\([^)]*\))?\s+AS\s*(?:NOT\s+)?(?:MATERIALIZED\s*)?\(/gi)].map(m => m[1].toLowerCase()))
    const unknown = fromTargets.filter(t => t && !ctes.has(t) && !/^(select|lateral|unnest|generate_series|json_table|dual)$/.test(t) && !resolves(t))
    if (unknown.length) return `无权查询未授权或未分析的表：${unknown.join('、')}。如果是新表，请先在页面上重新分析表结构并加入允许列表。`
  }
  const hidden = []
  const masked = []
  for (const t of refs) {
    const table = tables.find(x => x.name === t)
    for (const c of table?.columns ?? []) {
      if (columnHidden(policy, t, c.name)) hidden.push({ table: t, column: c.name.toLowerCase() })
      else if (columnMasked(policy, t, c.name)) masked.push({ table: t, column: c.name.toLowerCase() })
    }
  }
  if (hidden.length || masked.length) {
    const hiddenNames = new Set(hidden.map(h => h.column))
    const hit = ids.find(id => hiddenNames.has(id.split('.').pop().replace(/^"|"$/g, '')))
    if (hit) return `字段 ${hit} 已被数据源访问控制隐藏，不能在查询中使用。`
    if (/\b(row_to_json|to_jsonb?|jsonb?_agg|json_object_agg|hstore|record_out|row)\s*\(/i.test(scan)) return '引用的表含有受保护的字段，不允许使用整行转换函数（row_to_json/to_json/json_agg/ROW(...) 等）。'
    // Whole-row values: alias::type, CAST(alias AS …), (alias), alias in function args, alias.* inside a call.
    const aliasNames = tableAliases(scan, refs)
    for (const a of aliasNames) {
      const q = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const asValue = new RegExp(`(?:^|[^\\w."])${q}\\s*::|\\bCAST\\s*\\(\\s*${q}\\s+AS\\b|\\(\\s*${q}\\s*[,)]|,\\s*${q}\\s*\\)|\\(\\s*${q}\\.\\*`, 'i')
      if (asValue.test(scan)) return '引用的表含有受保护的字段，不允许把整行（表或别名本身）作为值使用；请明确列出需要的字段。'
    }
    // Masked columns may only be selected as plain columns (so results can be masked), not inside expressions.
    if (masked.length) {
      const maskedNames = new Set(masked.map(m => m.column))
      const exprUse = maskedInExpression(scan, maskedNames)
      if (exprUse) return `字段 ${exprUse} 需要脱敏显示，只能直接选取，不能用于表达式、函数或改名（AS）。`
    }
  }
  return undefined
}

/** Table names and aliases introduced in FROM/JOIN for the referenced tables. */
function tableAliases(scan, refs) {
  const out = new Set()
  const lastParts = new Set(refs.map(r => r.toLowerCase().split('.').pop()))
  for (const m of scan.matchAll(/\b(?:FROM|JOIN|,)\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))*)(?:\s+(?:AS\s+)?("?[A-Za-z_][\w$]*"?))?/gi)) {
    const name = m[1].split('.').pop().replace(/^"|"$/g, '').toLowerCase()
    if (!lastParts.has(name)) continue
    out.add(m[1].split('.').pop().replace(/^"|"$/g, ''))
    const alias = m[2]?.replace(/^"|"$/g, '')
    if (alias && !/^(WHERE|JOIN|ON|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP|ORDER|LIMIT|UNION|USING|NATURAL|HAVING|WINDOW)$/i.test(alias)) out.add(alias)
  }
  return [...out]
}

/**
 * Whether a masked column appears anywhere other than as a plain select item
 * (`col`, `t.col`) — e.g. inside a function, an operator, or renamed with AS.
 */
function maskedInExpression(scan, maskedNames) {
  const m = /^\s*\(*\s*SELECT\s+(DISTINCT\s+)?([\s\S]*?)\s+FROM\s/i.exec(scan)
  const items = m ? splitTop(m[2]) : []
  for (const item of items) {
    const text = item.trim()
    const plain = /^(?:"?[\w$]+"?\.)*"?([\w$]+)"?$/.exec(text)
    for (const name of maskedNames) {
      const re = new RegExp(`(^|[^\\w$])"?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?($|[^\\w$])`, 'i')
      if (!re.test(text)) continue
      if (plain && plain[1].toLowerCase() === name) continue
      return name
    }
  }
  // Outside the select list (WHERE/GROUP BY/ORDER BY) masked columns are fine: they do not reach results.
  return undefined
}

function splitTop(text) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** Result column indexes to drop (hidden) and to mask, given the referenced tables. */
export function resultColumnPolicy(policy, columns, refs, schema) {
  const drop = new Set()
  const mask = new Set()
  if (!policyActive(policy)) return { drop, mask }
  const tables = (schema?.tables ?? []).filter(t => refs.includes(t.name))
  columns.forEach((col, i) => {
    const name = String(col.name).toLowerCase()
    const origin = col.table && col.column ? [{ table: col.table, column: col.column }] : tables.map(t => ({ table: t.name, column: name.split('.').pop() }))
    for (const o of origin) {
      if (columnHidden(policy, o.table, o.column)) drop.add(i)
      else if (columnMasked(policy, o.table, o.column)) mask.add(i)
    }
  })
  return { drop, mask }
}
