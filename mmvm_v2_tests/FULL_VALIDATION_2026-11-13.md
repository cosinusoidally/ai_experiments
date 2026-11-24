# Full VM validation — 2026-11-13

Status: **complete**, approximately 13:16–14:54 UTC. Implementation under
test: `75860af` on `guestVM-cleanup3`. **No newly lost correctness pass was
found; no VM fixes were needed.** Existing ECMA failures remain failures.

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

## Complete main matrix

The serial supervisor completed **54 jobs** with **accepted=true** and an
empty unexpected-failures list. Both imported Test262 runs have clean exit 0.
Both ECMA runs have the same 1333 filename statuses as each other and the
baseline, with zero lost/gained passes or changed statuses. Executable ECMA
runner time is 654.192 s, process time 654.485 s, peak RSS 463832 KiB.
Executable Test262 peak RSS is 512400 KiB.

All 15 stock Octane suites also pass under the executable. Its genuine
self-hosted rebuild takes 83.996 s (previous 83.516 s) and reproduces the
same snapshot SHA-256. The supervisor confirms the input snapshot remains
absent throughout that phase and the executable is unmodified.

| Octane suite | Previous exe score | Current exe score | Change | Current seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 96.2 | 99.9 | +3.85% | 3.323 | 21504 |
| DeltaBlue | 91 | 94.8 | +4.18% | 4.501 | 58496 |
| Crypto | 175 | 180 | +2.86% | 25.567 | 38784 |
| RayTrace | 266 | 280 | +5.26% | 10.034 | 206720 |
| EarleyBoyer | 451 | 483 | +7.10% | 25.120 | 467584 |
| RegExp | 2.85 | 2.98 | +4.56% | 552.082 | 467584 |
| Splay | 699 | 723 | +3.43% | 3.914 | 420352 |
| NavierStokes | 270 | 277 | +2.59% | 9.972 | 25344 |
| PdfJS | 736 | 837 | +13.72% | 18.325 | 270648 |
| Mandreel | 495 | 511 | +3.23% | 104.727 | 487784 |
| Gameboy | 1004 | 1073 | +6.87% | 13.693 | 96496 |
| CodeLoad | 89.5 | 101 | +12.85% | 28.283 | 257536 |
| Box2D | 374 | 396 | +5.88% | 14.598 | 92672 |
| zlib | 595 | 611 | +2.69% | 250.527 | 104192 |
| Typescript | 1456 | 1495 | +2.68% | 96.370 | 467452 |

The executable geometric-mean score ratio is 1.05397 (+5.40%). All individual
observations are higher than the archived executable run. As with the
snapshot table, this is not a controlled attribution to a code optimization.

The main supervisor ran from 13:17:08 to 14:41:38 UTC (84 min 29 s), covering
both launchers serially. This duration is mostly the real corpus/benchmark
work, notably slow lexical tests, the unchanged ECMA watchdog cases and stock
RegExp/zlib. It is not multiple retries of incomplete intermediate VM builds.

## Remaining checks: complete

- `guest_vm/tests/run_tests.sh both`: exit 0, both Node and js_min pass
  12 guest programs / 270 assertions plus tokenizer, heap, embedding,
  kernel/numeric/native/predecoded backend and structured compiler checks.
  Runner stdout, net/node_web/demo help paths and three-context multiplexing
  also pass. Combined wrapper time 201.48 s; peak RSS 273188 KiB.
- Structural GC passes on all four execution paths: Node, js_min,
  snapshot-hosted and executable-hosted. Each checks 27 audits / 111996
  edges / 221 property indexes / 74 embedding collections. Maximum observed
  heap bump: Node 3531416 bytes; other paths 3531768 bytes, all below the
  8388608-byte cap. Native-counter collections are checked separately by the
  native workload (24 rounds / 48 collections on each main launcher).
- Independent snapshot collector audit: 39008 reachable records, zero
  missing marks. It also reports 457 unreachable occupied records / 86576
  bytes; these are disclosed, not confused with missing live marks.
- Debug/code equivalence passes on Node and js_min under both default and
  -O0 policies: 269 canonical functions; default 672705 code bytes / 18597
  statement positions / 333 locals with safe availability; -O0 545244 code
  bytes / 25066 positions / 2794 locals. Both hosts emit identical DWARF
  hashes. Node check 5.38 s / 259796 KiB; js_min 141.72 s / 937812 KiB.
  The latter's roughly 916 MiB compiler-test peak is a resource limitation,
  not application-runtime RSS. It ran without another heavy workload.
- Debug executable packaging: all 49 ELF/launch checks pass, including
  Node/js_min/standalone output identity, original payload/file immutability,
  no-snapshot execution and ordinary loader behavior. No compiler/binutils
  programs or rebuilt C loader were needed.
- Kernel debugger real-kernel acceptance passes on js_min and the standalone
  executable. Both launcher command-file workflows pass. Coverage includes
  list main before run, raw disassembly and original breakpoint bytes,
  local/argument inspection, stepping, CFI boundaries, restart and bounded
  GC interrupt/resume.
- Supplementary matrix: **14/14 checks pass**, seven through each launcher:
  structural GC, raw FFI file I/O, self-hosted frontend, net.js frontend
  compilation, recursive native compiler dependencies, demo8 runner I/O and
  three-context multiplexing. Its input snapshot was deleted before the
  executable half. Total 92.41 s; maximum RSS 266476 KiB.
- Fresh js_min source build: 110.64 s / 317232 KiB; byte-identical to the
  Node-built snapshot and both genuine self-hosted rebuilds. Ordinary
  js_runner executes hello from it. This audit has no matched previous
  non-debug js_min-build timing, so it does not establish js_min build-time
  improvement or parity. Node plain build: 9.28 s / 297848 KiB. Snapshot-
  hosted build: 82.41 s / 484228 KiB; executable-hosted: 83.99 s / 484280 KiB.

## Demo performance and limits of acceptance

All samples use 320x240 and the existing 20 FPS request. Demos 1–7 each have
one roughly five-second FPS sample before input-driven shutdown; demo8 has
three chronological samples while the existing driver switches garage and
auto-drive modes. Those samples include transitions, so they must not be
called steady-state garage/free-drive benchmarks or a sustained-20-FPS pass.

| Demo | Previous snapshot FPS | Current snapshot FPS | Previous exe FPS | Current exe FPS |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2.2 | 2.3 | 2.4 | 2.4 |
| 2 | 2.1 | 2.2 | 2.2 | 2.2 |
| 3 | 2.9 | 3.0 | 3.1 | 3.1 |
| 4 | 2.8 | 2.9 | 3.0 | 3.0 |
| 5 | 2.0 | 2.0 | 2.0 | 2.1 |
| 6 | 1.5 | 1.5 | 1.6 | 1.6 |
| 7 | 2.2 | 2.3 | 2.4 | 2.4 |
| 8, sample 1 | 19.9 | 19.6 | 19.0 | 19.1 |
| 8, sample 2 | 16.1 | 16.3 | 16.5 | 15.9 |
| 8, sample 3 | 19.2 | 19.4 | 19.1 | 19.2 |

The demo passes mean live startup, frame production, exercised input/mode
changes and normal shutdown. They are not automated pixel-by-pixel visual
comparison or proof against every long-lived GC defect. The bounded GC
workloads and structural audits provide separate lifetime/corruption checks;
no seven-minute demo8 run was used.

## Reproduction and evidence

From this directory, with an existing `artifacts/js_runner.exe`:

```sh
node guest_runner.js --vm-native --snapshot artifacts/full-suite.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/full-suite.snap artifacts/full-suite.exe
node guest_vm/tools/validate_snapshot_exe_suites.js artifacts/full-suite.snap artifacts/full-suite.exe artifacts/full-suite-results --ecma-baseline PREVIOUS_COMPLETE_ECMA_LOG
```

Use a new results directory; reinvoke the same supervisor command to resume.
It deletes the supplied snapshot between phases. The baseline for this run
was the saved November 12 complete ECMA log, read-only in the backup checkout.
The archived per-suite Octane logs provide the previous scores above.

Main receipts: `artifacts/full-suite-results/results.json`, individual
`.log`/`.time.json` files and `artifacts/full-suite-supervisor.log`.
Supplementary receipts: `artifacts/full-supplementary/results.json` and
`artifacts/full-check-*.log` / `*.time`. Project-wrapper and Node snapshot
build timing logs use the `artifacts/full-validation-*` / `full-suite-build`
prefixes. Temporary generated data is not committed.

No C, VM, demo or external corpus source was changed during this audit. No
new tests, skips, relaxed budgets, downloads, emulation, application-specific
performance shortcuts or parallel heavy jobs were introduced. Existing ECMA
failures and the imported Test262 corpus's limited coverage mean this is
**no observed correctness regression**, not complete ES5.1 compliance. The
historical performance comparisons show no broad application slowdown, but
single observations cannot exclude small regressions or isolate their cause.
