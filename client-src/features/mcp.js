    // ------------------------------------------------------------ MCP access (admin section)
    // Enable the local MCP server, manage bearer tokens (shown once; expiry, tool allowlist,
    // rate limit, rotation), test the connection, read the per-token call log, and copy setup
    // snippets for ten MCP clients (formats verified against each client's docs, see docs/mcp.md).

    const MCP_PKG = '@hedeqiang/dsh-nl2sql'
    const MCP_CLIENTS = ['claude', 'claudeCode', 'cursor', 'vscode', 'cline', 'windsurf', 'codex', 'gemini', 'zed', 'continue']

    /** Config snippets for a token (placeholder when the token value is no longer known). */
    function mcpSnippets(url, token) {
      const tok = token || '<YOUR_TOKEN>'
      const auth = { Authorization: `Bearer ${tok}` }
      const json = (o) => JSON.stringify(o, null, 2)
      const stdio = { command: 'npx', args: ['-y', '-p', MCP_PKG, 'nl2sql-mcp'], env: { NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: tok } }
      return {
        // https://modelcontextprotocol.io/docs/develop/connect-local-servers
        claude: json({ mcpServers: { nl2sql: stdio } }),
        // https://code.claude.com/docs/en/mcp
        claudeCode: `claude mcp add --transport http nl2sql ${url} \\\n  --header "Authorization: Bearer ${tok}"\n\n# stdio variant (bridge)\nclaude mcp add --transport stdio --env NL2SQL_MCP_URL=${url} --env NL2SQL_MCP_TOKEN=${tok} nl2sql -- npx -y -p ${MCP_PKG} nl2sql-mcp`,
        // https://cursor.com/docs/mcp
        cursor: json({ mcpServers: { nl2sql: { url, headers: auth } } }),
        // https://code.visualstudio.com/docs/agents/reference/mcp-configuration
        vscode: json({ servers: { nl2sql: { type: 'http', url, headers: auth } } }),
        // https://docs.cline.bot/mcp/configuring-mcp-servers
        cline: json({ mcpServers: { nl2sql: { type: 'streamableHttp', url, headers: auth, disabled: false } } }),
        // https://docs.devin.ai/windsurf/plugins/cascade/mcp
        windsurf: json({ mcpServers: { nl2sql: { serverUrl: url, headers: auth } } }),
        // https://developers.openai.com/codex/mcp
        codex: `[mcp_servers.nl2sql]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${tok}" }`,
        // https://geminicli.com/docs/tools/mcp-server/
        gemini: json({ mcpServers: { nl2sql: { httpUrl: url, headers: auth } } }),
        // https://zed.dev/docs/ai/mcp
        zed: json({ context_servers: { nl2sql: { url, headers: auth } } }),
        // https://docs.continue.dev/customize/deep-dives/mcp
        continue: `name: nl2sql\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: nl2sql\n    type: streamable-http\n    url: ${url}\n    requestOptions:\n      headers:\n        Authorization: Bearer ${tok}`,
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
      return h('div', { className: 'n2s-mcp-snippets' },
        h('div', { className: 'n2s-seg n2s-mcp-tabs', role: 'tablist', 'aria-label': t('mcp.setup') }, MCP_CLIENTS.map(k => h('button', { key: k, type: 'button', role: 'tab', 'data-client': k, 'aria-selected': tab === k, 'aria-pressed': tab === k, onClick: () => setTab(k) }, t(`mcp.client.${k}`)))),
        h('div', { className: 'n2s-faint n2s-small', style: { margin: '6px 0' } }, t(`mcp.where.${tab}`)),
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

    const mcpDateInput = (ms) => {
      if (!ms) return ''
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }

    /** Expiry, tool allowlist and rate limit fields. value: { expires: 'YYYY-MM-DD'|'', allTools, tools: [], rateLimit: '' }. */
    function McpLimitsFields({ t, value, onChange, toolNames }) {
      const set = (k, v) => onChange({ ...value, [k]: v })
      return h('div', { className: 'n2s-mcp-limits' },
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.expiry')),
          h('div', { className: 'n2s-row' },
            h('input', { type: 'date', className: 'n2s-input', style: { maxWidth: 180 }, 'aria-label': t('mcp.expiry'), value: value.expires, onChange: e => set('expires', e.target.value) }),
            value.expires && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => set('expires', '') }, t('mcp.noExpiry'))),
          h('span', { className: 'n2s-faint n2s-small' }, t('mcp.expiryHint'))),
        h('div', { className: 'n2s-field', role: 'group', 'aria-label': t('mcp.toolsAllow') },
          h('span', { className: 'n2s-flabel' }, t('mcp.toolsAllow')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: value.allTools, onChange: e => set('allTools', e.target.checked) }), ' ', t('mcp.allTools')),
          !value.allTools && h('div', { className: 'n2s-mcp-toolgrid' }, (toolNames ?? []).map(n => h('label', { key: n, className: 'n2s-check n2s-mono' },
            h('input', { type: 'checkbox', 'data-tool': n, checked: value.tools.includes(n), onChange: e => set('tools', e.target.checked ? [...value.tools, n] : value.tools.filter(x => x !== n)) }), ' ', n)))),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.rateLimit')),
          h('div', { className: 'n2s-row' },
            h('input', { className: 'n2s-input n2s-mono', style: { width: 110 }, inputMode: 'numeric', 'aria-label': t('mcp.rateLimit'), placeholder: t('mcp.unlimited'), value: value.rateLimit, onChange: e => set('rateLimit', e.target.value.replace(/\D/g, '').slice(0, 5)) }),
            h('span', { className: 'n2s-faint n2s-small' }, t('mcp.perMinute')))))
    }

    /** Limits form state → RPC payload fields. */
    function mcpLimitsPayload(v) {
      return {
        expiresAt: v.expires ? new Date(`${v.expires}T23:59:59`).getTime() : null,
        tools: v.allTools ? null : v.tools,
        rateLimit: v.rateLimit ? Number(v.rateLimit) : null,
      }
    }
    const mcpLimitsOf = (tok) => ({ expires: mcpDateInput(tok?.expiresAt), allTools: !Array.isArray(tok?.tools), tools: tok?.tools ?? [], rateLimit: tok?.rateLimit ? String(tok.rateLimit) : '' })

    function McpTokenForm({ t, datasources, toolNames, onCreated, onCancel }) {
      const users = useAsync(() => call('listUsers').catch(() => []), [])
      const [form, setForm] = useState({ name: '', type: 'owner', memberId: '', role: 'analyst', datasourceIds: [], rowColumn: '', rowValues: '' })
      const [limits, setLimits] = useState(mcpLimitsOf(null))
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
        if (!limits.allTools && !limits.tools.length) return setErr(t('mcp.err.tools'))
        const extra = mcpLimitsPayload(limits)
        setBusy(true)
        try { onCreated(await call('createMcpToken', { name: form.name.trim(), scope, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== null)) })) } catch (e) { setErr(e.message) }
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
        h(McpLimitsFields, { t, value: limits, onChange: setLimits, toolNames }),
        err && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, err),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: submit }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.create'))))
    }

    /** Edit name / expiry / allowlist / rate limit of an existing token (the secret is never shown again). */
    function McpTokenEditor({ t, tok, toolNames, onSaved, onCancel }) {
      const [name, setName] = useState(tok.name)
      const [limits, setLimits] = useState(mcpLimitsOf(tok))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const save = async () => {
        setErr(null)
        if (!name.trim()) return setErr(t('mcp.err.name'))
        if (!limits.allTools && !limits.tools.length) return setErr(t('mcp.err.tools'))
        setBusy(true)
        try { onSaved(await call('updateMcpToken', { id: tok.id, name: name.trim(), ...mcpLimitsPayload(limits) })) } catch (e) { setErr(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card n2s-mcp-editor', 'data-editing': tok.id },
        h('div', { className: 'n2s-sechead-title', style: { marginBottom: 10 } }, fmt(t, 'mcp.editTitle', { name: tok.name })),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.tokenName')),
          h('input', { className: 'n2s-input', value: name, maxLength: 60, 'aria-label': t('mcp.tokenName'), onChange: e => setName(e.target.value) })),
        h(McpLimitsFields, { t, value: limits, onChange: setLimits, toolNames }),
        err && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, err),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.save'))))
    }

    /** "Test connection": mcpSelfTest (discover + tools/list + initialize over loopback with a temporary credential). */
    function McpSelfTest({ t, disabled }) {
      const [res, setRes] = useState(null)
      const [busy, setBusy] = useState(false)
      const run = async () => {
        setBusy(true)
        try { setRes(await call('mcpSelfTest')) } catch (e) { setRes({ ok: false, error: e.message, steps: [] }) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-mcp-selftest' },
        h('button', { type: 'button', className: 'n2s-btn small', disabled: disabled || busy, onClick: run }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.test')),
        res && h('div', { className: `n2s-notice ${res.ok ? 'ok' : 'err'}`, role: 'status', 'data-selftest': res.ok ? 'ok' : 'fail', style: { marginTop: 8 } },
          h('div', null, res.ok ? fmt(t, 'mcp.testOk', { n: res.tools?.length ?? 0 }) : (res.error ? fmt(t, 'mcp.testFail', { error: res.error }) : t('mcp.testFailSteps'))),
          (res.steps ?? []).length > 0 && h('ul', { className: 'n2s-mcp-steps' }, res.steps.map(s => h('li', { key: s.step }, s.ok ? '✓ ' : '✗ ', h('span', { className: 'n2s-mono' }, s.step), ` · ${s.detail} · ${s.ms} ms`)))))
    }

    /** Per-token call log with a status / tool filter. */
    function McpCallLog({ t, tokens }) {
      const [tokenId, setTokenId] = useState('')
      const [status, setStatus] = useState('')
      const [q, setQ] = useState('')
      const log = useAsync(() => call('mcpCallLog', { ...(tokenId ? { tokenId } : {}), ...(status ? { status } : {}), limit: 200 }), [tokenId, status])
      const when = (ms) => new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const rows = (log.value ?? []).filter(r => !q || `${r.tool ?? r.method} ${r.datasource ?? ''}`.toLowerCase().includes(q.toLowerCase()))
      const badge = (s) => h('span', { className: `n2s-badge ${s === 'ok' ? 'ok' : s === 'cancelled' || s === 'rate-limited' ? 'warn' : 'err'}` }, t(`mcp.log.status.${s}`) ?? s)
      return h('div', { className: 'n2s-card n2s-mcp-log' },
        h('div', { className: 'n2s-row', style: { flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
          h('select', { className: 'n2s-select', 'aria-label': t('mcp.log.token'), value: tokenId, onChange: e => setTokenId(e.target.value) },
            h('option', { value: '' }, t('mcp.log.allTokens')), tokens.map(tk => h('option', { key: tk.id, value: tk.id }, tk.name))),
          h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('mcp.log.status') }, ['', 'ok', 'error', 'cancelled', 'rate-limited'].map(v => h('button', { key: v || 'all', type: 'button', 'aria-pressed': status === v, onClick: () => setStatus(v) }, v ? t(`mcp.log.status.${v}`) : t('mcp.log.all')))),
          h('input', { className: 'n2s-input', style: { maxWidth: 200 }, 'aria-label': t('mcp.log.filter'), placeholder: t('mcp.log.filter'), value: q, onChange: e => setQ(e.target.value) }),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => log.reload() }, t('mcp.log.refresh'))),
        rows.length === 0
          ? h('div', { className: 'n2s-faint n2s-small' }, log.value ? t('mcp.log.empty') : '…')
          : h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-mcp-logtable' },
            h('thead', null, h('tr', null, [t('mcp.log.time'), t('mcp.log.token'), t('mcp.log.tool'), t('mcp.log.datasource'), t('mcp.log.ms'), t('mcp.log.rows'), t('mcp.log.status')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, rows.map(r => h('tr', { key: r.id, 'data-log-id': r.id, title: r.error ?? '' },
              h('td', { className: 'n2s-small' }, when(r.at)),
              h('td', { className: 'n2s-small' }, r.tokenName),
              h('td', { className: 'n2s-mono n2s-small' }, r.tool ?? r.method),
              h('td', { className: 'n2s-small' }, r.datasource ?? '—'),
              h('td', { className: 'n2s-small' }, r.ms),
              h('td', { className: 'n2s-small' }, r.rows ?? '—'),
              h('td', null, badge(r.status))))))))
    }

    function McpSection({ t, datasources }) {
      const st = useAsync(() => call('mcpStatus'), [])
      const [port, setPort] = useState('')
      const [busy, setBusy] = useState(false)
      const [creating, setCreating] = useState(false)
      const [editing, setEditing] = useState(null)
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
      const rotate = async (tok) => {
        if (!(await confirmDialog({ title: fmt(t, 'mcp.rotateConfirm', { name: tok.name }), message: t('mcp.rotateHint'), confirmLabel: t('mcp.rotate'), danger: true }))) return
        try { const r = await call('rotateMcpToken', { id: tok.id }); setFresh(r); notify(t('mcp.rotated'), 'ok'); st.reload() } catch (e) { notifyError(e) }
      }
      if (!s) return st.error ? h('div', { className: 'n2s-notice err' }, st.error.message) : h('div', { className: 'n2s-skel', style: { height: 200 } })
      const portDirty = port !== String(s.port)
      const toolNames = s.toolNames ?? []
      const limitsLabel = (tok) => [
        tok.expiresAt ? (tok.expired ? t('mcp.expired') : fmt(t, 'mcp.expiresOn', { date: new Date(tok.expiresAt).toLocaleDateString(uiLocale()) })) : null,
        Array.isArray(tok.tools) ? fmt(t, 'mcp.toolsN', { n: tok.tools.length }) : null,
        tok.rateLimit ? fmt(t, 'mcp.rateN', { n: tok.rateLimit }) : null,
      ].filter(Boolean)
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
          h(McpSelfTest, { t, disabled: !s.running }),
          h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('mcp.localOnly'))),
        fresh && h('div', { className: 'n2s-card n2s-mcp-fresh', role: 'status' },
          h('div', { className: 'n2s-sechead-title' }, fmt(t, 'mcp.freshTitle', { name: fresh.name })),
          h('div', { className: 'n2s-notice warn', style: { margin: '8px 0' } }, t('mcp.freshHint')),
          h('div', { className: 'n2s-mcp-endpoint' }, h('code', { className: 'n2s-mono', 'data-mcp-token': true }, fresh.token), h(McpCopy, { t, text: fresh.token })),
          h(McpSnippets, { t, url: s.url, token: fresh.token }),
          h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 8 } }, h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setFresh(null) }, t('mcp.done')))),
        h('div', { className: 'n2s-row', style: { margin: '18px 0 8px' } },
          h('div', { className: 'n2s-sechead-title n2s-grow' }, t('mcp.tokens')),
          !creating && h('button', { type: 'button', className: 'n2s-btn', onClick: () => setCreating(true) }, '+ ', t('mcp.newToken'))),
        creating && h(McpTokenForm, { t, datasources, toolNames, onCancel: () => setCreating(false), onCreated: (tok) => { setCreating(false); setFresh(tok); st.reload() } }),
        editing && h(McpTokenEditor, { key: editing.id, t, tok: editing, toolNames, onCancel: () => setEditing(null), onSaved: () => { setEditing(null); notify(t('mcp.saved'), 'ok'); st.reload() } }),
        s.tokens.length === 0 && !creating
          ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mcp.noTokens')), h('div', null, t('mcp.noTokensHint')))
          : s.tokens.length > 0 && h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-mcp-tokens' },
            h('thead', null, h('tr', null, [t('mcp.col.name'), t('mcp.col.scope'), t('mcp.col.limits'), t('mcp.col.created'), t('mcp.col.lastUsed'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, s.tokens.map(tok => h('tr', { key: tok.id, 'data-token-id': tok.id },
              h('td', null, h('div', null, tok.name), h('div', { className: 'n2s-faint n2s-small n2s-mono' }, `${tok.prefix}…`)),
              h('td', null, h(McpScopeLabel, { t, scope: tok.scope })),
              h('td', { className: 'n2s-small' }, limitsLabel(tok).length ? limitsLabel(tok).map((x, i) => h('span', { key: i, className: `n2s-badge ${tok.expired && i === 0 ? 'warn' : ''}` }, x)) : h('span', { className: 'n2s-faint' }, t('mcp.noLimits'))),
              h('td', { className: 'n2s-small' }, when(tok.createdAt)),
              h('td', { className: 'n2s-small' }, when(tok.lastUsedAt)),
              h('td', { className: 'n2s-mcp-actions' },
                h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setEditing(tok) }, t('mcp.edit')),
                h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => rotate(tok) }, t('mcp.rotate')),
                h('button', { type: 'button', className: 'n2s-btn small danger', onClick: () => revoke(tok) }, t('mcp.revoke')))))))),
        s.tokens.length > 0 && h(React.Fragment, null,
          h('div', { className: 'n2s-sechead-title', style: { margin: '18px 0 8px' } }, t('mcp.callLog')),
          h(McpCallLog, { t, tokens: s.tokens })),
        h('div', { className: 'n2s-sechead-title', style: { margin: '18px 0 8px' } }, t('mcp.setup')),
        h('div', { className: 'n2s-card' }, h(McpSnippets, { t, url: s.url, token: null }),
          h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('mcp.docsHint'))))
    }

    extend.adminSections.push({ id: 'mcp', label: (t) => t('mcp.nav'), icon: () => Icon.code(15), Component: McpSection })
