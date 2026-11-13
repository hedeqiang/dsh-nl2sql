    // ------------------------------------------------------------ feedback
    // In-page toasts and dialogs that replace window.alert / confirm / prompt.
    // `notify`, `confirmDialog` and `promptDialog` can be called from anywhere
    // (event handlers, async code); the host <FeedbackLayer/> renders them.

    const feedbackStore = createStore({ toasts: [], dialog: null })
    let toastSeq = 0

    /** Show a transient message. kind: 'info' | 'ok' | 'err'. */
    function notify(text, kind = 'info', ms) {
      const id = ++toastSeq
      const toast = { id, text: String(text ?? ''), kind }
      feedbackStore.set({ ...feedbackStore.get(), toasts: [...feedbackStore.get().toasts, toast].slice(-4) })
      setTimeout(() => feedbackStore.set({ ...feedbackStore.get(), toasts: feedbackStore.get().toasts.filter(x => x.id !== id) }), ms ?? (kind === 'err' ? 6000 : 3000))
    }
    const notifyError = (e) => notify(e?.message ?? String(e), 'err')

    /** Resolve to true when confirmed. */
    function confirmDialog({ title, message, confirmLabel, danger = false }) {
      return new Promise(resolve => feedbackStore.set({ ...feedbackStore.get(), dialog: { kind: 'confirm', title, message, confirmLabel, danger, resolve } }))
    }

    /** Resolve to the entered text, or null when cancelled. */
    function promptDialog({ title, message, value = '', placeholder, confirmLabel, validate }) {
      return new Promise(resolve => feedbackStore.set({ ...feedbackStore.get(), dialog: { kind: 'prompt', title, message, value, placeholder, confirmLabel, validate, resolve } }))
    }

    function FeedbackLayer({ t }) {
      const get = () => feedbackStore.get()
      const st = useSyncExternalStore(feedbackStore.subscribe, get, get)
      const d = st.dialog
      const [value, setValue] = useState('')
      const [err, setErr] = useState(null)
      const box = useRef(null)
      useFocusTrap(box, Boolean(d))
      useEffect(() => {
        if (!d) return
        setValue(d.value ?? '')
        setErr(null)
        const prev = document.activeElement
        setTimeout(() => (box.current?.querySelector('input') ?? box.current?.querySelector('button.primary'))?.focus(), 0)
        return () => prev?.focus?.()
      }, [d])
      const close = (result) => { feedbackStore.set({ ...feedbackStore.get(), dialog: null }); d?.resolve(result) }
      const ok = () => {
        if (d.kind === 'prompt') {
          const v = value.trim()
          if (!v) { setErr(t('fb2.required')); return }
          const msg = d.validate?.(v)
          if (msg) { setErr(msg); return }
          close(v)
        } else close(true)
      }
      return h(React.Fragment, null,
        h('div', { className: 'n2s-toasts', role: 'status', 'aria-live': 'polite' }, st.toasts.map(x => h('div', { key: x.id, className: `n2s-toast ${x.kind}` }, x.kind === 'ok' ? Icon.check(14) : x.kind === 'err' ? Icon.close(13) : null, h('span', null, x.text)))),
        d && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) close(d.kind === 'prompt' ? null : false) } },
          h('div', { ref: box, className: 'n2s-modal', role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': 'n2s-dlg-title', style: { width: 'min(440px, 100%)' }, onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(d.kind === 'prompt' ? null : false) } if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') ok() } },
            h('div', { id: 'n2s-dlg-title', className: 'n2s-modal-title', style: { marginBottom: 8 } }, d.title),
            d.message && h('div', { className: 'n2s-muted', style: { fontSize: 13.5, marginBottom: 12, whiteSpace: 'pre-wrap' } }, d.message),
            d.kind === 'prompt' && h('input', { className: 'n2s-input', value, placeholder: d.placeholder, 'aria-label': d.title, onChange: e => { setValue(e.target.value); setErr(null) } }),
            err && h('div', { className: 'n2s-small', style: { color: 'var(--n2s-err)', marginTop: 6 } }, err),
            h('div', { className: 'n2s-row', style: { marginTop: 16, justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => close(d.kind === 'prompt' ? null : false) }, t('ds.cancel')),
              h('button', { type: 'button', className: `n2s-btn ${d.danger ? 'danger-solid' : 'primary'}`, onClick: ok }, d.confirmLabel ?? t('fb2.ok'))))), document.body))
    }


    /** Mount the FeedbackLayer once into its own root under document.body; returns the disposer. */
    function mountFeedbackLayer(ctx) {
      const el = document.createElement('div')
      el.className = 'n2s-feedback-root'
      el.dataset.plugin = PKG
      document.body.appendChild(el)
      const root = ReactDOMClient.createRoot(el)
      function GlobalFeedback() {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        return h(FeedbackLayer, { t })
      }
      root.render(h(GlobalFeedback))
      return () => { const d = feedbackStore.get().dialog; feedbackStore.set({ ...feedbackStore.get(), dialog: null }); d?.resolve(d.kind === 'prompt' ? null : false); setTimeout(() => { root.unmount(); el.remove() }, 0) }
    }
