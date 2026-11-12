    // -------------------------------------------------- knowledge suggestions
    // Candidate knowledge mined from history and feedback (service/suggestions.js),
    // shown in the 业务知识 → 建议 section for a human to accept or dismiss.

    const SUGGEST_KINDS = ['example', 'metric', 'note', 'glossary']

    function suggestionTitle(s) {
      const it = s.item ?? {}
      if (s.kind === 'example') return it.question
      if (s.kind === 'metric') return it.name
      if (s.kind === 'note') return it.key
      return it.term
    }

    function SuggestionBody({ t, s }) {
      const it = s.item ?? {}
      if (s.kind === 'example') return h('pre', { className: 'n2s-code', style: { marginTop: 6, maxHeight: 140 } }, prettySql(it.sql ?? ''))
      if (s.kind === 'metric') return h('div', null,
        h('div', { className: 'n2s-mono n2s-small' }, `${it.expression}${it.table ? ` FROM ${it.table}` : ''}${it.filter ? ` WHERE ${it.filter}` : ''}`),
        (it.timeColumn || it.dimensions?.length) && h('div', { className: 'n2s-muted n2s-small' }, [it.timeColumn && `${t('kb.timeColumn')}: ${it.timeColumn}`, it.dimensions?.length && `${t('kb.dimensions')}: ${it.dimensions.join(uiLang === 'zh' ? '、' : ', ')}`].filter(Boolean).join(' · ')))
      if (s.kind === 'note') return h('div', { className: 'n2s-small' }, it.text)
      return h('div', null, h('div', { className: 'n2s-small' }, it.definition), it.sql && h('code', { className: 'n2s-md-code', style: { display: 'inline-block', marginTop: 4 } }, it.sql))
    }

    /** Editor-ready copy of a suggested item (arrays the editor shows as text). */
    function suggestionForm(s) {
      const it = { ...(s.item ?? {}) }
      if (Array.isArray(it.dimensions)) it.dimensions = it.dimensions.join('，')
      return it
    }

    function SuggestionsSection({ t, ds, fields, schema, noteKeys, onChanged }) {
      const list = useAsync(() => call('listKnowledgeSuggestions', { datasourceId: ds.id }), [ds.id])
      const [editing, setEditing] = useState(null)
      const [busy, setBusy] = useState(null)
      const items = list.value?.suggestions ?? []
      const done = () => { list.reload(); onChanged?.() }
      const accept = async (s, item) => {
        setBusy(s.id)
        try {
          await call('acceptSuggestion', { datasourceId: ds.id, id: s.id, ...(item ? { item } : {}) })
          setEditing(null)
          notify(t('sg.accepted'), 'ok')
          done()
        } catch (e) { notifyError(e) } finally { setBusy(null) }
      }
      const dismiss = async (s) => {
        if (!await confirmDialog({ title: t('sg.dismissConfirm'), confirmLabel: t('sg.dismiss') })) return
        setBusy(s.id)
        try { await call('dismissSuggestion', { datasourceId: ds.id, id: s.id }); notify(t('sg.dismissed')); done() } catch (e) { notifyError(e) } finally { setBusy(null) }
      }
      const card = (s) => h('div', { key: s.id, className: 'n2s-card n2s-sgcard', 'data-sg': s.id },
        h('div', { className: 'n2s-row', style: { alignItems: 'flex-start' } },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } },
              h('span', { style: { fontWeight: 500, wordBreak: 'break-all' } }, suggestionTitle(s)),
              h('span', { className: `n2s-badge ${s.score >= 0.8 ? 'ok' : s.score >= 0.5 ? 'blue' : ''}` }, fmt(t, 'sg.score', { score: `${Math.round(s.score * 100)}%` }))),
            h('div', { style: { marginTop: 4 } }, h(SuggestionBody, { t, s })),
            h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 6 } }, s.reason),
            s.evidence?.length > 0 && h('details', { style: { marginTop: 6 } },
              h('summary', { className: 'n2s-small', style: { cursor: 'pointer' } }, fmt(t, 'sg.evidence', { count: s.evidence.length })),
              s.evidence.map((ev, i) => h('div', { key: i, style: { marginTop: 6 } },
                h('div', { className: 'n2s-small' }, h('span', { className: 'n2s-badge', style: { marginRight: 6 } }, ['feedback', 'agent', 'ui'].includes(ev.source) ? t(`sg.src.${ev.source}`) : ev.source), ev.question || '—', h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, ev.at ? new Date(ev.at).toLocaleString() : '')),
                h('pre', { className: 'n2s-code', style: { marginTop: 4, maxHeight: 120 } }, ev.sql))))),
          h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy === s.id, onClick: () => setEditing(s) }, t('sg.accept')),
            h(Dropdown, { label: t('sg.acceptDirect'), trigger: { className: 'n2s-iconbtn', content: Icon.chev(10) }, items: [
              { label: t('sg.acceptEdit'), icon: Icon.edit(14), onClick: () => setEditing(s) },
              { label: t('sg.acceptDirect'), icon: Icon.check(14), onClick: () => accept(s) },
            ] }),
            h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: busy === s.id, onClick: () => dismiss(s) }, t('sg.dismiss')))),
        editing?.id === s.id && h('div', { style: { marginTop: 10 } },
          h(KnowledgeEditor, { key: s.id, kind: s.kind, item: suggestionForm(s), t, fields: fields[s.kind], schema, noteKeys, onCancel: () => setEditing(null), onSave: (form) => accept(s, form) })))
      return h('div', null,
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('sg.hint')),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => list.reload() }, t('sg.refresh'))),
        list.error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, list.error.message),
        !list.loading && !list.error && items.length === 0 && h('div', { className: 'n2s-empty' },
          h('div', { style: { fontWeight: 500 } }, t('sg.empty')),
          h('div', { className: 'n2s-muted n2s-small', style: { maxWidth: 560, marginTop: 6 } }, t('sg.emptyHint'))),
        SUGGEST_KINDS.map(kind => {
          const group = items.filter(s => s.kind === kind)
          if (!group.length) return null
          return h('div', { key: kind, style: { marginBottom: 16 } },
            h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 600 } }, t(`sg.kind.${kind}`)), h('span', { className: 'n2s-badge' }, group.length)),
            h('div', { className: 'n2s-cards' }, group.map(card)))
        }))
    }
