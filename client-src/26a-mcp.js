    // ------------------------------------------------------------ MCP access (admin section)
    // Enable the local MCP server, manage bearer tokens (shown once) and their
    // scopes, and copy config snippets for Claude Desktop / Cursor / VS Code.

    const MCP_PKG = '@hedeqiang/dsh-nl2sql'

    /** Config snippets for a token (placeholder when the token value is no longer known). */
    function mcpSnippets(url, token) {
      const tok = token || '<YOUR_TOKEN>'
      return {
        claude: JSON.stringify({ mcpServers: { nl2sql: { command: 'npx', args: ['-y', '-p', MCP_PKG, 'nl2sql-mcp'], env: { NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: tok } } } }, null, 2),
        cursor: JSON.stringify({ mcpServers: { nl2sql: { url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2),
        vscode: JSON.stringify({ servers: { nl2sql: { type: 'http', url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2),
      }
    }

    function McpCopy({ t, text, label }) {
      const [done, setDone] = useState(false)
      return h('button', {
        type: 'button', className: 'n2s-btn small', 'aria-label': label ?? t('mcp.copy'),
        onClick: async () => {
          try { await navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch (e) { notifyError(e) }
        },
      }, done ? Icon.check(13) : Icon.copy(13), ' ', done ? t('mcp.copied') : (label ?? t('mcp.copy')))
    }

    function McpSnippets({ t, url, token }) {
      const [tab, setTab] = useState('claude')
      const snip = mcpSnippets(url, token)
      const where = { claude: 'mcp.where.claude', cursor: 'mcp.where.cursor', vscode: 'mcp.where.vscode' }
      return h('div', { className: 'n2s-mcp-snippets' },
        h('div', { className: 'n2s-seg', role: 'tablist' }, ['claude', 'cursor', 'vscode'].map(k => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': tab === k, 'aria-pressed': tab === k, onClick: () => setTab(k) }, t(`mcp.client.${k}`)))),
        h('div', { className: 'n2s-faint n2s-small', style: { margin: '6px 0' } }, t(where[tab])),
        h('div', { className: 'n2s-mcp-code' },
          h('pre', { className: 'n2s-code', 'data-snippet': tab }, snip[tab]),
          h('div', { className: 'n2s-mcp-codeact' }, h(McpCopy, { t, text: snip[tab] }))),
        !token && h('div', { className: 'n2s-faint n2s-small' }, t('mcp.placeholderHint')))
    }

    function McpScopeLabel({ t, scope }) {
      if (scope.type === 'member') return h('span', null, h('span', { className: 'n2s-badge' }, t('mcp.scope.member')), ' ', scope.memberName ?? scope.memberId, scope.missing ? h('span', { className: 'n2s-badge warn' }, t('mcp.memberMissing')) : scope.disabled ? h('span', { className: 'n2s-badge warn' }, t('mcp.memberDisabled')) : null)
      if (scope.type === 'role') return h('span', null, h('span', { className: 'n2s-badge' }, t(`mcp.role.${scope.role}`)), ' ', scope.datasourceNames ? joinList(scope.datasourceNames) : t('mcp.allDs'), scope.rowRules?.length ? h('span', { className: 'n2s-faint' }, paren(fmt(t, 'mcp.rowRulesN', { n: scope.rowRules.length }))) : null)
      return h('span', { className: 'n2s-badge ok' }, t('mcp.scope.owner'))
    }

    function McpTokenForm({ t, datasources, onCreated, onCancel }) {
      const users = useAsync(() => call('listUsers').catch(() => []), [])
      const [form, setForm] = useState({ name: '', type: 'owner', memberId: '', role: 'analyst', datasourceIds: [], rowColumn: '', rowValues: '' })
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
      const members = (users.value ?? []).filter(u => !u.disabled)
      const submit = async () => {
        setErr(null)
        const scope = form.type === 'member' ? { memberId: form.memberId }
          : form.type === 'role' ? { role: form.role, datasourceIds: form.datasourceIds, ...(form.rowColumn.trim() && form.rowValues.trim() ? { rowRules: [{ column: form.rowColumn.trim(), values: form.rowValues }] } : {}) }
            : { kind: 'owner' }
        if (!form.name.trim()) return setErr(t('mcp.err.name'))
        if (form.type === 'member' && !form.memberId) return setErr(t('mcp.err.member'))
        if (form.type === 'role' && !form.datasourceIds.length) return setErr(t('mcp.err.ds'))
        setBusy(true)
        try { onCreated(await call('createMcpToken', { name: form.name.trim(), scope })) } catch (e) { setErr(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card n2s-mcp-form' },
        h('div', { className: 'n2s-sechead-title', style: { marginBottom: 10 } }, t('mcp.newToken')),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.tokenName')),
          h('input', { className: 'n2s-input', value: form.name, maxLength: 60, placeholder: t('mcp.tokenNamePh'), onChange: e => set('name', e.target.value) })),
        h('div', { className: 'n2s-field', role: 'group', 'aria-label': t('mcp.scope') },
          h('span', { className: 'n2s-flabel' }, t('mcp.scope')),
          h('div', { className: 'n2s-seg', role: 'radiogroup' }, ['owner', 'member', 'role'].map(k => h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': form.type === k, 'aria-pressed': form.type === k, onClick: () => set('type', k) }, t(`mcp.scope.${k}`)))),
          h('span', { className: 'n2s-faint n2s-small' }, t(`mcp.scopeHint.${form.type}`))),
        form.type === 'member' && h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.member')),
          members.length
            ? h('select', { className: 'n2s-select', value: form.memberId, onChange: e => set('memberId', e.target.value) },
              h('option', { value: '' }, t('mcp.pickMember')),
              members.map(u => h('option', { key: u.id, value: u.id }, `${u.name} · ${t(`mcp.role.${u.role}`)}`)))
            : h('span', { className: 'n2s-faint n2s-small' }, t('mcp.noMembers'))),
        form.type === 'role' && h(React.Fragment, null,
          h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.role')),
            h('select', { className: 'n2s-select', value: form.role, onChange: e => set('role', e.target.value) }, ['analyst', 'viewer', 'admin'].map(r => h('option', { key: r, value: r }, t(`mcp.role.${r}`))))),
          h('div', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.datasources')),
            h('div', { className: 'n2s-chips' }, (datasources ?? []).map(d => h('button', { key: d.id, type: 'button', className: 'n2s-chip', 'aria-pressed': form.datasourceIds.includes(d.id), onClick: () => set('datasourceIds', form.datasourceIds.includes(d.id) ? form.datasourceIds.filter(x => x !== d.id) : [...form.datasourceIds, d.id]) }, d.name)))),
          h('div', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.rowRule')),
            h('div', { className: 'n2s-row' },
              h('input', { className: 'n2s-input n2s-mono', style: { maxWidth: 180 }, 'aria-label': t('mcp.rowColumn'), placeholder: t('mcp.rowColumn'), value: form.rowColumn, onChange: e => set('rowColumn', e.target.value) }),
              h('input', { className: 'n2s-input', 'aria-label': t('mcp.rowValues'), placeholder: t('mcp.rowValues'), value: form.rowValues, onChange: e => set('rowValues', e.target.value) })),
            h('span', { className: 'n2s-faint n2s-small' }, t('mcp.rowRuleHint')))),
        err && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, err),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: submit }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.create'))))
    }

    function McpSection({ t, datasources }) {
      const st = useAsync(() => call('mcpStatus'), [])
      const [port, setPort] = useState('')
      const [busy, setBusy] = useState(false)
      const [creating, setCreating] = useState(false)
      const [fresh, setFresh] = useState(null) // { name, token } shown once
      useEffect(() => { if (st.value) setPort(String(st.value.port)) }, [st.value?.port])
      const s = st.value
      const when = (ms) => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('mcp.never'))
      const save = async (patch) => {
        setBusy(true)
        try { await call('saveMcpSettings', patch); st.reload() } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const revoke = async (tok) => {
        if (!(await confirmDialog({ title: fmt(t, 'mcp.revokeConfirm', { name: tok.name }), message: t('mcp.revokeHint'), confirmLabel: t('mcp.revoke'), danger: true }))) return
        try { await call('revokeMcpToken', { id: tok.id }); if (fresh?.id === tok.id) setFresh(null); notify(t('mcp.revoked'), 'ok'); st.reload() } catch (e) { notifyError(e) }
      }
      if (!s) return st.error ? h('div', { className: 'n2s-notice err' }, st.error.message) : h('div', { className: 'n2s-skel', style: { height: 200 } })
      const portDirty = port !== String(s.port)
      return h('div', { className: 'n2s-mcp' },
        h(SectionHead, { title: t('mcp.title'), desc: t('mcp.desc') }),
        h('div', { className: 'n2s-card n2s-mcp-server' },
          h('div', { className: 'n2s-row', style: { flexWrap: 'wrap', gap: 14 } },
            h('label', { className: 'n2s-switch' },
              h('input', { type: 'checkbox', role: 'switch', checked: s.enabled, disabled: busy, onChange: e => save({ enabled: e.target.checked }) }),
              h('span', null, s.enabled ? t('mcp.enabled') : t('mcp.disabled'))),
            h('span', { className: `n2s-statusdot ${s.running ? 'ok' : s.error ? 'err' : ''}`, 'data-mcp-status': s.running ? 'running' : 'stopped' }, s.running ? t('mcp.running') : t('mcp.stopped')),
            h('span', { className: 'n2s-grow' }),
            h('label', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-flabel' }, t('mcp.port')),
              h('input', { className: 'n2s-input n2s-mono', style: { width: 96 }, inputMode: 'numeric', value: port, 'aria-label': t('mcp.port'), onChange: e => setPort(e.target.value.replace(/\D/g, '').slice(0, 5)) }),
              portDirty && h('button', { type: 'button', className: 'n2s-btn small', disabled: busy || !port, onClick: () => save({ port: Number(port) }) }, t('mcp.applyPort')))),
          s.error && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 10 } }, s.error),
          h('div', { className: 'n2s-mcp-endpoint' },
            h('span', { className: 'n2s-flabel' }, t('mcp.endpoint')),
            h('code', { className: 'n2s-mono', 'data-mcp-url': true }, s.url),
            h(McpCopy, { t, text: s.url })),
          h('div', { className: 'n2s-faint n2s-small' }, t('mcp.localOnly'))),
        fresh && h('div', { className: 'n2s-card n2s-mcp-fresh', role: 'status' },
          h('div', { className: 'n2s-sechead-title' }, fmt(t, 'mcp.freshTitle', { name: fresh.name })),
          h('div', { className: 'n2s-notice warn', style: { margin: '8px 0' } }, t('mcp.freshHint')),
          h('div', { className: 'n2s-mcp-endpoint' }, h('code', { className: 'n2s-mono', 'data-mcp-token': true }, fresh.token), h(McpCopy, { t, text: fresh.token })),
          h(McpSnippets, { t, url: s.url, token: fresh.token }),
          h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 8 } }, h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setFresh(null) }, t('mcp.done')))),
        h('div', { className: 'n2s-row', style: { margin: '18px 0 8px' } },
          h('div', { className: 'n2s-sechead-title n2s-grow' }, t('mcp.tokens')),
          !creating && h('button', { type: 'button', className: 'n2s-btn', onClick: () => setCreating(true) }, '+ ', t('mcp.newToken'))),
        creating && h(McpTokenForm, { t, datasources, onCancel: () => setCreating(false), onCreated: (tok) => { setCreating(false); setFresh(tok); st.reload() } }),
        s.tokens.length === 0 && !creating
          ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mcp.noTokens')), h('div', null, t('mcp.noTokensHint')))
          : s.tokens.length > 0 && h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-mcp-tokens' },
            h('thead', null, h('tr', null, [t('mcp.col.name'), t('mcp.col.scope'), t('mcp.col.created'), t('mcp.col.lastUsed'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, s.tokens.map(tok => h('tr', { key: tok.id, 'data-token-id': tok.id },
              h('td', null, h('div', null, tok.name), h('div', { className: 'n2s-faint n2s-small n2s-mono' }, `${tok.prefix}…`)),
              h('td', null, h(McpScopeLabel, { t, scope: tok.scope })),
              h('td', { className: 'n2s-small' }, when(tok.createdAt)),
              h('td', { className: 'n2s-small' }, when(tok.lastUsedAt)),
              h('td', { style: { textAlign: 'right' } }, h('button', { type: 'button', className: 'n2s-btn small danger', onClick: () => revoke(tok) }, t('mcp.revoke')))))))),
        h('div', { className: 'n2s-sechead-title', style: { margin: '18px 0 8px' } }, t('mcp.setup')),
        h('div', { className: 'n2s-card' }, h(McpSnippets, { t, url: s.url, token: null }),
          h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('mcp.docsHint'))))
    }

    extend.adminSections.push({ id: 'mcp', label: (t) => t('mcp.nav'), icon: () => Icon.code(15), Component: McpSection })
