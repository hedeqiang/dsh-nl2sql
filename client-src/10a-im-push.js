    // ------------------------------------------------------------ IM push

    function makeReplyAction(ctx) {
      return function Nl2SqlReplySend({ messageId, sessionId }) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        const info = useSyncExternalStore(sessionInfoCache.subscribe, () => sessionInfoCache.get()[sessionId], () => sessionInfoCache.get()[sessionId])
        const [open, setOpen] = useState(false)
        useEffect(() => { if (sessionId && !info) loadSessionInfo(sessionId) }, [sessionId])
        if (!info || info.preset !== PRESET) return null
        return h(React.Fragment, null,
          h('button', { type: 'button', className: 'n2s-reply-send', title: t('im.sendReply'), 'aria-label': t('im.sendReply'), onClick: () => setOpen(true) },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z' }))),
          open && h(SendDialog, { t, initial: { title: '', message: { sessionId, messageId } }, onClose: () => setOpen(false) }))
      }
    }

    const channelStore = createStore({ list: null })
    async function refreshChannels() {
      try { channelStore.set({ list: await call('listChannels') }) } catch { channelStore.set({ list: [] }) }
    }
    function useChannels() {
      const get = () => channelStore.get().list
      const list = useSyncExternalStore(channelStore.subscribe, get, get)
      useEffect(() => { if (list === null) refreshChannels() }, [])
      return list ?? []
    }
