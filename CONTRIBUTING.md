# 贡献指南

感谢参与！提交前请先阅读 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 开发流程
1. `pnpm install --ignore-scripts`
2. 修改代码：
   - Host 端业务逻辑在 `service/*.js`，工具与 RPC 注册在 `index.js`。
   - 页面在 `client-src/*.js`，改完运行 `node scripts/build-client.mjs`（不要直接改 `lib/client.js`）。
3. `npm test` 必须全部通过；新功能和修复请附带测试（`test/unit`、`test/integration`、`test/ui`）。
4. 在 `CHANGELOG.md` 的「未发布」下记录改动。

## 约定
- 安全相关改动（只读检查、访问控制、权限）必须附带能复现绕过的测试用例。
- 界面文案同时提供中文和英文（`client-src/01-locale.js`），交互使用页面内提示，不使用浏览器原生弹窗。
- 不要提交真实的连接信息、密钥或业务数据；测试使用本机数据库或 `eval/` 中的合成数据。

## 提交信息
使用简短的祈使句，例如 `Fix row-level filter for aliased tables`。
