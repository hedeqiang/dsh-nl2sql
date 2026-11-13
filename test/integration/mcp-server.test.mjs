// MCP server (service/mcp.js) against MySQL: Streamable HTTP on an ephemeral
// port, bearer tokens with scopes (owner / role + row rules / member), access
// policy, privacy modes, Origin / Host checks, resources, and the stdio bridge
// bin/nl2sql-mcp.mjs spawned as a child process.
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, PLUGIN_DIR, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'mcp' })
const { call, service } = app
let ds, url, port, scoped, owner

/** Raw HTTP POST (lets us set Host / Origin freely). */
function post(body, { token, headers = {}, method = 'POST', path = '/mcp' } = {}) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, 'content-length': Buffer.byteLength(text) } }, (res) => {
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
const callTool = (token, name, args) => rpc('tools/call', { name, arguments: args }, { token })

try {
  await test('setup: data source, policy hiding callback_*, MCP enabled on an ephemeral port', async () => {
    ds = await call('saveDatasource', { name: 'MCP-MySQL', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    await call('savePolicy', { id: ds.id, policy: { mode: 'deny', tables: ['callback_*'], hiddenColumns: [], maskedColumns: [] } })
    const st0 = await call('mcpStatus')
    assert.equal(st0.enabled, false, 'disabled by default')
    assert.equal(st0.port, 47860)
    assert.equal(service.mcpServer, undefined, 'no server while disabled')
    const st = await call('saveMcpSettings', { enabled: true, port: 0 })
    assert.equal(st.running, true, st.error ?? '')
    port = service.mcpServer.address().port
    assert.equal(service.mcpServer.address().address, '127.0.0.1')
    url = st.url
    assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/mcp$`))
  })

  await test('tokens: created once in plain text, only the SHA-256 hash is stored', async () => {
    owner = await call('createMcpToken', { name: 'owner-token' })
    scoped = await call('createMcpToken', { name: 'scoped', scope: { role: 'analyst', datasourceIds: [ds.id], rowRules: [{ column: 'status', values: ['1'] }] } })
    assert.match(scoped.token, /^n2s_mcp_/)
    const stored = service.state.mcp.tokens.find(t => t.id === scoped.id)
    assert.equal(stored.hash.length, 64)
    assert.ok(!JSON.stringify(service.state.mcp).includes(scoped.token), 'plain token not persisted')
    const listed = (await call('mcpStatus')).tokens
    assert.ok(listed.every(t => !('hash' in t) && !('token' in t)))
    assert.equal(listed.find(t => t.id === scoped.id).scope.type, 'role')
    await assert.rejects(call('createMcpToken', { name: 'bad', scope: { role: 'analyst', datasourceIds: [] } }), /数据源/)
  })

  await test('auth: missing / invalid bearer 401, foreign Origin 403, non-local Host 403, GET 405', async () => {
    const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    const r1 = await rpc('initialize', init)
    assert.equal(r1.status, 401)
    assert.match(r1.headers['www-authenticate'], /Bearer/)
    const r2 = await rpc('initialize', init, { token: 'n2s_mcp_wrong' })
    assert.equal(r2.status, 401)
    const r3 = await rpc('initialize', init, { token: scoped.token, headers: { origin: 'https://evil.example' } })
    assert.equal(r3.status, 403)
    const r3b = await rpc('initialize', init, { token: scoped.token, headers: { origin: `http://localhost:${port}` } })
    assert.equal(r3b.status, 200, 'local Origin allowed')
    const r4 = await rpc('initialize', init, { token: scoped.token, headers: { host: `evil.example:${port}` } })
    assert.equal(r4.status, 403, 'DNS rebinding: Host must be loopback')
    const r5 = await post(undefined, { token: scoped.token, method: 'GET' })
    assert.equal(r5.status, 405)
    const r6 = await post('{nope', { token: scoped.token })
    assert.equal(r6.status, 400)
    assert.equal(r6.json.error.code, -32700)
  })

  let sid
  await test('legacy handshake: initialize negotiates the version, mints Mcp-Session-Id; initialized → 202; ping', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, { token: scoped.token })
    assert.equal(r.status, 200)
    assert.equal(r.json.result.protocolVersion, '2025-06-18')
    assert.ok(r.json.result.capabilities.tools && r.json.result.capabilities.resources)
    assert.equal(r.json.result.serverInfo.name, 'nl2sql')
    sid = r.headers['mcp-session-id']
    assert.match(sid, /^[0-9a-f]{32}$/)
    const unknown = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} }, { token: scoped.token })
    assert.equal(unknown.json.result.protocolVersion, '2025-11-25', 'unsupported → latest legacy version offered')
    const n = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token: scoped.token, headers: { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' } })
    assert.equal(n.status, 202)
    assert.equal(n.text, '')
    const p = await rpc('ping', undefined, { token: scoped.token, headers: { 'mcp-session-id': sid } })
    assert.deepEqual(p.json.result, { resultType: 'complete' })
    const bad = await rpc('ping', undefined, { token: scoped.token, headers: { 'mcp-session-id': 'deadbeef' } })
    assert.equal(bad.status, 404, 'unknown session → 404')
    const foreign = await rpc('ping', undefined, { token: owner.token, headers: { 'mcp-session-id': sid } })
    assert.equal(foreign.status, 404, 'a session belongs to its token')
    const nf = await rpc('nope/method', undefined, { token: scoped.token })
    assert.equal(nf.json.error.code, -32601)
  })

  await test('modern (2026-07-28): server/discover, per-request _meta, header checks, unsupported version', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }
    const d = await rpc('server/discover', { _meta: meta }, { token: scoped.token, headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' } })
    assert.equal(d.status, 200)
    assert.ok(d.json.result.supportedVersions.includes('2026-07-28'))
    assert.equal(d.json.result.resultType, 'complete')
    assert.equal(d.json.result._meta['io.modelcontextprotocol/serverInfo'].name, 'nl2sql')
    assert.equal(d.headers['mcp-session-id'], undefined, 'no sessions in the modern era')
    const mism = await rpc('tools/list', { _meta: meta }, { token: scoped.token, headers: { 'mcp-protocol-version': '2025-06-18' } })
    assert.equal(mism.status, 400)
    assert.equal(mism.json.error.code, -32020)
    const old = await rpc('tools/list', { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } }, { token: scoped.token })
    assert.equal(old.status, 400)
    assert.equal(old.json.error.code, -32022)
    assert.ok(old.json.error.data.supported.includes('2026-07-28'))
    const nf = await rpc('nope/method', { _meta: meta }, { token: scoped.token })
    assert.equal(nf.status, 404)
    const q = await rpc('tools/call', { name: 'list_datasources', arguments: {}, _meta: meta }, { token: scoped.token, headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'list_datasources' } })
    assert.equal(q.json.result.isError, false)
  })

  await test('tools/list: core tools with input schemas; reconcile / forecast only when the service has them', async () => {
    const r = await rpc('tools/list', undefined, { token: scoped.token })
    const names = r.json.result.tools.map(t => t.name)
    for (const n of ['list_datasources', 'get_schema', 'query', 'query_metric', 'search_knowledge', 'drill', 'explain_change']) assert.ok(names.includes(n), n)
    assert.equal(names.includes('reconcile'), typeof service.reconcile === 'function')
    assert.equal(names.includes('forecast'), typeof service.forecast === 'function')
    const q = r.json.result.tools.find(t => t.name === 'query')
    assert.deepEqual(q.inputSchema.required, ['sql'])
    assert.match(q.description, /read-only/i)
    assert.equal(q.annotations.readOnlyHint, true)
  })

  await test('tools/call query (scoped token): row rule injected, audited as mcp with the token name', async () => {
    service.state.settings.resultToModel = 'rows'
    const r = await callTool(scoped.token, 'query', { sql: 'select status, count(*) n from blockchain_transactions group by status', title: 'by status' })
    const v = r.json.result.structuredContent
    assert.equal(r.json.result.isError, false, r.json.result.content[0].text)
    assert.equal(v.rowCount, 1, 'only status=1 rows visible')
    assert.equal(String(v.rows[0][0]), '1')
    assert.match(v.sql, /`status` IN \('1'\)/)
    assert.ok(v.rowLevelFilters?.length)
    assert.deepEqual(v.columns.map(c => c.name), ['status', 'n'])
    const h = service.records.list('history', { limit: 5 }).find(x => x.resultId === v.resultId)
    assert.equal(h.source, 'mcp')
    assert.match(h.actor.name, /MCP · scoped/)
    // nested queries are refused for row-ruled actors
    const nested = await callTool(scoped.token, 'query', { sql: 'select * from (select * from blockchain_transactions) t' })
    assert.equal(nested.json.result.isError, true)
    assert.match(nested.json.result.content[0].text, /行级权限/)
  })

  await test('tools/call query: policy-hidden table refused; writes refused; owner token unrestricted rows', async () => {
    const r = await callTool(scoped.token, 'query', { sql: 'select * from callback_configs' })
    assert.equal(r.json.result.isError, true)
    assert.match(r.json.result.content[0].text, /无权查询表：callback_configs/)
    const w = await callTool(owner.token, 'query', { sql: 'delete from blockchain_transactions' })
    assert.equal(w.json.result.isError, true)
    const o = await callTool(owner.token, 'query', { sql: 'select status, count(*) n from blockchain_transactions group by status' })
    assert.ok(o.json.result.structuredContent.rowCount >= 1)
    const blocked = service.records.list('history', { limit: 10 }).find(x => x.status === 'blocked' && x.source === 'mcp')
    assert.ok(blocked, 'refusals audited too')
  })

  await test('privacy: resultToModel none / summary / rows shape the tool output; modelRows caps rows', async () => {
    const sql = 'select chain_type, count(*) n from blockchain_transactions group by chain_type'
    service.state.settings.resultToModel = 'none'
    let v = (await callTool(owner.token, 'query', { sql })).json.result.structuredContent
    assert.equal(v.rows, undefined); assert.equal(v.summary, undefined); assert.equal(v.privacy, 'none'); assert.ok(v.rowCount >= 1)
    service.state.settings.resultToModel = 'summary'
    v = (await callTool(owner.token, 'query', { sql })).json.result.structuredContent
    assert.equal(v.rows, undefined); assert.ok(Array.isArray(v.summary)); assert.equal(v.summary[0].name, 'chain_type')
    service.state.settings.resultToModel = 'rows'
    service.state.settings.modelRows = 1
    v = (await callTool(owner.token, 'query', { sql: 'select id from blockchain_transactions limit 5' })).json.result.structuredContent
    assert.equal(v.rows.length, 1); assert.equal(v.rowCount, 5)
    service.state.settings.modelRows = 20
  })

  await test('get_schema / list_datasources / search_knowledge / drill as the token actor', async () => {
    const l = (await callTool(scoped.token, 'list_datasources', {})).json.result.structuredContent
    assert.deepEqual(l.datasources.map(d => d.name), ['MCP-MySQL'])
    assert.equal(l.datasources[0].dialect, 'MySQL')
    const s = (await callTool(scoped.token, 'get_schema', {})).json.result
    assert.match(s.content[0].text, /blockchain_transactions/)
    assert.doesNotMatch(s.content[0].text, /callback_configs/)
    assert.doesNotMatch(s.content[0].text, /nl2sql_schema/)
    const t = (await callTool(scoped.token, 'get_schema', { tables: ['blockchain_transactions'] })).json.result
    assert.match(t.content[0].text, /## blockchain_transactions/)
    const k = (await callTool(scoped.token, 'search_knowledge', { question: '交易数量' })).json.result
    assert.equal(k.isError, false)
    const base = (await callTool(scoped.token, 'query', { sql: 'select status, count(*) n from blockchain_transactions group by status' })).json.result.structuredContent
    const d = (await callTool(scoped.token, 'drill', { resultId: base.resultId, mode: 'breakdown', dimension: 'chain_type' })).json.result
    assert.equal(d.isError, false, d.content[0].text)
    assert.match(d.structuredContent.sql, /`status` IN \('1'\)/)
    // an owner (unfiltered) result cannot be drilled by the row-ruled token
    const ownerRes = (await callTool(owner.token, 'query', { sql: 'select status, count(*) n from blockchain_transactions group by status' })).json.result.structuredContent
    const deny = (await callTool(scoped.token, 'drill', { resultId: ownerRes.resultId, mode: 'breakdown', dimension: 'chain_type' })).json.result
    assert.equal(deny.isError, true)
  })

  await test('member-scoped token follows the member: scope, role (viewer), disabled → 401', async () => {
    const u = await call('saveUser', { name: 'Viewer V', kind: 'person', role: 'viewer', email: 'v@example.com', datasourceIds: [ds.id] })
    const m = await call('createMcpToken', { name: 'member', scope: { memberId: u.id } })
    const r = await callTool(m.token, 'query', { sql: 'select 1 as x' })
    assert.equal(r.json.result.isError, true)
    assert.match(r.json.result.content[0].text, /只读/)
    await call('saveUser', { id: u.id, disabled: true })
    const r2 = await callTool(m.token, 'list_datasources', {})
    assert.equal(r2.status, 401)
  })

  await test('resources/list + resources/read: schema per visible data source; hidden tables not exposed', async () => {
    const l = await rpc('resources/list', undefined, { token: scoped.token })
    const res = l.json.result.resources
    const schemaRes = res.filter(r => r.uri.endsWith('/schema'))
    assert.equal(schemaRes.length, 1, 'one schema resource per visible data source')
    assert.equal(schemaRes[0].uri, `nl2sql://datasource/${ds.id}/schema`)
    assert.ok(res.some(r => r.uri === `nl2sql://datasource/${ds.id}/knowledge`))
    assert.ok(res.some(r => r.uri === `nl2sql://datasource/${ds.id}/metrics`))
    const r = await rpc('resources/read', { uri: schemaRes[0].uri }, { token: scoped.token })
    assert.equal(r.json.result.contents[0].mimeType, 'text/plain')
    assert.match(r.json.result.contents[0].text, /blockchain_transactions/)
    assert.doesNotMatch(r.json.result.contents[0].text, /callback_configs/)
    const tb = await rpc('resources/read', { uri: `nl2sql://datasource/${ds.id}/table/blockchain_transactions` }, { token: scoped.token })
    assert.match(tb.json.result.contents[0].text, /## blockchain_transactions/)
    const hidden = await rpc('resources/read', { uri: `nl2sql://datasource/${ds.id}/table/callback_configs` }, { token: scoped.token })
    assert.equal(hidden.json.error.code, -32002)
    const p = await rpc('prompts/list', undefined, { token: scoped.token })
    assert.equal(p.json.result.prompts[0].name, 'ask_data')
  })

  await test('stdio bridge: bin/nl2sql-mcp.mjs relays newline-delimited JSON-RPC to the HTTP server', async () => {
    const child = spawn(process.execPath, [join(PLUGIN_DIR, 'bin', 'nl2sql-mcp.mjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: scoped.token },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines = []
    let buf = ''
    let stderr = ''
    child.stderr.on('data', c => { stderr += c })
    const waiters = []
    child.stdout.on('data', (c) => {
      buf += c
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (line.trim()) { lines.push(JSON.parse(line)); for (const w of waiters.splice(0)) w() }
      }
    })
    const waitFor = async (id) => {
      const deadline = Date.now() + 20000
      while (!lines.some(l => l.id === id)) {
        if (Date.now() > deadline) throw new Error(`timeout waiting for id ${id}; stderr: ${stderr}`)
        await new Promise(r => { waiters.push(r); setTimeout(r, 200) })
      }
      return lines.find(l => l.id === id)
    }
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`)
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '1' } } })
      const init = await waitFor(1)
      assert.equal(init.result.protocolVersion, '2025-06-18')
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tl = await waitFor(2)
      assert.ok(tl.result.tools.some(t => t.name === 'query'))
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query', arguments: { sql: 'select status, count(*) n from blockchain_transactions group by status' } } })
      const q = await waitFor(3)
      assert.equal(q.result.isError, false, JSON.stringify(q))
      assert.equal(q.result.structuredContent.rowCount, 1, 'row rule applies through the bridge')
      send({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: `nl2sql://datasource/${ds.id}/schema` } })
      const rr = await waitFor(4)
      assert.match(rr.result.contents[0].text, /blockchain_transactions/)
      child.stdin.write('not json\n')
      await new Promise(r => setTimeout(r, 200))
      assert.ok(lines.some(l => l.error?.code === -32700), 'parse errors reported')
      assert.equal(lines.filter(l => l.id === undefined && !l.error).length, 0, 'no stray output (notifications produce nothing)')
    } finally {
      child.stdin.end()
      await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r() }, 3000) })
    }
  })

  await test('stdio bridge: bad token surfaces a JSON-RPC error with the request id', async () => {
    const child = spawn(process.execPath, [join(PLUGIN_DIR, 'bin', 'nl2sql-mcp.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: 'bad' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', c => { out += c })
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`)
    await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r() }, 10000) })
    const msg = JSON.parse(out.trim().split('\n')[0])
    assert.equal(msg.id, 7)
    assert.equal(msg.error.code, -32001)
  })

  await test('reconcile tool (when the reconcile feature is present) runs both sides as the token actor', async () => {
    if (typeof service.reconcile !== 'function') return
    const sql = 'select status, count(*) n from blockchain_transactions group by status'
    const r = (await callTool(owner.token, 'reconcile', { left: { sql }, right: { sql }, keys: [{ left: 'status' }], compare: [{ left: 'n' }] })).json.result
    assert.equal(r.isError, false, r.content[0].text)
    assert.equal(r.structuredContent.summary.onlyLeft, 0)
    assert.equal(r.structuredContent.summary.mismatchedRows, 0)
  })

  await test('revoke → 401; settings change restarts; disable stops the server', async () => {
    await call('revokeMcpToken', { id: scoped.id })
    assert.equal((await rpc('ping', undefined, { token: scoped.token })).status, 401)
    const before = service.mcpServer
    const st = await call('saveMcpSettings', { port: 0, enabled: true })
    assert.equal(st.running, true)
    // unchanged settings keep the same server
    assert.equal(service.mcpServer, before)
    await call('saveMcpSettings', { enabled: false })
    assert.equal(service.mcpServer, undefined)
    await assert.rejects(rpc('ping', undefined, { token: owner.token }))
    await call('saveMcpSettings', { enabled: true })
    port = service.mcpServer.address().port
    assert.equal((await rpc('ping', undefined, { token: owner.token })).status, 200)
  })

  await test('dispose stops the server (ctx.effect cleanup)', async () => {
    const server = service.mcpServer
    assert.ok(server.listening)
    await app.close()
    assert.equal(server.listening, false)
  })
} finally {
  await app.close()
}
summary()
