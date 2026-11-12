    function PolicyEditor({ t, ds, onDone, onCancel }) {
      const schema = useAsync(() => (ds.schemaAnalyzedAt ? call('analyzeSchema', { id: ds.id }) : null), [ds.id])
      const [form, setForm] = useState(() => ({ mode: ds.policy?.mode ?? 'all', tables: (ds.policy?.tables ?? []).join('\n'), hiddenColumns: (ds.policy?.hiddenColumns ?? []).join('\n'), maskedColumns: (ds.policy?.maskedColumns ?? []).join('\n') }))
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const patterns = form.tables.split(/[\n,，]/).map(x => x.trim()).filter(Boolean)
      const globRe = (p) => { try { return new RegExp(`^${p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) } catch { return /(?!)/ } }
      const matches = (name) => patterns.some(p => { const re = globRe(p); return re.test(name.toLowerCase()) || (!p.includes('.') && re.test(name.toLowerCase().split('.').pop())) })
      const tables = schema.value?.tables ?? []
      const allowed = tables.filter(tb => form.mode === 'all' || (form.mode === 'allow' ? matches(tb.name) : !matches(tb.name)))
      const toggleTable = (name) => setForm(f => {
        const list = f.tables.split(/\n/).map(x => x.trim()).filter(Boolean)
        return { ...f, tables: (list.includes(name) ? list.filter(x => x !== name) : [...list, name]).join('\n') }
      })
      const save = async () => {
        setBusy(true); setError(null)
        try { await call('savePolicy', { id: ds.id, policy: form }); await refreshDatasources(); onDone() } catch (e) { setError(e.message) }
        setBusy(false)
      }
      const area = (key, label, ph) => h('label', { className: 'n2s-field' }, h('span', null, t(label)),
        h('textarea', { className: 'n2s-textarea n2s-mono', style: { minHeight: 90 }, spellCheck: false, value: form[key], placeholder: ph, onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) }))
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } }, h('span', { style: { fontWeight: 500 } }, `${t('policy.title')} · ${ds.name}`)),
        h('div', { className: 'n2s-notice', style: { marginBottom: 12 } }, t('policy.hint')),
        h('div', { className: 'n2s-field', style: { marginBottom: 12 } }, h('span', null, t('policy.mode')),
          h('div', { className: 'n2s-seg' }, ['all', 'allow', 'deny'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.mode === v, onClick: () => setForm(f => ({ ...f, mode: v })) }, t(`policy.mode.${v}`))))),
        h('div', { className: 'n2s-split', style: { minHeight: 0, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
          h('div', { style: { display: 'grid', gap: 10 } },
            form.mode !== 'all' && area('tables', form.mode === 'allow' ? 'policy.allowTables' : 'policy.denyTables', 'orders\\nods_*\\nsales.*'),
            area('hiddenColumns', 'policy.hiddenColumns', '*.salary\\nusers.id_card'),
            area('maskedColumns', 'policy.maskedColumns', 'users.phone\\n*.email')),
          h('div', null,
            h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 6 } }, tables.length ? fmt(t, 'policy.preview', { allowed: allowed.length, total: tables.length }) : t('schema.notAnalyzed')),
            h('div', { className: 'n2s-list', role: 'group', 'aria-label': t('policy.tablesLabel'), style: { maxHeight: 320 } }, tables.map(tb => {
              const ok = allowed.includes(tb)
              const editable = form.mode !== 'all'
              return h('div', {
                key: tb.name, className: 'n2s-item', style: { cursor: editable ? 'pointer' : 'default', opacity: ok ? 1 : 0.5 },
                role: 'checkbox', 'aria-checked': ok, 'aria-disabled': editable ? undefined : true, tabIndex: editable ? 0 : -1, 'aria-label': tb.name,
                onClick: () => editable && toggleTable(tb.name),
                onKeyDown: (e) => { if (editable && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleTable(tb.name) } },
              },
                h('span', { 'aria-hidden': true }, ok ? '✓' : '✕'), h('span', { className: 'name n2s-mono' }, tb.name), roleBadge(t, tb.role))
            })),
            form.mode !== 'all' && tables.length > 0 && h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 6 } }, t('policy.clickHint')))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, t('ds.save'))))
    }

    const RANGES = ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear', 'custom']
