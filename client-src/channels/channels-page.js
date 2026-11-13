    // ------------------------------------------------------------ channels page
    // 「渠道」: channel list grouped by platform, a two-step "add channel" dialog
    // (platform → kind, then a form rendered from the kind's `fields`), bot
    // settings per bot-capable channel and the delivery log.

    /** Request from elsewhere (bot overview) to open a channel's editor. */
    const channelNav = createStore({ edit: null })
    function openChannelEditor(id, bot) {
      channelNav.set({ edit: { id, bot: Boolean(bot) } })
      fbCtx.navigate?.({ tab: 'admin', section: 'push', sub: null })
    }

    const fieldVisible = (f, config) => {
      if (!f.showIf) return true
      const v = String(config?.[f.showIf.key] ?? '')
      return Array.isArray(f.showIf.equals) ? f.showIf.equals.map(String).includes(v) : v === String(f.showIf.equals)
    }

    /** Move focus between the [data-nav] items of a container with the arrow keys. */
    function arrowNav(e, select) {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const items = [...e.currentTarget.querySelectorAll('[data-nav]:not([disabled])')]
      if (!items.length) return
      const i = items.indexOf(document.activeElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      e.preventDefault()
      items[next].focus()
      if (select) items[next].click()
    }

    /** Modal shell: portal, backdrop, Escape, initial focus and focus restore. */
    function Modal({ label, labelledBy, onClose, width, children, className }) {
      const box = useRef(null)
      useFocusTrap(box)
      useEffect(() => {
        const prev = document.activeElement
        setTimeout(() => box.current?.querySelector('[data-autofocus], input:not([type=checkbox]), select, button:not(.n2s-modal-x)')?.focus(), 0)
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog) { e.stopPropagation(); onClose() } }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [])
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { ref: box, className: `n2s-modal ${className ?? ''}`, role: 'dialog', 'aria-modal': true, 'aria-label': labelledBy ? undefined : label, 'aria-labelledby': labelledBy, style: width ? { width: `min(${width}px, 100%)` } : undefined }, children)), document.body)
    }

    // ---------------------------------------------------------------- step 1

    function KindPicker({ t, catalog, platform, onPlatform, onPick }) {
      const p = catalog.find(x => x.platform === platform) ?? catalog[0]
      return h('div', { className: 'n2s-wiz-pick' },
        h('div', { className: 'n2s-flabel', id: 'n2s-wiz-plabel' }, t('ch.pickPlatform')),
        h('div', { className: 'n2s-ptiles', role: 'radiogroup', 'aria-labelledby': 'n2s-wiz-plabel', onKeyDown: (e) => arrowNav(e, true) },
          catalog.map(x => h('button', {
            key: x.platform, type: 'button', role: 'radio', 'data-nav': true, 'aria-checked': x.platform === p?.platform, tabIndex: x.platform === p?.platform ? 0 : -1,
            'data-autofocus': x.platform === p?.platform ? true : undefined, className: 'n2s-ptile', onClick: () => onPlatform(x.platform),
          }, h(PlatformMark, { t, platform: x.platform, size: 32 }), h('span', { className: 'n2s-ptile-name' }, platformName(t, x.platform, catalog)),
            h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ch.kindsN', { n: (x.kinds ?? []).length }))))),
        p && h(React.Fragment, null,
          h('div', { className: 'n2s-flabel', id: 'n2s-wiz-klabel', style: { marginTop: 18 } }, fmt(t, 'ch.pickKind', { platform: platformName(t, p.platform, catalog) })),
          h('ul', { className: 'n2s-kindcards', 'aria-labelledby': 'n2s-wiz-klabel', onKeyDown: (e) => arrowNav(e, false) },
            (p.kinds ?? []).map(k => h('li', { key: k.id, className: 'n2s-kindcard-li' }, h('button', { type: 'button', 'data-nav': true, className: 'n2s-kindcard', onClick: () => onPick(p.platform, k.id) },
              h('span', { className: 'n2s-kindcard-title' }, L(k.label), h('span', { className: 'n2s-grow' }), Icon.arrow(14)),
              k.description && h('span', { className: 'n2s-kindcard-desc' }, L(k.description)),
              h('span', { className: 'n2s-row', style: { gap: 6, marginTop: 4 } },
                h(CapabilityChips, { t, caps: k.capabilities, type: k.id }),
                k.capabilities?.bot && h('span', { className: 'n2s-faint n2s-small' }, t('ch.noPublicUrl')))))))))
    }

    // ---------------------------------------------------------------- step 2

    function FieldInput({ t, f, value, onChange, error, keep, idBase }) {
      const id = `${idBase}-${CSS_ID(f.key)}`
      const err = error ? `${id}-err` : undefined
      const help = L(f.help)
      const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': [err, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined, 'aria-required': f.required ? true : undefined }
      const secret = isSecretField(f)
      const control = f.type === 'select'
        ? h('select', { ...common, className: 'n2s-select', value: value ?? '', onChange: e => onChange(e.target.value) },
          (value ?? '') === '' && !(f.options ?? []).some(o => o.value === '') && h('option', { value: '' }, '—'),
          (f.options ?? []).map(o => h('option', { key: o.value, value: o.value }, L(o.label) || o.value)))
        : h('input', {
          ...common, className: `n2s-input${secret ? '' : ' n2s-mono-soft'}${error ? ' invalid' : ''}`, type: secret ? 'password' : f.type === 'url' ? 'url' : 'text',
          value: value ?? '', autoComplete: secret ? 'new-password' : 'off', spellCheck: false,
          placeholder: secret && keep ? t('ch.secretKeep') : (L(f.placeholder) || (secret && !f.required ? t('im.optional') : '')),
          onChange: e => onChange(e.target.value),
        })
      return h('div', { className: `n2s-field${f.full || f.type === 'url' || (secret && /url|webhook/i.test(f.key)) ? ' full' : ''}` },
        h('label', { htmlFor: id, className: 'n2s-flabel' }, L(f.label) || f.key, f.required ? h('span', { className: 'n2s-req', 'aria-hidden': true }, ' *') : null,
          secret && keep && h('span', { className: 'n2s-badge ok', style: { marginLeft: 6 } }, t('ch.secretSet'))),
        control,
        error ? h('span', { id: err, className: 'n2s-fielderr', role: 'alert' }, error) : help ? h('span', { id: `${id}-help`, className: 'n2s-faint n2s-small' }, help) : null)
    }

    function TargetPicker({ t, kind, remote, initial, config, secrets, onPick, current }) {
      const [st, setSt] = useState(null)
      const load = async () => {
        setSt({ busy: true })
        try {
          const legacyChats = async () => ((await call('listChannelChats', { id: initial?.id, appId: config.appId, appSecret: secrets.appSecret || undefined, domain: config.domain })) ?? []).map(c => ({ id: c.chatId, name: c.name, type: 'group' }))
          let list
          if (!remote && kind.id === 'lark_app') list = await legacyChats()
          else {
            try {
              list = await call('listChannelTargets', { ...(initial?.id ? { id: initial.id } : {}), type: kind.id, config, secrets })
            } catch (e) {
              if (!isUnknownMethod(e) || kind.id !== 'lark_app') throw e
              list = await legacyChats()
            }
          }
          setSt({ list: Array.isArray(list) ? list : [] })
        } catch (e) { setSt({ error: e.message }) }
      }
      return h('div', { className: 'n2s-field full' },
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn small', onClick: load, disabled: st?.busy }, st?.busy ? h('span', { className: 'n2s-spin' }) : Icon.search(13), t('im.pickChat')),
          h('span', { className: 'n2s-faint n2s-small' }, t('ch.pickHint'))),
        st?.error && h('div', { className: 'n2s-fielderr' }, st.error),
        st?.list && (st.list.length === 0
          ? h('div', { className: 'n2s-muted n2s-small' }, t('im.noChats'))
          : h('div', { role: 'group', 'aria-label': fmt(t, 'im.chats', { count: st.list.length }) },
            h('div', { className: 'n2s-faint n2s-small', style: { margin: '4px 0 6px' } }, fmt(t, 'im.chats', { count: st.list.length })),
            h('div', { className: 'n2s-chips' }, st.list.map(c => h('button', { key: c.id, type: 'button', className: 'n2s-chip', 'aria-pressed': current === c.id, title: c.id, onClick: () => onPick(c) }, c.name || c.id))))))
    }

    function ChannelForm({ t, catalog, remote, platform, kind, initial, focusBot, onBack, onClose }) {
      const bots = useBots()
      const caps = kind.capabilities ?? {}
      const modes = chartModesFor(caps, kind.id)
      const editing = Boolean(initial?.id)
      const fields = kind.fields ?? []
      const initBot = useMemo(() => {
        const b = initial ? botOf(initial, bots) : null
        return { enabled: Boolean(b?.enabled), allowP2p: b ? b.allowP2p !== false : true, sessionScope: b?.sessionScope ?? 'chat' }
      }, [])
      const [form, setForm] = useState(() => {
        const config = { ...(initial?.config ?? {}) }
        for (const f of fields) if (!isSecretField(f) && config[f.key] === undefined) config[f.key] = f.default ?? (f.type === 'select' && f.required !== false ? (f.options?.[0]?.value ?? '') : '')
        return { name: initial?.name ?? '', description: initial?.description ?? '', isDefault: Boolean(initial?.isDefault), chartMode: modes.includes(initial?.chartMode) ? initial.chartMode : modes[0], config, secrets: {}, bot: initBot }
      })
      const pristine = useRef(JSON.stringify(form))
      const dirty = JSON.stringify(form) !== pristine.current
      const [errors, setErrors] = useState({})
      const [general, setGeneral] = useState(null)
      const [busy, setBusy] = useState(null)
      const botRef = useRef(null)
      const formRef = useRef(null)
      useEffect(() => { if (focusBot) setTimeout(() => { botRef.current?.scrollIntoView?.({ block: 'center' }); botRef.current?.querySelector('input')?.focus() }, 30) }, [])
      const visible = fields.filter(f => fieldVisible(f, form.config))
      const setConfig = (k, v) => { setForm(f => ({ ...f, config: { ...f.config, [k]: v } })); setErrors(e => ({ ...e, [k]: undefined })) }
      const setSecret = (k, v) => { setForm(f => ({ ...f, secrets: { ...f.secrets, [k]: v } })); setErrors(e => ({ ...e, [k]: undefined })) }
      const setBot = (patch) => setForm(f => ({ ...f, bot: { ...f.bot, ...patch } }))
      const tf = targetFieldOf(kind)
      const canPick = caps.listTargets && tf && fieldVisible(tf, form.config) && (form.config.receiveIdType === undefined || form.config.receiveIdType === 'chat_id' || !fields.some(f => f.key === 'receiveIdType'))

      const validate = () => {
        const errs = {}
        if (!form.name.trim()) errs.name = t('ch.err.required')
        for (const f of visible) {
          const secret = isSecretField(f)
          const v = String((secret ? form.secrets[f.key] : form.config[f.key]) ?? '').trim()
          if (!v) { if (f.required && !(secret && initial?.secretsSet?.[f.key])) errs[f.key] = t('ch.err.required'); continue }
          if (f.pattern) { try { if (!new RegExp(f.pattern).test(v)) errs[f.key] = t('ch.err.pattern') } catch {} }
          if (f.type === 'url' && !/^https?:\/\//i.test(v)) errs[f.key] = t('ch.err.url')
        }
        return errs
      }
      const payload = () => {
        const config = {}
        const secrets = {}
        for (const f of visible) {
          if (isSecretField(f)) { const v = String(form.secrets[f.key] ?? '').trim(); if (v) secrets[f.key] = v }
          else config[f.key] = typeof form.config[f.key] === 'string' ? form.config[f.key].trim() : form.config[f.key]
        }
        const base = { ...(editing ? { id: initial.id } : {}), name: form.name.trim(), type: kind.id, description: form.description.trim(), isDefault: form.isDefault, chartMode: form.chartMode }
        // Old hosts only understand the flat Lark payload.
        if (!remote) return { ...base, ...config, ...secrets }
        return { ...base, config, secrets, ...(caps.bot ? { bot: form.bot } : {}) }
      }
      const showError = (e) => {
        const msg = e?.message ?? String(e)
        const f = (e?.field && fields.find(x => x.key === e.field)) || visible.find(x => msg.includes(x.key) || [x.label?.zh, x.label?.en, typeof x.label === 'string' ? x.label : null].filter(Boolean).some(l => msg.includes(l)))
        if (f) setErrors({ [f.key]: msg }); else setGeneral(msg)
      }
      const focusFirstError = (errs) => setTimeout(() => {
        const k = Object.keys(errs).find(x => errs[x])
        if (k) formRef.current?.querySelector(`#n2s-chf-${CSS_ID(k)}`)?.focus()
      }, 0)
      const save = async (test) => {
        setGeneral(null)
        const errs = validate()
        setErrors(errs)
        if (Object.keys(errs).length) { focusFirstError(errs); return }
        setBusy(test ? 'test' : 'save')
        let id = initial?.id
        try {
          const saved = await call('saveChannel', payload())
          id = saved?.id ?? id
          if (!remote && caps.bot && id && JSON.stringify(form.bot) !== JSON.stringify(initBot) && (form.bot.enabled || initBot.enabled)) {
            await saveBotFor(id, form.bot).catch(notifyError)
          }
        } catch (e) { setBusy(null); showError(e); return }
        await refreshChannels()
        refreshBots()
        if (test && id) {
          try {
            const r = await call('testChannel', { id })
            if (r && r.ok === false) notify(r.detail ? fmt(t, 'ch.savedTestFailedMsg', { msg: r.detail }) : t('ch.savedTestFailed'), 'err')
            else notify(r?.detail ? `${t('ch.testOk')} · ${r.detail}` : t('ch.testOk'), 'ok')
          } catch (e) { notify(fmt(t, 'ch.savedTestFailedMsg', { msg: e.message }), 'err') }
        } else notify(t('ch.saved'), 'ok')
        setBusy(null)
        onClose()
      }
      const testOnly = async () => {
        setBusy('test'); setGeneral(null)
        try {
          const r = await call('testChannel', { id: initial.id })
          if (r && r.ok === false) setGeneral(r.detail ?? t('im.lastFailed'))
          else notify(r?.detail ? `${t('ch.testOk')} · ${r.detail}` : t('ch.testOk'), 'ok')
          refreshChannels()
        } catch (e) { setGeneral(e.message) }
        setBusy(null)
      }
      const steps = L(kind.setupSteps)
      const stepList = Array.isArray(steps) ? steps : []
      const idBase = 'n2s-chf'
      return h('div', { ref: formRef },
        h('div', { className: 'n2s-wiz-head' },
          !editing && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ch.back'), title: t('ch.back'), onClick: onBack }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, Icon.arrow(14))),
          h(PlatformMark, { t, platform, size: 32 }),
          h('div', { className: 'n2s-grow' },
            h('div', { id: 'n2s-wiz-title', className: 'n2s-modal-title' }, editing ? fmt(t, 'ch.editTitle', { name: initial.name }) : t('ch.addTitle')),
            h('div', { className: 'n2s-muted n2s-small' }, `${platformName(t, platform, catalog)} · ${L(kind.label)}`)),
          h('button', { type: 'button', className: 'n2s-iconbtn n2s-modal-x', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
        !editing && h('ol', { className: 'n2s-wiz-steps', 'aria-label': t('ch.addTitle') },
          h('li', { className: 'done' }, t('ch.step.pick')), h('li', { className: 'current', 'aria-current': 'step' }, t('ch.step.config'))),
        stepList.length > 0 && h('details', { className: 'n2s-setup', open: !editing },
          h('summary', null, fmt(t, 'ch.setupSteps', { n: stepList.length })),
          h('ol', null, stepList.map((s, i) => h('li', { key: i }, s)))),
        h('div', { className: 'n2s-form', style: { marginTop: 14 } },
          h(FieldInput, { t, idBase, f: { key: 'name', label: t('im.name'), required: true, placeholder: t('ph.channelName') }, value: form.name, error: errors.name, onChange: (v) => { setForm(f => ({ ...f, name: v })); setErrors(e => ({ ...e, name: undefined })) } }),
          h(FieldInput, { t, idBase, f: { key: 'description', label: t('im.description') }, value: form.description, onChange: (v) => setForm(f => ({ ...f, description: v })) }),
          visible.map(f => h(FieldInput, {
            key: f.key, t, idBase, f, error: errors[f.key],
            keep: isSecretField(f) && Boolean(initial?.secretsSet?.[f.key]),
            value: isSecretField(f) ? (form.secrets[f.key] ?? '') : form.config[f.key],
            onChange: (v) => (isSecretField(f) ? setSecret(f.key, v) : setConfig(f.key, v)),
          })),
          canPick && h(TargetPicker, {
            t, kind, remote, initial, config: Object.fromEntries(visible.filter(f => !isSecretField(f)).map(f => [f.key, form.config[f.key]])), secrets: Object.fromEntries(Object.entries(form.secrets).filter(([k, v]) => v && visible.some(f => f.key === k))), current: form.config[tf.key],
            onPick: (c) => { setForm(f => ({ ...f, name: f.name || c.name || '', config: { ...f.config, [tf.key]: c.id } })); setErrors(e => ({ ...e, [tf.key]: undefined, name: undefined })) },
          }),
          h('div', { className: 'n2s-field full' },
            h('span', { className: 'n2s-flabel', id: 'n2s-chf-cm' }, t('im.chartMode')),
            h('div', { className: 'n2s-seg', role: 'group', 'aria-labelledby': 'n2s-chf-cm', style: { justifySelf: 'start' } }, modes.map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.chartMode === v, onClick: () => setForm(f => ({ ...f, chartMode: v })) }, t(`im.cm.${v}`)))),
            h('span', { className: 'n2s-faint n2s-small' }, caps.charts === 'none' ? t('ch.tablesOnly') : modes.includes('native') ? t('im.cmHint') : t('ch.cmImage'))),
          h('label', { className: 'n2s-check full' }, h('input', { type: 'checkbox', checked: form.isDefault, onChange: e => setForm(f => ({ ...f, isDefault: e.target.checked })) }), t('im.setDefault'))),
        caps.bot && h('fieldset', { ref: botRef, className: `n2s-botbox${focusBot ? ' focus' : ''}` },
          h('legend', null, t('ch.botSection')),
          h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, t('ch.botSectionHint')),
          h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: form.bot.enabled, onChange: e => setBot({ enabled: e.target.checked }) }), h('span', null, t('ch.botEnable'))),
          form.bot.enabled && h('div', { className: 'n2s-form', style: { marginTop: 12 } },
            h('label', { className: 'n2s-field' }, h('span', null, t('bot.scope')),
              h('select', { className: 'n2s-select', value: form.bot.sessionScope, onChange: e => setBot({ sessionScope: e.target.value }) }, ['chat', 'user'].map(x => h('option', { key: x, value: x }, t(`bot.scope.${x}`))))),
            h('label', { className: 'n2s-check', style: { alignSelf: 'end', height: 34 } }, h('input', { type: 'checkbox', checked: form.bot.allowP2p, onChange: e => setBot({ allowP2p: e.target.checked }) }), t('bot.p2p')))),
        general && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 12 } }, general),
        h('div', { className: 'n2s-row n2s-wiz-foot' },
          h('span', { className: 'n2s-faint n2s-small n2s-grow' }, editing && !dirty ? '' : t('ch.testSavesFirst')),
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
          editing && !dirty
            ? h('button', { type: 'button', className: 'n2s-btn', disabled: Boolean(busy), onClick: testOnly }, busy === 'test' ? h('span', { className: 'n2s-spin' }) : null, t('ch.testConn'))
            : h('button', { type: 'button', className: 'n2s-btn', disabled: Boolean(busy), onClick: () => save(true) }, busy === 'test' ? h('span', { className: 'n2s-spin' }) : null, t('im.saveTest')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: Boolean(busy), onClick: () => save(false) }, busy === 'save' ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }
    const CSS_ID = (k) => String(k).replace(/[^\w-]/g, '_')

    /** Add (pick platform → kind → form) or edit (form only) a channel. */
    function ChannelWizard({ t, initial, focusBot, onClose }) {
      const { catalog, remote, ready } = useCatalog(t)
      const editing = Boolean(initial?.id)
      const [platform, setPlatform] = useState(initial?.platform ?? null)
      const [type, setType] = useState(initial?.type ?? null)
      const p = platform ?? catalog[0]?.platform
      const found = type ? findKind(catalog, type) : null
      const step = type ? 'form' : 'pick'
      return h(Modal, { label: editing ? fmt(t, 'ch.editTitle', { name: initial.name }) : t('ch.addTitle'), labelledBy: step === 'form' && found ? 'n2s-wiz-title' : undefined, onClose, width: 720, className: 'n2s-wizard' },
        !ready ? h('div', { className: 'n2s-skel', style: { height: 220 } }) :
          step === 'pick' ? h(React.Fragment, null,
            h('div', { className: 'n2s-wiz-head' },
              h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-modal-title' }, t('ch.addTitle')), h('div', { className: 'n2s-muted n2s-small' }, t('ch.addSub'))),
              h('button', { type: 'button', className: 'n2s-iconbtn n2s-modal-x', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
            h('ol', { className: 'n2s-wiz-steps', 'aria-label': t('ch.addTitle') }, h('li', { className: 'current', 'aria-current': 'step' }, t('ch.step.pick')), h('li', null, t('ch.step.config'))),
            catalog.length === 0 ? h('div', { className: 'n2s-empty' }, t('ch.noCatalog')) :
              h(KindPicker, { t, catalog, platform: p, onPlatform: setPlatform, onPick: (pl, k) => { setPlatform(pl); setType(k) } })) :
          !found ? h('div', null,
            h('div', { className: 'n2s-notice err' }, fmt(t, 'ch.unknownKind', { type })),
            h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } }, h('button', { type: 'button', className: 'n2s-btn', onClick: onClose }, t('ds.cancel')))) :
            h(ChannelForm, { key: type, t, catalog, remote, platform: found.platform.platform, kind: found.kind, initial: editing ? initial : null, focusBot, onBack: () => setType(null), onClose }))
    }

    // ----------------------------------------------------------------- list

    const shortTime = (ts) => new Date(ts).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    function ChannelRow({ t, c, catalog, bots, onEdit, act }) {
      const kind = findKind(catalog, c.type)?.kind
      const caps = c.capabilities ?? kind?.capabilities
      const target = targetSummary(t, c, kind)
      const bot = caps?.bot ? botOf(c, bots) : null
      return h('div', { className: 'n2s-list2-row', 'data-channel': c.id },
        h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
          h('div', { className: 'n2s-row', style: { gap: 6 } },
            h('span', { className: 'n2s-list2-title' }, c.name),
            c.isDefault && h('span', { className: 'n2s-badge blue' }, t('im.default')),
            c.needsSecret && h('span', { className: 'n2s-badge warn', title: t('ds.needsSecretHint') }, t('ds.needsSecret')),
            c.secretsSet?.signSecret && h('span', { className: 'n2s-badge' }, t('im.signed'))),
          h('div', { className: 'n2s-list2-sub' }, kindLabel(t, c.type, catalog), target ? ' · ' : '', target && h('span', { className: target === t('im.webhookHidden') ? undefined : 'n2s-mono' }, target)),
          h('div', { className: 'n2s-row', style: { gap: 8, marginTop: 6 } },
            h(CapabilityChips, { t, caps, type: c.type }),
            bot && h(BotDot, { t, bot, prefix: t('ch.cap.bot') })),
          c.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)', whiteSpace: 'normal' } }, c.lastError)),
        h('div', { className: 'n2s-list2-side' },
          h('span', { className: `n2s-statusdot ${c.lastError ? 'err' : c.lastSentAt ? 'ok' : ''}` }, c.lastError ? t('im.lastFailed') : c.lastSentAt ? t('im.statusOk') : t('im.statusNew')),
          c.lastSentAt && h('span', { className: 'n2s-faint n2s-small' }, `${t('im.lastSent')} ${shortTime(c.lastSentAt)}`)),
        h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(() => call('testChannel', { id: c.id }), t('ch.testOk')) }, t('im.test')),
          h(Dropdown, { label: fmt(t, 'ch.actionsFor', { name: c.name }), trigger: { content: Icon.more() }, items: [
            { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => onEdit(c, false) },
            !c.isDefault && { label: t('im.makeDefault'), icon: Icon.check(14), onClick: () => act(() => makeDefault(c), t('ch.defaultSet')) },
            caps?.bot && { label: t('ch.botSettings'), icon: Icon.spark(14), onClick: () => onEdit(c, true) },
            { divider: true },
            { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'im.deleteConfirm', { name: c.name }), message: caps?.bot && bot?.enabled ? t('ch.deleteBotWarn') : undefined, confirmLabel: t('ds.delete'), danger: true })) act(() => call('deleteChannel', { id: c.id }), t('ch.deleted')) } },
          ] })))
    }

    /** Mark a channel as default; old hosts need the flat payload, new ones the config shape. */
    function makeDefault(c) {
      if (c.legacy) return call('saveChannel', { id: c.id, name: c.name, type: c.type, description: c.description, chartMode: c.chartMode, ...c.config, isDefault: true })
      return call('saveChannel', { id: c.id, name: c.name, type: c.type, description: c.description, chartMode: c.chartMode, config: c.config, secrets: {}, isDefault: true })
    }

    function DeliveryLog({ t, channels, deliveries }) {
      const [open, setOpen] = useState(false)
      const rows = deliveries ?? []
      if (!rows.length) return null
      const failed = rows.slice(0, 50).filter(d => d.status !== 'ok').length
      const platformOf = (d) => d.platform ?? channels.find(c => c.id === d.channelId)?.platform ?? channels.find(c => c.name === d.channelName)?.platform
      return h('div', { className: 'n2s-collapse' },
        h('button', { type: 'button', 'aria-expanded': open, 'aria-controls': 'n2s-deliveries', onClick: () => setOpen(v => !v) },
          t('im.log'), h('span', { className: 'n2s-faint' }, rows.length), failed > 0 && h('span', { className: 'n2s-badge err' }, fmt(t, 'ch.failedN', { n: failed })), Icon.chev(12)),
        open && h('div', { id: 'n2s-deliveries', className: 'n2s-table-wrap', style: { marginTop: 12 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, ['im.col.time', 'im.col.channel', 'im.col.title', 'im.col.source', 'im.col.status'].map(k => h('th', { key: k }, t(k))))),
          h('tbody', null, rows.slice(0, 50).map(d => h('tr', { key: d.id },
            h('td', { className: 'n2s-muted' }, shortTime(d.at)),
            h('td', null, h('span', { className: 'n2s-row', style: { gap: 6, flexWrap: 'nowrap' } }, platformOf(d) && h(PlatformMark, { t, platform: platformOf(d), size: 18 }), d.channelName)),
            h('td', { title: d.title }, d.title),
            h('td', { className: 'n2s-muted' }, tOpt(t, `im.src.${d.source}`) || d.source),
            h('td', { title: d.error ?? '' }, d.status === 'ok'
              ? h('span', { className: 'n2s-statusdot ok' }, [t('im.sentOk'), d.results ? fmt(t, 'im.resultsN', { count: d.results }) : '', d.files ? t('im.sentFile') : '', d.error ? d.error : ''].filter(Boolean).join(' · '))
              : h('span', { className: 'n2s-statusdot err' }, d.error ?? t('im.lastFailed')))))))))
    }

    function PushTab({ t }) {
      const channels = useChannels()
      const bots = useBots()
      const { catalog } = useCatalog(t)
      const deliveries = useAsync(() => call('listDeliveries'), [channels], [])
      const [editing, setEditing] = useState(null)
      // Pick up host upgrades (catalog, new channel shape) whenever the page opens.
      useEffect(() => { loadCatalog(); refreshChannels(); refreshBots() }, [])
      useEffect(() => {
        const id = setInterval(() => { if (!document.hidden) refreshBots() }, 8000)
        return () => clearInterval(id)
      }, [])
      // Opened from the bot overview: jump straight into that channel's bot settings.
      const nav = useSyncExternalStore(channelNav.subscribe, channelNav.get, channelNav.get)
      useEffect(() => {
        if (!nav.edit) return
        const c = channels.find(x => x.id === nav.edit.id)
        if (c) { setEditing({ channel: c, focusBot: nav.edit.bot }); channelNav.set({ edit: null }) }
      }, [nav, channels])
      const act = async (fn, ok) => {
        try { const r = await fn(); if (r && r.ok === false) notify(r.detail ?? t('im.lastFailed'), 'err'); else if (ok) notify(r?.detail ? `${ok} · ${r.detail}` : ok, 'ok') } catch (e) { notifyError(e) }
        refreshChannels()
        refreshBots()
      }
      const groups = []
      for (const c of channels) {
        let g = groups.find(x => x.platform === c.platform)
        if (!g) groups.push(g = { platform: c.platform, items: [] })
        g.items.push(c)
      }
      const rank = (p) => { const i = catalog.findIndex(x => x.platform === p); return i < 0 ? 99 : i }
      groups.sort((a, b) => rank(a.platform) - rank(b.platform))
      const add = () => setEditing({ channel: null })
      return h('div', null,
        h(SectionHead, { title: t('admin.push'), desc: t('ch.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: add }, '+ ', t('im.add'))),
        channels.length === 0
          ? h('div', { className: 'n2s-empty' },
            h('div', { className: 'n2s-row', style: { justifyContent: 'center', gap: 8, marginBottom: 12 } }, catalog.map(p => h(PlatformMark, { key: p.platform, t, platform: p.platform, size: 32 }))),
            h('h3', null, t('im.empty')), h('div', null, t('ch.emptyHint')),
            h('button', { type: 'button', className: 'n2s-btn primary', onClick: add }, t('im.add')))
          : h('div', { className: 'n2s-pgroups' }, groups.map(g => h('section', { key: g.platform, className: 'n2s-pgroup', 'aria-label': platformName(t, g.platform, catalog) },
            h('div', { className: 'n2s-pgroup-head' }, h(PlatformMark, { t, platform: g.platform, size: 22 }), h('span', null, platformName(t, g.platform, catalog)), h('span', { className: 'n2s-faint' }, g.items.length)),
            h('div', { className: 'n2s-list2' }, g.items.map(c => h(ChannelRow, { key: c.id, t, c, catalog, bots, act, onEdit: (ch, focusBot) => setEditing({ channel: ch, focusBot }) })))))),
        h(DeliveryLog, { t, channels, deliveries: deliveries.value }),
        editing && h(ChannelWizard, { key: editing.channel?.id ?? 'new', t, initial: editing.channel, focusBot: editing.focusBot, onClose: () => setEditing(null) }))
    }

    const HIDDEN_PIN = { hidden: true }
