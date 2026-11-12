# 隔离评测环境

在 Docker 里的合成数据上评测 Agent 回答准确率，不接触任何真实数据库。

- `01-schema.sql`：表结构（与 ledger 业务库同构，只有 DDL）。
- `02-data.sql`：脚本生成的合成数据（3 个商户、600 个用户、约 1200 条分录、充值/提现/转账/调账/收款单）。
- `knowledge.json`：评测用的业务知识（词表 11、指标 8、字段备注 6、样例问答 18）。样例问答即评测题。

## 运行

```bash
# 1. 只读 MySQL 5.7
docker run -d --name nl2sql-eval-mysql -p 127.0.0.1:43306:3306 \
  -e MYSQL_ROOT_PASSWORD=evalroot -e MYSQL_DATABASE=ledger_sim \
  -v "$PWD/eval":/docker-entrypoint-initdb.d:ro mysql:5.7 --character-set-server=utf8mb4
docker exec nl2sql-eval-mysql mysql -uroot -pevalroot -e \
  "CREATE USER 'reader'@'%' IDENTIFIED BY 'reader'; GRANT SELECT, SHOW VIEW ON ledger_sim.* TO 'reader'@'%';"

# 2. 独立的 Harness（DSH_HOME 指向临时目录，web 档案加载本插件，模型路由与桌面版相同）
DSH_HOME=/tmp/nl2sql-eval-home dsh --profile web --no-open --host 127.0.0.1 --port 47811
```

在这个独立实例的「数据问答 → 管理 → 数据源」添加 `127.0.0.1:43306 / reader / ledger_sim`，
在「业务知识 → 导入」导入 `knowledge.json`，然后在「业务知识 → 评测」选择「Agent 回答」开始评测。

## 基线（2026-11-12，模型 auto/gpt-6-sol）

| 轮次 | 通过 | 说明 |
|---|---|---|
| 1 | 17/18 | 「调增和调减各多少笔」Agent 返回一行两列（透视形态），评测比对当时不支持 → 已让比对识别透视形态 |
| 2 | 17/18 | 「收款单的金额和已退款金额」题目没说按状态，Agent 合理地只统计已支付 → 改写题目 |
| 3 | 18/18 | 全部通过，用时 162 秒（并发 2） |

SQL 回放：18/18。
