    // ------------------------------------------------------- drill & why

    function DrillPanel({ t, result, drill, onClose, onChange }) {
      const dims = useAsync(() => call('drillDimensions', { resultId: result.resultId }), [result.resultId])
      const [state, setState] = useState(null)
      const run = async (payload) => {
        setState({ busy: true })
        try { setState({ result: await call('drill', { resultId: result.resultId, ...payload }) }) } catch (e) { setState({ error: e.message }) }
      }
      const runWhy = async (payload) => {
        setState({ busy: true })
        try { setState({ why: await call('explainChange', { resultId: result.resultId, ...payload }) }) } catch (e) { setState({ error: e.message }) }
      }
      useEffect(() => { setState(null); if (drill.mode === 'why') runWhy({}) }, [drill.mode, drill.xValue])
      const d = dims.value?.dimensions ?? []
      const xLabel = drill.mode === 'why' ? (state?.why ? `${state.why.baseline} → ${state.why.current}` : '…') : drill.xValue !== undefined ? `${result.chart?.x} = ${drill.xValue}` : t('drill.wholeResult')
      return h('div', { className: 'n2s-drill' },
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('span', { className: 'n2s-h2', style: { margin: 0 } }, drill.mode === 'why' ? t('drill.whyTitle') : t('drill.title')),
          h('span', { className: 'n2s-badge blue' }, xLabel),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
        drill.mode !== 'why' && h('div', { className: 'n2s-row', style: { gap: 6 } },
          drill.xValue !== undefined && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => run({ mode: 'detail', xValue: drill.xValue }) }, Icon.table(13), t('drill.detail')),
          h('span', { className: 'n2s-faint n2s-small' }, t('drill.splitBy')),
          dims.loading ? h('span', { className: 'n2s-spin n2s-faint' }) : d.length === 0 ? h('span', { className: 'n2s-faint n2s-small' }, t('drill.noDims')) :
            d.slice(0, 10).map(x => h('button', { key: x.column, type: 'button', className: 'n2s-chip', title: x.label, onClick: () => run({ mode: 'breakdown', xValue: drill.xValue, dimension: x.column }) }, x.label === x.column ? x.column : `${x.label}`)),
          result.rows.length >= 2 && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onChange({ mode: 'why' }) }, Icon.spark(13), t('drill.why'))),
        state?.busy && h('div', { className: 'n2s-skel', style: { height: 160, marginTop: 10 } }),
        state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
        state?.result && h('div', { style: { marginTop: 10 } }, h(ResultView, { result: state.result, t, compact: true })),
        state?.why && h(WhyView, { t, why: state.why }))
    }

    function WhyView({ t, why }) {
      const [sel, setSel] = useState(0)
      const ok = why.dimensions.filter(d => d.attribution)
      const cur = ok[sel]
      const max = cur ? Math.max(...cur.attribution.items.map(i => Math.abs(i.delta)), 1) : 1
      return h('div', { style: { marginTop: 10, display: 'grid', gap: 10 } },
        h('div', { className: 'n2s-notice' }, why.summary),
        !why.additive && h('div', { className: 'n2s-faint n2s-small' }, t('drill.nonAdditive')),
        ok.length > 0 && h('div', { className: 'n2s-seg' }, ok.map((d, i) => h('button', { key: d.dimension, type: 'button', 'aria-pressed': sel === i, onClick: () => setSel(i) }, `${d.dimension} · ${Math.round(d.attribution.concentration * 100)}%`))),
        cur && h('div', { className: 'n2s-waterfall' }, cur.attribution.items.map((it, i) => h('div', { key: i, className: 'n2s-wf-row' },
          h('span', { className: 'n2s-wf-label n2s-ellipsis', title: String(it.value) }, String(it.value ?? 'NULL')),
          h('span', { className: 'n2s-wf-bar' }, h('span', { className: `n2s-wf-fill ${it.delta > 0 ? 'up' : it.delta < 0 ? 'down' : ''}`, style: { width: `${Math.max(2, Math.abs(it.delta) / max * 100)}%` } })),
          h('span', { className: 'n2s-wf-num' }, `${it.delta >= 0 ? '+' : ''}${formatCompact(it.delta)}`),
          h('span', { className: 'n2s-wf-share n2s-faint' }, it.share === null || Math.abs(it.share) > 3 ? '' : `${Math.round(it.share * 100)}%`)))),
        why.dimensions.filter(d => !d.attribution).length > 0 && h('div', { className: 'n2s-faint n2s-small' }, `${colon(t('drill.failedDims'))}${why.dimensions.filter(d => !d.attribution).map(d => d.dimension).join(listSep())}`))
    }

