// A fake IM adapter registered through registerAdapter: a channel of its kind can be saved,
// listed, tested and pushed to; its bot receives messages and replies through the generic
// bot pipeline (actor resolution, conversation, agent turn on MySQL, actions + re-authorization).
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin, sleep } from '../lib/env.mjs'
import { boot, fakeSchedule } from '../lib/harness.mjs'

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
  kinds: [makeKind('fakeim_bot', { buttons: true }), makeKind('fakeim_plain', { buttons: false }), { ...makeKind('fakeim_files', { buttons: false }), capabilities: { push: true, markdown: 'basic', charts: 'image', tables: 'markdown', tableRows: 20, files: true, buttons: false, bot: false, listTargets: false } }],
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
const firstResultIds = []
const sessions = fakeSessions(async (text, sid) => {
  prompts.push(text)
  const m = /Q:(.+?)(?:\n|$)/.exec(text)
  const out = await toolsRef.get('nl2sql_query').execute({ sql: m ? m[1] : 'select 1 as x', title: '每日笔数', chart: { type: 'line', x: 'd', y: ['n'] } }, { agent: { id: sid } })
  if (m) firstResultIds.push(out.display.resultId)
  return { text: `共 ${out.display.rowCount} 天 <font color='green'>↑</font>`, metas: [out.display] }
})

const schedule = fakeSchedule()
const app = await boot({ label: 'ch-fake', services: { agents: sessions.agents, sessionController: sessions.controller, schedule } })
toolsRef = app.tools
const { call, service } = app
const SQL = 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d'
let ch, plainCh, ds, bot

try {
  await test('catalog lists the fake platform with its kinds', async () => {
    const cat = await call('channelCatalog')
    const p = cat.find(x => x.platform === 'fakeim')
    assert.ok(p)
    assert.deepEqual(p.kinds.map(k => k.id), ['fakeim_bot', 'fakeim_plain', 'fakeim_files'])
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

  await test('bot: saveBot starts it; group @ message → agent turn on MySQL → reply without buttons', async () => {
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
    assert.equal(card.message.results[0].actions, undefined, 'bot replies carry no buttons')
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
    assert.match(bot.replies.at(-1).text, /可用数据源：\n· A/)
  })

  await test('members: people / groups that talked to the bot are offered for one-click adding (refused ones flagged)', async () => {
    await bot.receive({ id: 'q5', text: '今天多少', userId: 'newbie', chatId: 'g-new', chatType: 'group' })
    assert.match(bot.replies.at(-1).text, /没有开通数据问答权限/)
    const people = await call('listSeenIdentities', { kind: 'person' })
    const nb = people.find(x => x.id === 'newbie')
    assert.ok(nb, JSON.stringify(people))
    assert.equal(nb.platform, 'fakeim'); assert.equal(nb.name, 'n-newbie'); assert.equal(nb.refused, true); assert.equal(nb.memberId, undefined)
    const u1 = people.find(x => x.id === 'u1')
    assert.equal(u1.memberName, '甲', 'existing members are marked')
    const chats = await call('listSeenIdentities', { kind: 'chat' })
    assert.ok(chats.some(x => x.id === 'g-new' && x.refused))
    assert.ok(chats.some(x => x.id === 'g1' && x.memberName === '假群'))
    // adding it clears the pending state
    await call('saveUser', { kind: 'person', name: nb.name, identities: [{ platform: nb.platform, id: nb.id }], role: 'analyst', datasourceIds: [ds.id] })
    assert.equal((await call('listSeenIdentities', { kind: 'person' })).find(x => x.id === 'newbie').memberName, 'n-newbie')
  })

  await test('data source: prompt lists usable sources; question routes to the matching source; 切换 pins, 自动 unpins', async () => {
    // Second data source: a local file with an obviously different subject.
    const csv = Buffer.from('city,amount\nA,10\nB,20\n').toString('base64')
    const up = await call('importUpload', { fileName: '城市销售额.csv', base64: csv })
    const fileDs = up.datasourceId
    await call('saveDatasource', { id: fileDs, name: '销售文件', description: '各城市销售额' }).catch(() => {})
    await call('analyzeSchema', { id: fileDs, refresh: true })
    await call('saveUser', { id: (await call('listUsers')).find(u => u.name === '甲').id, datasourceIds: [ds.id, fileDs] })
    await call('saveUser', { id: (await call('listUsers')).find(u => u.name === '假群').id, datasourceIds: [ds.id, fileDs] })
    const dsName = (await call('listDatasources')).find(d => d.id === fileDs).name
    // a blockchain question → MySQL source A
    await bot.receive({ id: 'r1', text: `Q:${SQL}`, userId: 'u1' })
    assert.match(prompts.at(-1), new RegExp(`可用的数据源：\\n- A（mysql · testdb）.*主要表：.*blockchain_transactions[\\s\\S]*- ${dsName}（sqlite`), prompts.at(-1).slice(0, 600))
    assert.match(prompts.at(-1), /nl2sql_datasource action=use/)
    // a question naming the city sales file → routed to the file source
    const before = prompts.length
    await bot.receive({ id: 'r2', text: '各城市销售额 Q:select 1 as x', userId: 'u1' })
    assert.equal(prompts.length, before + 1)
    assert.match(prompts.at(-1), new RegExp(`当前数据源：${dsName}（按问题自动选择）`), prompts.at(-1).slice(0, 300))
    // scope changed → a new conversation key (by design); take the most recent one
    const conv = Object.values(service.state.botConversations).filter(c => c.channelId === ch.id && c.chatId === 'g1').sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
    assert.equal(service.state.sessions[conv.sessionId], fileDs, 'session bound to the routed source')
    // 切换 pins (fuzzy name), 自动 unpins
    await bot.receive({ id: 'r3', text: '切换 a', userId: 'u1' })
    assert.match(bot.replies.at(-1).text, /已切换到数据源「A」/)
    await bot.receive({ id: 'r4', text: '各城市销售额 Q:select 1 as x', userId: 'u1' })
    assert.match(prompts.at(-1), /数据源：A（群内已用「切换」指定/)
    await bot.receive({ id: 'r5', text: '自动', userId: 'u1' })
    assert.match(bot.replies.at(-1).text, /按问题自动选择数据源/)
    await bot.receive({ id: 'r6', text: '各城市销售额 Q:select 1 as x', userId: 'u1' })
    assert.match(prompts.at(-1), new RegExp(`当前数据源：${dsName}（按问题自动选择）`))
  })

  await test('bot commands: only whole-message commands; questions starting with a command word reach the agent', async () => {
    for (const q of ['自动续费用户有多少', '数据源表里有几行', '切换率是多少', 'help me count orders', '帮助中心的访问量', 'new users last week']) {
      const before = prompts.length
      await bot.receive({ id: `cq-${q}`, text: q, userId: 'u1' })
      assert.equal(prompts.length, before + 1, `question reached the agent: ${q}`)
    }
    const commands = [['帮助', /数据源 \/ sources[\s\S]*switch <name>[\s\S]*新对话 \/ new/], ['/help', /直接 @我 提问/], ['help?', /直接 @我 提问/], ['帮助？', /直接 @我 提问/],
      ['数据源', /可用数据源：/], ['sources', /可用数据源：/], ['datasources', /可用数据源：/], ['自动', /按问题自动选择数据源/], ['auto!', /按问题自动选择数据源/],
      ['新对话', /已开始新对话/], ['new', /已开始新对话/], ['reset', /已开始新对话/],
      ['切换', /用法：切换 <数据源名称>[\s\S]*可用：A/], ['switch', /用法/], ['切换 A', /已切换到数据源「A」/], ['switch a', /已切换到数据源「A」/], ['use A', /已切换到数据源「A」/]]
    for (const [cmd, re] of commands) {
      const before = prompts.length
      await bot.receive({ id: `cmd-${cmd}`, text: cmd, userId: 'u1' })
      assert.equal(prompts.length, before, `command not sent to the agent: ${cmd}`)
      assert.match(bot.replies.at(-1).text ?? '', re, `${cmd} → ${bot.replies.at(-1).text}`)
    }
    await bot.receive({ id: 'cmd-auto2', text: '自动', userId: 'u1' })
  })

  await test('actions: re-authorized per click (rate limit, viewer, wrong chat, wrong channel); breakdown replies', async () => {
    // Replies carry no buttons now; tokens from cards sent by older versions are still honoured.
    const conv = Object.values(service.state.botConversations).find(c => c.channelId === ch.id)
    const resultId = firstResultIds[0]
    const actor = service.resolveActor({ platform: 'fakeim', userId: 'u1', chatId: 'g1', chatType: 'group' }).actor
    const [withActions] = await service.withResultActions([service.lookupResult(resultId)], { actor, sessionId: conv.sessionId, channelId: ch.id, platform: 'fakeim', chatId: 'g1', chatType: 'group', replyTo: 'q1', depth: 0 })
    const { select, buttons } = withActions.actions
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
  await test('large results: full data attached as Excel where the kind can send files; not otherwise', async () => {
    const r = await call('runQuery', { datasourceId: ds.id, sql: 'select id, chain_type, amount from blockchain_transactions order by id limit 60' })
    assert.ok(r.rowCount > 20)
    const filesCh = await call('saveChannel', { name: 'Files', type: 'fakeim_files', config: { chatId: 'g9' }, secrets: { token: 'f' } })
    fake.sent.length = 0
    const out = await call('sendToChannel', { channelId: filesCh.id, title: '明细 60 行', resultIds: [r.resultId] })
    const msg = fake.sent.at(-1).message
    assert.ok(Buffer.isBuffer(msg.attachment?.buffer) && msg.attachment.buffer.length > 100, 'xlsx built')
    assert.match(msg.attachment.fileName, /\.xlsx$/)
    assert.deepEqual(msg.attachment.resultIndexes, [0])
    const { readXlsx } = await plugin('xlsx.js')
    const sheets = readXlsx(msg.attachment.buffer)
    assert.equal(sheets[0].rows.length - 1, r.rowCount, 'every row in the sheet (plus header)')
    assert.equal(out.ok, true)
    // per-send opt-out and kinds without files
    fake.sent.length = 0
    await call('sendToChannel', { channelId: filesCh.id, title: 'x', resultIds: [r.resultId], attachFull: false })
    assert.equal(fake.sent.at(-1).message.attachment, undefined)
    await call('sendToChannel', { channelId: ch.id, title: 'x', resultIds: [r.resultId] })
    assert.equal(fake.sent.at(-1).message.attachment, undefined, 'kind without files: no attachment')
    // small results are not attached
    const small = await call('runQuery', { datasourceId: ds.id, sql: 'select chain_type, count(*) n from blockchain_transactions group by chain_type' })
    await call('sendToChannel', { channelId: filesCh.id, title: 'small', resultIds: [small.resultId] })
    assert.equal(fake.sent.at(-1).message.attachment, undefined)
  })

  await test('send: titles over 100 characters are truncated, not rejected', async () => {
    const r = await call('runQuery', { datasourceId: ds.id, sql: 'select 1 as x', title: 'R'.repeat(110) })
    const out = await call('sendToChannel', { channelId: ch.id, resultIds: [r.resultId] })
    assert.equal(out.ok, true)
    let msg = fake.sent.at(-1).message
    assert.equal(msg.title.length, 100)
    assert.ok(msg.title.endsWith('…'))
    assert.ok(msg.results[0].title.length <= 100)
    await app.tool('nl2sql_send', { channel: 'F', title: 'T'.repeat(101), text: 'hi' })
    msg = fake.sent.at(-1).message
    assert.equal(msg.title.length, 100)
    await call('sendToChannel', { channelId: ch.id, title: '😀'.repeat(60), text: 'x' })
    assert.ok(!/[\uD800-\uDBFF]…$/.test(fake.sent.at(-1).message.title), 'no split surrogate pair')
  })

  await test('type change keeps stored secrets whose key the new kind also has', async () => {
    const c = await call('saveChannel', { name: 'TC', type: 'fakeim_bot', config: { chatId: 'g3' }, secrets: { token: 'keep' } })
    const changed = await call('saveChannel', { id: c.id, type: 'fakeim_plain', config: { chatId: 'g3' } })
    assert.equal(changed.type, 'fakeim_plain')
    assert.deepEqual(changed.secretsSet, { token: true })
    assert.equal(app.creds.get(`nl2sql/${c.id}`).payload.token, 'keep')
    await call('deleteChannel', { id: c.id })
  })

  await test('delete channel: alerts, schema notifications, report prompts and bot conversations drop the reference', async () => {
    const c = await call('saveChannel', { name: 'Gone', type: 'fakeim_bot', config: { chatId: 'g7' }, secrets: { token: 'g' }, bot: { enabled: true } })
    const gbot = fake.bots.at(-1)
    await gbot.receive({ id: 'gq1', text: 'Q:select 1 as x', userId: 'u1', chatId: 'g1' })
    assert.ok(Object.values(service.state.botConversations).some(v => v.channelId === c.id))
    const al = await call('saveAlert', { name: 'al', datasourceId: ds.id, source: 'sql', sql: 'select 1 as v', condition: { type: 'threshold', op: '>', value: 0 }, channelId: c.id })
    await call('saveSettings', { schemaNotifyChannel: c.id })
    const rp = await call('saveReport', { title: 'R', datasourceId: ds.id, question: 'q', channelId: c.id, time: '09:00' })
    assert.ok(schedule.sched.get(rp.scheduleId).prompt.includes(c.id))
    await call('deleteChannel', { id: c.id })
    assert.equal((await call('listAlerts')).find(a => a.id === al.id).channelId, null)
    assert.ok(!(await call('getSettings')).schemaNotifyChannel)
    assert.ok(!schedule.sched.get(rp.scheduleId).prompt.includes(c.id), 'report prompt rewritten')
    assert.equal(service.state.reports.find(r => r.id === rp.id).channelId, undefined)
    assert.equal(Object.values(service.state.botConversations).some(v => v.channelId === c.id), false)
    const res = await call('checkAlert', { id: al.id })
    assert.equal(res.triggered, true)
    const ev = service.records.list('alertEvent', { ref: al.id, limit: 5 })[0]
    assert.equal(ev.pushError, undefined, 'no push to a deleted channel')
    await call('deleteAlert', { id: al.id })
    await call('deleteReport', { id: rp.id }).catch(() => {})
  })
} finally {
  await app.close()
  unregisterAdapter('fakeim')
}
assert.equal(bot?.status().state, 'stopped', 'dispose stops bots')
summary('channels fake adapter')
