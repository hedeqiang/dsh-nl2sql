    // ------------------------------------------------- presentation (feature "present")
    // Dashboard menu: export PPT / long image, send the long image, presentation mode.
    // Result menu: export PPT. Admin section: Lark Bitable sync.

    async function preDownload(t, method, payload, doneKey) {
      notify(t('pre.working'), 'info', 2500)
      try { const r = await call(method, payload); downloadBase64(r); if (doneKey) notify(t(doneKey), 'ok') } catch (e) { notifyError(e) }
    }

    /** Pick an image-capable channel and send the dashboard long image. */
    function PreSendImageDialog({ t, boardId, onClose }) {
      const channels = useChannels().filter(c => c.type === 'lark_app' || c.type === 'telegram_bot')
      const [channelId, setChannelId] = useState('')
      const [busy, run] = useBusy()
      const [error, setError] = useState(null)
      useEffect(() => { if (!channelId && channels[0]) setChannelId(channels[0].id) }, [channels.length])
      const send = () => run(async () => {
        setError(null)
        try { const r = await call('sendDashboardImage', { dashboardId: boardId, channelId }); notify(fmt(t, 'pre.imageSent', { channel: r.channel }), 'ok'); onClose() } catch (e) { setError(e.message) }
      })
      return h(Modal, { label: t('pre.sendImage'), onClose, width: 460 },
        h('div', { className: 'n2s-modal-title' }, t('pre.sendImage')),
        h('div', { className: 'n2s-pre-dlg' },
          h('p', { className: 'n2s-muted n2s-small', style: { marginTop: 0 } }, t('pre.sendImageHint')),
          channels.length
            ? h('select', { className: 'n2s-select', 'aria-label': t('pre.channel'), value: channelId, onChange: e => setChannelId(e.target.value) }, channels.map(c => h('option', { key: c.id, value: c.id }, c.name)))
            : h('div', { className: 'n2s-notice warn' }, t('pre.noImageChannel')),
          error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error)),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', gap: 8, marginTop: 16 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy || !channelId, onClick: send }, busy ? h('span', { className: 'n2s-spin' }) : Icon.send(13), t('pre.send'))))
    }

    // ------------------------------------------------------ presentation mode

    const PRE_REFRESH = [60, 300, 900]
    const PRE_ROTATE = [0, 30, 60, 120, 300]

    function PreWidget({ t, widget, filters, tick, onLoaded }) {
      const [state, setState] = useState({ busy: true })
      useEffect(() => {
        let alive = true
        setState(s => ({ ...s, busy: true }))
        call('runWidget', { id: widget.id, ...(filters ? { filters } : {}), fresh: tick > 0 }).then(
          r => { if (alive) { setState({ result: { ...r, title: '' } }); onLoaded?.() } },
          e => { if (alive) { setState({ error: e.message }); onLoaded?.() } })
        return () => { alive = false }
      }, [widget.id, tick, filters])
      const width = ['third', 'half', 'full'].includes(widget.width) ? widget.width : 'half'
      return h('section', { className: `n2s-pre-card w-${width}`, 'aria-label': widget.title },
        h('div', { className: 'n2s-pre-card-title' }, widget.title, state.busy && state.result ? h('span', { className: 'n2s-spin', style: { marginLeft: 8 } }) : null),
        state.error ? h('div', { className: 'n2s-notice err' }, state.error)
          : state.result ? h(ResultView, { result: state.result, t, compact: true, embedded: true, hideSql: true, onPinned: HIDDEN_PIN })
            : h('div', { className: 'n2s-skel', style: { height: 240 } }))
    }

    function PresentationMode({ t, boardId, filters, onClose }) {
      const root = useRef(null)
      const boards = useAsync(() => call('listDashboards'), [])
      const list = boards.value?.dashboards ?? []
      const [current, setCurrent] = useState(boardId)
      const board = list.find(b => b.id === current)
      const widgets = useAsync(() => call('listDashboard', { dashboardId: current }), [current])
      const [refresh, setRefresh] = useState(() => { try { return Number(localStorage.getItem('nl2sql:preRefresh')) || 300 } catch { return 300 } })
      const [rotate, setRotate] = useState(0)
      const [tick, setTick] = useState(0)
      const [now, setNow] = useState(Date.now())
      const [lastAt, setLastAt] = useState(null)
      const [fs, setFs] = useState(false)
      // The opening board keeps the dashboard's current (unsaved) filters; other boards use their saved ones.
      const boardFilters = current === boardId ? filters : undefined
      const go = useCallback((delta) => {
        if (list.length < 2) return
        const i = Math.max(0, list.findIndex(b => b.id === current))
        setCurrent(list[(i + delta + list.length) % list.length].id)
        setLastAt(null)
      }, [list, current])
      useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
      useEffect(() => { const id = setInterval(() => setTick(x => x + 1), refresh * 1000); return () => clearInterval(id) }, [refresh])
      useEffect(() => { if (!rotate || list.length < 2) return; const id = setInterval(() => go(1), rotate * 1000); return () => clearInterval(id) }, [rotate, go, list.length])
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [go, onClose])
      useEffect(() => {
        const el = root.current
        const prev = document.activeElement
        el?.focus()
        try { if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().then(() => setFs(true), () => {}) } catch {}
        // Leaving browser fullscreen with Esc closes the overlay too.
        const onFs = () => { if (!document.fullscreenElement) { setFs(was => { if (was) onClose(); return false }) } }
        document.addEventListener('fullscreenchange', onFs)
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          document.removeEventListener('fullscreenchange', onFs)
          document.body.style.overflow = overflow
          try { if (document.fullscreenElement) document.exitFullscreen?.() } catch {}
          prev?.focus?.()
        }
      }, [])
      const setRefreshSaved = (v) => { setRefresh(v); try { localStorage.setItem('nl2sql:preRefresh', String(v)) } catch {} }
      const items = widgets.value ?? []
      const clock = new Date(now)
      return ReactDOM.createPortal(h('div', { ref: root, className: 'n2s-pre', role: 'dialog', 'aria-modal': true, 'aria-label': t('pre.mode'), tabIndex: -1 },
        h('header', { className: 'n2s-pre-head' },
          h('div', { className: 'n2s-pre-titles' },
            h('h1', null, board?.name ?? ''),
            h('div', { className: 'n2s-pre-sub', role: 'status', 'aria-live': 'polite' },
              lastAt ? fmt(t, 'pre.lastRefresh', { time: new Date(lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : t('pre.loading'),
              list.length > 1 ? ` · ${list.findIndex(b => b.id === current) + 1}/${list.length}` : '')),
          h('div', { className: 'n2s-pre-clock', 'aria-label': t('pre.clock') },
            h('div', { className: 'time' }, clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
            h('div', { className: 'date' }, clock.toLocaleDateString(uiLocale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }))),
          h('div', { className: 'n2s-pre-ctl' },
            h('label', null, h('span', null, t('pre.refresh')), h('select', { value: refresh, onChange: e => setRefreshSaved(Number(e.target.value)) }, PRE_REFRESH.map(v => h('option', { key: v, value: v }, fmt(t, 'dash.autoEvery', { min: v / 60 }))))),
            list.length > 1 && h('label', null, h('span', null, t('pre.rotate')), h('select', { value: rotate, onChange: e => setRotate(Number(e.target.value)) }, PRE_ROTATE.map(v => h('option', { key: v, value: v }, v ? fmt(t, 'pre.everySec', { s: v }) : t('pre.rotateOff'))))),
            list.length > 1 && h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.prev'), title: t('pre.prev'), onClick: () => go(-1) }, '←'),
            list.length > 1 && h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.next'), title: t('pre.next'), onClick: () => go(1) }, '→'),
            h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('dash.refresh'), title: t('dash.refresh'), onClick: () => setTick(x => x + 1) }, Icon.refresh(16)),
            h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.exit'), title: t('pre.exitHint'), onClick: onClose }, Icon.close(16)))),
        widgets.error && h('div', { className: 'n2s-notice err' }, widgets.error.message),
        !widgets.loading && items.length === 0 && h('div', { className: 'n2s-pre-empty' }, t('dash.empty')),
        h('main', { className: 'n2s-pre-grid', key: current },
          items.map(w => h(PreWidget, { key: w.id, t, widget: w, filters: boardFilters, tick, onLoaded: () => setLastAt(Date.now()) })))), document.body)
    }

    // ------------------------------------------------------------ menus

    const preState = createStore({ present: null, sendImage: null })
    function PreLayer({ t }) {
      const s = useSyncExternalStore(preState.subscribe, preState.get, preState.get)
      return h(React.Fragment, null,
        s.present && h(PresentationMode, { t, boardId: s.present.boardId, filters: s.present.filters, onClose: () => preState.set({ present: null }) }),
        s.sendImage && h(PreSendImageDialog, { t, boardId: s.sendImage.boardId, onClose: () => preState.set({ sendImage: null }) }))
    }
    extend.dashboardBar.push(PreLayer)

    extend.dashboardMenu.push(({ t, boardId, widgets, filters }) => [
      { divider: true },
      { label: t('pre.exportPpt'), icon: Icon.download(14), disabled: !widgets?.length, onClick: () => preDownload(t, 'exportDashboardPptx', { dashboardId: boardId, filters }, 'pre.exported') },
      { label: t('pre.exportImage'), icon: Icon.download(14), disabled: !widgets?.length, onClick: () => preDownload(t, 'exportDashboardImage', { dashboardId: boardId, filters, width: 1200 }, 'pre.exported') },
      { label: t('pre.sendImage'), icon: Icon.send(14), disabled: !widgets?.length, onClick: () => preState.set({ sendImage: { boardId } }) },
      { label: t('pre.mode'), icon: Icon.expand(14), onClick: () => preState.set({ present: { boardId, filters } }) },
    ])

    extend.resultMenu.push(({ t, result }) => (result?.resultId ? [
      { label: t('pre.exportPpt'), icon: Icon.download(14), onClick: () => preDownload(t, 'exportResultsPptx', { resultIds: [result.resultId], title: result.title }, 'pre.exported') },
    ] : []))

    // ------------------------------------------------------- Bitable sync admin

    function PreBitableForm({ t, initial, datasources, onDone, onCancel }) {
      const channels = useChannels().filter(c => c.type === 'lark_app')
      const boards = useAsync(() => call('listDashboards'), [])
      const allWidgets = useAsync(async () => {
        const list = boards.value?.dashboards ?? []
        const per = await Promise.all(list.map(b => call('listDashboard', { dashboardId: b.id }).then(ws => ws.map(w => ({ ...w, board: b.name }))).catch(() => [])))
        return per.flat()
      }, [boards.value])
      const [form, setForm] = useState(() => ({
        name: '', channelId: '', appToken: '', tableId: '', mode: 'replace', schedule: { time: '08:00', enabled: false },
        kind: initial?.source?.sql ? 'sql' : 'widget', widgetId: initial?.source?.widgetId ?? '', datasourceId: initial?.source?.datasourceId ?? datasources[0]?.id ?? '', sql: initial?.source?.sql ?? '',
        ...(initial ?? {}),
      }))
      useEffect(() => { if (!form.channelId && channels[0]) setForm(f => ({ ...f, channelId: channels[0].id })) }, [channels.length])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))
      // Paste a Bitable link: …/base/<app_token>?table=<table_id>
      const pasteLink = (e) => {
        const m = String(e.target.value).match(/\/base\/([A-Za-z0-9]+)(?:[^#]*[?&]table=(tbl[A-Za-z0-9]+))?/)
        if (m) { e.preventDefault(); setForm(f => ({ ...f, appToken: m[1], tableId: m[2] ?? f.tableId })) } else set('appToken')(e)
      }
      const save = () => run(async () => {
        setError(null)
        const source = form.kind === 'sql' ? { datasourceId: form.datasourceId, sql: form.sql } : { widgetId: form.widgetId }
        try { await call('saveBitableSync', { id: form.id, name: form.name, channelId: form.channelId, appToken: form.appToken, tableId: form.tableId, mode: form.mode, schedule: form.schedule, source }); onDone() } catch (e) { setError(e) }
      })
      const err = (field) => error?.field === field ? h('span', { className: 'n2s-small', style: { color: 'var(--n2s-err)' } }, error.message) : null
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pre.bt.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pre.bt.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('pre.bt.channel')),
            channels.length ? h('select', { className: 'n2s-select', value: form.channelId, onChange: set('channelId') }, channels.map(c => h('option', { key: c.id, value: c.id }, c.name))) : h('span', { className: 'n2s-small n2s-muted' }, t('pre.bt.noChannel')), err('channelId')),
          h('label', { className: 'n2s-field' }, h('span', null, 'app_token'), h('input', { className: 'n2s-input n2s-mono', value: form.appToken, onChange: pasteLink, placeholder: t('pre.bt.appTokenPh') }), err('appToken')),
          h('label', { className: 'n2s-field' }, h('span', null, 'table_id'), h('input', { className: 'n2s-input n2s-mono', value: form.tableId, onChange: set('tableId'), placeholder: 'tbl…' }), err('tableId')),
          h('div', { className: 'n2s-field full' }, h('span', null, t('pre.bt.source')), h('div', { className: 'n2s-seg' }, ['widget', 'sql'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.kind === v, onClick: () => setForm(f => ({ ...f, kind: v })) }, t(`pre.bt.src.${v}`))))),
          form.kind === 'widget'
            ? h('label', { className: 'n2s-field full' }, h('span', null, t('pre.bt.widget')), h('select', { className: 'n2s-select', value: form.widgetId, onChange: set('widgetId') }, h('option', { value: '' }, '—'), (allWidgets.value ?? []).map(w => h('option', { key: w.id, value: w.id }, `${w.board} · ${w.title}`))), err('source'))
            : h(React.Fragment, null,
              h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
              h('label', { className: 'n2s-field full' }, h('span', null, 'SQL'), h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, value: form.sql, onChange: set('sql'), placeholder: 'SELECT …' }), err('sql'))),
          h('div', { className: 'n2s-field' }, h('span', null, t('pre.bt.mode')), h('div', { className: 'n2s-seg' }, ['replace', 'append'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.mode === v, onClick: () => setForm(f => ({ ...f, mode: v })) }, t(`pre.bt.mode.${v}`)))),
            h('span', { className: 'n2s-faint n2s-small' }, t(`pre.bt.modeHint.${form.mode}`))),
          h('div', { className: 'n2s-field' }, h('span', null, t('pre.bt.schedule')),
            h('div', { className: 'n2s-row' },
              h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.schedule.enabled, onChange: e => setForm(f => ({ ...f, schedule: { ...f.schedule, enabled: e.target.checked } })) }), t('pre.bt.daily')),
              h('input', { className: 'n2s-input', type: 'time', 'aria-label': t('rep.time'), style: { width: 120 }, value: form.schedule.time, disabled: !form.schedule.enabled, onChange: e => setForm(f => ({ ...f, schedule: { ...f.schedule, time: e.target.value } })) })))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('pre.bt.permHint')),
        error && !error.field && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error.message),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function PreBitableSection({ t, datasources = [] }) {
      const list = useAsync(() => call('listBitableSyncs'), [])
      const [editing, setEditing] = useState(null)
      const [running, setRunning] = useState(null)
      const syncs = list.value ?? []
      const runNow = async (s) => {
        if (running) return
        setRunning(s.id)
        try { const r = await call('runBitableSync', { id: s.id }); notify(fmt(t, 'pre.bt.ran', { created: r.created, deleted: r.deleted }), 'ok') } catch (e) { notifyError(e) } finally { setRunning(null); list.reload() }
      }
      return h('div', null,
        h(SectionHead, { title: t('pre.bt.title'), desc: t('pre.bt.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('pre.bt.add'))),
        editing && h(PreBitableForm, { key: editing.id ?? 'new', t, datasources, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !syncs.length && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pre.bt.empty')), h('div', null, t('pre.bt.emptyHint'))),
        syncs.length > 0 && h('div', { className: 'n2s-list2' }, syncs.map(s => h('div', { key: s.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, Icon.table(16)),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, s.name), h('span', { className: 'n2s-badge' }, t(`pre.bt.mode.${s.mode}`)), s.schedule?.enabled && h('span', { className: 'n2s-badge blue' }, fmt(t, 'pre.bt.dailyAt', { time: s.schedule.time }))),
            h('div', { className: 'n2s-list2-sub' }, joinList([s.source?.widgetId ? `${t('pre.bt.src.widget')}${colon('')}${s.sourceLabel ?? '?'}` : `SQL · ${s.sourceLabel ?? ''}`, s.channelName ?? t('pre.bt.channelMissing'), `${s.appToken} / ${s.tableId}`], ' · ')),
            s.lastError && s.lastStatus === 'error' && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, s.lastError)),
          h('div', { className: 'n2s-list2-side' },
            h('span', { className: `n2s-statusdot ${s.lastStatus === 'error' ? 'err' : s.lastStatus === 'ok' ? 'ok' : ''}` }, s.lastStatus === 'ok' ? fmt(t, 'pre.bt.lastOk', { n: s.lastRows ?? 0 }) : s.lastStatus === 'error' ? t('pre.bt.lastErr') : t('pre.bt.never')),
            s.lastRunAt ? h('span', { className: 'n2s-faint n2s-small' }, new Date(s.lastRunAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : null),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: Boolean(running), onClick: () => runNow(s) }, running === s.id ? h('span', { className: 'n2s-spin' }) : null, t('pre.bt.run')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(s) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pre.bt.deleteConfirm', { name: s.name }), danger: true })) { try { await call('deleteBitableSync', { id: s.id }) } catch (e) { notifyError(e) } list.reload() } } },
            ] }))))))
    }

    extend.adminSections.push({ id: 'bitable', label: (t) => t('pre.bt.nav'), icon: () => Icon.table(15), Component: PreBitableSection })
