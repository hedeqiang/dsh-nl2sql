    // ----------------------------------------------------------- charts

    let echartsPromise
    function loadEcharts() {
      echartsPromise ??= require.async('./client.echarts.js')
      return echartsPromise
    }

    function cssVar(el, name, fallback) {
      const v = getComputedStyle(el).getPropertyValue(name).trim()
      return v || fallback
    }

    function buildOption(result, chart, el) {
      const label = cssVar(el, '--dsw-alias-label-secondary', '#888')
      const text = cssVar(el, '--dsw-alias-label-primary', '#222')
      const border = cssVar(el, '--dsw-alias-border-l1', 'rgba(128,128,128,.25)')
      const surface = cssVar(el, '--dsw-alias-bg-layer-1', '#fff')
      const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b', '#84cc16', '#f97316']
      const colIndex = (name) => result.columns.findIndex(c => c.name === name)
      const xi = colIndex(chart.x)
      const ys = (chart.y ?? []).map(colIndex).filter(i => i >= 0)
      const si = chart.series ? colIndex(chart.series) : -1
      const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
      const base = {
        color: palette,
        backgroundColor: 'transparent',
        textStyle: { color: text, fontFamily: 'inherit' },
        animationDuration: 300,
        grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
        tooltip: { trigger: 'axis', confine: true, backgroundColor: surface, borderColor: border, borderWidth: 1, padding: [8, 10], textStyle: { color: text, fontSize: 12 }, extraCssText: 'border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12)', axisPointer: { type: 'line', lineStyle: { color: border } }, valueFormatter: (v) => (v === null || v === undefined ? '—' : formatNumber(v)) },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: label, fontSize: 12 }, type: 'scroll' },
      }
      const axisCommon = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: label, fontSize: 11 }, splitLine: { lineStyle: { color: border, type: [3, 3] } } }
      if (chart.type === 'pie' || chart.type === 'funnel') {
        const data = result.rows.map(r => ({ name: String(r[xi] ?? 'NULL'), value: num(r[ys[0]]) }))
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item' },
          legend: { ...base.legend, show: data.length <= 12, orient: 'vertical', left: 'auto', right: 0, top: 'middle' },
          series: [chart.type === 'pie'
            ? { type: 'pie', radius: ['48%', '72%'], center: ['40%', '50%'], data, label: { color: label, fontSize: 11, formatter: '{b}  {d}%' }, labelLine: { length: 8, length2: 8 }, itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 } }
            : { type: 'funnel', top: 36, bottom: 8, data, label: { color: text } }],
        }
      }
      if (chart.type === 'scatter') {
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item' },
          xAxis: { type: 'value', name: chart.x, nameTextStyle: { color: label }, ...axisCommon },
          yAxis: { type: 'value', name: result.columns[ys[0]]?.name, nameTextStyle: { color: label }, ...axisCommon },
          series: [{ type: 'scatter', symbolSize: 7, data: result.rows.map(r => [num(r[xi]), num(r[ys[0]])]) }],
        }
      }
      const horizontal = chart.type === 'barh'
      const seriesType = chart.type === 'line' || chart.type === 'area' ? 'line' : 'bar'
      let categories
      let series
      if (si >= 0 && ys.length >= 1) {
        categories = [...new Set(result.rows.map(r => String(r[xi] ?? 'NULL')))]
        const groups = new Map()
        for (const r of result.rows) {
          const key = String(r[si] ?? 'NULL')
          if (!groups.has(key)) groups.set(key, new Map())
          groups.get(key).set(String(r[xi] ?? 'NULL'), num(r[ys[0]]))
        }
        series = [...groups.entries()].slice(0, 20).map(([name, m]) => ({ name, type: seriesType, data: categories.map(c => m.get(c) ?? null) }))
      } else {
        categories = result.rows.map(r => String(r[xi] ?? 'NULL'))
        series = ys.map(i => ({ name: result.columns[i].name, type: seriesType, data: result.rows.map(r => num(r[i])) }))
      }
      for (const s of series) {
        if (seriesType === 'line') { s.smooth = 0.3; s.symbol = 'circle'; s.symbolSize = 5; s.showSymbol = false; s.lineStyle = { width: 2 }; s.connectNulls = true; s.emphasis = { focus: 'series' } }
        if (chart.type === 'area' || (chart.type === 'line' && series.length === 1)) s.areaStyle = { opacity: chart.type === 'area' ? 0.18 : 0.08 }
        if (chart.type === 'stacked') s.stack = 'total'
        if (seriesType === 'bar') { s.barMaxWidth = 24; s.itemStyle = { borderRadius: horizontal ? [0, 4, 4, 0] : chart.type === 'stacked' ? 0 : [4, 4, 0, 0] } }
      }
      const catAxis = { type: 'category', data: categories, ...axisCommon, axisLine: { show: true, lineStyle: { color: border } }, axisLabel: { color: label, fontSize: 11, hideOverlap: true }, splitLine: { show: false }, boundaryGap: seriesType === 'bar' }
      const valAxis = { type: 'value', ...axisCommon, axisLabel: { color: label, fontSize: 11, formatter: (v) => formatNumber(v) } }
      // Second axis when series magnitudes differ by more than 10x.
      let dual = false
      if (!horizontal && chart.type !== 'stacked' && series.length >= 2 && series.length <= 4) {
        const peak = series.map(x => Math.max(0, ...x.data.filter(v => Number.isFinite(v)).map(Math.abs)))
        const top = Math.max(...peak)
        const small = peak.map(p => p > 0 && top / p > 10)
        if (top > 0 && small.some(Boolean) && !small.every(Boolean)) { series.forEach((x, i) => { if (small[i]) x.yAxisIndex = 1 }); dual = true }
      }
      return {
        ...base,
        legend: { ...base.legend, show: series.length > 1 },
        grid: { ...base.grid, top: series.length > 1 ? 36 : 16 },
        xAxis: horizontal ? valAxis : catAxis,
        yAxis: horizontal ? { ...catAxis, inverse: true } : dual ? [valAxis, { ...valAxis, splitLine: { show: false } }] : valAxis,
        dataZoom: categories.length > 60 && !horizontal ? [{ type: 'inside' }] : undefined,
        series,
      }
    }

    function EChart({ result, chart, t, onInstance, onPoint }) {
      const pointRef = useRef(onPoint)
      pointRef.current = onPoint
      const ref = useRef(null)
      const instance = useRef(null)
      const [error, setError] = useState(null)
      const [ready, setReady] = useState(false)
      useEffect(() => {
        let disposed = false
        let observer
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          instance.current = echarts.init(ref.current, null, { renderer: 'canvas' })
          instance.current.on('click', (p) => { if (pointRef.current && p.name !== undefined && p.name !== '') pointRef.current(p.name) })
          observer = new ResizeObserver(() => instance.current?.resize())
          observer.observe(ref.current)
          setReady(true)
          onInstance?.(instance.current)
        }, (e) => setError(e.message))
        return () => {
          disposed = true
          observer?.disconnect()
          instance.current?.dispose()
          instance.current = null
        }
      }, [])
      useEffect(() => {
        if (!ready || !instance.current || !ref.current) return
        try {
          instance.current.setOption(buildOption(result, chart, ref.current), true)
          instance.current.resize()
          setError(null)
        } catch (e) {
          setError(e.message)
        }
      }, [ready, result, chart])
      // Re-color on theme change.
      useEffect(() => {
        if (!ready) return
        const mo = new MutationObserver(() => {
          if (instance.current && ref.current) instance.current.setOption(buildOption(result, chart, ref.current), true)
        })
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        return () => mo.disconnect()
      }, [ready, result, chart])
      return h('div', { style: { position: 'relative' } },
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, className: 'n2s-chart', role: 'img', 'aria-label': result.title || t('chart.label') }),
        !ready && !error && h('div', { className: 'n2s-skel', style: { position: 'absolute', inset: 0 }, 'aria-label': t('chart.loading') }))
    }

    function DataTable({ result, max = 200 }) {
      const rows = result.rows.slice(0, max)
      return h('div', { className: 'n2s-table-wrap' },
        h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, result.columns.map((c, i) => h('th', { key: i, title: c.name, className: c.kind === 'number' ? 'num' : undefined }, c.name)))),
          h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, r.map((v, ci) => {
            const kind = result.columns[ci]?.kind
            return v === null
              ? h('td', { key: ci, className: 'null' }, 'NULL')
              : h('td', { key: ci, className: kind === 'number' ? 'num' : undefined, title: String(v) }, kind === 'number' ? formatNumber(v) : String(v))
          }))))))
    }

    function Kpis({ result, chart }) {
      const row = result.rows[0] ?? []
      const ys = (chart.y?.length ? chart.y : result.columns.filter(c => c.kind === 'number').map(c => c.name))
      return h('div', { className: 'n2s-kpis' }, ys.map(name => {
        const i = result.columns.findIndex(c => c.name === name)
        return h('div', { key: name, className: 'n2s-kpi' }, h('div', { className: 'v', title: String(row[i] ?? '') }, formatCompact(row[i])), h('div', { className: 'k n2s-ellipsis', title: name }, name))
      }))
    }

    const CHART_CHOICES = ['line', 'area', 'bar', 'barh', 'stacked', 'pie', 'funnel', 'scatter', 'kpi', 'table']

    function chartFor(type, result, suggested) {
      if (type === 'table') return { type }
      const cols = result.columns
      const nums = cols.filter(c => c.kind === 'number').map(c => c.name)
      const time = cols.find(c => c.kind === 'time')?.name
      const cat = cols.find(c => c.kind === 'text')?.name
      if (type === 'kpi') return nums.length ? { type, y: nums.slice(0, 6) } : null
      if (type === 'scatter') return nums.length >= 2 ? { type, x: nums[0], y: [nums[1]] } : null
      const x = suggested?.x ?? time ?? cat ?? cols[0]?.name
      const y = suggested?.y?.length ? suggested.y : nums.slice(0, 4)
      if (!x || !y.length) return null
      if (type === 'pie' || type === 'funnel') return { type, x: cat ?? x, y: [y[0]] }
      return { type, x, y, ...(suggested?.series ? { series: suggested.series } : {}) }
    }

    /** One rendered result: chart switcher, chart/table, SQL and actions. */
    function ResultView({ result: initialResult, t, compact, onPinned, hideSql, question, onFeedback, embedded }) {
      const [result, setResult] = useState(initialResult)
      useEffect(() => { setResult(initialResult) }, [initialResult])
      const [type, setType] = useState(result.chart?.type ?? 'table')
      const [showSql, setShowSql] = useState(false)
      const [showTable, setShowTable] = useState(false)
      const [pinned, setPinned] = useState(false)
      const [copied, setCopied] = useState(false)
      const [savedExample, setSavedExample] = useState(false)
      const [editing, setEditing] = useState(null)
      const [editError, setEditError] = useState(null)
      const [running, setRunning] = useState(false)
      const [chartInstance, setChartInstance] = useState(null)
      const [rated, setRated] = useState(null)
      const [sending, setSending] = useState(false)
      const [rating, setRating] = useState(null)
      const [drill, setDrill] = useState(null)
      useEffect(() => { setType(result.chart?.type ?? 'table') }, [result.resultId])
      const rate = async (value, comment) => {
        try {
          await call('submitFeedback', { resultId: result.resultId, rating: value, comment, question, sql: result.baseSql ?? result.sql, datasourceId: result.datasourceId, title: result.title, sessionId: onFeedback?.sessionId })
          setRated(value)
          setRating(null)
          if (value === 'down') onFeedback?.down?.(comment)
        } catch (e) {
          notifyError(e)
        }
      }
      const chart = useMemo(() => (type === result.chart?.type ? result.chart : chartFor(type, result, result.suggestedChart ?? result.chart)) ?? { type: 'table' }, [type, result])
      const available = useMemo(() => CHART_CHOICES.filter(c => c === 'table' || chartFor(c, result, result.chart)), [result])
      const pin = async () => {
        try {
          await call('pinWidget', { title: result.title || result.sql.slice(0, 60), sql: result.sql, datasourceId: result.datasourceId, chart })
          setPinned(true)
          onPinned?.()
        } catch (e) {
          notifyError(e)
        }
      }
      const saveExample = async () => {
        const q = await promptDialog({ title: t('kb.examplePrompt'), value: question || result.title || '' })
        if (!q) return
        try {
          await call('saveKnowledgeItem', { datasourceId: result.datasourceId, kind: 'example', item: { question: q, sql: result.sql } })
          setSavedExample(true)
        } catch (e) {
          notifyError(e)
        }
      }
      const rerun = async (confirmScan) => {
        setRunning(true); setEditError(null)
        try {
          const next = await call('runQuery', { sql: editing, datasourceId: result.datasourceId, title: result.title, confirmScan })
          setResult(next); setEditing(null)
        } catch (e) {
          if (e.code === 'nl2sql/scan-guard' && await confirmDialog({ title: t('sql.confirmScan'), message: e.message })) return rerun(true)
          setEditError(e.message)
        } finally {
          setRunning(false)
        }
      }
      const [flash, setFlash] = useFlash()
      const copySql = () => { navigator.clipboard?.writeText(result.sql); setFlash(t('result.copied')) }
      const exportPng = () => {
        const url = chartInstance?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssVar(document.body, '--dsw-alias-bg-base', '#fff') })
        if (url) fetch(url).then(r => r.blob()).then(b => download(`${safeName(result.title)}.png`, b))
      }
      const isChart = chart.type !== 'table' && chart.type !== 'kpi'
      const body = result.rows.length === 0
        ? h('div', { className: 'n2s-empty', style: { padding: 24 } }, t('result.empty'))
        : chart.type === 'table'
          ? h(DataTable, { result })
          : chart.type === 'kpi'
            ? h(Kpis, { result, chart })
            : h(EChart, { result, chart, t, onInstance: setChartInstance, onPoint: chart.x ? (xValue) => setDrill({ mode: 'menu', xValue }) : undefined })
      const flags = [
        result.columns.some(c => c.masked) && h('span', { key: 'm', className: 'n2s-badge warn' }, t('result.masked')),
        result.hiddenColumns > 0 && h('span', { key: 'h', className: 'n2s-badge warn', title: t('policy.hiddenInResult') }, fmt(t, 'policy.hiddenCount', { count: result.hiddenColumns })),
        result.filters?.length > 0 && h('span', { key: 'f', className: 'n2s-badge blue', title: result.filters.map(f => f.description).join('\n') }, fmt(t, 'filter.appliedCount', { count: result.filters.length })),
      ].filter(Boolean)
      const hidden = onPinned?.hidden
      const moreItems = [
        { label: t('result.copySql'), icon: Icon.copy(14), onClick: copySql },
        { label: t('sql.edit'), icon: Icon.edit(14), onClick: () => { setShowSql(true); setEditing(result.sql) } },
        { divider: true },
        { label: t('result.csv'), icon: Icon.download(14), onClick: () => download(`${safeName(result.title)}.csv`, new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' })) },
        { label: t('result.excel'), icon: Icon.download(14), onClick: () => exportExcel({ resultIds: [result.resultId], title: result.title }) },
        { divider: true },
        isChart && result.chart?.x && { label: t('drill.breakdownAll'), icon: Icon.chart(14), onClick: () => setDrill({ mode: 'breakdown' }) },
        isChart && result.chart?.x && result.rows.length >= 2 && { label: t('drill.why'), icon: Icon.spark(14), onClick: () => setDrill({ mode: 'why' }) },
        isChart && chartInstance && { label: t('result.png'), icon: Icon.download(14), onClick: exportPng },
        !hidden && { divider: true },
        !hidden && { label: savedExample ? t('kb.exampleSaved') : t('kb.saveExample'), icon: Icon.spark(14), disabled: savedExample, onClick: saveExample },
      ]
      const chartPicker = result.rows.length > 0 && h(Dropdown, {
        label: t('result.chartType'),
        trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, chart.type === 'table' ? Icon.table(14) : Icon.chart(14), t(`chart.${chart.type}`), Icon.chev(10)) },
        items: available.map(c => ({ label: t(`chart.${c}`), checked: chart.type === c, onClick: () => setType(c) })),
      })
      return h('div', { className: 'n2s-result' },
        !embedded && h('div', { className: 'n2s-result-head' },
          result.title && h('span', { className: 'title', title: result.title }, result.title),
          h('span', { className: 'n2s-result-meta' },
            h('span', null, fmt(t, 'result.rows', { count: result.rowCount }), result.truncated ? t('result.truncated') : ''),
            h('span', { className: 'sep' }, '·'), h('span', null, fmt(t, 'result.elapsed', { ms: result.elapsedMs })),
            result.datasourceName && h(React.Fragment, null, h('span', { className: 'sep' }, '·'), h('span', { className: 'n2s-ellipsis', style: { maxWidth: 160 } }, result.datasourceName))),
          flags,
          h('span', { className: 'n2s-grow' }),
          chartPicker),
        body,
        h('div', { className: 'n2s-result-foot' },
          !hideSql && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showSql, onClick: () => setShowSql(v => !v) }, Icon.code(14), t('result.sql')),
          isChart && result.rows.length > 0 && !compact && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showTable, onClick: () => setShowTable(v => !v) }, Icon.table(14), t('result.data')),
          embedded && chartPicker,
          flash && h('span', { className: 'n2s-small n2s-muted', role: 'status' }, flash),
          h('span', { className: 'n2s-grow' }),
          embedded && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'result.rows', { count: result.rowCount }), ' · ', fmt(t, 'result.elapsed', { ms: result.elapsedMs })),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-pressed': rated === 'up', title: t('fb.up'), 'aria-label': t('fb.up'), onClick: () => rate('up') }, Icon.thumbUp()),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-pressed': rated === 'down' || rating === 'down', title: t('fb.down'), 'aria-label': t('fb.down'), onClick: () => setRating(rating === 'down' ? null : 'down') }, Icon.thumbDown()),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', disabled: pinned, 'aria-pressed': pinned, title: pinned ? t('result.pinned') : t('result.pin'), 'aria-label': t('result.pin'), onClick: pin }, Icon.pin()),
          h('button', { type: 'button', className: 'n2s-iconbtn', title: t('im.share'), 'aria-label': t('im.share'), onClick: () => setSending(true) }, Icon.send()),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: moreItems })),
        rating === 'down' && h(FeedbackForm, { t, onCancel: () => setRating(null), onSubmit: (comment) => rate('down', comment) }),
        rated && h('div', { className: 'n2s-notice', role: 'status' }, rated === 'up' ? t('fb.thanksUp') : t('fb.thanksDown')),
        sending && h(SendDialog, { t, initial: { title: result.title || t('tool.query'), text: question ? `> ${question}` : '', resultIds: [result.resultId] }, onClose: () => setSending(false) }),
        showSql && editing === null && h('div', { style: { position: 'relative' } },
          h('pre', { className: 'n2s-code', style: { paddingRight: 72 } }, prettySql(result.sql)),
          h('div', { className: 'n2s-row', style: { position: 'absolute', top: 6, right: 6, gap: 2 } },
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('result.copy'), 'aria-label': t('result.copy'), onClick: copySql }, Icon.copy(14)),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('sql.edit'), 'aria-label': t('sql.edit'), onClick: () => setEditing(result.sql) }, Icon.edit(14)))),
        editing !== null && h('div', { className: 'n2s-sqlbox', style: { marginTop: 0 } },
          h('textarea', { value: editing, spellCheck: false, autoFocus: true, onChange: e => setEditing(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) rerun(false) } }),
          editError && h('div', { className: 'n2s-notice err', style: { margin: '0 10px 8px', borderRadius: 6 } }, editError),
          h('div', { className: 'n2s-sqlbar' },
            h('span', { className: 'n2s-faint n2s-small' }, h('kbd', { className: 'n2s-kbd' }, '⌘'), ' ', h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.run')),
            h('span', { className: 'n2s-grow' }),
            h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => { setEditing(null); setEditError(null) } }, t('ds.cancel')),
            h('button', { type: 'button', className: 'n2s-btn small primary', disabled: running || !editing.trim(), onClick: () => rerun(false) }, running ? h('span', { className: 'n2s-spin' }) : null, t('ask.run')))),
        drill && h(DrillPanel, { t, result, drill, onClose: () => setDrill(null), onChange: setDrill }),
        showTable && h(DataTable, { result }))
    }

