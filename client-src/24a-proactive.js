    // ------------------------------------------------------------ proactive (daily digest, goals, forecast)
    // Admin sections 'digests' (每日简报) and 'goals' (目标); goal chips in the dashboard bar;
    // "预测未来 N 天" in the result menu + forecast panel under the result; nl2sql_forecast tool view.

    // ---- forecast

    /** resultId → horizon requested from the result menu (shared by the menu item and the panel). */
    const proForecastStore = createStore({})

    function proForecastOption(f, el, t) {
      const label = cssVar(el, '--dsw-alias-label-secondary', '#888')
      const text = cssVar(el, '--dsw-alias-label-primary', '#222')
      const border = cssVar(el, '--dsw-alias-border-l1', 'rgba(128,128,128,.25)')
      const surface = cssVar(el, '--dsw-alias-bg-layer-1', '#fff')
      const color = '#3b82f6'
      const fcColor = '#f59e0b'
      const hist = f.history ?? []
      const fc = f.forecast ?? []
      const cats = [...hist.map(p => String(p.x)), ...fc.map(p => String(p.x))]
      const n = hist.length
      const pad = (k) => new Array(k).fill(null)
      const histData = hist.map(p => p.y)
      // The dashed forecast starts at the last observation so the two lines join.
      const fcData = [...pad(Math.max(0, n - 1)), n ? hist[n - 1].y : null, ...fc.map(p => p.value)]
      const lower = [...pad(n), ...fc.map(p => p.lower)]
      const width = [...pad(n), ...fc.map(p => p.upper - p.lower)]
      const axisCommon = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: label, fontSize: 11 }, splitLine: { lineStyle: { color: border, type: [3, 3] } } }
      return {
        color: [color, fcColor],
        backgroundColor: 'transparent',
        textStyle: { color: text, fontFamily: 'inherit' },
        animationDuration: 300,
        grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: label, fontSize: 12 }, data: [f.measure, t('pro.fc.forecast'), t('pro.fc.band')] },
        tooltip: {
          trigger: 'axis', confine: true, backgroundColor: surface, borderColor: border, borderWidth: 1, padding: [8, 10], textStyle: { color: text, fontSize: 12 },
          formatter: (ps) => {
            const i = ps[0]?.dataIndex ?? 0
            const rows = [escapeHtml(cats[i])]
            if (i < n) rows.push(`${escapeHtml(f.measure)}: ${formatNumber(hist[i].y)}`)
            else { const p = fc[i - n]; rows.push(`${escapeHtml(t('pro.fc.forecast'))}: ${formatNumber(p.value)}`, `95%: ${formatNumber(p.lower)} ~ ${formatNumber(p.upper)}`) }
            return rows.join('<br/>')
          },
        },
        xAxis: { type: 'category', data: cats, boundaryGap: false, ...axisCommon, axisLine: { show: true, lineStyle: { color: border } }, axisLabel: { color: label, fontSize: 11, hideOverlap: true }, splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...axisCommon, axisLabel: { color: label, fontSize: 11, formatter: (v) => formatNumber(v) } },
        dataZoom: cats.length > 60 ? [{ type: 'inside', startValue: Math.max(0, cats.length - 60) }] : undefined,
        series: [
          { name: f.measure, type: 'line', data: histData, smooth: 0.3, showSymbol: false, symbol: 'circle', lineStyle: { width: 2, color }, itemStyle: { color }, areaStyle: { opacity: 0.06 } },
          { name: t('pro.fc.forecast'), type: 'line', data: fcData, smooth: 0.3, showSymbol: false, symbol: 'circle', lineStyle: { width: 2, type: 'dashed', color: fcColor }, itemStyle: { color: fcColor } },
          { name: 'lower', type: 'line', data: lower, stack: 'band', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
          { name: t('pro.fc.band'), type: 'line', data: width, stack: 'band', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, itemStyle: { color: fcColor }, areaStyle: { color: fcColor, opacity: 0.16 }, silent: true },
        ],
      }
    }

    function ForecastChart({ t, forecast }) {
      const ref = useRef(null)
      const inst = useRef(null)
      const [error, setError] = useState(null)
      useEffect(() => {
        let disposed = false
        let observer
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          inst.current = echarts.init(ref.current, null, { renderer: 'canvas' })
          observer = new ResizeObserver(() => inst.current?.resize())
          observer.observe(ref.current)
          try { inst.current.setOption(proForecastOption(forecast, ref.current, t), true) } catch (e) { setError(e.message) }
        }, (e) => setError(e.message))
        return () => { disposed = true; observer?.disconnect(); inst.current?.dispose(); inst.current = null }
      }, [forecast])
      return h('div', { style: { position: 'relative' } },
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, className: 'n2s-chart', role: 'img', 'aria-label': t('pro.fc.title') }))
    }

    /** Forecast summary + chart + table, shared by the result panel and the tool view. */
    function ForecastView({ t, f, onClose, onHorizon }) {
      const [showTable, setShowTable] = useState(false)
      const method = f.method === 'holt-winters' ? t('pro.fc.hw') : t('pro.fc.holt')
      return h('div', { className: 'n2s-pro-fc' },
        h('div', { className: 'n2s-row', style: { gap: 8, marginBottom: 6 } },
          h('span', { className: 'n2s-pro-fc-title' }, Icon.spark(13), fmt(t, 'pro.fc.heading', { n: f.horizon })),
          h('span', { className: 'n2s-badge' }, method),
          f.filled > 0 && h('span', { className: 'n2s-badge warn', title: t('pro.fc.filledHint') }, fmt(t, 'pro.fc.filled', { n: f.filled })),
          h('span', { className: 'n2s-grow' }),
          onHorizon && h(Dropdown, { label: t('pro.fc.horizon'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, fmt(t, 'pro.fc.nDays', { n: f.horizon }), Icon.chev(10)) }, items: [7, 14, 30].map(n => ({ label: fmt(t, 'pro.fc.nDays', { n }), checked: f.horizon === n, onClick: () => onHorizon(n) })) }),
          h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showTable, onClick: () => setShowTable(v => !v) }, Icon.table(13), t('result.data')),
          onClose && h('button', { type: 'button', className: 'n2s-iconbtn', title: t('pro.close'), 'aria-label': t('pro.close'), onClick: onClose }, Icon.close())),
        h(ForecastChart, { t, forecast: f }),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('pro.fc.note')),
        showTable && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [f.x, t('pro.fc.forecast'), t('pro.fc.lower'), t('pro.fc.upper')].map((c, i) => h('th', { key: i, className: i ? 'num' : undefined }, c)))),
          h('tbody', null, (f.forecast ?? []).map(p => h('tr', { key: p.x }, h('td', null, p.x), h('td', { className: 'num' }, formatNumber(p.value)), h('td', { className: 'num' }, formatNumber(p.lower)), h('td', { className: 'num' }, formatNumber(p.upper))))))))
    }

    /** Can this result be forecast? Time column + exactly one numeric measure, no series split. */
    function proForecastable(result) {
      if (!result?.columns || !result.rows || result.rows.length < 3 || result.chart?.series) return false
      const time = result.columns.some(c => c.kind === 'time')
      const nums = result.columns.filter(c => c.kind === 'number')
      const ys = result.chart?.y?.length ? result.chart.y : nums.map(c => c.name)
      return time && ys.filter(y => nums.some(c => c.name === y)).length === 1
    }

    function ForecastPanel({ t, result }) {
      const get = () => proForecastStore.get()[result?.resultId]
      const horizon = useSyncExternalStore(proForecastStore.subscribe, get, get)
      const fc = useAsync(() => (horizon ? call('forecast', { resultId: result.resultId, horizon }) : null), [result?.resultId, horizon])
      if (!horizon) return null
      const close = () => proForecastStore.set({ [result.resultId]: 0 })
      if (fc.error) return h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, fc.error.message, ' ', h('button', { type: 'button', className: 'n2s-link', onClick: close }, t('pro.close')))
      if (!fc.value) return h('div', { className: 'n2s-pro-fc' }, h('span', { className: 'n2s-spin n2s-muted' }), ' ', h('span', { className: 'n2s-muted n2s-small' }, t('pro.fc.running')))
      return h(ForecastView, { t, f: fc.value, onClose: close, onHorizon: (n) => proForecastStore.set({ [result.resultId]: n }) })
    }

    extend.resultMenu.push(({ t, result }) => (proForecastable(result) ? [
      { divider: true },
      { label: fmt(t, 'pro.fc.menu', { n: 7 }), icon: Icon.spark(14), onClick: () => proForecastStore.set({ [result.resultId]: 7 }) },
    ] : []))
    extend.resultPanels.push(ForecastPanel)

    function makeForecastToolView(ctx) {
      return function Nl2SqlForecastView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const f = settled ? block.meta?.forecast : undefined
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('pro.fc.running'))))
        if (block.isError || !f) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || t('tool.failed')))
        return h('div', { className: 'n2s-toolcard' }, f.title && h('div', { style: { fontWeight: 500, marginBottom: 6 } }, f.title), h(ForecastView, { t, f }))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_forecast', make: makeForecastToolView })

    // ---- goals

    const proStatusClass = { 'on-track': 'ok', achieved: 'ok', 'at-risk': 'warn', missed: 'err', error: 'err' }
    const proPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`)

    function GoalBar({ g }) {
      const w = Math.max(0, Math.min(100, (g.pct ?? 0) * 100))
      const pw = Math.max(0, Math.min(100, (g.projectedPct ?? 0) * 100))
      const tick = Math.max(0, Math.min(100, (g.elapsedPct ?? 0) * 100))
      return h('span', { className: `n2s-pro-bar ${proStatusClass[g.status] ?? ''}`, 'aria-hidden': true },
        h('span', { className: 'proj', style: { width: `${pw}%` } }),
        h('span', { className: 'cur', style: { width: `${w}%` } }),
        g.direction !== 'down' && h('span', { className: 'tick', style: { left: `${tick}%` } }))
    }

    /** Goal chips in the dashboard bar: goals tied to this dashboard or to its data sources. */
    function GoalChips({ t, boardId }) {
      const list = useAsync(() => (boardId ? call('goalProgress', { dashboardId: boardId }) : []), [boardId])
      const goals = list.value ?? []
      if (!goals.length) return null
      return h('div', { className: 'n2s-pro-chips', role: 'list', 'aria-label': t('pro.goals.title') }, goals.slice(0, 4).map(g => h('span', {
        key: g.id, role: 'listitem', className: 'n2s-pro-chip',
        title: g.error ?? `${g.name} · ${g.metric}\n${t('pro.goals.actual')} ${formatNumber(g.actual)} / ${formatNumber(g.target)} (${proPct(g.pct)})\n${t('pro.goals.projected')} ${formatNumber(g.projected)} (${proPct(g.projectedPct)})\n${t(`pro.st.${g.status}`)}`,
      },
      h('span', { className: 'n2s-ellipsis', style: { maxWidth: 90 } }, g.name),
      g.error ? h('span', { className: 'n2s-statusdot err' }, t('pro.st.error')) : h(React.Fragment, null, h(GoalBar, { g }), h('span', { className: `n2s-pro-pct ${proStatusClass[g.status] ?? ''}` }, proPct(g.pct))))))
    }
    extend.dashboardBar.push(GoalChips)

    function useMetrics(datasourceId) {
      const k = useAsync(() => (datasourceId ? call('getKnowledge', { datasourceId }) : null), [datasourceId])
      return k.value?.metrics ?? []
    }

    function GoalForm({ t, initial, ds, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id ?? datasources[0]?.id ?? '', metric: '', period: 'month', target: '', direction: 'up', dashboardId: '', ...(initial ?? {}) }))
      const metrics = useMetrics(form.datasourceId)
      const boards = useAsync(() => call('listDashboards'), [])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const save = () => run(async () => {
        setError(null)
        try { await call('saveGoal', { ...form, target: Number(form.target), dashboardId: form.dashboardId || null }); onDone() } catch (e) { setError(e.message) }
      })
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pro.goals.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('label', { className: 'n2s-field' }, h('span', null, t('al.metric')), metrics.length ? h('select', { className: 'n2s-select', value: form.metric, onChange: set('metric') }, h('option', { value: '' }, '—'), metrics.map(m => h('option', { key: m.id, value: m.name }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics'))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.period')), h('select', { className: 'n2s-select', value: form.period, onChange: set('period') }, ['month', 'quarter', 'year'].map(p => h('option', { key: p, value: p }, t(`pro.period.${p}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.target')), h('input', { className: 'n2s-input', type: 'number', value: form.target, onChange: set('target') })),
          h('div', { className: 'n2s-field' }, h('span', null, t('pro.goals.direction')), h('div', { className: 'n2s-seg' }, ['up', 'down'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.direction === v, onClick: () => setForm(f => ({ ...f, direction: v })) }, t(`pro.dir.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.dashboard')), h('select', { className: 'n2s-select', value: form.dashboardId ?? '', onChange: set('dashboardId') }, h('option', { value: '' }, t('pro.goals.anyBoard')), (boards.value?.dashboards ?? []).map(b => h('option', { key: b.id, value: b.id }, b.name))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function GoalPushSettings({ t }) {
      const cfg = useAsync(() => call('getGoalPush'), [])
      const [busy, run] = useBusy()
      const v = cfg.value
      if (!v) return null
      const save = (patch) => run(async () => { try { await call('saveGoalPush', patch); cfg.reload() } catch (e) { notifyError(e) } })
      return h('div', { className: 'n2s-section' }, h('h2', null, t('pro.goals.weekly')),
        h('div', { className: 'n2s-row', style: { gap: 10, flexWrap: 'wrap' } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: Boolean(v.enabled), disabled: busy, onChange: e => save({ enabled: e.target.checked }) }), t('pro.goals.weeklyOn')),
          h('select', { className: 'n2s-select inline', 'aria-label': t('pro.weekday'), value: v.weekday, onChange: e => save({ weekday: Number(e.target.value) }) }, [1, 2, 3, 4, 5, 6, 0].map(d => h('option', { key: d, value: d }, t(`pro.wd.${d}`)))),
          h('input', { className: 'n2s-input', type: 'time', 'aria-label': t('rep.time'), style: { width: 110 }, value: v.time, onChange: e => save({ time: e.target.value }) }),
          h('div', { style: { minWidth: 200 } }, h(ChannelPicker, { t, value: v.channelId ?? '', noneLabel: t('al.noPush'), label: t('rep.push'), onChange: (id) => save({ channelId: id || null }) })),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: !v.channelId || busy, onClick: () => run(async () => { try { await call('sendGoalReport'); notify(t('pro.sent'), 'ok') } catch (e) { notifyError(e) } }) }, Icon.send(13), t('pro.sendNow'))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('pro.goals.weeklyHint')))
    }

    function GoalsSection({ t, ds, datasources }) {
      const list = useAsync(() => call('goalProgress', {}), [])
      const [editing, setEditing] = useState(null)
      const goals = list.value ?? []
      return h('div', null,
        h(SectionHead, { title: t('pro.goals.title'), desc: t('pro.goals.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, '+ ', t('pro.goals.add'))),
        editing && h(GoalForm, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        list.loading && !list.value && h('span', { className: 'n2s-spin n2s-muted' }),
        !list.loading && goals.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pro.goals.empty')), h('div', null, t('pro.goals.emptyHint'))),
        goals.length > 0 && h('div', { className: 'n2s-list2' }, goals.map(g => h('div', { key: g.id, className: 'n2s-list2-row' },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, g.name), h('span', { className: `n2s-statusdot ${proStatusClass[g.status] ?? ''}` }, t(`pro.st.${g.status}`))),
            h('div', { className: 'n2s-list2-sub' }, joinList([g.metric, t(`pro.period.${g.period}`), `${t(`pro.dir.${g.direction}`)} ${formatNumber(g.target)}`, g.datasourceName ?? null, g.periodStart && `${g.periodStart} ~ ${g.periodEnd}`], ' · ')),
            g.error ? h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, g.error)
              : h('div', { className: 'n2s-row', style: { gap: 8, marginTop: 6 } }, h(GoalBar, { g }),
                h('span', { className: 'n2s-small' }, `${formatCompact(g.actual)} / ${formatCompact(g.target)} (${proPct(g.pct)})`),
                h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'pro.goals.proj', { v: formatCompact(g.projected), p: proPct(g.projectedPct) }), g.weekdayAware ? ` · ${t('pro.goals.weekdayAware')}` : ''))),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
            { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing({ id: g.id, name: g.name, datasourceId: g.datasourceId, metric: g.metric, period: g.period, target: g.target, direction: g.direction, dashboardId: g.dashboardId ?? '' }) },
            { divider: true },
            { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pro.deleteConfirm', { name: g.name }), danger: true })) { try { await call('deleteGoal', { id: g.id }) } catch (e) { notifyError(e) } list.reload() } } },
          ] })))),
        h(GoalPushSettings, { t }))
    }
    extend.adminSections.push({ id: 'goals', label: (t) => t('pro.goals.title'), icon: () => svg(15, [h('circle', { key: 1, cx: 8, cy: 8, r: 6 }), h('circle', { key: 2, cx: 8, cy: 8, r: 3 }), h('circle', { key: 3, cx: 8, cy: 8, r: .6 })]), Component: GoalsSection })

    // ---- daily digest

    function DigestForm({ t, initial, ds, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id ?? datasources[0]?.id ?? '', source: initial?.dashboardId ? 'dashboard' : 'metrics', metrics: [], dashboardId: '', channelId: '', time: '09:00', language: uiLang, threshold: 30, enabled: true, ...(initial ?? {}) }))
      const metrics = useMetrics(form.datasourceId)
      const boards = useAsync(() => call('listDashboards'), [])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const payload = () => ({ id: form.id, name: form.name, datasourceId: form.datasourceId, metrics: form.source === 'metrics' ? form.metrics : [], dashboardId: form.source === 'dashboard' ? form.dashboardId || null : null, channelId: form.channelId || null, time: form.time, language: form.language, threshold: Number(form.threshold), enabled: form.enabled })
      const save = () => run(async () => {
        setError(null)
        try { await call('saveDigest', payload()); onDone() } catch (e) { setError(e.message) }
      })
      const toggle = (name) => setForm(f => ({ ...f, metrics: f.metrics.includes(name) ? f.metrics.filter(x => x !== name) : [...f.metrics, name] }))
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pro.dg.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('pro.dg.source')), h('div', { className: 'n2s-seg' }, ['metrics', 'dashboard'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.source === v, onClick: () => setForm(f => ({ ...f, source: v })) }, t(`pro.dg.src.${v}`))))),
          form.source === 'metrics'
            ? h('div', { className: 'n2s-field full' }, h('span', null, t('pro.dg.metrics')), metrics.length ? h('div', { className: 'n2s-chips' }, metrics.map(m => h('button', { key: m.id, type: 'button', className: 'n2s-chip', 'aria-pressed': form.metrics.includes(m.name), onClick: () => toggle(m.name) }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics')))
            : h('label', { className: 'n2s-field full' }, h('span', null, t('pro.dg.dashboard')), h('select', { className: 'n2s-select', value: form.dashboardId ?? '', onChange: set('dashboardId') }, h('option', { value: '' }, '—'), (boards.value?.dashboards ?? []).map(b => h('option', { key: b.id, value: b.id }, b.name)))),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-pro-dg-ch', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-pro-dg-ch', value: form.channelId ?? '', noneLabel: t('al.noPush'), onChange: (v) => setForm(f => ({ ...f, channelId: v })) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.language')), h('select', { className: 'n2s-select', value: form.language, onChange: set('language') }, h('option', { value: 'zh' }, '中文'), h('option', { value: 'en' }, 'English'))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.threshold')), h('input', { className: 'n2s-input', type: 'number', min: 1, max: 500, value: form.threshold, onChange: set('threshold') }))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('pro.dg.hint')),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function DigestPreview({ t, run }) {
      if (run.busy) return h('div', { className: 'n2s-notice', style: { marginTop: 10 } }, h('span', { className: 'n2s-spin' }), ' ', t('pro.dg.previewing'))
      if (run.error) return h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, run.error)
      return h('div', { className: 'n2s-pro-preview' },
        h('div', { style: { fontWeight: 500, marginBottom: 6 } }, run.title),
        h(MdPreview, { text: run.text }),
        (run.results ?? []).length > 0 && h('div', { className: 'n2s-pro-preview-charts' }, run.results.map(r => h(ResultView, { key: r.resultId, result: r, t, compact: true, hideSql: true, onPinned: { hidden: true } }))))
    }

    function DigestsSection({ t, ds, datasources }) {
      const list = useAsync(() => call('listDigests'), [])
      const [editing, setEditing] = useState(null)
      const [preview, setPreview] = useState(null)
      const digests = list.value ?? []
      const runPreview = async (d) => {
        setPreview({ id: d.id, busy: true })
        try { setPreview({ ...(await call('runDigest', { id: d.id })), runId: undefined, id: d.id }) } catch (e) { setPreview({ id: d.id, error: e.message }) }
      }
      const act = async (fn, ok) => { try { await fn(); if (ok) notify(ok, 'ok') } catch (e) { notifyError(e) } list.reload() }
      return h('div', null,
        h(SectionHead, { title: t('pro.dg.title'), desc: t('pro.dg.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, '+ ', t('pro.dg.add'))),
        editing && h(DigestForm, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && digests.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pro.dg.empty')), h('div', null, t('pro.dg.emptyHint'))),
        digests.length > 0 && h('div', { className: 'n2s-list2' }, digests.map(d => h(React.Fragment, { key: d.id },
          h('div', { className: 'n2s-list2-row' },
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, d.name), !d.enabled && h('span', { className: 'n2s-badge' }, t('rep.status.paused')), d.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), d.channelName)),
              h('div', { className: 'n2s-list2-sub' }, joinList([d.dashboardId ? t('pro.dg.src.dashboard') : joinList(d.metrics), fmt(t, 'pro.dg.dailyAt', { time: d.time }), d.datasourceName], ' · ')),
              d.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, d.lastError)),
            h('div', { className: 'n2s-list2-side' }, d.lastRunAt ? h('span', { className: `n2s-statusdot ${d.lastStatus === 'ok' ? 'ok' : 'err'}` }, new Date(d.lastRunAt).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : h('span', { className: 'n2s-faint n2s-small' }, t('al.never'))),
            h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
              h('button', { type: 'button', className: 'n2s-btn small', disabled: preview?.id === d.id && preview.busy, onClick: () => runPreview(d) }, t('pro.dg.preview')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('pro.sendNow'), icon: Icon.send(14), disabled: !d.channelId, onClick: () => act(() => call('runDigest', { id: d.id, send: true }), t('pro.sent')) },
                { label: d.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('saveDigest', { id: d.id, enabled: !d.enabled })) },
                { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing({ ...d, source: d.dashboardId ? 'dashboard' : 'metrics', channelId: d.channelId ?? '', dashboardId: d.dashboardId ?? '' }) },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pro.deleteConfirm', { name: d.name }), danger: true })) act(() => call('deleteDigest', { id: d.id })) } },
              ] }))),
          preview?.id === d.id && h('div', { style: { padding: '0 12px 12px' } }, h(DigestPreview, { t, run: preview }), !preview.busy && h('button', { type: 'button', className: 'n2s-btn small ghost', style: { marginTop: 6 }, onClick: () => setPreview(null) }, t('pro.close')))))))
    }
    extend.adminSections.push({ id: 'digests', label: (t) => t('pro.dg.title'), icon: () => Icon.spark(15), Component: DigestsSection })
