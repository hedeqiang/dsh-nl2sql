// Chat subscriptions and chat-created alerts (service/subscriptions.js) with a fake IM adapter:
// a bot conversation bound to a session, the agent tools called via app.tools, the scheduler job
// run with a controlled `now`, delivery to the original chat id (not the channel's configured one).
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const { registerAdapter, unregisterAdapter } = await plugin('channels/index.js')
const { chatTargetPatch, lastSubscriptionSlot } = await plugin('service/subscriptions.js')

const fake = { sent: [], bots: [] }
const kind = (id, extra = {}) => ({
  id,
  label: { zh: '订阅假 IM', en: 'Fake' },
  description: { zh: '测试', en: 'test' },
  fields: [
    { key: 'chatId', label: { zh: '群', en: 'Chat' }, type: 'text', required: true, target: true },
    { key: 'token', label: { zh: '令牌', en: 'Token' }, type: 'secret', secret: true, required: true },
  ],
  capabilities: { push: true, markdown: 'basic', charts: 'image', tables: 'markdown', tableRows: 5, files: true, buttons: false, bot: true, listTargets: false, mentionAll: false },
  setupSteps: { zh: ['一'], en: ['one'] },
  validate: (input) => ({ config: { chatId: String(input.config?.chatId ?? '') }, secrets: { token: input.secrets?.token } }),
  async send(channel, secrets, message) { fake.sent.push({ chatId: channel.chatId, cfgChatId: channel.config?.chatId, token: secrets.token, message }); return { messageId: `m${fake.sent.length}`, images: 0, files: message.attachment ? 1 : 0 } },
  ...extra,
})
registerAdapter({
  id: 'fakesub',
  name: { zh: '订阅假 IM', en: 'Fake' },
  kinds: [kind('fakesub_bot'), { ...kind('fakesub_hook'), fields: [{ key: 'token', label: { zh: 't', en: 't' }, type: 'secret', secret: true, required: true }] }],
  createBot(channel, secrets, handlers) {
    const bot = {
      replies: [],
      start: async () => {}, stop: async () => {}, status: () => ({ state: 'connected' }), info: () => null,
      async receive({ id, text, userId, chatId = 'grp-1', chatType = 'group' }) {
        await handlers.onMessage({ platform: 'fakesub', channelId: channel.id, messageId: id, chatId, chatType, chatName: '运营群', text, mentionedBot: true, sender: { id: userId, name: `n-${userId}` },
          reply: async (m) => { bot.replies.push(m); return {} }, replyText: async (t) => { bot.replies.push({ text: t }) } })
      },
    }
    fake.bots.push(bot)
    return bot
  },
})

// Fake sessions: every turn runs one nl2sql_query as the session.
let toolsRef
const SQL = 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d'
const sessions = (() => {
  const map = new Map(); let n = 0
  return {
    agents: { get: (id) => map.get(id) },
    controller: {
      async create() { const id = `sub-sess-${++n}`; const events = []; map.set(id, { turn: 0, session: { snapshotEvents: () => events } }); return { sessionId: id } },
      async rename() {},
      async prompt(req) { const s = map.get(req.sessionId); s.queue = [...(s.queue ?? []), req] },
      async wait({ sessionId }) {
        const s = map.get(sessionId); const ev = s.session.snapshotEvents()
        for (const req of s.queue.splice(0)) {
          const turn = ++s.turn
          ev.push({ type: 'user/message', data: { source: { rpcId: req.requestId } } }, { type: 'turn/start', data: { turn } })
          let meta
          try { meta = (await toolsRef.get('nl2sql_query').execute({ sql: SQL, title: '每日笔数', chart: { type: 'line', x: 'd', y: ['n'] } }, { agent: { id: sessionId } })).display } catch (e) { meta = null }
          if (meta) ev.push({ type: 'tool/result', data: { turn, meta } })
          ev.push({ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: 'ok' }] } } }, { type: 'turn/end', data: { turn } })
        }
        return { reason: 'idle' }
      },
      cancel() {},
    },
  }
})()

const app = await boot({ label: 'subs', services: { agents: sessions.agents, sessionController: sessions.controller } })
toolsRef = app.tools
const { call, service } = app
const exec = (sid) => ({ agent: { id: sid } })
const convOf = (userRole) => Object.values(service.state.botConversations).filter(c => c.chatId === 'grp-1').find(c => service.state.sessionActors[c.sessionId]?.role === userRole)
const tomorrowAt = (h, m) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return d }
let ch, ds, bot, analystSid, viewerSid, subId, metricSubId

try {
  await test('unit: per-kind chat target patches and schedule slots', async () => {
    assert.deepEqual(chatTargetPatch({ id: 'lark_app' }, 'oc_1'), { receiveIdType: 'chat_id', receiveId: 'oc_1' })
    assert.deepEqual(chatTargetPatch({ id: 'telegram_bot' }, -100), { chatId: '-100' })
    assert.deepEqual(chatTargetPatch({ id: 'dingtalk_app' }, 'cid1'), { openConversationId: 'cid1', userId: '' })
    assert.deepEqual(chatTargetPatch({ id: 'wecom_aibot' }, 'wc1'), { chatId: 'wc1', chatType: 'group' })
    assert.equal(chatTargetPatch({ id: 'lark_webhook' }, 'x'), undefined)
    const now = new Date(2026, 10, 12, 10, 0) // Thu
    assert.equal(lastSubscriptionSlot({ period: 'daily', time: '09:00' }, now), new Date(2026, 10, 12, 9, 0).getTime())
    assert.equal(lastSubscriptionSlot({ period: 'daily', time: '11:00' }, now), new Date(2026, 10, 11, 11, 0).getTime())
    assert.equal(lastSubscriptionSlot({ period: 'weekly', weekdays: [1], time: '09:00' }, now), new Date(2026, 10, 9, 9, 0).getTime())
    assert.equal(lastSubscriptionSlot({ period: 'monthly', monthDay: 31, time: '09:00' }, now), new Date(2026, 9, 31, 9, 0).getTime())
  })

  await test('setup: data source, members, bot conversation bound to sessions', async () => {
    ds = await call('saveDatasource', { name: 'SubDS', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '交易笔数', expression: 'COUNT(*)', table: 'blockchain_transactions', timeColumn: 'created_at' } })
    ch = await call('saveChannel', { name: 'SubBot', type: 'fakesub_bot', config: { chatId: 'configured-chat' }, secrets: { token: 'tk' } })
    await call('saveUser', { kind: 'person', name: '分析师甲', identities: [{ platform: 'fakesub', id: 'u1' }], role: 'analyst', datasourceIds: [ds.id] })
    await call('saveUser', { kind: 'person', name: '只读乙', identities: [{ platform: 'fakesub', id: 'u2' }], role: 'viewer', datasourceIds: [ds.id] })
    await call('saveBot', { channelId: ch.id, enabled: true })
    bot = fake.bots.at(-1)
    await bot.receive({ id: 'q1', text: '每天的交易笔数', userId: 'u1' })
    await bot.receive({ id: 'q2', text: '我的订阅', userId: 'u2' })
    analystSid = convOf('analyst')?.sessionId
    viewerSid = convOf('viewer')?.sessionId
    assert.ok(analystSid && viewerSid && analystSid !== viewerSid, JSON.stringify(service.state.botConversations))
  })

  await test('non-bot sessions are refused with a clear message', async () => {
    await assert.rejects(app.tool('nl2sql_subscribe', { metric: '交易笔数', time: '09:00', period: 'daily' }, exec('page-session')), /只能在 IM 机器人的聊天中创建/)
    await assert.rejects(app.tool('nl2sql_subscriptions', { action: 'list' }, exec('page-session')), /只能在 IM 机器人的聊天中/)
  })

  await test('nl2sql_subscribe from a previous resultId → stored with chat + creator', async () => {
    const rid = service.records.list('history', { limit: 50 }).find(h => h.sessionId === analystSid && h.resultId)?.resultId
    assert.ok(rid)
    // a result of another session cannot be subscribed
    const other = service.records.list('history', { limit: 50 }).find(h => h.sessionId === viewerSid && h.resultId)?.resultId
    if (other) await assert.rejects(app.tool('nl2sql_subscribe', { resultId: other, time: '09:00', period: 'daily' }, exec(analystSid)), /本聊天/)
    const out = await app.tool('nl2sql_subscribe', { resultId: rid, title: '日报', time: '09:00', period: 'daily' }, exec(analystSid))
    subId = out.created.id
    const s = service.state.chatSubscriptions.find(x => x.id === subId)
    assert.equal(s.chatId, 'grp-1'); assert.equal(s.channelId, ch.id); assert.equal(s.sql, SQL)
    assert.deepEqual(s.createdBy, { platform: 'fakesub', userId: 'u1', name: '分析师甲', memberId: (await call('listUsers')).find(u => u.name === '分析师甲').id, email: undefined })
    const m = await app.tool('nl2sql_subscribe', { metric: '交易笔数', grain: 'day', range: 'last7d', time: '08:30', period: 'weekly', weekdays: [1, 5] }, exec(analystSid))
    metricSubId = m.created.id
    assert.match(m.created.schedule, /每周一、五 08:30/)
  })

  await test('viewer: may list, may not create or cancel', async () => {
    await assert.rejects(app.tool('nl2sql_subscribe', { metric: '交易笔数', time: '09:00', period: 'daily' }, exec(viewerSid)), /只有管理员或分析师/)
    await assert.rejects(app.tool('nl2sql_alert_create', { metric: '交易笔数', condition: { type: 'threshold', op: '>', value: 1 } }, exec(viewerSid)), /只有管理员或分析师/)
    const list = await app.tool('nl2sql_subscriptions', { action: 'list' }, exec(viewerSid))
    assert.equal(list.items.length, 2)
    await assert.rejects(app.tool('nl2sql_subscriptions', { action: 'cancel', id: subId }, exec(viewerSid)), /只读成员/)
  })

  await test('scheduler job with controlled now delivers to the original chat id', async () => {
    const now = tomorrowAt(9, 5)
    const jobs = service.jobs_subscriptions(now)
    const job = jobs.find(j => j.id === `sub:${subId}`)
    assert.ok(job.due(now))
    assert.equal(job.due(tomorrowAt(8, 0)), false, 'tomorrow 8:00 is before the next slot')
    fake.sent.length = 0
    await job.run()
    assert.equal(fake.sent.length, 1)
    assert.equal(fake.sent[0].chatId, 'grp-1', 'not the channel\'s configured chat')
    assert.equal(fake.sent[0].cfgChatId, 'grp-1')
    assert.match(fake.sent[0].message.title, /日报/)
    assert.equal(fake.sent[0].message.results[0].columns.length, 2)
    if (fake.sent[0].message.results[0].rowCount > 5) assert.ok(fake.sent[0].message.attachment, 'Excel attached where files are supported')
    const s = service.state.chatSubscriptions.find(x => x.id === subId)
    assert.ok(s.lastDeliveredAt)
    assert.equal(service.jobs_subscriptions(now).find(j => j.id === `sub:${subId}`).due(now), false, 'one delivery per slot')
    const h = service.records.list('history', { limit: 5 }).find(x => x.source === 'subscription')
    assert.equal(h.actor.name, '分析师甲', 'ran as the creator')
    // via the real scheduler tick too (the metric subscription is not due at 9:05 unless Mon/Fri 08:30 passed)
    await service.tickAlerts(tomorrowAt(9, 6))
    assert.ok(service.state.scheduler.lastTickAt)
  })

  await test('chat alert via saveAlert delivers to the chat and @-mentions the asker', async () => {
    const rid = service.records.list('history', { limit: 50 }).find(h => h.sessionId === analystSid && h.resultId)?.resultId
    const out = await app.tool('nl2sql_alert_create', { resultId: rid, name: '笔数告警', condition: { type: 'threshold', op: '>', value: 0 }, every: 'hour', mentionMe: true }, exec(analystSid))
    const a = service.state.alerts.find(x => x.id === out.created.id)
    assert.equal(a.channelId, null)
    assert.deepEqual({ channelId: a.chatTarget.channelId, chatId: a.chatTarget.chatId }, { channelId: ch.id, chatId: 'grp-1' })
    fake.sent.length = 0
    const r = await service.checkAlert(a.id)
    assert.equal(r.triggered, true)
    assert.equal(r.pushed, true)
    assert.equal(fake.sent[0].chatId, 'grp-1')
    assert.match(fake.sent[0].message.text, /<at id=u1>分析师甲<\/at>/)
    const groups = await call('listChatSubscriptions')
    const g = groups.find(x => x.chatId === 'grp-1')
    assert.equal(g.items.length, 3)
    assert.ok(g.items.some(i => i.kind === 'alert' && i.status === 'active'))
  })

  await test('pause / resume / cancel from chat and page', async () => {
    const p = await app.tool('nl2sql_subscriptions', { action: 'pause', id: metricSubId }, exec(analystSid))
    assert.equal(p.status, 'paused')
    assert.equal(service.jobs_subscriptions(new Date()).some(j => j.id === `sub:${metricSubId}`), false)
    const r = await call('setChatSubscription', { id: metricSubId, action: 'resume' })
    assert.equal(r.status, 'active')
    await app.tool('nl2sql_subscriptions', { action: 'cancel', id: metricSubId }, exec(analystSid))
    assert.equal(service.state.chatSubscriptions.some(s => s.id === metricSubId), false)
  })

  await test('removed member: subscription and alert skipped, marked, chat told once', async () => {
    const u1 = (await call('listUsers')).find(u => u.name === '分析师甲')
    await call('deleteUser', { id: u1.id })
    fake.sent.length = 0
    const now = tomorrowAt(9, 10)
    const s0 = service.state.chatSubscriptions.find(x => x.id === subId)
    s0.lastSlot = 0
    const job = service.jobs_subscriptions(now).find(j => j.id === `sub:${subId}`)
    const res = await job.run()
    assert.equal(res.skipped, true)
    const s = service.state.chatSubscriptions.find(x => x.id === subId)
    assert.equal(s.status, 'suspended')
    assert.match(s.lastError, /分析师甲|开通/)
    assert.equal(fake.sent.length, 1, 'one notice')
    assert.equal(fake.sent[0].chatId, 'grp-1')
    assert.match(fake.sent[0].message.text, /已暂停/)
    assert.equal(service.jobs_subscriptions(now).some(j => j.id === `sub:${subId}`), false, 'suspended items no longer run')
    // the alert: suspended at the next check, no query run as a stranger
    const a = service.state.alerts.find(x => x.chatTarget)
    await assert.rejects(service.checkAlert(a.id), /分析师甲|开通/)
    const a2 = service.state.alerts.find(x => x.id === a.id)
    assert.equal(a2.enabled, false); assert.equal(a2.chatStatus, 'suspended')
    assert.equal(fake.sent.length, 2)
    await assert.rejects(service.checkAlert(a.id))
    assert.equal(fake.sent.length, 2, 'told only once')
    const g = (await call('listChatSubscriptions')).find(x => x.chatId === 'grp-1')
    assert.ok(g.items.every(i => i.status === 'suspended'), JSON.stringify(g.items.map(i => i.status)))
  })

  await test('kinds without a per-chat target refuse delivery', async () => {
    const hook = await call('saveChannel', { name: 'Hook', type: 'fakesub_hook', config: {}, secrets: { token: 'x' } })
    // the default branch (target field) is absent → refused
    assert.throws(() => service.chatDeliveryTarget(hook.id, 'grp-1'), /不能按聊天主动推送/)
  })
} finally {
  unregisterAdapter?.('fakesub')
  await app.close()
}
summary()
