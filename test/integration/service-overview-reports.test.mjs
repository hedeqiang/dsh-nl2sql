// Service: nl2sql_overview per engine and scheduled reports through a fake `schedule` service.
// Ported from an earlier standalone script (ES overview is skipped when Elasticsearch is not running;
// PostgreSQL uses a throwaway fixture schema instead of the former nl2sql_demo schema).
import { test, skip, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, PG, ES, mysqlUnavailable, pgUnavailable, esUnavailable, createPgFixture } from '../lib/env.mjs'
import { boot, fakeSchedule } from '../lib/harness.mjs'

const down = { mysql: await mysqlUnavailable(), postgres: await pgUnavailable(), elasticsearch: await esUnavailable() }
if (down.mysql && down.postgres) skipFile(`${down.mysql}; ${down.postgres}`)

const pgFix = down.postgres ? null : await createPgFixture()
const schedule = fakeSchedule()
const app = await boot({ label: 'svc-overview', services: { schedule } })
const { call, tool } = app
const saved = {}
try {
  for (const [type, form, table] of [
    ['mysql', { ...MYSQL }, 'blockchain_transactions'],
    ['postgres', { ...PG, schemas: pgFix?.schema }, `${pgFix?.schema}.orders`],
    ['elasticsearch', { host: ES.host, port: ES.port, database: 'app-*' }, 'app-logs'],
  ]) {
    await test(`${type}: nl2sql_overview produces charts`, async () => {
      if (down[type]) skip(down[type])
      const ds = await call('saveDatasource', { type, name: type, ...form })
      saved[type] = ds
      await call('analyzeSchema', { id: ds.id, refresh: true })
      const o = await tool('nl2sql_overview', { table, datasource: ds.id })
      const results = o.display.results
      assert.ok(results.length >= 3, `only ${results.length} charts`)
      const errors = results.filter((r) => r.error).map((r) => `${r.title}: ${r.error}`)
      assert.deepEqual(errors, [])
      assert.ok(results.some((r) => r.chart?.type === 'kpi'), 'has a KPI')
      assert.ok(results.some((r) => r.chart?.type === 'line'), 'has a daily trend')
      for (const r of results) assert.equal(typeof r.rowCount, 'number')
    })
  }

  await test('overview of an unknown table is refused', async () => {
    const ds = saved.mysql ?? saved.postgres
    await assert.rejects(tool('nl2sql_overview', { table: 'no_such_table_xyz', datasource: ds.id }), /表不存在或无权访问/)
  })

  await test('reports: create → schedule entry with daily timing and nl2sql preset', async () => {
    const ds = saved.postgres ?? saved.mysql
    const rep = await call('saveReport', { datasourceId: ds.id, title: '订单日报', question: '昨天订单量、GMV 及按状态分布', period: 'daily', time: '09:00' })
    assert.match(rep.id, /^rp-/)
    const e = schedule.sched.get(rep.scheduleId)
    assert.ok(e, 'schedule created')
    assert.equal(e.timing.kind, 'daily')
    assert.equal(e.timing.daily.time, '09:00:00')
    assert.deepEqual(e.target, { kind: 'new_once', create: { agentPreset: 'nl2sql' } })
    assert.match(e.prompt, /\[数据问答定时报告\] 订单日报/)
    assert.ok(e.prompt.includes(`datasource=${ds.id}`))
    assert.match(e.prompt, /日环比/)

    await call('saveReport', { ...rep, period: 'weekly', weekdays: [1, 5], time: '08:30' })
    assert.deepEqual(e.timing, { kind: 'weekly', weekly: { time: '08:30:00', time_zone: rep.timeZone, weekdays: [1, 5] } })
    assert.match(e.prompt, /周环比/)

    await call('setReportActive', { id: rep.id, active: false })
    const list = await call('listReports')
    assert.deepEqual(list.map((r) => [r.title, r.status, r.datasourceName]), [['订单日报', 'paused', ds.name]])

    const ran = await call('runReportNow', { id: rep.id })
    assert.equal(ran.id, rep.scheduleId)
    await call('deleteReport', { id: rep.id })
    assert.equal(schedule.sched.size, 0)
    assert.deepEqual(await call('listReports'), [])
  })
} finally {
  await app.close()
  await pgFix?.drop()
}
summary('service overview & reports')
