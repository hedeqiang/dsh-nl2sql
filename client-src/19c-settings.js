    // ------------------------------------------------------------ settings
    // Grouped settings: a section nav on the left, one form per group. Edits are
    // kept as a draft until "保存"; a sticky bar shows unsaved changes and offers
    // save / discard; each group can restore its defaults. Leaving the group or
    // the admin area with unsaved changes asks for confirmation.

    const SETTINGS_GROUPS = ['privacy', 'query', 'automation', 'lark', 'storage', 'about']
    const GROUP_KEYS = {
      privacy: ['sampleMode', 'resultToModel', 'modelRows', 'maskSensitive'],
      query: ['maxRows', 'timeoutMs', 'scanGuardRows', 'cacheTtlSec', 'schemaOverviewMax'],
      automation: ['schemaWatch', 'schemaCheckDaily', 'schemaNotifyChannel'],
      lark: ['larkDefaultRole'],
      storage: ['retention'],
      about: [],
    }

    function sameValue(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }

    /** One labelled setting row: label + control on the left, explanation underneath. */
    function SettingRow({ label, hint, children, changed, htmlFor }) {
      return h('div', { className: `n2s-setrow${changed ? ' changed' : ''}` },
        h('div', { className: 'n2s-setrow-label' }, htmlFor ? h('label', { htmlFor }, label) : h('span', null, label), changed && h('span', { className: 'n2s-dotchanged', title: '•' })),
        h('div', { className: 'n2s-setrow-ctl' }, children),
        hint && h('div', { className: 'n2s-setrow-hint' }, hint))
    }

    function SettingsPage({ t, datasources, onNavigate }) {
      const loaded = useAsync(() => call('getSettings'), [])
      const [group, setGroup] = useState('privacy')
      const [base, setBase] = useState(null)
      const [form, setForm] = useState(null)
      const [saving, setSaving] = useState(false)
      useEffect(() => { if (loaded.value) { const { defaults, ...v } = loaded.value; setBase(v); setForm(v) } }, [loaded.value])
      const defaults = loaded.value?.defaults ?? {}
      const dirtyKeys = form && base ? Object.keys(form).filter(k => !sameValue(form[k], base[k])) : []
      const dirty = dirtyKeys.length > 0
      // Warn before the browser tab closes with unsaved settings.
      useEffect(() => {
        if (!dirty) return
        const onBefore = (e) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', onBefore)
        return () => window.removeEventListener('beforeunload', onBefore)
      }, [dirty])
      // Let the admin nav ask before discarding.
      useEffect(() => { fbCtx.settingsDirty = dirty; return () => { fbCtx.settingsDirty = false } }, [dirty])
      if (!form) return loaded.error ? h('div', { className: 'n2s-notice err' }, loaded.error.message) : h('div', { className: 'n2s-skel', style: { height: 240 } })
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
      const changed = (k) => dirtyKeys.includes(k)
      const save = async () => {
        setSaving(true)
        try {
          const patch = Object.fromEntries(dirtyKeys.map(k => [k, form[k]]))
          const { defaults: _d, ...v } = await call('saveSettings', patch)
          setBase(v); setForm(v)
          notify(t('settings.saved'), 'ok')
        } catch (e) { notifyError(e) }
        setSaving(false)
      }
      const discard = () => setForm(base)
      const resetGroup = async () => {
        const keys = GROUP_KEYS[group].filter(k => k in defaults || k === 'retention')
        if (!keys.length) return
        if (!await confirmDialog({ title: t('settings.resetConfirm'), message: fmt(t, 'settings.resetConfirmMsg', { group: t(`set.g.${group}`) }) })) return
        try {
          const { defaults: _d, ...v } = await call('resetSettings', { keys })
          setBase(v); setForm(f => ({ ...f, ...Object.fromEntries(keys.map(k => [k, v[k]])) }))
          notify(t('settings.resetDone'), 'ok')
        } catch (e) { notifyError(e) }
      }
      const goGroup = async (g) => {
        if (g === group) return
        setGroup(g)
      }
      const radio = (key, values, prefix) => h('div', { className: 'n2s-radios', role: 'radiogroup', 'aria-label': t(`settings.${key}`) }, values.map(v => h('label', { key: v, className: `n2s-radio${form[key] === v ? ' on' : ''}` },
        h('input', { type: 'radio', name: key, checked: form[key] === v, onChange: () => set(key, v) }),
        h('span', null, h('span', { className: 'title' }, t(`${prefix}.${v}`)), h('span', { className: 'desc' }, t(`${prefix}.${v}.desc`))))))
      const num = (key, props = {}) => h('input', { id: `set-${key}`, className: 'n2s-input', type: 'number', style: { maxWidth: 200 }, value: form[key] ?? '', onChange: e => set(key, e.target.value === '' ? '' : Number(e.target.value)), ...props })
      const overrides = datasources.filter(d => d.privacy && Object.keys(d.privacy).length)
      const body =
        group === 'privacy' ? h(React.Fragment, null,
          h(SettingRow, { label: t('settings.sampleMode'), hint: t('set.h.sampleMode'), changed: changed('sampleMode') }, radio('sampleMode', ['off', 'enum', 'all'], 'settings.sample')),
          h(SettingRow, { label: t('settings.resultToModel'), hint: t('set.h.resultToModel'), changed: changed('resultToModel') }, radio('resultToModel', ['none', 'summary', 'rows'], 'settings.result')),
          form.resultToModel === 'rows' && h(SettingRow, { label: t('settings.modelRows'), hint: t('set.h.modelRows'), changed: changed('modelRows'), htmlFor: 'set-modelRows' }, num('modelRows', { min: 0, max: 500 })),
          h(SettingRow, { label: t('set.l.mask'), hint: t('set.h.maskSensitive'), changed: changed('maskSensitive') }, h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(form.maskSensitive), onChange: e => set('maskSensitive', e.target.checked) }), h('span', null, form.maskSensitive ? t('set.on') : t('set.off')))),
          h('div', { className: 'n2s-setnote' }, overrides.length
            ? h(React.Fragment, null, t('set.overrides'), ' ', overrides.map((d, i) => h(React.Fragment, { key: d.id }, i > 0 && '、', h('button', { type: 'button', className: 'n2s-link', onClick: () => onNavigate({ section: 'sources' }) }, d.name))))
            : t('set.noOverrides'))) :
        group === 'query' ? h(React.Fragment, null,
          h(SettingRow, { label: t('set.l.maxRows'), hint: t('set.h.maxRows'), changed: changed('maxRows'), htmlFor: 'set-maxRows' }, num('maxRows', { min: 1, max: 100000 })),
          h(SettingRow, { label: t('set.l.timeout'), hint: t('set.h.timeoutMs'), changed: changed('timeoutMs'), htmlFor: 'set-timeoutMs' }, num('timeoutMs', { min: 1000, step: 1000 })),
          h(SettingRow, { label: t('set.l.scanGuard'), hint: t('set.h.scanGuardRows'), changed: changed('scanGuardRows'), htmlFor: 'set-scanGuardRows' }, num('scanGuardRows', { min: 0, step: 100000 })),
          h(SettingRow, { label: t('set.l.cacheTtl'), hint: t('set.h.cacheTtl'), changed: changed('cacheTtlSec'), htmlFor: 'set-cacheTtlSec' }, h('div', { className: 'n2s-row' }, num('cacheTtlSec', { min: 0 }), h(CacheStats, { t }))),
          h(SettingRow, { label: t('set.schemaOverviewMax'), hint: t('set.h.schemaOverviewMax'), changed: changed('schemaOverviewMax'), htmlFor: 'set-schemaOverviewMax' }, num('schemaOverviewMax', { min: 10, max: 1000 }))) :
        group === 'automation' ? h(React.Fragment, null,
          h(SchedulerCard, { t, onOpen: () => onNavigate({ section: 'automation', sub: 'alerts' }) }),
          h(SettingRow, { label: t('set.l.watch'), hint: t('settings.schemaWatchOn'), changed: changed('schemaWatch') }, h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: form.schemaWatch !== false, onChange: e => set('schemaWatch', e.target.checked) }), h('span', null, form.schemaWatch !== false ? t('set.on') : t('set.off')))),
          h(SettingRow, { label: t('set.l.daily'), hint: t('set.h.schemaDaily'), changed: changed('schemaCheckDaily'), htmlFor: 'set-daily' }, h('div', { className: 'n2s-row' },
            h('input', { id: 'set-daily', className: 'n2s-input', type: 'time', style: { maxWidth: 160 }, value: form.schemaCheckDaily ?? '', onChange: e => set('schemaCheckDaily', e.target.value) }),
            form.schemaCheckDaily && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => set('schemaCheckDaily', '') }, t('set.turnOff')))),
          h(SettingRow, { label: t('set.l.notify'), hint: t('set.h.schemaNotify'), changed: changed('schemaNotifyChannel') }, h(ChannelSelect, { t, value: form.schemaNotifyChannel ?? '', onChange: v => set('schemaNotifyChannel', v) }))) :
        group === 'lark' ? h(React.Fragment, null,
          h(LarkSummaryCard, { t, onOpenMembers: () => onNavigate({ section: 'members' }), onOpenPush: () => onNavigate({ section: 'push' }) }),
          h(SettingRow, { label: t('set.l.unknownLark'), hint: t('set.h.larkDefaultRole'), changed: changed('larkDefaultRole') }, radio('larkDefaultRole', ['none', 'viewer', 'analyst'], 'mb.defaultRole'))) :
        group === 'storage' ? h(StorageSection, { t, form, set, changed, defaults }) :
        h(AboutSection, { t })
      const canReset = GROUP_KEYS[group].length > 0
      return h('div', { className: 'n2s-settings' },
        h(SectionHead, { title: t('tab.settings'), desc: t('set.desc') }),
        h('div', { className: 'n2s-setgroups', role: 'tablist', 'aria-label': t('tab.settings') }, SETTINGS_GROUPS.map(g => {
          const n = GROUP_KEYS[g].filter(k => dirtyKeys.includes(k)).length
          return h('button', { key: g, type: 'button', role: 'tab', 'aria-selected': group === g, onClick: () => goGroup(g) }, t(`set.g.${g}`), n > 0 && h('span', { className: 'n2s-dotchanged', 'aria-label': t('set.unsaved') }))
        })),
        h('div', { className: 'n2s-setpanel', role: 'tabpanel' },
          h('div', { className: 'n2s-row', style: { marginBottom: 6 } },
            h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-h2', style: { margin: 0 } }, t(`set.g.${group}`)), h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 2 } }, t(`set.gd.${group}`))),
            canReset && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: resetGroup }, Icon.refresh(13), t('settings.reset'))),
          body),
        dirty && h('div', { className: 'n2s-savebar', role: 'region', 'aria-label': t('set.unsaved') },
          h('span', { className: 'n2s-dotchanged' }),
          h('span', { className: 'n2s-grow' }, fmt(t, 'set.unsavedN', { n: dirtyKeys.length })),
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: discard, disabled: saving }, t('set.discard')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save, disabled: saving }, saving ? h('span', { className: 'n2s-spin' }) : null, t('settings.save'))))
    }

    function SchedulerCard({ t, onOpen }) {
      const st = useAsync(() => call('schedulerStatus').catch(() => null), [])
      const v = st.value
      return h('div', { className: 'n2s-infocard' },
        h('span', { className: `n2s-statusdot ${v?.running ? 'ok' : ''}` }, v?.running ? t('set.schedOn') : t('set.schedOff')),
        h('span', { className: 'n2s-muted n2s-small n2s-grow' },
          v?.lastTickAt ? fmt(t, 'al.lastTick', { time: new Date(v.lastTickAt).toLocaleTimeString(), n: (v.lastRan ?? []).length }) : t('al.noTickYet'),
          v?.nextAlerts?.[0] ? ` · ${fmt(t, 'al.nextDue', { name: v.nextAlerts[0].name, time: new Date(Math.max(v.nextAlerts[0].dueAt, Date.now())).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : ''),
        h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpen }, t('set.openAlerts')))
    }

    function LarkSummaryCard({ t, onOpenMembers, onOpenPush }) {
      const bot = useAsync(() => call('larkBotStatus').catch(() => null), [])
      const channels = useChannels()
      const def = channels.find(c => c.isDefault)
      const state = bot.value?.status?.state ?? 'idle'
      return h('div', { className: 'n2s-infogrid' },
        h('div', { className: 'n2s-infocard' },
          h('span', { className: `n2s-statusdot ${state === 'connected' ? 'ok' : state === 'error' ? 'err' : ''}` }, t('bot.title')),
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, bot.value?.enabled ? t(`bot.state.${state}`) : t('bot.state.idle')),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpenMembers }, t('set.configure'))),
        h('div', { className: 'n2s-infocard' },
          h('span', { className: 'n2s-small', style: { fontWeight: 500 } }, t('set.defaultChannel')),
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, def ? def.name : channels.length ? t('set.noDefaultChannel') : t('set.noChannels')),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpenPush }, t('set.configure'))))
    }

    const RETENTION_KINDS = ['history', 'feedback', 'delivery', 'alertEvent', 'admin', 'evalRun', 'schemaChange']

    function StorageSection({ t, form, set, changed, defaults }) {
      const st = useAsync(() => call('storageStats').catch(() => null), [])
      const v = st.value
      const retention = form.retention ?? defaults.retention ?? {}
      const fileRef = useRef(null)
      const [importState, setImportState] = useState(null)
      const exportAll = async () => {
        try {
          const doc = await call('exportConfig')
          download(`nl2sql-config-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
          notify(t('set.exported'), 'ok')
        } catch (e) { notifyError(e) }
      }
      const onFile = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          const doc = JSON.parse(await f.text())
          const dry = await call('importConfig', { data: doc, mode: 'merge', dryRun: true })
          setImportState({ doc, dry })
        } catch (err) { notifyError(err) }
      }
      const doImport = async (mode) => {
        if (mode === 'replace' && !await confirmDialog({ title: t('set.importReplaceConfirm'), message: t('set.importReplaceMsg'), danger: true })) return
        try {
          const r = await call('importConfig', { data: importState.doc, mode })
          setImportState(null)
          await refreshDatasources()
          refreshChannels()
          const needs = (r.report?.datasources?.needsSecret ?? r.needsSecret ?? []).length
          notify(needs ? fmt(t, 'set.importedNeedsSecret', { n: needs }) : t('set.imported'), 'ok', 6000)
        } catch (err) { notifyError(err) }
      }
      const purge = async (kind) => {
        if (!await confirmDialog({ title: fmt(t, 'set.purgeConfirm', { kind: t(`set.rk.${kind}`) }), danger: true })) return
        try { await call('purgeRecords', { kind }); st.reload(); notify(t('set.purged'), 'ok') } catch (e) { notifyError(e) }
      }
      return h(React.Fragment, null,
        h('div', { className: 'n2s-infogrid' },
          h('div', { className: 'n2s-infocard col' }, h('span', { className: 'n2s-faint n2s-small' }, t('set.resultsDb')), h('span', { className: 'n2s-bignum' }, v ? `${(v.resultsDb.bytes / 1048576).toFixed(1)} MB` : '…'), h('span', { className: 'n2s-muted n2s-small' }, v ? fmt(t, 'set.resultsDbSub', { results: v.resultsDb.results, cache: v.resultsDb.cacheEntries }) : '')),
          h('div', { className: 'n2s-infocard col' }, h('span', { className: 'n2s-faint n2s-small' }, t('set.stateFile')), h('span', { className: 'n2s-bignum' }, v ? `${(v.stateBytes / 1024).toFixed(1)} KB` : '…'), h('span', { className: 'n2s-muted n2s-small n2s-ellipsis', title: v?.dataDir }, v?.dataDir ?? ''))),
        h('div', { className: 'n2s-setsub' }, t('set.retention')),
        h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 8 } }, t('set.h.retention')),
        h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('set.rkCol'), t('set.rkCount'), t('set.rkKeep'), ''].map((x, i) => h('th', { key: i, className: i === 1 ? 'num' : undefined }, x)))),
          h('tbody', null, RETENTION_KINDS.map(k => h('tr', { key: k },
            h('td', null, t(`set.rk.${k}`)),
            h('td', { className: 'num' }, v?.records?.[k] ?? '—'),
            h('td', null, h('input', { className: 'n2s-input', type: 'number', min: 100, max: 200000, step: 100, 'aria-label': `${t(`set.rk.${k}`)} ${t('set.rkKeep')}`, style: { width: 120, height: 30 }, value: retention[k] ?? '', onChange: e => set('retention', { ...retention, [k]: e.target.value === '' ? '' : Number(e.target.value) }) })),
            h('td', { style: { textAlign: 'right' } }, h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: !v?.records?.[k], onClick: () => purge(k) }, t('set.purge')))))))),
        changed('retention') && h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('set.retentionNote')),
        h('div', { className: 'n2s-setsub' }, t('set.backup')),
        h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, t('set.h.backup')),
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn', onClick: exportAll }, Icon.download(13), t('set.export')),
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => fileRef.current?.click() }, Icon.up(13), t('set.import')),
          h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onChange: onFile })),
        importState && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) setImportState(null) } },
          h('div', { className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('set.import'), onKeyDown: (e) => { if (e.key === 'Escape') setImportState(null) } },
            h('div', { className: 'n2s-modal-title', style: { marginBottom: 10 } }, t('set.import')),
            h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, fmt(t, 'set.importFrom', { time: importState.doc.exportedAt ? new Date(importState.doc.exportedAt).toLocaleString() : '?' })),
            h('table', { className: 'n2s-table' }, h('thead', null, h('tr', null, [t('set.section'), t('set.toAdd'), t('set.toUpdate'), t('set.note')].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', null, Object.entries(importState.dry?.report ?? {}).map(([k, r]) => h('tr', { key: k },
                h('td', null, t(`set.sec.${k}`)), h('td', null, r.add ?? r.added ?? 0), h('td', null, r.update ?? r.updated ?? 0),
                h('td', { className: 'n2s-muted n2s-small', style: { whiteSpace: 'normal' } }, [r.needsSecret?.length ? fmt(t, 'set.needsSecret', { names: r.needsSecret.join('、') }) : '', r.paused ? t('set.reportsPaused') : '', r.skipped ? fmt(t, 'set.skipped', { n: r.skipped }) : ''].filter(Boolean).join('；')))))),
            h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => setImportState(null) }, t('ds.cancel')),
              h('button', { type: 'button', className: 'n2s-btn danger', onClick: () => doImport('replace') }, t('kb.replace')),
              h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => doImport('merge') }, t('kb.merge'))))), document.body))
    }

    function AboutSection({ t }) {
      const info = useAsync(() => call('aboutInfo').catch(() => null), [])
      const v = info.value
      const row = (k, val, mono) => h('tr', { key: k }, h('td', { className: 'n2s-muted', style: { width: 160 } }, t(`set.about.${k}`)), h('td', { className: mono ? 'n2s-mono' : undefined, style: { whiteSpace: 'normal', wordBreak: 'break-all' } }, val ?? '—'))
      return h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' }, h('tbody', null,
        row('version', v?.version),
        row('dataDir', v?.dataDir, true),
        row('runtime', v ? `Node ${v.nodeVersion} · SQLite ${v.sqliteVersion}` : null),
        row('tests', v?.testsCommand, true),
        row('docs', 'DEVELOPMENT.md'))))
    }

