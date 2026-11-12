// Server-side upload staging: stageUpload / stageUploadChunk / importUpload({ uploadId }),
// expiry, chunk validation, and the legacy base64 paths. Needs no external database.
import { existsSync, readdirSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test, summary, assert } from '../lib/assert.mjs'
import { boot } from '../lib/harness.mjs'

const app = await boot({ label: 'svc-uploads' })
const { call, service } = app
const csv = (n) => `day,city,amount\n${Array.from({ length: n }, (_, i) => `2026-01-${String(1 + (i % 28)).padStart(2, '0')},c${i % 3},${i}`).join('\n')}\n`
const b64 = (s) => Buffer.from(s).toString('base64')
const uploadsDir = join(app.dir, 'uploads')
const staged = () => (existsSync(uploadsDir) ? readdirSync(uploadsDir).filter(n => !n.endsWith('.json')) : [])

try {
  await test('stageUpload stores the file 0600 and returns the parseUpload preview', async () => {
    const text = csv(50)
    const r = await call('stageUpload', { fileName: 'sales.csv', base64: b64(text) })
    assert.match(r.uploadId, /^up-[0-9a-f]{10}$/)
    assert.equal(r.fileName, 'sales.csv')
    assert.equal(r.bytes, Buffer.byteLength(text))
    const legacy = await call('parseUpload', { fileName: 'sales.csv', base64: b64(text) })
    assert.deepEqual(r.sheets, legacy)
    assert.equal(r.sheets[0].rowCount, 50)
    const file = join(uploadsDir, r.uploadId)
    assert.ok(existsSync(file))
    assert.equal(statSync(file).mode & 0o777, 0o600)
  })

  await test('importUpload({ uploadId }) imports without re-sending, reuses the parse, deletes the staged file', async () => {
    const r = await call('stageUpload', { fileName: 'orders.csv', base64: b64(csv(30)) })
    // Prove the bytes are not parsed again: the cached parse is used.
    assert.equal(service.stagedParse?.id, r.uploadId)
    const imp = await call('importUpload', { uploadId: r.uploadId, newName: 'orders-ds' })
    assert.equal(imp.results.length, 1)
    assert.equal(imp.results[0].ok, true, JSON.stringify(imp))
    assert.ok(!existsSync(join(uploadsDir, r.uploadId)))
    const q = await call('runQuery', { datasourceId: imp.datasourceId, sql: `SELECT COUNT(*) AS n FROM ${imp.results[0].table}` })
    assert.equal(Number(q.rows[0][0]), 30)
    await assert.rejects(call('importUpload', { uploadId: r.uploadId, newName: 'again' }), /过期|不存在/)
  })

  await test('importUpload reads a staged file from disk when the parse is no longer cached', async () => {
    const r = await call('stageUpload', { fileName: 'cold.csv', base64: b64(csv(12)) })
    service.stagedParse = null
    const imp = await call('importUpload', { uploadId: r.uploadId, newName: 'cold-ds' })
    assert.equal(imp.results[0].ok, true)
    assert.equal(imp.results[0].rows ?? imp.results[0].rowCount ?? 12, 12)
  })

  await test('legacy base64 importUpload still works', async () => {
    const imp = await call('importUpload', { fileName: 'legacy.csv', base64: b64(csv(5)), newName: 'legacy-ds' })
    assert.equal(imp.results[0].ok, true)
  })

  await test('stageUploadChunk: ordered chunks → same preview as stageUpload; import by uploadId', async () => {
    const buf = Buffer.from(csv(400))
    const parts = [buf.subarray(0, 1000), buf.subarray(1000, 3000), buf.subarray(3000)]
    let id
    for (let i = 0; i < parts.length; i++) {
      const r = await call('stageUploadChunk', { uploadId: id, fileName: 'big.csv', index: i, total: parts.length, base64: parts[i].toString('base64') })
      if (i < parts.length - 1) { assert.deepEqual(r, { uploadId: r.uploadId, received: i + 1 }); id = r.uploadId }
      else {
        assert.equal(r.uploadId, id)
        assert.equal(r.bytes, buf.length)
        assert.deepEqual(r.sheets, await call('parseUpload', { fileName: 'big.csv', base64: buf.toString('base64') }))
      }
    }
    const imp = await call('importUpload', { uploadId: id, newName: 'big-ds' })
    assert.equal(imp.results[0].ok, true)
  })

  await test('stageUploadChunk validates order, total, unknown ids and size', async () => {
    const first = await call('stageUploadChunk', { fileName: 'x.csv', index: 0, total: 3, base64: b64('a,b\n') })
    await assert.rejects(call('stageUploadChunk', { uploadId: first.uploadId, index: 2, total: 3, base64: b64('1,2\n') }), /顺序/)
    await assert.rejects(call('stageUploadChunk', { uploadId: first.uploadId, index: 1, total: 4, base64: b64('1,2\n') }), /total/)
    await assert.rejects(call('stageUploadChunk', { uploadId: 'up-0000000000', index: 1, total: 3, base64: b64('1,2\n') }), /不存在|过期/)
    await assert.rejects(call('stageUploadChunk', { uploadId: '../etc', index: 1, total: 3, base64: b64('1,2\n') }), /不存在|过期/)
    await assert.rejects(call('stageUploadChunk', { fileName: 'x.csv', index: 5, total: 3, base64: b64('1') }), /index/)
    // Size: pretend the session already holds almost 200 MB.
    service.uploadSessions.get(first.uploadId).bytes = 200 * 1024 * 1024 - 2
    await assert.rejects(call('stageUploadChunk', { uploadId: first.uploadId, index: 1, total: 3, base64: b64('1,2\n') }), /200 MB/)
    assert.ok(!existsSync(join(uploadsDir, first.uploadId)), 'oversized upload is discarded')
  })

  await test('staged files expire after one hour (cleaned on the next stage and on load)', async () => {
    const r = await call('stageUpload', { fileName: 'old.csv', base64: b64(csv(3)) })
    const old = (Date.now() - 2 * 3600 * 1000) / 1000
    utimesSync(join(uploadsDir, r.uploadId), old, old)
    utimesSync(join(uploadsDir, `${r.uploadId}.json`), old, old)
    const fresh = await call('stageUpload', { fileName: 'new.csv', base64: b64(csv(3)) })
    assert.ok(!staged().includes(r.uploadId))
    assert.ok(staged().includes(fresh.uploadId))
    await assert.rejects(call('importUpload', { uploadId: r.uploadId }), /过期|不存在/)
    // On load.
    utimesSync(join(uploadsDir, fresh.uploadId), old, old)
    assert.equal(await service.cleanupUploads(), 1)
    assert.ok(!staged().includes(fresh.uploadId))
  })

  await test('empty files and bad ids are refused', async () => {
    await assert.rejects(call('stageUpload', { fileName: 'e.csv', base64: '' }), /为空/)
    await assert.rejects(call('importUpload', { uploadId: 'nope' }), /无效/)
  })
  await test('a new file data source gets a clean name and no "undefined" description', async () => {
    const csv = Buffer.from('a,b\n1,2\n').toString('base64')
    const r = await call('importUpload', { fileName: 'sales-2026.csv', base64: csv })
    const ds = (await call('listDatasources')).find(d => d.id === r.datasourceId)
    assert.equal(ds.name, 'sales-2026')
    assert.ok(!String(ds.description ?? '').includes('undefined'), ds.description)
    await assert.rejects(call('importUpload', { base64: csv }), /缺少文件名/)
  })
} finally {
  await app.close()
}
summary('service uploads')
