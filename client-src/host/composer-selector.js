    // ------------------------------------------------ composer selector

    function makeComposerControl(ctx) {
      return function Nl2SqlComposerControl({ sessionId }) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const info = useSyncExternalStore(sessionInfoCache.subscribe, () => sessionInfoCache.get()[sessionId], () => sessionInfoCache.get()[sessionId])
        const datasources = useStore(s => s.datasources)
        const [open, setOpen] = useState(false)
        const anchor = useRef(null)
        const menu = useRef(null)
        useEffect(() => {
          if (!sessionId) return
          let cancelled = false
          ;(async () => {
            const fresh = pendingAsks.length > 0 && !seenSessions.has(sessionId)
            seenSessions.add(sessionId)
            if (fresh) {
              // A session already bound to a data source, or running another preset, is not ours.
              const info = await call('sessionInfo', { sessionId }).catch(() => null)
              const candidate = info && !info.boundDatasourceId && (info.preset === PRESET || info.preset === null || info.preset === undefined)
              const pending = candidate ? claimPendingAsk(sessionId) : null
              if (pending) await call('bindSession', { sessionId, datasourceId: pending.datasourceId }).catch(() => {})
            }
            if (!cancelled) await loadSessionInfo(sessionId)
          })()
          if (!store.get().loaded) refreshDatasources()
          return () => { cancelled = true }
        }, [sessionId])
        useEffect(() => {
          if (!open) return
          const onDown = (e) => { if (!menu.current?.contains(e.target) && !anchor.current?.contains(e.target)) setOpen(false) }
          const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); anchor.current?.focus() } }
          document.addEventListener('mousedown', onDown)
          document.addEventListener('keydown', onKey)
          menu.current?.querySelector('button')?.focus()
          return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
        }, [open])
        if (!info || info.preset !== PRESET) return null
        const current = datasources.find(d => d.id === info.datasourceId)
        const rect = anchor.current?.getBoundingClientRect()
        return h(React.Fragment, null,
          h('button', { ref: anchor, type: 'button', className: 'n2s-composer', title: t('composer.title'), 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(v => !v) },
            Icon.db(14), h('span', null, current ? current.name : t('composer.none')), Icon.chev(10)),
          open && rect && ReactDOM.createPortal(h('div', {
            ref: menu, className: 'n2s-menu', role: 'menu',
            style: { left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 6) },
          }, datasources.length === 0 && h('div', { className: 'n2s-muted n2s-small', style: { padding: '6px 10px' } }, t('ds.none')),
          datasources.map(ds => h('button', {
            key: ds.id, type: 'button', role: 'menuitemradio', 'aria-checked': ds.id === info.datasourceId,
            onClick: async () => {
              setOpen(false)
              await call('bindSession', { sessionId, datasourceId: ds.id }).catch(e => notifyError(e))
              await loadSessionInfo(sessionId)
            },
          }, h('span', { className: 'check' }, ds.id === info.datasourceId ? Icon.check() : null), h('span', { className: 'n2s-grow' }, ds.name), h('span', { className: 'n2s-muted n2s-small' }, ds.database)))), document.body))
      }
    }

