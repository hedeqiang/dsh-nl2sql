// Alerts under concurrency: preview vs save, check vs edit; daily slots across DST;
// the bot turn timeout path (async cancel rejecting).
import { readFileSync } from 'node:fs'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin, sleep } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

// ------------------------------------------------------------ no database needed
const { methods } = await plugin('service/alerts.js')

await test('daily slot in a DST zone: nonexistent local time skipped, repeated one runs once (earlier instant)', () => {
  const tz = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const at = (s) => new Date(s).getTime()
    // 2026-03-08 02:00 → 03:00: 02:30 does not exist that day → next slot is 03-09 02:30.
    const spring = methods.alertDueAt({ every: 'day', at: '02:30', lastCheckedAt: at('2026-03-07T02:30:05-05:00') }, at('2026-03-08T04:00:00-04:00'))
    assert.equal(spring, at('2026-03-09T02:30:00-04:00'))
    // 2026-11-01 01:00–02:00 repeats: the slot is the first 01:30 (EDT).
    const fallNow = at('2026-11-01T01:45:00-05:00')
    const fall = methods.alertDueAt({ every: 'day', at: '01:30', lastCheckedAt: at('2026-10-31T01:30:05-04:00') }, fallNow)
    assert.equal(fall, at('2026-11-01T01:30:00-04:00'))
    // Checked at the first 01:30: not due again at the repeated 01:30.
    const after = methods.alertDueAt({ every: 'day', at: '01:30', lastCheckedAt: at('2026-11-01T01:30:05-04:00') }, fallNow)
    assert.ok(after > fallNow, new Date(after).toString())
    assert.equal(after, at('2026-11-02T01:30:00-05:00'))
    // Plain day: unchanged behaviour.
    assert.equal(methods.alertDueAt({ every: 'day', at: '09:00', lastCheckedAt: 0 }, at('2026-06-10T10:00:00-04:00')), at('2026-06-10T09:00:00-04:00'))
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz
  }
})

await test('bot turn timeout: an async cancel() rejection is not unhandled', async () => {
  let unhandled = null
  const onUnhandled = (e) => { unhandled = e }
  process.on('unhandledRejection', onUnhandled)
  const controller = { async create() { return { sessionId: 's1' } }, async rename() {}, async prompt() {},
    async wait() { return { reason: 'timeout' } },
    async cancel() { throw new Error('cancel failed: session busy') } }
  const app = await boot({ label: 'al-timeout', services: { sessionController: controller } })
  try {
    const out = await app.service.runAgentTurn({ requestId: 'r1', text: 'x', timeoutMs: 10 })
    assert.equal(out.reason, 'timeout')
    await sleep(50)
    assert.equal(unhandled, null, String(unhandled))
  } finally {
    process.off('unhandledRejection', onUnhandled)
    await app.close()
  }
})

// ------------------------------------------------------------ MySQL
const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'al-race' })
const { call, service } = app
const cond = { type: 'threshold', op: '>', value: 0 }
try {
  const ds = await call('saveDatasource', { name: 'A', ...MYSQL })
  const orig = service.runQuery.bind(service)

  await test('preview of a draft does not touch state.alerts: concurrent saves kept, draft never persisted', async () => {
    service.runQuery = async (a) => { const r = await orig(a); if (a.sql === 'select 2 as v') await sleep(600); return r }
    try {
      const preview = call('previewAlert', { name: 'draft', datasourceId: ds.id, source: 'sql', sql: 'select 2 as v', condition: cond })
      await sleep(150)
      const saved = await call('saveAlert', { name: 'real', datasourceId: ds.id, source: 'sql', sql: 'select 1 as v', condition: cond })
      assert.deepEqual(JSON.parse(readFileSync(service.file, 'utf8')).alerts.map(a => a.name), ['real'], 'draft not on disk')
      const p = await preview
      assert.equal(p.triggered, true)
      assert.deepEqual((await call('listAlerts')).map(a => a.id), [saved.id], 'concurrent save kept')
      await service.save()
      assert.deepEqual(JSON.parse(readFileSync(service.file, 'utf8')).alerts.map(a => a.name), ['real'])
      await call('deleteAlert', { id: saved.id })
    } finally { service.runQuery = orig }
  })

  await test('check vs concurrent edit: runtime fields land on the current object; cooldown respected', async () => {
    const al = await call('saveAlert', { name: 'al', datasourceId: ds.id, source: 'sql', sql: 'select 5 as v', condition: cond, cooldownMin: 60 })
    service.runQuery = async (a) => { const r = await orig(a); await sleep(400); return r }
    try {
      const check = call('checkAlert', { id: al.id })
      await sleep(100)
      await call('saveAlert', { id: al.id, name: 'al renamed' })
      const res = await check
      assert.equal(res.state, 'firing')
      const a = (await call('listAlerts')).find(x => x.id === al.id)
      assert.equal(a.name, 'al renamed', 'edit kept')
      assert.equal(a.state, 'firing')
      assert.ok(a.lastFiredAt > 0 && a.lastCheckedAt > 0, JSON.stringify(a))
      assert.ok(service.alertDueAt(a) > Date.now(), 'not due again right away')
      // A later edit keeps the runtime fields (save after the check).
      await call('saveAlert', { id: al.id, cooldownMin: 30 })
      const b = (await call('listAlerts')).find(x => x.id === al.id)
      assert.equal(b.lastFiredAt, a.lastFiredAt)
      assert.equal(b.state, 'firing')
      // Within cooldown: a second check does not fire again.
      const events = service.records.list('alertEvent', { ref: al.id, limit: 10 }).length
      service.runQuery = orig
      await call('checkAlert', { id: al.id })
      assert.equal(service.records.list('alertEvent', { ref: al.id, limit: 10 }).length, events, 'cooldown respected')
    } finally { service.runQuery = orig }
  })
} finally {
  await app.close()
}
summary('alerts race')
