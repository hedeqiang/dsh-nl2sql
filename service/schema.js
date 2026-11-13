/**
 * Nl2SqlService methods: schema.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { DIALECTS } from '../drivers.js'
import { annotateSchema, columnMasked, filterSchema, normalizePolicy, policyActive } from '../policy.js'
import { admitSql } from '../sql-guard.js'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DIALECT_HINTS, SENSITIVE_RULES_VERSION, UserError, classifyColumn, classifyTable, inferRelations, maskValue, newId, requireText, singular, upsert } from './shared.js'

/** Glossary terms / metrics inlined in the schema overview before it switches to the ones relevant to the question. */
export const KNOWLEDGE_INLINE = 30
/**
 * Characters of table detail in one nl2sql_schema call. The agent preset trims tool results
 * above 16384 characters to head + tail, which would silently drop columns in the middle.
 */
export const SCHEMA_DETAIL_MAX = 12000

/** Character bigrams (whitespace removed, works for Chinese) plus ASCII words of 3+ characters. */
export function textGrams(text) {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, '')
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  for (const w of String(text ?? '').toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []) out.add(w)
  return out
}

/**
 * Re-apply the current sensitive-column rules to a cached schema (rules change between
 * versions, e.g. a bare `token` currency column is no longer sensitive). Only the
 * 'sensitive' role is touched; other roles stay as analysed.
 */
export function reclassifySensitive(schema) {
  if (!schema?.tables || schema.sensitiveRules === SENSITIVE_RULES_VERSION) return schema
  for (const t of schema.tables) for (const c of t.columns ?? []) {
    const want = classifyColumn(c, t).includes('sensitive')
    const has = (c.roles ?? []).includes('sensitive')
    if (want && !has) c.roles = [...(c.roles ?? []), 'sensitive']
    if (!want && has) c.roles = c.roles.filter(r => r !== 'sensitive')
  }
  schema.sensitiveRules = SENSITIVE_RULES_VERSION
  return schema
}

export const methods = {
  // --------------------------------------------------------------- schema

  /**
   * Analyze the schema. `tables` (names) re-analyzes only those tables: their columns, indexes,
   * row estimates and value samples are refreshed; every other table keeps its previous
   * analysis (and samples). Tables that no longer exist are dropped; new tables can be named.
   * Relations and table roles are recomputed over the merged schema. Needs a previous analysis.
   */
  async analyzeSchema(id, { refresh = false, tables: only } = {}) {
    const ds = this.requireDatasource(id)
    const partial = Array.isArray(only) && only.length > 0
    const previousForPartial = partial ? (this.schemas.get(ds.id) ?? await this.readSchemaFile(ds.id)) : null
    if (partial && !previousForPartial) throw new UserError('nl2sql/invalid', '还没有分析过表结构，请先完整分析一次。')
    if (!refresh && !partial) {
      const cached = this.schemas.get(ds.id) ?? await this.readSchemaFile(ds.id)
      if (cached) {
        this.schemas.set(ds.id, cached)
        return cached
      }
    }
    const settings = this.settingsFor(ds)
    const raw = await this.withDriver(ds, d => d.introspect(Math.max(settings.timeoutMs, 30000)))
    const pick = partial ? new Set(only.map(String)) : null
    if (partial) {
      const known = new Set(raw.tables.map(t => t.name))
      const missing = [...pick].filter(n => !known.has(n) && !previousForPartial.tables.some(t => t.name === n))
      if (missing.length) throw new UserError('nl2sql/invalid', `找不到这些表：${missing.join('、')}`)
    }
    const tables = raw.tables.map(t => ({ ...t, columns: [], indexes: [] }))
    const byName = new Map(tables.map(t => [t.name, t]))
    for (const c of raw.columns) {
      const table = byName.get(c.table)
      if (!table) continue
      const { table: _t, ...col } = c
      col.roles = classifyColumn(col, table)
      table.columns.push(col)
    }
    const indexMap = new Map()
    for (const i of raw.indexes) {
      const k = `${i.table}\u0000${i.name}`
      if (!indexMap.has(k)) indexMap.set(k, { table: i.table, name: i.name, unique: i.unique, columns: [] })
      indexMap.get(k).columns.push(i.column)
    }
    for (const idx of indexMap.values()) byName.get(idx.table)?.indexes.push({ name: idx.name, unique: idx.unique, columns: idx.columns })
    if (partial) {
      // Keep the previous analysis of every table not picked (still existing ones only).
      const prevByName = new Map(previousForPartial.tables.map(t => [t.name, t]))
      for (let i = 0; i < tables.length; i++) {
        if (pick.has(tables[i].name)) continue
        const prev = prevByName.get(tables[i].name)
        if (prev) { tables[i] = structuredClone(prev); byName.set(prev.name, tables[i]) }
      }
    }
    const fkRows = raw.foreignKeys
    const versionRows = [{ version: raw.version }]
    const declared = fkRows.map(r => ({ ...r, kind: 'declared', confidence: 1 }))
    const relations = [...declared, ...inferRelations(tables, declared)]
    for (const t of tables) t.role = classifyTable(t, relations)

    // Enum value sampling, bounded and opt-out through settings.
    if (settings.sampleMode !== 'off') {
      const jobs = []
      for (const t of tables) {
        if (partial && !pick.has(t.name)) continue
        if (t.type === 'VIEW' || (t.rows ?? 0) > 2_000_000) continue
        for (const c of t.columns) {
          const cheapText = ds.type === 'sqlite' && c.roles.includes('text') && (t.rows ?? 0) <= 200000
          if ((!c.roles.includes('enum') && !cheapText) || c.roles.includes('sensitive')) continue
          jobs.push({ t, c })
        }
      }
      const driver = await this.driver(ds)
      for (const { t, c } of jobs.slice(0, 80)) {
        try {
          const rows = await driver.sampleColumn(t.name, c.name)
          c.distinct = rows.length > 12 ? '>12' : rows.length
          c.values = rows.slice(0, 12)
        } catch {}
      }
    }
    const schema = {
      ...(partial ? { partialAt: Date.now(), partialTables: [...pick].slice(0, 50), fullAnalyzedAt: previousForPartial.fullAnalyzedAt ?? previousForPartial.analyzedAt } : { fullAnalyzedAt: Date.now() }),
      datasourceId: ds.id,
      dialect: ds.type ?? 'mysql',
      database: ds.database,
      version: versionRows[0]?.version ?? null,
      analyzedAt: Date.now(),
      tables,
      relations,
    }
    const previous = this.schemas.get(ds.id) ?? await this.readSchemaFile(ds.id)
    if (previous && settings.schemaWatch !== false) {
      try { this.recordSchemaChange(ds, previous, schema) } catch (error) { console.warn('nl2sql: schema diff failed: %s', error.message) }
    }
    schema.sensitiveRules = SENSITIVE_RULES_VERSION
    this.schemas.set(ds.id, schema)
    ds.schemaAnalyzedAt = schema.analyzedAt
    if (raw.version && !ds.serverVersion) ds.serverVersion = raw.version
    await writeFile(join(this.dir, `schema-${ds.id}.json`), JSON.stringify(schema), { mode: 0o600 })
    await this.save()
    return schema
  },

  async readSchemaFile(id) {
    try {
      return reclassifySensitive(JSON.parse(await readFile(join(this.dir, `schema-${id}.json`), 'utf8')))
    } catch {
      return undefined
    }
  },

  policyFor(ds) {
    return normalizePolicy(ds?.policy ?? null)
  },

  /** Schema restricted to what the access policy exposes (model, tools, knowledge drafts). */
  async visibleSchema(ds, opts) {
    return filterSchema(await this.analyzeSchema(ds.id, opts), this.policyFor(ds))
  },

  /** Full schema annotated with policy flags (page only). */
  async annotatedSchema(id, opts) {
    const ds = this.requireDatasource(id)
    return annotateSchema(await this.analyzeSchema(ds.id, opts), this.policyFor(ds))
  },

  /**
   * Rank tables by relevance to a question: character-bigram / word overlap
   * with the table name, comment, note, columns, plus glossary / metric /
   * verified-example knowledge that references the table, plus a prior for
   * fact tables and large tables. Returns [{ table, score }] best first.
   */
  rankTables(schema, ds, question) {
    // Ranking uses non-ASCII bigrams and whole ASCII words (singular), so short Latin fragments don't match everything.
    const grams = (text) => {
      const out = new Set()
      for (const x of textGrams(text)) if (x.length > 2 || /[^\x00-\x7f]/.test(x)) out.add(x.length > 3 ? singular(x) : x)
      return out
    }
    const q = grams(question)
    const k = this.knowledgeFor(ds.id)
    const cover = (grams) => {
      if (!q.size) return 0
      let hit = 0
      for (const x of q) if (grams.has(x)) hit++
      return hit / q.size
    }
    const mentions = (text, t) => {
      const short = t.name.split('.').pop().toLowerCase()
      return new RegExp(`(^|[^\\w])${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(String(text ?? '').toLowerCase())
    }
    const found = question ? this.searchKnowledge(ds.id, question, 20) : { examples: [], glossary: [], metrics: [] }
    const prior = { fact: 0.15, dimension: 0.08, view: 0.04, other: 0, log: -0.05, config: -0.05 }
    return schema.tables.map(t => {
      const label = `${t.name.replace(/[_.]+/g, ' ')} ${t.comment ?? ''} ${k.notes[t.name] ?? ''}`
      const cols = t.columns.map(c => `${c.name.replace(/_+/g, ' ')} ${c.comment ?? ''} ${k.notes[`${t.name}.${c.name}`] ?? ''}`).join(' ')
      let score = 2 * cover(grams(label)) + 0.7 * cover(grams(cols))
      for (const m of found.metrics) if (m.table && (m.table === t.name || mentions(m.table, t))) score += 1.5 * m.score + 0.3
      for (const g of found.glossary) if (mentions(`${g.sql} ${g.definition}`, t)) score += g.score + 0.2
      for (const e of found.examples) if (mentions(e.sql, t)) score += e.score + 0.2
      score += prior[t.role] ?? 0
      score += 0.05 * Math.min(1, Math.log10((t.rows ?? 0) + 1) / 8)
      return { table: t, score }
    }).sort((a, b) => b.score - a.score || (b.table.rows ?? 0) - (a.table.rows ?? 0))
  },

  /** Compact schema text for the model, honoring the sampling setting. */
  schemaForModel(schema, ds, tableNames, { question } = {}) {
    const settings = this.settingsFor(ds)
    const lines = []
    if (!tableNames || tableNames.length === 0) {
      const dialect = DIALECTS[ds.type ?? 'mysql']
      lines.push(`${ds.type === 'elasticsearch' ? 'index pattern' : 'database'}: ${schema.database} (${dialect.label} ${schema.version ?? '?'}; write SQL in the ${dialect.sqlName} dialect), ${schema.tables.length} ${ds.type === 'elasticsearch' ? 'indices' : 'tables'}, analyzed ${new Date(schema.analyzedAt).toISOString()}`)
      lines.push(DIALECT_HINTS[ds.type ?? 'mysql'])
      if (policyActive(this.policyFor(ds))) lines.push('access control: only the tables and columns listed here may be queried; hidden columns are omitted and system catalogs are blocked. Do not try to work around it.')
      const max = settings.schemaOverviewMax ?? 80
      const large = schema.tables.length > max
      let detailed = schema.tables
      if (large) {
        const top = Math.max(1, settings.schemaOverviewTop ?? 15)
        const ranked = this.rankTables(schema, ds, question)
        detailed = ranked.slice(0, top).map(r => r.table)
        lines.push(`large schema (${schema.tables.length} tables > ${max}): every table is listed by name only; ${detailed.length} tables ${question ? 'most relevant to the question' : 'ranked by role and size (pass `question` for relevance)'} are described in full below. Call nl2sql_schema with \`tables\` to read any other table before using it.`)
        lines.push('all tables (table | role | ~rows):')
        for (const t of schema.tables) lines.push(`${t.name} | ${t.role} | ${t.rows ?? '?'}`)
        lines.push(`most relevant tables${question ? ` for: ${String(question).slice(0, 200)}` : ''}:`)
      }
      lines.push('table | role | ~rows | comment | columns(name:type[roles])')
      for (const t of detailed) {
        const cols = t.columns.map(c => `${c.name}:${c.dataType}${c.roles.length ? `[${c.roles.join(',')}]` : ''}`).join(', ')
        const tnote = this.knowledgeFor(ds.id).notes[t.name]
        lines.push(`${t.name} | ${t.role} | ${t.rows ?? '?'} | ${[t.comment, tnote].filter(Boolean).join('; ') || '-'} | ${cols}`)
      }
      const shown = new Set(detailed.map(t => t.name))
      const rels = large ? schema.relations.filter(r => shown.has(r.from.table) || shown.has(r.to.table)) : schema.relations
      if (rels.length) {
        lines.push('relations (from -> to, kind, confidence):')
        for (const r of rels) lines.push(`${r.from.table}.${r.from.column} -> ${r.to.table}.${r.to.column} (${r.kind}, ${r.confidence})`)
      }
      const k = this.knowledgeFor(ds.id)
      if (ds.description) lines.push(`business context: ${ds.description}`)
      // A large knowledge base is not inlined whole: the entries most relevant to the question, then the rest by name.
      const found = question && (k.glossary.length > KNOWLEDGE_INLINE || k.metrics.length > KNOWLEDGE_INLINE) ? this.searchKnowledge(ds.id, question, KNOWLEDGE_INLINE) : null
      const pickInline = (list, relevant) => {
        if (list.length <= KNOWLEDGE_INLINE) return { inline: list, rest: [] }
        const ids = new Set((relevant ?? []).map(x => x.id))
        const inline = relevant ? list.filter(x => ids.has(x.id)) : list.slice(0, KNOWLEDGE_INLINE)
        const kept = new Set(inline.map(x => x.id))
        return { inline, rest: list.filter(x => !kept.has(x.id)) }
      }
      const gl = pickInline(k.glossary, found?.glossary)
      if (k.glossary.length) {
        lines.push(`glossary (business term => meaning / SQL hint)${gl.rest.length ? `, ${gl.inline.length} of ${k.glossary.length} ${found ? 'most relevant to the question' : 'shown'}` : ''}:`)
        for (const g of gl.inline) lines.push(`- ${g.term}${g.synonyms?.length ? ` (${g.synonyms.join('/')})` : ''} => ${g.definition}${g.sql ? ` [SQL: ${g.sql}]` : ''}`)
        if (gl.rest.length) lines.push(`other terms (call nl2sql_knowledge action=search for their definitions): ${gl.rest.map(g => g.term).join(', ')}`)
      }
      const mt = pickInline(k.metrics, found?.metrics)
      if (k.metrics.length) {
        lines.push(`metrics (use these definitions exactly when the user asks for them)${mt.rest.length ? `, ${mt.inline.length} of ${k.metrics.length} ${found ? 'most relevant to the question' : 'shown'}` : ''}:`)
        for (const m of mt.inline) lines.push(`- ${m.name}${m.unit ? ` (${m.unit})` : ''}: ${m.expression}${m.table ? ` FROM ${m.table}` : ''}${m.filter ? ` WHERE ${m.filter}` : ''}${m.timeColumn ? `; time column ${m.timeColumn}` : ''}${m.description ? ` — ${m.description}` : ''}`)
        if (mt.rest.length) lines.push(`other metrics (query them by name with nl2sql_metric): ${mt.rest.map(m => m.name).join(', ')}`)
      }
      if (k.examples.length) lines.push(`${k.examples.length} verified question→SQL examples exist; call nl2sql_knowledge action=search with the user's question to reuse them.`)
      lines.push('Call nl2sql_schema with `tables` for full column comments, indexes and enum values.')
      return lines.join('\n')
    }
    const notes = this.knowledgeFor(ds.id).notes
    const wanted = new Set(tableNames.map(n => n.toLowerCase()))
    const missing = tableNames.filter(n => !schema.tables.some(t => t.name.toLowerCase() === n.toLowerCase()))
    // Stay below the size at which tool results get trimmed in the middle (losing columns): later tables are deferred.
    const deferred = []
    let size = 0
    let described = 0
    for (const t of schema.tables) {
      if (!wanted.has(t.name.toLowerCase())) continue
      const block = []
      block.push(`## ${t.name} (${t.type.toLowerCase()}, role=${t.role}, ~${t.rows ?? '?'} rows)${t.comment ? ` — ${t.comment}` : ''}`)
      if (notes[t.name]) block.push(`note: ${notes[t.name]}`)
      for (const c of t.columns) {
        const note = notes[`${t.name}.${c.name}`]
        let line = `- ${c.name} ${c.columnType}${c.nullable ? '' : ' NOT NULL'}${c.key ? ` ${c.key}` : ''}${c.roles.length ? ` [${c.roles.join(',')}]` : ''}${c.comment ? ` — ${c.comment}` : ''}${note ? ` (note: ${note})` : ''}`
        if (c.values && settings.sampleMode !== 'off' && !(settings.maskSensitive && c.roles.includes('sensitive'))) {
          line += ` values: ${c.values.map(v => `${JSON.stringify(v.value)}(${v.count})`).join(', ')}${c.distinct === '>12' ? ', …' : ''}`
        }
        block.push(line)
      }
      if (t.indexes.length) block.push(`indexes: ${t.indexes.map(i => `${i.unique ? 'UNIQUE ' : ''}${i.name}(${i.columns.join(',')})`).join('; ')}`)
      const rel = schema.relations.filter(r => r.from.table === t.name || r.to.table === t.name)
      if (rel.length) block.push(`relations: ${rel.map(r => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}(${r.kind})`).join('; ')}`)
      block.push('')
      const blockSize = block.reduce((n, l) => n + l.length + 1, 0)
      // The first table is always described, however wide.
      if (described && size + blockSize > SCHEMA_DETAIL_MAX) { deferred.push(t.name); continue }
      lines.push(...block)
      size += blockSize
      described++
    }
    if (deferred.length) lines.push(`not described (output size limit): ${deferred.join(', ')} — call nl2sql_schema again with \`tables\` set to these.`)
    if (missing.length) lines.push(`unknown tables: ${missing.join(', ')}`)
    return lines.join('\n')
  },

  async sampleRows(ds, table, limit, actor) {
    const settings = this.settingsFor(ds)
    if (actor && actor.kind !== 'owner' && (this.rowRulesFor(actor, ds).length || actor.role === 'viewer')) throw new UserError('nl2sql/row-policy', '当前成员不能查看原始样例数据行')
    if (settings.sampleMode !== 'all') throw new UserError('nl2sql/privacy', '当前隐私设置不允许把样例数据行发送给模型（需将“表结构抽样”设为“全部抽样”）。')
    const schema = await this.visibleSchema(ds)
    const t = schema.tables.find(x => x.name.toLowerCase() === table.toLowerCase())
    if (!t) throw new UserError('nl2sql/unknown-table', `表不存在或无权访问：${table}`)
    const res = await this.withDriver(ds, d => d.query(d.previewSql(t.name, Math.min(Math.max(limit, 1), 20)), { timeoutMs: settings.timeoutMs, maxRows: 20 }))
    const keep = res.columns.map((c, i) => (t.columns.some(x => x.name === c.name) ? i : -1)).filter(i => i >= 0)
    const columns = keep.map(i => res.columns[i].name)
    const masked = res.rows.map(r => keep.map(i => r[i]).map((cell, i) => {
      const col = t.columns.find(c => c.name === columns[i])
      const forced = columnMasked(this.policyFor(ds), t.name, columns[i]) || col?.policyMasked
      return forced || (settings.maskSensitive && col?.roles.includes('sensitive')) ? maskValue(columns[i], cell) : cell
    }))
    return { columns, rows: masked }
  },

  // ------------------------------------------------------ schema changes

  /** Compare two analyzed schemas: added/removed tables, added/removed/changed columns. */
  diffSchemas(before, after) {
    const tb = new Map(before.tables.map(t => [t.name, t]))
    const ta = new Map(after.tables.map(t => [t.name, t]))
    const changes = []
    for (const [name, t] of ta) if (!tb.has(name)) changes.push({ kind: 'table-added', table: name, detail: t.comment || '' })
    for (const [name] of tb) if (!ta.has(name)) changes.push({ kind: 'table-removed', table: name })
    for (const [name, t] of ta) {
      const old = tb.get(name)
      if (!old) continue
      const oc = new Map(old.columns.map(c => [c.name, c]))
      const nc = new Map(t.columns.map(c => [c.name, c]))
      for (const [cn, c] of nc) if (!oc.has(cn)) changes.push({ kind: 'column-added', table: name, column: cn, detail: c.columnType })
      for (const [cn, c] of oc) if (!nc.has(cn)) changes.push({ kind: 'column-removed', table: name, column: cn, detail: c.columnType })
      for (const [cn, c] of nc) {
        const o = oc.get(cn)
        if (o && o.columnType !== c.columnType) changes.push({ kind: 'column-type', table: name, column: cn, detail: `${o.columnType} → ${c.columnType}` })
      }
    }
    return changes
  },

  /** Things that reference removed/changed objects: widgets, examples, metrics, notes, alerts, policy. */
  schemaImpacts(ds, changes) {
    const removedTables = new Set(changes.filter(c => c.kind === 'table-removed').map(c => c.table.toLowerCase()))
    const removedCols = changes.filter(c => c.kind === 'column-removed' || c.kind === 'column-type')
    const hits = []
    const touches = (sql) => {
      if (!sql) return []
      const low = String(sql).toLowerCase()
      const out = []
      for (const t of removedTables) if (new RegExp(`(^|[^\\w])${t.split('.').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(low)) out.push(`表 ${t}`)
      for (const c of removedCols) if (new RegExp(`(^|[^\\w])${c.column.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`).test(low) && low.includes(c.table.split('.').pop().toLowerCase())) out.push(`${c.table}.${c.column}`)
      return out
    }
    for (const d of this.state.dashboards) for (const w of d.widgets) if (w.datasourceId === ds.id) { const t = touches(w.sql); if (t.length) hits.push({ kind: 'widget', id: w.id, name: `${d.name} / ${w.title}`, refs: t }) }
    const k = this.knowledgeFor(ds.id)
    for (const e of k.examples) { const t = touches(e.sql); if (t.length) hits.push({ kind: 'example', id: e.id, name: e.question, refs: t }) }
    for (const m of k.metrics) { const t = touches(`${m.expression} ${m.table} ${m.filter} ${m.timeColumn}`); if (t.length) hits.push({ kind: 'metric', id: m.id, name: m.name, refs: t }) }
    for (const key of Object.keys(k.notes)) { const [tb, col] = key.split('.'); if (removedTables.has(tb.toLowerCase()) || removedCols.some(c => c.table === tb && c.column === col)) hits.push({ kind: 'note', id: key, name: key, refs: [key] }) }
    for (const a of this.state.alerts ?? []) if (a.datasourceId === ds.id) { const t = touches(a.sql); if (t.length) hits.push({ kind: 'alert', id: a.id, name: a.name, refs: t }) }
    return hits
  },

  recordSchemaChange(ds, before, after) {
    const changes = this.diffSchemas(before, after)
    if (!changes.length) return undefined
    const entry = { id: newId('sc'), at: Date.now(), datasourceId: ds.id, datasourceName: ds.name, changes: changes.slice(0, 500), impacts: this.schemaImpacts(ds, changes), status: 'open' }
    this.records.put('schemaChange', entry)
    try { this.store?.putSnapshot({ id: newId('ss'), kind: 'schema', ref: ds.id, createdAt: before.analyzedAt ?? Date.now(), body: { analyzedAt: before.analyzedAt, tables: before.tables.map(t => ({ name: t.name, columns: t.columns.map(c => ({ name: c.name, columnType: c.columnType })) })) } }) } catch {}
    this.onSchemaChange?.(entry)
    if (this.state.settings.schemaNotifyChannel) {
      const lines = entry.changes.slice(0, 15).map(c => `- ${{ 'table-added': '新增表', 'table-removed': '删除表', 'column-added': '新增字段', 'column-removed': '删除字段', 'column-type': '类型变更' }[c.kind]}：${c.table}${c.column ? `.${c.column}` : ''}${c.detail ? `（${c.detail}）` : ''}`)
      const imp = entry.impacts.length ? `\n\n**受影响（${entry.impacts.length}）**\n${entry.impacts.slice(0, 10).map(i => `- ${i.name}`).join('\n')}` : ''
      this.sendToChannel({ channelId: this.state.settings.schemaNotifyChannel, title: `表结构变更：${ds.name}`, text: `${lines.join('\n')}${imp}`, source: 'schema' }).catch(() => {})
    }
    return entry
  },

  listSchemaChanges({ datasourceId, status } = {}) {
    return this.records.list('schemaChange', { ref: datasourceId, status, limit: 200 })
  },

  async ackSchemaChange({ id, status = 'acked' }) {
    const c = this.records.get('schemaChange', id)
    if (!c) throw new UserError('nl2sql/invalid', '变更记录不存在')
    c.status = status === 'open' ? 'open' : 'acked'
    c.ackedAt = Date.now()
    this.records.put('schemaChange', c)
    await this.save()
    return c
  },

  /** Re-analyze every data source (scheduled schema watch). */
  async checkAllSchemas() {
    const out = []
    for (const ds of this.state.datasources) {
      const before = this.records.count('schemaChange', { ref: ds.id })
      try {
        await this.analyzeSchema(ds.id, { refresh: true })
        out.push({ datasourceId: ds.id, name: ds.name, ok: true, changes: this.records.count('schemaChange', { ref: ds.id }) - before })
      } catch (error) {
        out.push({ datasourceId: ds.id, name: ds.name, ok: false, error: error.message })
      }
    }
    return out
  },

  // --------------------------------------------------- knowledge import/export

  exportKnowledge({ datasourceId, kinds } = {}) {
    const ids = datasourceId ? [this.requireDatasource(datasourceId).id] : this.state.datasources.map(d => d.id)
    const want = new Set(kinds?.length ? kinds : ['glossary', 'metric', 'note', 'example'])
    return {
      format: 'dsh-nl2sql-knowledge',
      version: 1,
      exportedAt: new Date().toISOString(),
      datasources: ids.map(id => {
        const ds = this.findDatasource(id)
        const k = this.knowledgeFor(id)
        return {
          name: ds.name, type: ds.type ?? 'mysql', database: ds.database,
          ...(want.has('glossary') ? { glossary: k.glossary.map(({ id: _i, ...g }) => g) } : {}),
          ...(want.has('metric') ? { metrics: k.metrics.map(({ id: _i, ...m }) => m) } : {}),
          ...(want.has('note') ? { notes: k.notes } : {}),
          ...(want.has('example') ? { examples: k.examples.map(({ id: _i, ...e }) => e) } : {}),
        }
      }),
    }
  },

  /**
   * Import knowledge exported by exportKnowledge. Each source block maps onto
   * `targetDatasourceId` (single block) or the data source with the same name.
   * mode: merge (default; same term / metric name / question replaced) or replace.
   */
  async importKnowledge({ data, targetDatasourceId, mode = 'merge', dryRun = false }) {
    const doc = typeof data === 'string' ? JSON.parse(data) : data
    if (doc?.format !== 'dsh-nl2sql-knowledge' || !Array.isArray(doc.datasources)) throw new UserError('nl2sql/invalid', '不是有效的业务知识导出文件（format 应为 dsh-nl2sql-knowledge）')
    const report = []
    for (const block of doc.datasources) {
      const ds = targetDatasourceId && doc.datasources.length === 1 ? this.requireDatasource(targetDatasourceId) : this.findDatasource(block.name)
      if (!ds) { report.push({ source: block.name, skipped: '找不到同名数据源，请指定目标数据源' }); continue }
      const k = mode === 'replace' ? { glossary: [], metrics: [], notes: {}, examples: [] } : this.knowledgeFor(ds.id)
      const count = { glossary: 0, metrics: 0, notes: 0, examples: 0, invalid: 0 }
      for (const g of block.glossary ?? []) {
        if (!g?.term || !g?.definition) { count.invalid++; continue }
        const prev = k.glossary.find(x => x.term === g.term)
        k.glossary = upsert(k.glossary, { id: prev?.id ?? newId('g'), term: String(g.term).slice(0, 60), synonyms: (g.synonyms ?? []).map(String).slice(0, 10), definition: String(g.definition).slice(0, 500), sql: String(g.sql ?? '').slice(0, 500) })
        count.glossary++
      }
      for (const m of block.metrics ?? []) {
        if (!m?.name || !m?.expression) { count.invalid++; continue }
        const prev = k.metrics.find(x => x.name === m.name)
        k.metrics = upsert(k.metrics, { id: prev?.id ?? newId('m'), name: String(m.name).slice(0, 60), expression: String(m.expression).slice(0, 500), table: String(m.table ?? '').slice(0, 64), filter: String(m.filter ?? '').slice(0, 500), timeColumn: String(m.timeColumn ?? '').slice(0, 64), unit: String(m.unit ?? '').slice(0, 20), description: String(m.description ?? '').slice(0, 500), dimensions: Array.isArray(m.dimensions) ? m.dimensions.map(String).slice(0, 20) : [] })
        count.metrics++
      }
      for (const [key, text] of Object.entries(block.notes ?? {})) { if (typeof text === 'string' && text.trim()) { k.notes[String(key).slice(0, 200)] = text.slice(0, 1000); count.notes++ } }
      for (const e of block.examples ?? []) {
        try { admitSql(e?.sql ?? '', { dialect: ds.type ?? 'mysql' }) } catch { count.invalid++; continue }
        if (!e?.question) { count.invalid++; continue }
        const prev = k.examples.find(x => x.question === e.question)
        k.examples = upsert(k.examples, { id: prev?.id ?? newId('e'), question: String(e.question).slice(0, 500), sql: e.sql, note: String(e.note ?? '').slice(0, 500), createdAt: e.createdAt ?? Date.now() }).slice(-500)
        count.examples++
      }
      if (!dryRun) this.state.knowledge[ds.id] = k
      report.push({ source: block.name, target: ds.name, ...count })
    }
    if (!dryRun) await this.save()
    return { dryRun, mode, report }
  },

  // ------------------------------------------------------- semantic layer

  knowledgeFor(id) {
    const k = this.state.knowledge[id] ?? {}
    return { glossary: k.glossary ?? [], metrics: k.metrics ?? [], notes: k.notes ?? {}, examples: k.examples ?? [] }
  },

  getKnowledge(datasourceId) {
    this.requireDatasource(datasourceId)
    return this.knowledgeFor(datasourceId)
  },

  async saveKnowledgeItem({ datasourceId, kind, item }) {
    const ds = this.requireDatasource(datasourceId)
    const k = this.knowledgeFor(ds.id)
    if (kind === 'note') {
      const key = requireText(item?.key, 'key', 200)
      const text = String(item?.text ?? '').trim().slice(0, 1000)
      if (text) k.notes[key] = text
      else delete k.notes[key]
    } else if (kind === 'glossary') {
      const entry = {
        id: item?.id || newId('g'),
        term: requireText(item?.term, 'term', 60),
        synonyms: (Array.isArray(item?.synonyms) ? item.synonyms : String(item?.synonyms ?? '').split(/[,，、]/)).map(x => String(x).trim()).filter(Boolean).slice(0, 10),
        definition: requireText(item?.definition, 'definition', 500),
        sql: String(item?.sql ?? '').trim().slice(0, 500),
      }
      k.glossary = upsert(k.glossary, entry)
    } else if (kind === 'metric') {
      const entry = {
        id: item?.id || newId('m'),
        name: requireText(item?.name, 'name', 60),
        expression: requireText(item?.expression, 'expression', 500),
        table: String(item?.table ?? '').trim().slice(0, 64),
        filter: String(item?.filter ?? '').trim().slice(0, 500),
        timeColumn: String(item?.timeColumn ?? '').trim().slice(0, 64),
        unit: String(item?.unit ?? '').trim().slice(0, 20),
        description: String(item?.description ?? '').trim().slice(0, 500),
        dimensions: (Array.isArray(item?.dimensions) ? item.dimensions : String(item?.dimensions ?? '').split(/[,，、\s]+/)).map(x => String(x).trim()).filter(Boolean).slice(0, 20),
        synonyms: (Array.isArray(item?.synonyms) ? item.synonyms : String(item?.synonyms ?? '').split(/[,，、]/)).map(x => String(x).trim()).filter(Boolean).slice(0, 10),
      }
      k.metrics = upsert(k.metrics, entry)
    } else if (kind === 'example') {
      const sql = requireText(item?.sql, 'sql', 20000)
      admitSql(sql, { dialect: ds.type ?? 'mysql' })
      const entry = { id: item?.id || newId('e'), question: requireText(item?.question, 'question', 500), sql, note: String(item?.note ?? '').slice(0, 500), createdAt: item?.createdAt ?? Date.now() }
      k.examples = upsert(k.examples, entry).slice(-500)
    } else {
      throw new UserError('nl2sql/invalid', `unknown knowledge kind ${kind}`)
    }
    this.state.knowledge[ds.id] = k
    await this.save()
    return k
  },

  async deleteKnowledgeItem({ datasourceId, kind, id }) {
    const ds = this.requireDatasource(datasourceId)
    const k = this.knowledgeFor(ds.id)
    if (kind === 'note') delete k.notes[id]
    else if (kind === 'glossary') k.glossary = k.glossary.filter(x => x.id !== id)
    else if (kind === 'metric') k.metrics = k.metrics.filter(x => x.id !== id)
    else if (kind === 'example') k.examples = k.examples.filter(x => x.id !== id)
    this.state.knowledge[ds.id] = k
    await this.save()
    return k
  },

  /** Rank stored examples and glossary/metric entries against a question (character bigram overlap, works for Chinese). */
  searchKnowledge(datasourceId, question, limit = 5) {
    const k = this.knowledgeFor(datasourceId)
    const grams = textGrams
    const q = grams(question)
    const score = (text) => {
      const g = grams(text)
      let hit = 0
      for (const x of g) if (q.has(x)) hit++
      return g.size === 0 ? 0 : hit / Math.sqrt(g.size * Math.max(q.size, 1))
    }
    const rank = (list, textOf) => list.map(x => ({ x, s: score(textOf(x)) })).filter(r => r.s > 0.08).sort((a, b) => b.s - a.s).slice(0, limit).map(r => ({ ...r.x, score: Number(r.s.toFixed(3)) }))
    return {
      examples: rank(k.examples, e => e.question),
      glossary: rank(k.glossary, g => `${g.term} ${(g.synonyms ?? []).join(' ')} ${g.definition}`),
      metrics: rank(k.metrics, m => `${m.name} ${m.description}`),
    }
  },

  /** Draft table/column notes from comments and enum samples, for the user to review. */
  async draftNotes(datasourceId) {
    const ds = this.requireDatasource(datasourceId)
    const schema = await this.visibleSchema(ds)
    const k = this.knowledgeFor(ds.id)
    const drafts = []
    for (const t of schema.tables) {
      for (const c of t.columns) {
        const key = `${t.name}.${c.name}`
        if (k.notes[key] || !c.values?.length || c.values.length > 12) continue
        if (!/(status|state|type|kind|level|状态|类型)/i.test(c.name + c.comment)) continue
        drafts.push({ key, text: `取值：${c.values.map(v => `${v.value}`).join(' / ')}${c.comment ? `（${c.comment}）` : ''}，请补充每个取值的业务含义` })
      }
    }
    return drafts.slice(0, 60)
  },
}
