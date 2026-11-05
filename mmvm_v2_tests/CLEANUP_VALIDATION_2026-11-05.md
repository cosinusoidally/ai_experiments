# Guest VM cleanup validation — 2026-11-05

Implementation checkpoint: `cdc4539` on `guestVM-cleanup3`.
Starting implementation: `a7fc652`. Documentation-only follow-ups do not
change the implementation under test. This report distinguishes completed
checks from existing failures; it does not replace failures
with smoke-test passes.

## Scope

- Removed legacy constant-local/initializer-override semantics from the
  kernel compiler and interpreter. Dependencies are explicit graph inputs.
- Removed the obsolete wrapper-owned refill arena; named acquire/release
  operations and one collection-preparation boundary own the handoff.
- Shared resolved property-descriptor addressing between native execution
  and the portable JS backend. Checked accessors retain their validation.
- Removed no-op helper-install/retry paths and shared view-kind ABI IDs.
- Centralised native rejection IDs, profile names and cold diagnostic
  formatting/source-location lookup. No guest-pointer dereferences are
  introduced by formatting a rejection reason.

No demo, C source, external corpus, Test262/ECMA/Octane harness or language
feature was changed. Generated artifacts/logs are not checked in. All heavy
validation jobs run serially; no VM multithreading or emulation is used.

The checked-in JavaScript line count is 231 lines lower than `a7fc652`,
including comments and extensions of existing integration checks. This is
not by itself a performance or correctness argument.

## Native code and snapshot gates — completed

- The default integrated i386 interpreter/collector instruction segment is
  byte-identical throughout the series: 630331 bytes. Refactoring the
  embedding/compiler paths is not claimed to accelerate those instructions.
- Node, js_min and genuine same-seed self-host builds produce identical
  7108408-byte snapshots. SHA-256:
  `f8623d93b4a887acca4de62badc86f06b5e935bc921c08c5509e26e99257f3bc`.
- The final image is 10680 bytes larger than the starting image. Explicit
  metadata and retained diagnostic code have a cost; this is not a snapshot
  size reduction and no source/debug information was stripped.
- Self-hosting rebuilds from current sources. It is not a seed-image copy.
- The isolated `476c904` control reproduces its own reference image exactly.

Build observations (wall seconds / peak RSS KiB):

| Measurement | Control | Candidate |
| --- | ---: | ---: |
| Adjacent Node descriptor prototype | 9.20 / 302920 | 9.16 / 306168 |
| Final Node, including diagnostics | — | 9.06 / 309252 |
| Adjacent self-host, final source | 86.74 / 481408 | 87.22 / 481592 |
| Final js_min | — | 106.25 / 322828 |

The adjacent self-host control is the allocator checkpoint, before the shared
descriptor/diagnostic cutover. These are individual observations, not a
confidence interval or proof of a CPU speedup. Node peak RSS is modestly
higher in the observed pair; self-host RSS is essentially unchanged. Earlier
slower/faster build observations remain in `guest_vm/docs/cleanup.md`.

## Core, GC and heap audits — completed

- Project suite passes on Node and actual i386 js_min: 12 guest programs /
  270 guest assertions per host, plus internal compiler, native/predecoded,
  heap, embedding, continuation and error-location checks.
- CLI smoke paths pass for hello, net, node_web and demos 1/2. The
  three-context multiplexing demo passes on both hosts. These are not a new
  claim of graphical interaction for every demo.
- Bounded structural GC checks pass on both hosts: 27 audits, 111888 checked
  edges, 221 property-index audits and 74 embedding collections. New checks
  cover provider identity, exclusion of the portable free index during native
  ownership and release of borrowed-index state.
- Maximum observed guest-heap bumps remain 3531120 / 3531472 bytes under the
  8 MiB cap. This workload shows no guest-heap growth regression.
- Standalone workload passes 24 rounds / 48 native collections.
- Node and i386 offline marking agree: 37843 reachable records, zero missing
  marks, 455 unreachable occupied records / 85784 bytes. The latter are
  reported, not silently described as reachable or eliminated.

## Broader frozen-source audit — completed

Started around 12:23 UTC. Run Test262, ECMA and a stock Octane image comparison
once for this combined checkpoint, not once per small source edit.

- Full imported Test262: completed around 12:30 UTC. **3292 passed / 0 failed /
  0 timed out / 0 not run / 0 skipped**, all 3292 authored files executed.
  Runner elapsed 471.851133 seconds; summed test time 453.062347 seconds.
  Process wall 472.58 seconds / peak RSS 524532 KiB. Previous cleanup repeat:
  436.840919 seconds / 511672 KiB. Correctness is preserved, but the observed
  8.0% time and 2.5% RSS increases are not silently called parity. Compare an
  adjacent slow-case baseline before attributing the difference to the code.
- Historical ECMA: completed around 12:42 UTC. **990 passed / 339 failed**,
  including **39** timeouts; **4 configured skips / 0 not run**. All 1329
  executable files ran. Specific passing and failing filename sets match the
  previous complete audit exactly: **0 lost passes / 0 new failures**.
  Runner elapsed 675.248083 seconds; process wall 676.71 seconds / peak RSS
  463636 KiB. Previous observation: 685.095617 seconds / 463576 KiB. Time is
  modestly lower in this observation and memory is effectively flat;
  neither is claimed as a statistically established improvement.
- Stock Octane: completed 15:59–16:20 UTC after the reboot. **28 passes /
  0 failures / 0 timeouts / 0 crashes**: both images pass every one of the
  fourteen selected suites. RegExp's much longer stock run was not repeated;
  this is not a full-fifteen stock sweep.
- Live graphics/HTTP and additional integration checks: completed as detailed
  below, with known failures explicitly retained.

Raw outputs stay in ignored `artifacts/cleanup10-*`.

Test262 command:

```sh
./artifacts/js_runner.exe artifacts/cleanup10-final.snap test262_runner.js
```

ECMA command:

```sh
TZ=UTC ./artifacts/js_runner.exe artifacts/cleanup10-final.snap ecma_tests_runner.js
```

A targeted starting-image control of the slow
`ch07/7.8/7.8.5/S7.8.5_A2.4_T2.js` passes in 90.021140 test seconds. The
current full run's same test took 90.145700 seconds; this does not reproduce
the historical 77.740865-second observation on the starting implementation.
A matching targeted candidate run passes in 85.806622 test seconds (97.71
process wall seconds / 380236 KiB peak RSS), versus control 90.021140 test
seconds (102.35 wall / 470896 KiB). The candidate is after the reboot, so
these are not a clean same-boot speedup measurement. They do not reproduce a
clear new slow-case regression; the historical complete-suite difference is
retained above rather than reclassified as a measured improvement.
A system reboot around
15:48 UTC ended the test sequencer after completed ECMA/control logs were
saved; no Octane process had started. Completed suites were not rerun.

## Paired stock Octane scores and peak RSS

Before is the `a7fc652` starting image; after is `cdc4539`. One process runs
at a time, with a 900-second limit per stock suite and unchanged correctness
checks. Scores are higher-is-better observations; RSS is process peak KiB,
not guest live bytes. Adaptive iteration/GC boundaries can change peaks, so
individual lower peaks are not proof of a persistent-memory optimization.

| Suite | Before score | After score | Before RSS KiB | After RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| Richards | 99.1 | 97.9 | 20608 | 20736 |
| DeltaBlue | 94.2 | 94.4 | 58496 | 58496 |
| Crypto | 190 | 190 | 38144 | 38016 |
| RayTrace | 251 | 256 | 417408 | 270208 |
| EarleyBoyer | 463 | 463 | 466944 | 426112 |
| Splay | 737 | 730 | 428032 | 423808 |
| NavierStokes | 276 | 276 | 24448 | 24576 |
| PdfJS | 875 | 876 | 239872 | 240280 |
| Mandreel | 510 | 513 | 497664 | 487212 |
| Gameboy | 1095 | 1101 | 95744 | 95960 |
| CodeLoad | 99.4 | 99.9 | 262528 | 272512 |
| Box2D | 400 | 397 | 92416 | 92672 |
| zlib | 595 | 593 | 103552 | 103552 |
| Typescript | 1411 | 1428 | 466888 | 467100 |

The geometric mean of the fourteen after/before score ratios is **1.00134**
(approximately +0.13%). That finds essentially flat performance in this
pair, not a significant interpreter speedup. RSS is mostly flat, lower for
several adaptive runs, and higher for CodeLoad; the full data are retained.
No Node comparison is newly measured by this guest-image regression sweep.

```sh
node octane_compare.js --reference-snapshot artifacts/strings-final.snap \
  --snapshot artifacts/cleanup10-final.snap --exclude RegExp \
  --output artifacts/cleanup10-octane-paired --timeout 900
```

## Live demos, HTTP and additional integration checks

- Standalone demos 1–7 opened at 320x240 with a 20 FPS limit, accepted input
  and closed normally. Captures were visually inspected for all seven.
  Demo1 accepted text and pointer movement; the model demos accepted camera
  input; demos 6/7 left attract mode and accepted driving input. This is
  functional coverage, not a claim that every demo sustains its FPS limit.
- A bounded Demo8 repeat exercised garage dragging, manual free drive, auto
  drive, reset to rolling mode and menu exit. Garage, field and auto captures
  were inspected. Warm manual/auto readings were 19.8–20.0 FPS; the first
  combined initialization/transition interval was about 16 FPS. Initialization
  took 1918 ms, including 876 ms for the sky. No VM/heap error was reported.
  An earlier orchestration attempt remained in garage mode and was terminated
  by the test driver; it is not counted as a normal-exit pass or a VM crash.
  These bounded checks are not a long soak or a universal minimum-FPS claim.
- Node-hosted native guest Demo1 also opened, accepted text and closed
  normally at 160x120. That is a functional check, not an FPS comparison.
- Standalone net.js and node_web.js both passed localhost checks for generated
  directory listings, default index.html, exact text and binary PNG contents,
  HEAD/Content-Length and 404. Temporary fixture files stayed in artifacts/.
- Standalone JSON checks pass all 12 files / 908 assertions. The shared JSON
  codec and stock Node reference also pass 12/908, as does the Node-hosted
  native guest path and js_min-hosted native guest path. The Node-hosted
  portable interpreter fails one file in
  the full sequence: parse-syntax-errors-02.js reports a non-SyntaxError.
  The isolated earlier 476c904 implementation reproduces the exact 11-pass /
  1-failure result; the selected file alone passes on both. This is a newly
  exercised existing sequence-dependent gap, not a resolved issue.
- The native compiler dependency integration passes nested calls, mutual
  recursion, nine arguments, lifetime and declaration-error checks (seven
  functions). The runner IO integration passes its 94-byte round trip,
  big-endian word and Xauthority checks.
- The native-exit inspector reports a named CALL_REJECT_INTRINSIC_ID and
  filename/line/column on its deliberately stopped CALL. Exit 70 is expected
  for that diagnostic probe, not a passing execution of the whole program.
- The existing extra standalone_language_integration.js still stops at CALL,
  bytecode PC 391, detail 1078 during dynamic library loading. This previously
  documented gap is not hidden by the passing main project suite.

## Why validation took this long

The combined checkpoint ran one full Test262 sweep (7m53s process wall), one
full ECMA sweep (11m17s), and one serial before/after Octane sweep (about
20m45s). Octane means 28 stock benchmark processes, not 14 quick checks.
Each architectural cutover also needed bounded core/GC and genuine snapshot
build/identity gates. Additional slow-case controls investigated the observed
Test262 timing difference instead of silently accepting it. Completed full
suites were not repeated after the reboot; saved logs were reused. The reboot
and interruption gaps are not time spent running tests. The first stalled
Demo8 input-driver sequence added avoidable time; the successful repeat used
bounded per-input operations rather than a long soak.

## Remaining architectural work

This is a first series of cutovers, not completion of every issue in the
[cleanup register](guest_vm/docs/cleanup.md). Ordinary/exotic lookup and
mutation still have overlapping implementations. Broader semantic unification,
embedding-root lifetime APIs, complete adopted source maps and exhaustive
host-transition auditing remain open. The standalone entry stub still prints
the raw diagnostic protocol; symbolic formatting is available to the inspector
and profiler, not claimed as a new default entry-stub feature.
