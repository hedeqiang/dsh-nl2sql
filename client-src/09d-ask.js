    /**
     * First-run checklist: connect → analyze → ask, plus an optional push step.
     * Hidden once every required step is done or the user dismisses it.
     */
    function Onboarding({ t, ds, onNavigate, onAsk, examples }) {
      const st = useAsync(() => call('onboardingStatus').catch(() => null), [ds?.id, ds?.schemaAnalyzedAt], [])
      const [busy, setBusy] = useState(false)
      const v = st.value
      if (!v || v.dismissed) return null
      const steps = [
        { key: 'connect', done: v.hasDatasource, action: () => onNavigate({ tab: 'admin', section: 'sources' }) },
        { key: 'analyze', done: v.analyzed, action: async () => { if (!ds) return; setBusy(true); try { await call('analyzeSchema', { id: ds.id, refresh: true }); await refreshDatasources(); st.reload(); notify(t('ob.analyzed'), 'ok') } catch (e) { notifyError(e) } setBusy(false) } },
        { key: 'ask', done: v.askedQuestion, action: () => examples[0] && onAsk(examples[0]) },
      ]
      const required = steps.every(x => x.done)
      if (required && v.hasChannel) return null
      const current = steps.find(x => !x.done)
      const dismiss = async () => { try { await call('dismissOnboarding', { dismissed: true }); st.reload() } catch (e) { notifyError(e) } }
      return h('section', { className: 'n2s-onboard', 'aria-label': t('ob.title') },
        h('div', { className: 'n2s-row', style: { marginBottom: 12 } },
          h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-onboard-title' }, required ? t('ob.doneTitle') : t('ob.title')), h('div', { className: 'n2s-muted n2s-small' }, required ? t('ob.doneSub') : t('ob.sub'))),
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: dismiss }, t('ob.dismiss'))),
        !required && h('ol', { className: 'n2s-steps' }, steps.map((x, i) => h('li', { key: x.key, className: `n2s-step${x.done ? ' done' : ''}${current === x ? ' current' : ''}` },
          h('span', { className: 'num', 'aria-hidden': true }, x.done ? Icon.check(13) : i + 1),
          h('div', { className: 'n2s-grow' },
            h('div', { className: 'title' }, t(`ob.${x.key}`), x.done && h('span', { className: 'n2s-sr' }, ` (${t('ob.stepDone')})`)),
            h('div', { className: 'desc' }, t(`ob.${x.key}.desc`))),
          current === x && h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy || (x.key !== 'connect' && !ds), onClick: x.action }, busy && x.key === 'analyze' ? h('span', { className: 'n2s-spin' }) : null, t(`ob.${x.key}.cta`))))),
        !v.hasChannel && h('div', { className: 'n2s-onboard-extra' },
          h(PlatformMark, { t, platform: 'lark' }),
          h('div', { className: 'n2s-grow' }, h('div', { style: { fontWeight: 500, fontSize: 13.5 } }, t('ob.push')), h('div', { className: 'n2s-muted n2s-small' }, t('ob.push.desc'))),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => onNavigate({ tab: 'admin', section: 'push' }) }, t('ob.push.cta'))))
    }

    function AskTab({ t, ds, datasources, onAsk, presetReady, onNavigate }) {
      const [question, setQuestion] = useState('')
      const [sql, setSql] = useState('')
      const [running, setRunning] = useState(false)
      const [result, setResult] = useState(null)
      const [plan, setPlan] = useState(null)
      const [error, setError] = useState(null)
      const [exOffset, setExOffset] = useState(0)
      const [recentLimit, setRecentLimit] = useState(8)
      const [hiddenRecent, setHiddenRecent] = useState(() => new Set())
      // Data source switched: reset paging and per-source results during render, so the
      // first request for the new source already uses offset 0 (no extra fetch).
      const [stateFor, setStateFor] = useState(ds?.id)
      if (stateFor !== ds?.id) {
        setStateFor(ds?.id)
        setExOffset(0); setRecentLimit(8); setHiddenRecent(new Set())
        setResult(null); setPlan(null); setError(null)
      }
      const pageOffset = stateFor === ds?.id ? exOffset : 0
      const pageRecent = stateFor === ds?.id ? recentLimit : 8
      // Scoped by data source + language: within one source the previous page stays on
      // screen while the next loads (no flicker on 换一批); another source's never does.
      const sugg = useAsync(() => (ds ? call('askSuggestions', { datasourceId: ds.id, locale: uiLang, offset: pageOffset, pageSize: 6, recentLimit: pageRecent }).catch(() => null) : null), [ds?.id, ds?.schemaAnalyzedAt, uiLang, pageOffset, pageRecent], [ds?.id, uiLang])
      useEffect(() => { if (sugg.value && !sugg.stale) setHiddenRecent(new Set()) }, [sugg.value])
      const data = sugg.value
      const examples = data?.examples?.length ? data.examples : [t('ask.ex.tables'), t('ask.ex.biggest')]
      const canShuffle = (data?.total ?? 0) > (data?.pageSize ?? 6)
      const recent = (data?.recent ?? []).filter(r => !hiddenRecent.has(r.question))
      const removeRecent = async (r) => {
        if (!await confirmDialog({ title: t('ask.deleteRecent'), message: fmt(t, 'ask.deleteRecentMsg', { q: r.question }), confirmLabel: t('ds.delete'), danger: true })) return
        setHiddenRecent(x => new Set(x).add(r.question))
        try { const res = await call('deleteHistory', { title: r.question, datasourceId: ds.id }); notify(fmt(t, 'ask.deletedN', { n: res.deleted }), 'ok') } catch (e) { notifyError(e); setHiddenRecent(x => { const n = new Set(x); n.delete(r.question); return n }) }
      }
      const currentDs = useRef(ds?.id)
      currentDs.current = ds?.id
      const run = async (confirmScan = false) => {
        const forId = ds.id
        setRunning(true); setError(null)
        try {
          const r = await call('runQuery', { sql, datasourceId: forId, title: '', confirmScan })
          if (currentDs.current === forId) setResult(r)
        } catch (e) {
          if (e.code === 'nl2sql/scan-guard' && currentDs.current === forId && await confirmDialog({ title: t('sql.confirmScan'), message: e.message })) { setRunning(false); return run(true) }
          if (currentDs.current === forId) setError(e.message)
        }
        setRunning(false)
      }
      const explain = async () => {
        const forId = ds.id
        setRunning(true); setError(null)
        try { const p = await call('explain', { sql, datasourceId: forId }); if (currentDs.current === forId) setPlan(p) } catch (e) { if (currentDs.current === forId) setError(e.message) }
        setRunning(false)
      }
      const submit = () => { if (question.trim()) { onAsk(question.trim()); setQuestion('') } }
      const [uploading, setUploading] = useState(false)
      const [sqlOpen, setSqlOpen] = useState(false)
      const tableCount = ds?.tableCount ?? data?.tableCount
      return h('div', null,
        h(Onboarding, { t, ds, onNavigate, onAsk, examples }),
        h('div', { className: 'n2s-hero' },
          h('h2', null, t('ask.heroTitle')),
          h('p', null, ds ? (ds.schemaAnalyzedAt ? (tableCount ? fmt(t, 'ask.heroSub', { name: ds.name, tables: tableCount }) : fmt(t, 'ask.heroSubShort', { name: ds.name })) : fmt(t, 'ask.heroSubNoSchema', { name: ds.name })) : t('ask.hint'))),
        h('div', { className: 'n2s-askbox' },
          h('textarea', {
            'aria-label': t('ask.placeholder'), placeholder: t('ask.placeholder'), value: question, rows: 3, disabled: !ds,
            onChange: e => setQuestion(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } },
          }),
          h('div', { className: 'n2s-askbar' },
            h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setUploading(true), title: t('up.askLink') }, Icon.up(13), h('span', { className: 'n2s-hide-narrow' }, t('up.short'))),
            h('span', { className: 'n2s-faint n2s-small n2s-grow n2s-hide-narrow', style: { textAlign: 'right' } }, h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.enterHint'), '  ', h('kbd', { className: 'n2s-kbd' }, '⇧ ↵'), ' ', t('ask.newline')),
            h('span', { className: 'n2s-grow n2s-show-narrow' }),
            h('button', { type: 'button', className: 'n2s-btn primary', disabled: !question.trim() || !presetReady || !ds, onClick: submit }, t('ask.start'), Icon.arrow(14)))),
        uploading && h(UploadDialog, { t, datasources, onClose: () => setUploading(false), onDone: async (res) => { await call('setCurrent', { id: res.datasourceId }).catch(() => {}); await refreshDatasources(); notify(t('up.askHint'), 'ok', 5000) } }),
        h('div', { className: 'n2s-sectlabel' }, t('ask.try'), h('span', { className: 'n2s-grow' }),
          canShuffle && h('button', { type: 'button', className: 'n2s-link n2s-small n2s-shuffle', disabled: sugg.loading, 'aria-label': t('ask.shuffle'), onClick: () => setExOffset(data?.nextOffset ?? 0) },
            h('span', { className: sugg.loading ? 'n2s-spinning' : undefined, 'aria-hidden': true }, Icon.refresh(12)), t('ask.shuffle'))),
        !data && sugg.loading ? h('div', { className: 'n2s-examples' }, [0, 1, 2, 3].map(i => h('div', { key: i, className: 'n2s-skel', style: { height: 44 } }))) :
          h('div', { className: 'n2s-examples' }, examples.map(q => h('button', { key: q, type: 'button', className: 'n2s-example', disabled: !ds, onClick: () => onAsk(q) }, h('span', { className: 'n2s-ico' }, Icon.spark(14)), h('span', null, q)))),
        recent.length > 0 && h(React.Fragment, null,
          h('div', { className: 'n2s-sectlabel' }, t('ask.recent'), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-link n2s-small', onClick: () => onNavigate({ tab: 'history' }) }, t('ask.allHistory'))),
          h('div', { className: 'n2s-recent' }, recent.map((r, i) => h('div', { key: `${r.sessionId ?? ''}-${i}`, className: 'n2s-recent-row' },
            h('span', { className: `n2s-dot ${r.status === 'error' ? 'err' : r.status === 'blocked' ? 'warn' : ''}`, 'aria-hidden': true }),
            h('span', { className: 'n2s-grow n2s-ellipsis', title: r.question }, r.question),
            h('span', { className: 'n2s-faint n2s-small n2s-hide-narrow' }, relTime(t, r.at)),
            r.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => fbCtx.openSession?.(r.sessionId) }, t('ask.openSession')),
            h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: !ds, onClick: () => onAsk(r.question) }, t('ask.askAgain')),
            h('button', { type: 'button', className: 'n2s-iconbtn n2s-recent-del', title: t('ask.deleteRecent'), 'aria-label': `${t('ask.deleteRecent')}: ${r.question}`, onClick: () => removeRecent(r) }, Icon.trash(13))))),
          data?.hasMoreRecent && h('button', { type: 'button', className: 'n2s-morebtn', disabled: sugg.loading, onClick: () => setRecentLimit(n => Math.min(50, n + 10)) }, sugg.loading ? h('span', { className: 'n2s-spin' }) : null, t('ask.moreRecent'))),
        h('div', { className: 'n2s-collapse' },
          h('button', { type: 'button', 'aria-expanded': sqlOpen, onClick: () => setSqlOpen(v => !v) }, Icon.code(14), t('ask.sql'), Icon.chev(11)),
          sqlOpen && h('div', null,
            h('div', { className: 'n2s-sqlbox' },
              h('textarea', { 'aria-label': t('ask.sql'), value: sql, onChange: e => setSql(e.target.value), placeholder: 'SELECT …', spellCheck: false, onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sql.trim()) run() } }),
              h('div', { className: 'n2s-sqlbar' },
                h('span', { className: 'n2s-faint n2s-small n2s-grow' }, h('kbd', { className: 'n2s-kbd' }, '⌘'), ' ', h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.run'), ' · ', t('ask.readonly')),
                h('button', { type: 'button', className: 'n2s-btn small', disabled: !sql.trim() || running || !ds, onClick: explain }, t('sql.explain')),
                h('button', { type: 'button', className: 'n2s-btn small primary', disabled: !sql.trim() || running || !ds, onClick: () => run(false) }, running ? h('span', { className: 'n2s-spin' }) : null, t('ask.run')))),
            error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
            plan && h('div', { className: 'n2s-card', style: { marginTop: 12 } },
              h('div', { className: 'n2s-row', style: { marginBottom: 10 } }, h('span', { className: 'n2s-h2', style: { margin: 0 } }, t('sql.plan')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.close'), onClick: () => setPlan(null) }, Icon.close())),
              h(PlanTable, { plan: plan.plan, t })),
            result && h('div', { className: 'n2s-card', style: { marginTop: 12 } }, h(ResultView, { result, t, hideSql: true })))))
    }

    /** "3 分钟前" style relative time in the UI language; future or older than a week → the date. */
    function relTime(t, at) {
      if (!at) return ''
      const d = (Date.now() - at) / 1000
      if (d < -60) return new Date(at).toLocaleDateString(uiLocale())
      if (d < 60) return t('time.justNow')
      if (d < 3600) return fmt(t, 'time.minAgo', { n: Math.floor(d / 60) })
      if (d < 86400) return fmt(t, 'time.hourAgo', { n: Math.floor(d / 3600) })
      if (d < 86400 * 7) return fmt(t, 'time.dayAgo', { n: Math.floor(d / 86400) })
      return new Date(at).toLocaleDateString(uiLocale())
    }

    function PlanTable({ plan }) {
      if (!plan?.length) return null
      const cols = Object.keys(plan[0])
      return h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
        h('thead', null, h('tr', null, cols.map(c => h('th', { key: c }, c)))),
        h('tbody', null, plan.map((r, i) => h('tr', { key: i }, cols.map(c => {
          const v = r[c]
          const warn = c === 'type' && String(v).toUpperCase() === 'ALL'
          return h('td', { key: c, className: v === null ? 'null' : undefined, style: warn ? { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 } : undefined }, v === null ? 'NULL' : String(v))
        }))))))
    }
