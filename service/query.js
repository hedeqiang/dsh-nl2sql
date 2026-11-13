/**
 * Nl2SqlService methods: query.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { aliasExpr, buildAttributionSql, buildBreakdownSql, buildDetailSql, buildMetricSql, computeAttribution, isAdditive, parseSelect, quoteName, rankDimensions } from '../analysis.js'
import { FilterInjectionError, applyFilters, normalizeFilters } from '../filters.js'
import { checkAccess, filterSchema, policyActive, referencedTables, resultColumnPolicy } from '../policy.js'
import { admitSql, prepareSql, stripSql } from '../sql-guard.js'
import { cacheKey } from '../store.js'
import { createHash } from 'node:crypto'
import { writeXlsx } from '../xlsx.js'
import { RESULT_CACHE_LIMIT, SENSITIVE_NAME, UserError, callContext, columnKind, fillChartHint, fmtNum, maskValue, newId, normalizeChart, suggestChart, summarize } from './shared.js'

export const methods = {
  // ---------------------------------------------------------------- query

  async runQuery({ sql, datasourceId, sessionId, title, chart, source, confirmScan, filters, useCache, actor, governed, maxRows }) {
    actor ??= this.actorFor(sessionId)
    const ds = this.datasourceForSession(sessionId, datasourceId)
    this.assertAccess(actor, ds)
    // Viewers run only governed SQL: metric library, verified examples, dashboard widgets.
    if (actor?.role === 'viewer' && !governed && !this.isVerifiedExample(ds, sql)) this.assertCanWriteSql(actor)
    if (sessionId && !this.state.sessions[sessionId]) {
      this.state.sessions[sessionId] = ds.id
      await this.save()
    }
    // Optional per-call row cap (reconciliation loads up to 200k rows per side); invalid values are ignored.
    const settings = { ...this.settingsFor(ds), ...(Number.isInteger(maxRows) && maxRows > 0 ? { maxRows: Math.min(maxRows, 200000) } : {}) }
    const dialect = ds.type ?? 'mysql'
    let admitted = admitSql(sql, { dialect })
    const policy = this.policyFor(ds)
    const fullSchema = policyActive(policy) || filters?.length ? await this.analyzeSchema(ds.id) : (this.schemas.get(ds.id) ?? await this.readSchemaFile(ds.id))
    const denied = checkAccess(admitted.sql, policy, fullSchema, admitted.head, { dialect })
    if (denied) {
      this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: denied, actor })
      await this.save()
      throw new UserError('nl2sql/access-denied', denied)
    }
    callContext.getStore()?.phase?.('admitted', { datasource: ds.name, title })
    let appliedFilters = []
    if (filters?.length) {
      let f
      try { f = applyFilters(admitted.sql, normalizeFilters(filters), { dialect, schema: filterSchema(fullSchema, policy) }) } catch (error) {
        if (!(error instanceof FilterInjectionError)) throw error
        this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: 'filter injection refused', actor })
        await this.save()
        throw new UserError('nl2sql/invalid', '无法安全地为这条查询加上筛选条件，已拒绝。请改写查询（检查括号与注释）。')
      }
      appliedFilters = f.applied
      if (f.applied.length) admitted = admitSql(f.sql, { dialect })
    }
    // Row-level security: every rule must be injected into the outer query; otherwise refuse.
    const rowRules = this.rowRulesFor(actor, ds)
    const rowRulesSig = rowRules.length ? rowRulesSignature(rowRules) : undefined
    if (rowRules.length) {
      const schemaForRules = fullSchema ?? await this.analyzeSchema(ds.id)
      const refs = referencedTables(admitted.sql, schemaForRules.tables, { dialect })
      const needed = rowRules.filter(r => refs.some(t => schemaForRules.tables.find(x => x.name === t)?.columns.some(c => c.name.toLowerCase() === r.column.toLowerCase())))
      if (needed.length) {
        if (!/^(SELECT|WITH)$/.test(admitted.head)) throw new UserError('nl2sql/row-policy', '当前成员受行级权限限制，只能执行 SELECT 查询')
        // Subqueries / CTEs / derived tables could read the table without the filter: allow only a single flat SELECT.
        const flat = stripSql(admitted.sql, { dialect }).code
        if (/\(\s*SELECT\b/i.test(flat) || /^\s*WITH\b/i.test(flat) || /\b(UNION|INTERSECT|EXCEPT)\b/i.test(flat)) {
          this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: 'row-level policy: nested query', actor })
          await this.save()
          throw new UserError('nl2sql/row-policy', `当前成员受行级权限限制（${needed.map(r => `${r.column} ∈ {${r.values.join(', ')}}`).join('；')}），查询不能包含子查询、CTE 或 UNION，请改写为单层查询。`)
        }
        let f
        try { f = applyFilters(admitted.sql, needed.map(r => ({ kind: 'in', column: r.column, values: r.values })), { dialect, schema: schemaForRules }) } catch (error) {
          if (!(error instanceof FilterInjectionError)) throw error
          this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: 'row-level policy: injection refused', actor })
          await this.save()
          throw new UserError('nl2sql/row-policy', `当前成员受行级权限限制（${needed.map(r => `${r.column} ∈ {${r.values.join(', ')}}`).join('；')}），这条查询无法安全地加上该过滤，已拒绝。`)
        }
        const missing = needed.filter(r => !f.applied.some(a => a.column.toLowerCase() === r.column.toLowerCase()))
        // Every referenced table that has the column must be covered.
        const tablesWithCol = (col) => refs.filter(t => schemaForRules.tables.find(x => x.name === t)?.columns.some(c => c.name.toLowerCase() === col.toLowerCase()))
        const uncovered = needed.filter(r => tablesWithCol(r.column).some(t => !f.applied.some(a => a.column.toLowerCase() === r.column.toLowerCase() && a.table === t)))
        if (missing.length || uncovered.length) {
          this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: 'row-level policy not applicable', actor })
          await this.save()
          throw new UserError('nl2sql/row-policy', `当前成员受行级权限限制（${needed.map(r => `${r.column} ∈ {${r.values.join(', ')}}`).join('；')}），这条查询无法安全地加上该过滤，已拒绝。`)
        }
        admitted = admitSql(f.sql, { dialect })
        appliedFilters = [...appliedFilters, ...f.applied.map(a => ({ ...a, description: `行级权限：${a.description ?? a.column}`, rowPolicy: true }))]
      }
    }
    // Query cache: dashboards, reruns and reports reuse a recent identical result.
    const ttlMs = (settings.cacheTtlSec ?? 0) * 1000
    const key = ttlMs > 0 && useCache && this.store ? cacheKey([ds.id, admitted.sql, settings.maxRows, settings.maskSensitive, ds.policy ?? null, ds.updatedAt ?? 0, rowRules, rowRulesSig ?? null]) : null
    if (key) {
      const hit = this.store.cached(key, ttlMs)
      if (hit && (hit.rowRulesSig ?? undefined) === rowRulesSig) {
        const result = { ...hit, resultId: newId('r'), title: title ? String(title).slice(0, 120) : hit.title, chart: normalizeChart(chart, hit.columns) ?? hit.chart, cached: true, cachedAt: hit.createdAt, createdAt: Date.now(), ...(appliedFilters.length ? { filters: appliedFilters, baseSql: sql } : {}) }
        this.remember(result)
        this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'ok', rows: result.rowCount, elapsedMs: 0, resultId: result.resultId, cached: true, actor })
        await this.save()
        return result
      }
    }
    const driver = await this.withDriver(ds, d => d)
    const prepared = prepareSql(admitted, { ...settings, useHint: dialect === 'mysql' && driver.useHint, dialect })
    if (admitted.head === 'SELECT' && settings.scanGuardRows > 0 && !confirmScan && dialect !== 'elasticsearch') {
      const risk = await this.scanRisk(ds, admitted.sql, settings)
      if (risk) {
        this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'blocked', error: risk.message, actor })
        await this.save()
        throw new UserError('nl2sql/scan-guard', risk.message)
      }
    }
    const started = Date.now()
    // Optional per-call context (MCP tools/call): progress phases and cancellation.
    const call = callContext.getStore()
    call?.phase?.('running', { datasource: ds.name, title })
    let res
    try {
      if (call?.signal?.aborted) throw new UserError('query/cancelled', '查询已取消')
      res = await this.withDriver(ds, d => d.query(prepared, { timeoutMs: settings.timeoutMs, maxRows: settings.maxRows, ...(call?.signal ? { signal: call.signal } : {}) }))
      if (call?.signal?.aborted) throw new UserError('query/cancelled', '查询已取消')
    } catch (error) {
      const cancelled = error.code === 'query/cancelled' || call?.signal?.aborted
      this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: cancelled ? 'cancelled' : 'error', error: cancelled ? 'cancelled by the client' : error.message, elapsedMs: Date.now() - started, actor })
      await this.save()
      throw error
    }
    const elapsedMs = Date.now() - started
    call?.phase?.('fetched', { datasource: ds.name, title, rows: Math.min(res.rows.length, settings.maxRows) })
    const truncated = res.rows.length > settings.maxRows
    let cells = truncated ? res.rows.slice(0, settings.maxRows) : res.rows
    const schema = fullSchema
    // Access policy: drop hidden columns that arrive anyway (SELECT *), force-mask policy-masked ones.
    const refs = schema ? referencedTables(admitted.sql, schema.tables, { dialect }) : []
    const colPolicy = resultColumnPolicy(policy, res.columns, refs, schema)
    let masks = colPolicy.mask
    if (colPolicy.drop.size) {
      const keep = res.columns.map((_, i) => i).filter(i => !colPolicy.drop.has(i))
      res = { ...res, columns: keep.map(i => res.columns[i]) }
      cells = cells.map(r => keep.map(i => r[i]))
      masks = new Set([...masks].map(i => keep.indexOf(i)).filter(i => i >= 0))
    }
    const sensitive = new Set(masks)
    if (settings.maskSensitive) {
      res.columns.forEach((f, i) => {
        const col = f.table ? schema?.tables.find(t => t.name === f.table)?.columns.find(c => c.name === f.column) : undefined
        if (col?.roles.includes('sensitive') || SENSITIVE_NAME.test(f.name)) sensitive.add(i)
      })
    }
    for (const row of cells) for (const i of sensitive) row[i] = maskValue(res.columns[i].name, row[i])
    const columns = res.columns.map((f, i) => ({ name: f.name, kind: columnKind(f, cells, i), ...(sensitive.has(i) ? { masked: true } : {}) }))
    const suggested = suggestChart(columns, cells)
    const resultId = newId('r')
    const result = {
      resultId,
      datasourceId: ds.id,
      datasourceName: ds.name,
      sql: admitted.sql,
      executedSql: prepared,
      ...(appliedFilters.length ? { filters: appliedFilters, baseSql: sql } : {}),
      ...(colPolicy.drop.size ? { hiddenColumns: colPolicy.drop.size } : {}),
      ...(rowRulesSig ? { rowRulesSig } : {}),
      title: title ? String(title).slice(0, 120) : '',
      columns,
      rows: cells,
      rowCount: cells.length,
      truncated,
      elapsedMs,
      chart: normalizeChart(chart, columns) ?? fillChartHint(chart, columns, suggested) ?? suggested,
      suggestedChart: suggested,
      createdAt: Date.now(),
    }
    this.remember(result)
    if (key) try { this.store.remember(key, resultId) } catch {}
    this.audit({ ds, sessionId, source, sql: admitted.sql, title, status: 'ok', rows: cells.length, elapsedMs, resultId, actor })
    await this.save()
    return result
  },

  audit({ ds, sessionId, source, sql, title, status, error, rows, elapsedMs, resultId, cached, actor }) {
    const who = actor ?? (sessionId ? this.state.sessionActors?.[sessionId] : undefined)
    this.records.put('history', {
      id: newId('h'), at: Date.now(), datasourceId: ds.id, datasourceName: ds.name, sessionId: sessionId ?? null,
      source: source ?? 'ui', title: title ? String(title).slice(0, 120) : '', sql, status,
      ...(cached ? { cached: true } : {}),
      ...(who ? { actor: { id: who.id, name: who.name, kind: who.kind } } : {}),
      ...(error ? { error: String(error).slice(0, 500) } : {}),
      ...(rows !== undefined ? { rows } : {}), ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...(resultId ? { resultId } : {}),
    })
  },

  /** EXPLAIN the statement and refuse full scans over large tables. */
  async scanRisk(ds, sql, settings) {
    let scans
    try {
      ({ scans } = await (await this.driver(ds)).explain(sql, { timeoutMs: Math.min(settings.timeoutMs, 10000) }))
    } catch {
      return undefined // EXPLAIN failures surface when the query itself runs
    }
    const big = scans.filter(r => r.rows >= settings.scanGuardRows)
    if (!big.length) return undefined
    const detail = big.map(r => `${r.table}（约 ${Number(r.rows).toLocaleString()} 行）`).join('、')
    return { message: `执行计划显示会全表扫描大表：${detail}，超过阈值 ${settings.scanGuardRows.toLocaleString()} 行。请增加带索引的过滤条件（如时间范围、主键/索引列），或改用聚合；确认要执行时，使用 confirmScan=true 重新调用。` }
  },

  async explain({ sql, datasourceId, sessionId }) {
    const ds = this.datasourceForSession(sessionId, datasourceId)
    const admitted = admitSql(sql, { dialect: ds.type ?? 'mysql' })
    if (admitted.head !== 'SELECT') throw new UserError('nl2sql/invalid', '只能对 SELECT 生成执行计划')
    const denied = checkAccess(admitted.sql, this.policyFor(ds), await this.analyzeSchema(ds.id), admitted.head, { dialect: ds.type ?? 'mysql' })
    if (denied) throw new UserError('nl2sql/access-denied', denied)
    const res = await this.withDriver(ds, d => d.explain(admitted.sql, { timeoutMs: this.settingsFor(ds).timeoutMs }))
    return { datasourceId: ds.id, dialect: ds.type ?? 'mysql', plan: res.plan, scans: res.scans }
  },

  remember(result) {
    this.results.set(result.resultId, result)
    while (this.results.size > RESULT_CACHE_LIMIT) this.results.delete(this.results.keys().next().value)
    try { this.store?.put(result) } catch (error) { console.warn('nl2sql: cannot persist result: %s', error.message) }
  },

  /** A result from memory, falling back to the durable store (survives restarts). */
  lookupResult(resultId) {
    if (!resultId) return undefined
    let r = this.results.get(resultId)
    if (!r && this.store) {
      try { r = this.store.get(resultId) } catch {}
      if (r) {
        this.results.set(resultId, r)
        while (this.results.size > RESULT_CACHE_LIMIT) this.results.delete(this.results.keys().next().value)
      }
    }
    return r
  },

  getResult(resultId) {
    return this.lookupResult(resultId) ?? null
  },

  /**
   * A scoped actor may only use results of data sources in scope, and — when it
   * has row rules — only results filtered by exactly its own rules (signature
   * match; results without a signature, e.g. from older versions, are refused).
   */
  assertResultAccess(r, actor) {
    if (!actor || actor.kind === 'owner') return
    const ds = this.requireDatasource(r.datasourceId)
    this.assertAccess(actor, ds)
    const rules = this.rowRulesFor(actor, ds)
    if (rules.length && (!r.filters?.some(f => f.rowPolicy) || r.rowRulesSig !== rowRulesSignature(rules))) throw new UserError('nl2sql/row-policy', '该结果未按你的行级权限过滤，不能使用，请重新查询')
  },

  cacheStats() {
    return this.store ? this.store.stats() : { results: this.results.size, bytes: 0, cacheEntries: 0 }
  },

  async clearCache() {
    this.store?.clearCache()
    return this.cacheStats()
  },

  async rechart({ resultId, chart, title, sessionId }) {
    const r = this.lookupResult(resultId)
    if (r) this.assertResultAccess(r, this.actorFor(sessionId))
    if (!r) throw new UserError('nl2sql/result-expired', `结果 ${resultId} 不存在或已过期，请重新执行 nl2sql_query。`)
    const normalized = normalizeChart(chart, r.columns)
    if (!normalized) throw new UserError('nl2sql/invalid-chart', `图表配置无效。可用列：${r.columns.map(c => `${c.name}(${c.kind})`).join(', ')}`)
    const next = { ...r, resultId: newId('r'), chart: normalized, title: title ? String(title).slice(0, 120) : r.title, createdAt: Date.now() }
    this.remember(next)
    return next
  },

  /** The part of a result the model may see, per privacy settings. */
  modelView(result) {
    const ds = this.findDatasource(result.datasourceId)
    const settings = this.settingsFor(ds)
    const view = {
      resultId: result.resultId,
      datasource: result.datasourceName,
      rowCount: result.rowCount,
      truncated: result.truncated,
      elapsedMs: result.elapsedMs,
      columns: result.columns.map(c => `${c.name}:${c.kind}${c.masked ? '(masked)' : ''}`),
      chart: result.chart,
    }
    if (settings.resultToModel === 'summary') view.summary = summarize(result.columns, result.rows)
    if (settings.resultToModel === 'rows') view.rows = result.rows.slice(0, settings.modelRows)
    view.privacy = settings.resultToModel
    return view
  },

  // -------------------------------------------------------------- metrics

  findMetric(ds, ref) {
    const k = this.knowledgeFor(ds.id)
    const q = String(ref ?? '').trim().toLowerCase()
    return k.metrics.find(m => m.id === ref || m.name.toLowerCase() === q || (m.synonyms ?? []).some(x => x.toLowerCase() === q))
  },

  /** Query a governed metric from the metric library (definition enforced, not re-derived by the model). */
  async queryMetric({ datasourceId, sessionId, metric: ref, grain, dimensions = [], range, from, to, filters = [], limit, title, source = 'agent', actor, chart }) {
    const ds = this.datasourceForSession(sessionId, datasourceId)
    const metric = this.findMetric(ds, ref)
    if (!metric) {
      const all = this.knowledgeFor(ds.id).metrics
      throw new UserError('nl2sql/unknown-metric', `指标库中没有「${ref}」。${all.length ? `可用指标：${all.map(m => m.name).join('、')}` : '指标库为空，请先在「业务知识 → 指标库」中定义。'}`)
    }
    if (metric.dimensions?.length && dimensions.length) {
      const bad = dimensions.filter(d => !metric.dimensions.includes(d))
      if (bad.length) throw new UserError('nl2sql/invalid', `指标「${metric.name}」不支持按 ${bad.join('、')} 拆分。允许的维度：${metric.dimensions.join('、')}`)
    }
    const built = buildMetricSql({ metric, dialect: ds.type ?? 'mysql', grain, dimensions, range, from, to, filters, limit: limit ?? 1000, now: new Date() })
    if (built.error) throw new UserError('nl2sql/invalid', built.error)
    const ch = chart ?? (grain ? { type: dimensions.length ? 'line' : 'area', x: '时间', y: [metric.name], ...(dimensions.length ? { series: dimensions[0] } : {}) } : dimensions.length ? { type: 'bar', x: dimensions[0], y: [metric.name] } : { type: 'kpi', y: [metric.name] })
    const result = await this.runQuery({ governed: true, sql: built.sql, datasourceId: ds.id, sessionId, title: title || `${metric.name}${grain ? ` · 按${{ day: '天', week: '周', month: '月', hour: '小时', year: '年' }[grain] ?? grain}` : ''}${dimensions.length ? ` · 按${dimensions.join('、')}` : ''}`, chart: ch, source, actor, useCache: true })
    return { ...result, metric: { id: metric.id, name: metric.name, unit: metric.unit, expression: metric.expression } }
  },

  // --------------------------------------------------------- drill & why

  /** Drill a result: detail rows behind one point, or breakdown by a dimension. */
  async drill({ resultId, mode, xValue, xColumn, dimension, sessionId, actor, source = 'ui' }) {
    const r = this.lookupResult(resultId)
    if (!r) throw new UserError('nl2sql/result-expired', '结果已过期，请重新查询')
    const ds = this.requireDatasource(r.datasourceId)
    this.assertResultAccess(r, actor ?? this.actorFor(sessionId))
    const dialect = ds.type ?? 'mysql'
    // Drill from the user-visible SQL; row-level rules are re-applied by runQuery.
    const base = r.baseSql ?? r.sql
    const x = xColumn ?? r.chart?.x
    let built
    if (mode === 'detail') built = buildDetailSql({ sql: base, dialect, xColumn: x, xValue, limit: 200 })
    else {
      if (!dimension) throw new UserError('nl2sql/invalid', '请选择拆分维度')
      built = buildBreakdownSql({ sql: base, dialect, xColumn: xValue === undefined ? undefined : x, xValue, dimension: quoteName(dimension, dialect), dimensionLabel: dimension, limit: 30 })
    }
    if (built.error) throw new UserError('nl2sql/invalid', built.error)
    const label = xValue === undefined ? '' : `${x}=${xValue}`
    const title = mode === 'detail' ? `${r.title || '明细'} · ${label} 明细` : `${r.title || '拆分'}${label ? ` · ${label}` : ''} · 按${dimension}`
    if (mode === 'detail') this.assertCanWriteSql(actor ?? this.actorFor(sessionId), '查看明细数据')
    return this.runQuery({ governed: true, sql: built.sql, datasourceId: ds.id, sessionId, title, source, actor, chart: mode === 'detail' ? { type: 'table' } : { type: 'bar', x: built.label ?? dimension, ...(built.measures?.length ? { y: built.measures.slice(0, 1) } : {}) } })
  },

  /** Columns of the tables a result reads that make sense as breakdown dimensions. */
  async drillDimensions(resultId) {
    const r = this.lookupResult(resultId)
    if (!r) throw new UserError('nl2sql/result-expired', '结果已过期，请重新查询')
    const ds = this.requireDatasource(r.datasourceId)
    const schema = await this.visibleSchema(ds)
    const refs = referencedTables(r.baseSql ?? r.sql, schema.tables, { dialect: ds.type ?? 'mysql' })
    const out = []
    for (const t of schema.tables.filter(x => refs.includes(x.name))) {
      for (const c of t.columns) {
        if (c.roles.includes('sensitive') || c.roles.includes('id') || c.roles.includes('measure') || c.roles.includes('time')) continue
        const lowCard = c.distinct !== undefined && c.distinct !== '>12' && c.distinct > 1
        const categorical = lowCard || c.roles.includes('enum') || c.roles.includes('geo') || c.dataType === 'keyword' || c.dataType === 'enum' || c.dataType === 'bool' || c.dataType === 'boolean'
        // Free-text / high-cardinality columns (hash, address, name) make poor dimensions.
        const shortText = /^(varchar|char|character varying|text)$/.test(c.dataType) && (((/\((\d+)\)/.test(c.columnType ?? '') && Number(/\((\d+)\)/.exec(c.columnType)[1]) <= 32)) || ds.type === 'sqlite') && !/(hash|addr|address|url|name|title|desc|memo|remark|content|email|phone|token|key|code)$/i.test(c.name)
        if (!categorical && !shortText) continue
        out.push({ column: refs.length > 1 ? `${t.name.split('.').pop()}.${c.name}` : c.name, label: c.comment || c.name, table: t.name, values: c.values?.length ?? null, rank: categorical ? 0 : 1 })
      }
    }
    out.sort((a, b) => a.rank - b.rank)
    return { x: r.chart?.x ?? null, dimensions: out.slice(0, 40).map(({ rank: _r, ...d }) => d) }
  },

  /**
   * "Why did it change": compare two periods of a time-series result and
   * rank dimensions by how well they explain the delta.
   */
  async explainChange({ resultId, current, baseline, dimensions, measure, sessionId, actor }) {
    const r = this.lookupResult(resultId)
    if (!r) throw new UserError('nl2sql/result-expired', '结果已过期，请重新查询')
    const ds = this.requireDatasource(r.datasourceId)
    this.assertResultAccess(r, actor ?? this.actorFor(sessionId))
    const dialect = ds.type ?? 'mysql'
    const parsed = parseSelect(r.baseSql ?? r.sql, { dialect })
    if (!parsed) throw new UserError('nl2sql/invalid', '这个查询结构太复杂（UNION / 无 FROM），无法自动归因')
    const x = r.chart?.x
    const timeExpr = aliasExpr(parsed, x)
    if (!timeExpr) throw new UserError('nl2sql/invalid', '需要一个按时间（或类别）分组的结果，才能比较两个时段')
    const measureItem = measure ? parsed.select.find(i => i.alias === measure) : parsed.select.find(i => i.isAggregate && (!r.chart?.y?.length || r.chart.y.includes(i.alias)))
    if (!measureItem?.isAggregate) throw new UserError('nl2sql/invalid', '需要一个聚合指标（SUM / COUNT 等）才能归因')
    // Default periods: last two points of the result.
    const xi = r.columns.findIndex(c => c.name === x)
    const points = r.rows.map(row => row[xi]).filter(v => v !== null && v !== undefined)
    const cur = current ?? points.at(-1)
    const base = baseline ?? points.at(-2)
    if (cur === undefined || base === undefined) throw new UserError('nl2sql/invalid', '至少需要两个时间点')
    let dims = dimensions
    if (!dims?.length) dims = (await this.drillDimensions(resultId)).dimensions.filter(d => d.values === null || d.values <= 60).slice(0, 6).map(d => d.column)
    const additive = isAdditive(measureItem.expr)
    const results = []
    for (const dim of dims.slice(0, 8)) {
      const built = buildAttributionSql({ dialect, from: parsed.from, where: parsed.where, timeExpr, measureExpr: measureItem.expr, dimension: quoteName(dim, dialect), current: cur, baseline: base, limit: 200 })
      if (built.error) { results.push({ dimension: dim, error: built.error }); continue }
      try {
        const res = await this.runQuery({ governed: true, sql: built.sql, datasourceId: ds.id, sessionId, title: `归因 · ${dim}`, source: sessionId ? 'agent' : 'ui', actor, useCache: true, confirmScan: true })
        const rows = res.rows.map(row => ({ dim: row[0], period: row[1], value: row[2] === null ? 0 : Number(row[2]) }))
        const attribution = computeAttribution(rows, { additive })
        results.push({ dimension: dim, attribution })
      } catch (error) {
        results.push({ dimension: dim, error: error.message })
      }
    }
    const ranked = rankDimensions(results.filter(x => x.attribution))
    const top = ranked[0]
    const total = top?.attribution.total
    const mixShift = top && Math.abs(top.attribution.total.delta) < top.attribution.items.reduce((a, i) => a + Math.abs(i.delta), 0) / 4
    const summary = top
      ? `${x}「${cur}」对比「${base}」：${measureItem.alias ?? '指标'} 从 ${fmtNum(total.baseline)} 变为 ${fmtNum(total.current)}（${total.delta >= 0 ? '+' : ''}${fmtNum(total.delta)}${total.pct === null ? '' : `，${total.pct >= 0 ? '+' : ''}${(total.pct * 100).toFixed(1)}%`}）。最能解释变化的维度是「${top.dimension}」：${top.attribution.items.slice(0, 3).map(i => `${i.value} ${i.delta >= 0 ? '+' : ''}${fmtNum(i.delta)}${i.share === null || Math.abs(i.share) > 3 ? '' : `（贡献 ${(i.share * 100).toFixed(0)}%）`}`).join('，')}。${mixShift ? '总量变化不大，但各分组此消彼长（结构性变化）。' : ''}`
      : '没有找到可解释变化的维度。'
    return { current: cur, baseline: base, measure: measureItem.alias ?? measureItem.expr, additive, dimensions: [...ranked, ...results.filter(x => !x.attribution)], summary }
  },

  // ------------------------------------------------------------- export

  /** Excel workbook (base64) for results, a dashboard, or one result; each result becomes a sheet. */
  async exportExcel({ resultIds = [], dashboardId, title, includeSql = true }) {
    let results = resultIds.map(id => this.lookupResult(id)).filter(Boolean)
    let name = title
    if (dashboardId) {
      const d = this.requireDashboard(dashboardId)
      name = name || d.name
      results = []
      for (const w of d.widgets.slice(0, 50)) {
        try { results.push({ ...(await this.runWidget(w.id, d.filters)), title: w.title }) } catch (error) { results.push({ title: w.title, error: error.message, columns: [{ name: '错误', kind: 'text' }], rows: [[error.message]] }) }
      }
    }
    if (!results.length) throw new UserError('nl2sql/result-expired', '没有可导出的结果（可能已过期），请重新查询')
    const sheets = results.map((r, i) => ({
      name: (r.title || `结果${i + 1}`).slice(0, 31),
      title: r.title || undefined,
      note: [r.datasourceName, r.rowCount !== undefined ? `${r.rowCount} 行${r.truncated ? '（已截断）' : ''}` : '', r.filters?.length ? `筛选：${r.filters.map(f => f.description).join('；')}` : '', r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }) : ''].filter(Boolean).join(' · ') || undefined,
      columns: r.columns,
      rows: r.rows,
    }))
    if (includeSql) sheets.push({ name: 'SQL', columns: [{ name: '结果', kind: 'text' }, { name: '数据源', kind: 'text' }, { name: 'SQL', kind: 'text' }], rows: results.map((r, i) => [r.title || `结果${i + 1}`, r.datasourceName ?? '', r.sql ?? '']) })
    const buf = writeXlsx(sheets, { creator: 'DeepSeek Harness 数据问答' })
    const file = `${(name || results[0].title || '数据问答').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}-${new Date().toISOString().slice(0, 10)}.xlsx`
    return { fileName: file, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buf.toString('base64'), bytes: buf.length, sheets: sheets.length }
  },
}

/** Stable signature of a set of row rules (order of rules and of values does not matter). */
export function rowRulesSignature(rules) {
  const norm = rules.map(r => ({ column: String(r.column).toLowerCase(), values: [...new Set((r.values ?? []).map(String))].sort() }))
    .sort((a, b) => (a.column + '\0' + a.values.join('\0')).localeCompare(b.column + '\0' + b.values.join('\0')))
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 32)
}
