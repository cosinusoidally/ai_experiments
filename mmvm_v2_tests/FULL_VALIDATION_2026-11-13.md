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

## Snapshot Octane: complete, 15/15 passed

Stock setup/warmup/timing/correctness checks are retained, including RegExp
and Mandreel. These are single observations against the November 12 archive,
not paired controlled benchmarks or evidence of an optimization in this task.
Scores are higher-is-better; seconds include process execution.

| Suite | Previous score | Current score | Change | Current seconds |
| --- | ---: | ---: | ---: | ---: |
| Richards | 84.1 | 94.2 | +12.01% | 3.366 |
| DeltaBlue | 69.8 | 89 | +27.51% | 4.491 |
| Crypto | 144 | 169 | +17.36% | 27.391 |
| RayTrace | 256 | 261 | +1.95% | 10.757 |
| EarleyBoyer | 438 | 443 | +1.14% | 27.637 |
| RegExp | 2.93 | 2.82 | -3.75% | 584.375 |
| Splay | 707 | 692 | -2.12% | 4.060 |
| NavierStokes | 273 | 275 | +0.73% | 10.038 |
| PdfJS | 820 | 829 | +1.10% | 18.470 |
| Mandreel | 509 | 516 | +1.38% | 104.502 |
| Gameboy | 1058 | 1070 | +1.13% | 13.790 |
| CodeLoad | 98.6 | 100 | +1.42% | 28.422 |
| Box2D | 391 | 396 | +1.28% | 14.669 |
| zlib | 600 | 612 | +2.00% | 250.184 |
| Typescript | 1430 | 1496 | +4.62% | 96.306 |

The geometric mean of per-suite score ratios is 1.04236 (+4.24%). RegExp
and Splay have lower individual observations; these are not hidden by the
aggregate. No source changes to improve scores were made in this audit.

## Self-hosting and executable checkpoint

- The snapshot genuinely recompiles the VM from source in 82.414 s, exit 0,
  and reproduces its input byte-for-byte. Previous observation: 83.118 s.
- Input snapshot SHA-256:
  `d788779e0427855d5bd79938d172cc9a02b67308257c4b3ae0849d6dbd42138d`.
- Executable SHA-256:
  `6cb065c39289f6e5ea75e7f86ecc79c8c59c9f382af6cc7c98f1cd1a00b69361`.
- The supervisor deleted `artifacts/full-suite.snap` before the executable
  matrix, verifies absence before every job, and verifies executable
  immutability afterward.
- Executable core: pass, 12 programs / 270 assertions plus internal checks,
  101.271 s. Tokenizer, language/object integration, JSON and native GC pass.
- All executable demos 1–8 and HTTP servers pass, 79.238 s total. Demo8
  garage/auto-drive transitions and shutdown pass with the snapshot absent.
- Executable Test262: **3292 passed / 0 failed / 0 timed out / 0 not run**,
  clean exit 0. Runner 412.023 s; process 412.645 s. Previous executable
  process observation: 422.82 s.

Executable ECMA/Octane/rebuild and supplementary checks remain in progress.
No final all-tests verdict is claimed at this checkpoint.
