/**
 * Durable result store and query cache on SQLite (node:sqlite).
 *
 * Results survive restarts so tool cards, dashboards and IM pushes can still
 * open them; the cache serves identical queries within a TTL.
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, closeSync, existsSync, openSync } from 'node:fs'

const MAX_RESULTS = 5000
const MAX_AGE_MS = 30 * 24 * 3600 * 1000
const MAX_RESULT_BYTES = 8 * 1024 * 1024

export class ResultStore {
  constructor(file) {
    this.file = file
    if (!existsSync(file)) closeSync(openSync(file, 'a', 0o600))
    this.db = new DatabaseSync(file)
    for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { chmodSync(f, 0o600) } catch {} }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        datasource_id TEXT,
        title TEXT,
        bytes INTEGER,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS results_created ON results(created_at);
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        result_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        ref TEXT,
        created_at INTEGER NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snapshots_ref ON snapshots(kind, ref, created_at);
      -- Append-mostly records: history (audit), feedback, deliveries, alert events, admin log, eval runs, schema changes.
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        ref TEXT,
        status TEXT,
        body TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS records_kind_at ON records(kind, at DESC);
      CREATE INDEX IF NOT EXISTS records_kind_ref ON records(kind, ref, at DESC);
    `)
    this.putStmt = this.db.prepare('INSERT OR REPLACE INTO results (id, created_at, datasource_id, title, bytes, body) VALUES (?, ?, ?, ?, ?, ?)')
    this.getStmt = this.db.prepare('SELECT body FROM results WHERE id = ?')
    this.cacheGet = this.db.prepare('SELECT result_id, created_at FROM cache WHERE key = ?')
    this.cachePut = this.db.prepare('INSERT OR REPLACE INTO cache (key, result_id, created_at) VALUES (?, ?, ?)')
    this.writes = 0
  }

  /** Persist a result; oversized results keep their first rows only. */
  put(result) {
    let body = JSON.stringify(result)
    if (body.length > MAX_RESULT_BYTES) {
      const keep = Math.max(1, Math.floor(result.rows.length * MAX_RESULT_BYTES / body.length * 0.9))
      body = JSON.stringify({ ...result, rows: result.rows.slice(0, keep), truncated: true, storedRows: keep })
    }
    this.putStmt.run(result.resultId, result.createdAt ?? Date.now(), result.datasourceId ?? null, result.title ?? '', body.length, body)
    if (++this.writes % 200 === 0) this.prune()
  }

  get(id) {
    const row = this.getStmt.get(id)
    if (!row) return undefined
    try { return JSON.parse(row.body) } catch { return undefined }
  }

  prune(now = Date.now()) {
    this.db.prepare('DELETE FROM results WHERE created_at < ?').run(now - MAX_AGE_MS)
    this.db.prepare(`DELETE FROM results WHERE id IN (SELECT id FROM results ORDER BY created_at DESC LIMIT -1 OFFSET ${MAX_RESULTS})`).run()
    this.db.prepare('DELETE FROM cache WHERE result_id NOT IN (SELECT id FROM results)').run()
  }

  /** Cached result for a key younger than ttlMs. */
  cached(key, ttlMs, now = Date.now()) {
    if (!(ttlMs > 0)) return undefined
    const hit = this.cacheGet.get(key)
    if (!hit || now - hit.created_at > ttlMs) return undefined
    return this.get(hit.result_id)
  }

  remember(key, resultId, now = Date.now()) {
    this.cachePut.run(key, resultId, now)
  }

  clearCache() {
    this.db.exec('DELETE FROM cache')
  }

  stats() {
    const r = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM results').get()
    const c = this.db.prepare('SELECT COUNT(*) AS n FROM cache').get()
    return { results: Number(r.n), bytes: Number(r.bytes), cacheEntries: Number(c.n) }
  }

  // Snapshots: schema versions, alert series, dashboard snapshots.
  putSnapshot({ id, kind, ref, createdAt = Date.now(), body }) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots (id, kind, ref, created_at, body) VALUES (?, ?, ?, ?, ?)').run(id, kind, ref ?? null, createdAt, JSON.stringify(body))
  }

  listSnapshots(kind, ref, limit = 50) {
    const rows = ref === undefined
      ? this.db.prepare('SELECT id, kind, ref, created_at, body FROM snapshots WHERE kind = ? ORDER BY created_at DESC LIMIT ?').all(kind, limit)
      : this.db.prepare('SELECT id, kind, ref, created_at, body FROM snapshots WHERE kind = ? AND ref = ? ORDER BY created_at DESC LIMIT ?').all(kind, ref, limit)
    return rows.map(r => ({ id: r.id, kind: r.kind, ref: r.ref, createdAt: Number(r.created_at), body: JSON.parse(r.body) }))
  }

  getSnapshot(id) {
    const r = this.db.prepare('SELECT id, kind, ref, created_at, body FROM snapshots WHERE id = ?').get(id)
    return r ? { id: r.id, kind: r.kind, ref: r.ref, createdAt: Number(r.created_at), body: JSON.parse(r.body) } : undefined
  }

  deleteSnapshots(kind, ref) {
    this.db.prepare('DELETE FROM snapshots WHERE kind = ? AND ref = ?').run(kind, ref)
  }

  // ------------------------------------------------------------ records

  /** Insert or replace one record. `ref` is a filter key (datasource / alert / actor). */
  putRecord(kind, rec, { ref, status } = {}) {
    this.recPut ??= this.db.prepare('INSERT OR REPLACE INTO records (kind, id, at, ref, status, body) VALUES (?, ?, ?, ?, ?, ?)')
    this.recPut.run(kind, String(rec.id), Number(rec.at ?? rec.startedAt ?? Date.now()), ref ?? null, status ?? rec.status ?? null, JSON.stringify(rec))
  }

  getRecord(kind, id) {
    this.recGet ??= this.db.prepare('SELECT body FROM records WHERE kind = ? AND id = ?')
    const r = this.recGet.get(kind, String(id))
    return r ? JSON.parse(r.body) : undefined
  }

  /**
   * Newest-first records with optional ref / status filters and a JS predicate
   * applied while scanning (stops after `limit` matches).
   */
  listRecords(kind, { ref, status, limit = 100, since, filter } = {}) {
    const where = ['kind = ?']
    const args = [kind]
    if (ref !== undefined && ref !== null) { where.push('ref = ?'); args.push(ref) }
    if (status) { where.push('status = ?'); args.push(status) }
    if (since) { where.push('at >= ?'); args.push(since) }
    // Same-millisecond records: the later insert comes first.
    const stmt = this.db.prepare(`SELECT body FROM records WHERE ${where.join(' AND ')} ORDER BY at DESC, rowid DESC`)
    const out = []
    for (const row of stmt.iterate(...args)) {
      const rec = JSON.parse(row.body)
      if (filter && !filter(rec)) continue
      out.push(rec)
      if (out.length >= limit) break
    }
    return out
  }

  countRecords(kind, { ref, status, since } = {}) {
    const where = ['kind = ?']
    const args = [kind]
    if (ref) { where.push('ref = ?'); args.push(ref) }
    if (status) { where.push('status = ?'); args.push(status) }
    if (since) { where.push('at >= ?'); args.push(since) }
    return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where.join(' AND ')}`).get(...args).n)
  }

  deleteRecord(kind, id) {
    this.db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, String(id))
  }

  clearRecords(kind) {
    this.db.prepare('DELETE FROM records WHERE kind = ?').run(kind)
  }

  /** Keep the newest `keep` records of a kind. */
  trimRecords(kind, keep) {
    this.db.prepare(`DELETE FROM records WHERE kind = ? AND rowid IN (SELECT rowid FROM records WHERE kind = ? ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ${Math.max(0, Math.floor(keep))})`).run(kind, kind)
  }

  /** Run fn inside one transaction (bulk migration). */
  transaction(fn) {
    this.db.exec('BEGIN')
    try { const r = fn(); this.db.exec('COMMIT'); return r } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }

  close() {
    try { this.db.close() } catch {}
  }
}

export function cacheKey(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)
}
