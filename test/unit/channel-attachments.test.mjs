// Large results in IM messages: how many rows a message shows, the "shown N of M" note,
// and the full-data Excel attachment (Lark app bot file message, Telegram sendDocument).
import http from 'node:http'
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { buildCard, sendMessage } = await plugin('channels/lark.js')
const { omittedNote, needsAttachment } = await plugin('channels/message.js')
const { renderMarkdown } = await plugin('channels/dingtalk.js')

const big = (n) => ({ title: '各币种提现', columns: [{ name: 'asset', kind: 'text' }, { name: 'n', kind: 'number' }], rows: Array.from({ length: n }, (_, i) => [`T${i}`, i]), rowCount: n, chart: { type: 'table' } })

await test('notes: nothing omitted → no note; omitted → explicit note', () => {
  assert.equal(omittedNote(big(8), 8), '')
  assert.match(omittedNote(big(122), 50), /共 122 行，消息中显示前 50 行；完整数据可在数据问答页面查看或导出 Excel/)
  assert.match(omittedNote(big(122), 50, { attached: true }), /完整数据见附件 Excel/)
  assert.equal(needsAttachment(big(31), 50), false)
  assert.equal(needsAttachment(big(122), 50), true)
})

await test('lark card: up to 50 rows paged in a table, with a note when more', () => {
  const c31 = buildCard({ title: 't', results: [big(31)] })
  const t31 = c31.body.elements.find(e => e.tag === 'table')
  assert.equal(t31.rows.length, 31, 'all 31 rows of the real Bitget result fit')
  assert.ok(!JSON.stringify(c31).includes('消息中显示前'), 'no omission note')
  const c122 = buildCard({ title: 't', results: [big(122)] })
  assert.equal(c122.body.elements.find(e => e.tag === 'table').rows.length, 50)
  assert.match(JSON.stringify(c122), /共 122 行，消息中显示前 50 行/)
  assert.ok(Buffer.byteLength(JSON.stringify(c122)) < 28000)
})

await test('lark card: wide/long cells shrink rows to fit the 28 KB card limit, note stays accurate', () => {
  const wide = { title: 'w', columns: Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, kind: 'text' })), rows: Array.from({ length: 300 }, () => Array.from({ length: 8 }, () => 'x'.repeat(78))), rowCount: 300, chart: { type: 'table' } }
  const c = buildCard({ title: 'w', results: [wide] })
  const n = c.body.elements.find(e => e.tag === 'table').rows.length
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 28000, 'fits')
  assert.match(JSON.stringify(c), new RegExp(`消息中显示前 ${n} 行`))
})

await test('dingtalk text says how many rows are shown', () => {
  const md = renderMarkdown({ title: 't', results: [big(31)] }).chunks.join('')
  assert.match(md, /共 31 行，仅显示前 10 行；完整数据可在数据问答页面查看或导出 Excel/)
})

// --------------------------------------------------------------- fake Lark API
const calls = []
const srv = http.createServer(async (req, res) => {
  let body = Buffer.alloc(0)
  for await (const c of req) body = Buffer.concat([body, c])
  calls.push({ url: req.url, ct: req.headers['content-type'] ?? '', body })
  res.setHeader('content-type', 'application/json')
  if (req.url.startsWith('/open-apis/auth/v3/tenant_access_token')) return res.end(JSON.stringify({ code: 0, tenant_access_token: 't-1', expire: 7200 }))
  if (req.url.startsWith('/open-apis/im/v1/files')) return res.end(JSON.stringify({ code: 0, data: { file_key: 'file_v3_abc' } }))
  if (req.url.startsWith('/open-apis/im/v1/messages')) return res.end(JSON.stringify({ code: 0, data: { message_id: `om_${calls.length}` } }))
  res.end(JSON.stringify({ code: 404 }))
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`

try {
  await test('lark app bot: card says "see attachment", then the xlsx is uploaded and sent as a file message', async () => {
    calls.length = 0
    const buffer = Buffer.from('PK fake xlsx')
    const sent = await sendMessage({ type: 'lark_app', appId: 'cli_x', receiveIdType: 'chat_id', receiveId: 'oc_1', baseUrl: base }, { appSecret: 's' }, { title: '充提', results: [big(122)], attachment: { buffer, fileName: '充提.xlsx', resultIndexes: [0] } })
    assert.equal(sent.files, 1)
    const msgs = calls.filter(c => c.url.startsWith('/open-apis/im/v1/messages')).map(c => JSON.parse(c.body.toString()))
    assert.equal(msgs[0].msg_type, 'interactive')
    assert.match(msgs[0].content, /完整数据见附件 Excel/)
    assert.equal(msgs[1].msg_type, 'file')
    assert.deepEqual(JSON.parse(msgs[1].content), { file_key: 'file_v3_abc' })
    const up = calls.find(c => c.url.startsWith('/open-apis/im/v1/files'))
    assert.match(up.ct, /multipart\/form-data/)
    const form = up.body.toString('latin1')
    assert.match(form, /name="file_type"\r\n\r\nxls/)
    assert.match(form, /PK fake xlsx/)
  })

  await test('lark: attachment failure does not fail the push; it is reported as a warning', async () => {
    const s2 = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); if (req.url.includes('tenant_access_token')) return res.end(JSON.stringify({ code: 0, tenant_access_token: 't', expire: 7200 })); if (req.url.includes('/files')) return res.end(JSON.stringify({ code: 234007, msg: 'App does not enable bot feature.' })); res.end(JSON.stringify({ code: 0, data: { message_id: 'om' } })) })
    await new Promise(r => s2.listen(0, '127.0.0.1', r))
    try {
      const sent = await sendMessage({ type: 'lark_app', appId: 'cli_y', receiveIdType: 'chat_id', receiveId: 'oc_1', baseUrl: `http://127.0.0.1:${s2.address().port}` }, { appSecret: 's' }, { title: 't', results: [big(80)], attachment: { buffer: Buffer.from('x'), fileName: 'a.xlsx', resultIndexes: [0] } })
      assert.equal(sent.files, 0)
      assert.match(sent.warning, /附件发送失败/)
    } finally { s2.close() }
  })
} finally {
  srv.close()
}
summary('channel attachments')
