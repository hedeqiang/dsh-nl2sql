    // ------------------------------------------------------------ apply

    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => {
          const el = document.createElement('style')
          el.dataset.plugin = PKG
          el.textContent = CSS
          document.head.appendChild(el)
          return () => el.remove()
        }, 'nl2sql: styles')
        ctx.effect(() => ctx.locale.register(NS, { zh, en, 'zh-CN': zh }), 'nl2sql: locale')
        const t = ctx.locale.bind(NS)
        // One feedback layer (toasts + confirm / prompt dialogs) for the page and every
        // tool view or reply action in conversations, mounted once outside the page.
        ctx.effect(() => mountFeedbackLayer(ctx), 'nl2sql: feedback layer')
        const Page = makePage(ctx)
        const PanelIcon = ({ size }) => Icon.db(size ?? 16)
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, PanelIcon))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'nl2sql-datasource', order: 50, locale: NS }, makeComposerControl(ctx)))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_query', locale: NS }, makeToolView(ctx, 'query')))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_chart', locale: NS }, makeToolView(ctx, 'chart')))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_overview', locale: NS }, makeOverviewToolView(ctx)))
        for (const v of extend.toolViews) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: v.key, locale: NS }, v.make(ctx)))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'nl2sql-send', order: 20, locale: NS }, makeReplyAction(ctx)))
      },
    }
  },
})
