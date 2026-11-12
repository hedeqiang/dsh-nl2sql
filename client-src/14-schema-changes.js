    // ---------------------------------------------------- schema changes

    function SchemaChanges({ t, ds }) {
      const list = useAsync(() => call('listSchemaChanges', { datasourceId: ds.id }), [ds.id, ds.schemaAnalyzedAt])
      const open = (list.value ?? []).filter(c => c.status === 'open')
      if (!open.length) return null
      const kindLabel = (k) => t(`sc.${k}`)
      return h('div', { className: 'n2s-notice warn', style: { marginBottom: 14 } },
        open.slice(0, 3).map(c => h('div', { key: c.id, style: { marginBottom: 6 } },
          h('div', { className: 'n2s-row' }, h('strong', null, fmt(t, 'sc.title', { count: c.changes.length, time: new Date(c.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })), h('span', { className: 'n2s-grow' }),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: async () => { await call('ackSchemaChange', { id: c.id }); list.reload() } }, t('sc.ack'))),
          h('div', { className: 'n2s-small', style: { marginTop: 4 } }, c.changes.slice(0, 8).map(x => `${kindLabel(x.kind)} ${x.table}${x.column ? `.${x.column}` : ''}${x.detail ? `（${x.detail}）` : ''}`).join('；')),
          c.impacts.length > 0 && h('div', { className: 'n2s-small', style: { marginTop: 4 } }, h('strong', null, `${colon(t('sc.impacts'))}`), c.impacts.slice(0, 8).map(i => `${t(`sc.imp.${i.kind}`)}「${i.name}」`).join(uiLang === 'zh' ? '、' : ', ')))))
    }

