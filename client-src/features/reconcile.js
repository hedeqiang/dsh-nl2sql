    // ------------------------------------------------------------ reconciliation (对账)
    // Admin section 'reconcile': saved jobs (two queries, key mapping, compare columns,
    // schedule, channel), dry run with summary + difference tables (ResultView), run history.
    // Also the conversation view of the nl2sql_reconcile agent tool.

    const rcPct = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(r === 1 || r === 0 ? 0 : 2)}%`)
    const rcTime = (at) => new Date(at).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    function rcBlank(ds) {
      return {
        name: '', left: { datasourceId: ds?.id ?? '', sql: '' }, right: { datasourceId: ds?.id ?? '', sql: '' },
        keys: [{ left: '', right: '' }], compare: [], options: { trim: true, ignoreCase: false },
        schedule: { time: '09:00', enabled: false }, channelId: '', notifyOn: 'diff',
      }
    }

    /** Definition as sent to the server: empty rows dropped, numbers parsed. */
    function rcPayload(form) {
      return {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, left: form.left, right: form.right,
        keys: form.keys.filter(k => k.left.trim()).map(k => ({ left: k.left.trim(), right: (k.right || k.left).trim() })),
        compare: form.compare.filter(c => c.left.trim()).map(c => ({ left: c.left.trim(), right: (c.right || c.left).trim(), tolerance: c.tolerance === '' || c.tolerance === undefined ? 0 : Number(c.tolerance), relative: Boolean(c.relative) })),
        options: form.options, schedule: form.schedule, channelId: form.channelId || null, notifyOn: form.notifyOn,
      }
    }

    /** Summary numbers + warnings + the four detail tables (ResultView each). */
    function ReconcileOutcome({ t, out }) {
      const parts = ['summary', 'mismatches', 'onlyLeft', 'onlyRight']
      const results = out.results ?? []
      const firstDiff = results.findIndex((r, i) => i > 0 && r.rowCount > 0)
      const [tab, setTab] = useState(firstDiff > 0 ? firstDiff : 0)
      const s = out.summary
      if (!s) return null
      const lname = out.left?.label ?? out.left?.datasourceName
      const rname = out.right?.label ?? out.right?.datasourceName
      const stat = (label, value, bad) => h('div', { className: `n2s-rc-stat${bad ? ' bad' : ''}` }, h('div', { className: 'n2s-rc-stat-v' }, value), h('div', { className: 'n2s-rc-stat-l' }, label))
      const label = (i) => (i === 0 ? t('rc.tab.summary') : i === 1 ? t('rc.tab.mismatches') : i === 2 ? fmt(t, 'rc.tab.only', { side: lname }) : fmt(t, 'rc.tab.only', { side: rname }))
      const cur = results[tab]
      return h('div', { className: 'n2s-rc-out' },
        h('div', { className: `n2s-notice ${s.hasDiff ? 'warn' : 'ok'}`, role: 'status' }, s.hasDiff ? fmt(t, 'rc.hasDiff', { rate: rcPct(s.matchRate) }) : fmt(t, 'rc.noDiff', { rate: rcPct(s.matchRate) })),
        h('div', { className: 'n2s-rc-stats' },
          stat(t('rc.matchRate'), rcPct(s.matchRate), s.matchRate < 1),
          stat(fmt(t, 'rc.rowsOf', { side: lname }), `${formatNumber(s.leftRows)}${s.truncated?.left ? '+' : ''}`),
          stat(fmt(t, 'rc.rowsOf', { side: rname }), `${formatNumber(s.rightRows)}${s.truncated?.right ? '+' : ''}`),
          stat(t('rc.matched'), formatNumber(s.matched)),
          stat(fmt(t, 'rc.onlyIn', { side: lname }), formatNumber(s.onlyLeft), s.onlyLeft > 0),
          stat(fmt(t, 'rc.onlyIn', { side: rname }), formatNumber(s.onlyRight), s.onlyRight > 0),
          s.columns?.length > 0 && stat(t('rc.mismatched'), formatNumber(s.mismatchedRows), s.mismatchedRows > 0)),
        s.columns?.length > 0 && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('rc.col'), t('rc.mismatchRows'), fmt(t, 'rc.totalOf', { side: lname }), fmt(t, 'rc.totalOf', { side: rname }), t('rc.diff')].map((x, i) => h('th', { key: i }, x)))),
          h('tbody', null, s.columns.map((c, i) => h('tr', { key: i },
            h('td', null, c.label, c.tolerance ? h('span', { className: 'n2s-faint n2s-small' }, ` ±${c.relative ? `${+(c.tolerance * 100).toFixed(4)}%` : c.tolerance}`) : null),
            h('td', { className: c.mismatches ? 'n2s-rc-bad' : undefined }, formatNumber(c.mismatches)),
            h('td', null, c.leftTotal === undefined ? '—' : formatNumber(c.leftTotal)),
            h('td', null, c.rightTotal === undefined ? '—' : formatNumber(c.rightTotal)),
            h('td', { className: c.diff ? 'n2s-rc-bad' : undefined }, c.diff === undefined ? '—' : formatNumber(c.diff))))))),
        (out.warnings ?? []).map((w, i) => h('div', { key: `w${i}`, className: 'n2s-notice warn', style: { marginTop: 8 } }, w)),
        results.length > 0 && h('div', { className: 'n2s-seg', role: 'tablist', style: { marginTop: 12 } }, results.map((r, i) => h('button', { key: parts[i] ?? i, type: 'button', role: 'tab', 'aria-pressed': tab === i, 'aria-selected': tab === i, onClick: () => setTab(i) }, label(i), i > 0 ? ` (${formatNumber(r.rowCount)}${r.truncated ? '+' : ''})` : ''))),
        cur && h('div', { style: { marginTop: 8 } }, cur.rows ? h(ResultView, { key: cur.resultId, t, result: cur, compact: true, onPinned: { hidden: true } }) : h('div', { className: 'n2s-faint' }, t('result.expired'))))
    }

    function RcSidePane({ t, title, side, datasources, onChange }) {
      return h('div', { className: 'n2s-rc-pane' },
        h('div', { className: 'n2s-rc-pane-title' }, title),
        h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')),
          h('select', { className: 'n2s-select', value: side.datasourceId, onChange: e => onChange({ ...side, datasourceId: e.target.value }) },
            h('option', { value: '' }, '—'), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
        h('label', { className: 'n2s-field' }, h('span', null, 'SQL'),
          h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, rows: 6, value: side.sql, onChange: e => onChange({ ...side, sql: e.target.value }), placeholder: 'SELECT order_no, amount FROM orders WHERE DATE(created_at) = CURDATE() - INTERVAL 1 DAY' })))
    }

    function ReconcileEditor({ t, initial, datasources, ds, onDone, onCancel }) {
      const [form, setForm] = useState(() => {
        const b = rcBlank(ds)
        if (!initial) return b
        return { ...b, ...initial, channelId: initial.channelId ?? '', keys: initial.keys?.length ? initial.keys : b.keys, compare: (initial.compare ?? []).map(c => ({ ...c, tolerance: c.tolerance ?? 0 })), options: { ...b.options, ...(initial.options ?? {}) }, schedule: { ...b.schedule, ...(initial.schedule ?? {}) } }
      })
      const [error, setError] = useState(null)
      const [dry, setDry] = useState(null)
      const [busy, runBusy] = useBusy()
      const patch = (p) => setForm(f => ({ ...f, ...p }))
      const setList = (key, i, p) => setForm(f => ({ ...f, [key]: f[key].map((x, j) => (j === i ? { ...x, ...p } : x)) }))
      const addRow = (key, row) => setForm(f => ({ ...f, [key]: [...f[key], row] }))
      const delRow = (key, i) => setForm(f => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }))
      const save = () => runBusy(async () => {
        setError(null)
        try { await call('saveReconcile', rcPayload(form)); notify(t('rc.saved'), 'ok'); onDone() } catch (e) { setError(e.message) }
      })
      const dryRun = async () => {
        if (dry?.busy) return
        setDry({ busy: true })
        try { setDry({ out: await call('runReconcile', { definition: { ...rcPayload(form), name: form.name || t('rc.dryRun') } }) }) } catch (e) { setDry({ error: e.message }) }
      }
      const colInput = (value, onChange, ph, label) => h('input', { className: 'n2s-input', value, placeholder: ph, 'aria-label': label, onChange: e => onChange(e.target.value) })
      return h('div', { className: 'n2s-card n2s-rc-editor', style: { marginBottom: 12 } },
        h('label', { className: 'n2s-field' }, h('span', null, t('rc.name')), h('input', { className: 'n2s-input', value: form.name, onChange: e => patch({ name: e.target.value }), placeholder: t('rc.namePh') })),
        h('div', { className: 'n2s-rc-panes' },
          h(RcSidePane, { t, title: t('rc.left'), side: form.left, datasources, onChange: (left) => patch({ left }) }),
          h(RcSidePane, { t, title: t('rc.right'), side: form.right, datasources, onChange: (right) => patch({ right }) })),
        h('div', { className: 'n2s-field full' }, h('span', null, t('rc.keys')), h('span', { className: 'n2s-faint n2s-small' }, t('rc.keysHint')),
          form.keys.map((k, i) => h('div', { key: i, className: 'n2s-rc-maprow' },
            colInput(k.left, v => setList('keys', i, { left: v }), t('rc.leftCol'), `${t('rc.keys')} ${i + 1} ${t('rc.left')}`),
            h('span', { className: 'n2s-muted', 'aria-hidden': true }, '⇄'),
            colInput(k.right, v => setList('keys', i, { right: v }), k.left || t('rc.rightCol'), `${t('rc.keys')} ${i + 1} ${t('rc.right')}`),
            h('button', { type: 'button', className: 'n2s-iconbtn', disabled: form.keys.length <= 1, title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => delRow('keys', i) }, Icon.trash(14)))),
          h('div', null, h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => addRow('keys', { left: '', right: '' }) }, '+ ', t('rc.addKey')))),
        h('div', { className: 'n2s-field full' }, h('span', null, t('rc.compare')), h('span', { className: 'n2s-faint n2s-small' }, t('rc.compareHint')),
          form.compare.map((c, i) => h('div', { key: i, className: 'n2s-rc-maprow' },
            colInput(c.left, v => setList('compare', i, { left: v }), t('rc.leftCol'), `${t('rc.compare')} ${i + 1} ${t('rc.left')}`),
            h('span', { className: 'n2s-muted', 'aria-hidden': true }, '⇄'),
            colInput(c.right, v => setList('compare', i, { right: v }), c.left || t('rc.rightCol'), `${t('rc.compare')} ${i + 1} ${t('rc.right')}`),
            h('input', { className: 'n2s-input n2s-rc-tol', type: 'number', min: 0, step: 'any', value: c.tolerance, 'aria-label': t('rc.tolerance'), title: t('rc.tolerance'), placeholder: t('rc.tolerance'), onChange: e => setList('compare', i, { tolerance: e.target.value }) }),
            h('select', { className: 'n2s-select inline', value: c.relative ? 'rel' : 'abs', 'aria-label': t('rc.tolMode'), onChange: e => setList('compare', i, { relative: e.target.value === 'rel' }) },
              h('option', { value: 'abs' }, t('rc.tolAbs')), h('option', { value: 'rel' }, t('rc.tolRel'))),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => delRow('compare', i) }, Icon.trash(14)))),
          h('div', null, h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => addRow('compare', { left: '', right: '', tolerance: 0, relative: false }) }, '+ ', t('rc.addCompare')))),
        h('div', { className: 'n2s-row', style: { gap: 16, marginTop: 4 } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.options.trim, onChange: e => patch({ options: { ...form.options, trim: e.target.checked } }) }), t('rc.trim')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.options.ignoreCase, onChange: e => patch({ options: { ...form.options, ignoreCase: e.target.checked } }) }), t('rc.ignoreCase'))),
        h('div', { className: 'n2s-form', style: { marginTop: 10 } },
          h('label', { className: 'n2s-check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: form.schedule.enabled, onChange: e => patch({ schedule: { ...form.schedule, enabled: e.target.checked } }) }), t('rc.daily')),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.schedule.time, disabled: !form.schedule.enabled, onChange: e => patch({ schedule: { ...form.schedule, time: e.target.value } }) })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-rc-channel', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-rc-channel', value: form.channelId ?? '', noneLabel: t('rc.noPush'), onChange: (v) => patch({ channelId: v }) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('rc.notifyOn')), h('select', { className: 'n2s-select', value: form.notifyOn, disabled: !form.channelId, onChange: e => patch({ notifyOn: e.target.value }) },
            h('option', { value: 'diff' }, t('rc.notify.diff')), h('option', { value: 'always' }, t('rc.notify.always'))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: dry?.busy, onClick: dryRun }, dry?.busy ? h('span', { className: 'n2s-spin' }) : null, t('rc.dryRun')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))),
        dry?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, dry.error),
        dry?.out && h('div', { className: 'n2s-rc-dry' }, h('div', { className: 'n2s-rc-pane-title' }, t('rc.dryResult')), h(ReconcileOutcome, { t, out: dry.out })))
    }

    function RcStatus({ t, run }) {
      if (!run) return h('span', { className: 'n2s-statusdot' }, t('rc.never'))
      if (run.status === 'error') return h('span', { className: 'n2s-statusdot err', title: run.error }, t('rc.status.error'))
      return h('span', { className: `n2s-statusdot ${run.status === 'diff' ? 'warn' : 'ok'}` }, run.status === 'diff' ? t('rc.status.diff') : t('rc.status.ok'))
    }

    function rcDiffText(t, run) {
      if (!run || run.status === 'error') return ''
      const s = run.summary ?? run
      return joinList([
        `${t('rc.matchRate')} ${rcPct(s.matchRate)}`,
        s.onlyLeft ? fmt(t, 'rc.short.onlyLeft', { n: s.onlyLeft }) : null,
        s.onlyRight ? fmt(t, 'rc.short.onlyRight', { n: s.onlyRight }) : null,
        s.mismatchedRows ? fmt(t, 'rc.short.mismatch', { n: s.mismatchedRows }) : null,
        s.complete === false ? t('rc.incomplete') : null,
      ], ' · ')
    }

    function ReconcileSection({ t, ds, datasources }) {
      const list = useAsync(() => call('listReconciles'), [])
      const [editing, setEditing] = useState(null)
      const [historyOf, setHistoryOf] = useState(null)
      const [shown, setShown] = useState(null)
      const runs = useAsync(() => call('reconcileRuns', { id: historyOf ?? undefined, limit: 50 }), [historyOf, list.value])
      const [running, setRunning] = useState(null)
      const jobs = list.value ?? []
      const runNow = async (job) => {
        if (running) return
        setRunning(job.id)
        try {
          const out = await call('runReconcile', { id: job.id })
          if (out.ok === false) notify(out.error, 'err')
          else { notify(`${out.status === 'diff' ? '⚠️ ' : '✓ '}${rcDiffText(t, out)}${out.pushed ? ` · ${t('rc.pushed')}` : ''}`, out.status === 'diff' ? 'info' : 'ok'); setShown(out) }
        } catch (e) { notifyError(e) } finally { setRunning(null); list.reload() }
      }
      const showRun = async (r) => {
        if (!r.resultIds?.length) return setShown({ ...r, results: [] })
        const results = await Promise.all(r.resultIds.map(id => call('getResult', { resultId: id }).catch(() => null)))
        setShown({ ...r, results: results.map((x, i) => x ?? { resultId: r.resultIds[i], title: '', rowCount: 0 }) })
      }
      return h('div', { className: 'n2s-rc' },
        h(SectionHead, { title: t('rc.title'), desc: t('rc.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => { setShown(null); setEditing({}) } }, '+ ', t('rc.add'))),
        editing && h(ReconcileEditor, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !list.error && jobs.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('rc.empty')), h('div', null, t('rc.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, t('rc.add'))),
        jobs.length > 0 && h('div', { className: 'n2s-list2' }, jobs.map(j => h('div', { key: j.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, '⇄'),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, j.name),
              j.schedule?.enabled ? h('span', { className: 'n2s-badge' }, fmt(t, 'rc.dailyAt', { time: j.schedule.time })) : h('span', { className: 'n2s-badge' }, t('rc.manual')),
              j.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), j.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${j.leftName} ⇄ ${j.rightName} · ${colon(t('rc.keys'))}${joinList(j.keys.map(k => (k.left === k.right ? k.left : `${k.left}/${k.right}`)))}`),
            j.lastRun && h('div', { className: 'n2s-list2-sub' }, `${rcTime(j.lastRun.at)} · `, j.lastRun.status === 'error' ? h('span', { style: { color: 'var(--n2s-err)' } }, j.lastRun.error) : rcDiffText(t, j.lastRun))),
          h('div', { className: 'n2s-list2-side' }, h(RcStatus, { t, run: j.lastRun })),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: Boolean(running), onClick: () => runNow(j) }, running === j.id ? h('span', { className: 'n2s-spin' }) : null, t('rc.runNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => { setShown(null); setEditing(j) } },
              { label: t('rc.history'), icon: Icon.table(14), onClick: () => setHistoryOf(j.id) },
              { label: j.schedule?.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: async () => { try { await call('saveReconcile', { id: j.id, schedule: { ...j.schedule, enabled: !j.schedule?.enabled } }) } catch (e) { notifyError(e) } list.reload() } },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'rc.deleteConfirm', { name: j.name }), danger: true })) { try { await call('deleteReconcile', { id: j.id }) } catch (e) { notifyError(e) } list.reload() } } },
            ] }))))),
        shown && h('div', { className: 'n2s-section' },
          h('div', { className: 'n2s-row' }, h('h2', { className: 'n2s-grow' }, fmt(t, 'rc.runOf', { name: shown.title ?? shown.name ?? '' }), shown.at ? h('span', { className: 'n2s-faint n2s-small' }, ` · ${rcTime(shown.at)}`) : null),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('rc.close'), 'aria-label': t('rc.close'), onClick: () => setShown(null) }, Icon.close(14))),
          shown.error ? h('div', { className: 'n2s-notice err' }, shown.error) : h(ReconcileOutcome, { key: shown.runId ?? shown.id ?? shown.at, t, out: shown })),
        (runs.value ?? []).length > 0 && h('div', { className: 'n2s-section' },
          h('div', { className: 'n2s-row' }, h('h2', { className: 'n2s-grow' }, historyOf ? fmt(t, 'rc.historyOf', { name: jobs.find(j => j.id === historyOf)?.name ?? '' }) : t('rc.history')),
            historyOf && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setHistoryOf(null) }, t('rc.allRuns'))),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-rc-runs' },
            h('thead', null, h('tr', null, [t('im.col.time'), t('rc.name'), t('im.col.status'), t('rc.detail'), t('rc.push')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, runs.value.map(r => h('tr', { key: r.id, className: 'n2s-rc-run', tabIndex: 0, onClick: () => showRun(r), onKeyDown: (e) => { if (e.key === 'Enter') showRun(r) } },
              h('td', { className: 'n2s-muted' }, rcTime(r.at)),
              h('td', null, r.name, r.source === 'schedule' ? h('span', { className: 'n2s-faint n2s-small' }, ` · ${t('rc.scheduled')}`) : null),
              h('td', null, h(RcStatus, { t, run: r })),
              h('td', { style: { whiteSpace: 'normal' } }, r.status === 'error' ? r.error : rcDiffText(t, r)),
              h('td', null, r.pushed ? h('span', { className: 'n2s-statusdot ok' }, t('im.sentOk')) : r.pushError ? h('span', { className: 'n2s-statusdot err', title: r.pushError }, t('im.lastFailed')) : h('span', { className: 'n2s-faint' }, '—')))))))))
    }

    extend.adminSections.push({ id: 'reconcile', label: (t) => t('rc.title'), icon: () => svg(15, [h('path', { key: 1, d: 'M2.5 5h10M10 2.5 12.5 5 10 7.5M13.5 11h-10M6 8.5 3.5 11 6 13.5' })]), Component: ReconcileSection })

    /** Conversation view of nl2sql_reconcile: summary + difference tables. */
    function makeReconcileToolView(ctx) {
      return function Nl2SqlReconcileView(props) {
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
          Promise.all(meta.results.map(r => call('getResult', { resultId: r.resultId }).then(full => full ?? { ...r, rows: null }).catch(() => ({ ...r, rows: null }))))
            .then(list => alive && setResults(list))
          return () => { alive = false }
        }, [settled, meta])
        const title = args.title || t('rc.tool')
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('rc.toolRunning')), h('span', null, title)))
        if (block.isError) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-badge err' }, t('tool.failed')), h('span', null, title)), h('div', { className: 'n2s-notice err', style: { marginTop: 8 } }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { style: { fontWeight: 500 } }, meta?.title ?? title), meta?.left && h('span', { className: 'n2s-badge' }, `${meta.left.datasourceName} ⇄ ${meta.right.datasourceName}`)),
          !meta?.summary ? null : !results ? h('span', { className: 'n2s-spin n2s-muted' }) : h(ReconcileOutcome, { t, out: { ...meta, results } }))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_reconcile', make: makeReconcileToolView })
