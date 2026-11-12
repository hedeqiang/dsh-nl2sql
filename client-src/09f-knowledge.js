    function KnowledgeEditor({ kind, item, t, fields, schema, noteKeys, onCancel, onSave }) {
      const [form, setForm] = useState(() => ({ ...item, ...(Array.isArray(item?.synonyms) ? { synonyms: item.synonyms.join('，') } : {}) }))
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' }, fields.map(([key, label, type]) => h('label', { key, className: `n2s-field ${type === 'textarea' || type?.startsWith('code') ? 'full' : ''}` },
          h('span', null, t(label)),
          type === 'textarea' || type?.startsWith('code')
            ? h('textarea', { className: `n2s-textarea ${type?.startsWith('code') ? 'n2s-mono' : ''}`, style: type === 'codeLarge' ? { minHeight: 140 } : undefined, value: form[key] ?? '', spellCheck: type?.startsWith('code') ? false : undefined, onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })
            : h('input', { className: 'n2s-input', value: form[key] ?? '', list: type === 'table' ? 'n2s-tables' : type === 'noteKey' ? 'n2s-notekeys' : undefined, readOnly: kind === 'note' && key === 'key' && Boolean(item?.key) && Boolean(item?.text), onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })))),
        h('datalist', { id: 'n2s-tables' }, (schema?.tables ?? []).map(tb => h('option', { key: tb.name, value: tb.name }))),
        h('datalist', { id: 'n2s-notekeys' }, noteKeys.slice(0, 2000).map(k2 => h('option', { key: k2, value: k2 }))),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => onSave(form) }, t('ds.save'))))
    }

    function KnowledgeTab({ t, ds }) {
      const kb = useAsync(() => (ds ? call('getKnowledge', { datasourceId: ds.id }) : null), [ds?.id])
      const schema = useAsync(() => (ds?.schemaAnalyzedAt ? call('analyzeSchema', { id: ds.id }) : null), [ds?.id, ds?.schemaAnalyzedAt])
      const [section, setSection] = useState('glossary')
      const [editing, setEditing] = useState(null)
      const [error, setError] = useState(null)
      const [drafts, setDrafts] = useState(null)
      const noteKeys = useMemo(() => (schema.value?.tables ?? []).flatMap(tb => [tb.name, ...tb.columns.map(c => `${tb.name}.${c.name}`)]), [schema.value])
      const allDatasources = useStore(s2 => s2.datasources)
      const sgCount = useAsync(() => (ds ? call('suggestionCount', { datasourceId: ds.id }) : null), [ds?.id, kb.value])
      if (!ds) return null
      const k = kb.value ?? { glossary: [], metrics: [], notes: {}, examples: [] }
      const save = async (kind, item) => {
        setError(null)
        try { await call('saveKnowledgeItem', { datasourceId: ds.id, kind, item }); setEditing(null); kb.reload() } catch (e) { setError(e.message) }
      }
      const remove = async (kind, id) => {
        if (!await confirmDialog({ title: t('kb.deleteConfirm'), danger: true })) return
        await call('deleteKnowledgeItem', { datasourceId: ds.id, kind, id }).catch(e => setError(e.message))
        kb.reload()
      }
      const FIELDS = {
        glossary: [['term', 'kb.term'], ['synonyms', 'kb.synonyms'], ['definition', 'kb.definition', 'textarea'], ['sql', 'kb.sqlHint', 'code']],
        metric: [['name', 'kb.metricName'], ['unit', 'kb.unit'], ['expression', 'kb.expression', 'code'], ['table', 'kb.table', 'table'], ['timeColumn', 'kb.timeColumn'], ['filter', 'kb.filter', 'code'], ['dimensions', 'kb.dimensions'], ['synonyms', 'kb.synonyms'], ['description', 'kb.description', 'textarea']],
        example: [['question', 'kb.question'], ['sql', 'kb.sql', 'codeLarge'], ['note', 'kb.note', 'textarea']],
        note: [['key', 'kb.noteKey', 'noteKey'], ['text', 'kb.noteText', 'textarea']],
      }
      function renderEditor({ kind, item }) {
        return h(KnowledgeEditor, { key: JSON.stringify(item?.id ?? item?.key ?? 'new'), kind, item, t, fields: FIELDS[kind], schema: schema.value, noteKeys, onCancel: () => setEditing(null), onSave: (form) => save(kind, form) })
      }
      const sections = [['glossary', 'kb.glossary', k.glossary.length], ['metric', 'kb.metrics', k.metrics.length], ['note', 'kb.notes', Object.keys(k.notes).length], ['example', 'kb.examples', k.examples.length], ['suggest', 'sg.section', sgCount.value?.count ?? 0], ['eval', 'ev.section', null], ['feedback', 'fb.section', null]]
      const empty = (text) => h('div', { className: 'n2s-empty' }, h('div', null, text), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({ kind: section, item: section === 'note' ? { key: '', text: '' } : {} }) }, t('kb.add')))
      const item = (key, title, sub, kind, data, extra) => h('div', { key, className: 'n2s-list2-row n2s-kbrow', style: { alignItems: 'flex-start' } },
        h('div', { className: 'n2s-grow', style: { minWidth: 0 } }, h('div', { className: 'n2s-list2-title', style: { whiteSpace: 'normal' } }, title), h('div', { className: 'n2s-kbsub' }, sub)),
        extra,
        h('div', { className: 'n2s-row n2s-kbactions', style: { gap: 2, flexWrap: 'nowrap' } },
          h('button', { type: 'button', className: 'n2s-iconbtn', title: t('ds.edit'), 'aria-label': t('ds.edit'), onClick: () => setEditing({ kind, item: data }) }, Icon.edit(14)),
          h('button', { type: 'button', className: 'n2s-iconbtn danger', title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => remove(kind, kind === 'note' ? data.key : data.id) }, Icon.trash(14))))
      const listWrap = (rows) => Array.isArray(rows) ? h('div', { className: 'n2s-list2' }, rows) : rows
      let list
      if (section === 'glossary') list = k.glossary.length ? k.glossary.map(g => item(g.id, h(React.Fragment, null, g.term, g.synonyms?.length ? h('span', { className: 'n2s-muted n2s-small' }, `  ${g.synonyms.join(' / ')}`) : null),
        h('div', null, h('div', null, g.definition), g.sql && h('code', { className: 'n2s-md-code', style: { display: 'inline-block', marginTop: 6 } }, g.sql)), 'glossary', g)) : empty(t('kb.glossaryEmpty'))
      if (section === 'metric') list = k.metrics.length ? k.metrics.map(m => item(m.id, h(React.Fragment, null, m.name, m.unit ? h('span', { className: 'n2s-badge', style: { marginLeft: 6 } }, m.unit) : null),
        h('div', null, h('div', { className: 'n2s-mono n2s-small' }, `${m.expression}${m.table ? ` FROM ${m.table}` : ''}${m.filter ? ` WHERE ${m.filter}` : ''}`), m.timeColumn && h('div', { className: 'n2s-muted n2s-small' }, `${t('kb.timeColumn')}: ${m.timeColumn}${m.dimensions?.length ? ` · ${t('kb.dimensions')}: ${m.dimensions.join('、')}` : ''}${m.synonyms?.length ? ` · ${t('kb.synonymsLabel')}: ${m.synonyms.join('、')}` : ''}`), m.description && h('div', { className: 'n2s-muted n2s-small' }, m.description)), 'metric', m)) : empty(t('kb.metricsEmpty'))
      if (section === 'note') {
        const entries = Object.entries(k.notes).sort(([a], [b]) => a.localeCompare(b))
        list = h(React.Fragment, null,
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('kb.notesHint')),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: async () => setDrafts(await call('draftNotes', { datasourceId: ds.id }).catch(e => { setError(e.message); return [] })) }, t('kb.draft'))),
          drafts && h('div', { className: 'n2s-card', style: { marginBottom: 10 } },
            h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 500 } }, fmt(t, 'kb.drafts', { count: drafts.length })), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setDrafts(null) }, '×')),
            drafts.length === 0 ? h('div', { className: 'n2s-muted n2s-small' }, t('kb.noDrafts')) :
              drafts.map(d => h('div', { key: d.key, className: 'n2s-row', style: { padding: '4px 0' } }, h('span', { className: 'n2s-mono n2s-small', style: { minWidth: 220 } }, d.key), h('span', { className: 'n2s-muted n2s-small n2s-grow' }, d.text),
                h('button', { type: 'button', className: 'n2s-btn small', onClick: () => { setDrafts(x => x.filter(y => y.key !== d.key)); setEditing({ kind: 'note', item: d }) } }, t('ds.edit'))))),
          entries.length ? listWrap(entries.map(([key, text]) => item(key, h('span', { className: 'n2s-mono' }, key), h('div', null, text), 'note', { key, text }))) : empty(t('kb.notesEmpty')))
      }
      if (section === 'example') list = k.examples.length ? [...k.examples].reverse().map(e => item(e.id, e.question, h('pre', { className: 'n2s-code', style: { marginTop: 8, maxHeight: 160 } }, prettySql(e.sql)), 'example', e)) : empty(t('kb.examplesEmpty'))
      return h('div', null,
        h(SectionHead, { title: t('tab.knowledge'), desc: t('kb.hint') },
          h(KnowledgeIO, { t, ds, datasources: allDatasources, onImported: () => kb.reload() }),
          section !== 'feedback' && section !== 'eval' && section !== 'suggest' && h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({ kind: section, item: section === 'note' ? { key: '', text: '' } : {} }) }, '+ ', t('kb.add'))),
        h('div', { className: 'n2s-subtabs', role: 'tablist' }, sections.map(([key, label, count]) => h('button', { key, type: 'button', role: 'tab', 'aria-selected': section === key, onClick: () => { setSection(key); setEditing(null) } }, t(label), count === null ? null : h('span', { className: 'count' }, count)))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 10 } }, error),
        editing && h('div', { style: { marginBottom: 12 } }, renderEditor(editing)),
        section === 'suggest' ? h(SuggestionsSection, { t, ds, fields: FIELDS, schema: schema.value, noteKeys, onChanged: () => kb.reload() }) : section === 'feedback' ? h(FeedbackSection, { t, ds }) : section === 'eval' ? h(EvalSection, { t, ds }) : listWrap(list))
    }
