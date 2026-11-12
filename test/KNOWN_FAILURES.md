# Known failures

Genuine bugs that a test exposes but that are not fixed yet. Each entry is marked as an expected failure so the suite stays green while the issue stays visible:

- a single test: `test.xfail(name, reason, fn)` from `test/lib/assert.mjs` (reported as `xfail`; reported as `XPASS` once the bug is fixed — then remove the marker and the entry here);
- a whole file: add `'<path relative to test/>': '<reason>'` to `EXPECTED_FAILURES` in `test/run.mjs`.

## Current entries

None.

## Test environment notes

- PostgreSQL tests create and drop their own schema `nl2sql_test_<pid>_<ts>` (`createPgFixture()` in `test/lib/env.mjs`).
- Elasticsearch tests are skipped when `127.0.0.1:39200` is not reachable.
