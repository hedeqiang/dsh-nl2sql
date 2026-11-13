    // ------------------------------------------------------------ icons

    const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, ...children)
    const Icon = {
      db: (size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 2.8 }),
        h('path', { d: 'M4.5 5.5v6.2c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V5.5' }),
        h('path', { d: 'M4.5 11.7v6.5c0 1.55 3.36 2.8 7.5 2.8 1 0 1.96-.07 2.83-.2' }),
        h('path', { d: 'M17 15.5v5M19.5 17.5v3M14.5 18.5v2', strokeWidth: 1.8 })),
      chev: (size = 12) => svg(size, [h('path', { key: 1, d: 'M4 6l4 4 4-4' })]),
      check: (size = 14) => svg(size, [h('path', { key: 1, d: 'M3.5 8.5l3 3 6-7' })], { strokeWidth: 1.8 }),
      more: (size = 16) => svg(size, [h('circle', { key: 1, cx: 3.5, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 2, cx: 8, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 3, cx: 12.5, cy: 8, r: .9, fill: 'currentColor' })]),
      code: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5' })]),
      copy: (size = 15) => svg(size, [h('rect', { key: 1, x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.6 }), h('path', { key: 2, d: 'M10.5 5.5V3.6c0-.6-.5-1.1-1.1-1.1H3.6c-.6 0-1.1.5-1.1 1.1v5.8c0 .6.5 1.1 1.1 1.1h1.9' })]),
      download: (size = 15) => svg(size, [h('path', { key: 1, d: 'M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10' })]),
      pin: (size = 15) => svg(size, [h('path', { key: 1, d: 'M10.2 2.5 13.5 5.8l-2.3.8-2.4 2.4.3 2.8-1.3 1.3-2.2-2.2-3 3M4.6 8.7 7.3 6l.8-2.3 2.1-1.2' })]),
      send: (size = 15) => svg(size, [h('path', { key: 1, d: 'M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z' })]),
      thumbUp: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5 7v6.5H3V7h2zm0 0 2.6-4.5c.8 0 1.4.7 1.3 1.5L8.6 6h3.6c.8 0 1.4.8 1.2 1.6l-1 4.6c-.1.7-.7 1.3-1.4 1.3H5' })]),
      thumbDown: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5 9V2.5H3V9h2zm0 0 2.6 4.5c.8 0 1.4-.7 1.3-1.5L8.6 10h3.6c.8 0 1.4-.8 1.2-1.6l-1-4.6c-.1-.7-.7-1.3-1.4-1.3H5' })]),
      chart: (size = 15) => svg(size, [h('path', { key: 1, d: 'M2.5 13.5h11M4.5 11V7.5M8 11V4.5M11.5 11V8.5' })]),
      table: (size = 15) => svg(size, [h('rect', { key: 1, x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 }), h('path', { key: 2, d: 'M2.5 6.5h11M6.5 6.5V13' })]),
      refresh: (size = 15) => svg(size, [h('path', { key: 1, d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v2.8h-2.8' })]),
      close: (size = 14) => svg(size, [h('path', { key: 1, d: 'M4 4l8 8M12 4l-8 8' })]),
      search: (size = 14) => svg(size, [h('circle', { key: 1, cx: 7, cy: 7, r: 4.5 }), h('path', { key: 2, d: 'M10.5 10.5 13.5 13.5' })]),
      spark: (size = 15) => svg(size, [h('path', { key: 1, d: 'M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8l4.2-1.3L8 2.5z' })]),
      arrow: (size = 15) => svg(size, [h('path', { key: 1, d: 'M3 8h10M9 4l4 4-4 4' })]),
      edit: (size = 15) => svg(size, [h('path', { key: 1, d: 'M10.5 3 13 5.5 6 12.5H3.5V10L10.5 3z' })]),
      external: (size = 14) => svg(size, [h('path', { key: 1, d: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.2c0 .5-.4.8-.8.8H3.3c-.5 0-.8-.3-.8-.8V4.8c0-.4.3-.8.8-.8h3.2' })]),
      trash: (size = 15) => svg(size, [h('path', { key: 1, d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.3c0 .4.4.7.8.7h4.2c.4 0 .8-.3.8-.7l.6-8.3' })]),
      up: (size = 14) => svg(size, [h('path', { key: 1, d: 'M8 13V3M4 7l4-4 4 4' })]),
      down: (size = 14) => svg(size, [h('path', { key: 1, d: 'M8 3v10M4 9l4 4 4-4' })]),
      expand: (size = 14) => svg(size, [h('path', { key: 1, d: 'M2.5 6V2.5H6M13.5 10v3.5H10M2.5 2.5l4 4M13.5 13.5l-4-4' })]),
    }

    /** Small popover menu anchored to a trigger; items: [{ label, icon?, onClick, danger?, checked?, divider? }]. */
    function Dropdown({ trigger, items, align = 'end', label }) {
      const [open, setOpen] = useState(false)
      const btn = useRef(null)
      const menu = useRef(null)
      const [pos, setPos] = useState(null)
      useEffect(() => {
        if (!open) return
        const r = btn.current.getBoundingClientRect()
        const width = 200
        const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(window.innerWidth - width - 8, r.left)
        const below = window.innerHeight - r.bottom > 260
        setPos(below ? { left, top: r.bottom + 4, minWidth: width } : { left, bottom: window.innerHeight - r.top + 4, minWidth: width })
        const onDown = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
        const onKey = (e) => {
          if (e.key === 'Escape') { setOpen(false); btn.current?.focus() }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const list = [...(menu.current?.querySelectorAll('button:not([disabled])') ?? [])]
            const i = list.indexOf(document.activeElement)
            list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
            e.preventDefault()
          }
        }
        const onScroll = () => setOpen(false)
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        window.addEventListener('scroll', onScroll, true)
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true) }
      }, [open])
      useEffect(() => { if (open && pos) menu.current?.querySelector('button:not([disabled])')?.focus() }, [open, pos])
      return h(React.Fragment, null,
        h('button', { ref: btn, type: 'button', className: trigger.className ?? 'n2s-iconbtn', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': label, title: label, onClick: () => setOpen(v => !v) }, trigger.content),
        open && pos && ReactDOM.createPortal(h('div', { ref: menu, className: 'n2s-menu', role: 'menu', style: pos },
          items.filter(Boolean).map((it, i) => it.divider
            ? h('hr', { key: `d${i}` })
            : h('button', { key: i, type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked, className: it.danger ? 'danger' : undefined, disabled: it.disabled, onClick: () => { setOpen(false); it.onClick() } },
              it.checked !== undefined ? h('span', { className: 'check' }, it.checked ? Icon.check(13) : null) : it.icon ? h('span', { className: 'n2s-ico' }, it.icon) : null,
              h('span', { className: 'n2s-grow' }, it.label),
              it.hint ? h('span', { className: 'n2s-faint n2s-small' }, it.hint) : null))), document.body))
    }

    /** Transient confirmation shown next to an action (copied / saved …). */
    function useFlash() {
      const [msg, setMsg] = useState(null)
      const timer = useRef(null)
      useEffect(() => () => clearTimeout(timer.current), [])
      return [msg, (text) => { setMsg(text); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 1600) }]
    }

