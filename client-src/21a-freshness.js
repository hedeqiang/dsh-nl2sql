    // ------------------------------------------------------------ data freshness + quality (health)
    // - resultPanels: a warning bar under results whose referenced tables are stale
    //   (server resolves the tables with policy.js referencedTables via freshnessFor({ sql })).
    // - schemaPanels: tables with lag (green / amber / red) and a refresh button.
    // - adminSections 'health': freshness table with per-table thresholds, quality patrol
    //   results, run now, settings (channels, thresholds, schedule).
    // - toolViews: conversation view of the nl2sql_freshness agent tool.

    /** Shared freshness cache: key → { at, promise, value }; bumping `rev` re-renders subscribers. */
    const fqCache = (() => {
      let rev = 0
      const map = new Map()
      const subs = new Set()
      const TTL = 5 * 60000
      return {
        get(datasourceId, sql) {
          const key = `${datasourceId}\u0000${sql ?? ''}`
          const hit = map.get(key)
          if (hit && Date.now() - hit.at < TTL) return hit.promise
          const promise = call('freshnessFor', { datasourceId, ...(sql ? { sql } : {}) })
          map.set(key, { at: Date.now(), promise })
          promise.catch(() => map.delete(key))
          return promise
        },
        async refresh(datasourceId) {
          const v = await call('freshnessFor', { datasourceId, refresh: true })
          for (const k of [...map.keys()]) if (k.startsWith(`${datasourceId}\u0000`)) map.delete(k)
          map.set(`${datasourceId}\u0000`, { at: Date.now(), promise: Promise.resolve(v) })
          rev++
          for (const f of subs) f()
          return v
        },
        subscribe(f) { subs.add(f); return () => subs.delete(f) },
        rev: () => rev,
      }
    })()

    const fqStatusClass = { ok: 'ok', warn: 'warn', stale: 'err', error: 'err', empty: 'off', off: 'off', unknown: 'off' }
    const fqPad = (n) => String(n).padStart(2, '0')

    function fqLag(t, min) {
      if (min === null || min === undefined || !Number.isFinite(min)) return '—'
      const m = Math.max(0, Math.round(min))
      if (m < 60) return fmt(t, 'fq.lagMin', { n: m })
      if (m < 48 * 60) return fmt(t, 'fq.lagHour', { n: Math.round(m / 60) })
      return fmt(t, 'fq.lagDay', { n: Math.round(m / 1440) })
    }

    /** 「昨天 17:55」 / "yesterday 17:55" relative to now. */
    function fqWhen(t, ms) {
      if (!Number.isFinite(ms)) return '—'
      const d = new Date(ms)
      const now = new Date()
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diff = Math.round((day(now) - day(d)) / 86400000)
      const hm = `${fqPad(d.getHours())}:${fqPad(d.getMinutes())}`
      if (diff === 0) return fmt(t, 'fq.today', { time: hm })
      if (diff === 1) return fmt(t, 'fq.yesterday', { time: hm })
      return `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}-`}${fqPad(d.getMonth() + 1)}-${fqPad(d.getDate())} ${hm}`
    }

    const fqTime = (at) => (at ? new Date(at).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

    function useFqRev() {
      return useSyncExternalStore(fqCache.subscribe, fqCache.rev, fqCache.rev)
    }

    // ---- result warning bar

    function FreshnessResultPanel({ t, result }) {
      const rev = useFqRev()
      const dsId = result?.datasourceId
      const sql = result?.sql
      const [view, setView] = useState(null)
      useEffect(() => {
        if (!dsId || !sql || result?.error) return
        let alive = true
        fqCache.get(dsId, sql).then(v => alive && setView(v), () => {})
        return () => { alive = false }
      }, [dsId, sql, rev])
      const stale = (view?.tables ?? []).filter(x => x.stale)
      if (!stale.length) return null
      return h('div', { className: 'n2s-fq-bar', role: 'status' },
        h('span', { 'aria-hidden': true }, '⚠️'),
        h('span', null, joinClauses(stale.slice(0, 3).map(x => fmt(t, 'fq.barItem', { table: x.table, when: fqWhen(t, x.latestAt), lag: fqLag(t, x.lagMinutes) })))),
        stale.length > 3 && h('span', { className: 'n2s-faint' }, fmt(t, 'fq.barMore', { n: stale.length - 3 })))
    }
    extend.resultPanels.push(FreshnessResultPanel)

    // ---- schema panel

    function FqDot({ status }) {
      return h('span', { className: `n2s-fq-dot ${fqStatusClass[status] ?? 'off'}`, 'aria-hidden': true })
    }

    function FreshnessSchemaPanel({ t, ds }) {
      const rev = useFqRev()
      const [state, setState] = useState({ loading: true })
      const [open, setOpen] = useState(null)
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        if (!ds?.id) return
        let alive = true
        setState(s => ({ ...s, loading: true }))
        fqCache.get(ds.id).then(v => alive && setState({ value: v }), e => alive && setState({ error: e }))
        return () => { alive = false }
      }, [ds?.id, rev])
      const v = state.value
      if (!ds || state.error || !v || !v.tables?.length) return null
      const stale = v.tables.filter(x => x.stale).length
      const warn = v.tables.filter(x => x.status === 'warn').length
      const expanded = open ?? stale > 0
      const refresh = async () => {
        setBusy(true)
        try { await fqCache.refresh(ds.id) } catch (e) { notifyError(e) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-fq-panel' },
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': expanded, onClick: () => setOpen(!expanded) }, Icon.chev(10), t('fq.title')),
          h('span', { className: `n2s-badge ${stale ? 'err' : warn ? 'warn' : 'ok'}` }, stale ? fmt(t, 'fq.staleCount', { n: stale }) : warn ? fmt(t, 'fq.warnCount', { n: warn }) : t('fq.allFresh')),
          h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.checkedAt', { time: fqTime(v.checkedAt) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy, onClick: refresh }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), t('fq.refresh'))),
        expanded && h('div', { className: 'n2s-fq-list' }, v.tables.map(x => h('div', { key: x.table, className: 'n2s-fq-item', title: x.error ?? `${x.column} · ${x.latestLocal ?? '—'}` },
          h(FqDot, { status: x.status }),
          h('span', { className: 'n2s-ellipsis n2s-mono' }, x.table),
          h('span', { className: 'n2s-grow' }),
          h('span', { className: 'n2s-faint n2s-small' }, x.error ? t('fq.st.error') : x.latestAt === null ? t('fq.st.empty') : fqLag(t, x.lagMinutes))))))
    }
    extend.schemaPanels.push(FreshnessSchemaPanel)

    // ---- conversation tool view

    function makeFreshnessToolView(ctx) {
      return function Nl2SqlFreshnessView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const f = settled ? block.meta?.freshness : undefined
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('fq.running'))))
        if (block.isError || !f) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || t('fq.failed')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 500 } }, t('fq.title')), f.datasource && h('span', { className: 'n2s-badge' }, f.datasource)),
          (f.warnings ?? []).map((w, i) => h('div', { key: i, className: 'n2s-fq-bar' }, w)),
          h('div', { className: 'n2s-fq-list' }, (f.tables ?? []).map(x => h('div', { key: x.table, className: 'n2s-fq-item' },
            h(FqDot, { status: x.status ?? 'unknown' }),
            h('span', { className: 'n2s-mono n2s-ellipsis' }, x.table),
            h('span', { className: 'n2s-grow' }),
            h('span', { className: 'n2s-faint n2s-small' }, x.note && !x.latestAt ? t('fq.noTime') : x.latestAt ? `${x.latestAt} · ${fqLag(t, x.lagMinutes)}` : t('fq.st.empty'))))))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_freshness', make: makeFreshnessToolView })

    // ---- admin section

    function FqScore({ score }) {
      const cls = score === null || score === undefined ? 'off' : score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'err'
      return h('span', { className: `n2s-fq-score ${cls}` }, score === null || score === undefined ? '—' : score)
    }

    function HealthSettings({ t, onSaved }) {
      const st = useAsync(() => call('healthSettings'), [])
      const [form, setForm] = useState(null)
      const [busy, runBusy] = useBusy()
      useEffect(() => { if (st.value) setForm(structuredClone(st.value)) }, [st.value])
      if (!form) return h('div', { className: 'n2s-skel', style: { height: 120 } })
      const setF = (k, v) => setForm(f => ({ ...f, freshness: { ...f.freshness, [k]: v } }))
      const setQ = (k, v) => setForm(f => ({ ...f, quality: { ...f.quality, [k]: v } }))
      const save = () => runBusy(async () => {
        try {
          const { overrides: _o, ...freshness } = form.freshness
          const out = await call('saveHealthSettings', { freshness: { ...freshness, intervalMin: Number(freshness.intervalMin), staleHours: Number(freshness.staleHours), channelId: freshness.channelId || null }, quality: { ...form.quality, dropPoints: Number(form.quality.dropPoints), channelId: form.quality.channelId || null } })
          setForm(structuredClone(out))
          notify(t('fq.saved'), 'ok')
          onSaved?.()
        } catch (e) { notifyError(e) }
      })
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: Boolean(form.freshness.enabled), onChange: e => setF('enabled', e.target.checked) }), t('fq.set.fEnabled')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: Boolean(form.quality.enabled), onChange: e => setQ('enabled', e.target.checked) }), t('fq.set.qEnabled')),
          h('label', { className: 'n2s-field' }, h('span', null, t('fq.set.interval')), h('input', { className: 'n2s-input', type: 'number', min: 5, max: 1440, value: form.freshness.intervalMin, onChange: e => setF('intervalMin', e.target.value) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('fq.set.time')), h('input', { className: 'n2s-input', type: 'time', value: form.quality.time, onChange: e => setQ('time', e.target.value) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('fq.set.staleHours')), h('input', { className: 'n2s-input', type: 'number', min: 0.25, step: 0.25, value: form.freshness.staleHours, onChange: e => setF('staleHours', e.target.value) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('fq.set.drop')), h('input', { className: 'n2s-input', type: 'number', min: 1, max: 100, value: form.quality.dropPoints, onChange: e => setQ('dropPoints', e.target.value) })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-fq-fch', className: 'n2s-flabel' }, t('fq.set.fChannel')), h(ChannelPicker, { t, id: 'n2s-fq-fch', value: form.freshness.channelId ?? '', noneLabel: t('fq.set.noPush'), onChange: v => setF('channelId', v) })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-fq-qch', className: 'n2s-flabel' }, t('fq.set.qChannel')), h(ChannelPicker, { t, id: 'n2s-fq-qch', value: form.quality.channelId ?? '', noneLabel: t('fq.set.noPush'), onChange: v => setQ('channelId', v) }))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 10 } }, t('fq.set.hint')),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function HealthFreshnessTable({ t, dsId }) {
      const rev = useFqRev()
      const fr = useAsync(() => (dsId ? fqCache.get(dsId) : null), [dsId, rev])
      const settings = useAsync(() => call('healthSettings'), [dsId, rev])
      const events = useAsync(() => (dsId ? call('freshnessEvents', { datasourceId: dsId, limit: 10 }) : []), [dsId, rev])
      const [busy, setBusy] = useState(false)
      const refresh = async () => {
        setBusy(true)
        try { await fqCache.refresh(dsId) } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const setOverride = async (table, value) => {
        const cur = structuredClone(settings.value?.freshness?.overrides ?? {})
        cur[dsId] ??= {}
        if (value === '' || value === null) delete cur[dsId][table]
        else cur[dsId][table] = Number(value)
        try { await call('saveHealthSettings', { freshness: { overrides: cur } }); await fqCache.refresh(dsId) } catch (e) { notifyError(e) }
      }
      const v = fr.value
      const overrides = settings.value?.freshness?.overrides?.[dsId] ?? {}
      return h('div', null,
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('div', { className: 'n2s-setsub', style: { margin: 0 } }, t('fq.title')),
          v && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.checkedAt', { time: fqTime(v.checkedAt) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy || !dsId, onClick: refresh }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), t('fq.refresh'))),
        fr.error && h('div', { className: 'n2s-notice err' }, fr.error.message),
        v && !v.analyzed && h('div', { className: 'n2s-notice' }, t('fq.notAnalyzed')),
        v && v.analyzed && !v.tables.length && h('div', { className: 'n2s-notice' }, t('fq.noTables')),
        v && v.tables.length > 0 && h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('fq.col.table'), t('fq.col.column'), t('fq.col.latest'), t('fq.col.lag'), t('fq.col.threshold')].map((x, i) => h('th', { key: i, className: i === 3 ? 'num' : undefined }, x)))),
          h('tbody', null, v.tables.map(x => h('tr', { key: x.table },
            h('td', null, h('span', { className: 'n2s-row', style: { flexWrap: 'nowrap' } }, h(FqDot, { status: x.status }), h('span', { className: 'n2s-mono' }, x.table))),
            h('td', { className: 'n2s-mono n2s-muted' }, x.column),
            h('td', { title: x.error ?? '' }, x.error ? h('span', { className: 'n2s-badge err' }, t('fq.st.error')) : x.latestAt === null ? t('fq.st.empty') : fqWhen(t, x.latestAt)),
            h('td', { className: 'num' }, fqLag(t, x.lagMinutes)),
            h('td', null, h('input', { className: 'n2s-input', type: 'number', min: 0, step: 0.5, style: { width: 90, height: 28 }, 'aria-label': fmt(t, 'fq.thresholdFor', { table: x.table }), placeholder: String(settings.value?.freshness?.staleHours ?? 24), defaultValue: overrides[x.table] ?? '', onBlur: e => { const val = e.target.value; if (String(overrides[x.table] ?? '') !== val) setOverride(x.table, val) } }))))))),
        (events.value ?? []).length > 0 && h('div', { style: { marginTop: 10 } },
          h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 4 } }, t('fq.events')),
          events.value.map(e => h('div', { key: e.id, className: 'n2s-small n2s-muted' }, `${fqTime(e.at)} · ${e.kind === 'stale' ? '⚠️' : '✅'} ${e.table} ${e.kind === 'stale' ? fmt(t, 'fq.evStale', { lag: fqLag(t, e.lagMinutes) }) : t('fq.evRecovered')}${e.pushed ? ` · ${t('fq.pushed')}` : ''}`))))
    }

    function HealthQuality({ t, dsId }) {
      const res = useAsync(() => (dsId ? call('qualityResults', { datasourceId: dsId }) : null), [dsId])
      const [busy, setBusy] = useState(false)
      const [open, setOpen] = useState({})
      const run = async () => {
        setBusy(true)
        try { const r = await call('qualityScan', { datasourceId: dsId }); notify(fmt(t, 'fq.q.done', { score: r.score ?? '—' }), 'ok'); res.reload() } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const latest = res.value?.latest
      const lang = uiLang === 'zh' ? 'zh' : 'en'
      return h('div', null,
        h('div', { className: 'n2s-row', style: { margin: '22px 0 8px' } },
          h('div', { className: 'n2s-setsub', style: { margin: 0 } }, t('fq.q.title')),
          latest && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.q.lastRun', { time: fqTime(latest.at) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy || !dsId, onClick: run }, busy ? h('span', { className: 'n2s-spin' }) : Icon.spark(13), busy ? t('fq.q.running') : t('fq.q.run'))),
        res.error && h('div', { className: 'n2s-notice err' }, res.error.message),
        !res.loading && !latest && h('div', { className: 'n2s-notice' }, t('fq.q.empty')),
        latest && h('div', { className: 'n2s-fq-summary' },
          h(FqScore, { score: latest.score }),
          h('div', { className: 'n2s-grow' },
            h('div', null, latest.summary?.[lang] ?? ''),
            res.value.history.length > 1 && h('div', { className: 'n2s-faint n2s-small' }, colon(t('fq.q.history')), res.value.history.slice(0, 10).reverse().map(x => x.score ?? '—').join(' → ')))),
        latest && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('fq.col.table'), t('fq.q.score'), t('fq.q.rows'), t('fq.q.issues')].map((x, i) => h('th', { key: i, className: i === 1 || i === 2 ? 'num' : undefined }, x)))),
          h('tbody', null, latest.tables.map(r => {
            const issues = (r.issues ?? []).filter(i => i.deduct > 0 || r.score === null)
            const shown = open[r.table] ? issues : issues.slice(0, 2)
            return h('tr', { key: r.table },
              h('td', { className: 'n2s-mono' }, r.table),
              h('td', { className: 'num' }, h(FqScore, { score: r.score })),
              h('td', { className: 'num' }, r.rowCount ?? '—'),
              h('td', null,
                issues.length ? shown.map((i, k) => h('div', { key: k, className: 'n2s-small' }, i[lang])) : h('span', { className: 'n2s-faint n2s-small' }, t('fq.q.noIssues')),
                issues.length > 2 && h('button', { type: 'button', className: 'n2s-link n2s-small', onClick: () => setOpen(o => ({ ...o, [r.table]: !o[r.table] })) }, open[r.table] ? t('fq.less') : fmt(t, 'fq.more', { n: issues.length - 2 }))))
          })))))
    }

    function HealthSection({ t, ds, datasources }) {
      const [dsId, setDsId] = useState(ds?.id ?? datasources?.[0]?.id ?? '')
      useEffect(() => { if (!dsId && (ds?.id || datasources?.[0]?.id)) setDsId(ds?.id ?? datasources[0].id) }, [ds?.id, datasources?.length])
      const status = useAsync(() => call('healthStatus'), [])
      return h('div', null,
        h(SectionHead, { title: t('fq.admin.title'), desc: t('fq.admin.desc') },
          (datasources ?? []).length > 1 && h('select', { className: 'n2s-select inline', 'aria-label': t('ds.select'), value: dsId, onChange: e => setDsId(e.target.value) }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
        status.value && h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 10 } },
          status.value.freshness.enabled ? fmt(t, 'fq.admin.nextF', { time: fqTime(status.value.freshness.nextAt) }) : t('fq.admin.fOff'),
          ' · ',
          status.value.quality.enabled ? fmt(t, 'fq.admin.nextQ', { time: status.value.quality.time }) : t('fq.admin.qOff')),
        !dsId ? h('div', { className: 'n2s-empty' }, h('h3', null, t('fq.admin.noDs'))) : h(React.Fragment, null,
          h(HealthFreshnessTable, { key: `f-${dsId}`, t, dsId }),
          h(HealthQuality, { key: `q-${dsId}`, t, dsId })),
        h('div', { className: 'n2s-setsub' }, t('fq.set.title')),
        h(HealthSettings, { t, onSaved: () => status.reload() }))
    }
    extend.adminSections.push({ id: 'health', label: (t) => t('fq.admin.nav'), icon: () => svg(15, [h('path', { key: 1, d: 'M1.5 8.5h3l1.5-4 3 7 1.5-3h4' })]), Component: HealthSection })
