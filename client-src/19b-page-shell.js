    // ---------------------------------------------------------- page shell
    // Five everyday tabs on top; administration lives behind one "管理" tab with
    // a left-hand section nav. The current location is kept in the URL hash-free
    // local state and remembered per browser (localStorage) so a refresh lands
    // where the user was.

    const PRIMARY_TABS = ['ask', 'dashboard', 'schema', 'knowledge', 'history']
    const ADMIN_SECTIONS = ['sources', 'members', 'automation', 'push', 'settings']
    const NAV_KEY = 'nl2sql:nav'

    function loadNav() {
      try { const v = JSON.parse(localStorage.getItem(NAV_KEY) ?? 'null'); if (v && (PRIMARY_TABS.includes(v.tab) || v.tab === 'admin')) return v } catch {}
      return { tab: 'ask', section: 'sources', sub: null }
    }

    const AdminIcons = {
      sources: () => Icon.db(15),
      members: () => svg(15, [h('circle', { key: 1, cx: 6, cy: 5.5, r: 2.5 }), h('path', { key: 2, d: 'M1.5 13.5c.6-2.4 2.3-3.8 4.5-3.8s3.9 1.4 4.5 3.8M11 3.2a2.4 2.4 0 0 1 0 4.6M12.6 9.9c1 .6 1.7 1.8 2 3.6' })]),
      automation: () => svg(15, [h('circle', { key: 1, cx: 8, cy: 8.5, r: 5.5 }), h('path', { key: 2, d: 'M8 5.5v3l2 1.5M6 1.5h4' })]),
      push: () => Icon.send(15),
      settings: () => svg(15, [h('path', { key: 1, d: 'M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7' }), h('circle', { key: 2, cx: 11, cy: 4.5, r: 1.5 }), h('circle', { key: 3, cx: 5, cy: 11.5, r: 1.5 })]),
    }

    function AdminArea({ t, ctx, section, sub, onNavigate, ds, datasources }) {
      const counts = useAsync(() => Promise.all([call('listAlerts').catch(() => []), call('listReports').catch(() => []), call('listChannels').catch(() => []), call('listUsers').catch(() => [])]), [section])
      const [alerts, reports, channels, users] = counts.value ?? []
      const badge = { sources: datasources.length, members: users?.length, automation: (alerts?.length ?? 0) + (reports?.length ?? 0), push: channels?.length }
      const firing = (alerts ?? []).filter(a => a.state === 'firing').length
      const autoSub = sub === 'reports' ? 'reports' : 'alerts'
      return h('div', { className: 'n2s-admin' },
        h('nav', { className: 'n2s-adminnav', 'aria-label': t('tab.admin') },
          ADMIN_SECTIONS.map(k => h('button', { key: k, type: 'button', className: 'n2s-adminnav-item', 'aria-current': section === k ? 'page' : undefined, onClick: () => onNavigate({ section: k, sub: null }) },
            h('span', { className: 'ico', 'aria-hidden': true }, AdminIcons[k]()),
            h('span', { className: 'n2s-grow' }, t(`admin.${k}`)),
            k === 'automation' && firing > 0 ? h('span', { className: 'n2s-navbadge err', title: t('al.firing') }, firing) : badge[k] ? h('span', { className: 'n2s-navbadge' }, badge[k]) : null))),
        h('div', { className: 'n2s-adminbody' },
          section === 'sources' ? h(SourcesTab, { t, datasources }) :
          section === 'members' ? h(MembersTab, { t, datasources }) :
          section === 'automation' ? h(React.Fragment, null,
            h('div', { className: 'n2s-seg', role: 'tablist', style: { marginBottom: 16 } },
              ['alerts', 'reports'].map(k => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': autoSub === k, 'aria-pressed': autoSub === k, onClick: () => onNavigate({ section, sub: k }) }, t(`tab.${k}`),
                k === 'alerts' && alerts?.length ? h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, alerts.length) : null,
                k === 'reports' && reports?.length ? h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, reports.length) : null))),
            autoSub === 'alerts' ? h(AlertsTab, { t, ds, datasources }) : h(ReportsTab, { t, ds, datasources, onOpenSession: (id) => ctx.uiWorkspace.openSession(id), onOpenSchedules: () => ctx.layout.selectPanel('schedules') })) :
          section === 'push' ? h(PushTab, { t }) :
          h(SettingsPage, { t, datasources, onNavigate })))
    }

    function makePage(ctx) {
      return function Nl2SqlPage() {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        const localeSnap = useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot())
        setUiLang(localeSnap)
        const { datasources, loaded, error } = useStore(s => s)
        const [nav, setNavState] = useState(loadNav)
        const setNav = useCallback((patch) => setNavState(n => { const next = { ...n, ...patch }; try { localStorage.setItem(NAV_KEY, JSON.stringify(next)) } catch {} return next }), [])
        const [selectedId, setSelectedId] = useState(null)
        useEffect(() => { refreshDatasources() }, [])
        const ds = datasources.find(d => d.id === selectedId) ?? datasources.find(d => d.current) ?? datasources[0]
        const needsSource = loaded && datasources.length === 0 && ['schema', 'knowledge'].includes(nav.tab)
        const ask = useCallback((question) => {
          if (!ds) return
          const pending = { datasourceId: ds.id, question }
          pendingAsks.push(pending)
          setTimeout(() => { const i = pendingAsks.indexOf(pending); if (i >= 0) pendingAsks.splice(i, 1) }, 60000)
          try {
            ctx.uiWorkspace.startSession(undefined, { agentPreset: PRESET, prompt: question, whenDraftExists: 'replace' })
          } catch (e) {
            notifyError(e)
          }
        }, [ds?.id])
        fbCtx.openSession = (id) => ctx.uiWorkspace.openSession(id)
        fbCtx.navigate = (patch) => setNav(patch)
        const tabs = [...PRIMARY_TABS, 'admin']
        const onTabKey = (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const i = tabs.indexOf(nav.tab)
          const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
          setNav({ tab: next })
          setTimeout(() => document.getElementById(`n2s-tab-${next}`)?.focus(), 0)
        }
        const tabBtn = (k) => h('button', { key: k, type: 'button', role: 'tab', id: `n2s-tab-${k}`, className: `n2s-tab${k === 'admin' ? ' admin' : ''}`, tabIndex: nav.tab === k ? 0 : -1, 'aria-selected': nav.tab === k, onClick: () => setNav({ tab: k }) },
          k === 'admin' && AdminIcons.settings(), t(`tab.${k}`))
        const status = !ds ? 'off' : ds.lastTestOk === false ? 'err' : ''
        const showPicker = datasources.length > 0 && nav.tab !== 'admin'
        return h('div', { className: 'n2s-page' },
          h('div', { className: 'n2s-scroll' }, h('div', { className: `n2s-content${nav.tab === 'admin' ? ' wide' : ''}` },
            h('div', { className: 'n2s-top' },
              h('div', { className: 'n2s-heading' },
                h('h1', null, t('page.title')),
                h('span', { className: 'n2s-grow' }),
                showPicker && h('label', { className: 'n2s-dspill', title: ds ? (ds.type === 'sqlite' ? t('up.localDesc') : `${ds.user ? `${ds.user}@` : ''}${ds.host}:${ds.port}/${ds.database}`) : '' },
                  h('span', { className: `n2s-dot ${status}` }),
                  h('span', { className: 'name' }, ds?.name ?? '—'),
                  ds && h('span', { className: 'meta' }, typeLabel(t, ds.type)),
                  Icon.chev(10),
                  h('select', { 'aria-label': t('ds.select'), value: ds?.id ?? '', onChange: async (e) => { const id = e.target.value; setSelectedId(id); await call('setCurrent', { id }).catch(() => {}); refreshDatasources() } },
                    datasources.map(d => h('option', { key: d.id, value: d.id }, `${d.name} · ${typeLabel(t, d.type)}${d.type === 'sqlite' ? '' : ` · ${d.database}`}`))))),
              h('div', { className: 'n2s-tabs', role: 'tablist', 'aria-label': t('page.title'), onKeyDown: onTabKey }, PRIMARY_TABS.map(tabBtn), h('span', { className: 'n2s-grow' }), tabBtn('admin'))),
            h('div', { className: 'n2s-body', role: 'tabpanel', 'aria-labelledby': `n2s-tab-${nav.tab}` },
              error && h('div', { className: 'n2s-notice err', style: { marginBottom: 12 } }, error),
              !loaded ? h('div', { style: { display: 'grid', gap: 12 } }, h('div', { className: 'n2s-skel', style: { height: 120 } }), h('div', { className: 'n2s-skel', style: { height: 60 } })) :
                needsSource ? h(EmptySourceHint, { t, onGo: () => setNav({ tab: 'admin', section: 'sources' }) }) :
                nav.tab === 'ask' ? h(AskTab, { t, ds, datasources, onAsk: ask, presetReady: true, onNavigate: setNav }) :
                nav.tab === 'schema' ? h(SchemaTab, { t, ds, onAskTable: (tb) => ask(fmt(t, 'ask.tablePrompt', { name: tb.name, comment: tb.comment ? `（${tb.comment}）` : '' })) }) :
                nav.tab === 'knowledge' ? h(KnowledgeTab, { t, ds }) :
                nav.tab === 'history' ? h(HistoryTab, { t, datasources, onOpenSession: (id) => ctx.uiWorkspace.openSession(id) }) :
                nav.tab === 'dashboard' ? h(DashboardTab, { t, ds, datasources }) :
                h(AdminArea, { t, ctx, section: ADMIN_SECTIONS.includes(nav.section) ? nav.section : 'sources', sub: nav.sub, onNavigate: setNav, ds, datasources }))),
            h(FeedbackLayer, { t })))
      }
    }

    function EmptySourceHint({ t, onGo }) {
      return h('div', { className: 'n2s-empty' },
        h('h3', null, t('ds.empty')),
        h('div', null, t('ds.emptyHint')),
        h('button', { type: 'button', className: 'n2s-btn primary', onClick: onGo }, t('ds.goAdd')))
    }

    function typeLabel(t, type) {
      return type === 'sqlite' ? t('type.sqlite') : (TYPE_LABEL[type] ?? type)
    }

