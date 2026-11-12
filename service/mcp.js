/**
 * MCP server: other AI tools (Claude Desktop, Cursor, Cline, VS Code) reach the
 * plugin's governed data access through the Model Context Protocol.
 *
 * Transport: Streamable HTTP on 127.0.0.1 only (POST /mcp, plain JSON responses;
 * GET / DELETE → 405), disabled by default. Dual-era: legacy clients use the
 * `initialize` handshake (2024-11-05 … 2025-11-25, Mcp-Session-Id minted on
 * initialize); modern clients (2026-07-28) send per-request `_meta` and may call
 * `server/discover`. No dependencies beyond node:http / node:crypto.
 *
 * Security: bearer tokens created in the page (only SHA-256 hashes are stored);
 * every token maps to an actor — the owner, an existing member (scope, role,
 * row rules), or a role + data source list — and every query goes through
 * runQuery (read-only admission, access policy, row-level rules, masking,
 * audit with source 'mcp'). Foreign Origin → 403, non-local Host → 403
 * (DNS-rebinding defence), missing / invalid token → 401.
 *
 * State: state.mcp = { enabled, port, tokens: [{ id, name, hash, prefix, actor, createdAt, lastUsedAt }] }.
 */
import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DIALECTS } from '../drivers.js'
import { UserError, clampInt, newId, oneOf, requireText, summarize } from './shared.js'

export const MCP_DEFAULT_PORT = 47860
export const MCP_PATH = '/mcp'
/** Newest first. 2026-07-28 is stateless (per-request _meta); the others use initialize. */
export const MCP_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MODERN = new Set(['2026-07-28'])
const LATEST_LEGACY = '2025-11-25'
const MAX_BODY = 1 << 20
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const PKG = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) } catch { return {} } })()
const SERVER_INFO = { name: 'nl2sql', title: 'DeepSeek Harness Data Q&A (nl2sql)', version: PKG.version ?? '0.0.0' }
const INSTRUCTIONS = 'Governed, read-only access to enterprise databases configured in DeepSeek Harness Data Q&A. Start with list_datasources, then get_schema (overview, then specific tables) and search_knowledge for verified examples and metric definitions before writing SQL. Prefer query_metric for metrics in the metric library. Every statement is admitted read-only; access policies, member scopes and row-level rules are enforced server-side and every call is audited — do not try to work around refusals.'

const DS_PARAM = { type: 'string', description: 'Data source id or name from list_datasources. Omit to use the default one for this token.' }

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

/** Host header names a loopback host (any port). */
export function isLocalHost(host) {
  if (!host) return false
  const h = String(host).trim().toLowerCase()
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d+$/, '')
  return LOCAL_HOSTS.has(name)
}

/** Origin header absent, or a loopback origin. */
export function isLocalOrigin(origin) {
  if (origin === undefined || origin === null || origin === '') return true
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname.toLowerCase())
  } catch { return false }
}

/** Decode the `=?base64?…?=` sentinel used by Mcp-Name / Mcp-Param-* headers. */
function decodeHeaderValue(v) {
  const m = /^=\?base64\?(.*)\?=$/.exec(v ?? '')
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v
}

class RpcError extends Error {
  constructor(code, message, data, status) { super(message); this.rpcCode = code; this.data = data; this.status = status }
}

/** Tool definitions for external models. `extra(service)` decides runtime-optional tools. */
function toolDefs(service) {
  const ro = { readOnlyHint: true, openWorldHint: false }
  const defs = [
    {
      name: 'list_datasources',
      title: 'List data sources',
      description: 'List the databases this token may query: id, name, engine (MySQL, PostgreSQL, Elasticsearch, SQLite for uploaded files), database name, description and the SQL dialect to use. Call this first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: ro,
    },
    {
      name: 'get_schema',
      title: 'Read schema',
      description: 'Read the analyzed schema of a data source. Without `tables`: a compact overview of every visible table (role, approximate rows, comment, columns with semantic roles such as time/measure/enum/id/sensitive), relations, the SQL dialect notes, glossary and metric definitions. With `tables`: full column types, comments, indexes and sampled enum values for those tables. Tables and columns hidden by the access policy are not listed and cannot be queried.',
      inputSchema: {
        type: 'object',
        properties: {
          datasource: DS_PARAM,
          tables: { type: 'array', items: { type: 'string' }, description: 'Table names to describe in detail.' },
          question: { type: 'string', description: 'The user question; on large databases the overview then describes the most relevant tables in full.' },
        },
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'query',
      title: 'Run read-only SQL',
      description: 'Execute ONE read-only SQL statement (SELECT / WITH / SHOW / EXPLAIN) on a data source, written in its dialect: MySQL (backtick identifiers; 5.7 has no CTE/window functions; ONLY_FULL_GROUP_BY), PostgreSQL (date_trunc, CTEs, window functions), Elasticsearch SQL (indices are tables, no JOINs) or SQLite. Writes, DDL, multiple statements and system catalogs are refused. Rows are capped and a time limit applies; sensitive columns may be masked; row-level rules of this token are added automatically (then subqueries/CTE/UNION are refused). Depending on the privacy setting you receive the first rows, per-column statistics, or only the row count — plus a resultId usable with drill / explain_change. Prefer aggregated queries.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'The single read-only SQL statement.' },
          datasource: DS_PARAM,
          title: { type: 'string', description: 'Short human title for the result (shown in the audit log).' },
          confirmScan: { type: 'boolean', description: 'Set true only after a scan-guard refusal when the user accepts a full scan of a large table.' },
        },
        required: ['sql'],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'query_metric',
      title: 'Query a governed metric',
      description: 'Query a metric from the metric library by name or synonym. Its expression, table, filter and time column are fixed by the definition (see get_schema / search_knowledge) — do not re-derive them in SQL. Optional time grain, dimensions (allowed ones only), time range and filters.',
      inputSchema: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'Metric name or synonym.' },
          datasource: DS_PARAM,
          grain: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Time bucket; omit for a single total.' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Columns to split by.' },
          range: { type: 'string', enum: ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear'] },
          from: { type: 'string', description: 'Start date (inclusive), YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date (exclusive), YYYY-MM-DD.' },
          filters: { type: 'array', items: { type: 'object', properties: { column: { type: 'string' }, op: { type: 'string', enum: ['=', '!=', 'in', '>', '>=', '<', '<='] }, value: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['column', 'op'], additionalProperties: false } },
          title: { type: 'string' },
        },
        required: ['metric'],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'search_knowledge',
      title: 'Search business knowledge',
      description: 'Find verified question→SQL examples, glossary terms and metric definitions related to a question. Call it before writing SQL for a non-trivial question and reuse matching definitions.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, datasource: DS_PARAM }, required: ['question'], additionalProperties: false },
      annotations: ro,
    },
    {
      name: 'drill',
      title: 'Drill into a result',
      description: 'Drill into a previous result by resultId: mode=breakdown splits the result (or one x value of it) by a dimension column; mode=detail lists raw rows behind one x value. Row-level rules and policies are re-applied.',
      inputSchema: {
        type: 'object',
        properties: {
          resultId: { type: 'string' },
          mode: { type: 'string', enum: ['breakdown', 'detail'] },
          xValue: { type: 'string', description: 'The x value (category or time bucket) to drill into.' },
          dimension: { type: 'string', description: 'breakdown: column to split by.' },
        },
        required: ['resultId', 'mode'],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'explain_change',
      title: 'Explain a change',
      description: 'Compare two periods of a time-series result (resultId from query / query_metric) and rank dimensions by how much of the change they explain (attribution). Defaults to the last two points.',
      inputSchema: {
        type: 'object',
        properties: {
          resultId: { type: 'string' },
          current: { type: 'string', description: 'Current period x value (default: last point).' },
          baseline: { type: 'string', description: 'Baseline period x value (default: previous point).' },
          dimensions: { type: 'array', items: { type: 'string' }, description: 'Candidate dimensions (default: inferred).' },
        },
        required: ['resultId'],
        additionalProperties: false,
      },
      annotations: ro,
    },
  ]
  if (typeof service.reconcile === 'function') {
    const side = (d) => ({ type: 'object', description: d, properties: { sql: { type: 'string', description: 'One read-only SQL statement in that data source\'s dialect.' }, datasource: DS_PARAM }, required: ['sql'], additionalProperties: false })
    const pair = { type: 'array', items: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' }, tolerance: { type: 'number' }, relative: { type: 'boolean' } }, required: ['left'], additionalProperties: false } }
    defs.push({
      name: 'reconcile',
      title: 'Reconcile two query results',
      description: 'Reconcile / compare two read-only queries — typically the same business numbers from two data sources. Joins rows on key columns and reports matched keys, keys only on one side, value mismatches per compare column (optional numeric tolerance; relative=true for a fraction) and per-side totals. Each side runs through the same admission, policy and row-level rules as query.',
      inputSchema: {
        type: 'object',
        properties: {
          left: side('Left (reference) side'),
          right: side('Right side'),
          keys: { ...pair, description: 'Key columns identifying a row on both sides; right defaults to left.' },
          compare: { ...pair, description: 'Columns whose values must agree.' },
          title: { type: 'string' },
        },
        required: ['left', 'right', 'keys'],
        additionalProperties: false,
      },
      annotations: ro,
    })
  }
  if (typeof service.forecast === 'function') {
    defs.push({
      name: 'forecast',
      title: 'Forecast',
      description: 'Forecast a time-series result (resultId from query / query_metric) a few periods ahead with the plugin\'s forecasting feature (read-only).',
      inputSchema: { type: 'object', properties: { resultId: { type: 'string' }, horizon: { type: 'integer', minimum: 1, maximum: 90 } }, required: ['resultId'], additionalProperties: true },
      annotations: ro,
    })
  }
  return defs
}

const PROMPTS = [
  {
    name: 'ask_data',
    title: 'Answer a data question',
    description: 'Answer a business question from the governed databases.',
    arguments: [{ name: 'question', description: 'The business question', required: true }, { name: 'datasource', description: 'Data source name (optional)', required: false }],
  },
]

export const methods = {
  /** state.mcp, initialized lazily. */
  mcpState() {
    const s = this.state.mcp ??= {}
    s.enabled = Boolean(s.enabled)
    s.port ??= MCP_DEFAULT_PORT
    s.tokens ??= []
    return s
  },

  mcpPublicToken(tok) {
    const a = tok.actor ?? { kind: 'owner' }
    let scope
    if (a.memberId) {
      const u = (this.state.users ?? []).find(x => x.id === a.memberId)
      scope = { type: 'member', memberId: a.memberId, memberName: u?.name ?? null, missing: !u, disabled: Boolean(u?.disabled) }
    } else if (a.role) {
      scope = { type: 'role', role: a.role, datasourceIds: a.datasourceIds ?? null, datasourceNames: Array.isArray(a.datasourceIds) ? a.datasourceIds.map(id => this.findDatasource(id)?.name ?? id) : null, rowRules: a.rowRules ?? [] }
    } else scope = { type: 'owner' }
    return { id: tok.id, name: tok.name, prefix: tok.prefix, scope, createdAt: tok.createdAt, lastUsedAt: tok.lastUsedAt ?? null }
  },

  mcpStatus() {
    const s = this.mcpState()
    const running = Boolean(this.mcpServer?.listening)
    const port = running ? this.mcpServer.address().port : s.port
    return {
      enabled: s.enabled, port: s.port, running, error: this.mcpError ?? null,
      url: `http://127.0.0.1:${port}${MCP_PATH}`,
      protocolVersions: MCP_VERSIONS,
      tokens: s.tokens.map(t => this.mcpPublicToken(t)),
    }
  },

  async saveMcpSettings(input = {}) {
    const s = this.mcpState()
    const before = JSON.stringify([s.enabled, s.port])
    if (input.enabled !== undefined) s.enabled = Boolean(input.enabled)
    if (input.port !== undefined && input.port !== null && input.port !== '') s.port = clampInt(Number(input.port), 0, 65535, 'port')
    const changed = JSON.stringify([s.enabled, s.port]) !== before
    if (changed) this.auditAdmin('mcp.settings', `${s.enabled ? 'enabled' : 'disabled'} :${s.port}`)
    await this.save()
    if (changed || (s.enabled && !this.mcpServer)) await this.applyMcp()
    return this.mcpStatus()
  },

  /** Validate a token scope: { kind:'owner' } | { memberId } | { role, datasourceIds, rowRules? }. */
  mcpNormalizeScope(scope) {
    const sc = scope ?? { kind: 'owner' }
    if (sc.memberId) {
      const u = (this.state.users ?? []).find(x => x.id === sc.memberId)
      if (!u) throw new UserError('nl2sql/invalid', `成员不存在：${sc.memberId}`)
      return { memberId: u.id }
    }
    if (sc.role) {
      const role = oneOf(sc.role, ['admin', 'analyst', 'viewer'], 'role')
      const datasourceIds = sc.datasourceIds === null || sc.allDatasources ? null : (Array.isArray(sc.datasourceIds) ? sc.datasourceIds : []).filter(id => this.findDatasource(id))
      if (Array.isArray(datasourceIds) && !datasourceIds.length) throw new UserError('nl2sql/invalid', '请至少选择一个数据源')
      const rowRules = (Array.isArray(sc.rowRules) ? sc.rowRules : []).map(r => ({
        datasourceId: r.datasourceId && this.findDatasource(r.datasourceId) ? r.datasourceId : null,
        column: requireText(r.column, 'rowRules.column', 64),
        values: (Array.isArray(r.values) ? r.values : String(r.values ?? '').split(/[,，]/)).map(v => String(v).trim()).filter(Boolean).slice(0, 200),
      })).filter(r => r.values.length).slice(0, 20)
      if (rowRules.some(r => !/^[A-Za-z_\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*$/.test(r.column))) throw new UserError('nl2sql/invalid', '行级规则的字段名只能包含字母、数字、下划线或中文')
      return { role, datasourceIds, ...(rowRules.length ? { rowRules } : {}) }
    }
    if (sc.kind && sc.kind !== 'owner') throw new UserError('nl2sql/invalid', '无效的令牌范围')
    return { kind: 'owner' }
  },

  /** Create a token; the plain value is returned once and never stored. */
  async createMcpToken({ name, scope } = {}) {
    const s = this.mcpState()
    const tokenName = requireText(name, 'name', 60)
    if (s.tokens.some(t => t.name === tokenName)) throw new UserError('nl2sql/duplicate', `令牌名称已存在：${tokenName}`)
    if (s.tokens.length >= 50) throw new UserError('nl2sql/invalid', '令牌数量已达上限（50）')
    const actor = this.mcpNormalizeScope(scope)
    const token = `n2s_mcp_${randomBytes(24).toString('base64url')}`
    const rec = { id: newId('mt'), name: tokenName, hash: hashToken(token), prefix: token.slice(0, 12), actor, createdAt: Date.now(), lastUsedAt: null }
    s.tokens.push(rec)
    this.auditAdmin('mcp.token.create', `${tokenName}（${actor.memberId ? `member ${actor.memberId}` : actor.role ? `role ${actor.role}` : 'owner'}）`)
    await this.save()
    return { ...this.mcpPublicToken(rec), token }
  },

  async revokeMcpToken({ id } = {}) {
    const s = this.mcpState()
    const tok = s.tokens.find(t => t.id === id)
    if (!tok) throw new UserError('nl2sql/invalid', '令牌不存在')
    s.tokens = s.tokens.filter(t => t.id !== id)
    for (const [sid, sess] of this.mcpSessions ?? []) if (sess.tokenId === id) this.mcpSessions.delete(sid)
    this.auditAdmin('mcp.token.revoke', tok.name)
    await this.save()
    return { revoked: id }
  },

  /** The token record for a bearer value (constant-time hash comparison), or undefined. */
  mcpFindToken(bearer) {
    if (!bearer) return undefined
    const h = Buffer.from(hashToken(bearer), 'hex')
    let found
    for (const t of this.mcpState().tokens) {
      const other = Buffer.from(String(t.hash ?? ''), 'hex')
      if (other.length === h.length && timingSafeEqual(other, h)) found = t
    }
    return found
  },

  /** The actor a token runs as; re-resolved on every request so member changes apply at once. */
  mcpActor(tok) {
    const a = tok.actor ?? { kind: 'owner' }
    const label = `MCP · ${tok.name}`
    if (a.memberId) {
      const u = (this.state.users ?? []).find(x => x.id === a.memberId)
      if (!u || u.disabled) return undefined
      return { kind: 'mcp', id: u.id, name: `${u.name}（${label}）`, role: u.role, datasourceIds: u.datasourceIds ?? null, rowRules: u.rowRules ?? [], defaultDatasourceId: u.defaultDatasourceId ?? null, mcpTokenId: tok.id }
    }
    if (a.role) return { kind: 'mcp', id: `mcp:${tok.id}`, name: label, role: a.role, datasourceIds: a.datasourceIds ?? null, rowRules: a.rowRules ?? [], defaultDatasourceId: a.datasourceIds?.[0] ?? null, mcpTokenId: tok.id }
    // Owner tokens: full access (assertAccess passes kind 'owner'), audited under the token name.
    return { kind: 'owner', id: `mcp:${tok.id}`, name: label, mcpTokenId: tok.id }
  },

  mcpScoped(actor) { return Boolean(actor && actor.kind !== 'owner') },

  mcpVisibleDatasources(actor) {
    return this.state.datasources.filter(d => !this.mcpScoped(actor) || !Array.isArray(actor.datasourceIds) || actor.datasourceIds.includes(d.id))
  },

  /** Data source for an MCP call: explicit (checked), else the actor's default / first in scope, else the current one. */
  mcpDatasource(actor, ref) {
    if (ref) { const ds = this.requireDatasource(ref); this.assertAccess(actor, ds); return ds }
    const visible = this.mcpVisibleDatasources(actor)
    const pick = (this.mcpScoped(actor) ? this.findDatasource(actor.defaultDatasourceId) : this.findDatasource(this.state.current)) ?? visible[0]
    if (!pick || !visible.includes(pick)) {
      if (visible[0]) return visible[0]
      throw new UserError('nl2sql/no-datasource', this.state.datasources.length ? 'This token has no accessible data source.' : 'No data source is configured yet.')
    }
    return pick
  },

  /** The part of a result an external model may see, per the data source privacy settings. */
  mcpResultView(result) {
    const settings = this.settingsFor(this.findDatasource(result.datasourceId))
    const privacy = settings.resultToModel ?? 'summary'
    const view = {
      resultId: result.resultId,
      datasource: result.datasourceName,
      title: result.title || undefined,
      sql: result.sql,
      columns: result.columns.map(c => ({ name: c.name, kind: c.kind, ...(c.masked ? { masked: true } : {}) })),
      rowCount: result.rowCount,
      truncated: Boolean(result.truncated),
      elapsedMs: result.elapsedMs,
      privacy,
      ...(result.filters?.some(f => f.rowPolicy) ? { rowLevelFilters: result.filters.filter(f => f.rowPolicy).map(f => f.description) } : {}),
      ...(result.cached ? { cached: true } : {}),
    }
    if (privacy === 'rows') {
      const n = settings.modelRows ?? 20
      view.rows = result.rows.slice(0, n)
      view.rowsReturned = view.rows.length
      if (result.rowCount > view.rows.length) view.note = `Only the first ${view.rows.length} of ${result.rowCount} rows are returned (privacy setting). Aggregate in SQL instead of paging.`
    } else if (privacy === 'summary') {
      view.summary = summarize(result.columns, result.rows)
      view.note = 'Rows are not shared with external models by the privacy setting; per-column statistics are returned. Aggregate in SQL to get specific figures.'
    } else {
      view.note = 'The privacy setting shares no row data or statistics with external models; only the row count and columns are returned.'
    }
    return JSON.parse(JSON.stringify(view, (_k, v) => (typeof v === 'bigint' ? v.toString() : typeof v === 'number' && !Number.isFinite(v) ? null : v)))
  },

  /** Run one MCP tool as `actor`. Returns a plain object (structuredContent). */
  async mcpCallTool(name, args, actor) {
    const a = args && typeof args === 'object' ? args : {}
    const source = 'mcp'
    switch (name) {
      case 'list_datasources':
        return {
          datasources: this.mcpVisibleDatasources(actor).map(d => ({
            id: d.id, name: d.name, type: d.type ?? 'mysql', database: d.database, description: d.description || undefined,
            dialect: DIALECTS[d.type ?? 'mysql']?.sqlName, serverVersion: d.serverVersion || undefined,
          })),
        }
      case 'get_schema': {
        const ds = this.mcpDatasource(actor, a.datasource)
        const schema = await this.visibleSchema(ds)
        const tables = Array.isArray(a.tables) ? a.tables.map(String).slice(0, 50) : undefined
        return { datasource: ds.name, tableCount: schema.tables.length, text: this.schemaForModel(schema, ds, tables, { question: typeof a.question === 'string' ? a.question : undefined }).replace(/nl2sql_schema/g, 'get_schema').replace(/nl2sql_knowledge action=search/g, 'search_knowledge') }
      }
      case 'query': {
        if (typeof a.sql !== 'string' || !a.sql.trim()) throw new UserError('nl2sql/invalid', '`sql` is required')
        const ds = this.mcpDatasource(actor, a.datasource)
        const r = await this.runQuery({ sql: a.sql, datasourceId: ds.id, title: typeof a.title === 'string' ? a.title : '', source, actor, confirmScan: Boolean(a.confirmScan) })
        return this.mcpResultView(r)
      }
      case 'query_metric': {
        const ds = this.mcpDatasource(actor, a.datasource)
        const r = await this.queryMetric({ metric: a.metric, grain: a.grain, dimensions: Array.isArray(a.dimensions) ? a.dimensions : [], range: a.range, from: a.from, to: a.to, filters: Array.isArray(a.filters) ? a.filters : [], title: a.title, datasourceId: ds.id, source, actor })
        return { ...this.mcpResultView(r), metric: r.metric }
      }
      case 'search_knowledge': {
        const ds = this.mcpDatasource(actor, a.datasource)
        return { datasource: ds.name, ...this.searchKnowledge(ds.id, String(a.question ?? '')) }
      }
      case 'drill': {
        if (!['breakdown', 'detail'].includes(a.mode)) throw new UserError('nl2sql/invalid', 'mode must be breakdown or detail')
        const r = await this.drill({ resultId: a.resultId, mode: a.mode, xValue: a.xValue, dimension: a.dimension, actor, source })
        return this.mcpResultView(r)
      }
      case 'explain_change': {
        const r = await this.explainChange({ resultId: a.resultId, current: a.current, baseline: a.baseline, dimensions: Array.isArray(a.dimensions) ? a.dimensions : undefined, actor })
        return { summary: r.summary, current: r.current, baseline: r.baseline, measure: r.measure, additive: r.additive, dimensions: r.dimensions.slice(0, 8).map(d => (d.attribution ? { dimension: d.dimension, concentration: Number(d.attribution.concentration?.toFixed?.(2) ?? d.attribution.concentration), total: d.attribution.total, top: d.attribution.items.slice(0, 5) } : { dimension: d.dimension, error: d.error })) }
      }
      case 'reconcile': {
        if (typeof this.reconcile !== 'function') throw new RpcError(-32602, `Unknown tool: ${name}`)
        this.assertCanWriteSql(actor, 'write reconciliation SQL')
        const sideOf = (s) => ({ sql: s?.sql, datasourceId: this.mcpDatasource(actor, s?.datasource).id })
        const out = await this.reconcile({ left: sideOf(a.left), right: sideOf(a.right), keys: a.keys, compare: a.compare ?? [], title: a.title, actor, source })
        const privacy = [out.left.datasourceId, out.right.datasourceId].map(id => this.settingsFor(this.findDatasource(id)).resultToModel)
        return JSON.parse(JSON.stringify({
          title: out.title, left: out.left, right: out.right, summary: out.summary, warnings: out.warnings,
          resultIds: Object.fromEntries(out.results.map(r => [r.reconcilePart, r.resultId])),
          firstDiffs: privacy.every(p => p === 'rows') ? out.diffs.slice(0, 20) : `hidden by privacy settings (${privacy.join('/')})`,
        }))
      }
      case 'forecast': {
        if (typeof this[name] !== 'function') throw new RpcError(-32602, `Unknown tool: ${name}`)
        if (a.resultId) { const r = this.lookupResult(a.resultId); if (!r) throw new UserError('nl2sql/result-expired', 'Result expired; run the query again.'); this.assertResultAccess(r, actor) }
        const input = { ...a, actor, source }
        if (a.datasource) { const ds = this.mcpDatasource(actor, a.datasource); input.datasourceId = ds.id }
        const out = await this[name](input)
        return out?.rows && out?.columns && out?.resultId ? this.mcpResultView(out) : JSON.parse(JSON.stringify(out ?? null))
      }
      default:
        throw new RpcError(-32602, `Unknown tool: ${name}`)
    }
  },

  /** Handle one JSON-RPC message. Returns { status, body?, headers? }. */
  async mcpHandleMessage(msg, { tok, actor, headers, session }) {
    const isObj = msg && typeof msg === 'object' && !Array.isArray(msg)
    if (!isObj || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // A JSON-RPC response from the client (legacy) is accepted and ignored.
      if (isObj && msg.jsonrpc === '2.0' && ('result' in msg || 'error' in msg)) return { status: 202 }
      return { status: 400, body: { jsonrpc: '2.0', id: isObj && 'id' in msg ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } } }
    }
    const isNotification = !('id' in msg) || msg.id === undefined
    const id = isNotification ? undefined : msg.id
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {}
    const meta = params._meta ?? {}
    const bodyVersion = meta['io.modelcontextprotocol/protocolVersion']
    const headerVersion = headers['mcp-protocol-version']
    const modern = Boolean(bodyVersion) && msg.method !== 'initialize'
    const reply = (result, extra = {}) => ({ status: 200, body: { jsonrpc: '2.0', id, result: { ...(modern ? { _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } } : {}), ...result, resultType: 'complete' } }, ...extra })
    const fail = (code, message, data, status = 200) => ({ status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } } })

    // Version checks: modern _meta version, header/body agreement, header version support.
    if (modern) {
      if (!MCP_VERSIONS.includes(bodyVersion)) return fail(-32022, 'Unsupported protocol version', { supported: MCP_VERSIONS, requested: bodyVersion }, 400)
      if (headerVersion && headerVersion !== bodyVersion) return fail(-32020, `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match body '${bodyVersion}'`, undefined, 400)
      if (headers['mcp-method'] && headers['mcp-method'] !== msg.method) return fail(-32020, `Header mismatch: Mcp-Method '${headers['mcp-method']}' does not match body '${msg.method}'`, undefined, 400)
      const bodyName = params.name ?? params.uri
      if (headers['mcp-name'] !== undefined && bodyName !== undefined && decodeHeaderValue(headers['mcp-name']) !== String(bodyName)) return fail(-32020, 'Header mismatch: Mcp-Name does not match the body', undefined, 400)
    } else if (headerVersion && msg.method !== 'initialize' && !MCP_VERSIONS.includes(headerVersion)) {
      return fail(-32022, 'Unsupported protocol version', { supported: MCP_VERSIONS, requested: headerVersion }, 400)
    }

    if (isNotification) return { status: 202 } // notifications/initialized, cancelled, …

    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = String(params.protocolVersion ?? '')
          // Legacy handshake: echo a supported legacy version, else offer our latest legacy one.
          const version = MCP_VERSIONS.includes(requested) && !MODERN.has(requested) ? requested : LATEST_LEGACY
          const sid = randomBytes(16).toString('hex')
          this.mcpSessions ??= new Map()
          this.mcpSessions.set(sid, { tokenId: tok.id, version, at: Date.now(), client: params.clientInfo?.name })
          if (this.mcpSessions.size > 500) this.mcpSessions.delete(this.mcpSessions.keys().next().value)
          return reply({ protocolVersion: version, capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }, { headers: { 'mcp-session-id': sid } })
        }
        case 'server/discover':
          return reply({ supportedVersions: MCP_VERSIONS, capabilities: { tools: {}, resources: {}, prompts: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO }, instructions: INSTRUCTIONS })
        case 'ping':
          return reply({})
        case 'tools/list':
          return reply({ tools: toolDefs(this) })
        case 'tools/call': {
          const name = String(params.name ?? '')
          if (!toolDefs(this).some(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
          try {
            const value = await this.mcpCallTool(name, params.arguments ?? {}, actor)
            const text = typeof value?.text === 'string' && Object.keys(value).length <= 3 ? value.text : JSON.stringify(value, null, 1)
            return reply({ content: [{ type: 'text', text }], structuredContent: value && typeof value === 'object' && !Array.isArray(value) ? value : { value }, isError: false })
          } catch (error) {
            if (error instanceof RpcError) throw error
            // Tool execution errors go back to the model as results so it can correct itself.
            return reply({ content: [{ type: 'text', text: error.message ?? String(error) }], isError: true })
          }
        }
        case 'resources/list':
          return reply({
            resources: this.mcpVisibleDatasources(actor).map(d => ({
              uri: `nl2sql://datasource/${encodeURIComponent(d.id)}/schema`, name: `${d.name} schema`, title: `${d.name} — schema overview`,
              description: `Visible tables, columns, relations and dialect notes of ${d.name} (${DIALECTS[d.type ?? 'mysql']?.label ?? d.type}).`, mimeType: 'text/plain',
            })),
          })
        case 'resources/templates/list':
          return reply({ resourceTemplates: [{ uriTemplate: 'nl2sql://datasource/{id}/schema', name: 'Data source schema', description: 'Schema overview of a data source', mimeType: 'text/plain' }, { uriTemplate: 'nl2sql://datasource/{id}/table/{table}', name: 'Table schema', description: 'Full description of one table', mimeType: 'text/plain' }] })
        case 'resources/read': {
          const uri = String(params.uri ?? '')
          const m = /^nl2sql:\/\/datasource\/([^/]+)\/(schema|table\/(.+))$/.exec(uri)
          if (!m) return fail(-32002, 'Resource not found', { uri })
          let ds
          try { ds = this.mcpDatasource(actor, decodeURIComponent(m[1])) } catch { return fail(-32002, 'Resource not found', { uri }) }
          const schema = await this.visibleSchema(ds)
          const table = m[3] ? decodeURIComponent(m[3]) : undefined
          if (table && !schema.tables.some(t => t.name.toLowerCase() === table.toLowerCase())) return fail(-32002, 'Resource not found', { uri })
          const text = this.schemaForModel(schema, ds, table ? [table] : undefined).replace(/nl2sql_schema/g, 'get_schema').replace(/nl2sql_knowledge action=search/g, 'search_knowledge')
          return reply({ contents: [{ uri, mimeType: 'text/plain', text }] })
        }
        case 'resources/subscribe':
        case 'resources/unsubscribe':
          return reply({})
        case 'prompts/list':
          return reply({ prompts: PROMPTS })
        case 'prompts/get': {
          if (params.name !== 'ask_data') return fail(-32602, `Unknown prompt: ${params.name}`)
          const q = String(params.arguments?.question ?? '').trim()
          if (!q) return fail(-32602, 'Missing required argument: question')
          const dsName = params.arguments?.datasource ? ` on the data source "${params.arguments.datasource}"` : ''
          return reply({ description: 'Answer a data question with the nl2sql tools', messages: [{ role: 'user', content: { type: 'text', text: `Answer this business question${dsName} using the nl2sql tools: list_datasources → get_schema (overview, then the relevant tables) → search_knowledge → query (one read-only, aggregated statement in the data source dialect) or query_metric. Explain the result briefly and show the SQL you used.\n\nQuestion: ${q}` } }] })
        }
        case 'logging/setLevel':
          return reply({})
        default:
          return fail(-32601, `Method not found: ${msg.method}`, undefined, modern ? 404 : 200)
      }
    } catch (error) {
      if (error instanceof RpcError) return fail(error.rpcCode, error.message, error.data, error.status ?? 200)
      return fail(-32603, error.message ?? 'Internal error')
    }
  },

  /** node:http request handler for the MCP endpoint. */
  async mcpHandleHttp(req, res) {
    const send = (status, body, headers = {}) => {
      if (res.headersSent) return
      const h = { 'cache-control': 'no-store', ...headers }
      if (body === undefined) { res.writeHead(status, h); res.end(); return }
      const text = JSON.stringify(body)
      res.writeHead(status, { ...h, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
      res.end(text)
    }
    const rpcErr = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } })
    // DNS-rebinding defence: loopback Host only, and no foreign Origin.
    if (!isLocalHost(req.headers.host)) return send(403, rpcErr(-32600, 'Forbidden: Host must be localhost or 127.0.0.1'))
    if (!isLocalOrigin(req.headers.origin)) return send(403, rpcErr(-32600, 'Forbidden: Origin not allowed'))
    const path = (req.url ?? '/').split('?')[0]
    if (path !== MCP_PATH) return send(404, rpcErr(-32600, `Not found; the MCP endpoint is ${MCP_PATH}`))
    if (req.method !== 'POST') return send(405, rpcErr(-32600, 'Method Not Allowed: use POST'), { allow: 'POST' })
    // Authentication.
    const auth = String(req.headers.authorization ?? '')
    const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1]
    const tok = this.mcpFindToken(bearer)
    const actor = tok ? this.mcpActor(tok) : undefined
    if (!tok || !actor) return send(401, rpcErr(-32001, tok ? 'Unauthorized: the member of this token is disabled or deleted' : 'Unauthorized: missing or invalid bearer token'), { 'www-authenticate': 'Bearer realm="nl2sql-mcp"' })
    // Body.
    let size = 0
    const chunks = []
    try {
      for await (const c of req) {
        size += c.length
        if (size > MAX_BODY) return send(413, rpcErr(-32600, 'Request body too large'))
        chunks.push(c)
      }
    } catch { return }
    let msg
    try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(400, rpcErr(-32700, 'Parse error')) }
    // Legacy sessions: an unknown or foreign Mcp-Session-Id is a terminated session (404).
    const sid = req.headers['mcp-session-id']
    let session
    if (sid && !(Array.isArray(msg) ? msg : [msg]).some(m => m?.method === 'initialize')) {
      session = this.mcpSessions?.get(String(sid))
      if (!session || session.tokenId !== tok.id) return send(404, rpcErr(-32001, 'Session not found; initialize again'))
    }
    // lastUsedAt, persisted at most once a minute per token.
    const now = Date.now()
    if (!tok.lastUsedAt || now - tok.lastUsedAt > 60000) { tok.lastUsedAt = now; this.save() } else tok.lastUsedAt = now
    const ctx = { tok, actor, headers: req.headers, session }
    if (Array.isArray(msg)) {
      // JSON-RPC batch (2025-03-26): answer every request in one array.
      if (!msg.length) return send(400, rpcErr(-32600, 'Invalid Request'))
      const out = []
      let extra = {}
      for (const m of msg.slice(0, 50)) {
        const r = await this.mcpHandleMessage(m, ctx)
        if (r.body) out.push(r.body)
        if (r.headers) extra = { ...extra, ...r.headers }
      }
      return out.length ? send(200, out, extra) : send(202)
    }
    const r = await this.mcpHandleMessage(msg, ctx)
    return send(r.status, r.body, r.headers)
  },

  /** (Re)start or stop the server according to state.mcp. */
  async applyMcp() {
    await this.stopMcp()
    const s = this.mcpState()
    this.mcpError = null
    if (!s.enabled || this.disposed) return this.mcpStatus()
    const server = createServer((req, res) => {
      this.mcpHandleHttp(req, res).catch(error => {
        try { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message } })) } } catch {}
      })
    })
    server.requestTimeout = 15 * 60 * 1000
    server.headersTimeout = 30000
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(s.port, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      this.mcpServer = server
      server.on('error', (e) => { this.mcpError = e.message })
    } catch (error) {
      this.mcpError = error.code === 'EADDRINUSE' ? `端口 ${s.port} 已被占用` : error.message
      console.warn('nl2sql mcp: cannot listen on 127.0.0.1:%s: %s', s.port, error.message)
    }
    return this.mcpStatus()
  },

  async stopMcp() {
    const server = this.mcpServer
    this.mcpServer = undefined
    this.mcpSessions?.clear()
    if (!server) return
    await new Promise(resolve => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  },
}

export const FEATURE = {
  name: 'mcp',
  methods,
  rpc: (service) => ({
    mcpStatus: () => service.mcpStatus(),
    saveMcpSettings: (p) => service.saveMcpSettings(p ?? {}),
    createMcpToken: (p) => service.createMcpToken(p ?? {}),
    revokeMcpToken: (p) => service.revokeMcpToken(p ?? {}),
  }),
  start(ctx, service) {
    ctx.effect(() => () => service.stopMcp(), 'nl2sql: mcp server')
    service.applyMcp().catch(error => console.warn('nl2sql mcp: start failed: %s', error.message))
  },
}
