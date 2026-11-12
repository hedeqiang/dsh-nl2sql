# dsh-nl2sql · Data Q&A

An enterprise NL2SQL plugin for DeepSeek Harness: connect databases, ask in plain language, and the agent writes read-only SQL, runs it and charts the result in the conversation. Pin results to dashboards, push them to Lark / Feishu, or ask the bot directly in a Lark group.

[中文](README.md)

## Features

- **Data sources:** MySQL 5.7+, PostgreSQL, Elasticsearch SQL (optionally over SSH), and CSV / Excel uploads stored as local SQLite.
- **Schema analysis:** table roles, column semantics (time / measure / enum / sensitive), inferred relations, ER view.
- **Asking:** in a Harness conversation through the `nl2sql_*` tools; results render as ECharts charts or tables.
- **Drill-down and "why did it change":** split by a dimension, show rows, rank dimensions by their contribution to a change.
- **Metric library and business knowledge:** glossary, governed metrics (`nl2sql_metric`), column notes, verified examples; import / export; accuracy evaluation against the examples.
- **Dashboards:** multiple boards, global filters, drag-to-reorder, three widths, snapshots, Excel export.
- **Channels:** Lark / Feishu, Telegram, WeCom and DingTalk through pluggable adapters ([docs/CHANNELS.md](docs/CHANNELS.md)); push Markdown and results (native charts, images or tables per platform), and @-mention bots that need no public URL.
- **Automation:** scheduled reports, metric alerts (threshold / change / anomaly / missing), schema change detection.
- **Safety:**
  - read-only admission with per-dialect lexing, read-only transactions, server-side timeouts, streamed truncation;
  - table / column access policies with masking, full-scan guard;
  - member scopes, viewer role and row-level rules for Lark users;
  - a setting for what result data reaches the model (column statistics by default); audit attributed to people.

## Install

Requires DeepSeek Harness (desktop or `dsh web`).

```bash
git clone <this repo> dsh-nl2sql && cd dsh-nl2sql
pnpm install --ignore-scripts
```

Install the directory as a bundle (plugin manager `install_bundle` with the absolute path), or add `@hedeqiang/dsh-nl2sql` to your profile's `dsh.profile.bundles` with a `link:` dependency. Once published, install `@hedeqiang/dsh-nl2sql` from npm.

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
