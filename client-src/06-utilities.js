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
    /** List separator in the UI language. */
    const listSep = () => (uiLang === 'zh' ? '、' : ', ')
    /** Clauses joined in the UI language: 「a；b」 / "a; b". */
    const joinClauses = (items) => joinList(items, uiLang === 'zh' ? '；' : '; ')
    /** Parenthetical in the UI language: 「（x）」 / " (x)". */
    const paren = (s) => (s === undefined || s === null || s === '' ? '' : uiLang === 'zh' ? `（${s}）` : ` (${s})`)
    /** Quoted name in the UI language: 「x」 / "x". */
    const quoted = (s) => (uiLang === 'zh' ? `「${s}」` : `"${s}"`)
    /** BCP 47 tag for Intl formatting in the UI language. */
    const uiLocale = () => (uiLang === 'zh' ? 'zh-CN' : 'en-US')
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
      if (v === null || v === undefined || v === '') return '—'
      const n = Number(v)
      if (!Number.isFinite(n)) return String(v)
      const abs = Math.abs(n)
      // [divisor, suffix, threshold, digits(abs)] from the largest unit down.
      const scales = uiLang === 'zh'
        ? [[1e8, '亿', 1e8, a => (a >= 1e10 ? 0 : 2)], [1e4, '万', 1e5, a => (a >= 1e7 ? 0 : 1)]]
        : [[1e9, 'B', 1e9, a => (a >= 1e11 ? 0 : 2)], [1e6, 'M', 1e6, a => (a >= 1e8 ? 0 : 1)], [1e3, 'K', 1e5, () => 0]]
      for (let i = 0; i < scales.length; i++) {
        const [div, suffix, threshold, digits] = scales[i]
        if (abs < threshold) continue
        const s = (n / div).toFixed(digits(abs))
        // Rounding can reach the next unit (999 999 → "1000K"): use the larger unit instead.
        if (i > 0 && Math.abs(Number(s)) >= scales[i - 1][0] / div) {
          const [div2, suffix2, , digits2] = scales[i - 1]
          return `${(n / div2).toFixed(digits2(scales[i - 1][0]))}${suffix2}`
        }
        return `${s}${suffix}`
      }
      return n.toLocaleString(uiLocale(), { maximumFractionDigits: 2 })
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
     *
     * `value` belongs to the current deps: while new deps load it is undefined,
     * so e.g. a previous data source's data is never shown or acted on.
     * `reload()` with unchanged deps keeps `value` until the new one arrives.
     * `scope` (optional) names the deps that identify *whose* data this is; when
     * only other deps change (a page offset, a filter) the previous value stays
     * on screen while the next one loads, as long as the scope is unchanged.
     */
    function useAsync(fn, deps, scope) {
      const depsKey = JSON.stringify(deps)
      const scopeKey = scope === undefined ? depsKey : JSON.stringify(scope)
      const [state, setState] = useState({ loading: true, value: undefined, error: undefined, key: null, scope: null })
      const seq = useRef(0)
      const reload = useCallback(() => {
        const id = ++seq.current
        setState(s => ({ ...s, loading: true, error: undefined }))
        Promise.resolve().then(fn).then(
          value => { if (seq.current === id) setState({ loading: false, value, error: undefined, key: depsKey, scope: scopeKey }) },
          error => { if (seq.current === id) setState({ loading: false, value: undefined, error, key: depsKey, scope: scopeKey }) },
        )
        return () => { if (seq.current === id) seq.current++ }
      }, deps)
      useEffect(reload, [reload])
      const stale = state.key !== depsKey
      const foreign = state.scope !== scopeKey
      return { loading: state.loading || stale, value: foreign ? undefined : state.value, error: stale ? undefined : state.error, stale, reload }
    }

    /**
     * Guard against double submits: `run(fn)` ignores calls while one is in
     * flight (checked synchronously through a ref, so two clicks in the same
     * tick still run once) and `busy` re-renders the disabled state.
     */
    function useBusy() {
      const ref = useRef(false)
      const [busy, setBusy] = useState(false)
      const alive = useRef(true)
      useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
      const run = useCallback(async (fn) => {
        if (ref.current) return undefined
        ref.current = true
        setBusy(true)
        try { return await fn() } finally { ref.current = false; if (alive.current) setBusy(false) }
      }, [])
      return [busy, run]
    }

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    /** Keep Tab / Shift+Tab focus inside the element while `active`. */
    function useFocusTrap(ref, active = true) {
      useEffect(() => {
        const el = ref.current
        if (!active || !el) return
        const onKey = (e) => {
          if (e.key !== 'Tab') return
          const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => !x.closest('[hidden]') && x.getAttribute('aria-hidden') !== 'true')
          if (!items.length) { e.preventDefault(); return }
          const first = items[0]
          const last = items[items.length - 1]
          const cur = document.activeElement
          if (e.shiftKey && (cur === first || !el.contains(cur))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (cur === last || !el.contains(cur))) { e.preventDefault(); first.focus() }
        }
        el.addEventListener('keydown', onKey)
        return () => el.removeEventListener('keydown', onKey)
      }, [ref, active, ref.current])
    }

