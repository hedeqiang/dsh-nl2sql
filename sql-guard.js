/**
 * Read-only SQL admission for MySQL 5.7+, PostgreSQL, Elasticsearch SQL and SQLite.
 *
 * The guard is a syntactic first line of defence; execution additionally runs
 * inside a READ ONLY transaction with a server-side time limit, so a statement
 * the guard misjudges still cannot write.
 */

const ALLOWED_HEADS = {
  mysql: new Set(['SELECT', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN', 'WITH']),
  postgres: new Set(['SELECT', 'SHOW', 'EXPLAIN', 'WITH', 'VALUES', 'TABLE']),
  elasticsearch: new Set(['SELECT', 'SHOW', 'DESC', 'DESCRIBE']),
  sqlite: new Set(['SELECT', 'WITH', 'VALUES', 'EXPLAIN']),
}

// PostgreSQL functions that write, signal, sleep, or reach the file system.
const PG_FORBIDDEN = /\b(pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|nextval|setval|set_config|pg_advisory\w*|pg_try_advisory\w*|pg_notify|txid_current|pg_switch_wal|pg_create_\w+|pg_drop_\w+|pg_logical_\w+|copy|query_to_xml\w*|query_to_json\w*|table_to_xml\w*|cursor_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|pg_get_\w*def|pg_get_expr|xmlparse|xmltable|pg_read_\w+|pg_file_\w+|pg_execute\w*|current_setting|pg_settings)\s*\(/i

// SQLite: extension loading, file I/O (CLI/fileio shell functions), tokenizer pointer tricks,
// and statements that touch other database files or the schema/connection state.
const SQLITE_FORBIDDEN_FN = /\b(load_extension|readfile|writefile|edit|fts3_tokenizer|zipfile|sqlar_\w+|lsmode|randomblob|zeroblob)\s*\(/i
const SQLITE_FORBIDDEN_STMT = /\b(ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|RETURNING)\b/i

const FORBIDDEN = [
  [/\bINTO\s+(OUTFILE|DUMPFILE)\b/i, 'INTO OUTFILE/DUMPFILE is not allowed'],
  [/\bINTO\s+@/i, 'SELECT ... INTO @variable is not allowed'],
  [/\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i, 'SELECT ... FOR UPDATE/SHARE takes locks and is not allowed'],
  [/\bLOCK\s+IN\s+SHARE\s+MODE\b/i, 'LOCK IN SHARE MODE is not allowed'],
  [/\b(SLEEP|BENCHMARK|LOAD_FILE|GET_LOCK|RELEASE_LOCK|RELEASE_ALL_LOCKS)\s*\(/i, 'time-wasting or file/lock functions are not allowed'],
  [/\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL|HANDLER|LOAD|SET|USE|KILL|FLUSH|RESET|SHUTDOWN|INSTALL|UNINSTALL|PREPARE|EXECUTE|DEALLOCATE|LOCK|UNLOCK|START|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|XA|DO|ANALYZE|OPTIMIZE|REPAIR|CHECKSUM)\b/i, 'only read-only statements are allowed'],
]

/**
 * Per-dialect lexical rules. Getting these exactly right matters: if the guard
 * thinks a quote is escaped when the server does not (or vice versa), text the
 * server executes would be hidden inside a "string".
 *   mysql:          `-- ` needs whitespace after it, `#` comments, backslash escapes in '…' and "…", `…` identifiers
 *   postgres:       any `--` comments, no `#`, backslash escapes only inside E'…', $tag$…$tag$ dollar quoting, "…" identifiers
 *   sqlite:         any `--` comments, no `#`, no backslash escapes, "…" / `…` / […] identifiers
 *   elasticsearch:  any `--` comments, no `#`, no backslash escapes, "…" identifiers
 */
export function dialectRules(dialect = 'mysql') {
  const mysql = dialect === 'mysql'
  return {
    dashDashNeedsSpace: mysql,
    hashComment: mysql,
    backslashEscapes: mysql, // postgres: only E'…' strings (handled separately)
    dollarQuotes: dialect === 'postgres',
    escapeStrings: dialect === 'postgres',
    bracketIdents: dialect === 'sqlite',
    backtickIdents: mysql || dialect === 'sqlite',
  }
}

/**
 * Tokenize SQL into code / string / identifier / comment segments using the
 * dialect's lexical rules. Unterminated strings, identifiers and comments are
 * reported (the server would reject them, and they can hide code).
 * @returns {{ segments: { kind: 'code'|'string'|'ident'|'comment', text: string, start: number, end: number }[], unterminated: boolean, executableComment: boolean }}
 */
export function lexSql(sql, { dialect = 'mysql' } = {}) {
  const r = dialectRules(dialect)
  const segments = []
  let unterminated = false
  let executableComment = false
  let code = ''
  let codeStart = 0
  const flush = (end) => { if (code) segments.push({ kind: 'code', text: code, start: codeStart, end }); code = '' }
  const push = (kind, start, end) => { flush(start); segments.push({ kind, text: sql.slice(start, end), start, end }); codeStart = end }
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    // -- comments
    if (c === '-' && n === '-' && (!r.dashDashNeedsSpace || sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) {
      const start = i
      while (i < sql.length && sql[i] !== '\n') i++
      push('comment', start, i)
      continue
    }
    if (c === '#' && r.hashComment) {
      const start = i
      while (i < sql.length && sql[i] !== '\n') i++
      push('comment', start, i)
      continue
    }
    if (c === '/' && n === '*') {
      const start = i
      if (sql[i + 2] === '!' && dialect === 'mysql') executableComment = true
      // PostgreSQL block comments nest.
      let depth = 1
      i += 2
      while (i < sql.length && depth > 0) {
        if (dialect === 'postgres' && sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; continue }
        if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; continue }
        i++
      }
      if (depth > 0) unterminated = true
      push('comment', start, i)
      continue
    }
    // PostgreSQL dollar quoting: $$…$$ or $tag$…$tag$ (tag cannot start with a digit: $1 is a parameter).
    if (c === '$' && r.dollarQuotes) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
        const tag = m[0]
        const start = i
        const close = sql.indexOf(tag, i + tag.length)
        if (close < 0) { unterminated = true; i = sql.length } else i = close + tag.length
        push('string', start, i)
        continue
      }
    }
    const isEString = r.escapeStrings && (c === 'E' || c === 'e') && n === '\'' && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '')
    if (c === '\'' || isEString || c === '"' || (c === '`' && r.backtickIdents) || (c === '[' && r.bracketIdents)) {
      const start = i
      if (isEString) i++
      const q = sql[i]
      const closeCh = q === '[' ? ']' : q
      const backslash = q === '\'' || q === '"' ? (r.backslashEscapes || isEString) : false
      i++
      let closed = false
      while (i < sql.length) {
        if (backslash && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === closeCh) {
          if (closeCh !== ']' && sql[i + 1] === closeCh) { i += 2; continue }
          closed = true
          break
        }
        i++
      }
      if (!closed) unterminated = true
      i = Math.min(sql.length, i + 1)
      const isString = q === '\'' || (q === '"' && dialect === 'mysql')
      push(isString ? 'string' : 'ident', start, i)
      continue
    }
    if (!code) codeStart = i
    code += c
    i++
  }
  flush(sql.length)
  return { segments, unterminated, executableComment }
}

/**
 * Replace string literals, quoted identifiers and comments with placeholders so
 * the keyword checks only see SQL structure.
 * @returns {{ code: string, executableComment: boolean, unterminated: boolean }}
 */
export function stripSql(sql, { dialect = 'mysql' } = {}) {
  const { segments, unterminated, executableComment } = lexSql(sql, { dialect })
  const code = segments.map(s => s.kind === 'code' ? s.text : s.kind === 'string' ? ' _str_ ' : s.kind === 'ident' ? ' _ident_ ' : ' ').join('')
  return { code, executableComment, unterminated }
}

/**
 * Validate one statement and return its normalized form.
 * @param {string} input - user or model SQL.
 * @returns {{ sql: string, head: string, hasLimit: boolean }}
 * @throws Error with a model-readable reason when the statement is refused.
 */
export function admitSql(input, { dialect = 'mysql' } = {}) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('SQL is empty')
  let sql = input.trim()
  while (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd()
  const { code, executableComment, unterminated } = stripSql(sql, { dialect })
  if (executableComment) throw new Error('MySQL executable comments (/*! ... */) are not allowed')
  if (unterminated) throw new Error('unterminated string, identifier or comment')
  if (code.includes(';')) throw new Error('only one statement may be executed at a time')
  const head = (code.trim().match(/^\(*\s*([A-Za-z]+)/)?.[1] ?? '').toUpperCase()
  const allowed = ALLOWED_HEADS[dialect] ?? ALLOWED_HEADS.mysql
  if (!allowed.has(head)) throw new Error(`only read-only statements (${[...allowed].join(' / ')}) are allowed (got ${head || 'unknown'})`)
  if (dialect === 'postgres') {
    if (PG_FORBIDDEN.test(code)) throw new Error('this PostgreSQL function is not allowed in read-only queries')
    if (/\bINTO\b/i.test(code) && head !== 'EXPLAIN') throw new Error('SELECT ... INTO is not allowed')
    if (/\bEXPLAIN\b[^)]*\bANALY[SZ]E\b/i.test(code)) throw new Error('EXPLAIN ANALYZE executes the statement and is not allowed')
  }
  if (dialect === 'sqlite') {
    if (head === 'EXPLAIN' && !/^\(*\s*EXPLAIN\s+QUERY\s+PLAN\b/i.test(code.trim())) throw new Error('only EXPLAIN QUERY PLAN is allowed')
    if (SQLITE_FORBIDDEN_FN.test(code)) throw new Error('this SQLite function is not allowed in read-only queries')
    const m = code.match(SQLITE_FORBIDDEN_STMT)
    if (m) throw new Error(`${m[1].toUpperCase()} is not allowed; only read-only SELECT queries are allowed`)
    if (/\bINTO\b/i.test(code)) throw new Error('INTO is not allowed in read-only queries')
  }
  for (const [pattern, reason] of FORBIDDEN) {
    for (const m of code.matchAll(new RegExp(pattern.source, 'gi'))) {
      // REPLACE()/INSERT() are string functions and CHARACTER SET is a clause;
      // these spellings stay allowed inside a SELECT.
      if (isFunctionCall(code, m.index, m[0])) continue
      if (/^SET$/i.test(m[1] ?? '') && /CHARACTER\s+$/i.test(code.slice(Math.max(0, m.index - 12), m.index))) continue
      if (/^ANALYZE$/i.test(m[1] ?? '') && head === 'EXPLAIN' && dialect === 'mysql') continue
      if (/^LOCK$/i.test(m[1] ?? '') && /FOR\s+(UPDATE|SHARE|NO\s+KEY|KEY)\s*$/i.test(code.slice(Math.max(0, m.index - 20), m.index))) continue
      throw new Error(reason)
    }
  }
  const hasLimit = /\bLIMIT\s+\d+(\s*(,|OFFSET)\s*\d+)?\s*$/i.test(code.trim())
  return { sql, head, hasLimit }
}

function isFunctionCall(code, index, word) {
  const name = word.trim()
  if (!/^(REPLACE|INSERT|LOCK|SET|LOAD)$/i.test(name)) return false
  return /^\s*\(/.test(code.slice(index + word.length))
}

/**
 * Prepare a SELECT for execution: cap rows and attach the server time limit.
 * @param {{ sql: string, head: string, hasLimit: boolean }} admitted
 * @param {{ maxRows: number, timeoutMs: number, useHint?: boolean, dialect?: string }} limits
 * @returns {string}
 */
export function prepareSql(admitted, limits) {
  let sql = admitted.sql
  const dialect = limits.dialect ?? 'mysql'
  if (admitted.head === 'SELECT' || (admitted.head === 'WITH' && (dialect === 'postgres' || dialect === 'sqlite'))) {
    if (dialect === 'mysql' && limits.useHint !== false && !/MAX_EXECUTION_TIME/i.test(sql)) sql = sql.replace(/^(\(*\s*)SELECT\b/i, `$1SELECT /*+ MAX_EXECUTION_TIME(${Math.max(1, Math.floor(limits.timeoutMs))}) */`)
    // Elasticsearch pages with fetch_size instead; PostgreSQL, SQLite and MySQL get a LIMIT one row past the cap.
    if (!admitted.hasLimit && dialect !== 'elasticsearch') sql = `${sql}\nLIMIT ${limits.maxRows + 1}`
  }
  return sql
}
