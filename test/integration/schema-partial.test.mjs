// Re-analyze selected tables only: picked tables refreshed (columns, indexes, samples),
// others keep their previous analysis; unknown tables refused; needs a full analysis first.
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)
const app = await boot({ label: 'schema-partial' })
const { call, service } = app
try {
  let ds
  await test('partial analysis needs a full one first', async () => {
    ds = await call('saveDatasource', { name: 'A', ...MYSQL })
    await assert.rejects(call('analyzeSchema', { id: ds.id, tables: ['blockchain_transactions'] }), /先完整分析/)
  })
  await test('only the picked tables are refreshed; others keep their previous analysis', async () => {
    const full = await call('analyzeSchema', { id: ds.id, refresh: true })
    // Mark every table's analysis so we can see which ones were redone.
    const s = service.schemas.get(ds.id)
    for (const t of s.tables) { t.comment = `${t.comment}#old`; for (const c of t.columns) c.values = [{ value: 'stale', count: 1 }] }
    const picked = full.tables.find(t => t.name === 'blockchain_transactions') ? 'blockchain_transactions' : full.tables[0].name
    const other = full.tables.find(t => t.name !== picked).name
    const part = await call('analyzeSchema', { id: ds.id, tables: [picked] })
    const p = part.tables.find(t => t.name === picked), o = part.tables.find(t => t.name === other)
    assert.ok(!p.comment.endsWith('#old'), 'picked table re-read')
    assert.ok(!p.columns.some(c => (c.values ?? []).some(v => v.value === 'stale')), 'picked table re-sampled')
    assert.ok(o.comment.endsWith('#old'), 'other table kept')
    assert.equal(part.tables.length, full.tables.length)
    assert.deepEqual(part.partialTables, [picked])
    assert.ok(part.relations.length > 0, 'relations recomputed over the merged schema')
    // persisted: a reload returns the merged schema
    service.schemas.delete(ds.id)
    const again = await call('analyzeSchema', { id: ds.id })
    assert.ok(again.tables.find(t => t.name === other).comment.endsWith('#old'))
  })
  await test('unknown table names are refused', async () => {
    await assert.rejects(call('analyzeSchema', { id: ds.id, tables: ['no_such_table'] }), /找不到这些表：no_such_table/)
  })
} finally {
  await app.close()
}
summary('schema partial analysis')
