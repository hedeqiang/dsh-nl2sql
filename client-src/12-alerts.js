    // ------------------------------------------------------------ alerts

    function AlertForm({ t, initial, datasources, ds, onDone, onCancel }) {
      const channels = useChannels()
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id, source: 'metric', metric: '', grain: 'day', sql: '', every: 'hour', at: '09:00', cooldownMin: 60, channelId: channels.find(c => c.isDefault)?.id ?? '', mention: false, enabled: true, ...(initial ?? {}), condition: { type: 'change', direction: 'any', pct: 20, ...(initial?.condition ?? {}) } }))
      const k = useAsync(() => (form.datasourceId ? call('getKnowledge', { datasourceId: form.datasourceId }) : null), [form.datasourceId])
      const [error, setError] = useState(null)
      const [test, setTest] = useState(null)
      const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const setC = (patch) => setForm(f => ({ ...f, condition: { ...f.condition, ...patch } }))
      const metrics = k.value?.metrics ?? []
      const save = async () => {
        setError(null)
        try { await call('saveAlert', { ...form, cooldownMin: Number(form.cooldownMin) }); onDone() } catch (e) { setError(e.message) }
      }
      const tryIt = async () => {
        if (test?.busy) return
        setTest({ busy: true })
        try { setTest(await call('previewAlert', { ...form, cooldownMin: Number(form.cooldownMin) })) } catch (e) { setTest({ error: e.message }) }
      }
      const c = form.condition
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('al.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('al.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('al.source')), h('div', { className: 'n2s-seg' }, ['metric', 'sql'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.source === v, onClick: () => setForm(f => ({ ...f, source: v })) }, t(`al.src.${v}`))))),
          form.source === 'metric' ? h(React.Fragment, null,
            h('label', { className: 'n2s-field' }, h('span', null, t('al.metric')), metrics.length ? h('select', { className: 'n2s-select', value: form.metric, onChange: set('metric') }, h('option', { value: '' }, '—'), metrics.map(m => h('option', { key: m.id, value: m.name }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics'))),
            h('label', { className: 'n2s-field' }, h('span', null, t('al.grain')), h('select', { className: 'n2s-select', value: form.grain, onChange: set('grain') }, ['hour', 'day', 'week', 'month'].map(g => h('option', { key: g, value: g }, t(`al.grain.${g}`))))))
            : h('label', { className: 'n2s-field full' }, h('span', null, t('al.sql')), h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, value: form.sql, onChange: set('sql'), placeholder: "SELECT DATE(created_at) AS d, COUNT(*) AS n FROM orders GROUP BY d ORDER BY d" })),
          h('div', { className: 'n2s-field full' }, h('span', null, t('al.condition')),
            h('div', { className: 'n2s-row' },
              h('select', { className: 'n2s-select inline', value: c.type, onChange: e => setC({ type: e.target.value }) }, ['change', 'threshold', 'anomaly', 'missing'].map(v => h('option', { key: v, value: v }, t(`al.cond.${v}`)))),
              c.type === 'threshold' && h(React.Fragment, null,
                h('select', { className: 'n2s-select inline', value: c.op ?? '>', onChange: e => setC({ op: e.target.value }) }, ['>', '>=', '<', '<=', '==', '!='].map(o => h('option', { key: o, value: o }, o))),
                h('input', { className: 'n2s-input', type: 'number', style: { width: 140 }, value: c.value ?? 0, onChange: e => setC({ value: Number(e.target.value) }) })),
              c.type === 'change' && h(React.Fragment, null,
                h('select', { className: 'n2s-select inline', value: c.direction ?? 'any', onChange: e => setC({ direction: e.target.value }) }, ['any', 'up', 'down'].map(o => h('option', { key: o, value: o }, t(`al.dir.${o}`)))),
                h('input', { className: 'n2s-input', type: 'number', style: { width: 90 }, value: c.pct ?? 20, onChange: e => setC({ pct: Number(e.target.value) }) }), h('span', { className: 'n2s-muted' }, '%')),
              c.type === 'anomaly' && h(React.Fragment, null, h('span', { className: 'n2s-muted n2s-small' }, 'Z ≥'), h('input', { className: 'n2s-input', type: 'number', step: 0.5, style: { width: 80 }, value: c.z ?? 3, onChange: e => setC({ z: Number(e.target.value) }) }), h('span', { className: 'n2s-faint n2s-small' }, t('al.anomalyHint')))),
            h('span', { className: 'n2s-faint n2s-small' }, t(`al.condHint.${c.type}`))),
          h('label', { className: 'n2s-field' }, h('span', null, t('al.every')), h('select', { className: 'n2s-select', value: form.every, onChange: set('every') }, ['15m', 'hour', 'day'].map(v => h('option', { key: v, value: v }, t(`al.every.${v}`))))),
          form.every === 'day' ? h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.at, onChange: set('at') })) : h('label', { className: 'n2s-field' }, h('span', null, t('al.cooldown')), h('input', { className: 'n2s-input', type: 'number', value: form.cooldownMin, onChange: set('cooldownMin') })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-al-channel', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-al-channel', value: form.channelId ?? '', noneLabel: t('al.noPush'), onChange: (v) => setForm(f => ({ ...f, channelId: v })) })),
          h('label', { className: 'n2s-check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: form.mention, onChange: set('mention') }), t('al.mentionAll'))),
        test && h('div', { className: `n2s-notice ${test.error ? 'err' : test.triggered ? 'warn' : 'ok'}`, style: { marginTop: 10 } }, test.busy ? t('ds.testing') : test.error ?? `${test.triggered ? t('al.wouldFire') : t('al.wouldNotFire')}：${test.message}`),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: test?.busy, onClick: tryIt }, t('al.test')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save }, t('ds.save'))))
    }

    function AlertsTab({ t, ds, datasources }) {
      const list = useAsync(() => call('listAlerts'), [])
      const events = useAsync(() => call('listAlertEvents', {}), [list.value])
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState(null)
      const act = async (fn, ok) => { setNotice(null); try { const r = await fn(); if (ok) setNotice({ ok: true, text: typeof ok === 'function' ? ok(r) : ok }) } catch (e) { setNotice({ ok: false, text: e.message }) } list.reload() }
      const alerts = list.value ?? []
      const sched = useAsync(() => call('schedulerStatus'), [list.value])
      const condText = (a) => a.condition.type === 'threshold' ? `${a.condition.op} ${a.condition.value}` : a.condition.type === 'change' ? `${t(`al.dir.${a.condition.direction ?? 'any'}`)} ≥ ${a.condition.pct}%` : a.condition.type === 'anomaly' ? `Z ≥ ${a.condition.z ?? 3}` : t('al.cond.missing')
      return h('div', null,
        h(SectionHead, { title: t('tab.alerts'), desc: t('al.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, '+ ', t('al.add'))),
        sched.value && h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 10 } },
          sched.value.lastTickAt ? fmt(t, 'al.lastTick', { time: new Date(sched.value.lastTickAt).toLocaleTimeString(), n: (sched.value.lastRan ?? []).length }) : t('al.noTickYet'),
          sched.value.nextAlerts?.[0] ? ` · ${fmt(t, 'al.nextDue', { name: sched.value.nextAlerts[0].name, time: new Date(Math.max(sched.value.nextAlerts[0].dueAt, Date.now())).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : '',
          ` · ${t('al.schedulerNote')}`),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, style: { marginBottom: 10 }, role: 'status' }, notice.text),
        editing && h(AlertForm, { key: editing.id ?? 'new', t, ds, datasources, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        !list.loading && alerts.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('al.empty')), h('div', null, t('al.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, t('al.add'))),
        alerts.length > 0 && h('div', { className: 'n2s-list2' }, alerts.map(a => h('div', { key: a.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', style: a.state === 'firing' ? { color: 'var(--n2s-err)', background: 'color-mix(in srgb, var(--n2s-err) 12%, transparent)' } : undefined, 'aria-hidden': true }, svg(16, [h('path', { key: 1, d: 'M8 2.5 14 13H2L8 2.5zM8 6.5v3M8 11.3v.2' })])),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, a.name), !a.enabled && h('span', { className: 'n2s-badge' }, t('rep.status.paused')), a.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), a.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${a.source === 'metric' ? `${a.metric} · ${t(`al.grain.${a.grain}`)}` : 'SQL'} · ${t(`al.cond.${a.condition.type}`)} ${condText(a)} · ${t(`al.every.${a.every}`)} · ${a.datasourceName}`),
            a.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, a.lastError)),
          h('div', { className: 'n2s-list2-side' },
            h('span', { className: `n2s-statusdot ${a.state === 'firing' ? 'err' : a.lastCheckedAt ? 'ok' : ''}` }, a.state === 'firing' ? t('al.firing') : a.lastCheckedAt ? t('al.ok') : t('al.never')),
            h('span', { className: 'n2s-faint n2s-small' }, a.lastValue !== null && a.lastValue !== undefined ? `${t('al.last')} ${formatCompact(a.lastValue)}` : '')),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(() => call('checkAlert', { id: a.id }), (r) => `${r.triggered ? '⚠️ ' : '✓ '}${r.message}${r.pushed ? ` · ${t('al.pushed')}` : ''}`) }, t('al.checkNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: a.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('saveAlert', { id: a.id, enabled: !a.enabled })) },
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(a) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'al.deleteConfirm', { name: a.name }), danger: true })) act(() => call('deleteAlert', { id: a.id })) } },
            ] }))))),
        (events.value ?? []).length > 0 && h('div', { className: 'n2s-section' }, h('h2', null, t('al.events')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('im.col.time'), t('al.name'), t('al.message'), t('im.col.status')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, events.value.slice(0, 50).map(e => h('tr', { key: e.id },
              h('td', { className: 'n2s-muted' }, new Date(e.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
              h('td', null, e.name), h('td', { style: { whiteSpace: 'normal' } }, e.message),
              h('td', null, e.pushed ? h('span', { className: 'n2s-statusdot ok' }, t('im.sentOk')) : e.pushError ? h('span', { className: 'n2s-statusdot err', title: e.pushError }, t('im.lastFailed')) : h('span', { className: 'n2s-faint' }, '—')))))))))
    }

