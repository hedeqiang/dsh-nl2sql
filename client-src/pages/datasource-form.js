    // ------------------------------------------------------------- page

    const DS_TYPES = [
      { id: 'mysql', label: 'MySQL', port: 3306 },
      { id: 'postgres', label: 'PostgreSQL', port: 5432 },
      { id: 'elasticsearch', label: 'Elasticsearch', port: 9200 },
    ]
    const TYPE_LABEL = { ...Object.fromEntries(DS_TYPES.map(x => [x.id, x.label])), sqlite: 'SQLite' }

    function DatasourceForm({ t, initial, onDone, onCancel }) {
      const [form, setForm] = useState(() => {
        const base = { type: 'mysql', name: '', host: '127.0.0.1', port: 3306, database: '', user: '', password: '', apiKey: '', charset: 'utf8mb4', schemas: '', ssl: false, description: '', ...(initial ?? {}) }
        return {
          ...base, password: '', apiKey: '',
          ssh: { enabled: false, host: '', port: 22, user: '', auth: 'password', password: '', privateKey: '', passphrase: '', ...(initial?.ssh ?? {}) },
          privacyOn: Boolean(initial?.privacy && Object.keys(initial.privacy).length),
          privacy: { sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, ...(initial?.privacy ?? {}) },
        }
      })
      const [test, setTest] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const setSsh = (k) => (e) => setForm(f => ({ ...f, ssh: { ...f.ssh, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }))
      const setPrivacy = (k, v) => setForm(f => ({ ...f, privacy: { ...f.privacy, [k]: v } }))
      const changeType = (type) => setForm(f => ({ ...f, type, port: DS_TYPES.find(x => x.id === type).port, database: type === 'elasticsearch' && !f.database ? '*' : f.database }))
      const isEs = form.type === 'elasticsearch'
      const payload = () => {
        const { privacyOn, privacy, ssh, ...rest } = form
        return {
          ...rest,
          port: Number(form.port) || DS_TYPES.find(x => x.id === form.type).port,
          ssh: ssh.enabled ? { ...ssh, port: Number(ssh.port) || 22 } : { enabled: false },
          privacy: privacyOn ? { ...privacy, modelRows: Number(privacy.modelRows) || 0 } : null,
          ...(initial?.id ? { id: initial.id } : {}),
        }
      }
      const runTest = async () => {
        setBusy(true); setTest(null)
        try { setTest(await call('testConnection', payload())) } catch (e) { setTest({ ok: false, error: e.message }) }
        setBusy(false)
      }
      const save = async () => {
        setBusy(true); setError(null)
        try {
          const saved = await call('saveDatasource', payload())
          await refreshDatasources()
          onDone?.(saved)
        } catch (e) { setError(e.message) }
        setBusy(false)
      }
      const input = (value, onChange, props = {}) => props.textarea
        ? h('textarea', { className: `n2s-textarea ${props.mono ? 'n2s-mono' : ''}`, value: value ?? '', onChange, placeholder: props.placeholder, spellCheck: false })
        : h('input', { className: 'n2s-input', value: value ?? '', onChange, type: props.type ?? 'text', placeholder: props.placeholder, autoComplete: 'off', spellCheck: false })
      const field = (key, label, props = {}) => h('label', { className: `n2s-field ${props.full ? 'full' : ''}` }, h('span', null, label), input(form[key], set(key), props))
      const sshField = (key, label, props = {}) => h('label', { className: `n2s-field ${props.full ? 'full' : ''}` }, h('span', null, label), input(form.ssh[key], setSsh(key), props))
      const radio = (key, values, prefix) => h('div', { style: { display: 'grid', gap: 4 } }, values.map(v => h('label', { key: v, className: 'n2s-check' },
        h('input', { type: 'radio', name: `ds-${key}`, checked: form.privacy[key] === v, onChange: () => setPrivacy(key, v) }), t(`settings.${prefix}.${v}`))))
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-field', style: { marginBottom: 14 } }, h('span', null, t('ds.type')),
          h('div', { className: 'n2s-seg', role: 'radiogroup' }, DS_TYPES.map(x => h('button', { key: x.id, type: 'button', role: 'radio', 'aria-checked': form.type === x.id, 'aria-pressed': form.type === x.id, disabled: Boolean(initial?.id) && initial.type !== x.id, onClick: () => changeType(x.id) }, x.label)))),
        h('div', { className: 'n2s-form' },
          field('name', t('ds.name'), { placeholder: t('ph.dsName') }),
          field('database', isEs ? t('ds.indexPattern') : t('ds.database'), { placeholder: isEs ? 'logs-*,orders' : '' }),
          field('host', t('ds.host')),
          field('port', t('ds.port'), { type: 'number' }),
          field('user', isEs ? t('ds.userOptional') : t('ds.user')),
          field('password', t('ds.password'), { type: 'password', placeholder: initial?.hasPassword ? t('ds.passwordKeep') : '' }),
          isEs && field('apiKey', t('ds.apiKey'), { type: 'password', placeholder: initial?.hasApiKey ? t('ds.passwordKeep') : t('ds.apiKeyHint'), full: true }),
          form.type === 'mysql' && field('charset', t('ds.charset')),
          form.type === 'postgres' && field('schemas', t('ds.schemas'), { placeholder: 'public,sales' }),
          h('label', { className: 'n2s-check', style: { alignSelf: 'end', height: 34 } }, h('input', { type: 'checkbox', checked: Boolean(form.ssl), onChange: set('ssl') }), isEs ? t('ds.https') : t('ds.ssl')),
          field('description', t('ds.description'), { textarea: true, full: true })),
        h('details', { className: 'n2s-details', open: form.ssh.enabled },
          h('summary', null, t('ds.sshTitle'), form.ssh.enabled ? h('span', { className: 'n2s-badge brand', style: { marginLeft: 8 } }, 'SSH') : null),
          h('label', { className: 'n2s-check', style: { margin: '8px 0' } }, h('input', { type: 'checkbox', checked: Boolean(form.ssh.enabled), onChange: setSsh('enabled') }), t('ds.sshEnable')),
          form.ssh.enabled && h('div', { className: 'n2s-form' },
            sshField('host', t('ds.sshHost')),
            sshField('port', t('ds.port'), { type: 'number' }),
            sshField('user', t('ds.user')),
            h('div', { className: 'n2s-field' }, h('span', null, t('ds.sshAuth')),
              h('div', { className: 'n2s-seg' }, ['password', 'key'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.ssh.auth === v, onClick: () => setForm(f => ({ ...f, ssh: { ...f.ssh, auth: v } })) }, t(`ds.sshAuth.${v}`))))),
            form.ssh.auth === 'password'
              ? sshField('password', t('ds.password'), { type: 'password', placeholder: initial?.ssh?.hasSecret ? t('ds.passwordKeep') : '', full: true })
              : h(React.Fragment, null,
                sshField('privateKey', t('ds.sshKey'), { textarea: true, mono: true, full: true, placeholder: initial?.ssh?.hasSecret ? t('ds.passwordKeep') : '-----BEGIN OPENSSH PRIVATE KEY-----' }),
                sshField('passphrase', t('ds.sshPassphrase'), { type: 'password' })),
            h('div', { className: 'n2s-muted n2s-small full' }, t('ds.sshHint')))),
        h('details', { className: 'n2s-details', open: form.privacyOn },
          h('summary', null, t('ds.privacyTitle'), form.privacyOn ? h('span', { className: 'n2s-badge warn', style: { marginLeft: 8 } }, t('ds.privacyCustom')) : null),
          h('label', { className: 'n2s-check', style: { margin: '8px 0' } }, h('input', { type: 'checkbox', checked: form.privacyOn, onChange: set('privacyOn') }), t('ds.privacyEnable')),
          form.privacyOn && h('div', { className: 'n2s-form' },
            h('div', { className: 'n2s-field' }, h('span', null, t('settings.sampleMode')), radio('sampleMode', ['off', 'enum', 'all'], 'sample')),
            h('div', { className: 'n2s-field' }, h('span', null, t('settings.resultToModel')), radio('resultToModel', ['none', 'summary', 'rows'], 'result')),
            form.privacy.resultToModel === 'rows' && h('label', { className: 'n2s-field' }, h('span', null, t('settings.modelRows')),
              h('input', { className: 'n2s-input', type: 'number', min: 0, max: 500, value: form.privacy.modelRows, onChange: e => setPrivacy('modelRows', e.target.value) })),
            h('label', { className: 'n2s-check full' }, h('input', { type: 'checkbox', checked: Boolean(form.privacy.maskSensitive), onChange: e => setPrivacy('maskSensitive', e.target.checked) }), t('settings.maskSensitive')))),
        test && h('div', { className: `n2s-notice ${test.ok ? (test.readOnlyGrant === false ? 'warn' : 'ok') : 'err'}`, style: { marginTop: 12 } },
          test.ok ? [fmt(t, 'ds.testOk', { version: test.version, tables: test.tableCount ?? '?', latency: test.latencyMs }), test.viaSsh ? t('ds.viaSsh') : '', ...(test.warnings ?? [])].filter(Boolean).join(' · ') : fmt(t, 'ds.testFail', { error: test.error })),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 12 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: busy, onClick: runTest }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.test')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, t('ds.save'))))
    }

    /** Page section header: title, one-line description, actions. */
    function SectionHead({ title, desc, children }) {
      return h('div', { className: 'n2s-sechead' },
        h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-sechead-title' }, title), desc && h('div', { className: 'n2s-sechead-desc' }, desc)),
        children)
    }

    /** Monogram tile for a data source type. */
    function TypeTile({ type }) {
      const map = { mysql: ['My', '#00758f'], postgres: ['Pg', '#336791'], elasticsearch: ['Es', '#f0a20b'], sqlite: ['CSV', '#16a34a'], lark_webhook: ['飞', '#3370ff'], lark_app: ['飞', '#3370ff'] }
      const [txt, color] = map[type] ?? ['DB', '#64748b']
      return h('span', { className: 'n2s-tile', style: { color, background: `color-mix(in srgb, ${color} 12%, transparent)` }, 'aria-hidden': true }, txt)
    }


