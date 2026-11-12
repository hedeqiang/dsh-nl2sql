# nl2sql 插件开发说明

## 目录结构

| 路径 | 内容 |
|---|---|
| `index.js` | Host 入口：组装服务、注册 Agent 工具与页面 RPC（`/api/nl2sql.rpc`） |
| `service/shared.js` | 公共常量、工具函数、`Records`（日志型数据存储） |
| `service/datasources.js` | 设置、数据源、会话绑定、驱动池 |
| `service/access.js` | 成员（多平台身份 `identities`）、角色、数据源范围、行级权限、`resolveActor` 身份解析 |
| `service/schema.js` | 表结构分析、变更检测、业务知识及导入导出 |
| `service/query.js` | 查询执行（只读检查、访问控制、行级过滤、缓存、脱敏）、指标、下钻归因、Excel 导出 |
| `service/dashboards.js` | 多看板、全局筛选、自动概览、定时报告 |
| `service/channels.js` | IM 渠道（按适配器校验、密钥 `nl2sql/ch-<id>`、列表、测试、推送、推送记录），见 `docs/CHANNELS.md` |
| `service/bots.js` | IM 机器人：每个启用机器人的渠道运行适配器的 `createBot`；收消息 → 会话 → 按轮次取回答案 → 回复；回答上的交互按钮（拆分 / 为什么变化 / 明细 / 固定到看板）只带不透明令牌（SQLite `action_tokens`，7 天过期），点击者重新鉴权 |
| `service/push.js` | 发送助手回复 / 看板、看板快照、结果反馈 |
| `service/evaluation.js` | 准确率评测 |
| `service/alerts.js` | 告警与调度器（含表结构每日检查） |
| `service/uploads.js` | CSV / Excel 上传到本地 SQLite（服务端暂存 `uploads/<uploadId>`，1 小时过期，支持分片） |
| `service/admin.js` | 存储统计、日志保留与清理、配置导出/导入、关于、提问建议、新手引导 |
| `service/suggestions.js` | 从查询历史和反馈中挖掘候选知识（样例/指标/备注/词表），人工采纳或忽略 |
| `sql-guard.js` | 只读 SQL 准入（按方言词法：MySQL / PostgreSQL / SQLite / ES） |
| `policy.js` | 访问控制（表、隐藏列、脱敏列） |
| `filters.js` / `analysis.js` | 筛选注入；指标、下钻、归因、告警判断、结果比对 |
| `drivers.js` / `sqlite-driver.js` | 数据库驱动 |
| `store.js` | SQLite：查询结果、缓存、快照、日志记录（`results.sqlite`） |
| `channels/index.js` | 渠道适配器注册表与目录（`registerAdapter` / `kindOf` / `listCatalog`） |
| `channels/http.js` / `channels/message.js` | 带超时的请求与 `ChannelError`；与平台无关的消息工具（图表 PNG、Markdown 表格、去除 `<font>`/`<at>`） |
| `channels/lark.js` | 飞书适配器：卡片、Webhook / 应用推送、长连接机器人 |
| `channels/telegram.js` / `wecom.js` / `dingtalk.js` | Telegram / 企业微信 / 钉钉适配器 |
| `im.js` / `lark-bot.js` | 兼容旧导入路径的转发模块（实现在 `channels/lark.js`） |
| `xlsx.js` | Excel/CSV 读写 |
| `client-src/*.js` | 页面源码（按功能拆分），**编辑这里** |
| `lib/client.js` | 由 `client-src` 拼接生成的浏览器模块，**不要直接编辑** |

`client-src` 的各文件是同一个模块工厂函数体的连续片段（共享作用域），按文件名顺序拼接。

## 常用命令（在插件目录执行）

```bash
node scripts/build-client.mjs          # client-src → lib/client.js
npm test                               # 全部测试（需要本机 MySQL / PostgreSQL，不可用时自动跳过）
npm test -- --fast                     # 只跑单元测试和界面测试
npm test -- --filter security          # 按文件名过滤
```

测试使用临时目录，不会触碰 `~/.dsh`。`test/unit/client-build.test.mjs` 会检查 `lib/client.js` 是否与 `client-src` 一致。

## 数据存储

- `~/.dsh/nl2sql/state.json`：配置类数据（数据源、看板、知识、告警、成员、渠道、设置等；`suggestionDismissed[dsId]` 记录已采纳/忽略的知识建议 ID）。
- `~/.dsh/nl2sql/results.sqlite`：查询结果与缓存、看板快照、以及日志类数据（查询历史/审计、反馈、推送记录、告警记录、管理日志、评测记录、表结构变更）。旧版本 `state.json` 中的这些数组在首次加载时自动迁移。
- 密码、密钥：Harness 凭据库。

## 知识建议（`service/suggestions.js`）

确定性规则（不调用模型），阈值见 `SUGGEST`：只看成功的、未命中缓存的查询，先按访问控制过滤（`checkAccess` + 可见表结构）；涉及敏感列取值的查询不进入样例/词表，证据中的字面量会被替换为 `?`。

- 样例：👍 反馈、或已解决且带修正 SQL 的 👎 反馈；助手（source=agent、有标题）执行的同结构查询（字面量 → `?`）≥ 2 次时取最近一次。按规范化 SQL 和问题相似度（≥ 0.8）与现有样例去重。
- 指标：单表查询中相同聚合表达式 + 相同非时间 WHERE 条件出现在 ≥ 3 条不同查询里，且指标库中没有同口径；名称取中文别名或标题公共子串，时间列取最常用的时间列，维度取 GROUP BY 列。
- 字段备注：CASE WHEN / IN 列表 / 计数别名（如 `SUM(CASE WHEN status=1 …) AS 成功笔数`）把枚举字段取值映射为中文含义，≥ 2 条查询且该字段还没有备注。
- 业务词：问题标题中的中文 n-gram（2–6 字）/ 大写英文词，出现在 ≥ 3 个不同标题中、对应查询稳定使用某字段（≥ 60% 且明显高于其他问题）或某张表，且不在词表/指标中。
- 建议 ID 为 `sg-` + hash(kind+key)，采纳或忽略后写入 `state.suggestionDismissed[dsId]`。
