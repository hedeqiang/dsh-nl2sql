# dsh-nl2sql · Data Q&A

An enterprise NL2SQL plugin for DeepSeek Harness: connect databases, ask in plain language, and the agent writes read-only SQL, runs it and charts the result in the conversation. Pin results to dashboards, push them to Lark / Feishu, or ask the bot directly in a Lark group.

[中文](README.md)

## Features

- **Data sources:** MySQL 5.7+, PostgreSQL, Elasticsearch SQL (optionally over SSH), and CSV / Excel uploads stored as local SQLite.
- **Schema analysis:** table roles, column semantics (time / measure / enum / sensitive), inferred relations, ER view.
- **Asking:** in a Harness conversation through the `nl2sql_*` tools; results render as ECharts charts or tables.
- **Drill-down and "why did it change":** split by a dimension, show rows, rank dimensions by their contribution to a change.
- **Metric library and business knowledge:** glossary, governed metrics (`nl2sql_metric`), column notes, verified examples; import / export; accuracy evaluation against the examples.
- **Dashboards:** multiple boards, global filters, drag-to-reorder, three widths, snapshots, Excel export; a board may mix data sources — each chart shows its source and the board can be scoped to the current source.
- **Large results in IM:** messages say how many rows are shown; Lark app bots and Telegram attach the full data as Excel.
- **Channels:** Lark / Feishu, Telegram, WeCom and DingTalk through pluggable adapters ([docs/CHANNELS.md](docs/CHANNELS.md)); push Markdown and results (native charts, images or tables per platform), and @-mention bots that need no public URL.
- **Automation:** scheduled reports, metric alerts (threshold / change / anomaly / missing), schema change detection.
- **Safety:**
  - read-only admission with per-dialect lexing, read-only transactions, server-side timeouts, streamed truncation;
  - table / column access policies with masking, full-scan guard;
  - member scopes, viewer role and row-level rules for Lark users;
  - a setting for what result data reaches the model (column statistics by default); audit attributed to people.

## Install

Requires DeepSeek Harness 0.2 or later (desktop or `dsh web`). Published on npm as [`@hedeqiang/dsh-nl2sql`](https://www.npmjs.com/package/@hedeqiang/dsh-nl2sql).

[![npm](https://img.shields.io/npm/v/@hedeqiang/dsh-nl2sql)](https://www.npmjs.com/package/@hedeqiang/dsh-nl2sql)

**In Harness (recommended)**

1. Sidebar → **Plugins** → **Add plugin**.
2. Enter `@hedeqiang/dsh-nl2sql` (optionally with a version, e.g. `@hedeqiang/dsh-nl2sql@0.11.1`), install and enable it.
3. **Data Q&A** appears in the sidebar, and the Data Q&A preset is available for new conversations.

You can also ask the Harness agent: "install the plugin @hedeqiang/dsh-nl2sql".

**Command line**

```bash
dsh plugin --profile desktop add @hedeqiang/dsh-nl2sql   # desktop app profile; dsh web uses "web" by default
```

Then enable it on the **Plugins** page (or restart Harness).

**Upgrade:** update it from the plugin's details on the **Plugins** page, or run `dsh plugin --profile desktop update @hedeqiang/dsh-nl2sql`, then re-enable the plugin. Configuration and data live in `~/.dsh/nl2sql` and survive upgrades; older configuration is migrated on first load.

**Uninstall:** remove it on the **Plugins** page or with `dsh plugin --profile desktop remove @hedeqiang/dsh-nl2sql`. Data in `~/.dsh/nl2sql` is kept; delete the directory if you no longer need it. Database passwords live in the Harness credential store.

> All dependencies (mysql2, pg, ssh2, echarts, @resvg/resvg-js, @larksuiteoapi/node-sdk) ship prebuilt; no install scripts need to run.

**From source (development)**

```bash
git clone https://github.com/hedeqiang/dsh-nl2sql.git && cd dsh-nl2sql
pnpm install --ignore-scripts
```

Enter the directory's absolute path in **Plugins** → **Add plugin** (it is linked, so re-enabling the plugin picks up code changes), or ask the agent to install the directory with the plugin manager.

## Use

1. Sidebar → **Data Q&A** → **Manage → Data sources**: add a database (a read-only account is recommended) or upload a file.
2. **Schema** → analyze.
3. Ask on the **Ask** page, or pick the Data Q&A preset in any conversation.
4. Pin useful charts to a **Dashboard**; add glossary terms, metrics and examples under **Knowledge**.
5. **Manage → Push channels / Alerts & reports / Members & access** for Lark push, automation and the Lark bot.

## Data and privacy

- **Configuration:** `~/.dsh/nl2sql/state.json`.
- **Results, cache and logs:** `~/.dsh/nl2sql/results.sqlite`.
- **Uploaded files:** `~/.dsh/nl2sql/files/`.
- **Passwords and app secrets:** the Harness credential store.
- **What reaches the model:** **Settings → Data shown to the model** decides this; by default it is schema, enum values and per-column result statistics.
- **Lark:** content pushed to Lark leaves the machine.

## Development

```bash
npm test                       # whole suite; local MySQL / PostgreSQL optional (skipped when absent)
npm test -- --fast             # unit + UI tests only
node scripts/build-client.mjs  # regenerate lib/client.js after editing client-src/
```

See [DEVELOPMENT.md](DEVELOPMENT.md) and [eval/README.md](eval/README.md).

## License

[MIT](LICENSE)
