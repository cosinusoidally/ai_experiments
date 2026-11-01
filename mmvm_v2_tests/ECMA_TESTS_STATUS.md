# Historical ECMA test bring-up

## Scope

All 1333 standalone test files in the unchanged external `ecma`, `ecma_2`,
`ecma_3` and `ecma_5` directories execute. Infrastructure/helper files are
handled as described in [ECMA_TESTS.md](ECMA_TESTS.md). Extensions and slow
tests are included, not silently skipped. This ledger measures raw coverage
for the ES1--ES5.1 VM project, not a claim that every historical expectation
is standard ES5.1 behavior. No VM, C, demo or external-test source changes
are part of this bring-up.

## Initial complete control run

- 2026-11-01, approximately 15:54 UTC, Node v24.14.1, `TZ=UTC`,
  `node ecma_tests_runner_node.js --timeout-ms 1000`:
  **1184 passed / 149 failed / 0 not run**; 35 failures were timeouts.
  All 1333 files executed; runner elapsed 131.966976 seconds. Node used
  serial bounded workers, but this first run used the default contextifying
  global proxy. The subsequent baseline uses Node's ordinary realm global
  where available and a larger five-second limit; do not combine the two as
  if they were one run.
  - `ecma`: 588 passed / 32 failed / 10 timed out.
  - `ecma_2`: 163 passed / 9 failed / 0 timed out.
  - `ecma_3`: 203 passed / 26 failed / 4 timed out.
  - `ecma_5`: 230 passed / 82 failed / 21 timed out.

## Investigation notes

- The first nonisolated Node attempt hung inside native `Array.splice` on a
  length-4294967295 sparse array, despite a VM-script timeout. An external
  process watchdog now records the failure and continues. No test was removed.
- An early guest attempt created contexts without restoring intrinsics;
  an Array.prototype mutation contaminated later tests. That run was discarded.
- The guest currently has a native exit in `ecma/Date/15.9.5.2-1.js`.
  Serial fork workers now contain such failures and preserve a complete
  denominator instead of stopping at the first native exit. The known-good
  `ecma/Array/15.4.4.1.js` passes in the same smoke run; the Date native exit
  counts as failed, not as a passing negative test.
- The rebuilt generic image has SHA-256
  `5aa7f3a8f837676eaac5073e736b5e1f68c0c74b95ced3ba613e6f0419668cf0`,
  identical to the preceding performance checkpoint. The interpreter has not
  been changed to make these tests pass.
- Complete five-second guest/Node baseline runs and final source-review
  classification are in progress; their counts will be recorded only after
  completion. Interrupted/contaminated attempts are not pass-rate baselines.
