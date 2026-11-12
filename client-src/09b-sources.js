    function FileTables({ t, ds }) {
      const list = useAsync(() => call('listFileTables', { datasourceId: ds.id }), [ds.id, ds.schemaAnalyzedAt])
      const tables = list.value ?? []
      if (!tables.length) return null
      return h('div', { className: 'n2s-chips', style: { marginTop: 6 } }, tables.map(tb => h('span', { key: tb.name, className: 'n2s-badge', title: `${tb.source ?? ''} · ${new Date(tb.updatedAt ?? tb.createdAt).toLocaleString()}` },
        `${tb.name} · ${formatCompact(tb.rows)}`,
        h('button', { type: 'button', className: 'n2s-iconbtn', style: { width: 16, height: 16 }, 'aria-label': `${t('ds.delete')} ${tb.name}`, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'up.dropConfirm', { name: tb.name }), danger: true })) { await call('dropFileTable', { datasourceId: ds.id, table: tb.name }); list.reload(); refreshDatasources() } } }, Icon.close(10)))))
    }

    function SourcesTab({ t, datasources }) {
      const [editing, setEditing] = useState(null)
      const [policyFor, setPolicyFor] = useState(null)
      const [tests, setTests] = useState({})
      const [upload, setUpload] = useState(null)
      if (policyFor) return h(PolicyEditor, { t, ds: policyFor, onDone: () => setPolicyFor(null), onCancel: () => setPolicyFor(null) })
      if (editing) return h(DatasourceForm, { t, initial: editing === 'new' ? null : editing, onDone: () => setEditing(null), onCancel: () => setEditing(null) })
      const test = async (ds) => {
        setTests(s => ({ ...s, [ds.id]: { busy: true, ok: true } }))
        const r = await call('testConnection', { id: ds.id }).catch(e => ({ ok: false, error: e.message }))
        setTests(s => ({ ...s, [ds.id]: r }))
        refreshDatasources()
      }
      return h('div', null,
        h(SectionHead, { title: t('tab.sources'), desc: t('ds.sectionDesc') },
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => setUpload({}) }, Icon.up(13), t('up.button')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing('new') }, '+ ', t('ds.add'))),
        upload && h(UploadDialog, { t, datasources, initialTarget: upload.target, onClose: () => setUpload(null) }),
        datasources.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('ds.none')), h('div', null, t('ds.noneHint')), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing('new') }, t('ds.add'))),
        datasources.length > 0 && h('div', { className: 'n2s-list2' }, datasources.map(ds => {
          const tr = tests[ds.id]
          const policyOn = Boolean(ds.policy && (ds.policy.mode !== 'all' || ds.policy.hiddenColumns.length > 0 || ds.policy.maskedColumns.length > 0))
          const version = ds.serverVersion ? String(ds.serverVersion).replace(/^(PostgreSQL|Elasticsearch) /, '').split(' ')[0] : ''
          return h('div', { key: ds.id, className: 'n2s-list2-row' },
            h(TypeTile, { type: ds.type }),
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-row', style: { gap: 6 } },
                h('span', { className: 'n2s-list2-title' }, ds.name),
                ds.current && h('span', { className: 'n2s-badge' }, t('ds.current')),
                ds.needsSecret && h('button', { type: 'button', className: 'n2s-badge warn', style: { border: 0, cursor: 'pointer' }, title: t('ds.needsSecretHint'), onClick: () => setEditing(ds) }, t('ds.needsSecret')),
                policyOn && h('span', { className: 'n2s-badge warn', title: t(`policy.mode.${ds.policy.mode}`) }, t('policy.badge')),
                ds.privacy && Object.keys(ds.privacy).length > 0 && h('span', { className: 'n2s-badge' }, t('ds.privacyCustom')),
                ds.ssh?.enabled && h('span', { className: 'n2s-badge' }, 'SSH')),
              h('div', { className: 'n2s-list2-sub n2s-mono' }, ds.type === 'sqlite' ? t('up.localDesc') : `${ds.user ? `${ds.user}@` : ''}${ds.host}:${ds.port}/${ds.database}${ds.schemas ? ` (${ds.schemas})` : ''}`),
              ds.type === 'sqlite' && h(FileTables, { t, ds }),
              ds.description && h('div', { className: 'n2s-list2-sub' }, ds.description),
              tr && h('div', { className: `n2s-notice ${tr.busy ? '' : tr.ok ? 'ok' : 'err'}`, style: { marginTop: 8 }, role: 'status' },
                tr.busy ? t('ds.testing') : tr.ok ? fmt(t, 'ds.testOk', { version: tr.version, tables: tr.tableCount, latency: tr.latencyMs }) : fmt(t, 'ds.testFail', { error: tr.error }))),
            h('div', { className: 'n2s-list2-side' },
              h('span', { className: `n2s-statusdot ${ds.lastTestOk === false ? 'err' : ds.readOnlyGrant === false ? 'warn' : 'ok'}` }, ds.lastTestOk === false ? t('ds.statusFail') : ds.readOnlyGrant === false ? t('ds.statusWrite') : t('ds.statusOk')),
              h('span', { className: 'n2s-faint n2s-small' }, [typeLabel(t, ds.type), version].filter(Boolean).join(' '))),
            h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
              h('button', { type: 'button', className: 'n2s-btn small', disabled: tr?.busy, onClick: () => test(ds) }, tr?.busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.test')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                !ds.current && { label: t('ds.setCurrent'), icon: Icon.check(14), onClick: async () => { await call('setCurrent', { id: ds.id }); refreshDatasources() } },
                ds.type === 'sqlite' && { label: t('up.addFile'), icon: Icon.up(14), onClick: () => setUpload({ target: ds.id }) },
                ds.type !== 'sqlite' && { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(ds) },
                { label: t('policy.button'), icon: svg(14, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.4 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' })]), onClick: () => setPolicyFor(ds) },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (!await confirmDialog({ title: fmt(t, 'ds.deleteConfirm', { name: ds.name }), danger: true })) return; await call('deleteDatasource', { id: ds.id }).catch(e => notifyError(e)); refreshDatasources() } },
              ] })))
        })))
    }

    function DatasourcePicker({ t, datasources, value, onChange }) {
      return h('select', { className: 'n2s-select', style: { width: 'auto', minWidth: 200 }, value: value ?? '', onChange: (e) => onChange(e.target.value), 'aria-label': t('ds.select') },
        datasources.map(ds => h('option', { key: ds.id, value: ds.id }, `${ds.name} · ${typeLabel(t, ds.type)} · ${ds.database}`)))
    }

    function roleBadge(t, role) {
      const cls = role === 'fact' ? 'brand' : role === 'dimension' ? 'ok' : ''
      return h('span', { className: `n2s-badge ${cls}` }, t(`role.${role}`))
    }
