// A fake IM adapter registered through registerAdapter: a channel of its kind can be saved,
// listed, tested and pushed to; its bot receives messages and replies through the generic
// bot pipeline (actor resolution, conversation, agent turn on MySQL, actions + re-authorization).
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin, sleep } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const { registerAdapter, unregisterAdapter } = await plugin('channels/index.js')
const { ChannelError } = await plugin('channels/http.js')
const { toPlainMarkdown } = await plugin('channels/message.js')

// ------------------------------------------------------------ fake adapter
const fake = { sent: [], bots: [], tests: 0, targets: 0 }
function makeKind(id, { buttons }) {
  return {
    id,
    label: { zh: '假 IM', en: 'Fake IM' },
    description: { zh: '测试用', en: 'for tests' },
    fields: [
      { key: 'chatId', label: { zh: '群 ID', en: 'Chat id' }, type: 'text', required: true, target: true },
      { key: 'token', label: { zh: '令牌', en: 'Token' }, type: 'secret', secret: true, required: true },
    ],
    capabilities: { push: true, markdown: 'basic', charts: 'image', tables: 'markdown', buttons, bot: true, listTargets: true, mentionAll: false },
    setupSteps: { zh: ['一'], en: ['one'] },
    validate(input) {
      const chatId = String(input.config?.chatId ?? '').trim()
      if (!chatId) throw new ChannelError('channel/config', '请填写群 ID', { field: 'chatId' })
      if (!input.secrets?.token) throw new ChannelError('channel/config', '请填写令牌', { field: 'token' })
      if (input.secrets.token === 'bad') throw new ChannelError('channel/auth', '令牌无效', { field: 'token' })
      return { config: { chatId }, secrets: { token: input.secrets.token } }
    },
    async send(channel, secrets, message, ctx) {
      assert.equal(typeof ctx.renderChartPng, 'function')
      if (secrets.token === 'fail') throw new ChannelError('channel/rejected', '平台拒绝')
      fake.sent.push({ chatId: channel.chatId, token: secrets.token, message })
      return { messageId: `m${fake.sent.length}`, images: 0 }
    },
    async test(channel, secrets) { fake.tests++; return { ok: secrets.token !== 'nope', detail: `token ok for ${channel.chatId}` } },
    async listTargets(channel, secrets) { fake.targets++; return [{ id: 'g1', name: `群 ${secrets.token}`, type: 'group' }] },
  }
}
registerAdapter({
  id: 'fakeim',
  name: { zh: '假 IM', en: 'Fake IM' },
  kinds: [makeKind('fakeim_bot', { buttons: true }), makeKind('fakeim_plain', { buttons: false })],
  createBot(channel, secrets, handlers) {
    let state = 'idle'
    const bot = {
      channel, secrets, handlers, replies: [],
      start: async () => { state = 'connected' },
      stop: async () => { state = 'stopped' },
      status: () => ({ state, since: 1 }),
      info: () => ({ id: 'bot1', name: 'FakeBot' }),
      /** Simulate an inbound message. */
      async receive({ id, text, userId, chatId = 'g1', chatType = 'group', mentionedBot = true }) {
        // onMessage resolves once the reply has been sent (the bot pipeline awaits the turn).
        await handlers.onMessage({
          platform: 'fakeim', channelId: channel.id, messageId: id, chatId, chatType, text, mentionedBot, sender: { id: userId, name: `n-${userId}` },
          reply: async (message, opts) => { bot.replies.push({ kind: 'card', to: opts?.replyTo ?? id, message }); return { messageId: `r${bot.replies.length}` } },
          replyText: async (t) => { bot.replies.push({ kind: 'text', to: id, text: t }) },
          react: async (k) => { bot.replies.push({ kind: 'react', to: id, react: k }) },
        })
      },
      async click({ userId, value, option, chatId = 'g1', messageId = 'card1' }) {
        return handlers.onAction({ platform: 'fakeim', channelId: channel.id, operator: { id: userId }, chatId, messageId, value, option,
          reply: async (message, opts) => { bot.replies.push({ kind: 'card', to: opts?.replyTo ?? messageId, message }); return {} },
          replyText: async (t, opts) => { bot.replies.push({ kind: 'text', to: opts?.replyTo ?? messageId, text: t }) } })
      },
    }
    fake.bots.push(bot)
    return bot
  },
})

// ------------------------------------------------------------ fake sessions (service-security pattern)
function fakeSessions(answer) {
  const sessions = new Map()
  let n = 0
  const agents = { get: (id) => sessions.get(id) }
  const controller = {
    async create() { const id = `sess-${++n}`; const events = []; sessions.set(id, { id, turn: 0, session: { snapshotEvents: () => events } }); return { sessionId: id } },
    async rename() {},
    async prompt(req) { const s = sessions.get(req.sessionId); s.queue = [...(s.queue ?? []), req] },
    async wait({ sessionId }) {
      const s = sessions.get(sessionId)
      const ev = s.session.snapshotEvents()
      for (const req of s.queue.splice(0)) {
        const turn = ++s.turn
        ev.push({ type: 'user/message', data: { source: { kind: 'user', rpcId: req.requestId }, content: req.content } }, { type: 'turn/start', data: { turn } })
        const out = await answer(req.content[0].text, sessionId)
        for (const meta of out.metas ?? []) ev.push({ type: 'tool/result', data: { turn, meta } })
        ev.push({ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: out.text }] } } }, { type: 'turn/end', data: { turn } })
      }
      return { reason: 'idle' }
    },
    cancel() {},
  }
  return { agents, controller }
}
let toolsRef
const prompts = []
const sessions = fakeSessions(async (text, sid) => {
  prompts.push(text)
  const m = /Q:(.+?)(?:\n|$)/.exec(text)
  const out = await toolsRef.get('nl2sql_query').execute({ sql: m ? m[1] : 'select 1 as x', title: '每日笔数', chart: { type: 'line', x: 'd', y: ['n'] } }, { agent: { id: sid } })
  return { text: `共 ${out.display.rowCount} 天 <font color='green'>↑</font>`, metas: [out.display] }
})

const app = await boot({ label: 'ch-fake', services: { agents: sessions.agents, sessionController: sessions.controller } })
toolsRef = app.tools
const { call, service } = app
const SQL = 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d'
let ch, plainCh, ds, bot

try {
  await test('catalog lists the fake platform with its kinds', async () => {
    const cat = await call('channelCatalog')
    const p = cat.find(x => x.platform === 'fakeim')
    assert.ok(p)
    assert.deepEqual(p.kinds.map(k => k.id), ['fakeim_bot', 'fakeim_plain'])
    assert.equal(p.kinds[0].fields.find(f => f.key === 'token').secret, true)
  })

  await test('save: validation errors carry the field; secrets stored in nl2sql/ch-<id>', async () => {
    await assert.rejects(call('saveChannel', { name: 'F', type: 'fakeim_bot', config: {}, secrets: { token: 't' } }), (e) => e.field === 'chatId')
    await assert.rejects(call('saveChannel', { name: 'F', type: 'fakeim_bot', config: { chatId: 'g1' }, secrets: { token: 'bad' } }), (e) => e.field === 'token' && /令牌无效/.test(e.message))
    ch = await call('saveChannel', { name: 'F', type: 'fakeim_bot', config: { chatId: 'g1' }, secrets: { token: 'tok' }, chartMode: 'native' })
    assert.equal(ch.platform, 'fakeim')
    assert.equal(ch.chartMode, 'image', 'native not supported → kind default')
    assert.deepEqual(ch.config, { chatId: 'g1' })
    assert.deepEqual(ch.secretsSet, { token: true })
    assert.equal(ch.hasSecret, true)
    assert.equal(ch.capabilities.bot, true)
    assert.equal(ch.bot.enabled, false)
    assert.deepEqual(app.creds.get(`nl2sql/ch-${ch.id.replace(/^ch-/, '')}`).payload, { token: 'tok' })
    // Editing without secrets keeps them.
    const again = await call('saveChannel', { id: ch.id, description: 'x' })
    assert.equal(again.description, 'x')
    assert.equal(app.creds.get(`nl2sql/${ch.id}`).payload.token, 'tok')
    plainCh = await call('saveChannel', { name: 'P', type: 'fakeim_plain', config: { chatId: 'g2' }, secrets: { token: 'p' } })
  })

  await test('list, targets (saved and unsaved), test', async () => {
    const list = await call('listChannels')
    assert.ok(list.some(c => c.id === ch.id && c.type === 'fakeim_bot'))
    assert.ok(!JSON.stringify(list).includes('"tok"'))
    assert.deepEqual(await call('listChannelTargets', { id: ch.id }), [{ id: 'g1', name: '群 tok', type: 'group' }])
    assert.deepEqual(await call('listChannelTargets', { type: 'fakeim_bot', config: { chatId: 'x' }, secrets: { token: 'unsaved' } }), [{ id: 'g1', name: '群 unsaved', type: 'group' }])
    await assert.rejects(call('listChannelTargets', { type: 'fakeim_bot', config: {} }), (e) => e.field === 'token')
    const t = await call('testChannel', { id: ch.id })
    assert.equal(t.ok, true)
    assert.match(t.detail, /token ok for g1/)
    assert.equal(fake.tests, 1)
    assert.equal(fake.sent.at(-1).message.title, '数据问答 · 推送测试', 'test message sent after the check')
  })

  await test('push: results, chart mode and <at id=all> reach the adapter; errors logged', async () => {
    ds = await call('saveDatasource', { name: 'A', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    const r = await call('runQuery', { datasourceId: ds.id, sql: SQL, title: '每日', chart: { type: 'line', x: 'd', y: ['n'] } })
    const sent = await call('sendToChannel', { channelId: ch.id, title: '日报', text: "<at id=all></at> **好**", resultIds: [r.resultId], chartMode: 'table' })
    assert.equal(sent.ok, true)
    assert.equal(sent.platform, 'fakeim')
    const msg = fake.sent.at(-1).message
    assert.equal(msg.chartMode, 'table')
    assert.equal(msg.mentionAll, true)
    assert.equal(msg.results[0].title, '每日')
    assert.equal(toPlainMarkdown(msg.text), '@所有人 **好**')
    const agentSent = await app.tool('nl2sql_send', { channel: 'F', title: 'a', text: 'b' })
    assert.equal(agentSent.ok, true)
    const listed = await app.tool('nl2sql_send', { action: 'list' })
    assert.equal(listed.channels.find(c => c.name === 'F').platform, 'fakeim')
    // A platform rejection becomes a user error and is logged.
    await call('saveChannel', { id: plainCh.id, secrets: { token: 'fail' } })
    await assert.rejects(call('sendToChannel', { channelId: plainCh.id, title: 't', text: 'x' }), (e) => e.code === 'channel/rejected')
    const dl = await call('listDeliveries', { limit: 5 })
    assert.equal(dl[0].status, 'error')
    assert.equal(dl[0].platform, 'fakeim')
    assert.ok(dl.some(d => d.status === 'ok' && d.title === '日报'))
  })

  await test('bot: saveBot starts it; group @ message → agent turn on MySQL → reply with actions', async () => {
    await call('saveUser', { kind: 'chat', name: '假群', identities: [{ platform: 'fakeim', id: 'g1' }], role: 'analyst', datasourceIds: [ds.id] })
    await call('saveUser', { kind: 'person', name: '甲', identities: [{ platform: 'fakeim', id: 'u1' }], role: 'analyst', datasourceIds: [ds.id] })
    await call('saveUser', { kind: 'person', name: '读', identities: [{ platform: 'fakeim', id: 'u9' }], role: 'viewer', datasourceIds: [ds.id] })
    const st = await call('saveBot', { channelId: ch.id, enabled: true })
    assert.equal(st.status.state, 'connected')
    assert.deepEqual(st.info, { id: 'bot1', name: 'FakeBot' })
    bot = fake.bots.at(-1)
    assert.equal(bot.channel.chatId, 'g1', 'config spread on the channel')
    assert.equal(bot.secrets.token, 'tok')
    await bot.receive({ id: 'q1', text: `Q:${SQL}`, userId: 'u1' })
    const card = bot.replies.find(r => r.kind === 'card' && r.to === 'q1')
    assert.ok(card, JSON.stringify(bot.replies))
    assert.match(card.message.text, /共 \d+ 天/)
    assert.equal(card.message.results.length, 1)
    const actions = card.message.results[0].actions
    assert.ok(actions?.buttons?.some(b => b.text === '为什么变化'), JSON.stringify(actions))
    for (const b of actions.buttons) assert.deepEqual(Object.keys(b.value).sort(), ['a', 't'])
    assert.ok(bot.replies.some(r => r.react === 'working') && bot.replies.some(r => r.react === 'done'))
    assert.match(prompts.at(-1), /^\[fakeim群「g1」 · 甲\] Q:/, prompts.at(-1).slice(0, 40))
    const conv = Object.values(service.state.botConversations).find(c => c.channelId === ch.id)
    assert.ok(conv.key.startsWith(`${ch.id}:g1#`))
    assert.equal(conv.platform, 'fakeim')
    const status = (await call('botStatus')).find(b => b.channelId === ch.id)
    assert.equal(status.conversations.length, 1)
    const hist = await call('listDeliveries', { limit: 3 })
    assert.ok(hist.some(d => d.source === 'fakeimbot' && d.status === 'ok'))
  })

  await test('bot: unknown users refused; group not @-mentioned ignored; commands answered', async () => {
    const n = bot.replies.length
    await bot.receive({ id: 'q2', text: 'hello', userId: 'u1', mentionedBot: false })
    assert.equal(bot.replies.length, n, 'ignored')
    await bot.receive({ id: 'q3', text: '帮助', userId: 'stranger', chatType: 'p2p', chatId: 'dm1' })
    assert.match(bot.replies.at(-1).text, /没有开通数据问答权限/)
    await bot.receive({ id: 'q4', text: '数据源', userId: 'u1' })
    assert.match(bot.replies.at(-1).text, /可用数据源：A/)
  })

  await test('actions: re-authorized per click (rate limit, viewer, wrong chat, wrong channel); breakdown replies', async () => {
    const card = bot.replies.find(r => r.kind === 'card' && r.to === 'q1')
    const { select, buttons } = card.message.results[0].actions
    const why = buttons.find(b => b.text === '为什么变化').value
    const ok = await bot.click({ userId: 'u1', value: select.value, option: select.options.find(o => o.value === 'chain_type')?.value ?? select.options[0].value })
    assert.equal(ok.toast.type, 'info')
    const fast = await bot.click({ userId: 'u1', value: why })
    assert.equal(fast.toast.type, 'warning')
    const t0 = Date.now()
    while (!bot.replies.some(r => r.kind === 'card' && /拆分/.test(r.message.text ?? ''))) { if (Date.now() - t0 > 10000) throw new Error('no drill reply'); await sleep(20) }
    const viewer = await bot.click({ userId: 'u9', value: why })
    assert.equal(viewer.toast.type, 'error')
    await sleep(2100)
    const elsewhere = await bot.click({ userId: 'u1', value: why, chatId: 'other' })
    assert.equal(elsewhere.toast.type, 'error', JSON.stringify(elsewhere))
    assert.match(elsewhere.toast.content, /不属于当前聊天/)
    // A token from this channel is refused on another bot.
    const r2 = await service.handleBotAction({ platform: 'fakeim', channelId: 'ch-other', operator: { id: 'u5' }, chatId: 'g1', value: why, reply: async () => ({}) })
    assert.match(r2.toast.content, /不属于当前机器人/)
    const denied = service.records.list('admin', { limit: 20 }).filter(x => x.action === 'fakeimbot.action.denied')
    assert.ok(denied.length >= 2)
  })

  await test('kinds without buttons get no actions; disabling stops the bot; delete removes it', async () => {
    await call('saveChannel', { id: plainCh.id, secrets: { token: 'p' }, bot: { enabled: true } })
    const plainBot = fake.bots.at(-1)
    assert.equal(plainBot.channel.id, plainCh.id)
    await plainBot.receive({ id: 'p1', text: `Q:${SQL}`, userId: 'u1' })
    const card = plainBot.replies.find(r => r.kind === 'card')
    assert.ok(card)
    assert.equal(card.message.results[0].actions, undefined)
    const off = await call('saveBot', { channelId: plainCh.id, enabled: false })
    assert.equal(off.status.state, 'idle')
    assert.equal(plainBot.status().state, 'stopped')
    await call('deleteChannel', { id: plainCh.id })
    assert.equal((await call('botStatus')).some(b => b.channelId === plainCh.id), false)
  })
} finally {
  await app.close()
  unregisterAdapter('fakeim')
}
assert.equal(bot?.status().state, 'stopped', 'dispose stops bots')
summary('channels fake adapter')
