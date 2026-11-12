# dsh-nl2sql · 数据问答

[DeepSeek Harness](https://github.com/deepseek-ai) 的企业级 NL2SQL 插件：连接数据库，用自然语言提问，Agent 写只读 SQL、执行并在对话中画图；结果可以固定到看板、推送到飞书 / Telegram / 企业微信 / 钉钉，还能在群里直接 @机器人提问。

[English](README.en.md)

## 功能

**问答与分析**
- 数据源：MySQL 5.7+、PostgreSQL、Elasticsearch（SQL），支持 SSH 隧道；也可以上传 CSV / Excel（存为本机 SQLite）。
- 表结构分析：识别表的角色、字段语义（时间 / 度量 / 枚举 / 敏感）、推断表间关系，提供关系图。
- 自然语言提问：在 Harness 对话中进行，Agent 使用 `nl2sql_*` 工具查询，结果在对话中渲染为 ECharts 图表或表格。
- 下钻与归因：按维度拆分、查看明细、「为什么变化」——比较两个时段并按维度贡献排序。
- 指标库与业务知识：词表、指标口径（Agent 用 `nl2sql_metric` 按口径查询）、字段备注、样例问答；支持导入导出。
- 准确率评测：用样例问答作为评测集，Agent 从零作答后与样例结果比对。

**看板与推送**
- 多看板、全局筛选（时间范围 / 维度）、拖拽排序、三档宽度、快照、Excel 导出。
- 一个看板可以放多个数据源的图表：每个图表标注所属数据源，可切换「全部数据源 / 仅当前数据源」。
- 推送大结果时注明「共 N 行，显示前 M 行」；飞书应用机器人和 Telegram 会附带完整数据 Excel。
- IM 渠道：飞书 / Lark、Telegram、企业微信、钉钉（推送 Markdown 与结果，图表按平台能力用原生图表、图片或表格）；架构见 [docs/CHANNELS.md](docs/CHANNELS.md)，新增平台只需实现一个适配器。
- 定时报告（基于 Harness 定时任务）、指标告警（阈值 / 环比 / 异常 / 无数据）、表结构变更检测。
- 群聊 @机器人提问：飞书长连接、Telegram 长轮询、企业微信智能机器人长连接、钉钉 Stream 模式，都不需要公网地址。

**安全与治理**
- 只读执行：按方言词法检查语句（MySQL / PostgreSQL / SQLite / ES），只读事务，PostgreSQL 使用扩展协议拒绝多语句，服务端超时，大结果流式截断。
- 访问控制：按表允许 / 排除、隐藏列、脱敏列；大表全表扫描保护。
- 成员与权限：飞书用户 / 群的数据源范围、只读角色（只能用指标库、已验证样例和看板）、行级权限（自动注入过滤，无法安全改写的查询直接拒绝）。
- 隐私：可设置发给模型的内容（不发 / 统计摘要 / 前 N 行），敏感字段默认脱敏；审计记录归属到具体的人。

## 安装

需要 DeepSeek Harness 0.2 及以上（桌面版或 `dsh web`）。插件已发布到 npm：[`@hedeqiang/dsh-nl2sql`](https://www.npmjs.com/package/@hedeqiang/dsh-nl2sql)。

[![npm](https://img.shields.io/npm/v/@hedeqiang/dsh-nl2sql)](https://www.npmjs.com/package/@hedeqiang/dsh-nl2sql)

**方式一：在 Harness 里添加（推荐）**

1. 打开左侧栏 **插件** → **添加插件**。
2. 输入包名 `@hedeqiang/dsh-nl2sql`（可加版本，如 `@hedeqiang/dsh-nl2sql@0.11.1`），确认安装并启用。
3. 左侧栏出现 **数据问答**，新建对话时也可以选择「数据问答」预设。

也可以直接对 Harness 的 Agent 说：「安装插件 @hedeqiang/dsh-nl2sql」。

**方式二：命令行**

```bash
dsh plugin --profile desktop add @hedeqiang/dsh-nl2sql   # 桌面版的 profile 名为 desktop；dsh web 默认为 web
```

然后在 **插件** 页启用它（或重启 Harness）。

**升级**：在 **插件** 页的插件详情中更新，或执行 `dsh plugin --profile desktop update @hedeqiang/dsh-nl2sql`，然后重新启用插件。配置和数据保存在 `~/.dsh/nl2sql`，升级不会丢失；旧版本的配置会在首次加载时自动迁移。

**卸载**：在 **插件** 页移除，或 `dsh plugin --profile desktop remove @hedeqiang/dsh-nl2sql`。卸载不会删除 `~/.dsh/nl2sql` 中的数据；不再需要时可手动删除该目录，数据库密码等凭据在 Harness 凭据库中，可在设置中清除。

> 依赖（mysql2、pg、ssh2、echarts、@resvg/resvg-js、@larksuiteoapi/node-sdk）都使用预编译包，安装时不需要运行构建脚本。

**从源码安装（开发）**

```bash
git clone https://github.com/hedeqiang/dsh-nl2sql.git && cd dsh-nl2sql
pnpm install --ignore-scripts
```

在 **插件** → **添加插件** 中填入本目录的绝对路径（以链接方式安装，改代码后重新启用插件即可生效），或让 Agent 用插件管理器安装该目录。

## 使用

1. 左侧栏打开「数据问答」→「管理 → 数据源」，添加数据库（建议使用只读账号）或上传文件。
2. 「表结构」→ 分析表结构。
3. 「问答」页提问，或在任意对话中选择「数据问答」预设直接提问。
4. 把满意的图表固定到「看板」；在「业务知识」补充词表、指标和样例，提高准确率。
5. 「管理 → 推送渠道」添加飞书机器人；「告警与报告」配置自动任务；「成员与权限」开通飞书群提问。

飞书应用机器人所需权限与长连接配置步骤见页面「成员与权限 → 飞书机器人 → 飞书开放平台配置步骤」。

## 数据与隐私

| 内容 | 位置 |
|---|---|
| 配置（数据源、看板、知识、告警、成员、设置） | `~/.dsh/nl2sql/state.json` |
| 查询结果、缓存、快照、日志（历史 / 审计 / 反馈 / 推送 / 告警） | `~/.dsh/nl2sql/results.sqlite` |
| 上传的文件 | `~/.dsh/nl2sql/files/` |
| 数据库密码、飞书密钥 | Harness 凭据库 |

发给模型的内容由「设置 → 模型可见数据」决定：默认只发表结构、枚举字段取值和查询结果的统计摘要，不发明细行。推送到飞书的内容会离开本机。

## 开发

```bash
npm test                      # 全部测试（需要 Harness 桌面版作为 Node 运行时；本机 MySQL / PostgreSQL 可选，不可用时跳过）
npm test -- --fast            # 仅单元测试和界面测试
node scripts/build-client.mjs # 修改 client-src/ 后生成 lib/client.js
node scripts/build-echarts.mjs
```

目录结构与约定见 [DEVELOPMENT.md](DEVELOPMENT.md)；隔离的准确率评测环境见 [eval/README.md](eval/README.md)。

## 已知限制

- 告警和每日表结构检查在 Harness 进程内调度：Harness 关闭期间不检查，重新打开后补查一次。
- 行级权限只对飞书成员生效；本机页面始终是所有者权限，没有登录机制。
- 行级权限下不支持子查询、CTE、UNION（会被拒绝）。
- 不支持旧版 `.xls`。

## 许可证

[MIT](LICENSE)
