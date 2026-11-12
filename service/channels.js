/**
 * Nl2SqlService methods: IM channels (see docs/channels.md).
 * Mixed into the service prototype by index.js; `this` is the service.
 *
 * A channel record (state.channels[]):
 *   { id, name, type, platform, description, isDefault, chartMode,
 *     config: { non-secret fields of the kind }, secretsSet: { <secretKey>: true },
 *     bot?: { enabled, allowP2p, sessionScope }, needsSecret?, createdAt, updatedAt, lastSentAt?, lastError? }
 * Lark channels also keep their legacy top-level fields (domain, appId,
 * receiveIdType, receiveId, hasSecret, hasSign) so older pages and exports work.
 * Secrets live in one credential record per channel: `nl2sql/ch-<id>`.
 */
import { ChannelError } from '../channels/http.js'
import { needsAttachment, renderChartPng } from '../channels/message.js'
import { writeXlsx } from '../xlsx.js'
import { getAdapter, kindOf, listCatalog, loadAdapters, requireKind, secretKeys } from '../channels/index.js'
import { UserError, newId, pick, requireText, upsert } from './shared.js'

const LARK_LEGACY = ['domain', 'appId', 'receiveIdType', 'receiveId']
const BOT_DEFAULTS = { enabled: false, allowP2p: true, sessionScope: 'chat' }

/** Truncate to `max` UTF-16 units with an ellipsis, without splitting a surrogate pair. */
export function clip(s, max) {
  const str = String(s ?? '')
  if (str.length <= max) return str
  let cut = max - 1
  if (/[\uD800-\uDBFF]/.test(str[cut - 1] ?? '')) cut--
  return `${str.slice(0, cut)}…`
}

/** ChannelError (or legacy ImError) → UserError with the same code and message. */
export function channelUserError(error, code) {
  if (!(error instanceof ChannelError || (error?.code && /^(im|channel)\//.test(error.code)))) return error
  const e = new UserError(code ?? error.code, error.message)
  if (error.field) e.field = error.field
  return e
}

/** Chart modes a kind supports; the first one is the default. */
export function chartModesOf(kind) {
  const caps = kind?.capabilities ?? {}
  if (Array.isArray(caps.chartModes) && caps.chartModes.length) return caps.chartModes
  if (caps.charts === 'native') return ['native', 'table']
  if (caps.charts === 'image') return ['image', 'table']
  return ['table']
}

/**
 * Bring a stored channel record to the current shape (idempotent, in place):
 * platform, config, secretsSet; Lark legacy fields mirrored both ways.
 */
export function migrateChannelRecord(c) {
  if (!c || typeof c !== 'object') return c
  const found = kindOf(c.type)
  const platform = found?.kind.platform ?? (String(c.type ?? '').startsWith('lark_') ? 'lark' : c.platform)
  if (platform) c.platform = platform
  if (!c.config || typeof c.config !== 'object') {
    const keys = found ? (found.kind.fields ?? []).filter(f => !(f.secret || f.type === 'secret')).map(f => f.key) : LARK_LEGACY
    c.config = {}
    for (const k of keys) if (c[k] !== undefined) c.config[k] = c[k]
    if (platform === 'lark' && c.domain && !c.config.domain) c.config.domain = c.domain
  }
  if (!c.secretsSet || typeof c.secretsSet !== 'object') {
    c.secretsSet = {}
    if (c.type === 'lark_webhook') { if (c.hasSecret) c.secretsSet.webhookUrl = true; if (c.hasSign) c.secretsSet.signSecret = true }
    else if (c.type === 'lark_app') { if (c.hasSecret) c.secretsSet.appSecret = true }
  }
  if (platform === 'lark') {
    for (const k of LARK_LEGACY) { if (c.config[k] !== undefined) c[k] = c.config[k]; else delete c[k] }
    c.hasSecret = Boolean(c.type === 'lark_webhook' ? c.secretsSet.webhookUrl : c.secretsSet.appSecret)
    c.hasSign = Boolean(c.secretsSet.signSecret)
  }
  return c
}

/** Legacy flat Lark payload ({ webhookUrl, signSecret, appId, appSecret, receiveId… }) → { config, secrets }. */
function splitPayload(input, kind) {
  const fields = kind.fields ?? []
  const secretSet = new Set(secretKeys(kind))
  const config = input.config && typeof input.config === 'object' ? { ...input.config } : {}
  const secrets = {}
  const rawSecrets = input.secrets && typeof input.secrets === 'object' ? input.secrets : {}
  for (const f of fields) {
    if (secretSet.has(f.key)) {
      const v = Object.hasOwn(rawSecrets, f.key) ? rawSecrets[f.key] : input[f.key]
      if (v === null) secrets[f.key] = null
      else if (typeof v === 'string' && v.trim() !== '') secrets[f.key] = v.trim()
      // Legacy: an empty sign secret with clearSign removes it.
      else if (typeof v === 'string' && f.key === 'signSecret' && input.clearSign) secrets[f.key] = null
    } else if (!(f.key in config) && input[f.key] !== undefined) {
      config[f.key] = input[f.key]
    }
  }
  if (kind.platform === 'lark' && !('domain' in config) && input.domain !== undefined) config.domain = input.domain
  return { config, secrets }
}

export const methods = {
  // ---------------------------------------------------------- channels

  publicChannel(c) {
    migrateChannelRecord(c)
    const found = kindOf(c.type)
    const kind = found?.kind
    const required = kind ? (kind.fields ?? []).filter(f => (f.secret || f.type === 'secret') && f.required).map(f => f.key) : []
    const out = {
      ...pick(c, ['id', 'name', 'type', 'platform', 'description', 'isDefault', 'createdAt', 'updatedAt', 'lastSentAt', 'lastError', 'chartMode']),
      config: structuredClone(c.config ?? {}),
      secretsSet: { ...(c.secretsSet ?? {}) },
      hasSecret: c.platform === 'lark' ? Boolean(c.hasSecret) : required.every(k => c.secretsSet?.[k]),
      capabilities: kind ? { ...kind.capabilities, chartModes: chartModesOf(kind) } : null,
      ...(c.needsSecret ? { needsSecret: true } : {}),
      ...(found ? {} : { unsupported: true }),
    }
    if (c.platform === 'lark') Object.assign(out, pick(c, LARK_LEGACY), { hasSign: Boolean(c.hasSign) })
    if (kind?.capabilities?.bot) {
      const bot = { ...BOT_DEFAULTS, ...(c.bot ?? {}) }
      out.bot = { enabled: Boolean(bot.enabled), allowP2p: Boolean(bot.allowP2p), sessionScope: bot.sessionScope, status: this.botRuntimeStatus(c), info: this.bots?.get(c.id)?.bot.info?.() ?? null }
    }
    return out
  },

  listChannels() {
    return this.state.channels.map(c => this.publicChannel(c))
  },

  async channelCatalog({ locale } = {}) {
    await loadAdapters()
    return listCatalog(locale)
  },

  findChannel(ref) {
    if (!ref) return this.state.channels.find(c => c.isDefault) ?? (this.state.channels.length === 1 ? this.state.channels[0] : undefined)
    return this.state.channels.find(c => c.id === ref) ?? this.state.channels.find(c => c.name === ref)
  },

  requireChannel(ref) {
    const c = this.findChannel(ref)
    if (!c) throw new UserError('nl2sql/unknown-channel', ref ? `推送渠道不存在：${ref}` : `没有可用的推送渠道。${this.state.channels.length ? `可用渠道：${this.state.channels.map(x => x.name).join('、')}` : '请用户在「数据问答 → 推送」页面添加 IM 渠道（飞书 / Telegram / 企业微信 / 钉钉）。'}`)
    return migrateChannelRecord(c)
  },

  channelSecretId(c) {
    return `ch-${String(typeof c === 'string' ? c : c.id).replace(/^ch-/, '')}`
  },

  channelSecretKey(id) {
    return this.credentialKey(this.channelSecretId(id))
  },

  async channelSecrets(c) {
    return this.readSecrets(this.channelSecretId(c))
  },

  /** The channel as adapters see it: config fields at the top level too. */
  adapterChannel(c) {
    migrateChannelRecord(c)
    return { ...c, ...(c.config ?? {}) }
  },

  /**
   * Create or update a channel. Accepts the contract payload
   * ({ id?, name, type, description?, isDefault?, chartMode?, config, secrets, bot? })
   * and the legacy flat Lark payload (webhookUrl, signSecret, appId, appSecret, receiveId…).
   * Secrets omitted or '' keep their stored value; null clears one.
   */
  async saveChannel(input = {}) {
    await loadAdapters()
    const existing = input.id ? this.state.channels.find(c => c.id === input.id) : undefined
    if (input.id && !existing) throw new UserError('nl2sql/unknown-channel', '推送渠道不存在')
    if (existing) migrateChannelRecord(existing)
    const c = existing ? structuredClone(existing) : { id: newId('ch'), createdAt: Date.now() }
    c.name = requireText(input.name ?? c.name, 'name', 64)
    if (this.state.channels.some(x => x.name === c.name && x.id !== c.id)) throw new UserError('nl2sql/duplicate', `渠道名称已存在：${c.name}`)
    const type = input.type ?? c.type ?? 'lark_webhook'
    let found
    try { found = requireKind(type) } catch (error) { throw new UserError('nl2sql/invalid', error.message) }
    const { adapter, kind } = found
    const typeChanged = Boolean(existing && existing.type !== type)
    c.type = type
    c.platform = adapter.id
    c.description = String(input.description ?? c.description ?? '').slice(0, 300)
    const { config: configIn, secrets: changed } = splitPayload(input, { ...kind, platform: adapter.id })
    const keys = secretKeys(kind)
    // A type change keeps stored secrets whose key the new kind also has (e.g. webhookUrl, token).
    const stored = existing ? await this.channelSecrets(existing) : {}
    if (typeChanged) for (const k of Object.keys(stored)) if (!keys.includes(k)) delete stored[k]
    const merged = {}
    for (const k of keys) {
      if (Object.hasOwn(changed, k)) { if (changed[k] !== null) merged[k] = changed[k] } else if (stored[k] !== undefined) merged[k] = stored[k]
    }
    let validated
    try {
      validated = await kind.validate({ name: c.name, config: { ...(typeChanged ? {} : c.config ?? {}), ...configIn }, secrets: merged }, existing && !typeChanged ? { config: existing.config ?? {}, secrets: stored } : undefined)
    } catch (error) {
      throw error instanceof ChannelError ? channelUserError(error, 'nl2sql/invalid') : error
    }
    c.config = validated.config ?? {}
    const finalSecrets = {}
    for (const k of keys) if (validated.secrets?.[k] !== undefined && validated.secrets[k] !== null && validated.secrets[k] !== '') finalSecrets[k] = validated.secrets[k]
    // Write only what changed; a type change also drops secrets of the old kind.
    const patch = {}
    const before = existing ? await this.channelSecrets(existing) : {}
    for (const k of new Set([...Object.keys(before), ...keys])) {
      const next = keys.includes(k) ? finalSecrets[k] : undefined
      if (next !== before[k]) patch[k] = next === undefined ? null : next
    }
    if (Object.keys(patch).length) await this.writeSecrets(this.channelSecretId(c), patch)
    c.secretsSet = Object.fromEntries(Object.keys(finalSecrets).map(k => [k, true]))
    delete c.needsSecret
    const modes = chartModesOf(kind)
    c.chartMode = modes.includes(input.chartMode) ? input.chartMode : modes.includes(c.chartMode) ? c.chartMode : modes[0]
    if (adapter.id !== 'lark') for (const k of [...LARK_LEGACY, 'hasSecret', 'hasSign']) delete c[k]
    if (kind.capabilities?.bot) {
      if (input.bot && typeof input.bot === 'object') c.bot = this.normalizeBotConfig(input.bot, c.bot)
    } else {
      delete c.bot
    }
    migrateChannelRecord(c)
    if (input.isDefault || !this.state.channels.some(x => x.isDefault && x.id !== c.id)) {
      for (const x of this.state.channels) x.isDefault = false
      c.isDefault = true
    }
    c.updatedAt = Date.now()
    this.state.channels = upsert(this.state.channels, c)
    await this.save()
    // Credentials or bot settings may have changed: restart (or stop) its bot.
    if (this.bots?.has(c.id) || c.bot?.enabled) await this.restartBot({ channelId: c.id }).catch(error => console.warn('nl2sql bot: restart failed: %s', error.message))
    return this.publicChannel(c)
  },

  async deleteChannel(id) {
    const c = this.state.channels.find(x => x.id === id)
    if (!c) return { deleted: id }
    await this.stopBot(id)
    this.state.channels = this.state.channels.filter(x => x.id !== id)
    if (c.isDefault && this.state.channels[0]) this.state.channels[0].isDefault = true
    // Drop every reference to the channel: alerts, schema notifications, bot conversations, reports.
    for (const a of this.state.alerts ?? []) if (a.channelId === id) a.channelId = null
    if (this.state.settings?.schemaNotifyChannel === id) this.state.settings.schemaNotifyChannel = null
    for (const [k, conv] of Object.entries(this.state.botConversations ?? {})) if (conv?.channelId === id) delete this.state.botConversations[k]
    const reports = (this.state.reports ?? []).filter(r => r.channelId === id)
    for (const r of reports) delete r.channelId
    try { await this.ctx.get('credentials')?.deleteRecord(this.channelSecretKey(id)) } catch {}
    await this.save()
    // Scheduled report prompts name the channel: rewrite them through the normal report save.
    for (const r of reports) {
      if (!r.scheduleId || !this.ctx.get('schedule')) continue
      try { await this.saveReport({ ...r, channelId: undefined }) } catch (error) { console.warn('nl2sql: cannot update report %s after channel delete: %s', r.id, error.message) }
    }
    return { deleted: id }
  },

  /**
   * Chats/groups a channel's bot can reach: a saved channel, or unsaved
   * credentials from the form (nothing is stored). → [{ id, name, type }]
   */
  async listChannelTargets({ id, type, config, secrets, ...flat } = {}) {
    await loadAdapters()
    const saved = id ? this.state.channels.find(c => c.id === id) : undefined
    if (id && !saved) throw new UserError('nl2sql/unknown-channel', '推送渠道不存在')
    const found = kindOf(type ?? saved?.type ?? (flat.appId ? 'lark_app' : undefined))
    if (!found) throw new UserError('nl2sql/invalid', `不支持的渠道类型：${type ?? saved?.type ?? '?'}`)
    const { kind } = found
    if (!kind.listTargets) throw new UserError('nl2sql/invalid', `「${kind.label?.zh ?? kind.id}」不支持列出群聊`)
    const given = splitPayload({ ...flat, config, secrets }, { ...kind, platform: found.adapter.id })
    const base = saved && saved.type === kind.id ? this.adapterChannel(saved) : { type: kind.id, platform: found.adapter.id, config: {} }
    const channel = { ...base, ...given.config, config: { ...(base.config ?? {}), ...given.config } }
    const storedSecrets = saved && saved.type === kind.id ? await this.channelSecrets(saved) : {}
    const allSecrets = { ...storedSecrets }
    for (const [k, v] of Object.entries(given.secrets)) if (v) allSecrets[k] = v
    for (const f of (kind.fields ?? []).filter(x => (x.secret || x.type === 'secret') && x.required)) {
      if (!allSecrets[f.key]) throw Object.assign(new UserError('nl2sql/invalid', `请先填写 ${f.label?.zh ?? f.key}`), { field: f.key })
    }
    try {
      return await kind.listTargets(channel, allSecrets)
    } catch (error) {
      throw channelUserError(error)
    }
  },

  /** Legacy: chats of a Lark app bot as [{ chatId, name, description }]. */
  async listChannelChats({ id, appId, appSecret, domain } = {}) {
    const saved = id ? this.state.channels.find(c => c.id === id) : undefined
    if (saved && saved.type !== 'lark_app') throw new UserError('nl2sql/invalid', '只有应用机器人渠道可以列出群聊')
    if (!saved) requireText(appId, 'appId', 64)
    if (!appSecret && !saved) throw new UserError('nl2sql/invalid', '请先填写 App Secret')
    const targets = await this.listChannelTargets({ id, type: 'lark_app', config: { ...(appId ? { appId } : {}), ...(domain ? { domain } : {}) }, secrets: appSecret ? { appSecret } : {} })
    return targets.map(t => ({ chatId: t.id, name: t.name, description: t.description ?? '' }))
  },

  /**
   * Check a channel: the kind's cheap auth check when it has one, plus a test
   * message when it has none (or the check asks for one). → { ok, detail, … }
   */
  async testChannel(input) {
    await loadAdapters()
    const id = typeof input === 'string' ? input : input?.id
    const c = this.requireChannel(id)
    const found = kindOf(c.type)
    if (!found) throw new UserError('nl2sql/invalid', `不支持的渠道类型：${c.type}`)
    let checked
    if (found.kind.test) {
      try { checked = await found.kind.test(this.adapterChannel(c), await this.channelSecrets(c)) } catch (error) { throw channelUserError(error) }
      if (checked && checked.ok === false) return { ok: false, detail: checked.detail ?? '' }
      if (checked && checked.send === false) return { ok: true, detail: checked.detail ?? '' }
    }
    const sent = await this.sendToChannel({ channelId: c.id, title: '数据问答 · 推送测试', text: `这是一条测试消息。\n发送时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`, source: 'test' })
    return { ...sent, ok: true, detail: [checked?.detail, '测试消息已发送'].filter(Boolean).join('；') }
  },

  /**
   * Send to an IM channel. Results are referenced by resultId (from this
   * process' cache) or given inline; each is re-checked against privacy:
   * masked values stay masked because results are stored masked.
   */
  async sendToChannel({ channelId, title, text, resultIds = [], results = [], includeSql = false, source = 'ui', sessionId, footer, chartMode, template, mentionAll, attachFull }) {
    await loadAdapters()
    const c = this.requireChannel(channelId)
    const resolved = []
    const sender = this.actorFor(sessionId)
    for (const id of resultIds.slice(0, 10)) {
      const r = this.lookupResult(id)
      if (!r) throw new UserError('nl2sql/result-expired', `结果 ${id} 已过期，请重新查询后再发送。`)
      if (source === 'agent') this.assertResultAccess(r, sender)
      resolved.push(r)
    }
    resolved.push(...results.slice(0, 10))
    if (!text && resolved.length === 0) throw new UserError('nl2sql/invalid', '没有可发送的内容')
    const found = kindOf(c.type)
    if (!found) throw new UserError('nl2sql/invalid', `不支持的渠道类型：${c.type}（对应的渠道插件未加载）`)
    const modes = chartModesOf(found.kind)
    const body = text ? String(text).slice(0, 20000) : ''
    const message = {
      title: clip(String(title || resolved[0]?.title || '').trim() || '数据问答', 100),
      text: body,
      chartMode: modes.includes(chartMode) ? chartMode : modes.includes(c.chartMode) ? c.chartMode : modes[0],
      results: resolved.map(r => ({ ...pick(r, ['title', 'columns', 'rows', 'rowCount', 'truncated', 'chart', 'sql', 'filters', 'error', ...(found.kind.capabilities?.buttons ? ['actions'] : [])]), ...(r.title ? { title: clip(String(r.title), 100) } : {}) })),
      includeSql: Boolean(includeSql),
      mentionAll: mentionAll ?? /<at\s+id\s*=\s*["']?all["']?\s*>/i.test(body),
      ...(template ? { template } : {}),
      footer: footer ?? `数据问答 · ${new Date().toLocaleString('zh-CN', { hour12: false })}${resolved[0]?.datasourceName ? ` · ${resolved[0].datasourceName}` : ''}`,
    }
    // Results with more rows than the message can show: attach the full data as Excel
    // where the platform can send files (default on; per send `attachFull: false` to skip).
    const caps = found.kind.capabilities ?? {}
    const shown = caps.tableRows ?? 10
    const wantAttach = attachFull ?? c.attachFull ?? true
    if (caps.files && wantAttach) {
      const idx = message.results.map((r, i) => (needsAttachment(r, shown) ? i : -1)).filter(i => i >= 0)
      if (idx.length) {
        const sheets = idx.map(i => ({ name: message.results[i].title || `结果${i + 1}`, columns: message.results[i].columns, rows: message.results[i].rows }))
        if (includeSql) sheets.push({ name: 'SQL', columns: [{ name: '结果', kind: 'text' }, { name: 'SQL', kind: 'text' }], rows: idx.map(i => [message.results[i].title ?? '', message.results[i].sql ?? '']) })
        const buffer = writeXlsx(sheets, { creator: 'DeepSeek Harness 数据问答' })
        const safe = String(message.title).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '数据'
        message.attachment = { buffer, fileName: `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`, resultIndexes: idx }
      }
    }
    const started = Date.now()
    try {
      if (c.needsSecret) throw new ChannelError('channel/config', `渠道「${c.name}」需要重新填写密钥后才能使用`)
      const sent = await found.kind.send(this.adapterChannel(c), await this.channelSecrets(c), message, { renderChartPng, logger: console, fetch: globalThis.fetch })
      c.lastSentAt = Date.now()
      delete c.lastError
      this.recordDelivery({ channel: c, title: message.title, status: 'ok', results: resolved.length, images: sent?.images, files: sent?.files, ...(sent?.warning ? { error: sent.warning } : {}), source, sessionId, elapsedMs: Date.now() - started })
      await this.save()
      return { ok: true, channel: c.name, platform: c.platform, messageId: sent?.messageId ?? null, images: sent?.images ?? 0, files: sent?.files ?? 0, ...(sent?.warning ? { warning: sent.warning } : {}), results: resolved.length }
    } catch (error) {
      c.lastError = error.message
      this.recordDelivery({ channel: c, title: message.title, status: 'error', error: error.message, results: resolved.length, source, sessionId, elapsedMs: Date.now() - started })
      await this.save()
      throw channelUserError(error)
    }
  },

  recordDelivery({ channel, title, status, error, results, images, files, source, sessionId, elapsedMs }) {
    this.records.put('delivery', { id: newId('dl'), at: Date.now(), channelId: channel.id, channelName: channel.name, ...(channel.platform ? { platform: channel.platform } : {}), title, status, ...(error ? { error: String(error).slice(0, 500) } : {}), results, images: images ?? 0, files: files ?? 0, source, sessionId: sessionId ?? null, elapsedMs })
  },

  listDeliveries(limit = 100) {
    return this.records.list('delivery', { limit: typeof limit === 'number' ? limit : limit?.limit ?? 100 })
  },

  /** Load optional adapters and migrate channel records (called once on start). */
  async initChannels() {
    await loadAdapters()
    let changed = false
    for (const c of this.state.channels ?? []) {
      const before = JSON.stringify(c)
      migrateChannelRecord(c)
      if (JSON.stringify(c) !== before) changed = true
    }
    if (this.migrateLegacyBot()) changed = true
    return changed
  },

  adapterFor(c) {
    return getAdapter(c?.platform ?? kindOf(c?.type)?.adapter.id)
  },
}
