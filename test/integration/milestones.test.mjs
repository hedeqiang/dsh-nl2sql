// Feature "milestones" (破纪录播报): save validation, preview, scheduler push only when there is
// news, backtest, running-total base cache. Local SQLite file data source with synthetic data.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const { registerAdapter } = await plugin('channels/index.js')
const sent = []
registerAdapter({
  id: 'fakems',
  name: { zh: '假 IM', en: 'Fake IM' },
  kinds: [{
    id: 'fakems_hook',
    label: { zh: '假 IM', en: 'Fake IM' },
    description: { zh: '测试用', en: 'for tests' },
    fields: [{ key: 'chatId', label: { zh: '群', en: 'Chat' }, type: 'text', required: true, target: true }],
    capabilities: { push: true, markdown: 'basic', charts: 'image', tables: 'markdown', buttons: false, bot: false, listTargets: false },
    setupSteps: { zh: ['一'], en: ['one'] },
    validate(input) { return { config: { chatId: String(input.config?.chatId ?? 'g') }, secrets: {} } },
    async send(_channel, _secrets, message) { sent.push(message); return { messageId: `m${sent.length}`, images: 0 } },
    async test() { return { ok: true } },
  }],
})

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date(); today.setHours(0, 0, 0, 0)
const dayAt = (k) => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + k))

// 90 days ending yesterday, 10–12 orders a day of amount 10; yesterday 30 orders (a record).
// The five days before: 14, 15, 16, 17, 18 (growth, but the streak through yesterday is 7 days).
const lines = ['day,amount']
for (let k = -90; k <= -1; k++) {
  const n = k === -1 ? 30 : k >= -6 ? 14 + (k + 6) : 10 + ((k + 90) % 3)
  for (let i = 0; i < n; i++) lines.push(`${dayAt(k)},10`)
}
for (let i = 0; i < 40; i++) lines.push(`${dayAt(0)},10`) // today: partial, ignored
const csv = lines.join('\n') + '\n'

const app = await boot({ label: 'milestones' })
const { call, service } = app
try {
  const imp = await call('importUpload', { fileName: 'orders.csv', base64: Buffer.from(csv).toString('base64'), newName: 'orders-file' })
  assert.equal(imp.results[0].ok, true, JSON.stringify(imp))
  const dsId = imp.datasourceId
  const table = imp.results[0].table
  await call('analyzeSchema', { id: dsId, refresh: true })
  await call('saveKnowledgeItem', { datasourceId: dsId, kind: 'metric', item: { name: '订单数', expression: 'COUNT(*)', table, timeColumn: 'day' } })
  await call('saveKnowledgeItem', { datasourceId: dsId, kind: 'metric', item: { name: '无时间指标', expression: 'COUNT(*)', table } })
  const ch = await call('saveChannel', { name: 'M', type: 'fakems_hook', config: { chatId: 'g1' } })

  let rule
  await test('save validates metrics, time column and kinds', async () => {
    await assert.rejects(call('saveMilestone', { name: 'x', datasourceId: dsId, metrics: [] }), /至少选择一个指标/)
    await assert.rejects(call('saveMilestone', { name: 'x', datasourceId: dsId, metrics: ['不存在'] }), /指标库/)
    await assert.rejects(call('saveMilestone', { name: 'x', datasourceId: dsId, metrics: ['无时间指标'] }), /时间列/)
    await assert.rejects(call('saveMilestone', { name: 'x', datasourceId: dsId, metrics: ['订单数'], kinds: { record: false, month: false, streak: false, total: false } }), /至少选择一种/)
    rule = await call('saveMilestone', { name: '订单播报', datasourceId: dsId, metrics: ['订单数'], channelId: ch.id, totalStep: 500 })
    assert.equal(rule.time, '09:30')
    assert.deepEqual(rule.kinds, { record: true, month: true, streak: true, total: true })
    assert.equal(rule.streakDays, 5)
  })

  await test('preview: record high with previous best and the total crossing 1,000-step mark; nothing sent', async () => {
    const before = sent.length
    const r = await call('runMilestone', { id: rule.id })
    assert.equal(sent.length, before)
    assert.equal(r.day, dayAt(-1))
    const kinds = r.events.map(e => e.kind).sort()
    assert.ok(kinds.includes('record'), JSON.stringify(r.events))
    const rec = r.events.find(e => e.kind === 'record')
    assert.equal(rec.value, 30); assert.equal(rec.previous, 18); assert.equal(rec.allTime, true)
    assert.match(r.text, /🏆 \*\*订单数\*\* \d\d-\d\d 达到 \*\*30\*\*，创历史新高（此前最高 18，/)
    // Total through yesterday, step 500: check consistency with the event list.
    const total = lines.length - 1 - 40
    const crossed = Math.floor((total - 30) / 500) < Math.floor(total / 500)
    assert.equal(kinds.includes('total'), crossed, `total ${total}`)
    assert.equal(r.resultIds.length, 1)
    assert.ok(r.results[0].rows.length <= 60 && r.results[0].rows.length > 50)
    assert.equal(r.results[0].rows.at(-1)[0].slice(0, 10), dayAt(-1), 'chart ends yesterday (today excluded)')
    const runs = await call('listMilestoneRuns', { ruleId: rule.id })
    assert.equal(runs[0].preview, true)
  })

  await test('running total base is cached on the rule and reused', async () => {
    const base = service.state.milestones[0].totalBases?.['订单数']
    assert.ok(base && base.value === 0, JSON.stringify(base))
    base.value = 1e6 // pretend older history: the next check uses it without re-querying
    const r = await call('runMilestone', { id: rule.id })
    const total = 1e6 + (lines.length - 1 - 40)
    assert.equal(r.events.some(e => e.kind === 'total'), Math.floor((total - 30) / 500) < Math.floor(total / 500))
    assert.equal(service.state.milestones[0].totalBases['订单数'].value, 1e6)
    // Changing the metric definition invalidates the cache.
    const k = await call('getKnowledge', { datasourceId: dsId })
    const m = k.metrics.find(x => x.name === '订单数')
    await call('saveKnowledgeItem', { datasourceId: dsId, kind: 'metric', item: { ...m, expression: 'COUNT(1)' } })
    await call('runMilestone', { id: rule.id })
    assert.equal(service.state.milestones[0].totalBases['订单数'].value, 0)
  })

  await test('scheduler: sends once per slot with a carmine card; no message on a quiet day', async () => {
    service.state.milestones[0].createdAt = 0
    const job = service.jobs_milestones(new Date()).find(j => j.id === `milestone:${rule.id}`)
    assert.ok(job.due(new Date()))
    const before = sent.length
    await service.tickAlerts(new Date())
    assert.equal(sent.length, before + 1)
    assert.match(sent.at(-1).title, /🎉 订单播报/)
    assert.equal(sent.at(-1).template, 'carmine')
    assert.equal(sent.at(-1).results.length, 1)
    assert.equal(service.jobs_milestones(new Date()).find(j => j.id === job.id).due(new Date()), false)
    assert.ok(service.state.milestones[0].lastEvents >= 1)
    // A day without news (a normal day: 10–12 orders, no record, no 5-day streak): nothing sent.
    await call('saveMilestone', { id: rule.id, kinds: { total: false, month: false } })
    const quiet = await service.runMilestone({ id: rule.id, send: true, day: dayAt(-20) })
    assert.equal(quiet.events.length, 0, JSON.stringify(quiet.events))
    assert.equal(quiet.pushed, undefined)
    assert.equal(sent.length, before + 1)
  })

  await test('@all and English wording', async () => {
    await call('saveMilestone', { id: rule.id, mentionAll: true, language: 'en' })
    await call('runMilestone', { id: rule.id, send: true })
    assert.match(sent.at(-1).text, /hit \*\*30\*\* on \d\d-\d\d, an all-time high/)
    assert.equal(sent.at(-1).mentionAll, true)
  })

  await test('backtest lists what would have been announced (nothing sent)', async () => {
    await call('saveMilestone', { id: rule.id, language: 'zh', mentionAll: false, kinds: { total: true, month: true } })
    const before = sent.length
    const b = await call('backtestMilestone', { id: rule.id, days: 30 })
    assert.equal(sent.length, before)
    assert.equal(b.days, 30)
    assert.ok(b.events.some(e => e.kind === 'record' && e.day === dayAt(-1)))
    assert.ok(b.events.every(e => typeof e.text === 'string' && e.text.includes('订单数')))
    assert.ok(b.events[0].day >= b.events.at(-1).day, 'newest first')
  })

  await test('delete', async () => {
    await call('deleteMilestone', { id: rule.id })
    assert.deepEqual(await call('listMilestones'), [])
  })
} finally {
  await app.close()
}
summary('milestones')
