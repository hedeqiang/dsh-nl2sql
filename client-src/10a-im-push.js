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

    // ------------------------------------------- channels: catalog & shapes
    // The host may be older (flat Lark-only channels, no channelCatalog /
    // botStatus RPCs) or newer (docs/channels.md). Everything below normalizes
    // both so the pages only deal with { platform, type, config, secretsSet,
    // capabilities, bot }.

    const KNOWN_PLATFORMS = ['lark', 'telegram', 'wecom', 'dingtalk']
    const PLATFORM_COLORS = { lark: '#3370ff', telegram: '#2aabee', wecom: '#0ba5a0', dingtalk: '#1a7cff' }
    const ID_PLACEHOLDER = {
      lark: { person: 'ou_xxx', chat: 'oc_xxx' }, telegram: { person: '123456789', chat: '-1001234567890' },
      wecom: { person: 'zhangsan', chat: 'wrxxxx' }, dingtalk: { person: 'manager1234', chat: 'cidxxxx==' },
    }
    const LEGACY_CAPS = {
      lark_webhook: { push: true, markdown: 'full', charts: 'native', tables: 'native', buttons: false, bot: false, listTargets: false, mentionAll: true },
      lark_app: { push: true, markdown: 'full', charts: 'native', chartImages: true, tables: 'native', buttons: true, bot: true, listTargets: true, mentionAll: true },
    }
    /** Localized value of a { zh, en } object (or a plain string). */
    const L = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[uiLang] ?? v.zh ?? v.en ?? '') : (v ?? ''))
    const isUnknownMethod = (e) => e?.code === 'nl2sql/unknown-method' || /unknown method/i.test(e?.message ?? '')
    const platformOfType = (type) => (/^lark_/.test(type ?? '') ? 'lark' : (String(type ?? '').split('_')[0] || 'lark'))
    const isSecretField = (f) => Boolean(f.secret || f.type === 'secret')
    /** Translation or '' when the key is missing (hosts return the key or a !!marker). */
    const tOpt = (t, k) => { const v = t(k); return !v || v === k || v.startsWith('!!') ? '' : v }

    /** Built-in catalog used when the host has no `channelCatalog` RPC: today's Lark form. */
    function legacyCatalog(t) {
      const tx = (k) => ({ zh: t(k), en: t(k) })
      return [{
        platform: 'lark', name: tx('ch.p.lark'), builtin: true,
        kinds: [
          {
            id: 'lark_webhook', label: tx('im.type.lark_webhook'), description: tx('ch.k.lark_webhook'),
            fields: [
              { key: 'webhookUrl', label: tx('im.webhookUrl'), type: 'secret', secret: true, required: true, full: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', pattern: '^https://open\\.(feishu\\.cn|larksuite\\.com)/open-apis/bot/v2/hook/[\\w-]+$' },
              { key: 'signSecret', label: tx('im.signSecret'), type: 'secret', secret: true, help: tx('ch.f.signSecret') },
            ],
            capabilities: LEGACY_CAPS.lark_webhook,
            setupSteps: { zh: [t('im.help.lark_webhook')], en: [t('im.help.lark_webhook')] },
          },
          {
            id: 'lark_app', label: tx('im.type.lark_app'), description: tx('ch.k.lark_app'),
            fields: [
              { key: 'domain', label: tx('im.domain'), type: 'select', options: ['feishu', 'lark'].map(v => ({ value: v, label: tx(`im.domain.${v}`) })) },
              { key: 'appId', label: tx('im.appId'), type: 'text', required: true, placeholder: 'cli_xxx' },
              { key: 'appSecret', label: tx('im.appSecret'), type: 'secret', secret: true, required: true },
              { key: 'receiveIdType', label: tx('im.receiveIdType'), type: 'select', options: ['chat_id', 'email', 'open_id', 'user_id', 'union_id'].map(v => ({ value: v, label: tx(`im.rid.${v}`) })) },
              { key: 'receiveId', label: tx('im.receiveId'), type: 'text', required: true, placeholder: 'oc_xxx', target: true, help: tx('ch.f.receiveId') },
            ],
            capabilities: LEGACY_CAPS.lark_app,
            setupSteps: { zh: ['im.help.lark_app', 'bot.step3', 'bot.step4', 'bot.step5', 'bot.step7', 'bot.step6'].map(t), en: ['im.help.lark_app', 'bot.step3', 'bot.step4', 'bot.step5', 'bot.step7', 'bot.step6'].map(t) },
          },
        ],
      }]
    }

    function normalizeChannel(c) {
      if (!c || typeof c !== 'object') return c
      const legacy = !c.config
      const config = c.config ?? Object.fromEntries(['domain', 'appId', 'receiveIdType', 'receiveId'].filter(k => c[k] !== undefined && c[k] !== null).map(k => [k, c[k]]))
      const secretsSet = c.secretsSet ?? (c.type === 'lark_webhook' ? { webhookUrl: Boolean(c.hasSecret), signSecret: Boolean(c.hasSign) } : c.type === 'lark_app' ? { appSecret: Boolean(c.hasSecret) } : {})
      return { ...c, platform: c.platform ?? platformOfType(c.type), config, secretsSet, capabilities: c.capabilities ?? LEGACY_CAPS[c.type] ?? { push: true, charts: 'none' }, legacy }
    }

    const channelStore = createStore({ list: null })
    async function refreshChannels() {
      try {
        const list = await call('listChannels')
        channelStore.set({ list: (Array.isArray(list) ? list : []).map(normalizeChannel) })
      } catch { channelStore.set({ list: [] }) }
    }
    function useChannels() {
      const get = () => channelStore.get().list
      const list = useSyncExternalStore(channelStore.subscribe, get, get)
      useEffect(() => { if (list === null) refreshChannels() }, [])
      return list ?? []
    }

    // remote: null = not loaded yet, true = host catalog, false = built-in Lark catalog.
    const catalogStore = createStore({ list: [], remote: null })
    async function loadCatalog() {
      try {
        const list = await call('channelCatalog')
        catalogStore.set(Array.isArray(list) && list.length ? { list, remote: true } : { list: [], remote: false })
      } catch { catalogStore.set({ list: [], remote: false }) }
    }
    function sortPlatforms(list) {
      const rank = (p) => { const i = KNOWN_PLATFORMS.indexOf(p); return i < 0 ? 99 : i }
      return [...list].sort((a, b) => rank(a.platform) - rank(b.platform))
    }
    function useCatalog(t) {
      const get = () => catalogStore.get()
      const st = useSyncExternalStore(catalogStore.subscribe, get, get)
      useEffect(() => { if (st.remote === null) loadCatalog() }, [])
      const catalog = useMemo(() => (st.remote ? sortPlatforms(st.list) : legacyCatalog(t)), [st, t, uiLang])
      return { catalog, remote: st.remote === true, ready: st.remote !== null }
    }
    function findKind(catalog, type) {
      for (const p of catalog) { const kind = (p.kinds ?? []).find(k => k.id === type); if (kind) return { platform: p, kind } }
      return null
    }
    function platformName(t, platform, catalog) {
      if (KNOWN_PLATFORMS.includes(platform)) return t(`ch.p.${platform}`)
      return L((catalog ?? []).find(p => p.platform === platform)?.name) || String(platform ?? '')
    }
    function kindLabel(t, type, catalog) {
      const k = findKind(catalog ?? [], type)?.kind
      if (k) return L(k.label)
      return type === 'lark_webhook' || type === 'lark_app' ? t(`im.type.${type}`) : String(type ?? '')
    }
    function channelOptionLabel(t, c, catalog) {
      return `${c.name} · ${platformName(t, c.platform, catalog)} · ${kindLabel(t, c.type, catalog)}`
    }
    /** Chart modes a channel can send: native card charts, PNG images, tables. */
    function chartModesFor(caps, type) {
      const cm = caps?.charts ?? 'native'
      const modes = cm === 'native' ? ['native'] : cm === 'image' ? ['image'] : []
      if (cm === 'native' && (caps?.chartImages || type === 'lark_app')) modes.push('image')
      modes.push('table')
      return modes
    }
    /** The form field that holds the delivery target (chat id …), used by the target picker. */
    function targetFieldOf(kind) {
      const fields = kind?.fields ?? []
      return fields.find(f => f.target) ?? fields.find(f => !isSecretField(f) && f.type !== 'select' && /chat|target|receive|conversation/i.test(f.key))
    }
    /** One-line, secret-free description of where a channel delivers. */
    function targetSummary(t, c, kind) {
      const cfg = c.config ?? {}
      if (cfg.receiveId) return `${cfg.receiveIdType ? `${cfg.receiveIdType}:` : ''}${cfg.receiveId}`
      const tf = targetFieldOf(kind)
      if (tf && cfg[tf.key]) return String(cfg[tf.key])
      for (const k of ['chatId', 'chat_id', 'conversationId', 'openConversationId', 'target', 'webhookHost', 'host']) if (cfg[k]) return String(cfg[k])
      if (Object.keys(c.secretsSet ?? {}).some(k => /webhook/i.test(k) && c.secretsSet[k])) return t('im.webhookHidden')
      const plain = (kind?.fields ?? []).find(f => !isSecretField(f) && f.type !== 'select' && cfg[f.key])
      return plain ? String(cfg[plain.key]) : ''
    }

    // ------------------------------------------------------------- bots
    // New hosts: botStatus / saveBot (one bot per bot-capable channel).
    // Old hosts: one Lark bot (larkBotStatus / saveLarkBot) bound to a channel.

    const botStore = createStore({ list: null, legacy: false, legacyConf: null, error: null })
    function legacyBotEntry(v) {
      return { channelId: v.channelId ?? null, platform: 'lark', enabled: Boolean(v.enabled), allowP2p: v.allowP2p !== false, sessionScope: v.sessionScope ?? 'chat', status: v.status ?? { state: 'idle' }, info: v.bot ?? null, conversations: v.conversations ?? [] }
    }
    async function refreshBots() {
      try {
        const list = await call('botStatus')
        if (!Array.isArray(list)) throw Object.assign(new Error('unknown method botStatus'), { code: 'nl2sql/unknown-method' })
        botStore.set({ list, legacy: false, error: null })
      } catch (e) {
        if (!isUnknownMethod(e)) { botStore.set({ list: botStore.get().list ?? [], error: e.message }); return }
        try {
          const v = await call('larkBotStatus')
          botStore.set({ list: v?.channelId ? [legacyBotEntry(v)] : [], legacy: true, legacyConf: v ?? null, error: null })
        } catch { botStore.set({ list: [], legacy: true, legacyConf: null }) }
      }
    }
    function useBots() {
      const get = () => botStore.get()
      const st = useSyncExternalStore(botStore.subscribe, get, get)
      useEffect(() => { if (st.list === null) refreshBots() }, [])
      return st
    }
    /** Bot settings + status of one channel, merged from listChannels and botStatus. */
    function botOf(c, bots) {
      const base = { enabled: false, allowP2p: true, sessionScope: 'chat', status: { state: 'idle' }, conversations: [] }
      const e = (bots?.list ?? []).find(b => b.channelId === c.id)
      if (bots?.legacy) {
        const conf = bots.legacyConf ?? {}
        return e ? { ...base, ...e } : { ...base, allowP2p: conf.allowP2p !== false, sessionScope: conf.sessionScope ?? 'chat' }
      }
      const merged = { ...base, ...(c.bot ?? {}), ...(e ?? {}) }
      return { ...merged, status: e?.status ?? c.bot?.status ?? { state: merged.enabled ? 'connecting' : 'idle' } }
    }
    /** 'off' | 'connecting' | 'connected' | 'error' | 'stopped' */
    function botStateOf(b) {
      if (!b?.enabled) return 'off'
      const s = b.status?.state ?? 'connecting'
      return s === 'idle' ? 'connecting' : s
    }
    const BOT_DOT = { connected: 'ok', error: 'err', connecting: 'conn', stopped: 'warn', off: '' }
    function BotDot({ t, bot, prefix }) {
      const s = botStateOf(bot)
      return h('span', { className: `n2s-statusdot ${BOT_DOT[s] ?? ''}`, title: bot?.status?.error ?? undefined }, prefix ? `${prefix} · ` : '', t(`ch.bot.state.${s}`))
    }
    async function saveBotFor(channelId, patch) {
      const st = botStore.get()
      if (st.legacy) {
        const conf = st.legacyConf ?? {}
        const owner = conf.channelId ?? null
        // The single legacy bot belongs to another channel: only an explicit enable moves it.
        if (conf.enabled && owner && owner !== channelId && patch.enabled !== true) return
        if (patch.enabled === false && owner !== channelId) return
        await call('saveLarkBot', { channelId, ...patch })
      } else {
        await call('saveBot', { channelId, ...patch })
      }
      await refreshBots()
    }

    /** Platform tile: brand-tinted letter mark (original, not a logo). */
    function PlatformMark({ t, platform, size = 36 }) {
      const color = PLATFORM_COLORS[platform] ?? '#64748b'
      const txt = KNOWN_PLATFORMS.includes(platform) ? t(`ch.p.${platform}.mark`) : String(platform ?? '?').slice(0, 2).toUpperCase()
      return h('span', {
        className: 'n2s-tile n2s-pmark', 'aria-hidden': true,
        style: { width: size, height: size, borderRadius: Math.round(size * 0.28), fontSize: Math.max(9, Math.round(size * (txt.length > 1 ? 0.3 : 0.4))), color, background: `color-mix(in srgb, ${color} 13%, transparent)` },
      }, txt)
    }

    /** Capability chips: charts / buttons / bot. */
    function CapabilityChips({ t, caps, type }) {
      if (!caps) return null
      const cm = caps.charts ?? 'native'
      const chart = cm === 'none' ? 'none' : chartModesFor(caps, type).includes('native') ? 'native' : 'image'
      return h('div', { className: 'n2s-caps' },
        h('span', { className: `n2s-cap${chart === 'none' ? ' muted' : ''}` }, Icon.chart(11), t(`ch.cap.${chart}`)),
        caps.buttons && h('span', { className: 'n2s-cap' }, t('ch.cap.buttons')),
        caps.bot && h('span', { className: 'n2s-cap bot' }, t('ch.cap.bot')))
    }

    /** Native channel <select> with the platform mark of the selected channel. */
    function ChannelPicker({ t, value, onChange, noneLabel, id, label }) {
      const channels = useChannels()
      const { catalog } = useCatalog(t)
      const cur = channels.find(c => c.id === value)
      return h('div', { className: 'n2s-chpick' },
        cur ? h(PlatformMark, { t, platform: cur.platform, size: 24 }) : h('span', { className: 'n2s-chpick-none', 'aria-hidden': true }, Icon.send(12)),
        h('select', { id, className: 'n2s-select', 'aria-label': id ? undefined : label, value: value ?? '', onChange: e => onChange(e.target.value) },
          noneLabel !== undefined && h('option', { value: '' }, noneLabel),
          channels.map(c => h('option', { key: c.id, value: c.id }, channelOptionLabel(t, c, catalog)))))
    }
