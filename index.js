/**
 * Host half of the NL2SQL bundle.
 *
 * One service implements every operation; the Web page reaches it through the
 * private `/nl2sql` Connection RPC channel and the Agent reaches it through the
 * `nl2sql_*` tools. Data sources and settings live in a JSON file under the
 * DSH home; passwords live in the Harness credential store.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DIALECTS } from './drivers.js'
import { ResultStore } from './store.js'
import * as shared from './service/shared.js'
import { methods as m0 } from './service/datasources.js'
import { methods as m1 } from './service/access.js'
import { methods as m2 } from './service/schema.js'
import { methods as m3 } from './service/query.js'
import { methods as m4 } from './service/dashboards.js'
import { methods as m5 } from './service/push.js'
import { methods as m6 } from './service/bots.js'
import { methods as mChannels } from './service/channels.js'
import { methods as m7 } from './service/evaluation.js'
import { methods as m8 } from './service/alerts.js'
import { methods as m9 } from './service/uploads.js'
import { methods as m10 } from './service/admin.js'
import { methods as mSuggest } from './service/suggestions.js'
import { FEATURES } from './service/features.js'
const { CHART_TYPES, DEFAULT_SETTINGS, RECORD_KINDS, RPC_PATH, Records, UserError, newId, pick, toUserError } = shared

export const name = 'nl2sql'
export const inject = ['tools', 'connection']

class Nl2SqlService {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config ?? {}
    this.dir = this.config.dataDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'nl2sql')
    this.file = join(this.dir, 'state.json')
    this.state = { version: 1, datasources: [], settings: structuredClone(DEFAULT_SETTINGS), current: null, sessions: {}, dashboard: [], knowledge: {}, reports: [], dashboardFilters: [], channels: [], dashboards: [], currentDashboard: null, evals: {}, alerts: [], users: [], botConversations: {} }
    this.drivers = new Map()
    this.schemas = new Map()
    this.results = new Map()
    this.writing = Promise.resolve()
    this.saves = 0
  }

  async load() {
    await mkdir(this.dir, { recursive: true })
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      this.state = { ...this.state, ...raw, settings: { ...structuredClone(DEFAULT_SETTINGS), ...(raw.settings ?? {}), retention: { ...DEFAULT_SETTINGS.retention, ...(raw.settings?.retention ?? {}) } } }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('nl2sql: cannot read state, starting empty: %s', error.message)
    }
    // Multi-dashboard migration: the legacy single dashboard becomes "默认看板".
    if (!this.state.dashboards?.length) {
      this.state.dashboards = [{ id: 'db-default', name: '默认看板', description: '', widgets: this.state.dashboard ?? [], filters: this.state.dashboardFilters ?? [], createdAt: Date.now() }]
      this.state.currentDashboard = 'db-default'
    }
    this.syncLegacyDashboard()
    // Channels (adapter registry), bots on channels, member identities, bot settings.
    const migrated = [await this.initChannels(), this.migrateUsers(), this.migrateSettings()].some(Boolean)
    try {
      this.store = new ResultStore(join(this.dir, 'results.sqlite'))
    } catch (error) {
      console.warn('nl2sql: result store unavailable, results stay in memory: %s', error.message)
    }
    this.records = new Records(this.store, () => this.state.settings.retention)
    // Staged uploads older than one hour are removed on start and on every new upload.
    this.cleanupUploads().catch(() => {})
    // One-time migration: growing logs move from state.json into SQLite.
    if (this.store) {
      const moved = {}
      this.store.transaction(() => {
        for (const [kind, key] of RECORD_KINDS) {
          const list = this.state[key]
          if (!Array.isArray(list) || !list.length) continue
          for (const rec of [...list].reverse()) this.records.put(kind, rec.id ? rec : { ...rec, id: newId(kind.slice(0, 2)) })
          moved[key] = list.length
        }
      })
      let changed = false
      for (const [, key] of RECORD_KINDS) if (key in this.state) { delete this.state[key]; changed = true }
      if (changed) {
        if (Object.keys(moved).length) console.warn('nl2sql: migrated logs to SQLite: %s', JSON.stringify(moved))
        await this.save()
        return
      }
    }
    if (migrated) await this.save()
  }

  /** Keep the legacy `dashboard` / `dashboardFilters` fields pointing at the current dashboard. */
  syncLegacyDashboard() {
    const d = this.currentDashboardObj()
    this.state.dashboard = d.widgets
    this.state.dashboardFilters = d.filters ?? []
  }

  currentDashboardObj() {
    return this.state.dashboards.find(d => d.id === this.state.currentDashboard) ?? this.state.dashboards[0]
  }

  /** Bound per-session maps: keep the most recent 2000 bindings; eval exclusions only for live eval sessions. */
  pruneSessionMaps() {
    const keep = 2000
    const ids = Object.keys(this.state.sessions ?? {})
    if (ids.length > keep) for (const id of ids.slice(0, ids.length - keep)) { delete this.state.sessions[id]; delete this.state.sessionActors?.[id]; delete this.state.evalExclusions?.[id] }
    for (const id of Object.keys(this.state.sessionActors ?? {})) if (!(id in (this.state.sessions ?? {}))) delete this.state.sessionActors[id]
    for (const id of Object.keys(this.state.evalExclusions ?? {})) if (!(id in (this.state.sessions ?? {}))) delete this.state.evalExclusions[id]
    this.pruneBotConversations()
  }

  save() {
    if (++this.saves % 50 === 0 || this.saves === 1) this.pruneSessionMaps()
    // `dashboard` / `dashboardFilters` mirror the current dashboard for old code paths; don't write them twice.
    const { dashboard: _d, dashboardFilters: _f, ...persisted } = this.state
    const snapshot = JSON.stringify(persisted, null, 2)
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, snapshot, { mode: 0o600 })
      await rename(tmp, this.file)
    }).catch(error => console.warn('nl2sql: save failed: %s', error.message))
    return this.writing
  }

  /**
   * Scheduler jobs contributed by feature modules: every prototype method named
   * `jobs_<feature>(now)` returns an array of { id, due(now), run() }.
   */
  schedulerJobs(now) {
    const out = []
    for (const k of Object.getOwnPropertyNames(Nl2SqlService.prototype)) if (k.startsWith('jobs_')) { try { out.push(...(this[k](now) ?? [])) } catch (error) { console.warn('nl2sql: %s failed: %s', k, error.message) } }
    return out
  }

  async dispose() {
    this.disposed = true
    if (this.alertTimer) clearInterval(this.alertTimer)
    if (this.alertKick) clearTimeout(this.alertKick)
    // Let in-flight evaluation workers notice disposal before the store closes.
    const jobs = [...(this.evalJobs?.values() ?? [])]
    if (jobs.length) {
      let timer
      await Promise.race([Promise.allSettled(jobs), new Promise(r => { timer = setTimeout(r, 3000) })])
      clearTimeout(timer)
    }
    await this.stopAllBots()
    // Button analyses still running in the background (service/bots.js).
    if (this.botActionJobs?.size) await Promise.race([Promise.allSettled([...this.botActionJobs]), new Promise(r => setTimeout(r, 3000).unref?.())])
    await Promise.allSettled([...this.drivers.values()].map(p => p.then(d => d.close())))
    this.drivers.clear()
    await this.writing
    this.store?.close()
  }

}
for (const m of [m0, m1, m2, m3, m4, m5, mChannels, m6, m7, m8, m9, m10, mSuggest, ...FEATURES.map(f => f.methods)]) Object.defineProperties(Nl2SqlService.prototype, Object.getOwnPropertyDescriptors(m))
const DATASOURCE_PARAM = { type: 'string', description: 'Data source id or name. Omit to use the one bound to this session.' }

function textBlock(text) {
  return [{ type: 'text', text }]
}

function registerTools(ctx, service) {
  const tools = ctx.tools
  const wrap = (fn) => async (args, exec) => {
    try {
      return await fn(args ?? {}, exec)
    } catch (error) {
      throw error instanceof UserError ? new Error(error.message) : error
    }
  }

  tools.register({
    name: 'nl2sql_datasource',
    description: 'List the configured enterprise data sources (MySQL, PostgreSQL, Elasticsearch) or choose the one this session queries. Data sources are created by the user in the Data Q&A page; you cannot create them or see passwords.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'use'], description: 'list: show data sources and the current binding. use: bind this session to `datasource`.' },
        datasource: DATASOURCE_PARAM,
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 1)),
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', title: args?.action === 'use' ? `选择数据源 ${args?.datasource ?? ''}` : '列出数据源', kind: 'read' }),
    execute: wrap(async (args, exec) => {
      const sessionId = exec.agent?.id
      const actor = sessionId ? service.state.sessionActors?.[sessionId] : undefined
      const visible = service.listDatasources().filter(d => !Array.isArray(actor?.datasourceIds) || actor.datasourceIds.includes(d.id))
      if (args.action === 'use') {
        if (!args.datasource) throw new Error('`datasource` is required for action=use')
        const ds = service.requireDatasource(args.datasource)
        service.assertAccess(actor, ds)
        // The agent tool binds only this session; the page's current data source is left alone.
        const info = await service.bindSession(sessionId, ds.id, { setCurrent: false })
        return { bound: info.datasourceId, datasources: visible.map(d => pick(d, ['id', 'name', 'type', 'database', 'serverVersion'])) }
      }
      const info = sessionId ? service.sessionInfo(sessionId) : null
      return {
        boundToSession: info?.boundDatasourceId ?? (actor ? null : service.state.current) ?? null,
        datasources: visible.map(d => pick(d, ['id', 'name', 'type', 'host', 'database', 'serverVersion', 'description', 'schemaAnalyzedAt'])),
      }
    }),
  })

  tools.register({
    name: 'nl2sql_schema',
    description: 'Read the analyzed schema of the session data source. Without `tables`: a compact overview of every table (role, approximate rows, comment, columns with semantic roles such as time/measure/enum/id/sensitive) and table relations (declared foreign keys plus inferred ones). With `tables`: full column types, comments, indexes and sampled enum values for those tables. With `sample`: up to 20 masked example rows of one table (only when privacy settings allow).',
    parameters: {
      type: 'object',
      properties: {
        datasource: DATASOURCE_PARAM,
        tables: { type: 'array', items: { type: 'string' }, description: 'Table names to describe in detail.' },
        sample: { type: 'string', description: 'One table name to fetch example rows from.' },
        refresh: { type: 'boolean', description: 'Re-read information_schema instead of the cached analysis.' },
        question: { type: 'string', description: 'The user\'s question, verbatim. Pass it with the overview call: on large databases only the tables most relevant to it are described in full (all other tables are listed by name).' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(value.text ?? JSON.stringify(value)),
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', title: args?.tables?.length ? `查看表结构 ${args.tables.join(', ')}` : args?.sample ? `样例数据 ${args.sample}` : '表结构概览', kind: 'read' }),
    execute: wrap(async (args, exec) => {
      const ds = service.datasourceForSession(exec.agent?.id, args.datasource)
      const schema = await service.visibleSchema(ds, { refresh: Boolean(args.refresh) })
      if (args.sample) {
        const s = await service.sampleRows(ds, args.sample, 10, service.actorFor(exec.agent?.id))
        return { datasource: ds.name, text: `${args.sample} sample rows\n${s.columns.join(' | ')}\n${s.rows.map(r => r.map(v => v === null ? 'NULL' : String(v)).join(' | ')).join('\n')}` }
      }
      return { datasource: ds.name, tableCount: schema.tables.length, text: service.schemaForModel(schema, ds, args.tables, { question: typeof args.question === 'string' ? args.question : undefined }) }
    }),
  })

  const chartParam = {
    type: 'object',
    description: 'Optional chart for the result. Omit to let the UI pick automatically from column types.',
    properties: {
      type: { type: 'string', enum: CHART_TYPES, description: 'line/area for trends, bar/barh/stacked for comparisons, pie/funnel for composition, scatter for correlation, kpi for single numbers, table for details.' },
      x: { type: 'string', description: 'Category or time column.' },
      y: { type: 'array', items: { type: 'string' }, description: 'Numeric value columns.' },
      series: { type: 'string', description: 'Optional column splitting one value column into series.' },
    },
    required: ['type'],
    additionalProperties: false,
  }

  const queryOutput = {
    schema: { type: 'object' },
    render: (_args, value) => textBlock(JSON.stringify(value.model, null, 1)),
    presentationMeta: (_args, value) => value.display,
  }

  tools.register({
    name: 'nl2sql_query',
    description: 'Execute ONE read-only SQL statement on the session data source, written in that source\'s dialect (see the dialect line of nl2sql_schema): MySQL (5.7 has no CTE/window functions; ONLY_FULL_GROUP_BY), PostgreSQL, or Elasticsearch SQL (indices are tables, no JOINs). Rows are capped and a server time limit applies. The full result is shown to the user as a table/chart in the conversation; you receive a resultId plus a summary or a few rows, depending on privacy settings. Prefer aggregated queries for charts.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The single read-only SQL statement.' },
        title: { type: 'string', description: 'Short human title for the result, in the user\'s language.' },
        show: { type: 'boolean', description: 'IM bot answers only: false = an intermediate / exploratory query that should not be shown in the reply card (e.g. a lookup that found nothing, a probe of the wrong table). Default true.' },
        datasource: DATASOURCE_PARAM,
        chart: chartParam,
        confirmScan: { type: 'boolean', description: 'Set true only after a scan-guard refusal when the user accepts a full scan of a large table.' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    output: queryOutput,
    timeoutMs: 660000,
    presentCall: (args) => ({ card: 'generic', title: args?.title ? `查询：${args.title}` : '执行 SQL', kind: 'read' }),
    execute: wrap(async (args, exec) => {
      const result = await service.runQuery({ sql: args.sql, datasourceId: args.datasource, sessionId: exec.agent?.id, title: args.title, chart: args.chart, source: 'agent', confirmScan: Boolean(args.confirmScan) })
      if (args.show === false) result.hidden = true
      return { model: service.modelView(result), display: displayMeta(result) }
    }),
  })

  tools.register({
    name: 'nl2sql_chart',
    description: 'Render an existing query result (by resultId from nl2sql_query) as a different chart without re-running SQL.',
    parameters: {
      type: 'object',
      properties: {
        resultId: { type: 'string', description: 'resultId returned by nl2sql_query.' },
        title: { type: 'string', description: 'Chart title.' },
        chart: chartParam,
      },
      required: ['resultId', 'chart'],
      additionalProperties: false,
    },
    output: queryOutput,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', title: args?.title ? `图表：${args.title}` : '生成图表', kind: 'other' }),
    execute: wrap(async (args, exec) => {
      const result = await service.rechart({ ...args, sessionId: exec?.agent?.id })
      return { model: { resultId: result.resultId, chart: result.chart }, display: displayMeta(result) }
    }),
  })
}

function registerSendTool(ctx, service) {
  ctx.tools.register({
    name: 'nl2sql_send',
    description: 'Send a message to an IM channel (such as Lark/Feishu, Telegram, WeCom, DingTalk) configured by the user in the Data Q&A page: a title, a Markdown body, and up to 10 query results by resultId. Each platform renders them as natively as it can (Lark: interactive cards with native charts; others: chart images or Markdown tables — see `capabilities` in action=list). The Markdown supports headings, bold/italic, lists, quotes, code blocks, links, tables, <font color=\'green|red|grey\'>…</font> and <at id=all></at>; platforms with basic Markdown drop the <font>/<at> tags. Only send when the user asks to share/push/send, or when a scheduled report instructs you to. Use action=list to see channels.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['send', 'list'], description: 'send (default) or list channels.' },
        channel: { type: 'string', description: 'Channel id or name; omit for the default channel.' },
        title: { type: 'string', description: 'Message title.' },
        text: { type: 'string', description: 'Markdown body: summary, conclusions, tables. Write it for the IM reader; do not paste raw result rows that are already attached via resultIds.' },
        chartMode: { type: 'string', enum: ['native', 'image', 'table'], description: 'How attached results render: native card charts, PNG images, or tables. Omit to use the channel default; unsupported modes fall back to it.' },
        resultIds: { type: 'array', items: { type: 'string' }, description: 'resultIds from nl2sql_query / nl2sql_chart / nl2sql_overview to include.' },
        includeSql: { type: 'boolean', description: 'Also include each result\'s SQL.' },
        attachFull: { type: 'boolean', description: 'Where the channel can send files (Lark app bot, Telegram), results with more rows than the message shows get the full data attached as an Excel file. Default true.' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => textBlock(JSON.stringify(value, null, 1)) },
    presentCall: (args) => ({ card: 'generic', title: args?.action === 'list' ? '列出推送渠道' : `推送到 ${args?.channel ?? '默认渠道'}：${args?.title ?? ''}`, kind: 'other' }),
    execute: async (args, exec) => {
      try {
        if (args.action === 'list') return { channels: service.listChannels().map(c => ({ ...pick(c, ['id', 'name', 'type', 'platform', 'description', 'isDefault']), ...(c.capabilities ? { capabilities: pick(c.capabilities, ['markdown', 'charts', 'tables', 'chartModes']) } : {}) })) }
        return await service.sendToChannel({ channelId: args.channel, title: args.title, text: args.text, resultIds: args.resultIds ?? [], includeSql: args.includeSql, attachFull: args.attachFull, chartMode: args.chartMode, source: 'agent', sessionId: exec.agent?.id })
      } catch (error) {
        throw error instanceof UserError ? new Error(error.message) : error
      }
    },
  })
}

function registerOverviewTool(ctx, service) {
  ctx.tools.register({
    name: 'nl2sql_overview',
    description: 'Generate an automatic overview of one table of the session data source: KPI totals, daily trend, weekly comparison, category distributions and top-N charts, chosen from the analyzed column roles. Each chart is shown to the user; you receive their resultIds and summaries. Set pin=true only when the user asks to put them on the dashboard.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table (or Elasticsearch index) name exactly as listed by nl2sql_schema.' },
        pin: { type: 'boolean', description: 'Also pin every generated chart to the Data Q&A dashboard.' },
        datasource: DATASOURCE_PARAM,
      },
      required: ['table'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value.model, null, 1)),
      presentationMeta: (_args, value) => value.display,
    },
    timeoutMs: 660000,
    presentCall: (args) => ({ card: 'generic', title: `自动概览 ${args?.table ?? ''}`, kind: 'read' }),
    execute: async (args, exec) => {
      try {
        const ds = service.datasourceForSession(exec.agent?.id, args.datasource)
        service.assertCanWriteSql(service.actorFor(exec.agent?.id), '生成自动概览')
        if (args.pin && service.actorFor(exec.agent?.id)) throw new Error('只有本机用户可以把图表固定到看板')
        const sessionId = exec.agent?.id
        const { table, results } = await service.tableOverview({ datasourceId: ds.id, table: args.table, pin: Boolean(args.pin), sessionId, actor: service.actorFor(sessionId), source: 'agent' })
        return {
          model: { table, pinned: Boolean(args.pin), charts: results.map(r => (r.error ? { title: r.title, error: r.error } : { title: r.title, ...service.modelView(r) })) },
          display: { overview: true, table, results: results.map(r => (r.error ? { title: r.title, sql: r.sql, error: r.error } : displayMeta(r))) },
        }
      } catch (error) {
        throw error instanceof UserError ? new Error(error.message) : error
      }
    },
  })
}

function registerKnowledgeTool(ctx, service) {
  ctx.tools.register({
    name: 'nl2sql_knowledge',
    description: 'Business knowledge of the session data source. action=search: find verified question→SQL examples, glossary terms and metric definitions related to `question`; call it before writing SQL for a non-trivial question and reuse matching definitions. action=save_example: after the user confirms a result is correct, store `question` and its final `sql` as a verified example for future questions.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'save_example'], description: 'search or save_example.' },
        question: { type: 'string', description: 'The user question (search) or the question to store (save_example).' },
        sql: { type: 'string', description: 'save_example only: the verified read-only SQL.' },
        datasource: DATASOURCE_PARAM,
      },
      required: ['action', 'question'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => textBlock(JSON.stringify(value, null, 1)) },
    isConcurrencySafe: (args) => args?.action === 'search',
    presentCall: (args) => ({ card: 'generic', title: args?.action === 'save_example' ? '保存样例问答' : '检索业务知识', kind: args?.action === 'save_example' ? 'edit' : 'search' }),
    execute: async (args, exec) => {
      try {
        const ds = service.datasourceForSession(exec.agent?.id, args.datasource)
        if (args.action === 'save_example') {
          if (!args.sql) throw new UserError('nl2sql/invalid', '`sql` is required for save_example')
          const who = service.actorFor(exec.agent?.id)
          if (who && who.role !== 'admin') throw new Error('只有本机用户或管理员可以保存样例问答')
          await service.saveKnowledgeItem({ datasourceId: ds.id, kind: 'example', item: { question: args.question, sql: args.sql } })
          return { saved: true, datasource: ds.name }
        }
        const found = service.searchKnowledge(ds.id, args.question)
        // Evaluation sessions must not see the reference answer they are graded against.
        const excluded = service.state.evalExclusions?.[exec.agent?.id]
        if (excluded) found.examples = found.examples.filter(e => e.id !== excluded)
        return { datasource: ds.name, ...found }
      } catch (error) {
        throw error instanceof UserError ? new Error(error.message) : error
      }
    },
  })
}

function displayMeta(result) {
  // Tool presentation metadata must be lossless JSON: drop undefined / non-finite values.
  return JSON.parse(JSON.stringify({
    resultId: result.resultId,
    datasourceId: result.datasourceId,
    datasourceName: result.datasourceName,
    title: result.title,
    sql: result.sql,
    rowCount: result.rowCount,
    truncated: result.truncated,
    elapsedMs: result.elapsedMs,
    chart: result.chart,
    columns: result.columns,
    ...(result.cached ? { cached: true } : {}),
  }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)))
}

// ---------------------------------------------------------------------- RPC

function registerRpc(ctx, service) {
  const methods = {
    // Feature modules (service/features.js) contribute RPCs as rpc(service) → { name: fn }.
    ...Object.assign({}, ...FEATURES.map(f => f.rpc?.(service) ?? {})),
    listDatasources: () => service.listDatasources(),
    saveDatasource: (p) => service.saveDatasource(p),
    deleteDatasource: (p) => service.deleteDatasource(p.id),
    setCurrent: (p) => service.setCurrent(p.id),
    testConnection: (p) => service.testConnection(p),
    analyzeSchema: (p) => service.annotatedSchema(p.id, { refresh: Boolean(p.refresh), ...(Array.isArray(p.tables) ? { tables: p.tables.slice(0, 200) } : {}) }),
    getSettings: () => service.getSettings(),
    saveSettings: (p) => service.saveSettings(p),
    runQuery: (p) => service.runQuery({ sql: p.sql, datasourceId: p.datasourceId, title: p.title, chart: p.chart, source: 'ui', confirmScan: Boolean(p.confirmScan), useCache: Boolean(p.useCache) }),
    getResult: (p) => service.getResult(p.resultId),
    sessionInfo: (p) => service.sessionInfo(p.sessionId),
    bindSession: (p) => service.bindSession(p.sessionId, p.datasourceId ?? null),
    listDashboard: (p) => service.listDashboard(p?.dashboardId),
    pinWidget: (p) => service.pinWidget(p),
    unpinWidget: (p) => service.unpinWidget(p.id),
    runWidget: (p) => service.runWidget(p.id, p.filters, { useCache: p.fresh !== true }),
    filterCandidates: (p) => service.filterCandidates(p?.dashboardId),
    getDashboardFilters: (p) => service.getDashboardFilters(p?.dashboardId),
    saveDashboardFilters: (p) => service.saveDashboardFilters(p.filters ?? [], p.dashboardId),
    submitFeedback: (p) => service.submitFeedback(p),
    listFeedback: (p) => service.listFeedback(p ?? {}),
    feedbackStats: (p) => service.feedbackStats(p?.datasourceId),
    resolveFeedback: (p) => service.resolveFeedback(p),
    deleteFeedback: (p) => service.deleteFeedback(p.id),
    savePolicy: (p) => service.savePolicy(p),
    listChannels: () => service.listChannels(),
    saveChannel: (p) => service.saveChannel(p),
    deleteChannel: (p) => service.deleteChannel(p.id),
    testChannel: (p) => service.testChannel(p.id),
    listChannelChats: (p) => service.listChannelChats(p ?? {}),
    channelCatalog: (p) => service.channelCatalog(p ?? {}),
    listChannelTargets: (p) => service.listChannelTargets(p ?? {}),
    sendToChannel: (p) => service.sendToChannel({ ...p, source: p.source === 'dashboard' ? 'dashboard' : 'ui' }),
    sendDashboard: (p) => service.sendDashboard(p),
    previewAssistantMessage: (p) => service.previewAssistantMessage(p),
    sendAssistantMessage: (p) => service.sendAssistantMessage(p),
    listDeliveries: (p) => service.listDeliveries(p?.limit ?? 100),
    listHistory: (p) => service.listHistory(p ?? {}),
    clearHistory: () => service.clearHistory(),
    deleteHistory: (p) => service.deleteHistory(p ?? {}),
    explain: (p) => service.explain({ sql: p.sql, datasourceId: p.datasourceId }),
    getKnowledge: (p) => service.getKnowledge(p.datasourceId),
    saveKnowledgeItem: (p) => service.saveKnowledgeItem(p),
    deleteKnowledgeItem: (p) => service.deleteKnowledgeItem(p),
    draftNotes: (p) => service.draftNotes(p.datasourceId),
    updateWidget: (p) => service.updateWidget(p),
    listReports: () => service.listReports(),
    saveReport: (p) => service.saveReport(p),
    setReportActive: (p) => service.setReportActive(p),
    runReportNow: (p) => service.runReportNow(p.id),
    deleteReport: (p) => service.deleteReport(p.id),
    tableOverview: (p) => service.tableOverview(p),
    dialects: () => Object.entries(DIALECTS).map(([id, d]) => ({ id, ...d })),
    moveWidget: (p) => service.moveWidget(p),
    listDashboards: () => service.listDashboards(),
    saveDashboard: (p) => service.saveDashboard(p),
    deleteDashboard: (p) => service.deleteDashboard(p.id),
    selectDashboard: (p) => service.selectDashboard(p.id),
    transferWidget: (p) => service.transferWidget(p),
    snapshotDashboard: (p) => service.snapshotDashboard(p ?? {}),
    listDashboardSnapshots: (p) => service.listDashboardSnapshots(p?.dashboardId),
    cacheStats: () => service.cacheStats(),
    exportExcel: (p) => service.exportExcel(p ?? {}),
    clearCache: () => service.clearCache(),
    exportKnowledge: (p) => service.exportKnowledge(p ?? {}),
    importKnowledge: (p) => service.importKnowledge(p),
    listSchemaChanges: (p) => service.listSchemaChanges(p ?? {}),
    ackSchemaChange: (p) => service.ackSchemaChange(p),
    checkAllSchemas: () => service.checkAllSchemas(),
    listUsers: () => service.listUsers(),
    listSeenIdentities: (p) => service.listSeenIdentities(p ?? {}),
    saveUser: (p) => service.saveUser(p),
    deleteUser: (p) => service.deleteUser(p.id),
    usageByActor: (p) => service.usageByActor(p?.days ?? 30),
    adminLog: () => service.records.list('admin', { limit: 200 }),
    larkBotStatus: () => service.larkBotStatus(),
    saveLarkBot: (p) => service.saveLarkBot(p),
    restartLarkBot: async () => { await service.restartLarkBot(); return service.larkBotStatus() },
    botStatus: () => service.botStatus(),
    saveBot: (p) => service.saveBot(p ?? {}),
    restartBot: async (p) => { await service.restartBot({ channelId: p?.channelId }); return (await service.botStatus()).find(b => b.channelId === p?.channelId) ?? null },
    queryMetric: (p) => service.queryMetric({ ...p, source: 'ui' }),
    parseUpload: (p) => service.parseUpload(p),
    importUpload: (p) => service.importUpload(p),
    listFileTables: (p) => service.listFileTables(p.datasourceId),
    dropFileTable: (p) => service.dropFileTable(p),
    drill: (p) => service.drill(p),
    drillDimensions: (p) => service.drillDimensions(p.resultId),
    explainChange: (p) => service.explainChange(p),
    evalSet: (p) => service.evalSet(p.datasourceId),
    setEvalCase: (p) => service.setEvalCase(p),
    runEval: (p) => service.runEval(p),
    listEvalRuns: (p) => service.listEvalRuns(p?.datasourceId),
    getEvalRun: (p) => service.getEvalRun(p.id),
    listAlerts: () => service.listAlerts(),
    saveAlert: (p) => service.saveAlert(p),
    deleteAlert: (p) => service.deleteAlert(p.id),
    checkAlert: (p) => service.checkAlert(p.id, { dryRun: Boolean(p.dryRun), force: Boolean(p.force) }),
    listAlertEvents: (p) => service.listAlertEvents(p?.alertId),
    previewAlert: (p) => service.previewAlert(p),
    schedulerStatus: () => service.schedulerStatus(),
    // Uploads staged on the server (upload once, import by uploadId).
    stageUpload: (p) => service.stageUpload(p),
    stageUploadChunk: (p) => service.stageUploadChunk(p),
    // Settings page.
    resetSettings: (p) => service.resetSettings(p ?? {}),
    storageStats: () => service.storageStats(),
    purgeRecords: (p) => service.purgeRecords(p ?? {}),
    exportConfig: () => service.exportConfig(),
    importConfig: (p) => service.importConfig(p ?? {}),
    aboutInfo: () => service.aboutInfo(),
    // Ask page and onboarding.
    askSuggestions: (p) => service.askSuggestions(p ?? {}),
    onboardingStatus: () => service.onboardingStatus(),
    dismissOnboarding: (p) => service.dismissOnboarding({ dismissed: p?.dismissed !== false }),
    reorderWidgets: (p) => service.reorderWidgets(p ?? {}),
    // Knowledge suggestions mined from history and feedback.
    listKnowledgeSuggestions: (p) => service.listKnowledgeSuggestions(p ?? {}),
    suggestionCount: (p) => service.suggestionCount(p ?? {}),
    acceptSuggestion: (p) => service.acceptSuggestion(p ?? {}),
    dismissSuggestion: (p) => service.dismissSuggestion(p ?? {}),
  }
  // One exact POST route inside Connection's authenticated /api fence:
  // body { method, payload } → { ok, value } | { ok: false, error }.
  ctx.connection.fetch.register({
    path: RPC_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return Response.json({ ok: false, error: { code: 'nl2sql/bad-request', message: 'body is not JSON' } }, { status: 400 })
      }
      const method = typeof body?.method === 'string' ? body.method : ''
      const fn = Object.hasOwn(methods, method) ? methods[method] : undefined
      if (!fn) return Response.json({ ok: false, error: { code: 'nl2sql/unknown-method', message: `unknown method ${method}` } }, { status: 404 })
      try {
        const value = await fn(body.payload ?? {})
        return Response.json({ ok: true, value: value ?? null }, { headers: { 'cache-control': 'no-store' } })
      } catch (error) {
        const e = toUserError(error)
        return Response.json({ ok: false, error: { code: e.code ?? 'nl2sql/error', message: e.message, ...(e.field ? { field: e.field } : {}) } }, { headers: { 'cache-control': 'no-store' } })
      }
    },
  })
}

export async function apply(ctx, config) {
  const service = new Nl2SqlService(ctx, config)
  await service.load()
  if (typeof config?.onService === 'function') config.onService(service) // test hook
  ctx.effect(() => () => service.dispose(), 'nl2sql: pools')
  registerRpc(ctx, service)
  registerTools(ctx, service)
  registerKnowledgeTool(ctx, service)
  registerOverviewTool(ctx, service)
  registerSendTool(ctx, service)
  // Inbound IM bots (Lark long connection, Telegram polling, …) for every enabled bot channel.
  service.startBots().catch(error => console.warn('nl2sql bot: start failed: %s', error.message))
  service.scheduleAlerts()
  registerAnalysisTools(ctx, service)
  // Feature modules register their own agent tools: tools(ctx, service, helpers).
  for (const f of FEATURES) f.tools?.(ctx, service, { displayMeta, textBlock, DATASOURCE_PARAM })
  for (const f of FEATURES) f.start?.(ctx, service)
}

function registerAnalysisTools(ctx, service) {
  const out = {
    schema: { type: 'object' },
    render: (_args, value) => textBlock(JSON.stringify(value.model ?? value, null, 1)),
    presentationMeta: (_args, value) => (value.display ? JSON.parse(JSON.stringify(value.display)) : value.why ? JSON.parse(JSON.stringify({ why: value.why })) : null),
  }
  const fail = (fn) => async (args, exec) => {
    try { return await fn(args ?? {}, exec) } catch (error) { throw error instanceof UserError ? new Error(error.message) : error }
  }
  ctx.tools.register({
    name: 'nl2sql_metric',
    description: 'Query a governed metric from the metric library by name (its expression, table, filter and time column are fixed by the definition — do not rewrite them yourself). Use this whenever the question asks for a metric that exists in the library (see nl2sql_knowledge search results). Optional time grain, dimensions (allowed ones only), time range and filters. Returns a chart result like nl2sql_query.',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'Metric name (or synonym) from the metric library.' },
        grain: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Time bucket; omit for a single total.' },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'Columns to split by (must be allowed by the metric).' },
        range: { type: 'string', enum: ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear'], description: 'Relative time range on the metric time column.' },
        from: { type: 'string', description: 'Start date (inclusive), YYYY-MM-DD; use instead of range.' },
        to: { type: 'string', description: 'End date (exclusive), YYYY-MM-DD.' },
        filters: { type: 'array', items: { type: 'object', properties: { column: { type: 'string' }, op: { type: 'string', enum: ['=', '!=', 'in', '>', '>=', '<', '<='] }, value: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['column', 'op'], additionalProperties: false }, description: 'Extra conditions.' },
        title: { type: 'string', description: 'Short chart title.' },
        datasource: DATASOURCE_PARAM,
      },
      required: ['metric'],
      additionalProperties: false,
    },
    output: out,
    timeoutMs: 660000,
    presentCall: (args) => ({ card: 'generic', title: `指标：${args?.metric ?? ''}`, kind: 'read' }),
    execute: fail(async (args, exec) => {
      const r = await service.queryMetric({ ...args, datasourceId: args.datasource, sessionId: exec.agent?.id, source: 'agent' })
      return { model: { ...service.modelView(r), metric: r.metric, sql: r.sql }, display: displayMeta(r) }
    }),
  })
  ctx.tools.register({
    name: 'nl2sql_drill',
    description: 'Drill into an existing result: mode=breakdown splits the result (or one point of it, via xValue) by a dimension column; mode=detail lists the raw rows behind one point; mode=why compares two periods of a time-series result and ranks dimensions by how much of the change they explain (attribution). Use mode=why for questions like "为什么昨天下降了".',
    parameters: {
      type: 'object',
      properties: {
        resultId: { type: 'string', description: 'resultId from nl2sql_query / nl2sql_metric.' },
        mode: { type: 'string', enum: ['breakdown', 'detail', 'why'] },
        xValue: { type: 'string', description: 'The x value (category or time bucket) to drill into.' },
        dimension: { type: 'string', description: 'breakdown: column to split by.' },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'why: candidate dimensions (default: inferred).' },
        current: { type: 'string', description: 'why: current period x value (default: last point).' },
        baseline: { type: 'string', description: 'why: baseline period x value (default: previous point).' },
      },
      required: ['resultId', 'mode'],
      additionalProperties: false,
    },
    output: out,
    timeoutMs: 660000,
    presentCall: (args) => ({ card: 'generic', title: args?.mode === 'why' ? '变化归因' : args?.mode === 'detail' ? `明细 ${args?.xValue ?? ''}` : `按 ${args?.dimension ?? ''} 拆分`, kind: 'read' }),
    execute: fail(async (args, exec) => {
      if (args.mode === 'why') {
        const r = await service.explainChange({ ...args, sessionId: exec.agent?.id })
        return { why: r, model: { summary: r.summary, current: r.current, baseline: r.baseline, measure: r.measure, dimensions: r.dimensions.slice(0, 5).map(d => d.attribution ? { dimension: d.dimension, concentration: Number(d.attribution.concentration.toFixed(2)), top: d.attribution.items.slice(0, 5) } : { dimension: d.dimension, error: d.error }) } }
      }
      const r = await service.drill({ ...args, sessionId: exec.agent?.id, source: 'agent' })
      return { model: service.modelView(r), display: displayMeta(r) }
    }),
  })
}

