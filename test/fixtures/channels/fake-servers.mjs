// Test-only fakes for channel adapters: a JSON HTTP server and a minimal
// RFC 6455 WebSocket server (text frames only) on 127.0.0.1. No dependencies.
import http from 'node:http'
import { createHash } from 'node:crypto'

/**
 * HTTP server; `handler(req, body, res)` returns { status?, json } or writes itself.
 * `calls` records { method, url, headers, body, json, raw }.
 */
export async function fakeHttp(handler) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      let json
      const ct = req.headers['content-type'] ?? ''
      if (ct.includes('json')) { try { json = JSON.parse(raw.toString()) } catch {} }
      const call = { method: req.method, url: req.url, headers: req.headers, raw, json }
      calls.push(call)
      try {
        const out = await handler(call, res)
        if (out === undefined || res.writableEnded) return
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out.json ?? {}))
      } catch (e) {
        if (!res.writableEnded) { res.writeHead(500); res.end(String(e?.message ?? e)) }
      }
    })
  })
  server.on('upgrade', (req, socket) => server.emit('ws', req, socket))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url, calls, server,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) }),
  }
}

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text)
  const len = payload.length
  let head
  if (len < 126) head = Buffer.from([0x80 | opcode, len])
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2) }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2) }
  return Buffer.concat([head, payload])
}

/**
 * WebSocket server. `onConnection(conn, req)` gets
 * conn = { send(objOrText), close(), drop(), messages:[], on(fn), url }.
 */
export async function fakeWs(onConnection) {
  const connections = []
  const server = http.createServer((_, res) => { res.writeHead(404); res.end() })
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    let buf = Buffer.alloc(0)
    const listeners = []
    const conn = {
      url: req.url,
      messages: [],
      closed: false,
      send(m) { if (!conn.closed) socket.write(encodeFrame(typeof m === 'string' ? m : JSON.stringify(m))) },
      close() { if (conn.closed) return; conn.closed = true; try { socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe8])) } catch {}; setTimeout(() => socket.destroy(), 20) },
      drop() { conn.closed = true; socket.destroy() },
      on(fn) { listeners.push(fn) },
    }
    connections.push(conn)
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        const masked = buf[1] & 0x80
        const need = off + (masked ? 4 : 0) + len
        if (buf.length < need) return
        const mask = masked ? buf.subarray(off, off + 4) : null
        const payload = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need))
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
        buf = buf.subarray(need)
        if (opcode === 0x8) { conn.closed = true; try { socket.write(Buffer.from([0x88, 0x00])) } catch {}; socket.end(); return }
        if (opcode === 0x9) { socket.write(encodeFrame(payload.toString(), 0xA)); continue }
        if (opcode !== 0x1) continue
        const text = payload.toString()
        let msg = text
        try { msg = JSON.parse(text) } catch {}
        conn.messages.push(msg)
        for (const fn of listeners) fn(msg)
      }
    })
    socket.on('close', () => { conn.closed = true })
    socket.on('error', () => {})
    onConnection?.(conn, req)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  return {
    url: `ws://127.0.0.1:${port}`, port, connections, server,
    close: () => new Promise(r => { for (const c of connections) c.drop(); server.closeAllConnections?.(); server.close(() => r()) }),
  }
}

/** Poll until fn() is truthy (or throw after timeoutMs). */
export async function waitFor(fn, timeoutMs = 3000, label = 'condition') {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise(r => setTimeout(r, 15))
  }
}
