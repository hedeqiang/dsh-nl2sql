    function ChannelForm({ t, initial, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ type: 'lark_webhook', name: '', description: '', appId: '', receiveIdType: 'chat_id', receiveId: '', domain: 'feishu', isDefault: false, ...(initial ?? {}), webhookUrl: '', signSecret: '', appSecret: '' }))
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [chats, setChats] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const field = (k, label, props = {}) => h('label', { className: `n2s-field ${props.full ? 'full' : ''}` }, h('span', null, t(label)),
        h('input', { className: 'n2s-input', type: props.type ?? 'text', value: form[k] ?? '', placeholder: props.placeholder, autoComplete: 'off', spellCheck: false, onChange: set(k) }))
      const save = async (thenTest) => {
        setBusy(true); setError(null)
        try {
          const saved = await call('saveChannel', form)
          await refreshChannels()
          if (thenTest) await call('testChannel', { id: saved.id })
          onDone(thenTest ? t('im.testOk') : null)
        } catch (e) { setError(e.message) }
        setBusy(false)
      }
      const loadChats = async () => {
        setError(null)
        try { setChats(await call('listChannelChats', { id: form.id, appId: form.appId, appSecret: form.appSecret || undefined, domain: form.domain })) } catch (e) { setError(e.message) }
      }
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-field', style: { marginBottom: 12 } }, h('span', null, t('im.kind')),
          h('div', { className: 'n2s-seg' }, ['lark_webhook', 'lark_app'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.type === v, disabled: Boolean(initial?.id) && initial.type !== v, onClick: () => setForm(f => ({ ...f, type: v })) }, t(`im.type.${v}`))))),
        h('div', { className: 'n2s-notice', style: { marginBottom: 12 } }, t(`im.help.${form.type}`)),
        h('div', { className: 'n2s-form' },
          field('name', 'im.name', { placeholder: t('ph.channelName') }),
          field('description', 'im.description'),
          form.type === 'lark_webhook' && field('webhookUrl', 'im.webhookUrl', { full: true, type: 'password', placeholder: initial?.hasSecret ? t('ds.passwordKeep') : 'https://open.feishu.cn/open-apis/bot/v2/hook/…' }),
          form.type === 'lark_webhook' && field('signSecret', 'im.signSecret', { type: 'password', placeholder: initial?.hasSign ? t('ds.passwordKeep') : t('im.optional') }),
          form.type === 'lark_app' && h('div', { className: 'n2s-field' }, h('span', null, t('im.domain')),
            h('div', { className: 'n2s-seg' }, ['feishu', 'lark'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.domain === v, onClick: () => setForm(f => ({ ...f, domain: v })) }, t(`im.domain.${v}`))))),
          form.type === 'lark_app' && field('appId', 'im.appId', { placeholder: 'cli_xxx' }),
          form.type === 'lark_app' && field('appSecret', 'im.appSecret', { type: 'password', placeholder: initial?.hasSecret ? t('ds.passwordKeep') : '' }),
          form.type === 'lark_app' && h('label', { className: 'n2s-field' }, h('span', null, t('im.receiveIdType')),
            h('select', { className: 'n2s-select', value: form.receiveIdType, onChange: set('receiveIdType') }, ['chat_id', 'email', 'open_id', 'user_id', 'union_id'].map(v => h('option', { key: v, value: v }, t(`im.rid.${v}`))))),
          form.type === 'lark_app' && h('label', { className: 'n2s-field' }, h('span', null, t('im.receiveId')),
            h('div', { className: 'n2s-row', style: { flexWrap: 'nowrap' } },
              h('input', { className: 'n2s-input', value: form.receiveId, placeholder: form.receiveIdType === 'email' ? 'name@company.com' : form.receiveIdType === 'chat_id' ? 'oc_xxx' : 'ou_xxx', onChange: set('receiveId') }),
              form.receiveIdType === 'chat_id' && h('button', { type: 'button', className: 'n2s-btn small', disabled: !form.appId, onClick: loadChats }, t('im.pickChat')))),
          chats && h('div', { className: 'n2s-field full' }, h('span', null, fmt(t, 'im.chats', { count: chats.length })),
            chats.length === 0 ? h('div', { className: 'n2s-muted n2s-small' }, t('im.noChats')) :
              h('div', { className: 'n2s-chips' }, chats.map(c => h('button', { key: c.chatId, type: 'button', className: 'n2s-chip', 'aria-pressed': form.receiveId === c.chatId, onClick: () => setForm(f => ({ ...f, receiveId: c.chatId, name: f.name || c.name })) }, c.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('im.chartMode')),
            h('div', { className: 'n2s-seg' }, ['native', ...(form.type === 'lark_app' ? ['image'] : []), 'table'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': (form.chartMode ?? 'native') === v, onClick: () => setForm(f => ({ ...f, chartMode: v })) }, t(`im.cm.${v}`)))),
            h('span', { className: 'n2s-muted n2s-small' }, t('im.cmHint'))),
          h('label', { className: 'n2s-check full' }, h('input', { type: 'checkbox', checked: Boolean(form.isDefault), onChange: set('isDefault') }), t('im.setDefault'))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: busy, onClick: () => save(true) }, t('im.saveTest')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: () => save(false) }, t('ds.save'))))
    }

    function PushTab({ t }) {
      const channels = useChannels()
      const deliveries = useAsync(() => call('listDeliveries'), [channels])
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState(null)
      const act = async (fn, ok) => {
        setNotice(null)
        try { await fn(); if (ok) setNotice({ ok: true, text: ok }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        refreshChannels()
      }
      return h('div', null,
        h(SectionHead, { title: t('tab.push'), desc: t('im.hintShort') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('im.add'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, style: { marginBottom: 10 }, role: 'status' }, notice.text),
        editing && h(ChannelForm, { key: editing.id ?? 'new', t, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: (msg) => { setEditing(null); if (msg) setNotice({ ok: true, text: msg }) } }),
        channels.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('im.empty')), h('div', null, t('im.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, t('im.add'))),
        channels.length > 0 && h('div', { className: 'n2s-list2', style: { marginTop: editing ? 12 : 0 } }, channels.map(c => h('div', { key: c.id, className: 'n2s-list2-row' },
          h(TypeTile, { type: c.type }),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } },
              h('span', { className: 'n2s-list2-title' }, c.name),
              c.isDefault && h('span', { className: 'n2s-badge' }, t('im.default')),
              c.needsSecret && h('span', { className: 'n2s-badge warn', title: t('ds.needsSecretHint') }, t('ds.needsSecret')),
              c.hasSign && h('span', { className: 'n2s-badge' }, t('im.signed'))),
            h('div', { className: 'n2s-list2-sub' }, t(`im.type.${c.type}`), ' · ', c.type === 'lark_app' ? h('span', { className: 'n2s-mono' }, `${c.receiveIdType}:${c.receiveId}`) : t('im.webhookHidden')),
            c.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, c.lastError)),
          h('div', { className: 'n2s-list2-side' },
            h('span', { className: `n2s-statusdot ${c.lastError ? 'err' : c.lastSentAt ? 'ok' : ''}` }, c.lastError ? t('im.lastFailed') : c.lastSentAt ? t('im.statusOk') : t('im.statusNew')),
            c.lastSentAt && h('span', { className: 'n2s-faint n2s-small' }, new Date(c.lastSentAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(() => call('testChannel', { id: c.id }), t('im.testOk')) }, t('im.test')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              !c.isDefault && { label: t('im.makeDefault'), icon: Icon.check(14), onClick: () => act(() => call('saveChannel', { ...c, isDefault: true })) },
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(c) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'im.deleteConfirm', { name: c.name }), danger: true })) act(() => call('deleteChannel', { id: c.id })) } },
            ] }))))),
        (deliveries.value ?? []).length > 0 && h('div', { className: 'n2s-section' }, h('h2', null, t('im.log')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, ['im.col.time', 'im.col.channel', 'im.col.title', 'im.col.source', 'im.col.status'].map(k => h('th', { key: k }, t(k))))),
            h('tbody', null, deliveries.value.slice(0, 50).map(d => h('tr', { key: d.id },
              h('td', { className: 'n2s-muted' }, new Date(d.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('td', null, d.channelName), h('td', { title: d.title }, d.title),
              h('td', { className: 'n2s-muted' }, t(`im.src.${d.source}`)),
              h('td', { title: d.error ?? '' }, d.status === 'ok'
                ? h('span', { className: 'n2s-statusdot ok' }, [t('im.sentOk'), d.results ? fmt(t, 'im.resultsN', { count: d.results }) : ''].filter(Boolean).join(' · '))
                : h('span', { className: 'n2s-statusdot err' }, d.error ?? t('im.lastFailed'))))))))))
    }

    const HIDDEN_PIN = { hidden: true }
