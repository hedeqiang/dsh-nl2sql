# Known failures

Genuine bugs in plugin source that a test exposes but that are not fixed yet. Each entry is
marked as an expected failure so the suite stays green while the issue stays visible:

- a single test: `test.xfail(name, reason, fn)` from `test/lib/assert.mjs` (reported as `xfail`;
  reported as `XPASS` once the bug is fixed — then remove the marker and the entry here);
- a whole file: add `'<path relative to test/>': '<reason>'` to `EXPECTED_FAILURES` in `test/run.mjs`.

## Current entries

None. The last full run (2026-11-12) passed all 222 tests. 2 tests were skipped because
Elasticsearch was not running.

## Notes (test-environment changes, not source bugs)

- The scratch tests `svc4.mjs` and `svc5.mjs` used a PostgreSQL schema called `nl2sql_demo`. That schema no longer
  exists in `testdb`. The ported tests create and drop their own schema `nl2sql_test_<pid>_<ts>`
  (`createPgFixture()` in `test/lib/env.mjs`).
- The dashboard filter bar no longer shows the visible text "全局筛选". The text survives only as the
  `aria-label` of `.n2s-filterbar`, so the UI test now checks the bar's DOM structure.
