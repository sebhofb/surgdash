# Tests

Every suite is a plain Node script: it loads the real app modules into a `vm` context with a
fake `document`, `Storage`, `electronAPI` (and a fake LearnWorlds API or Google Sheets where
needed), then prints `PASS`/`FAIL` lines and a final `N/M passed`. No test framework, no
dependencies, no network, nothing touched on disk outside a temp folder.

- `npm test` — the fixture-based suites in `test/*.test.js` (this is what GitHub runs on every push).
- `npm run test:live` — also `test/live/*.test.js`, which read the SURGdash data folder on this
  Mac (`SURGDASH_DATA` or `~/Library/Application Support/surgdash/data`) and are skipped when it
  is absent. Their assertions are about shapes and invariants, not about this week's numbers.
- `node test/run.js sheets` — only suites whose file name contains "sheets".

`test/fixtures/google-apps-script-v2.js` is the previous Apps Script (per-row writers, no
fingerprints, no sync key): the batched writers in the current script are compared against it
cell for cell, and the client's legacy protocol is exercised against it.
