# Accuracy benchmark

An isolated benchmark that measures how accurately the agent answers business questions, using synthetic data in Docker. It never touches a real database.

| File | Contents |
|---|---|
| `01-schema.sql` | Schema of a ledger-style business database (DDL only) |
| `02-data.sql` | Generated synthetic data: 3 merchants, 600 users, ~1,200 journal entries, deposits, withdrawals, transfers, adjustments and invoices |
| `knowledge.json` | Business knowledge: 11 glossary terms, 8 metrics, 6 column notes and 18 verified question → SQL examples. The examples are the benchmark questions. |

## Run it

```bash
# 1. A MySQL 5.7 database with a read-only user
docker run -d --name nl2sql-eval-mysql -p 127.0.0.1:43306:3306 \
  -e MYSQL_ROOT_PASSWORD=evalroot -e MYSQL_DATABASE=ledger_sim \
  -v "$PWD/eval":/docker-entrypoint-initdb.d:ro mysql:5.7 --character-set-server=utf8mb4
docker exec nl2sql-eval-mysql mysql -uroot -pevalroot -e \
  "CREATE USER 'reader'@'%' IDENTIFIED BY 'reader'; GRANT SELECT, SHOW VIEW ON ledger_sim.* TO 'reader'@'%';"

# 2. A separate Harness instance (its own DSH_HOME), with this plugin installed in the "web" profile
DSH_HOME=/tmp/nl2sql-eval-home dsh --profile web --no-open --host 127.0.0.1 --port 47811
```

In that instance:

1. **Data Q&A → Manage → Data sources**: add `127.0.0.1:43306`, user `reader`, password `reader`, database `ledger_sim`.
2. **Knowledge → Import**: import `knowledge.json`.
3. **Knowledge → Evaluation**: choose **Agent answers** and start the run.

Results are compared by value, ignoring column names, column order and row order (and pivoted shapes).

## Baseline (2026-11-12, model `auto/gpt-6-sol`)

| Run | Passed | Notes |
|---|---|---|
| 1 | 17 / 18 | One answer returned a single row with two columns (pivoted); the comparison now recognises pivoted shapes. |
| 2 | 17 / 18 | One question was ambiguous (it did not say "by status"); the question was reworded. |
| 3 | **18 / 18** | All passed in 162 s (concurrency 2). |

SQL replay of the examples: 18 / 18.
