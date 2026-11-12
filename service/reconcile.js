/**
 * Cross-datasource comparison / reconciliation (对账 / 核对).
 *
 * Two read-only queries (any two data sources, or the same one twice) run
 * through runQuery — so admission, access policy, row-level rules, masking and
 * audit all apply — and both results (≤ 200k rows per side) are joined on key
 * columns in an in-memory SQLite database. The outcome: matched keys, keys only
 * on one side, value mismatches per compare column (numeric tolerance, absolute
 * or relative; string trim / case options), per-side totals, and detail tables
 * shaped like query results (columns / rows) so the page's ResultView, Excel
 * export and IM push can use them.
 *
 * Saved jobs live in state.reconciles; runs are recorded as 'reconcileRun'
 * records (summary + first 200 differences); a scheduler job runs due ones daily.
 */
import { DatabaseSync } from 'node:sqlite'
import { admitSql } from '../sql-guard.js'
import { UserError, fmtNum, lastDailySlot, newId, oneOf, requireText, upsert } from './shared.js'

/** Rows loaded per side. */
export const SIDE_ROW_CAP = 200000
/** Rows kept in each detail table (summary counts are always complete). */
export const DETAIL_LIMIT = 10000
/** Differences kept in a run record. */
export const RECORD_DIFFS = 200
const MAX_KEYS = 8
const MAX_COMPARE = 20

// ------------------------------------------------------------ value rules

const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/
const CANON_INT = /^-?(0|[1-9]\d*)(\.\d+)?$/
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/

/** A finite number for numbers / numeric strings, else undefined. */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const s = v.trim()
    if (s && NUMERIC.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : undefined }
  }
  return undefined
}

/** Date / datetime strings from different engines ("2026-01-01T00:00:00.000Z" vs "2026-01-01 00:00:00"). */
function normDate(s) {
  if (!DATE_LIKE.test(s)) return s
  return s.replace('T', ' ').replace(/(\.0+)?(Z|[+-]00:?00)?$/, '').replace(/ 00:00(:00)?$/, '')
}

function normText(v, { trim = true, ignoreCase = false } = {}) {
  let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (trim) s = s.trim()
  s = normDate(s)
  if (ignoreCase) s = s.toLowerCase()
  return s
}

/** Canonical key text: equal keys from MySQL / PostgreSQL / ES / files compare equal. */
export function normKey(v, opts = {}) {
  if (v === null || v === undefined) return '\u0000NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  const s = normText(v, opts)
  // "1.00" and 1 are the same key; codes with leading zeros ("007") and long ids stay text.
  if (CANON_INT.test(s) && s.length < 16) return String(Number(s))
  return s
}

/**
 * Are two values equal under a compare rule? Numbers (or numeric strings on
 * both sides) use the tolerance — absolute, or relative to the larger
 * magnitude — everything else compares as normalized text. NULL equals NULL only.
 */
export function valuesEqual(a, b, rule = {}, options = {}) {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an || bn) return an && bn
  const na = toNumber(a)
  const nb = toNumber(b)
  if (na !== undefined && nb !== undefined) {
    const diff = Math.abs(na - nb)
    const tol = Math.max(0, Number(rule.tolerance) || 0)
    const scale = Math.max(Math.abs(na), Math.abs(nb))
    const eps = 1e-9 * Math.max(1, scale) // float noise: 0.1 + 0.2 vs 0.3
    return rule.relative ? diff <= tol * scale + eps : diff <= tol + eps
  }
  return normText(a, options) === normText(b, options)
}

// ------------------------------------------------------------ spec

function mapping(list, what, max) {
  if (!Array.isArray(list)) return []
  if (list.length > max) throw new UserError('nl2sql/invalid', `${what}最多 ${max} 个`)
  return list.map((x) => {
    const item = typeof x === 'string' ? { left: x } : (x ?? {})
    const left = String(item.left ?? '').trim()
    const right = String(item.right ?? '').trim() || left
    if (!left) throw new UserError('nl2sql/invalid', `${what}需要填写左侧列名`)
    return { ...item, left, right }
  })
}

/** Validate the comparison part of a definition (keys, compare columns, options). */
export function normalizeSpec({ keys, compare, options } = {}) {
  const k = mapping(keys, '键列', MAX_KEYS).map(({ left, right }) => ({ left, right }))
  if (!k.length) throw new UserError('nl2sql/invalid', '至少需要一个键列（用于把两边的行对上）')
  const c = mapping(compare, '比较列', MAX_COMPARE).map(({ left, right, tolerance, relative }) => {
    const tol = tolerance === undefined || tolerance === null || tolerance === '' ? 0 : Number(tolerance)
    if (!Number.isFinite(tol) || tol < 0) throw new UserError('nl2sql/invalid', `比较列 ${left} 的容差必须是非负数`)
    return { left, right, tolerance: tol, relative: Boolean(relative) }
  })
  return { keys: k, compare: c, options: { trim: options?.trim !== false, ignoreCase: Boolean(options?.ignoreCase) } }
}

function columnIndex(result, name, side, what) {
  const exact = result.columns.findIndex(c => c.name === name)
  if (exact >= 0) return exact
  const ci = result.columns.findIndex(c => c.name.toLowerCase() === name.toLowerCase())
  if (ci >= 0) return ci
  throw new UserError('nl2sql/invalid', `${side}结果中没有${what}「${name}」。可用列：${result.columns.map(c => c.name).join('、')}`)
}

const labelOf = (m) => (m.left === m.right ? m.left : `${m.left}/${m.right}`)

// ------------------------------------------------------------ engine

/**
 * Compare two query results (pure; no service). `left` / `right` are results
 * ({ columns:[{name,kind,masked?}], rows, truncated? }); `spec` from normalizeSpec.
 * Returns { summary, tables: { summary, mismatches, onlyLeft, onlyRight }, diffs, warnings }.
 */
export function compareResults(left, right, spec, { leftName = '左侧', rightName = '右侧', detailLimit = DETAIL_LIMIT, recordDiffs = RECORD_DIFFS } = {}) {
  const { keys, compare, options } = spec
  const lk = keys.map(k => columnIndex(left, k.left, '左侧', '键列'))
  const rk = keys.map(k => columnIndex(right, k.right, '右侧', '键列'))
  const lc = compare.map(c => columnIndex(left, c.left, '左侧', '比较列'))
  const rc = compare.map(c => columnIndex(right, c.right, '右侧', '比较列'))
  const warnings = []
  for (const [res, idx, side] of [[left, lk, leftName], [right, rk, rightName]]) {
    const masked = idx.filter(i => res.columns[i].masked).map(i => res.columns[i].name)
    if (masked.length) warnings.push(`${side}的键列 ${masked.join('、')} 被脱敏，脱敏后的值可能无法正确匹配`)
    if (res.truncated) warnings.push(`${side}结果超过 ${(res.rows?.length ?? 0).toLocaleString('en-US')} 行被截断，只比较了已加载的行，对账结果不完整`)
  }
  const db = new DatabaseSync(':memory:')
  try {
    const kc = keys.map((_, i) => `k${i}`)
    const vc = compare.map((_, i) => `c${i}`)
    const dk = keys.map((_, i) => `d${i}`) // display key values (original)
    for (const t of ['L', 'R']) {
      db.exec(`CREATE TABLE ${t} (${[...kc.map(c => `${c} TEXT NOT NULL`), ...dk, ...vc, '_row INTEGER'].join(', ')}, PRIMARY KEY (${kc.join(', ')})) WITHOUT ROWID`)
    }
    const bindable = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? String(v) : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
    const load = (table, res, kIdx, cIdx) => {
      const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (${new Array(kc.length * 2 + vc.length + 1).fill('?').join(', ')})`)
      const totals = compare.map(() => ({ sum: 0, numeric: 0 }))
      let unique = 0
      let dups = 0
      db.exec('BEGIN')
      try {
        res.rows.forEach((row, n) => {
          const values = cIdx.map(i => bindable(row[i]))
          const r = stmt.run(...kIdx.map(i => normKey(row[i], options)), ...kIdx.map(i => bindable(row[i])), ...values, n)
          if (Number(r.changes) === 1) {
            unique++
            values.forEach((v, j) => { const x = toNumber(v); if (x !== undefined) { totals[j].sum += x; totals[j].numeric++ } })
          } else dups++
        })
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
      return { rows: res.rows.length, unique, duplicates: dups, totals }
    }
    const L = load('L', left, lk, lc)
    const R = load('R', right, rk, rc)
    if (L.duplicates) warnings.push(`${leftName}有 ${L.duplicates} 行键重复，重复行未参与比较（以第一行为准）`)
    if (R.duplicates) warnings.push(`${rightName}有 ${R.duplicates} 行键重复，重复行未参与比较（以第一行为准）`)
    db.function('n2s_ne', { deterministic: true }, (i, a, b) => (valuesEqual(a, b, compare[i], options) ? 0 : 1))
    const on = kc.map(c => `L.${c} = R.${c}`).join(' AND ')
    const ne = (i) => `n2s_ne(${i}, L.c${i}, R.c${i})`
    const agg = db.prepare(`SELECT COUNT(*) AS matched${compare.map((_, i) => `, COALESCE(SUM(${ne(i)}), 0) AS m${i}`).join('')}${compare.length ? `, COALESCE(SUM(${compare.map((_, i) => ne(i)).join(' OR ')}), 0) AS mm` : ', 0 AS mm'} FROM L JOIN R ON ${on}`).get()
    const matched = Number(agg.matched)
    const mismatchedRows = Number(agg.mm)
    const onlyLeft = L.unique - matched
    const onlyRight = R.unique - matched
    const union = matched + onlyLeft + onlyRight
    const columns = compare.map((c, i) => {
      const lt = L.totals[i]
      const rt = R.totals[i]
      const numeric = lt.numeric > 0 || rt.numeric > 0
      return {
        left: c.left, right: c.right, label: labelOf(c), tolerance: c.tolerance, relative: c.relative,
        mismatches: Number(agg[`m${i}`]),
        ...(numeric ? { leftTotal: round(lt.sum), rightTotal: round(rt.sum), diff: round(lt.sum - rt.sum) } : {}),
      }
    })
    const summary = {
      leftRows: L.rows, rightRows: R.rows, leftUnique: L.unique, rightUnique: R.unique,
      duplicates: { left: L.duplicates, right: R.duplicates },
      matched, onlyLeft, onlyRight, mismatchedRows,
      consistent: matched - mismatchedRows,
      keyMatchRate: union ? matched / union : 1,
      matchRate: union ? (matched - mismatchedRows) / union : 1,
      columns,
      truncated: { left: Boolean(left.truncated), right: Boolean(right.truncated) },
      complete: !left.truncated && !right.truncated,
    }
    // Totals follow from the row comparison (each matched row agrees within its tolerance).
    summary.hasDiff = onlyLeft > 0 || onlyRight > 0 || mismatchedRows > 0

    // ---- detail tables, shaped like query results
    const keyCols = keys.map((k, i) => ({ name: k.left, kind: left.columns[lk[i]].kind === 'number' ? 'number' : 'text' }))
    const numericCol = (i) => columns[i].leftTotal !== undefined
    const mmCols = [...keyCols]
    compare.forEach((c, i) => {
      mmCols.push({ name: `${labelOf(c)} [${leftName}]`, kind: numericCol(i) ? 'number' : 'text' }, { name: `${labelOf(c)} [${rightName}]`, kind: numericCol(i) ? 'number' : 'text' })
      if (numericCol(i)) mmCols.push({ name: `${labelOf(c)} 差值`, kind: 'number' })
    })
    mmCols.push({ name: '差异列', kind: 'text' })
    const mmRows = compare.length ? db.prepare(`SELECT ${[...dk.map(c => `L.${c}`), ...compare.flatMap((_, i) => [`L.c${i} AS l${i}`, `R.c${i} AS r${i}`, `${ne(i)} AS f${i}`])].join(', ')} FROM L JOIN R ON ${on} WHERE ${compare.map((_, i) => ne(i)).join(' OR ')} ORDER BY L._row LIMIT ${detailLimit + 1}`).all() : []
    const mismatchRows = mmRows.slice(0, detailLimit).map(r => {
      const out = dk.map(c => r[c])
      const bad = []
      compare.forEach((c, i) => {
        out.push(r[`l${i}`], r[`r${i}`])
        if (numericCol(i)) { const a = toNumber(r[`l${i}`]); const b = toNumber(r[`r${i}`]); out.push(a !== undefined && b !== undefined ? round(a - b) : null) }
        if (r[`f${i}`]) bad.push(labelOf(c))
      })
      out.push(bad.join('、'))
      return out
    })
    const sideTable = (from, other, res, cIdx) => {
      const cols = [...keyCols, ...compare.map((c, i) => ({ name: from === 'L' ? c.left : c.right, kind: numericCol(i) ? 'number' : (res.columns[cIdx[i]].kind === 'time' ? 'time' : 'text') }))]
      const rows = db.prepare(`SELECT ${[...dk, ...vc].join(', ')} FROM ${from} WHERE NOT EXISTS (SELECT 1 FROM ${other} WHERE ${kc.map(c => `${other}.${c} = ${from}.${c}`).join(' AND ')}) ORDER BY _row LIMIT ${detailLimit + 1}`).all()
      return { columns: cols, rows: rows.slice(0, detailLimit).map(r => [...dk, ...vc].map(c => r[c])), more: rows.length > detailLimit }
    }
    const ol = sideTable('L', 'R', left, lc)
    const or = sideTable('R', 'L', right, rc)
    const sumCols = [{ name: '项目', kind: 'text' }, { name: leftName, kind: 'number' }, { name: rightName, kind: 'number' }, { name: '差值', kind: 'number' }]
    const sumRows = [
      ['行数', L.rows, R.rows, L.rows - R.rows],
      ['匹配的键', matched, matched, 0],
      ['仅一侧存在', onlyLeft, onlyRight, onlyLeft - onlyRight],
      ...(compare.length ? [['值不一致的行', mismatchedRows, mismatchedRows, 0]] : []),
      ...columns.filter(c => c.leftTotal !== undefined).map(c => [`合计 ${c.label}`, c.leftTotal, c.rightTotal, c.diff]),
    ]
    const table = (columns, rows, more) => ({ columns, rows, rowCount: rows.length, truncated: Boolean(more) })
    const tables = {
      summary: table(sumCols, sumRows, false),
      mismatches: table(mmCols, mismatchRows, mmRows.length > detailLimit),
      onlyLeft: table(ol.columns, ol.rows, ol.more),
      onlyRight: table(or.columns, or.rows, or.more),
    }
    // First differences for the run record (compact objects).
    const keyObj = (row) => Object.fromEntries(keys.map((k, i) => [k.left, row[i]]))
    const diffs = []
    for (const row of mismatchRows) {
      if (diffs.length >= recordDiffs) break
      let p = keys.length
      const values = {}
      compare.forEach((c, i) => { values[labelOf(c)] = { left: row[p], right: row[p + 1] }; p += numericCol(i) ? 3 : 2 })
      diffs.push({ type: 'mismatch', key: keyObj(row), columns: row[row.length - 1], values })
    }
    for (const [type, t] of [['onlyLeft', ol], ['onlyRight', or]]) {
      for (const row of t.rows) {
        if (diffs.length >= recordDiffs) break
        diffs.push({ type, key: keyObj(row), values: Object.fromEntries(compare.map((c, i) => [labelOf(c), row[keys.length + i]])) })
      }
    }
    return { summary, tables, diffs, warnings }
  } finally {
    db.close()
  }
}

function round(n) {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : n
}

const pct = (r) => `${(r * 100).toFixed(r === 1 || r === 0 ? 0 : 2)}%`

/** Markdown summary for IM pushes and the agent. */
export function summaryMarkdown(run) {
  if (run.error) return `**对账失败**：${run.error}`
  const s = run.summary
  const lines = []
  lines.push(s.hasDiff ? `**发现差异** · 一致率 **${pct(s.matchRate)}**` : `<font color='green'>**两边一致**</font> · 一致率 **${pct(s.matchRate)}**`)
  lines.push('')
  lines.push(`- 左侧 **${run.left.datasourceName}**：${s.leftRows.toLocaleString('en-US')} 行${s.truncated.left ? '（已截断）' : ''}`)
  lines.push(`- 右侧 **${run.right.datasourceName}**：${s.rightRows.toLocaleString('en-US')} 行${s.truncated.right ? '（已截断）' : ''}`)
  lines.push(`- 匹配的键 ${s.matched.toLocaleString('en-US')}，仅左侧 ${s.onlyLeft > 0 ? `<font color='red'>${s.onlyLeft}</font>` : 0}，仅右侧 ${s.onlyRight > 0 ? `<font color='red'>${s.onlyRight}</font>` : 0}${s.columns.length ? `，值不一致 ${s.mismatchedRows > 0 ? `<font color='red'>${s.mismatchedRows}</font>` : 0} 行` : ''}`)
  const withTotals = s.columns.filter(c => c.leftTotal !== undefined)
  if (s.columns.length) {
    lines.push('')
    lines.push(`| 比较列 | 不一致行 |${withTotals.length ? ' 左侧合计 | 右侧合计 | 差值 |' : ''}`)
    lines.push(`|---|---|${withTotals.length ? '---|---|---|' : ''}`)
    for (const c of s.columns) lines.push(`| ${c.label}${c.tolerance ? `（容差 ${c.relative ? `${c.tolerance * 100}%` : c.tolerance}）` : ''} | ${c.mismatches} |${withTotals.length ? (c.leftTotal !== undefined ? ` ${fmtNum(c.leftTotal)} | ${fmtNum(c.rightTotal)} | ${fmtNum(c.diff)} |` : ' — | — | — |') : ''}`)
  }
  if (run.warnings?.length) { lines.push(''); for (const w of run.warnings) lines.push(`> ⚠️ ${w}`) }
  return lines.join('\n')
}

// ------------------------------------------------------------ service methods

const RUNTIME = ['lastRun', 'lastScheduledAt']

export const methods = {
  /**
   * Run one reconciliation: both queries via runQuery (actor-aware), compare,
   * and remember the detail tables as results (ResultView / export / push).
   */
  async reconcile({ left, right, keys, compare, options, title, actor, sessionId, source = 'reconcile' }) {
    const spec = normalizeSpec({ keys, compare, options })
    actor ??= this.actorFor(sessionId)
    if (!left?.sql || !right?.sql) throw new UserError('nl2sql/invalid', '两侧都需要填写 SQL')
    const lds = this.datasourceForSession(sessionId, left.datasourceId ?? left.datasource)
    const rds = this.datasourceForSession(sessionId, right.datasourceId ?? right.datasource)
    this.assertAccess(actor, lds)
    this.assertAccess(actor, rds)
    const name = String(title ?? '').trim().slice(0, 80) || `${lds.name} ↔ ${rds.name}`
    const started = Date.now()
    const run = async (ds, sql, side) => {
      try {
        return await this.runQuery({ sql, datasourceId: ds.id, sessionId, actor, title: `对账 · ${name} · ${side}`, source, confirmScan: true, maxRows: SIDE_ROW_CAP, chart: { type: 'table' } })
      } catch (error) {
        throw new UserError(error.code ?? 'nl2sql/error', `${side}（${ds.name}）查询失败：${error.message}`)
      }
    }
    const [lr, rr] = await Promise.all([run(lds, left.sql, '左侧'), run(rds, right.sql, '右侧')])
    const sameName = lds.name === rds.name
    const leftName = sameName ? '左侧' : lds.name
    const rightName = sameName ? '右侧' : rds.name
    const cmp = compareResults(lr, rr, spec, { leftName, rightName })
    const base = { datasourceId: lds.id, datasourceName: `${lds.name} ↔ ${rds.name}`, sql: `-- 左侧（${lds.name}）\n${lr.sql}\n\n-- 右侧（${rds.name}）\n${rr.sql}`, elapsedMs: Date.now() - started, chart: { type: 'table' }, reconcile: true }
    const make = (key, label) => {
      const t = cmp.tables[key]
      const r = { ...base, resultId: newId('r'), title: `${name} · ${label}`, columns: t.columns, rows: t.rows, rowCount: t.rowCount, truncated: t.truncated, suggestedChart: { type: 'table' }, createdAt: Date.now(), reconcilePart: key }
      this.remember(r)
      return r
    }
    const results = [
      make('summary', '汇总'),
      make('mismatches', '值不一致'),
      make('onlyLeft', `仅${leftName}`),
      make('onlyRight', `仅${rightName}`),
    ]
    const out = {
      title: name,
      at: started,
      elapsedMs: Date.now() - started,
      left: { datasourceId: lds.id, datasourceName: lds.name, resultId: lr.resultId, rows: lr.rowCount, truncated: lr.truncated, label: leftName },
      right: { datasourceId: rds.id, datasourceName: rds.name, resultId: rr.resultId, rows: rr.rowCount, truncated: rr.truncated, label: rightName },
      keys: spec.keys,
      compare: spec.compare,
      options: spec.options,
      summary: cmp.summary,
      warnings: cmp.warnings,
      diffs: cmp.diffs,
      results,
    }
    out.markdown = summaryMarkdown(out)
    return out
  },

  // ---------------------------------------------------- saved jobs

  listReconciles() {
    return (this.state.reconciles ?? []).map(r => ({
      ...r,
      leftName: this.findDatasource(r.left?.datasourceId)?.name ?? r.left?.datasourceId,
      rightName: this.findDatasource(r.right?.datasourceId)?.name ?? r.right?.datasourceId,
      channelName: r.channelId ? (this.state.channels.find(c => c.id === r.channelId)?.name ?? null) : null,
    }))
  },

  /** Validate a definition (shared by save and dry run). */
  normalizeReconcile(input = {}, { allowNew = true } = {}) {
    const existing = input.id ? (this.state.reconciles ?? []).find(r => r.id === input.id) : undefined
    if (input.id && !existing && !allowNew) throw new UserError('nl2sql/invalid', '对账任务不存在')
    const r = existing ? structuredClone(existing) : { id: newId('rc'), createdAt: Date.now() }
    r.name = requireText(input.name ?? r.name, 'name', 80)
    const side = (inp, cur, label) => {
      const ds = this.requireDatasource(inp?.datasourceId ?? inp?.datasource ?? cur?.datasourceId)
      const sql = requireText(inp?.sql ?? cur?.sql, `${label} SQL`, 20000)
      admitSql(sql, { dialect: ds.type ?? 'mysql' })
      return { datasourceId: ds.id, sql }
    }
    r.left = side(input.left, r.left, '左侧')
    r.right = side(input.right, r.right, '右侧')
    const spec = normalizeSpec({ keys: input.keys ?? r.keys, compare: input.compare ?? r.compare, options: input.options ?? r.options })
    Object.assign(r, spec)
    const sch = { ...(r.schedule ?? {}), ...(input.schedule ?? {}) }
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(sch.time ?? '')) ? sch.time : '09:00'
    r.schedule = { time, enabled: Boolean(sch.enabled) }
    if (input.channelId !== undefined) r.channelId = input.channelId && this.state.channels.some(c => c.id === input.channelId) ? input.channelId : null
    r.channelId ??= null
    r.notifyOn = oneOf(input.notifyOn ?? r.notifyOn ?? 'diff', ['diff', 'always'], 'notifyOn')
    r.updatedAt = Date.now()
    return r
  },

  async saveReconcile(input) {
    const r = this.normalizeReconcile(input, { allowNew: false })
    const current = (this.state.reconciles ?? []).find(x => x.id === r.id)
    // Runtime fields come from the stored object (a run may have finished meanwhile).
    if (current) for (const k of RUNTIME) { if (current[k] === undefined) delete r[k]; else r[k] = current[k] }
    // New or rescheduled: the schedule starts counting from now (no immediate catch-up run).
    if (!current || current.schedule?.time !== r.schedule.time || (!current.schedule?.enabled && r.schedule.enabled)) r.lastScheduledAt = Date.now()
    this.state.reconciles = upsert(this.state.reconciles ?? [], r)
    await this.save()
    return r
  },

  async deleteReconcile(id) {
    this.state.reconciles = (this.state.reconciles ?? []).filter(r => r.id !== id)
    await this.save()
    return { deleted: id }
  },

  /**
   * Run a saved job ({ id }) — recorded, pushed per notifyOn unless dryRun /
   * push:false — or dry-run an unsaved definition ({ definition }).
   */
  async runReconcile({ id, definition, dryRun = false, push = true, source = 'ui' } = {}) {
    if (!id) {
      const draft = this.normalizeReconcile({ ...(definition ?? {}), id: undefined, name: definition?.name || '试运行' })
      return this.reconcile({ ...draft, title: draft.name, source: 'reconcile' })
    }
    const job = (this.state.reconciles ?? []).find(r => r.id === id)
    if (!job) throw new UserError('nl2sql/invalid', '对账任务不存在')
    if (dryRun) return this.reconcile({ ...job, title: job.name, source: 'reconcile' })
    return this.withJobLock(`job:reconcile:${id}`, () => this.runSavedReconcile(job, { push, source }))
  },

  async runSavedReconcile(job, { push = true, source = 'ui' } = {}) {
    const runId = newId('rr')
    let out
    let error
    try { out = await this.reconcile({ ...job, title: job.name, source: 'reconcile' }) } catch (e) { error = e }
    const rec = {
      id: runId, reconcileId: job.id, name: job.name, at: Date.now(), source,
      status: error ? 'error' : out.summary.hasDiff ? 'diff' : 'ok',
      ...(error ? { error: String(error.message).slice(0, 500) } : {
        elapsedMs: out.elapsedMs, left: out.left, right: out.right, summary: out.summary, warnings: out.warnings,
        diffs: out.diffs.slice(0, RECORD_DIFFS), resultIds: out.results.map(r => r.resultId),
      }),
    }
    let pushed = false
    if (push && job.channelId && (error || rec.status === 'diff' || job.notifyOn === 'always')) {
      try {
        const title = error ? `❌ 对账失败：${job.name}` : rec.status === 'diff' ? `⚠️ 对账差异：${job.name}` : `✅ 对账一致：${job.name}`
        const results = error ? [] : out.results.filter((r, i) => i === 0 || r.rows.length > 0)
        await this.sendToChannel({ channelId: job.channelId, title, text: error ? `**对账失败**：${error.message}` : out.markdown, results, source: 'reconcile', template: error || rec.status === 'diff' ? 'red' : 'green' })
        pushed = true
      } catch (e) { rec.pushError = String(e.message).slice(0, 300) }
    }
    rec.pushed = pushed
    this.records.put('reconcileRun', rec)
    const cur = (this.state.reconciles ?? []).find(r => r.id === job.id)
    if (cur) cur.lastRun = { at: rec.at, runId, status: rec.status, ...(error ? { error: rec.error } : { matchRate: out.summary.matchRate, matched: out.summary.matched, onlyLeft: out.summary.onlyLeft, onlyRight: out.summary.onlyRight, mismatchedRows: out.summary.mismatchedRows, complete: out.summary.complete }), pushed }
    await this.save()
    if (error) return { ...rec, ok: false }
    return { ...out, runId, status: rec.status, pushed, ...(rec.pushError ? { pushError: rec.pushError } : {}) }
  },

  reconcileRuns({ id, limit = 50 } = {}) {
    return this.records.list('reconcileRun', { ref: id, limit: Math.min(Math.max(Number(limit) || 50, 1), 500) })
  },

  /** Scheduler: each enabled job runs once per daily slot (catches up once after downtime). */
  jobs_reconcile(now) {
    return (this.state.reconciles ?? []).filter(r => r.schedule?.enabled).map(r => ({
      id: `reconcile:${r.id}`,
      due: (at) => (r.lastScheduledAt ?? r.createdAt ?? 0) < lastDailySlot(r.schedule.time, at ?? now),
      run: async () => {
        const cur = (this.state.reconciles ?? []).find(x => x.id === r.id)
        if (!cur) return
        cur.lastScheduledAt = Date.now()
        await this.runSavedReconcile(cur, { push: true, source: 'schedule' })
      },
    }))
  },
}

// ------------------------------------------------------------ agent tool

const SIDE_PARAM = (helpers, label) => ({
  type: 'object',
  description: `${label} query.`,
  properties: {
    datasource: { ...helpers.DATASOURCE_PARAM, description: 'Data source id or name for this side. Omit to use the one bound to this session.' },
    sql: { type: 'string', description: 'One read-only SQL statement in that data source\'s dialect. Return the key columns and the columns to compare; aggregate to the reconciliation grain (e.g. per day / per order) rather than raw rows when possible.' },
  },
  required: ['sql'],
  additionalProperties: false,
})

function registerTool(ctx, service, helpers) {
  const { displayMeta, textBlock } = helpers
  ctx.tools.register({
    name: 'nl2sql_reconcile',
    description: 'Reconcile / compare two query results (对账 / 核对 / 对比) — typically the same business numbers from two different data sources, or two queries on one source. Runs both read-only queries, joins their rows on key columns, and reports matched keys, keys only in one side, value mismatches per compare column (with optional numeric tolerance) and per-side totals. The user sees a summary and the difference tables; you receive the summary plus the first differences.',
    parameters: {
      type: 'object',
      properties: {
        left: SIDE_PARAM(helpers, 'Left (reference) side'),
        right: SIDE_PARAM(helpers, 'Right side'),
        keys: { type: 'array', description: 'Key columns that identify a row on both sides (e.g. order id, or day + channel). right defaults to left when the names are the same.', items: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' } }, required: ['left'], additionalProperties: false } },
        compare: { type: 'array', description: 'Columns whose values must agree. tolerance: allowed absolute numeric difference (or a fraction like 0.001 when relative=true).', items: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' }, tolerance: { type: 'number' }, relative: { type: 'boolean' } }, required: ['left'], additionalProperties: false } },
        options: { type: 'object', properties: { trim: { type: 'boolean', description: 'Trim spaces before comparing text (default true).' }, ignoreCase: { type: 'boolean', description: 'Case-insensitive text comparison (default false).' } }, additionalProperties: false },
        title: { type: 'string', description: 'Short title in the user\'s language.' },
      },
      required: ['left', 'right', 'keys'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value.model, null, 1)),
      presentationMeta: (_args, value) => value.display,
    },
    timeoutMs: 660000,
    presentCall: (args) => ({ card: 'generic', title: args?.title ? `对账：${args.title}` : '对账 / 对比两份数据', kind: 'read' }),
    execute: async (args, exec) => {
      try {
        const sessionId = exec.agent?.id
        const actor = service.actorFor(sessionId)
        service.assertCanWriteSql(actor, '自由编写对账 SQL')
        const out = await service.reconcile({
          left: { datasourceId: args.left?.datasource, sql: args.left?.sql },
          right: { datasourceId: args.right?.datasource, sql: args.right?.sql },
          keys: args.keys, compare: args.compare ?? [], options: args.options, title: args.title, actor, sessionId, source: 'agent',
        })
        // Detail rows reach the model only when both data sources allow rows.
        const privacy = [out.left.datasourceId, out.right.datasourceId].map(id => service.settingsFor(service.findDatasource(id)).resultToModel)
        const rows = privacy.every(p => p === 'rows')
        const model = {
          title: out.title,
          left: out.left, right: out.right,
          summary: { ...out.summary, matchRate: Number(out.summary.matchRate.toFixed(4)), keyMatchRate: Number(out.summary.keyMatchRate.toFixed(4)) },
          warnings: out.warnings,
          resultIds: Object.fromEntries(out.results.map(r => [r.reconcilePart, r.resultId])),
          ...(rows ? { firstDiffs: out.diffs.slice(0, 20) } : { firstDiffs: `hidden by privacy settings (${privacy.join('/')}); ${out.diffs.length} differences shown to the user` }),
        }
        const display = JSON.parse(JSON.stringify({ reconcile: true, title: out.title, left: out.left, right: out.right, summary: out.summary, warnings: out.warnings, results: out.results.map(r => displayMeta(r)) }))
        return { model, display }
      } catch (error) {
        throw error instanceof UserError ? new Error(error.message) : error
      }
    },
  })
}

export const FEATURE = {
  name: 'reconcile',
  methods,
  rpc: (service) => ({
    listReconciles: () => service.listReconciles(),
    saveReconcile: (p) => service.saveReconcile(p ?? {}),
    deleteReconcile: (p) => service.deleteReconcile(p?.id),
    runReconcile: (p) => service.runReconcile({ id: p?.id, definition: p?.definition, dryRun: Boolean(p?.dryRun), push: p?.push !== false, source: 'ui' }),
    reconcileRuns: (p) => service.reconcileRuns(p ?? {}),
  }),
  tools: (ctx, service, helpers) => registerTool(ctx, service, helpers),
}
