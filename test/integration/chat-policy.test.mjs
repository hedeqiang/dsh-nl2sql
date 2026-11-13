// Group "who may ask" policy: askers (all / members / listed), blocked list, merge mode,
// read-only, rate limits; legacy groups keep 'all'; new groups inherit the global default.
import { test, summary, assert } from '../lib/assert.mjs'
import { boot } from '../lib/harness.mjs'

const app = await boot({ label: 'chat-policy' })
const { call, service } = app
const ask = (userId, chatId = 'g1') => service.resolveActor({ platform: 'lark', userId, chatId, chatType: 'group' })

try {
  // Two file data sources so scopes can differ.
  const csv = Buffer.from('a,b\n1,2\n').toString('base64')
  const d1 = (await call('importUpload', { fileName: 'one.csv', base64: csv })).datasourceId
  const d2 = (await call('importUpload', { fileName: 'two.csv', base64: csv })).datasourceId
  let chat, alice, bob

  await test('a group registered before the policy existed keeps "everyone in the group"', async () => {
    chat = await call('saveUser', { kind: 'chat', name: 'G', identities: [{ platform: 'lark', id: 'g1' }], role: 'analyst', datasourceIds: [d1, d2] })
    // simulate a pre-existing record
    const rec = service.state.users.find(u => u.id === chat.id); delete rec.chatPolicy
    const r = ask('stranger')
    assert.ok(r.actor, JSON.stringify(r))
    assert.equal(r.actor.chatPolicy.askers, 'all')
    assert.deepEqual(r.actor.datasourceIds.sort(), [d1, d2].sort())
  })

  await test('new groups inherit the global default (registered members only)', async () => {
    const g2 = await call('saveUser', { kind: 'chat', name: 'G2', identities: [{ platform: 'lark', id: 'g2' }], role: 'analyst', allDatasources: true })
    assert.deepEqual(g2.chatPolicy, { inherit: true })
    const r = ask('stranger', 'g2')
    assert.match(r.refused, /只允许已登记的成员/)
    alice = await call('saveUser', { kind: 'person', name: 'Alice', identities: [{ platform: 'lark', id: 'ou_a' }], role: 'admin', datasourceIds: [d1] })
    bob = await call('saveUser', { kind: 'person', name: 'Bob', identities: [{ platform: 'lark', id: 'ou_b' }], role: 'analyst', allDatasources: true })
    assert.ok(ask('ou_a', 'g2').actor)
    // changing the global default changes inheriting groups
    await call('saveSettings', { chatPolicyDefault: { askers: 'all' } })
    assert.ok(ask('stranger', 'g2').actor)
    await call('saveSettings', { chatPolicyDefault: { askers: 'members' } })
  })

  await test('members only / listed only / blocked', async () => {
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'members' } })
    assert.match(ask('stranger').refused, /只允许已登记的成员/)
    assert.ok(ask('ou_b').actor)
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'listed', listed: [alice.id] } })
    assert.ok(ask('ou_a').actor)
    assert.match(ask('ou_b').refused, /只允许指定成员/)
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'members', blocked: [bob.id] } })
    assert.match(ask('ou_b').refused, /已被管理员暂停/)
    assert.ok(ask('ou_a').actor)
  })

  await test('merge: strict = narrower of group and person; chat = the group decides', async () => {
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'members', merge: 'strict' } })
    let a = ask('ou_a').actor
    assert.deepEqual(a.datasourceIds, [d1], 'Alice only has d1')
    assert.equal(a.role, 'analyst', 'narrower role (group analyst < admin)')
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'members', merge: 'chat' } })
    a = ask('ou_a').actor
    assert.deepEqual(a.datasourceIds.sort(), [d1, d2].sort(), "the group's scope")
    assert.equal(a.role, 'analyst', "the group's role")
  })

  await test('read-only: everyone asks as a viewer', async () => {
    await call('saveUser', { id: chat.id, chatPolicy: { askers: 'members', readOnly: true } })
    assert.equal(ask('ou_b').actor.role, 'viewer')
  })

  await test('rate limits: per asker per minute and per chat per hour', async () => {
    const p = { ...service.chatPolicyOf(service.state.users.find(u => u.id === chat.id)), perUserPerMinute: 2, perChatPerHour: 3 }
    const t0 = 1_000_000
    const k = (u) => ({ chatKey: 'lark:g1', userKey: `lark:g1:${u}` })
    assert.equal(service.checkChatRate(p, k('a'), t0), null)
    assert.equal(service.checkChatRate(p, k('a'), t0 + 1), null)
    assert.match(service.checkChatRate(p, k('a'), t0 + 2), /每人每分钟最多 2 次/)
    assert.equal(service.checkChatRate(p, k('a'), t0 + 61000), null, 'window slides')
    assert.match(service.checkChatRate(p, k('b'), t0 + 62000), /每小时最多 3 次/)
    assert.equal(service.checkChatRate({ ...p, perUserPerMinute: 0, perChatPerHour: 0 }, k('c'), t0), null, '0 = unlimited')
  })

  await test('validation: unknown askers mode refused; lists keep only existing persons', async () => {
    await assert.rejects(call('saveUser', { id: chat.id, chatPolicy: { askers: 'anyone' } }), /askers/)
    const u = await call('saveUser', { id: chat.id, chatPolicy: { askers: 'listed', listed: [alice.id, 'u-nope', chat.id] } })
    assert.deepEqual(u.chatPolicy.listed, [alice.id])
  })
} finally {
  await app.close()
}
summary('chat policy')
