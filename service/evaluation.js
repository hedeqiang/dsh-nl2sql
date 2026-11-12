/**
 * Nl2SqlService methods: evaluation.
 * Mixed into the service prototype by index.js; `this` is the service.
 */
import { compareResults, scoreSql } from '../analysis.js'
import { UserError, newId } from './shared.js'

export const methods = {
  // ------------------------------------------------------------ evaluation

  /** Evaluation set = verified examples (+ expected result snapshots). */
  evalSet(datasourceId) {
    const k = this.knowledgeFor(datasourceId)
    const meta = this.state.evals[datasourceId] ?? {}
    return k.examples.map(e => ({ id: e.id, question: e.question, sql: e.sql, enabled: meta[e.id]?.enabled !== false, lastStatus: meta[e.id]?.lastStatus ?? null }))
  },

  async setEvalCase({ datasourceId, id, enabled }) {
    this.state.evals[datasourceId] ??= {}
    this.state.evals[datasourceId][id] = { ...(this.state.evals[datasourceId][id] ?? {}), enabled: Boolean(enabled) }
    await this.save()
    return this.evalSet(datasourceId)
  },

  /**
   * Run the evaluation: for each example, ask a fresh nl2sql agent session the
   * question (or only re-run the SQL when mode = 'sql'), then compare the
   * agent's result with the reference SQL's result.
   */
  async runEval({ datasourceId, mode = 'agent', ids, concurrency = 2 }) {
    const ds = this.requireDatasource(datasourceId)
    const cases = this.evalSet(ds.id).filter(c => c.enabled && (!ids?.length || ids.includes(c.id)))
    if (!cases.length) throw new UserError('nl2sql/invalid', '评测集为空：请先在「业务知识 → 样例问答」中保存已验证的问答')
    const run = { id: newId('ev'), datasourceId: ds.id, datasourceName: ds.name, mode, startedAt: Date.now(), status: 'running', total: cases.length, done: 0, passed: 0, cases: [] }
    this.records.put('evalRun', run)
    this.evalLive ??= new Map()
    this.evalLive.set(run.id, run)
    const queue = [...cases]
    const worker = async () => {
      while (queue.length && !this.disposed) {
        const c = queue.shift()
        const item = { id: c.id, question: c.question, expectedSql: c.sql, status: 'error' }
        const started = Date.now()
        try {
          const expected = await this.runQuery({ sql: c.sql, datasourceId: ds.id, title: `评测基准 · ${c.question}`.slice(0, 120), source: 'eval', confirmScan: true, useCache: true })
          let actual
          if (mode === 'sql') {
            actual = await this.runQuery({ sql: c.sql, datasourceId: ds.id, title: `评测 · ${c.question}`.slice(0, 120), source: 'eval', confirmScan: true })
            item.actualSql = c.sql
          } else {
            const got = await this.askAgent({ datasourceId: ds.id, question: c.question, excludeExampleId: c.id })
            item.sessionId = got.sessionId
            item.answer = got.text.slice(0, 2000)
            if (!got.resultIds.length) throw new Error('Agent 没有执行查询')
            // Pick the result that best matches the expected one.
            let best
            for (const rid of got.resultIds) {
              const r = this.lookupResult(rid)
              if (!r) continue
              const cmp = compareResults(expected, r, { tolerance: 1e-6 })
              if (!best || (cmp.match && !best.cmp.match)) best = { r, cmp }
            }
            actual = best?.r
            item.actualSql = actual?.sql
          }
          const cmp = compareResults(expected, actual, { tolerance: 1e-6 })
          item.status = cmp.match ? 'pass' : 'fail'
          item.reason = cmp.reason
          item.similarity = item.actualSql ? Number(scoreSql(c.sql, item.actualSql).toFixed(2)) : null
          item.expectedRows = expected.rowCount
          item.actualRows = actual?.rowCount ?? null
        } catch (error) {
          item.reason = error.message
        }
        item.elapsedMs = Date.now() - started
        run.cases.push(item)
        run.done++
        if (item.status === 'pass') run.passed++
        this.state.evals[ds.id] ??= {}
        this.state.evals[ds.id][c.id] = { ...(this.state.evals[ds.id][c.id] ?? {}), lastStatus: item.status, lastRunAt: Date.now() }
        if (!this.disposed) { this.records.put('evalRun', run); await this.save() }
      }
    }
    const done = Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, worker)).then(async () => {
      run.status = 'done'
      run.finishedAt = Date.now()
      run.accuracy = run.total ? Number((run.passed / run.total).toFixed(3)) : null
      if (!this.disposed) { this.records.put('evalRun', run); await this.save() }
      this.evalLive?.delete(run.id)
    })
    this.evalJobs ??= new Map()
    this.evalJobs.set(run.id, done)
    done.catch(async (error) => { run.status = 'error'; run.error = error.message; this.evalLive?.delete(run.id); if (!this.disposed) { this.records.put('evalRun', run); await this.save() } })
    return run
  },

  listEvalRuns(datasourceId) {
    return this.records.list('evalRun', { ref: datasourceId, limit: 50 }).map(r => ({ ...(this.evalLive?.get(r.id) ?? r), cases: undefined, caseCount: r.cases.length }))
  },

  getEvalRun(id) {
    return this.evalLive?.get(id) ?? this.records.get('evalRun', id) ?? null
  },

  /** Ask a fresh nl2sql session one question and wait for the answer (evaluation). */
  async askAgent({ datasourceId, question, excludeExampleId, timeoutMs = 300000 }) {
    if (!this.ctx.get('sessionController')) throw new UserError('nl2sql/unavailable', '当前 Harness 不支持程序化创建会话，无法用 Agent 模式评测；请改用「仅回放 SQL」模式')
    const requestId = `eval-${newId('q')}`
    const prepare = async (sid) => {
      this.state.sessions[sid] = datasourceId
      this.state.sessionActors ??= {}
      this.state.sessionActors[sid] = { id: 'eval', name: '评测', kind: 'eval' }
      if (excludeExampleId) { this.state.evalExclusions ??= {}; this.state.evalExclusions[sid] = excludeExampleId }
      await this.save()
    }
    const turn = await this.runAgentTurn({ sessionId: null, title: `评测 · ${question.slice(0, 40)}`, requestId, text: `${question}\n\n（这是自动评测：请直接用 nl2sql_query 查询并给出结论，不要向用户提问。）`, prepare, timeoutMs })
    try { await this.ctx.get('workspaceRegistry')?.archiveSession?.(turn.sessionId, { stopActivity: true }) } catch {}
    if (turn.reason !== 'idle') throw new Error(turn.reason === 'timeout' ? `Agent 超过 ${Math.round(timeoutMs / 1000)} 秒未完成` : 'Agent 需要人工确认，已取消')
    return turn
  },
}
