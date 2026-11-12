    function SchemaTab({ t, ds, onAskTable }) {
      const [schema, setSchema] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [filter, setFilter] = useState('')
      const [selected, setSelected] = useState(null)
      const [preview, setPreview] = useState(null)
      const [mode, setMode] = useState('list')
      const currentDs = useRef(ds?.id)
      currentDs.current = ds?.id
      const analyze = useCallback(async (refresh) => {
        if (!ds) return
        const forId = ds.id
        setBusy(true); setError(null)
        try { const sc = await call('analyzeSchema', { id: forId, refresh }); if (currentDs.current === forId) setSchema(sc) } catch (e) { if (currentDs.current === forId) setError(e.message) }
        if (currentDs.current === forId) setBusy(false)
        refreshDatasources()
      }, [ds?.id])
      useEffect(() => { setSchema(null); setSelected(null); setPreview(null); if (ds?.schemaAnalyzedAt) analyze(false) }, [ds?.id])
      if (!ds) return null
      const tables = (schema?.tables ?? []).filter(tb => !filter || tb.name.toLowerCase().includes(filter.toLowerCase()) || tb.comment.toLowerCase().includes(filter.toLowerCase()) || tb.columns.some(c => c.name.toLowerCase().includes(filter.toLowerCase())))
      const table = schema?.tables.find(tb => tb.name === selected)
      const rels = table ? schema.relations.filter(r => r.from.table === table.name || r.to.table === table.name) : []
      const runPreview = async (sql, title) => {
        const forId = ds.id
        setPreview({ busy: true })
        try { const r = await call('runQuery', { sql, datasourceId: forId, title }); if (currentDs.current === forId) setPreview({ result: r }) } catch (e) { if (currentDs.current === forId) setPreview({ error: e.message }) }
      }
      const quoteTable = (name) => ds.type === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : ds.type === 'postgres' ? name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.') : `"${name.replace(/"/g, '""')}"`
      const runOverview = async (tb, pin) => {
        const forId = ds.id
        setPreview({ busy: true })
        try {
          const res = await call('tableOverview', { datasourceId: forId, table: tb.name, pin })
          if (currentDs.current === forId) setPreview({ overview: res.results, pinned: pin })
        } catch (e) { if (currentDs.current === forId) setPreview({ error: e.message }) }
      }
      // Default to the largest fact table so the detail pane is never blank.
      const defaultTable = schema ? ([...schema.tables].sort((x, y) => (y.role === 'fact') - (x.role === 'fact') || (y.rows ?? 0) - (x.rows ?? 0))[0]?.name ?? null) : null
      const current = selected ?? defaultTable
      const tbl = schema?.tables.find(tb => tb.name === current)
      const rels2 = tbl ? schema.relations.filter(r => r.from.table === tbl.name || r.to.table === tbl.name) : []
      const keyIcon = (c) => c.key === 'PRI' ? h('span', { className: 'n2s-colkey pk', title: 'PRIMARY KEY' }, 'PK') : c.key === 'UNI' ? h('span', { className: 'n2s-colkey', title: 'UNIQUE' }, 'UQ') : c.key === 'MUL' ? h('span', { className: 'n2s-colkey', title: 'INDEX' }, 'IX') : null
      return h('div', null,
        h('div', { className: 'n2s-toolbar' },
          schema && h('span', { className: 'n2s-muted n2s-small' }, fmt(t, 'schema.tables', { count: schema.tables.length }), ' · ', fmt(t, 'schema.relations', { count: schema.relations.length }), ' · ', fmt(t, 'schema.analyzedAt', { time: new Date(schema.analyzedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })),
          h('span', { className: 'n2s-grow' }),
          schema && h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('schema.mode') },
            h('button', { type: 'button', 'aria-pressed': mode === 'list', onClick: () => setMode('list') }, t('schema.modeList')),
            h('button', { type: 'button', 'aria-pressed': mode === 'er', onClick: () => setMode('er') }, t('schema.modeEr'))),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy, onClick: () => analyze(true) }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), busy ? t('schema.analyzing') : schema ? t('schema.refresh') : t('schema.analyze'))),
        h(SchemaChanges, { t, ds }),
        schema && mode === 'er' && h(ErGraph, { t, schema, onPick: (name) => { setSelected(name); setMode('list'); setPreview(null) } }),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 12 } }, error),
        !schema && busy && h('div', { className: 'n2s-split' }, h('div', { className: 'n2s-skel', style: { height: 360 } }), h('div', { className: 'n2s-skel', style: { height: 360 } })),
        !schema && !busy && h('div', { className: 'n2s-empty' }, h('h3', null, t('schema.notAnalyzed')), h('div', null, t('schema.notAnalyzedHint')), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => analyze(true) }, t('schema.analyze'))),
        schema && mode === 'list' && h('div', { className: 'n2s-split' },
          h('div', { className: 'n2s-sidepanel' },
            h('div', { className: 'n2s-search', style: { maxWidth: 'none', marginBottom: 6 } }, h('span', { className: 'n2s-ico' }, Icon.search()), h('input', { className: 'n2s-input', 'aria-label': t('schema.search'), placeholder: t('schema.search'), value: filter, onChange: e => setFilter(e.target.value) })),
            h('div', { className: 'n2s-list', role: 'listbox', 'aria-label': t('schema.tablesLabel') }, tables.map(tb => h('button', {
              key: tb.name, type: 'button', className: 'n2s-item', role: 'option', 'aria-selected': current === tb.name,
              onClick: () => { setSelected(tb.name); setPreview(null) }, title: tb.comment || tb.name,
              style: tb.blocked ? { opacity: 0.5 } : undefined,
            }, h('span', { className: `n2s-roledot ${tb.role}`, title: t(`role.${tb.role}`) }), h('span', { className: 'name' }, tb.name), tb.blocked ? h('span', { className: 'n2s-badge err' }, t('policy.blocked')) : h('span', { className: 'n2s-faint n2s-small' }, tb.rows === null ? '' : formatCompact(tb.rows))))),
            h('div', { className: 'n2s-legend' }, ['fact', 'dimension', 'log', 'config'].map(r => h('span', { key: r }, h('span', { className: `n2s-roledot ${r}` }), t(`role.${r}`))))),
          tbl && h('div', { className: 'n2s-detail' },
            h('div', { className: 'n2s-detail-head' },
              h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                h('div', { className: 'n2s-row', style: { gap: 8 } }, h('span', { className: 'n2s-detail-title n2s-mono' }, tbl.name), roleBadge(t, tbl.role)),
                h('div', { className: 'n2s-list2-sub', style: { whiteSpace: 'normal' } }, [tbl.comment, tbl.rows !== null ? fmt(t, 'schema.rows', { rows: formatNumber(tbl.rows) }) : '', fmt(t, 'schema.colCount', { count: tbl.columns.length })].filter(Boolean).join(' · '))),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => runPreview(`SELECT * FROM ${quoteTable(tbl.name)} LIMIT 50`, `${tbl.name} · ${t('schema.preview')}`) }, Icon.table(13), t('schema.preview')),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => runOverview(tbl, false) }, Icon.chart(13), t('schema.overview')),
              h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => onAskTable(tbl) }, Icon.spark(13), t('schema.askAbout')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('schema.overviewPin'), icon: Icon.pin(14), onClick: async () => { if (await confirmDialog({ title: t('schema.overviewPinConfirm') })) runOverview(tbl, true) } },
                { label: t('schema.copyName'), icon: Icon.copy(14), onClick: () => navigator.clipboard?.writeText(tbl.name) },
              ] })),
            preview && h('div', { style: { marginBottom: 16 } },
              preview.busy && h('div', { className: 'n2s-skel', style: { height: 220 } }),
              preview.error && h('div', { className: 'n2s-notice err' }, preview.error),
              preview.result && h('div', { className: 'n2s-card' }, h(ResultView, { result: preview.result, t })),
              preview.overview && h(OverviewGrid, { t, results: preview.overview, pinned: preview.pinned })),
            h('div', { className: 'n2s-table-wrap', style: { maxHeight: 'none' } }, h('table', { className: 'n2s-table n2s-coltable' },
              h('thead', null, h('tr', null, [t('schema.th.name'), t('schema.th.type'), t('schema.th.meaning'), t('schema.th.values')].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', null, tbl.columns.map(c => h('tr', { key: c.name, style: c.hidden ? { opacity: 0.55 } : undefined },
                h('td', null, h('div', { className: 'n2s-row', style: { gap: 6, flexWrap: 'nowrap' } },
                  h('span', { className: 'n2s-mono', style: { color: 'var(--dsw-alias-label-primary)', textDecoration: c.hidden ? 'line-through' : undefined } }, c.name), keyIcon(c),
                  c.hidden && h('span', { className: 'n2s-badge err' }, t('policy.hidden')), c.policyMasked && h('span', { className: 'n2s-badge warn' }, t('policy.masked')))),
                h('td', { className: 'n2s-mono n2s-muted' }, c.columnType),
                h('td', { style: { whiteSpace: 'normal', maxWidth: 360 } },
                  h('div', { className: 'n2s-row', style: { gap: 4 } }, c.roles.filter(r => r !== 'text').map(r => h('span', { key: r, className: `n2s-badge ${r === 'sensitive' ? 'warn' : r === 'measure' || r === 'time' ? 'blue' : ''}` }, t(`col.${r}`))), c.comment && h('span', { className: 'n2s-muted' }, c.comment))),
                h('td', { className: 'n2s-muted', title: (c.values ?? []).map(v => `${v.value}(${v.count})`).join(', ') }, (c.values ?? []).slice(0, 4).map(v => `${v.value}`).join(' · '))))))),
            (tbl.indexes.length > 0 || rels2.length > 0) && h('div', { className: 'n2s-detail-meta' },
              tbl.indexes.length > 0 && h('div', null, h('div', { className: 'n2s-h2' }, t('schema.indexes')),
                h('div', { style: { display: 'grid', gap: 4 } }, tbl.indexes.map(i => h('div', { key: i.name, className: 'n2s-mono n2s-small' }, h('span', { className: 'n2s-muted' }, i.unique ? 'UNIQUE ' : ''), i.name, h('span', { className: 'n2s-faint' }, ` (${i.columns.join(', ')})`))))),
              rels2.length > 0 && h('div', null, h('div', { className: 'n2s-h2' }, t('schema.relationsOf')),
                h('div', { style: { display: 'grid', gap: 4 } }, rels2.map((r, i) => {
                  const other = r.to.table === tbl.name ? r.from.table : r.to.table
                  return h('div', { key: i, className: 'n2s-row n2s-small', style: { gap: 6 } },
                    h('span', { className: 'n2s-mono n2s-muted' }, `${r.from.table === tbl.name ? '' : `${r.from.table}.`}${r.from.column}`), h('span', { className: 'n2s-faint' }, '→'),
                    h('button', { type: 'button', className: 'n2s-linkbtn n2s-mono', onClick: () => { setSelected(other); setPreview(null) } }, `${r.to.table}.${r.to.column}`),
                    h('span', { className: `n2s-badge ${r.kind === 'declared' ? 'ok' : ''}` }, r.kind === 'declared' ? 'FK' : fmt(t, 'schema.inferred', { p: Math.round(r.confidence * 100) })))
                })))))))
    }
