/**
 * Nl2SqlService methods: storage statistics, log retention, configuration
 * export / import, about info, Ask-page suggestions and onboarding status.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS, RECORD_LIMITS, UserError, newId, pick } from './shared.js'
import { widgetWidth } from './dashboards.js'
import { kindOf } from '../channels/index.js'
import { findIdentityClash, normalizeIdentities, normalizeUserRecord } from './access.js'
import { migrateChannelRecord } from './channels.js'

const PKG = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) } catch { return {} } })()

const CONFIG_FORMAT = 'dsh-nl2sql-config'
const SECTIONS = ['settings', 'datasources', 'knowledge', 'dashboards', 'alerts', 'reports', 'channels', 'users']
/** Datasource fields carried by a config export (never secrets). */
const DS_FIELDS = ['id', 'name', 'type', 'host', 'port', 'database', 'user', 'charset', 'timezone', 'ssl', 'schemas', 'description', 'privacy', 'policy']
const ALERT_RUNTIME = ['state', 'lastCheckedAt', 'lastValue', 'lastResultId', 'lastFiredAt', 'lastError']
const REPORT_FIELDS = ['id', 'title', 'scope', 'question', 'instructions', 'period', 'time', 'weekdays', 'timeZone', 'target']
const CHANNEL_FIELDS = ['id', 'name', 'type', 'platform', 'domain', 'appId', 'receiveIdType', 'receiveId', 'description', 'isDefault', 'chartMode', 'config', 'bot']

async function fileBytes(file) {
  try { return (await stat(file)).size } catch { return 0 }
}

/** "区块链交易表 - 记录具体链…" → "区块链交易" (same cleanup the Ask page used). */
export function tableLabel(t) {
  return t.comment ? t.comment.split(/[\s\-—–:：,，(（]/)[0].replace(/表$/, '') || t.name : t.name
}

/**
 * Schema-based example questions. Fact tables (largest first, then other
 * tables) each contribute several templates: daily trend, distribution by an
 * enum column, top-N by a measure, totals. Returns a long, deterministic pool;
 * the Ask page shows a page of it at a time ("换一批").
 */
export function schemaExamples(schema, locale = 'zh') {
  const en = locale === 'en'
  if (!schema) return en ? ['What are the core business tables and what is each one for?', 'Which 10 tables hold the most rows?'] : ['这个库里有哪些核心业务表？分别是做什么的？', '数据量最大的 10 张表是哪些？']
  const byRows = (a, b) => (b.rows ?? 0) - (a.rows ?? 0)
  const tables = [...schema.tables.filter(tb => tb.role === 'fact').sort(byRows), ...schema.tables.filter(tb => tb.role !== 'fact' && tb.role !== 'log' && tb.role !== 'config').sort(byRows)].filter(tb => !tb.blocked)
  const colLabel = (c) => (en ? c.name : (c.comment || c.name).split(/[\s:：,，(（]/)[0])
  // Round-robin: first template of every table, then the second, … so a page mixes tables.
  const perTable = tables.slice(0, 12).map(f => {
    const label = en ? f.name.split('.').pop() : tableLabel(f)
    const qs = []
    const time = f.columns.find(c => c.roles.includes('time') && !/update|modif/i.test(c.name)) ?? f.columns.find(c => c.roles.includes('time'))
    const enumCol = f.columns.find(c => c.roles.includes('enum') && c.values?.length && !c.roles.includes('sensitive'))
    const enum2 = f.columns.filter(c => c.roles.includes('enum') && c.values?.length && !c.roles.includes('sensitive'))[1]
    const measure = f.columns.find(c => c.roles.includes('measure') && !c.roles.includes('flag') && !c.roles.includes('id') && !/_no$|uid$|_id$/i.test(c.name))
    if (time) qs.push(en ? `${label} trend per day over the last 30 days` : `最近 30 天每天的${label}数量趋势`)
    if (enumCol) qs.push(en ? `${label} by ${enumCol.name}` : `${label}按${colLabel(enumCol)}的分布`)
    if (measure && enumCol) qs.push(en ? `Total ${measure.name} of ${label} by ${enumCol.name}` : `各${colLabel(enumCol)}的${label}${colLabel(measure)}合计`)
    if (time && enumCol) qs.push(en ? `How did ${label} by ${enumCol.name} change week over week?` : `${label}按${colLabel(enumCol)}的周环比变化`)
    if (measure) qs.push(en ? `Top 10 ${label} by ${measure.name}` : `${colLabel(measure)}最大的 10 条${label}`)
    if (enum2) qs.push(en ? `${label} by ${enumCol.name} and ${enum2.name}` : `${label}按${colLabel(enumCol)}和${colLabel(enum2)}的交叉分布`)
    if (time) qs.push(en ? `How many ${label} were added yesterday compared with the day before?` : `昨天新增了多少${label}？和前一天相比如何？`)
    return qs
  })
  const out = []
  for (let i = 0; perTable.some(q => q[i]); i++) for (const q of perTable) if (q[i]) out.push(q[i])
  out.push(en ? 'What are the core business tables and how are they related?' : '这个库里有哪些核心业务表？它们之间是什么关系？')
  out.push(en ? 'Which 10 tables hold the most rows?' : '数据量最大的 10 张表是哪些？')
  return out
}

/** Example questions from the metric library (two templates per metric). */
export function metricExamples(metrics, locale = 'zh') {
  const en = locale === 'en'
  const first = []
  const second = []
  for (const m of metrics) {
    if (m.timeColumn) first.push(en ? `Daily ${m.name} over the last 30 days` : `最近 30 天每天的${m.name}`)
    else first.push(en ? `What is the ${m.name}?` : `${m.name}是多少`)
    if (m.dimensions?.length) second.push(en ? `${m.name} by ${m.dimensions[0]}` : `${m.name}按${m.dimensions[0]}分布`)
    else if (m.timeColumn) second.push(en ? `${m.name} this month vs last month` : `本月和上月的${m.name}对比`)
  }
  return [...first, ...second]
}

const ASK_PAGE = 6

export const methods = {
  // ------------------------------------------------------------- storage

  async storageStats() {
    const db = join(this.dir, 'results.sqlite')
    const bytes = (await fileBytes(db)) + (await fileBytes(`${db}-wal`)) + (await fileBytes(`${db}-shm`))
    const s = this.cacheStats()
    let uploads = 0
    try { for (const n of await readdir(this.uploadDir())) uploads += await fileBytes(join(this.uploadDir(), n)) } catch {}
    return {
      resultsDb: { bytes, results: s.results, cacheEntries: s.cacheEntries, resultBytes: s.bytes },
      records: this.records.counts(),
      retention: this.records.limits(),
      stateBytes: await fileBytes(this.file),
      uploadsBytes: uploads,
      dataDir: this.dir,
    }
  },

  async purgeRecords({ kind } = {}) {
    if (!Object.hasOwn(RECORD_LIMITS, kind)) throw new UserError('nl2sql/invalid', `未知的日志类型：${kind}（可选：${Object.keys(RECORD_LIMITS).join(' / ')}）`)
    const n = this.records.count(kind)
    this.records.clear(kind)
    this.auditAdmin('records.purge', `${kind}（${n} 条）`)
    await this.save()
    return { kind, purged: n, records: this.records.counts() }
  },

  aboutInfo() {
    let sqliteVersion = null
    try {
      const db = new DatabaseSync(':memory:')
      sqliteVersion = db.prepare('SELECT sqlite_version() AS v').get().v
      db.close()
    } catch {}
    return {
      name: PKG.name ?? 'nl2sql',
      version: PKG.version ?? null,
      dataDir: this.dir,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
      sqliteVersion,
      testsCommand: 'npm test',
    }
  },

  // ------------------------------------------------------- Ask & onboarding

  /**
   * Ask-page suggestions. `examples` is one page of a deterministic pool that
   * mixes the metric library, liked (👍) questions, verified examples and
   * schema templates; `offset` pages through it ("换一批", wrapping around).
   * `recent` lists the latest distinct agent questions (paged by `recentLimit`).
   */
  async askSuggestions({ datasourceId, locale = 'zh', offset = 0, pageSize = ASK_PAGE, recentLimit = 8 } = {}) {
    const lang = locale === 'en' ? 'en' : 'zh'
    const ds = this.requireDatasource(datasourceId ?? this.state.current)
    const k = this.knowledgeFor(ds.id)
    const pool = []
    const add = (q) => { const s = String(q ?? '').trim(); if (s && !pool.includes(s)) pool.push(s) }
    const metricQs = metricExamples(k.metrics, lang)
    const liked = this.records.list('feedback', { ref: ds.id, limit: 200, filter: f => f.rating === 'up' && Boolean(f.question?.trim()) }).map(f => f.question.trim())
    const verified = [...k.examples].reverse().map(e => e.question)
    let schema
    if (ds.schemaAnalyzedAt || this.schemas.has(ds.id)) { try { schema = await this.visibleSchema(ds) } catch {} }
    const schemaQs = schemaExamples(schema, lang)
    // Interleave sources so every page is a mix: metric, liked, verified, schema, schema …
    const sources = [metricQs, liked, lang === 'zh' ? verified : [], schemaQs]
    const weights = [1, 1, 1, 2]
    for (let i = 0; sources.some(src => src.length); i++) {
      sources.forEach((src, j) => { for (let n = 0; n < weights[j] && src.length; n++) add(src.shift()) })
    }
    const size = Math.max(1, Math.min(12, Math.floor(Number(pageSize) || ASK_PAGE)))
    const total = pool.length
    const start = total ? ((Math.floor(Number(offset) || 0) % total) + total) % total : 0
    const examples = []
    for (let i = 0; i < Math.min(size, total); i++) examples.push(pool[(start + i) % total])
    const recent = []
    const seen = new Set()
    const cap = Math.max(1, Math.min(50, Math.floor(Number(recentLimit) || 8)))
    this.records.list('history', { ref: ds.id, limit: cap + 1, filter: h => {
      if (h.source !== 'agent' || !h.title) return false
      if (seen.has(h.title)) return false
      seen.add(h.title)
      return true
    } }).forEach(h => recent.push({ id: h.id, at: h.at, question: h.title, sessionId: h.sessionId ?? null, resultId: h.resultId ?? null, sql: h.sql, status: h.status ?? 'ok' }))
    return {
      datasourceId: ds.id, locale: lang, tableCount: schema ? schema.tables.length : null,
      examples, total, offset: start, nextOffset: total ? (start + size) % total : 0, pageSize: size,
      recent: recent.slice(0, cap), hasMoreRecent: recent.length > cap,
    }
  },

  onboardingStatus() {
    const k = Object.values(this.state.knowledge ?? {})
    return {
      hasDatasource: this.state.datasources.length > 0,
      analyzed: this.state.datasources.some(d => d.schemaAnalyzedAt || this.schemas.has(d.id)),
      hasKnowledge: k.some(x => (x.glossary?.length ?? 0) + (x.metrics?.length ?? 0) + (x.examples?.length ?? 0) > 0),
      askedQuestion: this.records.list('history', { limit: 1, filter: h => h.source === 'agent' }).length > 0,
      hasChannel: this.state.channels.length > 0,
      dismissed: Boolean(this.state.onboardingDismissed),
    }
  },

  async dismissOnboarding({ dismissed = true } = {}) {
    this.state.onboardingDismissed = Boolean(dismissed)
    await this.save()
    return this.onboardingStatus()
  },

  // ------------------------------------------------------ config export

  /** Whole configuration as one JSON document, without secrets or runtime state. */
  exportConfig() {
    const dsName = (id) => this.findDatasource(id)?.name ?? null
    const chName = (id) => this.state.channels.find(c => c.id === id)?.name ?? null
    const settings = structuredClone(this.state.settings)
    const botDs = settings.botDefaultDatasourceIds !== undefined ? settings.botDefaultDatasourceIds : settings.larkDefaultDatasourceIds
    if (Array.isArray(botDs)) settings.botDefaultDatasources = botDs.map(dsName).filter(Boolean)
    if (settings.larkDefaultRole !== undefined && settings.botDefaultRole === undefined) settings.botDefaultRole = settings.larkDefaultRole
    delete settings.larkDefaultDatasourceIds; delete settings.botDefaultDatasourceIds; delete settings.larkDefaultRole
    if (settings.schemaNotifyChannel) settings.schemaNotifyChannelName = chName(settings.schemaNotifyChannel)
    delete settings.schemaNotifyChannel
    return {
      format: CONFIG_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      plugin: { name: PKG.name, version: PKG.version },
      settings,
      datasources: this.state.datasources.map(ds => ({
        ...structuredClone(pick(ds, DS_FIELDS)),
        type: ds.type ?? 'mysql',
        hasPassword: Boolean(ds.hasPassword),
        hasApiKey: Boolean(ds.hasApiKey),
        ssh: ds.ssh?.enabled ? { enabled: true, host: ds.ssh.host, port: ds.ssh.port, user: ds.ssh.user, auth: ds.ssh.auth ?? 'password', hasSecret: Boolean(ds.ssh.hasSecret) } : { enabled: false },
        ...(ds.type === 'sqlite' ? { localFile: true } : {}),
      })),
      knowledge: this.exportKnowledge({}).datasources,
      dashboards: this.state.dashboards.map(d => ({
        id: d.id, name: d.name, description: d.description ?? '', filters: structuredClone(d.filters ?? []),
        widgets: d.widgets.map(w => ({ ...structuredClone(pick(w, ['id', 'title', 'sql', 'chart', 'width'])), datasourceName: dsName(w.datasourceId) })),
      })),
      alerts: (this.state.alerts ?? []).map(a => {
        const out = structuredClone(a)
        for (const k of ALERT_RUNTIME) delete out[k]
        delete out.datasourceId; delete out.channelId
        return { ...out, datasourceName: dsName(a.datasourceId), channelName: chName(a.channelId) }
      }),
      reports: this.state.reports.map(r => ({
        ...structuredClone(pick(r, REPORT_FIELDS)),
        datasourceName: dsName(r.datasourceId),
        channelName: chName(r.channelId),
        dashboardName: this.state.dashboards.find(d => d.id === r.dashboardId)?.name ?? null,
      })),
      channels: this.state.channels.map(c => { migrateChannelRecord(c); return { ...structuredClone(pick(c, CHANNEL_FIELDS)), secretsSet: { ...(c.secretsSet ?? {}) }, hasSecret: Boolean(c.hasSecret ?? Object.keys(c.secretsSet ?? {}).length), hasSign: Boolean(c.hasSign) } }),
      users: (this.state.users ?? []).map(u => {
        const out = normalizeUserRecord(structuredClone(u))
        out.datasources = Array.isArray(u.datasourceIds) ? u.datasourceIds.map(dsName).filter(Boolean) : null
        out.defaultDatasource = dsName(u.defaultDatasourceId)
        out.rowRules = (u.rowRules ?? []).map(r => ({ ...r, datasource: r.datasourceId ? dsName(r.datasourceId) : null, datasourceId: undefined }))
        delete out.datasourceIds; delete out.defaultDatasourceId
        return out
      }),
    }
  },

  // ------------------------------------------------------ config import

  /**
   * Import a document produced by exportConfig.
   *   mode 'merge' (default): items are matched by name (users by identity)
   *     and updated; others are added. Ids that clash get new ids.
   *   mode 'replace': dashboards, alerts, reports, channels, users and
   *     knowledge sections present in the file replace the current ones;
   *     data sources are matched by name and never deleted.
   * References between sections resolve by data source / channel / dashboard
   * name. Secrets are never in the file: imported data sources and channels
   * that had one are flagged needsSecret. dryRun reports counts only.
   */
  async importConfig({ data, mode = 'merge', dryRun = false, sections } = {}) {
    let doc = data
    if (typeof doc === 'string') { try { doc = JSON.parse(doc) } catch { throw new UserError('nl2sql/invalid', '不是有效的 JSON') } }
    if (doc?.format !== CONFIG_FORMAT) throw new UserError('nl2sql/invalid', `不是有效的配置导出文件（format 应为 ${CONFIG_FORMAT}）`)
    if (Number(doc.version) !== 1) throw new UserError('nl2sql/invalid', `不支持的配置版本：${doc.version}`)
    if (mode !== 'merge' && mode !== 'replace') throw new UserError('nl2sql/invalid', 'mode 必须是 merge 或 replace')
    for (const s of SECTIONS) if (doc[s] !== undefined && s !== 'settings' && !Array.isArray(doc[s])) throw new UserError('nl2sql/invalid', `${s} 必须是数组`)
    const want = new Set(Array.isArray(sections) && sections.length ? sections.filter(s => SECTIONS.includes(s)) : SECTIONS)
    const apply = !dryRun
    const report = {}
    const sec = (name) => (report[name] ??= { add: 0, update: 0, skipped: 0, warnings: [] })
    const warn = (name, text) => { const r = sec(name); if (r.warnings.length < 50) r.warnings.push(text) }

    // ---- datasources: name → target id (existing or created)
    const dsByName = new Map(this.state.datasources.map(d => [d.name, d.id]))
    const dsMap = new Map() // source name → target id (or a planned placeholder in dry runs)
    if (want.has('datasources')) {
      const r = sec('datasources')
      r.needsSecret = []
      for (const src of doc.datasources ?? []) {
        const name = String(src?.name ?? '').trim()
        if (!name) { r.skipped++; warn('datasources', '缺少名称的数据源已跳过'); continue }
        const needsSecret = Boolean(src.hasPassword || src.hasApiKey || src.ssh?.hasSecret)
        const existing = this.findDatasource(dsByName.get(name))
        try {
          const input = { ...pick(src, DS_FIELDS.filter(k => k !== 'id')), ssh: src.ssh?.enabled ? { ...src.ssh } : { enabled: false } }
          // Local file sources have no connection fields (normalizeDatasourceInput fills them).
          if (src.type === 'sqlite') { delete input.host; delete input.port; delete input.user; delete input.ssh }
          if (existing) {
            const ds = this.normalizeDatasourceInput(input, { ...existing }, { checkName: false })
            if (apply) {
              const i = this.state.datasources.findIndex(d => d.id === existing.id)
              this.state.datasources[i] = ds
              await this.closeDriver(ds.id)
              this.schemas.delete(ds.id)
            }
            dsMap.set(name, existing.id)
            r.update++
          } else {
            const clash = src.id && this.state.datasources.some(d => d.id === src.id)
            const base = this.normalizeDatasourceInput(input, undefined, { checkName: false })
            if (src.id && !clash && /^ds-[\w-]+$/.test(src.id)) {
              base.id = src.id
              if (base.type === 'sqlite') base.file = join(this.dir, 'files', `${base.id}.sqlite`)
            }
            if (needsSecret) base.needsSecret = true
            base.hasPassword = false; base.hasApiKey = false
            if (base.ssh?.enabled) base.ssh.hasSecret = false
            if (apply) {
              this.state.datasources.push(base)
              if (!this.state.current) this.state.current = base.id
            }
            dsMap.set(name, base.id)
            dsByName.set(name, base.id)
            if (needsSecret) r.needsSecret.push(name)
            if (base.type === 'sqlite') warn('datasources', `「${name}」是本地文件数据源，文件数据不在配置中，需要重新上传`)
            r.add++
          }
        } catch (error) {
          r.skipped++
          warn('datasources', `「${name}」：${error.message}`)
        }
      }
    }
    const resolveDs = (name) => {
      if (!name) return undefined
      return dsMap.get(name) ?? dsByName.get(name)
    }

    // ---- channels: name → id
    const chMap = new Map(this.state.channels.map(c => [c.name, c.id]))
    if (want.has('channels')) {
      const r = sec('channels')
      r.needsSecret = []
      const next = mode === 'replace' ? [] : [...this.state.channels]
      if (mode === 'replace') chMap.clear()
      for (const src of doc.channels ?? []) {
        const name = String(src?.name ?? '').trim().slice(0, 64)
        const found = kindOf(src?.type)
        if (!name || !found) { r.skipped++; warn('channels', `渠道「${name || '?'}」无效${src?.type && !found ? `（不支持的类型 ${src.type}）` : ''}，已跳过`); continue }
        const current = mode === 'replace' ? this.state.channels.find(c => c.name === name) : next.find(c => c.name === name)
        const fields = structuredClone(pick(src, CHANNEL_FIELDS.filter(k => k !== 'id' && k !== 'isDefault')))
        fields.platform = found.adapter.id
        if (fields.bot) fields.bot = this.normalizeBotConfig(fields.bot, {})
        if (current && current.type !== src.type) { delete current.config; delete current.secretsSet }
        if (current) {
          const c = migrateChannelRecord({ ...current, ...fields, name, ...(src.config ? {} : { config: undefined }), updatedAt: Date.now() })
          const i = next.findIndex(x => x.id === current.id)
          if (i >= 0) next[i] = c; else next.push(c)
          chMap.set(name, c.id)
          r.update++
        } else {
          const id = src.id && /^ch-[\w-]+$/.test(src.id) && !next.some(c => c.id === src.id) && !this.state.channels.some(c => c.id === src.id) ? src.id : newId('ch')
          const c = migrateChannelRecord({ id, ...fields, name, hasSecret: false, hasSign: false, secretsSet: {}, needsSecret: true, createdAt: Date.now(), updatedAt: Date.now(), isDefault: false })
          // Bots need their secret back first.
          if (c.bot) c.bot.enabled = false
          next.push(c)
          chMap.set(name, id)
          r.add++
          r.needsSecret.push(name)
        }
      }
      {
        const wantDefault = (doc.channels ?? []).find(c => c?.isDefault)?.name
        if (wantDefault && next.some(c => c.name === wantDefault) && !next.some(c => c.isDefault)) for (const c of next) c.isDefault = c.name === wantDefault
        if (next.length && !next.some(c => c.isDefault)) next[0].isDefault = true
      }
      if (apply) this.state.channels = next
    }
    const resolveCh = (name) => (name ? chMap.get(name) ?? null : null)

    // ---- knowledge
    if (want.has('knowledge')) {
      const r = sec('knowledge')
      r.items = 0
      for (const block of doc.knowledge ?? []) {
        const target = resolveDs(block?.name)
        if (!target) { r.skipped++; warn('knowledge', `找不到数据源「${block?.name}」，其业务知识已跳过`); continue }
        const items = (block.glossary?.length ?? 0) + (block.metrics?.length ?? 0) + Object.keys(block.notes ?? {}).length + (block.examples?.length ?? 0)
        if (!apply || !this.findDatasource(target)) {
          r.items += items
          if (this.findDatasource(target) && this.knowledgeFor(target).glossary.length + this.knowledgeFor(target).metrics.length + this.knowledgeFor(target).examples.length) r.update++; else r.add++
          continue
        }
        const res = await this.importKnowledge({ data: { format: 'dsh-nl2sql-knowledge', version: 1, datasources: [block] }, targetDatasourceId: target, mode, dryRun: false })
        const c = res.report[0] ?? {}
        r.items += (c.glossary ?? 0) + (c.metrics ?? 0) + (c.notes ?? 0) + (c.examples ?? 0)
        if (c.invalid) warn('knowledge', `「${block.name}」有 ${c.invalid} 条无效条目被跳过`)
        r.update++
      }
    }

    // ---- dashboards
    const dbMap = new Map(this.state.dashboards.map(d => [d.name, d.id]))
    if (want.has('dashboards')) {
      const r = sec('dashboards')
      r.widgets = 0
      const next = mode === 'replace' ? [] : [...this.state.dashboards]
      for (const src of doc.dashboards ?? []) {
        const name = String(src?.name ?? '').trim().slice(0, 40)
        if (!name) { r.skipped++; continue }
        const widgets = []
        for (const w of src.widgets ?? []) {
          const dsId = resolveDs(w?.datasourceName)
          if (!dsId || typeof w.sql !== 'string' || !w.sql.trim()) { warn('dashboards', `看板「${name}」的组件「${w?.title ?? '?'}」引用的数据源「${w?.datasourceName ?? '?'}」不存在，已跳过`); continue }
          widgets.push({ id: newId('w'), title: String(w.title || 'Untitled').slice(0, 120), sql: w.sql, datasourceId: dsId, chart: w.chart ?? { type: 'table' }, width: widgetWidth(w.width), createdAt: Date.now() })
        }
        r.widgets += widgets.length
        const existing = next.find(d => d.name === name)
        if (existing) {
          const d = { ...existing, description: String(src.description ?? existing.description ?? '').slice(0, 300), widgets, filters: Array.isArray(src.filters) ? src.filters : existing.filters ?? [], updatedAt: Date.now() }
          next[next.indexOf(existing)] = d
          r.update++
        } else {
          const prev = mode === 'replace' ? this.state.dashboards.find(d => d.name === name) : undefined
          const id = prev?.id ?? (src.id && /^db-[\w-]+$/.test(src.id) && !next.some(d => d.id === src.id) && !this.state.dashboards.some(d => d.id === src.id) ? src.id : newId('db'))
          next.push({ id, name, description: String(src.description ?? '').slice(0, 300), widgets, filters: Array.isArray(src.filters) ? src.filters : [], createdAt: Date.now(), updatedAt: Date.now() })
          r.add++
        }
        dbMap.set(name, next.find(d => d.name === name).id)
      }
      if (apply) {
        if (!next.length) next.push({ id: 'db-default', name: '默认看板', description: '', widgets: [], filters: [], createdAt: Date.now() })
        this.state.dashboards = next
        if (!next.some(d => d.id === this.state.currentDashboard)) this.state.currentDashboard = next[0].id
        for (const rp of this.state.reports) if (rp.dashboardId && !next.some(d => d.id === rp.dashboardId)) delete rp.dashboardId
        this.syncLegacyDashboard()
      }
    }

    // ---- alerts
    if (want.has('alerts')) {
      const r = sec('alerts')
      const next = mode === 'replace' ? [] : [...(this.state.alerts ?? [])]
      for (const src of doc.alerts ?? []) {
        const name = String(src?.name ?? '').trim().slice(0, 60)
        const dsId = resolveDs(src?.datasourceName)
        if (!name || !dsId) { r.skipped++; warn('alerts', `告警「${name || '?'}」引用的数据源「${src?.datasourceName ?? '?'}」不存在，已跳过`); continue }
        const def = structuredClone(src)
        for (const k of [...ALERT_RUNTIME, 'datasourceName', 'channelName', 'id']) delete def[k]
        const existing = next.find(a => a.name === name)
        const a = { ...def, name, datasourceId: dsId, channelId: resolveCh(src.channelName), state: 'ok', updatedAt: Date.now() }
        if (src.channelName && !a.channelId) warn('alerts', `告警「${name}」的推送渠道「${src.channelName}」不存在，已清空`)
        if (existing) { next[next.indexOf(existing)] = { ...a, id: existing.id, createdAt: existing.createdAt }; r.update++ }
        else {
          const id = src.id && /^al-[\w-]+$/.test(src.id) && !next.some(x => x.id === src.id) ? src.id : newId('al')
          next.push({ ...a, id, createdAt: Date.now() })
          r.add++
        }
      }
      if (apply) this.state.alerts = next
    }

    // ---- reports (schedules are created only when the schedule service exists)
    if (want.has('reports')) {
      const r = sec('reports')
      let paused = 0
      r.paused = false
      const schedule = this.ctx.get('schedule')
      if (apply && mode === 'replace') for (const rp of [...this.state.reports]) await this.deleteReport(rp.id)
      for (const src of doc.reports ?? []) {
        const title = String(src?.title ?? '').trim()
        const dsId = resolveDs(src?.datasourceName)
        if (!title || !dsId) { r.skipped++; warn('reports', `报告「${title || '?'}」引用的数据源「${src?.datasourceName ?? '?'}」不存在，已跳过`); continue }
        const existing = this.state.reports.find(x => x.title === title)
        const input = { ...pick(src, REPORT_FIELDS.filter(k => k !== 'id')), title, datasourceId: dsId, channelId: resolveCh(src.channelName) ?? undefined, dashboardId: src.dashboardName ? dbMap.get(src.dashboardName) : undefined }
        if (existing && mode === 'merge') r.update++; else r.add++
        if (!apply) { if (!schedule) paused++; continue }
        if (schedule && this.findDatasource(dsId)) {
          try {
            await this.saveReport({ ...input, id: existing && mode === 'merge' ? existing.id : undefined })
            continue
          } catch (error) {
            warn('reports', `报告「${title}」创建定时任务失败：${error.message}，已按暂停导入`)
          }
        }
        // No schedule service: keep the definition, paused, until the report is saved again.
        const rp = {
          id: existing && mode === 'merge' ? existing.id : newId('rp'),
          title: title.slice(0, 80), datasourceId: dsId,
          scope: input.scope === 'dashboard' ? 'dashboard' : 'question', question: String(input.question ?? '').slice(0, 2000),
          instructions: String(input.instructions ?? '').slice(0, 1000), period: input.period === 'weekly' ? 'weekly' : 'daily',
          time: /^\d{2}:\d{2}(:\d{2})?$/.test(String(input.time)) ? (String(input.time).length === 5 ? `${input.time}:00` : String(input.time)) : '09:00:00',
          weekdays: Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter(n => n >= 1 && n <= 7) : [1],
          timeZone: String(input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone), target: input.target === 'new' ? 'new' : 'new_once',
          channelId: input.channelId, dashboardId: input.dashboardId, paused: true, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
        }
        this.state.reports = [...this.state.reports.filter(x => x.id !== rp.id), rp]
        paused++
      }
      r.paused = paused > 0
      if (paused) warn('reports', schedule ? `${paused} 个报告未能创建定时任务，已按暂停导入` : `当前 Harness 没有定时任务服务，${paused} 个报告已按暂停导入；启用定时任务后重新保存即可`)
    }

    // ---- users
    if (want.has('users')) {
      const r = sec('users')
      const next = mode === 'replace' ? [] : [...(this.state.users ?? [])]
      for (const src of doc.users ?? []) {
        const name = String(src?.name ?? '').trim().slice(0, 60)
        if (!name || !['person', 'chat'].includes(src.kind ?? 'person') || !['admin', 'analyst', 'viewer'].includes(src.role ?? 'analyst')) { r.skipped++; continue }
        const ids = src.datasources === null || src.datasources === undefined ? null : (src.datasources ?? []).map(resolveDs).filter(Boolean)
        if (Array.isArray(src.datasources) && ids.length < src.datasources.length) warn('users', `成员「${name}」的部分数据源不存在，已忽略`)
        let identities
        try { identities = Array.isArray(src.identities) ? normalizeIdentities(src.identities) : undefined } catch (error) { r.skipped++; warn('users', `成员「${name}」：${error.message}`); continue }
        const u = normalizeUserRecord({
          ...pick(src, ['kind', 'role', 'larkOpenId', 'email', 'larkChatId', 'disabled', 'note']),
          ...(identities ? { identities } : {}),
          kind: src.kind ?? 'person', role: src.role ?? 'analyst', name,
          datasourceIds: ids, defaultDatasourceId: resolveDs(src.defaultDatasource) ?? ids?.[0] ?? null,
          rowRules: (src.rowRules ?? []).map(x => ({ datasourceId: x.datasource ? resolveDs(x.datasource) ?? null : null, column: x.column, values: x.values ?? [] })).filter(x => x.column && x.values.length),
          updatedAt: Date.now(),
        })
        const existing = findIdentityClash(next, { ...u, id: undefined }) ?? next.find(x => x.name === name)
        if (existing) { next[next.indexOf(existing)] = { ...u, id: existing.id, createdAt: existing.createdAt }; r.update++ }
        else {
          const id = src.id && /^u-[\w-]+$/.test(src.id) && !next.some(x => x.id === src.id) ? src.id : newId('u')
          next.push({ ...u, id, createdAt: Date.now() })
          r.add++
        }
      }
      if (apply) this.state.users = next
    }

    // ---- settings (validated through saveSettings)
    if (want.has('settings') && doc.settings && typeof doc.settings === 'object') {
      const r = sec('settings')
      const input = pick(doc.settings, Object.keys(DEFAULT_SETTINGS).concat(['schemaCheckDaily']))
      if (doc.settings.larkDefaultRole !== undefined && input.botDefaultRole === undefined) input.botDefaultRole = doc.settings.larkDefaultRole
      const botDs = doc.settings.botDefaultDatasources ?? doc.settings.larkDefaultDatasources
      if (Array.isArray(botDs)) input.botDefaultDatasourceIds = botDs.map(resolveDs).filter(Boolean)
      if (doc.settings.schemaNotifyChannelName) input.schemaNotifyChannel = resolveCh(doc.settings.schemaNotifyChannelName) ?? ''
      if (apply) {
        const before = structuredClone(this.state.settings)
        try { await this.saveSettings(input) } catch (error) { this.state.settings = before; r.skipped++; warn('settings', error.message) }
        if (!r.skipped) r.update = Object.keys(input).length
      } else {
        r.update = Object.keys(input).length
      }
    }

    if (apply) {
      this.auditAdmin('config.import', `${mode}: ${Object.entries(report).map(([k, v]) => `${k} +${v.add}/~${v.update}`).join(', ')}`)
      await this.save()
      if (want.has('alerts')) this.scheduleAlerts()
    }
    return { dryRun: Boolean(dryRun), mode, report }
  },
}
