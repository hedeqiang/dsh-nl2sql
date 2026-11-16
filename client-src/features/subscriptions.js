    // ------------------------------------------------------------ chat subscriptions (admin section)

    const SUB_RANGES = ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear']

    /** Inline editor for one chat subscription (schedule, title, metric range) or chat alert (condition, frequency). */
    function ChatSubEditor({ t, item, onDone, onCancel }) {
      const isSub = item.kind === 'subscription'
      const [form, setForm] = useState(() => isSub
        ? { title: item.title ?? '', period: item.period ?? 'daily', time: item.time ?? '09:00', weekdays: item.weekdays ?? [1], monthDay: item.monthDay ?? 1, grain: item.grain ?? '', range: item.range ?? 'yesterday' }
        : { title: item.title ?? '', condition: { type: 'threshold', op: '>', value: 0, ...(item.condition ?? {}) }, every: item.every ?? 'hour', at: item.at ?? '09:00', cooldownMin: item.cooldownMin ?? 60, mentionMe: Boolean(item.mentionMe) })
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const setC = (patch) => setForm(f => ({ ...f, condition: { ...f.condition, ...patch } }))
      const save = () => run(async () => {
        setError(null)
        const payload = isSub
          ? { id: item.id, title: form.title, period: form.period, time: form.time, ...(form.period === 'weekly' ? { weekdays: form.weekdays } : {}), ...(form.period === 'monthly' ? { monthDay: Number(form.monthDay) } : {}), ...(item.source === 'metric' ? { grain: form.grain || null, range: form.range } : {}) }
          : { id: item.id, title: form.title, condition: form.condition, every: form.every, at: form.at, cooldownMin: Number(form.cooldownMin), mentionMe: form.mentionMe }
        try { await call('updateChatSubscription', payload); onDone() } catch (e) { setError(e.message) }
      })
      const c = form.condition
      const toggleDay = (d) => setForm(f => ({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d].sort() }))
      return h('div', { className: 'n2s-sub-edit' },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t(isSub ? 'sub.edit.title' : 'sub.edit.name')), h('input', { className: 'n2s-input', value: form.title, onChange: set('title') })),
          isSub ? h(React.Fragment, null,
            h('div', { className: 'n2s-field' }, h('span', null, t('rep.period')), h('div', { className: 'n2s-seg' }, ['daily', 'weekly', 'monthly'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.period === v, onClick: () => setForm(f => ({ ...f, period: v })) }, t(`sub.period.${v}`))))),
            form.period === 'weekly' && h('div', { className: 'n2s-field full' }, h('span', null, t('rep.weekdays')), h('div', { className: 'n2s-chips' }, [1, 2, 3, 4, 5, 6, 7].map(d => h('button', { key: d, type: 'button', className: 'n2s-chip', 'aria-pressed': form.weekdays.includes(d), onClick: () => toggleDay(d) }, t(`pro.wd.${d % 7}`))))),
            form.period === 'monthly' && h('label', { className: 'n2s-field' }, h('span', null, t('sub.edit.monthDay')), h('input', { className: 'n2s-input', type: 'number', min: 1, max: 31, value: form.monthDay, onChange: set('monthDay') })),
            h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
            item.source === 'metric' && h('label', { className: 'n2s-field' }, h('span', null, t('sub.edit.range')), h('select', { className: 'n2s-select', value: form.range, onChange: set('range') }, SUB_RANGES.map(r => h('option', { key: r, value: r }, t(`sub.range.${r}`))))),
            item.source === 'metric' && h('label', { className: 'n2s-field' }, h('span', null, t('al.grain')), h('select', { className: 'n2s-select', value: form.grain, onChange: set('grain') }, h('option', { value: '' }, t('sub.edit.noGrain')), ['hour', 'day', 'week', 'month', 'year'].map(g => h('option', { key: g, value: g }, t(`sub.grain.${g}`))))))
          : h(React.Fragment, null,
            h('div', { className: 'n2s-field full' }, h('span', null, t('al.condition')),
              h('div', { className: 'n2s-row' },
                h('select', { className: 'n2s-select inline', value: c.type, onChange: e => setC({ type: e.target.value }) }, ['threshold', 'change', 'anomaly'].map(v => h('option', { key: v, value: v }, t(`al.cond.${v}`)))),
                c.type === 'threshold' && h(React.Fragment, null,
                  h('select', { className: 'n2s-select inline', 'aria-label': t('al.condition'), value: c.op ?? '>', onChange: e => setC({ op: e.target.value }) }, ['>', '>=', '<', '<=', '==', '!='].map(o => h('option', { key: o, value: o }, o))),
                  h('input', { className: 'n2s-input', type: 'number', 'aria-label': t('sub.edit.value'), style: { width: 140 }, value: c.value ?? 0, onChange: e => setC({ value: Number(e.target.value) }) })),
                c.type === 'change' && h(React.Fragment, null,
                  h('select', { className: 'n2s-select inline', value: c.direction ?? 'any', onChange: e => setC({ direction: e.target.value }) }, ['any', 'up', 'down'].map(o => h('option', { key: o, value: o }, t(`al.dir.${o}`)))),
                  h('input', { className: 'n2s-input', type: 'number', style: { width: 90 }, value: c.pct ?? 20, onChange: e => setC({ pct: Number(e.target.value) }) }), h('span', { className: 'n2s-muted' }, '%')),
                c.type === 'anomaly' && h(React.Fragment, null, h('span', { className: 'n2s-muted n2s-small' }, 'Z ≥'), h('input', { className: 'n2s-input', type: 'number', step: 0.5, style: { width: 80 }, value: c.z ?? 3, onChange: e => setC({ z: Number(e.target.value) }) }))),
              h('span', { className: 'n2s-faint n2s-small' }, t(`al.condHint.${c.type}`))),
            h('label', { className: 'n2s-field' }, h('span', null, t('al.every')), h('select', { className: 'n2s-select', value: form.every, onChange: set('every') }, ['15m', 'hour', 'day'].map(v => h('option', { key: v, value: v }, t(`al.every.${v}`))))),
            form.every === 'day' && h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.at, onChange: set('at') })),
            h('label', { className: 'n2s-field' }, h('span', null, t('al.cooldown')), h('input', { className: 'n2s-input', type: 'number', min: 0, max: 10080, value: form.cooldownMin, onChange: set('cooldownMin') })),
            h('div', { className: 'n2s-field' }, h('span', null, t('ms.mention')), h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', checked: form.mentionMe, onChange: e => setForm(f => ({ ...f, mentionMe: e.target.checked })) }), fmt(t, 'sub.edit.mentionMe', { name: item.createdBy?.name ?? '' }))))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t(isSub ? 'sub.edit.hintSub' : 'sub.edit.hintAlert')),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    /** Subscriptions and alerts created from IM chats, grouped by chat, with edit / pause / resume / delete. */
    function ChatSubscriptionsSection({ t }) {
      const list = useAsync(() => call('listChatSubscriptions'), [])
      const [notice, setNotice] = useState(null)
      const [editing, setEditing] = useState(null)
      const groups = list.value ?? []
      const when = (ms) => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
      const act = async (item, action) => {
        setNotice(null)
        if (action === 'delete' && !(await confirmDialog({ title: fmt(t, 'sub.deleteConfirm', { name: item.title }), danger: true }))) return
        try { await call('setChatSubscription', { id: item.id, action }); setNotice({ ok: true, text: t(`sub.done.${action}`) }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        list.reload()
      }
      const statusDot = (s) => h('span', { className: `n2s-statusdot ${s === 'active' ? 'ok' : s === 'suspended' ? 'err' : ''}` }, t(`sub.status.${s}`))
      return h('div', { className: 'n2s-sub' },
        h(SectionHead, { title: t('sub.title'), desc: t('sub.desc') },
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => list.reload() }, Icon.refresh(14), ' ', t('sub.refresh'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, role: 'status', style: { marginBottom: 10 } }, notice.text),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !list.error && groups.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('sub.empty')), h('div', null, t('sub.emptyHint'))),
        groups.map(g => h('div', { key: g.key, className: 'n2s-card n2s-sub-group' },
          h('div', { className: 'n2s-sub-head' },
            h('span', { className: 'n2s-sub-chat' }, g.chatName || g.chatId),
            h('span', { className: 'n2s-badge' }, Icon.send(11), ' ', g.channelName ?? g.channelId),
            h('span', { className: 'n2s-faint n2s-small' }, g.platform)),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('sub.col.item'), t('sub.col.creator'), t('sub.col.schedule'), t('sub.col.last'), t('sub.col.status'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, g.items.map(it => h(React.Fragment, { key: it.id }, h('tr', { className: editing === it.id ? 'n2s-sub-editing' : undefined },
              h('td', null,
                h('span', { className: 'n2s-badge n2s-sub-kind' }, t(`sub.kind.${it.kind}`)), ' ', it.title,
                h('div', { className: 'n2s-faint n2s-small' }, joinList([it.datasourceName, it.conditionText, it.metric]))),
              h('td', null, it.createdBy?.name ?? '—'),
              h('td', null, it.schedule, it.nextAt ? h('div', { className: 'n2s-faint n2s-small' }, `${colon(t('sub.next'))}${when(it.nextAt)}`) : null),
              h('td', null, when(it.lastDeliveredAt)),
              h('td', null, statusDot(it.status), it.lastError && h('div', { className: 'n2s-small n2s-sub-err' }, it.lastError)),
              h('td', null, h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
                h('button', { type: 'button', className: 'n2s-btn small', 'aria-expanded': editing === it.id, onClick: () => { setNotice(null); setEditing(editing === it.id ? null : it.id) } }, t('sub.edit')),
                it.status === 'active'
                  ? h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'pause') }, t('sub.pause'))
                  : h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'resume') }, t('sub.resume')),
                h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('sub.delete'), title: t('sub.delete'), onClick: () => act(it, 'delete') }, Icon.trash(13))))),
              editing === it.id && h('tr', { className: 'n2s-sub-editrow' }, h('td', { colSpan: 6 },
                h(ChatSubEditor, { t, item: it, onCancel: () => setEditing(null), onDone: () => { setEditing(null); setNotice({ ok: true, text: t('sub.done.update') }); list.reload() } })))))))))))
    }

    extend.adminSections.push({ id: 'subscriptions', label: (t) => t('sub.nav'), icon: () => svg(15, [h('path', { key: 1, d: 'M4 6.5a4 4 0 0 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5M6.5 13.5a1.6 1.6 0 0 0 3 0' })]), Component: ChatSubscriptionsSection })
