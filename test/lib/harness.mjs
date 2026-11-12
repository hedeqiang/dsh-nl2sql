// Boots the nl2sql plugin's Host side with a fake Cordis ctx for service tests.
//
//   const app = await boot({ services: { schedule } })
//   await app.call('saveDatasource', {...})          // RPC through the registered fetch route
//   await app.tools.get('nl2sql_query').execute(args, { agent: { id: 's' } })
//   await app.close()                                 // runs disposers, deletes the temp dataDir
import { rmSync } from 'node:fs'
import { plugin, tempDir } from './env.mjs'

export async function boot({ dataDir, services = {}, label = 'svc' } = {}) {
  const dir = dataDir ?? tempDir(label)
  const { apply } = await plugin('index.js')
  const effects = []
  const tools = new Map()
  const creds = new Map()
  let fetchRoute
  const credentials = {
    readRecord: async (k) => creds.get(k),
    modifyRecord: async (k, f) => { const v = await f(creds.get(k)); creds.set(k, v); return v },
    deleteRecord: async (k) => creds.delete(k),
  }
  const quiet = { info() {}, debug() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) }
  const ctx = {
    effect(fn) { const d = fn(); effects.push(d); return d },
    get(k) { return k === 'credentials' ? credentials : services[k] },
    tools: { register(d) { tools.set(d.name, d); return () => tools.delete(d.name) } },
    connection: { fetch: { register(r) { fetchRoute = r; return () => {} } } },
    logger: quiet,
  }
  let service
  await apply(ctx, { dataDir: dir, onService: (s) => { service = s } })

  async function call(method, payload) {
    const res = await fetchRoute.fetch(new Request('http://x/api/nl2sql.rpc', { method: 'POST', body: JSON.stringify({ method, payload }) }))
    const r = await res.json()
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code, ...(r.error.field ? { field: r.error.field } : {}) })
    return r.value
  }
  const exec = (id = 's-test') => ({ agent: { id } })
  async function tool(name, args, execCtx = exec()) {
    const t = tools.get(name)
    if (!t) throw new Error(`tool not registered: ${name}`)
    return t.execute(args, execCtx)
  }
  let closed = false
  async function close() {
    if (closed) return
    closed = true
    for (const d of effects.reverse()) {
      const r = typeof d === 'function' ? d() : d
      if (typeof r === 'function') await r(); else await r
    }
    rmSync(dir, { recursive: true, force: true })
  }
  const fetchRouteFn = (req) => fetchRoute.fetch(req)
  return { call, tool, tools, exec, close, ctx, service, dir, creds, fetchRoute: fetchRouteFn }
}

/** Simple in-memory stand-in for the DSH `schedule` service. */
export function fakeSchedule() {
  const sched = new Map()
  let n = 0
  return {
    sched,
    catalog: async () => [...sched.values()],
    create: async (r) => { const e = { id: 'sch-' + (++n), ...r, status: 'active', scheduledAt: '2026-11-12T01:00:00Z' }; sched.set(e.id, e); return e },
    edit: async (r) => {
      if (r.action === 'delete') { sched.delete(r.id); return { id: r.id, deleted: true } }
      const e = sched.get(r.id)
      if (!e) return { id: r.id, code: 'schedule_not_found' }
      Object.assign(e, r.patch, r.patch.active === false ? { status: 'paused' } : r.patch.active ? { status: 'active' } : {})
      return e
    },
    run: async (r) => sched.get(r.id) ?? { code: 'schedule_not_found' },
  }
}
