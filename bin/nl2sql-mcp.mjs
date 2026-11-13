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
 *
 * Streaming (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http):
 * SSE responses are parsed incrementally, so notifications/progress and notifications/message
 * reach stdout while the request runs; `:` comment lines (heartbeats) are ignored. A
 * subscriptions/listen request stays open and forwards its notifications.
 * Cancellation (https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation):
 * on stdio the client sends notifications/cancelled; the bridge closes the HTTP response
 * stream of that request (the HTTP cancellation signal) and also forwards the notification
 * for legacy sessions. Legacy sessions (2025-03-26 … 2025-11-25): after initialize the bridge
 * opens the standalone GET SSE stream and forwards server notifications (resources/updated,
 * resources/list_changed).
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
let getStream // AbortController of the legacy GET stream
/** In-flight requests: JSON-RPC id → AbortController (closing the response stream cancels on the server). */
const inflight = new Map()

/** Header-safe value (Base64 sentinel for non-ASCII), per the Streamable HTTP binding. */
function headerValue(v) {
  const s = String(v)
  return /^[\x20-\x7e]*$/.test(s) && s.trim() === s && !/^=\?base64\?.*\?=$/.test(s) ? s : `=?base64?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

/** Read an SSE body incrementally; calls onMessage for every `data:` event (comments ignored). */
async function readSse(body, onMessage) {
  const decoder = new TextDecoder()
  let buf = ''
  const flush = (block) => {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
    if (data) { try { onMessage(JSON.parse(data)) } catch {} }
  }
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true })
    let m
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      flush(buf.slice(0, m.index))
      buf = buf.slice(m.index + m[0].length)
    }
  }
  if (buf.trim()) flush(buf)
}

function headersFor(msg) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`
  const metaVersion = msg?.params?._meta?.['io.modelcontextprotocol/protocolVersion']
  if (sessionId && !metaVersion) headers['mcp-session-id'] = sessionId
  const version = metaVersion || protocolVersion
  if (version && msg?.method !== 'initialize') headers['mcp-protocol-version'] = version
  if (typeof msg?.method === 'string') headers['mcp-method'] = msg.method
  const name = msg?.params?.name ?? msg?.params?.uri
  if (name !== undefined && metaVersion) headers['mcp-name'] = headerValue(name)
  return headers
}

/** Legacy standalone GET SSE stream for server notifications (resources/updated, list_changed). */
async function openGetStream() {
  if (!sessionId || getStream) return
  const ctl = new AbortController()
  getStream = ctl
  try {
    const headers = { accept: 'text/event-stream', 'mcp-session-id': sessionId }
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion
    const res = await fetch(URL_, { method: 'GET', headers, signal: ctl.signal })
    if (res.status !== 200 || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) { await res.body?.cancel?.(); return }
    await readSse(res.body, (m) => { if (m && !('id' in m)) write(m) })
  } catch {} finally { if (getStream === ctl) getStream = undefined }
}

async function forward(msg) {
  const isRequest = msg && typeof msg === 'object' && 'id' in msg && typeof msg.method === 'string'
  // stdio cancellation → close the HTTP stream of that request.
  if (msg?.method === 'notifications/cancelled' && msg.params?.requestId !== undefined) {
    const ctl = inflight.get(msg.params.requestId)
    if (ctl) ctl.abort()
    // Legacy sessions also get the notification (the server stops the work by request id).
    if (!sessionId) return
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  if (isRequest) inflight.set(msg.id, ctl)
  let res
  try {
    try {
      res = await fetch(URL_, { method: 'POST', headers: headersFor(msg), body: JSON.stringify(msg), signal: ctl.signal })
    } catch (e) {
      if (isRequest && !ctl.signal.aborted) errorReply(msg.id, -32000, `Cannot reach the nl2sql MCP server at ${URL_} (${e.cause?.code ?? e.message}). Enable it in DeepSeek Harness → Data Q&A → MCP access and keep DeepSeek Harness running.`)
      return
    }
    const sid = res.headers.get('mcp-session-id')
    if (sid) sessionId = sid
    const type = res.headers.get('content-type') ?? ''
    const emit = (body) => {
      if (body?.result?.protocolVersion && msg?.method === 'initialize') protocolVersion = body.result.protocolVersion
      write(body)
    }
    if (type.includes('text/event-stream')) {
      // Request-scoped SSE stream: forward every event as it arrives (progress, log messages, then the response).
      try {
        await readSse(res.body, emit)
      } catch (e) {
        if (!ctl.signal.aborted && isRequest) errorReply(msg.id, -32000, `Stream interrupted: ${e.message}`)
      }
      return
    }
    const text = await res.text()
    if (res.status === 202 || res.status === 204 || !text) {
      if (isRequest && res.status !== 204) errorReply(msg.id, -32000, `HTTP ${res.status} without a response body`)
      return
    }
    let body
    try { body = JSON.parse(text) } catch {
      if (isRequest) errorReply(msg.id, -32000, `HTTP ${res.status}: ${text.slice(0, 200)}`)
      return
    }
    if (Array.isArray(body)) { for (const b of body) emit(b); return }
    if (body && typeof body === 'object' && body.jsonrpc === '2.0') {
      // Errors without an id (401 / 403 / 429) belong to this request.
      if (isRequest && (body.id === null || body.id === undefined) && body.error) body.id = msg.id
      if (res.status === 404 && sessionId && msg?.method !== 'initialize') { sessionId = undefined; getStream?.abort() }
      emit(body)
      if (msg?.method === 'initialize' && sessionId && body.result) openGetStream()
    } else if (isRequest) errorReply(msg.id, -32000, `HTTP ${res.status}`)
  } catch (e) {
    if (!ctl.signal.aborted) throw e
  } finally {
    clearTimeout(timer)
    if (isRequest && inflight.get(msg.id) === ctl) inflight.delete(msg.id)
  }
}

function finish() {
  if (!ended || pending) return
  getStream?.abort()
  process.exit(0)
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
    forward(msg).catch(e => log('forward failed:', e.message)).finally(() => { pending--; finish() })
  }
})
process.stdin.on('end', () => { ended = true; finish() })
