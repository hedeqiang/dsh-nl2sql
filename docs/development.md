# Development guide

This document describes how the plugin is organised and how to work on it. For setup and the pull request process, see [CONTRIBUTING.md](../CONTRIBUTING.md); for the IM adapter contract, see [channels.md](channels.md).

## How the plugin fits into DeepSeek Harness

dsh-nl2sql is a Harness **bundle** (`package.json` → `dsh.bundle.patch`). Its patch, [`cordis.patch.yml`](../cordis.patch.yml), adds three rows to the Harness composition:

- `nl2sql` — the Host plugin ([`index.js`](../index.js)). It creates the service, registers the `nl2sql_*` agent tools and the page RPC endpoint `/api/nl2sql.rpc`, and starts the scheduler and IM bots.
- `preset-nl2sql` — the *Data Q&A* agent preset (`nl2sql`): page conversations, scheduled reports and evaluation runs.
- `preset-nl2sql-bot` — the preset of conversations created by IM bots (`nl2sql-bot`): no `ask_user_question` tool; the card layout and chat rules that used to be repeated in every bot message.

Both presets share one set of core rules through the YAML anchor `&nl2sql-core` (the persona `prefix`); each adds its own rules as the persona `suffix`. Bot messages carry only what changes per message: who asks where, and the data-source note.

The browser side (`dsh.client` in `package.json`) is a single module, [`lib/client.js`](../lib/client.js), that renders the Data Q&A page and the tool result views in conversations.

## Project layout

| Path | Contents |
|---|---|
| `index.js` | Host entry: wires the service, registers agent tools and page RPCs |
| `service/shared.js` | Shared constants and helpers; `Records` (log-style storage) |
| `service/datasources.js` | Settings, data sources, session binding, driver pool |
| `service/access.js` | Members (multi-platform `identities`), roles, data source scopes, row-level rules, `resolveActor`, identities seen by bots |
| `service/schema.js` | Schema analysis, change detection, business knowledge, import / export, table ranking |
| `service/query.js` | Query execution (admission, access control, row-level filters, cache, masking), metrics, drill-down / attribution, Excel export |
| `service/dashboards.js` | Dashboards, global filters, table overviews, scheduled reports, history |
| `service/channels.js` | IM channels: validation through adapters, secrets (`nl2sql/ch-<id>`), listing, tests, push, full-data attachments, delivery log |
| `service/bots.js` | IM bots: one bot per enabled bot-capable channel; message → conversation → agent turn → reply; data source routing; buttons with opaque tokens (SQLite `action_tokens`, 7-day expiry) re-authorized on every click |
| `service/push.js` | Sending assistant replies and dashboards, dashboard snapshots, result feedback |
| `service/evaluation.js` | Accuracy evaluation |
| `service/alerts.js` | Alerts and the in-process scheduler (including the daily schema check) |
| `service/uploads.js` | CSV / Excel uploads into local SQLite (staged under `uploads/<uploadId>`, chunked, 1-hour expiry) |
| `service/admin.js` | Storage stats, log retention and purge, config export / import, about info, Ask-page suggestions, onboarding |
| `service/suggestions.js` | Knowledge suggestions mined from history and feedback |
| `sql-guard.js` | Read-only SQL admission with per-dialect lexing (MySQL / PostgreSQL / SQLite / Elasticsearch) |
| `policy.js` | Access policies (tables, hidden and masked columns) |
| `filters.js`, `analysis.js` | Filter injection; metrics, drill-down, attribution, alert evaluation, result comparison |
| `drivers.js`, `sqlite-driver.js` | Database drivers |
| `store.js` | SQLite store `results.sqlite`: results, cache, snapshots, log records |
| `channels/index.js` | Adapter registry and catalog (`registerAdapter`, `kindOf`, `listCatalog`) |
| `channels/http.js`, `channels/message.js` | HTTP with timeouts and `ChannelError`; platform-neutral message helpers (chart PNG, Markdown tables, row-omission notes) |
| `channels/lark.js`, `telegram.js`, `wecom.js`, `dingtalk.js` | Platform adapters |
| `im.js`, `lark-bot.js` | Compatibility re-exports for old import paths |
| `xlsx.js` | Excel / CSV reading and writing |
| `client-src/*.js` | Page source, split by feature — **edit these** |
| `lib/client.js` | Generated from `client-src/` — **do not edit by hand** |
| `lib/client.echarts.js` | Bundled ECharts (`node scripts/build-echarts.mjs`) |
| `eval/` | Synthetic database and knowledge for an isolated accuracy benchmark |

### The browser bundle

The files in `client-src/` are consecutive slices of one module factory function and share a single scope; [`scripts/build-client.mjs`](../scripts/build-client.mjs) concatenates them in file-name order into `lib/client.js`. Name new files so they sort into the right place (for example `15b-…` between `15-…` and `16-…`). Functions are hoisted within the factory, so order matters only for top-level `const` values used during module evaluation.

UI text goes through `t(key)` / `fmt(t, key, params)`. Every key needs both a `zh` and an `en` entry in `client-src/01-locale.js`. Use `joinList` and `colon` from `06-utilities.js` instead of hard-coded Chinese punctuation.

## Adding a feature

New features plug in without editing `index.js` or the page shell:

- **Server:** create `service/<feature>.js` exporting `{ name, methods, rpc(service), tools(ctx, service, helpers), start?(ctx, service) }` and add it to [`service/features.js`](../service/features.js). `methods` are mixed into the service; a method named `jobs_<feature>(now)` returns scheduler jobs `[{ id, due(now), run() }]` that the in-process scheduler runs (see `lastDailySlot` in `service/shared.js`). Queries must go through `runQuery` so read-only admission, access policies, row-level rules, masking and audit apply.
- **Client:** create `client-src/2Nx-<feature>.js` and register UI through `extend.*` (defined in `client-src/06-utilities.js`): `adminSections` (with an optional `group`), `dashboardMenu`, `dashboardBar`, `resultMenu`, `resultPanels`, `schemaPanels`, `askPanels` and `toolViews`. `client-src/99-apply.js` must stay last: it closes the module factory.
- **Agent rules:** describe new tools in the preset rules in `cordis.patch.yml` — in the shared core (`&nl2sql-core`) unless the tool only applies to page or bot conversations. Keep tool results the model reads compact (`JSON.stringify` without indentation) and under the 16384-character pruning threshold of the presets.

Existing feature modules: `freshness` (data health), `reconcile`, `subscriptions`, `proactive` (digests, goals, forecast, alert attribution), `present` (PPT, long image, presentation mode, Bitable) and `mcp`.

## Commands

```bash
node scripts/build-client.mjs          # client-src → lib/client.js
node scripts/build-client.mjs --check  # fail if lib/client.js is stale
npm test                               # all tests
npm run test:fast                      # unit and UI tests only
npm test -- --filter security          # only files whose path contains "security"
npm test -- --verbose                  # print every test
```

## Tests

| Directory | What | Needs |
|---|---|---|
| `test/unit` | Pure modules: SQL admission, policies, filters, analysis, xlsx, adapters (with local fake HTTP / WebSocket servers) | nothing |
| `test/ui` | The page rendered in jsdom against mocked RPCs (`client-dom.test.cjs`) | nothing |
| `test/integration` | The service booted with a fake Harness context (`test/lib/harness.mjs`) against real databases | MySQL / PostgreSQL / Elasticsearch, skipped when unreachable |

The runner prefers the Harness Electron runtime (Node 24 with `node:sqlite` features the plugin uses) and falls back to the current `node`; set `NL2SQL_TEST_RUNTIME` to choose another binary. Tests use temporary directories and never touch `~/.dsh`.

Integration tests expect these local databases (see `test/lib/env.mjs`):

| Engine | Address | Credentials / database |
|---|---|---|
| MySQL | `127.0.0.1:3306` | `user` / `root`, database `testdb` |
| PostgreSQL | `127.0.0.1:5432` | `user` / `root`, database `testdb` |
| Elasticsearch | `127.0.0.1:39200` | no auth |

Known, intentionally unfixed failures are tracked in [`test/KNOWN_FAILURES.md`](../test/KNOWN_FAILURES.md).

## Data storage

- `~/.dsh/nl2sql/state.json` — configuration: data sources, dashboards, knowledge, alerts, members, channels, settings, bot conversations, identities seen by bots, dismissed knowledge suggestions (`suggestionDismissed[dsId]`). Migrations from older layouts run on load and are idempotent.
- `~/.dsh/nl2sql/results.sqlite` — query results and cache, dashboard snapshots, action tokens, and log records (history / audit, feedback, deliveries, alert events, admin log, evaluation runs, schema changes), with configurable retention.
- `~/.dsh/nl2sql/files/` — uploaded files as SQLite databases.
- Passwords and secrets — the Harness credential store, under keys `nl2sql/<datasourceId>` and `nl2sql/ch-<channelId>`.

## Knowledge suggestions (`service/suggestions.js`)

Deterministic rules, no model calls; thresholds are in `SUGGEST`. Only successful, non-cached queries are considered, filtered by the current access policy; queries with literals on sensitive columns are excluded from examples and glossary, and literals in evidence are replaced with `?`.

- **Examples:** 👍 feedback, or resolved 👎 feedback with a corrected SQL; agent queries with a title whose normalized shape (literals → `?`) repeats at least twice. Deduplicated against existing examples by normalized SQL and question similarity (≥ 0.8).
- **Metrics:** the same aggregate expression with the same non-time `WHERE` conditions in at least 3 distinct single-table queries, not already in the metric library. The name comes from a Chinese alias or the common substring of titles; time column and dimensions from usage.
- **Column notes:** `CASE WHEN` / `IN` lists / count aliases mapping enum values to labels (e.g. `SUM(CASE WHEN status = 1 …) AS 成功笔数`) in at least 2 queries, for columns without a note.
- **Glossary:** Chinese 2–6 character n-grams or upper-case words recurring in at least 3 question titles and consistently tied to a column (≥ 60 % of those queries and clearly more than in others) or a table.
- Suggestion ids are `sg-` + hash(kind + key); accepted or dismissed ids are stored in `state.suggestionDismissed[dsId]`.

## Releasing

1. Move the **Unreleased** notes in `CHANGELOG.md` into a new `## [x.y.z] - YYYY-MM-DD` section and bump `version` in `package.json`.
2. Commit, then `git tag vX.Y.Z && git push origin main --tags`.
3. The [`release` workflow](../.github/workflows/release.yml) checks that the tag matches `package.json`, runs the checks, packs, publishes to npm with provenance (trusted publishing, no token) and creates the GitHub release from the changelog section. Versions with a pre-release suffix (`-beta.1`) are published under the `next` tag.
