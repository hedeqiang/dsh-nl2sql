/**
 * Channel adapter registry (see docs/CHANNELS.md).
 *
 * Built-in adapters: lark (static), telegram / wecom / dingtalk (loaded with
 * dynamic import so a missing or broken module never breaks the registry).
 * Adapters must NOT import this module (import ./http.js and ./message.js
 * instead) — the registry imports them.
 *
 * Call `await loadAdapters()` once before using the synchronous lookups; the
 * service core does this on start and in every channel RPC.
 */
import lark from './lark.js'
import { ChannelError } from './http.js'

const adapters = new Map()
const kinds = new Map()

/** Register (or replace) an adapter. Its kinds become valid channel types. */
export function registerAdapter(adapter) {
  if (!adapter?.id || !Array.isArray(adapter.kinds)) throw new Error('adapter needs id and kinds')
  const previous = adapters.get(adapter.id)
  if (previous) for (const k of previous.kinds) kinds.delete(k.id)
  adapters.set(adapter.id, adapter)
  for (const kind of adapter.kinds) kinds.set(kind.id, { adapter, kind: { platform: adapter.id, ...kind } })
  return adapter
}

/** Remove an adapter (tests). */
export function unregisterAdapter(id) {
  const adapter = adapters.get(id)
  if (!adapter) return false
  for (const k of adapter.kinds) kinds.delete(k.id)
  adapters.delete(id)
  return true
}

registerAdapter(lark)

const OPTIONAL = ['telegram', 'wecom', 'dingtalk']
const loadErrors = {}
let loading

/** Load the optional built-in adapters (idempotent). Resolves to the list of loaded ids. */
export function loadAdapters() {
  loading ??= Promise.all(OPTIONAL.map(async (id) => {
    try {
      const mod = await import(`./${id}.js`)
      const adapter = mod.default ?? mod.adapter
      // A test may have registered a replacement already: keep it.
      if (adapter && !adapters.has(adapter.id)) registerAdapter(adapter)
      return adapter?.id
    } catch (error) {
      loadErrors[id] = error?.message ?? String(error)
      return undefined
    }
  })).then(ids => ids.filter(Boolean))
  return loading
}

/** Errors from optional adapters that failed to load: { [platform]: message }. */
export function adapterLoadErrors() {
  return { ...loadErrors }
}

export function getAdapter(platform) {
  return adapters.get(platform)
}

export function listAdapters() {
  return [...adapters.values()]
}

/** Resolve a channel type to { adapter, kind }, or undefined. */
export function kindOf(type) {
  return kinds.get(type)
}

/** Like kindOf, but throws ChannelError('channel/config') for unknown types. */
export function requireKind(type) {
  const found = kinds.get(type)
  if (!found) throw new ChannelError('channel/config', `不支持的渠道类型：${type}`)
  return found
}

/** Pick zh/en text from a { zh, en } object (or return a plain string). */
export function localized(text, locale = 'zh') {
  if (text === null || text === undefined) return text
  if (typeof text !== 'object' || Array.isArray(text)) return text
  return text[locale] ?? text.zh ?? text.en
}

/** A JSON-safe description of a kind for the UI: no functions, never a value. */
export function describeKind(kind) {
  return {
    id: kind.id,
    platform: kind.platform,
    label: kind.label,
    description: kind.description,
    fields: (kind.fields ?? []).map(f => {
      const secret = Boolean(f.secret || f.type === 'secret')
      const out = { ...f, secret }
      if (secret) delete out.default // never any secret value
      return JSON.parse(JSON.stringify(out))
    }),
    capabilities: { ...kind.capabilities },
    setupSteps: kind.setupSteps ?? { zh: [], en: [] },
  }
}

/**
 * The catalog for the page: [{ platform, name, kinds:[{ id, label, description, fields, capabilities, setupSteps }] }].
 * With a locale, `name` / `label` / `description` / `setupSteps` / field labels are also given as `*Text` strings.
 */
export function listCatalog(locale) {
  return listAdapters().map(adapter => ({
    platform: adapter.id,
    name: adapter.name,
    ...(locale ? { nameText: localized(adapter.name, locale) } : {}),
    kinds: adapter.kinds.map(k => {
      const d = describeKind({ platform: adapter.id, ...k })
      if (!locale) return d
      return {
        ...d,
        labelText: localized(d.label, locale),
        descriptionText: localized(d.description, locale),
        setupStepsText: localized(d.setupSteps, locale) ?? [],
        fields: d.fields.map(f => ({ ...f, labelText: localized(f.label, locale), helpText: localized(f.help, locale) })),
      }
    }),
  }))
}

/** Secret field keys of a kind. */
export function secretKeys(kind) {
  return (kind.fields ?? []).filter(f => f.secret || f.type === 'secret').map(f => f.key)
}

export { ChannelError }
