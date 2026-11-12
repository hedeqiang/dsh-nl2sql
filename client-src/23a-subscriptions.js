    // ------------------------------------------------------------ chat subscriptions (admin section)

    /** Subscriptions and alerts created from IM chats, grouped by chat, with pause / resume / delete. */
    function ChatSubscriptionsSection({ t }) {
      const list = useAsync(() => call('listChatSubscriptions'), [])
      const [notice, setNotice] = useState(null)
      const groups = list.value ?? []
      const when = (ms) => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
      const act = async (item, action) => {
        setNotice(null)
        if (action === 'delete' && !(await confirmDialog({ title: fmt(t, 'sub.deleteConfirm', { name: item.title }), danger: true }))) return
        try { await call('setChatSubscription', { id: item.id, action }); setNotice({ ok: true, text: t(`sub.done.${action}`) }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        list.reload()
      }
      const statusDot = (s) => h('span', { className: `n2s-statusdot ${s === 'active' ? 'ok' : s === 'suspended' ? 'err' : ''}` }, t(`sub.status.${s}`))
      return h('div', { className: 'n2s-sub' },
        h(SectionHead, { title: t('sub.title'), desc: t('sub.desc') },
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => list.reload() }, Icon.refresh(14), ' ', t('sub.refresh'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, role: 'status', style: { marginBottom: 10 } }, notice.text),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !list.error && groups.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('sub.empty')), h('div', null, t('sub.emptyHint'))),
        groups.map(g => h('div', { key: g.key, className: 'n2s-card n2s-sub-group' },
          h('div', { className: 'n2s-sub-head' },
            h('span', { className: 'n2s-sub-chat' }, g.chatName || g.chatId),
            h('span', { className: 'n2s-badge' }, Icon.send(11), ' ', g.channelName ?? g.channelId),
            h('span', { className: 'n2s-faint n2s-small' }, g.platform)),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('sub.col.item'), t('sub.col.creator'), t('sub.col.schedule'), t('sub.col.last'), t('sub.col.status'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, g.items.map(it => h('tr', { key: it.id },
              h('td', null,
                h('span', { className: 'n2s-badge n2s-sub-kind' }, t(`sub.kind.${it.kind}`)), ' ', it.title,
                h('div', { className: 'n2s-faint n2s-small' }, joinList([it.datasourceName, it.conditionText, it.metric]))),
              h('td', null, it.createdBy?.name ?? '—'),
              h('td', null, it.schedule, it.nextAt ? h('div', { className: 'n2s-faint n2s-small' }, `${colon(t('sub.next'))}${when(it.nextAt)}`) : null),
              h('td', null, when(it.lastDeliveredAt)),
              h('td', null, statusDot(it.status), it.lastError && h('div', { className: 'n2s-small n2s-sub-err' }, it.lastError)),
              h('td', null, h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
                it.status === 'active'
                  ? h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'pause') }, t('sub.pause'))
                  : h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'resume') }, t('sub.resume')),
                h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('sub.delete'), title: t('sub.delete'), onClick: () => act(it, 'delete') }, Icon.trash(13))))))))))))
    }

    extend.adminSections.push({ id: 'subscriptions', label: (t) => t('sub.nav'), icon: () => svg(15, [h('path', { key: 1, d: 'M4 6.5a4 4 0 0 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5M6.5 13.5a1.6 1.6 0 0 0 3 0' })]), Component: ChatSubscriptionsSection })
