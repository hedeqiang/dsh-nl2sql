# Channel architecture

A **channel** is one configured connection to an IM platform. Every platform is an
**adapter** module under `channels/`; the service core (`service/channels.js`,
`service/bots.js`) only talks to the adapter interface, never to a platform API.

```
channels/
  index.js        registry: list/get adapters, shared types and helpers
  message.js      platform-neutral message model + Markdown utilities + chart PNG
  http.js         fetch with timeout, JSON helpers, ChannelError
  lark.js         Lark / Feishu   (webhook bot, app bot; long connection; card buttons)
  telegram.js     Telegram        (Bot API; long polling; inline keyboard)
  wecom.js        WeCom 企业微信   (group webhook bot; AI bot long connection)
  dingtalk.js     DingTalk 钉钉    (custom robot webhook; enterprise app robot over Stream)
```

## Message model (platform neutral)

Producers (agent `nl2sql_send`, dashboards, reports, alerts, schema notices,
bot answers) build one `OutboundMessage`; each adapter renders it natively.

```js
OutboundMessage = {
  title: string,
  text?: string,                 // Markdown (CommonMark subset + <font color='green|red|grey'>, <at id=all></at>)
  results?: ResultBlock[],       // ≤ 10
  footer?: string,
  includeSql?: boolean,
  chartMode?: 'native' | 'image' | 'table',
  mentionAll?: boolean,
  template?: 'blue' | 'red' | 'green' | 'orange' | 'grey',  // accent; adapters may ignore
}
ResultBlock = { title, columns:[{name,kind}], rows, rowCount, truncated, chart, sql?, filters?, error?,
                actions?: ActionSpec }          // interactive controls, only when the target supports them
ActionSpec  = { buttons?: [{ text, value }], select?: { placeholder, value, options:[{ text, value }] } }
               // value objects are opaque tokens: { a, t } — never trusted on receipt
```

## Adapter interface

```js
export default {
  id: 'telegram',                       // platform id
  name: { zh: 'Telegram', en: 'Telegram' },
  kinds: [ChannelKind, ...],            // what a user can configure for this platform
  // Optional inbound bot (one per configured channel of a bot-capable kind):
  createBot?(channel, secrets, handlers, opts) -> Bot,
}

ChannelKind = {
  id: 'telegram_bot',                   // stored as channel.type (legacy: lark_webhook, lark_app)
  platform: 'telegram',
  label: { zh, en }, description: { zh, en },
  // Form schema rendered generically by the UI:
  fields: [{ key, label:{zh,en}, type:'text'|'secret'|'select'|'url', required?, placeholder?, help?:{zh,en},
             options?:[{value,label:{zh,en}}], pattern?: string, secret?: boolean, showIf?: { key, equals } }],
  capabilities: {
    push: true,
    markdown: 'full' | 'basic' | 'none',
    charts: 'native' | 'image' | 'none',        // native card charts vs PNG upload vs tables only
    tables: 'native' | 'markdown' | 'text',
    buttons: boolean,                          // interactive buttons on pushed/bot messages
    bot: boolean,                              // inbound questions (no public URL needed)
    listTargets: boolean,                      // can list chats/groups the bot is in
    mentionAll: boolean,
    maxMessageBytes?: number,
  },
  setupSteps: { zh: string[], en: string[] },  // shown in the UI; console paths, permissions
  validate(input, existing) -> { config, secrets }   // throws ChannelError with a user message
  send(channel, secrets, message, ctx) -> { messageId?, images }  // ctx: { renderChartPng, logger, fetch }
  test?(channel, secrets) -> { ok, detail }       // cheap auth check (token fetch / getMe)
  listTargets?(channel, secrets) -> [{ id, name, type }]
}

Bot = {
  start(), stop(), status() -> { state:'idle'|'connecting'|'connected'|'error'|'stopped', error?, since? },
  info() -> { name?, id? } | null,
}
handlers = {
  onMessage(InboundMessage) -> Promise<void>,
  onAction?(InboundAction) -> Promise<{ toast?: { type:'info'|'success'|'error', content } }>,
}
InboundMessage = {
  platform, channelId, messageId, chatId, chatType: 'p2p' | 'group', text,       // mention markup stripped
  mentionedBot: boolean, sender: { id, name?, email?, unionId? }, raw?,
  reply(OutboundMessage) -> Promise<{ messageId? }>,     // threaded reply when supported
  replyText(text) -> Promise<void>,
  react?(kind: 'working'|'done'|'failed') -> Promise<void>,
}
InboundAction = { platform, channelId, operator: { id }, chatId, messageId, value, option?, raw?,
                  reply(OutboundMessage) -> Promise<{ messageId? }> }
```

Errors: adapters throw `ChannelError(code, message)` with a Chinese user-facing
message and a stable code such as `channel/auth`, `channel/config`,
`channel/network`, `channel/rate-limit`, `channel/rejected`.

## Identities (members)

Members carry platform-scoped identities instead of Lark-only fields:

```js
user = { id, kind: 'person' | 'chat', name, role, datasourceIds, rowRules, disabled, note,
         identities: [{ platform: 'lark'|'telegram'|'wecom'|'dingtalk', id, email? }] }
```

Legacy fields migrate on load: `larkOpenId → { platform:'lark', id }`,
`larkChatId → { platform:'lark', id }`, `email` stays and also matches any
platform that reports an email. `resolveActor({ platform, userId, email, name,
chatId, chatType })` replaces `resolveLarkActor` (kept as a thin alias).

Settings: `botDefaultRole` / `botDefaultDatasourceIds` replace
`larkDefaultRole` / `larkDefaultDatasourceIds` (read both; write the new keys).

## Bots

Bot configuration lives on the channel: `channel.bot = { enabled, allowP2p,
sessionScope: 'chat'|'user' }`. Every enabled bot channel runs its adapter's
`createBot`; `service/bots.js` owns lifecycle, the per-conversation queue, the
agent turn (`runAgentTurn`), actor resolution, card actions (opaque tokens,
rate limit, re-authorization), delivery log and audit. Conversations are keyed
`<channelId>:<chatId>[:<userId>]`.

Legacy `state.larkBot = { enabled, channelId, allowP2p, sessionScope }`
migrates to `channel.bot` on the referenced channel.

## Platform notes

| Platform | Push | Bot without public URL | Buttons | Charts |
|---|---|---|---|---|
| Lark / Feishu | webhook bot; app bot (chat / user / email) | long connection (`im.message.receive_v1`, `card.action.trigger`) | yes | native card charts / PNG |
| Telegram | Bot API `sendMessage` / `sendPhoto` to chat ids | long polling `getUpdates` | inline keyboard (`callback_query`) | PNG (`sendPhoto`) |
| WeCom 企业微信 | group robot webhook (markdown, image base64+md5) | AI bot long connection (`wss://openws.work.weixin.qq.com`, bot id + secret) | template card buttons where supported, else none | PNG via webhook image |
| DingTalk 钉钉 | custom robot webhook (+ HMAC sign) | enterprise app robot over Stream (`/v1.0/im/bot/messages/get`), reply via `sessionWebhook` | ActionCard links only | PNG not uploadable via webhook → tables |

Only verified behaviour should be claimed in the UI; anything tested against
fakes only is labelled in `CHANGELOG.md`.

## Page RPC contract (UI ↔ host)

Existing RPC names keep working (`listChannels`, `saveChannel`, `deleteChannel`,
`testChannel`, `listChannelChats`, `sendToChannel`, `sendDashboard`,
`larkBotStatus`, `saveLarkBot`, `restartLarkBot`, `listDeliveries`). New:

- `channelCatalog()` → `[{ platform, name:{zh,en}, kinds:[{ id, label, description, fields, capabilities, setupSteps }] }]`
  (secrets fields marked `secret: true`; never any value).
- `listChannels()` → `[{ id, name, type, platform, description, isDefault, chartMode, config: {non-secret fields},
  secretsSet: { <secretKey>: true }, needsSecret?, lastSentAt?, lastError?,
  capabilities, bot?: { enabled, allowP2p, sessionScope, status:{state,error?}, info? } }]`
- `saveChannel({ id?, name, type, description?, isDefault?, chartMode?, config: {...}, secrets: {...only changed...}, bot?: {...} })`
  — legacy flat payloads (`webhookUrl`, `appId`, `appSecret`, `receiveId`…) are still accepted for Lark.
- `listChannelTargets({ id? , type?, config?, secrets? })` → `[{ id, name, type }]` (unsaved credentials allowed; nothing stored).
- `testChannel({ id })` → `{ ok, detail }` (sends a test message where the platform has no cheap auth check).
- `botStatus()` → `[{ channelId, channelName, platform, enabled, status, info, conversations: [...] }]`
- `saveBot({ channelId, enabled?, allowP2p?, sessionScope? })` → bot status for that channel; `restartBot({ channelId })`.
- `listUsers` / `saveUser` use `identities: [{ platform, id, email? }]`; legacy `larkOpenId` / `larkChatId` / `email` accepted.
- `getSettings` exposes `botDefaultRole`; `larkDefaultRole` is still returned as an alias.
