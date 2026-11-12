    /** Minimal Markdown → React preview of what the Lark card shows (escaped; <font color> kept). */
    function MdPreview({ text }) {
      const blocks = []
      const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
      const inline = (s, key) => {
        const out = []
        const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|<font color=['"]?([\w-]+)['"]?>([\s\S]*?)<\/font>|<at [^>]*><\/at>)/g
        let last = 0
        let m
        let i = 0
        while ((m = re.exec(s))) {
          if (m.index > last) out.push(s.slice(last, m.index))
          const t = m[0]
          const k = `${key}-${i++}`
          if (t.startsWith('**') || t.startsWith('__')) out.push(h('strong', { key: k }, t.slice(2, -2)))
          else if (t.startsWith('~~')) out.push(h('del', { key: k }, t.slice(2, -2)))
          else if (t.startsWith('`')) out.push(h('code', { key: k, className: 'n2s-md-code' }, t.slice(1, -1)))
          else if (t.startsWith('[')) { const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/); out.push(h('a', { key: k, href: mm[2], target: '_blank', rel: 'noreferrer' }, mm[1])) }
          else if (t.startsWith('<font')) { const c = { green: '#34c724', red: '#f54a45', grey: '#8f959e', gray: '#8f959e', blue: '#3370ff', orange: '#ff8800' }[m[2]] ?? undefined; out.push(h('span', { key: k, style: c ? { color: c } : undefined }, m[3])) }
          else if (t.startsWith('<at')) out.push(h('span', { key: k, className: 'n2s-badge brand' }, /all/.test(t) ? (uiLang === 'zh' ? '@所有人' : '@all') : (uiLang === 'zh' ? '@用户' : '@user')))
          else out.push(h('em', { key: k }, t.slice(1, -1)))
          last = m.index + t.length
        }
        if (last < s.length) out.push(s.slice(last))
        return out
      }
      for (let i = 0; i < lines.length;) {
        const line = lines[i]
        if (/^```/.test(line)) {
          const body = []
          i++
          while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
          i++
          blocks.push(h('pre', { key: blocks.length, className: 'n2s-code' }, body.join('\n')))
          continue
        }
        if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
          const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
          const head = split(line)
          const rows = []
          i += 2
          while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]))
          blocks.push(h('div', { key: blocks.length, className: 'n2s-table-wrap', style: { maxHeight: 220 } }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, head.map((c, j) => h('th', { key: j }, inline(c, `h${j}`))))),
            h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, head.map((_, j) => h('td', { key: j }, inline(r[j] ?? '', `c${ri}-${j}`)))))))))
          continue
        }
        const hm = line.match(/^(#{1,6})\s+(.*)$/)
        if (hm) { blocks.push(h('div', { key: blocks.length, style: { fontWeight: 600, fontSize: [20, 18, 16, 15, 14, 14][hm[1].length - 1], margin: '6px 0 2px' } }, inline(hm[2], `t${i}`))); i++; continue }
        if (/^(-{3,}|<hr\s*\/?>)\s*$/.test(line)) { blocks.push(h('hr', { key: blocks.length, style: { border: 0, borderTop: '.5px solid var(--dsw-alias-border-l2)', margin: '8px 0' } })); i++; continue }
        if (/^>\s?/.test(line)) {
          const q = []
          while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
          blocks.push(h('div', { key: blocks.length, style: { borderLeft: '3px solid var(--dsw-alias-border-l2)', paddingLeft: 8, color: 'var(--dsw-alias-label-secondary)' } }, q.map((l, j) => h('div', { key: j }, inline(l, `q${i}-${j}`)))))
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const items = []
          const ordered = /^\s*\d+\./.test(line)
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
          blocks.push(h(ordered ? 'ol' : 'ul', { key: blocks.length, style: { margin: '2px 0', paddingLeft: 20 } }, items.map((it, j) => h('li', { key: j }, inline(it, `l${i}-${j}`)))))
          continue
        }
        if (line.trim() === '') { i++; continue }
        const para = []
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) para.push(lines[i++])
        if (!para.length) { para.push(lines[i++]) }
        blocks.push(h('p', { key: blocks.length, style: { margin: '4px 0' } }, para.flatMap((l, j) => [j ? h('br', { key: `b${j}` }) : null, ...inline(l, `p${i}-${j}`)])))
      }
      return h('div', { className: 'n2s-md' }, blocks)
    }

    const MD_SNIPPETS_ZH = [
      ['im.md.bold', '**', '**', '加粗'],
      ['im.md.heading', '\n## ', '', '标题'],
      ['im.md.list', '\n- ', '', '要点'],
      ['im.md.quote', '\n> ', '', '引用'],
      ['im.md.green', "<font color='green'>", '</font>', '+12%'],
      ['im.md.red', "<font color='red'>", '</font>', '-5%'],
      ['im.md.table', '\n| 指标 | 数值 |\n|---|---:|\n| ', ' | 0 |\n', '名称'],
      ['im.md.link', '[', '](https://)', '链接'],
      ['im.md.atAll', '<at id=all></at> ', '', ''],
    ]
    const MD_SNIPPETS_EN = [
      ['im.md.bold', '**', '**', 'bold'],
      ['im.md.heading', '\n## ', '', 'Heading'],
      ['im.md.list', '\n- ', '', 'point'],
      ['im.md.quote', '\n> ', '', 'quote'],
      ['im.md.green', "<font color='green'>", '</font>', '+12%'],
      ['im.md.red', "<font color='red'>", '</font>', '-5%'],
      ['im.md.table', '\n| Metric | Value |\n|---|---:|\n| ', ' | 0 |\n', 'name'],
      ['im.md.link', '[', '](https://)', 'link'],
      ['im.md.atAll', '<at id=all></at> ', '', ''],
    ]
    const mdSnippets = () => (uiLang === 'zh' ? MD_SNIPPETS_ZH : MD_SNIPPETS_EN)

    function MdEditor({ t, value, onChange, minHeight = 140 }) {
      const ref = useRef(null)
      const [mode, setMode] = useState('edit')
      const insert = ([, before, after, placeholder]) => {
        const el = ref.current
        const start = el?.selectionStart ?? value.length
        const end = el?.selectionEnd ?? value.length
        const sel = value.slice(start, end) || placeholder
        const next = value.slice(0, start) + before + sel + after + value.slice(end)
        onChange(next)
        requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = start + before.length; el.selectionEnd = start + before.length + sel.length } })
      }
      return h('div', { className: 'n2s-mdedit' },
        h('div', { className: 'n2s-row', style: { gap: 4, marginBottom: 4 } },
          h('div', { className: 'n2s-seg' }, ['edit', 'preview'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`im.md.${m}`)))),
          mode === 'edit' && mdSnippets().map(sn => h('button', { key: sn[0], type: 'button', className: 'n2s-btn small ghost', title: t(sn[0]), onMouseDown: (e) => e.preventDefault(), onClick: () => insert(sn) }, t(sn[0])))),
        mode === 'edit'
          ? h('textarea', { ref, className: 'n2s-textarea', style: { minHeight, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12.5 }, value, spellCheck: false, placeholder: t('im.textPh'), onChange: e => onChange(e.target.value) })
          : h('div', { className: 'n2s-card', style: { minHeight, maxHeight: 360, overflow: 'auto', padding: '10px 12px' } }, value.trim() ? h(MdPreview, { text: value }) : h('span', { className: 'n2s-muted' }, t('im.md.empty'))))
    }
