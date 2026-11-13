// MCP server enhancements (service/mcp.js) against MySQL: SSE responses with progress,
// cancellation (HTTP stream close + notifications/cancelled, KILL QUERY), resource
// subscriptions (legacy GET stream + 2026-07-28 subscriptions/listen), new resources and
// tools, outputSchema / structuredContent validation, resource_link items, prompts,
// completion, logging, pagination, token expiry / allowlist / rate limit / rotation,
// call log, self-test, and SSE progress through the stdio bridge.
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, PLUGIN_DIR, mysqlUnavailable, sleep } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'mcp-plus' })
const { call, service } = app
let ds, port, url, owner, scoped
// ~1 s and ~8 s statements on the test database (SLEEP() is refused by read-only admission).
const SLOW_SQL = 'select count(*) n from blockchain_addresses a, blockchain_addresses b, collection_policies c where a.id + b.id + c.id > 0'
const SLOWER_SQL = 'select count(*) n from blockchain_addresses a, blockchain_addresses b, blockchain_transactions c where a.id + b.id + c.id > 0'
const MODERN = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }

/** Raw HTTP request; resolves with the full body. */
function post(body, { token, headers = {}, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const req = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, 'content-length': Buffer.byteLength(text) } }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => { data += c })
      res.on('end', () => { let json; try { json = data ? JSON.parse(data) : undefined } catch {} resolve({ status: res.statusCode, headers: res.headers, json, text: data }) })
    })
    req.on('error', reject)
    req.end(text)
  })
}
let nextId = 1
const rpc = (method, params, opts) => post({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }, opts)
const callTool = (token, name, args, opts = {}) => rpc('tools/call', { name, arguments: args, ...(opts.params ?? {}) }, { token, ...opts })

/** Streaming request: parses SSE events incrementally. */
function stream(body, { token, headers = {}, method = 'POST' } = {}) {
  const events = []
  const comments = []
  const waiters = []
  const text = body === undefined ? '' : JSON.stringify(body)
  let resolveDone
  const done = new Promise(r => { resolveDone = r })
  const out = { events, comments, status: undefined, headers: undefined, done, ended: false }
  const req = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, ...(text ? { 'content-length': Buffer.byteLength(text) } : {}) } }, (res) => {
    out.status = res.statusCode
    out.headers = res.headers
    let buf = ''
    res.setEncoding('utf8')
    res.on('data', (c) => {
      buf += c
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        for (const l of block.split('\n')) if (l.startsWith(':')) comments.push(l)
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
        if (data) events.push(JSON.parse(data))
        for (const w of waiters.splice(0)) w()
      }
    })
    res.on('end', () => { out.ended = true; out.raw = buf; resolveDone(); for (const w of waiters.splice(0)) w() })
    res.on('error', () => { out.ended = true; resolveDone() })
  })
  req.on('error', () => { out.ended = true; resolveDone() })
  req.end(text)
  out.close = () => req.destroy()
  out.waitFor = async (pred, ms = 15000) => {
    const deadline = Date.now() + ms
    while (!events.some(pred)) {
      if (Date.now() > deadline) throw new Error(`timeout; events: ${JSON.stringify(events).slice(0, 500)}`)
      await new Promise(r => { waiters.push(r); setTimeout(r, 100) })
    }
    return events.find(pred)
  }
  return out
}

/** Tiny JSON Schema checker for the subset used by the outputSchemas (type, properties, required, items, enum). */
function validate(schema, value, path = '$') {
  const errors = []
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const t = typeOf(value)
    if (!types.some(x => x === t || (x === 'number' && t === 'integer'))) return [`${path}: expected ${types.join('|')}, got ${t}`]
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`)
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required ?? []) if (!(r in value)) errors.push(`${path}.${r}: required`)
    for (const [k, s] of Object.entries(schema.properties)) if (k in value && value[k] !== undefined) errors.push(...validate(s, value[k], `${path}.${k}`))
  }
  if (schema.items && Array.isArray(value)) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)))
  return errors
}

const historyOf = (pred) => service.records.list('history', { limit: 50 }).find(pred)

try {
  await test('setup: data source, policy, metric, dashboard, tokens, server', async () => {
    ds = await call('saveDatasource', { name: 'MCP+ MySQL', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    await call('savePolicy', { id: ds.id, policy: { mode: 'deny', tables: ['callback_*'], hiddenColumns: [], maskedColumns: [] } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '交易笔数', expression: 'COUNT(*)', table: 'blockchain_transactions', timeColumn: 'created_at', synonyms: ['tx count'], dimensions: ['status', 'chain_type'] } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'note', item: { key: 'blockchain_transactions', text: '链上交易' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'note', item: { key: 'callback_configs', text: 'SECRET NOTE' } })
    const st = await call('saveMcpSettings', { enabled: true, port: 0 })
    assert.equal(st.running, true, st.error ?? '')
    port = service.mcpServer.address().port
    url = st.url
    owner = await call('createMcpToken', { name: 'owner' })
    scoped = await call('createMcpToken', { name: 'scoped', scope: { role: 'analyst', datasourceIds: [ds.id], rowRules: [{ column: 'status', values: ['1'] }] } })
    assert.ok(st.toolNames.includes('list_metrics') && st.toolNames.includes('explain_sql'))
  })

  await test('tools/list: annotations (title, readOnly, destructive false, idempotent, openWorld) and outputSchema on every tool', async () => {
    const r = await rpc('tools/list', undefined, { token: owner.token })
    const tools = r.json.result.tools
    for (const n of ['list_metrics', 'list_dashboards', 'run_dashboard', 'explain_sql', 'data_freshness']) assert.ok(tools.some(t => t.name === n), n)
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, true, t.name)
      assert.equal(t.annotations.destructiveHint, false, t.name)
      assert.equal(typeof t.annotations.idempotentHint, 'boolean', t.name)
      assert.equal(t.annotations.openWorldHint, false, t.name)
      assert.ok(t.annotations.title, t.name)
      if (t.name !== 'forecast' && t.name !== 'reconcile') assert.equal(t.outputSchema?.type, 'object', t.name)
    }
    assert.equal(tools.find(t => t.name === 'query').annotations.idempotentHint, false)
    // Version gating: 2025-03-26 session gets annotations but no outputSchema / title.
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'old', version: '1' } }, { token: owner.token })
    const sid = init.headers['mcp-session-id']
    const old = (await rpc('tools/list', undefined, { token: owner.token, headers: { 'mcp-session-id': sid } })).json.result.tools
    assert.ok(old.every(t => !t.outputSchema && !t.title && t.annotations))
    const c = await callTool(owner.token, 'list_datasources', {}, { headers: { 'mcp-session-id': sid } })
    assert.equal(c.json.result.structuredContent, undefined, 'no structuredContent before 2025-06-18')
    assert.ok(c.json.result.content.every(x => x.type === 'text'))
  })

  await test('structuredContent validates against outputSchema; resource_link points at nl2sql://result/{id}', async () => {
    service.state.settings.resultToModel = 'rows'
    const defs = Object.fromEntries((await rpc('tools/list', undefined, { token: owner.token })).json.result.tools.map(t => [t.name, t]))
    const check = async (name, args, token = owner.token) => {
      const r = (await callTool(token, name, args)).json.result
      assert.equal(r.isError, false, `${name}: ${r.content[0].text}`)
      assert.deepEqual(validate(defs[name].outputSchema, r.structuredContent), [], name)
      return r
    }
    const q = await check('query', { sql: 'select status, count(*) n from blockchain_transactions group by status' })
    const link = q.content.find(c => c.type === 'resource_link')
    assert.equal(link.uri, `nl2sql://result/${q.structuredContent.resultId}`)
    assert.equal(link.mimeType, 'text/csv')
    assert.equal(q.content[0].type, 'text')
    await check('list_datasources', {})
    await check('get_schema', {})
    await check('search_knowledge', { question: '交易笔数' })
    await check('list_metrics', {})
    await check('query_metric', { metric: '交易笔数' })
    await check('explain_sql', { sql: 'select * from blockchain_transactions where id = 1' })
    await check('data_freshness', {})
    await call('pinWidget', { title: '按状态', sql: 'select status, count(*) n from blockchain_transactions group by status', datasourceId: ds.id, chart: { type: 'bar' } })
    await check('list_dashboards', {})
    const d = await check('run_dashboard', { dashboard: service.state.dashboards[0].id })
    assert.ok(d.content.filter(c => c.type === 'resource_link').length >= 1)
  })

  await test('new tools are scoped and audited: list_metrics, list_dashboards, run_dashboard (privacy), explain_sql', async () => {
    service.state.settings.resultToModel = 'summary'
    if (!service.state.dashboards.some(d => d.widgets.some(w => w.title === '按状态'))) await call('pinWidget', { title: '按状态', sql: 'select status, count(*) n from blockchain_transactions group by status', datasourceId: ds.id, chart: { type: 'bar' } })
    const m = (await callTool(scoped.token, 'list_metrics', {})).json.result.structuredContent
    assert.deepEqual(m.metrics.map(x => x.name), ['交易笔数'])
    const ld = (await callTool(scoped.token, 'list_dashboards', {})).json.result.structuredContent
    assert.ok(ld.dashboards[0].widgets.some(w => w.title === '按状态'))
    const rd = (await callTool(scoped.token, 'run_dashboard', { dashboard: ld.dashboards[0].name })).json.result.structuredContent
    const w = rd.results.find(x => x.title === '按状态')
    assert.equal(w.ok, true, w.error)
    assert.equal(w.result.rows, undefined, 'summary privacy: no rows')
    assert.ok(Array.isArray(w.result.summary))
    assert.ok(w.result.rowLevelFilters?.length, 'row rule applied to widgets too')
    const h = historyOf(x => x.resultId === w.result.resultId)
    assert.equal(h.source, 'mcp'); assert.match(h.actor.name, /MCP · scoped/)
    // explain_sql: refusal for a policy-hidden table, plan (no rows) for a valid SELECT
    const deny = (await callTool(scoped.token, 'explain_sql', { sql: 'select * from callback_configs' })).json.result.structuredContent
    assert.equal(deny.admitted, false); assert.match(deny.refusal, /callback_configs/)
    const w2 = (await callTool(scoped.token, 'explain_sql', { sql: 'delete from blockchain_transactions' })).json.result.structuredContent
    assert.equal(w2.admitted, false)
    const ok = (await callTool(scoped.token, 'explain_sql', { sql: 'select * from blockchain_transactions' })).json.result.structuredContent
    assert.equal(ok.admitted, true); assert.ok(Array.isArray(ok.plan) && ok.plan.length); assert.equal(ok.rows, undefined)
    assert.deepEqual(ok.rowLevelRules, ['status IN (1)'])
    assert.equal(typeof ok.scanGuard.wouldRefuse, 'boolean')
    // a viewer-member token cannot see other data sources' widgets / metrics
    const other = await call('saveDatasource', { name: 'MCP+ other', ...MYSQL })
    const narrow = await call('createMcpToken', { name: 'narrow', scope: { role: 'viewer', datasourceIds: [other.id] } })
    const nd = (await callTool(narrow.token, 'list_dashboards', {})).json.result.structuredContent
    assert.equal(nd.dashboards.length, 0)
    const nm = (await callTool(narrow.token, 'list_metrics', { datasource: ds.id })).json.result
    assert.equal(nm.isError, true)
    const nr = (await callTool(narrow.token, 'run_dashboard', { dashboard: ld.dashboards[0].id })).json.result
    assert.equal(nr.isError, true)
    await call('deleteDatasource', { id: other.id })
    await call('revokeMcpToken', { id: narrow.id })
  })

  await test('resources: knowledge (scope-filtered notes), metrics, dashboards, freshness, result CSV with privacy', async () => {
    const list = (await rpc('resources/list', undefined, { token: scoped.token })).json.result.resources.map(r => r.uri)
    for (const u of [`nl2sql://datasource/${ds.id}/knowledge`, `nl2sql://datasource/${ds.id}/metrics`, `nl2sql://datasource/${ds.id}/freshness`, 'nl2sql://dashboards']) assert.ok(list.includes(u), u)
    assert.ok(list.some(u => u.startsWith('nl2sql://dashboard/')))
    const k = JSON.parse((await rpc('resources/read', { uri: `nl2sql://datasource/${ds.id}/knowledge` }, { token: scoped.token })).json.result.contents[0].text)
    assert.equal(k.notes.blockchain_transactions, '链上交易')
    assert.equal(k.notes.callback_configs, undefined, 'notes of hidden tables are not exposed')
    assert.equal(k.metrics[0].name, '交易笔数')
    const mt = JSON.parse((await rpc('resources/read', { uri: `nl2sql://datasource/${ds.id}/metrics` }, { token: scoped.token })).json.result.contents[0].text)
    assert.equal(mt.metrics.length, 1)
    const db = JSON.parse((await rpc('resources/read', { uri: `nl2sql://dashboard/${service.state.dashboards[0].id}` }, { token: scoped.token })).json.result.contents[0].text)
    assert.ok(db.widgets.length >= 1); assert.equal(db.widgets[0].sql, undefined, 'definitions without SQL')
    const fr = JSON.parse((await rpc('resources/read', { uri: `nl2sql://datasource/${ds.id}/freshness` }, { token: scoped.token })).json.result.contents[0].text)
    assert.ok(Array.isArray(fr.tables))
    // result CSV: rows privacy → data rows (capped by modelRows); summary → no rows
    service.state.settings.resultToModel = 'rows'
    service.state.settings.modelRows = 3
    const q = (await callTool(owner.token, 'query', { sql: 'select id, status from blockchain_transactions order by id limit 10' })).json.result.structuredContent
    const csv = (await rpc('resources/read', { uri: `nl2sql://result/${q.resultId}` }, { token: owner.token })).json.result.contents[0]
    assert.equal(csv.mimeType, 'text/csv')
    const lines = csv.text.split('\r\n')
    assert.equal(lines[0], 'id,status'); assert.equal(lines.length, 4, 'header + modelRows rows')
    service.state.settings.resultToModel = 'summary'
    const csv2 = (await rpc('resources/read', { uri: `nl2sql://result/${q.resultId}` }, { token: owner.token })).json.result.contents[0].text
    assert.match(csv2, /privacy=summary/)
    assert.ok(!csv2.split('\r\n').some(l => /^\d+,\d+$/.test(l)), 'no data rows under summary privacy')
    service.state.settings.resultToModel = 'none'
    assert.match((await rpc('resources/read', { uri: `nl2sql://result/${q.resultId}` }, { token: owner.token })).json.result.contents[0].text, /privacy=none/)
    service.state.settings.resultToModel = 'rows'; service.state.settings.modelRows = 20
    // a row-ruled token cannot read an unfiltered owner result; unknown → -32002 (legacy) / -32602 (2026-07-28)
    assert.equal((await rpc('resources/read', { uri: `nl2sql://result/${q.resultId}` }, { token: scoped.token })).json.error.code, -32002)
    assert.equal((await rpc('resources/read', { uri: 'nl2sql://result/r-nope', _meta: MODERN }, { token: owner.token })).json.error.code, -32602)
    const tpl = (await rpc('resources/templates/list', undefined, { token: owner.token })).json.result.resourceTemplates.map(t => t.uriTemplate)
    assert.ok(tpl.includes('nl2sql://result/{resultId}') && tpl.includes('nl2sql://dashboard/{id}'))
  })

  await test('pagination: tools/list and resources/list with opaque cursors; invalid cursor → -32602', async () => {
    service.mcpPageSize = { tools: 4, resources: 3 }
    try {
      const names = []
      let cursor
      let pages = 0
      do {
        const r = (await rpc('tools/list', cursor ? { cursor } : undefined, { token: owner.token })).json.result
        names.push(...r.tools.map(t => t.name)); cursor = r.nextCursor; pages++
      } while (cursor)
      assert.ok(pages >= 3)
      assert.equal(new Set(names).size, names.length)
      assert.ok(names.includes('explain_sql'))
      const r1 = (await rpc('resources/list', undefined, { token: owner.token })).json.result
      assert.equal(r1.resources.length, 3); assert.ok(r1.nextCursor)
      const r2 = (await rpc('resources/list', { cursor: r1.nextCursor }, { token: owner.token })).json.result
      assert.notEqual(r2.resources[0].uri, r1.resources[0].uri)
      assert.equal((await rpc('tools/list', { cursor: 'garbage' }, { token: owner.token })).json.error.code, -32602)
      assert.equal((await rpc('tools/list', { cursor: r1.nextCursor }, { token: owner.token })).json.error.code, -32602, 'cursor of another list')
    } finally { delete service.mcpPageSize }
  })

  await test('SSE: tools/call with progressToken streams notifications/progress (admitted → running → fetched → formatting) then the response', async () => {
    const s = stream({ jsonrpc: '2.0', id: 'p1', method: 'tools/call', params: { name: 'query', arguments: { sql: SLOW_SQL }, _meta: { progressToken: 'tok-1' } } }, { token: owner.token })
    await s.done
    assert.equal(s.status, 200)
    assert.match(s.headers['content-type'], /text\/event-stream/)
    assert.equal(s.headers['x-accel-buffering'], 'no')
    const prog = s.events.filter(e => e.method === 'notifications/progress')
    assert.deepEqual(prog.map(p => p.params.message.split(' ')[0]), ['admitted', 'running', 'fetched', 'formatting'])
    assert.ok(prog.every((p, i) => p.params.progressToken === 'tok-1' && p.params.progress === i + 1), 'monotonic progress')
    assert.match(prog[2].params.message, /1 rows/)
    const last = s.events.at(-1)
    assert.equal(last.id, 'p1'); assert.equal(last.result.isError, false)
    // plain JSON without SSE in Accept, or without a progress token / log level
    const j = await post({ jsonrpc: '2.0', id: 'p2', method: 'tools/call', params: { name: 'list_datasources', arguments: {}, _meta: { progressToken: 'x' } } }, { token: owner.token })
    assert.match(j.headers['content-type'], /application\/json/)
    const j2 = stream({ jsonrpc: '2.0', id: 'p3', method: 'tools/call', params: { name: 'list_datasources', arguments: {} } }, { token: owner.token })
    await j2.done
    assert.match(j2.headers['content-type'], /application\/json/)
  })

  await test('SSE: heartbeat comments keep a long stream alive', async () => {
    service.mcpHeartbeatMs = 150
    try {
      const s = stream({ jsonrpc: '2.0', id: 'hb', method: 'tools/call', params: { name: 'query', arguments: { sql: SLOW_SQL }, _meta: { progressToken: 'hb' } } }, { token: owner.token })
      await s.done
      assert.ok(s.comments.some(c => /keep-alive/.test(c)), JSON.stringify(s.comments))
    } finally { delete service.mcpHeartbeatMs }
  })

  await test('SSE: reconcile reports progress per side', async () => {
    if (typeof service.reconcile !== 'function') return
    const sql = 'select status, count(*) n from blockchain_transactions group by status'
    const s = stream({ jsonrpc: '2.0', id: 'rc', method: 'tools/call', params: { name: 'reconcile', arguments: { left: { sql }, right: { sql }, keys: [{ left: 'status' }] }, _meta: { progressToken: 7 } } }, { token: owner.token })
    await s.done
    const msgs = s.events.filter(e => e.method === 'notifications/progress').map(e => e.params.message)
    assert.ok(msgs.some(m => /left side/.test(m)) && msgs.some(m => /right side/.test(m)), msgs.join(' | '))
    assert.equal(s.events.at(-1).result.isError, false)
  })

  await test('cancellation (2026-07-28): closing the SSE stream aborts the query (KILL QUERY) and audits cancelled', async () => {
    const t0 = Date.now()
    const s = stream({ jsonrpc: '2.0', id: 'c1', method: 'tools/call', params: { name: 'query', arguments: { sql: SLOWER_SQL, title: 'cancel-me-1' }, _meta: { ...MODERN, progressToken: 'c1' } } }, { token: owner.token, headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'query' } })
    await s.waitFor(e => e.params?.message?.startsWith('running'))
    s.close()
    let h
    for (let i = 0; i < 40 && !(h = historyOf(x => x.title === 'cancel-me-1')); i++) await sleep(100)
    assert.ok(h, 'audited')
    assert.equal(h.status, 'cancelled')
    assert.ok(Date.now() - t0 < 5000, `stopped early (${Date.now() - t0} ms)`)
    const log = await call('mcpCallLog', { tokenId: owner.id, limit: 5 })
    assert.equal(log.find(x => x.tool === 'query' && x.status === 'cancelled')?.status, 'cancelled')
  })

  await test('cancellation (legacy): notifications/cancelled for an in-flight request id stops it; no response is sent', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } }, { token: owner.token })
    const sid = init.headers['mcp-session-id']
    const t0 = Date.now()
    const pending = post({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'query', arguments: { sql: SLOWER_SQL, title: 'cancel-me-2' } } }, { token: owner.token, headers: { 'mcp-session-id': sid } })
    await sleep(600)
    const n = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99, reason: 'user' } }, { token: owner.token, headers: { 'mcp-session-id': sid } })
    assert.equal(n.status, 202)
    const r = await pending
    assert.equal(r.status, 204); assert.equal(r.text, '', 'no JSON-RPC response for a cancelled request')
    assert.ok(Date.now() - t0 < 5000)
    assert.equal(historyOf(x => x.title === 'cancel-me-2')?.status, 'cancelled')
    // unknown ids are ignored
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 12345 } }, { token: owner.token })).status, 202)
  })

  await test('legacy subscriptions: GET stream + resources/subscribe → resources/updated after re-analysis; list_changed on data source add', async () => {
    service.mcpWatchMs = 150
    const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sub', version: '1' } }, { token: scoped.token })
    assert.equal(init.json.result.capabilities.resources.subscribe, true)
    assert.equal(init.json.result.capabilities.resources.listChanged, true)
    assert.ok(init.json.result.capabilities.logging && init.json.result.capabilities.completions)
    const sid = init.headers['mcp-session-id']
    const hdr = { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-11-25' }
    const g = stream(undefined, { token: scoped.token, method: 'GET', headers: { ...hdr, accept: 'text/event-stream' } })
    await sleep(200)
    assert.equal(g.status, 200)
    const uri = `nl2sql://datasource/${ds.id}/schema`
    assert.deepEqual((await rpc('resources/subscribe', { uri }, { token: scoped.token, headers: hdr })).json.result, { resultType: 'complete' })
    await sleep(300)
    await call('analyzeSchema', { id: ds.id, refresh: true })
    const upd = await g.waitFor(e => e.method === 'notifications/resources/updated')
    assert.equal(upd.params.uri, uri)
    const extra = await call('saveDatasource', { name: 'MCP+ extra', ...MYSQL })
    await g.waitFor(e => e.method === 'notifications/resources/list_changed')
    // unsubscribe → no further updated notifications
    await rpc('resources/unsubscribe', { uri }, { token: scoped.token, headers: hdr })
    const before = g.events.filter(e => e.method === 'notifications/resources/updated').length
    await call('analyzeSchema', { id: ds.id, refresh: true })
    await sleep(600)
    assert.equal(g.events.filter(e => e.method === 'notifications/resources/updated').length, before)
    // subscribe needs a session; GET without a session → 405; DELETE ends the session
    assert.equal((await rpc('resources/subscribe', { uri }, { token: scoped.token })).json.error.code, -32600)
    assert.equal((await post(undefined, { token: scoped.token, method: 'GET' })).status, 405)
    assert.equal((await post(undefined, { token: scoped.token, method: 'DELETE', headers: hdr })).status, 204)
    await g.done
    assert.equal((await rpc('ping', undefined, { token: scoped.token, headers: hdr })).status, 404)
    await call('deleteDatasource', { id: extra.id })
  })

  await test('2026-07-28 subscriptions/listen: acknowledged first, then tagged updated / list_changed; resources/subscribe not available', async () => {
    const uri = `nl2sql://datasource/${ds.id}/schema`
    const h = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'subscriptions/listen' }
    const s = stream({ jsonrpc: '2.0', id: 42, method: 'subscriptions/listen', params: { _meta: MODERN, notifications: { resourcesListChanged: true, toolsListChanged: true, resourceSubscriptions: [uri, 'nl2sql://datasource/nope/schema'] } } }, { token: owner.token, headers: h })
    const ack = await s.waitFor(e => e.method === 'notifications/subscriptions/acknowledged')
    assert.equal(s.events[0], ack, 'acknowledgment is the first message')
    assert.equal(ack.params._meta['io.modelcontextprotocol/subscriptionId'], 42)
    assert.deepEqual(ack.params.notifications, { resourcesListChanged: true, resourceSubscriptions: [uri] }, 'only supported / visible types acknowledged')
    await sleep(300)
    await call('analyzeSchema', { id: ds.id, refresh: true })
    const upd = await s.waitFor(e => e.method === 'notifications/resources/updated')
    assert.equal(upd.params.uri, uri); assert.equal(upd.params._meta['io.modelcontextprotocol/subscriptionId'], 42)
    const extra = await call('saveDatasource', { name: 'MCP+ extra2', ...MYSQL })
    const lc = await s.waitFor(e => e.method === 'notifications/resources/list_changed')
    assert.equal(lc.params._meta['io.modelcontextprotocol/subscriptionId'], 42)
    s.close()
    await sleep(200)
    assert.equal(service.mcpListeners.size, 0, 'closing the stream ends the subscription')
    await call('deleteDatasource', { id: extra.id })
    const sub = await rpc('resources/subscribe', { uri, _meta: MODERN }, { token: owner.token })
    assert.equal(sub.status, 404); assert.equal(sub.json.error.code, -32601)
    // server shutdown sends the graceful completion result
    const s2 = stream({ jsonrpc: '2.0', id: 43, method: 'subscriptions/listen', params: { _meta: MODERN, notifications: { resourcesListChanged: true } } }, { token: owner.token, headers: h })
    await s2.waitFor(e => e.method === 'notifications/subscriptions/acknowledged')
    await call('revokeMcpToken', { id: (await call('createMcpToken', { name: 'tmp-listen' })).id }) // unrelated token: stream stays
    assert.equal(s2.ended, false)
    for (const l of [...service.mcpListeners]) l.close()
    await s2.done
    assert.equal(s2.events.at(-1).id, 43); assert.equal(s2.events.at(-1).result.resultType, 'complete')
  })

  await test('prompts: analyze_table, compare_periods, reconcile_sources (+ ask_data); missing argument → -32602', async () => {
    const list = (await rpc('prompts/list', undefined, { token: owner.token })).json.result.prompts.map(p => p.name)
    assert.deepEqual(list, ['ask_data', 'analyze_table', 'compare_periods', 'reconcile_sources'])
    const a = (await rpc('prompts/get', { name: 'analyze_table', arguments: { datasource: ds.name, table: 'blockchain_transactions' } }, { token: owner.token })).json.result
    assert.match(a.messages[0].content.text, /blockchain_transactions/)
    const c = (await rpc('prompts/get', { name: 'compare_periods', arguments: { metric: '交易笔数', period: 'month' } }, { token: owner.token })).json.result
    assert.match(c.messages[0].content.text, /explain_change/); assert.match(c.messages[0].content.text, /previous month/)
    const r = (await rpc('prompts/get', { name: 'reconcile_sources', arguments: { left: 'orders', right: 'finance' } }, { token: owner.token })).json.result
    assert.match(r.messages[0].content.text, /Left \(reference\): orders/)
    assert.equal((await rpc('prompts/get', { name: 'analyze_table', arguments: { datasource: 'x' } }, { token: owner.token })).json.error.code, -32602)
    assert.equal((await rpc('prompts/get', { name: 'nope' }, { token: owner.token })).json.error.code, -32602)
  })

  await test('completion/complete: data sources, tables and metrics scoped to the token', async () => {
    const other = await call('saveDatasource', { name: 'MCP+ zzz', ...MYSQL })
    const comp = (token, ref, name, value, context) => rpc('completion/complete', { ref, argument: { name, value }, ...(context ? { context: { arguments: context } } : {}) }, { token })
    const o = (await comp(owner.token, { type: 'ref/prompt', name: 'analyze_table' }, 'datasource', 'MCP+')).json.result.completion
    assert.ok(o.values.includes('MCP+ zzz') && o.values.includes('MCP+ MySQL'))
    const s = (await comp(scoped.token, { type: 'ref/prompt', name: 'analyze_table' }, 'datasource', 'MCP+')).json.result.completion
    assert.deepEqual(s.values, ['MCP+ MySQL'], 'scoped token sees only its data sources')
    const t = (await comp(scoped.token, { type: 'ref/prompt', name: 'analyze_table' }, 'table', 'c', { datasource: ds.name })).json.result.completion
    assert.ok(t.values.includes('collections'))
    assert.ok(!t.values.some(v => v.startsWith('callback_')), 'policy-hidden tables not completed')
    const tr = (await comp(scoped.token, { type: 'ref/resource', uri: 'nl2sql://datasource/{id}/table/{table}' }, 'table', 'blockchain_t', { id: ds.id })).json.result.completion
    assert.deepEqual(tr.values, ['blockchain_transactions'])
    const m = (await comp(scoped.token, { type: 'ref/prompt', name: 'compare_periods' }, 'metric', '交易')).json.result.completion
    assert.deepEqual(m.values, ['交易笔数'])
    assert.equal((await comp(scoped.token, { type: 'ref/prompt', name: 'compare_periods' }, 'metric', 'tx')).json.result.completion.values[0], 'tx count')
    const id = (await comp(scoped.token, { type: 'ref/resource', uri: 'nl2sql://datasource/{id}/schema' }, 'id', '')).json.result.completion
    assert.deepEqual(id.values, [ds.id])
    assert.equal((await comp(owner.token, { type: 'ref/prompt', name: 'nope' }, 'x', '')).json.error.code, -32602)
    await call('deleteDatasource', { id: other.id })
  })

  await test('logging: legacy logging/setLevel → notifications/message (privacy redaction, truncation); modern per-request _meta level; none without a level', async () => {
    service.state.settings.resultToModel = 'summary'
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'log', version: '1' } }, { token: owner.token })
    const hdr = { 'mcp-session-id': init.headers['mcp-session-id'], 'mcp-protocol-version': '2025-06-18' }
    assert.equal((await rpc('logging/setLevel', { level: 'loud' }, { token: owner.token, headers: hdr })).json.error.code, -32602)
    assert.deepEqual((await rpc('logging/setLevel', { level: 'notice' }, { token: owner.token, headers: hdr })).json.result, { resultType: 'complete' })
    const s = stream({ jsonrpc: '2.0', id: 'l1', method: 'tools/call', params: { name: 'query', arguments: { sql: 'select status from blockchain_transactions' } } }, { token: owner.token, headers: hdr })
    await s.done
    const msgs = s.events.filter(e => e.method === 'notifications/message')
    assert.ok(msgs.some(m => m.params.data.event === 'privacy-redaction' && m.params.level === 'notice'), JSON.stringify(s.events).slice(0, 300))
    assert.equal(s.events.at(-1).id, 'l1')
    // truncation warning
    service.state.settings.maxRows = 2
    const s2 = stream({ jsonrpc: '2.0', id: 'l2', method: 'tools/call', params: { name: 'query', arguments: { sql: 'select id from blockchain_transactions' } } }, { token: owner.token, headers: hdr })
    await s2.done
    assert.ok(s2.events.some(e => e.method === 'notifications/message' && e.params.level === 'warning' && e.params.data.event === 'truncated'))
    delete service.state.settings.maxRows
    service.state.settings.maxRows = 500
    // modern: per-request level; logging/setLevel removed; no messages without the field
    const mh = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'query' }
    const s3 = stream({ jsonrpc: '2.0', id: 'l3', method: 'tools/call', params: { name: 'query', arguments: { sql: 'select status from blockchain_transactions' }, _meta: { ...MODERN, 'io.modelcontextprotocol/logLevel': 'info' } } }, { token: owner.token, headers: mh })
    await s3.done
    assert.ok(s3.events.some(e => e.method === 'notifications/message'))
    const s4 = stream({ jsonrpc: '2.0', id: 'l4', method: 'tools/call', params: { name: 'query', arguments: { sql: 'select status from blockchain_transactions' }, _meta: { ...MODERN, progressToken: 'q' } } }, { token: owner.token, headers: mh })
    await s4.done
    assert.ok(!s4.events.some(e => e.method === 'notifications/message'), 'MUST NOT emit without io.modelcontextprotocol/logLevel')
    const sl = await rpc('logging/setLevel', { level: 'info', _meta: MODERN }, { token: owner.token })
    assert.equal(sl.status, 404)
    const bad = await rpc('tools/list', { _meta: { ...MODERN, 'io.modelcontextprotocol/logLevel': 'chatty' } }, { token: owner.token })
    assert.equal(bad.status, 400); assert.equal(bad.json.error.code, -32602)
    service.state.settings.resultToModel = 'rows'
  })

  await test('tokens: expiry → 401 with a clear message; past expiry refused at creation', async () => {
    await assert.rejects(call('createMcpToken', { name: 'past', expiresAt: Date.now() - 1000 }), /晚于现在/)
    const t = await call('createMcpToken', { name: 'expiring', expiresAt: Date.now() + 3600000 })
    assert.ok(t.expiresAt > Date.now())
    assert.equal((await rpc('ping', undefined, { token: t.token })).status, 200)
    service.state.mcp.tokens.find(x => x.id === t.id).expiresAt = Date.now() - 1
    const r = await rpc('ping', undefined, { token: t.token })
    assert.equal(r.status, 401)
    assert.match(r.json.error.message, /expired/)
    assert.match(r.headers['www-authenticate'], /invalid_token/)
    assert.equal((await call('mcpStatus')).tokens.find(x => x.id === t.id).expired, true)
    // extend via updateMcpToken → works again, secret never re-revealed
    const u = await call('updateMcpToken', { id: t.id, expiresAt: null })
    assert.equal(u.token, undefined); assert.equal(u.expiresAt, null)
    assert.equal((await rpc('ping', undefined, { token: t.token })).status, 200)
    await call('revokeMcpToken', { id: t.id })
  })

  await test('tokens: tool allowlist filters tools/list and refuses other tools/call', async () => {
    await assert.rejects(call('createMcpToken', { name: 'bad-allow', tools: ['drop_table'] }), /未知工具/)
    const t = await call('createMcpToken', { name: 'allow', tools: ['list_datasources', 'query'] })
    assert.deepEqual(t.tools, ['list_datasources', 'query'])
    const names = (await rpc('tools/list', undefined, { token: t.token })).json.result.tools.map(x => x.name)
    assert.deepEqual(names, ['list_datasources', 'query'])
    const r = await callTool(t.token, 'get_schema', {})
    assert.equal(r.json.error.code, -32602); assert.match(r.json.error.message, /not allowed/)
    assert.equal((await callTool(t.token, 'list_datasources', {})).json.result.isError, false)
    const u = await call('updateMcpToken', { id: t.id, tools: null, name: 'allow-all' })
    assert.equal(u.tools, null); assert.equal(u.name, 'allow-all')
    assert.equal((await callTool(t.token, 'get_schema', {})).json.result.isError, false)
    await call('revokeMcpToken', { id: t.id })
  })

  await test('tokens: per-token rate limit → 429 with Retry-After', async () => {
    const t = await call('createMcpToken', { name: 'limited', rateLimit: 3 })
    for (let i = 0; i < 3; i++) assert.equal((await rpc('ping', undefined, { token: t.token })).status, 200)
    const r = await rpc('ping', undefined, { token: t.token })
    assert.equal(r.status, 429)
    assert.ok(Number(r.headers['retry-after']) >= 1 && Number(r.headers['retry-after']) <= 60)
    assert.match(r.json.error.message, /rate limit 3\/min/)
    assert.equal((await rpc('ping', undefined, { token: owner.token })).status, 200, 'other tokens unaffected')
    const log = await call('mcpCallLog', { tokenId: t.id })
    assert.equal(log[0].status, 'rate-limited')
    await call('updateMcpToken', { id: t.id, rateLimit: null })
    assert.equal((await rpc('ping', undefined, { token: t.token })).status, 200)
    await call('revokeMcpToken', { id: t.id })
  })

  await test('call log: per token entries (time, tool, datasource, ms, status, rows), no result rows, SQL capped at 2000 chars', async () => {
    const t = await call('createMcpToken', { name: 'logged' })
    await callTool(t.token, 'query', { sql: `select status, count(*) n from blockchain_transactions /* ${'x'.repeat(3000)} */ group by status` })
    await callTool(t.token, 'query', { sql: 'select * from callback_configs' }) // ok for owner policy? hidden → error
    await rpc('tools/list', undefined, { token: t.token })
    const log = await call('mcpCallLog', { tokenId: t.id, limit: 10 })
    assert.equal(log.length, 3)
    assert.ok(log.every(x => x.tokenId === t.id && typeof x.at === 'number' && typeof x.ms === 'number'))
    const q = log.find(x => x.tool === 'query' && x.status === 'ok')
    assert.equal(q.datasource, 'MCP+ MySQL'); assert.ok(q.rows >= 1)
    assert.equal(q.sql.length, 2000)
    assert.ok(!('result' in q) && !('structuredContent' in q))
    const e = log.find(x => x.tool === 'query' && x.status === 'error')
    assert.match(e.error, /callback_configs/)
    assert.equal(log.find(x => x.method === 'tools/list').status, 'ok')
    assert.ok((await call('mcpCallLog', { limit: 1000 })).length > 3, 'all tokens without tokenId')
    assert.equal((await call('mcpCallLog', { tokenId: t.id, status: 'error' })).length, 1)
    await call('revokeMcpToken', { id: t.id })
  })

  await test('rotate secret: new secret shown once, the old one stops working, settings kept', async () => {
    const t = await call('createMcpToken', { name: 'rot', tools: ['list_datasources'], rateLimit: 100 })
    const r = await call('rotateMcpToken', { id: t.id })
    assert.notEqual(r.token, t.token); assert.match(r.token, /^n2s_mcp_/)
    assert.equal((await rpc('ping', undefined, { token: t.token })).status, 401)
    assert.equal((await rpc('ping', undefined, { token: r.token })).status, 200)
    assert.deepEqual(r.tools, ['list_datasources']); assert.equal(r.rateLimit, 100)
    assert.ok(!JSON.stringify(service.state.mcp).includes(r.token))
    assert.equal((await call('mcpStatus')).tokens.find(x => x.id === t.id).token, undefined)
    await call('revokeMcpToken', { id: t.id })
  })

  await test('mcpSelfTest: discover + tools/list + initialize over loopback with a temporary credential (nothing persisted)', async () => {
    const before = service.state.mcp.tokens.length
    const r = await call('mcpSelfTest')
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.steps.map(s => s.step), ['server/discover', 'tools/list', 'initialize (2025-11-25)'])
    assert.ok(r.tools.includes('query'))
    assert.equal(service.state.mcp.tokens.length, before)
    assert.equal(service.mcpTempTokens.size, 0)
    assert.ok(!service.records.list('mcpCall', { limit: 50 }).some(x => x.tokenName === '(self-test)'))
  })

  await test('stdio bridge forwards SSE progress notifications to stdout before the response', async () => {
    const child = spawn(process.execPath, [join(PLUGIN_DIR, 'bin', 'nl2sql-mcp.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: owner.token }, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = []
    let buf = ''
    let stderr = ''
    child.stderr.on('data', c => { stderr += c })
    child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) lines.push(JSON.parse(l)) } })
    const waitFor = async (pred, ms = 20000) => { const d = Date.now() + ms; while (!lines.some(pred)) { if (Date.now() > d) throw new Error(`timeout; stderr ${stderr}; lines ${JSON.stringify(lines).slice(0, 400)}`); await sleep(50) } return lines.find(pred) }
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query', arguments: { sql: SLOW_SQL }, _meta: { progressToken: 'bridge' } } })}\n`)
      await waitFor(l => l.id === 1)
      const idx = lines.findIndex(l => l.id === 1)
      const prog = lines.slice(0, idx).filter(l => l.method === 'notifications/progress')
      assert.ok(prog.length >= 3, JSON.stringify(lines))
      assert.ok(prog.every(p => p.params.progressToken === 'bridge'))
      // stdio cancellation: notifications/cancelled closes the HTTP stream; no response
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query', arguments: { sql: SLOWER_SQL, title: 'bridge-cancel' }, _meta: { ...MODERN, progressToken: 'b2' } } })}\n`)
      await waitFor(l => l.params?.progressToken === 'b2' && /running/.test(l.params.message))
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } })}\n`)
      let h
      for (let i = 0; i < 40 && !(h = historyOf(x => x.title === 'bridge-cancel')); i++) await sleep(100)
      assert.equal(h?.status, 'cancelled')
      await sleep(300)
      assert.ok(!lines.some(l => l.id === 2), 'no response for the cancelled request')
    } finally {
      child.stdin.end()
      await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r() }, 3000) })
    }
  })

  await test('stdio bridge: legacy session opens the GET stream and forwards resources/updated', async () => {
    service.mcpWatchMs = 150
    const child = spawn(process.execPath, [join(PLUGIN_DIR, 'bin', 'nl2sql-mcp.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: owner.token }, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = []
    let buf = ''
    child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) lines.push(JSON.parse(l)) } })
    const waitFor = async (pred, ms = 15000) => { const d = Date.now() + ms; while (!lines.some(pred)) { if (Date.now() > d) throw new Error(`timeout ${JSON.stringify(lines).slice(0, 400)}`); await sleep(50) } return lines.find(pred) }
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'b', version: '1' } } })}\n`)
      await waitFor(l => l.id === 1)
      const uri = `nl2sql://datasource/${ds.id}/schema`
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri } })}\n`)
      await waitFor(l => l.id === 2)
      await sleep(400)
      await call('analyzeSchema', { id: ds.id, refresh: true })
      const n = await waitFor(l => l.method === 'notifications/resources/updated')
      assert.equal(n.params.uri, uri)
    } finally {
      child.stdin.end()
      await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r() }, 3000) })
    }
  })
} finally {
  await app.close()
}
summary()
