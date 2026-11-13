/**
 * MCP server: other AI tools (Claude Desktop, Claude Code, Cursor, VS Code, Cline,
 * Windsurf, Codex, Gemini CLI, Zed, Continue) reach the plugin's governed data
 * access through the Model Context Protocol.
 *
 * Specification revisions implemented (read from https://modelcontextprotocol.io/specification/):
 *   - 2026-07-28 (latest, stateless): https://modelcontextprotocol.io/specification/2026-07-28
 *     changelog https://modelcontextprotocol.io/specification/2026-07-28/changelog
 *   - 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 (initialize + Mcp-Session-Id):
 *     https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 *
 * Transport (Streamable HTTP, 127.0.0.1 only, disabled by default):
 *   https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 *   - POST /mcp. A request whose Accept lists text/event-stream gets a request-scoped SSE
 *     stream for tools/call (notifications/progress + notifications/message, then the
 *     response; `:` comment heartbeats; X-Accel-Buffering: no). Everything else: JSON.
 *   - 2026-07-28: subscriptions/listen opens a long-lived SSE stream (acknowledged first,
 *     notifications tagged with io.modelcontextprotocol/subscriptionId); closing a stream
 *     cancels its request; logging level per request via _meta io.modelcontextprotocol/logLevel.
 *   - legacy: GET /mcp with Mcp-Session-Id opens the standalone SSE stream carrying
 *     notifications/resources/updated (resources/subscribe per session) and
 *     notifications/resources/list_changed; notifications/cancelled by request id;
 *     logging/setLevel per session; DELETE ends a session.
 *
 * Security: bearer tokens created in the page (only SHA-256 hashes are stored), optional
 * expiry, tool allowlist and per-token rate limit; every token maps to an actor — the
 * owner, an existing member (scope, role, row rules), or a role + data source list — and
 * every query goes through runQuery (read-only admission, access policy, row-level rules,
 * masking, audit with source 'mcp'). Foreign Origin → 403, non-local Host → 403
 * (DNS-rebinding defence), missing / invalid / expired token → 401, rate limit → 429.
 * Per-token call log: records kind 'mcpCall' (no result rows; SQL capped at 2000 chars).
 *
 * State: state.mcp = { enabled, port, tokens: [{ id, name, hash, prefix, actor, createdAt,
 *   lastUsedAt, expiresAt?, tools?, rateLimit? }] }.
 */
import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DIALECTS } from '../drivers.js'
import { admitSql } from '../sql-guard.js'
import { checkAccess } from '../policy.js'
import { UserError, callContext, clampInt, newId, oneOf, requireText, summarize } from './shared.js'

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
const INSTRUCTIONS = 'Governed, read-only access to enterprise databases configured in DeepSeek Harness Data Q&A. Start with list_datasources, then get_schema (overview, then specific tables) and search_knowledge for verified examples and metric definitions before writing SQL. Prefer query_metric for metrics in the metric library (list_metrics). Every statement is admitted read-only; access policies, member scopes and row-level rules are enforced server-side and every call is audited — do not try to work around refusals.'
/** RFC 5424 levels, https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging */
export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']
/** Page sizes for cursor pagination (https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination). */
export const PAGE_SIZE = { tools: 50, resources: 50, templates: 50, prompts: 50 }
const HEARTBEAT_MS = 15000
const CSV_MAX_ROWS = 500
const CSV_MAX_BYTES = 256 * 1024
const WATCH_MS = 5000

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

/** Accept header lists text/event-stream. */
export function acceptsSse(accept) {
  return /(^|,)\s*text\/event-stream\s*(;|,|$)/i.test(String(accept ?? ''))
}

/** Feature gates per negotiated revision (capability matrix in docs/mcp.md). */
export function revisionFeatures(version) {
  const v = version ?? '2025-03-26'
  return {
    modern: MODERN.has(v),
    structuredContent: v >= '2025-06-18', // structured tool output + outputSchema (2025-06-18 changelog #2)
    resourceLinks: v >= '2025-06-18', // resource_link content (2025-06-18 changelog #7)
    annotations: v >= '2025-03-26', // tool annotations (2025-03-26 changelog #4)
    titles: v >= '2025-06-18', // `title` fields (2025-06-18 other changes #3)
    completions: v >= '2025-03-26', // completions capability (2025-03-26 other changes)
    batching: v === '2025-03-26', // JSON-RPC batches (added 2025-03-26, removed 2025-06-18)
    setLevel: !MODERN.has(v), // logging/setLevel removed in 2026-07-28 (per-request _meta logLevel)
    listen: MODERN.has(v), // subscriptions/listen replaces GET + resources/subscribe
    getStream: !MODERN.has(v) && v >= '2025-03-26',
  }
}

class RpcError extends Error {
  constructor(code, message, data, status) { super(message); this.rpcCode = code; this.data = data; this.status = status }
}

/** Opaque cursor: base64url of { o: offset, k: kind }. Invalid → -32602 per the pagination spec. */
function paginate(list, cursor, kind, size) {
  let offset = 0
  if (cursor !== undefined && cursor !== null) {
    try {
      const c = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
      if (c.k !== kind || !Number.isInteger(c.o) || c.o < 0 || c.o > list.length) throw new Error('bad')
      offset = c.o
    } catch { throw new RpcError(-32602, 'Invalid cursor') }
  }
  const page = list.slice(offset, offset + size)
  const next = offset + size < list.length ? Buffer.from(JSON.stringify({ k: kind, o: offset + size })).toString('base64url') : undefined
  return { page, ...(next ? { nextCursor: next } : {}) }
}

/** CSV text (RFC 4180 quoting). */
export function toCsv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(c => cell(c.name ?? c)).join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n')
}

const jsonSafe = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'bigint' ? x.toString() : typeof x === 'number' && !Number.isFinite(x) ? null : x)))

// ------------------------------------------------------------------ output schemas
// https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema
// Keep to a small JSON Schema subset (type / properties / required / items / enum) so
// clients and the test checker validate it easily.
const S = {
  str: { type: 'string' }, num: { type: 'number' }, int: { type: 'integer' }, bool: { type: 'boolean' },
  arr: (items) => ({ type: 'array', items }), obj: (properties, required = []) => ({ type: 'object', properties, required }),
}
const RESULT_SCHEMA = S.obj({
  resultId: S.str, datasource: S.str, title: S.str, sql: S.str,
  columns: S.arr(S.obj({ name: S.str, kind: S.str, masked: S.bool }, ['name'])),
  rowCount: S.int, truncated: S.bool, elapsedMs: S.num, privacy: { type: 'string', enum: ['none', 'summary', 'rows'] },
  rows: S.arr({ type: 'array' }), rowsReturned: S.int, summary: S.arr({ type: 'object' }), note: S.str,
  rowLevelFilters: S.arr(S.str), cached: S.bool, metric: { type: 'object' },
}, ['resultId', 'columns', 'rowCount', 'truncated', 'privacy'])
const OUTPUT_SCHEMAS = {
  list_datasources: S.obj({ datasources: S.arr(S.obj({ id: S.str, name: S.str, type: S.str, database: S.str, description: S.str, dialect: S.str, serverVersion: S.str }, ['id', 'name', 'type'])) }, ['datasources']),
  get_schema: S.obj({ datasource: S.str, tableCount: S.int, text: S.str }, ['datasource', 'tableCount', 'text']),
  query: RESULT_SCHEMA,
  query_metric: RESULT_SCHEMA,
  drill: RESULT_SCHEMA,
  search_knowledge: S.obj({ datasource: S.str, examples: S.arr({ type: 'object' }), glossary: S.arr({ type: 'object' }), metrics: S.arr({ type: 'object' }) }, ['datasource', 'examples', 'glossary', 'metrics']),
  explain_change: S.obj({ summary: S.str, current: {}, baseline: {}, measure: S.str, additive: S.bool, dimensions: S.arr({ type: 'object' }) }, ['dimensions']),
  list_metrics: S.obj({ datasource: S.str, metrics: S.arr(S.obj({ id: S.str, name: S.str, expression: S.str, table: S.str, filter: S.str, timeColumn: S.str, unit: S.str, description: S.str, dimensions: S.arr(S.str), synonyms: S.arr(S.str) }, ['name', 'expression'])) }, ['datasource', 'metrics']),
  list_dashboards: S.obj({ dashboards: S.arr(S.obj({ id: S.str, name: S.str, description: S.str, widgets: S.arr(S.obj({ id: S.str, title: S.str, datasource: S.str, chart: S.str }, ['id', 'title'])), filters: S.arr({ type: 'object' }) }, ['id', 'name', 'widgets'])) }, ['dashboards']),
  run_dashboard: S.obj({ dashboard: S.str, results: S.arr(S.obj({ widgetId: S.str, title: S.str, ok: S.bool, error: S.str, result: RESULT_SCHEMA }, ['widgetId', 'title', 'ok'])), skipped: S.arr(S.obj({ widgetId: S.str, title: S.str, reason: S.str }, ['widgetId', 'reason'])) }, ['dashboard', 'results']),
  data_freshness: S.obj({ datasource: S.str, checkedAt: { type: ['integer', 'null'] }, staleCount: S.int, tables: S.arr(S.obj({ table: S.str, column: S.str, latestLocal: { type: ['string', 'null'] }, lagMinutes: { type: ['number', 'null'] }, thresholdHours: S.num, status: S.str }, ['table', 'status'])) }, ['datasource', 'staleCount', 'tables']),
  explain_sql: S.obj({ datasource: S.str, dialect: S.str, admitted: S.bool, sql: S.str, head: S.str, refusal: S.str, plan: S.arr({ type: 'object' }), scans: S.arr(S.obj({ table: S.str, rows: S.num }, ['table'])), scanGuard: S.obj({ threshold: S.int, wouldRefuse: S.bool }, ['threshold', 'wouldRefuse']), rowLevelRules: S.arr(S.str), note: S.str }, ['datasource', 'admitted']),
}

/** Tool definitions for external models. Runtime-optional tools depend on the service. */
export function toolDefs(service) {
  // https://modelcontextprotocol.io/specification/2025-03-26/server/tools (annotations, 2025-03-26)
  const ann = (title, { idempotent = true } = {}) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false })
  const defs = [
    {
      name: 'list_datasources',
      title: 'List data sources',
      description: 'List the databases this token may query: id, name, engine (MySQL, PostgreSQL, Elasticsearch, SQLite for uploaded files), database name, description and the SQL dialect to use. Call this first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
    },
    {
      name: 'query',
      title: 'Run read-only SQL',
      description: 'Execute ONE read-only SQL statement (SELECT / WITH / SHOW / EXPLAIN) on a data source, written in its dialect: MySQL (backtick identifiers; 5.7 has no CTE/window functions; ONLY_FULL_GROUP_BY), PostgreSQL (date_trunc, CTEs, window functions), Elasticsearch SQL (indices are tables, no JOINs) or SQLite. Writes, DDL, multiple statements and system catalogs are refused. Rows are capped and a time limit applies; sensitive columns may be masked; row-level rules of this token are added automatically (then subqueries/CTE/UNION are refused). Depending on the privacy setting you receive the first rows, per-column statistics, or only the row count — plus a resultId usable with drill / explain_change and as the resource nl2sql://result/{resultId}. Prefer aggregated queries.',
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
      idempotent: false,
    },
    {
      name: 'query_metric',
      title: 'Query a governed metric',
      description: 'Query a metric from the metric library by name or synonym (see list_metrics). Its expression, table, filter and time column are fixed by the definition — do not re-derive them in SQL. Optional time grain, dimensions (allowed ones only), time range and filters.',
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
      idempotent: false,
    },
    {
      name: 'search_knowledge',
      title: 'Search business knowledge',
      description: 'Find verified question→SQL examples, glossary terms and metric definitions related to a question. Call it before writing SQL for a non-trivial question and reuse matching definitions.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, datasource: DS_PARAM }, required: ['question'], additionalProperties: false },
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
      idempotent: false,
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
    },
    {
      name: 'list_metrics',
      title: 'List governed metrics',
      description: 'List the metric library of a data source: name, synonyms, expression, table, filter, time column, unit and allowed dimensions. Use the names with query_metric.',
      inputSchema: { type: 'object', properties: { datasource: DS_PARAM }, additionalProperties: false },
    },
    {
      name: 'list_dashboards',
      title: 'List dashboards',
      description: 'List dashboards with their widgets (id, title, data source, chart type) and global filters. Only widgets on data sources this token may use are listed.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'run_dashboard',
      title: 'Run a dashboard',
      description: 'Run the widgets of a dashboard (governed SQL; viewers may use it) with optional global filters, e.g. [{"kind":"time","column":"created_at","range":"last7d"}] or [{"kind":"in","column":"status","values":["1"]}]. Returns per-widget results shaped by the privacy setting (rows / statistics / counts). Widgets on data sources outside this token\'s scope are skipped.',
      inputSchema: {
        type: 'object',
        properties: {
          dashboard: { type: 'string', description: 'Dashboard id or name (list_dashboards).' },
          widgets: { type: 'array', items: { type: 'string' }, description: 'Only these widget ids (default: all, at most 12).' },
          filters: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['time', 'in'] }, column: { type: 'string' }, range: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'column'], additionalProperties: false }, description: 'Global filters replacing the dashboard\'s saved ones.' },
        },
        required: ['dashboard'],
        additionalProperties: false,
      },
      idempotent: false,
    },
    {
      name: 'explain_sql',
      title: 'Explain / dry-run SQL',
      description: 'Dry-run admission of one SQL statement without returning rows: read-only admission, access policy and row-level rule checks, then the database EXPLAIN plan for SELECTs, with full scans and whether the scan guard would refuse it. Use it to check a statement before running query.',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' }, datasource: DS_PARAM }, required: ['sql'], additionalProperties: false },
    },
  ]
  if (typeof service.freshnessFor === 'function') {
    defs.push({
      name: 'data_freshness',
      title: 'Data freshness',
      description: 'How fresh the data of a data source is: per table the latest timestamp of its main time column, lag, stale threshold and status (ok / warn / stale / empty). Check it before answering questions about recent periods and warn when stale.',
      inputSchema: { type: 'object', properties: { datasource: DS_PARAM, tables: { type: 'array', items: { type: 'string' }, description: 'Only these tables.' }, refresh: { type: 'boolean', description: 'Measure now instead of using the last check.' } }, additionalProperties: false },
    })
  }
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
      idempotent: false,
    })
  }
  if (typeof service.forecast === 'function') {
    defs.push({
      name: 'forecast',
      title: 'Forecast',
      description: 'Forecast a time-series result (resultId from query / query_metric) a few periods ahead with the plugin\'s forecasting feature (read-only).',
      inputSchema: { type: 'object', properties: { resultId: { type: 'string' }, horizon: { type: 'integer', minimum: 1, maximum: 90 } }, required: ['resultId'], additionalProperties: true },
    })
  }
  return defs.map(({ idempotent, ...d }) => ({ ...d, annotations: ann(d.title, { idempotent: idempotent !== false }), ...(OUTPUT_SCHEMAS[d.name] ? { outputSchema: OUTPUT_SCHEMAS[d.name] } : {}) }))
}

/** Tool definitions shaped for a revision: no outputSchema before 2025-06-18, no annotations before 2025-03-26, no title before 2025-06-18. */
function toolsForVersion(defs, version) {
  const f = revisionFeatures(version)
  return defs.map(({ outputSchema, annotations, title, ...d }) => ({
    ...d,
    ...(f.titles ? { title } : {}),
    ...(f.annotations ? { annotations } : {}),
    ...(f.structuredContent && outputSchema ? { outputSchema } : {}),
  }))
}

export const PROMPTS = [
  {
    name: 'ask_data',
    title: 'Answer a data question',
    description: 'Answer a business question from the governed databases.',
    arguments: [{ name: 'question', description: 'The business question', required: true }, { name: 'datasource', description: 'Data source name (optional)', required: false }],
  },
  {
    name: 'analyze_table',
    title: 'Analyze a table',
    description: 'Profile one table: what it holds, its key dimensions and measures, recent trend and data quality notes.',
    arguments: [{ name: 'datasource', description: 'Data source name', required: true }, { name: 'table', description: 'Table name', required: true }],
  },
  {
    name: 'compare_periods',
    title: 'Compare two periods of a metric',
    description: 'Compare a governed metric between the current and the previous period and explain what drove the change.',
    arguments: [{ name: 'metric', description: 'Metric name from the metric library', required: true }, { name: 'period', description: 'day | week | month (default week)', required: false }, { name: 'datasource', description: 'Data source name (optional)', required: false }],
  },
  {
    name: 'reconcile_sources',
    title: 'Reconcile two sources',
    description: 'Check that the same business figures agree between two data sources (or two queries).',
    arguments: [{ name: 'left', description: 'What the left (reference) side is, e.g. "orders DB, daily paid amount"', required: true }, { name: 'right', description: 'What the right side is, e.g. "finance DB, daily settled amount"', required: true }],
  },
]

/** Which completion source an argument uses. */
const COMPLETE_ARGS = { datasource: 'datasource', table: 'table', metric: 'metric', id: 'datasource', period: 'period' }

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
    return {
      id: tok.id, name: tok.name, prefix: tok.prefix, scope, createdAt: tok.createdAt, lastUsedAt: tok.lastUsedAt ?? null,
      expiresAt: tok.expiresAt ?? null, expired: Boolean(tok.expiresAt && tok.expiresAt <= Date.now()),
      tools: Array.isArray(tok.tools) ? tok.tools : null, rateLimit: tok.rateLimit ?? null, rotatedAt: tok.rotatedAt ?? null,
    }
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
      toolNames: toolDefs(this).map(t => t.name),
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

  /** Normalize the optional limits: expiresAt (ms, future or null), tools (allowlist of known names or null), rateLimit (requests/min or null). */
  mcpNormalizeLimits(input, { partial = false } = {}) {
    const out = {}
    if (!partial || input.expiresAt !== undefined) {
      const v = input.expiresAt
      if (v === undefined || v === null || v === '' || v === 0) out.expiresAt = null
      else {
        const ms = typeof v === 'number' ? v : Date.parse(String(v))
        if (!Number.isFinite(ms)) throw new UserError('nl2sql/invalid', '过期时间无效')
        if (ms <= Date.now()) throw new UserError('nl2sql/invalid', '过期时间必须晚于现在')
        out.expiresAt = Math.floor(ms)
      }
    }
    if (!partial || input.tools !== undefined) {
      if (input.tools === undefined || input.tools === null) out.tools = null
      else {
        if (!Array.isArray(input.tools)) throw new UserError('nl2sql/invalid', 'tools 必须是工具名数组')
        const known = new Set(toolDefs(this).map(t => t.name))
        const bad = input.tools.filter(n => !known.has(n))
        if (bad.length) throw new UserError('nl2sql/invalid', `未知工具：${bad.join(', ')}`)
        if (!input.tools.length) throw new UserError('nl2sql/invalid', '请至少允许一个工具')
        out.tools = [...new Set(input.tools.map(String))]
      }
    }
    if (!partial || input.rateLimit !== undefined) {
      const v = input.rateLimit
      out.rateLimit = v === undefined || v === null || v === '' || v === 0 ? null : clampInt(Number(v), 1, 10000, 'rateLimit')
    }
    return out
  },

  /** Create a token; the plain value is returned once and never stored. */
  async createMcpToken({ name, scope, expiresAt, tools, rateLimit } = {}) {
    const s = this.mcpState()
    const tokenName = requireText(name, 'name', 60)
    if (s.tokens.some(t => t.name === tokenName)) throw new UserError('nl2sql/duplicate', `令牌名称已存在：${tokenName}`)
    if (s.tokens.length >= 50) throw new UserError('nl2sql/invalid', '令牌数量已达上限（50）')
    const actor = this.mcpNormalizeScope(scope)
    const limits = this.mcpNormalizeLimits({ expiresAt, tools, rateLimit })
    const token = `n2s_mcp_${randomBytes(24).toString('base64url')}`
    const rec = { id: newId('mt'), name: tokenName, hash: hashToken(token), prefix: token.slice(0, 12), actor, createdAt: Date.now(), lastUsedAt: null, ...limits }
    s.tokens.push(rec)
    this.auditAdmin('mcp.token.create', `${tokenName}（${actor.memberId ? `member ${actor.memberId}` : actor.role ? `role ${actor.role}` : 'owner'}）`)
    await this.save()
    return { ...this.mcpPublicToken(rec), token }
  },

  /** Update name / scope / allowlist / limits. Never re-reveals the secret. */
  async updateMcpToken({ id, name, scope, expiresAt, tools, rateLimit } = {}) {
    const s = this.mcpState()
    const tok = s.tokens.find(t => t.id === id)
    if (!tok) throw new UserError('nl2sql/invalid', '令牌不存在')
    if (name !== undefined) {
      const n = requireText(name, 'name', 60)
      if (s.tokens.some(t => t.name === n && t.id !== id)) throw new UserError('nl2sql/duplicate', `令牌名称已存在：${n}`)
      tok.name = n
    }
    if (scope !== undefined) tok.actor = this.mcpNormalizeScope(scope)
    Object.assign(tok, this.mcpNormalizeLimits({ expiresAt, tools, rateLimit }, { partial: true }))
    tok.updatedAt = Date.now()
    this.auditAdmin('mcp.token.update', tok.name)
    await this.save()
    return this.mcpPublicToken(tok)
  },

  /** New secret for an existing token (shown once); the old one stops working at once. */
  async rotateMcpToken({ id } = {}) {
    const tok = this.mcpState().tokens.find(t => t.id === id)
    if (!tok) throw new UserError('nl2sql/invalid', '令牌不存在')
    const token = `n2s_mcp_${randomBytes(24).toString('base64url')}`
    tok.hash = hashToken(token)
    tok.prefix = token.slice(0, 12)
    tok.rotatedAt = Date.now()
    this.mcpDropToken(id)
    this.auditAdmin('mcp.token.rotate', tok.name)
    await this.save()
    return { ...this.mcpPublicToken(tok), token }
  },

  async revokeMcpToken({ id } = {}) {
    const s = this.mcpState()
    const tok = s.tokens.find(t => t.id === id)
    if (!tok) throw new UserError('nl2sql/invalid', '令牌不存在')
    s.tokens = s.tokens.filter(t => t.id !== id)
    this.mcpDropToken(id)
    this.auditAdmin('mcp.token.revoke', tok.name)
    await this.save()
    return { revoked: id }
  },

  /** End sessions, streams and in-flight calls of a token (revoked / rotated). */
  mcpDropToken(id) {
    for (const [sid, sess] of this.mcpSessions ?? []) if (sess.tokenId === id) this.mcpEndSession(sid)
    for (const l of [...(this.mcpListeners ?? [])]) if (l.tokenId === id) l.close()
    for (const c of this.mcpInflight?.values() ?? []) if (c.tokenId === id) c.abort('token revoked')
    this.mcpRate?.delete(id)
  },

  mcpEndSession(sid) {
    const sess = this.mcpSessions?.get(sid)
    if (!sess) return
    this.mcpSessions.delete(sid)
    sess.stream?.close()
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

  /** Tools a token may use (allowlist ∩ installed). */
  mcpToolsFor(tok) {
    const all = toolDefs(this)
    return Array.isArray(tok?.tools) ? all.filter(t => tok.tools.includes(t.name)) : all
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
    return jsonSafe(view)
  },

  /** Warnings worth a notifications/message for a result view (truncation, redaction, masking). */
  mcpResultWarnings(view) {
    const w = []
    if (!view || typeof view !== 'object') return w
    if (view.truncated) w.push({ level: 'warning', data: { event: 'truncated', resultId: view.resultId, message: `Result truncated at ${view.rowCount} rows (row cap). Aggregate in SQL.` } })
    if (view.privacy && view.privacy !== 'rows') w.push({ level: 'notice', data: { event: 'privacy-redaction', resultId: view.resultId, privacy: view.privacy, message: view.privacy === 'none' ? 'Rows and statistics withheld by the privacy setting.' : 'Rows withheld by the privacy setting; statistics returned.' } })
    else if (view.rows && view.rowCount > (view.rowsReturned ?? 0)) w.push({ level: 'notice', data: { event: 'privacy-row-cap', resultId: view.resultId, message: view.note } })
    if (view.columns?.some(c => c.masked)) w.push({ level: 'notice', data: { event: 'masked-columns', resultId: view.resultId, columns: view.columns.filter(c => c.masked).map(c => c.name) } })
    return w
  },

  /** Run one MCP tool as `actor`. Returns a plain object (structuredContent). `ctx.log(level, data)` emits notifications/message. */
  async mcpCallTool(name, args, actor, ctx = {}) {
    const a = args && typeof args === 'object' ? args : {}
    const source = 'mcp'
    const log = ctx.log ?? (() => {})
    switch (name) {
      case 'list_datasources':
        return {
          datasources: this.mcpVisibleDatasources(actor).map(d => jsonSafe({
            id: d.id, name: d.name, type: d.type ?? 'mysql', database: d.database ?? undefined, description: d.description || undefined,
            dialect: DIALECTS[d.type ?? 'mysql']?.sqlName, serverVersion: d.serverVersion || undefined,
          })),
        }
      case 'get_schema': {
        const ds = this.mcpDatasource(actor, a.datasource)
        const schema = await this.visibleSchema(ds)
        const tables = Array.isArray(a.tables) ? a.tables.map(String).slice(0, 50) : undefined
        return { datasource: ds.name, tableCount: schema.tables.length, text: this.mcpSchemaText(schema, ds, tables, typeof a.question === 'string' ? a.question : undefined) }
      }
      case 'query': {
        if (typeof a.sql !== 'string' || !a.sql.trim()) throw new UserError('nl2sql/invalid', '`sql` is required')
        const ds = this.mcpDatasource(actor, a.datasource)
        ctx.ds = ds
        const r = await this.runQuery({ sql: a.sql, datasourceId: ds.id, title: typeof a.title === 'string' ? a.title : '', source, actor, confirmScan: Boolean(a.confirmScan) })
        return this.mcpResultView(r)
      }
      case 'query_metric': {
        const ds = this.mcpDatasource(actor, a.datasource)
        ctx.ds = ds
        const r = await this.queryMetric({ metric: a.metric, grain: a.grain, dimensions: Array.isArray(a.dimensions) ? a.dimensions : [], range: a.range, from: a.from, to: a.to, filters: Array.isArray(a.filters) ? a.filters : [], title: a.title, datasourceId: ds.id, source, actor })
        return { ...this.mcpResultView(r), metric: r.metric }
      }
      case 'search_knowledge': {
        const ds = this.mcpDatasource(actor, a.datasource)
        return jsonSafe({ datasource: ds.name, ...this.searchKnowledge(ds.id, String(a.question ?? '')) })
      }
      case 'drill': {
        if (!['breakdown', 'detail'].includes(a.mode)) throw new UserError('nl2sql/invalid', 'mode must be breakdown or detail')
        const r = await this.drill({ resultId: a.resultId, mode: a.mode, xValue: a.xValue, dimension: a.dimension, actor, source })
        return this.mcpResultView(r)
      }
      case 'explain_change': {
        const r = await this.explainChange({ resultId: a.resultId, current: a.current, baseline: a.baseline, dimensions: Array.isArray(a.dimensions) ? a.dimensions : undefined, actor })
        return jsonSafe({ summary: r.summary, current: r.current, baseline: r.baseline, measure: r.measure, additive: r.additive, dimensions: r.dimensions.slice(0, 8).map(d => (d.attribution ? { dimension: d.dimension, concentration: Number(d.attribution.concentration?.toFixed?.(2) ?? d.attribution.concentration), total: d.attribution.total, top: d.attribution.items.slice(0, 5) } : { dimension: d.dimension, error: d.error })) })
      }
      case 'list_metrics': {
        const ds = this.mcpDatasource(actor, a.datasource)
        return { datasource: ds.name, metrics: this.mcpMetrics(ds) }
      }
      case 'list_dashboards':
        return { dashboards: this.mcpDashboards(actor) }
      case 'run_dashboard': {
        const d = this.mcpFindDashboard(actor, a.dashboard)
        const only = Array.isArray(a.widgets) ? a.widgets.map(String) : null
        const filters = Array.isArray(a.filters) ? a.filters : undefined
        const results = []
        const skipped = []
        const widgets = d.widgets.filter(w => !only || only.includes(w.id))
        for (const w of widgets) {
          if (results.length >= 12) { skipped.push({ widgetId: w.id, title: w.title, reason: 'limit of 12 widgets per call' }); continue }
          const ds = this.findDatasource(w.datasourceId)
          if (!ds || !this.mcpVisibleDatasources(actor).includes(ds)) { skipped.push({ widgetId: w.id, title: w.title, reason: 'data source outside this token\'s scope' }); continue }
          if (ctx.signal?.aborted) break
          ctx.phase?.('widget', { title: w.title, index: results.length + 1, total: Math.min(widgets.length, 12) })
          try {
            const r = await this.runQuery({ governed: true, sql: w.sql, datasourceId: ds.id, title: `${d.name} · ${w.title}`, chart: w.chart, source, confirmScan: true, filters: filters ?? d.filters ?? [], useCache: true, actor })
            results.push({ widgetId: w.id, title: w.title, ok: true, result: this.mcpResultView(r) })
          } catch (error) {
            if (error.code === 'query/cancelled') throw error
            results.push({ widgetId: w.id, title: w.title, ok: false, error: error.message })
          }
        }
        return jsonSafe({ dashboard: d.name, results, ...(skipped.length ? { skipped } : {}) })
      }
      case 'data_freshness': {
        if (typeof this.freshnessFor !== 'function') throw new RpcError(-32602, `Unknown tool: ${name}`)
        const ds = this.mcpDatasource(actor, a.datasource)
        const view = await this.freshnessFor({ datasourceId: ds.id, refresh: Boolean(a.refresh) })
        const schema = await this.cachedVisibleSchema(ds)
        const visible = schema ? new Set(schema.tables.map(t => t.name)) : null
        const only = Array.isArray(a.tables) ? new Set(a.tables.map(String)) : null
        const tables = view.tables.filter(t => (!visible || visible.has(t.table)) && (!only || only.has(t.table))).map(t => jsonSafe({ table: t.table, column: t.column, latestLocal: t.latestLocal ?? null, lagMinutes: t.lagMinutes ?? null, thresholdHours: t.thresholdHours, status: t.status }))
        const out = { datasource: ds.name, checkedAt: view.checkedAt ?? null, staleCount: tables.filter(t => t.status === 'stale').length, tables }
        if (out.staleCount) log('warning', { event: 'stale-data', datasource: ds.name, tables: tables.filter(t => t.status === 'stale').map(t => t.table), message: `${out.staleCount} table(s) are stale; recent figures may be incomplete.` })
        return out
      }
      case 'explain_sql':
        return this.mcpExplainSql(a, actor)
      case 'reconcile': {
        if (typeof this.reconcile !== 'function') throw new RpcError(-32602, `Unknown tool: ${name}`)
        this.assertCanWriteSql(actor, 'write reconciliation SQL')
        const sideOf = (s) => ({ sql: s?.sql, datasourceId: this.mcpDatasource(actor, s?.datasource).id })
        const out = await this.reconcile({ left: sideOf(a.left), right: sideOf(a.right), keys: a.keys, compare: a.compare ?? [], title: a.title, actor, source })
        const privacy = [out.left.datasourceId, out.right.datasourceId].map(id => this.settingsFor(this.findDatasource(id)).resultToModel)
        return jsonSafe({
          title: out.title, left: out.left, right: out.right, summary: out.summary, warnings: out.warnings,
          resultIds: Object.fromEntries(out.results.map(r => [r.reconcilePart, r.resultId])),
          firstDiffs: privacy.every(p => p === 'rows') ? out.diffs.slice(0, 20) : `hidden by privacy settings (${privacy.join('/')})`,
        })
      }
      case 'forecast': {
        if (typeof this[name] !== 'function') throw new RpcError(-32602, `Unknown tool: ${name}`)
        if (a.resultId) { const r = this.lookupResult(a.resultId); if (!r) throw new UserError('nl2sql/result-expired', 'Result expired; run the query again.'); this.assertResultAccess(r, actor) }
        const input = { ...a, actor, source }
        if (a.datasource) { const ds = this.mcpDatasource(actor, a.datasource); input.datasourceId = ds.id }
        const out = await this[name](input)
        return out?.rows && out?.columns && out?.resultId ? this.mcpResultView(out) : jsonSafe(out)
      }
      default:
        throw new RpcError(-32602, `Unknown tool: ${name}`)
    }
  },

  mcpSchemaText(schema, ds, tables, question) {
    return this.schemaForModel(schema, ds, tables, { question }).replace(/nl2sql_schema/g, 'get_schema').replace(/nl2sql_knowledge action=search/g, 'search_knowledge')
  },

  mcpMetrics(ds) {
    return this.knowledgeFor(ds.id).metrics.map(m => jsonSafe({ id: m.id, name: m.name, expression: m.expression, table: m.table || undefined, filter: m.filter || undefined, timeColumn: m.timeColumn || undefined, unit: m.unit || undefined, description: m.description || undefined, dimensions: m.dimensions ?? [], synonyms: m.synonyms ?? [] }))
  },

  /** Dashboards with only the widgets this actor may see; dashboards with no visible widget are hidden for scoped tokens. */
  mcpDashboards(actor) {
    const visible = new Set(this.mcpVisibleDatasources(actor).map(d => d.id))
    return (this.state.dashboards ?? []).map(d => {
      const widgets = d.widgets.filter(w => visible.has(w.datasourceId)).map(w => ({ id: w.id, title: w.title, datasource: this.findDatasource(w.datasourceId)?.name ?? w.datasourceId, chart: w.chart?.type ?? 'table' }))
      return { id: d.id, name: d.name, description: d.description || undefined, widgets, filters: d.filters ?? [], hiddenWidgets: d.widgets.length - widgets.length }
    }).filter(d => !this.mcpScoped(actor) || d.widgets.length).map(({ hiddenWidgets: _h, ...d }) => jsonSafe(d))
  },

  mcpFindDashboard(actor, ref) {
    const d = (this.state.dashboards ?? []).find(x => x.id === ref) ?? (this.state.dashboards ?? []).find(x => x.name === ref)
    if (!d || !this.mcpDashboards(actor).some(x => x.id === d.id)) throw new UserError('nl2sql/unknown-dashboard', `Dashboard not found: ${ref}`)
    return d
  },

  /** explain_sql: admission + policy + row rules + EXPLAIN, never rows. Reuses service.explain()'s driver facility. */
  async mcpExplainSql(a, actor) {
    if (typeof a.sql !== 'string' || !a.sql.trim()) throw new UserError('nl2sql/invalid', '`sql` is required')
    const ds = this.mcpDatasource(actor, a.datasource)
    const dialect = ds.type ?? 'mysql'
    const out = { datasource: ds.name, dialect, admitted: false }
    let admitted
    try { admitted = admitSql(a.sql, { dialect }) } catch (error) { return { ...out, refusal: error.message } }
    if (actor?.role === 'viewer' && !this.isVerifiedExample(ds, a.sql)) return { ...out, refusal: 'viewer tokens can only run governed SQL (metrics, verified examples, dashboards)' }
    const schema = await this.analyzeSchema(ds.id)
    const denied = checkAccess(admitted.sql, this.policyFor(ds), schema, admitted.head, { dialect })
    if (denied) return { ...out, refusal: denied }
    const rules = this.rowRulesFor(actor, ds)
    Object.assign(out, { admitted: true, sql: admitted.sql, head: admitted.head, ...(rules.length ? { rowLevelRules: rules.map(r => `${r.column} IN (${r.values.join(', ')})`) } : {}) })
    if (admitted.head !== 'SELECT' || dialect === 'elasticsearch') return { ...out, note: 'No execution plan for this statement type / engine; admission checks passed.' }
    try {
      const res = await this.withDriver(ds, d => d.explain(admitted.sql, { timeoutMs: Math.min(this.settingsFor(ds).timeoutMs, 10000) }))
      const threshold = Number(this.settingsFor(ds).scanGuardRows ?? 0)
      return jsonSafe({ ...out, plan: (res.plan ?? []).slice(0, 50), scans: res.scans ?? [], scanGuard: { threshold, wouldRefuse: threshold > 0 && (res.scans ?? []).some(s => s.rows >= threshold) }, ...(rules.length ? { note: 'Row-level rules are injected when the statement runs; nested queries are then refused.' } : {}) })
    } catch (error) {
      return { ...out, note: `EXPLAIN failed: ${error.message}` }
    }
  },

  // ------------------------------------------------------------------ resources

  /** Static resources visible to an actor (resources/list). */
  mcpResources(actor) {
    const out = []
    for (const d of this.mcpVisibleDatasources(actor)) {
      const id = encodeURIComponent(d.id)
      const lm = d.schemaAnalyzedAt ? { annotations: { lastModified: new Date(d.schemaAnalyzedAt).toISOString() } } : {}
      out.push({ uri: `nl2sql://datasource/${id}/schema`, name: `${d.name} schema`, title: `${d.name} — schema overview`, description: `Visible tables, columns, relations and dialect notes of ${d.name} (${DIALECTS[d.type ?? 'mysql']?.label ?? d.type}).`, mimeType: 'text/plain', ...lm })
      out.push({ uri: `nl2sql://datasource/${id}/knowledge`, name: `${d.name} knowledge`, title: `${d.name} — business knowledge`, description: 'Glossary, metric definitions, verified question→SQL examples and table / column notes (visible tables only).', mimeType: 'application/json' })
      out.push({ uri: `nl2sql://datasource/${id}/metrics`, name: `${d.name} metrics`, title: `${d.name} — metric library`, description: 'Governed metric definitions usable with query_metric.', mimeType: 'application/json' })
      if (typeof this.freshnessFor === 'function') out.push({ uri: `nl2sql://datasource/${id}/freshness`, name: `${d.name} freshness`, title: `${d.name} — data freshness`, description: 'Latest timestamp, lag and stale status per table.', mimeType: 'application/json' })
    }
    out.push({ uri: 'nl2sql://dashboards', name: 'dashboards', title: 'Dashboards', description: 'Dashboards and their widgets visible to this token.', mimeType: 'application/json' })
    for (const d of this.mcpDashboards(actor)) out.push({ uri: `nl2sql://dashboard/${encodeURIComponent(d.id)}`, name: `dashboard ${d.name}`, title: `Dashboard — ${d.name}`, description: `${d.widgets.length} widget(s)`, mimeType: 'application/json' })
    return out
  },

  mcpResourceTemplates() {
    return [
      { uriTemplate: 'nl2sql://datasource/{id}/schema', name: 'Data source schema', description: 'Schema overview of a data source', mimeType: 'text/plain' },
      { uriTemplate: 'nl2sql://datasource/{id}/table/{table}', name: 'Table schema', description: 'Full description of one table', mimeType: 'text/plain' },
      { uriTemplate: 'nl2sql://datasource/{id}/knowledge', name: 'Business knowledge', description: 'Glossary, metrics, verified examples, notes', mimeType: 'application/json' },
      { uriTemplate: 'nl2sql://datasource/{id}/metrics', name: 'Metric library', description: 'Governed metric definitions', mimeType: 'application/json' },
      ...(typeof this.freshnessFor === 'function' ? [{ uriTemplate: 'nl2sql://datasource/{id}/freshness', name: 'Data freshness', description: 'Freshness per table', mimeType: 'application/json' }] : []),
      { uriTemplate: 'nl2sql://dashboard/{id}', name: 'Dashboard', description: 'A dashboard and its widgets (definitions, not data)', mimeType: 'application/json' },
      { uriTemplate: 'nl2sql://result/{resultId}', name: 'Query result', description: `A query result as CSV (first ${CSV_MAX_ROWS} rows; only when the privacy setting shares rows)`, mimeType: 'text/csv' },
    ]
  },

  /** resources/read. Returns { contents } or throws RpcError(not found). */
  async mcpReadResource(uri, actor, notFoundCode) {
    const notFound = () => new RpcError(notFoundCode, 'Resource not found', { uri })
    const json = (value) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 1) }] })
    let m = /^nl2sql:\/\/result\/([^/]+)$/.exec(uri)
    if (m) {
      const r = this.lookupResult(decodeURIComponent(m[1]))
      if (!r) throw notFound()
      try { this.assertResultAccess(r, actor) } catch { throw notFound() }
      const settings = this.settingsFor(this.findDatasource(r.datasourceId))
      const privacy = settings.resultToModel ?? 'summary'
      if (privacy !== 'rows') {
        const view = this.mcpResultView(r)
        const text = `# privacy=${privacy}: rows are not shared with external models\r\n${toCsv(['column', 'kind', 'masked'].map(name => ({ name })), view.columns.map(c => [c.name, c.kind, c.masked ? 'yes' : '']))}`
        return { contents: [{ uri, mimeType: 'text/csv', text }], warnings: [{ level: 'notice', data: { event: 'privacy-redaction', resultId: r.resultId, privacy } }] }
      }
      const cap = Math.min(CSV_MAX_ROWS, settings.modelRows ?? 20)
      let rows = r.rows.slice(0, cap)
      let text = toCsv(r.columns, rows)
      while (Buffer.byteLength(text) > CSV_MAX_BYTES && rows.length > 1) { rows = rows.slice(0, Math.floor(rows.length / 2)); text = toCsv(r.columns, rows) }
      const warnings = rows.length < r.rowCount ? [{ level: 'notice', data: { event: 'truncated', resultId: r.resultId, message: `CSV holds ${rows.length} of ${r.rowCount} rows (privacy row cap / size cap).` } }] : []
      return { contents: [{ uri, mimeType: 'text/csv', text: jsonSafe(text) }], warnings }
    }
    if (uri === 'nl2sql://dashboards') return json({ dashboards: this.mcpDashboards(actor) })
    m = /^nl2sql:\/\/dashboard\/([^/]+)$/.exec(uri)
    if (m) {
      const d = this.mcpDashboards(actor).find(x => x.id === decodeURIComponent(m[1]))
      if (!d) throw notFound()
      return json(d)
    }
    m = /^nl2sql:\/\/datasource\/([^/]+)\/(schema|knowledge|metrics|freshness|table\/(.+))$/.exec(uri)
    if (!m) throw notFound()
    let ds
    try { ds = this.mcpDatasource(actor, decodeURIComponent(m[1])) } catch { throw notFound() }
    const kind = m[2].startsWith('table/') ? 'table' : m[2]
    if (kind === 'metrics') return json({ datasource: ds.name, metrics: this.mcpMetrics(ds) })
    if (kind === 'freshness') {
      if (typeof this.freshnessFor !== 'function') throw notFound()
      return json(await this.mcpCallTool('data_freshness', { datasource: ds.id }, actor))
    }
    const schema = await this.visibleSchema(ds)
    if (kind === 'knowledge') return json(this.mcpKnowledge(ds, schema, actor))
    const table = m[3] ? decodeURIComponent(m[3]) : undefined
    if (table && !schema.tables.some(t => t.name.toLowerCase() === table.toLowerCase())) throw notFound()
    return { contents: [{ uri, mimeType: 'text/plain', text: this.mcpSchemaText(schema, ds, table ? [table] : undefined) }] }
  },

  /** Knowledge filtered to what the token may see: notes only for visible tables / columns; viewers see examples (governed SQL). */
  mcpKnowledge(ds, schema, _actor) {
    const k = this.knowledgeFor(ds.id)
    const visible = new Map(schema.tables.map(t => [t.name, new Set(t.columns.map(c => c.name))]))
    const notes = Object.fromEntries(Object.entries(k.notes ?? {}).filter(([key]) => {
      if (visible.has(key)) return true
      const i = key.lastIndexOf('.')
      return i > 0 && visible.get(key.slice(0, i))?.has(key.slice(i + 1))
    }))
    const tablesOk = (sql) => { try { return !checkAccess(sql, this.policyFor(ds), schema, 'SELECT', { dialect: ds.type ?? 'mysql' }) } catch { return false } }
    return jsonSafe({
      datasource: ds.name,
      glossary: k.glossary.map(g => ({ term: g.term, synonyms: g.synonyms, definition: g.definition, ...(g.sql ? { sql: g.sql } : {}) })),
      metrics: this.mcpMetrics(ds),
      examples: k.examples.filter(e => tablesOk(e.sql)).slice(-100).map(e => ({ question: e.question, sql: e.sql, ...(e.note ? { note: e.note } : {}) })),
      notes,
    })
  },

  // ------------------------------------------------------------------ completion

  /** completion/complete values for prompt / resource-template arguments, scoped to the actor. */
  async mcpComplete(params, actor) {
    const ref = params.ref ?? {}
    const arg = params.argument ?? {}
    const name = String(arg.name ?? '')
    const value = String(arg.value ?? '').toLowerCase()
    const context = params.context?.arguments ?? {}
    if (ref.type === 'ref/prompt') {
      const p = PROMPTS.find(x => x.name === ref.name)
      if (!p) throw new RpcError(-32602, `Unknown prompt: ${ref.name}`)
      if (!p.arguments.some(x => x.name === name)) throw new RpcError(-32602, `Unknown argument: ${name}`)
    } else if (ref.type === 'ref/resource') {
      if (!this.mcpResourceTemplates().some(t => t.uriTemplate === ref.uri) && !String(ref.uri ?? '').startsWith('nl2sql://')) throw new RpcError(-32602, `Unknown resource template: ${ref.uri}`)
    } else throw new RpcError(-32602, 'ref.type must be ref/prompt or ref/resource')
    const kind = COMPLETE_ARGS[name]
    const visible = this.mcpVisibleDatasources(actor)
    const dsFromCtx = () => {
      const r = context.datasource ?? context.id
      try { return this.mcpDatasource(actor, r) } catch { return undefined }
    }
    let candidates = []
    if (kind === 'datasource') candidates = visible.map(d => (name === 'id' ? d.id : d.name))
    else if (kind === 'table') { const ds = dsFromCtx(); if (ds) { const s = await this.cachedVisibleSchema(ds); candidates = s ? s.tables.map(t => t.name) : [] } }
    else if (kind === 'metric') { const dss = context.datasource ? [dsFromCtx()].filter(Boolean) : visible; candidates = [...new Set(dss.flatMap(d => this.knowledgeFor(d.id).metrics.flatMap(m => [m.name, ...(m.synonyms ?? [])])))] }
    else if (kind === 'period') candidates = ['day', 'week', 'month']
    const starts = candidates.filter(c => c.toLowerCase().startsWith(value))
    const contains = candidates.filter(c => !c.toLowerCase().startsWith(value) && c.toLowerCase().includes(value))
    const all = [...starts, ...contains]
    return { completion: { values: all.slice(0, 100), total: all.length, hasMore: all.length > 100 } }
  },

  // ------------------------------------------------------------------ prompts

  mcpPrompt(name, args = {}) {
    const p = PROMPTS.find(x => x.name === name)
    if (!p) throw new RpcError(-32602, `Unknown prompt: ${name}`)
    const v = (k) => String(args?.[k] ?? '').trim()
    for (const a of p.arguments) if (a.required && !v(a.name)) throw new RpcError(-32602, `Missing required argument: ${a.name}`)
    const msg = (text) => ({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text } }] })
    if (name === 'ask_data') {
      const dsName = v('datasource') ? ` on the data source "${v('datasource')}"` : ''
      return msg(`Answer this business question${dsName} using the nl2sql tools: list_datasources → get_schema (overview, then the relevant tables) → search_knowledge → query (one read-only, aggregated statement in the data source dialect) or query_metric. Explain the result briefly and show the SQL you used.\n\nQuestion: ${v('question')}`)
    }
    if (name === 'analyze_table') {
      return msg(`Analyze the table "${v('table')}" on the data source "${v('datasource')}" with the nl2sql tools:\n1. get_schema with tables=["${v('table')}"] — describe what one row represents, the key dimensions (enum / category columns), measures and the main time column.\n2. data_freshness (if available) — note whether the table is stale.\n3. query — a few aggregated read-only statements: row count, rows per day/week over the last 30 days on the time column, and the distribution of the top 1–2 dimensions. Use explain_sql first if unsure about cost.\n4. Summarize: purpose, size, trend, notable distributions, data quality concerns (nulls, gaps), and 3 good questions to ask next.\nNever select raw sensitive columns; aggregate instead.`)
    }
    if (name === 'compare_periods') {
      const period = ['day', 'week', 'month'].includes(v('period')) ? v('period') : 'week'
      const dsName = v('datasource') ? ` on the data source "${v('datasource')}"` : ''
      return msg(`Compare the metric "${v('metric')}"${dsName} between the current ${period} and the previous ${period}:\n1. list_metrics — confirm the metric and its allowed dimensions.\n2. query_metric with grain="${period === 'month' ? 'month' : 'day'}" over the last two ${period}s (from / to dates), then aggregate the two periods.\n3. explain_change on that resultId (current vs baseline) to rank the dimensions that explain the change.\n4. Report: both values, absolute and % change, the top drivers, and caveats (incomplete current ${period}, stale data via data_freshness).`)
    }
    return msg(`Reconcile these two sources:\n- Left (reference): ${v('left')}\n- Right: ${v('right')}\n\nSteps: list_datasources → get_schema on both → write one aggregated read-only query per side at the same grain (e.g. per day, or per order id) with matching key and value column names → reconcile with keys and compare columns (set a numeric tolerance when rounding differs) → explain where the sources disagree (keys only on one side, value mismatches, totals) and likely causes (timing, filters, currency, status mapping).`)
  },

  // ------------------------------------------------------------------ call log, rate limit

  /** Sliding-window per-token rate limit. Returns 0 when allowed, else seconds to wait. */
  mcpRateCheck(tok, now = Date.now()) {
    if (!tok.rateLimit) return 0
    this.mcpRate ??= new Map()
    const hits = (this.mcpRate.get(tok.id) ?? []).filter(t => now - t < 60000)
    if (hits.length >= tok.rateLimit) {
      this.mcpRate.set(tok.id, hits)
      return Math.max(1, Math.ceil((hits[0] + 60000 - now) / 1000))
    }
    hits.push(now)
    this.mcpRate.set(tok.id, hits)
    return 0
  },

  /** One call-log record (no result rows; SQL capped at 2000 chars). */
  mcpLogCall(tok, { method, tool, datasource, ms, status, rows, error, sql, version }) {
    try {
      this.records.put('mcpCall', {
        id: newId('mc'), at: Date.now(), tokenId: tok.id, tokenName: tok.name, method, ...(tool ? { tool } : {}),
        ...(datasource ? { datasource } : {}), ms, status, ...(rows !== undefined ? { rows } : {}),
        ...(error ? { error: String(error).slice(0, 300) } : {}), ...(sql ? { sql: String(sql).slice(0, 2000) } : {}), ...(version ? { version } : {}),
      })
    } catch (e) { console.warn('nl2sql mcp: call log failed: %s', e.message) }
  },

  mcpCallLog({ tokenId, limit = 100, status, tool } = {}) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 100))
    return this.records.list('mcpCall', { ref: tokenId || undefined, status: status || undefined, limit: n, filter: tool ? (r => r.tool === tool || r.method === tool) : undefined })
  },

  /**
   * Test connection: discover + tools/list (+ legacy initialize) against the running server over
   * loopback with a temporary in-memory credential (never persisted, removed afterwards).
   */
  async mcpSelfTest() {
    const st = this.mcpStatus()
    if (!st.running) return { ok: false, error: this.mcpError ?? 'MCP server is not running', url: st.url, steps: [] }
    const token = `n2s_mcp_selftest_${randomBytes(18).toString('base64url')}`
    const temp = { id: newId('mt-selftest'), name: '(self-test)', hash: hashToken(token), prefix: token.slice(0, 12), actor: { kind: 'owner' }, createdAt: Date.now(), temporary: true }
    this.mcpTempTokens ??= new Set()
    this.mcpTempTokens.add(temp)
    const steps = []
    const post = async (body, extra = {}) => {
      const t0 = Date.now()
      const res = await fetch(st.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      const json = await res.json().catch(() => null)
      return { status: res.status, json, ms: Date.now() - t0, headers: res.headers }
    }
    try {
      const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'nl2sql-self-test', version: SERVER_INFO.version } }
      const d = await post({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' })
      steps.push({ step: 'server/discover', ok: d.status === 200 && Boolean(d.json?.result), ms: d.ms, detail: d.json?.result ? `versions ${d.json.result.supportedVersions.join(', ')}` : d.json?.error?.message ?? `HTTP ${d.status}` })
      const tl = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' })
      const tools = tl.json?.result?.tools?.map(t => t.name) ?? []
      steps.push({ step: 'tools/list', ok: tl.status === 200 && tools.length > 0, ms: tl.ms, detail: `${tools.length} tools` })
      const init = await post({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: LATEST_LEGACY, capabilities: {}, clientInfo: { name: 'nl2sql-self-test', version: SERVER_INFO.version } } })
      const sid = init.headers.get('mcp-session-id')
      steps.push({ step: `initialize (${LATEST_LEGACY})`, ok: init.status === 200 && init.json?.result?.protocolVersion === LATEST_LEGACY, ms: init.ms, detail: init.json?.result ? `session ${sid ? 'minted' : 'missing'}` : init.json?.error?.message ?? `HTTP ${init.status}` })
      if (sid) this.mcpEndSession(sid)
      return { ok: steps.every(s => s.ok), url: st.url, server: d.json?.result?._meta?.['io.modelcontextprotocol/serverInfo'] ?? SERVER_INFO, tools, steps }
    } catch (error) {
      return { ok: false, url: st.url, error: error.message, steps }
    } finally {
      this.mcpTempTokens.delete(temp)
    }
  },

  // ------------------------------------------------------------------ notifications (server → client)

  /** Send a notification to every legacy session stream / modern listener that opted in. */
  mcpBroadcast(kind, payload) {
    // kind: 'resources/list_changed' | 'resources/updated'
    for (const sess of this.mcpSessions?.values() ?? []) {
      if (!sess.stream) continue
      const tok = this.mcpState().tokens.find(t => t.id === sess.tokenId)
      const actor = tok && this.mcpActor(tok)
      if (!actor) continue
      if (kind === 'resources/list_changed') sess.stream.send({ jsonrpc: '2.0', method: 'notifications/resources/list_changed' })
      else if (sess.subscriptions?.has(payload.uri) && this.mcpCanSee(actor, payload.uri)) sess.stream.send({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: payload.uri } })
    }
    for (const l of this.mcpListeners ?? []) {
      const tok = this.mcpState().tokens.find(t => t.id === l.tokenId)
      const actor = tok && this.mcpActor(tok)
      if (!actor) continue
      const meta = { 'io.modelcontextprotocol/subscriptionId': l.id }
      if (kind === 'resources/list_changed' && l.filter.resourcesListChanged) l.send({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: { _meta: meta } })
      else if (kind === 'resources/updated' && l.filter.resourceSubscriptions?.includes(payload.uri) && this.mcpCanSee(actor, payload.uri)) l.send({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { _meta: meta, uri: payload.uri } })
    }
  },

  mcpCanSee(actor, uri) {
    const m = /^nl2sql:\/\/datasource\/([^/]+)\//.exec(uri)
    if (!m) return true
    const ds = this.findDatasource(decodeURIComponent(m[1]))
    return Boolean(ds && this.mcpVisibleDatasources(actor).includes(ds))
  },

  /**
   * Cheap watcher: compares data source ids (→ list_changed) and schemaAnalyzedAt / knowledge
   * fingerprints (→ updated for schema / table / knowledge / metrics resources). Runs only while
   * someone listens. The interval is unref'd.
   */
  mcpWatchTick() {
    const ds = this.state.datasources
    const ids = ds.map(d => d.id).join('|')
    const prev = this.mcpWatchState
    const next = { ids, at: Object.fromEntries(ds.map(d => [d.id, d.schemaAnalyzedAt ?? 0])), know: Object.fromEntries(ds.map(d => [d.id, createHash('sha1').update(JSON.stringify(this.state.knowledge?.[d.id] ?? {})).digest('hex')])), dash: createHash('sha1').update(JSON.stringify((this.state.dashboards ?? []).map(d => [d.id, d.widgets.map(w => w.id)]))).digest('hex') }
    this.mcpWatchState = next
    if (!prev) return
    if (prev.ids !== ids || prev.dash !== next.dash) this.mcpBroadcast('resources/list_changed')
    for (const d of ds) {
      const id = encodeURIComponent(d.id)
      if (prev.at[d.id] !== undefined && prev.at[d.id] !== next.at[d.id]) {
        this.mcpBroadcast('resources/updated', { uri: `nl2sql://datasource/${id}/schema` })
        for (const uri of this.mcpSubscribedUris()) if (uri.startsWith(`nl2sql://datasource/${id}/table/`)) this.mcpBroadcast('resources/updated', { uri })
      }
      if (prev.know[d.id] !== undefined && prev.know[d.id] !== next.know[d.id]) {
        this.mcpBroadcast('resources/updated', { uri: `nl2sql://datasource/${id}/knowledge` })
        this.mcpBroadcast('resources/updated', { uri: `nl2sql://datasource/${id}/metrics` })
      }
    }
  },

  mcpSubscribedUris() {
    const out = new Set()
    for (const s of this.mcpSessions?.values() ?? []) for (const u of s.subscriptions ?? []) out.add(u)
    for (const l of this.mcpListeners ?? []) for (const u of l.filter.resourceSubscriptions ?? []) out.add(u)
    return out
  },

  mcpEnsureWatcher() {
    const listening = (this.mcpListeners?.size ?? 0) + [...(this.mcpSessions?.values() ?? [])].filter(s => s.stream).length
    if (listening && !this.mcpWatchTimer) {
      this.mcpWatchState = undefined
      this.mcpWatchTick()
      this.mcpWatchTimer = setInterval(() => { try { this.mcpWatchTick() } catch (e) { console.warn('nl2sql mcp watch: %s', e.message) } }, this.mcpWatchMs ?? WATCH_MS)
      this.mcpWatchTimer.unref?.()
    } else if (!listening && this.mcpWatchTimer) {
      clearInterval(this.mcpWatchTimer)
      this.mcpWatchTimer = undefined
    }
  },

  /** Open an SSE response with heartbeats. Returns { send(obj), comment(), close(), closed }. */
  mcpOpenSse(res, headers = {}, onClose) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', ...headers })
    res.flushHeaders?.()
    const stream = {
      closed: false,
      send(obj) { if (!stream.closed) res.write(`event: message\ndata: ${JSON.stringify(obj)}\n\n`) },
      comment(text = '') { if (!stream.closed) res.write(`: ${text}\n\n`) },
      close() { if (stream.closed) return; stream.closed = true; clearInterval(hb); try { res.end() } catch {} onClose?.() },
    }
    const hb = setInterval(() => stream.comment('keep-alive'), this.mcpHeartbeatMs ?? HEARTBEAT_MS)
    hb.unref?.()
    res.on('close', () => { if (!stream.closed) { stream.closed = true; clearInterval(hb); onClose?.('client') } })
    return stream
  },

  // ------------------------------------------------------------------ JSON-RPC

  /**
   * Handle one JSON-RPC message. Returns { status, body?, headers? }.
   * ctx: { tok, actor, headers, session, stream?: { progress(), log() }, signal, version }.
   */
  async mcpHandleMessage(msg, ctx) {
    const { tok, actor, headers, session } = ctx
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
    // Negotiated version: modern body version; legacy session version; MCP-Protocol-Version header.
    // Without any of these the transport spec suggests assuming 2025-03-26; we keep that era's
    // transport rules but still return the additive fields of the latest legacy revision
    // (structuredContent, resource_link, titles), which older clients ignore.
    const version = modern ? bodyVersion : session?.version ?? (MCP_VERSIONS.includes(headerVersion) ? headerVersion : LATEST_LEGACY)
    const feat = revisionFeatures(version)
    ctx.version = version
    const reply = (result, extra = {}) => ({ status: 200, body: { jsonrpc: '2.0', id, result: { ...(modern ? { _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } } : {}), ...result, resultType: 'complete' } }, ...extra })
    const fail = (code, message, data, status = 200) => ({ status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } } })
    // Resource-not-found code: -32602 from 2026-07-28, -32002 before (basic/index error codes).
    const notFoundCode = modern ? -32602 : -32002

    // Version checks: modern _meta version, header/body agreement, header version support.
    if (modern) {
      if (!MCP_VERSIONS.includes(bodyVersion)) return fail(-32022, 'Unsupported protocol version', { supported: MCP_VERSIONS, requested: bodyVersion }, 400)
      if (headerVersion && headerVersion !== bodyVersion) return fail(-32020, `Header mismatch: MCP-Protocol-Version '${headerVersion}' does not match body '${bodyVersion}'`, undefined, 400)
      if (headers['mcp-method'] && headers['mcp-method'] !== msg.method) return fail(-32020, `Header mismatch: Mcp-Method '${headers['mcp-method']}' does not match body '${msg.method}'`, undefined, 400)
      const bodyName = params.name ?? params.uri
      if (headers['mcp-name'] !== undefined && bodyName !== undefined && decodeHeaderValue(headers['mcp-name']) !== String(bodyName)) return fail(-32020, 'Header mismatch: Mcp-Name does not match the body', undefined, 400)
      const lvl = meta['io.modelcontextprotocol/logLevel']
      if (lvl !== undefined && !LOG_LEVELS.includes(lvl)) return fail(-32602, `Invalid log level: ${lvl}`, undefined, 400)
    } else if (headerVersion && msg.method !== 'initialize' && !MCP_VERSIONS.includes(headerVersion)) {
      return fail(-32022, 'Unsupported protocol version', { supported: MCP_VERSIONS, requested: headerVersion }, 400)
    }

    if (isNotification) {
      // https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
      if (msg.method === 'notifications/cancelled' && params.requestId !== undefined) this.mcpCancel(tok, session, params.requestId, params.reason)
      return { status: 202 } // notifications/initialized, cancelled, …
    }

    // Logging: the effective level for this request (modern: _meta; legacy: logging/setLevel on the session).
    ctx.logLevel = modern ? meta['io.modelcontextprotocol/logLevel'] : session?.logLevel
    const log = (level, data) => {
      if (!ctx.logLevel || LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(ctx.logLevel)) return
      const n = { jsonrpc: '2.0', method: 'notifications/message', params: { level, logger: 'nl2sql', data } }
      if (ctx.stream) ctx.stream.send(n)
      else if (!modern && session?.stream) session.stream.send(n) // legacy: no request stream → standalone GET stream
    }

    try {
      switch (msg.method) {
        case 'initialize': {
          const requested = String(params.protocolVersion ?? '')
          // Legacy handshake: echo a supported legacy version, else offer our latest legacy one.
          const v = MCP_VERSIONS.includes(requested) && !MODERN.has(requested) ? requested : LATEST_LEGACY
          const f = revisionFeatures(v)
          const sid = randomBytes(16).toString('hex')
          this.mcpSessions ??= new Map()
          this.mcpSessions.set(sid, { tokenId: tok.id, version: v, at: Date.now(), client: params.clientInfo?.name, subscriptions: new Set(), logLevel: undefined, stream: null })
          if (this.mcpSessions.size > 500) this.mcpEndSession(this.mcpSessions.keys().next().value)
          return reply({ protocolVersion: v, capabilities: { tools: { listChanged: false }, resources: { subscribe: true, listChanged: true }, prompts: { listChanged: false }, logging: {}, ...(f.completions ? { completions: {} } : {}) }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }, { headers: { 'mcp-session-id': sid } })
        }
        case 'server/discover':
          return reply({ supportedVersions: MCP_VERSIONS, capabilities: { tools: { listChanged: false }, resources: { subscribe: true, listChanged: true }, prompts: { listChanged: false }, completions: {}, logging: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO }, instructions: INSTRUCTIONS })
        case 'ping':
          return reply({})
        case 'tools/list': {
          const { page, nextCursor } = paginate(toolsForVersion(this.mcpToolsFor(tok), version), params.cursor, 'tools', this.mcpPageSize?.tools ?? PAGE_SIZE.tools)
          return reply({ tools: page, ...(nextCursor ? { nextCursor } : {}) })
        }
        case 'tools/call': {
          const name = String(params.name ?? '')
          if (!toolDefs(this).some(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
          if (!this.mcpToolsFor(tok).some(t => t.name === name)) return fail(-32602, `Tool not allowed for this token: ${name}`)
          ctx.toolName = name
          const tctx = { log, signal: ctx.signal, phase: ctx.phase }
          try {
            const value = await callContext.run({ signal: ctx.signal, phase: ctx.phase }, () => this.mcpCallTool(name, params.arguments ?? {}, actor, tctx))
            ctx.callInfo = { datasource: tctx.ds?.name ?? value?.datasource, rows: value?.rowCount, sql: value?.sql }
            for (const w of this.mcpResultWarnings(value)) log(w.level, w.data)
            for (const r of value?.results ?? []) for (const w of this.mcpResultWarnings(r.result)) log(w.level, w.data)
            const text = typeof value?.text === 'string' && Object.keys(value).length <= 3 ? value.text : JSON.stringify(value, null, 1)
            const content = [{ type: 'text', text }]
            if (feat.resourceLinks) {
              const ids = [value?.resultId, ...(value?.results ?? []).map(r => r.result?.resultId), ...Object.values(value?.resultIds ?? {})].filter(Boolean)
              for (const rid of [...new Set(ids)].slice(0, 12)) content.push({ type: 'resource_link', uri: `nl2sql://result/${encodeURIComponent(rid)}`, name: `result ${rid}`, description: 'Query result as CSV (subject to the privacy setting)', mimeType: 'text/csv' })
            }
            return reply({ content, ...(feat.structuredContent ? { structuredContent: value && typeof value === 'object' && !Array.isArray(value) ? value : { value } } : {}), isError: false })
          } catch (error) {
            if (error instanceof RpcError) throw error
            if (ctx.signal?.aborted || error.code === 'query/cancelled') { ctx.cancelled = true; return { status: 499, cancelled: true } }
            ctx.callError = error.message
            // Tool execution errors go back to the model as results so it can correct itself.
            return reply({ content: [{ type: 'text', text: error.message ?? String(error) }], isError: true })
          }
        }
        case 'resources/list': {
          const { page, nextCursor } = paginate(this.mcpResources(actor), params.cursor, 'resources', this.mcpPageSize?.resources ?? PAGE_SIZE.resources)
          return reply({ resources: page, ...(nextCursor ? { nextCursor } : {}) })
        }
        case 'resources/templates/list': {
          const { page, nextCursor } = paginate(this.mcpResourceTemplates(), params.cursor, 'templates', this.mcpPageSize?.templates ?? PAGE_SIZE.templates)
          return reply({ resourceTemplates: page, ...(nextCursor ? { nextCursor } : {}) })
        }
        case 'resources/read': {
          const uri = String(params.uri ?? '')
          const out = await this.mcpReadResource(uri, actor, notFoundCode)
          for (const w of out.warnings ?? []) log(w.level, w.data)
          return reply({ contents: out.contents })
        }
        case 'resources/subscribe':
        case 'resources/unsubscribe': {
          // Legacy only (2026-07-28 replaced it with subscriptions/listen): per session.
          if (modern) return fail(-32601, `Method not found: ${msg.method} (use subscriptions/listen)`, undefined, 404)
          const uri = String(params.uri ?? '')
          if (!uri.startsWith('nl2sql://')) return fail(notFoundCode, 'Resource not found', { uri })
          if (!session) return fail(-32600, 'resources/subscribe needs an Mcp-Session-Id (initialize first)')
          if (msg.method === 'resources/subscribe') {
            if (!this.mcpCanSee(actor, uri)) return fail(notFoundCode, 'Resource not found', { uri })
            session.subscriptions.add(uri)
          } else session.subscriptions.delete(uri)
          this.mcpEnsureWatcher()
          return reply({})
        }
        case 'prompts/list': {
          const { page, nextCursor } = paginate(PROMPTS.map(p => (feat.titles ? p : (({ title: _t, ...x }) => x)(p))), params.cursor, 'prompts', PAGE_SIZE.prompts)
          return reply({ prompts: page, ...(nextCursor ? { nextCursor } : {}) })
        }
        case 'prompts/get':
          return reply(this.mcpPrompt(params.name, params.arguments ?? {}))
        case 'completion/complete':
          if (!feat.completions) return fail(-32601, 'Method not found: completion/complete')
          return reply(await this.mcpComplete(params, actor))
        case 'logging/setLevel': {
          if (!feat.setLevel) return fail(-32601, 'Method not found: logging/setLevel (use _meta io.modelcontextprotocol/logLevel)', undefined, 404)
          if (!LOG_LEVELS.includes(params.level)) return fail(-32602, `Invalid log level: ${params.level}`)
          if (session) session.logLevel = params.level
          return reply({})
        }
        default:
          return fail(-32601, `Method not found: ${msg.method}`, undefined, modern ? 404 : 200)
      }
    } catch (error) {
      if (error instanceof RpcError) return fail(error.rpcCode, error.message, error.data, error.status ?? 200)
      return fail(-32603, error.message ?? 'Internal error')
    }
  },

  /** notifications/cancelled: abort the in-flight request of the same token (and session) — legacy and stdio clients. */
  mcpCancel(tok, session, requestId, reason) {
    for (const c of this.mcpInflight?.values() ?? []) {
      if (c.tokenId === tok.id && c.requestId === requestId && (!session || !c.session || c.session === session)) c.abort(reason ?? 'cancelled by client')
    }
    // A listen stream is also cancelled by referencing its request id (stdio rule; harmless on HTTP).
    for (const l of [...(this.mcpListeners ?? [])]) if (l.tokenId === tok.id && l.id === requestId) l.close()
  },

  /** node:http request handler for the MCP endpoint. */
  async mcpHandleHttp(req, res) {
    const send = (status, body, headers = {}) => {
      if (res.headersSent || res.destroyed) return
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
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) return send(405, rpcErr(-32600, 'Method Not Allowed'), { allow: 'POST, GET, DELETE' })
    // Authentication.
    const auth = String(req.headers.authorization ?? '')
    const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1]
    const tok = this.mcpFindToken(bearer) ?? (bearer ? [...(this.mcpTempTokens ?? [])].find(t => t.hash === hashToken(bearer)) : undefined)
    const wwwAuth = { 'www-authenticate': 'Bearer realm="nl2sql-mcp"' }
    if (tok?.expiresAt && tok.expiresAt <= Date.now()) return send(401, rpcErr(-32001, `Unauthorized: token "${tok.name}" expired at ${new Date(tok.expiresAt).toISOString()}; ask the administrator to extend it or create a new one`), { ...wwwAuth, 'www-authenticate': 'Bearer realm="nl2sql-mcp", error="invalid_token", error_description="token expired"' })
    const actor = tok ? this.mcpActor(tok) : undefined
    if (!tok || !actor) return send(401, rpcErr(-32001, tok ? 'Unauthorized: the member of this token is disabled or deleted' : 'Unauthorized: missing or invalid bearer token'), wwwAuth)
    // Rate limit (per token, requests per minute).
    const wait = this.mcpRateCheck(tok)
    if (wait) {
      this.mcpLogCall(tok, { method: req.method === 'POST' ? 'rpc' : req.method, ms: 0, status: 'rate-limited' })
      return send(429, rpcErr(-32000, `Too Many Requests: rate limit ${tok.rateLimit}/min for token "${tok.name}"; retry after ${wait}s`), { 'retry-after': String(wait) })
    }
    const sid = req.headers['mcp-session-id']
    // Legacy GET stream / DELETE session (2025-03-26 … 2025-11-25). 2026-07-28 has neither → 405.
    if (req.method === 'GET' || req.method === 'DELETE') {
      const session = sid ? this.mcpSessions?.get(String(sid)) : undefined
      if (!sid || MODERN.has(req.headers['mcp-protocol-version'])) return send(405, rpcErr(-32600, 'Method Not Allowed: use POST (and subscriptions/listen for notifications)'), { allow: 'POST' })
      if (!session || session.tokenId !== tok.id) return send(404, rpcErr(-32001, 'Session not found; initialize again'))
      if (req.method === 'DELETE') { this.mcpEndSession(String(sid)); return send(204) }
      if (!acceptsSse(req.headers.accept)) return send(406, rpcErr(-32600, 'Not Acceptable: GET needs Accept: text/event-stream'))
      session.stream?.close()
      session.stream = this.mcpOpenSse(res, {}, () => { if (session.stream?.closed) session.stream = null; this.mcpEnsureWatcher() })
      session.stream.comment('stream open')
      this.mcpEnsureWatcher()
      return
    }
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
    // 2026-07-28 requests ignore the header (streamable-http "Backward Compatibility").
    let session
    const first = Array.isArray(msg) ? msg[0] : msg
    const isModernMsg = Boolean(first?.params?._meta?.['io.modelcontextprotocol/protocolVersion']) && first?.method !== 'initialize'
    if (sid && !isModernMsg && !(Array.isArray(msg) ? msg : [msg]).some(m => m?.method === 'initialize')) {
      session = this.mcpSessions?.get(String(sid))
      if (!session || session.tokenId !== tok.id) return send(404, rpcErr(-32001, 'Session not found; initialize again'))
    }
    // lastUsedAt, persisted at most once a minute per token (never for temporary self-test credentials).
    const now = Date.now()
    if (!tok.temporary) { if (!tok.lastUsedAt || now - tok.lastUsedAt > 60000) { tok.lastUsedAt = now; this.save() } else tok.lastUsedAt = now }
    const ctx = { tok, actor, headers: req.headers, session }
    if (Array.isArray(msg)) {
      // JSON-RPC batch (2025-03-26 only; removed in 2025-06-18): answer every request in one array.
      if (!msg.length) return send(400, rpcErr(-32600, 'Invalid Request'))
      const out = []
      let extra = {}
      for (const m of msg.slice(0, 50)) {
        const r = await this.mcpHandleMessage(m, { ...ctx })
        if (r.body) out.push(r.body)
        if (r.headers) extra = { ...extra, ...r.headers }
      }
      return out.length ? send(200, out, extra) : send(202)
    }
    if (msg?.method === 'subscriptions/listen') return this.mcpListen(msg, ctx, req, res, send)
    return this.mcpDispatch(msg, ctx, req, res, send)
  },

  /** One POST message: plain JSON, or a request-scoped SSE stream for long requests when accepted. */
  async mcpDispatch(msg, ctx, req, res, send) {
    const isRequest = msg && typeof msg === 'object' && 'id' in msg && typeof msg.method === 'string'
    const started = Date.now()
    const params = msg?.params && typeof msg.params === 'object' ? msg.params : {}
    const progressToken = params._meta?.progressToken
    const modernMsg = Boolean(params._meta?.['io.modelcontextprotocol/protocolVersion'])
    const logLevel = modernMsg ? params._meta?.['io.modelcontextprotocol/logLevel'] : ctx.session?.logLevel
    // Streaming is used for long requests (tools/call) when the client accepts SSE (streamable-http "Sending Messages" 6).
    const stream = isRequest && msg.method === 'tools/call' && acceptsSse(req.headers.accept) && (progressToken !== undefined || logLevel || this.mcpAlwaysStream)
    const controller = new AbortController()
    ctx.signal = controller.signal
    let sse
    let inflight
    if (isRequest && msg.method === 'tools/call') {
      this.mcpInflight ??= new Map()
      inflight = { tokenId: ctx.tok.id, requestId: msg.id, session: ctx.session, abort: (reason) => { if (!controller.signal.aborted) controller.abort(reason) } }
      this.mcpInflight.set(inflight, inflight)
      // 2026-07-28: closing the stream is the cancellation signal. Legacy: disconnection SHOULD NOT be treated as cancel,
      // but no response can be delivered any more, so the work is stopped as well.
      res.on('close', () => { if (!res.writableFinished) inflight.abort('client disconnected') })
    }
    if (stream) {
      sse = this.mcpOpenSse(res)
      ctx.stream = sse
      let progress = 0
      const steps = { admitted: 'admitted', running: 'running query', fetched: 'fetched rows', formatting: 'formatting', widget: 'running widget' }
      ctx.phase = (phase, info = {}) => {
        if (progressToken === undefined || sse.closed || controller.signal.aborted) return
        progress += 1
        const side = info.title && /对账 · .* · (左侧|右侧)$/.exec(info.title)?.[1]
        const label = `${steps[phase] ?? phase}${side ? ` (${side === '左侧' ? 'left' : 'right'} side)` : ''}${info.datasource ? ` · ${info.datasource}` : ''}${info.rows !== undefined ? ` · ${info.rows} rows` : ''}${phase === 'widget' ? ` ${info.index}/${info.total} · ${info.title}` : ''}`
        sse.send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress, message: label } })
      }
    }
    let r
    try {
      r = await this.mcpHandleMessage(msg, ctx)
    } finally {
      if (inflight) this.mcpInflight.delete(inflight)
    }
    // Call log (requests only; not notifications).
    if (isRequest && !ctx.tok.temporary) {
      const status = ctx.cancelled || controller.signal.aborted ? 'cancelled' : r.body?.error ? 'error' : r.body?.result?.isError ? 'error' : 'ok'
      this.mcpLogCall(ctx.tok, { method: msg.method, tool: ctx.toolName, datasource: ctx.callInfo?.datasource, ms: Date.now() - started, status, rows: ctx.callInfo?.rows, error: status === 'error' ? (r.body?.error?.message ?? ctx.callError) : status === 'cancelled' ? String(controller.signal.reason ?? 'cancelled') : undefined, sql: msg.method === 'tools/call' ? (typeof params.arguments?.sql === 'string' ? params.arguments.sql : ctx.callInfo?.sql) : undefined, version: ctx.version })
    }
    // Cancelled: send nothing more (cancellation spec: "Not send a response for the cancelled request").
    if (ctx.cancelled || controller.signal.aborted) {
      if (sse) sse.close()
      else if (!res.headersSent && !res.destroyed) { res.writeHead(204); res.end() }
      return
    }
    if (sse) {
      if (r.body && !r.cancelled) { ctx.phase?.('formatting'); sse.send(r.body) }
      sse.close()
      return
    }
    return send(r.status, r.body, r.headers)
  },

  /**
   * 2026-07-28 subscriptions/listen: long-lived SSE stream for opted-in change notifications.
   * https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions
   */
  async mcpListen(msg, ctx, req, res, send) {
    const params = msg.params ?? {}
    // Reuse the version / header validation of mcpHandleMessage (Mcp-Method is checked against the real method here).
    if (ctx.headers['mcp-method'] && ctx.headers['mcp-method'] !== 'subscriptions/listen') return send(400, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32020, message: `Header mismatch: Mcp-Method '${ctx.headers['mcp-method']}' does not match body 'subscriptions/listen'` } })
    const { 'mcp-method': _m, ...headers } = ctx.headers
    const pre = await this.mcpHandleMessage({ jsonrpc: '2.0', id: msg.id, method: 'ping', params: { _meta: params._meta } }, { ...ctx, headers })
    if (pre.body?.error) return send(pre.status, pre.body)
    if (!params._meta?.['io.modelcontextprotocol/protocolVersion']) return send(200, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: 'Method not found: subscriptions/listen (2026-07-28 only; legacy clients use GET + resources/subscribe)' } })
    if (!acceptsSse(req.headers.accept)) return send(406, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'subscriptions/listen needs Accept: text/event-stream' } })
    const f = params.notifications ?? {}
    // Only the types we support are acknowledged (tools/prompts lists are static here).
    const filter = {
      ...(f.resourcesListChanged ? { resourcesListChanged: true } : {}),
      ...(Array.isArray(f.resourceSubscriptions) ? { resourceSubscriptions: f.resourceSubscriptions.map(String).filter(u => u.startsWith('nl2sql://') && this.mcpCanSee(ctx.actor, u)).slice(0, 200) } : {}),
    }
    this.mcpListeners ??= new Set()
    const listener = { id: msg.id, tokenId: ctx.tok.id, filter }
    const sse = this.mcpOpenSse(res, {}, () => { this.mcpListeners.delete(listener); this.mcpEnsureWatcher() })
    listener.send = (n) => sse.send(n)
    // Server-side teardown: graceful completion result, then close (subscriptions "Graceful Closure").
    listener.close = () => { sse.send({ jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/subscriptionId': msg.id } } }); sse.close() }
    this.mcpListeners.add(listener)
    sse.send({ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': msg.id }, notifications: filter } })
    this.mcpEnsureWatcher()
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
    server.requestTimeout = 0 // long-lived SSE streams (GET / subscriptions/listen); tools/call is bounded by query timeouts
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
    for (const l of [...(this.mcpListeners ?? [])]) l.close()
    for (const sid of [...(this.mcpSessions?.keys() ?? [])]) this.mcpEndSession(sid)
    for (const c of this.mcpInflight?.values() ?? []) c.abort('server stopped')
    if (this.mcpWatchTimer) { clearInterval(this.mcpWatchTimer); this.mcpWatchTimer = undefined }
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
    updateMcpToken: (p) => service.updateMcpToken(p ?? {}),
    rotateMcpToken: (p) => service.rotateMcpToken(p ?? {}),
    revokeMcpToken: (p) => service.revokeMcpToken(p ?? {}),
    mcpCallLog: (p) => service.mcpCallLog(p ?? {}),
    mcpSelfTest: () => service.mcpSelfTest(),
  }),
  start(ctx, service) {
    ctx.effect(() => () => service.stopMcp(), 'nl2sql: mcp server')
    service.applyMcp().catch(error => console.warn('nl2sql mcp: start failed: %s', error.message))
  },
}
