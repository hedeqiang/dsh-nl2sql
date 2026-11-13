    // ------------------------------------------------------------ group question permissions
    // Who may ask the bot in a group (a registered person always gets the stricter of their own
    // and the group's permissions), a blocked list, rate limits and restrictions. Used in the group member form (per group,
    // optionally "follow the default") and in Settings → Bots (the default for new groups).

    const CHAT_POLICY_FALLBACK = { askers: 'members', listed: [], blocked: [], perUserPerMinute: 0, perChatPerHour: 0, noAttachments: false, readOnly: false }

    /** A person picker: chips of registered persons; toggles ids in `value`. */
    function PersonChips({ t, persons, value, onChange, label, empty }) {
      if (!persons.length) return h('div', { className: 'n2s-faint n2s-small' }, empty)
      return h('div', { className: 'n2s-chips', role: 'group', 'aria-label': label },
        persons.map(p => h('button', { key: p.id, type: 'button', className: 'n2s-chip', 'aria-pressed': value.includes(p.id), onClick: () => onChange(value.includes(p.id) ? value.filter(x => x !== p.id) : [...value, p.id]) }, p.name)))
    }

    /**
     * policy: the editable object; onChange(next). `persons` (registered person members) enables
     * the name lists; without them (Settings default) the lists are hidden.
     */
    function ChatPolicyEditor({ t, policy, onChange, persons, idPrefix = 'cp' }) {
      const { merge: _m, ...given } = policy ?? {}
      const p = { ...CHAT_POLICY_FALLBACK, ...given }
      const set = (k, v) => onChange({ ...p, [k]: v })
      const radio = (key, values, label) => h('div', { className: 'n2s-radios', role: 'radiogroup', 'aria-label': label },
        values.map(v => h('label', { key: v, className: `n2s-radio${p[key] === v ? ' on' : ''}` },
          h('input', { type: 'radio', name: `${idPrefix}-${key}`, checked: p[key] === v, onChange: () => set(key, v) }),
          h('span', null, h('strong', null, t(`cp.${key}.${v}`)), h('span', { className: 'n2s-faint n2s-small' }, t(`cp.${key}.${v}.hint`))))))
      const num = (key, max, unit) => h('div', { className: 'n2s-row', style: { gap: 8 } },
        h('input', { id: `${idPrefix}-${key}`, className: 'n2s-input', type: 'number', min: 0, max, style: { maxWidth: 120 }, value: p[key] || '', placeholder: t('cp.unlimited'), onChange: e => set(key, Math.max(0, Math.floor(Number(e.target.value) || 0))) }),
        h('span', { className: 'n2s-muted n2s-small' }, unit))
      const sw = (key) => h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(p[key]), 'aria-label': t(`cp.${key}`), onChange: e => set(key, e.target.checked) }), h('span', null, p[key] ? t('fq.set.on') : t('fq.set.off')))
      return h('div', { className: 'n2s-cp' },
        // The default (Settings) has no member lists: 'listed' only makes sense per group.
        h(SettingRow, { label: t('cp.askers') }, radio('askers', persons ? ['all', 'members', 'listed'] : ['all', 'members'], t('cp.askers'))),
        persons && p.askers === 'listed' && h(SettingRow, { label: t('cp.listed'), hint: t('cp.listed.hint') }, h(PersonChips, { t, persons, value: p.listed, onChange: v => set('listed', v), label: t('cp.listed'), empty: t('cp.noPersons') })),
        persons && h(SettingRow, { label: t('cp.blocked'), hint: t('cp.blocked.hint') }, h(PersonChips, { t, persons, value: p.blocked, onChange: v => set('blocked', v), label: t('cp.blocked'), empty: t('cp.noPersons') })),
        h(SettingRow, { label: t('cp.perUser'), htmlFor: `${idPrefix}-perUserPerMinute`, hint: t('cp.rate.hint') }, num('perUserPerMinute', 120, t('cp.perMinute'))),
        h(SettingRow, { label: t('cp.perChat'), htmlFor: `${idPrefix}-perChatPerHour` }, num('perChatPerHour', 10000, t('cp.perHour'))),
        h(SettingRow, { label: t('cp.noAttachments'), hint: t('cp.noAttachments.hint') }, sw('noAttachments')),
        h(SettingRow, { label: t('cp.readOnly'), hint: t('cp.readOnly.hint') }, sw('readOnly')))
    }

    /** One-line summary of a group's policy for the member list. */
    function chatPolicySummary(t, u, def) {
      const legacy = !u.chatPolicy
      const inherit = Boolean(u.chatPolicy?.inherit)
      const p = legacy ? { ...CHAT_POLICY_FALLBACK, askers: 'all' } : inherit ? { ...CHAT_POLICY_FALLBACK, ...(def ?? {}) } : { ...CHAT_POLICY_FALLBACK, ...u.chatPolicy }
      const parts = [t(`cp.askers.${p.askers}`)]
      if (p.askers === 'listed') parts[0] = fmt(t, 'cp.sum.listed', { n: p.listed.length })
      if (p.blocked?.length) parts.push(fmt(t, 'cp.sum.blocked', { n: p.blocked.length }))
      if (p.perUserPerMinute) parts.push(fmt(t, 'cp.sum.perUser', { n: p.perUserPerMinute }))
      if (p.perChatPerHour) parts.push(fmt(t, 'cp.sum.perChat', { n: p.perChatPerHour }))
      if (p.noAttachments) parts.push(t('cp.noAttachments'))
      if (p.readOnly) parts.push(t('cp.readOnly'))
      return `${colon(t('cp.title'))}${joinClauses(parts)}${inherit ? paren(t('cp.followDefault')) : ''}`
    }
