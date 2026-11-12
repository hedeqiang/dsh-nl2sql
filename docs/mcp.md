# MCP server

dsh-nl2sql can expose its governed data access to other AI tools — Claude Desktop, Cursor, Cline, VS Code (GitHub Copilot agent mode) and any other [Model Context Protocol](https://modelcontextprotocol.io/specification/) client. External models get the same guard rails as the built-in Data Q&A agent:

- every statement passes **read-only admission** (one SELECT / WITH / SHOW / EXPLAIN; writes, DDL, multiple statements and system catalogs are refused);
- **access policies** (hidden tables and columns, masked columns) and **sensitive-column masking** apply;
- each token runs as an **actor** — the local owner, an existing **member** (role, data source scope, row-level rules) or a **role + data sources** (+ optional row rule);
- the **privacy setting** "result data sent to the model" decides whether the model sees rows, per-column statistics, or only row counts;
- every call is **audited** in History with source `mcp` and the token name.

The server runs inside DeepSeek Harness, so Harness must be running while you use it.

## Enable it

1. Open **Data Q&A → 管理 / Admin → MCP 接入 / MCP access**.
2. Turn the server on. It listens on `http://127.0.0.1:47860/mcp` by default (change the port there; the server restarts automatically). It is **off by default** and never binds to other interfaces.
3. Click **New token**, give it a name and choose its scope:
   - **Local owner** — the same access as asking on the page (policies still apply);
   - **A member** — follows that member's role, data sources and row-level rules, live; disabling or deleting the member makes the token stop working;
   - **Role + data sources** — analyst / viewer / admin on the selected data sources, with an optional row rule (`column IN (values)`).
4. Copy the token — it is shown **once**. Only its SHA-256 hash is stored; if you lose it, revoke it and create a new one.

The page shows ready-to-copy snippets for the clients below, filled in with the new token.

## Claude Desktop (stdio bridge)

Claude Desktop launches local MCP servers as processes speaking stdio. The package ships a small bridge, `nl2sql-mcp` (plain Node ≥ 18, no dependencies), that relays stdio to the HTTP endpoint. Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

You can run the bridge by hand to check it: `NL2SQL_MCP_TOKEN=… npx -y -p @hedeqiang/dsh-nl2sql nl2sql-mcp`, then type `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.

| Variable | Default | Meaning |
|---|---|---|
| `NL2SQL_MCP_URL` | `http://127.0.0.1:47860/mcp` | The MCP endpoint shown in the page |
| `NL2SQL_MCP_TOKEN` | — | Bearer token (required) |
| `NL2SQL_MCP_TIMEOUT_MS` | 660000 | Per-request timeout |

## Cursor

Cursor speaks Streamable HTTP directly. Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "nl2sql": {
      "url": "http://127.0.0.1:47860/mcp",
      "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }
    }
  }
}
```

## VS Code

Add to `.vscode/mcp.json` (or the user-level MCP configuration):

```json
{
  "servers": {
    "nl2sql": {
      "type": "http",
      "url": "http://127.0.0.1:47860/mcp",
      "headers": { "Authorization": "Bearer <YOUR_TOKEN>" }
    }
  }
}
```

Cline and other clients: use the HTTP URL with an `Authorization: Bearer …` header when the client supports remote/HTTP servers, otherwise the stdio bridge command above.

## What the server offers

**Tools** (all read-only):

| Tool | What it does |
|---|---|
| `list_datasources` | Data sources this token may use, with engine and SQL dialect |
| `get_schema` | Schema overview (visible tables, column roles, relations, dialect notes, glossary, metrics) or full detail of `tables` |
| `query` | One read-only SQL statement → columns, rows / statistics / count per privacy setting, `rowCount`, `truncated`, `resultId` |
| `query_metric` | A governed metric from the metric library (grain, dimensions, range, filters) |
| `search_knowledge` | Verified question→SQL examples, glossary and metric definitions related to a question |
| `drill` | Breakdown / detail of an earlier `resultId` (row rules re-applied) |
| `explain_change` | Attribution: which dimensions explain the change between two periods of a result |
| `reconcile` | Compare two queries (e.g. the same figures from two databases) — listed when the reconcile feature is installed |
| `forecast` | Forecast a time-series result — listed when the forecast feature is installed |

Tool errors (refused SQL, row-level restrictions, unknown tables) come back as results with `isError: true` so the model can correct itself.

**Resources:** `nl2sql://datasource/{id}/schema` for every visible data source (and `nl2sql://datasource/{id}/table/{table}` for one table), as plain text.

**Prompts:** `ask_data` — a template that walks the model through list → schema → knowledge → query.

## Protocol details

- Streamable HTTP, `POST /mcp`, plain JSON responses (no SSE); `GET` / `DELETE` → `405`.
- Dual-era: the 2026-07-28 revision (stateless, per-request `_meta`, `server/discover`, header checks `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`) and the `initialize`-based revisions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 (`initialize` negotiates the version and mints an `Mcp-Session-Id`; unknown sessions → `404`). `ping`, `notifications/*` (→ `202`) and JSON-RPC batches are accepted.
- Unsupported versions get error `-32022` with the supported list.

## Security notes

- **Local only.** The server binds to `127.0.0.1`. Requests whose `Host` is not `localhost` / `127.0.0.1` / `[::1]` are refused with `403` (DNS-rebinding defence), as are requests with a non-local `Origin` header — so web pages in your browser cannot call it.
- **Tokens.** Every request needs `Authorization: Bearer <token>`; missing or unknown tokens get `401`. Tokens are 192-bit random values; only SHA-256 hashes are stored in `~/.dsh/nl2sql/state.json`, compared in constant time. Revoke a token in the page to cut a client off immediately. "Last used" is shown per token.
- **Least privilege.** Prefer member- or role-scoped tokens for tools you do not fully trust. Owner tokens can read everything the page can (still read-only and policy-filtered).
- **Data leaving the machine.** Whatever the MCP client receives is sent to *its* model provider. Use the privacy setting (Admin → Settings → Privacy, or per data source) to send only statistics (`summary`) or nothing (`none`) instead of rows.
- **Audit.** History lists every MCP query with source `mcp`, the token name and the actor; refusals are logged as `blocked`.
