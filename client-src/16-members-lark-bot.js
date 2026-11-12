    // ------------------------------------------------------ members & bots

    /** Identities of a member: the new array, or the legacy Lark fields. */
    function identitiesOf(u) {
      if (Array.isArray(u?.identities)) return u.identities.filter(x => x && x.id).map(x => ({ platform: x.platform ?? 'lark', id: String(x.id), ...(x.email ? { email: x.email } : {}) }))
      const out = []
      const id = u?.kind === 'chat' ? u?.larkChatId : u?.larkOpenId
      if (id || (u?.kind !== 'chat' && u?.email)) out.push({ platform: 'lark', id: id ?? '', ...(u?.kind !== 'chat' && u?.email ? { email: u.email } : {}) })
      return out
    }

    /** Platforms members can be identified on: those with a bot-capable kind. */
    function identityPlatforms(catalog) {
      const list = catalog.filter(p => (p.kinds ?? []).some(k => k.capabilities?.bot)).map(p => p.platform)
      return list.length ? list : ['lark']
    }

    function IdentityEditor({ t, kind, rows, onChange, catalog, errors }) {
      const platforms = identityPlatforms(catalog)
      const set = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
      const help = (p) => tOpt(t, `mb.idHelp.${p}.${kind}`)
      return h('div', { className: 'n2s-field full', role: 'group', 'aria-labelledby': 'n2s-ids-label' },
        h('span', { id: 'n2s-ids-label', className: 'n2s-flabel' }, kind === 'chat' ? t('mb.ids.chat') : t('mb.ids.person')),
        h('span', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.ids.chatHint') : t('mb.ids.personHint')),
        h('div', { className: 'n2s-idrows' }, rows.map((r, i) => h('div', { key: i, className: 'n2s-idrow', 'data-identity': i },
          h('div', { className: 'n2s-idrow-main' },
            h(PlatformMark, { t, platform: r.platform, size: 30 }),
            h('select', { className: 'n2s-select inline', 'aria-label': fmt(t, 'mb.ids.platformN', { n: i + 1 }), value: r.platform, onChange: e => set(i, { platform: e.target.value }) },
              [...new Set([...platforms, r.platform])].map(p => h('option', { key: p, value: p }, platformName(t, p, catalog)))),
            h('input', { className: `n2s-input n2s-mono${errors?.[i] ? ' invalid' : ''}`, 'aria-label': fmt(t, 'mb.ids.idN', { n: i + 1 }), 'aria-invalid': errors?.[i] ? true : undefined, value: r.id, placeholder: ID_PLACEHOLDER[r.platform]?.[kind] ?? 'id', spellCheck: false, autoComplete: 'off', onChange: e => set(i, { id: e.target.value }) }),
            kind === 'person' && h('input', { className: 'n2s-input', style: { maxWidth: 220 }, type: 'email', 'aria-label': fmt(t, 'mb.ids.emailN', { n: i + 1 }), value: r.email ?? '', placeholder: t('mb.ids.emailPh'), onChange: e => set(i, { email: e.target.value }) }),
            h('button', { type: 'button', className: 'n2s-iconbtn danger', 'aria-label': fmt(t, 'mb.ids.remove', { n: i + 1 }), title: t('ds.delete'), onClick: () => onChange(rows.filter((_, j) => j !== i)) }, Icon.close())),
          errors?.[i] ? h('div', { className: 'n2s-fielderr', role: 'alert' }, errors[i]) : help(r.platform) && h('div', { className: 'n2s-faint n2s-small n2s-idrow-help' }, help(r.platform))))),
        h('button', { type: 'button', className: 'n2s-btn small ghost', style: { justifySelf: 'start' }, onClick: () => onChange([...rows, { platform: rows[rows.length - 1]?.platform ?? platforms[0], id: '', email: '' }]) }, '+ ', t('mb.ids.add')))
    }

    /**
     * One-click identity picks: people and groups that already talked to a bot
     * (recorded by the host, including refused ones), plus the groups a bot is
     * in (channels whose kind can list targets). No id lookup needed.
     */
    function IdentityPicker({ t, kind, catalog, onPick, chosen }) {
      const seen = useAsync(() => call('listSeenIdentities', { kind }).catch(() => []), [kind])
      const channels = useChannels()
      const listable = channels.filter(c => (c.capabilities ?? findKind(catalog, c.type)?.kind?.capabilities)?.listTargets)
      const [groups, setGroups] = useState(null)
      const [loadingGroups, setLoadingGroups] = useState(false)
      const loadGroups = async () => {
        setLoadingGroups(true)
        const out = []
        for (const c of listable) {
          try { for (const g of await call('listChannelTargets', { id: c.id })) out.push({ platform: c.platform, kind: 'chat', id: String(g.id), name: g.name, via: c.name }) } catch (e) { notifyError(e) }
        }
        setGroups(out); setLoadingGroups(false)
      }
      useEffect(() => { if (kind === 'chat' && listable.length && groups === null) loadGroups() }, [kind, listable.length])
      const isChosen = (x) => chosen.some(r => r.platform === x.platform && r.id === x.id)
      const items = [...(seen.value ?? [])]
      if (kind === 'chat') for (const g of groups ?? []) if (!items.some(x => x.platform === g.platform && x.id === g.id)) items.push(g)
      const label = (x) => x.name || x.chatName || x.email || x.id
      return h('div', { className: 'n2s-field full n2s-idpicker' },
        h('div', { className: 'n2s-row' },
          h('span', { className: 'n2s-flabel' }, kind === 'chat' ? t('mb.pick.chats') : t('mb.pick.people')),
          h('span', { className: 'n2s-grow' }),
          kind === 'chat' && listable.length > 0 && h('button', { type: 'button', className: 'n2s-link n2s-small', disabled: loadingGroups, onClick: loadGroups }, loadingGroups ? h('span', { className: 'n2s-spin' }) : Icon.refresh(12), t('mb.pick.refresh'))),
        seen.loading && !seen.value ? h('div', { className: 'n2s-skel', style: { height: 34 } }) :
          items.length === 0
            ? h('div', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.pick.noChats') : t('mb.pick.noPeople'))
            : h('div', { className: 'n2s-pickchips', role: 'list' }, items.slice(0, 30).map(x => {
              const taken = x.memberId && !isChosen(x)
              return h('button', {
                key: `${x.platform}:${x.id}`, type: 'button', role: 'listitem', className: 'n2s-pickchip', 'aria-pressed': isChosen(x), disabled: Boolean(taken),
                title: [`${platformName(t, x.platform, catalog)} · ${x.id}`, x.email, x.via ? fmt(t, 'mb.pick.via', { name: x.via }) : '', taken ? fmt(t, 'mb.pick.taken', { name: x.memberName }) : '', x.refused ? t('mb.pick.refused') : ''].filter(Boolean).join('\n'),
                onClick: () => onPick(x),
              },
              h(PlatformMark, { t, platform: x.platform, size: 16 }),
              h('span', { className: 'n2s-pickchip-name' }, label(x)),
              x.refused && !x.memberId && h('span', { className: 'n2s-badge warn' }, t('mb.pick.pending')),
              taken && h('span', { className: 'n2s-faint' }, t('mb.pick.added')),
              x.lastAt && h('span', { className: 'n2s-faint' }, shortTime(x.lastAt)))
            })),
        h('div', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.pick.chatsHint') : t('mb.pick.peopleHint')))
    }

    /** People / groups refused by a bot because they are not members yet: add with one click. */
    function PendingMembers({ t, onAdd }) {
      const seen = useAsync(() => call('listSeenIdentities', {}).catch(() => []), [])
      const { catalog } = useCatalog(t)
      const pending = (seen.value ?? []).filter(x => x.refused && !x.memberId).slice(0, 6)
      if (!pending.length) return null
      return h('div', { className: 'n2s-notice warn n2s-pending', role: 'status', style: { marginBottom: 12 } },
        h('div', { style: { marginBottom: 6 } }, fmt(t, 'mb.pending.title', { n: pending.length })),
        h('div', { className: 'n2s-pickchips' }, pending.map(x => h('button', { key: `${x.platform}:${x.kind}:${x.id}`, type: 'button', className: 'n2s-pickchip', onClick: () => onAdd(x), title: `${platformName(t, x.platform, catalog)} · ${x.id}` },
          h(PlatformMark, { t, platform: x.platform, size: 16 }),
          h('span', { className: 'n2s-pickchip-name' }, x.name || x.chatName || x.id),
          h('span', { className: 'n2s-faint' }, x.kind === 'chat' ? t('mb.kind2.chat') : t('mb.kind2.person')),
          h('span', { className: 'n2s-link' }, t('mb.pending.add'))))))
    }

    function IdentityChips({ t, u, catalog }) {
      const ids = identitiesOf(u)
      if (!ids.length) return h('span', { className: 'n2s-badge warn' }, t('mb.ids.none'))
      return h('span', { className: 'n2s-idchips' }, ids.map((x, i) => h('span', { key: i, className: 'n2s-idchip', title: `${platformName(t, x.platform, catalog)} · ${x.id}${x.email ? ` · ${x.email}` : ''}` },
        h(PlatformMark, { t, platform: x.platform, size: 16 }), h('span', { className: 'n2s-mono' }, x.id || x.email))))
    }

    function UserForm({ t, initial, prefill, datasources, onDone, onCancel }) {
      const { catalog } = useCatalog(t)
      const [form, setForm] = useState(() => {
        const base = { kind: prefill?.kind ?? 'person', name: prefill ? (prefill.name || prefill.chatName || '') : '', role: 'analyst', allDatasources: initial ? initial.datasourceIds === null : false, datasourceIds: [], note: '', ...(initial ?? {}) }
        const ids = prefill ? [{ platform: prefill.platform, id: prefill.id, ...(prefill.kind === 'person' && prefill.email ? { email: prefill.email } : {}) }] : identitiesOf(initial)
        return { ...base, identities: ids.length ? ids : [{ platform: 'lark', id: '', email: '' }] }
      })
      const [error, setError] = useState(null)
      const [idErrors, setIdErrors] = useState({})
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const ids = form.datasourceIds ?? []
      const rules = form.rowRules ?? []
      const setRule = (i, patch) => setForm(f => ({ ...f, rowRules: (f.rowRules ?? []).map((r, j) => j === i ? { ...r, ...patch } : r) }))
      const save = async () => {
        setError(null)
        const identities = form.identities
          .map(r => ({ platform: r.platform, id: String(r.id ?? '').trim(), ...(form.kind === 'person' && String(r.email ?? '').trim() ? { email: String(r.email).trim() } : {}) }))
        // Rows left empty are dropped; at least one identity is required.
        const kept = identities.filter(r => r.id || r.email)
        if (!kept.length) { setIdErrors({ 0: t('mb.ids.needOne') }); return }
        setIdErrors({})
        // Legacy mirror for hosts that still read the Lark-only fields.
        const lark = kept.find(r => r.platform === 'lark' && r.id)
        const email = kept.find(r => r.email)?.email
        const legacy = form.kind === 'chat' ? { larkChatId: lark?.id ?? '' } : { larkOpenId: lark?.id ?? '', email: email ?? '' }
        const { identities: _i, larkOpenId: _o, larkChatId: _c, email: _e, ...rest } = form
        try {
          await call('saveUser', { ...rest, ...legacy, identities: kept.filter(r => r.id), datasourceIds: form.allDatasources ? null : ids, rowRules: rules.filter(r => r.column && (Array.isArray(r.values) ? r.values.length : String(r.values ?? '').trim())) })
          onDone()
        } catch (e) { setError(e.message) }
      }
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('div', { className: 'n2s-field full' }, h('span', { id: 'n2s-mb-kind' }, t('mb.kind')), h('div', { className: 'n2s-seg', role: 'group', 'aria-labelledby': 'n2s-mb-kind', style: { justifySelf: 'start' } }, ['person', 'chat'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.kind === v, disabled: Boolean(initial?.id), onClick: () => setForm(f => ({ ...f, kind: v })) }, t(`mb.kind2.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('im.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('mb.role')), h('select', { className: 'n2s-select', value: form.role, onChange: set('role') }, ['admin', 'analyst', 'viewer'].map(r => h('option', { key: r, value: r }, t(`mb.role.${r}`)))), h('span', { className: 'n2s-faint n2s-small' }, t(`mb.roleHint.${form.role}`))),
          !initial?.id && h(IdentityPicker, { t, kind: form.kind, catalog, chosen: form.identities, onPick: (x) => setForm(f => {
            const exists = f.identities.some(r => r.platform === x.platform && r.id === x.id)
            const rows = exists ? f.identities.filter(r => !(r.platform === x.platform && r.id === x.id)) : [...f.identities.filter(r => r.id || r.email), { platform: x.platform, id: x.id, ...(f.kind === 'person' && x.email ? { email: x.email } : {}) }]
            return { ...f, identities: rows.length ? rows : [{ platform: x.platform, id: '', email: '' }], name: f.name || (exists ? f.name : (x.name || x.chatName || '')) }
          }) }),
          h(IdentityEditor, { t, kind: form.kind, rows: form.identities, catalog, errors: idErrors, onChange: (rows) => { setForm(f => ({ ...f, identities: rows })); setIdErrors({}) } }),
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
        error && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save }, t('ds.save'))))
    }

    /** 「机器人」: every bot-capable channel with status, enable switch and recent conversations. */
    function BotsOverview({ t }) {
      const channels = useChannels()
      const bots = useBots()
      const { catalog } = useCatalog(t)
      const [busy, setBusy] = useState(null)
      const [open, setOpen] = useState(null)
      useEffect(() => { loadCatalog(); refreshChannels(); refreshBots() }, [])
      useEffect(() => {
        const id = setInterval(() => { if (!document.hidden) refreshBots() }, 5000)
        return () => clearInterval(id)
      }, [])
      const capable = channels.filter(c => (c.capabilities ?? findKind(catalog, c.type)?.kind?.capabilities)?.bot)
      const toggle = async (c, enabled) => {
        setBusy(c.id)
        try { await saveBotFor(c.id, { enabled }); notify(enabled ? fmt(t, 'ch.botOn', { name: c.name }) : fmt(t, 'ch.botOff', { name: c.name }), 'ok') } catch (e) { notifyError(e) }
        refreshChannels()
        setBusy(null)
      }
      const restart = async (c) => {
        try {
          if (bots.legacy) await call('restartLarkBot'); else await call('restartBot', { channelId: c.id })
          await refreshBots()
        } catch (e) { notifyError(e) }
      }
      return h('div', { className: 'n2s-section', style: { marginTop: 0, marginBottom: 24 } },
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('h2', { className: 'n2s-h2', style: { margin: 0 } }, t('ch.bots')),
          h('span', { className: 'n2s-faint n2s-small n2s-grow' }, t('ch.botsHint'))),
        bots.error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, bots.error),
        capable.length === 0
          ? h('div', { className: 'n2s-empty', style: { padding: '24px 20px' } },
            h('h3', null, t('ch.bots.empty')), h('div', null, t('ch.bots.emptyHint')),
            h('button', { type: 'button', className: 'n2s-btn', onClick: () => fbCtx.navigate?.({ tab: 'admin', section: 'push' }) }, t('ch.bots.goAdd')))
          : h('div', { className: 'n2s-list2' }, capable.map(c => {
            const b = botOf(c, bots)
            const convs = b.conversations ?? []
            const expanded = open === c.id
            return h('div', { key: c.id, className: 'n2s-botrow', 'data-bot': c.id },
              h('div', { className: 'n2s-list2-row' },
                h(PlatformMark, { t, platform: c.platform }),
                h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                  h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, c.name), b.info?.name && h('span', { className: 'n2s-badge' }, b.info.name), h(BotDot, { t, bot: b })),
                  h('div', { className: 'n2s-list2-sub' }, `${platformName(t, c.platform, catalog)} · ${kindLabel(t, c.type, catalog)} · ${t(`bot.scope.${b.sessionScope ?? 'chat'}`)}${b.allowP2p ? ` · ${t('ch.p2pOn')}` : ''}`),
                  b.enabled && b.status?.error && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)', whiteSpace: 'normal' } }, b.status.error)),
                h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
                  convs.length > 0 && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': expanded, onClick: () => setOpen(expanded ? null : c.id) }, fmt(t, 'ch.convsN', { n: convs.length }), Icon.chev(10)),
                  b.enabled && botStateOf(b) === 'error' && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => restart(c) }, Icon.refresh(12), t('ch.restart')),
                  h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => openChannelEditor(c.id, true) }, t('ch.botSettings')),
                  h('label', { className: 'n2s-switch', title: t('bot.enable') }, h('input', { type: 'checkbox', role: 'switch', 'aria-label': fmt(t, 'ch.botToggle', { name: c.name }), checked: Boolean(b.enabled), disabled: busy === c.id, onChange: e => toggle(c, e.target.checked) })))),
              expanded && h('div', { style: { padding: '0 16px 14px' } }, h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
                h('thead', null, h('tr', null, [t('bot.chat'), t('bot.lastQ'), t('mb.user'), t('im.col.time'), ''].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', null, convs.slice(0, 20).map(cv => h('tr', { key: cv.key },
                  h('td', null, cv.chatName ?? (cv.chatType === 'p2p' ? t('bot.p2pShort') : cv.chatId)), h('td', { title: cv.lastQuestion }, cv.lastQuestion), h('td', null, cv.lastActor ?? ''),
                  h('td', { className: 'n2s-muted' }, cv.lastAt ? shortTime(cv.lastAt) : ''),
                  h('td', null, cv.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('hist.openSession'), title: t('hist.openSession'), onClick: () => fbCtx.openSession?.(cv.sessionId) }, Icon.external(13))))))))))
          })))
    }

    function MembersTab({ t, datasources }) {
      const users = useAsync(() => call('listUsers'), [])
      const usage = useAsync(() => call('usageByActor', { days: 30 }), [])
      const settings = useAsync(() => call('getSettings'), [])
      const [editing, setEditing] = useState(null)
      const { catalog } = useCatalog(t)
      const list = users.value ?? []
      const usageById = new Map((usage.value ?? []).map(u => [u.actorId, u]))
      return h('div', null,
        h(SectionHead, { title: t('tab.members'), desc: t('mb.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('mb.add'))),
        h(BotsOverview, { t }),
        !editing && h(PendingMembers, { t, onAdd: (x) => setEditing({ prefill: x }) }),
        editing && h(UserForm, { key: editing.id ?? (editing.prefill ? `p:${editing.prefill.id}` : 'new'), t, datasources, prefill: editing.prefill, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); users.reload() } }),
        settings.value && h('div', { className: 'n2s-setnote', style: { marginBottom: 10 } },
          t('mb.default'), ' ', h('strong', null, t(`mb.defaultRole.${settings.value.botDefaultRole ?? settings.value.larkDefaultRole ?? 'none'}`)), ' · ',
          h('button', { type: 'button', className: 'n2s-link', onClick: () => fbCtx.navigate?.({ tab: 'admin', section: 'settings' }) }, t('set.changeInSettings'))),
        list.length === 0 && !editing ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mb.empty')), h('div', null, t('mb.emptyHint'))) :
          h('div', { className: 'n2s-list2' }, list.map(u => {
            const us = usageById.get(u.id)
            return h('div', { key: u.id, className: 'n2s-list2-row' },
              h('span', { className: 'n2s-tile', 'aria-hidden': true }, u.kind === 'chat' ? t('mb.chatShort') : (u.name || '?').slice(0, 1)),
              h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, u.name), h('span', { className: 'n2s-badge' }, t(`mb.role.${u.role}`)), u.disabled && h('span', { className: 'n2s-badge err' }, t('mb.disabled'))),
                h('div', { className: 'n2s-row', style: { gap: 6, marginTop: 4 } }, h(IdentityChips, { t, u, catalog }), h('span', { className: 'n2s-muted n2s-small' }, u.datasourceIds === null ? t('mb.allDs') : (u.datasourceNames ?? []).join(uiLang === 'zh' ? '、' : ', ') || t('mb.noDs'))),
                (u.rowRules ?? []).length > 0 && h('div', { className: 'n2s-list2-sub' }, `${colon(t('mb.rowRules'))}${u.rowRules.map(r => `${r.column} ∈ {${r.values.join(', ')}}`).join('；')}`)),
              h('div', { className: 'n2s-list2-side' }, h('span', { className: 'n2s-small' }, us ? fmt(t, 'mb.queries', { n: us.queries }) : t('mb.noUsage')), us?.lastAt && h('span', { className: 'n2s-faint n2s-small' }, new Date(us.lastAt).toLocaleDateString())),
              h(Dropdown, { label: fmt(t, 'ch.actionsFor', { name: u.name }), trigger: { content: Icon.more() }, items: [
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

