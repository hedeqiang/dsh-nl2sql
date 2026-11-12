# nl2sql 插件开发说明

## 目录结构

| 路径 | 内容 |
|---|---|
| `index.js` | Host 入口：组装服务、注册 Agent 工具与页面 RPC（`/api/nl2sql.rpc`） |
| `service/shared.js` | 公共常量、工具函数、`Records`（日志型数据存储） |
| `service/datasources.js` | 设置、数据源、会话绑定、驱动池 |
| `service/access.js` | 成员、角色、数据源范围、行级权限、飞书身份解析 |
| `service/schema.js` | 表结构分析、变更检测、业务知识及导入导出 |
| `service/query.js` | 查询执行（只读检查、访问控制、行级过滤、缓存、脱敏）、指标、下钻归因、Excel 导出 |
| `service/dashboards.js` | 多看板、全局筛选、自动概览、定时报告 |
| `service/push.js` | 飞书推送渠道、推送记录、结果反馈 |
| `service/lark.js` | 飞书机器人：收消息 → 会话 → 按轮次取回答案 → 回复卡片 |
| `service/evaluation.js` | 准确率评测 |
| `service/alerts.js` | 告警与调度器（含表结构每日检查） |
| `service/uploads.js` | CSV / Excel 上传到本地 SQLite（服务端暂存 `uploads/<uploadId>`，1 小时过期，支持分片） |
| `service/admin.js` | 存储统计、日志保留与清理、配置导出/导入、关于、提问建议、新手引导 |
| `sql-guard.js` | 只读 SQL 准入（按方言词法：MySQL / PostgreSQL / SQLite / ES） |
| `policy.js` | 访问控制（表、隐藏列、脱敏列） |
| `filters.js` / `analysis.js` | 筛选注入；指标、下钻、归因、告警判断、结果比对 |
| `drivers.js` / `sqlite-driver.js` | 数据库驱动 |
| `store.js` | SQLite：查询结果、缓存、快照、日志记录（`results.sqlite`） |
| `im.js` / `lark-bot.js` / `xlsx.js` | 飞书卡片与推送、飞书长连接、Excel/CSV 读写 |
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

- `~/.dsh/nl2sql/state.json`：配置类数据（数据源、看板、知识、告警、成员、渠道、设置等）。
- `~/.dsh/nl2sql/results.sqlite`：查询结果与缓存、看板快照、以及日志类数据（查询历史/审计、反馈、推送记录、告警记录、管理日志、评测记录、表结构变更）。旧版本 `state.json` 中的这些数组在首次加载时自动迁移。
- 密码、密钥：Harness 凭据库。
