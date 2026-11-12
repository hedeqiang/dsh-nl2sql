/**
 * Shared HTTP helpers for channel adapters.
 *
 * Adapters throw `ChannelError(code, message)`: a stable code such as
 * `channel/auth`, `channel/config`, `channel/network`, `channel/rate-limit`,
 * `channel/rejected` (or a platform-specific `channel/<platform>-<code>`) and
 * a Chinese user-facing message.
 */

export class ChannelError extends Error {
  /** @param {{ field?: string }} [opts] - `field`: the form field key the error belongs to. */
  constructor(code, message, { field } = {}) {
    super(message)
    this.name = 'ChannelError'
    this.code = code
    if (field) this.field = field
  }
}

function parseBody(text) {
  try { return JSON.parse(text) } catch { return { raw: String(text ?? '').slice(0, 300) } }
}

/**
 * fetch with a timeout. Returns { status, json, headers } — json is the parsed
 * body, or `{ raw }` (first 300 chars) when the body is not JSON.
 * Network failures and timeouts throw ChannelError('channel/network').
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: any, json?: any, timeoutMs?: number, label?: string, fetch?: Function }} [opts]
 *   `json` is serialized as the request body with a JSON content type;
 *   `label` names the platform in error messages (e.g. '飞书').
 */
export async function request(url, { method, headers = {}, body, json, timeoutMs = 15000, label = '', fetch: fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const init = { method: method ?? (json !== undefined || body !== undefined ? 'POST' : 'GET'), headers: { ...headers }, signal: controller.signal }
  if (json !== undefined) {
    init.headers['content-type'] ??= 'application/json; charset=utf-8'
    init.body = JSON.stringify(json)
  } else if (body !== undefined) {
    init.body = body
  }
  try {
    const res = await fetchImpl(url, init)
    const text = await res.text()
    return { status: res.status, json: parseBody(text), headers: res.headers }
  } catch (error) {
    const who = label ? `${label}接口` : '接口'
    throw new ChannelError('channel/network', error?.name === 'AbortError' ? `请求${who}超时` : `无法访问${who}：${error?.cause?.code ?? error?.message ?? error}`)
  } finally {
    clearTimeout(timer)
  }
}

/** POST a JSON body. Returns { status, json }. */
export function postJson(url, body, headers = {}, opts = {}) {
  return request(url, { ...opts, method: 'POST', headers, json: body })
}

/** GET a URL. Returns { status, json }. */
export function getJson(url, headers = {}, opts = {}) {
  return request(url, { ...opts, method: 'GET', headers })
}
