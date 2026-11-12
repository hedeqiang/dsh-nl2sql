/**
 * Nl2SqlService methods: knowledge suggestions mined from usage.
 * Mixed into the service prototype by index.js; `this` is the service.
 *
 * Deterministic (no model): 👍 / corrected 👎 feedback and repeated query
 * shapes become example candidates; recurring aggregates become metric
 * candidates; recurring CASE WHEN / aliased value mappings on enum columns
 * become column notes; recurring words of question titles that point at one
 * table / column become glossary drafts. A human accepts or dismisses each.
 */
import { parseSelect } from '../analysis.js'
import { checkAccess, filterSchema, referencedTables } from '../policy.js'
import { admitSql, lexSql } from '../sql-guard.js'
import { textGrams } from './schema.js'
import { SENSITIVE_NAME, UserError, hashText } from './shared.js'

/** Thresholds (see docs/development.md). */
export const SUGGEST = {
  shapeMin: 2, // agent queries with the same literal-free shape
  metricMin: 3, // distinct successful queries using the same aggregate + filter on one table
  noteMin: 2, // distinct queries mapping values of one enum column
  termMin: 3, // distinct question titles containing a term
  questionSim: 0.8, // question similarity above which an example counts as existing
  historyScan: 3000,
  feedbackScan: 1000,
  evidence: 5,
  glossaryMax: 15,
  dismissedMax: 2000,
}

const KIND_ORDER = { example: 0, metric: 1, note: 2, glossary: 3 }
const CJK = /[\u3400-\u9fff]/
const SQL_KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'BETWEEN', 'LIKE', 'ILIKE', 'ASC', 'DESC', 'UNION', 'ALL', 'INTERVAL', 'USING', 'WITH', 'TRUE', 'FALSE', 'EXISTS', 'OVER', 'PARTITION'])

// ------------------------------------------------------------ tokenizer

function unquoteString(text, dialect) {
  let s = text
  const e = /^[eE]'/.test(s)
  if (e) s = s.slice(1)
  if (s.startsWith('$')) {
    const m = /^\$[^$]*\$/.exec(s)
    return m ? s.slice(m[0].length, s.length - m[0].length) : s
  }
  const q = s[0]
  let body = s.slice(1, -1).split(q + q).join(q)
  if (dialect === 'mysql' || e) body = body.replace(/\\(.)/g, '$1')
  return body
}

/**
 * Tokens of a statement using the dialect's lexical rules: str, num, name
 * (dotted chains merged, `parts`), open, close, comma, op. Each token keeps
 * its source offsets and parenthesis depth `d`.
 */
export function sqlTokens(sql, dialect = 'mysql') {
  const src = String(sql ?? '')
  const { segments } = lexSql(src, { dialect })
  const raw = []
  for (const s of segments) {
    if (s.kind === 'comment') continue
    if (s.kind === 'string') { raw.push({ k: 'str', v: unquoteString(s.text, dialect), start: s.start, end: s.end }); continue }
    if (s.kind === 'ident') { const q = s.text[0]; const close = q === '[' ? ']' : q; raw.push({ k: 'id', v: s.text.slice(1, -1).split(close + close).join(close), start: s.start, end: s.end }); continue }
    const text = s.text
    let i = 0
    while (i < text.length) {
      const c = text[i]
      if (/\s/.test(c)) { i++; continue }
      const at = s.start + i
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? '') && !/[\w$\u00c0-\uffff]/.test(text[i - 1] ?? ''))) {
        const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.)/.exec(text.slice(i))
        const len = m ? m[0].length : 1
        raw.push({ k: 'num', v: text.slice(i, i + len), start: at, end: at + len })
        i += len
        continue
      }
      if (/[A-Za-z_\u00c0-\uffff]/.test(c)) {
        let j = i + 1
        while (j < text.length && /[\w$\u00c0-\uffff]/.test(text[j])) j++
        raw.push({ k: 'word', v: text.slice(i, j), start: at, end: s.start + j })
        i = j
        continue
      }
      const two = text.slice(i, i + 2)
      if (['<=', '>=', '<>', '!=', '||', '::'].includes(two)) { raw.push({ k: 'op', v: two, start: at, end: at + 2 }); i += 2; continue }
      raw.push({ k: c === '(' ? 'open' : c === ')' ? 'close' : c === ',' ? 'comma' : 'op', v: c, start: at, end: at + 1 })
      i++
    }
  }
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]
    if (t.k === 'word' || t.k === 'id') {
      const parts = [t.v]
      let end = t.end
      let lastStart = t.start
      let j = i
      while (raw[j + 1]?.k === 'op' && raw[j + 1].v === '.' && raw[j + 1].start === end && (raw[j + 2]?.k === 'word' || raw[j + 2]?.k === 'id' || (raw[j + 2]?.k === 'op' && raw[j + 2].v === '*'))) {
        parts.push(raw[j + 2].v)
        end = raw[j + 2].end
        lastStart = raw[j + 2].start
        j += 2
      }
      out.push({ k: 'name', parts, v: parts.join('.'), upper: parts.length === 1 && t.k === 'word' ? t.v.toUpperCase() : '', start: t.start, end, lastStart })
      i = j
      continue
    }
    out.push(t)
  }
  while (out.length && out.at(-1).k === 'op' && out.at(-1).v === ';') out.pop()
  let d = 0
  for (const t of out) {
    if (t.k === 'close') d--
    t.d = d
    if (t.k === 'open') d++
  }
  return out
}

const litText = (t) => (t.k === 'str' ? `'${t.v.replace(/'/g, "''")}'` : Number.isFinite(Number(t.v)) ? String(Number(t.v)) : t.v)
const isLit = (t) => t?.k === 'str' || t?.k === 'num'

/**
 * Literal-free shape: literals → ?, literal lists collapsed, identifiers
 * unquoted and lower-cased, whitespace normalized.
 */
export function sqlShape(sql, dialect = 'mysql') {
  const s = sqlTokens(sql, dialect).map(t => (isLit(t) ? '?' : t.k === 'name' ? t.v.toLowerCase() : t.v)).join(' ')
  return s.replace(/\?(?: , \?)+/g, '?').replace(/- \?/g, '?')
}

/** Canonical text keeping literals (case / quoting / whitespace insensitive). */
export function sqlCanonical(sql, dialect = 'mysql') {
  return sqlTokens(sql, dialect).map(t => (isLit(t) ? litText(t) : t.k === 'name' ? t.v.toLowerCase() : t.v)).join(' ')
}

/** Source text of a token run; qualifiers in `strip` are dropped, literals optionally redacted. */
function textOf(src, toks, { strip, redact } = {}) {
  let out = ''
  let prev
  for (const t of toks) {
    if (prev !== undefined && t.start > prev) out += /\S/.test(src.slice(prev, t.start)) ? src.slice(prev, t.start) : ' '
    if (t.k === 'name' && strip && t.parts.length > 1 && strip.has(t.parts.slice(0, -1).join('.').toLowerCase())) out += src.slice(t.lastStart, t.end)
    else if (redact && isLit(t)) out += '?'
    else out += src.slice(t.start, t.end)
    prev = t.end
  }
  return out.trim()
}

/** Split at depth-0 separators of the run's base depth. */
function splitTop(toks, isSep) {
  const out = []
  let cur = []
  const base = toks[0]?.d ?? 0
  for (const t of toks) {
    if (t.d === base && isSep(t)) { if (cur.length) out.push(cur); cur = []; continue }
    cur.push(t)
  }
  if (cur.length) out.push(cur)
  return out
}

/** Top-level AND conjuncts (BETWEEN … AND … kept together). */
function conjuncts(toks) {
  const out = []
  let cur = []
  let between = false
  const base = toks[0]?.d ?? 0
  for (const t of toks) {
    if (t.d === base && t.upper === 'BETWEEN') between = true
    if (t.d === base && t.upper === 'AND') {
      if (between) { between = false; cur.push(t); continue }
      if (cur.length) out.push(cur)
      cur = []
      continue
    }
    cur.push(t)
  }
  if (cur.length) out.push(cur)
  return out
}

// ------------------------------------------------------------ text helpers

/** Similarity of two questions: character bigram Dice after dropping filler characters and punctuation. */
export function questionSimilarity(a, b) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[的了个吗呢啊一下请帮我查询看看\s\p{P}]/gu, '')
  const x = textGrams(norm(a))
  const y = textGrams(norm(b))
  if (!x.size || !y.size) return norm(a) === norm(b) ? 1 : 0
  let inter = 0
  for (const g of x) if (y.has(g)) inter++
  return (2 * inter) / (x.size + y.size)
}

const LABEL_SUFFIX = /(的)?(笔数|单数|数量|次数|人数|个数|件数|总数|数|量|金额|总额|额|占比|比例|率|count|cnt|num|total|amount|sum)$/i
/** Value label from an aggregate alias such as 成功笔数 → 成功. */
export function labelFromAlias(alias) {
  const s = String(alias ?? '').trim().replace(LABEL_SUFFIX, '').replace(/[_\s]+$/, '')
  return s.length >= 1 && s.length <= 20 && CJK.test(s) ? s : undefined
}

const NAME_PREFIX = /^(最近|近|过去|每天|每日|每周|每月|每年|按天|按日|按周|按月|按年|今日|今天|昨日|昨天|本月|上月|本周|上周|今年|去年|各|按|的|统计|查询|计算)+/
const NAME_SUFFIX = /(趋势|分布|统计|情况|变化|排名|对比|明细|汇总|列表|走势|top\s*\d+|前\s*\d+)+$/i
/** Clean a metric name drawn from an alias or a title. */
export function cleanMetricName(text) {
  let s = String(text ?? '').replace(/["'`]/g, '').replace(/[（(][^）)]*[）)]$/, '').trim()
  for (let i = 0; i < 3; i++) s = s.replace(/\d+\s*(天|日|周|个月|月|年|小时)/g, '').replace(NAME_PREFIX, '').replace(NAME_SUFFIX, '').replace(/^[\s·:：,，、-]+|[\s·:：,，、-]+$/g, '')
  return s.slice(0, 60)
}

/** Longest common substring of all texts (CJK-aware, at least `min` characters). */
function commonSubstring(texts, min = 2) {
  const list = texts.map(x => String(x ?? '').replace(/\s+/g, '')).filter(Boolean)
  if (list.length < 2) return undefined
  const base = [...list].sort((a, b) => a.length - b.length)[0]
  for (let len = base.length; len >= min; len--) {
    for (let i = 0; i + len <= base.length; i++) {
      const sub = base.slice(i, i + len)
      if (list.every(x => x.includes(sub))) return sub
    }
  }
  return undefined
}

const TERM_STOP = new Set(['统计', '查询', '多少', '数量', '趋势', '分布', '排名', '情况', '对比', '变化', '明细', '列表', '汇总', '占比', '比例', '总数', '总量', '每天', '每日', '每周', '每月', '每年', '最近', '今天', '昨天', '本月', '上月', '本周', '上周', '今年', '去年', '按天', '按月', '一下', '哪些', '什么', '如何', '分析', '数据', '记录', '报表', '平均', '合计', '总计', '一共', '按照', '各个', '所有', '全部', '近期', '天数', '每个', '前十', '排行', '走势', '金额', '时间', '日期', '小时', '分钟'])
const EDGE_STOP = '的了和与及或按各每在是有中把被对从到为且个前后近内里次天日周月年吗呢啊'
/** Candidate glossary terms of a question title: CJK n-grams (2–6) and Latin words. */
export function titleTerms(title) {
  const out = new Set()
  const s = String(title ?? '')
  for (const run of s.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let n = 2; n <= Math.min(6, run.length); n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const g = run.slice(i, i + n)
        if (TERM_STOP.has(g) || EDGE_STOP.includes(g[0]) || EDGE_STOP.includes(g.at(-1))) continue
        out.add(g)
      }
    }
  }
  for (const w of s.match(/\b[A-Za-z][A-Za-z0-9]{1,15}\b/g) ?? []) if (/[A-Z]/.test(w) && !SQL_KEYWORDS.has(w.toUpperCase())) out.add(w)
  return out
}

// ------------------------------------------------------------ query analysis

/**
 * Parse one statement against the visible schema: referenced tables, alias
 * map, column resolver.
 */
export function analyzeSql(sql, { dialect = 'mysql', tables }) {
  const toks = sqlTokens(sql, dialect)
  const parsed = parseSelect(sql, { dialect })
  const refs = referencedTables(sql, tables, { dialect }).map(n => tables.find(t => t.name === n)).filter(Boolean)
  const byQual = new Map()
  for (const t of refs) { byQual.set(t.name.toLowerCase(), t); byQual.set(t.name.split('.').pop().toLowerCase(), t) }
  // Aliases: `table [AS] alias` anywhere in FROM / JOIN lists.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k !== 'name') continue
    const tb = refs.find(r => r.name.toLowerCase() === t.v.toLowerCase() || r.name.split('.').pop().toLowerCase() === t.parts.at(-1).toLowerCase())
    if (!tb || !['FROM', 'JOIN', ','].includes(toks[i - 1]?.upper || toks[i - 1]?.v)) continue
    let a = toks[i + 1]
    if (a?.upper === 'AS') a = toks[i + 2]
    if (a?.k === 'name' && a.parts.length === 1 && !SQL_KEYWORDS.has(a.upper) && !/^(NATURAL|STRAIGHT_JOIN|FORCE|USE|IGNORE)$/.test(a.upper)) byQual.set(a.v.toLowerCase(), tb)
  }
  const resolve = (tok) => {
    if (tok?.k !== 'name' || tok.parts.at(-1) === '*') return undefined
    const at = toks.indexOf(tok)
    if (at >= 0 && toks[at + 1]?.k === 'open') return undefined // function call
    const col = tok.parts.at(-1).toLowerCase()
    const qual = tok.parts.slice(0, -1).join('.').toLowerCase()
    const cands = qual ? [byQual.get(qual)].filter(Boolean) : refs
    const hits = cands.map(t => ({ table: t, column: t.columns.find(c => c.name.toLowerCase() === col) })).filter(x => x.column)
    return hits.length === 1 ? hits[0] : undefined
  }
  const single = refs.length === 1 && parsed && !parsed.prefix && !/\bjoin\b|\(|,/i.test(parsed.from)
  const strip = new Set([...byQual.keys()])
  return { sql, toks, parsed, refs, resolve, single, strip, dialect }
}

const isSensitiveCol = (c) => !c || c.roles?.includes('sensitive') || SENSITIVE_NAME.test(c.name)
const enumLike = (c) => c && !isSensitiveCol(c) && (c.roles?.includes('enum') || c.roles?.includes('flag') || (Array.isArray(c.values) && c.values.length > 0 && c.values.length <= 12) || /^(tinyint|smallint|enum|bool|boolean|bit)$/.test(c.dataType ?? ''))

/** Whether a literal sits next to a sensitive column (so the SQL carries a sensitive value). */
export function carriesSensitiveValue(a) {
  const toks = a.toks
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k !== 'name') continue
    const r = a.resolve(t)
    const sensitive = r ? isSensitiveCol(r.column) : SENSITIVE_NAME.test(t.parts.at(-1))
    if (!sensitive) continue
    for (let j = Math.max(0, i - 4); j <= Math.min(toks.length - 1, i + 4); j++) if (isLit(toks[j])) return true
  }
  return false
}

/** Columns of the WHERE / GROUP BY / select list a query uses, plus `col = literal` filters. */
function queryFacts(a) {
  const cols = new Set()
  const eq = new Map()
  for (const t of a.toks) {
    const r = a.resolve(t)
    if (r && !isSensitiveCol(r.column) && !r.column.roles?.includes('time')) cols.add(`${r.table.name}.${r.column.name}`)
  }
  if (a.parsed?.where) {
    const wt = sqlTokens(a.parsed.where, a.dialect)
    for (const c of conjuncts(wt)) {
      if (c.length === 3 && c[0].k === 'name' && c[1].v === '=' && isLit(c[2])) {
        const r = a.resolve(a.toks.find(x => x.k === 'name' && x.v === c[0].v))
        if (r && !isSensitiveCol(r.column)) eq.set(`${r.table.name}.${r.column.name}`, litText(c[2]))
      }
    }
  }
  return { tables: new Set(a.refs.map(t => t.name)), cols, eq }
}

/** Aggregate select items of a single-table query → metric facts. */
export function metricFacts(a) {
  if (!a.single || !a.parsed) return []
  const table = a.refs[0]
  const resolveIn = (src) => (tok) => a.resolve(a.toks.find(x => x.k === 'name' && x.v === tok.v) ?? tok)
  const whereSrc = a.parsed.where ?? ''
  const wt = whereSrc ? sqlTokens(whereSrc, a.dialect) : []
  const timeUses = new Map()
  const useTime = (src, toks) => {
    const res = resolveIn(src)
    for (const t of toks) { const r = t.k === 'name' ? res(t) : undefined; if (r?.column.roles?.includes('time')) timeUses.set(r.column.name, (timeUses.get(r.column.name) ?? 0) + 1) }
  }
  const filters = []
  for (const c of conjuncts(wt)) {
    const res = resolveIn(whereSrc)
    if (c.some(t => t.k === 'name' && res(t)?.column.roles?.includes('time'))) continue
    if (c.length === 3 && isLit(c[0]) && c[1].v === '=' && isLit(c[2])) continue // 1 = 1
    if (c.some(t => t.k === 'name' && isSensitiveCol(res(t)?.column) && res(t))) return [] // filter on a sensitive column: skip the query
    let text = textOf(whereSrc, c, { strip: a.strip })
    if (c.some(t => t.d === c[0].d && t.upper === 'OR')) text = `(${text})`
    filters.push({ text, key: sqlCanonical(text, a.dialect) })
  }
  filters.sort((x, y) => x.key.localeCompare(y.key))
  useTime(whereSrc, wt)
  const dims = new Set()
  if (a.parsed.groupBy) {
    const gt = sqlTokens(a.parsed.groupBy, a.dialect)
    useTime(a.parsed.groupBy, gt)
    for (const item of splitTop(gt, t => t.k === 'comma')) {
      let expr = item
      if (item.length === 1 && item[0].k === 'num') { const sel = a.parsed.select[Number(item[0].v) - 1]; expr = sel ? sqlTokens(sel.expr, a.dialect) : [] } else if (item.length === 1 && item[0].k === 'name') {
        const sel = a.parsed.select.find(s => s.alias && s.alias.toLowerCase() === item[0].v.toLowerCase())
        if (sel) expr = sqlTokens(sel.expr, a.dialect)
      }
      if (expr.length === 1 && expr[0].k === 'name') {
        const r = a.resolve(a.toks.find(x => x.k === 'name' && x.v === expr[0].v) ?? expr[0])
        const c = r?.column
        if (c && !isSensitiveCol(c) && !c.roles?.includes('time') && !c.roles?.includes('measure')) dims.add(c.name)
      } else useTime(a.parsed.groupBy, expr)
    }
  }
  const out = []
  for (const item of a.parsed.select) {
    if (!item.isAggregate) continue
    const et = sqlTokens(item.expr, a.dialect)
    if (et.some(t => t.upper === 'SELECT' || t.upper === 'OVER')) continue
    if (et.some(t => t.k === 'name' && isSensitiveCol(a.resolve(a.toks.find(x => x.k === 'name' && x.v === t.v) ?? t)?.column) && a.resolve(a.toks.find(x => x.k === 'name' && x.v === t.v) ?? t))) continue
    const expression = textOf(item.expr, et, { strip: a.strip })
    if (expression.length > 500) continue
    const filter = filters.map(f => f.text).join(' AND ')
    out.push({
      table: table.name,
      expression,
      filter,
      key: `${table.name.toLowerCase()}|${sqlCanonical(expression, a.dialect)}|${filters.map(f => f.key).join(' and ')}`,
      alias: item.alias,
      dims: [...dims],
      timeUses,
    })
  }
  return out
}

/** Value → label mappings of enum columns: CASE WHEN … THEN '<label>' and aggregates aliased by label. */
export function valueMappings(a) {
  const out = []
  const toks = a.toks
  const push = (nameTok, lit, label) => {
    const r = a.resolve(nameTok)
    if (!r || !enumLike(r.column) || !label) return
    const l = String(label).trim()
    if (!l || l.length > 30) return
    out.push({ key: `${r.table.name}.${r.column.name}`, table: r.table.name, column: r.column.name, value: lit.k === 'str' ? lit.v : String(Number(lit.v)), label: l })
  }
  // CASE expressions.
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].upper !== 'CASE') continue
    let end = i + 1
    let depth = 0
    for (; end < toks.length; end++) {
      if (toks[end].upper === 'CASE') depth++
      if (toks[end].upper === 'END') { if (depth === 0) break; depth-- }
    }
    const body = toks.slice(i + 1, end)
    const subject = body[0]?.k === 'name' && body[1]?.upper === 'WHEN' ? body[0] : undefined
    for (let j = 0; j < body.length; j++) {
      if (body[j].upper !== 'WHEN') continue
      const thenAt = body.findIndex((t, k) => k > j && t.upper === 'THEN' && t.d === body[j].d)
      if (thenAt < 0) break
      const cond = body.slice(j + 1, thenAt)
      const val = body[thenAt + 1]
      const label = val?.k === 'str' && body[thenAt + 2] && /^(WHEN|ELSE|END)$/.test(body[thenAt + 2].upper || (thenAt + 2 >= body.length ? 'END' : '')) ? val.v : (val?.k === 'str' && thenAt + 2 >= body.length ? val.v : undefined)
      if (!label || !CJK.test(label)) continue
      if (subject && cond.length === 1 && isLit(cond[0])) push(subject, cond[0], label)
      else if (!subject && cond[0]?.k === 'name' && cond[1]?.v === '=' && isLit(cond[2]) && cond.length === 3) push(cond[0], cond[2], label)
      else if (!subject && cond[0]?.k === 'name' && cond[1]?.upper === 'IN' && cond[2]?.k === 'open') for (const lit of cond.slice(3).filter(isLit)) push(cond[0], lit, label)
    }
    i = end
  }
  // Aggregates counting one value, aliased by its meaning: SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS 成功笔数.
  for (const item of a.parsed?.select ?? []) {
    if (!item.isAggregate || !item.alias) continue
    const label = labelFromAlias(item.alias)
    if (!label) continue
    const et = sqlTokens(item.expr, a.dialect)
    if (et.some(t => t.k === 'str' && CJK.test(t.v))) continue
    const preds = []
    for (let k = 0; k + 2 < et.length; k++) if (et[k].k === 'name' && et[k + 1].v === '=' && isLit(et[k + 2])) preds.push([et[k], et[k + 2]])
    if (preds.length !== 1) continue
    const nameTok = toks.find(x => x.k === 'name' && x.v === preds[0][0].v) ?? preds[0][0]
    push(nameTok, preds[0][1], label)
  }
  return out
}

// ------------------------------------------------------------ candidate mining

const evidenceOf = (q) => ({ at: q.at, question: q.question, sql: q.redacted, source: q.source })
const addEvidence = (list, ev) => {
  if (!list.some(x => x.at === ev.at && x.sql === ev.sql)) list.push(ev)
  list.sort((x, y) => (y.at ?? 0) - (x.at ?? 0))
  list.splice(SUGGEST.evidence)
  return list
}
const sid = (kind, key) => `sg-${hashText(`${kind}|${key}`)}`
const round = (x) => Number(Math.min(0.99, x).toFixed(2))

/**
 * Pure miner: history / feedback entries plus visible schema and knowledge
 * → suggestions. Exported for unit tests.
 * @param {{ history: object[], feedback: object[], tables: object[], knowledge: object, dialect?: string, accessOk?: (sql: string) => boolean }} input
 */
export function mineSuggestions({ history = [], feedback = [], tables = [], knowledge, dialect = 'mysql', accessOk = () => true }) {
  const k = knowledge ?? { glossary: [], metrics: [], notes: {}, examples: [] }
  const out = new Map()
  const analyze = (sql) => { try { return analyzeSql(sql, { dialect, tables }) } catch { return undefined } }
  const exampleCanon = new Set()
  const exampleShapes = new Set()
  for (const e of k.examples) { try { exampleCanon.add(sqlCanonical(e.sql, dialect)); exampleShapes.add(sqlShape(e.sql, dialect)) } catch {} }
  const questionKnown = (q) => k.examples.some(e => questionSimilarity(e.question, q) >= SUGGEST.questionSim)

  // Successful queries (history), each analyzed once.
  const queries = []
  for (const h of history) {
    if (h.status !== 'ok' || !h.sql || h.cached) continue
    if (/^归因 · /.test(h.title ?? '')) continue
    if (!accessOk(h.sql)) continue
    const a = analyze(h.sql)
    if (!a) continue
    const sensitive = carriesSensitiveValue(a)
    queries.push({ ...h, question: h.title ?? '', a, sensitive, canon: sqlCanonical(h.sql, dialect), shape: sqlShape(h.sql, dialect), redacted: sensitive ? textOf(h.sql, a.toks, { redact: true }) : h.sql })
  }

  // 1. Examples from feedback.
  for (const f of feedback) {
    const corrected = f.rating === 'down' && f.status === 'resolved' && f.correctedSql
    if (f.rating !== 'up' && !corrected) continue
    if (f.savedAsExample) continue
    const sql = corrected ? f.correctedSql : f.sql
    const question = String(f.question || f.title || '').trim()
    if (!sql || !question) continue
    try { admitSql(sql, { dialect }) } catch { continue }
    if (!accessOk(sql)) continue
    const a = analyze(sql)
    if (!a || carriesSensitiveValue(a)) continue
    const canon = sqlCanonical(sql, dialect)
    if (exampleCanon.has(canon) || questionKnown(question)) continue
    const id = sid('example', canon)
    const prev = out.get(id)
    const ev = { at: f.at, question, sql, source: 'feedback' }
    if (prev) { addEvidence(prev.evidence, ev); prev.score = round(prev.score + 0.02); continue }
    out.set(id, {
      id, kind: 'example', key: canon, shape: sqlShape(sql, dialect),
      item: { question: question.slice(0, 500), sql, note: corrected && f.comment ? `修正自反馈：${f.comment}`.slice(0, 500) : '' },
      evidence: [ev], score: corrected ? 0.95 : 0.9,
      reason: corrected ? '👎 反馈已修正为正确 SQL，可作为样例问答复用' : '用户对这条查询结果点了 👍，可作为已验证的样例问答',
    })
  }

  // 2. Examples from repeated agent query shapes.
  const shapes = new Map()
  for (const q of queries) {
    if (q.source !== 'agent' || !q.question.trim() || q.sensitive) continue
    if (!shapes.has(q.shape)) shapes.set(q.shape, [])
    shapes.get(q.shape).push(q)
  }
  for (const [shape, list] of shapes) {
    if (list.length < SUGGEST.shapeMin || exampleShapes.has(shape)) continue
    const latest = [...list].sort((x, y) => (y.at ?? 0) - (x.at ?? 0))[0]
    const fromFeedback = [...out.values()].find(s => s.kind === 'example' && s.shape === shape)
    if (fromFeedback) { for (const q of list) addEvidence(fromFeedback.evidence, evidenceOf(q)); continue }
    if (exampleCanon.has(latest.canon) || questionKnown(latest.question)) continue
    const id = sid('example-shape', shape)
    out.set(id, {
      id, kind: 'example', key: shape, shape,
      item: { question: latest.question.slice(0, 500), sql: latest.sql, note: '' },
      evidence: list.map(evidenceOf).sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).slice(0, SUGGEST.evidence),
      score: round(0.4 + 0.1 * list.length),
      reason: `同一结构的查询被助手执行了 ${list.length} 次（仅取值不同），可沉淀为样例问答`,
    })
  }

  // 3. Metrics from recurring aggregates.
  const metricGroups = new Map()
  const tableTime = new Map()
  for (const q of queries) {
    for (const m of metricFacts(q.a)) {
      if (!metricGroups.has(m.key)) metricGroups.set(m.key, { ...m, queries: new Map(), aliases: [], titles: [], dimsCount: new Map(), time: new Map() })
      const g = metricGroups.get(m.key)
      if (!g.queries.has(q.canon)) {
        g.queries.set(q.canon, q)
        if (m.alias) g.aliases.push(m.alias)
        if (q.question) g.titles.push(q.question)
        for (const d of m.dims) g.dimsCount.set(d, (g.dimsCount.get(d) ?? 0) + 1)
        for (const [c, n] of m.timeUses) g.time.set(c, (g.time.get(c) ?? 0) + n)
      }
      const tt = tableTime.get(m.table) ?? new Map()
      for (const [c, n] of m.timeUses) tt.set(c, (tt.get(c) ?? 0) + n)
      tableTime.set(m.table, tt)
    }
  }
  const metricKey = (m) => `${String(m.table ?? '').toLowerCase()}|${sqlCanonical(m.expression, dialect)}|${conjuncts(sqlTokens(m.filter ?? '', dialect)).map(c => sqlCanonical(c.map(t => (t.k === 'name' ? t.parts.at(-1) : isLit(t) ? litText(t) : t.v)).join(' '), dialect)).sort().join(' and ')}`
  const libKeys = new Set(k.metrics.map(metricKey))
  const libNames = new Set(k.metrics.flatMap(m => [m.name, ...(m.synonyms ?? [])]).map(x => String(x).toLowerCase()))
  const top = (map) => [...map.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0]
  const metricNames = new Set()
  for (const g of metricGroups.values()) {
    const n = g.queries.size
    if (n < SUGGEST.metricMin) continue
    const probe = metricKey({ table: g.table, expression: g.expression, filter: g.filter })
    if (libKeys.has(probe)) continue
    const aliasCount = new Map()
    for (const x of g.aliases) aliasCount.set(x, (aliasCount.get(x) ?? 0) + 1)
    const cjkAlias = top(new Map([...aliasCount].filter(([x]) => CJK.test(x))))
    const fromTitles = commonSubstring(g.titles.map(cleanMetricName))
    let name = cleanMetricName(cjkAlias ?? '') || (fromTitles && cleanMetricName(fromTitles).length >= 2 ? cleanMetricName(fromTitles) : '') || cleanMetricName(top(aliasCount) ?? '') || g.expression.slice(0, 60)
    if (libNames.has(name.toLowerCase()) || metricNames.has(name)) name = `${name}（${g.table.split('.').pop()}${g.filter ? '，条件' : ''}）`.slice(0, 60)
    metricNames.add(name)
    const timeColumn = top(g.time) ?? top(tableTime.get(g.table) ?? new Map()) ?? ''
    const dimensions = [...g.dimsCount.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d).slice(0, 20)
    const synonyms = [...new Set(g.aliases.filter(x => CJK.test(x)).map(cleanMetricName).filter(x => x && x !== name))].slice(0, 5)
    const list = [...g.queries.values()]
    const id = sid('metric', g.key)
    out.set(id, {
      id, kind: 'metric', key: g.key,
      item: { name, expression: g.expression, table: g.table, filter: g.filter, timeColumn, dimensions, synonyms, unit: '', description: '' },
      evidence: list.map(evidenceOf).sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).slice(0, SUGGEST.evidence),
      score: round(0.3 + 0.1 * n),
      reason: `${n} 条成功的查询在 ${g.table} 上使用了相同的聚合口径 ${g.expression}${g.filter ? `（条件 ${g.filter}）` : ''}，指标库中还没有`,
    })
  }

  // 4. Notes from recurring value mappings.
  const noteGroups = new Map()
  for (const q of queries) {
    const seen = new Set()
    for (const m of valueMappings(q.a)) {
      if (k.notes[m.key]) continue
      if (!noteGroups.has(m.key)) noteGroups.set(m.key, { ...m, queries: new Map(), labels: new Map() })
      const g = noteGroups.get(m.key)
      g.queries.set(q.canon, q)
      const tag = `${q.canon}\u0000${m.value}\u0000${m.label}`
      if (seen.has(tag)) continue
      seen.add(tag)
      const lv = g.labels.get(m.value) ?? new Map()
      lv.set(m.label, (lv.get(m.label) ?? 0) + 1)
      g.labels.set(m.value, lv)
    }
  }
  for (const g of noteGroups.values()) {
    const n = g.queries.size
    if (n < SUGGEST.noteMin) continue
    const pairs = [...g.labels.entries()].map(([v, labels]) => [v, top(labels)]).sort((x, y) => (Number.isFinite(Number(x[0])) && Number.isFinite(Number(y[0])) ? Number(x[0]) - Number(y[0]) : x[0].localeCompare(y[0])))
    const conflicts = [...g.labels.values()].filter(l => l.size > 1).length
    const text = pairs.map(([v, l]) => `${v}=${l}`).join('，')
    const id = sid('note', g.key)
    out.set(id, {
      id, kind: 'note', key: g.key,
      item: { key: g.key, text: text.slice(0, 1000) },
      evidence: [...g.queries.values()].map(evidenceOf).sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).slice(0, SUGGEST.evidence),
      score: round(0.5 + 0.1 * n - 0.1 * conflicts),
      reason: `${n} 条查询用 CASE WHEN / 别名把 ${g.key} 的取值映射为业务含义${conflicts ? `（有 ${conflicts} 个取值的叫法不一致，已取最常用的）` : ''}，该字段还没有备注`,
    })
  }

  // 5. Glossary terms from question titles.
  const byTitle = new Map()
  for (const q of queries) {
    const title = q.question.trim()
    if (!title || q.sensitive) continue
    const prev = byTitle.get(title)
    if (!prev || (q.at ?? 0) > (prev.at ?? 0)) byTitle.set(title, q)
  }
  const titled = [...byTitle.values()].map(q => ({ q, facts: queryFacts(q.a), terms: titleTerms(q.question) }))
  const support = new Map()
  titled.forEach((x, i) => { for (const term of x.terms) { if (!support.has(term)) support.set(term, new Set()); support.get(term).add(i) } })
  const known = new Set([...k.glossary.flatMap(g => [g.term, ...(g.synonyms ?? [])]), ...k.metrics.flatMap(m => [m.name, ...(m.synonyms ?? [])]), ...metricNames].map(x => String(x).toLowerCase()))
  let terms = [...support.entries()].filter(([term, s]) => s.size >= SUGGEST.termMin && !/\d/.test(term))
  // Keep maximal terms: drop a term contained in a longer one with the same support.
  terms.sort((x, y) => y[0].length - x[0].length)
  const kept = []
  for (const [term, s] of terms) if (!kept.some(([t2, s2]) => t2.includes(term) && s2.size >= s.size)) kept.push([term, s])
  // Known terms are not suggested again (fragments of longer terms were dropped above).
  terms = kept.filter(([term]) => !known.has(term.toLowerCase()))
  const glossary = []
  const tableByName = new Map(tables.map(t => [t.name, t]))
  for (const [term, s] of terms) {
    const inside = [...s].map(i => titled[i])
    const outside = titled.filter((_, i) => !s.has(i))
    const share = (list, pred) => (list.length ? list.filter(pred).length / list.length : 0)
    // Column: present in most of the term's queries, rarely elsewhere.
    const cands = new Map()
    for (const x of inside) for (const c of x.facts.cols) cands.set(c, (cands.get(c) ?? 0) + 1)
    let best
    for (const [c] of cands) {
      const sIn = share(inside, x => x.facts.cols.has(c))
      const sOut = share(outside, x => x.facts.cols.has(c))
      const lift = sIn - sOut
      if (sIn >= 0.6 && lift >= 0.34 && (!best || lift > best.lift || (lift === best.lift && sIn > best.sIn))) best = { c, sIn, lift }
    }
    let item
    let reason
    if (best) {
      const [tName, ...rest] = best.c.split(/\.(?=[^.]+$)/)
      const col = rest[0]
      const column = tableByName.get(tName)?.columns.find(c => c.name === col)
      const eqVals = new Map()
      for (const x of inside) { const v = x.facts.eq.get(best.c); if (v !== undefined) eqVals.set(v, (eqVals.get(v) ?? 0) + 1) }
      const v = top(eqVals)
      const consistent = v !== undefined && eqVals.get(v) / inside.length >= 0.8
      const comment = column?.comment ? `（${String(column.comment).slice(0, 60)}）` : ''
      item = { term, synonyms: [], definition: consistent ? `指 ${tName}.${col}${comment} = ${v} 的记录` : `指 ${tName}.${col}${comment}`, sql: consistent ? `${col} = ${v}` : '' }
      reason = `「${term}」出现在 ${s.size} 个问题标题中，对应的查询都用到了 ${best.c}${consistent ? `（条件 ${col} = ${v}）` : ''}，而其他问题很少用到`
    } else {
      const tcount = new Map()
      for (const x of inside) for (const tb of x.facts.tables) tcount.set(tb, (tcount.get(tb) ?? 0) + 1)
      const tb = top(tcount)
      if (!tb) continue
      const sIn = share(inside, x => x.facts.tables.has(tb))
      const sOut = share(outside, x => x.facts.tables.has(tb))
      if (sIn < 0.8 || !outside.length || sOut > 0.5) continue
      const comment = tableByName.get(tb)?.comment ? `（${String(tableByName.get(tb).comment).slice(0, 60)}）` : ''
      item = { term, synonyms: [], definition: `指 ${tb}${comment} 表中的记录`, sql: '' }
      reason = `「${term}」出现在 ${s.size} 个问题标题中，对应的查询都读取 ${tb}，而其他问题大多不读这张表`
    }
    const id = sid('glossary', term.toLowerCase())
    glossary.push({
      id, kind: 'glossary', key: term.toLowerCase(), item,
      evidence: inside.map(x => evidenceOf(x.q)).sort((x, y) => (y.at ?? 0) - (x.at ?? 0)).slice(0, SUGGEST.evidence),
      score: round(0.25 + 0.05 * s.size + (best ? 0.15 : 0) + Math.min(0.1, 0.02 * term.length)),
      reason,
    })
  }
  glossary.sort((x, y) => y.score - x.score).slice(0, SUGGEST.glossaryMax).forEach(g => out.set(g.id, g))

  return [...out.values()].map(({ shape: _s, key: _k, ...s }) => s).sort((x, y) => (KIND_ORDER[x.kind] - KIND_ORDER[y.kind]) || (y.score - x.score))
}

// ------------------------------------------------------------ service methods

export const methods = {
  /** All current suggestions for a data source (dismissed ones removed). */
  async suggestKnowledge({ datasourceId, limit = 50 } = {}) {
    const ds = this.requireDatasource(datasourceId)
    const dialect = ds.type ?? 'mysql'
    const k = this.knowledgeFor(ds.id)
    const dismissed = new Set(this.state.suggestionDismissed?.[ds.id] ?? [])
    const newest = (kind) => this.records.list(kind, { ref: ds.id, limit: 1 })[0]?.id ?? ''
    let schema
    // Cached analysis only: listing suggestions (and the tab badge) never connects to the database.
    try { schema = this.schemas.get(ds.id) ?? await this.readSchemaFile(ds.id) } catch { schema = undefined }
    const memoKey = JSON.stringify([this.records.count('history', { ref: ds.id }), newest('history'), this.records.count('feedback', { ref: ds.id }), newest('feedback'), hashText(JSON.stringify(k)), dismissed.size, ds.updatedAt ?? 0, JSON.stringify(ds.policy ?? null), schema?.analyzedAt ?? 0])
    this.suggestMemo ??= new Map()
    let all = this.suggestMemo.get(ds.id)?.key === memoKey ? this.suggestMemo.get(ds.id).value : undefined
    if (!all) {
      const policy = this.policyFor(ds)
      if (!schema) all = []
      else {
        const visible = filterSchema(schema, policy)
        const accessOk = (sql) => {
          try {
            const admitted = admitSql(sql, { dialect })
            return !checkAccess(admitted.sql, policy, schema, admitted.head, { dialect })
          } catch { return false }
        }
        all = mineSuggestions({
          history: this.records.list('history', { ref: ds.id, status: 'ok', limit: SUGGEST.historyScan }),
          feedback: this.records.list('feedback', { ref: ds.id, limit: SUGGEST.feedbackScan }),
          tables: visible.tables,
          knowledge: k,
          dialect,
          accessOk,
        })
      }
      this.suggestMemo.set(ds.id, { key: memoKey, value: all })
    }
    const list = all.filter(s => !dismissed.has(s.id))
    const n = Math.max(1, Math.min(500, Number(limit) || 50))
    return list.slice(0, n)
  },

  async listKnowledgeSuggestions({ datasourceId, limit } = {}) {
    const ds = this.requireDatasource(datasourceId)
    const suggestions = await this.suggestKnowledge({ datasourceId: ds.id, limit: limit ?? 200 })
    return { datasourceId: ds.id, total: suggestions.length, suggestions }
  },

  async suggestionCount({ datasourceId } = {}) {
    const ds = this.requireDatasource(datasourceId)
    const list = await this.suggestKnowledge({ datasourceId: ds.id, limit: 500 })
    const byKind = { example: 0, metric: 0, note: 0, glossary: 0 }
    for (const s of list) byKind[s.kind]++
    return { datasourceId: ds.id, count: list.length, byKind }
  },

  /** Save a suggestion (optionally edited) to the knowledge base and stop suggesting it. */
  async acceptSuggestion({ datasourceId, id, item } = {}) {
    const ds = this.requireDatasource(datasourceId)
    const list = await this.suggestKnowledge({ datasourceId: ds.id, limit: 500 })
    const s = list.find(x => x.id === id)
    if (!s) throw new UserError('nl2sql/unknown-suggestion', '建议不存在或已处理，请刷新列表')
    const next = { ...s.item, ...(item && typeof item === 'object' ? item : {}) }
    delete next.id
    if (s.kind === 'example') {
      const dialect = ds.type ?? 'mysql'
      let admitted
      try { admitted = admitSql(String(next.sql ?? ''), { dialect }) } catch (error) { throw new UserError('nl2sql/invalid', `SQL 未通过只读检查：${error.message}`) }
      const policy = this.policyFor(ds)
      const denied = checkAccess(admitted.sql, policy, await this.analyzeSchema(ds.id), admitted.head, { dialect })
      if (denied) throw new UserError('nl2sql/access-denied', denied)
      next.sql = admitted.sql
    }
    const knowledge = await this.saveKnowledgeItem({ datasourceId: ds.id, kind: s.kind, item: next })
    await this.markSuggestion(ds.id, s.id)
    return { accepted: s.id, kind: s.kind, knowledge }
  },

  async dismissSuggestion({ datasourceId, id } = {}) {
    const ds = this.requireDatasource(datasourceId)
    if (typeof id !== 'string' || !/^sg-[0-9a-f]{10}$/.test(id)) throw new UserError('nl2sql/invalid', '无效的建议 ID')
    await this.markSuggestion(ds.id, id)
    return { dismissed: id }
  },

  /** Remember a handled (accepted or dismissed) suggestion id. */
  async markSuggestion(dsId, id) {
    this.state.suggestionDismissed ??= {}
    const list = (this.state.suggestionDismissed[dsId] ?? []).filter(x => x !== id)
    list.push(id)
    this.state.suggestionDismissed[dsId] = list.slice(-SUGGEST.dismissedMax)
    await this.save()
  },
}
