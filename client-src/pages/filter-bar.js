    function FilterBar({ t, filters, onChange }) {
      const cand = useAsync(() => call('filterCandidates'), [])
      const time = filters.find(f => f.kind === 'time')
      const ins = filters.filter(f => f.kind === 'in')
      const [adding, setAdding] = useState('')
      const setTime = (patch) => {
        const next = patch === null ? null : { kind: 'time', column: time?.column ?? cand.value?.time[0]?.column ?? 'created_at', range: 'last30d', ...time, ...patch }
        onChange([...(next ? [next] : []), ...ins])
      }
      // keep: an emptied free-text field keeps its tag (with no values) instead of disappearing.
      const setIn = (column, values, keep) => {
        const others = ins.filter(f => f.column !== column)
        const at = ins.findIndex(f => f.column === column)
        const mine = values.length || keep ? [{ kind: 'in', column, values }] : []
        const next = at < 0 ? [...others, ...mine] : [...others.slice(0, at), ...mine, ...others.slice(at)]
        onChange([...(time ? [time] : []), ...next])
      }
      const c = cand.value ?? { time: [], dims: [] }
      const activeN = filters.filter(f => f.kind !== 'in' || f.values.length > 0).length
      return h('div', { className: 'n2s-filterbar', role: 'group', 'aria-label': t('filter.title') },
        h('span', { className: 'n2s-faint', style: { display: 'inline-flex' } }, svg(14, [h('path', { key: 1, d: 'M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5L2.5 3.5z' })])),
        h('select', { className: 'n2s-select', value: time ? time.range : '', onChange: e => setTime(e.target.value ? { range: e.target.value } : null), 'aria-label': t('filter.range') },
          h('option', { value: '' }, t('filter.noTime')), RANGES.map(r => h('option', { key: r, value: r }, t(`filter.range.${r}`)))),
        time && c.time.length > 1 && h('select', { className: 'n2s-select', value: time.column, onChange: e => setTime({ column: e.target.value }), 'aria-label': t('filter.timeColumn') },
          c.time.map(x => h('option', { key: x.column, value: x.column }, x.label === x.column ? x.column : x.label))),
        time?.range === 'custom' && h(React.Fragment, null,
          h('input', { className: 'n2s-input', type: 'date', 'aria-label': t('filter.from'), value: time.from ?? '', onChange: e => setTime({ from: e.target.value }) }),
          h('span', { className: 'n2s-faint' }, '–'),
          h('input', { className: 'n2s-input', type: 'date', 'aria-label': t('filter.to'), value: time.to ?? '', onChange: e => setTime({ to: e.target.value }) })),
        ins.map(f => {
          const dim = c.dims.find(d => d.column === f.column)
          return h('span', { key: f.column, className: 'n2s-ftag' },
            h('span', { className: 'n2s-muted' }, dim?.label ?? f.column),
            dim?.values?.length
              ? h('select', { className: 'n2s-select', 'aria-label': dim.label, value: f.values[0] ?? '', onChange: e => setIn(f.column, e.target.value ? [e.target.value] : []) }, dim.values.map(v => h('option', { key: v, value: v }, v)))
              : h(FilterValuesInput, { key: f.column, t, label: dim?.label ?? f.column, values: f.values, onCommit: (values) => setIn(f.column, values, true) }),
            h('button', { type: 'button', className: 'n2s-iconbtn', style: { width: 22, height: 22 }, 'aria-label': t('filter.remove'), onClick: () => setIn(f.column, []) }, Icon.close(11)))
        }),
        c.dims.filter(d => !ins.some(f => f.column === d.column)).length > 0 && h(Dropdown, {
          label: t('filter.add'), align: 'start',
          trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, '+ ', t('filter.addShort')) },
          items: c.dims.filter(d => !ins.some(f => f.column === d.column)).map(d => ({ label: d.label === d.column ? d.column : `${d.label}`, hint: d.label === d.column ? '' : d.column, onClick: () => setIn(d.column, d.values?.slice(0, 1) ?? []) })),
        }),
        h('span', { className: 'n2s-grow' }),
        activeN > 0 && h('span', { className: 'n2s-faint n2s-small', title: t('filter.hint') }, fmt(t, 'filter.activeN', { count: activeN })),
        filters.length > 0 && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onChange([]) }, t('filter.clear')))
    }

    /**
     * Free-text values of an "in" filter: typed into a local draft (commas allowed,
     * clearing does not remove the tag) and committed on Enter, blur or after a pause.
     */
    function FilterValuesInput({ t, label, values, onCommit }) {
      const joined = values.join(', ')
      const [draft, setDraft] = useState(joined)
      const committed = useRef(joined)
      // Adopt outside changes (clear all, another board) when not mid-edit.
      useEffect(() => { if (joined !== committed.current) { committed.current = joined; setDraft(joined) } }, [joined])
      const parse = (s) => s.split(/[,，]/).map(x => x.trim()).filter(Boolean)
      const commit = (s) => {
        const next = parse(s)
        if (next.join('\u0000') === parse(committed.current).join('\u0000')) return
        committed.current = next.join(', ')
        onCommit(next)
      }
      useEffect(() => {
        if (draft === committed.current) return
        const id = setTimeout(() => commit(draft), 800)
        return () => clearTimeout(id)
      }, [draft])
      return h('input', {
        className: 'n2s-input', style: { width: 120, height: 26, border: 0 }, 'aria-label': label, placeholder: t('filter.valuesPh'), value: draft,
        onChange: e => setDraft(e.target.value),
        onBlur: () => commit(draft),
        onKeyDown: (e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); commit(draft) } },
      })
    }
