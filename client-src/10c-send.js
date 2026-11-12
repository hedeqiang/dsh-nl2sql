    /** Modal dialog sending a title, text and results to an IM channel. */
    function SendDialog({ t, initial, onClose }) {
      const channels = useChannels()
      const [form, setForm] = useState(() => ({ channelId: '', title: initial.title ?? '', text: initial.text ?? '', includeSql: false, chartMode: '', attachFull: true }))
      const [resultIds, setResultIds] = useState(initial.resultIds ?? [])
      const [loading, setLoading] = useState(Boolean(initial.message))
      useEffect(() => {
        if (!initial.message) return
        call('previewAssistantMessage', initial.message).then((p) => {
          setForm(f => ({ ...f, text: p.text, title: f.title || (p.text.split('\n').map(l => l.replace(/^#+\s*|\*\*/g, '').trim()).find(Boolean) ?? '').slice(0, 60) }))
          setResultIds(p.resultIds)
          setLoading(false)
        }, (e) => { setState({ error: e.message }); setLoading(false) })
      }, [])
      const [state, setState] = useState(null)
      const ref = useRef(null)
      useFocusTrap(ref)
      const closeTimer = useRef(null)
      useEffect(() => () => clearTimeout(closeTimer.current), [])
      const busyRef = useRef(false)
      busyRef.current = Boolean(state?.busy)
      useEffect(() => {
        const def = channels.find(c => c.isDefault) ?? channels[0]
        if (def && !form.channelId) setForm(f => ({ ...f, channelId: def.id }))
      }, [channels.length])
      useEffect(() => {
        const prev = document.activeElement
        ref.current?.querySelector('select, textarea, input, button')?.focus()
        // Escape belongs to a confirm/prompt dialog on top, if any.
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog) onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [])
      const send = async () => {
        if (busyRef.current) return
        busyRef.current = true
        setState({ busy: true })
        try {
          const res = initial.dashboard
            ? await call('sendDashboard', { channelId: form.channelId, title: form.title, attachFull: form.attachFull, ...(form.chartMode ? { chartMode: form.chartMode } : {}) })
            : await call('sendToChannel', { channelId: form.channelId, title: form.title, text: form.text, resultIds, includeSql: form.includeSql, attachFull: form.attachFull, ...(form.chartMode ? { chartMode: form.chartMode } : {}), sessionId: initial.message?.sessionId })
          setState({ ok: `${fmt(t, 'im.sent', { channel: res.channel, images: res.images })}${res.files ? ` · ${t('im.sentFile')}` : ''}`, warn: res.warning })
          refreshChannels()
          closeTimer.current = setTimeout(onClose, 1200)
        } catch (e) {
          setState({ error: e.message })
        }
      }
      const channel = channels.find(c => c.id === form.channelId)
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { ref, className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('im.sendTitle') },
          h('div', { className: 'n2s-row', style: { marginBottom: 12 } }, h('span', { style: { fontWeight: 500, fontSize: 15 } }, t('im.sendTitle')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('ds.cancel'), onClick: onClose }, '×')),
          channels.length === 0
            ? h('div', { className: 'n2s-empty' }, h('div', { className: 'n2s-muted' }, t('im.noChannel')))
            : h('div', { style: { display: 'grid', gap: 10 } },
              h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-send-channel', className: 'n2s-flabel' }, t('im.channel')),
                h(ChannelPicker, { t, id: 'n2s-send-channel', value: form.channelId, onChange: (v) => setForm(f => ({ ...f, channelId: v, chartMode: '' })) })),
              h('label', { className: 'n2s-field' }, h('span', null, t('im.msgTitle')), h('input', { className: 'n2s-input', value: form.title, onChange: e => setForm(f => ({ ...f, title: e.target.value })) })),
              !initial.dashboard && h('div', { className: 'n2s-field' }, h('span', null, t('im.text')),
                loading ? h('span', { className: 'n2s-spin n2s-muted' }) : h(MdEditor, { t, value: form.text, onChange: (v) => setForm(f => ({ ...f, text: v })) })),
              h('div', { className: 'n2s-muted n2s-small' }, initial.dashboard ? t('im.dashboardHint') : fmt(t, 'im.attach', { count: resultIds.length })),
              (resultIds.length > 0 || initial.dashboard) && h('div', { className: 'n2s-row' },
                h('span', { className: 'n2s-small' }, t('im.chartMode')),
                channel?.capabilities?.charts === 'none' && h('span', { className: 'n2s-faint n2s-small' }, t('ch.tablesOnly')),
                h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('im.chartMode') }, ['', ...chartModesFor(channel?.capabilities, channel?.type)].map(v => h('button', { key: v || 'def', type: 'button', 'aria-pressed': form.chartMode === v, onClick: () => setForm(f => ({ ...f, chartMode: v })) }, t(v ? `im.cm.${v}` : 'im.cm.default'))))),
              !initial.dashboard && resultIds.length > 0 && h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.includeSql, onChange: e => setForm(f => ({ ...f, includeSql: e.target.checked })) }), t('im.includeSql')),
              (resultIds.length > 0 || initial.dashboard) && h('div', { className: 'n2s-field' },
                channel?.capabilities?.files
                  ? h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.attachFull, onChange: e => setForm(f => ({ ...f, attachFull: e.target.checked })) }), fmt(t, 'im.attachFull', { n: channel.capabilities.tableRows ?? 10 }))
                  : h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'im.rowsLimit', { n: channel?.capabilities?.tableRows ?? 10 })))),
          state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
          state?.ok && h('div', { className: 'n2s-notice ok', style: { marginTop: 10 } }, state.ok),
          state?.warn && h('div', { className: 'n2s-notice warn', style: { marginTop: 8 } }, state.warn),
          h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
            h('button', { type: 'button', className: 'n2s-btn primary', disabled: !form.channelId || !form.title.trim() || state?.busy || loading, onClick: send }, state?.busy ? h('span', { className: 'n2s-spin' }) : null, t('im.send'))))), document.body)
    }
