# Historical ECMA test bring-up

## VM parity work: built-in initialization

2026-11-01: the repeated uncapped Node control remains **1218 passed / 111
failed / 0 timed out / 4 skipped / 0 not run**, in **130.489515 seconds**.
The parity target is the set of Node-passing files, not merely the same total
pass count. ES5.1 semantics take precedence over modern Node differences and
historical SpiderMonkey extensions; the external corpus remains unchanged.

The first runtime changes address shared initialization rather than adding
test-specific execution paths:

- Standard native function formal lengths have explicit ES5.1 metadata,
  separate from the native interpreter's minimum supported argument counts
  and the embedding callback's implementation signature.
- Built-in constructor `prototype` properties are immutable and
  non-enumerable. Prototype `constructor` properties and static methods use
  the ordinary writable/configurable, non-enumerable built-in attributes.
- String, Number and Boolean prototypes carry the same internal primitive
  value slot as their respective wrappers. Date.prototype carries NaN.
- Date, Math, Object, JSON and Error method installation consistently uses
  built-in property attributes instead of ordinary assignment attributes.

These changes leave dispatch, object lookup, allocation and GC algorithms
unchanged. Frozen before/after images are compared serially with identical
default limits (10-second watchdog, 20 million instructions):

- Before: **811 passed / 518 failed / 10 timed out / 4 skipped / 0 not run**,
  569.218517 seconds; 1333 selected, 1329 executed.
- Initialization candidate: **868 passed / 461 failed / 32 timed out / 4
  skipped / 0 not run**, 767.432632 seconds; the same selection.
- **57 new passes, zero lost passes**, checked by filename. Node-only passes
  decrease from **417 to 366**; the candidate passes 852 files also passed by
  Node and 16 files failed by Node. This is progress, not parity.
- For the **811 files passing in both guest images**, summed per-file time
  is **279.830 seconds before / 272.572 seconds after**. One pair is not
  statistically conclusive, but does not show a common-work slowdown.
- The 22 additional timeouts are all descriptor-combination tests under
  `ecma_5/Object/15.2.3.6`: eight dictionary-redefinition, eight
  middle-redefinition, four redefinition, function-length and new-definition.
  They formerly stopped at an early assertion (whose error formatting then
  referenced missing `uneval`); they now get farther and reach the unchanged
  watchdog. Their failure classifications and total runtime increase are
  retained, not hidden by a timeout/skip-policy change.

The first project regression gate also caught portable Date construction
writing an internal slot through ordinary assignment. The slot now uses the
internal-value accessor for construction and setters. The small internal
two-runtime isolation fixture uses fixed 64 KiB heaps instead of 32 KiB to
fit the new standard descriptors; its isolation checks and fixed-capacity
behavior are unchanged. No production or benchmark heap ceiling is raised.
The full candidate counts above precede that portable Date-write follow-up;
subsequent regression gates are recorded separately.

Follow-up checks on the Date-write correction:

- Node and js_min project runners pass: 12 guest programs / 270 assertions
  each, compiler/embedding checks, unchanged server/demo CLI entry points,
  and three-context multiplexing.
- Structural GC stress passes on both hosts: 27 audits, 110018 checked edges,
  221 property-index audits and 74 embedding collections each. Maximum
  observed bumps are 3530056 / 3530496 bytes under the unchanged 8 MiB cap.
- The final standalone image passes 24 GC workload rounds / 48 native
  collections. Node construction of that image takes 8.00 seconds wall.
- Full standalone Test262 passes **3292 / 3292**, with zero failures,
  timeouts or not-run files: **424.389549 seconds** runner elapsed versus
  430.384625 seconds at the preceding checkpoint. These are single runs.
- Cross-host snapshot gate passes: program/environment-independent js_min
  images, identical Node output and a genuine self-hosted byte-identical
  rebuild. The complete serial gate takes 289.90 seconds; this includes
  multiple builds and is not an individual build-time measurement.
- Eight paired stock Octane workloads pass on both frozen images, serially.
  Scores before / after: Richards **101 / 102**, DeltaBlue **95.4 / 96.1**,
  RayTrace **248 / 252**, NavierStokes **273 / 271**, Box2D **364 / 367**,
  Gameboy **1061 / 1063**, TypeScript **1315 / 1309**, Mandreel **492 / 491**.
  TypeScript wall time is 108.23 / 108.46 seconds; Mandreel 107.38 / 107.60.
  These matched observations show no clear regression, not proof of a
  speedup or a new measurement of the remaining Octane suites. Command:
  `node octane_compare.js --reference-snapshot artifacts/ecma-before.snap --snapshot artifacts/ecma-final.snap --include Richards,DeltaBlue,RayTrace,NavierStokes,Box2D,Gameboy,Typescript,Mandreel --output artifacts/ecma-initialization-octane --timeout 600`.
  Snapshot bytes increase from 6686024 to 6719976 (33952 bytes, about 0.51%).
- Live unchanged demos1--7 render at 320x240, emit multiple FPS samples,
  have their window captures inspected and close cleanly through X11 input.
  Demo8 passes attract, garage, mouse dragging, free-drive auto pilot and
  manual acceleration/steering, then menu quit. Steady sampled rates are
  19.8--20.0 FPS in the garage and 19.5--20.1 in free drive; a transition
  sample is 16.9. These are bounded smoke checks, not long GC soaks.
- Both unchanged HTTP programs pass localhost directory listing, exact text
  and PNG binary comparisons, automatic index.html selection, HEAD length
  and missing-file 404 checks. All demo/server processes exit or are stopped.
  Captures, fixtures and raw logs remain ignored artifacts, not tracked data.

Next architectural step: separate guest-written standard-library bootstrap
from the Node-compatible embedding. Currently `GuestNodeEnvironment` installs
the owned Array/RegExp/String/Number algorithms, whereas a bare embedded VM
does not. Provide one VM installation API with an explicit source-reader
callback, use it from both embeddings, and install once before preparing
isolated test contexts. This must not introduce a Node dependency into the VM
or a second implementation of the algorithms. Then use the new corpus to
drive generic descriptor, coercion and sparse-array support, preserving the
existing native fast paths rather than replacing them with test-specific
behavior. Per-file pass preservation remains a regression gate.

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
