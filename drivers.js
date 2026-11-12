/**
 * Database drivers behind one interface.
 *
 *   test()                      → { version, user, database, tableCount, readOnlyGrant, grants, warnings }
 *   introspect()                → { version, tables, columns, foreignKeys, indexes }  (raw, driver-neutral)
 *   query(sql, { timeoutMs, maxRows }) → { columns: [{ name, kind, table?, column? }], rows: any[][] }
 *   explain(sql, { timeoutMs }) → { plan: object[], scans: [{ table, rows }] }
 *   sampleColumn(table, column) → [{ value, count }]
 *   preview(table, limit)       → same shape as query
 *   ident(name)                 → quoted identifier for the dialect
 *   close()
 *
 * Every driver executes statements read-only: MySQL and PostgreSQL inside a
 * READ ONLY transaction with a statement timeout, Elasticsearch through the
 * SQL API, which cannot write.
 */
import { createServer } from 'node:net'
import mysql from 'mysql2/promise'
import pg from 'pg'
import ssh2 from 'ssh2'
import { stripSql } from './sql-guard.js'

export class DriverError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const DIALECTS = {
  mysql: { label: 'MySQL', defaultPort: 3306, sqlName: 'MySQL' },
  postgres: { label: 'PostgreSQL', defaultPort: 5432, sqlName: 'PostgreSQL' },
  elasticsearch: { label: 'Elasticsearch', defaultPort: 9200, sqlName: 'Elasticsearch SQL' },
  sqlite: { label: '本地文件（CSV / Excel）', defaultPort: 0, sqlName: 'SQLite' },
}

export function parseVersion(v) {
  const m = String(v ?? '').match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] ?? 0) : 0
}

function toCell(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (Buffer.isBuffer(value)) {
    if (value.length === 1 && (value[0] === 0 || value[0] === 1)) return value[0]
    return `0x${value.subarray(0, 64).toString('hex')}${value.length > 64 ? '…' : ''}`
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

// ---------------------------------------------------------------- SSH tunnel

/**
 * Open a local TCP listener that forwards every connection through one SSH
 * session to targetHost:targetPort. Returns { host, port, close }.
 */
export async function openTunnel(ssh, targetHost, targetPort) {
  const client = new ssh2.Client()
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DriverError('ssh/timeout', 'SSH 连接超时')), 15000)
    client.once('ready', () => { clearTimeout(timer); resolve() })
    client.once('error', (e) => { clearTimeout(timer); reject(new DriverError('ssh/error', `SSH 连接失败：${e.message}`)) })
    client.connect({
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.user,
      ...(ssh.privateKey ? { privateKey: ssh.privateKey, passphrase: ssh.passphrase || undefined } : { password: ssh.password }),
      readyTimeout: 15000,
      keepaliveInterval: 20000,
    })
  })
  let broken = null
  client.on('error', (e) => { broken = e })
  client.on('close', () => { broken ??= new Error('SSH connection closed') })
  const sockets = new Set()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    if (broken) { socket.destroy(); return }
    client.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
      if (err) { socket.destroy(err); return }
      socket.pipe(stream).pipe(socket)
      stream.on('error', () => socket.destroy())
      socket.on('error', () => stream.destroy())
    })
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = server.address()
  return {
    host: '127.0.0.1',
    port,
    get broken() { return broken },
    async close() {
      for (const s of sockets) s.destroy()
      await new Promise(r => server.close(() => r()))
      client.end()
    },
  }
}

// --------------------------------------------------------------------- MySQL

const MYSQL_NUM = new Set([0, 1, 2, 3, 4, 5, 8, 9, 246, 13])
const MYSQL_TIME = new Set([7, 10, 11, 12, 14])

class MysqlDriver {
  constructor(conf) {
    this.conf = conf
    this.dialect = 'mysql'
    this.pool = mysql.createPool({
      host: conf.host, port: conf.port, user: conf.user, password: conf.password, database: conf.database,
      charset: conf.charset || 'utf8mb4', timezone: 'local',
      connectionLimit: 3, maxIdle: 1, idleTimeout: 60000, connectTimeout: 10000,
      multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
      ...(conf.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    this.version = conf.serverVersion ?? ''
  }

  ident(name) {
    return `\`${String(name).replace(/`/g, '``')}\``
  }

  async run(sql, params, timeoutMs) {
    const conn = await this.pool.getConnection()
    try {
      await conn.query('START TRANSACTION READ ONLY')
      try {
        const [rows, fields] = await conn.query({ sql, values: params, timeout: timeoutMs, rowsAsArray: true })
        return { rows, fields: fields ?? [] }
      } finally {
        await conn.query('ROLLBACK').catch(() => {})
      }
    } catch (error) {
      if (error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
        conn.destroy()
        throw new DriverError('query/timeout', `查询超时（>${timeoutMs}ms）`)
      }
      throw error
    } finally {
      try { conn.release() } catch {}
    }
  }

  async objects(sql, params, timeoutMs) {
    const { rows, fields } = await this.run(sql, params, timeoutMs)
    return rows.map(r => Object.fromEntries(fields.map((f, i) => [f.name, r[i]])))
  }

  async test() {
    const [ver] = await this.objects('SELECT VERSION() AS version, CURRENT_USER() AS user, DATABASE() AS db', [], 10000)
    const grants = (await this.objects('SHOW GRANTS FOR CURRENT_USER()', [], 10000)).map(g => String(Object.values(g)[0]))
    const writes = grants.some(g => /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT OPTION)\b/i.test(g))
    const [{ n }] = await this.objects('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', [], 10000)
    const version = String(ver.version)
    this.version = version
    const old = parseVersion(version) < 50700 && !/mariadb/i.test(version)
    return {
      version, user: ver.user, database: ver.db, tableCount: Number(n), readOnlyGrant: !writes, grants: grants.slice(0, 12),
      warnings: [...(old ? ['服务器版本低于 5.7，部分功能可能不可用'] : []), ...(writes ? ['当前账号拥有写权限。查询始终在只读事务中执行，但仍建议使用只读账号。'] : [])],
    }
  }

  async introspect(timeoutMs) {
    const db = this.conf.database
    const q = (sql) => this.objects(sql, [db], timeoutMs)
    const [tables, columns, fks, indexes, [ver]] = await Promise.all([
      q(`SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS \`rows\`, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`),
      q(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_KEY AS \`key\`, EXTRA AS extra, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`),
      q(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`),
      q(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`),
      this.objects('SELECT VERSION() AS version', [], timeoutMs),
    ])
    this.version = String(ver.version)
    return {
      version: this.version,
      tables: tables.map(t => ({ name: t.name, type: t.type === 'VIEW' ? 'VIEW' : 'TABLE', rows: t.rows === null ? null : Number(t.rows), comment: t.comment ?? '' })),
      columns: columns.map(c => ({ table: c.tableName, name: c.name, dataType: String(c.dataType).toLowerCase(), columnType: String(c.columnType).toLowerCase(), nullable: c.nullable === 'YES', key: c.key || '', comment: c.comment ?? '', ...(c.extra ? { extra: c.extra } : {}) })),
      foreignKeys: fks.map(r => ({ from: { table: r.tableName, column: r.columnName }, to: { table: r.refTable, column: r.refColumn } })),
      indexes: indexes.map(i => ({ table: i.tableName, name: i.indexName, unique: Number(i.nonUnique) === 0, column: i.columnName })),
    }
  }

  get useHint() {
    return parseVersion(this.version) >= 50708 && !/mariadb/i.test(this.version)
  }

  /**
   * Run one statement streaming its rows: at most maxRows + 1 rows are kept;
   * once that many arrived the pooled connection is destroyed (never returned
   * to the pool mid-result), which also aborts the statement on the server.
   */
  async stream(sql, { timeoutMs, maxRows }) {
    const limit = Number.isFinite(maxRows) && maxRows >= 0 ? maxRows + 1 : Infinity
    const conn = await this.pool.getConnection()
    const core = conn.connection
    let destroyed = false
    const destroy = () => { if (!destroyed) { destroyed = true; try { conn.destroy() } catch {} } }
    // Late protocol errors after an intentional destroy must not crash the process.
    const swallow = () => {}
    core.on('error', swallow)
    // MAX_EXECUTION_TIME as a hint only fits a leading SELECT; other heads (WITH …) get the session limit.
    const sessionLimit = this.useHint && !/MAX_EXECUTION_TIME/i.test(sql)
    try {
      if (sessionLimit) await conn.query(`SET SESSION max_execution_time = ${Math.max(1, Math.floor(timeoutMs))}`)
      await conn.query('START TRANSACTION READ ONLY')
      const out = await new Promise((resolve, reject) => {
        const rows = []
        let fields = []
        let settled = false
        const q = core.query({ sql, timeout: timeoutMs + 2000, rowsAsArray: true })
        q.on('fields', (f) => { fields = f ?? [] })
        q.on('result', (row) => {
          if (settled) return
          rows.push(row)
          if (rows.length >= limit) {
            settled = true
            destroy()
            resolve({ rows, fields, aborted: true })
          }
        })
        q.on('error', (error) => {
          if (settled) return
          settled = true
          reject(error)
        })
        q.on('end', () => {
          if (settled) return
          settled = true
          resolve({ rows, fields, aborted: false })
        })
      })
      if (!out.aborted) {
        await conn.query('ROLLBACK').catch(() => {})
        if (sessionLimit) await conn.query('SET SESSION max_execution_time = DEFAULT').catch(() => destroy())
      }
      return out
    } catch (error) {
      if (error.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
        destroy()
        throw new DriverError('query/timeout', `查询超时（>${timeoutMs}ms）`)
      }
      if (!destroyed) {
        await conn.query('ROLLBACK').catch(() => destroy())
        if (sessionLimit && !destroyed) await conn.query('SET SESSION max_execution_time = DEFAULT').catch(() => destroy())
      }
      throw error
    } finally {
      // A destroyed connection keeps the no-op listener: its socket may still report errors.
      if (!destroyed) { core.removeListener('error', swallow); try { conn.release() } catch {} }
    }
  }

  async query(sql, { timeoutMs, maxRows }) {
    const { rows, fields } = await this.stream(sql, { timeoutMs, maxRows })
    return {
      columns: fields.map((f, i) => ({
        name: f.name,
        kind: MYSQL_TIME.has(f.type) ? 'time' : MYSQL_NUM.has(f.type) ? (/(^id$|_id$)/i.test(f.name) ? 'text' : 'number') : 'auto',
        table: f.orgTable, column: f.orgName, index: i,
      })),
      rows: rows.map(r => r.map(toCell)),
    }
  }

  async explain(sql, { timeoutMs }) {
    const plan = await this.objects(`EXPLAIN ${sql}`, [], timeoutMs)
    return {
      plan: plan.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toCell(v)]))),
      scans: plan.filter(r => String(r.type ?? '').toUpperCase() === 'ALL' && r.table && !String(r.table).startsWith('<')).map(r => ({ table: r.table, rows: Number(r.rows ?? 0) })),
    }
  }

  async sampleColumn(table, column) {
    const rows = await this.objects(`SELECT ${this.useHint ? '/*+ MAX_EXECUTION_TIME(3000) */ ' : ''}${this.ident(column)} AS v, COUNT(*) AS n FROM ${this.ident(table)} GROUP BY ${this.ident(column)} ORDER BY n DESC LIMIT 13`, [], 5000)
    return rows.map(r => ({ value: toCell(r.v), count: Number(r.n) }))
  }

  previewSql(table, limit) {
    return `SELECT * FROM ${this.ident(table)} LIMIT ${limit}`
  }

  async close() {
    await this.pool.end().catch(() => {})
  }
}

// ---------------------------------------------------------------- PostgreSQL

/** Leading keyword when a PostgreSQL statement can be declared as a cursor, else ''. */
export function cursorHead(sql) {
  let code
  try { code = stripSql(String(sql), { dialect: 'postgres' }).code } catch { return '' }
  const head = (code.trim().match(/^\(*\s*([A-Za-z]+)/)?.[1] ?? '').toUpperCase()
  return ['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(head) ? head : ''
}

// pg type OIDs
const PG_NUM = new Set([20, 21, 23, 26, 700, 701, 1700, 790])
const PG_TIME = new Set([1082, 1083, 1114, 1184, 1266])

class PostgresDriver {
  constructor(conf) {
    this.conf = conf
    this.dialect = 'postgres'
    this.version = conf.serverVersion ?? ''
    this.pool = new pg.Pool({
      host: conf.host, port: conf.port, user: conf.user, password: conf.password, database: conf.database,
      max: 3, idleTimeoutMillis: 60000, connectionTimeoutMillis: 10000,
      ...(conf.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    this.pool.on('error', () => {})
    // Return text for dates and big numbers so values stay lossless and JSON friendly.
    this.types = {
      getTypeParser: (oid, format) => {
        if (PG_TIME.has(oid) || oid === 20 || oid === 1700) return (v) => v
        return pg.types.getTypeParser(oid, format)
      },
    }
  }

  ident(name) {
    return String(name).split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.')
  }

  async run(sql, params, timeoutMs, rowMode) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
      try {
        // Extended protocol (parse/bind/execute) refuses multi-statement strings, so a
        // guard mistake cannot smuggle `; COMMIT; …` past the READ ONLY transaction.
        return await client.query({ text: sql, values: params ?? [], types: this.types, queryMode: 'extended', ...(rowMode ? { rowMode } : {}) })
      } finally {
        await client.query('ROLLBACK').catch(() => {})
      }
    } catch (error) {
      if (error.code === '57014') throw new DriverError('query/timeout', `查询超时（>${timeoutMs}ms）`)
      throw error
    } finally {
      client.release()
    }
  }

  async objects(sql, params, timeoutMs) {
    return (await this.run(sql, params, timeoutMs, undefined)).rows
  }

  get schemas() {
    const list = String(this.conf.schemas ?? '').split(/[,\s]+/).filter(Boolean)
    return list.length ? list : null
  }

  schemaFilter(col) {
    return this.schemas
      ? { sql: `${col} = ANY($1)`, params: [this.schemas] }
      : { sql: `${col} NOT IN ('pg_catalog','information_schema') AND ${col} NOT LIKE 'pg_toast%' AND ${col} NOT LIKE 'pg_temp%'`, params: [] }
  }

  async test() {
    const [info] = await this.objects('SELECT version() AS version, current_user AS "user", current_database() AS db, current_setting(\'server_version\') AS sv', [], 10000)
    const f = this.schemaFilter('table_schema')
    const [{ n }] = await this.objects(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE ${f.sql}`, f.params, 10000)
    const [priv] = await this.objects(`SELECT
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
        EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee = current_user AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) AS writes,
        (SELECT COUNT(*) FROM pg_namespace n WHERE has_schema_privilege(n.oid, 'CREATE') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema')::int AS create_schemas`, [], 10000)
    const writes = Boolean(priv.superuser || priv.writes)
    this.version = String(info.sv)
    return {
      version: `PostgreSQL ${info.sv}`, user: info.user, database: info.db, tableCount: Number(n), readOnlyGrant: !writes,
      grants: [`superuser: ${priv.superuser}`, `table write grants: ${priv.writes}`, `schemas with CREATE: ${priv.create_schemas}`],
      warnings: writes ? ['当前账号拥有写权限（或为超级用户）。查询始终在只读事务中执行，但仍建议使用只读账号。'] : [],
    }
  }

  async introspect(timeoutMs) {
    const f = this.schemaFilter('n.nspname')
    const tables = await this.objects(`
      SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
             GREATEST(c.reltuples, 0)::bigint AS rows, obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','v','m','p','f') AND NOT c.relispartition AND ${f.sql}
      ORDER BY n.nspname, c.relname`, f.params, timeoutMs)
    const columns = await this.objects(`
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
             format_type(a.atttypid, a.atttypmod) AS column_type, t.typname AS data_type,
             NOT a.attnotnull AS nullable, col_description(c.oid, a.attnum) AS comment,
             EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid
      WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','v','m','p','f') AND NOT c.relispartition AND ${f.sql}
      ORDER BY n.nspname, c.relname, a.attnum`, f.params, timeoutMs)
    const fks = await this.objects(`
      SELECT n.nspname AS schema, c.relname AS table, a.attname AS column, nf.nspname AS ref_schema, cf.relname AS ref_table, af.attname AS ref_column
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class cf ON cf.oid = k.confrelid JOIN pg_namespace nf ON nf.oid = cf.relnamespace
      JOIN LATERAL unnest(k.conkey, k.confkey) AS u(col, refcol) ON true
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.col
      JOIN pg_attribute af ON af.attrelid = k.confrelid AND af.attnum = u.refcol
      WHERE k.contype = 'f' AND ${f.sql}`, f.params, timeoutMs)
    const indexes = await this.objects(`
      SELECT n.nspname AS schema, c.relname AS table, ic.relname AS index_name, i.indisunique AS unique, a.attname AS column
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE ${f.sql} ORDER BY n.nspname, c.relname, ic.relname, k.ord`, f.params, timeoutMs)
    const [{ sv }] = await this.objects(`SELECT current_setting('server_version') AS sv`, [], timeoutMs)
    this.version = sv
    const single = new Set(tables.map(t => t.schema)).size === 1 && (tables[0]?.schema === 'public')
    const qn = (schema, name) => (single ? name : `${schema}.${name}`)
    const pgType = (t) => {
      if (/^(int2|int4|int8|serial)/.test(t)) return t === 'int2' ? 'smallint' : t === 'int8' ? 'bigint' : 'int'
      if (/^(float4|float8|numeric)$/.test(t)) return t === 'numeric' ? 'decimal' : 'double'
      if (t === 'bool') return 'tinyint'
      if (/^(timestamp|timestamptz)$/.test(t)) return 'datetime'
      if (t === 'date') return 'date'
      if (/^(time|timetz)$/.test(t)) return 'time'
      if (/^(varchar|bpchar|text|name|citext)$/.test(t)) return 'varchar'
      if (/^(json|jsonb)$/.test(t)) return 'json'
      return t
    }
    return {
      version: sv,
      qualified: !single,
      tables: tables.map(t => ({ name: qn(t.schema, t.name), type: t.kind === 'v' || t.kind === 'm' ? 'VIEW' : 'TABLE', rows: t.rows === null ? null : Number(t.rows), comment: t.comment ?? '' })),
      columns: columns.map(c => ({ table: qn(c.schema, c.table), name: c.name, dataType: pgType(c.data_type), columnType: c.column_type, nullable: c.nullable, key: c.pk ? 'PRI' : '', comment: c.comment ?? '', ...(c.data_type === 'bool' ? { columnType: 'tinyint(1)' } : {}) })),
      foreignKeys: fks.map(r => ({ from: { table: qn(r.schema, r.table), column: r.column }, to: { table: qn(r.ref_schema, r.ref_table), column: r.ref_column } })),
      indexes: indexes.map(i => ({ table: qn(i.schema, i.table), name: i.index_name, unique: i.unique, column: i.column })),
    }
  }

  /**
   * Run a statement through a server-side cursor so at most maxRows + 1 rows
   * are pulled. Statements that cannot be declared as a cursor (SHOW, EXPLAIN)
   * run as a plain query.
   */
  async cursorRun(sql, { timeoutMs, maxRows }) {
    const head = cursorHead(sql)
    if (!head || !Number.isFinite(maxRows)) return this.run(sql, [], timeoutMs, 'array')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
      try {
        // Extended protocol refuses multi-statement strings: the DECLARE cannot carry a second statement.
        await client.query({ text: `DECLARE nl2sql_cur NO SCROLL CURSOR FOR ${sql}`, queryMode: 'extended' })
        return await client.query({ text: `FETCH FORWARD ${Math.max(1, Math.floor(maxRows) + 1)} FROM nl2sql_cur`, types: this.types, queryMode: 'extended', rowMode: 'array' })
      } finally {
        await client.query('ROLLBACK').catch(() => {})
      }
    } catch (error) {
      if (error.code === '57014') throw new DriverError('query/timeout', `查询超时（>${timeoutMs}ms）`)
      throw error
    } finally {
      client.release()
    }
  }

  async query(sql, { timeoutMs, maxRows }) {
    const res = await this.cursorRun(sql, { timeoutMs, maxRows })
    return {
      columns: (res.fields ?? []).map((f, i) => ({
        name: f.name,
        kind: PG_TIME.has(f.dataTypeID) ? 'time' : PG_NUM.has(f.dataTypeID) ? (/(^id$|_id$)/i.test(f.name) ? 'text' : 'number') : 'auto',
        index: i,
      })),
      rows: (res.rows ?? []).map(r => r.map(toCell)),
    }
  }

  async explain(sql, { timeoutMs }) {
    const res = await this.objects(`EXPLAIN (FORMAT JSON) ${sql}`, [], timeoutMs)
    const root = res[0]?.['QUERY PLAN']?.[0]?.Plan
    const flat = []
    const scans = []
    const walk = (node, depth) => {
      if (!node) return
      flat.push({ depth, node: node['Node Type'], relation: node['Relation Name'] ?? null, index: node['Index Name'] ?? null, rows: node['Plan Rows'], cost: node['Total Cost'], filter: node.Filter ?? node['Index Cond'] ?? null })
      if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) scans.push({ table: node['Relation Name'], rows: Number(node['Plan Rows'] ?? 0) * 1 })
      for (const child of node.Plans ?? []) walk(child, depth + 1)
    }
    walk(root, 0)
    // Plan Rows of a filtered Seq Scan is the estimated output; use the table size for the guard.
    for (const s of scans) {
      try {
        const [{ n }] = await this.objects('SELECT GREATEST(reltuples, 0)::bigint AS n FROM pg_class WHERE relname = $1 ORDER BY reltuples DESC LIMIT 1', [s.table], 3000)
        s.rows = Math.max(s.rows, Number(n))
      } catch {}
    }
    return { plan: flat, scans }
  }

  async sampleColumn(table, column) {
    const rows = await this.objects(`SELECT ${this.ident(column)}::text AS v, COUNT(*)::bigint AS n FROM ${this.ident(table)} GROUP BY 1 ORDER BY 2 DESC LIMIT 13`, [], 5000)
    return rows.map(r => ({ value: r.v, count: Number(r.n) }))
  }

  previewSql(table, limit) {
    return `SELECT * FROM ${this.ident(table)} LIMIT ${limit}`
  }

  async close() {
    await this.pool.end().catch(() => {})
  }
}

// ------------------------------------------------------------ Elasticsearch

const ES_NUM = new Set(['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float', 'unsigned_long'])
const ES_TIME = new Set(['datetime', 'date', 'time', 'date_nanos'])

class ElasticsearchDriver {
  constructor(conf) {
    this.conf = conf
    this.dialect = 'elasticsearch'
    this.version = conf.serverVersion ?? ''
    const scheme = conf.ssl ? 'https' : 'http'
    this.base = `${scheme}://${conf.host}:${conf.port}`
    this.headers = { 'content-type': 'application/json', accept: 'application/json' }
    if (conf.apiKey) this.headers.authorization = `ApiKey ${conf.apiKey}`
    else if (conf.user) this.headers.authorization = `Basic ${Buffer.from(`${conf.user}:${conf.password ?? ''}`).toString('base64')}`
    this.indexPattern = String(conf.database || '*').trim() || '*'
  }

  ident(name) {
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `"${String(name).replace(/"/g, '""')}"`
  }

  async request(method, path, body, timeoutMs = 15000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(`${this.base}${path}`, {
        method, headers: this.headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        // Self-signed clusters are common internally; Node fetch honours NODE_TLS_REJECT_UNAUTHORIZED only.
      })
    } catch (error) {
      if (error.name === 'AbortError') throw new DriverError('query/timeout', `请求超时（>${timeoutMs}ms）`)
      throw new DriverError('es/connect', `无法连接 Elasticsearch：${error.cause?.code ?? error.message}`)
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
    if (!res.ok) {
      const reason = json?.error?.root_cause?.[0]?.reason ?? json?.error?.reason ?? json?.error ?? text.slice(0, 300)
      throw new DriverError(res.status === 401 || res.status === 403 ? 'es/auth' : 'es/error', `Elasticsearch ${res.status}: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`)
    }
    return json
  }

  async test() {
    const info = await this.request('GET', '/')
    const version = String(info.version?.number ?? '')
    this.version = version
    let indices = []
    try { indices = await this.request('GET', `/_cat/indices/${encodeURIComponent(this.indexPattern)}?format=json&h=index`) } catch {}
    let readOnly = null
    const grants = []
    try {
      const priv = await this.request('POST', '/_security/user/_has_privileges', { index: [{ names: [this.indexPattern], privileges: ['write', 'delete', 'manage'] }] })
      const p = Object.values(priv.index ?? {})[0] ?? {}
      readOnly = !(p.write || p.delete || p.manage)
      grants.push(`write=${p.write} delete=${p.delete} manage=${p.manage}`)
    } catch {
      grants.push('security disabled or privileges API unavailable')
    }
    const major = parseVersion(version)
    return {
      version: `Elasticsearch ${version}`, user: this.conf.user || (this.conf.apiKey ? 'api-key' : 'anonymous'), database: this.indexPattern,
      tableCount: indices.filter(i => !String(i.index).startsWith('.')).length, readOnlyGrant: readOnly ?? undefined, grants,
      warnings: [
        ...(major < 60300 ? ['Elasticsearch 6.3 以下不支持 SQL 接口'] : []),
        ...(readOnly === false ? ['该账号对索引有写权限。插件只通过只读的 SQL 接口查询，但仍建议使用只读账号。'] : []),
        ...(readOnly === null ? ['集群未开启安全认证，无法检查账号权限'] : []),
      ],
    }
  }

  async introspect(timeoutMs) {
    const info = await this.request('GET', '/', undefined, timeoutMs)
    this.version = String(info.version?.number ?? '')
    const cat = await this.request('GET', `/_cat/indices/${encodeURIComponent(this.indexPattern)}?format=json&h=index,docs.count,status`, undefined, timeoutMs)
    const visible = cat.filter(i => !String(i.index).startsWith('.')).sort((a, b) => String(a.index).localeCompare(String(b.index))).slice(0, 300)
    const tables = []
    const columns = []
    const indexes = []
    if (visible.length) {
      const mappings = await this.request('GET', `/${visible.map(i => encodeURIComponent(i.index)).join(',')}/_mapping`, undefined, timeoutMs)
      for (const idx of visible) {
        const props = mappings[idx.index]?.mappings?.properties ?? {}
        tables.push({ name: idx.index, type: 'TABLE', rows: idx['docs.count'] === null ? null : Number(idx['docs.count']), comment: mappings[idx.index]?.mappings?._meta?.description ?? '' })
        const walk = (properties, prefix) => {
          for (const [field, spec] of Object.entries(properties ?? {})) {
            const name = prefix ? `${prefix}.${field}` : field
            if (spec.properties) { walk(spec.properties, name); continue }
            const t = spec.type ?? 'object'
            const dataType = ES_NUM.has(t) ? (t === 'long' || t === 'unsigned_long' ? 'bigint' : t === 'integer' || t === 'short' || t === 'byte' ? 'int' : 'double')
              : t === 'date' || t === 'date_nanos' ? 'datetime' : t === 'boolean' ? 'tinyint' : t === 'keyword' || t === 'constant_keyword' || t === 'wildcard' ? 'varchar' : t === 'text' || t === 'match_only_text' ? 'text' : t
            columns.push({ table: idx.index, name, dataType, columnType: t + (spec.fields?.keyword ? ' (+keyword)' : ''), nullable: true, key: name === '_id' ? 'PRI' : '', comment: spec.meta?.description ?? '', ...(t === 'boolean' ? { columnType: 'tinyint(1)' } : {}) })
            if (t !== 'text') indexes.push({ table: idx.index, name: `${name}`, unique: false, column: name })
          }
        }
        walk(props, '')
      }
    }
    return { version: this.version, tables, columns, foreignKeys: [], indexes: [] }
  }

  async query(sql, { timeoutMs, maxRows }) {
    const fetchSize = Math.min(Math.max(maxRows + 1, 1), 10000)
    const body = { query: sql, fetch_size: fetchSize, request_timeout: `${Math.ceil(timeoutMs / 1000)}s`, page_timeout: '30s', time_zone: this.conf.timezone && this.conf.timezone !== 'local' ? this.conf.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone }
    const res = await this.request('POST', '/_sql?format=json', body, timeoutMs + 3000)
    const rows = [...(res.rows ?? [])]
    let cursor = res.cursor
    while (cursor && rows.length <= maxRows) {
      const next = await this.request('POST', '/_sql?format=json', { cursor }, timeoutMs + 3000)
      rows.push(...(next.rows ?? []))
      cursor = next.cursor
    }
    if (cursor) await this.request('POST', '/_sql/close', { cursor }).catch(() => {})
    return {
      columns: (res.columns ?? []).map((c, i) => ({ name: c.name, kind: ES_TIME.has(c.type) ? 'time' : ES_NUM.has(c.type) ? 'number' : 'auto', index: i })),
      rows: rows.map(r => r.map(toCell)),
    }
  }

  async explain(sql, { timeoutMs }) {
    const res = await this.request('POST', '/_sql/translate', { query: sql }, timeoutMs)
    return { plan: [{ translated_query_dsl: JSON.stringify(res) }], scans: [] }
  }

  async sampleColumn(table, column) {
    const res = await this.request('POST', `/${encodeURIComponent(table)}/_search`, { size: 0, aggs: { v: { terms: { field: column, size: 13 } } } }, 5000)
    return (res.aggregations?.v?.buckets ?? []).map(b => ({ value: b.key_as_string ?? b.key, count: b.doc_count }))
  }

  previewSql(table, limit) {
    return `SELECT * FROM ${this.ident(table)} LIMIT ${limit}`
  }

  async close() {}
}

// ------------------------------------------------------------------- factory

/**
 * Create a driver for a data source; opens the SSH tunnel first when
 * configured. The returned driver's close() also closes the tunnel.
 * @param {object} conf - data source record plus resolved secrets.
 */
export async function createDriver(conf) {
  if (conf.type === 'sqlite') {
    const { SqliteDriver, useErrorClass } = await import('./sqlite-driver.js')
    useErrorClass(DriverError)
    return new SqliteDriver({ file: conf.file })
  }
  let tunnel
  let effective = conf
  if (conf.ssh?.enabled) {
    tunnel = await openTunnel(conf.ssh, conf.host, conf.port)
    effective = { ...conf, host: tunnel.host, port: tunnel.port }
  }
  const Driver = conf.type === 'postgres' ? PostgresDriver : conf.type === 'elasticsearch' ? ElasticsearchDriver : MysqlDriver
  const driver = new Driver(effective)
  if (tunnel) {
    const close = driver.close.bind(driver)
    driver.close = async () => { await close(); await tunnel.close() }
    driver.tunnel = tunnel
  }
  return driver
}

/** Map a driver/database error to a user-readable message. */
export function describeError(error) {
  if (error instanceof DriverError) return { code: error.code, message: error.message }
  const code = error?.code ?? 'ERR'
  const hints = {
    ER_ACCESS_DENIED_ERROR: '用户名或密码错误', '28P01': '用户名或密码错误', '28000': '认证失败',
    ECONNREFUSED: '无法连接到数据库服务器（连接被拒绝）', ETIMEDOUT: '连接超时', ENOTFOUND: '主机名无法解析',
    ER_BAD_DB_ERROR: '数据库不存在', '3D000': '数据库不存在', ER_QUERY_TIMEOUT: '查询超过最大执行时间', '57014': '查询超时被取消',
    '25006': '只读事务中不能执行写操作', ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION: '只读事务中不能执行写操作',
  }
  const hint = hints[code] ? `${hints[code]}：` : ''
  return { code: `db/${code}`, message: `${hint}${error?.sqlMessage ?? error?.message ?? String(error)}` }
}
