    function FeedbackForm({ t, onCancel, onSubmit }) {
      const [comment, setComment] = useState('')
      const [busy, runBusy] = useBusy()
      const reasons = ['fb.reason.wrongTable', 'fb.reason.wrongMetric', 'fb.reason.wrongFilter', 'fb.reason.wrongTime', 'fb.reason.chart']
      return h('div', { className: 'n2s-card', style: { padding: 10 } },
        h('div', { className: 'n2s-small', style: { marginBottom: 6 } }, t('fb.whatWrong')),
        h('div', { className: 'n2s-chips', style: { marginBottom: 6 } }, reasons.map(r => h('button', { key: r, type: 'button', className: 'n2s-chip', onClick: () => setComment(c => (c ? joinClauses([c, t(r)]) : t(r))) }, t(r)))),
        h('textarea', { className: 'n2s-textarea', style: { minHeight: 56 }, value: comment, onChange: e => setComment(e.target.value), placeholder: t('fb.commentPh') }),
        h('div', { className: 'n2s-row', style: { marginTop: 8, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy, onClick: () => runBusy(() => onSubmit(comment.trim())) }, busy ? h('span', { className: 'n2s-spin' }) : null, t('fb.submit'))))
    }

    function FeedbackSection({ t, ds }) {
      const [status, setStatus] = useState('open')
      const list = useAsync(() => call('listFeedback', { datasourceId: ds?.id, ...(status ? { status } : {}) }), [ds?.id, status], [ds?.id])
      const stats = useAsync(() => call('feedbackStats', { datasourceId: ds?.id }), [ds?.id, list.value], [ds?.id])
      const [fixing, setFixing] = useState(null)
      const [error, setError] = useState(null)
      const [busy, runBusy] = useBusy()
      const resolve = (payload) => runBusy(async () => {
        setError(null)
        try { await call('resolveFeedback', payload); setFixing(null); list.reload() } catch (e) { setError(e.message) }
      })
      const remove = async (f) => {
        if (!await confirmDialog({ title: t('fb.deleteConfirm'), message: f.question || f.title || '', confirmLabel: t('ds.delete'), danger: true })) return
        try { await call('deleteFeedback', { id: f.id }) } catch (e) { notifyError(e) }
        list.reload()
      }
      const st = stats.value
      return h('div', null,
        st && h('div', { className: 'n2s-kpis', style: { marginBottom: 12 } },
          [['fb.stat.up', st.up], ['fb.stat.down', st.down], ['fb.stat.open', st.open], ['fb.stat.rate', st.rate === null ? '—' : `${Math.round(st.rate * 100)}%`]].map(([k, v]) => h('div', { key: k, className: 'n2s-kpi' }, h('div', { className: 'v', style: { fontSize: 20 } }, v), h('div', { className: 'k' }, t(k))))),
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('div', { className: 'n2s-seg' }, [['open', 'fb.filter.open'], ['resolved', 'fb.filter.resolved'], ['', 'fb.filter.all']].map(([v, k]) => h('button', { key: k, type: 'button', 'aria-pressed': status === v, onClick: () => setStatus(v) }, t(k)))),
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('fb.hint'))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, error),
        !list.loading && (list.value ?? []).length === 0 && h('div', { className: 'n2s-empty' }, h('div', { className: 'n2s-muted' }, t('fb.empty'))),
        h('div', { className: 'n2s-cards' }, (list.value ?? []).map(f => h('div', { key: f.id, className: 'n2s-card' },
          h('div', { className: 'n2s-row', style: { alignItems: 'flex-start' } },
            h('span', { style: { fontSize: 16 } }, f.rating === 'up' ? '👍' : '👎'),
            h('div', { className: 'n2s-grow' },
              h('div', { className: 'n2s-row' },
                h('span', { style: { fontWeight: 500 } }, f.question || f.title || t('fb.noQuestion')),
                h('span', { className: `n2s-badge ${f.status === 'open' ? 'warn' : 'ok'}` }, t(`fb.status.${f.status}`)),
                f.savedAsExample && h('span', { className: 'n2s-badge brand' }, t('kb.exampleSaved')),
                h('span', { className: 'n2s-muted n2s-small' }, new Date(f.at).toLocaleString())),
              f.comment && h('div', { className: 'n2s-small', style: { marginTop: 4 } }, f.comment),
              h('pre', { className: 'n2s-code', style: { marginTop: 6 } }, f.correctedSql || f.sql),
              f.resolution && h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 4 } }, `${colon(t('fb.resolution'))}${f.resolution}`)),
            h('div', { style: { display: 'grid', gap: 4 } },
              f.sessionId && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => fbCtx.openSession?.(f.sessionId) }, t('hist.openSession')),
              f.status === 'open' && h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => setFixing({ id: f.id, sql: f.sql, question: f.question || f.title, resolution: '' }) }, t('fb.fix')),
              f.status === 'open' && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'ignored' }) }, t('fb.ignore')),
              f.rating === 'up' && !f.savedAsExample && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'resolved', saveExample: true }) }, t('kb.saveExample')),
              h('button', { type: 'button', className: 'n2s-btn small ghost danger', onClick: () => remove(f) }, t('ds.delete')))),
          fixing?.id === f.id && h('div', { className: 'n2s-ask', style: { marginTop: 10 } },
            h('label', { className: 'n2s-field' }, h('span', null, t('kb.question')), h('input', { className: 'n2s-input', value: fixing.question, onChange: e => setFixing(x => ({ ...x, question: e.target.value })) })),
            h('label', { className: 'n2s-field' }, h('span', null, t('fb.correctedSql')), h('textarea', { className: 'n2s-textarea n2s-mono', style: { minHeight: 120 }, spellCheck: false, value: fixing.sql, onChange: e => setFixing(x => ({ ...x, sql: e.target.value })) })),
            h('label', { className: 'n2s-field' }, h('span', null, t('fb.resolution')), h('input', { className: 'n2s-input', value: fixing.resolution, placeholder: t('fb.resolutionPh'), onChange: e => setFixing(x => ({ ...x, resolution: e.target.value })) })),
            h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setFixing(null) }, t('ds.cancel')),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'resolved', resolution: fixing.resolution, correctedSql: fixing.sql !== f.sql ? fixing.sql : undefined }) }, t('fb.markResolved')),
              h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => resolve({ id: f.id, status: 'resolved', resolution: fixing.resolution, saveExample: true, correctedSql: fixing.sql, question: fixing.question }) }, t('fb.saveFix'))))))))
    }

    // Page-level callbacks the feedback list uses (set by the page).
    const fbCtx = {}
