    // -------------------------------------------------------- evaluation

    function EvalSection({ t, ds }) {
      const set = useAsync(() => call('evalSet', { datasourceId: ds.id }), [ds.id])
      const runs = useAsync(() => call('listEvalRuns', { datasourceId: ds.id }), [ds.id])
      const [mode, setMode] = useState('agent')
      const [open, setOpen] = useState(null)
      const [error, setError] = useState(null)
      const latest = (runs.value ?? [])[0]
      useEffect(() => {
        if (latest?.status !== 'running') return
        const id = setInterval(() => { runs.reload(); set.reload() }, 3000)
        return () => clearInterval(id)
      }, [latest?.status, latest?.id])
      const detail = useAsync(() => (open ? call('getEvalRun', { id: open }) : null), [open, latest?.done], [open])
      const start = async () => { setError(null); try { await call('runEval', { datasourceId: ds.id, mode }); runs.reload() } catch (e) { setError(e.message) } }
      const cases = set.value ?? []
      return h('div', null,
        h('div', { className: 'n2s-notice', style: { marginBottom: 12 } }, t('ev.hint')),
        h('div', { className: 'n2s-toolbar' },
          h('div', { className: 'n2s-seg' }, ['agent', 'sql'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`ev.mode.${m}`)))),
          h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ev.cases', { count: cases.filter(c => c.enabled).length })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: latest?.status === 'running' || !cases.length, onClick: start }, latest?.status === 'running' ? h('span', { className: 'n2s-spin' }) : null, latest?.status === 'running' ? fmt(t, 'ev.running', { done: latest.done, total: latest.total }) : t('ev.run'))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 10 } }, error),
        (runs.value ?? []).length > 0 && h('div', { className: 'n2s-evalchart' }, [...runs.value].reverse().slice(-20).map(r => h('button', { key: r.id, type: 'button', className: 'n2s-evalbar', 'aria-pressed': open === r.id, title: `${new Date(r.startedAt).toLocaleString()} · ${t(`ev.mode.${r.mode}`)} · ${r.passed}/${r.total}`, onClick: () => setOpen(open === r.id ? null : r.id) },
          h('span', { className: 'fill', style: { height: `${r.total ? Math.max(4, r.passed / r.total * 100) : 4}%` } }),
          h('span', { className: 'lbl' }, r.status === 'running' ? '…' : `${Math.round((r.accuracy ?? 0) * 100)}%`)))),
        detail.value && h('div', { className: 'n2s-hist', style: { marginTop: 12 } }, detail.value.cases.map(c => h('div', { key: c.id, className: 'n2s-hist-row', style: { padding: '10px 16px' } },
          h('div', { className: 'n2s-row' },
            h('span', { className: `n2s-statusdot ${c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'warn' : 'err'}` }, t(`ev.status.${c.status}`)),
            h('span', { style: { fontWeight: 500 } }, c.question),
            c.similarity !== null && c.similarity !== undefined && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ev.sim', { p: Math.round(c.similarity * 100) })),
            h('span', { className: 'n2s-grow' }),
            c.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => fbCtx.openSession?.(c.sessionId) }, Icon.external(13), t('hist.openSession'))),
          c.reason && h('div', { className: 'n2s-small n2s-muted', style: { marginTop: 4 } }, c.reason),
          c.status !== 'pass' && c.actualSql && h('details', { style: { marginTop: 6 } }, h('summary', { className: 'n2s-small n2s-muted', style: { cursor: 'pointer' } }, t('ev.compareSql')),
            h('div', { className: 'n2s-form', style: { marginTop: 6 } }, h('pre', { className: 'n2s-code' }, prettySql(c.expectedSql)), h('pre', { className: 'n2s-code' }, prettySql(c.actualSql))))))),
        !open && cases.length > 0 && h('div', { className: 'n2s-list2', style: { marginTop: 12 } }, cases.map(c => h('div', { key: c.id, className: 'n2s-list2-row', style: { padding: '8px 16px' } },
          h('input', { type: 'checkbox', checked: c.enabled, 'aria-label': t('ev.include'), onChange: async (e) => { try { await call('setEvalCase', { datasourceId: ds.id, id: c.id, enabled: e.target.checked }) } catch (err) { notifyError(err) } set.reload() } }),
          h('span', { className: 'n2s-grow n2s-ellipsis' }, c.question),
          c.lastStatus && h('span', { className: `n2s-statusdot ${c.lastStatus === 'pass' ? 'ok' : c.lastStatus === 'fail' ? 'warn' : 'err'}` }, t(`ev.status.${c.lastStatus}`))))))
    }

