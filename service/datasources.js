/**
 * Nl2SqlService methods: datasources.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { DIALECTS, createDriver, describeError } from '../drivers.js'
import { normalizePolicy, policyActive } from '../policy.js'
import { sanitizeTableName } from '../sqlite-driver.js'
import { join } from 'node:path'
import { CREDENTIAL_SCOPE, DEFAULT_SETTINGS, RETENTION_MAX, RETENTION_MIN, SUPPORTED_TYPES, UserError, clampInt, newId, oneOf, pick, requireText } from './shared.js'

export const methods = {
  // ------------------------------------------------------------ settings

  /** Current settings plus `defaults` (for "restore defaults" in the page). */
  getSettings() {
    return { ...structuredClone(this.state.settings), defaults: structuredClone(DEFAULT_SETTINGS) }
  },

  /** Reset the given setting keys (or all) to their defaults. */
  async resetSettings({ keys } = {}) {
    const list = Array.isArray(keys) && keys.length ? keys : Object.keys(DEFAULT_SETTINGS)
    const unknown = list.filter(k => !Object.hasOwn(DEFAULT_SETTINGS, k))
    if (unknown.length) throw new UserError('nl2sql/invalid', `未知的设置项：${unknown.join(', ')}`)
    const s = { ...this.state.settings }
    for (const k of list) s[k] = structuredClone(DEFAULT_SETTINGS[k])
    if (!Array.isArray(keys) || !keys.length) {
      // Full reset also clears the optional settings that have no default value.
      for (const k of ['larkDefaultDatasourceIds', 'schemaNotifyChannel', 'schemaCheckDaily']) delete s[k]
    }
    this.state.settings = s
    this.records.trim()
    this.auditAdmin('settings.reset', list.join(', '))
    await this.save()
    return this.getSettings()
  },

  async saveSettings(input) {
    const s = { ...this.state.settings }
    if (input.maxRows !== undefined) s.maxRows = clampInt(input.maxRows, 1, 100000, 'maxRows')
    if (input.timeoutMs !== undefined) s.timeoutMs = clampInt(input.timeoutMs, 1000, 600000, 'timeoutMs')
    if (input.modelRows !== undefined) s.modelRows = clampInt(input.modelRows, 0, 500, 'modelRows')
    if (input.sampleMode !== undefined) s.sampleMode = oneOf(input.sampleMode, ['off', 'enum', 'all'], 'sampleMode')
    if (input.resultToModel !== undefined) s.resultToModel = oneOf(input.resultToModel, ['none', 'summary', 'rows'], 'resultToModel')
    if (input.maskSensitive !== undefined) s.maskSensitive = Boolean(input.maskSensitive)
    if (input.scanGuardRows !== undefined) s.scanGuardRows = clampInt(input.scanGuardRows, 0, 1e12, 'scanGuardRows')
    if (input.cacheTtlSec !== undefined) s.cacheTtlSec = clampInt(input.cacheTtlSec, 0, 86400, 'cacheTtlSec')
    if (input.schemaWatch !== undefined) s.schemaWatch = Boolean(input.schemaWatch)
    if (input.larkDefaultRole !== undefined) s.larkDefaultRole = oneOf(input.larkDefaultRole, ['none', 'viewer', 'analyst'], 'larkDefaultRole')
    if (input.larkDefaultDatasourceIds !== undefined) s.larkDefaultDatasourceIds = input.larkDefaultDatasourceIds === null ? null : (input.larkDefaultDatasourceIds ?? []).filter(id => this.findDatasource(id))
    if (input.schemaNotifyChannel !== undefined) s.schemaNotifyChannel = this.state.channels.some(c => c.id === input.schemaNotifyChannel) ? input.schemaNotifyChannel : ''
    if (input.schemaCheckDaily !== undefined) s.schemaCheckDaily = /^\d{2}:\d{2}$/.test(String(input.schemaCheckDaily)) ? input.schemaCheckDaily : ''
    if (input.schemaOverviewMax !== undefined) s.schemaOverviewMax = clampInt(input.schemaOverviewMax, 1, 100000, 'schemaOverviewMax')
    if (input.schemaOverviewTop !== undefined) s.schemaOverviewTop = clampInt(input.schemaOverviewTop, 1, 200, 'schemaOverviewTop')
    let lowered = false
    if (input.retention !== undefined && input.retention !== null) {
      if (typeof input.retention !== 'object') throw new UserError('nl2sql/invalid', 'retention 必须是对象')
      const r = { ...DEFAULT_SETTINGS.retention, ...(s.retention ?? {}) }
      for (const [k, v] of Object.entries(input.retention)) {
        if (!Object.hasOwn(DEFAULT_SETTINGS.retention, k)) throw new UserError('nl2sql/invalid', `未知的日志类型：${k}`)
        const n = Number(v)
        if (!Number.isFinite(n)) throw new UserError('nl2sql/invalid', `retention.${k} 必须是数字`)
        const next = Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, Math.round(n)))
        if (next < r[k]) lowered = true
        r[k] = next
      }
      s.retention = r
    }
    this.state.settings = s
    if (lowered) this.records.trim()
    await this.save()
    return structuredClone(s)
  },

  settingsFor(ds) {
    return { ...this.state.settings, ...(ds?.privacy ?? {}) }
  },

  // --------------------------------------------------------- datasources

  publicDatasource(ds) {
    return {
      ...pick(ds, ['id', 'name', 'type', 'host', 'port', 'database', 'user', 'charset', 'timezone', 'ssl', 'schemas', 'description', 'createdAt', 'updatedAt', 'serverVersion', 'lastTestAt', 'lastTestOk', 'readOnlyGrant', 'privacy']),
      policy: ds.policy ?? normalizePolicy(null),
      type: ds.type ?? 'mysql',
      hasPassword: Boolean(ds.hasPassword),
      hasApiKey: Boolean(ds.hasApiKey),
      ...(ds.needsSecret ? { needsSecret: true } : {}),
      ssh: ds.ssh ? { enabled: Boolean(ds.ssh.enabled), host: ds.ssh.host, port: ds.ssh.port, user: ds.ssh.user, auth: ds.ssh.auth ?? 'password', hasSecret: Boolean(ds.ssh.hasSecret) } : { enabled: false },
      current: this.state.current === ds.id,
      schemaAnalyzedAt: this.schemas.get(ds.id)?.analyzedAt ?? ds.schemaAnalyzedAt ?? null,
    }
  },

  listDatasources() {
    return this.state.datasources.map(ds => this.publicDatasource(ds))
  },

  findDatasource(ref) {
    if (ref === undefined || ref === null || ref === '') return undefined
    return this.state.datasources.find(d => d.id === ref) ?? this.state.datasources.find(d => d.name === ref)
  },

  requireDatasource(ref) {
    const ds = this.findDatasource(ref)
    if (!ds) throw new UserError('nl2sql/unknown-datasource', `数据源不存在：${ref}`)
    return ds
  },

  credentialKey(id) {
    return `${CREDENTIAL_SCOPE}/${id}`
  },

  /** All secrets of one data source live in one credential record. */
  async readSecrets(id) {
    const creds = this.ctx.get('credentials')
    if (!creds) return {}
    const record = await creds.readRecord(this.credentialKey(id))
    return record?.kind === 'grant' && record.payload && typeof record.payload === 'object' ? { ...record.payload } : {}
  },

  async writeSecrets(id, patch) {
    const creds = this.ctx.get('credentials')
    if (!creds) throw new UserError('nl2sql/no-credentials', '当前 Harness 没有可用的凭据服务，无法保存密码')
    const next = { ...(await this.readSecrets(id)) }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') delete next[k]
      else if (v !== undefined) next[k] = v
    }
    if (Object.keys(next).length === 0) {
      await creds.deleteRecord(this.credentialKey(id))
      return next
    }
    await creds.modifyRecord(this.credentialKey(id), async () => ({ kind: 'grant', payload: next }))
    return next
  },

  /** Data source record plus its secrets, as a driver configuration. */
  async driverConfig(ds, overrideSecrets) {
    const secrets = overrideSecrets ?? await this.readSecrets(ds.id)
    return {
      ...ds,
      password: secrets.password ?? '',
      apiKey: secrets.apiKey ?? '',
      ssh: ds.ssh?.enabled ? { ...ds.ssh, password: secrets.sshPassword ?? '', privateKey: secrets.sshPrivateKey ?? '', passphrase: secrets.sshPassphrase ?? '' } : undefined,
    }
  },

  normalizeDatasourceInput(input, existing, { checkName = true } = {}) {
    const out = existing ? { ...existing } : { id: newId('ds'), type: 'mysql', createdAt: Date.now() }
    if (input.type !== undefined) out.type = oneOf(input.type, SUPPORTED_TYPES, 'type')
    out.type ??= 'mysql'
    if (input.name !== undefined) out.name = requireText(input.name, 'name', 64)
    if (input.host !== undefined) out.host = requireText(input.host, 'host', 255)
    if (input.port !== undefined) out.port = clampInt(input.port, 1, 65535, 'port')
    if (input.database !== undefined) out.database = String(input.database ?? '').trim().slice(0, 255)
    if (input.user !== undefined) out.user = String(input.user ?? '').trim().slice(0, 128)
    if (input.charset !== undefined) out.charset = String(input.charset || 'utf8mb4')
    if (input.timezone !== undefined) out.timezone = String(input.timezone || 'local')
    if (input.schemas !== undefined) out.schemas = String(input.schemas ?? '').trim().slice(0, 500)
    if (input.description !== undefined) out.description = String(input.description ?? '').slice(0, 2000)
    if (input.ssl !== undefined) out.ssl = Boolean(input.ssl)
    if (input.privacy !== undefined) {
      const pv = input.privacy === null ? {} : pick(input.privacy, ['sampleMode', 'resultToModel', 'modelRows', 'maskSensitive'])
      if (pv.sampleMode !== undefined) oneOf(pv.sampleMode, ['off', 'enum', 'all'], 'sampleMode')
      if (pv.resultToModel !== undefined) oneOf(pv.resultToModel, ['none', 'summary', 'rows'], 'resultToModel')
      if (pv.modelRows !== undefined) pv.modelRows = clampInt(pv.modelRows, 0, 500, 'modelRows')
      out.privacy = Object.keys(pv).length ? pv : undefined
    }
    if (input.policy !== undefined) out.policy = policyActive(normalizePolicy(input.policy)) ? normalizePolicy(input.policy) : undefined
    if (input.ssh !== undefined) {
      const sh = input.ssh ?? {}
      out.ssh = sh.enabled
        ? { enabled: true, host: requireText(sh.host, 'ssh.host', 255), port: clampInt(sh.port ?? 22, 1, 65535, 'ssh.port'), user: requireText(sh.user, 'ssh.user', 128), auth: sh.auth === 'key' ? 'key' : 'password', hasSecret: existing?.ssh?.hasSecret ?? false }
        : { enabled: false }
    }
    if (out.type === 'sqlite') {
      out.host = 'local'
      out.port = 0
      out.user = ''
      out.database ||= sanitizeTableName(out.name || 'files')
      out.file = join(this.dir, 'files', `${out.id}.sqlite`)
      delete out.ssh
    }
    out.port ??= DIALECTS[out.type].defaultPort
    if (out.type === 'mysql') out.charset ??= 'utf8mb4'
    out.timezone ??= 'local'
    const required = out.type === 'elasticsearch' ? ['name', 'host'] : out.type === 'sqlite' ? ['name'] : ['name', 'host', 'database', 'user']
    for (const k of required) if (!out[k]) throw new UserError('nl2sql/invalid', `缺少字段：${k}`)
    if (out.type === 'elasticsearch') out.database ||= '*'
    if (checkName && this.state.datasources.some(d => d.name === out.name && d.id !== out.id)) throw new UserError('nl2sql/duplicate', `数据源名称已存在：${out.name}`)
    out.updatedAt = Date.now()
    return out
  },

  /** Secrets supplied by a form: only non-empty fields replace stored values. */
  secretPatch(input) {
    const patch = {}
    if (typeof input.password === 'string' && (input.password !== '' || input.clearPassword)) patch.password = input.password
    if (typeof input.apiKey === 'string' && (input.apiKey !== '' || input.clearApiKey)) patch.apiKey = input.apiKey
    const sh = input.ssh ?? {}
    if (typeof sh.password === 'string' && sh.password !== '') patch.sshPassword = sh.password
    if (typeof sh.privateKey === 'string' && sh.privateKey.trim() !== '') patch.sshPrivateKey = sh.privateKey
    if (typeof sh.passphrase === 'string' && sh.passphrase !== '') patch.sshPassphrase = sh.passphrase
    return patch
  },

  async saveDatasource(input) {
    const existing = input.id ? this.requireDatasource(input.id) : undefined
    const ds = this.normalizeDatasourceInput(input, existing)
    const patch = this.secretPatch(input)
    if (Object.keys(patch).length) {
      const secrets = await this.writeSecrets(ds.id, patch)
      ds.hasPassword = Boolean(secrets.password)
      ds.hasApiKey = Boolean(secrets.apiKey)
      if (ds.ssh?.enabled) ds.ssh.hasSecret = Boolean(ds.ssh.auth === 'key' ? secrets.sshPrivateKey : secrets.sshPassword)
      delete ds.needsSecret
    }
    const index = this.state.datasources.findIndex(d => d.id === ds.id)
    if (index >= 0) this.state.datasources[index] = ds
    else this.state.datasources.push(ds)
    if (!this.state.current) this.state.current = ds.id
    await this.closeDriver(ds.id)
    this.schemas.delete(ds.id)
    await this.save()
    return this.publicDatasource(ds)
  },

  async deleteDatasource(id) {
    const ds = this.requireDatasource(id)
    await this.closeDriver(ds.id)
    this.state.datasources = this.state.datasources.filter(d => d.id !== ds.id)
    if (this.state.current === ds.id) this.state.current = this.state.datasources[0]?.id ?? null
    for (const [sid, dsId] of Object.entries(this.state.sessions)) if (dsId === ds.id) delete this.state.sessions[sid]
    for (const r of this.state.reports.filter(x => x.datasourceId === ds.id)) await this.deleteReport(r.id)
    for (const d of this.state.dashboards) d.widgets = d.widgets.filter(w => w.datasourceId !== ds.id)
    this.syncLegacyDashboard()
    delete this.state.knowledge[ds.id]
    delete this.state.evals?.[ds.id]
    this.state.alerts = (this.state.alerts ?? []).filter(a => a.datasourceId !== ds.id)
    for (const u of this.state.users ?? []) if (Array.isArray(u.datasourceIds)) u.datasourceIds = u.datasourceIds.filter(x => x !== ds.id)
    if (Array.isArray(this.state.settings.larkDefaultDatasourceIds)) this.state.settings.larkDefaultDatasourceIds = this.state.settings.larkDefaultDatasourceIds.filter(x => x !== ds.id)
    for (const c of Object.values(this.state.larkSessions ?? {})) if (c.datasourceId === ds.id) c.datasourceId = null
    try { const { rm } = await import('node:fs/promises'); await rm(join(this.dir, `schema-${ds.id}.json`), { force: true }) } catch {}
    this.schemas.delete(ds.id)
    if (ds.type === 'sqlite' && ds.file?.startsWith(this.dir)) { try { const { rm } = await import('node:fs/promises'); await rm(ds.file, { force: true }); await rm(`${ds.file}-wal`, { force: true }); await rm(`${ds.file}-shm`, { force: true }) } catch {} }
    try { await this.ctx.get('credentials')?.deleteRecord(this.credentialKey(ds.id)) } catch {}
    await this.save()
    return { deleted: ds.id }
  },

  async savePolicy({ id, policy }) {
    const ds = this.requireDatasource(id)
    const next = normalizePolicy(policy)
    ds.policy = policyActive(next) ? next : undefined
    ds.updatedAt = Date.now()
    this.audit({ ds, source: 'ui', sql: `-- access policy updated: ${next.mode}, ${next.tables.length} table patterns, ${next.hiddenColumns.length} hidden, ${next.maskedColumns.length} masked`, title: '访问控制变更', status: 'ok' })
    await this.save()
    return this.publicDatasource(ds)
  },

  async setCurrent(id) {
    const ds = this.requireDatasource(id)
    this.state.current = ds.id
    await this.save()
    return this.publicDatasource(ds)
  },

  // ------------------------------------------------------------ binding

  datasourceForSession(sessionId, explicit) {
    const actor = this.actorFor(sessionId)
    if (explicit) { const ds = this.requireDatasource(explicit); this.assertAccess(actor, ds); return ds }
    const bound = sessionId ? this.findDatasource(this.state.sessions[sessionId]) : undefined
    if (bound) { this.assertAccess(actor, bound); return bound }
    if (actor && actor.kind !== 'owner') {
      // Scoped actors never fall back to the page's current data source.
      const first = Array.isArray(actor.datasourceIds) ? this.findDatasource(actor.datasourceIds[0]) : this.findDatasource(actor.defaultDatasourceId)
      if (!first) throw new UserError('nl2sql/no-datasource', '当前成员没有可访问的数据源')
      return first
    }
    const current = this.findDatasource(this.state.current) ?? (this.state.datasources.length === 1 ? this.state.datasources[0] : undefined)
    if (!current) throw new UserError('nl2sql/no-datasource', this.state.datasources.length === 0
      ? '尚未配置任何数据源。请用户在左侧栏「数据问答」页面新建数据源（MySQL / PostgreSQL / Elasticsearch）。'
      : `当前会话未选择数据源。可用数据源：${this.state.datasources.map(d => d.name).join('、')}。调用 nl2sql_datasource action=use 选择一个。`)
    return current
  },

  async bindSession(sessionId, datasourceId) {
    if (!sessionId) throw new UserError('nl2sql/invalid', '缺少会话')
    if (datasourceId === null) {
      delete this.state.sessions[sessionId]
    } else {
      const ds = this.requireDatasource(datasourceId)
      this.state.sessions[sessionId] = ds.id
      this.state.current = ds.id
    }
    await this.save()
    return this.sessionInfo(sessionId)
  },

  sessionInfo(sessionId) {
    let preset = null
    try {
      const agent = this.ctx.get('agents')?.get(sessionId)
      const presets = this.ctx.get('agentPresets')
      if (agent && presets) preset = presets.presetForSession(agent.session)
    } catch {}
    const boundId = this.state.sessions[sessionId] ?? null
    const effective = this.findDatasource(boundId) ?? this.findDatasource(this.state.current) ?? null
    return {
      sessionId,
      preset,
      boundDatasourceId: boundId,
      datasourceId: effective?.id ?? null,
      datasources: this.state.datasources.map(d => ({ id: d.id, name: d.name, database: d.database, type: d.type ?? 'mysql' })),
    }
  },

  // -------------------------------------------------------------- drivers

  driver(ds) {
    let pending = this.drivers.get(ds.id)
    if (!pending) {
      // Store the promise before awaiting so concurrent callers share one driver.
      pending = this.driverConfig(ds).then(conf => createDriver(conf))
      this.drivers.set(ds.id, pending)
      pending.catch(() => { if (this.drivers.get(ds.id) === pending) this.drivers.delete(ds.id) })
    }
    return pending.then(async (d) => {
      // A dropped SSH tunnel makes every later query fail; rebuild once.
      if (d.tunnel?.broken && this.drivers.get(ds.id) === pending) {
        this.drivers.delete(ds.id)
        d.close().catch(() => {})
        return this.driver(ds)
      }
      return d
    })
  },

  async closeDriver(id) {
    const pending = this.drivers.get(id)
    this.drivers.delete(id)
    if (pending) await pending.then(d => d.close()).catch(() => {})
  },

  /** Run a driver operation and convert database failures into user errors. */
  async withDriver(ds, fn) {
    try {
      return await fn(await this.driver(ds))
    } catch (error) {
      if (error instanceof UserError) throw error
      const e = describeError(error)
      throw new UserError(e.code, e.message)
    }
  },

  async testConnection(input) {
    let ds
    let secrets
    let temporary = false
    if (input.id && !input.host) {
      ds = this.requireDatasource(input.id)
    } else {
      const base = input.id ? this.findDatasource(input.id) : undefined
      ds = this.normalizeDatasourceInput({ ...input, name: input.name || base?.name || 'test' }, base ? { ...base } : undefined, { checkName: false })
      temporary = true
      secrets = { ...(base ? await this.readSecrets(base.id) : {}) }
      const patch = this.secretPatch(input)
      Object.assign(secrets, patch)
    }
    const started = Date.now()
    let driver
    try {
      driver = await createDriver(await this.driverConfig(ds, secrets))
      const info = await driver.test()
      const result = { ok: true, latencyMs: Date.now() - started, ...info, viaSsh: Boolean(ds.ssh?.enabled) }
      if (!temporary) {
        Object.assign(ds, { serverVersion: info.version, lastTestAt: Date.now(), lastTestOk: true, readOnlyGrant: info.readOnlyGrant })
        await this.save()
      }
      return result
    } catch (error) {
      if (!temporary) {
        Object.assign(ds, { lastTestAt: Date.now(), lastTestOk: false })
        await this.save()
      }
      return { ok: false, latencyMs: Date.now() - started, error: describeError(error).message }
    } finally {
      await driver?.close().catch(() => {})
    }
  },
}
