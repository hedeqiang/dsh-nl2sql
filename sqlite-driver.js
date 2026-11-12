/**
 * Local "file" data source backed by SQLite (node:sqlite, built into the runtime).
 *
 * Read side — SqliteDriver mirrors the drivers.js interface:
 *   test()                      → { version, user, database, tableCount, readOnlyGrant, grants, warnings }
 *   introspect(timeoutMs)       → { version, tables, columns, foreignKeys, indexes }
 *   query(sql, { timeoutMs, maxRows }) → { columns: [{ name, kind, table?, column?, index }], rows }
 *   explain(sql, { timeoutMs }) → { plan, scans: [{ table, rows }] }
 *   sampleColumn(table, column) → [{ value, count }]
 *   previewSql(table, limit), ident(name), close(), dialect = 'sqlite', useHint = false
 *
 * Every read statement runs on a separate connection opened with
 * readOnly: true, defensive mode, ATTACH disabled (limits.attach = 0),
 * extension loading off, and an authorizer that only admits SELECT / READ /
 * non-dangerous FUNCTION / RECURSIVE and a whitelist of introspection PRAGMAs.
 *
 * Timeouts: node:sqlite is synchronous and exposes no progress handler or
 * sqlite3_interrupt(); a worker thread cannot be terminated while SQLite is
 * inside one long step either. Reads therefore run in one long-lived child
 * process per driver (process.execPath with ELECTRON_RUN_AS_NODE=1, IPC). The
 * host event loop never blocks; when timeoutMs (+250ms grace) elapses the
 * caller gets query/timeout and the child is SIGKILLed — a hard stop — and the
 * next call forks a fresh one (~100ms). Row loops also check the deadline every
 * 256 rows and stop at maxRows + 1.
 *
 * Write side — importTable / dropTable / listTables / fileStats open a
 * short-lived read-write connection per call.
 */
import { DatabaseSync } from 'node:sqlite'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, basename } from 'node:path'

export const META_TABLE = '__nl2sql_tables'

export class SqliteError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// drivers.js may import this module (createDriver), so we must not import it
// back. The host can inject DriverError so describeError() keeps the error code:
//   import { useErrorClass } from './sqlite-driver.js'; useErrorClass(DriverError)
let ErrorClass = SqliteError
export function useErrorClass(C) {
  if (typeof C === 'function') ErrorClass = C
}
const fail = (code, message) => new ErrorClass(code, message)
const isOurs = e => e instanceof SqliteError || e instanceof ErrorClass

const SQLITE_VERSION = (() => {
  try {
    const db = new DatabaseSync(':memory:')
    const v = db.prepare('SELECT sqlite_version() AS v').get().v
    db.close()
    return String(v)
  } catch {
    return ''
  }
})()

function versionNumber(v) {
  const m = String(v).match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] ?? 0) : 0
}

const MODERN_JOINS = versionNumber(SQLITE_VERSION) >= 33900

/** Dialect notes for the model (append to DIALECT_HINTS.sqlite). */
export const sqliteDialectHints = [
  `SQLite ${SQLITE_VERSION}: quote identifiers with double quotes (always for Chinese or mixed-case names, e.g. "订单"."金额").`,
  'Dates are stored as TEXT \'YYYY-MM-DD\' / \'YYYY-MM-DD HH:MM:SS\': use date(col), strftime(\'%Y-%m\', col) for months, strftime(\'%Y\', col), strftime(\'%Y-%W\', col) for weeks, strftime(\'%w\', col) weekday (0=Sunday), date(\'now\', \'-30 days\'), julianday(a) - julianday(b) for day differences, unixepoch(col) for epoch seconds; there is no DATE_FORMAT, date_trunc, EXTRACT, NOW() or INTERVAL.',
  `CTEs, window functions, FILTER (WHERE ...), IIF(), CASE, group_concat()/string_agg(), JSON ->/->> ${MODERN_JOINS ? 'and RIGHT / FULL OUTER JOIN are supported' : 'are supported; RIGHT and FULL OUTER JOIN are NOT supported (rewrite as LEFT JOIN)'}.`,
  'Integer division truncates (use col * 1.0 / x); || concatenates strings; LIKE is case-insensitive for ASCII (no ILIKE); ROUND(x, 2) for decimals; no schemas, the whole file is one database.',
].join(' ')

// ------------------------------------------------------------------ helpers

const A = {
  PRAGMA: 19, READ: 20, SELECT: 21, FUNCTION: 31, RECURSIVE: 33,
}

const FORBIDDEN_FUNCTIONS = new Set(['load_extension', 'readfile', 'writefile', 'edit', 'fts3_tokenizer', 'fts5', 'zipfile', 'sqlar_compress', 'sqlar_uncompress', 'lsmode', 'sqlite_offset'])
// PRAGMAs whose argument is a table/index name and which never write.
const PRAGMA_WITH_ARG = new Set(['table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list', 'table_list'])
// PRAGMAs readable without argument; any assignment (arg present) is refused.
const PRAGMA_READ = new Set(['user_version', 'schema_version', 'application_id', 'encoding', 'page_size', 'page_count', 'freelist_count', 'database_list', 'compile_options', 'function_list', 'collation_list', 'table_list', 'foreign_keys', 'journal_mode'])

const ACTION_NAMES = {
  1: 'CREATE INDEX', 2: 'CREATE TABLE', 3: 'CREATE TEMP INDEX', 4: 'CREATE TEMP TABLE', 5: 'CREATE TEMP TRIGGER', 6: 'CREATE TEMP VIEW',
  7: 'CREATE TRIGGER', 8: 'CREATE VIEW', 9: 'DELETE', 10: 'DROP INDEX', 11: 'DROP TABLE', 12: 'DROP TEMP INDEX', 13: 'DROP TEMP TABLE',
  14: 'DROP TEMP TRIGGER', 15: 'DROP TEMP VIEW', 16: 'DROP TRIGGER', 17: 'DROP VIEW', 18: 'INSERT', 19: 'PRAGMA', 22: 'TRANSACTION',
  23: 'UPDATE', 24: 'ATTACH', 25: 'DETACH', 26: 'ALTER TABLE', 27: 'REINDEX', 28: 'ANALYZE', 29: 'CREATE VIRTUAL TABLE', 30: 'DROP VIRTUAL TABLE', 31: 'FUNCTION', 32: 'SAVEPOINT',
}

export function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/** Convert one SQLite value to a JSON-friendly cell. */
export function toCell(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Uint8Array) return `<binary ${value.length} bytes>`
  return value
}

/** Map a declared SQLite type to the service's dataType vocabulary. */
function mapType(declared) {
  const t = String(declared ?? '').toUpperCase()
  if (!t) return { dataType: 'varchar', affinity: 'none' }
  if (/BOOL/.test(t)) return { dataType: 'tinyint', affinity: 'number', columnType: 'tinyint(1)' }
  if (/^BIGINT|INT8/.test(t)) return { dataType: 'bigint', affinity: 'number' }
  if (/INT/.test(t)) return { dataType: 'int', affinity: 'number' }
  if (/DATETIME|TIMESTAMP/.test(t)) return { dataType: 'datetime', affinity: 'time' }
  if (/^DATE/.test(t)) return { dataType: 'date', affinity: 'time' }
  if (/^TIME/.test(t)) return { dataType: 'time', affinity: 'time' }
  if (/CHAR|CLOB|TEXT/.test(t)) return { dataType: 'varchar', affinity: 'text' }
  if (/BLOB/.test(t)) return { dataType: 'blob', affinity: 'text' }
  if (/REAL|FLOA|DOUB/.test(t)) return { dataType: 'double', affinity: 'number' }
  if (/NUM|DEC/.test(t)) return { dataType: 'decimal', affinity: 'number' }
  return { dataType: t.toLowerCase(), affinity: 'number' } // SQLite: unknown types get NUMERIC affinity
}

/** Text left after the first statement, minus whitespace and comments. */
function trailingCode(rest) {
  return rest.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ').replace(/[\s;]+/g, '')
}

function translate(error, denied) {
  if (isOurs(error)) return error
  const msg = String(error?.message ?? error)
  if (/not authorized|too many attached/i.test(msg)) return fail('sqlite/denied', `只读数据源不允许执行该语句${denied ? `（${denied}）` : ''}：仅支持 SELECT 查询`)
  if (/attempt to write a readonly database/i.test(msg)) return fail('sqlite/denied', '只读数据源不允许写入')
  if (/unable to open database file/i.test(msg)) return fail('sqlite/missing', '数据文件不存在或无法打开，请先上传 CSV/Excel 文件')
  const e = fail(`sqlite/${error?.errstr ? error.errstr.replace(/\s+/g, '-') : 'error'}`, `SQLite：${msg}`)
  return e
}

// ------------------------------------------------------------- read session

/** Read-only connection with an authorizer; used in the child process or in-process. */
class ReadSession {
  constructor(file) {
    this.file = file
    this.denied = null
    this.db = new DatabaseSync(file, { readOnly: true, allowExtension: false, timeout: 5000, defensive: true, limits: { attach: 0, length: 64 * 1024 * 1024 } })
    try { this.db.enableDefensive?.(true) } catch {}
    this.db.setAuthorizer((action, a1, a2) => {
      if (action === A.SELECT || action === A.READ || action === A.RECURSIVE) return 0
      if (action === A.FUNCTION) {
        if (FORBIDDEN_FUNCTIONS.has(String(a2 ?? '').toLowerCase())) { this.denied = `函数 ${a2}`; return 1 }
        return 0
      }
      if (action === A.PRAGMA) {
        const name = String(a1 ?? '').toLowerCase()
        if (PRAGMA_WITH_ARG.has(name) || (PRAGMA_READ.has(name) && (a2 === null || a2 === undefined))) return 0
        this.denied = `PRAGMA ${name}${a2 != null ? `=${a2}` : ''}`
        return 1
      }
      this.denied = ACTION_NAMES[action] ?? `action ${action}`
      return 1
    })
  }

  prepare(sql) {
    // Stepping any statement re-checks the schema cookie, so a table replaced by
    // an import on another connection is seen before columns() is read.
    this.ping ??= this.db.prepare('SELECT 1 FROM sqlite_master LIMIT 1')
    try { this.ping.get() } catch {}
    this.denied = null
    let stmt
    try {
      stmt = this.db.prepare(sql)
    } catch (error) {
      throw translate(error, this.denied)
    }
    const src = stmt.sourceSQL
    if (typeof src === 'string' && sql.startsWith(src) && trailingCode(sql.slice(src.length))) throw fail('sqlite/multi', '一次只能执行一条语句')
    stmt.setReadBigInts(true)
    return stmt
  }

  objects(sql, ...params) {
    return this.prepare(sql).all(...params).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toCell(v)])))
  }

  query(sql, { maxRows = 1000, deadline = Infinity } = {}) {
    const stmt = this.prepare(sql)
    const meta = stmt.columns()
    stmt.setReturnArrays(true)
    const rows = []
    try {
      for (const raw of stmt.iterate()) {
        rows.push(raw.map(toCell))
        if (rows.length > maxRows) break
        if ((rows.length & 255) === 0 && Date.now() > deadline) throw fail('query/timeout', '查询超时')
      }
    } catch (error) {
      throw translate(error, this.denied)
    }
    const columns = meta.map((c, i) => {
      const affinity = c.type ? mapType(c.type).affinity : 'none'
      let kind
      if (affinity === 'time') kind = 'time'
      else if (affinity === 'text') kind = 'text'
      else if (affinity === 'number') kind = 'number'
      else {
        const values = rows.map(r => r[i]).filter(v => v !== null)
        kind = values.length && values.every(v => typeof v === 'number') ? 'number' : 'auto'
      }
      if (kind === 'number' && /(^id$|_id$)/i.test(c.name)) kind = 'text'
      return { name: c.name, kind, ...(c.table ? { table: c.table, column: c.column } : {}), index: i }
    })
    return { columns, rows }
  }

  rowCount(table) {
    return Number(this.objects(`SELECT COUNT(*) AS n FROM ${ident(table)}`)[0].n)
  }

  userTables() {
    return this.objects(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> ? ORDER BY name`, META_TABLE)
  }

  meta() {
    const has = this.objects(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`, META_TABLE).length > 0
    return has ? new Map(this.objects(`SELECT name, source, rows, created_at, updated_at FROM ${ident(META_TABLE)}`).map(r => [r.name, r])) : new Map()
  }

  info() {
    return { version: SQLITE_VERSION, tableCount: this.userTables().length }
  }

  introspect({ deadline = Infinity } = {}) {
    const meta = this.meta()
    const list = this.userTables()
    const tables = []
    const columns = []
    const foreignKeys = []
    const indexes = []
    for (const t of list) {
      if (Date.now() > deadline) throw fail('query/timeout', '读取表结构超时')
      const m = meta.get(t.name)
      const comment = m ? [m.source ? `来源：${m.source}` : '', m.updated_at ? `导入于 ${new Date(Number(m.updated_at)).toLocaleString('zh-CN', { hour12: false })}` : ''].filter(Boolean).join('，') : ''
      tables.push({ name: t.name, type: t.type === 'view' ? 'VIEW' : 'TABLE', rows: t.type === 'view' ? null : this.rowCount(t.name), comment })
      const cols = this.objects('SELECT cid, name, type, "notnull" AS nn, pk FROM pragma_table_info(?)', t.name)
      const idx = t.type === 'view' ? [] : this.objects('SELECT name, "unique" AS u, origin FROM pragma_index_list(?) ORDER BY seq DESC', t.name)
      const idxCols = idx.map(i => ({ ...i, cols: this.objects('SELECT name FROM pragma_index_info(?) ORDER BY seqno', i.name).map(r => r.name) }))
      const pkCols = cols.filter(c => Number(c.pk) > 0).sort((a, b) => a.pk - b.pk).map(c => c.name)
      for (const i of idxCols) {
        const name = i.origin === 'pk' ? 'PRIMARY' : i.name
        for (const c of i.cols) if (c !== null) indexes.push({ table: t.name, name, unique: Number(i.u) === 1, column: c })
      }
      if (pkCols.length && !idxCols.some(i => i.origin === 'pk')) for (const c of pkCols) indexes.push({ table: t.name, name: 'PRIMARY', unique: true, column: c })
      for (const c of cols) {
        const mt = mapType(c.type)
        const isPk = Number(c.pk) > 0
        const key = isPk ? 'PRI'
          : idxCols.some(i => Number(i.u) === 1 && i.cols.length === 1 && i.cols[0] === c.name) ? 'UNI'
            : idxCols.some(i => i.cols[0] === c.name) ? 'MUL' : ''
        columns.push({ table: t.name, name: c.name, dataType: mt.dataType, columnType: mt.columnType ?? (String(c.type || '').toLowerCase() || 'any'), nullable: !Number(c.nn) && !isPk, key, comment: '' })
      }
      if (t.type !== 'view') {
        for (const fk of this.objects('SELECT "table" AS ref, "from" AS col, "to" AS refCol FROM pragma_foreign_key_list(?) ORDER BY id, seq', t.name)) {
          let refCol = fk.refCol
          if (refCol === null) refCol = this.objects('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk', fk.ref)[0]?.name ?? 'rowid'
          foreignKeys.push({ from: { table: t.name, column: fk.col }, to: { table: fk.ref, column: refCol } })
        }
      }
    }
    return { version: SQLITE_VERSION, tables, columns, foreignKeys, indexes }
  }

  explain(sql) {
    const plan = this.objects(`EXPLAIN QUERY PLAN ${sql}`).map(r => ({ id: r.id, parent: r.parent, detail: r.detail }))
    const tables = this.userTables().filter(t => t.type === 'table').map(t => t.name)
    // Aliases: FROM/JOIN <name> [AS] <alias>
    const alias = new Map()
    const identRe = '("(?:[^"]|"")+"|`[^`]+`|\\[[^\\]]+\\]|[\\p{L}\\p{N}_$]+)'
    const unq = s => (/^["`[]/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s)
    const kw = /^(where|on|using|join|left|right|full|inner|cross|natural|outer|group|order|limit|having|union|except|intersect|window|as|set)$/i
    for (const m of sql.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+${identRe}(?:\\s+(?:AS\\s+)?${identRe})?`, 'giu'))) {
      const name = unq(m[1])
      const a = m[2] ? unq(m[2]) : null
      if (a && !kw.test(a)) alias.set(a, name)
    }
    const candidates = [...new Set([...tables, ...alias.keys()])].sort((a, b) => b.length - a.length)
    const scans = []
    const counted = new Map()
    for (const p of plan) {
      const d = String(p.detail ?? '')
      if (!d.startsWith('SCAN ') || /\bUSING\b.*\bINDEX\b/.test(d)) continue
      let rest = d.slice(5)
      if (rest.startsWith('TABLE ')) rest = rest.slice(6) // pre-3.36 wording
      const hit = candidates.find(c => rest === c || rest.startsWith(`${c} `))
      if (!hit) continue
      const table = alias.get(hit) ?? hit
      const real = tables.find(t => t.toLowerCase() === table.toLowerCase())
      if (!real) continue
      if (!counted.has(real)) counted.set(real, this.rowCount(real))
      scans.push({ table: real, rows: counted.get(real) })
    }
    return { plan, scans }
  }

  sample(table, column) {
    return this.objects(`SELECT ${ident(column)} AS v, COUNT(*) AS n FROM ${ident(table)} GROUP BY 1 ORDER BY 2 DESC LIMIT 13`).map(r => ({ value: r.v, count: Number(r.n) }))
  }

  run(op, args) {
    switch (op) {
      case 'query': return this.query(args.sql, args)
      case 'explain': return this.explain(args.sql)
      case 'sample': return this.sample(args.table, args.column)
      case 'introspect': return this.introspect(args)
      case 'info': return this.info()
      default: throw new Error(`unknown op ${op}`)
    }
  }

  close() {
    try { this.db.close() } catch {}
  }
}

// ------------------------------------------------------------- child process

// Reads run in a child process (same runtime binary, ELECTRON_RUN_AS_NODE=1) so
// a runaway statement can be SIGKILLed — node:sqlite has no interrupt API and
// a worker thread cannot be stopped while SQLite is inside one long step.
if (process.env.NL2SQL_SQLITE_CHILD === '1' && typeof process.send === 'function') {
  let session = null
  process.on('message', ({ id, op, args }) => {
    try {
      session ??= new ReadSession(process.env.NL2SQL_SQLITE_FILE)
      process.send({ id, ok: true, result: session.run(op, args) })
    } catch (error) {
      const e = translate(error)
      process.send({ id, ok: false, code: e.code, message: e.message })
    }
  })
  process.on('disconnect', () => process.exit(0))
}

// ------------------------------------------------------------------- driver

export class SqliteDriver {
  /**
   * @param {{ file: string, worker?: boolean }} conf - absolute path of the .sqlite file;
   *   worker:false runs reads in-process (blocks the event loop, timeouts only
   *   checked between rows; for tests or hosts that cannot fork).
   */
  constructor(conf) {
    this.conf = conf
    this.file = conf.file
    this.dialect = 'sqlite'
    this.version = SQLITE_VERSION
    this.useWorker = conf.worker !== false
    this.child = null
    this.pending = new Map()
    this.seq = 0
    this.local = null
  }

  get useHint() { return false }

  ident(name) { return ident(name) }

  previewSql(table, limit) {
    return `SELECT * FROM ${ident(table)} LIMIT ${Math.max(0, Math.floor(Number(limit) || 0))}`
  }

  ensureFile() {
    if (!this.file || !existsSync(this.file)) throw fail('sqlite/missing', '数据文件不存在，请先上传 CSV/Excel 文件')
  }

  spawn() {
    const child = fork(fileURLToPath(import.meta.url), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NL2SQL_SQLITE_CHILD: '1', NL2SQL_SQLITE_FILE: this.file },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      serialization: 'advanced',
    })
    child.unref()
    child.channel?.unref?.()
    child.on('message', (m) => {
      const p = this.pending.get(m?.id)
      if (!p) return
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (this.pending.size === 0) child.channel?.unref?.()
      if (m.ok) p.resolve(m.result)
      else p.reject(fail(m.code ?? 'sqlite/error', m.message))
    })
    const dead = (error) => {
      if (this.child === child) this.child = null
      for (const [id, p] of this.pending) {
        if (p.child !== child) continue
        this.pending.delete(id)
        clearTimeout(p.timer)
        p.reject(fail('sqlite/worker', `SQLite 查询进程异常退出${error?.message ? `：${error.message}` : ''}`))
      }
    }
    child.on('error', dead)
    child.on('exit', () => dead())
    return child
  }

  async call(op, args, timeoutMs) {
    this.ensureFile()
    const deadline = Date.now() + timeoutMs
    if (!this.useWorker) {
      this.local ??= new ReadSession(this.file)
      try {
        return this.local.run(op, { ...args, deadline })
      } catch (error) {
        throw translate(error)
      }
    }
    if (!this.child) {
      try {
        this.child = this.spawn()
      } catch {
        this.useWorker = false // cannot fork in this host: run in-process (no hard timeout)
        return this.call(op, args, timeoutMs)
      }
    }
    const child = this.child
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        // node:sqlite cannot interrupt a statement; kill the process that runs it.
        if (this.child === child) this.child = null
        for (const [pid, p] of this.pending) if (p.child === child) { this.pending.delete(pid); clearTimeout(p.timer); p.reject(fail('query/timeout', `查询超时（>${timeoutMs}ms）`)) }
        child.kill('SIGKILL')
        reject(fail('query/timeout', `查询超时（>${timeoutMs}ms）`))
      }, timeoutMs + 250)
      this.pending.set(id, { resolve, reject, timer, child })
      child.channel?.ref?.()
      try {
        child.send({ id, op, args: { ...args, deadline } })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(fail('sqlite/worker', `SQLite 查询进程不可用：${error.message}`))
      }
    })
  }

  async test() {
    const info = await this.call('info', {}, 10000)
    const bytes = statSync(this.file).size
    return {
      version: `SQLite ${info.version}`, user: 'local', database: basename(this.file), tableCount: info.tableCount, readOnlyGrant: true,
      grants: ['read-only connection (readOnly, defensive, ATTACH disabled)', 'authorizer: SELECT / read PRAGMA only', 'extension loading disabled', `file size: ${bytes} bytes`],
      warnings: [],
    }
  }

  async introspect(timeoutMs = 30000) {
    const raw = await this.call('introspect', {}, timeoutMs)
    this.version = raw.version
    return raw
  }

  async query(sql, { timeoutMs = 30000, maxRows = 1000 } = {}) {
    return this.call('query', { sql: String(sql), maxRows }, timeoutMs)
  }

  async explain(sql, { timeoutMs = 10000 } = {}) {
    return this.call('explain', { sql: String(sql) }, timeoutMs)
  }

  async sampleColumn(table, column) {
    return this.call('sample', { table, column }, 5000)
  }

  async close() {
    const child = this.child
    this.child = null
    for (const [id, p] of this.pending) { this.pending.delete(id); clearTimeout(p.timer); p.reject(fail('sqlite/closed', '数据源已关闭')) }
    if (child && child.exitCode === null) {
      const exited = new Promise(r => child.once('exit', r))
      child.ref() // keep the loop alive until the exit is observed
      child.kill('SIGKILL')
      let timer
      await Promise.race([exited, new Promise(r => { timer = setTimeout(r, 2000) })])
      clearTimeout(timer)
      child.unref()
    }
    this.local?.close()
    this.local = null
  }
}

// --------------------------------------------------------------- write side

const COLUMN_TYPES = new Set(['INTEGER', 'REAL', 'TEXT', 'DATE', 'DATETIME'])

/**
 * Normalize a user-supplied table name: keep letters (incl. Chinese), digits and
 * underscores; others become "_". Prefix "t_" when it starts with a digit.
 */
export function sanitizeTableName(input) {
  let name = String(input ?? '').normalize('NFC').trim().replace(/[^\p{L}\p{Nd}_]/gu, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!name) throw fail('sqlite/invalid-name', '表名不能为空')
  if (/^\p{Nd}/u.test(name)) name = `t_${name}`
  name = [...name].slice(0, 64).join('')
  if (/^sqlite_/i.test(name) || name.toLowerCase() === META_TABLE) throw fail('sqlite/invalid-name', `表名不能以 sqlite_ 开头或使用保留名：${name}`)
  return name
}

function openWrite(file, { create = false } = {}) {
  if (!file || typeof file !== 'string') throw fail('sqlite/invalid', '缺少数据文件路径')
  if (!create && !existsSync(file)) throw fail('sqlite/missing', '数据文件不存在')
  if (create) mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { allowExtension: false, timeout: 5000, defensive: true, limits: { attach: 0 } })
  db.exec(`CREATE TABLE IF NOT EXISTS ${ident(META_TABLE)} (name TEXT PRIMARY KEY, source TEXT, rows INTEGER, created_at INTEGER, updated_at INTEGER)`)
  return db
}

function findTable(db, name) {
  return db.prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND lower(name) = lower(?)`).get(name)
}

function pad2(n) { return String(n).padStart(2, '0') }

function toValue(v, type) {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const d = `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
    return type === 'DATE' ? d : `${d} ${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`
  }
  if (v instanceof Uint8Array) return v
  return String(v)
}

/**
 * Import already-coerced rows into a table.
 * @param {{ file: string, table: string, columns: { name: string, type: 'INTEGER'|'REAL'|'TEXT'|'DATE'|'DATETIME' }[], rows: any[][], mode?: 'create'|'replace'|'append', source?: string }} input
 * @returns {{ table: string, rows: number, columns: { name: string, type: string }[] }}
 */
export function importTable({ file, table, columns, rows, mode = 'create', source = '' }) {
  if (!['create', 'replace', 'append'].includes(mode)) throw fail('sqlite/invalid', `未知导入模式：${mode}`)
  const name = sanitizeTableName(table)
  if (!Array.isArray(columns) || columns.length === 0) throw fail('sqlite/invalid', '至少需要一列')
  if (columns.length > 2000) throw fail('sqlite/invalid', '列数过多（最多 2000 列）')
  const seen = new Set()
  const cols = columns.map((c, i) => {
    const cname = String(c?.name ?? '').trim()
    if (!cname) throw fail('sqlite/invalid', `第 ${i + 1} 列缺少列名`)
    if (seen.has(cname.toLowerCase())) throw fail('sqlite/invalid', `列名重复：${cname}`)
    seen.add(cname.toLowerCase())
    const type = String(c.type ?? 'TEXT').toUpperCase()
    if (!COLUMN_TYPES.has(type)) throw fail('sqlite/invalid', `不支持的列类型：${c.type}`)
    return { name: cname, type }
  })
  const list = Array.isArray(rows) ? rows : []
  const db = openWrite(file, { create: true })
  let inserted = 0
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const existing = findTable(db, name)
      let target = cols
      let createdAt = Date.now()
      if (existing && existing.type === 'view') throw fail('sqlite/exists', `同名视图已存在：${existing.name}`)
      if (mode === 'create' && existing) throw fail('sqlite/exists', `表已存在：${existing.name}`)
      if (mode === 'append') {
        if (!existing) throw fail('sqlite/not-found', `表不存在：${name}`)
        const have = db.prepare('SELECT name, type FROM pragma_table_info(?) ORDER BY cid').all(existing.name)
        const same = have.length === cols.length && have.every((h, i) => h.name.toLowerCase() === cols[i].name.toLowerCase())
        if (!same) throw fail('sqlite/columns-mismatch', `追加的数据列与现有表不一致：现有 [${have.map(h => h.name).join(', ')}]，导入 [${cols.map(c => c.name).join(', ')}]`)
        target = have.map(h => ({ name: h.name, type: String(h.type || 'TEXT').toUpperCase() }))
        createdAt = Number(db.prepare(`SELECT created_at FROM ${ident(META_TABLE)} WHERE name = ?`).get(existing.name)?.created_at ?? createdAt)
      }
      const tname = existing && mode === 'append' ? existing.name : name
      if (mode === 'replace' && existing) {
        db.exec(`DROP TABLE ${ident(existing.name)}`)
        db.prepare(`DELETE FROM ${ident(META_TABLE)} WHERE name = ?`).run(existing.name)
      }
      if (mode !== 'append') db.exec(`CREATE TABLE ${ident(tname)} (${target.map(c => `${ident(c.name)} ${c.type}`).join(', ')})`)
      const n = target.length
      const batch = Math.max(1, Math.min(500, Math.floor(32766 / n)))
      const sqlFor = k => `INSERT INTO ${ident(tname)} (${target.map(c => ident(c.name)).join(', ')}) VALUES ${Array.from({ length: k }, () => `(${Array(n).fill('?').join(',')})`).join(',')}`
      const full = db.prepare(sqlFor(batch))
      const flat = (slice) => {
        const out = []
        for (const r of slice) {
          const row = Array.isArray(r) ? r : []
          for (let i = 0; i < n; i++) out.push(toValue(row[i], target[i].type))
        }
        return out
      }
      let i = 0
      for (; i + batch <= list.length; i += batch) { full.run(...flat(list.slice(i, i + batch))); inserted += batch }
      if (i < list.length) {
        const rest = list.slice(i)
        db.prepare(sqlFor(rest.length)).run(...flat(rest))
        inserted += rest.length
      }
      const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${ident(tname)}`).get().n)
      const now = Date.now()
      db.prepare(`INSERT INTO ${ident(META_TABLE)} (name, source, rows, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET source = excluded.source, rows = excluded.rows, updated_at = excluded.updated_at`).run(tname, String(source ?? ''), total, createdAt, now)
      db.exec('COMMIT')
      return { table: tname, rows: inserted, columns: target }
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw translate(error)
    }
  } finally {
    db.close()
  }
}

/** Drop a user table and its metadata row. */
export function dropTable({ file, table }) {
  if (/^sqlite_/i.test(String(table)) || String(table).toLowerCase() === META_TABLE) throw fail('sqlite/invalid-name', `不能删除系统表：${table}`)
  const db = openWrite(file)
  try {
    const existing = findTable(db, String(table))
    if (!existing) throw fail('sqlite/not-found', `表不存在：${table}`)
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`DROP ${existing.type === 'view' ? 'VIEW' : 'TABLE'} ${ident(existing.name)}`)
      db.prepare(`DELETE FROM ${ident(META_TABLE)} WHERE name = ?`).run(existing.name)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw translate(error)
    }
    return { table: existing.name, dropped: true }
  } finally {
    db.close()
  }
}

/** List imported tables with live row counts and upload metadata. */
export function listTables({ file }) {
  if (!file || !existsSync(file)) return []
  const s = new ReadSession(file)
  try {
    const meta = s.meta()
    return s.userTables().filter(t => t.type === 'table').map((t) => {
      const m = meta.get(t.name)
      return { name: t.name, rows: s.rowCount(t.name), source: m?.source ?? null, createdAt: m?.created_at ?? null, updatedAt: m?.updated_at ?? null }
    })
  } finally {
    s.close()
  }
}

/** Size on disk (including WAL/journal side files) and user table count. */
export function fileStats({ file }) {
  if (!file || !existsSync(file)) return { bytes: 0, tables: 0 }
  let bytes = 0
  for (const f of [file, `${file}-wal`, `${file}-journal`]) { try { bytes += statSync(f).size } catch {} }
  const s = new ReadSession(file)
  try {
    return { bytes, tables: s.userTables().filter(t => t.type === 'table').length }
  } finally {
    s.close()
  }
}
