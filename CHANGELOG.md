# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.3] - 2026-11-13

### Changed
- **Bot reply cards read like a report:** a one-row result with period pairs (上周X / 前周X, 本月X / 上月X, current_/previous_ …) is shown as a comparison table (指标 / 上周 / 前周 / 变化) with change columns matched to their metric; numbers use thousands separators instead of 万 / 亿 in messages; percent columns show `%` and a sign; technical column suffixes (`_pct`, `_U`) become readable labels.
- The bot's instructions now ask for a one-sentence conclusion, at most three points, consistent number formats and readable column names, and not to repeat the result table in the text.

### Fixed
- A card-action test raced with the delivery record (test only).

## [0.15.2] - 2026-11-13

### Added
- **Re-analyze selected tables:** on the Schema page, "Re-analyze selected tables" turns the table list into checkboxes, and each table's menu has "Re-analyze this table". Only those tables' columns, indexes, row estimates and value samples are refreshed; every other table keeps its previous analysis, and relations are recomputed over the merged schema. Requires one full analysis first (`analyzeSchema { tables }`).

## [0.15.1] - 2026-11-13

### Changed
- Removed the "how permissions combine" option from group question permissions: a registered person in a group always gets the stricter of their own and the group's permissions (intersection of data sources, lower role, both sets of row rules), so personal limits cannot be bypassed in a group.

## [0.15.0] - 2026-11-13

### Added
- **Who can ask in a group:** each registered group chat can set who may ask the bot — everyone in the group, registered members only, or listed members only — plus a blocked list; how a person's own scope combines with the group's (stricter of the two, or the group decides); rate limits per person per minute and per group per hour; no full-data Excel attachments; read-only mode (everyone asks as a viewer). Configure per group in **Members & access**, or follow the default in **Settings → Channels & bots**. New groups default to "registered members only"; groups registered earlier keep "everyone in the group". The member list shows each group's policy.

## [0.14.9] - 2026-11-13

### Security
- IM bot conversations can no longer push data to other channels: `nl2sql_send` is refused in bot sessions (listing channels still works) and the attempt is recorded in the admin log. Answers are replied in the chat they were asked in; pushing stays available from the Harness page and page conversations.

## [0.14.8] - 2026-11-13

### Fixed
- Two messages arriving at the same time in a chat that predates channel grouping could split into two sessions, so the second message lost the conversation context. They now share the new grouped session. (0.14.7 was published with this failing test.)

## [0.14.7] - 2026-11-13

### Changed
- **Bot conversations are grouped by channel in the Harness sidebar:** each IM channel gets its own workspace group (e.g. "飞书 · AlchemyPay-Bot") instead of "Ungrouped". Existing chats continue in a new session inside the group on their next message (older sessions stay where they are). An explicit bot working directory (`settings.botCwd`) still takes precedence.

## [0.14.6] - 2026-11-13

### Changed
- **IM bot replies carry no buttons** ("split by dimension", "why did it change", "details", "pin to dashboard"): replies show the conclusion and data only; follow-up analysis happens in Harness conversations. The Lark app bot no longer needs the `card.action.trigger` callback. Clicks on buttons of cards sent by earlier versions still work (re-authorized as before).

## [0.14.5] - 2026-11-13

### Changed
- **Data health settings** are laid out like the Settings page: two groups (Data freshness, Data quality patrol) with switches and one explanation per row; a group's fields are hidden while it is off. With freshness off, its table and events are no longer shown on the Data health page either — just a note and the switch.

## [0.14.4] - 2026-11-13

### Added
- Data freshness can be switched off, or hidden from the page only (**Manage → Data health → Settings**). When off, nothing is shown under results or in Schema, no scheduled checks run and the agent's `nl2sql_freshness` tool reports that it is off; "hide on page" keeps checks and notifications but removes the warning bars and the Schema panel. The Data health page keeps showing the data either way.

## [0.14.3] - 2026-11-13

### Changed
- **Cleaner bot reply cards:** intermediate queries the agent marks with `show: false`, and empty results when the answer has non-empty ones, are no longer shown (an empty probe of the wrong table read like "no such order").
- **Buttons only where they help:** results looking up one order / id / hash, single rows and empty results get no "split by dimension", "details" or "pin to dashboard" buttons.
- **Single records as field lists:** one-row results are shown as one "field: value" per line, with long identifiers in full (no truncation, no 万 / 亿 abbreviation of order numbers).
- **Codes with meanings:** status / type codes are shown as `10（处理中）` when the column comment (e.g. `0=新建，10=处理中，11=交易失败`) or a knowledge column note defines them — in IM cards and tables.

## [0.14.2] - 2026-11-13

### Fixed
- A column named just `token` was always masked, but in crypto / payment databases it is the currency (USDT, BTC…). It is now masked only in credential tables (sessions, oauth, api keys…) or when its comment says it is a credential; credential names such as `access_token`, `api_token` and `token_hash` are still masked. Mask any other column explicitly with the data source's access policy.
- `tel`, `mail` and `mobile` no longer match inside other words (`whitelist_status`, `hotel`, `telegram_id`, `mailbox`).
- Cached schema analyses are re-classified with the new rules on load (no re-analysis needed), and cached query results masked under the old rules are not reused.

## [0.14.1] - 2026-11-13

### Fixed
- Charts, the ER graph and forecast charts were blurry on Retina / HiDPI screens: ECharts runs in a sandboxed chunk without access to the real `window`, so it rendered at 1×. Charts now render at the screen's device pixel ratio (re-rendering when it changes, e.g. moving to another monitor or zooming), and PNG export uses at least 2×.

## [0.14.0] - 2026-11-13

### Added
- **MCP streaming and progress:** long tool calls stream over SSE with `notifications/progress` (admitted → running → rows fetched → formatting); the stdio bridge forwards them.
- **MCP cancellation:** `notifications/cancelled` (or closing the stream on 2026-07-28) stops the request; MySQL queries are killed server-side, other engines drop the result; the audit records `cancelled`.
- **MCP resources:** knowledge, metrics, data freshness, dashboards and query results (privacy-aware CSV); subscriptions with `resources/updated` and `list_changed` notifications; cursor pagination.
- **MCP tools:** annotations, `outputSchema` with structured content and `resource_link` items; new `list_metrics`, `list_dashboards`, `run_dashboard`, `data_freshness`, `explain_sql`.
- **MCP prompts and completion:** `analyze_table`, `compare_periods`, `reconcile_sources`; argument completion for data sources, tables, metrics and periods, scoped to the token; log notifications for truncation, stale data and redaction.
- **Tokens:** expiry, tool allowlists, rate limits (429 with Retry-After), secret rotation and a per-token call log.
- **Admin page:** setup guides for Claude Desktop, Claude Code, Cursor, VS Code, Cline, Windsurf, Codex CLI, Gemini CLI, Zed and Continue; a connection self-test; token editor; call log.
- Query history shows cancelled queries.

## [0.13.1] - 2026-11-12

### Fixed
- `npx -p @hedeqiang/dsh-nl2sql nl2sql-mcp` warned about an unsupported Node version: `engines.node` is now `>=18` (the bridge's requirement; the plugin itself runs on the Node bundled with DeepSeek Harness).

## [0.13.0] - 2026-11-12

### Added
- **Data health:** per-table freshness (latest timestamp, lag, thresholds), the `nl2sql_freshness` tool and stale-data warnings under results and in the schema view, notifications when a table stops updating and when it recovers; a daily data-quality patrol (null rates, duplicate keys, outliers, future timestamps, negative amounts) with a health score and a push when it drops.
- **Reconciliation:** the `nl2sql_reconcile` tool and saved daily jobs that compare two queries on two data sources by key (tolerances, normalisation), with match rate, rows missing on either side, value differences, run history and pushes with the full differences as Excel.
- **Chat subscriptions:** `nl2sql_subscribe`, `nl2sql_alert_create` and `nl2sql_subscriptions` create, list, pause and cancel scheduled results and alerts delivered to the chat they were created in, running with the creator's permissions at delivery time.
- **Data finds people:** daily digests of notable metric changes with their main contributors, automatic attribution in alert messages, metric goals with progress and projection on dashboards, and time-series forecasts (`nl2sql_forecast`, result menu).
- **Presentation:** PowerPoint and long-image export for dashboards and results, sending the long image to Lark / Telegram, presentation mode, and scheduled sync of results to Lark Bitable.
- **MCP server:** a local Model Context Protocol endpoint with per-client tokens mapped to owner, member or role scopes, plus the `nl2sql-mcp` stdio bridge for Claude Desktop ([docs/mcp.md](docs/mcp.md)).
- The **Manage** navigation groups sections into core, *Insight & automation* and *Integrations*.

### Changed
- Internal: feature modules plug in through `service/features.js` (RPCs, tools, scheduler jobs) and client extension points (`extend.*`); `runQuery` accepts a per-call `maxRows` up to 200,000.

These features are tested with local databases and fake IM / Lark servers; real Lark, Telegram, WeCom, DingTalk and MCP clients have not been exercised yet.

## [0.12.2] - 2026-11-12

### Security
- Row-level rules could be bypassed with MySQL `--` arithmetic (e.g. `WHERE 1--1) OR (1`): the filter injector now uses the dialect-aware lexer and refuses any rewrite where the injected rule is not a top-level conjunct.
- The SQL guard followed JavaScript's notion of whitespace after `--`; it now follows MySQL exactly, and SQL containing control characters or non-ASCII whitespace outside literals is refused (closed table-policy and system-catalog bypasses).
- `nl2sql_overview` ran its queries without the caller's row-level rules; it now runs as the caller.
- A result filtered for one member could be reused (re-charted, drilled, sent) by a member with different row-level rules; results now carry a signature of the rules applied.
- The bot's data source catalog listed tables hidden by the access policy.
- Data values could inject mentions (`<at id=all>`) or links into Lark cards and other IM messages; data-derived text is now escaped per platform.

### Fixed
- Previewing an alert while another alert was saved could delete saved alerts; an alert edited during a check lost its state and re-fired every minute.
- Bot commands matched any question starting with words such as 自动, 数据源, 切换 or help; commands must now be the whole message. English aliases: `help`, `sources`, `switch <name>`, `auto`, `new`.
- Bots no longer change the page's current data source when they switch sources.
- Deleting a channel left alerts, the schema-change notice, scheduled reports and bot conversations pointing at it.
- Sending failed for titles longer than 100 characters; NULL numbers showed as 0; line breaks inside cells broke tables; changing a channel's type asked for unchanged secrets again; Excel sheet names with emoji could exceed Excel's limit; daily alerts handled daylight-saving transitions wrongly.
- New file data sources had the description "上传的文件：undefined".
- Page: the knowledge editor could save into another data source after switching; the Ask page briefly offered the previous data source's questions; dialogs and toasts did not appear inside conversation tool views; free-text dashboard filters could not take a comma; double clicks created duplicate widgets, alerts and knowledge items; unsaved settings were lost without warning; several actions failed silently; number formatting showed 0 for empty values and `10000万` / `1000K`; history labels for Telegram / WeCom / DingTalk bots; dates follow the UI language.
- Accessibility: focus stays inside dialogs; policy rows work with the keyboard; Chinese punctuation no longer appears in the English UI.

## [0.12.1] - 2026-11-12

### Fixed
- History & audit: the per-row delete button overlapped the row count and duration columns; it now has its own column.

## [0.12.0] - 2026-11-12

### Added
- One-click member adding: people and groups that talked to a bot, and the groups a bot is in, are offered in the member form with their ids, names and emails filled in. People and groups refused because they are not members yet are listed at the top of **Members & access**.
- Bots know the member's data sources: every question carries a catalog of the sources the member may use (type, database, description, main tables); the agent switches to the matching source and states which one it used. A source named in the question, or one whose business knowledge matches, is selected automatically.
- Bot commands: `数据源` lists sources with descriptions, `切换 <name>` pins a source (fuzzy match), `自动` returns to automatic selection. The reply footer shows the source actually used.

### Changed
- README rewritten in English (Chinese in `README.zh-CN.md`) with screenshots, security model and installation from npm; added a Code of Conduct, issue and pull request templates, and an English development guide (`docs/development.md`). `docs/CHANNELS.md` moved to `docs/channels.md`.
- List separators and label colons in the page follow the UI language.

## [0.11.2] - 2026-11-12

### Added
- Dashboards show each chart's data source (and flag deleted sources); a dashboard that mixes sources lists them and can be scoped to *All sources* or *Only the current source* (remembered per browser). Reordering while scoped keeps hidden charts in place.
- Large results in IM messages: messages say how many rows are shown (Lark cards up to 50 rows with paging, Telegram 20, WeCom and DingTalk 10). Lark app bots and Telegram attach the full data as an Excel file (`attachFull`, on by default); a failed attachment does not fail the message and is noted in the delivery log.

### Changed
- README installation instructions now use npm (**Plugins → Add plugin** or `dsh plugin add`), with upgrade, uninstall and from-source steps.

## [0.11.1] - 2026-11-12

### Added
- Release workflow: pushing a `v*` tag checks, packs and publishes to npm with trusted publishing and provenance, and creates the GitHub release.

### Fixed
- Channel catalog text, suggested questions and number units showed in English in the Chinese UI (the UI read the wrong field of the Harness locale snapshot).

## [0.11.0] - 2026-11-12

### Added
- Channel adapter architecture (`channels/`): a platform-neutral message model, capability declarations, form schemas and a bot interface ([docs/channels.md](docs/channels.md)).
- Telegram (push, long-polling bot, inline buttons), WeCom (group webhook push; AI bot over the long connection) and DingTalk (custom robot push; internal app robot over Stream mode). These adapters are tested against local fakes only.
- Multi-platform member identities; one bot per channel, several bots at once.
- Redesigned pages: channels grouped by platform with a two-step add dialog, a bots overview, an identities editor, and a *Channels & bots* settings group.
- Ask page: shuffle suggested questions, delete single history entries, show more recent questions.

### Changed
- Existing Lark channels, bot settings, member fields and settings are migrated on first load; old RPCs and payloads keep working.

## [0.10.0] - 2026-11-12

### Added
- Interactive buttons on Lark answer cards: break down by a dimension, why did it change, details, pin to dashboard (via the long connection, re-authorized per click).
- Knowledge suggestions mined from 👍 feedback, repeated queries, common aggregates and value mappings, accepted by a person.
- Open-source groundwork: MIT license, README, contributing guide, security policy, CI.

### Fixed
- Business columns such as `token_code` are no longer treated as sensitive.
- Evaluation recognises the same numbers in pivoted shapes (one row with many columns vs. many rows).

## [0.9.0] - 2026-11-12

### Changed
- Page reorganised into five tabs plus a **Manage** area; grouped settings with descriptions, unsaved-changes bar, reset to defaults and configuration export / import.
- Onboarding checklist; suggested and recent questions on the Ask page.
- Dashboard drag-to-reorder, three widths, refresh and cache status; in-page dialogs instead of browser pop-ups; complete English UI.
- Chunked uploads; streamed truncation of large MySQL / PostgreSQL results; relevant-table selection for large schemas; configurable log retention.

## [0.8.0] - 2026-11-12

### Added
- Viewer role, row-level rules, scheduler catch-up and status, logs stored in SQLite, `service/` and `client-src/` split, test suite.

### Security
- Per-dialect lexing for read-only admission (fixes writes through PostgreSQL), access-control bypasses, Lark member data source scopes, mismatched Lark answers.

## [0.7.0] - 2026-11-11

### Added
- Metric alerts, Lark @-mention bot, drill-down and attribution, accuracy evaluation, schema change detection, metric tool, multiple dashboards, Excel export, CSV / Excel upload, persisted results and cache, knowledge import / export, members, permissions and audit.

## [0.6.0] and earlier

- Redesigned UI; Lark push (Markdown and native charts); access control, feedback loop, dashboard global filters; PostgreSQL / Elasticsearch, SSH tunnels, privacy settings, automatic overviews, scheduled reports; semantic layer, ER graph, scan guard, history and audit, dashboards; first version.

[Unreleased]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.15.3...HEAD
[0.15.3]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.15.2...v0.15.3
[0.15.2]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.9...v0.15.0
[0.14.9]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.8...v0.14.9
[0.14.8]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.7...v0.14.8
[0.14.7]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.6...v0.14.7
[0.14.6]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.5...v0.14.6
[0.14.5]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.4...v0.14.5
[0.14.4]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.3...v0.14.4
[0.14.3]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.2...v0.14.3
[0.14.2]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/hedeqiang/dsh-nl2sql/releases/tag/v0.11.1
