/**
 * Feature modules. Each entry: { name, methods, rpc?(service), tools?(ctx, service, helpers), start?(ctx, service) }.
 * - methods: mixed into the service prototype (`this` = service). Methods named `jobs_<name>(now)` return
 *   scheduler jobs [{ id, due(now), run() }] run by the in-process scheduler (service/alerts.js).
 * - rpc: page RPC methods; tools: agent tools; start: called after apply (e.g. servers).
 * New features add a file under service/ and one line here, so they do not edit index.js.
 */
import { FEATURE as subscriptions } from './subscriptions.js'
import { FEATURE as reconcile } from './reconcile.js'
import { FEATURE as present } from './present.js'
import { FEATURE as mcp } from './mcp.js'
import { FEATURE as proactive } from './proactive.js'
import { FEATURE as freshness } from './freshness.js'
export const FEATURES = [
  present,
  mcp,
  reconcile,
  subscriptions,
  proactive,
  freshness,
]
