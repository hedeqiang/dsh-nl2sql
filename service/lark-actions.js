/**
 * Nl2SqlService methods: interactive buttons on Lark bot answer cards.
 * Mixed into the service prototype by index.js; `this` is the service.
 *
 * Buttons carry only an opaque token ({ a: <action>, t: <token> }); the token
 * maps server-side to { resultId, sessionId, chatId, replyTo, depth, ownerRole }.
 * Every click re-resolves the clicking operator and re-checks data source
 * scope, row-level rules and role before anything runs.
 */
import { randomBytes } from 'node:crypto'
import { parseSelect } from '../analysis.js'
import { buildCard } from '../im.js'
import { getUserInfo, replyMessage, replyText } from '../lark-bot.js'
import { toUserError } from './shared.js'

export const ACTION_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000
const ACTION_TOKEN_MAX = 5000
export const ACTION_RATE_MS = 2000
/** Cards produced by button actions get buttons up to this depth (0 = answer card). */
export const ACTION_MAX_DEPTH = 2
const ACTIONS = new Set(['drill', 'why', 'detail', 'pin'])
const ACTION_LABEL = { drill: '拆分', why: '为什么变化', detail: '明细', pin: '固定到看板' }

const toast = (type, content) => ({ toast: { type, content } })

function hasAggregate(r, dialect) {
  const parsed = parseSelect(r.baseSql ?? r.sql, { dialect })
  return Boolean(parsed?.select?.some(i => i.isAggregate))
}

export const methods = {
  // ------------------------------------------------------------- tokens

  /** Store context for a card's buttons; returns the opaque token. */
  createLarkActionToken(ctx) {
    const token = randomBytes(9).toString('base64url')
    const now = Date.now()
    const body = { resultId: ctx.resultId, sessionId: ctx.sessionId ?? null, chatId: ctx.chatId ?? null, chatType: ctx.chatType === 'p2p' ? 'p2p' : 'group', replyTo: ctx.replyTo ?? null, depth: ctx.depth ?? 0, ownerRole: ctx.ownerRole ?? null }
    this.larkActionTokens ??= new Map()
    this.larkActionTokens.set(token, { ...body, created: now })
    while (this.larkActionTokens.size > ACTION_TOKEN_MAX) this.larkActionTokens.delete(this.larkActionTokens.keys().next().value)
    try {
      this.store?.putActionToken(token, body, now)
      if ((this.larkTokenWrites = (this.larkTokenWrites ?? 0) + 1) % 200 === 0) this.store?.pruneActionTokens(ACTION_TOKEN_TTL_MS, ACTION_TOKEN_MAX)
    } catch {}
    return token
  },

  /** Context for a token, or undefined when unknown / expired. */
  lookupLarkActionToken(token, now = Date.now()) {
    if (typeof token !== 'string' || !/^[\w-]{8,32}$/.test(token)) return undefined
    let ctx = this.larkActionTokens?.get(token)
    if (!ctx) { try { ctx = this.store?.getActionToken(token) } catch {} }
    if (!ctx || now - ctx.created > ACTION_TOKEN_TTL_MS) return undefined
    return ctx
  },

  // ------------------------------------------------------------- building

  /**
   * Button spec (see im.js actionElement) for one result shown to `actor` in a
   * chat, or undefined when nothing applies. Never throws.
   */
  async larkCardActions(result, { actor, sessionId, chatId, chatType, replyTo, depth = 0 } = {}) {
    try {
      if (!result?.resultId || result.error || depth >= ACTION_MAX_DEPTH) return undefined
      const ds = this.findDatasource(result.datasourceId)
      if (!ds) return undefined
      const dialect = ds.type ?? 'mysql'
      const role = actor?.role ?? 'analyst'
      const token = this.createLarkActionToken({ resultId: result.resultId, sessionId, chatId, chatType, replyTo, depth, ownerRole: role })
      const aggregate = hasAggregate(result, dialect)
      const buttons = []
      let select
      if (aggregate) {
        let dims = []
        try { dims = (await this.drillDimensions(result.resultId)).dimensions } catch {}
        const xName = result.chart?.x
        dims = dims.filter(d => d.column !== xName && d.column.split('.').pop() !== xName).slice(0, 6)
        if (dims.length) select = { placeholder: '按维度拆分', value: { a: 'drill', t: token }, options: dims.map(d => ({ text: d.label && d.label !== d.column ? `${d.label}（${d.column}）` : d.column, value: d.column })) }
      }
      const xi = result.chart?.x ? result.columns.findIndex(c => c.name === result.chart.x) : -1
      const points = xi >= 0 ? result.rows.filter(r => r[xi] !== null && r[xi] !== undefined).length : 0
      const timeLike = xi >= 0 && (result.columns[xi].kind === 'time' || ['line', 'area'].includes(result.chart?.type))
      if (aggregate && timeLike && points >= 2) buttons.push({ text: '为什么变化', value: { a: 'why', t: token } })
      if (xi >= 0 && points >= 1 && role !== 'viewer') buttons.push({ text: '明细', value: { a: 'detail', t: token } })
      if (role === 'admin' || role === 'analyst') buttons.push({ text: '固定到看板', value: { a: 'pin', t: token } })
      if (!select && !buttons.length) return undefined
      return { ...(select ? { select } : {}), buttons }
    } catch (error) {
      console.warn('nl2sql lark: cannot build card actions: %s', error.message)
      return undefined
    }
  },

  /** Results with their button specs attached (for buildCard). */
  async withLarkCardActions(results, ctx) {
    const out = []
    for (const r of results) {
      const cardActions = await this.larkCardActions(r, ctx)
      out.push(cardActions ? { ...r, cardActions } : r)
    }
    return out
  },

  /** Reply with a card, falling back to no charts, then no buttons, then text. */
  async replyLarkCard(creds, messageId, message) {
    const attempts = [{}, { charts: false }, { charts: false, actions: false }]
    let lastError
    for (const opts of attempts) {
      try { return await replyMessage({ ...creds, messageId, card: buildCard(message, opts) }) } catch (error) { lastError = error }
    }
    try { return await replyText({ ...creds, messageId, text: String(message.text ?? '').slice(0, 3000) || `回复失败：${lastError?.message}` }) } catch {}
    return undefined
  },

  // ------------------------------------------------------------- clicks

  /**
   * card.action.trigger (normalized by lark-bot.js). Authorizes synchronously
   * and returns a toast within Feishu's 3 s window; the analysis runs in the
   * background and replies in the chat with a new card.
   */
  async handleLarkCardAction(evt) {
    const creds = this.larkCreds
    if (!creds || !evt?.operator?.openId) return undefined
    const a = evt.value?.a
    const ctx = this.lookupLarkActionToken(evt.value?.t)
    const deny = (msg, detail) => { this.auditAdmin('larkbot.action.denied', `${evt.operator.openId} · ${a ?? '?'} · ${detail ?? msg}`); return toast('error', msg) }
    // Per-operator rate limit.
    this.larkActionRate ??= new Map()
    const now = Date.now()
    const last = this.larkActionRate.get(evt.operator.openId) ?? 0
    if (now - last < ACTION_RATE_MS) return toast('warning', '操作太频繁，请稍后再试。')
    this.larkActionRate.set(evt.operator.openId, now)
    if (this.larkActionRate.size > 2000) for (const [k, t] of this.larkActionRate) if (now - t > ACTION_RATE_MS) this.larkActionRate.delete(k)

    if (!ACTIONS.has(a) || !ctx) return deny('该按钮已过期或无效，请重新提问。', 'unknown/expired token')
    if (ctx.chatId && evt.chatId && ctx.chatId !== evt.chatId) return deny('该按钮不属于当前聊天。', 'chat mismatch')
    // Who clicked: resolved from our member list, never from the callback value.
    let user = {}
    let timer
    try { user = await Promise.race([getUserInfo({ ...creds, openId: evt.operator.openId }), new Promise(r => { timer = setTimeout(() => r({}), 1200) })]) } catch {} finally { clearTimeout(timer) }
    const chatId = ctx.chatId ?? evt.chatId
    const resolved = this.resolveLarkActor({ openId: evt.operator.openId, email: user.email, name: user.name ?? evt.operator.name, chatId, chatType: ctx.chatType ?? 'group' })
    if (resolved.refused) return deny(resolved.refused, 'actor refused')
    const actor = { ...resolved.actor, kind: 'lark' }
    const r = this.lookupResult(ctx.resultId)
    if (!r) return deny('结果已过期，请重新提问。', 'result expired')
    try { this.assertResultAccess(r, actor) } catch (error) { return deny(toUserError(error).message, `${actor.name}: ${error.message}`) }
    if (actor.role === 'viewer') {
      // Viewers may only act on governed results (produced under viewer rules, or a verified example / dashboard SQL).
      const ds = this.findDatasource(r.datasourceId)
      const governed = ctx.ownerRole === 'viewer' || (ds && this.isVerifiedExample(ds, r.baseSql ?? r.sql))
      if (!governed || a === 'detail' || a === 'pin') return deny(a === 'pin' ? '只读成员不能固定到看板。' : a === 'detail' ? '只读成员不能查看明细数据。' : '只读成员只能分析指标库或已验证问答的结果。', `${actor.name}: viewer`)
    }
    if (a === 'pin' && actor.role !== 'admin' && actor.role !== 'analyst') return deny('只有管理员或分析师可以固定到看板。', `${actor.name}: role ${actor.role}`)
    let dimension
    if (a === 'drill') {
      dimension = typeof evt.option === 'string' ? evt.option : undefined
      let allowed = []
      try { allowed = (await this.drillDimensions(r.resultId)).dimensions.map(d => d.column) } catch {}
      if (!dimension || !allowed.includes(dimension)) return deny('请选择一个有效的拆分维度。', `invalid dimension ${String(dimension).slice(0, 40)}`)
    }

    if (a === 'pin') {
      try {
        const widget = await this.pinWidget({ title: r.title || '飞书结果', sql: r.baseSql ?? r.sql, datasourceId: r.datasourceId, chart: r.chart })
        const board = this.currentDashboardObj()
        this.auditAdmin('larkbot.pin', `${actor.name} · ${widget.title} → ${board.name}`, actor)
        this.recordDelivery({ channel: { id: 'larkbot', name: `飞书机器人 · ${actor.name}` }, title: `固定：${widget.title}`.slice(0, 60), status: 'ok', results: 0, source: 'larkbot', sessionId: ctx.sessionId, elapsedMs: Date.now() - now })
        await this.save()
        return toast('success', `已固定到看板「${board.name}」`)
      } catch (error) {
        return toast('error', `固定失败：${toUserError(error).message}`.slice(0, 200))
      }
    }

    const job = this.runLarkCardAction({ a, ctx, r, actor, dimension, evt, creds })
    this.larkActionJobs ??= new Set()
    this.larkActionJobs.add(job)
    job.finally(() => this.larkActionJobs.delete(job)).catch(() => {})
    return toast('info', '正在分析…')
  },

  async runLarkCardAction({ a, ctx, r, actor, dimension, evt, creds }) {
    const started = Date.now()
    const replyTo = ctx.replyTo ?? evt.messageId
    const label = a === 'drill' ? `拆分：${dimension}` : a === 'why' ? '为什么变化' : `明细：${r.chart?.x ?? ''}`
    const footer = `数据问答 · ${r.datasourceName ?? ''} · ${actor.name}`
    let status = 'ok'
    let error
    let resultsCount = 0
    try {
      let message
      if (a === 'drill' || a === 'detail') {
        let xValue
        if (a === 'detail') {
          const xi = r.columns.findIndex(c => c.name === r.chart?.x)
          xValue = r.rows.map(row => row[xi]).filter(v => v !== null && v !== undefined).at(-1)
        }
        const out = await this.drill({ resultId: r.resultId, mode: a === 'drill' ? 'breakdown' : 'detail', dimension, xValue, sessionId: ctx.sessionId ?? undefined, actor, source: 'larkbot' })
        const results = await this.withLarkCardActions([out], { actor, sessionId: ctx.sessionId, chatId: ctx.chatId ?? evt.chatId, chatType: ctx.chatType, replyTo, depth: (ctx.depth ?? 0) + 1 })
        resultsCount = 1
        message = { title: out.title || label, text: a === 'detail' ? `「${r.title || '结果'}」在 ${r.chart?.x}=${xValue} 的明细（最多 200 行）。` : `「${r.title || '结果'}」按 ${dimension} 拆分。`, results, footer }
      } else {
        const out = await this.explainChange({ resultId: r.resultId, sessionId: ctx.sessionId ?? undefined, actor })
        const top = out.dimensions.find(d => d.attribution)
        const rows = (top?.attribution.items ?? []).slice(0, 8)
        const table = rows.length ? `\n\n| ${top.dimension} | ${out.baseline} | ${out.current} | 变化 |\n|---|---|---|---|\n${rows.map(i => `| ${i.value ?? 'NULL'} | ${i.baseline} | ${i.current} | ${i.delta >= 0 ? '+' : ''}${i.delta} |`).join('\n')}` : ''
        message = { title: `为什么变化 · ${r.title || ''}`.slice(0, 80), text: `${out.summary}${table}`, results: [], footer }
      }
      await this.replyLarkCard(creds, replyTo, message)
    } catch (e) {
      status = 'error'
      error = toUserError(e).message
      try { await replyText({ ...creds, messageId: replyTo, text: `${label} 失败：${error}`.slice(0, 1000) }) } catch {}
    }
    this.auditAdmin('larkbot.action', `${actor.name} · ${label} · ${r.resultId}${error ? ` · ${error}` : ''}`, actor)
    this.recordDelivery({ channel: { id: 'larkbot', name: `飞书机器人 · ${actor.name}` }, title: label.slice(0, 60), status, ...(error ? { error } : {}), results: resultsCount, source: 'larkbot', sessionId: ctx.sessionId, elapsedMs: Date.now() - started })
    await this.save()
  },
}
