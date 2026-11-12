    // ------------------------------------------------- members & lark bot

    function UserForm({ t, initial, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ kind: 'person', name: '', role: 'analyst', larkOpenId: '', email: '', larkChatId: '', allDatasources: initial ? initial.datasourceIds === null : false, datasourceIds: [], note: '', ...(initial ?? {}) }))
      const [error, setError] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const ids = form.datasourceIds ?? []
      const rules = form.rowRules ?? []
      const setRule = (i, patch) => setForm(f => ({ ...f, rowRules: (f.rowRules ?? []).map((r, j) => j === i ? { ...r, ...patch } : r) }))
      const save = async () => { setError(null); try { await call('saveUser', { ...form, datasourceIds: form.allDatasources ? null : ids, rowRules: rules.filter(r => r.column && (Array.isArray(r.values) ? r.values.length : String(r.values ?? '').trim())) }); onDone() } catch (e) { setError(e.message) } }
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('div', { className: 'n2s-field full' }, h('span', null, t('mb.kind')), h('div', { className: 'n2s-seg' }, ['person', 'chat'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.kind === v, disabled: Boolean(initial?.id), onClick: () => setForm(f => ({ ...f, kind: v })) }, t(`mb.kind.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('im.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('mb.role')), h('select', { className: 'n2s-select', value: form.role, onChange: set('role') }, ['admin', 'analyst', 'viewer'].map(r => h('option', { key: r, value: r }, t(`mb.role.${r}`)))), h('span', { className: 'n2s-faint n2s-small' }, t(`mb.roleHint.${form.role}`))),
          form.kind === 'person' ? h(React.Fragment, null,
            h('label', { className: 'n2s-field' }, h('span', null, 'open_id'), h('input', { className: 'n2s-input n2s-mono', value: form.larkOpenId ?? '', placeholder: 'ou_xxx', onChange: set('larkOpenId') })),
            h('label', { className: 'n2s-field' }, h('span', null, t('mb.email')), h('input', { className: 'n2s-input', value: form.email ?? '', placeholder: 'name@company.com', onChange: set('email') })))
            : h('label', { className: 'n2s-field full' }, h('span', null, 'chat_id'), h('input', { className: 'n2s-input n2s-mono', value: form.larkChatId ?? '', placeholder: 'oc_xxx', onChange: set('larkChatId') })),
          h('div', { className: 'n2s-field full' }, h('span', null, t('mb.scope')),
            h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.allDatasources, onChange: set('allDatasources') }), t('mb.allDs')),
            !form.allDatasources && h('div', { className: 'n2s-chips', style: { marginTop: 6 } }, datasources.map(d => h('button', { key: d.id, type: 'button', className: 'n2s-chip', 'aria-pressed': ids.includes(d.id), onClick: () => setForm(f => ({ ...f, datasourceIds: ids.includes(d.id) ? ids.filter(x => x !== d.id) : [...ids, d.id] })) }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('mb.rowRules')),
            h('span', { className: 'n2s-faint n2s-small' }, t('mb.rowRulesHint')),
            rules.map((r, i) => h('div', { key: i, className: 'n2s-row', style: { flexWrap: 'nowrap' } },
              h('select', { className: 'n2s-select inline', 'aria-label': t('ds.select'), value: r.datasourceId ?? '', onChange: e => setRule(i, { datasourceId: e.target.value || null }) }, h('option', { value: '' }, t('mb.anyDs')), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name))),
              h('input', { className: 'n2s-input n2s-mono', style: { width: 180 }, 'aria-label': t('mb.ruleColumn'), placeholder: 'merchant_code', value: r.column ?? '', onChange: e => setRule(i, { column: e.target.value }) }),
              h('span', { className: 'n2s-muted' }, '∈'),
              h('input', { className: 'n2s-input', 'aria-label': t('mb.ruleValues'), placeholder: 'A001, A002', value: Array.isArray(r.values) ? r.values.join(', ') : (r.values ?? ''), onChange: e => setRule(i, { values: e.target.value }) }),
              h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.delete'), onClick: () => setForm(f => ({ ...f, rowRules: (f.rowRules ?? []).filter((_, j) => j !== i) })) }, Icon.close()))),
            h('button', { type: 'button', className: 'n2s-btn small ghost', style: { justifySelf: 'start' }, onClick: () => setForm(f => ({ ...f, rowRules: [...(f.rowRules ?? []), { datasourceId: null, column: '', values: '' }] })) }, '+ ', t('mb.addRule'))),
          h('label', { className: 'n2s-field full' }, h('span', null, t('im.description')), h('input', { className: 'n2s-input', value: form.note ?? '', onChange: set('note') }))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save }, t('ds.save'))))
    }

    function LarkBotCard({ t }) {
      const st = useAsync(() => call('larkBotStatus'), [])
      const channels = useChannels().filter(c => c.type === 'lark_app')
      const [error, setError] = useState(null)
      useEffect(() => { const id = setInterval(() => st.reload(), 5000); return () => clearInterval(id) }, [])
      const v = st.value
      if (!v) return h('div', { className: 'n2s-skel', style: { height: 120 } })
      const save = async (patch) => { setError(null); try { await call('saveLarkBot', patch); st.reload() } catch (e) { setError(e.message) } }
      const state = v.status?.state ?? 'idle'
      return h('div', { className: 'n2s-card', style: { marginBottom: 16 } },
        h('div', { className: 'n2s-row', style: { alignItems: 'flex-start' } },
          h(TypeTile, { type: 'lark_app' }),
          h('div', { className: 'n2s-grow' },
            h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-list2-title' }, t('bot.title')), h('span', { className: `n2s-statusdot ${state === 'connected' ? 'ok' : state === 'error' ? 'err' : ''}` }, t(`bot.state.${state}`)), v.bot?.name && h('span', { className: 'n2s-badge' }, v.bot.name)),
            h('div', { className: 'n2s-list2-sub', style: { whiteSpace: 'normal' } }, t('bot.hint')),
            v.status?.error && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)', whiteSpace: 'normal' } }, v.status.error)),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: v.enabled, disabled: !v.channelId && !v.enabled, onChange: e => save({ enabled: e.target.checked }) }), t('bot.enable'))),
        h('div', { className: 'n2s-form', style: { marginTop: 12 } },
          h('label', { className: 'n2s-field' }, h('span', null, t('bot.channel')),
            h('select', { className: 'n2s-select', value: v.channelId ?? '', onChange: e => save({ channelId: e.target.value || null }) }, h('option', { value: '' }, channels.length ? '—' : t('bot.noAppChannel')), channels.map(c => h('option', { key: c.id, value: c.id }, `${c.name} · ${c.appId}`)))),
          h('label', { className: 'n2s-field' }, h('span', null, t('bot.scope')),
            h('select', { className: 'n2s-select', value: v.sessionScope, onChange: e => save({ sessionScope: e.target.value }) }, ['chat', 'user'].map(x => h('option', { key: x, value: x }, t(`bot.scope.${x}`))))),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: v.allowP2p, onChange: e => save({ allowP2p: e.target.checked }) }), t('bot.p2p'))),
        h('details', { className: 'n2s-details' }, h('summary', null, t('bot.setup')), h('ol', { className: 'n2s-small n2s-muted', style: { paddingLeft: 18, margin: '8px 0 0', lineHeight: 1.8 } }, [1, 2, 3, 4, 5, 6].map(i => h('li', { key: i }, t(`bot.step${i}`))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        v.conversations.length > 0 && h('div', { style: { marginTop: 12 } }, h('div', { className: 'n2s-h2' }, t('bot.convs')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('bot.chat'), t('bot.lastQ'), t('mb.user'), t('im.col.time'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, v.conversations.slice(0, 20).map(c => h('tr', { key: c.key },
              h('td', null, c.chatName ?? (c.chatType === 'p2p' ? t('bot.p2pShort') : c.chatId)), h('td', { title: c.lastQuestion }, c.lastQuestion), h('td', null, c.lastActor ?? ''),
              h('td', { className: 'n2s-muted' }, c.lastAt ? new Date(c.lastAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''),
              h('td', null, c.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('hist.openSession'), title: t('hist.openSession'), onClick: () => fbCtx.openSession?.(c.sessionId) }, Icon.external(13))))))))))
    }

    function MembersTab({ t, datasources }) {
      const users = useAsync(() => call('listUsers'), [])
      const usage = useAsync(() => call('usageByActor', { days: 30 }), [])
      const settings = useAsync(() => call('getSettings'), [])
      const [editing, setEditing] = useState(null)
      const list = users.value ?? []
      const usageById = new Map((usage.value ?? []).map(u => [u.actorId, u]))
      return h('div', null,
        h(SectionHead, { title: t('tab.members'), desc: t('mb.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('mb.add'))),
        h(LarkBotCard, { t }),
        editing && h(UserForm, { key: editing.id ?? 'new', t, datasources, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); users.reload() } }),
        settings.value && h('div', { className: 'n2s-setnote', style: { marginBottom: 10 } },
          t('mb.default'), ' ', h('strong', null, t(`mb.defaultRole.${settings.value.larkDefaultRole ?? 'none'}`)), ' · ',
          h('button', { type: 'button', className: 'n2s-link', onClick: () => fbCtx.navigate?.({ tab: 'admin', section: 'settings' }) }, t('set.changeInSettings'))),
        list.length === 0 && !editing ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mb.empty')), h('div', null, t('mb.emptyHint'))) :
          h('div', { className: 'n2s-list2' }, list.map(u => {
            const us = usageById.get(u.id)
            return h('div', { key: u.id, className: 'n2s-list2-row' },
              h('span', { className: 'n2s-tile', 'aria-hidden': true }, u.kind === 'chat' ? t('mb.chatShort') : (u.name || '?').slice(0, 1)),
              h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, u.name), h('span', { className: 'n2s-badge' }, t(`mb.role.${u.role}`)), u.disabled && h('span', { className: 'n2s-badge err' }, t('mb.disabled'))),
                h('div', { className: 'n2s-list2-sub' }, `${u.kind === 'chat' ? `chat_id ${u.larkChatId}` : [u.email, u.larkOpenId].filter(Boolean).join(' · ')} · ${u.datasourceIds === null ? t('mb.allDs') : u.datasourceNames.join('、') || t('mb.noDs')}`),
                (u.rowRules ?? []).length > 0 && h('div', { className: 'n2s-list2-sub' }, `${t('mb.rowRules')}：${u.rowRules.map(r => `${r.column} ∈ {${r.values.join(', ')}}`).join('；')}`)),
              h('div', { className: 'n2s-list2-side' }, h('span', { className: 'n2s-small' }, us ? fmt(t, 'mb.queries', { n: us.queries }) : t('mb.noUsage')), us?.lastAt && h('span', { className: 'n2s-faint n2s-small' }, new Date(us.lastAt).toLocaleDateString())),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(u) },
                { label: u.disabled ? t('mb.enable') : t('mb.disable'), icon: Icon.refresh(14), onClick: async () => { try { await call('saveUser', { id: u.id, disabled: !u.disabled }) } catch (e) { notifyError(e) } users.reload() } },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'mb.deleteConfirm', { name: u.name }), danger: true })) { try { await call('deleteUser', { id: u.id }) } catch (e) { notifyError(e) } users.reload() } } },
              ] }))
          })),
        (usage.value ?? []).length > 0 && h('div', { className: 'n2s-section' }, h('h2', null, t('mb.usage')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('mb.user'), t('hist.total'), t('hist.errors'), t('hist.blocked'), t('mb.lastActive')].map((x, i) => h('th', { key: i, className: i && i < 4 ? 'num' : undefined }, x)))),
            h('tbody', null, usage.value.map(u => h('tr', { key: u.actorId }, h('td', null, u.name), h('td', { className: 'num' }, u.queries), h('td', { className: 'num' }, u.errors), h('td', { className: 'num' }, u.blocked), h('td', { className: 'n2s-muted' }, new Date(u.lastAt).toLocaleString()))))))))
    }

