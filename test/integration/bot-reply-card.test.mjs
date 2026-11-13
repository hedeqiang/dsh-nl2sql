// runQuery attaches value labels from MySQL column comments ("状态: 0-pending, 1-confirmed");
// a knowledge note overrides the comment; sensitive / unlabelled columns get none.
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)
const app = await boot({ label: 'bot-card' })
const { call } = app
try {
  let ds
  await test('labels from the column comment', async () => {
    ds = await call('saveDatasource', { name: 'A', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
    const r = await call('runQuery', { datasourceId: ds.id, sql: 'select status, tx_type, count(*) n from blockchain_transactions group by status, tx_type' })
    const st = r.columns.find(c => c.name === 'status')
    assert.deepEqual(st.labels, { 0: 'pending', 1: 'confirmed', 2: 'failed' })
    assert.equal(r.columns.find(c => c.name === 'tx_type').labels['1'], '归集转账')
    assert.equal(r.columns.find(c => c.name === 'n').labels, undefined)
  })
  await test('a knowledge note overrides the comment', async () => {
    await call('saveKnowledgeItem', { datasourceId: ds.id, kind: 'note', item: { key: 'blockchain_transactions.status', text: '0=待确认，1=成功，2=失败' } })
    const r = await call('runQuery', { datasourceId: ds.id, sql: 'select status, count(*) n from blockchain_transactions group by status' })
    assert.equal(r.columns.find(c => c.name === 'status').labels['1'], '成功')
  })
} finally {
  await app.close()
}
summary('bot reply card (integration)')
