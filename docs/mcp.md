# MCP server

dsh-nl2sql can expose its governed data access to other AI tools — Claude Desktop, Claude Code, Cursor, VS Code (GitHub Copilot), Cline, Windsurf, OpenAI Codex, Gemini CLI, Zed, Continue and any other [Model Context Protocol](https://modelcontextprotocol.io/specification/) client. External models get the same guard rails as the built-in Data Q&A agent:

- every statement passes **read-only admission** (one SELECT / WITH / SHOW / EXPLAIN; writes, DDL, multiple statements and system catalogs are refused);
- **access policies** (hidden tables and columns, masked columns) and **sensitive-column masking** apply;
- each token runs as an **actor** — the local owner, an existing **member** (role, data source scope, row-level rules) or a **role + data sources** (+ optional row rule);
- the **privacy setting** "result data sent to the model" decides whether the model sees rows, per-column statistics, or only row counts — for tool results, `nl2sql://result/…` resources and dashboard runs alike;
- every call is **audited** in History with source `mcp` and the token name, and logged per token in the **call log**.

The server runs inside DeepSeek Harness, so Harness must be running while you use it.

## Enable it

1. Open **Data Q&A → 管理 / Admin → MCP 接入 / MCP access**.
2. Turn the server on. It listens on `http://127.0.0.1:47860/mcp` by default (change the port there; the server restarts automatically). It is **off by default** and never binds to other interfaces.
3. Click **测试连接 / Test connection**: the page runs `server/discover`, `tools/list` and a legacy `initialize` against the running server over loopback with a temporary in-memory credential (nothing is stored) and shows each step.
4. Click **New token**, give it a name and choose its scope:
   - **Local owner** — the same access as asking on the page (policies still apply);
   - **A member** — follows that member's role, data sources and row-level rules, live; disabling or deleting the member makes the token stop working;
   - **Role + data sources** — analyst / viewer / admin on the selected data sources, with an optional row rule (`column IN (values)`).

   Optional limits: **expiry date**, **allowed tools** (checkbox list) and a **rate limit** (requests per minute). They can be changed later with **Edit**; **Rotate secret** issues a new secret (shown once) and invalidates the old one at once.
5. Copy the token — it is shown **once**. Only its SHA-256 hash is stored; if you lose it, rotate it.

The page has a setup wizard with a tab per client below, filled in with the real URL and — while it is shown — the new token.

## Client setup

Formats were checked against each client's official documentation (November 2026). Replace `<YOUR_TOKEN>` with your token.

### Claude Desktop (stdio bridge)

[Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers): Settings → Developer → Edit Config opens `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`). Claude Desktop launches local servers as processes speaking stdio; the package ships a bridge, `nl2sql-mcp` (plain Node ≥ 18, no dependencies), that relays stdio to the HTTP endpoint:

```json
{
  "mcpServers": {
    "nl2sql": {
      "command": "npx",
      "args": ["-y", "-p", "@hedeqiang/dsh-nl2sql", "nl2sql-mcp"],
      "env": {
        "NL2SQL_MCP_URL": "http://127.0.0.1:47860/mcp",
        "NL2SQL_MCP_TOKEN": "<YOUR_TOKEN>"
      }
    }
  }
}
```

The bridge parses SSE responses incrementally and forwards `notifications/progress` / `notifications/message` to stdout before the response; on `notifications/cancelled` it closes the HTTP stream of that request (the HTTP cancellation signal). For legacy sessions it opens the standalone GET stream after `initialize` and forwards `notifications/resources/updated` / `list_changed`.

| Variable | Default | Meaning |
|---|---|---|
| `NL2SQL_MCP_URL` | `http://127.0.0.1:47860/mcp` | The MCP endpoint shown in the page |
| `NL2SQL_MCP_TOKEN` | — | Bearer token (required) |
| `NL2SQL_MCP_TIMEOUT_MS` | 660000 | Per-request timeout |

Check it by hand: `NL2SQL_MCP_TOKEN=… npx -y -p @hedeqiang/dsh-nl2sql nl2sql-mcp`, then type `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.

### Claude Code

[Claude Code MCP docs](https://code.claude.com/docs/en/mcp):

```bash
claude mcp add --transport http nl2sql http://127.0.0.1:47860/mcp \
  --header "Authorization: Bearer <YOUR_TOKEN>"

# stdio variant (bridge)
claude mcp add --transport stdio --env NL2SQL_MCP_URL=http://127.0.0.1:47860/mcp --env NL2SQL_MCP_TOKEN=<YOUR_TOKEN> nl2sql -- npx -y -p @hedeqiang/dsh-nl2sql nl2sql-mcp
```

### Cursor

[Cursor MCP docs](https://cursor.com/docs/mcp): `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{ "mcpServers": { "nl2sql": { "url": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

### VS Code

[VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) (`servers` format in `.vscode/mcp.json` or the user profile `mcp.json`):

```json
{ "servers": { "nl2sql": { "type": "http", "url": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

### Cline

[Configuring MCP servers](https://docs.cline.bot/mcp/configuring-mcp-servers): `cline_mcp_settings.json` (Cline panel → MCP Servers → Configure). Set `"type": "streamableHttp"` explicitly — omitting it means legacy SSE:

```json
{ "mcpServers": { "nl2sql": { "type": "streamableHttp", "url": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }, "disabled": false } } }
```

### Windsurf

[Windsurf Cascade MCP](https://docs.devin.ai/windsurf/plugins/cascade/mcp) (formerly docs.windsurf.com): `mcp_config.json`, remote servers use `serverUrl` (or `url`) plus `headers`:

```json
{ "mcpServers": { "nl2sql": { "serverUrl": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

### OpenAI Codex CLI

[Codex MCP docs](https://developers.openai.com/codex/mcp): `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project). `bearer_token_env_var = "NL2SQL_MCP_TOKEN"` is an alternative that keeps the token out of the file:

```toml
[mcp_servers.nl2sql]
url = "http://127.0.0.1:47860/mcp"
http_headers = { "Authorization" = "Bearer <YOUR_TOKEN>" }
```

### Gemini CLI

[Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/): `~/.gemini/settings.json` or `.gemini/settings.json`; `httpUrl` is the Streamable HTTP endpoint (`url` would mean SSE):

```json
{ "mcpServers": { "nl2sql": { "httpUrl": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

### Zed

[Zed MCP docs](https://zed.dev/docs/ai/mcp): `settings.json`:

```json
{ "context_servers": { "nl2sql": { "url": "http://127.0.0.1:47860/mcp", "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

### Continue

[Continue MCP deep dive](https://docs.continue.dev/customize/deep-dives/mcp) and [config.yaml reference](https://docs.continue.dev/reference) (`requestOptions` for `streamable-http` servers): save as `.continue/mcpServers/nl2sql.yaml`:

```yaml
name: nl2sql
version: 0.0.1
schema: v1
mcpServers:
  - name: nl2sql
    type: streamable-http
    url: http://127.0.0.1:47860/mcp
    requestOptions:
      headers:
        Authorization: Bearer <YOUR_TOKEN>
```

## What the server offers

**Tools** (all read-only; annotations `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, `idempotentHint` true except where a call creates a new result id; each has an `outputSchema` and returns `structuredContent` plus the JSON as text; results that produce a `resultId` add a `resource_link` to `nl2sql://result/{resultId}`):

| Tool | What it does |
|---|---|
| `list_datasources` | Data sources this token may use, with engine and SQL dialect |
| `get_schema` | Schema overview (visible tables, column roles, relations, dialect notes, glossary, metrics) or full detail of `tables` |
| `query` | One read-only SQL statement → columns, rows / statistics / count per privacy setting, `rowCount`, `truncated`, `resultId` |
| `query_metric` | A governed metric from the metric library (grain, dimensions, range, filters) |
| `list_metrics` | The metric library of a data source (expression, table, filter, time column, unit, dimensions, synonyms) |
| `search_knowledge` | Verified question→SQL examples, glossary and metric definitions related to a question |
| `drill` | Breakdown / detail of an earlier `resultId` (row rules re-applied) |
| `explain_change` | Attribution: which dimensions explain the change between two periods of a result |
| `list_dashboards` | Dashboards with the widgets on data sources in scope, and their filters |
| `run_dashboard` | Run a dashboard's widgets (governed SQL, so viewer tokens may use it) with optional global filters; per-widget results per privacy (max 12 widgets per call) |
| `explain_sql` | Dry run: admission, policy and row-rule checks plus the EXPLAIN plan, full scans and whether the scan guard would refuse — no rows |
| `data_freshness` | Latest timestamp, lag and stale status per table — listed when the freshness feature is installed |
| `reconcile` | Compare two queries (e.g. the same figures from two databases) — listed when the reconcile feature is installed |
| `forecast` | Forecast a time-series result — listed when the forecast feature is installed |

Tool errors (refused SQL, row-level restrictions, unknown tables) come back as results with `isError: true` so the model can correct itself.

**Resources** (`resources/list` is paginated; `resources/templates/list` lists the templates):

| URI | Content |
|---|---|
| `nl2sql://datasource/{id}/schema` | Schema overview (text) |
| `nl2sql://datasource/{id}/table/{table}` | One table in full (text) |
| `nl2sql://datasource/{id}/knowledge` | Glossary, metrics, verified examples (only those touching visible tables) and notes of visible tables / columns (JSON) |
| `nl2sql://datasource/{id}/metrics` | Metric definitions (JSON) |
| `nl2sql://datasource/{id}/freshness` | Freshness per table (JSON; when the freshness feature is installed) |
| `nl2sql://dashboards`, `nl2sql://dashboard/{id}` | Dashboards and widget definitions (titles, data source, chart type — not SQL, not data) |
| `nl2sql://result/{resultId}` | A query result as `text/csv`: with privacy `rows` the first `modelRows` rows (≤ 500, ≤ 256 KB); with `summary` / `none` only the column list and a `# privacy=…` note — never rows. Row-ruled tokens can only read results filtered by their own rules |

**Prompts:** `ask_data` (question), `analyze_table` (datasource, table), `compare_periods` (metric, period day/week/month), `reconcile_sources` (left, right descriptions).

**Completion** (`completion/complete`): data source names (`datasource`) and ids (`id` of the resource templates), table names of a data source (`table`, using `context.arguments.datasource` / `id`; policy-hidden tables are never suggested), metric names and synonyms (`metric`), and `period`. Only data sources in the token's scope are suggested.

## Streaming, progress, cancellation, notifications

- **SSE responses.** A `tools/call` POST whose `Accept` lists `text/event-stream` and that carries `_meta.progressToken` (or asked for log messages) gets a request-scoped SSE stream (`X-Accel-Buffering: no`): `notifications/progress` with increasing `progress` and messages `admitted → running query → fetched rows (n) → formatting` (reconcile: per left / right side; run_dashboard: per widget), any `notifications/message`, then the final response, after which the stream closes. `:` comment heartbeats every 15 s. Everything else stays plain JSON.
- **Cancellation.** 2026-07-28: closing the response stream cancels the request. Legacy revisions: `notifications/cancelled` with the request id (same token and session). Either way the running MySQL statement is stopped (`KILL QUERY` on the server, the pooled connection is dropped), no response is sent, History records the query as `cancelled` and the call log as `cancelled`. Other engines: the result is dropped and audited `cancelled` once the driver returns (or times out).
- **Resource notifications.** A cheap watcher (every 5 s, only while someone listens) compares data source ids, dashboards, `schemaAnalyzedAt` and a knowledge fingerprint: adding / removing a data source or dashboard sends `notifications/resources/list_changed`; re-analysis sends `notifications/resources/updated` for the schema (and subscribed table) resources; knowledge edits for the knowledge / metrics resources.
  - 2026-07-28: `subscriptions/listen` (POST, SSE) with `notifications: { resourcesListChanged, resourceSubscriptions: [uris] }`. The server acknowledges first (`notifications/subscriptions/acknowledged`, only the supported / visible subset), tags every notification with `io.modelcontextprotocol/subscriptionId` and, when it ends the subscription (shutdown, token revoked), sends the completion result before closing. `toolsListChanged` / `promptsListChanged` are not acknowledged (those lists are static).
  - Legacy: `resources/subscribe` / `resources/unsubscribe` per `Mcp-Session-Id`; notifications arrive on the session's standalone `GET /mcp` SSE stream. `DELETE /mcp` ends the session.
- **Logging.** Warnings go out as `notifications/message` (logger `nl2sql`): truncated results (`warning`), stale data from `data_freshness` (`warning`), privacy redaction / row caps / masked columns (`notice`). Legacy: after `logging/setLevel` on the session. 2026-07-28: only for requests with `_meta["io.modelcontextprotocol/logLevel"]` (the feature is deprecated in that revision but still defined). Never without a level.
- **Pagination.** `tools/list`, `resources/list`, `resources/templates/list` and `prompts/list` return opaque `nextCursor`s; invalid cursors → `-32602`.

## Capability matrix per revision

| Feature | 2024-11-05 | 2025-03-26 | 2025-06-18 | 2025-11-25 | 2026-07-28 |
|---|---|---|---|---|---|
| Handshake | `initialize` + `Mcp-Session-Id` | same | same | same | none; `server/discover`, per-request `_meta` |
| Tool annotations | — | ✓ | ✓ | ✓ | ✓ |
| `title`, `outputSchema`, `structuredContent`, `resource_link` | — | — | ✓ | ✓ | ✓ |
| JSON-RPC batches | — | ✓ | — (accepted for compatibility) | — | — |
| Completion | — | ✓ | ✓ (+ `context.arguments`) | ✓ | ✓ |
| Progress + logs on request SSE | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancellation | `notifications/cancelled` | same | same | same | close the stream (stdio bridge: `notifications/cancelled`) |
| Resource updates | `resources/subscribe` + GET stream | same | same | same | `subscriptions/listen` |
| Log level | `logging/setLevel` | same | same | same | `_meta` `io.modelcontextprotocol/logLevel` (deprecated) |
| Resource not found | `-32002` | `-32002` | `-32002` | `-32002` | `-32602` |
| `ping` | ✓ | ✓ | ✓ | ✓ | removed (still answered) |

Clients that send no version information are answered with the latest legacy shapes (additive fields only). The 2024-11-05 HTTP+SSE transport (separate `endpoint` event) is not offered; such clients can use the stdio bridge.

## Protocol details

- Streamable HTTP, `POST /mcp`; `GET` (SSE stream) and `DELETE` only for legacy sessions, otherwise `405`.
- Dual-era: 2026-07-28 (stateless, per-request `_meta`, `server/discover`, header checks `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` → `-32020`, `Mcp-Session-Id` ignored) and the `initialize`-based revisions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (`initialize` negotiates the version and mints an `Mcp-Session-Id`; unknown sessions → `404`). Unsupported versions get `-32022` with the supported list; invalid `logLevel` → `-32602`.

Specification pages used: [specification](https://modelcontextprotocol.io/specification/2026-07-28), [changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog), [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/changelog), [2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/changelog); [Streamable HTTP (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [transports (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports); [subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions), [progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress), [cancellation (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation), [cancellation (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation); [resources (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/server/resources), [resources (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/server/resources); [tools (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [tools (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/server/tools); [prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts); [completion](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion); [logging (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging), [logging (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging); [pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination); [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover); [base protocol / error codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index).

## Security notes

- **Local only.** The server binds to `127.0.0.1`. Requests whose `Host` is not `localhost` / `127.0.0.1` / `[::1]` are refused with `403` (DNS-rebinding defence), as are requests with a non-local `Origin` header — so web pages in your browser cannot call it.
- **Tokens.** Every request needs `Authorization: Bearer <token>`; missing or unknown tokens get `401`. Tokens are 192-bit random values; only SHA-256 hashes are stored in `~/.dsh/nl2sql/state.json`, compared in constant time. Revoke a token to cut a client off immediately (its sessions, streams and in-flight calls end too); **rotate** to replace a leaked secret while keeping scope and limits. "Last used" is shown per token.
- **Expiry.** A token past its `expiresAt` gets `401` with `token "…" expired at …` and `WWW-Authenticate: Bearer error="invalid_token"`. Extend it with Edit.
- **Least privilege.** Prefer member- or role-scoped tokens for tools you do not fully trust, and narrow them with a **tool allowlist** (`tools/list` only lists allowed tools; `tools/call` of others → `-32602`). Owner tokens can read everything the page can (still read-only and policy-filtered).
- **Rate limits.** A per-token limit (requests per minute, sliding window) answers `429` with `Retry-After` once exceeded.
- **Data leaving the machine.** Whatever the MCP client receives is sent to *its* model provider. Use the privacy setting (Admin → Settings → Privacy, or per data source) to send only statistics (`summary`) or nothing (`none`) instead of rows; the `nl2sql://result/…` CSV follows the same setting.
- **Audit.** History lists every MCP query with source `mcp`, the token name and the actor; refusals are logged as `blocked`, cancellations as `cancelled`. The per-token **call log** (Admin → MCP access, RPC `mcpCallLog`) keeps time, method / tool, data source, duration, status (`ok` / `error` / `cancelled` / `rate-limited`) and row count — never result rows; SQL is cut at 2000 characters. It is retained like other logs (5000 entries).
