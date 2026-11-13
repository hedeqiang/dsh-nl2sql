    // -------------------------------------------------------------- CSS

    const CSS = `
.n2s-page{--n2s-radius:12px;--n2s-radius-sm:8px;--n2s-muted:var(--dsw-alias-label-secondary);--n2s-faint:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));--n2s-line:var(--dsw-alias-border-l1);--n2s-line-2:var(--dsw-alias-border-l2);--n2s-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));--n2s-fill:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05));--n2s-accent:#3b82f6;--n2s-ok:var(--dsw-alias-state-success-primary);--n2s-warn:var(--dsw-alias-state-warn-primary);--n2s-err:var(--dsw-alias-state-error-primary);width:100%;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.55;overflow:hidden}
.n2s-page,.n2s-toolcard,.n2s-modal,.n2s-menu{--n2s-muted:var(--dsw-alias-label-secondary);--n2s-faint:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));--n2s-line:var(--dsw-alias-border-l1);--n2s-line-2:var(--dsw-alias-border-l2);--n2s-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));--n2s-fill:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05));--n2s-accent:#3b82f6;--n2s-ok:var(--dsw-alias-state-success-primary);--n2s-warn:var(--dsw-alias-state-warn-primary);--n2s-err:var(--dsw-alias-state-error-primary)}
.n2s-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.n2s-content{max-width:1120px;margin:0 auto;padding:0 clamp(20px,4vw,40px) 64px;box-sizing:border-box}

/* header */
.n2s-top{position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-base);padding-top:24px}
[data-platform=darwin] .n2s-top{padding-top:calc(24px + var(--dsh-frame-top-clearance,0px))}
.n2s-heading{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.n2s-heading h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:28px}
.n2s-dspill{position:relative;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px 0 8px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;max-width:340px}
.n2s-dspill:hover{background:var(--n2s-hover)}
.n2s-dspill select{position:absolute;inset:0;opacity:0;cursor:pointer;font-size:13px}
.n2s-dspill .name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-dspill .meta{color:var(--n2s-faint);white-space:nowrap}
.n2s-dot{width:7px;height:7px;border-radius:50%;background:var(--n2s-ok);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-ok) 18%,transparent)}
.n2s-dot.off{background:var(--n2s-faint);box-shadow:none}
.n2s-dot.err{background:var(--n2s-err);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-err) 18%,transparent)}
.n2s-tabs{display:flex;align-items:center;gap:2px;border-bottom:.5px solid var(--n2s-line-2);overflow-x:auto;scrollbar-width:none}
.n2s-tabs::-webkit-scrollbar{display:none}
.n2s-tab{position:relative;height:36px;padding:0 12px;border:0;background:transparent;color:var(--n2s-muted);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
.n2s-tab:hover{color:var(--dsw-alias-label-primary)}
.n2s-tab[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-tab[aria-selected=true]::after{content:'';position:absolute;left:12px;right:12px;bottom:-.5px;height:2px;border-radius:2px;background:var(--dsw-alias-label-primary)}
.n2s-tabsep{width:1px;height:16px;margin:0 8px;background:var(--n2s-line-2);flex:none}
.n2s-body{padding-top:20px}

/* controls */
.n2s-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--n2s-radius-sm);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .12s,opacity .12s}
.n2s-btn:hover:not(:disabled){background:var(--n2s-hover)}
.n2s-btn:focus-visible,.n2s-tab:focus-visible,.n2s-iconbtn:focus-visible,.n2s-chip:focus-visible,.n2s-seg button:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:1px}
.n2s-btn:disabled{opacity:.45;cursor:default}
.n2s-btn.primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}
.n2s-btn.primary:hover:not(:disabled){opacity:.86;background:var(--dsw-alias-label-primary)}
.n2s-btn.small{height:28px;padding:0 10px;font-size:12px}
.n2s-btn.ghost{border-color:transparent;background:transparent;font-weight:400;color:var(--n2s-muted)}
.n2s-btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.n2s-btn.danger{color:var(--n2s-err)}
.n2s-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-faint);cursor:pointer;flex:none}
.n2s-iconbtn:hover:not(:disabled){background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-iconbtn:disabled{opacity:.35;cursor:default}
.n2s-iconbtn[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--n2s-hover)}
.n2s-iconbtn.danger:hover:not(:disabled){color:var(--n2s-err)}
.n2s-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.n2s-grow{flex:1;min-width:0}
.n2s-muted{color:var(--n2s-muted)}
.n2s-faint{color:var(--n2s-faint)}
.n2s-small{font-size:12px}
.n2s-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.n2s-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

/* surfaces */
.n2s-card{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);padding:16px}
.n2s-cards{display:grid;gap:10px}
.n2s-section{margin-top:28px}
.n2s-section>h2,.n2s-h2{font-size:14px;font-weight:600;margin:0 0 10px}
.n2s-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.n2s-empty{border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius);padding:40px 24px;text-align:center;color:var(--n2s-muted)}
.n2s-empty h3{margin:0 0 6px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.n2s-empty .n2s-btn{margin-top:14px}

/* forms */
.n2s-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
.n2s-form .full{grid-column:1/-1}
.n2s-field{display:grid;gap:6px;font-size:13px;align-content:start}
.n2s-field>span{color:var(--n2s-muted);font-size:12px}
.n2s-input,.n2s-select,.n2s-textarea{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 10px;border-radius:var(--n2s-radius-sm);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none;transition:border-color .12s,box-shadow .12s}
.n2s-textarea{height:auto;min-height:72px;padding:9px 10px;resize:vertical;line-height:1.55}
.n2s-input:focus,.n2s-select:focus,.n2s-textarea:focus{border-color:var(--n2s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-accent) 16%,transparent)}
.n2s-input::placeholder,.n2s-textarea::placeholder{color:var(--n2s-faint)}
.n2s-check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.n2s-check input,.n2s-page input[type=radio],.n2s-page input[type=checkbox]{accent-color:var(--dsw-alias-label-primary)}
.n2s-select.inline{width:auto;height:30px}

/* status */
.n2s-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:6px;font-size:11px;font-weight:500;line-height:20px;background:var(--n2s-fill);color:var(--n2s-muted);white-space:nowrap}
.n2s-badge.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 12%,transparent)}
.n2s-badge.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black);background:color-mix(in srgb,var(--n2s-warn) 14%,transparent)}
.n2s-badge.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 10%,transparent)}
.n2s-badge.brand{color:var(--dsw-alias-label-primary)}
.n2s-badge.blue{color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 12%,transparent)}
.n2s-notice{font-size:12.5px;padding:8px 12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);color:var(--n2s-muted);line-height:1.55}
.n2s-notice.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 10%,transparent)}
.n2s-notice.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 8%,transparent)}
.n2s-notice.warn{color:color-mix(in srgb,var(--n2s-warn) 80%,black);background:color-mix(in srgb,var(--n2s-warn) 12%,transparent)}
.n2s-statusdot{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--n2s-muted);white-space:nowrap}
.n2s-statusdot::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.n2s-statusdot.ok::before{background:var(--n2s-ok)}
.n2s-statusdot.err{color:var(--n2s-err)}
.n2s-statusdot.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black)}

/* segmented */
.n2s-seg{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-seg button{height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--n2s-muted);font:inherit;font-size:12px;cursor:pointer}
.n2s-seg button:hover{color:var(--dsw-alias-label-primary)}
.n2s-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 .5px var(--n2s-line-2)}
.n2s-seg button:disabled{opacity:.45;cursor:default}

/* lists */
.n2s-split{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;min-height:480px;align-items:start}
@media (width<=860px){.n2s-split{grid-template-columns:1fr}.n2s-form{grid-template-columns:1fr}}
.n2s-list{display:flex;flex-direction:column;gap:1px;max-height:calc(100vh - 260px);overflow:auto}
.n2s-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--n2s-radius-sm);border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;width:100%}
.n2s-item:hover{background:var(--n2s-hover)}
.n2s-item[aria-selected=true]{background:var(--n2s-fill);font-weight:500}
.n2s-item .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* tables */
.n2s-table-wrap{overflow:auto;max-height:420px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm)}
.n2s-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;line-height:1.5}
.n2s-table th,.n2s-table td{padding:7px 12px;border-bottom:.5px solid var(--n2s-line);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
.n2s-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);color:var(--n2s-muted);font-weight:500;font-size:12px;z-index:1;border-bottom-color:var(--n2s-line-2)}
.n2s-table tbody tr:hover td{background:var(--n2s-hover)}
.n2s-table tbody tr:last-child td{border-bottom:0}
.n2s-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.n2s-table th.num{text-align:right}
.n2s-table td.null{color:var(--n2s-faint);font-style:italic}
.n2s-code{margin:0;padding:12px 14px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;color:var(--dsw-alias-label-primary)}
.n2s-code.oneline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:none;padding:0;background:transparent;color:var(--n2s-muted)}

/* result */
.n2s-result{display:grid;gap:12px;min-width:0}
.n2s-result-head{display:flex;align-items:center;gap:10px;min-width:0}
.n2s-result-head .title{font-weight:600;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-result-meta{display:flex;align-items:center;gap:6px;color:var(--n2s-faint);font-size:12px;white-space:nowrap}
.n2s-result-meta .sep{opacity:.5}
.n2s-result-foot{display:flex;align-items:center;gap:4px;margin:-4px -4px -6px}
.n2s-chart{width:100%;height:300px}
.n2s-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;container-type:inline-size}
.n2s-kpi{min-width:0;padding:14px 16px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-kpi .v{font-size:clamp(18px,4.2cqi,26px);font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-kpi .k{margin-top:2px;font-size:12px;color:var(--n2s-muted)}
.n2s-dropdown{position:relative;display:inline-flex}
.n2s-menu{position:fixed;z-index:1000;min-width:180px;max-width:320px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 10px 30px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.06)}
.n2s-menu button{display:flex;width:100%;align-items:center;gap:8px;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer;white-space:nowrap}
.n2s-menu button:hover,.n2s-menu button:focus-visible{background:var(--n2s-hover);outline:none}
.n2s-menu button[aria-checked=true]{font-weight:500}
.n2s-menu button.danger{color:var(--n2s-err)}
.n2s-menu .check{width:14px;display:inline-flex;color:var(--dsw-alias-label-primary)}
.n2s-menu hr{border:0;border-top:.5px solid var(--n2s-line-2);margin:4px 2px}
.n2s-menu .n2s-ico{color:var(--n2s-faint);display:inline-flex}

/* ask */
.n2s-hero{margin:8px 0 24px}
.n2s-hero h2{margin:0 0 4px;font-size:22px;font-weight:600;letter-spacing:-.01em}
.n2s-hero p{margin:0;color:var(--n2s-muted);font-size:13.5px}
.n2s-askbox{position:relative;border:.5px solid var(--n2s-line-2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.04);transition:border-color .12s,box-shadow .12s}
.n2s-askbox:focus-within{border-color:color-mix(in srgb,var(--n2s-accent) 55%,var(--n2s-line-2));box-shadow:0 0 0 4px color-mix(in srgb,var(--n2s-accent) 12%,transparent)}
.n2s-askbox textarea{display:block;width:100%;box-sizing:border-box;min-height:96px;padding:16px 18px 8px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:1.6;resize:none}
.n2s-askbox textarea::placeholder{color:var(--n2s-faint)}
.n2s-askbar{display:flex;align-items:center;gap:8px;padding:8px 10px 10px 16px}
.n2s-kbd{display:inline-flex;align-items:center;height:18px;padding:0 5px;border-radius:4px;border:.5px solid var(--n2s-line-2);font-size:11px;color:var(--n2s-faint);font-family:inherit}
.n2s-examples{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:14px}
.n2s-example{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.n2s-example:hover{background:var(--n2s-hover);border-color:var(--n2s-line-2)}
.n2s-example .n2s-ico{margin-top:1px;color:var(--n2s-faint);flex:none}
.n2s-collapse{border-top:.5px solid var(--n2s-line-2);margin-top:32px;padding-top:16px}
.n2s-collapse>button{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.n2s-collapse>button:hover{color:var(--dsw-alias-label-primary)}
.n2s-collapse>button svg{transition:transform .15s}
.n2s-collapse>button[aria-expanded=true] svg{transform:rotate(180deg)}
.n2s-sqlbox{margin-top:12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.n2s-sqlbox textarea{display:block;width:100%;box-sizing:border-box;min-height:110px;padding:12px 14px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.n2s-sqlbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:.5px solid var(--n2s-line);background:var(--n2s-fill)}
.n2s-chips{display:flex;flex-wrap:wrap;gap:6px}
.n2s-chip{height:28px;padding:0 12px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.n2s-chip:hover{background:var(--n2s-hover)}
.n2s-chip[aria-pressed=true]{border-color:var(--dsw-alias-label-primary);font-weight:500}

/* history */
.n2s-hist{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.n2s-hist-row{border-bottom:.5px solid var(--n2s-line)}
.n2s-hist-row:last-child{border-bottom:0}
.n2s-hist-head{display:flex;align-items:center}
.n2s-hist-head:hover{background:var(--n2s-hover)}
.n2s-hist-head .n2s-rowdel{flex:none;margin-right:10px}
.n2s-hist-main{display:grid;grid-template-columns:76px minmax(0,1fr) 150px 84px 20px;align-items:center;gap:14px;flex:1;min-width:0;width:100%;padding:11px 6px 11px 16px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.n2s-hist-main:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:-2px}
.n2s-hist-what{display:grid;gap:2px;min-width:0}
.n2s-hist-title{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-hist-title.none{color:var(--n2s-muted);font-weight:400}
.n2s-hist-sql{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--n2s-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-hist-when{display:grid;gap:1px;font-size:12px;color:var(--n2s-muted);text-align:right;white-space:nowrap}
.n2s-hist-when .src{color:var(--n2s-faint)}
.n2s-hist-num{font-size:12px;color:var(--n2s-muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.n2s-hist-chev{color:var(--n2s-faint);display:inline-flex;transition:transform .15s}
.n2s-hist-main[aria-expanded=true] .n2s-hist-chev{transform:rotate(180deg)}
.n2s-hist-detail{display:grid;gap:10px;padding:2px 16px 16px 106px}
@media (width<=760px){.n2s-hist-main{grid-template-columns:64px minmax(0,1fr) 20px}.n2s-hist-when,.n2s-hist-num{display:none}.n2s-hist-detail{padding-left:16px}}
.n2s-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.n2s-stat{padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2)}
.n2s-stat .v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-stat .k{font-size:12px;color:var(--n2s-muted)}
.n2s-search{position:relative;flex:1;min-width:200px;max-width:320px}
.n2s-search .n2s-input{padding-left:30px}
.n2s-search .n2s-ico{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--n2s-faint);display:inline-flex}

/* dashboard */
.n2s-dash{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media (width<=980px){.n2s-dash{grid-template-columns:1fr}}
.n2s-widget{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1)}
.n2s-widget-head{display:flex;align-items:center;gap:8px;min-height:28px}
.n2s-widget-head .title{font-size:14px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-widget-actions{display:flex;align-items:center;gap:2px;margin-left:auto;opacity:0;transition:opacity .12s}
.n2s-widget:hover .n2s-widget-actions,.n2s-widget:focus-within .n2s-widget-actions{opacity:1}
@media (hover:none){.n2s-widget-actions{opacity:1}}
.n2s-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:16px;border-radius:var(--n2s-radius);background:var(--n2s-fill)}
.n2s-filterbar .n2s-select,.n2s-filterbar .n2s-input{height:30px;width:auto;background:var(--dsw-alias-bg-layer-1)}
.n2s-ftag{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 4px 0 10px;border-radius:var(--n2s-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);font-size:12.5px}
.n2s-ftag .n2s-select{border:0;height:26px;padding:0 4px;box-shadow:none}

/* tool card in chat */
.n2s-toolcard{margin:6px 0;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius,12px);background:var(--dsw-alias-bg-layer-1);padding:14px 16px;font-size:13px;--n2s-radius:12px;--n2s-radius-sm:8px}
.n2s-toolcard .n2s-chart{height:260px}
.n2s-toolcard-head{display:flex;align-items:center;gap:8px;color:var(--n2s-muted);font-size:12.5px}

/* composer & reply */
.n2s-composer{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border-radius:14px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;max-width:220px}
.n2s-composer:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.n2s-composer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-reply-send{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer}
.n2s-reply-send:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* modal */
.n2s-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(15,17,21,.36);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;animation:n2s-fade .12s ease-out}
.n2s-modal{width:min(680px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:20px 22px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 24px 64px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.55;animation:n2s-pop .14s ease-out}
.n2s-modal-title{font-size:16px;font-weight:600}
@keyframes n2s-fade{from{opacity:0}}
@keyframes n2s-pop{from{opacity:0;transform:translateY(6px) scale(.985)}}

/* section + list pattern */
.n2s-sechead{display:flex;align-items:flex-end;gap:10px;margin-bottom:16px}
.n2s-sechead-title{font-size:16px;font-weight:600;line-height:24px}
.n2s-sechead-desc{margin-top:2px;font-size:12.5px;color:var(--n2s-muted);max-width:720px;line-height:1.55}
.n2s-list2{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.n2s-list2-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:.5px solid var(--n2s-line)}
.n2s-list2-row:last-child{border-bottom:0}
.n2s-list2-row:hover{background:color-mix(in srgb,var(--n2s-hover) 50%,transparent)}
.n2s-list2-title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-list2-sub{margin-top:3px;font-size:12px;color:var(--n2s-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-list2-side{display:grid;justify-items:end;gap:2px;flex:none;min-width:112px}
.n2s-tile{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--n2s-fill);color:var(--n2s-muted);flex:none;font-size:12px;font-weight:700;letter-spacing:-.02em}
@media (width<=760px){.n2s-list2-side{display:none}}

/* schema */
.n2s-sidepanel{position:sticky;top:96px;display:flex;flex-direction:column;padding:8px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1)}
.n2s-legend{display:flex;flex-wrap:wrap;gap:4px 10px;padding:8px 6px 2px;border-top:.5px solid var(--n2s-line);margin-top:6px;font-size:11px;color:var(--n2s-faint)}
.n2s-legend>span{display:inline-flex;align-items:center;gap:5px}
.n2s-roledot{width:7px;height:7px;border-radius:2px;flex:none;background:#94a3b8}
.n2s-roledot.fact{background:#3b82f6}.n2s-roledot.dimension{background:#22c55e}.n2s-roledot.log{background:#f59e0b}.n2s-roledot.config{background:#8b5cf6}.n2s-roledot.view{background:#14b8a6}
.n2s-detail{min-width:0}
.n2s-detail-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
.n2s-detail-title{font-size:16px !important;font-weight:600}
.n2s-detail-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:20px}
.n2s-colkey{display:inline-flex;align-items:center;height:16px;padding:0 4px;border-radius:4px;font-size:9.5px;font-weight:700;letter-spacing:.02em;color:var(--n2s-faint);border:.5px solid var(--n2s-line-2)}
.n2s-colkey.pk{color:color-mix(in srgb,var(--n2s-warn) 75%,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,#f59e0b 50%,transparent);background:color-mix(in srgb,#f59e0b 10%,transparent)}
.n2s-coltable td{vertical-align:top;padding-top:9px;padding-bottom:9px}
.n2s-linkbtn{padding:0;border:0;background:transparent;color:var(--n2s-accent);font:inherit;cursor:pointer}
.n2s-linkbtn:hover{text-decoration:underline}

.n2s-subtabs{display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap}
.n2s-subtabs button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:.5px solid transparent;background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-subtabs button:hover{color:var(--dsw-alias-label-primary);background:var(--n2s-hover)}
.n2s-subtabs button[aria-selected=true]{background:var(--n2s-fill);color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-subtabs .count{font-size:11px;color:var(--n2s-faint);font-variant-numeric:tabular-nums}
.n2s-kbsub{margin-top:4px;font-size:13px;color:var(--n2s-muted);line-height:1.6}
.n2s-kbactions{opacity:0;transition:opacity .12s}
.n2s-kbrow:hover .n2s-kbactions,.n2s-kbrow:focus-within .n2s-kbactions{opacity:1}
@media (hover:none){.n2s-kbactions{opacity:1}}

/* drill & why */
.n2s-drill{border-top:.5px solid var(--n2s-line-2);padding-top:12px}
.n2s-waterfall{display:grid;gap:4px}
.n2s-wf-row{display:grid;grid-template-columns:minmax(80px,180px) minmax(0,1fr) 80px 44px;align-items:center;gap:10px;font-size:12.5px}
.n2s-wf-bar{height:14px;border-radius:4px;background:var(--n2s-fill);overflow:hidden}
.n2s-wf-fill{display:block;height:100%;border-radius:4px;background:var(--n2s-line-2)}
.n2s-wf-fill.up{background:#22c55e}
.n2s-wf-fill.down{background:#ef4444}
.n2s-wf-num{text-align:right;font-variant-numeric:tabular-nums}
.n2s-wf-share{text-align:right;font-size:11.5px}
/* dashboards tabs */
.n2s-dashtabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:14px}
.n2s-dashtabs [role=tab]{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-dashtabs [role=tab]:hover{color:var(--dsw-alias-label-primary)}
.n2s-dashtabs [role=tab][aria-selected=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}
.n2s-dashtabs .count{font-size:11px;opacity:.7}
/* eval chart */
.n2s-evalchart{display:flex;align-items:flex-end;gap:6px;height:110px;padding:10px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius)}
.n2s-evalbar{position:relative;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;width:28px;height:100%;padding:0;border:0;background:transparent;cursor:pointer}
.n2s-evalbar .fill{display:block;width:100%;border-radius:4px 4px 0 0;background:color-mix(in srgb,var(--n2s-accent) 70%,transparent)}
.n2s-evalbar[aria-pressed=true] .fill{background:var(--n2s-accent)}
.n2s-evalbar .lbl{font-size:10px;color:var(--n2s-faint);margin-top:2px}

.n2s-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;border:1.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius);cursor:pointer;text-align:center;padding:20px;transition:background .12s,border-color .12s}
.n2s-drop:hover,.n2s-drop.over{background:var(--n2s-hover);border-color:var(--n2s-accent)}

/* misc */
.n2s-md{font-size:13.5px;line-height:1.65;word-break:break-word}
.n2s-md a{color:var(--n2s-accent)}
.n2s-md-code{padding:1px 4px;border-radius:4px;background:var(--n2s-fill);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.n2s-mdedit .n2s-btn.small.ghost{height:24px;padding:0 6px}
.n2s-details{margin-top:16px;border-top:.5px solid var(--n2s-line-2);padding-top:12px}
.n2s-details>summary{cursor:pointer;font-size:13px;font-weight:500;list-style-position:inside}
.n2s-ask{display:grid;gap:10px}
.n2s-ask .n2s-textarea{min-height:88px}
.n2s-ds-head{display:flex;align-items:flex-start;gap:12px}
.n2s-ds-title{font-weight:600}
.n2s-dsicon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--n2s-fill);flex:none;font-size:11px;font-weight:600;color:var(--n2s-muted)}
.n2s-spin{display:inline-block;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:n2s-spin .8s linear infinite}
.n2s-skel{border-radius:8px;background:linear-gradient(90deg,var(--n2s-fill) 25%,color-mix(in srgb,var(--n2s-fill) 40%,transparent) 50%,var(--n2s-fill) 75%);background-size:200% 100%;animation:n2s-shimmer 1.2s infinite}
/* ---- v0.9 shell: admin area ---- */
.n2s-content.wide{max-width:1240px}
.n2s-tab.admin{display:inline-flex;align-items:center;gap:6px}
.n2s-admin{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.n2s-adminnav{position:sticky;top:12px;display:grid;gap:2px}
.n2s-adminnav-item{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border:0;border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.n2s-adminnav-item:hover{background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-adminnav-item[aria-current=page]{background:var(--n2s-fill);color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-adminnav-item .ico{display:inline-flex;width:18px;justify-content:center}
.n2s-adminnav-item:focus-visible,.n2s-setgroups button:focus-visible,.n2s-draghandle:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:1px}
.n2s-navbadge{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--n2s-fill);color:var(--n2s-muted);font-size:11px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.n2s-navbadge.err{background:var(--n2s-err);color:#fff}
.n2s-adminbody{min-width:0}
@media (width<=860px){.n2s-admin{grid-template-columns:1fr;gap:14px}.n2s-adminnav{position:static;display:flex;overflow-x:auto;scrollbar-width:none;gap:4px;padding-bottom:4px;border-bottom:.5px solid var(--n2s-line-2)}.n2s-adminnav-item{flex:none}.n2s-adminnav-item .n2s-grow{flex:none}}

/* ---- settings ---- */
.n2s-settings{max-width:820px;padding-bottom:72px}
.n2s-setgroups{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px}
.n2s-setgroups button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-setgroups button:hover{color:var(--dsw-alias-label-primary)}
.n2s-setgroups button[aria-selected=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}
.n2s-setpanel{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);padding:18px 20px;background:var(--dsw-alias-bg-layer-1)}
.n2s-setrow{display:grid;grid-template-columns:200px minmax(0,1fr);gap:4px 20px;padding:16px 0;border-top:.5px solid var(--n2s-line)}
.n2s-setrow:first-of-type{border-top:0}
.n2s-setrow-label{display:flex;align-items:flex-start;align-self:start;gap:6px;font-size:13.5px;font-weight:500;padding-top:6px;line-height:1.5}
.n2s-setrow-ctl{min-width:0}
.n2s-setrow-hint{grid-column:2;color:var(--n2s-muted);font-size:12.5px;line-height:1.55}
.n2s-setrow.changed .n2s-setrow-label{color:var(--dsw-alias-label-primary)}
@media (width<=760px){.n2s-setrow{grid-template-columns:1fr}.n2s-setrow-hint{grid-column:1}.n2s-setrow-label{padding-top:0}}
.n2s-dotchanged{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--n2s-accent);flex:none}
.n2s-radios{display:grid;gap:8px}
.n2s-radio{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);cursor:pointer}
.n2s-radio:hover{background:var(--n2s-hover)}
.n2s-radio.on{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent)}
.n2s-radio input{margin-top:3px}
.n2s-radio .title{display:block;font-size:13.5px;font-weight:500}
.n2s-radio .desc{display:block;color:var(--n2s-muted);font-size:12.5px;margin-top:2px;line-height:1.5}
.n2s-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px}
.n2s-switch input{appearance:none;width:34px;height:20px;border-radius:999px;background:var(--n2s-line-2);position:relative;cursor:pointer;margin:0;transition:background .15s}
.n2s-switch input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.n2s-switch input:checked{background:var(--n2s-accent)}
.n2s-switch input:checked::after{transform:translateX(14px)}
.n2s-switch input:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:2px}
.n2s-setnote{padding:10px 12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);color:var(--n2s-muted);font-size:12.5px;line-height:1.6}
.n2s-setsub{margin:22px 0 4px;font-size:14px;font-weight:500}
.n2s-infogrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:8px 0 6px}
.n2s-infocard{display:flex;align-items:center;gap:10px;padding:12px 14px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);min-width:0;margin:8px 0}
.n2s-infogrid .n2s-infocard{margin:0}
.n2s-infocard.col{flex-direction:column;align-items:flex-start;gap:2px}
.n2s-bignum{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-savebar{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;gap:10px;margin-top:16px;padding:10px 12px 10px 16px;border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 8px 28px rgba(0,0,0,.14);font-size:13.5px;animation:n2s-up .18s ease-out}
@keyframes n2s-up{from{transform:translateY(8px);opacity:0}}
.n2s-link{border:0;background:none;padding:0;color:var(--n2s-accent);font:inherit;cursor:pointer;text-decoration:none}
.n2s-link:hover{text-decoration:underline}
.n2s-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ---- toasts & dialogs ---- */
.n2s-toasts{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:grid;gap:8px;pointer-events:none}
.n2s-toast{display:flex;align-items:center;gap:8px;max-width:420px;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-bg-base,#fff);font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.2);pointer-events:auto;animation:n2s-up .18s ease-out}
.n2s-toast.err{background:var(--n2s-err,#dc2626);color:#fff}
.n2s-toast.ok svg{color:#4ade80}
.n2s-btn.danger-solid{background:var(--n2s-err,#dc2626);border-color:transparent;color:#fff}
.n2s-btn.danger-solid:hover{filter:brightness(1.05)}

/* ---- onboarding & ask ---- */
.n2s-onboard{margin-bottom:22px;padding:18px 20px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:linear-gradient(180deg,color-mix(in srgb,var(--n2s-accent) 5%,transparent),transparent 70%)}
.n2s-onboard-title{font-size:15px;font-weight:600}
.n2s-steps{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.n2s-step{display:flex;align-items:center;gap:12px;padding:10px 4px;border-radius:var(--n2s-radius-sm)}
.n2s-step .num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--n2s-line-2);font-size:12px;color:var(--n2s-muted);flex:none}
.n2s-step.current .num{border-color:var(--n2s-accent);color:var(--n2s-accent);font-weight:600}
.n2s-step.done .num{background:var(--n2s-ok);border-color:transparent;color:#fff}
.n2s-step .title{font-size:13.5px;font-weight:500}
.n2s-step.done .title{color:var(--n2s-muted);text-decoration:line-through;text-decoration-color:var(--n2s-line-2)}
.n2s-step .desc{font-size:12.5px;color:var(--n2s-muted)}
.n2s-step:not(.current) .desc{display:none}
.n2s-onboard-extra{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:12px;border-top:.5px dashed var(--n2s-line-2)}
.n2s-sectlabel{display:flex;align-items:center;gap:8px;margin:22px 0 8px;font-size:12px;font-weight:500;color:var(--n2s-faint);letter-spacing:.02em}
.n2s-sectlabel + .n2s-examples{margin-top:0}
.n2s-recent{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden}
.n2s-recent-row{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-top:.5px solid var(--n2s-line);font-size:13.5px;min-width:0}
.n2s-recent-row:first-child{border-top:0}
.n2s-recent-row:hover{background:var(--n2s-hover)}
.n2s-recent-row .n2s-btn{opacity:.75}
.n2s-recent-row:hover .n2s-btn{opacity:1}
.n2s-dot.warn{background:var(--n2s-warn)}
.n2s-show-narrow{display:none}
@media (width<=640px){.n2s-hide-narrow{display:none!important}.n2s-show-narrow{display:block}}

.n2s-progress{width:min(260px,70%);height:4px;margin-top:12px;border-radius:999px;background:var(--n2s-fill);overflow:hidden}
.n2s-progress span{display:block;height:100%;background:var(--n2s-accent);transition:width .2s}
.n2s-shuffle{display:inline-flex;align-items:center;gap:4px}
.n2s-shuffle:disabled{opacity:.6;cursor:default}
.n2s-spinning{display:inline-flex;animation:n2s-spin .8s linear infinite}
.n2s-recent-del,.n2s-rowdel{opacity:0;color:var(--n2s-faint)}
.n2s-recent-row:hover .n2s-recent-del,.n2s-recent-del:focus-visible,.n2s-hist-row:hover .n2s-rowdel,.n2s-rowdel:focus-visible{opacity:1}
.n2s-recent-del:hover,.n2s-rowdel:hover{color:var(--n2s-err)}
@media (hover:none){.n2s-recent-del,.n2s-rowdel{opacity:1}}
.n2s-morebtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:36px;margin-top:6px;border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-morebtn:hover{background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-btn.danger-text{color:var(--n2s-err)}
/* ---- member identity picker ---- */
.n2s-pickchips{display:flex;flex-wrap:wrap;gap:6px}
.n2s-pickchip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:30px;padding:0 10px;border:.5px solid var(--n2s-line-2);border-radius:999px;background:var(--n2s-surface);color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.n2s-pickchip:hover:not(:disabled){background:var(--n2s-hover)}
.n2s-pickchip[aria-pressed=true]{border-color:var(--n2s-accent);background:var(--n2s-accent-soft,rgba(51,112,255,.08));color:var(--n2s-accent)}
.n2s-pickchip:disabled{opacity:.55;cursor:default}
.n2s-pickchip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.n2s-idpicker{gap:6px}
.n2s-sub-group { margin-bottom: 12px; }
.n2s-sub-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.n2s-sub-chat { font-weight: 600; }
.n2s-sub-kind { font-size: 11px; }
.n2s-sub-err { color: var(--n2s-err); white-space: normal; max-width: 260px; }
/* ---- reconciliation (rc) ---- */
.n2s-rc-panes{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}
@media (max-width:820px){.n2s-rc-panes{grid-template-columns:1fr}}
.n2s-rc-pane{display:flex;flex-direction:column;gap:8px;padding:10px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);min-width:0}
.n2s-rc-pane-title{font-weight:500;margin-bottom:2px}
.n2s-rc-maprow{display:flex;align-items:center;gap:6px;margin-top:6px}
.n2s-rc-maprow .n2s-input{flex:1;min-width:0}
.n2s-rc-maprow .n2s-input.n2s-rc-tol{flex:0 0 100px}
.n2s-rc-dry{margin-top:14px;padding-top:12px;border-top:.5px solid var(--n2s-line)}
.n2s-rc-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.n2s-rc-stat{padding:8px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);min-width:96px}
.n2s-rc-stat-v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-rc-stat-l{font-size:12px;color:var(--n2s-muted)}
.n2s-rc-stat.bad .n2s-rc-stat-v,.n2s-rc-bad{color:var(--n2s-err)}
.n2s-rc-run{cursor:pointer}
.n2s-rc-run:hover td{background:color-mix(in srgb,currentColor 4%,transparent)}
.n2s-mcp .n2s-card{margin-bottom:12px}
.n2s-mcp-endpoint{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 6px}
.n2s-mcp-endpoint code{padding:4px 8px;border-radius:var(--n2s-radius-sm);background:var(--n2s-hover);font-size:12.5px;word-break:break-all}
.n2s-mcp-form{display:grid;gap:12px}
.n2s-mcp-snippets{margin-top:10px}
.n2s-mcp-code{position:relative}
.n2s-mcp-code pre{margin:0;padding:10px 12px;max-height:260px;overflow:auto;white-space:pre;font-size:12px}
.n2s-mcp-codeact{position:absolute;top:6px;right:6px}
.n2s-mcp-fresh{border-color:var(--n2s-accent)}
/* ---- presentation mode (feature present) ---- */
.n2s-pre{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:18px;padding:22px 28px 28px;overflow:auto;box-sizing:border-box;background:#0b1020;color:#e8ecf4;font-size:16px;line-height:1.5;outline:none;
  --dsw-alias-label-primary:#e8ecf4;--dsw-alias-label-secondary:#9aa4b8;--dsw-alias-label-tertiary:#6f7a90;--dsw-alias-border-l1:rgba(255,255,255,.10);--dsw-alias-border-l2:rgba(255,255,255,.16);--dsw-alias-bg-layer-1:#141b2e;--dsw-alias-bg-base:#0b1020;--n2s-muted:#9aa4b8;--n2s-faint:#6f7a90;--n2s-line:rgba(255,255,255,.10);--n2s-line-2:rgba(255,255,255,.16);--n2s-hover:rgba(255,255,255,.06);--n2s-fill:rgba(255,255,255,.05);--n2s-accent:#5b8cff;--n2s-ok:#34c759;--n2s-warn:#ffb020;--n2s-err:#ff5c5c}
.n2s-pre-head{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.n2s-pre-titles{flex:1;min-width:240px}
.n2s-pre-titles h1{margin:0;font-size:clamp(26px,2.6vw,40px);font-weight:700;letter-spacing:-.01em;line-height:1.2}
.n2s-pre-sub{color:#9aa4b8;font-size:14px;margin-top:4px}
.n2s-pre-clock{text-align:right;font-variant-numeric:tabular-nums}
.n2s-pre-clock .time{font-size:clamp(26px,2.4vw,38px);font-weight:600;line-height:1.1}
.n2s-pre-clock .date{color:#9aa4b8;font-size:13px}
.n2s-pre-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.n2s-pre-ctl label{display:inline-flex;align-items:center;gap:6px;color:#9aa4b8;font-size:13px}
.n2s-pre-ctl select{height:32px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#141b2e;color:#e8ecf4;font:inherit;font-size:13px}
.n2s-pre-btn{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#141b2e;color:#e8ecf4;font:inherit;font-size:16px;cursor:pointer}
.n2s-pre-btn:hover{background:#1d2640}
.n2s-pre-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:18px;align-content:start}
.n2s-pre-card{grid-column:span 3;min-width:0;padding:16px 18px;border-radius:14px;background:#141b2e;border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.25)}
.n2s-pre-card.w-third{grid-column:span 2}
.n2s-pre-card.w-full{grid-column:span 6}
.n2s-pre-card-title{display:flex;align-items:center;font-size:clamp(16px,1.3vw,22px);font-weight:600;margin-bottom:8px}
.n2s-pre-card .n2s-result-foot{display:none}
.n2s-pre-card .n2s-chart{min-height:300px}
.n2s-pre-card .n2s-kpi .v{font-size:clamp(34px,3.6vw,60px)}
.n2s-pre-card .n2s-table{font-size:14px}
.n2s-pre-empty{padding:80px 0;text-align:center;color:#9aa4b8;font-size:20px}
@media (max-width:1100px){.n2s-pre-card,.n2s-pre-card.w-third{grid-column:span 6}}
@media (min-width:1101px) and (max-width:1500px){.n2s-pre-card.w-third{grid-column:span 3}}
.n2s-pre-dlg{margin-top:10px}

/* ---- proactive: forecast, goals, digest ---- */
.n2s-pro-fc{margin-top:10px;padding:10px 12px;border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius-sm)}
.n2s-pro-fc-title{display:inline-flex;align-items:center;gap:6px;font-weight:500;font-size:13px}
.n2s-pro-chips{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.n2s-pro-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:.5px solid var(--n2s-line-2);font-size:12px;white-space:nowrap}
.n2s-pro-bar{position:relative;display:inline-block;width:64px;height:5px;border-radius:999px;background:var(--n2s-fill);overflow:hidden;flex:none}
.n2s-pro-bar .proj,.n2s-pro-bar .cur{position:absolute;left:0;top:0;bottom:0;border-radius:999px}
.n2s-pro-bar .proj{background:color-mix(in srgb,var(--n2s-accent) 28%,transparent)}
.n2s-pro-bar .cur{background:var(--n2s-accent)}
.n2s-pro-bar.ok .cur{background:var(--n2s-ok)}.n2s-pro-bar.ok .proj{background:color-mix(in srgb,var(--n2s-ok) 28%,transparent)}
.n2s-pro-bar.warn .cur{background:var(--n2s-warn)}.n2s-pro-bar.warn .proj{background:color-mix(in srgb,var(--n2s-warn) 28%,transparent)}
.n2s-pro-bar.err .cur{background:var(--n2s-err)}
.n2s-pro-bar .tick{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-label-secondary)}
.n2s-list2-row .n2s-pro-bar{width:140px}
.n2s-pro-pct{font-variant-numeric:tabular-nums;color:var(--n2s-muted)}
.n2s-pro-pct.ok{color:var(--n2s-ok)}.n2s-pro-pct.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black)}.n2s-pro-pct.err{color:var(--n2s-err)}
.n2s-pro-preview{margin-top:10px;padding:12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-pro-preview-charts{display:grid;gap:10px;margin-top:10px}
/* ---- data freshness / health (features/freshness.js) ---- */
.n2s-fq-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding:6px 10px;border-radius:var(--n2s-radius-sm);font-size:12.5px;line-height:1.5;color:color-mix(in srgb,var(--n2s-warn) 80%,black);background:color-mix(in srgb,var(--n2s-warn) 12%,transparent)}
.n2s-fq-panel{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);padding:6px 10px;margin-bottom:12px}
.n2s-fq-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 16px;margin-top:6px}
.n2s-fq-item{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;padding:2px 0}
.n2s-fq-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--n2s-faint)}
.n2s-fq-dot.ok{background:var(--n2s-ok)}
.n2s-fq-dot.warn{background:var(--n2s-warn)}
.n2s-fq-dot.err{background:var(--n2s-err)}
.n2s-fq-score{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:22px;padding:0 6px;border-radius:6px;font-weight:600;font-size:12px;background:var(--n2s-fill);color:var(--n2s-muted)}
.n2s-fq-score.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 12%,transparent)}
.n2s-fq-score.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black);background:color-mix(in srgb,var(--n2s-warn) 14%,transparent)}
.n2s-fq-score.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 10%,transparent)}
.n2s-fq-summary{display:flex;align-items:center;gap:12px;font-size:13px}
.n2s-fq-summary .n2s-fq-score{min-width:48px;height:34px;font-size:17px}
.n2s-adminnav-group{margin:14px 12px 4px;font-size:11.5px;letter-spacing:.02em;color:var(--n2s-faint)}
.n2s-adminnav-sep{height:.5px;margin:10px 12px;background:var(--n2s-line)}
.n2s-mcp-tabs{flex-wrap:wrap}
.n2s-mcp-limits{display:grid;gap:12px;padding-top:4px;border-top:1px dashed var(--n2s-border)}
.n2s-mcp-toolgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 12px;margin-top:4px;font-size:12.5px}
.n2s-mcp-editor{display:grid;gap:12px;border-color:var(--n2s-accent)}
.n2s-mcp-actions{text-align:right;white-space:nowrap}
.n2s-mcp-actions .n2s-btn{margin-left:4px}
.n2s-mcp-tokens .n2s-badge{margin:0 4px 2px 0}
.n2s-mcp-selftest{margin-top:6px}
.n2s-mcp-steps{margin:6px 0 0;padding-left:18px;font-size:12.5px}
.n2s-mcp-log .n2s-select{max-width:200px}
.n2s-mcp-logtable td{vertical-align:middle}
.n2s-fq-settings{padding-top:6px}
.n2s-fq-setgroup{margin:14px 0 2px;font-size:12.5px;font-weight:600;color:var(--n2s-muted);letter-spacing:.02em}
.n2s-fq-setgroup:first-child{margin-top:4px}
.n2s-cp-wrap{margin-top:14px;padding-top:6px;border-top:.5px solid var(--n2s-line)}
.n2s-cp .n2s-radios{display:grid;gap:6px}
.n2s-cp .n2s-radio span{display:grid;gap:2px}
.n2s-pickbar{display:grid;gap:8px;margin:0 0 6px;padding:8px;border-radius:8px;background:var(--n2s-fill)}
.n2s-pickbar-row{display:flex;align-items:center;gap:10px;white-space:nowrap}
.n2s-pickitem{display:flex;align-items:center;gap:8px;cursor:pointer}
.n2s-pickitem input{margin:0}
/* ---- milestones (features/milestones.js) ---- */
.n2s-ms-kinds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (max-width:720px){.n2s-ms-kinds{grid-template-columns:1fr}}
.n2s-ms-kind{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--n2s-line);border-radius:var(--n2s-radius-sm);cursor:pointer}
.n2s-ms-kind:hover{background:var(--n2s-hover)}
.n2s-ms-kind input{margin-top:3px}
.n2s-ms-kind>span{display:flex;flex-direction:column;gap:2px;min-width:0}
.n2s-ms-kind-title{font-size:13px;font-weight:500}
.n2s-ms-bt{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto}
.n2s-ms-bt-day{display:flex;gap:12px;align-items:flex-start;padding-bottom:8px;border-bottom:1px solid var(--n2s-line)}
.n2s-ms-bt-day:last-child{border-bottom:0}
.n2s-ms-bt-date{flex:none;width:84px;font-size:12px;color:var(--n2s-muted);font-variant-numeric:tabular-nums;padding-top:2px}
/* ---- dashboard v2 ---- */
.n2s-srcbadge{display:inline-flex;align-items:center;gap:3px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.n2s-seg.small button{height:26px;padding:0 10px;font-size:12px}
.n2s-dash{grid-template-columns:repeat(6,minmax(0,1fr));align-items:start}
.n2s-widget.w-third{grid-column:span 2}
.n2s-widget.w-half{grid-column:span 3}
.n2s-widget.w-full{grid-column:1 / -1}
@media (width<=1100px){.n2s-widget.w-third{grid-column:span 3}}
@media (width<=980px){.n2s-dash{grid-template-columns:1fr}.n2s-widget.w-third,.n2s-widget.w-half,.n2s-widget.w-full{grid-column:1 / -1}}
.n2s-draghandle{display:inline-flex;align-items:center;justify-content:center;width:18px;height:22px;margin-left:-6px;border-radius:4px;color:var(--n2s-faint);cursor:grab;flex:none;opacity:.5}
.n2s-widget:hover .n2s-draghandle{opacity:1}
.n2s-draghandle:active{cursor:grabbing}
.n2s-widget.dragging{opacity:.45}
.n2s-dash.is-dragging .n2s-widget:not(.dragging){transition:box-shadow .12s}
.n2s-widget.drop-before{box-shadow:inset 3px 0 0 var(--n2s-accent)}
.n2s-widget.drop-after{box-shadow:inset -3px 0 0 var(--n2s-accent)}
.n2s-widget.w-full.drop-before{box-shadow:inset 0 3px 0 var(--n2s-accent)}
.n2s-widget.w-full.drop-after{box-shadow:inset 0 -3px 0 var(--n2s-accent)}
@media (hover:none){.n2s-draghandle{display:none}}
.n2s-dashbar{flex-wrap:wrap;row-gap:8px}
.n2s-dashbar-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
@media (width<=640px){.n2s-dashbar-actions{width:100%;justify-content:flex-end}.n2s-dashtabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.n2s-dashtabs [role=tab]{flex:none}}
/* ---- channels, bots, identities ---- */
.n2s-flabel{color:var(--n2s-muted);font-size:12px;display:inline-flex;align-items:center;gap:2px}
.n2s-req{color:var(--n2s-err)}
.n2s-fielderr{color:var(--n2s-err);font-size:12px;line-height:1.45}
.n2s-input.invalid,.n2s-input[aria-invalid=true],.n2s-select[aria-invalid=true]{border-color:var(--n2s-err);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-err) 12%,transparent)}
.n2s-mono-soft{font-variant-ligatures:none}
.n2s-pmark{font-weight:700;letter-spacing:-.02em;flex:none;line-height:1}
.n2s-caps{display:inline-flex;flex-wrap:wrap;gap:4px}
.n2s-cap{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:999px;border:.5px solid var(--n2s-line-2);font-size:11px;color:var(--n2s-muted);white-space:nowrap}
.n2s-cap.muted{color:var(--n2s-faint);border-style:dashed}
.n2s-cap.bot{color:var(--n2s-accent);border-color:color-mix(in srgb,var(--n2s-accent) 40%,transparent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent)}
.n2s-statusdot.conn::before{background:var(--n2s-warn);animation:n2s-pulse 1.2s ease-in-out infinite}
.n2s-statusdot.warn::before{background:var(--n2s-warn)}
@keyframes n2s-pulse{50%{opacity:.35}}
.n2s-chpick{display:flex;align-items:center;gap:8px;min-width:0}
.n2s-chpick .n2s-select{flex:1}
.n2s-chpick-none{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:var(--n2s-fill);color:var(--n2s-faint);flex:none}
.n2s-pgroups{display:grid;gap:18px}
.n2s-pgroup-head{display:flex;align-items:center;gap:8px;margin:0 2px 8px;font-size:13px;font-weight:600}
.n2s-pgroup-head .n2s-faint{font-weight:400;font-size:12px}
.n2s-wizard{padding:20px 24px 18px}
.n2s-wiz-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.n2s-wiz-steps{display:flex;gap:6px;list-style:none;margin:0 0 16px;padding:0;counter-reset:wiz}
.n2s-wiz-steps li{counter-increment:wiz;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--n2s-faint)}
.n2s-wiz-steps li::before{content:counter(wiz);display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--n2s-line-2);font-size:11px}
.n2s-wiz-steps li+li::after{content:none}
.n2s-wiz-steps li+li{padding-left:6px;border-left:.5px solid var(--n2s-line-2)}
.n2s-wiz-steps li.current{color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-wiz-steps li.current::before{border-color:var(--n2s-accent);color:var(--n2s-accent)}
.n2s-wiz-steps li.done::before{content:'✓';background:var(--n2s-ok);border-color:transparent;color:#fff}
.n2s-ptiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:8px}
.n2s-ptile{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.n2s-ptile:hover{background:var(--n2s-hover)}
.n2s-ptile[aria-checked=true]{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent);box-shadow:0 0 0 1px var(--n2s-accent)}
.n2s-ptile:focus-visible,.n2s-kindcard:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:2px}
.n2s-ptile-name{font-size:13.5px;font-weight:600}
.n2s-kindcards{display:grid;gap:8px;margin:8px 0 0;padding:0;list-style:none}
.n2s-kindcard-li{display:grid}
.n2s-kindcard{display:grid;gap:4px;padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.n2s-kindcard:hover{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 4%,transparent)}
.n2s-kindcard-title{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.n2s-kindcard-title svg{color:var(--n2s-faint)}
.n2s-kindcard-desc{font-size:12.5px;color:var(--n2s-muted);line-height:1.55}
.n2s-setup{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);padding:10px 12px;background:var(--n2s-fill)}
.n2s-setup>summary{cursor:pointer;font-size:13px;font-weight:500}
.n2s-setup ol{margin:8px 0 2px;padding-left:20px;font-size:12.5px;line-height:1.75;color:var(--n2s-muted)}
.n2s-botbox{margin:16px 0 0;padding:12px 14px 14px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius)}
.n2s-botbox legend{padding:0 6px;font-size:13px;font-weight:600}
.n2s-botbox.focus{border-color:var(--n2s-accent)}
.n2s-wiz-foot{margin-top:16px;padding-top:14px;border-top:.5px solid var(--n2s-line);justify-content:flex-end}
.n2s-idrows{display:grid;gap:8px}
.n2s-idrow-main{display:flex;align-items:center;gap:8px}
.n2s-idrow-main .n2s-input{flex:1}
.n2s-idrow-help,.n2s-idrow .n2s-fielderr{margin:4px 0 0 38px}
.n2s-idchips{display:inline-flex;flex-wrap:wrap;gap:4px;min-width:0}
.n2s-idchip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 3px;border-radius:999px;background:var(--n2s-fill);font-size:11.5px;max-width:240px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.n2s-botrow{border-bottom:.5px solid var(--n2s-line)}
.n2s-botrow:last-child{border-bottom:0}
.n2s-botrow .n2s-list2-row{border-bottom:0}
.n2s-collapse>button .n2s-badge{margin-left:2px}
@media (prefers-reduced-motion:reduce){.n2s-statusdot.conn::before{animation:none}}
@keyframes n2s-spin{to{transform:rotate(360deg)}}
@keyframes n2s-shimmer{to{background-position:-200% 0}}
`

