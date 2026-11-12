// Feature "present" on MySQL: dashboard PPTX / results PPTX, dashboard long image, sending the
// image to a Lark app bot and a Telegram bot (fake HTTP servers), and Lark Bitable sync
// (fields, replace / append, ≤ 500 records per call, scheduler job, run records) against a fake Open API.
import http from 'node:http'
import { test, skipFile, summary, assert } from '../lib/assert.mjs'
import { MYSQL, mysqlUnavailable, plugin } from '../lib/env.mjs'
import { boot } from '../lib/harness.mjs'

const down = await mysqlUnavailable()
if (down) skipFile(down)

const { unzip } = await plugin('service/pptx.js')
const { clearTenantTokenCache } = await plugin('channels/lark.js')

// ------------------------------------------------------------ fake Lark + Telegram
const lark = { calls: [], fields: [], records: [], nextId: 1, fail: null }
const tg = { calls: [] }
function readBody(req) { return new Promise(r => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks))) }) }
const server = http.createServer(async (req, res) => {
  const raw = await readBody(req)
  const u = new URL(req.url, 'http://x')
  const send = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const ctype = req.headers['content-type'] ?? ''
  const json = ctype.includes('json') && raw.length ? JSON.parse(raw.toString()) : undefined
  if (u.pathname.startsWith('/bot')) {
    tg.calls.push({ path: u.pathname, ctype, bytes: raw.length, hasPng: raw.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47])) })
    if (u.pathname.endsWith('/sendPhoto') || u.pathname.endsWith('/sendDocument')) return send({ ok: true, result: { message_id: 77 } })
    return send({ ok: false, error_code: 404, description: 'Not Found' }, 404)
  }
  lark.calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, json, multipart: ctype.startsWith('multipart/'), bytes: raw.length })
  if (u.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
    if (json.app_secret !== 'sec') return send({ code: 10014, msg: 'app secret invalid' })
    return send({ code: 0, tenant_access_token: 't-ok', expire: 7200 })
  }
  if (req.headers.authorization !== 'Bearer t-ok') return send({ code: 99991663, msg: 'invalid token' })
  if (u.pathname === '/open-apis/im/v1/images') return send({ code: 0, data: { image_key: 'img_1' } })
  if (u.pathname === '/open-apis/im/v1/messages') return send({ code: 0, data: { message_id: 'om_img' } })
  const m = u.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/(fields|records)(?:\/(batch_create|batch_delete))?$/)
  if (!m) return send({ code: 404, msg: 'not found' }, 404)
  if (m[1] !== 'appTok12345') return send({ code: 1254040, msg: 'BaseTokenNotFound' })
  if (lark.fail === m[3] + (m[4] ?? '')) return send({ code: 1254302, msg: 'Permission denied.' }, 403)
  const pageSize = Number(u.searchParams.get('page_size') ?? 20)
  const start = Number(u.searchParams.get('page_token') || 0)
  if (m[3] === 'fields' && req.method === 'GET') {
    const items = lark.fields.slice(start, start + Math.min(pageSize, 2)) // force paging
    const next = start + items.length
    return send({ code: 0, data: { items, has_more: next < lark.fields.length, page_token: next < lark.fields.length ? String(next) : undefined, total: lark.fields.length } })
  }
  if (m[3] === 'fields' && req.method === 'POST') {
    if (lark.fields.some(f => f.field_name === json.field_name)) return send({ code: 1254014, msg: 'FieldNameDuplicated' })
    const f = { field_id: `fld${lark.fields.length}`, field_name: json.field_name, type: json.type, property: json.property ?? null }
    lark.fields.push(f)
    return send({ code: 0, data: { field: f } })
  }
  if (m[3] === 'records' && !m[4]) {
    assert.ok(pageSize <= 500)
    const items = lark.records.slice(start, start + pageSize)
    const next = start + items.length
    return send({ code: 0, data: { items, has_more: next < lark.records.length, page_token: next < lark.records.length ? String(next) : undefined, total: lark.records.length } })
  }
  if (m[4] === 'batch_create') {
    if (json.records.length > 500) return send({ code: 1254104, msg: 'RecordAddOnceExceedLimit' })
    for (const r of json.records) {
      for (const [k, v] of Object.entries(r.fields)) {
        const f = lark.fields.find(x => x.field_name === k)
        if (!f) return send({ code: 1254045, msg: `FieldNameNotFound ${k}` })
        if (f.type === 2 && typeof v !== 'number') return send({ code: 1254061, msg: 'NumberFieldConvFail' })
        if (f.type === 5 && typeof v !== 'number') return send({ code: 1254064, msg: 'DatetimeFieldConvFail' })
        if (f.type === 1 && typeof v !== 'string') return send({ code: 1254060, msg: 'TextFieldConvFail' })
      }
      lark.records.push({ record_id: `rec${lark.nextId++}`, fields: r.fields })
    }
    return send({ code: 0, data: { records: [] } })
  }
  if (m[4] === 'batch_delete') {
    if (json.records.length > 500) return send({ code: 1254002, msg: 'too many' })
    const del = new Set(json.records)
    lark.records = lark.records.filter(r => !del.has(r.record_id))
    return send({ code: 0, data: { records: json.records.map(id => ({ deleted: true, record_id: id })) } })
  }
  send({ code: 404, msg: 'unhandled' }, 404)
})
// Long renders between calls: keep idle sockets open longer than the default 5 s (avoids keep-alive races).
server.keepAliveTimeout = 120000
await new Promise(r => server.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${server.address().port}`

const app = await boot({ label: 'present' })
const { call, service } = app
service.config.larkBaseUrl = baseUrl
clearTenantTokenCache()
let ds, w1, w2, w3, larkCh, tgCh, hookCh

try {
  await test('setup: data source, dashboard widgets, channels', async () => {
    ds = await call('saveDatasource', { type: 'mysql', name: 'my', ...MYSQL })
    await call('saveSettings', { maxRows: 5000 })
    w1 = await call('pinWidget', { title: '每日笔数', datasourceId: ds.id, sql: 'select date(created_at) d, count(*) n from blockchain_transactions group by d order by d', chart: { type: 'line', x: 'd', y: ['n'] } })
    w2 = await call('pinWidget', { title: '按链类型', datasourceId: ds.id, sql: 'select chain_type, count(*) n, sum(amount) amt from blockchain_transactions group by chain_type', chart: { type: 'table' }, width: 'full' })
    w3 = await call('pinWidget', { title: '总笔数', datasourceId: ds.id, sql: 'select count(*) total from blockchain_transactions', chart: { type: 'kpi', y: ['total'] } })
    larkCh = await call('saveChannel', { name: '飞书应用', type: 'lark_app', config: { appId: 'cli_a1b2c3d4e5f60718', receiveIdType: 'chat_id', receiveId: 'oc_1' }, secrets: { appSecret: 'sec' } })
    tgCh = await call('saveChannel', { name: 'TG', type: 'telegram_bot', config: { chatId: '-1001234567890', apiBase: baseUrl }, secrets: { botToken: '123456789:AAHabcdefghijklmnopqrstuvwxyz0123456' } })
    hookCh = await call('saveChannel', { name: '群机器人', type: 'lark_webhook', secrets: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc-123' } })
  })

  await test('exportDashboardPptx: title + one slide per widget, chart image, table, notes with SQL', async () => {
    const out = await call('exportDashboardPptx', {})
    assert.match(out.fileName, /\.pptx$/)
    assert.equal(out.slides, 4)
    const parts = unzip(Buffer.from(out.base64, 'base64'))
    assert.equal([...parts.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length, 4)
    assert.deepEqual([...parts.keys()].filter(k => k.startsWith('ppt/media/')), ['ppt/media/image1.png'])
    assert.match(parts.get('ppt/slides/slide1.xml').toString(), /数据源：my/)
    assert.match(parts.get('ppt/slides/slide3.xml').toString(), /<a:tbl>/)
    assert.match(parts.get('ppt/notesSlides/notesSlide1.xml').toString(), /blockchain_transactions/)
  })

  await test('exportResultsPptx from resultIds; expired ids refused', async () => {
    const r = await call('runWidget', { id: w1.id })
    const out = await call('exportResultsPptx', { resultIds: [r.resultId], title: '我的报告' })
    assert.match(out.fileName, /^我的报告-/)
    assert.equal(out.slides, 2)
    await assert.rejects(call('exportResultsPptx', { resultIds: ['r-nope'] }), /过期/)
  })

  await test('exportDashboardImage: one tall PNG', async () => {
    const out = await call('exportDashboardImage', { width: 900 })
    assert.equal(out.mediaType, 'image/png')
    const png = Buffer.from(out.base64, 'base64')
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png.readUInt32BE(16), 1800, '2x width')
    assert.ok(png.readUInt32BE(20) > 1000)
    assert.equal(out.widgets, 3)
  })

  await test('sendDashboardImage: Lark app (upload + image message), Telegram sendPhoto, webhook refused', async () => {
    lark.calls.length = 0
    const r = await call('sendDashboardImage', { channelId: larkCh.id })
    assert.equal(r.ok, true)
    assert.equal(r.messageId, 'om_img')
    const up = lark.calls.find(c => c.path === '/open-apis/im/v1/images')
    assert.ok(up.multipart && up.bytes > 10000)
    const msg = lark.calls.find(c => c.path === '/open-apis/im/v1/messages')
    assert.deepEqual(msg.query, { receive_id_type: 'chat_id' })
    assert.equal(msg.json.msg_type, 'image')
    assert.equal(JSON.parse(msg.json.content).image_key, 'img_1')
    const t = await call('sendDashboardImage', { channelId: tgCh.id })
    assert.equal(t.messageId, '77')
    assert.match(tg.calls.at(-1).path, /\/bot123456789:[^/]+\/sendPhoto$/)
    assert.ok(tg.calls.at(-1).hasPng)
    await assert.rejects(call('sendDashboardImage', { channelId: hookCh.id }), (e) => e.code === 'nl2sql/unsupported' && /不支持发送图片/.test(e.message))
    const dl = await call('listDeliveries', {})
    assert.ok(dl.some(d => d.title.includes('长图') && d.status === 'ok' && d.images === 1))
  })

  let sync
  await test('saveBitableSync validates channel, tokens and source', async () => {
    await assert.rejects(call('saveBitableSync', { name: 'x', channelId: hookCh.id, appToken: 'appTok12345', tableId: 'tblAbc123', source: { widgetId: w2.id } }), (e) => e.field === 'channelId')
    await assert.rejects(call('saveBitableSync', { name: 'x', channelId: larkCh.id, appToken: 'a b', tableId: 'tblAbc123', source: { widgetId: w2.id } }), (e) => e.field === 'appToken')
    await assert.rejects(call('saveBitableSync', { name: 'x', channelId: larkCh.id, appToken: 'appTok12345', tableId: 'xx', source: { widgetId: w2.id } }), (e) => e.field === 'tableId')
    await assert.rejects(call('saveBitableSync', { name: 'x', channelId: larkCh.id, appToken: 'appTok12345', tableId: 'tblAbc123', source: { datasourceId: ds.id, sql: 'delete from blockchain_transactions' } }), (e) => e.field === 'sql')
    sync = await call('saveBitableSync', { name: '链类型同步', channelId: larkCh.id, appToken: 'appTok12345', tableId: 'tblAbc123', source: { widgetId: w2.id }, mode: 'replace', schedule: { time: '7:30', enabled: false } })
    assert.equal(sync.schedule.time, '07:30')
    assert.equal(sync.mode, 'replace')
    assert.equal((await call('listBitableSyncs')).length, 1)
  })

  await test('runBitableSync (widget, replace): creates missing fields by kind, replaces records', async () => {
    lark.fields = [{ field_id: 'fld0', field_name: '多行文本', type: 1 }, { field_id: 'fldx', field_name: 'chain_type', type: 1 }, { field_id: 'fldy', field_name: 'other', type: 1 }]
    lark.records = Array.from({ length: 1203 }, (_, i) => ({ record_id: `old${i}`, fields: {} }))
    lark.calls.length = 0
    const run = await call('runBitableSync', { id: sync.id })
    assert.equal(run.status, 'ok', run.error)
    assert.deepEqual(run.fieldsCreated, ['n', 'amt'])
    assert.equal(lark.fields.find(f => f.field_name === 'n').type, 2)
    assert.equal(run.deleted, 1203)
    const dels = lark.calls.filter(c => c.path.endsWith('/batch_delete'))
    assert.deepEqual(dels.map(c => c.json.records.length), [500, 500, 203])
    assert.ok(lark.records.every(r => !String(r.record_id).startsWith('old')))
    assert.equal(lark.records.length, run.created)
    assert.ok(run.created > 0)
    assert.ok(lark.records.every(r => typeof r.fields.n === 'number' && typeof r.fields.chain_type === 'string'))
    const list = await call('listBitableSyncs')
    assert.equal(list[0].lastStatus, 'ok')
    assert.equal(list[0].runs.length, 1)
  })

  let sqlSync
  await test('SQL source, append mode: datetime fields, batches of ≤ 500', async () => {
    lark.fields = []
    lark.records = [{ record_id: 'keep1', fields: {} }]
    sqlSync = await call('saveBitableSync', { name: '明细追加', channelId: larkCh.id, appToken: 'appTok12345', tableId: 'tblAbc123', source: { datasourceId: ds.id, sql: 'select a.id, a.created_at, a.chain_type from blockchain_transactions a cross join (select 1 k union all select 2 union all select 3) b' }, mode: 'append' })
    lark.calls.length = 0
    const run = await call('runBitableSync', { id: sqlSync.id })
    assert.equal(run.status, 'ok', run.error)
    assert.equal(run.created, run.rows)
    assert.ok(run.rows > 500)
    assert.equal(lark.fields.find(f => f.field_name === 'created_at').type, 5)
    const sizes = lark.calls.filter(c => c.path.endsWith('/batch_create')).map(c => c.json.records.length)
    assert.ok(sizes.every(n => n <= 500) && sizes.length === Math.ceil(run.rows / 500))
    assert.ok(lark.records.some(r => r.record_id === 'keep1'), 'append keeps existing records')
    assert.ok(!lark.calls.some(c => c.path.endsWith('/batch_delete')))
    assert.equal(typeof lark.records[1].fields.created_at, 'number')
    const hist = await call('listHistory', { source: 'bitable' })
    assert.ok(hist.length >= 1, 'query audited through runQuery')
  })

  await test('errors: Lark permission hint, run recorded as error', async () => {
    lark.fail = 'recordsbatch_create'
    await assert.rejects(call('runBitableSync', { id: sqlSync.id }), (e) => e.code === 'nl2sql/bitable' && /写入记录失败/.test(e.message) && /添加文档应用/.test(e.message))
    lark.fail = null
    const runs = await call('listBitableRuns', { syncId: sqlSync.id })
    assert.equal(runs[0].status, 'error')
    assert.equal((await call('listBitableSyncs')).find(s => s.id === sqlSync.id).lastStatus, 'error')
  })

  await test('scheduler job: due once per daily slot when enabled', async () => {
    await call('saveBitableSync', { id: sync.id, schedule: { time: '00:00', enabled: true } })
    const s = service.state.bitableSyncs.find(x => x.id === sync.id)
    s.lastRunAt = 0
    s.createdAt = 0
    const jobs = service.schedulerJobs(new Date()).filter(j => j.id.startsWith('bitable:'))
    assert.deepEqual(jobs.map(j => j.id), [`bitable:${sync.id}`])
    assert.equal(jobs[0].due(new Date()), true)
    await jobs[0].run()
    const again = service.schedulerJobs(new Date()).find(j => j.id === `bitable:${sync.id}`)
    assert.equal(again.due(new Date()), false)
    const runs = await call('listBitableRuns', { syncId: sync.id })
    assert.equal(runs[0].trigger, 'schedule')
  })

  await test('deleteBitableSync', async () => {
    await call('deleteBitableSync', { id: sqlSync.id })
    assert.deepEqual((await call('listBitableSyncs')).map(s => s.id), [sync.id])
  })
} finally {
  await app.close()
  server.close()
}
summary()
