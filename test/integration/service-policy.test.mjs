// Service (MySQL): datasource access policy enforced in tools and RPC, result feedback loop,
// dashboard global filters, and hidden columns. Ported from an earlier standalone script and svc7.mjs.
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const app = await boot({ label: 'svc-policy' })
const { call, tool } = app
const q = (sql) => tool('nl2sql_query', { sql })
let ds
try {
  await test('setup datasource', async () => {
    ds = await call('saveDatasource', { name: 'm', ...MYSQL })
    await call('analyzeSchema', { id: ds.id, refresh: true })
  })

  // ---------------------------------------------------------------- deny policy (svc6)
  await test('deny policy: schema overview hides denied tables and mentions access control', async () => {
    await call('savePolicy', { id: ds.id, policy: { mode: 'deny', tables: 'callback_*', hiddenColumns: ['*.api_secret', 'blockchain_transactions.raw_data'], maskedColumns: ['blockchain_transactions.from_address'] } })
    const ov = (await tool('nl2sql_schema', {})).text
    assert.doesNotMatch(ov, /callback_configs/)
    assert.match(ov, /access control/)
  })
  await test('deny policy: denied table, system catalog and hidden column refused', async () => {
    await assert.rejects(q('select * from callback_configs'), /无权查询表：callback_configs/)
    await assert.rejects(q('select table_name from information_schema.tables'), /不允许查询系统目录/)
    // api_secret is hidden by policy; the query is refused (by policy or by the DB once removed).
    await assert.rejects(q('select api_secret from address_pool_configs'))
  })
  await test('deny policy: select * drops hidden and masks masked columns', async () => {
    const r = await q('select * from blockchain_transactions limit 2')
    assert.equal(r.model.rowCount, 2)
    const cols = r.model.columns.join(',')
    assert.match(cols, /from_address:text\(masked\)/)
    assert.doesNotMatch(cols, /raw_data/)
    const rr = await call('runQuery', { datasourceId: ds.id, sql: 'select hash, from_address from blockchain_transactions limit 1' })
    assert.deepEqual(rr.columns.map((c) => c.name + (c.masked ? '*' : '')), ['hash', 'from_address*'])
    assert.match(String(rr.rows[0][1]), /\*{4,}/)
  })
  await test('deny policy: analyzeSchema annotates blocked tables and hidden columns for the page', async () => {
    const an = await call('analyzeSchema', { id: ds.id })
    assert.deepEqual(an.tables.filter((t) => t.blocked).map((t) => t.name), ['callback_configs'])
    const hidden = an.tables.flatMap((t) => t.columns.filter((c) => c.hidden).map((c) => `${t.name}.${c.name}`))
    assert.ok(hidden.includes('callback_configs.api_secret'), hidden.join(','))
  })

  // ---------------------------------------------------------------- allow policy
  await test('allow policy: listed tables queryable, others refused (query and overview)', async () => {
    await call('savePolicy', { id: ds.id, policy: { mode: 'allow', tables: ['blockchain_transactions', 'wallets'] } })
    const r = await q('select count(*) n from blockchain_transactions t join wallets w on 1=1')
    assert.equal(r.model.rowCount, 1)
    await assert.rejects(q('select count(*) from blocks'), /无权查询表：blocks/)
    await assert.rejects(tool('nl2sql_overview', { table: 'blocks' }), /表不存在或无权访问：blocks/)
  })

  // ---------------------------------------------------------------- hidden columns (svc7)
  await test('hidden column: direct and aliased references refused, select * omits it, schema hides it', async () => {
    await call('savePolicy', { id: ds.id, policy: { mode: 'all', hiddenColumns: ['blockchain_transactions.amount'] } })
    await assert.rejects(q('select amount from blockchain_transactions'), /字段 amount 已被数据源访问控制隐藏/)
    await assert.rejects(q('select sum(t.amount) from blockchain_transactions t'), /字段 t\.amount 已被数据源访问控制隐藏/)
    const ok = await q('select id, hash from blockchain_transactions limit 1')
    assert.deepEqual(ok.model.columns, ['id:text', 'hash:text'])
    const star = await q('select * from blockchain_transactions limit 1')
    assert.ok(!star.model.columns.some((c) => c.startsWith('amount:')), star.model.columns.join(','))
    const det = (await tool('nl2sql_schema', { tables: ['blockchain_transactions'] })).text
    assert.doesNotMatch(det, /- amount /)
  })

  // ---------------------------------------------------------------- feedback
  await test('feedback: submit → stats → resolve saves verified example', async () => {
    await call('savePolicy', { id: ds.id, policy: { mode: 'all' } })
    const res = await call('runQuery', { datasourceId: ds.id, sql: 'select status, count(*) n from blockchain_transactions group by status', title: '按状态' })
    const fb = await call('submitFeedback', { resultId: res.resultId, rating: 'down', comment: '应排除测试网', question: '各状态交易笔数' })
    assert.equal(fb.status, 'open')
    assert.match(fb.sql, /^select status, count\(\*\) n from blockchain_transactions/)
    assert.deepEqual(await call('feedbackStats', {}), { up: 0, down: 1, open: 1, rate: 0 })
    await call('resolveFeedback', { id: fb.id, saveExample: true, correctedSql: "select status, count(*) n from blockchain_transactions where network <> 'testnet' group by status", question: '各状态交易笔数' })
    const k = await call('getKnowledge', { datasourceId: ds.id })
    assert.deepEqual(k.examples.map((e) => e.question), ['各状态交易笔数'])
    assert.match(k.examples[0].sql, /network <> 'testnet'/)
    assert.deepEqual(await call('feedbackStats', {}), { up: 0, down: 1, open: 0, rate: 0 })
  })

  // ---------------------------------------------------------------- dashboard filters
  await test('dashboard filters: candidates and injection into widget SQL', async () => {
    await call('pinWidget', { title: 'trend', sql: 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d', datasourceId: ds.id })
    const cand = await call('filterCandidates')
    assert.ok(cand.time.some((t) => t.column === 'created_at' && t.tables.includes('blockchain_transactions')))
    assert.ok(Array.isArray(cand.dims))
    await call('saveDashboardFilters', { filters: [{ kind: 'time', column: 'created_at', range: 'last90d' }, { kind: 'in', column: 'status', values: ['1'] }] })
    const w = (await call('listDashboard'))[0]
    const wr = await call('runWidget', { id: w.id })
    const desc = wr.filters.map((f) => f.description)
    assert.equal(desc.length, 2)
    assert.match(desc[0], /^created_at ∈ \[\d{4}-\d\d-\d\d, \d{4}-\d\d-\d\d\)$/)
    assert.equal(desc[1], 'status IN (1)')
    assert.match(wr.sql, /WHERE `blockchain_transactions`\.`created_at` >= '\d{4}-\d\d-\d\d 00:00:00' AND `blockchain_transactions`\.`created_at` < /)
    assert.match(wr.sql, /`blockchain_transactions`\.`status` IN \('1'\) group by d order by d/)
  })
} finally {
  await app.close()
}
summary('service policy')
