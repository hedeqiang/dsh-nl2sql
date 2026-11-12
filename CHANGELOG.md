# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.12.1...HEAD
[0.12.1]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/hedeqiang/dsh-nl2sql/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/hedeqiang/dsh-nl2sql/releases/tag/v0.11.1
