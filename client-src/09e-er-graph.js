    /** ER graph rendered with ECharts' force layout. */
    function ErGraph({ t, schema, onPick }) {
      const ref = useRef(null)
      const [error, setError] = useState(null)
      const [onlyLinked, setOnlyLinked] = useState(true)
      const [showInferred, setShowInferred] = useState(true)
      useEffect(() => {
        let chart
        let disposed = false
        let observer
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          chart = initChart(echarts, ref.current)
          observer = new ResizeObserver(() => chart?.resize())
          observer.observe(ref.current)
          const el = ref.current
          const relations = schema.relations.filter(r => showInferred || r.kind === 'declared').filter(r => r.from.table !== r.to.table)
          const linked = new Set(relations.flatMap(r => [r.from.table, r.to.table]))
          const tables = schema.tables.filter(tb => !onlyLinked || linked.has(tb.name))
          const roleColor = { fact: cssVar(el, '--dsw-alias-brand-primary', '#4d6bfe'), dimension: '#22b07d', log: '#f5a623', config: '#8b5cf6', view: '#14b8c4', other: '#7c8a9a' }
          const degree = new Map()
          for (const r of relations) for (const n of [r.from.table, r.to.table]) degree.set(n, (degree.get(n) ?? 0) + 1)
          const roles = ['fact', 'dimension', 'log', 'config', 'view', 'other']
          chart.setOption({
            backgroundColor: 'transparent',
            tooltip: {
              confine: true,
              // ECharts renders tooltip strings as HTML: escape database-provided names and comments.
              formatter: (p) => p.dataType === 'edge'
                ? escapeHtml(p.data.label)
                : `<b>${escapeHtml(p.data.name)}</b><br/>${escapeHtml(t(`role.${p.data.role}`))} · ${escapeHtml(p.data.rows ?? '?')} rows<br/>${escapeHtml(p.data.comment ?? '')}`,
            },
            legend: [{ data: roles.map(r => t(`role.${r}`)), textStyle: { color: cssVar(el, '--dsw-alias-label-secondary', '#888') }, top: 0 }],
            series: [{
              type: 'graph',
              layout: 'force',
              roam: true,
              draggable: true,
              categories: roles.map(r => ({ name: t(`role.${r}`), itemStyle: { color: roleColor[r] } })),
              force: { repulsion: 260, edgeLength: [80, 180], gravity: 0.08 },
              label: { show: true, position: 'right', color: cssVar(el, '--dsw-alias-label-primary', '#222'), fontSize: 11 },
              edgeSymbol: ['none', 'arrow'],
              edgeSymbolSize: 7,
              lineStyle: { color: cssVar(el, '--dsw-alias-label-secondary', '#888'), opacity: 0.6, curveness: 0.12 },
              emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
              data: tables.map(tb => ({
                id: tb.name, name: tb.name, role: tb.role, rows: tb.rows, comment: tb.comment,
                category: roles.indexOf(tb.role),
                symbolSize: 10 + Math.min(26, Math.log10((tb.rows ?? 0) + 10) * 4 + (degree.get(tb.name) ?? 0) * 2),
              })),
              links: relations.filter(r => tables.some(x => x.name === r.from.table) && tables.some(x => x.name === r.to.table)).map(r => ({
                source: r.from.table, target: r.to.table,
                label: `${r.from.table}.${r.from.column} → ${r.to.table}.${r.to.column} (${r.kind === 'declared' ? 'FK' : `~${Math.round(r.confidence * 100)}%`})`,
                lineStyle: r.kind === 'declared' ? { type: 'solid' } : { type: 'dashed' },
              })),
            }],
          }, true)
          chart.on('dblclick', (p) => { if (p.dataType === 'node') onPick(p.data.name) })
        }, (e) => setError(e.message))
        return () => { disposed = true; observer?.disconnect(); chart?.dispose() }
      }, [schema, onlyLinked, showInferred])
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: onlyLinked, onChange: e => setOnlyLinked(e.target.checked) }), t('er.onlyLinked')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: showInferred, onChange: e => setShowInferred(e.target.checked) }), t('er.inferred')),
          h('span', { className: 'n2s-grow' }),
          h('span', { className: 'n2s-muted n2s-small' }, t('er.hint'))),
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, style: { width: '100%', height: '62vh', minHeight: 420 } }))
    }
