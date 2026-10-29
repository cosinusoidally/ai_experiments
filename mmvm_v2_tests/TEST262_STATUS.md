# Test262 status

This is the chronological ledger for ECMAScript 5.1 Test262 work. The corpus
is read from `../../js_tests/tests/test262` and is never modified. Counts in
completed full-suite results are recorded only after every selected variant
reaches a pass, failure, or timeout result; interrupted and focused runs appear
in the investigation log and are not used to claim progress.

Each current run reports `passed`, `failed`, and `not run` as mutually
exclusive outcomes, with their sum equal to the applicable variant total.
Timeouts are included in `failed` and also shown as a diagnostic subset. A
normal unfiltered complete run is valid only when `not run` is zero. There are
no conformance skips: unsupported ES5.1 behavior fails until implemented.

Negative-metadata correction (2026-10-28): previous notes describing the
strict `Math.PI` assignment test as a corpus erratum were mistaken. This
import's plain `@negative NotEarlyError` pattern expects that sentinel;
`@negative ^((?!NotEarlyError).)*$` excludes it. The wrapper had incorrectly
rejected the sentinel in both cases. The corrected interpretation preserves
ES5.1 semantics, executes the original tests unchanged and needs no corpus
exception. Historical counts below retain the old wrapper's results; new
results identify harness corrections separately from VM semantic fixes.

As of 2026-09-13 the runner follows this historical corpus's authored-program
model: every file runs once as written, except that `@onlyStrict` directs the
harness to prepend a strict prologue. Earlier 5,765-variant measurements below
were useful VM diagnostics, but synthesized strict copies of every unannotated
file and are therefore not Test262 conformance totals. They remain in the
chronological ledger rather than being rewritten or silently discarded.

## Result history

- 2026-10-28, general frontend/property-lookup checkpoint: focused authored
  selection `ch09/9.5 ch11/11.6 ch11/11.7` completed all 165 tests with
  164 passed, 1 failed, 0 not run and 0 timed out. An isolated copy of starting
  revision `5327ff5` produced exactly the same counts and failure ID:
  `ch11/11.6/11.6.1/S11.6.1_A3.2_T2.3.js` (boxed String plus undefined).
  Current run: 47.78 seconds / 200,896 KiB peak RSS; starting revision:
  47.05 seconds / 201,648 KiB. This is a focused no-regression check, not a
  new full-suite conformance total or a claimed speedup. Commands used the
  documented `js_min.exe guest_runner.js --vm-native test262_runner.js
  --quiet` shape with the three selectors and the library path exported.
  Raw logs remain ignored under `artifacts/general-checkpoint-test262-baseline.log`
  and `artifacts/mandreel-batch-test262.log`.

- 2026-10-23, after precise register-use analysis/temporary coalescing
  (`b723791` plus named value-cell writer cleanup): focused selection
  `ch09/9.5 ch11/11.6 ch11/11.7`, 165 files/variants executed, 153 passed,
  12 failed, 0 not run, 0 timed out. Failure IDs and variants exactly match
  the preceding checkpoint. Elapsed 42.81 seconds; peak RSS 209,780 KiB.
  Run: `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet
  ch09/9.5 ch11/11.6 ch11/11.7`, with the documented library path exported.
  Raw log: ignored `artifacts/zlib-final-test262.log`. This is a focused
  regression comparison, not a replacement for the whole-suite totals.

- 2026-10-22 evening, zlib/interpreter optimization checkpoint `c73aa0a`:
  focused authored selection `ch09/9.5 ch11/11.6 ch11/11.7` completed all
  165 tests: 153 passed, 12 failed, 0 not run, 0 timed out. These are the
  same counts as the earlier baseline for this selection; no full-suite
  conformance improvement is claimed. Run log is the ignored artifact
  `artifacts/zlib-loop-state-test262.log`. Both-host regression suites also
  passed (12 guest programs, 269 assertions per host).

Results are grouped by identical selection so that movement in the pass and
failure counts is directly comparable. The intended progression within each
group is toward zero failures; a smaller selection is never presented as an
improvement over a larger one.

### Standalone js_runner — 3,292 authored tests

- 2026-10-29, approximately 07:37 UTC, contract-71 lexical-scope and
  permanent arguments-detachment checkpoint:
  **3,292 executed, 3,286 passed, 6 failed, 0 not run; all 6 failures are
  instruction-limit timeouts**. Pass rate **99.82%**; **zero non-timeout
  failures remain**. Same command/20,000-instruction diagnostic limit as the
  preceding run, using `artifacts/es51-scopes.snap`. Elapsed **354.71 seconds**,
  user CPU **347.00 seconds**, peak RSS **549,676 KiB**; exit status 1 because
  the timeouts remain failures, not skips. Exact ID/variant comparison with
  contract 70 shows **9 new passes, zero new failures**. Every test is executed
  unchanged; no corpus exceptions or new wrapper reclassifications are used.
  Chapters 6 and 9–13 pass completely. The remaining six IDs are listed below.
  Raw log: `artifacts/es51-scopes-full.log`. Final-image regression gates are
  recorded separately after completion.

Remaining diagnostic-budget timeouts (executed, not skipped):

- `ch07/7.4/S7.4_A5.js`
- `ch07/7.4/S7.4_A6.js`
- `ch07/7.8/7.8.5/S7.8.5_A1.1_T2.js`
- `ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js`
- `ch07/7.8/7.8.5/S7.8.5_A2.1_T2.js`
- `ch07/7.8/7.8.5/S7.8.5_A2.4_T2.js`

- 2026-10-29, approximately 00:27 UTC, contract-70 operator/prototype and
  inherited-enumeration checkpoint:
  **3,292 executed, 3,277 passed, 15 failed, 0 not run; 6 instruction-limit
  timeouts included in failures**. Pass rate **99.54%**; **9 non-timeout
  failures remain**. Command: `./artifacts/js_runner.exe
  artifacts/es51-enumeration.snap test262_runner.js --instruction-limit 20000`.
  Elapsed **335.34 seconds**, user CPU **328.94 seconds**, peak RSS **549,644
  KiB**; exit status 1. Exact failing-ID/variant comparison with contract 68
  shows **15 new passes and zero new failures**. The remaining semantic
  failures are eight catch-binding/scope cases and one permanent arguments
  parameter-map detachment case. Chapters 9–11 now pass completely.
  Remaining chapter totals: **7: 6; 9: 0; 10: 0; 11: 0; 12: 7; 13: 2**.
  Raw log: `artifacts/es51-enumeration-full.log`. Both Node project checks
  (12 programs / 270 assertions) and bounded GC stress pass. A system reboot
  occurred after the contract-68 run; the faster total is not by itself a
  controlled interpreter-throughput speedup claim. Focused checks of the
  original 24 non-timeout failures progressed through 8/16, 13/11 and 15/9
  pass/fail outcomes, each with zero not run/timeouts. No external source or
  negative metadata expectation changed in this batch.
- 2026-10-28, approximately 23:51 UTC, contract-68 restricted accessors and
  arguments instantiation:
  **3,292 executed, 3,262 passed, 30 failed, 0 not run; 6 instruction-limit
  timeouts included in failures**. Pass rate **99.09%**; **24 non-timeout
  failures remain**. Command: `./artifacts/js_runner.exe
  artifacts/es51-restricted-final.snap test262_runner.js --instruction-limit
  20000`. Elapsed **417.71 seconds**, user CPU **414.60 seconds**, peak RSS
  **549,752 KiB**; exit status 1. Exact failure-ID/variant comparison with
  contract 67 shows **35 new passes and zero new failures**, all VM changes
  with no wrapper reclassification in this run. Chapter 10 is now all passing.
  Remaining chapter totals: **7: 6; 9: 4; 10: 0; 11: 4; 12: 9; 13: 7**.
  Raw log: `artifacts/es51-restricted-full.log`. An earlier focused run of
  the 59 non-timeout failures passed 33 and failed 26; subsequent formal
  arguments-parameter fixes account for the other two new passes.
  The Node project suite passes all 12 programs / 270 assertions. The
  formatter module being prepared separately is not loaded by this image.
- 2026-10-28, approximately 23:31 UTC, contract-67 function descriptors,
  lexical-this/hoisting and negative-pattern checkpoint:
  **3,292 executed, 3,227 passed, 65 failed, 0 not run; 6 instruction-limit
  timeouts included in failures**. Pass rate **98.03%**; **59 non-timeout
  failures remain**. Command: `./artifacts/js_runner.exe
  artifacts/es51-checkpoint.snap test262_runner.js --instruction-limit 20000`.
  All original files execute unchanged. Exact failing-ID/variant comparison
  with the fresh baseline shows **48 new passes and zero new failures**:
  45 VM fixes and three positive `NotEarlyError` pattern classifications.
  Remaining chapter totals: **7: 6; 9: 4; 10: 10; 11: 4; 12: 9; 13: 32**.
  The six chapter-7 timeouts remain counted, not skipped or silently accepted.
  Elapsed approximately **460 seconds**, based on output-file creation and
  final-write timestamps; CPU time and peak RSS were not captured for this
  run. Do not present sampled RSS as a measured peak. The same-session fresh
  baseline completed **3,179 passed / 113 failed / 0 not run / 6 timeouts** in
  approximately **445 seconds**, measured the same way. Extra completed test
  bodies and measurement variability prevent these individual runs from
  establishing interpreter-throughput parity. Raw logs:
  `artifacts/es51-checkpoint-full.log`, `artifacts/es51-baseline-tests.log`.
  Earlier focused selections of the 107 non-timeout baseline failures
  progressed from **12 passed / 95 failed** to **42 passed / 65 failed**, both
  with zero not run/timeouts. Those selections are diagnostics, not separate
  whole-suite totals. Design: `ES51_SEMANTICS_PROGRESS.md`.
  Checkpoint revision `ec3347f` also passes both complete host project suites
  (270 guest assertions each), all ten prior standalone Octane quick
  selections, GC stress (24 rounds / 47 collections), live demos 1–8 with
  demo8 garage/auto-pilot, both HTTP servers, and three-way byte-identical
  Node/js_min/genuine self-hosted snapshots. The tests and demos are unchanged.
- 2026-10-28, approximately 21:51 UTC, protected-edge cleanup checkpoint:
  **3,292 executed, 3,179 passed, 113 failed, 0 not run; 6 timeouts included
  in failures**. Pass rate **96.57%**. Command:
  `./artifacts/js_runner.exe artifacts/unwind-recheck.snap test262_runner.js
  --instruction-limit 20000`. Elapsed **431.43 seconds**, user CPU **423.77
  seconds**, peak RSS **549,496 KiB**; exit status 1. Exact failing-ID/variant
  comparison against `ec5e517` shows **11 new passes and zero new failures**.
  The final optimized compiler has the same failure IDs as its initial
  protected-edge implementation (3179/113/0 in 414.29 seconds). The initial
  run was before a reboot; these times alone do not isolate throughput changes.
  Raw final log: `artifacts/unwind-final-test262.log`.
  All eleven new passes are chapter-12 try/finally abrupt-exit cases:
  `S12.14_A9_T2/T3/T5`, `A10_T2/T3/T5`, `A11_T2/T3`, `A12_T2/T3`, and `A15`.
  Cleanup is emitted by the shared compiler, not a test-specific runtime path.
  Remaining failures by chapter: **7: 6; 9: 7; 10: 10; 11: 8; 12: 42;
  13: 40**. Chapter 12 has 24 with-scope, eight loop/hoisting/enumeration,
  and ten try/catch/finally failures. Catch lexical environments remain work.
  The imported corpus is unchanged; no test is skipped or marked passing
  without execution. See `ES51_SEMANTICS_PROGRESS.md` for design/build gates.
- 2026-10-28, approximately 22:05 UTC, same-boot performance control using
  the unchanged `ec5e517` image:
  **3,292 executed, 3,168 passed, 124 failed, 0 not run; 6 timeouts included
  in failures**. Command: `./artifacts/js_runner.exe
  artifacts/completion-final-node.snap test262_runner.js --instruction-limit
  20000`. Elapsed **415.19 seconds**, user CPU **412.49 seconds**, peak RSS
  **549,608 KiB**; exit status 1. Failure IDs exactly match the original
  checkpoint; none of the changed image's eleven new passes is an incidental
  baseline change. Raw log: `artifacts/unwind-control-test262.log`.
  The changed image's 431.43-second run is 3.9% longer elapsed / 2.7% more
  user CPU in this single pair, with essentially unchanged peak RSS. Record
  this as a suite-time difference requiring further measurement, not a
  demonstrated speedup or proven performance parity. This control is an
  intentionally older image, not a regression in the checked-in source.
- 2026-10-28, approximately 16:37 UTC, efficient statement-completion/early-error
  checkpoint `ec5e517`:
  **3,292 executed, 3,168 passed, 124 failed, 0 not run; 6 timeouts included
  in failures**. Pass rate **96.23%**. Command:
  `./artifacts/js_runner.exe artifacts/completion-final-node.snap
  test262_runner.js --instruction-limit 20000`. Elapsed **396.74 seconds**,
  user CPU **394.80 seconds**, peak RSS **549,476 KiB**; exit status 1.
  The fresh serial baseline at `4ea036a` completed with **3,139 passed /
  153 failed / 0 not run / 6 timeouts**, in **403.81 seconds**, user CPU
  **401.31 seconds**, peak RSS **549,396 KiB**. Exact failing-ID/variant
  comparison shows **29 newly passing tests and zero new failures**.
  These single-run measurements show no throughput or RSS regression in this
  inventory; they do not establish a statistically significant speedup or
  parity with V8 jitless. Logs remain ignored under
  `artifacts/completion-baseline-test262.log` and
  `artifacts/completion-final-test262.log`.
  The 29 new passes are five switch cases, thirteen loop/enumeration/eval
  completion cases, one strict try/eval case, and all ten top-level-return
  negative tests. No tests were suppressed or changed. See
  `ES51_SEMANTICS_PROGRESS.md` for the shared frontend design and build gates.
  Remaining failures by chapter: **7: 6; 9: 7; 10: 10; 11: 8; 12: 53;
  13: 40**. Chapter 12 now has 24 with-scope, eight loop/hoisting/enumeration,
  and 21 try/catch/finally failures; no switch or top-level-return failures
  remain in this inventory.
  Build and workload gates also passed: three-way byte-identical snapshots;
  Node/js_min/self-hosted build times 6.35/90.40/111.39 seconds versus fresh
  baselines 6.57/95.01/120.72 seconds; both project suites (270 assertions
  each); all ten previously working standalone Octane quick runs; GC stress
  (24 rounds / 47 native collections); live demos 1–8, including demo8 garage
  and auto-pilot; and HTTP text/binary/directory-listing checks. No new
  language micro-test files, generated files or external corpus changes were
  needed. These single-run build timings are not statistical speedup claims.
- 2026-10-28, approximately 15:13 UTC, final contract-66 image, revision `572c2d6`:
  **3,292 executed, 3,139 passed, 153 failed, 0 not run; 6 timeouts included
  in failures**. Pass rate **95.35%**. Command:
  `./artifacts/js_runner.exe artifacts/test262-codeunit-node.snap
  test262_runner.js --instruction-limit 20000`. Elapsed **361.85 seconds**
  (6m 1.85s), user CPU **355.65 seconds**, peak RSS **549,516 KiB**
  (536.64 MiB). The process correctly returned **exit status 1** for the
  failing suite, after reporting every test and tearing down the test runtime.
  Sorted failing IDs and strict/sloppy variants exactly match both the prior
  standalone full run and the fresh hosted comparison below: **zero new
  failures, zero lost tests**. Elapsed time is essentially unchanged from the
  362.20-second standalone bring-up run; these are single-run observations,
  not a statistical speedup claim. Raw log: ignored
  `artifacts/test262-codeunit-full.log`.
- 2026-10-28, guest-executed embedding bring-up, executable contract 65:
  **3,292 executed, 3,139 passed, 153 failed, 0 not run; 6 timeouts included
  in failures**. Pass rate: **95.35%**. Command:
  `./artifacts/js_runner.exe artifacts/test262-errors.snap test262_runner.js
  --instruction-limit 20000`. Elapsed **362.20 seconds** (6m 2.20s), user CPU
  **359.23 seconds**, peak RSS **549,504 KiB** (536.625 MiB). This includes
  construction of the persistent guest-owned test runtime and final teardown.
  Both the control embedding and the test runtime execute inside the guest VM;
  no Node or SpiderMonkey engine is present in the process. Raw detailed log:
  ignored `artifacts/test262-js-runner-full3.log`.
- This is a bounded diagnostic inventory, not complete ES5.1 conformance.
  The six generated eval/lexer workloads exhaust the stated instruction
  allowance; they remain failures, not skips. This historical import covers
  chapters 6, 7, 9, 10, 11, 12 and 13, not every standard-library feature.
- The first complete inventory exposed a separate process-status bug: the
  standalone source entry returned zero after a caught `process.exit(1)`.
  Exit-status forwarding was corrected afterward; a one-file failing
  `--fail-fast` selection now returns 1, while an all-passing fresh-context
  chapter-6 selection returns 0. The recorded full-run summary was not inferred
  from that earlier exit code.
- A fresh hosted comparison completed with exactly the same 153 failing IDs
  and strict/sloppy variants, not merely matching totals. The serial hosted
  run took 471.31 seconds (468.43 seconds user CPU), peak RSS 305,280 KiB.
  These individual runs show lower standalone elapsed time but substantially
  higher memory usage; they are not a statistical performance comparison.

Initial bring-up failure inventory (the 153-failure baseline, retained for
comparison; current chapter totals appear above). Groups are source chapters,
not mutually exclusive root-cause diagnoses:

- Chapter 7: **6**, all instruction-cap timeouts (two comment/eval tests and
  four generated regexp-literal lexer tests).
- Chapter 9: **7**: empty-string Boolean conversion (1), ES5 canonical
  number-to-string formatting/exponent thresholds (4), and required TypeErrors
  for property access on null/undefined (2).
- Chapter 10: **10**, all in arguments-object semantics/property descriptors,
  including strict `arguments.callee` access that must throw.
- Chapter 11: **8**, including missing function `length`, boxed-string
  addition/compound assignment, deletion and `in` behavior, and the previously
  documented strict Math.PI corpus erratum. Do not change valid language
  semantics merely to accept its `NotEarlyError` expectation.
- Chapter 12: **82**: loops/hoisting/enumeration (21), dynamic `with` resolution
  (24), switch/fall-through (5), top-level return incorrectly accepted (10),
  and try/catch/finally behavior (22). The latter includes finally blocks
  skipped across break/continue and a catch-binding compilation limitation.
- Chapter 13: **40**: function/arguments bindings and function-object property
  metadata, including absent descriptors and enumerable `prototype.constructor`.
  One catch-binding case also fails during compilation.

Only two of the 153 failures are compile-phase failures, both reporting
`catch binding is not directly addressable`. Most remaining work is incomplete
or incorrect semantics of already accepted constructs, not wholesale absence
of their syntax. Merely adding parser productions would not resolve it.

Bring-up checkpoints, not full-suite results:

- 2026-10-28, native contract 66: the snapshot regression gate exposed a
  logical UTF-16 accessor returning neighboring storage bits. Numeric property
  lookup could fail even though the equivalent string-key lookup succeeded.
  Corrected both flat and indirect logical-accessor paths, without changing
  assembler lookups. Node, js_min and genuine self-hosted builds now produce
  byte-identical 6,005,936-byte images (SHA-256
  `778154be4aed4e20a296d909cb524f51a1d7411bb35de93f0451ca3c7f995e26`).
  The final complete inventory above uses this corrected image.
- Contract-66 regression gates: both complete project suites passed under
  js_min and Node (12 guest programs / 270 guest assertions each, plus heap,
  embedding and compiler checks). Live demos 1–8 opened at 320x240/20 FPS
  and exited cleanly; demo8 also entered garage and free-drive auto-pilot.
  These were short interaction checks, not long-duration soak tests or a
  sustained-FPS claim. Both HTTP servers served text, a byte-identical binary
  snapshot and a directory listing. The standalone GC workload passed 24
  rounds / 47 native collections. All ten previously working standalone
  Octane quick-correctness runs passed: Richards, DeltaBlue, Crypto, RayTrace,
  EarleyBoyer, Splay, NavierStokes, Box2D, Gameboy and zlib. No stock-score
  sweep or RegExp benchmark is implied by those quick runs.
- Initial standalone chapter 6: 1 executed / 1 passed / 0 failed.
- Chapter 9 after portable conversion fixes: 128 executed / 121 passed /
  7 failed / 0 not run / 0 timed out.
- Label/throw selections `ch12/12.12 ch12/12.13` after safe exception reporting:
  15 executed / 15 passed / 0 failed / 0 not run / 0 timed out.
- `--self-hosted-eval ch10/10.1` with the ordinary 20-million-instruction
  allowance: 43 executed / 40 passed / 3 failed / 0 not run / 0 timed out.
  These are Function/eval realm/global-binding cases. At the smaller 20,000
  allowance the same three cases time out because eval compilation is charged
  inside the test realm. This mode is not the default standalone inventory.
  A heap-adopted constant-register sentinel bug exposed by the mode was fixed:
  the portable frame initializer now skips negative unmapped-register entries,
  like the native frame initializer.
- Earlier full attempts stopped at native semantic exits, first while
  converting internal property-key strings and later while formatting a
  primitive thrown value. Neither partial attempt replaces the completed
  inventory above. VM inspection was extended to include frame parameters;
  temporary raw heap dumps and logs are not committed.

### Hosted native interpreter under js_min — 3,292 files

- Latest completed hosted authored-program checkpoint (2026-10-28, standalone
  bring-up comparison): **3,292 executed, 3,139 passed, 153 failed, 0 not run**; six
  instruction-budget timeouts are included in failures. See the dated
  packed-object entries below. Historical synthetic-variant results are
  retained separately and are not the current conformance totals.

- 2026-10-28: `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet
  --instruction-limit 20000`: **3,139 passed, 153 failed, 0 not run; 6 timeouts**.
  Elapsed 471.31 seconds, user CPU 468.43 seconds, peak RSS 305,280 KiB.
  Sorted failing IDs and variants exactly match the completed standalone run
  above. Raw log: ignored `artifacts/test262-hosted-current-full.log`.

- 2026-10-27, approximately 09:53 UTC, revision `70ff17d`:
  `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet
  --instruction-limit 20000`. All 3,292 authored variants executed:
  **3,139 passed, 153 failed, 0 not run; 6 timeouts included in failures**.
  Elapsed 415.93 s; user CPU 410.42 s; peak RSS 276,372 KiB. The totals
  match the preceding checkpoint. The fresh serial control run of `81d1545`
  completed around 10:02 UTC with the same totals, in 423.15 s (user CPU
  421.66 s; peak RSS 274,540 KiB). Sorted failing IDs and strict/sloppy
  variants compare byte-for-byte: **153 unchanged failures, zero new failures,
  zero newly passing cases**. These are single-run regression measurements,
  not a statistically established speedup. No corpus
  files or expectations were changed. JSON tests are a separate selected
  integration check, since this Test262 import has no chapter 15.12.

- 2026-10-27, approximately 17:31 UTC, loaded revision `e387dde`:
  the complete authored-program run with `--vm-native --quiet
  --instruction-limit 20000` again executes all 3,292 variants:
  **3,139 passed, 153 failed, 0 not run; 6 timeouts included in failures**.
  Elapsed 486.95 s; user CPU 480.00 s; peak RSS 281,356 KiB. This is the
  large-backing memory checkpoint, including the pending embedder-call
  synchronization correction. Totals match the previous complete checkpoint;
  the extra embedding buffer-access work prompted the next refinement.

- 2026-10-27, approximately 17:47 UTC, loaded revision `5e7b15c`:
  the same complete command executes all 3,292 authored variants:
  **3,139 passed, 153 failed, 0 not run; 6 timeouts included in failures**.
  Elapsed 454.49 s; user CPU 453.00 s; peak RSS 281,080 KiB. Native byte
  access now uses the authoritative backing pointer for inline and external
  storage. Failing IDs and strict/sloppy variants match the preceding
  `e387dde` run exactly: 153 unchanged failures, zero newly passing cases.
  These are serial single-run measurements, not statistical speedup claims.

- 2026-10-27, approximately 18:00 UTC, loaded revision `c918b07`:
  the same complete command executes all 3,292 authored variants:
  **3,139 passed, 153 failed, 0 not run; 6 timeouts included in failures**.
  Elapsed 428.99 s; user CPU 427.57 s; peak RSS 319,592 KiB. Context
  snapshots now retain their external-backing metadata rather than discovering
  it again at every restore. Failing IDs and strict/sloppy variants match
  both preceding memory-work runs exactly: 153 unchanged failures and no
  newly passing cases. Compared with the earlier 415.93/423.15 s checkpoints,
  timing is close, not a demonstrated speedup. This hosted suite's peak RSS
  is higher than the preceding runs; the standalone zlib memory reduction
  must not be generalized to all workloads. See [OCTANE_MEMORY.md](OCTANE_MEMORY.md).

- 2026-09-12, revision `381a345`, 20,000-instruction diagnostic allowance:
  all 3,292 files and 5,765 variants were executed; 4,856 passed, 909 failed,
  0 were not run, and 4 of the failures were timeouts. Elapsed: 275.50
  seconds. Peak RSS: 344,840 KiB. Against the directly comparable first
  baseline this is 4 more passes, 4 fewer failures, no hidden skips, and
  150.56 seconds less elapsed time.
- 2026-09-11, working tree after revision `e3c4f33`, 20,000-instruction
  diagnostic allowance: all 3,292 files and 5,765 variants reached a result;
  4,852 passed, 913 failed, 0 not run, and 4 of those failures were timeouts.
  Elapsed: 426.06 seconds. Peak RSS: 359,508 KiB. This is the first complete
  baseline; the allowance is deliberately recorded because a later unbounded
  conformance result is not directly comparable to it.

### Performance reference

- 2026-09-11, local Node.js 24.14.1 direct `vm`-context runner: all 3,292
  files and 5,765 selected variants completed in 41.52 seconds (41.78 seconds
  wall time), with peak RSS 1,198,568 KiB. This is a throughput reference, not
  a guest-VM conformance result: the helper counted completion versus throws
  but did not apply the authoritative runner's negative-test classification.
- The first complete bounded MMVM run took 426.06 seconds, approximately
  10.2 times the Node throughput reference. Context restoration is no longer
  the dominant cost; front-end compilation, semantic services, and
  accumulated program metadata remain the principal general targets.
  This comparison used the superseded 5,765 synthetic-variant selection and
  remains only a historical throughput reference.
- 2026-09-11, MMVM native guest with context snapshots, working tree after
  `2e70454`: `ch07/7.9`, 101 files and 202 variants, 202 passed and 0 failed in
  11.50 seconds; peak RSS 145,632 KiB. The previous completed measurement for
  the identical selection was 86.44 seconds.
- 2026-09-11, same working tree: `ch07/7.6`, 271 files and 503 variants,
  503 passed and 0 failed in 24.43 seconds; peak RSS 181,064 KiB. The previous
  completed measurement for the identical selection was 282.16 seconds.

### Chapter 9 — 128 files, 254 variants

- 2026-09-11 01:15 BST, revision `f801d9a`: 160 passed, 94 failed,
  0 timed out; 132.48 seconds; peak RSS 172,116 KiB.
- 2026-09-11 01:25 BST, revision `793da54`: 200 passed, 54 failed,
  0 timed out; 135.92 seconds; peak RSS 172,112 KiB.
- 2026-09-11 01:45 BST, working tree after `793da54`: 252 passed,
  2 failed, 0 timed out; 139.87 seconds; peak RSS 171,392 KiB.

### Chapter 7 focused selections

- `ch07/7.3`, 59 files, 118 variants, revision `e926acc`: 118 passed,
  0 failed, 0 timed out; 60.94 seconds.
- `ch07/7.2`, 45 files, 90 variants, revision `e8907b6`: 90 passed,
  0 failed, 0 timed out.
- `ch07/7.6`, 271 files, 503 variants, revision `1dd5005`: 503 passed,
  0 failed, 0 timed out; 282.16 seconds.
- `ch07/7.8/7.8.3`, 80 files, 150 variants, revision `5838573`:
  150 passed, 0 failed, 0 timed out; 72.87 seconds.
- `ch07/7.8/7.8.4`, 78 files, 120 variants, revision `7106d12`:
  120 passed, 0 failed, 0 timed out; 55.97 seconds.
- `ch07/7.9`, 101 files, 202 variants, revision `9e4ca43`: 202 passed,
  0 failed, 0 timed out; 86.44 seconds.

The failure count must decrease from one completed full run to the next.
A higher count blocks the corresponding change from being accepted, even if
individual new features pass. Existing VM tests, demos, and their established
performance are separate mandatory regression gates.

## Investigation log

### 2026-09-10 08:56 BST — initial complete-run attempt

- Revision: `8aaeea3`
- Command shape: `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet`
- Outcome: interrupted after 66 reported variant failures because reparsing
  the root harness for every fresh context projected an impractically long
  run. This is not a full-suite count.
- Common failure: `ReferenceError: Function is not defined` at
  `shell.js:102:1` during harness evaluation.
- Action: retain fresh globals but cache and reuse the immutable compiled
  harness program within the one runtime.

### 2026-09-10 09:03 BST — Function constructor checkpoint

- Scope: both variants of `ch06/6.1.js` under Node-hosted and MMVM-native
  guest execution.
- Result before the change: 0 passed, 2 failed in the root harness because
  `Function` was absent.
- Result after the change: the `Function` failure is gone; both variants now
  reach `shell.js:430:5` and fail because
  `Date.prototype.getTimezoneOffset` is absent.
- Implementation: `Function` constructs source, runs it through the VM's own
  parser/compiler/verifier, and returns a guest-heap bytecode function. It
  does not call the host JavaScript `Function` constructor.
- Regression gates: Node and `js_min.exe` VM suites pass; the guest suite now
  contains 239 passing assertions. Networking, `node_web.js`, demo1, demo2,
  heap/GC/context tests, and the three-context demo remain passing.

### 2026-09-10 09:06 BST — host-call audit mode

- Added `guest_runner.js --vm-no-host-calls`.
- Any attempted embedder callback now becomes a source-located
  `HostCallError` before the callback executes, including in nested guest
  execution.
- A pure language test completes in this mode. `node_hello.js` currently
  identifies `require` as an existing bootstrap dependency.
- Test262 is not yet self-hosted: its bootstrap `Test262VM` service and
  filesystem operations still cross the embedding boundary. Conformance
  counts and self-hosting status remain separate until the suite completes
  with `--vm-no-host-calls`.

## Current failure groups

1. Runner bootstrap: isolated context execution and filesystem reads are
   still embedder services and must migrate behind guest/native runtime
   operations.
2. Broad test-level groups in the current failure inventory include RegExp,
   URI encode/decode functions, property/declaration attributes, strict
   `this` and eval behavior, `arguments` objects, update expressions, object
   literal accessors, and the remaining statement forms.
3. Four Unicode lexical variants exhaust the deliberately bounded diagnostic
   allowance. They remain failures, not skips, until their general execution
   path completes within the allowance.
4. The former cumulative Chapter 11 heap corruption is fixed. Complete
   Chapter 11 and whole-suite runs now finish, so stability and classification
   are no longer marked as pending.

### 2026-09-10 09:40 BST — runnable harness and chapter sample

- Root harness now completes under MMVM. `Function` and Date calendar
  construction are guest implementations; MMVM source-file decoding now
  converts UTF-8 to ES5.1 UTF-16 code units without host decoding.
- Added a reproducible manifest of all 3,292 applicable files and an initialized
  harness template. Each variant still receives a fresh global, cloned mutable
  harness state, and context-bound guest functions while sharing immutable
  bytecode.
- Complete `ch07/7.3` run under MMVM native: 59 files, 118 variants, 82 passed,
  36 failed, 0 timed out; 60.94 seconds. This is a subtree measurement, not a
  full-suite total.
- Observed groups in that subtree: eval completion/lexing, constructor
  prototype setup, Unicode line terminators, and identifier handling.
- A complete-run attempt reached the same test-level failures but was stopped
  after 67 files because pre-manifest discovery projected excessive startup
  time. It is not entered in the full-suite table.
- Regression gates: Node and `js_min.exe` suites pass with 249 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap/GC/context tests,
  and three-context scheduling remain passing.

### 2026-09-10 09:44 BST — unbounded-timeout run stopped

- Revision: `78fb446`.
- Selection: all 3,292 files; provisional 20,000,000-instruction limit.
- Outcome: deliberately terminated after 1,185.69 seconds. The run reported
  its 100-file checkpoint (160 passed, 40 failed) and then spent more than 15
  minutes in one small failing variant. This is not a completed-suite count.
- Peak RSS: 185,380 KiB.
- Action: use a bounded diagnostic allowance so a faulty infinite path cannot
  make the suite operationally unfinishable. A timeout remains a failure and
  therefore cannot inflate conformance.

### 2026-09-10 10:04 BST — lexical and Error-object checkpoint

- Revision: `e926acc`.
- Complete focused run: `ch07/7.3`, 59 files, 118 variants, 118 passed,
  0 failed, 0 timed out. The same selection previously had 36 failures.
- Fixed general guest behavior: U+2028/U+2029 token boundaries, guest-owned
  Error subtype prototypes, Error construction, inherited `instanceof`, and
  `Error.prototype.toString`.
- Regression gates: Node and `js_min.exe` suites pass with 252 guest
  assertions plus the existing networking, demo, heap, GC, and context checks.

### 2026-09-10 10:12 BST — eval completion checkpoint

- Revision: `e8907b6`.
- Complete focused run: `ch07/7.2`, 45 files, 90 variants, 90 passed,
  0 failed, 0 timed out.
- Eval now returns the value of a top-level expression completion rather than
  unconditionally returning `undefined`.
- Regression gates remain green on Node and `js_min.exe`.

### 2026-09-10 10:17 BST — bounded complete-run attempt exposed a crash

- Revision: `e926acc`; all 3,292 files; 20,000-instruction diagnostic limit.
- Outcome: the process received SIGSEGV after approximately 380 files, so no
  full-suite conformance count is claimed. Its last complete progress line was
  300 files / 600 variants: 532 passed and 68 failed. Later output reached
  `ch07/7.6/S7.6_A1.3_T3.js` before the crash.
- Elapsed at crash: 745.80 seconds. Peak RSS: 179,644 KiB.
- A five-file run spanning the apparent crash boundary subsequently completed
  all 10 variants, which points to accumulated runtime/context/GC state rather
  than one intrinsically crashing source file.

### 2026-09-10 17:10 BST — strict parsing and direct eval checkpoint

- Revision: `b7193b2`.
- Complete focused run: `ch07/7.6/7.6.1/7.6.1.2`, 62 files, 86 variants,
  86 passed, 0 failed, 0 timed out. Before direct strict eval, 18 strict
  variants in this selection failed.
- ES5.1 future-reserved words, strict directive prologues, function strictness,
  and reserved-word property names are handled by the guest tokenizer/parser.
- Syntactically direct eval no longer yields through an embedder host call. It
  inherits strict parsing and can address existing caller bindings through
  guest lexical-environment slots; indirect eval continues to use the global
  environment.
- Regression gates: Node and `js_min.exe` suites pass with 253 guest
  assertions plus networking, `node_web.js`, demo1, demo2, heap/GC/context,
  and three-context checks.

### 2026-09-10 18:01 BST — authoritative Unicode identifiers

- Revision: `1dd5005`.
- Complete focused native run: `ch07/7.6`, 271 files, 503 variants,
  503 passed, 0 failed, 0 timed out.
- Elapsed: 282.16 seconds. Peak RSS: 169,456 KiB.
- Replaced the permissive non-ASCII identifier fallback with a compact,
  host-independent BMP category lookup generated from the pinned Unicode
  3.0.0 `UnicodeData` source. The lookup covers ES5.1 identifier-start and
  identifier-part categories plus U+200C and U+200D without regular
  expressions, locale functions, host callbacks, or `Intl`.
- Byte-for-byte deterministic regeneration was verified with `js_min.exe`.
- Regression gates: Node and `js_min.exe` suites pass with 255 guest
  assertions. Existing networking, `node_web.js`, demo1, demo2, heap, GC,
  context, native-interpreter, and three-context checks remain green.

### 2026-09-10 18:25 BST — strict octal and native catch stability

- Pre-fix complete focused run at revision `8429e50`: `ch07/7.7`,
  `ch07/7.8`, and `ch07/7.9`, 326 files, 606 variants, 515 passed,
  91 failed, 0 timed out. Elapsed: 411.40 seconds. Peak RSS: 182,216 KiB.
  The failures cluster in strict octal string/numeric syntax, RegExp, and six
  automatic-semicolon-insertion cases.
- Intermediate numeric-literal run after strict lexical recognition:
  `ch07/7.8/7.8.3`, 80 files, 150 variants, 143 passed, 7 failed,
  0 timed out. Elapsed: 70.81 seconds. Peak RSS: 169,496 KiB. All seven
  remaining failures were dynamic strict-eval cases in the native engine.
- Post-fix complete native run: `ch07/7.8/7.8.3`, 80 files, 150 variants,
  150 passed, 0 failed, 0 timed out. Elapsed: 72.87 seconds. Peak RSS:
  169,484 KiB.
- Numeric tokens now distinguish and correctly evaluate the non-strict legacy
  octal extension, while the parser rejects it in strict programs, strict
  functions, direct eval, and numeric object-property names.
- Fixed a general native continuation bug: after a semantic exception entered
  a guest catch handler, the partially reloaded semantic register mirror was
  incorrectly spilled over authoritative native-heap registers. Catch
  continuations now retain heap authority, preventing stale constants and
  temporaries from corrupting subsequent operations.
- Regression gates: Node and `js_min.exe` suites pass with 258 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 00:52 BST — strict string literal grammar

- Complete focused native run: `ch07/7.8/7.8.4`, 78 files, 120 variants,
  120 passed, 0 failed, 0 timed out. The earlier combined lexical run had
  35 failures in this selection.
- Elapsed: 55.97 seconds. Peak RSS: 166,032 KiB.
- String tokens now retain lexical metadata for escape sequences and decode
  the non-strict legacy octal extension correctly. Strict code rejects decimal
  and octal escape forms while retaining the permitted `\\0` form when it is
  not followed by a decimal digit.
- Directive-prologue handling now rejects an octal escape in an earlier
  directive when a later exact `use strict` directive makes the whole body
  strict. Escaped spellings such as `use\\x20strict` remain ordinary string
  directives and do not enable strict mode.
- Regression gates: Node and `js_min.exe` suites pass with 262 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 01:00 BST — automatic semicolon insertion boundaries

- Complete focused native run: `ch07/7.9`, 101 files, 202 variants,
  202 passed, 0 failed, 0 timed out. The earlier combined lexical run had six
  failures in this selection.
- Elapsed: 86.44 seconds. Peak RSS: 178,284 KiB.
- Expression statements now enforce the ES5.1 semicolon/ASI boundary instead
  of accepting arbitrary adjacent same-line tokens. Insertion remains valid at
  a line terminator, closing brace, or end of input; malformed same-line block
  statements and `if` consequents before `else` are rejected during parsing.
- Regression gates: Node and `js_min.exe` suites pass with 264 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 01:15 BST — Chapter 9 baseline and intrinsic stability

- Complete focused native run: `ch09`, 128 files, 254 variants, 160 passed,
  94 failed, 0 timed out. Elapsed: 132.48 seconds. Peak RSS: 172,116 KiB.
- The first attempt crashed in the strict variant of
  `ch09/9.8/9.8.1/S9.8.1_A9_T1.js`. Native symbol-offset introspection traced
  the fault to the buffer intrinsic helper: its broad numeric-ID test treated
  later, unrelated intrinsic IDs as buffer accesses and dereferenced their
  operands using a buffer layout. Intrinsic dispatch now rejects IDs before
  reading operation-specific fields; the isolated strict variant and the
  complete chapter both finish without a native fault.
- The remaining failures primarily group into ToPrimitive for guest objects
  and boxed primitives, missing Number constructor constants, ES5.1 string to
  number whitespace/conversion rules, and the Boolean object interface.
- Regression gates: Node and `js_min.exe` suites pass with 264 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 01:25 BST — Number constructor constants

- Complete focused native run: `ch09`, 128 files, 254 variants, 200 passed,
  54 failed, 0 timed out. Elapsed: 135.92 seconds. Peak RSS: 172,112 KiB.
  This is 40 fewer failures than the directly preceding Chapter 9 baseline.
- Added the five ES5.1 Number constructor constants as guest-owned primitive
  properties. This removed secondary failures across Boolean conversion,
  signed-zero checks, infinity conversion, bitwise conversion, and number to
  string tests that had all observed missing properties as `undefined`.
- Regression gates: Node and `js_min.exe` suites pass with 267 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 01:45 BST — ES5.1 conversion model

- Complete focused native run: `ch09`, 128 files, 254 variants, 252 passed,
  2 failed, 0 timed out. Elapsed: 139.87 seconds. Peak RSS: 171,392 KiB.
  This is 52 fewer failures than the directly preceding Chapter 9 result and
  92 fewer than the initial Chapter 9 baseline.
- Added guest-owned primitive wrapper objects and the shared `ToObject` and
  `ToPrimitive` operations. Arithmetic, relational comparison, loose
  equality, bitwise operations, constructors, and standard prototype methods
  now consume those conversions consistently. Guest-defined `valueOf` and
  `toString` functions execute in the guest VM rather than being forwarded to
  the host language.
- String-to-number conversion now recognizes the complete ES5.1 whitespace
  set. The native interpreter trims guest strings itself and sends only the
  numeric span through its direct `strtod` FFI service.
- The two remaining failures are both `with (null/undefined) statement`
  cases. They require the general ES5.1 `with` statement and dynamic object
  environment records; they are not being special-cased as conversions.
- Regression gates: Node and `js_min.exe` suites pass with 264 guest
  assertions; networking, `node_web.js`, demo1, demo2, heap, GC, context,
  native interpreter, and three-context checks remain green.

### 2026-09-11 01:55 BST — interrupted full-run lifetime audit

- A complete-suite attempt at revision `2514f10` was externally interrupted,
  probably when the machine was shut down. Its last observation at 297.83
  seconds showed RSS at 342,492 KiB. It is inconclusive and therefore does not
  appear as a whole-suite baseline.
- Destroyed contexts made their guest program records unreachable, but the
  runtime's program-address and metadata indexes still retained every host
  parser/compiler object. The authoritative marker also treated that index as
  a root on the JavaScript collector path.
- Program metadata is now a weak address index in lifecycle terms: programs
  remain alive through context, frame, function, and program-record edges in
  the guest heap. After marking, metadata for an unmarked program is retired
  before its records are swept. This lets fresh-context teardown release both
  guest storage and transitional host representations without invalidating a
  genuinely reachable function.
- Regression gates remain green on Node and `js_min.exe`.

### 2026-09-11 — first complete suite and context snapshot checkpoint

- Revision `a789cda` introduced a general guest-heap context snapshot. The
  initialized harness is captured once, and each variant restores all mutable
  records reachable from the context while excluding the live scheduler's
  frames and engine state.
- The identical `ch07/7.9` selection improved from 86.44 to 11.50 seconds;
  all 202 variants still pass. The identical `ch07/7.6` selection improved
  from 282.16 to 24.43 seconds; all 503 variants still pass.
- Revision `e3c4f33` added `--summary-only`, which suppresses diagnostic text
  without skipping or reclassifying tests. The first complete bounded run
  produced the whole-suite count above.
- Profiling 473 Chapter 10 variants attributes roughly 0.8 seconds to context
  restoration, 3.5 seconds to compilation, and 3.1 seconds to execution.
  This rules out further snapshot micro-tuning as the major route to the
  41.52-second Node reference.

### 2026-09-11 — genuine fresh-context comparison

- Revision `2ebbc01` reduced actual `JSContext` create/destroy cost from about
  58 ms to about 0.3 ms per context under `js_min.exe`. It does this with a
  kernel-compiled global-property copier, bulk memory clearing, cached template
  metadata, and runtime-owned context-neutral `Function` and indirect `eval`
  intrinsics. It does not restore a context snapshot.
- Added a diagnostic `--fresh-contexts` Test262 mode while retaining the
  snapshot checkpoint as the default comparison path. It creates a new context
  for every variant and evaluates the already-compiled harness programs there.
- Complete focused native run: `ch07/7.9`, 101 files, 202 variants, 202 passed,
  0 failed, 0 timed out. Elapsed: 54.45 seconds. Peak RSS: 161,452 KiB.
- For 200 reported variants, context creation consumed only 67 ms in total;
  executing the Test262 harness in those fresh contexts consumed 42,178 ms.
  Thus fresh context allocation is already cheap. The end-to-end gap from the
  11.83-second snapshot run is repeated guest harness execution, especially its
  Date/DST initialization and host-transition overhead, not context creation.
- This diagnostic mode is not yet the default. A replacement for snapshot
  isolation must instantiate an independently mutable, initialized realm; it
  must not hide harness replay time inside the context-construction metric or
  reuse mutable state from the previous test.

### 2026-09-11 — fresh harness native operations

- Complete focused native runs of `ch07/7.9` continued to pass all 202
  variants with 0 failures and 0 timeouts as general operations moved across
  the native interpreter boundary. The elapsed progression was 54.45 seconds,
  46.83 seconds after native UTC timezone offsets, 26.82 seconds after native
  missing-global property allocation, and 25.93 seconds after native UTC Date
  getters and common numeric Date construction.
- The latest run peaked at 159,160 KiB. Its profile measured 99 ms creating
  200 contexts and 14,024 ms evaluating the harness. Semantic exits fell to
  933 across the complete command, including runner services; the earlier
  profile had 33,025 exits.
- The `Function` constructor now caches immutable verified programs by source
  at runtime scope. Each invocation still creates a distinct guest function
  with the requesting context as its home realm, so the optimization does not
  share mutable function objects between tests.
- Date values and results remain guest-heap value cells. The native path uses
  the kernel compiler and named heap accessors; non-numeric and deliberately
  bounded edge cases return to the existing semantic implementation rather
  than changing observable results.
- Follow-up complete focused native run: `ch07/7.9`, 101 files, 202 variants,
  202 passed, 0 failed, 0 timed out. Elapsed: 23.68 seconds. Peak RSS:
  158,732 KiB. A guest-heap program index now lets repeated single-argument
  `Function` construction allocate a distinct function directly in the native
  interpreter after the first real parse and compilation.
- Regression gates after the fresh-harness work: Node and `js_min.exe` suites
  pass with 264 guest assertions; networking, `node_web.js`, demo1, demo2,
  heap, GC, context, native interpreter, and three-context checks remain green.

### 2026-09-12 — complete Chapter 11 stability run and explicit outcomes

- Complete focused native run: `ch11`, 1,320 files and 2,476 variants;
  2,209 passed, 267 failed, 0 not run, and 0 timed out. Elapsed: 188.88
  seconds. Peak RSS: 282,556 KiB. This is a complete chapter measurement, not
  a replacement for the whole-suite baseline.
- A repeated single-argument `Function` construction had exposed a malformed
  guest prototype record. Firefox 1's source decompiler rewrote a kernel local
  named `prototype` when `prototypeProperty` was also present, so the compiler
  did not receive the source spelling visible in the repository. Distinct
  kernel-local names now survive `Function#toString`, and the native heap
  verifier completes the whole chapter without corruption.
- The runner now reports the complete applicable denominator as mutually
  exclusive passed, failed, and not-run counts. A normal unfiltered run has
  zero not-run variants. Diagnostic strict filters and `--fail-fast` account
  for every deliberately unexecuted variant instead of silently shrinking the
  denominator; timeouts remain failures.
- A native Date regression found by the broader gate was an eight-byte
  temporary written across two adjacent four-byte engine scratch fields. The
  temporary now uses dead space in the result value cell. The complete
  `ch07/7.9` selection again passes all 202 variants with 0 failed and 0 not
  run in 12.00 seconds, peak RSS 148,768 KiB.
- Regression gates pass on Node and `js_min.exe` with 264 guest assertions;
  networking, `node_web.js`, demo1, demo2, heap, GC, context, native
  interpreter, and three-context checks remain green.

### 2026-09-12 — first explicit whole-suite outcome improvement

- The first complete run after adding explicit not-run accounting executed all
  5,765 variants and reported 4,848 passed, 917 failed, 0 not run, and 4 timed
  out in 287.47 seconds, peak RSS 346,680 KiB. It was rejected as a progress
  result because it had four more failures than the accepted baseline.
- The regression was the native one-argument Date constructor copying its
  input without ES5.1 `TimeClip`. The native kernel now rejects non-finite and
  out-of-range values and truncates finite values toward zero. The shared
  kernel compiler gained a portable `truncateF64` operation: the i386 backend
  temporarily selects x87 round-toward-zero through macro-assembler calls,
  while the JavaScript backend emits the equivalent floor/ceiling operation.
  No host Date operation or test-name special case is used.
- Chapter 9 returned to 252 passed, 2 failed, 0 not run, and 0 timed out across
  all 254 variants. The two remaining failures are the previously documented
  unimplemented `with` statement.
- ES5.1 immutable own `length` properties were added for the Array constructor
  and String prototype using a general guest-heap data-property definition.
  Their focused four variants now all pass.
- The subsequent complete run at revision `381a345` produced the accepted
  4,856 passed / 909 failed / 0 not run result recorded above. Both Node and
  `js_min.exe` regression suites remained green before that run.

### 2026-09-13 — authored-mode accounting and chapter 11 operators

- The runner was corrected to execute this Mozilla-era corpus as authored:
  JavaScript is sloppy by default, `@onlyStrict` requests a prepended strict
  directive, and unannotated programs are no longer duplicated with an
  invented directive. `@noStrict` documents the default. This is not a skip;
  each of the 3,292 corpus files has exactly one applicable execution in a
  normal run. `TEST262.md` documents the selection contract.
- Before the operator work, a complete authored-mode Chapter 11 run executed
  all 1,320 files: 1,245 passed, 75 failed, 0 were not run, and 0 timed out.
  (The immediately preceding 1,397-variant diagnostic reported 1,245 passed
  and 152 failed; its 77 additional failures were synthesized strict copies.)
- After implementing sparse array literal length/hole semantics, strict object
  literal validation, strict setter/update targets, numeric update coercion,
  and strict/sloppy binding/property deletion, a complete authored-mode
  Chapter 11 run executed all 1,320 files: 1,280 passed, 40 failed, 0 were not
  run, and 0 timed out. Chapter 11.1 is 66 passed / 0 failed.

### 2026-09-13 — Chapter 11 shared semantic gaps reduced to one corpus erratum

- Complete native authored-source run: `ch11`, 1,320 files; 1,319 passed,
  1 failed, 0 not run, and 0 timed out. Elapsed: 88.23 seconds. Peak RSS:
  236,096 KiB.
- General ES5.1 behavior added in this step includes callable
  `Function.prototype`, function `length`, recursive `new` expressions,
  computed member access after construction, non-extensible ordinary objects,
  `Object.preventExtensions`, `Object.isExtensible`,
  `Object.getOwnPropertyNames`, `Array.isArray`, standard immutable Number and
  Math constants, sparse-array and array-length deletion behavior, invalid
  assignment references, and deterministic Date parsing/UTC operations.
- The regexp/division lexical-goal decision after a function expression is
  now made from the expression context, so a function expression can be the
  left operand of division without mis-tokenizing `/` as a regexp literal.
- The sole remaining Chapter 11 failure is
  `ch11/11.13/11.13.1/11.13.1-4-28gs.js`. Its source executes
  `throw NotEarlyError` before `Math.PI = 20`, while its metadata demands an
  early error. ES5.1 permits the member assignment syntactically and requires
  a runtime `TypeError` only if execution reaches the assignment, so making
  this file pass would require a deliberate language-semantic regression.
  It remains counted as a failure; it is neither skipped nor silently accepted.
- Node and `js_min.exe` regression gates pass with all 264 guest assertions,
  including networking, `node_web.js`, demo1, demo2, heap/GC/context checks,
  native interpreter checks, and the three-context demo.

### 2026-09-13 — interrupted whole-suite run and eval stress diagnosis

- A complete authored-source run was stopped externally after approximately
  85 minutes and the machine was subsequently rebooted. It produced no final
  summary, so it does not change the accepted whole-suite pass/fail/not-run
  baseline. Resident memory had grown gradually beyond 400 MiB. The generated
  log remained empty because `--quiet` reports only failures and the final
  summary; no outcome is inferred from that empty partial log.
- Bounded chapter runs localized the extreme delay to historical generated
  lexer tests. Chapter 7.2 passed 45/45 in 10.68 seconds (142,432 KiB peak),
  chapter 7.3 passed 59/59 in 10.86 seconds (142,228 KiB peak), and chapter
  7.6 passed 271/271 in 45.90 seconds (193,544 KiB peak). Chapter 7.8.3 passed
  80/80 in 11.21 seconds and 7.8.4 passed 78/78 in 11.39 seconds.
- `ch07/7.4/S7.4_A5.js` and `S7.4_A6.js` each perform 65,536 direct evals.
  The former initially took 77.45 seconds under native `js_min.exe`, versus
  7.63 seconds for the same guest VM hosted by Node. Successfully parsed empty
  eval programs now share one immutable retained program, avoiding tens of
  thousands of redundant program graphs. A kernel-compiled eval intrinsic
  recognizes sources consisting entirely of ES5 whitespace and comments and
  returns `undefined` without a native-to-host transition; all other string
  sources retain the real parser/compiler path. A5 now passes in 36.94 seconds;
  A6 passes in 10.48 seconds.
- Chapter 7.8.5 contains several further 65,536-iteration tests whose eval
  sources are non-empty regexp programs. They must be handled by wiring the
  existing guest-owned tokenizer/parser/compiler and program-adoption ABI into
  eval. No benchmark-specific regexp evaluator or cached parse is acceptable.
- Node and `js_min.exe` regression gates remain green with all 264 guest
  assertions and the existing networking/demo/integration checks.

### 2026-09-13 — long-run memory diagnosis and bounded regexp completion

- The reported 85-minute run exceeding 400 MiB was treated as a lifecycle
  regression. No second opaque whole-suite run was started. Reproducible,
  bounded selections show that the runtime atom table made every identifier,
  literal, and property spelling a permanent GC root, while the growable heap
  doubled its logical limit at collection pressure before attempting to
  reclaim dead records.
- Interning is now weak: live heap references preserve canonical atom
  addresses, while mark/sweep rebuilds the host lookup tables from marked
  entries and releases dead spellings. Native allocation requests collection
  at its pressure boundary and grows the logical heap only if reclamation
  cannot satisfy a later allocation. The stable maximum address reservation
  and growable-heap behavior are unchanged.
- High-churn address dictionaries are replaced by survivor-only maps during
  collection, released program-metadata slots are reused, and the transitional
  compiled-regexp accelerator is bounded to 256 entries. Host-VM collection
  is not coupled to guest collection: doing so caused long pauses in
  interactive workloads with a large persistent guest graph.
- Native `ch07/7.4` remains 14 passed / 0 failed / 0 not run in 39.11 seconds,
  with a 268,220 KiB peak. Its guest heap reported a 64 MiB logical limit, no
  growth, and four collections. The exact generated regexp test
  `ch07/7.8/7.8.5/S7.8.5_A1.1_T2.js` now has a completed bounded result:
  1 passed / 0 failed / 0 not run in approximately 165 seconds. Its sampled
  RSS still rose from 137,996 KiB at 15 seconds to 335,788 KiB at 165 seconds.
  Therefore weak atoms and bounded metadata remove genuine leaks but do not
  resolve the dominant cost: non-empty direct eval still constructs its
  tokenizer, AST, compiler, and program adapter in the host VM. Wiring the
  existing guest-owned frontend into general eval remains the next large
  memory and performance step; no regexp-specific evaluator or parse cache is
  used.
- Complete Node and `js_min.exe` regression gates pass after these changes
  with all 264 guest assertions, networking, `node_web.js`, demo1, demo2,
  heap/GC/context/native-interpreter checks, and the three-context demo green.

### 2026-09-13 — self-hosted eval checkpoint and GC performance correction

- The guest-owned frontend can now compile direct eval through the shared
  tokenizer, parser, compiler, verifier, and authoritative program-builder
  ABI. Sloppy eval uses dynamic caller-environment lookup; strict eval creates
  its own lexical environment and dynamically resolves outer bindings.
  Program strict/eval flags and sloppy eval declarations survive adoption.
- This path is selected explicitly with `--self-hosted-eval` while it is being
  optimized. Native `ch10/10.1` passes 43/43 in that mode in 14.10 seconds,
  peak RSS 135,220 KiB. The generated 65,536-regexp test remained incomplete
  at the 180-second cap, but peak RSS fell to 255,192 KiB from the prior
  host-frontend sample above 335 MiB. It is not yet the default because that
  would regress Test262 throughput.
- Profiling identified general string intrinsic gaps rather than a regexp-test
  special case. Native `String.charAt` now returns arbitrary UTF-16 code units,
  allocating a one-code-unit guest string above the prebuilt Latin-1 table,
  and single-argument `String.fromCharCode` reuses native ES number conversion
  for string arguments. The latter removes a host transition from generated
  lexical workloads.
- The initial collect-before-grow policy caused demo8 to exhaust its
  contiguous 64 MiB tail and cycle thousands of fragmented regions. It
  repeatedly collected a graph with only about 3.7 MiB live, dropping from
  roughly 4 FPS to 0.4--0.7 FPS. Logical growth is now permitted only after a
  collection proves high live occupancy, an unusable native region, or an
  exhausted contiguous tail. No demo code or workload-specific VM path was
  added.
- After the correction, a native guest demo8 run at 320x240 and a 20 FPS cap
  reported consecutive five-second samples of 15.2, 15.4, 16.6, 17.8, and
  15.4 FPS with no cliff. A second run reported 14.8, 12.3, and 18.2 FPS.
  Complete Node and `js_min.exe` regression gates pass with all 264 guest
  assertions and the existing integration checks.

### 2026-10-02 — GC stability regression check

- Revision `966169c`, native js_min host, authored `ch10/10.1` selection,
  20,000-instruction allowance: 43 files/variants executed, 43 passed,
  0 failed, 0 not run, and 0 timed out. This is a focused regression check
  after allocator ownership and collector preparation changes, not a new
  full-suite conformance result. Elapsed time and peak RSS were not captured.
  The existing corpus was not modified. Raw output remains an ignored
  artifact in `artifacts/gc-test262-contexts.log`.

### 2026-10-22, approximately 14:40 UTC — compiler/performance differential check

- Focused selection only: `ch09/9.5 ch11/11.6 ch11/11.7`, authored variants,
  native interpreter under js_min. Executed 165 of 165 files/variants:
  153 passed, 12 failed, 0 not run, 0 timed out.
- An isolated checkout of baseline `9ff16dd` ran the identical selection:
  153 passed, 12 failed, 0 not run/timeouts. The failing test IDs are identical.
  The working changes use compact literal ASTs at script/eval/Function entry
  points and retain balanced dispatch. Failures include existing boolean/null
  arithmetic and boxed-string conversion gaps. This comparison establishes no
  new failures in this selection, not complete ES5.1 conformance.
- Full dual-host project regression suite also passed: 12 guest programs,
  269 guest assertions per host, plus the existing GC, embedding, compiler,
  networking CLI and context checks. No corpus files were modified.
- Elapsed time and peak RSS were not captured for this focused check. Raw
  diagnostics remain ignored artifacts `zlib-compact-test262-details.log` and
  `zlib-baseline-test262-details.log` under `artifacts/`. The temporary baseline
  checkout was removed; logs were retained.
- No whole-suite rerun was performed here. The latest whole-suite totals above
  remain unchanged; these 165 tests are not substituted for those totals.
- Follow-up after bounded non-leaf inlining and typed-read/ToInt32 combination:
  the identical selection again executed all 165 variants, 153 passed,
  12 failed, 0 not run/timeouts; failing IDs still exactly match `9ff16dd`.
  Raw log: `artifacts/zlib-read-conversion-test262.log`. Elapsed/RSS were not
  captured. This remains a focused regression check, not a whole-suite run.

### 2026-10-23, approximately 15:55 BST — register initialization checkpoint

- Revision `45fd599`, focused selection `ch09/9.5 ch11/11.6 ch11/11.7`,
  authored variants under `js_min.exe guest_runner.js --vm-native`.
- Executed 165 of 165 variants: 153 passed, 12 failed, 0 not run,
  0 timed out. Failure IDs exactly match the preceding focused log
  `artifacts/zlib-final-test262.log`; no newly failing test in this selection.
- Raw log: ignored `artifacts/zlib-frame-init-js-min-test262.log`.
  Elapsed time and peak RSS were not captured. This was a correctness check,
  not a timed suite comparison; demo1 was also running for a stability check.
- Both-host project regressions passed. No corpus files were changed.
  No whole-suite run was performed; whole-suite totals above remain unchanged.
- Running this wrapper selection through standalone js_runner failed before
  test execution with unsupported opcode 35 / a non-callable value. The
  previous predecoded image reproduces the same failure. This standalone
  wrapper limitation remains outstanding; it is not counted as 165 passes.

### 2026-10-23, approximately 21:20 BST — self-hosted rebuild repair

- Revision `1d6bcd2`, focused selection `ch09/9.5 ch11/11.6 ch11/11.7`,
  authored variants under `js_min.exe guest_runner.js --vm-native`.
- Executed 165 of 165 variants: 153 passed, 12 failed, 0 not run,
  0 timed out. Totals match the previously recorded focused baseline. The
  existing boolean/null arithmetic and boxed-string failures remain. Exact
  failure-ID comparison was not repeated because the earlier raw log was no
  longer present; this entry does not claim such a comparison.
- Raw log: ignored `artifacts/self-build-bounded-test262.log`. Elapsed time
  and peak RSS were not captured for this correctness run.
- Native numeric-string array reads, primitive own-key enumeration and numeric
  string header initialization were repaired. An existing higher-level
  object/array traversal case now guards the compiler failure. Both-host
  project regressions pass (12 programs / 270 guest assertions per host), and
  a genuine self-hosted snapshot rebuild produces a byte-identical image.
- The standalone js_runner Test262 wrapper still exits before executing the
  selection with a non-callable value / unsupported opcode 35. Raw log:
  `artifacts/self-build-bounded-raw-test262.log`. That is an outstanding wrapper
  limitation, not a passing Test262 result. No whole-suite run was performed;
  whole-suite totals above remain unchanged. No external corpus files changed.

### 2026-10-23, approximately 23:15 BST — compact string storage

- Revision `9c591d8`, focused selection `ch09/9.5 ch11/11.6 ch11/11.7`,
  authored variants under `js_min.exe guest_runner.js --vm-native`.
- Executed 165 of 165 variants: 153 passed, 12 failed, 0 not run and
  0 timed out. The failing test IDs exactly match the pre-change log
  `artifacts/self-build-bounded-test262.log`; no new failure in this selection.
- Raw log: ignored `artifacts/latin1-test262.log`. Elapsed time and peak RSS
  were not captured for this correctness check. No whole-suite run was
  performed; the whole-suite totals above remain unchanged.
- Flat Latin-1 strings use one byte per code unit; wider strings retain exact
  UTF-16 storage. Source text and inspection metadata are retained. Both-host
  project regressions pass (12 programs / 270 assertions per host), including
  native execution, heap/GC and the string round-trip samples. A genuine
  self-hosted rebuild is byte-identical. No corpus files were changed.

### 2026-10-24, approximately midday BST — compact snapshot metadata

- Revision `e217d5b`; js_min-hosted native execution using the explicit
  `--with-snapshot artifacts/fruits-profitable1.snap` option. Focused authored
  variants: `ch09/9.5 ch11/11.6 ch11/11.7`.
- Executed 165 of 165 variants: 153 passed, 12 failed, 0 not run and
  0 timed out. The 12 failing IDs exactly match the earlier compact-string
  baseline, compared with cmp. Raw log: ignored
  `artifacts/fruits-profitable-test262-final.log`.
- This is a focused regression check, not a new whole-suite run. Whole-suite
  totals above remain unchanged. The final serial run took 41.51 seconds,
  with peak RSS 189,668 KiB (about 185 MiB). An earlier run with the same
  counts overlapped a demo stability check.
- Both-host project regressions pass (12 programs / 270 language assertions
  per host, plus embedding/GC/native-engine checks). Private immutable
  argument/register metadata is shared; explicit map edits use copy-on-write.
  Native integer joining no longer needs host semantics for metadata keys.
- The final dense snapshot occupies 8,326,112 bytes, and its genuine
  self-hosted rebuild is byte-identical. Large strings retain exact source
  text through backing views; tiny records remain inline when views would
  not save storage. No C, demo or external corpus files were modified.

### 2026-10-24, afternoon BST — scratch-layout corruption correction

- Working revision: scratch-layout fix accompanying `GC_STRESS.md`. Complete
  authored suite, native js_min execution with a fresh snapshot, using
  `--quiet --instruction-limit 20000` (verbose inventory retained separately).
- Executed **3,292 of 3,292 variants: 3,139 passed, 153 failed, 0 not run**.
  Six instruction-budget timeouts are included in the failures. This is a
  bounded diagnostic group, not an unbounded conformance result; do not merge
  its counts with other instruction limits or synthetic strict variants.
- Elapsed 353.26 seconds; peak RSS 249,208 KiB. Raw log:
  `artifacts/build-scratch-test262-full.log` (ignored).
- The pre-fix run crashed after recording 2,411 passes and 59 failures, so its
  incomplete failure count is not comparable to a whole-suite total. Comparing
  identifiers confirms **zero regressions among those 2,411 passing variants**.
  Comparison: ignored `artifacts/build-scratch-test262-comparison.json`.
- Both-host project tests pass (12 guest programs / 270 guest assertions per
  host, plus embedding/native checks). All eight previously working Octane
  suites pass quick correctness checks. The new bounded GC stress test passes
  under both embedding hosts and standalone automatic collection. No external
  corpus or demo sources were changed.

### 2026-10-24, afternoon BST — snapshot construction optimization

- Fresh native snapshot with canonical field-schema reuse and bounded backing
  search setup. Selection: `ch09/9.5 ch11/11.6 ch11/11.7`, authored variants,
  explicit `--instruction-limit 20000` diagnostic cap.
- **165 executed: 164 passed, 1 failed, 0 not run, 0 timed out**.
  Elapsed 51.38 seconds, peak RSS 191,708 KiB (overlapped project regressions;
  not a serial performance measurement).
- Failing ID exactly matches the same selection in the complete scratch-fixed
  baseline: `ch11/11.6/11.6.1/S11.6.1_A3.2_T2.3.js` (boxed-string addition).
  No focused regression. Raw log: ignored
  `artifacts/prepared-search-test262.log`. Whole-suite totals above unchanged.
- Both-host project suites, all eight previously working Octane quick suites
  and standalone bounded GC stress pass. Genuine self-build is byte-identical;
  no corpus or demo source was modified. See `BUILD_PERFORMANCE.md`.

### 2026-10-24, late afternoon BST — register packing and frontend reuse

- Complete authored suite, native js_min execution with the fresh
  `packed-registers.snap`, `--quiet --instruction-limit 20000`.
- **3,292 executed: 3,139 passed, 153 failed, 0 not run, 6 timed out**
  (timeouts included in failures). Elapsed 344.49 seconds; peak RSS
  270,516 KiB. Counts match the earlier scratch-fixed bounded full baseline.
  Raw log: ignored `artifacts/packed-registers-test262-full.log`.
- This validates the register-packing/frontend/prototype-lookup candidate,
  not the later canonical-hash/content-cache changes. Those later changes
  pass both-host project suites, eight previously working Octane quick suites
  and standalone bounded GC stress; their full-suite comparison remains due.
- Test/benchmark execution is now strictly serial to limit host memory.
  An overlapping profiling build was interrupted; no partial timing from it
  is treated as a benchmark result. No external corpus files were changed.

### 2026-10-24, about 22:10 BST — global lookup / ordered-storage foundation

- Complete authored suite, native js_min execution from the current source,
  `--quiet --instruction-limit 20000`, run serially.
- **3,292 executed: 3,139 passed, 153 failed, 0 not run, 6 timed out**
  (timeouts included in failures). The exact failing IDs and strict/sloppy
  variants match `packed-registers-test262-full.log`: no additions or removals.
- Elapsed **312.21 seconds**, versus 344.49 seconds in that baseline. Peak RSS
  **319,440 KiB**, versus 270,516 KiB: time improved, memory did not. Raw log:
  ignored `artifacts/ordered-storage-test262-full.log`. The explicit diagnostic
  instruction cap and remaining failures mean this is not a conformance claim.
- Direct standalone execution of the Test262 wrapper still fails before tests
  (`value is not callable`, opcode 35, PC 285). The preceding `lean-compiler`
  snapshot reproduces the same failure. This inventory uses the established
  js_min entry point, not an assertion that standalone Test262 works.
- Both-host project suites, all eight previously passing Octane quick suites,
  standalone bounded GC stress and byte-identical genuine self-build pass.
  Packed entry storage is a collector-tested component, not yet ordinary
  objects' default representation. No demo or external corpus was modified.

### 2026-10-24, about 23:10 BST — guarded owner/entry API stage

- Native js_min, authored selection `ch09/9.5 ch11/11.6 ch11/11.7`,
  `--quiet --instruction-limit 20000`, serial execution.
- **165 executed: 164 passed, 1 failed, 0 not run, 0 timed out**.
  Elapsed 46.01 seconds; peak RSS 196,832 KiB. The sole failing ID is the
  existing boxed-string addition case
  `ch11/11.6/11.6.1/S11.6.1_A3.2_T2.3.js` (non-strict).
- No focused regression. This is not a new whole-suite run; the most recent
  whole-suite inventory above remains 3,139 pass / 153 fail / zero not run.
  Raw log: ignored `artifacts/owner-entry-test262-focused.log`.
- Both-host project suites, eight previously working Octane quick suites,
  standalone language integration, bounded GC and short unchanged demos 1–8
  pass. Genuine self-build is byte-identical. Ordinary objects still use the
  legacy backing while owner/entry consumers are migrated; packed default
  storage is not claimed to be enabled at this checkpoint.

### 2026-10-25, morning GMT — packed-storage cutover validation

- Fresh exported pre-cutover reference: `bfec626`, native js_min,
  complete authored inventory, `--quiet --instruction-limit 20000`.
  **3,292 executed: 3,139 passed, 153 failed, 0 not run, 6 timed out**
  (timeouts are included in failures). Elapsed 317.86 seconds; peak RSS
  288,436 KiB. Raw log: ignored `artifacts/packed-baseline-test262-full.log`.
- The packed cutover exposed a context-snapshot lifetime defect: eager backing
  retirement could reuse a record still owned by a saved context. Snapshot
  pins now preserve those boundaries, while saved immutable targets remain GC
  roots even after the running context deletes their references. An initial
  aborted run is not counted as a complete-suite result.
- Intermediate diagnostic with backing lifetime corrected but restore-cache
  invalidation still missing: **3,292 executed: 3,099 passed, 193 failed,
  0 not run, 6 timed out**. Elapsed 565.52 seconds; peak RSS 271,856 KiB.
  This is not an accepted regression baseline. The exact failing set was the
  original 153 plus 40 cases; no original failure disappeared to mask them.
  Raw log: ignored `artifacts/packed-pins-test262-full.log`.
- Restoring old epochs cannot validate weak views from the abandoned execution
  timeline. Restore now clears native lookup caches, threaded property/array
  views and handle entry maps, including handles adopted after capture.
  The exact 40 added failures now all pass: **40 executed, 40 passed, 0 failed,
  0 not run, 0 timed out**. The both-snapshot dictionary/collection/restore
  lifecycle is also covered by the existing embedding-context test, rather
  than a new set of language micro-tests. The Node project suite passes.
  Raw log: ignored `artifacts/packed-restore-test262-40.log`.
- Corrected complete native inventory (`0deb997`): **3,292 executed:
  3,139 passed, 153 failed, 0 not run, 6 timed out**. The exact failing
  IDs/variants match the pre-cutover set. Elapsed 587.10 seconds; peak RSS
  285,212 KiB. Raw log: ignored `artifacts/packed-restore-test262-full.log`.
  Correctness is back to baseline, but this timing does not establish
  performance parity with the earlier 317.86-second run.
- A serial, same-machine repeat of the exported pre-cutover inventory confirms
  the same 3,139 pass / 153 fail / zero not-run / six-timeout set in **308.96
  seconds** (307.74 user, 0.85 system), peak RSS 288,336 KiB. The whole-suite
  slowdown is therefore real, not dismissed as timing noise. Raw log: ignored
  `artifacts/packed-baseline-test262-repeat.log`. A focused phase comparison of
  152 cases (`ch11/11.6 ch11/11.7`) has identical 151-pass/one-failure results:
  first-100 context creation/restore 375 versus 308 ms, compilation/registration
  5,874 versus 6,104 ms, execution 1,226 versus 828 ms (packed versus baseline).
  Native interpreter time for the complete selection is 94 versus 85 ms, with
  identical bytecode/exit counts. These instrumented figures do not explain
  the entire difference in the whole-suite wall times. No corpus was modified.
- An explicitly named resolved-entry descriptor/value-cell accessor now skips
  repeated slot bounds/key validation only after semantic lookup or guarded
  cache validation has established a live entry. The checked low-level API is
  unchanged; neither view may survive re-entry or structural mutation. The
  Node project suite passes, and the same 152-case selection remains 151 pass /
  one existing failure. First-100 compilation/registration is 5,309 ms and
  execution 1,110 ms. A complete instrumented run is in progress to identify
  the remaining whole-suite cost; performance parity is not claimed.

### 2026-10-26, morning GMT — span decoding and bounded property scans

- Complete native js_min run with string-span decoding and length/hash
  rejection before text comparison: **3,292 executed: 3,139 passed,
  153 failed, 0 not run, 6 timed out**. Exact failing IDs/variants unchanged.
  Elapsed 417.41 seconds (409.84 user, 2.49 system); peak RSS 299,376 KiB.
  Raw log: ignored `artifacts/packed-span-test262-full.log`.
- Follow-up with the packed linear-scan span validated once, using its named
  within-length key accessor: **3,292 executed: 3,139 passed, 153 failed,
  0 not run, 6 timed out**. Elapsed 412.72 seconds (410.74 user, 1.02 system);
  peak RSS 304,176 KiB. Raw log: ignored
  `artifacts/packed-scan-test262-full.log`. The exact failure-set comparison
  is retained separately from total-count checks.
- Both totals match the pre-cutover set. The earlier 40 added failures and
  harness-restore crash are fixed. This is not full ES5.1 conformance: the
  original 153 failures, including six diagnostic-cap timeouts, remain.
- The former 587.10-second cutover run is substantially improved, but whole
  inventory performance is still below the 308.96-second baseline repeat.
  No performance-parity claim is made. Both-host project/CLI/context checks
  and bounded GC checks pass at the span-reader checkpoint. Fresh snapshot
  generation and genuine self-hosted generation produce bit-identical dense
  images. Unchanged demos 1–8 subsequently passed actual standalone X11
  rendering/input/exit checks, including garage and free-driving autopilot.
  These are short smoke checks, not long soaks. The eight previously working
  Octane quick correctness selections also pass; no stock-score claim is made.

### 2026-10-26, final packed-object integration checks

- The complete inventory result above remains **3,139 pass / 153 fail /
  0 not run**, with six bounded timeouts included in failures. The subsequent
  platform timer fix did not change the language interpreter or compiler.
- Real Node-hosted X11 execution exposed a host Timeout object escaping into
  a guest return value. The environment now keeps timer handles private and
  returns numeric guest IDs, with callback roots released on every lifecycle
  path. Actual demo1 passes on Node and js_min; Node threaded demos 4–7 pass.
  The Node project suite passes all 12 guest programs and 270 assertions,
  embedding/compiler checks and the 100-call three-context example.
- Final snapshot generation: 77.12 seconds under js_min, 79.26 seconds for a
  genuine self-hosted rebuild; both dense 8,201,744-byte images are identical.
  This is not faster than the pre-cutover build reference. Raw logs are
  `artifacts/packed-final-build.log` and `artifacts/packed-final-self.log`.
- Both `net.js` and `node_web.js` pass loopback HTTP checks from that final
  image: text and binary byte comparisons, generated directory listings and
  default `index.html`. Temporary fixtures remain ignored under artifacts;
  neither demo source nor the external test corpus was changed.
- The final image also passes all eight previously working Octane quick
  correctness selections, including zlib. Independent tracing reports
  33,192 reachable records and zero missing GC marks. Logs use the ignored
  `artifacts/packed-final-` prefix. RegExp remains outside this checkpoint.
- All eight actual X11 demo checks were repeated with that final image:
  320x240, 20 FPS cap, input and clean exit. Demo8 additionally enters garage
  and free-driving autopilot before exit. These remain bounded smoke checks,
  not a sustained-throughput measurement.

### 2026-10-26, morning GMT — Node cross-build regression inventory

- Revision `5a2fd3c` runtime, same complete authored-program inventory and
  20,000-instruction diagnostic allowance: **3,292 executed, 3,139 passed,
  153 failed, 0 not run; 6 timeouts included in failures**. Totals match the
  preceding packed-object checkpoint. Elapsed 429.33 seconds (423.67 user,
  2.22 system), peak RSS 303,780 KiB. Raw log:
  `artifacts/cross-test262-full.log`. Earlier temporary failure-ID logs had
  been cleared, so this entry claims matching totals, not a fresh exact-ID
  comparison against those deleted logs. The known failures remain real
  conformance work, not skips.
- Command: `js_min.exe guest_runner.js --vm-native test262_runner.js --quiet
  --instruction-limit 20000`, with the documented library path exported.
  The external corpus was not modified. No interpreter opcode or language
  semantic implementation was changed for Node snapshot construction.
- Both-host project suites, actual standalone demos 1–8, both HTTP servers,
  all eight previously supported Octane quick selections and bounded GC
  checks passed at the cross-build checkpoint. Complete suite time is close
  to but above the preceding 412.72-second run; no throughput speedup is
  claimed. Node construction is faster; guest interpreter optimization is
  a separate task.
- The subsequent Node-only deferred-token isolation fix passes the complete
  three-host snapshot regression again. All eight actual demos, both HTTP
  servers, the supported Octane quick selections, native compiler dependency
  graph and standalone GC/audit checks pass with its final image. The native
  interpreter code section and kernel fingerprint exactly match a freshly
  built pre-change `5883e86` image. Zlib quick correctness took 47.34 seconds
  versus 47.35 seconds for that fresh reference; no language changes were
  introduced by the guard fix.

## Rules for subsequent entries

- Record local date/time, revision, exact selection, variant totals, failure
  count, timeout count, elapsed time, and peak RSS for every complete run.
- Keep raw logs as ignored temporary artifacts, not committed corpus output.
- Record focused and interrupted runs explicitly as such.
- Never convert an unsupported feature into an unexplained skip.
- Never implement an ES5.1 operation by forwarding it to SpiderMonkey or
  Node. Guest-visible semantics belong to the guest heap/runtime/interpreter.
- Do not make no-host-calls mode the default until existing platform services
  have migrated and the pre-existing regression suite passes in that mode.
