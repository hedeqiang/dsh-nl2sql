// Ask page suggestions paging ("换一批") and deleting history entries.
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'svc-ask-history' })
const { call, service } = app
try {
  let ds
  await test('setup', async () => {
    ds = await call('saveDatasource', { name: 'm', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'metric', item: { name: '交易笔数', expression: 'COUNT(*)', table: 'blockchain_transactions', timeColumn: 'created_at', dimensions: 'chain_type' } })
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'example', item: { question: '各链类型交易笔数', sql: 'select chain_type, count(*) from blockchain_transactions group by chain_type' } })
  })

  await test('suggestions page through a larger pool and wrap around', async () => {
    const p1 = await call('askSuggestions', { datasourceId: ds.id, pageSize: 6 })
    assert.equal(p1.examples.length, 6)
    assert.ok(p1.total > 6, `pool ${p1.total}`)
    assert.ok(p1.examples.includes('最近 30 天每天的交易笔数'), 'metric example on first page')
    assert.ok(p1.examples.includes('各链类型交易笔数'), 'verified example on first page')
    const p2 = await call('askSuggestions', { datasourceId: ds.id, pageSize: 6, offset: p1.nextOffset })
    assert.notDeepEqual(p2.examples, p1.examples, 'next page differs')
    assert.equal(new Set(p2.examples).size, p2.examples.length, 'no duplicates within a page')
    // walking the whole pool returns to the start
    let off = 0
    const seen = new Set()
    for (let i = 0; i < 20; i++) { const p = await call('askSuggestions', { datasourceId: ds.id, pageSize: 6, offset: off }); p.examples.forEach(x => seen.add(x)); off = p.nextOffset; if (off === 0) break }
    assert.equal(seen.size, p1.total, 'every pooled question is reachable')
    const en = await call('askSuggestions', { datasourceId: ds.id, locale: 'en' })
    assert.ok(en.examples.every(q => !/[\u4e00-\u9fa5]/.test(q.replaceAll('交易笔数', ''))), 'english templates (metric names stay as defined)')
  })

  await test('recent questions: limit, hasMore, delete by title removes repeats', async () => {
    for (const [i, title] of ['问题A', '问题B', '问题A', '问题C'].entries()) await service.runQuery({ datasourceId: ds.id, sql: `select ${i + 1} as x`, title, source: 'agent', sessionId: `s-${i}` })
    const r1 = await call('askSuggestions', { datasourceId: ds.id, recentLimit: 2 })
    assert.deepEqual(r1.recent.map(r => r.question), ['问题C', '问题A'])
    assert.equal(r1.hasMoreRecent, true)
    const del = await call('deleteHistory', { title: '问题A', datasourceId: ds.id })
    assert.equal(del.deleted, 2, 'both asks of 问题A removed')
    const r2 = await call('askSuggestions', { datasourceId: ds.id, recentLimit: 8 })
    assert.deepEqual(r2.recent.map(r => r.question), ['问题C', '问题B'])
    assert.equal(r2.hasMoreRecent, false)
  })

  await test('delete one history entry by id; unknown id refused; audited', async () => {
    const h = (await call('listHistory', { limit: 50 })).find(x => x.title === '问题B')
    assert.equal((await call('deleteHistory', { id: h.id })).deleted, 1)
    assert.ok(!(await call('listHistory', { limit: 50 })).some(x => x.id === h.id))
    await assert.rejects(call('deleteHistory', { id: h.id }), /不存在/)
    await assert.rejects(call('deleteHistory', {}), /缺少/)
    assert.ok((await call('adminLog')).some(a => a.action === 'history.delete'))
  })
} finally {
  await app.close()
}
summary('service ask/history')
