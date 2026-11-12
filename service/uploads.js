/**
 * Nl2SqlService methods: uploads.
 * Mixed into the service prototype by index.js; `this` is the service.
 *
 * Files can be sent once (base64 in parseUpload / importUpload), or staged on
 * the server: stageUpload (one request) or stageUploadChunk (several requests)
 * keep the bytes under <dataDir>/uploads/<uploadId> (0600) for one hour, and
 * importUpload({ uploadId }) imports them without the browser re-sending.
 */
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dropTable, importTable, listTables, sanitizeTableName } from '../sqlite-driver.js'
import { coerceValue, inferColumns, parseCsv, readXlsx } from '../xlsx.js'
import { UserError, newId } from './shared.js'

export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024
export const UPLOAD_TTL_MS = 60 * 60 * 1000
const UPLOAD_ID = /^up-[0-9a-f]{10}$/

const isText = (fileName) => /\.(csv|tsv|txt)$/i.test(String(fileName ?? ''))

/** Raw sheets of a CSV / Excel file: [{ name, rows, encoding?, delimiter?, truncated }]. */
function readSheets(fileName, buf) {
  try {
    if (isText(fileName)) {
      const p = parseCsv(buf)
      return [{ name: String(fileName).replace(/\.[^.]+$/, ''), rows: p.rows, encoding: p.encoding, delimiter: p.delimiter, truncated: p.truncated }]
    }
    return readXlsx(buf)
  } catch (error) {
    throw new UserError('nl2sql/invalid', error.message)
  }
}

/** Preview shape returned by parseUpload / stageUpload. */
function previewSheets(raw, fileName, headerRow) {
  return raw.filter(sh => sh.rows.some(r => r.length)).map(sh => {
    const rows = sh.rows.filter(r => r.some(v => v !== null && v !== undefined && v !== ''))
    const header = headerRow ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `column_${i + 1}`)
    const body = headerRow ? rows.slice(1) : rows
    const width = Math.max(header.length, ...body.slice(0, 1000).map(r => r.length))
    const cols = inferColumns(Array.from({ length: width }, (_, i) => header[i] ?? ''), body.map(r => r.map(v => v === null || v === undefined ? '' : String(v))))
    return { sheet: sh.name, table: sanitizeTableName(sh.name || fileName || 'data'), columns: cols, rowCount: body.length, preview: body.slice(0, 20), encoding: sh.encoding, delimiter: sh.delimiter, truncated: Boolean(sh.truncated) }
  })
}

function decode(base64) {
  return Buffer.from(String(base64 ?? ''), 'base64')
}

function checkSize(n) {
  if (n > UPLOAD_MAX_BYTES) throw new UserError('nl2sql/invalid', '文件超过 200 MB')
}

export const methods = {
  // ----------------------------------------------------------- file uploads

  /**
   * Parse an uploaded CSV / Excel file (base64) into a preview: sheets with
   * inferred column types and the first rows, without importing.
   */
  parseUpload({ fileName, base64, headerRow = true }) {
    const buf = decode(base64)
    if (!buf.length) throw new UserError('nl2sql/invalid', '文件为空')
    checkSize(buf.length)
    return previewSheets(readSheets(fileName, buf), fileName, headerRow)
  },

  uploadDir() {
    return join(this.dir, 'uploads')
  },

  uploadPath(id) {
    if (!UPLOAD_ID.test(String(id ?? ''))) throw new UserError('nl2sql/invalid', '上传编号无效')
    return join(this.uploadDir(), id)
  },

  /** Delete staged files (complete or partial) older than the TTL. */
  async cleanupUploads(now = Date.now()) {
    let names = []
    try { names = await readdir(this.uploadDir()) } catch { return 0 }
    let removed = 0
    for (const name of names) {
      const id = name.replace(/\.json$/, '')
      const file = join(this.uploadDir(), name)
      try {
        const st = await stat(file)
        if (now - st.mtimeMs <= UPLOAD_TTL_MS) continue
        await rm(file, { force: true })
        this.uploadSessions?.delete(id)
        if (this.stagedParse?.id === id) this.stagedParse = null
        removed++
      } catch {}
    }
    return removed
  },

  async writeUploadMeta(id, meta) {
    await writeFile(`${this.uploadPath(id)}.json`, JSON.stringify(meta), { mode: 0o600 })
  },

  async readUploadMeta(id) {
    try { return JSON.parse(await readFile(`${this.uploadPath(id)}.json`, 'utf8')) } catch { return undefined }
  },

  /** Parse a fully staged file once, remember the parse for the following import, return the preview. */
  async finishStage(id, fileName, buf, headerRow) {
    const raw = readSheets(fileName, buf)
    // Keep only the latest parse in memory: importUpload right after staging reuses it.
    this.stagedParse = { id, fileName, raw }
    await this.writeUploadMeta(id, { fileName, bytes: buf.length, complete: true, createdAt: Date.now() })
    return { uploadId: id, fileName, bytes: buf.length, sheets: previewSheets(raw, fileName, headerRow) }
  },

  /** Store one whole file (base64) on the server, parse it once, return the preview. */
  async stageUpload({ fileName, base64, headerRow = true }) {
    await this.cleanupUploads()
    const name = String(fileName ?? '').trim().slice(0, 255)
    if (!name) throw new UserError('nl2sql/invalid', '缺少文件名')
    const buf = decode(base64)
    if (!buf.length) throw new UserError('nl2sql/invalid', '文件为空')
    checkSize(buf.length)
    await mkdir(this.uploadDir(), { recursive: true, mode: 0o700 })
    const id = newId('up')
    await writeFile(this.uploadPath(id), buf, { mode: 0o600 })
    try {
      return await this.finishStage(id, name, buf, headerRow)
    } catch (error) {
      await this.discardUpload(id)
      throw error
    }
  },

  /**
   * Chunked staging: chunks arrive in order (index 0..total-1). The first
   * chunk opens an upload (uploadId omitted); later ones must name it. The
   * last chunk parses the file and returns the stageUpload result; earlier
   * chunks return { uploadId, received }.
   */
  async stageUploadChunk({ uploadId, fileName, index, total, base64, headerRow = true }) {
    this.uploadSessions ??= new Map()
    const idx = Number(index)
    const tot = Number(total)
    if (!Number.isInteger(tot) || tot < 1 || tot > 100000) throw new UserError('nl2sql/invalid', 'total 无效')
    if (!Number.isInteger(idx) || idx < 0 || idx >= tot) throw new UserError('nl2sql/invalid', 'index 无效')
    const chunk = decode(base64)
    let up
    if (idx === 0 && !uploadId) {
      await this.cleanupUploads()
      const name = String(fileName ?? '').trim().slice(0, 255)
      if (!name) throw new UserError('nl2sql/invalid', '缺少文件名')
      await mkdir(this.uploadDir(), { recursive: true, mode: 0o700 })
      up = { id: newId('up'), fileName: name, total: tot, next: 0, bytes: 0, startedAt: Date.now() }
      await writeFile(this.uploadPath(up.id), Buffer.alloc(0), { mode: 0o600 })
      this.uploadSessions.set(up.id, up)
    } else {
      up = uploadId ? this.uploadSessions.get(String(uploadId)) : undefined
      if (!up) throw new UserError('nl2sql/invalid', '上传不存在或已过期，请重新上传')
      if (tot !== up.total) throw new UserError('nl2sql/invalid', 'total 与首个分片不一致')
      if (idx !== up.next) throw new UserError('nl2sql/invalid', `分片顺序错误：期望第 ${up.next} 片，收到第 ${idx} 片`)
    }
    if (up.bytes + chunk.length > UPLOAD_MAX_BYTES) {
      await this.discardUpload(up.id)
      throw new UserError('nl2sql/invalid', '文件超过 200 MB')
    }
    await appendFile(this.uploadPath(up.id), chunk)
    up.bytes += chunk.length
    up.next = idx + 1
    if (up.next < up.total) return { uploadId: up.id, received: up.next }
    this.uploadSessions.delete(up.id)
    if (!up.bytes) { await this.discardUpload(up.id); throw new UserError('nl2sql/invalid', '文件为空') }
    try {
      return await this.finishStage(up.id, up.fileName, await readFile(this.uploadPath(up.id)), headerRow)
    } catch (error) {
      await this.discardUpload(up.id)
      throw error
    }
  },

  async discardUpload(id) {
    this.uploadSessions?.delete(id)
    if (this.stagedParse?.id === id) this.stagedParse = null
    try { await rm(this.uploadPath(id), { force: true }); await rm(`${this.uploadPath(id)}.json`, { force: true }) } catch {}
  },

  /** Raw sheets of a staged upload: the cached parse, or one read + one parse. */
  async stagedSheets(uploadId) {
    const file = this.uploadPath(uploadId)
    const meta = await this.readUploadMeta(uploadId)
    if (!meta?.complete) throw new UserError('nl2sql/invalid', '上传不存在或已过期（暂存文件保留 1 小时），请重新上传')
    if (this.stagedParse?.id === uploadId) return { fileName: meta.fileName, raw: this.stagedParse.raw }
    let buf
    try { buf = await readFile(file) } catch { throw new UserError('nl2sql/invalid', '上传不存在或已过期（暂存文件保留 1 小时），请重新上传') }
    return { fileName: meta.fileName, raw: readSheets(meta.fileName, buf) }
  },

  /** Import one or more sheets of an uploaded file into a local file data source. */
  async importUpload({ datasourceId, newName, uploadId, fileName, base64, headerRow = true, sheets: picks, mode = 'create' }) {
    let raw
    if (uploadId) {
      const staged = await this.stagedSheets(uploadId)
      fileName = fileName || staged.fileName
      raw = staged.raw
    }
    let ds = datasourceId ? this.requireDatasource(datasourceId) : undefined
    if (!ds) ds = await this.saveDatasource({ type: 'sqlite', name: newName || String(fileName ?? '本地文件').replace(/\.[^.]+$/, '').slice(0, 60), description: `上传的文件：${fileName}` })
    if (ds.type !== 'sqlite') throw new UserError('nl2sql/invalid', '只能导入到「本地文件」类型的数据源')
    const ds2 = this.requireDatasource(ds.id)
    if (!raw) {
      const buf = decode(base64)
      checkSize(buf.length)
      raw = isText(fileName) ? [{ name: String(fileName).replace(/\.[^.]+$/, ''), rows: parseCsv(buf).rows }] : readXlsx(buf)
    }
    const results = []
    await this.closeDriver(ds2.id)
    for (const sh of raw) {
      const pick = picks?.find(p => p.sheet === sh.name)
      if (picks?.length && !pick) continue
      const rows = sh.rows.filter(r => r.some(v => v !== null && v !== undefined && v !== ''))
      if (!rows.length) continue
      const header = headerRow ? rows[0] : rows[0].map((_, i) => `column_${i + 1}`)
      const body = headerRow ? rows.slice(1) : rows
      const width = Math.max(header.length, ...body.slice(0, 1000).map(r => r.length))
      const strBody = body.map(r => Array.from({ length: width }, (_, i) => r[i] === null || r[i] === undefined ? '' : String(r[i])))
      let cols = inferColumns(Array.from({ length: width }, (_, i) => header[i] ?? ''), strBody)
      if (pick?.columns?.length === cols.length) cols = cols.map((c, i) => ({ ...c, name: pick.columns[i].name || c.name, type: pick.columns[i].type || c.type }))
      const values = strBody.map(r => r.map((v, i) => coerceValue(v, cols[i].type)))
      try {
        const res = importTable({ file: ds2.file, table: pick?.table || sh.name || 'data', columns: cols.map(c => ({ name: c.name, type: c.type })), rows: values, mode: pick?.mode ?? mode, source: fileName })
        results.push({ sheet: sh.name, ...res, ok: true })
      } catch (error) {
        results.push({ sheet: sh.name, ok: false, error: error.message })
      }
    }
    if (results.some(r => r.ok)) {
      await this.analyzeSchema(ds2.id, { refresh: true })
      if (uploadId) await this.discardUpload(uploadId)
    }
    this.auditAdmin('upload', `${fileName} → ${ds2.name}`)
    await this.save()
    return { datasourceId: ds2.id, datasourceName: ds2.name, results }
  },

  listFileTables(datasourceId) {
    const ds = this.requireDatasource(datasourceId)
    if (ds.type !== 'sqlite') throw new UserError('nl2sql/invalid', '不是本地文件数据源')
    try { return listTables({ file: ds.file }) } catch { return [] }
  },

  async dropFileTable({ datasourceId, table }) {
    const ds = this.requireDatasource(datasourceId)
    if (ds.type !== 'sqlite') throw new UserError('nl2sql/invalid', '不是本地文件数据源')
    await this.closeDriver(ds.id)
    dropTable({ file: ds.file, table })
    await this.analyzeSchema(ds.id, { refresh: true })
    return this.listFileTables(ds.id)
  },
}
