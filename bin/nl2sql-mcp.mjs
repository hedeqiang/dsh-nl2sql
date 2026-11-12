#!/usr/bin/env node
/**
 * nl2sql-mcp — stdio bridge to the DeepSeek Harness Data Q&A MCP server.
 *
 * Speaks MCP over stdio (newline-delimited JSON-RPC 2.0) and forwards every
 * message to the plugin's Streamable HTTP endpoint, so stdio-only clients
 * (e.g. Claude Desktop) can use it. Plain ESM, Node ≥ 18, no dependencies.
 *
 *   NL2SQL_MCP_URL    default http://127.0.0.1:47860/mcp
 *   NL2SQL_MCP_TOKEN  bearer token created in Data Q&A → MCP access (required)
 *
 *   npx -y -p @hedeqiang/dsh-nl2sql nl2sql-mcp
 */
const URL_ = process.env.NL2SQL_MCP_URL || 'http://127.0.0.1:47860/mcp'
const TOKEN = process.env.NL2SQL_MCP_TOKEN || ''
const TIMEOUT_MS = Number(process.env.NL2SQL_MCP_TIMEOUT_MS) || 11 * 60 * 1000

const log = (...a) => process.stderr.write(`[nl2sql-mcp] ${a.join(' ')}\n`)
const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
const errorReply = (id, code, message, data) => write({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } })

if (typeof fetch !== 'function') { log('Node.js 18 or newer is required (global fetch).'); process.exit(1) }
if (!TOKEN) log('NL2SQL_MCP_TOKEN is not set; requests will be rejected (401). Create a token in DeepSeek Harness → Data Q&A → MCP access.')

let sessionId
let protocolVersion
let pending = 0
let ended = false

/** Header-safe value (Base64 sentinel for non-ASCII), per the Streamable HTTP binding. */
function headerValue(v) {
  const s = String(v)
  return /^[\x20-\x7e]*$/.test(s) && s.trim() === s && !/^=\?base64\?.*\?=$/.test(s) ? s : `=?base64?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

async function forward(msg) {
  const isRequest = msg && typeof msg === 'object' && 'id' in msg && typeof msg.method === 'string'
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`
  if (sessionId) headers['mcp-session-id'] = sessionId
  const metaVersion = msg?.params?._meta?.['io.modelcontextprotocol/protocolVersion']
  const version = metaVersion || protocolVersion
  if (version && msg?.method !== 'initialize') headers['mcp-protocol-version'] = version
  if (typeof msg?.method === 'string') headers['mcp-method'] = msg.method
  const name = msg?.params?.name ?? msg?.params?.uri
  if (name !== undefined && metaVersion) headers['mcp-name'] = headerValue(name)
  let res
  try {
    res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    if (isRequest) errorReply(msg.id, -32000, `Cannot reach the nl2sql MCP server at ${URL_} (${e.cause?.code ?? e.message}). Enable it in DeepSeek Harness → Data Q&A → MCP access and keep DeepSeek Harness running.`)
    return
  }
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const type = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (res.status === 202 || !text) {
    if (isRequest) errorReply(msg.id, -32000, `HTTP ${res.status} without a response body`)
    return
  }
  const emit = (body) => {
    if (body?.result?.protocolVersion && msg?.method === 'initialize') protocolVersion = body.result.protocolVersion
    write(body)
  }
  if (type.includes('text/event-stream')) {
    // Request-scoped SSE stream: forward every `data:` event.
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
      if (data) { try { emit(JSON.parse(data)) } catch {} }
    }
    return
  }
  let body
  try { body = JSON.parse(text) } catch {
    if (isRequest) errorReply(msg.id, -32000, `HTTP ${res.status}: ${text.slice(0, 200)}`)
    return
  }
  if (Array.isArray(body)) { for (const b of body) emit(b); return }
  if (body && typeof body === 'object' && body.jsonrpc === '2.0') {
    // Errors without an id (401 / 403) belong to this request.
    if (isRequest && (body.id === null || body.id === undefined) && body.error) body.id = msg.id
    if (res.status === 404 && sessionId && msg?.method !== 'initialize') sessionId = undefined
    emit(body)
  } else if (isRequest) errorReply(msg.id, -32000, `HTTP ${res.status}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim()
    buffer = buffer.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { errorReply(null, -32700, 'Parse error'); continue }
    pending++
    forward(msg).catch(e => log('forward failed:', e.message)).finally(() => { pending--; if (ended && !pending) process.exit(0) })
  }
})
process.stdin.on('end', () => { ended = true; if (!pending) process.exit(0) })
