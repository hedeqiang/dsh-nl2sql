    // -------------------------------------------------- knowledge io

    function KnowledgeIO({ t, ds, datasources, onImported }) {
      const fileRef = useRef(null)
      const [state, setState] = useState(null)
      const doExport = async (all) => {
        const data = await call('exportKnowledge', all ? {} : { datasourceId: ds.id })
        download(`knowledge-${all ? 'all' : safeName(ds.name)}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      }
      const onFile = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          const text = await f.text()
          const doc = JSON.parse(text)
          const single = doc.datasources?.length === 1
          const dry = await call('importKnowledge', { data: doc, targetDatasourceId: single ? ds.id : undefined, dryRun: true })
          setState({ doc, single, dry })
        } catch (err) { setState({ error: err.message }) }
      }
      const apply = async (mode) => {
        try { const r = await call('importKnowledge', { data: state.doc, targetDatasourceId: state.single ? ds.id : undefined, mode }); setState({ done: r }); onImported() } catch (err) { setState({ error: err.message }) }
      }
      return h(React.Fragment, null,
        h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onChange: onFile }),
        h(Dropdown, { label: t('kb.io'), trigger: { className: 'n2s-btn', content: h(React.Fragment, null, t('kb.io'), Icon.chev(10)) }, items: [
          { label: t('kb.exportThis'), icon: Icon.download(14), onClick: () => doExport(false) },
          datasources.length > 1 && { label: t('kb.exportAll'), icon: Icon.download(14), onClick: () => doExport(true) },
          { divider: true },
          { label: t('kb.import'), icon: Icon.up(14), onClick: () => fileRef.current?.click() },
        ] }),
        state && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) setState(null) } },
          h('div', { className: 'n2s-modal', role: 'dialog', 'aria-modal': true },
            h('div', { className: 'n2s-modal-title', style: { marginBottom: 10 } }, t('kb.import')),
            state.error && h('div', { className: 'n2s-notice err' }, state.error),
            state.dry && h(React.Fragment, null,
              h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 8 } }, state.single ? fmt(t, 'kb.importInto', { name: ds.name }) : t('kb.importByName')),
              h('table', { className: 'n2s-table' }, h('thead', null, h('tr', null, [t('kb.src'), t('kb.target'), t('kb.glossary'), t('kb.metrics'), t('kb.notes'), t('kb.examples'), t('kb.invalid')].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', null, state.dry.report.map((r, i) => h('tr', { key: i }, h('td', null, r.source), h('td', null, r.target ?? h('span', { style: { color: 'var(--n2s-err)' } }, r.skipped)), h('td', null, r.glossary ?? '—'), h('td', null, r.metrics ?? '—'), h('td', null, r.notes ?? '—'), h('td', null, r.examples ?? '—'), h('td', null, r.invalid ?? '—'))))),
              h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
                h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => setState(null) }, t('ds.cancel')),
                h('button', { type: 'button', className: 'n2s-btn danger', onClick: async () => { if (await confirmDialog({ title: t('kb.replaceConfirm'), danger: true })) apply('replace') } }, t('kb.replace')),
                h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => apply('merge') }, t('kb.merge')))),
            state.done && h(React.Fragment, null, h('div', { className: 'n2s-notice ok' }, t('kb.imported')), h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setState(null) }, t('ds.close')))))), document.body))
    }

