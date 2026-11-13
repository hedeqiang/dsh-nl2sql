    // ------------------------------------------------------------ milestones (破纪录播报)
    // Admin section 'milestones': rules (metrics, kinds of records, push time and channel), a preview
    // of yesterday's check, and a 30-day backtest showing what would have been announced.

    const MS_KINDS = ['record', 'month', 'streak', 'total']

    function MilestoneForm({ t, initial, ds, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id ?? datasources[0]?.id ?? '', metrics: [], kinds: { record: true, month: true, streak: true, total: true }, direction: 'up', streakDays: 5, totalStep: '', channelId: '', time: '09:30', mentionAll: false, language: uiLang, enabled: true, ...(initial ?? {}) }))
      const metrics = useMetrics(form.datasourceId)
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const toggle = (name) => setForm(f => ({ ...f, metrics: f.metrics.includes(name) ? f.metrics.filter(x => x !== name) : [...f.metrics, name] }))
      const save = () => run(async () => {
        setError(null)
        try {
          await call('saveMilestone', { id: form.id, name: form.name, datasourceId: form.datasourceId, metrics: form.metrics, kinds: form.kinds, direction: form.direction, streakDays: Number(form.streakDays), totalStep: Number(form.totalStep || 0), channelId: form.channelId || null, time: form.time, mentionAll: form.mentionAll, language: form.language, enabled: form.enabled })
          onDone()
        } catch (e) { setError(e.message) }
      })
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('ms.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('ms.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: e => setForm(f => ({ ...f, datasourceId: e.target.value, metrics: [] })) }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('ms.metrics')),
            metrics.length ? h('div', { className: 'n2s-chips' }, metrics.map(m => h('button', { key: m.id, type: 'button', className: 'n2s-chip', 'aria-pressed': form.metrics.includes(m.name), disabled: !m.timeColumn, title: m.timeColumn ? undefined : t('ms.noTime'), onClick: () => toggle(m.name) }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics'))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('ms.kinds')),
            h('div', { className: 'n2s-ms-kinds' }, MS_KINDS.map(k => h('label', { key: k, className: 'n2s-ms-kind' },
              h('input', { type: 'checkbox', checked: form.kinds[k] !== false, onChange: e => setForm(f => ({ ...f, kinds: { ...f.kinds, [k]: e.target.checked } })) }),
              h('span', null, h('span', { className: 'n2s-ms-kind-title' }, t(`ms.kind.${k}`)), h('span', { className: 'n2s-faint n2s-small' }, t(`ms.kindHint.${k}`))))))),
          h('div', { className: 'n2s-field' }, h('span', null, t('ms.direction')), h('div', { className: 'n2s-seg' }, ['up', 'down'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.direction === v, onClick: () => setForm(f => ({ ...f, direction: v })) }, t(`ms.dir.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('ms.streakDays')), h('input', { className: 'n2s-input', type: 'number', min: 2, max: 60, value: form.streakDays, disabled: form.kinds.streak === false, onChange: set('streakDays') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ms.totalStep')), h('input', { className: 'n2s-input', type: 'number', min: 0, value: form.totalStep || '', placeholder: t('ms.totalStepPh'), disabled: form.kinds.total === false || form.direction === 'down', onChange: set('totalStep') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-ms-ch', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-ms-ch', value: form.channelId ?? '', noneLabel: t('ms.noChannel'), onChange: (v) => setForm(f => ({ ...f, channelId: v })) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.language')), h('select', { className: 'n2s-select', value: form.language, onChange: set('language') }, h('option', { value: 'zh' }, '中文'), h('option', { value: 'en' }, 'English'))),
          h('div', { className: 'n2s-field' }, h('span', null, t('ms.mention')), h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', checked: Boolean(form.mentionAll), onChange: e => setForm(f => ({ ...f, mentionAll: e.target.checked })) }), t('ms.mentionAll')))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('ms.hint')),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function MilestonePreview({ t, view }) {
      if (view.busy) return h('div', { className: 'n2s-notice', style: { marginTop: 10 } }, h('span', { className: 'n2s-spin' }), ' ', t(view.mode === 'backtest' ? 'ms.backtesting' : 'ms.previewing'))
      if (view.error) return h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, view.error)
      if (view.mode === 'backtest') {
        const byDay = new Map()
        for (const e of view.events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
        return h('div', { className: 'n2s-pro-preview' },
          h('div', { style: { fontWeight: 500, marginBottom: 4 } }, fmt(t, 'ms.btTitle', { days: view.days })),
          h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 8 } }, view.events.length ? fmt(t, 'ms.btSummary', { n: view.daysWithEvents, days: view.days, events: view.events.length }) : t('ms.btNone')),
          (view.errors ?? []).map(e => h('div', { key: e.metric, className: 'n2s-notice err', style: { marginBottom: 6 } }, `${e.metric}：${e.error}`)),
          byDay.size > 0 && h('div', { className: 'n2s-ms-bt' }, [...byDay].map(([day, list]) => h('div', { key: day, className: 'n2s-ms-bt-day' },
            h('div', { className: 'n2s-ms-bt-date' }, day),
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } }, list.map((e, i) => h(MdPreview, { key: i, text: e.text })))))))
      }
      return h('div', { className: 'n2s-pro-preview' },
        h('div', { style: { fontWeight: 500, marginBottom: 6 } }, view.title),
        h(MdPreview, { text: view.text }),
        !view.events?.length && h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('ms.quietHint')),
        (view.results ?? []).length > 0 && h('div', { className: 'n2s-pro-preview-charts' }, view.results.map(r => h(ResultView, { key: r.resultId, result: r, t, compact: true, hideSql: true, onPinned: { hidden: true } }))))
    }

    function MilestonesSection({ t, ds, datasources }) {
      const list = useAsync(() => call('listMilestones'), [])
      const [editing, setEditing] = useState(null)
      const [view, setView] = useState(null)
      const rules = list.value ?? []
      const preview = async (r) => {
        setView({ id: r.id, mode: 'preview', busy: true })
        try { setView({ ...(await call('runMilestone', { id: r.id })), id: r.id, mode: 'preview' }) } catch (e) { setView({ id: r.id, mode: 'preview', error: e.message }) }
      }
      const backtest = async (r) => {
        setView({ id: r.id, mode: 'backtest', busy: true })
        try { setView({ ...(await call('backtestMilestone', { id: r.id, days: 30 })), id: r.id, mode: 'backtest' }) } catch (e) { setView({ id: r.id, mode: 'backtest', error: e.message }) }
      }
      const act = async (fn, ok) => { try { const v = await fn(); if (ok) notify(typeof ok === 'function' ? ok(v) : ok, 'ok') } catch (e) { notifyError(e) } list.reload() }
      const kindsText = (r) => joinList(MS_KINDS.filter(k => r.kinds?.[k] !== false).map(k => t(`ms.kind.${k}`)))
      return h('div', null,
        h(SectionHead, { title: t('ms.title'), desc: t('ms.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, '+ ', t('ms.add'))),
        editing && h(MilestoneForm, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && rules.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('ms.empty')), h('div', null, t('ms.emptyHint'))),
        rules.length > 0 && h('div', { className: 'n2s-list2' }, rules.map(r => h(React.Fragment, { key: r.id },
          h('div', { className: 'n2s-list2-row' },
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, r.name), !r.enabled && h('span', { className: 'n2s-badge' }, t('rep.status.paused')), r.channelName ? h('span', { className: 'n2s-badge' }, Icon.send(11), r.channelName) : h('span', { className: 'n2s-badge warn' }, t('ms.noChannelBadge'))),
              h('div', { className: 'n2s-list2-sub' }, joinList([joinList(r.metrics), kindsText(r), fmt(t, 'pro.dg.dailyAt', { time: r.time }), r.datasourceName], ' · ')),
              r.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, r.lastError)),
            h('div', { className: 'n2s-list2-side' }, r.lastRunAt
              ? h('span', { className: `n2s-statusdot ${r.lastStatus === 'ok' ? 'ok' : 'err'}`, title: new Date(r.lastRunAt).toLocaleString(uiLocale()) }, r.lastStatus === 'ok' ? (r.lastEvents ? fmt(t, 'ms.lastEvents', { n: r.lastEvents }) : t('ms.lastQuiet')) : t('pro.st.error'))
              : h('span', { className: 'n2s-faint n2s-small' }, t('al.never'))),
            h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
              h('button', { type: 'button', className: 'n2s-btn small', disabled: view?.id === r.id && view.busy, onClick: () => preview(r) }, t('ms.preview')),
              h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: view?.id === r.id && view.busy, onClick: () => backtest(r) }, t('ms.backtest')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('ms.sendNow'), icon: Icon.send(14), disabled: !r.channelId, onClick: () => act(() => call('runMilestone', { id: r.id, send: true }), (v) => (v?.pushed ? t('pro.sent') : t('ms.nothingToSend'))) },
                { label: r.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('saveMilestone', { id: r.id, enabled: !r.enabled })) },
                { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing({ ...r, channelId: r.channelId ?? '', totalStep: r.totalStep || '' }) },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pro.deleteConfirm', { name: r.name }), danger: true })) act(() => call('deleteMilestone', { id: r.id })) } },
              ] }))),
          view?.id === r.id && h('div', { style: { padding: '0 12px 12px' } }, h(MilestonePreview, { t, view }), !view.busy && h('button', { type: 'button', className: 'n2s-btn small ghost', style: { marginTop: 6 }, onClick: () => setView(null) }, t('pro.close')))))))
    }
    extend.adminSections.push({ id: 'milestones', group: 'insight', label: (t) => t('ms.title'), icon: () => svg(15, [h('path', { key: 1, d: 'M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H2.5a2 2 0 0 0 2.6 2.4M11 3.5h2.5a2 2 0 0 1-2.6 2.4M8 8.5v3M5.5 13.5h5M6.5 11.5h3' })]), Component: MilestonesSection })
