    // ---------------------------------------------------- dashboards bar

    function DashboardSwitcher({ t, value, onChange }) {
      const list = useAsync(() => call('listDashboards'), [value?.id], [])
      const v = list.value
      if (!v) return null
      const cur = v.dashboards.find(d => d.id === v.current)
      const act = async (fn) => { try { const r = await fn(); list.reload(); onChange(r?.current ?? v.current) } catch (e) { notifyError(e) } }
      return h('div', { className: 'n2s-dashtabs', role: 'tablist' },
        v.dashboards.map(d => h('button', { key: d.id, type: 'button', role: 'tab', 'aria-selected': d.id === v.current, onClick: () => act(() => call('selectDashboard', { id: d.id })) }, d.name, h('span', { className: 'count' }, d.widgets))),
        h(Dropdown, { label: t('dash.manage'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, '+', Icon.chev(10)) }, items: [
          { label: t('dash.new'), icon: Icon.chart(14), onClick: async () => { const name = await promptDialog({ title: t('dash.newName') }); if (name) act(() => call('saveDashboard', { name })) } },
          { label: t('dash.duplicate'), icon: Icon.copy(14), onClick: async () => { const name = await promptDialog({ title: t('dash.newName'), value: fmt(t, 'dash.copyName', { name: cur?.name ?? '' }) }); if (name) act(() => call('saveDashboard', { name, copyFrom: v.current })) } },
          { label: t('dash.renameBoard'), icon: Icon.edit(14), onClick: async () => { const name = await promptDialog({ title: t('dash.renameBoard'), value: cur?.name }); if (name) act(() => call('saveDashboard', { id: v.current, name })) } },
          { divider: true },
          v.dashboards.length > 1 && { label: t('dash.deleteBoard'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'dash.deleteBoardConfirm', { name: cur?.name }), danger: true })) act(() => call('deleteDashboard', { id: v.current })) } },
        ] }))
    }

    function CacheStats({ t }) {
      const st = useAsync(() => call('cacheStats'), [])
      const v = st.value
      return h('div', { className: 'n2s-row' },
        h('span', { className: 'n2s-small n2s-muted' }, v ? fmt(t, 'settings.cacheStatsText', { results: v.results, mb: (v.bytes / 1048576).toFixed(1), cache: v.cacheEntries }) : '…'),
        h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: async () => { try { await call('clearCache') } catch (e) { notifyError(e) } st.reload() } }, t('settings.clearCache')))
    }

    function ChannelSelect({ t, value, onChange }) {
      return h('div', { style: { maxWidth: 380 } }, h(ChannelPicker, { t, value, onChange, noneLabel: t('rep.pushNone'), label: t('set.l.notify') }))
    }

    // Questions started from the page bind their new session to the chosen
    // data source as soon as the session appears in the composer. Only the
    // session our own startSession created may claim an ask: the one whose id
    // startSession returned (when the host returns it), otherwise a session the
    // composer had not seen before the ask was made, within PENDING_ASK_MS.
    const pendingAsks = []
    const seenSessions = new Set()
    const PENDING_ASK_MS = 60000
    function addPendingAsk(datasourceId, question) {
      const pending = { datasourceId, question, at: Date.now(), seen: new Set(seenSessions), sessionId: null }
      pendingAsks.push(pending)
      setTimeout(() => { const i = pendingAsks.indexOf(pending); if (i >= 0) pendingAsks.splice(i, 1) }, PENDING_ASK_MS)
      return pending
    }
    /** Remove and return the pending ask that belongs to this session, if any. */
    function claimPendingAsk(sessionId) {
      const now = Date.now()
      const i = pendingAsks.findIndex(p => now - p.at < PENDING_ASK_MS && (p.sessionId ? p.sessionId === sessionId : !p.seen.has(sessionId)))
      return i >= 0 ? pendingAsks.splice(i, 1)[0] : null
    }

