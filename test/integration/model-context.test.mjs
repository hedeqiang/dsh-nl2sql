// What the model sees: result summaries (trend / leader without rows), privacy notes, compact
// tool output, the "unknown column" hint, the schema detail size cap and question-relevant
// knowledge in the overview. Uses uploaded CSV files (SQLite); needs no external database.
import { test, summary, assert } from '../lib/assert.mjs'
import { boot } from '../lib/harness.mjs'

const app = await boot({ label: 'model-context' })
const { call, tool, tools } = app
const b64 = (text) => Buffer.from(text).toString('base64')
const render = (name, value) => tools.get(name).output.render({}, value)[0].text

try {
  const daily = 'day,orders\n2026-11-01,120\n2026-11-02,95\n2026-11-03,180\n'
  const up = await call('importUpload', { fileName: 'daily.csv', base64: b64(daily), newName: 'mc' })
  const ds = up.datasourceId
  const table = up.results[0].table
  await call('analyzeSchema', { id: ds, refresh: true })
  await tool('nl2sql_datasource', { action: 'use', datasource: ds })

  await test('summary: time series gets first / last / change and the labels of max / min', async () => {
    const out = await tool('nl2sql_query', { sql: `select day, orders from "${table}" order by orders desc`, title: '每日订单', chart: { type: 'line', x: 'day', y: ['orders'] } })
    assert.equal(out.model.privacy, 'summary')
    assert.equal(out.model.rows, undefined, 'summary mode never sends rows')
    const s = out.model.summary.find(c => c.name === 'orders')
    assert.deepEqual(s.first, { at: '2026-11-01', value: 120 }, 'first point in time order, not result order')
    assert.deepEqual(s.last, { at: '2026-11-03', value: 180 })
    assert.equal(s.change, 60)
    assert.equal(s.changePct, 50)
    assert.equal(s.maxAt, '2026-11-03')
    assert.equal(s.minAt, '2026-11-02')
    assert.match(out.model.note, /State only figures given here/)
  })

  await test('summary: categories get the leader, no meaningless first→last change', async () => {
    const out = await tool('nl2sql_query', { sql: `select case when orders > 100 then 'big' else 'small' end as size, sum(orders) as total from "${table}" group by 1 order by total desc` })
    const s = out.model.summary.find(c => c.name === 'total')
    assert.equal(s.maxAt, 'big')
    assert.equal(s.change, undefined)
    const label = out.model.summary.find(c => c.name === 'size')
    assert.deepEqual(label.firstValues, ['big', 'small'])
  })

  await test('tool output is compact JSON (no indentation)', async () => {
    const out = await tool('nl2sql_query', { sql: `select day, orders from "${table}"` })
    const text = render('nl2sql_query', out)
    assert.ok(!text.includes('\n'), text.slice(0, 200))
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(out.model)))
  })

  await test('privacy none and rows: the note says what the model cannot see', async () => {
    await call('saveSettings', { resultToModel: 'none' })
    let out = await tool('nl2sql_query', { sql: `select day, orders from "${table}"` })
    assert.equal(out.model.summary, undefined)
    assert.match(out.model.note, /Do not state any figures/)
    await call('saveSettings', { resultToModel: 'rows', modelRows: 2 })
    out = await tool('nl2sql_query', { sql: `select day, orders from "${table}"` })
    assert.equal(out.model.rows.length, 2)
    assert.match(out.model.note, /first 2 of 3 rows/)
    await call('saveSettings', { resultToModel: 'summary' })
  })

  await test('unknown column: the agent gets the real column names', async () => {
    await assert.rejects(tool('nl2sql_query', { sql: `select day, order_count from "${table}"` }), (e) => {
      assert.match(e.message, /no such column/i)
      assert.match(e.message, new RegExp(`columns of ${table}: day, orders`))
      return true
    })
    // The page (source ui) gets the plain database error.
    await assert.rejects(call('runQuery', { datasourceId: ds, sql: `select order_count from "${table}"` }), (e) => !/columns of/.test(e.message))
  })

  await test('schema detail stays below the pruning threshold; the rest is deferred by name', async () => {
    const cols = Array.from({ length: 160 }, (_, i) => `a_rather_long_column_name_number_${i}`)
    const wide = `${cols.join(',')}\n${cols.map((_, i) => i).join(',')}\n`
    const names = []
    for (const n of ['wide_a', 'wide_b', 'wide_c']) {
      const r = await call('importUpload', { datasourceId: ds, fileName: `${n}.csv`, base64: b64(wide), mode: 'create' })
      names.push(r.results[0].table)
    }
    await call('analyzeSchema', { id: ds, refresh: true })
    const text = (await tool('nl2sql_schema', { tables: names })).text
    assert.ok(text.length < 16384, `detail is ${text.length} characters`)
    assert.match(text, new RegExp(`^## ${names[0]}`, 'm'), 'the first table is always described')
    assert.match(text, /not described \(output size limit\): .*call nl2sql_schema again/)
  })

  await test('large knowledge base: the overview inlines the entries relevant to the question', async () => {
    for (let i = 0; i < 35; i++) await call('saveKnowledgeItem', { datasourceId: ds, kind: 'glossary', item: { term: `术语${i}号`, definition: `第 ${i} 个无关定义` } })
    await call('saveKnowledgeItem', { datasourceId: ds, kind: 'glossary', item: { term: '复购率', definition: '30 天内再次下单的用户占比' } })
    const ov = (await tool('nl2sql_schema', { question: '上个月的复购率是多少' })).text
    assert.match(ov, /- 复购率 => 30 天内再次下单的用户占比/)
    assert.match(ov, /most relevant to the question/)
    assert.match(ov, /other terms \(call nl2sql_knowledge action=search for their definitions\): .*术语0号/)
    const plain = (await tool('nl2sql_schema', {})).text
    assert.match(plain, /glossary .*30 of 36 shown/)
  })
} finally {
  await app.close()
}
summary('model context')
