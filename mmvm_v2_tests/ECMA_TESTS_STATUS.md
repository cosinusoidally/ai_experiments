# Historical ECMA test bring-up

## Default-policy update

The four pathological Array/RegExp cases from the initial Node timeout list
are now skipped by default on both engines. `--include-slow` restores them.
Default full runs select 1333 files, execute 1329, and report four skips
separately from failures and not-run files. Node now has no timeout by default;
positive `--timeout-ms` enables its optional cap, and zero disables it.
The guest's existing watchdog and instruction budgets remain unchanged.

Default PASS/FAIL/elapsed output remains enabled. Node now writes these lines
synchronously so redirected/pipe output does not wait for event-loop callbacks
while the supervisor is blocked in a worker. `--quiet` and `--summary-only`
remain explicit opt-outs. Historical full-corpus results below retain their
original all-tests/no-skips policy and bounded-run settings; they have not
been silently reclassified as new default-run measurements.

### Completed uncapped Node default run

2026-11-01, approximately 16:59 UTC:
`TZ=UTC node ecma_tests_runner_node.js` (no timeout option).
**1218 passed / 111 failed / 0 timed out / 4 skipped / 0 not run**;
1333 selected files, 1329 executed; runner elapsed **139.106478 seconds**.
Default per-file PASS/FAIL/timing lines were emitted during execution.

- `ecma`: 598 passed / 22 failed / 0 skipped.
- `ecma_2`: 163 passed / 9 failed / 0 skipped.
- `ecma_3`: 203 passed / 22 failed / 4 skipped.
- `ecma_5`: 254 passed / 58 failed / 0 skipped.

The four fewer failures than the original five-second run are exactly the
four configured skips, not fixes to test expectations or VM language support.
The original failure review retains its four timeout entries as historical
results. A new full guest baseline has not been substituted for the earlier
one; guest default selection and mixed skipped/positive/negative behavior are
checked separately.

Policy validation: default Node/guest `--list` output agrees (1329 runnable,
1333 selected, four skipped); `--include-slow --list` restores 1333 runnable.
A guest mixed selection executes its positive and negative tests successfully
and reports all four skips. Explicit Node `--timeout-ms 0` passes the same
positive/negative pair. Re-enabling the four slow cases with a 50 ms explicit
Node cap reports four timeouts and zero skips, demonstrating that optional
limits still work. Fail-fast accounting keeps four configured skips separate
from one executed failure and one not-run file. No corpus or VM code changed.

## Original all-tests bounded baselines

2026-11-01, approximately 16:22--16:25 UTC. Both engines execute all
**1333 files, zero not run and zero skipped**. Timeout counts below are
subsets of failures, not additional outcomes. All source files are unchanged.

- **Standalone guest: 800 passed / 533 failed / 28 timed out / 0 not run**.
  Pass rate 60.02%; runner elapsed **552.318344 seconds**. Command:
  `TZ=UTC ./artifacts/js_runner.exe artifacts/ecma.snap ecma_tests_runner.js --verbose --timeout-ms 5000 --instruction-limit 2000000`.
  - `ecma`: 392 passed / 228 failed / 17 timed out, 620 files.
  - `ecma_2`: 146 passed / 26 failed / 0 timed out, 172 files.
  - `ecma_3`: 144 passed / 85 failed / 5 timed out, 229 files.
  - `ecma_5`: 118 passed / 194 failed / 6 timed out, 312 files.
- **Direct Node: 1218 passed / 115 failed / 4 timed out / 0 not run**.
  Pass rate 91.37%; runner elapsed **161.120027 seconds**. Command:
  `TZ=UTC node ecma_tests_runner_node.js --timeout-ms 5000`.
  Node v24.14.1 with an ordinary, non-contextified global realm.
  - `ecma`: 598 passed / 22 failed / 0 timed out, 620 files.
  - `ecma_2`: 163 passed / 9 failed / 0 timed out, 172 files.
  - `ecma_3`: 203 passed / 26 failed / 4 timed out, 229 files.
  - `ecma_5`: 254 passed / 58 failed / 0 timed out, 312 files.

The runs are serial. They have the same watchdog setting but different
resource models: the guest additionally has an instruction budget and an
inner guest-heap cap; Node has a V8 old-space limit and worker startup grace.
These are bounded bring-up observations, not unbounded compliance scores or
an interpreter speed comparison. Defaults and resource details are in
[ECMA_TESTS.md](ECMA_TESTS.md).

Cross-engine outcomes: **790 pass both**, **428 pass Node but fail guest**,
**10 pass guest but fail Node**, and **105 fail both**. Node-passing cases
give useful next targets, but source review is still required before treating
every difference as a standard ES5.1 defect. See the complete
[Node failure review](ECMA_NODE_FAILURE_REVIEW.md); no failure is waived.

## Guest gaps exposed by the new coverage

Of 533 failed files, the initial diagnostic breakdown is:

- 459 structured JavaScript/assertion failures, including standard-library
  gaps, legacy expectations and missing proprietary facilities.
- 10 failures explicitly reporting heap/storage limits (notably huge sparse
  arrays); these are not automatically proof of incorrect scalar semantics.
- 28 timeouts: 13 instruction-budget and 15 wall-clock watchdog limits.
- 36 worker terminations: **33 native exit-70 unsupported paths**, **one
  SIGSEGV**, and **two explicit early exit-0 cases with no result**. Early
  quits are not treated as passes. Some are authored shell skips, not crashes.

The SIGSEGV is `ecma_5/RegExp/exec.js`. Representative exit-70 cases include
`ecma/Date/15.9.5.2-1.js`, several Math coercion/edge-case tests,
`ecma/String/15.5.4.11-1.js`, `ecma_3/Statements/switch-001.js`, and
`ecma_5/Number/toString-radix-handling.js`. These are missing/unsupported
execution forms or stability defects, not failures of every CALL opcode.
The supervising i386 process remains working and continues the suite.

Some useful standard-library coverage subsets within `ecma_5`:

- JSON: 20 passed / 16 failed.
- Object: 10 passed / 38 failed.
- Array: 8 passed / 15 failed.
- Function: 4 passed / 8 failed.
- Strict: 19 passed / 24 failed.

This materially extends the earlier Test262 chapter selection: it exercises
Date/Math/String coercions, built-in descriptors, array algorithms, JSON,
Object operations and additional strict behavior. The initial task establishes
the baseline; it does not implement those missing VM features or proprietary
SpiderMonkey APIs.

## Scope

The original baseline executed all 1333 standalone test files in the unchanged
external `ecma`, `ecma_2`, `ecma_3` and `ecma_5` directories. Infrastructure/helper files are
handled as described in [ECMA_TESTS.md](ECMA_TESTS.md). Current defaults exclude
only the four explicitly reported cases above; `--include-slow` restores
all-test execution. This ledger measures raw coverage
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
- The complete five-second baselines are recorded above. Increasing Node's
  timeout resolved 31 earlier timeouts. Using an ordinary global fixed three
  harness artifacts: `ecma_5/Global/adding-global-var-nonextensible-error.js`,
  `ecma_5/Object/proto-property-change-writability-set.js`, and
  `ecma_5/misc/function-definition-eval.js`. These must not be mislabeled as
  Node language defects or fixed by weakening the tests. Interrupted and
  contaminated attempts are not pass-rate baselines.
- Final runner checks: Node and guest `--list` output are byte-identical for
  1333 files; a known positive plus a `-n.js` expected-exception test pass on
  both engines; `--fail-fast` on two failing files reports one executed failure
  and one not run on both. Control characters in failure messages are escaped
  for single-line readable logs. The review inventory was cross-checked against
  every one of the 115 Node failures. All workers have exited or been reaped.
