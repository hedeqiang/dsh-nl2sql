// Service (MySQL): member scopes, viewer role, row-level rules, policy bypasses
// found in review, records storage in SQLite, scheduler, and Lark turn anchoring.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, tempDir } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

// ------------------------------------------------------------------ fakes
// A minimal session controller: each prompt runs `answer(text, sessionId)` (which may call tools),
// then appends user/message, turn events, tool results and an assistant message like DSH does.
function fakeSessions(answer) {
  const sessions = new Map()
  let n = 0
  const agents = { get: (id) => sessions.get(id) }
  const controller = {
    async create() { const id = `sess-${++n}`; const events = []; sessions.set(id, { id, turn: 0, session: { get seq() { return events.length }, snapshotEvents: () => events } }); return { sessionId: id } },
    async rename() {},
    async prompt(req) {
      const s = sessions.get(req.sessionId)
      if (!s) throw Object.assign(new Error('session not found'), { code: 'session/not-found' })
      s.queue = [...(s.queue ?? []), req]
    },
    async wait({ sessionId }) {
      const s = sessions.get(sessionId)
      const ev = s.session.snapshotEvents()
      for (const req of s.queue.splice(0)) {
        const turn = ++s.turn
        ev.push({ seq: ev.length, type: 'user/message', data: { source: { kind: 'user', rpcId: req.requestId }, content: req.content } })
        ev.push({ seq: ev.length, type: 'turn/start', data: { turn } })
        const out = await answer(req.content[0].text, sessionId)
        for (const meta of out.metas ?? []) ev.push({ seq: ev.length, type: 'tool/result', data: { turn, step: 1, meta } })
        ev.push({ seq: ev.length, type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text: out.text }] } } })
        ev.push({ seq: ev.length, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
      }
      return { reason: 'idle' }
    },
    cancel() {},
  }
  return { agents, controller, sessions }
}

let toolsRef
const fake = fakeSessions(async (text, sid) => {
  // The "agent" runs one query per question; the text after "Q:" picks the SQL.
  const m = /Q:(.+?)(?:\n|$)/.exec(text)
  try {
    const out = await toolsRef.get('nl2sql_query').execute({ sql: m ? m[1] : 'select 1', title: 'q' }, { agent: { id: sid } })
    return { text: `答：${out.display.rowCount} 行`, metas: [out.display] }
  } catch (e) {
    return { text: `拒绝：${e.message}` }
  }
})

const app = await boot({ label: 'svc-security', services: { agents: fake.agents, sessionController: fake.controller } })
toolsRef = app.tools
const { call, tool, service } = app
let dsA, dsB
try {
  await test('setup: two data sources', async () => {
    dsA = await call('saveDatasource', { name: 'A', ...MYSQL })
    dsB = await call('saveDatasource', { name: 'B', ...MYSQL })
    await call('analyzeSchema', { id: dsA.id, refresh: true })
    await call('setCurrent', { id: dsB.id })
  })

  // ------------------------------------------------------------ actor scope
  await test('scoped actor never falls back to the page current data source', async () => {
    service.state.sessionActors = { 'lark-s1': { id: 'u1', name: 'U1', kind: 'lark', datasourceIds: [dsA.id], role: 'analyst' } }
    service.state.sessions['lark-s1'] = dsA.id
    const r = await tool('nl2sql_query', { sql: 'select 1 as x' }, { agent: { id: 'lark-s1' } })
    assert.equal(r.display.datasourceName, 'A')
    delete service.state.sessions['lark-s1']
    const r2 = await tool('nl2sql_query', { sql: 'select 1 as x' }, { agent: { id: 'lark-s1' } })
    assert.equal(r2.display.datasourceName, 'A', 'falls back to first in scope, not current B')
    await assert.rejects(tool('nl2sql_query', { sql: 'select 1', datasource: dsB.id }, { agent: { id: 'lark-s1' } }), /无权访问数据源/)
    service.state.sessions['lark-s1'] = dsB.id // stale binding outside scope
    await assert.rejects(tool('nl2sql_schema', {}, { agent: { id: 'lark-s1' } }), /无权访问数据源/)
  })
  await test('results of other data sources cannot be recharted or sent by a scoped actor', async () => {
    const rb = await call('runQuery', { datasourceId: dsB.id, sql: 'select status, count(*) n from blockchain_transactions group by status' })
    service.state.sessions['lark-s1'] = dsA.id
    await assert.rejects(tool('nl2sql_chart', { resultId: rb.resultId, chart: { type: 'pie' } }, { agent: { id: 'lark-s1' } }), /无权访问数据源/)
  })

  // ------------------------------------------------------------ viewer role
  await test('viewer: free SQL refused; verified example SQL and metrics allowed', async () => {
    service.state.sessionActors['view-s'] = { id: 'v', name: 'V', kind: 'lark', datasourceIds: [dsA.id], role: 'viewer' }
    service.state.sessions['view-s'] = dsA.id
    const ex = { agent: { id: 'view-s' } }
    await assert.rejects(tool('nl2sql_query', { sql: 'select count(*) from blockchain_transactions' }, ex), /只读/)
    await call('saveKnowledgeItem', { datasourceId: dsA.id, kind: 'example', item: { question: '各状态笔数', sql: 'select status, count(*) n from blockchain_transactions group by status' } })
    const ok = await tool('nl2sql_query', { sql: 'SELECT status, COUNT(*) n\n FROM blockchain_transactions GROUP BY status' }, ex)
    assert.ok(ok.display.rowCount >= 1)
    await call('saveKnowledgeItem', { datasourceId: dsA.id, kind: 'metric', item: { name: '笔数', expression: 'COUNT(*)', table: 'blockchain_transactions', timeColumn: 'created_at' } })
    const m = await tool('nl2sql_metric', { metric: '笔数' }, ex)
    assert.ok(m.display.rowCount >= 1)
    await assert.rejects(tool('nl2sql_knowledge', { action: 'save_example', question: 'x', sql: 'select 1' }, ex), /只有本机用户或管理员/)
    await assert.rejects(tool('nl2sql_overview', { table: 'blockchain_transactions' }, ex), /只读/)
  })

  // ------------------------------------------------------------ row-level rules
  await test('row rules: injected into every query, nested queries refused, results tagged', async () => {
    service.state.sessionActors['row-s'] = { id: 'r', name: 'R', kind: 'lark', datasourceIds: [dsA.id], role: 'analyst', rowRules: [{ column: 'status', values: ['1'] }] }
    service.state.sessions['row-s'] = dsA.id
    const ex = { agent: { id: 'row-s' } }
    const r = await tool('nl2sql_query', { sql: 'select status, count(*) n from blockchain_transactions group by status' }, ex)
    assert.equal(r.display.rowCount, 1, 'only status=1 visible')
    assert.match(r.display.sql, /`status` IN \('1'\)/)
    await assert.rejects(tool('nl2sql_query', { sql: 'select * from (select * from blockchain_transactions) t' }, ex), /行级权限/)
    await assert.rejects(tool('nl2sql_query', { sql: 'select count(*) from blockchain_transactions union select 1' }, ex), /行级权限/)
    // tables without the column are not affected
    const w = await tool('nl2sql_query', { sql: 'select count(*) c from wallets' }, ex)
    assert.ok(w.display.rowCount === 1)
    // an unfiltered result of the same data source cannot be reused by this actor
    const plain = await call('runQuery', { datasourceId: dsA.id, sql: 'select status, count(*) n from blockchain_transactions group by status' })
    await assert.rejects(tool('nl2sql_drill', { resultId: plain.resultId, mode: 'breakdown', dimension: 'chain_type' }, ex), /行级权限/)
    // drilling its own (filtered) result keeps the rule
    const d = await tool('nl2sql_drill', { resultId: r.display.resultId, mode: 'breakdown', dimension: 'chain_type' }, ex)
    assert.match(d.display.sql, /`status` IN \('1'\)/)
  })

  // ------------------------------------------------------------ policy bypasses (review)
  await test('policy: MySQL `1--1` and spaced dots do not hide denied tables / catalogs', async () => {
    await call('savePolicy', { id: dsA.id, policy: { mode: 'deny', tables: ['callback_*'], hiddenColumns: [], maskedColumns: ['blockchain_transactions.from_address'] } })
    const q = (sql) => call('runQuery', { datasourceId: dsA.id, sql })
    await assert.rejects(q('SELECT 1--1, t.* FROM callback_configs t'), /无权查询表/)
    await assert.rejects(q('SELECT 1--1, TABLE_NAME FROM information_schema.tables'), /系统目录/)
    await assert.rejects(q('SELECT TABLE_NAME FROM information_schema . tables'), /系统目录/)
    await assert.rejects(q('SELECT * FROM callback_not_analyzed_yet'), /无权查询表/)
  })
  await test('policy: masked column usable only as a plain select item', async () => {
    const q = (sql) => call('runQuery', { datasourceId: dsA.id, sql })
    await assert.rejects(q("SELECT CONCAT(from_address, '') AS n FROM blockchain_transactions"), /脱敏/)
    await assert.rejects(q('SELECT from_address AS x FROM blockchain_transactions'), /脱敏/)
    const ok = await q('SELECT from_address FROM blockchain_transactions LIMIT 1')
    assert.ok(ok.columns[0].masked, 'plain select is masked')
    const where = await q("SELECT COUNT(*) FROM blockchain_transactions WHERE from_address <> ''")
    assert.equal(where.rowCount, 1, 'masked column allowed outside the select list')
    await call('savePolicy', { id: dsA.id, policy: { mode: 'all' } })
  })

  // ------------------------------------------------------------ security review 2
  await test('row rules: MySQL `1--1) OR (1` cannot break out of the injected predicate', async () => {
    const ex = { agent: { id: 'row-s' } }
    await assert.rejects(tool('nl2sql_query', { sql: 'select status, count(*) n from blockchain_transactions WHERE 1--1) OR (1\ngroup by status' }, ex), /行级权限/)
    // a trailing line comment cannot swallow the injected WHERE either
    const r = await tool('nl2sql_query', { sql: 'select status, count(*) n from blockchain_transactions -- note\ngroup by status' }, ex)
    assert.equal(r.display.rowCount, 1, 'still only status=1')
  })
  await test('guard: `--<NBSP>` / `--\\x01` lexer confusion refused before running', async () => {
    await call('savePolicy', { id: dsA.id, policy: { mode: 'deny', tables: ['callback_*'], hiddenColumns: [], maskedColumns: [] } })
    const q = (sql) => call('runQuery', { datasourceId: dsA.id, sql })
    await assert.rejects(q("SELECT 1 AS \u00a0 FROM wallets HAVING 0--\u00a0 UNION ALL SELECT concat('LEAK:', count(*)) FROM callback_configs"), /U\+00A0/)
    await assert.rejects(q("SELECT 1 AS x --\u0001 '\nUNION ALL SELECT count(*) FROM callback_configs -- '"), /U\+0001/)
    await call('savePolicy', { id: dsA.id, policy: { mode: 'all' } })
  })
  await test('nl2sql_overview runs as the actor: row rules applied and audited', async () => {
    const ov = await tool('nl2sql_overview', { table: 'blockchain_transactions' }, { agent: { id: 'row-s' } })
    const ok = ov.display.results.filter(r => !r.error)
    assert.ok(ok.length > 0)
    for (const r of ok) assert.match(r.sql, /`status` IN \('1'\)/, r.title)
    const resultIds = new Set(ok.map(r => r.resultId))
    const hist = service.records.list('history', { limit: 200, filter: h => resultIds.has(h.resultId) })
    assert.ok(hist.length > 0, 'overview queries are audited')
    for (const h of hist) assert.equal(h.actor?.id, 'r', 'audited as the actor, not the owner')
  })
  await test('results: another actor\'s row-filtered result (different rules) is refused', async () => {
    service.state.sessionActors['row-s0'] = { id: 'r0', name: 'R0', kind: 'lark', datasourceIds: [dsA.id], role: 'analyst', rowRules: [{ column: 'status', values: ['0'] }] }
    service.state.sessions['row-s0'] = dsA.id
    const own = await tool('nl2sql_query', { sql: 'select status, count(*) n from blockchain_transactions group by status' }, { agent: { id: 'row-s' } })
    await assert.rejects(tool('nl2sql_chart', { resultId: own.display.resultId, chart: { type: 'table' } }, { agent: { id: 'row-s0' } }), /行级权限/)
    // the owner of the rules may still use it
    const mine = await tool('nl2sql_chart', { resultId: own.display.resultId, chart: { type: 'table' } }, { agent: { id: 'row-s' } })
    assert.ok(mine.display.resultId)
    // a legacy result tagged rowPolicy but without a signature is refused
    const legacy = { ...service.getResult(own.display.resultId), resultId: 'r-legacy-nosig' }
    delete legacy.rowRulesSig
    service.remember(legacy)
    await assert.rejects(tool('nl2sql_chart', { resultId: 'r-legacy-nosig', chart: { type: 'table' } }, { agent: { id: 'row-s' } }), /行级权限/)
  })
  await test('datasourceCatalog lists only policy-visible tables', async () => {
    await call('savePolicy', { id: dsA.id, policy: { mode: 'allow', tables: ['wallets'], hiddenColumns: [], maskedColumns: [] } })
    const cat = await service.datasourceCatalog([service.findDatasource(dsA.id)])
    assert.match(cat, /wallets/)
    assert.doesNotMatch(cat, /blockchain_transactions|callback_/)
    await call('savePolicy', { id: dsA.id, policy: { mode: 'all' } })
  })
  await test('nl2sql_datasource use from a bot session does not move the page current data source', async () => {
    service.state.sessionActors['bot-s'] = { id: 'b', name: 'Bot', kind: 'lark', datasourceIds: [dsA.id, dsB.id], role: 'analyst' }
    await call('setCurrent', { id: dsB.id })
    await tool('nl2sql_datasource', { action: 'use', datasource: dsA.id }, { agent: { id: 'bot-s' } })
    assert.equal(service.state.sessions['bot-s'], dsA.id, 'session bound')
    assert.equal(service.state.current, dsB.id, 'page current unchanged')
    // the page RPC still sets current
    await call('bindSession', { sessionId: 'page-s', datasourceId: dsA.id })
    assert.equal(service.state.current, dsA.id)
    await call('setCurrent', { id: dsB.id })
  })

  // ------------------------------------------------------------ records in SQLite
  await test('history / feedback / deliveries live in SQLite, not state.json', async () => {
    const h = await call('listHistory', { limit: 5 })
    assert.ok(h.length >= 1)
    const r = await call('runQuery', { datasourceId: dsA.id, sql: 'select 1 as x' })
    const fb = await call('submitFeedback', { resultId: r.resultId, rating: 'down', comment: 'c' })
    assert.equal((await call('listFeedback', { status: 'open' })).some(f => f.id === fb.id), true)
    await call('resolveFeedback', { id: fb.id, status: 'resolved' })
    assert.equal((await call('listFeedback', { status: 'open' })).some(f => f.id === fb.id), false)
    await service.save()
    const state = JSON.parse(readFileSync(join(app.dir, 'state.json'), 'utf8'))
    for (const k of ['history', 'feedback', 'deliveries', 'alertEvents', 'adminLog', 'evalRuns', 'schemaChanges', 'dashboard', 'dashboardFilters']) assert.equal(k in state, false, `${k} not in state.json`)
  })

  // ------------------------------------------------------------ scheduler
  await test('alerts: preview does not save; due times; status; manual check vs tick lock', async () => {
    const before = (await call('listAlerts')).length
    const p = await call('previewAlert', { name: 'x', datasourceId: dsA.id, source: 'sql', sql: 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d', condition: { type: 'threshold', op: '>', value: -1 } })
    assert.equal(p.triggered, true)
    assert.equal((await call('listAlerts')).length, before, 'preview saved nothing')
    const a = await call('saveAlert', { name: 'daily', datasourceId: dsA.id, source: 'sql', sql: 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d', condition: { type: 'threshold', op: '>', value: 1e12 }, every: 'day', at: '00:00' })
    const st = await call('schedulerStatus')
    assert.ok(st.nextAlerts.some(x => x.id === a.id && x.dueAt <= Date.now()), 'never-checked daily alert is due (catch-up)')
    await service.tickAlerts(new Date())
    const st2 = await call('schedulerStatus')
    assert.ok(st2.lastTickAt > 0)
    assert.ok(st2.nextAlerts.find(x => x.id === a.id).dueAt > Date.now(), 'after the tick it is due tomorrow')
  })

  // ------------------------------------------------------------ Lark turn anchoring
  await test('lark: each message gets its own turn answer, also for concurrent messages', async () => {
    // New groups default to registered members only; this test is about turn routing, so allow everyone.
    await call('saveUser', { kind: 'chat', name: 'G', larkChatId: 'oc_g', role: 'analyst', allDatasources: true, chatPolicy: { askers: 'all' } })
    service.larkCreds = { appId: 'cli_x', appSecret: 's', domain: 'feishu', baseUrl: 'http://127.0.0.1:1' }
    const replies = []
    service.state.larkBot = { enabled: false, sessionScope: 'chat', allowP2p: true }
    // capture replies: patch module-level helpers through the service hook
    const origInner = service.handleLarkMessageInner.bind(service)
    service.handleLarkMessageInner = (m, text, conf, creds, reply) => origInner(m, text, conf, creds, reply)
    const turnBy = (id) => service.collectTurnByRequest(Object.values(service.state.larkSessions)[0].sessionId, `lark-${id}`)
    const msg = (id, sql) => ({ messageId: id, chatId: 'oc_g', chatType: 'group', text: `Q:${sql}`, mentionedBot: true, sender: { openId: 'ou_z' } })
    await Promise.all([
      service.handleLarkMessage(msg('m1', 'select 1 as a')),
      service.handleLarkMessage(msg('m2', 'select status from blockchain_transactions group by status')),
    ])
    const a1 = await turnBy('m1')
    const a2 = await turnBy('m2')
    assert.match(a1.text, /1 行/)
    assert.notEqual(a1.resultIds[0], a2.resultIds[0], 'different results per message')
    assert.equal(a1.resultIds.length, 1)
    void replies
  })
} finally {
  await app.close()
}
summary('service security')
