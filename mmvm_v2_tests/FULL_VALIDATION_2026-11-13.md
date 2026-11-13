# Full VM validation — 2026-11-13

Status: in progress. Implementation under test: `75860af` on
`guestVM-cleanup3`. No passing result is inferred from a started job.

## Scope and method

Run workloads serially, with no overlapping memory-heavy tests. Use the
existing i386 js_min binary with LD_LIBRARY_PATH configured, and the existing
js_runner binary; neither requires rebuilding. Temporary inputs, outputs,
logs and timing receipts remain under ignored `artifacts/`.

- Run the project suite on Node and js_min, plus bounded structural GC.
- Build a fresh optimized snapshot, package an executable, and run the serial
  snapshot/executable acceptance matrix: core, tokenizer, language/object/JSON
  integration, native GC, demos 1–8, HTTP servers, full imported Test262,
  historical ECMA, all 15 stock Octane suites, and genuine self-hosted rebuild.
- Compare ECMA filenames with the completed November 12 baseline, not just
  aggregate counts. Baseline: 994 passed, 335 failed (39 timeouts included),
  four configured skips; imported Test262: 3292 passed, no failures.
- Delete the task-created input snapshot before the executable matrix, as
  required by the existing acceptance supervisor.
- Exercise supplemental FFI, frontend, dependency compiler and context tests;
  run debugger/debug metadata and executable packaging acceptance separately.
- Measure build time/RSS and Octane scores; compare against the previous
  recorded measurements. Retain single-run variability and any unresolved
  regressions explicitly rather than presenting all changes as speedups.

The external test corpora and demo sources are not to be changed to achieve
passing results. Existing known ECMA failures remain failures, not passes.

## Initial environment/build checks

- Direct i386 js_min runs hello successfully.
- Fresh Node optimized `-g` snapshot build: exit 0, 9.82 s wall,
  337784 KiB maximum RSS (one observation).

## Completed snapshot-launcher checks

- Core: 12 guest programs / 270 assertions plus the existing embedding,
  heap, compiler and native/predecoded interpreter checks, exit 0, 106.261 s.
- Tokenizer: pass; language/object integration: pass; selected JSON: pass;
  bounded native GC workload: pass.
- All demos 1–8 and all three HTTP servers pass the existing live application
  matrix in 80.413 s. Demo8 switches garage/auto-drive modes and exits normally.
- Imported Test262: **3292 passed / 0 failed / 0 timed out / 0 not run**,
  clean process exit 0. Runner 433.644 s; process 434.34 s; peak RSS
  512404 KiB. Previous snapshot observation: 453.981 s process time.
- ECMA: **994 passed / 335 failed**, including 39 watchdog timeouts;
  four existing configured skips, zero not run. All **1333 filename statuses
  exactly match** the November 12 snapshot baseline: zero lost/gained passes,
  zero changed statuses. Runner 666.361 s; process 667.71 s; peak RSS
  463836 KiB. Previous process observation: 666.755 s. Exit 1 is expected
  because the existing known failures are still reported as failures.

Debug and non-debug optimized snapshots contain byte-identical interpreter
code (672705 bytes). This checks debug emission equivalence, not identity
with the older VM revision.

Snapshot Octane, the executable matrix and supplementary checks remain in
progress. No final all-tests verdict is claimed at this checkpoint.
