    // ------------------------------------------------------ tool views

    function parseArgs(raw) {
      try { return JSON.parse(raw || '{}') } catch { return {} }
    }

    function makeOverviewToolView(ctx) {
      return function Nl2SqlOverviewView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const meta = settled ? block.meta : undefined
        const args = parseArgs(settled ? block.call?.argsRaw : block?.argsRaw)
        const [results, setResults] = useState(null)
        useEffect(() => {
          if (!settled || block.isError || !meta?.results) return
          let alive = true
          Promise.all(meta.results.map(r => (r.error || !r.resultId ? r : call('getResult', { resultId: r.resultId }).then(full => full ?? { ...r, rows: [], expired: true }).catch(() => r))))
            .then(list => alive && setResults(list))
          return () => { alive = false }
        }, [settled, meta])
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('tool.overviewRunning')), h('span', null, args.table ?? '')))
        if (block.isError) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { style: { fontWeight: 500 } }, fmt(t, 'tool.overviewTitle', { table: meta?.table ?? args.table })), meta?.results && h('span', { className: 'n2s-badge' }, fmt(t, 'tool.overviewCount', { count: meta.results.length }))),
          !results ? h('span', { className: 'n2s-spin n2s-muted' }) : h(OverviewGrid, { t, results: results.map(r => (r.expired ? { title: r.title, sql: r.sql, error: t('result.expired') } : r)), pinned: Boolean(args.pin) }))
      }
    }

    /** The latest user message before this tool call, used as the feedback question. */
    function findQuestion(props) {
      try {
        const nodes = props.useChat?.((s) => s.nodes ?? s.items ?? null)
        if (!Array.isArray(nodes)) return ''
        const idx = nodes.findIndex(n => n?.callId === props.callId || n?.block?.callId === props.callId)
        for (let i = (idx < 0 ? nodes.length : idx) - 1; i >= 0; i--) {
          const n = nodes[i]
          if (n?.kind === 'user') return String(n.text ?? n.message?.text ?? '').slice(0, 500)
        }
      } catch {}
      return ''
    }

    function makeToolView(ctx, kind) {
      return function Nl2SqlToolView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const meta = settled ? block.meta : undefined
        const args = settled ? parseArgs(block.call?.argsRaw) : parseArgs(block?.argsRaw)
        const [result, setResult] = useState(null)
        const [state, setState] = useState('idle')
        const load = useCallback(async (rerun) => {
          if (!meta?.resultId) return
          setState('loading')
          try {
            let r = rerun ? null : await call('getResult', { resultId: meta.resultId })
            if (!r && rerun) r = await call('runQuery', { sql: meta.sql, datasourceId: meta.datasourceId, title: meta.title, chart: meta.chart })
            if (r) { setResult(r); setState('ok') } else setState('expired')
          } catch (e) {
            setState('error'); setResult({ error: e.message })
          }
        }, [meta?.resultId])
        useEffect(() => { if (settled && !block.isError) load(false) }, [settled, meta?.resultId])
        const title = args.title || (kind === 'chart' ? t('tool.chart') : t('tool.query'))
        if (!settled) {
          return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('tool.running')), h('span', null, title)),
            args.sql && h('pre', { className: 'n2s-code', style: { marginTop: 8 } }, args.sql))
        }
        if (block.isError) {
          const text = block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || block.error?.code || ''
          return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-badge err' }, t('tool.failed')), h('span', null, title)),
            args.sql && h('pre', { className: 'n2s-code', style: { marginTop: 8 } }, args.sql),
            h('div', { className: 'n2s-notice err', style: { marginTop: 8 } }, text))
        }
        return h('div', { className: 'n2s-toolcard' },
          state === 'loading' && h('span', { className: 'n2s-spin n2s-muted' }),
          state === 'expired' && h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-muted n2s-grow' }, `${meta?.title || title} · ${t('result.expired')}`),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => load(true) }, t('result.rerun'))),
          state === 'error' && h('div', { className: 'n2s-notice err' }, result?.error),
          state === 'ok' && result && h(ResultView, {
            result, t, compact: true, question: findQuestion(props),
            onFeedback: {
              sessionId: props.sessionId,
              down: (comment) => props.inputActions?.setDraft?.(fmt(t, 'fb.followup', { title: result.title || t('tool.query'), comment: comment || t('fb.followupDefault') })),
            },
          }))
      }
    }

