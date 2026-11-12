// Legacy state → channel architecture: Lark channels (config / secretsSet), state.larkBot →
// channel.bot, larkSessions → botConversations, member identities, bot default settings,
// legacy flat Lark saveChannel payloads, and the legacy Lark bot RPCs. No database needed.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, summary, assert } from '../lib/assert.mjs'
import { tempDir } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const dir = tempDir('ch-migrate')
mkdirSync(dir, { recursive: true })
const legacy = {
  version: 1, datasources: [{ id: 'ds-1', name: 'shop', type: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u', createdAt: 1 }], current: 'ds-1',
  settings: { larkDefaultRole: 'viewer', larkDefaultDatasourceIds: ['ds-1'] },
  channels: [
    { id: 'ch-hook', name: '群', type: 'lark_webhook', domain: 'feishu', hasSecret: true, hasSign: true, isDefault: true, chartMode: 'native', createdAt: 1 },
    // An invalid App ID keeps the bot from touching the network (it fails locally).
    { id: 'ch-app', name: '应用', type: 'lark_app', domain: 'feishu', appId: 'cli_x', receiveIdType: 'chat_id', receiveId: 'oc_1', hasSecret: true, createdAt: 1 },
  ],
  larkBot: { enabled: true, channelId: 'ch-app', allowP2p: false, sessionScope: 'user' },
  larkSessions: { 'oc_g#abc': { key: 'oc_g#abc', chatId: 'oc_g', chatType: 'group', sessionId: 's1', datasourceId: 'ds-1', lastAt: 5 } },
  users: [
    { id: 'u-p', kind: 'person', name: '甲', role: 'analyst', larkOpenId: 'ou_a', email: 'a@x.com', datasourceIds: ['ds-1'] },
    { id: 'u-c', kind: 'chat', name: '群', role: 'viewer', larkChatId: 'oc_g', datasourceIds: null },
  ],
}
writeFileSync(join(dir, 'state.json'), JSON.stringify(legacy))
const app = await boot({ dataDir: dir, label: 'ch-migrate' })
await app.creds.set('nl2sql/ch-hook', { kind: 'grant', payload: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/old', signSecret: 'sig' } })
await app.creds.set('nl2sql/ch-app', { kind: 'grant', payload: { appSecret: 'sec' } })
const { call, service } = app

try {
  await test('channels: config / secretsSet / platform derived; legacy fields kept', async () => {
    const list = await call('listChannels')
    const hook = list.find(c => c.id === 'ch-hook')
    assert.equal(hook.platform, 'lark')
    assert.deepEqual(hook.secretsSet, { webhookUrl: true, signSecret: true })
    assert.equal(hook.hasSecret, true)
    assert.equal(hook.hasSign, true)
    assert.equal(hook.capabilities.push, true)
    assert.equal(hook.bot, undefined, 'webhook kind has no bot')
    const appCh = list.find(c => c.id === 'ch-app')
    assert.deepEqual(appCh.config, { domain: 'feishu', appId: 'cli_x', receiveIdType: 'chat_id', receiveId: 'oc_1' })
    assert.equal(appCh.appId, 'cli_x', 'legacy top-level field')
    assert.deepEqual(appCh.secretsSet, { appSecret: true })
    assert.ok(!JSON.stringify(list).includes('sec') || !JSON.stringify(list).includes('"sec"'), 'no secret values')
    assert.ok(!JSON.stringify(list).includes('hook/old'))
  })

  await test('state.larkBot → channel.bot; larkSessions → botConversations (persisted, idempotent)', async () => {
    const appCh = service.state.channels.find(c => c.id === 'ch-app')
    assert.deepEqual(appCh.bot, { enabled: true, allowP2p: false, sessionScope: 'user' })
    assert.equal('larkBot' in service.state, false)
    const conv = service.state.botConversations['ch-app:oc_g#abc']
    assert.equal(conv.sessionId, 's1')
    assert.equal(conv.channelId, 'ch-app')
    assert.equal(service.state.larkSessions, service.state.botConversations, 'legacy getter')
    await service.save()
    const disk = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
    assert.equal('larkBot' in disk, false)
    assert.equal('larkSessions' in disk, false)
    assert.ok(disk.botConversations['ch-app:oc_g#abc'])
    assert.equal(service.migrateLegacyBot(), false, 'second run changes nothing')
    assert.equal(service.migrateUsers(), false)
    assert.equal(service.migrateSettings(), false)
  })

  await test('bot status: invalid credentials surface as error without network; legacy RPC aliases', async () => {
    // Started at boot before the test stored its secret: restart with credentials.
    const one = await call('restartBot', { channelId: 'ch-app' })
    assert.equal(one.channelId, 'ch-app')
    const all = await call('botStatus')
    assert.equal(all.length, 1)
    assert.equal(all[0].channelId, 'ch-app')
    assert.equal(all[0].platform, 'lark')
    assert.equal(all[0].enabled, true)
    assert.equal(all[0].status.state, 'error')
    assert.match(all[0].status.error, /Invalid Lark App ID/)
    const legacyStatus = await call('larkBotStatus')
    assert.equal(legacyStatus.channelId, 'ch-app')
    assert.equal(legacyStatus.sessionScope, 'user')
    assert.equal(legacyStatus.conversations.length, 1)
    const off = await call('saveLarkBot', { enabled: false })
    assert.equal(off.enabled, false)
    assert.equal(off.status.state, 'idle')
    assert.equal(service.state.channels.find(c => c.id === 'ch-app').bot.enabled, false)
    const restarted = await call('restartLarkBot')
    assert.equal(restarted.channelId, 'ch-app')
    const viaNew = await call('saveBot', { channelId: 'ch-app', allowP2p: true })
    assert.equal(viaNew.allowP2p, true)
    await assert.rejects(call('saveBot', { channelId: 'ch-hook', enabled: true }), /不支持机器人/)
    await assert.rejects(call('saveLarkBot', { channelId: 'ch-hook' }), /应用机器人/)
  })

  await test('members: larkOpenId / larkChatId → identities; resolveActor by identity, email and chat', async () => {
    const users = await call('listUsers')
    assert.deepEqual(users.find(u => u.id === 'u-p').identities, [{ platform: 'lark', id: 'ou_a' }])
    assert.deepEqual(users.find(u => u.id === 'u-c').identities, [{ platform: 'lark', id: 'oc_g' }])
    assert.equal(service.resolveActor({ platform: 'lark', userId: 'ou_a' }).actor.name, '甲')
    assert.equal(service.resolveActor({ platform: 'telegram', userId: 'ou_a' }).actor.name, 'ou_a', 'same id on another platform is not the member (falls back to default role)')
    assert.equal(service.resolveActor({ platform: 'dingtalk', userId: 'x', email: 'A@X.com' }).actor.name, '甲', 'email matches on any platform')
    const inChat = service.resolveActor({ platform: 'lark', userId: 'ou_a', chatId: 'oc_g', chatType: 'group' }).actor
    assert.equal(inChat.role, 'viewer', 'narrower of person and chat')
    assert.equal(service.resolveLarkActor({ openId: 'ou_a' }).actor.openId, 'ou_a')
    // New identities form, duplicate check across platforms.
    const tg = await call('saveUser', { kind: 'person', name: '乙', role: 'analyst', identities: [{ platform: 'telegram', id: '42' }, { platform: 'lark', id: 'ou_b' }], datasourceIds: ['ds-1'] })
    assert.equal(tg.larkOpenId, 'ou_b', 'legacy mirror')
    assert.equal(service.resolveActor({ platform: 'telegram', userId: '42' }).actor.name, '乙')
    await assert.rejects(call('saveUser', { kind: 'person', name: '丙', identities: [{ platform: 'telegram', id: '42' }] }), /已属于成员「乙」/)
    await assert.rejects(call('saveUser', { kind: 'person', name: '丁', larkOpenId: 'ou_a' }), /已属于成员「甲」/)
    await call('saveUser', { kind: 'person', name: '戊', identities: [{ platform: 'lark', id: 'ou_a2' }, { platform: 'telegram', id: '42x' }] })
    // Legacy update replaces only the Lark identity.
    const p = (await call('listUsers')).find(u => u.name === '戊')
    const upd = await call('saveUser', { id: p.id, larkOpenId: 'ou_a3' })
    assert.deepEqual(upd.identities, [{ platform: 'lark', id: 'ou_a3' }, { platform: 'telegram', id: '42x' }])
    await assert.rejects(call('saveUser', { kind: 'person', name: '己', identities: [] }), /至少一个 IM 账号/)
    await assert.rejects(call('saveUser', { kind: 'chat', name: '庚' }), /群 ID/)
  })

  await test('settings: botDefault* migrated from larkDefault*; both names read and written', async () => {
    const s = await call('getSettings')
    assert.equal(s.botDefaultRole, 'viewer')
    assert.equal(s.larkDefaultRole, 'viewer')
    assert.deepEqual(s.botDefaultDatasourceIds, ['ds-1'])
    assert.deepEqual(s.larkDefaultDatasourceIds, ['ds-1'])
    assert.equal('larkDefaultRole' in service.state.settings, false)
    const saved = await call('saveSettings', { larkDefaultRole: 'analyst' })
    assert.equal(saved.botDefaultRole, 'analyst')
    assert.equal(service.state.settings.botDefaultRole, 'analyst')
    await call('saveSettings', { botDefaultRole: 'none', botDefaultDatasourceIds: [] })
    assert.equal((await call('getSettings')).larkDefaultRole, 'none')
    assert.match(service.resolveActor({ platform: 'telegram', userId: 'nobody' }).refused, /Telegram/)
    const reset = await call('resetSettings', { keys: ['larkDefaultRole'] })
    assert.equal(reset.botDefaultRole, 'none')
  })

  await test('saveChannel: legacy flat Lark payloads keep working and keep the secret layout', async () => {
    const hook = await call('saveChannel', { name: '新群', type: 'lark_webhook', webhookUrl: 'https://open.larksuite.com/open-apis/bot/v2/hook/new', signSecret: 's1' })
    assert.equal(hook.domain, 'lark')
    assert.deepEqual(hook.secretsSet, { webhookUrl: true, signSecret: true })
    const rec = app.creds.get(`nl2sql/ch-${hook.id.replace(/^ch-/, '')}`)
    assert.deepEqual(rec.payload, { webhookUrl: 'https://open.larksuite.com/open-apis/bot/v2/hook/new', signSecret: 's1' })
    // Edit without secrets keeps them; empty sign + clearSign removes the sign secret.
    await call('saveChannel', { id: hook.id, name: '新群2' })
    assert.equal(app.creds.get(`nl2sql/${hook.id}`).payload.signSecret, 's1')
    const cleared = await call('saveChannel', { id: hook.id, signSecret: '', clearSign: true })
    assert.equal(cleared.hasSign, false)
    assert.deepEqual(app.creds.get(`nl2sql/${hook.id}`).payload, { webhookUrl: 'https://open.larksuite.com/open-apis/bot/v2/hook/new' })
    await assert.rejects(call('saveChannel', { name: 'x', type: 'lark_webhook', webhookUrl: 'https://evil/x' }), (e) => /格式不正确/.test(e.message) && e.code === 'nl2sql/invalid')
    await assert.rejects(call('saveChannel', { name: 'y', type: 'lark_app', appId: 'cli_y', receiveId: 'oc' }), /App Secret/)
    // Contract payload with config / secrets / bot.
    const appCh = await call('saveChannel', { name: '应用2', type: 'lark_app', config: { appId: 'cli_y', receiveId: 'oc_9', domain: 'lark' }, secrets: { appSecret: 'z' }, chartMode: 'image', bot: { enabled: false, sessionScope: 'user' } })
    assert.equal(appCh.chartMode, 'image')
    assert.equal(appCh.receiveId, 'oc_9')
    assert.deepEqual(pickBot(appCh.bot), { enabled: false, allowP2p: true, sessionScope: 'user' })
    assert.deepEqual(app.creds.get(`nl2sql/${appCh.id}`).payload, { appSecret: 'z' })
    // chartMode image is not available on webhook channels → default.
    const h2 = await call('saveChannel', { id: hook.id, chartMode: 'image' })
    assert.equal(h2.chartMode, 'native')
    // Unknown types are refused; deleting removes the credential record.
    await assert.rejects(call('saveChannel', { name: 'z', type: 'nope' }), /不支持的渠道类型/)
    await call('deleteChannel', { id: appCh.id })
    assert.equal(app.creds.has(`nl2sql/${appCh.id}`), false)
  })

  await test('RPC errors carry the field of a ChannelError', async () => {
    let err
    try { await call('saveChannel', { name: 'f', type: 'lark_app', config: { receiveId: 'oc' }, secrets: { appSecret: 's' } }) } catch (e) { err = e }
    assert.equal(err?.field, 'appId')
    const res = await rawCall('saveChannel', { name: 'f', type: 'lark_app', config: { receiveId: 'oc' }, secrets: { appSecret: 's' } })
    assert.equal(res.error.field, 'appId')
  })

  await test('catalog and export / import keep new channel shapes and identities', async () => {
    const cat = await call('channelCatalog', {})
    assert.ok(cat.some(p => p.platform === 'lark'))
    const doc = await call('exportConfig')
    const ch = doc.channels.find(c => c.id === 'ch-app')
    assert.equal(ch.platform, 'lark')
    assert.deepEqual(ch.config.appId, 'cli_x')
    assert.ok(!JSON.stringify(doc).includes('"sec"'))
    assert.ok(doc.users.find(u => u.name === '乙').identities.some(i => i.platform === 'telegram'))
    assert.equal(doc.settings.botDefaultRole, 'none')
    const other = await boot({ label: 'ch-migrate-import' })
    try {
      const res = await other.call('importConfig', { data: doc, mode: 'merge' })
      assert.ok(res.report.channels.add >= 2)
      const users = await other.call('listUsers')
      assert.equal(other.service.resolveActor({ platform: 'telegram', userId: '42' }).actor.name, '乙')
      assert.ok(users.length >= 3)
      const chans = await other.call('listChannels')
      const imported = chans.find(c => c.name === '应用')
      assert.equal(imported.needsSecret, true)
      assert.equal(imported.bot.enabled, false, 'imported bots stay off until their secret is set')
      // A legacy export (no config / identities) still imports.
      const legacyDoc = { ...doc, channels: [{ name: '旧', type: 'lark_app', appId: 'cli_z', receiveId: 'oc_z', domain: 'feishu' }], users: [{ name: '旧人', kind: 'person', larkOpenId: 'ou_old', role: 'analyst' }] }
      await other.call('importConfig', { data: legacyDoc, mode: 'merge', sections: ['channels', 'users'] })
      assert.equal((await other.call('listChannels')).find(c => c.name === '旧').config.appId, 'cli_z')
      assert.equal(other.service.resolveActor({ platform: 'lark', userId: 'ou_old' }).actor.name, '旧人')
    } finally { await other.close() }
  })
} finally {
  await app.close()
}

function pickBot(b) { return { enabled: b.enabled, allowP2p: b.allowP2p, sessionScope: b.sessionScope } }
async function rawCall(method, payload) {
  const res = await app.fetchRoute(new Request('http://x/api/nl2sql.rpc', { method: 'POST', body: JSON.stringify({ method, payload }) }))
  return res.json()
}
summary('channels migration')
