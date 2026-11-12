    function OverviewGrid({ t, results, pinned }) {
      const [sending, setSending] = useState(false)
      const ok = results.filter(r => !r.error && r.resultId)
      return h('div', null,
        pinned && h('div', { className: 'n2s-notice ok', style: { marginBottom: 10 } }, t('schema.overviewPinned')),
        ok.length > 1 && h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setSending(true) }, t('im.shareAll'))),
        sending && h(SendDialog, { t, initial: { title: `${ok[0].title.split(' · ')[0]} · ${t('ov.suffix')}`, resultIds: ok.map(r => r.resultId) }, onClose: () => setSending(false) }),
        h('div', { className: 'n2s-dash' }, results.map((r, i) => h('div', { key: i, className: 'n2s-card', style: r.error || r.chart?.type === 'kpi' || /趋势|trend/i.test(r.title) ? { gridColumn: '1 / -1' } : undefined },
          r.error
            ? h(React.Fragment, null, h('div', { style: { fontWeight: 500, marginBottom: 6 } }, r.title), h('div', { className: 'n2s-notice err' }, r.error), h('pre', { className: 'n2s-code', style: { marginTop: 6 } }, r.sql))
            : h(ResultView, { result: r, t, compact: true })))))
    }

    const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

    function ReportChannelField({ t, value, onChange }) {
      return h('div', { className: 'n2s-field full' }, h('label', { htmlFor: 'n2s-rep-channel', className: 'n2s-flabel' }, t('rep.push')),
        h(ChannelPicker, { t, id: 'n2s-rep-channel', value, onChange, noneLabel: t('rep.pushNone') }))
    }

    function ReportForm({ t, datasources, initial, defaultDatasourceId, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ title: '', datasourceId: defaultDatasourceId, scope: 'question', question: '', instructions: '', period: 'daily', time: '09:00', weekdays: [1], target: 'new_once', ...(initial ?? {}), ...(initial?.time ? { time: initial.time.slice(0, 5) } : {}) }))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const save = async () => {
        setBusy(true); setError(null)
        try { await call('saveReport', form); onDone() } catch (e) { setError(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.title')), h('input', { className: 'n2s-input', value: form.title, onChange: set('title'), placeholder: t('rep.titlePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')),
            h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, `${d.name} · ${typeLabel(t, d.type)}`)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('rep.scope')),
            h('div', { className: 'n2s-seg' }, ['question', 'dashboard'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.scope === v, onClick: () => setForm(f => ({ ...f, scope: v })) }, t(`rep.scope.${v}`))))),
          form.scope === 'question' && h('label', { className: 'n2s-field full' }, h('span', null, t('rep.question')), h('textarea', { className: 'n2s-textarea', value: form.question, onChange: set('question'), placeholder: t('rep.questionPh') })),
          h('label', { className: 'n2s-field full' }, h('span', null, t('rep.instructions')), h('textarea', { className: 'n2s-textarea', style: { minHeight: 52 }, value: form.instructions, onChange: set('instructions'), placeholder: t('rep.instructionsPh') })),
          h('div', { className: 'n2s-field' }, h('span', null, t('rep.period')),
            h('div', { className: 'n2s-seg' }, ['daily', 'weekly'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.period === v, onClick: () => setForm(f => ({ ...f, period: v })) }, t(`rep.period.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
          form.period === 'weekly' && h('div', { className: 'n2s-field full' }, h('span', null, t('rep.weekdays')),
            h('div', { className: 'n2s-row' }, WEEKDAYS.map(d => h('label', { key: d, className: 'n2s-check' },
              h('input', { type: 'checkbox', checked: form.weekdays.includes(d), onChange: e => setForm(f => ({ ...f, weekdays: e.target.checked ? [...f.weekdays, d].sort() : f.weekdays.filter(x => x !== d) })) }), t(`rep.wd.${d}`))))),
          h(ReportChannelField, { t, value: form.channelId ?? '', onChange: (v) => setForm(f => ({ ...f, channelId: v || undefined })) }),
          h('div', { className: 'n2s-field full' }, h('span', null, t('rep.target')),
            h('div', { className: 'n2s-seg' }, ['new_once', 'new'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.target === v, disabled: Boolean(initial?.id) && initial.target !== v, onClick: () => setForm(f => ({ ...f, target: v })) }, t(`rep.target.${v}`)))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy || !form.title.trim() || (form.scope === 'question' && !form.question.trim()), onClick: save }, t('ds.save'))))
    }

    function ReportsTab({ t, ds, datasources, onOpenSession, onOpenSchedules }) {
      const list = useAsync(() => call('listReports'), [])
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState(null)
      const act = async (fn, okText) => {
        setNotice(null)
        try { await fn(); if (okText) setNotice({ ok: true, text: okText }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        list.reload()
      }
      const reports = list.value ?? []
      const statusDot = (st) => h('span', { className: `n2s-statusdot ${st === 'active' ? 'ok' : st === 'missing' ? 'err' : 'warn'}` }, t(`rep.status.${st}`))
      return h('div', null,
        h(SectionHead, { title: t('tab.reports'), desc: t('rep.hint') },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onOpenSchedules }, t('rep.openSchedules'), Icon.external(13)),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, '+ ', t('rep.add'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, style: { marginBottom: 10 }, role: 'status' }, notice.text),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        editing && h(ReportForm, { key: editing.id ?? 'new', t, datasources, initial: editing.id ? editing : null, defaultDatasourceId: ds?.id, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        !list.loading && reports.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('rep.empty')), h('div', null, t('rep.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, t('rep.add'))),
        reports.length > 0 && h('div', { className: 'n2s-list2', style: { marginTop: editing ? 12 : 0 } }, reports.map(r => h('div', { key: r.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, svg(16, [h('circle', { key: 1, cx: 8, cy: 8, r: 5.5 }), h('path', { key: 2, d: 'M8 5v3.2l2 1.3' })])),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, r.title), r.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), r.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${t(`rep.period.${r.period}`)} ${r.period === 'weekly' ? r.weekdays.map(d => t(`rep.wd.${d}`)).join(uiLang === 'zh' ? '、' : ', ') + ' ' : ''}${r.time.slice(0, 5)} · ${r.datasourceName} · ${r.scope === 'question' ? r.question : t('rep.scope.dashboard')}`)),
          h('div', { className: 'n2s-list2-side' },
            statusDot(r.status),
            h('span', { className: 'n2s-faint n2s-small' }, r.scheduledAt && r.status === 'active' ? `${t('rep.next')} ${new Date(r.scheduledAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '')),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: r.status === 'missing', onClick: () => act(() => call('runReportNow', { id: r.id }), t('rep.started')) }, t('rep.runNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              r.lastDelivery && { label: t('rep.openLast'), icon: Icon.external(14), onClick: () => onOpenSession(r.lastDelivery.targetSessionId) },
              r.status !== 'missing' && { label: r.status === 'active' ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('setReportActive', { id: r.id, active: r.status !== 'active' })) },
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(r) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'rep.deleteConfirm', { title: r.title }), danger: true })) act(() => call('deleteReport', { id: r.id })) } },
            ] }))))))
    }
