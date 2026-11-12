    // ------------------------------------------------------------ upload

    const UPLOAD_CHUNK = 4 * 1024 * 1024
    const UPLOAD_MAX = 200 * 1024 * 1024

    function bytesToBase64(bytes) {
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      return btoa(bin)
    }

    /**
     * Upload a file once, in 4 MB chunks, to the host's staging area. The host
     * parses it after the last chunk and returns { uploadId, sheets }.
     */
    async function stageFile(file, onProgress) {
      if (file.size > UPLOAD_MAX) throw new Error(`> 200 MB (${(file.size / 1048576).toFixed(0)} MB)`)
      const total = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK))
      let uploadId
      let res
      for (let index = 0; index < total; index++) {
        const chunk = new Uint8Array(await file.slice(index * UPLOAD_CHUNK, (index + 1) * UPLOAD_CHUNK).arrayBuffer())
        res = await call('stageUploadChunk', { uploadId, fileName: file.name, index, total, base64: bytesToBase64(chunk) })
        uploadId = res.uploadId
        onProgress?.((index + 1) / total)
      }
      return res
    }

    function UploadDialog({ t, datasources, initialTarget, onClose, onDone }) {
      const fileDs = datasources.filter(d => d.type === 'sqlite')
      const [file, setFile] = useState(null)
      const [uploadId, setUploadId] = useState(null)
      const [progress, setProgress] = useState(0)
      const [sheets, setSheets] = useState(null)
      const [target, setTarget] = useState(initialTarget ?? fileDs[0]?.id ?? '')
      const [newName, setNewName] = useState('')
      const [mode, setMode] = useState('create')
      const [state, setState] = useState(null)
      const [drag, setDrag] = useState(false)
      const inputRef = useRef(null)
      const pick = async (f) => {
        if (!f) return
        setFile(f); setSheets(null); setState({ busy: true }); setProgress(0)
        try {
          const staged = await stageFile(f, setProgress)
          setUploadId(staged.uploadId)
          setSheets(staged.sheets.map(sh => ({ ...sh, include: true })))
          setNewName(n => n || f.name.replace(/\.[^.]+$/, ''))
          setState(null)
        } catch (e) { setState({ error: e.message }) }
      }
      const run = async () => {
        setState({ busy: true })
        try {
          const res = await call('importUpload', { datasourceId: target || undefined, newName: target ? undefined : newName, fileName: file.name, uploadId, mode, sheets: sheets.filter(x => x.include).map(x => ({ sheet: x.sheet, table: x.table, mode, columns: x.columns })) })
          await refreshDatasources()
          setState({ done: res })
          onDone?.(res)
        } catch (e) { setState({ error: e.message }) }
      }
      const typeOpts = ['TEXT', 'INTEGER', 'REAL', 'DATE', 'DATETIME']
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('up.title'), style: { width: 'min(860px, 100%)' }, onKeyDown: (e) => { if (e.key === 'Escape' && !state?.busy) onClose() } },
          h('div', { className: 'n2s-row', style: { marginBottom: 12 } }, h('span', { className: 'n2s-modal-title' }, t('up.title')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
          !sheets && h('div', {
            className: `n2s-drop ${drag ? 'over' : ''}`, role: 'button', tabIndex: 0,
            onClick: () => inputRef.current?.click(), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() },
            onDragOver: (e) => { e.preventDefault(); setDrag(true) }, onDragLeave: () => setDrag(false),
            onDrop: (e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) },
          },
            h('div', { style: { fontSize: 15, fontWeight: 500 } }, state?.busy ? (progress > 0 && progress < 1 ? fmt(t, 'up.uploading', { p: Math.round(progress * 100) }) : t('up.parsing')) : t('up.drop')),
            state?.busy && h('div', { className: 'n2s-progress', role: 'progressbar', 'aria-valuenow': Math.round(progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: `${Math.max(4, progress * 100)}%` } })),
            h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 4 } }, t('up.formats')),
            h('input', { ref: inputRef, type: 'file', accept: '.csv,.tsv,.txt,.xlsx', style: { display: 'none' }, onChange: e => pick(e.target.files?.[0]) })),
          sheets && h(React.Fragment, null,
            h('div', { className: 'n2s-form', style: { marginBottom: 12 } },
              h('label', { className: 'n2s-field' }, h('span', null, t('up.target')),
                h('select', { className: 'n2s-select', value: target, onChange: e => setTarget(e.target.value) }, h('option', { value: '' }, t('up.newSource')), fileDs.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
              !target ? h('label', { className: 'n2s-field' }, h('span', null, t('up.newName')), h('input', { className: 'n2s-input', value: newName, onChange: e => setNewName(e.target.value) }))
                : h('div', { className: 'n2s-field' }, h('span', null, t('up.mode')), h('div', { className: 'n2s-seg' }, ['create', 'replace', 'append'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`up.mode.${m}`)))))),
            sheets.map((sh, si) => h('div', { key: sh.sheet, className: 'n2s-card', style: { marginBottom: 10, padding: 12 } },
              h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
                sheets.length > 1 && h('input', { type: 'checkbox', checked: sh.include, 'aria-label': sh.sheet, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, include: e.target.checked } : y)) }),
                h('span', { className: 'n2s-small n2s-muted' }, t('up.table')),
                h('input', { className: 'n2s-input', style: { width: 220, height: 30 }, value: sh.table, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, table: e.target.value } : y)) }),
                h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'up.rows', { rows: sh.rowCount.toLocaleString(), cols: sh.columns.length }), sh.encoding && sh.encoding !== 'utf-8' ? ` · ${sh.encoding}` : '', sh.truncated ? ` · ${t('up.truncated')}` : '')),
              h('div', { className: 'n2s-table-wrap', style: { maxHeight: 260 } }, h('table', { className: 'n2s-table' },
                h('thead', null,
                  h('tr', null, sh.columns.map((c, ci) => h('th', { key: ci }, c.name))),
                  h('tr', null, sh.columns.map((c, ci) => h('th', { key: ci, style: { top: 30, padding: '2px 8px' } }, h('select', { className: 'n2s-select', style: { height: 24, fontSize: 11, padding: '0 4px' }, value: c.type, 'aria-label': `${c.name} type`, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, columns: y.columns.map((cc, j) => j === ci ? { ...cc, type: e.target.value } : cc) } : y)) }, typeOpts.map(o => h('option', { key: o, value: o }, t(`up.type.${o}`)))))))),
                h('tbody', null, sh.preview.slice(0, 8).map((r, ri) => h('tr', { key: ri }, sh.columns.map((c, ci) => h('td', { key: ci, className: c.type === 'INTEGER' || c.type === 'REAL' ? 'num' : undefined }, r[ci] === null || r[ci] === undefined ? '' : String(r[ci]))))))))))),
          state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
          state?.done && h('div', { className: 'n2s-notice ok', style: { marginTop: 10 } }, fmt(t, 'up.done', { name: state.done.datasourceName }), ' ', state.done.results.map(r => r.ok ? fmt(t, 'up.resultOk', { table: r.table, rows: r.rows }) : `${r.sheet}: ${r.error}`).join('；')),
          h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
            h('span', { className: 'n2s-faint n2s-small n2s-grow' }, t('up.privacy')),
            h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, state?.done ? t('ds.close') : t('ds.cancel')),
            sheets && !state?.done && h('button', { type: 'button', className: 'n2s-btn primary', disabled: state?.busy || !sheets.some(x => x.include) || (!target && !newName.trim()), onClick: run }, state?.busy ? h('span', { className: 'n2s-spin' }) : null, t('up.import'))))), document.body)
    }
