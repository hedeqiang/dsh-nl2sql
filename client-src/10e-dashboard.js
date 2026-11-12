    const WIDGET_WIDTHS = ['third', 'half', 'full']

    function DashboardWidget({ t, widget, onRemove, onChanged, onMove, tick, first, last, filters, filterCount, otherBoards = [], onTransfer, onLoaded, drag, source, showSource }) {
      const [state, setState] = useState({ busy: true })
      const [local, setLocal] = useState(0)
      useEffect(() => {
        let alive = true
        setState(s => ({ ...s, busy: true, error: undefined }))
        call('runWidget', { id: widget.id, filters, fresh: local > 0 || tick > 0 }).then(
          r => { if (alive) { setState({ result: r, at: Date.now() }); onLoaded?.(widget.id, { at: Date.now(), cached: Boolean(r.cached), cachedAt: r.cachedAt }) } },
          e => { if (alive) { setState({ error: e.message }); onLoaded?.(widget.id, { at: Date.now(), error: true }) } })
        return () => { alive = false }
      }, [widget.id, tick, local, filters])
      const update = async (patch) => { try { await call('updateWidget', { id: widget.id, ...patch }) } catch (e) { notifyError(e) } onChanged() }
      const ago = state.at ? new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      const widgetResult = useMemo(() => (state.result ? { ...state.result, title: '' } : null), [state.result])
      const width = WIDGET_WIDTHS.includes(widget.width) ? widget.width : 'half'
      return h('div', {
        className: `n2s-widget w-${width}${drag.dragging ? ' dragging' : ''}${drag.over ? ` drop-${drag.over}` : ''}`,
        onDragOver: drag.onDragOver, onDragLeave: drag.onDragLeave, onDrop: drag.onDrop,
      },
        h('div', { className: 'n2s-widget-head' },
          h('span', {
            className: 'n2s-draghandle', draggable: true, role: 'button', tabIndex: 0, title: t('dash.dragHint'), 'aria-label': fmt(t, 'dash.dragLabel', { title: widget.title }),
            onDragStart: drag.onDragStart, onDragEnd: drag.onDragEnd,
            onKeyDown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); if (!first) onMove(-1) } if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (!last) onMove(1) } },
          }, svg(14, [h('circle', { key: 1, cx: 6, cy: 4, r: .9, fill: 'currentColor' }), h('circle', { key: 2, cx: 10, cy: 4, r: .9, fill: 'currentColor' }), h('circle', { key: 3, cx: 6, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 4, cx: 10, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 5, cx: 6, cy: 12, r: .9, fill: 'currentColor' }), h('circle', { key: 6, cx: 10, cy: 12, r: .9, fill: 'currentColor' })])),
          h('span', { className: 'title', title: widget.title }, widget.title),
          showSource && h('span', { className: `n2s-badge n2s-srcbadge${source ? '' : ' warn'}`, title: source ? `${t('dash.sourceOf')}: ${source.name} · ${typeLabel(t, source.type)}` : t('dash.sourceMissing') }, Icon.db(11), source ? source.name : t('dash.sourceMissingShort')),
          state.busy ? h('span', { className: 'n2s-spin n2s-faint', 'aria-label': t('dash.loading') }) : ago && h('span', { className: 'n2s-faint n2s-small n2s-hide-narrow', title: state.result?.cached ? fmt(t, 'dash.cachedAt', { time: new Date(state.result.cachedAt).toLocaleTimeString() }) : t('dash.updatedAt') }, state.result?.cached ? `${ago} · ${t('dash.cached')}` : ago),
          state.result?.filters?.length > 0 && h('span', { className: 'n2s-badge blue', title: state.result.filters.map(f => f.description).join('\n') }, fmt(t, 'filter.appliedCount', { count: state.result.filters.length })),
          state.result && filterCount > 0 && !(state.result.filters?.length) && h('span', { className: 'n2s-badge', title: t('filter.notApplied') }, t('filter.notAppliedShort')),
          h('div', { className: 'n2s-widget-actions' },
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('dash.refreshOne'), 'aria-label': t('dash.refreshOne'), onClick: () => setLocal(x => x + 1) }, Icon.refresh(14)),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('dash.rename'), icon: Icon.edit(14), onClick: async () => { const v = await promptDialog({ title: t('dash.rename'), value: widget.title }); if (v) update({ title: v }) } },
              ...WIDGET_WIDTHS.map(w => ({ label: t(`dash.width.${w}`), checked: width === w, onClick: () => width !== w && update({ width: w }) })),
              { divider: true },
              { label: t('dash.moveUp'), icon: Icon.up(14), disabled: first, onClick: () => onMove(-1) },
              { label: t('dash.moveDown'), icon: Icon.down(14), disabled: last, onClick: () => onMove(1) },
              ...otherBoards.flatMap(b => [{ label: fmt(t, 'dash.copyTo', { name: b.name }), icon: Icon.copy(14), onClick: () => onTransfer(b.id, true) }, { label: fmt(t, 'dash.moveTo', { name: b.name }), icon: Icon.arrow(14), onClick: () => onTransfer(b.id, false) }]),
              { divider: true },
              { label: t('dash.remove'), icon: Icon.trash(14), danger: true, onClick: onRemove },
            ] }))),
        state.error && h('div', { className: 'n2s-notice err' }, state.error, ' ', h('button', { type: 'button', className: 'n2s-link', onClick: () => setLocal(x => x + 1) }, t('dash.retry'))),
        !state.result && state.busy && h('div', { className: 'n2s-skel', style: { height: 220 } }),
        state.result && h(ResultView, { result: widgetResult, t, compact: true, embedded: true, onPinned: HIDDEN_PIN }))
    }

    function DashboardTab({ t, ds, datasources = [] }) {
      const [boardId, setBoardId] = useState(null)
      const list = useAsync(() => call('listDashboard'), [boardId])
      const boards = useAsync(() => call('listDashboards'), [boardId])
      const [tick, setTick] = useState(0)
      const [auto, setAuto] = useState(0)
      useEffect(() => {
        if (!auto) return
        const id = setInterval(() => setTick(x => x + 1), auto * 1000)
        return () => clearInterval(id)
      }, [auto])
      // Optimistic order while a drag-and-drop reorder is being saved.
      const [order, setOrder] = useState(null)
      useEffect(() => { setOrder(null) }, [list.value])
      const serverWidgets = list.value ?? []
      const allWidgets = order ? order.map(id => serverWidgets.find(w => w.id === id)).filter(Boolean) : serverWidgets
      // Widgets keep the data source they were pinned from; a board may mix sources.
      // Scope: all sources, or only the one selected at the top right (remembered per browser).
      const [scope, setScopeState] = useState(() => { try { return localStorage.getItem('nl2sql:dashScope') === 'current' ? 'current' : 'all' } catch { return 'all' } })
      const setScope = (v) => { setScopeState(v); try { localStorage.setItem('nl2sql:dashScope', v) } catch {} }
      const sourceIds = [...new Set(allWidgets.map(w => w.datasourceId))]
      const mixed = sourceIds.length > 1
      const dsById = new Map(datasources.map(d => [d.id, d]))
      const widgets = scope === 'current' && ds ? allWidgets.filter(w => w.datasourceId === ds.id) : allWidgets
      const hiddenByScope = allWidgets.length - widgets.length
      const showSource = mixed || (ds && sourceIds.some(id => id !== ds.id))
      const saved = useAsync(() => call('getDashboardFilters'), [boardId])
      const [filters, setFilters] = useState(null)
      const [filtersFor, setFiltersFor] = useState(null)
      // Adopt the saved filters only once they belong to the current board (avoid showing the previous board's filters).
      useEffect(() => { if (!saved.loading && saved.value) { setFilters(saved.value); setFiltersFor(boardId) } }, [saved.value, saved.loading, boardId])
      const filtersReady = filters !== null && filtersFor === boardId
      const [sendingDash, setSendingDash] = useState(false)
      // Saves are serialized so an older save can never land after a newer one.
      const saveChain = useRef(Promise.resolve())
      const changeFilters = (next) => {
        setFilters(next)
        saveChain.current = saveChain.current.then(() => call('saveDashboardFilters', { filters: next })).catch((e) => notifyError(e))
      }
      const otherBoards = (boards.value?.dashboards ?? []).filter(d => d.id !== boards.value?.current)
      // Per-widget load status → header summary ("updated 10:42 · 2 from cache").
      const [loads, setLoads] = useState({})
      useEffect(() => { setLoads({}) }, [boardId])
      const onLoaded = useCallback((id, info) => setLoads(l => ({ ...l, [id]: info })), [])
      const loadList = widgets.map(w => loads[w.id]).filter(Boolean)
      const lastAt = loadList.length ? Math.max(...loadList.map(x => x.at)) : null
      const cachedN = loadList.filter(x => x.cached).length
      const errorN = loadList.filter(x => x.error).length
      const loadingN = widgets.length - loadList.length
      // Drag and drop.
      const [dragId, setDragId] = useState(null)
      const [over, setOver] = useState(null) // { id, pos: 'before'|'after' }
      const commitOrder = async (visibleIds) => {
        // Hidden (other-source) widgets keep their slots; visible ones take the new order.
        const queue = [...visibleIds]
        const visible = new Set(visibleIds)
        const ids = allWidgets.map(w => (visible.has(w.id) ? queue.shift() : w.id))
        setOrder(ids)
        try { await call('reorderWidgets', { dashboardId: boards.value?.current, ids }) } catch (e) { notifyError(e); setOrder(null) }
        list.reload()
      }
      const dragProps = (w) => ({
        dragging: dragId === w.id,
        over: over?.id === w.id && dragId !== w.id ? over.pos : null,
        onDragStart: (e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', w.id) } catch {} },
        onDragEnd: () => { setDragId(null); setOver(null) },
        onDragOver: (e) => {
          if (!dragId || dragId === w.id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const pos = (r.width > r.height * 1.6 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) ? 'before' : 'after'
          if (over?.id !== w.id || over?.pos !== pos) setOver({ id: w.id, pos })
        },
        onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget) && over?.id === w.id) setOver(null) },
        onDrop: (e) => {
          e.preventDefault()
          if (!dragId || dragId === w.id) return
          const ids = widgets.map(x => x.id).filter(id => id !== dragId)
          const at = ids.indexOf(w.id) + (over?.pos === 'after' ? 1 : 0)
          ids.splice(at, 0, dragId)
          setDragId(null); setOver(null)
          commitOrder(ids)
        },
      })
      const move = (w, delta) => {
        const ids = widgets.map(x => x.id)
        const i = ids.indexOf(w.id)
        const j = i + delta
        if (j < 0 || j >= ids.length) return
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        commitOrder(ids)
        setTimeout(() => document.querySelectorAll('.n2s-draghandle')[j]?.focus(), 50)
      }
      return h('div', null,
        h(DashboardSwitcher, { t, value: { id: boardId }, onChange: (id) => setBoardId(`${id}:${Date.now()}`) }),
        allWidgets.length > 0 && h('div', { className: 'n2s-toolbar n2s-dashbar' },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 10 } },
              h('div', { className: 'n2s-h2', style: { margin: 0 } }, fmt(t, 'dash.count', { count: widgets.length })),
              (mixed || hiddenByScope > 0 || (ds && sourceIds.some(id => id !== ds.id))) && h('div', { className: 'n2s-seg small', role: 'group', 'aria-label': t('dash.scope') },
                ['all', 'current'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': scope === v, disabled: v === 'current' && !ds, onClick: () => setScope(v) }, v === 'all' ? t('dash.scopeAll') : fmt(t, 'dash.scopeCurrent', { name: ds?.name ?? '' }))))),
            showSource && h('div', { className: 'n2s-faint n2s-small' }, fmt(t, 'dash.sources', { list: joinList(sourceIds.map(id => dsById.get(id)?.name ?? t('dash.sourceMissingShort'))) })),
            h('div', { className: 'n2s-faint n2s-small', role: 'status', 'aria-live': 'polite' },
              loadingN > 0 ? fmt(t, 'dash.loadingN', { n: loadingN }) : lastAt ? fmt(t, 'dash.lastRefresh', { time: new Date(lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : '',
              cachedN > 0 && loadingN === 0 ? h('span', null, ' · ', h('button', { type: 'button', className: 'n2s-link', title: t('dash.cachedHint'), onClick: () => setTick(x => x + 1) }, fmt(t, 'dash.cachedN', { n: cachedN }))) : null,
              errorN > 0 ? h('span', { style: { color: 'var(--n2s-err)' } }, ' · ', fmt(t, 'dash.errorN', { n: errorN })) : null)),
          h('div', { className: 'n2s-dashbar-actions' },
            h(Dropdown, { label: t('dash.export'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, Icon.download(13), h('span', { className: 'n2s-hide-narrow' }, t('dash.export')), Icon.chev(10)) }, items: [
              { label: t('result.excel'), icon: Icon.download(14), onClick: () => exportExcel({ dashboardId: boards.value?.current }) },
              { label: t('dash.snapshot'), icon: Icon.pin(14), onClick: async () => { try { const s = await call('snapshotDashboard', { dashboardId: boards.value?.current }); notify(fmt(t, 'dash.snapshotDone', { n: s.widgets.length }), 'ok') } catch (e) { notifyError(e) } } },
              ...extItems(extend.dashboardMenu, { t, boardId: boards.value?.current, widgets, filters: filters ?? [] }),
            ] }),
            ...extend.dashboardBar.map((C, i) => h(C, { key: `x${i}`, t, boardId: boards.value?.current, widgets, filters: filters ?? [] })),
            h(Dropdown, { label: t('dash.auto'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, Icon.refresh(13), h('span', { className: 'n2s-hide-narrow' }, auto ? fmt(t, 'dash.autoEvery', { min: auto / 60 }) : t('dash.autoShort')), Icon.chev(10)) },
              items: [0, 60, 300, 900].map(v => ({ label: v === 0 ? t('dash.autoOff') : fmt(t, 'dash.autoEvery', { min: v / 60 }), checked: auto === v, onClick: () => setAuto(v) })) }),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setTick(x => x + 1) }, t('dash.refresh')),
            h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => setSendingDash(true) }, Icon.send(13), h('span', { className: 'n2s-hide-narrow' }, t('im.shareDashboard'))))),
        widgets.length > 0 && filtersReady && h(FilterBar, { key: `f:${boardId ?? 'b'}`, t, filters, onChange: changeFilters }),
        sendingDash && h(SendDialog, { t, initial: { title: t('im.dashboardTitle'), dashboard: true }, onClose: () => setSendingDash(false) }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && widgets.length === 0 && hiddenByScope > 0 && h('div', { className: 'n2s-empty' }, h('h3', null, fmt(t, 'dash.scopeEmpty', { name: ds?.name ?? '' })), h('div', null, fmt(t, 'dash.scopeEmptyHint', { n: hiddenByScope })), h('button', { type: 'button', className: 'n2s-btn', onClick: () => setScope('all') }, t('dash.scopeAll'))),
        !list.loading && allWidgets.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('dash.empty')), h('div', null, t('dash.emptyHint')), h('button', { type: 'button', className: 'n2s-btn', onClick: () => fbCtx.navigate?.({ tab: 'ask' }) }, t('dash.goAsk'))),
        widgets.length > 1 && h('div', { className: 'n2s-faint n2s-small n2s-hide-narrow', style: { margin: '-4px 0 8px' } }, t('dash.dragTip')),
        filtersReady && !list.loading && h('div', { className: `n2s-dash${dragId ? ' is-dragging' : ''}`, key: `d:${boardId ?? 'b'}` }, widgets.map((w, i) => h(DashboardWidget, {
          key: w.id, t, widget: w, tick, first: i === 0, last: i === widgets.length - 1, filters: filters ?? [], filterCount: (filters ?? []).filter(f => f.kind !== 'in' || f.values.length > 0).length,
          onChanged: () => list.reload(), onLoaded, drag: dragProps(w), source: dsById.get(w.datasourceId), showSource,
          onMove: (delta) => move(w, delta),
          onRemove: async () => { if (!await confirmDialog({ title: fmt(t, 'dash.removeConfirm', { title: w.title }), danger: true })) return; try { await call('unpinWidget', { id: w.id }); notify(t('dash.removed'), 'ok') } catch (e) { notifyError(e) } list.reload() },
          otherBoards, onTransfer: async (to, copy) => { try { await call('transferWidget', { id: w.id, toDashboardId: to, copy }); notify(copy ? t('dash.copied') : t('dash.moved'), 'ok') } catch (e) { notifyError(e) } list.reload(); boards.reload() },
        }))))
    }
