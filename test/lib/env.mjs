// Shared paths, temp directories and database availability probes.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

export const TEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PLUGIN_DIR = resolve(TEST_DIR, '..')
export const FIXTURES = join(TEST_DIR, 'fixtures')

/** Import a plugin module by path relative to the plugin root, e.g. plugin('sql-guard.js'). */
export const plugin = (rel) => import(pathToFileURL(join(PLUGIN_DIR, rel)).href)
/** require() resolving from the plugin root (its node_modules). */
export const pluginRequire = createRequire(join(PLUGIN_DIR, 'package.json'))

// Never let a test fall back to ~/.dsh: point DSH_HOME at a throwaway dir for the process.
const homeGuard = mkdtempSync(join(tmpdir(), 'nl2sql-test-home-'))
process.env.DSH_HOME = homeGuard
process.on('exit', () => { try { rmSync(homeGuard, { recursive: true, force: true }) } catch {} })

const temps = []
/** Fresh directory under os.tmpdir(); removed when the process exits. */
export function tempDir(label = 'tmp') {
  const d = mkdtempSync(join(tmpdir(), `nl2sql-test-${label}-`))
  temps.push(d)
  return d
}
export function cleanupTemps() { for (const d of temps.splice(0)) { try { rmSync(d, { recursive: true, force: true }) } catch {} } }
process.on('exit', cleanupTemps)

export const MYSQL = { host: '127.0.0.1', port: 3306, user: 'user', password: 'root', database: 'testdb' }
export const PG = { host: '127.0.0.1', port: 5432, user: 'user', password: 'root', database: 'testdb' }
export const ES = { host: '127.0.0.1', port: 39200 }

/** Resolves to undefined when MySQL answers, else a reason string. */
export async function mysqlUnavailable() {
  try {
    const mysql = pluginRequire('mysql2/promise')
    const c = await mysql.createConnection({ ...MYSQL, connectTimeout: 3000 })
    await c.query('SELECT 1')
    await c.end()
  } catch (e) { return `MySQL ${MYSQL.host}:${MYSQL.port} unavailable (${e.code ?? e.message})` }
}

export async function pgUnavailable() {
  try {
    const pg = pluginRequire('pg')
    const c = new pg.Client({ ...PG, connectionTimeoutMillis: 3000 })
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
  } catch (e) { return `PostgreSQL ${PG.host}:${PG.port} unavailable (${e.code ?? e.message})` }
}

export async function esUnavailable() {
  try {
    const res = await fetch(`http://${ES.host}:${ES.port}/`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return `Elasticsearch responded ${res.status}`
  } catch (e) { return `Elasticsearch ${ES.host}:${ES.port} unavailable (${e.cause?.code ?? e.message})` }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Creates a throwaway PostgreSQL schema with an `orders` table (600 rows over ~6 months)
 * and a `customers` table referenced by orders.customer_id. Returns { schema, drop }.
 */
export async function createPgFixture() {
  const pg = pluginRequire('pg')
  const schema = `nl2sql_test_${process.pid}_${Date.now().toString(36)}`
  const c = new pg.Client(PG)
  await c.connect()
  try {
    await c.query(`CREATE SCHEMA ${schema}`)
    await c.query(`CREATE TABLE ${schema}.customers (id int PRIMARY KEY, name text, city text)`)
    await c.query(`INSERT INTO ${schema}.customers SELECT i, 'c' || i, (ARRAY['北京','上海','广州'])[1 + i % 3] FROM generate_series(1, 30) i`)
    await c.query(`CREATE TABLE ${schema}.orders (id serial PRIMARY KEY, customer_id int REFERENCES ${schema}.customers(id), status int NOT NULL, amount numeric(12,2), created_at timestamp NOT NULL)`)
    await c.query(`COMMENT ON TABLE ${schema}.orders IS '订单'`)
    await c.query(`COMMENT ON COLUMN ${schema}.orders.status IS '状态'`)
    await c.query(`INSERT INTO ${schema}.orders (customer_id, status, amount, created_at)
      SELECT 1 + i % 30, i % 3, (i % 50) * 2.5, now() - (i * interval '7 hours') FROM generate_series(1, 600) i`)
    await c.query(`ANALYZE ${schema}.orders`)
  } finally { await c.end() }
  const drop = async () => {
    const d = new pg.Client(PG)
    await d.connect()
    try { await d.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`) } finally { await d.end() }
  }
  return { schema, drop }
}
