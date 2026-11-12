    // -------------------------------------------------------- utilities

    function fmt(t, key, vars) {
      let s = t(key)
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    }

    /** Current UI language ('zh' | 'en'), updated by the page/tool views on render. */
    let uiLang = 'zh'
    // LocaleSnapshot is { active, locales, revision } (dsh-client-locale); older hosts passed a string.
    /** Join a list for display in the UI language: 「a、b」 / "a, b". */
    const joinList = (items, sep) => (items ?? []).filter(x => x !== undefined && x !== null && x !== '').join(sep ?? (uiLang === 'zh' ? '、' : ', '))
    /** Label + colon in the UI language: 「标签：」 / "Label: ". */
    const colon = (label) => (uiLang === 'zh' ? `${label}：` : `${label}: `)
    const setUiLang = (snapshot) => {
      const id = typeof snapshot === 'string' ? snapshot : (snapshot?.active ?? snapshot?.locale ?? 'zh')
      uiLang = /^zh/i.test(String(id)) ? 'zh' : 'en'
    }

    function formatNumber(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return String(v)
      if (uiLang === 'zh' && Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
      if (Math.abs(n) >= 1e4) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
    }

    function formatCompact(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return String(v ?? '—')
      const abs = Math.abs(n)
      if (uiLang !== 'zh') {
        if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e11 ? 0 : 2)}B`
        if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`
        if (abs >= 1e5) return `${(n / 1e3).toFixed(0)}K`
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      }
      if (abs >= 1e8) return `${(n / 1e8).toFixed(abs >= 1e10 ? 0 : 2)}亿`
      if (abs >= 1e5) return `${(n / 1e4).toFixed(abs >= 1e7 ? 0 : 1)}万`
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    function toCsv(result) {
      const esc = (v) => {
        if (v === null || v === undefined) return ''
        const s = String(v)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      return `\ufeff${[result.columns.map(c => esc(c.name)).join(','), ...result.rows.map(r => r.map(esc).join(','))].join('\r\n')}`
    }

    function download(name, blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    /** Display-only SQL layout: one clause per line when the author wrote it on one line. */
    function prettySql(sql) {
      const src = String(sql ?? '')
      if (src.includes('\n') || src.length < 90) return src
      let depth = 0
      let out = ''
      let quote = null
      let inSelect = false
      for (let i = 0; i < src.length; i++) {
        const c = src[i]
        if (quote) { out += c; if (c === quote) quote = null; continue }
        if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; continue }
        if (c === '(') depth++
        if (c === ')') depth = Math.max(0, depth - 1)
        if (depth === 0) {
          const rest = src.slice(i)
          const m = rest.match(/^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION(?: ALL)?|(?:LEFT |RIGHT |INNER |FULL |CROSS )?(?:OUTER )?JOIN|WITH)\b/i)
          if (m && (out.length === 0 || /\s$/.test(out))) {
            inSelect = /^SELECT$/i.test(m[0])
            out = out.length ? out.replace(/\s+$/, '') + '\n' + m[0].toUpperCase() : m[0].toUpperCase()
            i += m[0].length - 1
            continue
          }
          if (c === ',' && inSelect) { out += ',\n  '; while (src[i + 1] === ' ') i++; continue }
        }
        out += c
      }
      return out
    }

    function downloadBase64({ base64, fileName, mediaType }) {
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      download(fileName, new Blob([bytes], { type: mediaType }))
    }

    async function exportExcel(payload) {
      try { downloadBase64(await call('exportExcel', payload)) } catch (e) { notifyError(e) }
    }

    function escapeHtml(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    }

    function safeName(s) {
      return (s || 'result').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
    }

    /**
     * Async data with request ordering: results of an older request (or of
     * previous deps) never overwrite newer ones, and `loading` is true from the
     * first render after deps change.
     */
    function useAsync(fn, deps) {
      const depsKey = JSON.stringify(deps)
      const [state, setState] = useState({ loading: true, value: undefined, error: undefined, key: null })
      const seq = useRef(0)
      const reload = useCallback(() => {
        const id = ++seq.current
        setState(s => ({ ...s, loading: true, error: undefined }))
        Promise.resolve().then(fn).then(
          value => { if (seq.current === id) setState({ loading: false, value, error: undefined, key: depsKey }) },
          error => { if (seq.current === id) setState({ loading: false, value: undefined, error, key: depsKey }) },
        )
        return () => { if (seq.current === id) seq.current++ }
      }, deps)
      useEffect(reload, [reload])
      const stale = state.key !== depsKey
      return { ...state, loading: state.loading || stale, stale, reload }
    }

