    function HistoryTab({ t, datasources, onOpenSession }) {
      const [filters, setFilters] = useState({ status: '', source: '', datasourceId: '', search: '' })
      const list = useAsync(() => call('listHistory', { ...filters, limit: 300 }), [filters.status, filters.source, filters.datasourceId, filters.search])
      const [open, setOpen] = useState(null)
      const [rerun, setRerun] = useState(null)
      const [removed, setRemoved] = useState(() => new Set())
      useEffect(() => { setRemoved(new Set()) }, [list.value])
      const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))
      const rows = (list.value ?? []).filter(r => !removed.has(r.id))
      const removeRow = async (r) => {
        if (!await confirmDialog({ title: t('hist.deleteOne'), message: r.title || oneLine(r.sql).slice(0, 120), confirmLabel: t('ds.delete'), danger: true })) return
        setRemoved(x => new Set(x).add(r.id))
        if (open === r.id) setOpen(null)
        try { await call('deleteHistory', { id: r.id }); notify(t('hist.deleted'), 'ok') } catch (e) { notifyError(e); setRemoved(x => { const n = new Set(x); n.delete(r.id); return n }) }
      }
      const statusBadge = (s) => h('span', { className: `n2s-badge ${s === 'error' ? 'err' : s === 'blocked' ? 'warn' : 'ok'}` }, t(`hist.status.${s ?? 'ok'}`))
      const exportCsv = () => {
        const cols = ['time', 'datasource', 'source', 'status', 'title', 'rows', 'elapsedMs', 'sessionId', 'sql', 'error']
        const esc = (v) => { const x = v === undefined || v === null ? '' : String(v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x }
        const text = '\ufeff' + [cols.join(','), ...rows.map(r => [new Date(r.at).toISOString(), r.datasourceName ?? r.datasourceId, r.source, r.status ?? 'ok', r.title, r.rows, r.elapsedMs, r.sessionId, r.sql, r.error].map(esc).join(','))].join('\r\n')
        download(`nl2sql-audit-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }))
      }
      const stats = useMemo(() => {
        const ok = rows.filter(r => (r.status ?? 'ok') === 'ok')
        return { total: rows.length, errors: rows.filter(r => r.status === 'error').length, blocked: rows.filter(r => r.status === 'blocked').length, avg: ok.length ? Math.round(ok.reduce((a, r) => a + (r.elapsedMs ?? 0), 0) / ok.length) : 0 }
      }, [rows])
      const [search, setSearch] = useState('')
      useEffect(() => { const id = setTimeout(() => setFilters(f => (f.search === search ? f : { ...f, search })), 250); return () => clearTimeout(id) }, [search])
      const rel = (at) => {
        const d = (Date.now() - at) / 1000
        if (d < 60) return t('time.justNow')
        if (d < 3600) return fmt(t, 'time.minAgo', { n: Math.floor(d / 60) })
        if (d < 86400) return fmt(t, 'time.hourAgo', { n: Math.floor(d / 3600) })
        return new Date(at).toLocaleDateString()
      }
      const statusDot = (st) => h('span', { className: `n2s-statusdot ${st === 'error' ? 'err' : st === 'blocked' ? 'warn' : 'ok'}` }, t(`hist.status.${st ?? 'ok'}`))
      const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim()
      return h('div', null,
        h('div', { className: 'n2s-stats' },
          [['hist.total', stats.total], ['hist.errors', stats.errors], ['hist.blocked', stats.blocked], ['hist.avg', `${stats.avg} ms`]].map(([k2, v]) => h('div', { key: k2, className: 'n2s-stat' }, h('div', { className: 'v' }, v), h('div', { className: 'k' }, t(k2))))),
        h('div', { className: 'n2s-toolbar' },
          h('div', { className: 'n2s-search' }, h('span', { className: 'n2s-ico' }, Icon.search()), h('input', { className: 'n2s-input', 'aria-label': t('hist.search'), placeholder: t('hist.search'), value: search, onChange: e => setSearch(e.target.value) })),
          h('select', { className: 'n2s-select inline', 'aria-label': t('hist.allSources'), value: filters.datasourceId, onChange: set('datasourceId') }, h('option', { value: '' }, t('hist.allSources')), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name))),
          h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('hist.allStatus') }, ['', 'ok', 'error', 'blocked'].map(v => h('button', { key: v || 'all', type: 'button', 'aria-pressed': filters.status === v, onClick: () => setFilters(f => ({ ...f, status: v })) }, v ? t(`hist.status.${v}`) : t('hist.all')))),
          h('select', { className: 'n2s-select inline', 'aria-label': t('hist.allSource'), value: filters.source, onChange: set('source') }, ['', 'agent', 'ui', 'dashboard', 'alert', 'eval'].map(v => h('option', { key: v, value: v }, v ? t(`hist.source.${v}`) : t('hist.allSource')))),
          h('span', { className: 'n2s-grow' }),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
            { label: t('hist.export'), icon: Icon.download(14), disabled: rows.length === 0, onClick: exportCsv },
            { divider: true },
            { label: t('hist.clear'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: t('hist.clearConfirm'), danger: true })) { await call('clearHistory'); list.reload() } } },
          ] })),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        list.loading && !list.value && h('div', { className: 'n2s-skel', style: { height: 240 } }),
        !list.loading && rows.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('hist.empty')), h('div', null, t('hist.emptyHint'))),
        rows.length > 0 && h('div', { className: 'n2s-hist', role: 'list' }, rows.map(r => {
          const isOpen = open === r.id
          return h('div', { key: r.id ?? `${r.at}`, className: 'n2s-hist-row', role: 'listitem' },
            h('div', { className: 'n2s-hist-head' },
            h('button', { type: 'button', className: 'n2s-hist-main', 'aria-expanded': isOpen, onClick: () => setOpen(isOpen ? null : r.id) },
              statusDot(r.status),
              h('span', { className: 'n2s-hist-what' },
                h('span', { className: `n2s-hist-title ${r.title ? '' : 'none'}` }, r.title || r.error?.slice(0, 80) || t('hist.untitled')),
                h('span', { className: 'n2s-hist-sql', title: oneLine(r.sql).slice(0, 400) }, oneLine(r.sql).slice(0, 300))),
              h('span', { className: 'n2s-hist-when' }, h('span', { title: new Date(r.at).toLocaleString() }, rel(r.at)), h('span', { className: 'src' }, `${t(`hist.source.${r.source}`)} · ${r.datasourceName ?? ''}`)),
              h('span', { className: 'n2s-hist-num' }, r.rows !== undefined ? fmt(t, 'result.rows', { count: r.rows }) : '—', h('br'), r.elapsedMs !== undefined ? `${r.elapsedMs} ms` : ''),
              h('span', { className: 'n2s-hist-chev' }, Icon.chev(12))),
            h('button', { type: 'button', className: 'n2s-iconbtn n2s-rowdel', title: t('hist.deleteOne'), 'aria-label': `${t('hist.deleteOne')}: ${r.title || t('hist.untitled')}`, onClick: () => removeRow(r) }, Icon.trash(14))),
            isOpen && h('div', { className: 'n2s-hist-detail' },
              r.error && h('div', { className: `n2s-notice ${r.status === 'blocked' ? 'warn' : 'err'}` }, r.error),
              h('div', { style: { position: 'relative' } },
                h('pre', { className: 'n2s-code', style: { maxHeight: 220, paddingRight: 44 } }, prettySql(r.sql)),
                h('button', { type: 'button', className: 'n2s-iconbtn', style: { position: 'absolute', top: 6, right: 6 }, title: t('result.copy'), 'aria-label': t('result.copy'), onClick: () => navigator.clipboard?.writeText(r.sql) }, Icon.copy(14))),
              h('div', { className: 'n2s-row' },
                h('span', { className: 'n2s-faint n2s-small n2s-grow' }, new Date(r.at).toLocaleString()),
                r.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onOpenSession(r.sessionId) }, Icon.external(13), t('hist.openSession')),
                h('button', {
                  type: 'button', className: 'n2s-btn small',
                  onClick: async () => {
                    setRerun({ id: r.id, busy: true })
                    try { setRerun({ id: r.id, result: await call('runQuery', { sql: r.sql, datasourceId: r.datasourceId, title: r.title, confirmScan: r.status !== 'blocked' }) }) } catch (e) { setRerun({ id: r.id, error: e.message }) }
                  },
                }, Icon.refresh(13), t('result.rerun')),
                h('button', { type: 'button', className: 'n2s-btn small ghost danger-text', onClick: () => removeRow(r) }, Icon.trash(13), t('ds.delete'))),
              rerun?.id === r.id && (rerun.busy ? h('div', { className: 'n2s-skel', style: { height: 200 } }) : rerun.error ? h('div', { className: 'n2s-notice err' }, rerun.error) : h('div', { className: 'n2s-card' }, h(ResultView, { result: rerun.result, t, hideSql: true })))))
        })))
    }
