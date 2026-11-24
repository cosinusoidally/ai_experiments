# Bootstrap compatibility regression validation — 2026-11-14

Status: **complete**. VM implementation under test:
`8767315`; documentation checkpoint `9140cbf`. No external corpus, application
source, test selection or execution-limit changes.

## Method and already completed checks

Run one memory-heavy workload at a time. Existing i386 binaries execute
directly; no emulation, threads, downloads or C modifications. Generated
snapshots, executables, logs and timing receipts remain in ignored artifacts.

- The unchanged mishmashvm full bootstrap passes in its original directory,
  with all eight final objects byte-identical to a sequential local jsshell
  reference. Guest 233.45 seconds / 558340 KiB peak RSS; jsshell 12.10 seconds /
  79616 KiB. This is functional, not performance parity.
- Node and js_min core suites pass: each 12 guest programs / 270 assertions,
  plus the internal heap/compiler/interpreter checks.
- Standalone shell/FFI integration passes, including native pointers, typed
  byte sources, radix formatting and binary-read type identity.
- The default standalone image genuinely rebuilds itself from source and
  produces a byte-identical image. Image SHA-256:
  `bb81fe1510cac443237486f912b50c9f97c725d300a9604c227fa686c2f79b91`.
- Full Test262: 3292 passed / zero failed / zero timed out / zero not run.
  Harness elapsed 340626.683 ms versus previous 340013.538 ms; this single
  0.18% difference is not evidence of a performance regression.
- Packaged default executable: all eight bounded demos, three HTTP servers
  and seven supplementary checks, including structural GC, pass with its
  input snapshot absent. These are not long endurance tests.

See [bootstrap details and reproduction](guest_vm/MISHMASHVM_BOOTSTRAP.md).

## Remaining full-suite runs

The measured default executable is `artifacts/bootstrap-regression.exe`:
SHA-256 `4f93cd633eb7112cf5f6c3ef8637e108084d0bde47600b14d4dcaeb7285575c7`.
It is distinct from the shell-policy `artifacts/js` used by mishmashvm.

ECMA uses the existing default four configured skips, no total instruction
cap and its unchanged 10-second per-test watchdog. Preserve known failures
as failures and compare actual filenames, not just pass totals. The complete
archived acceptance log has SHA-256
`e46a60d6ef05b0dd94b40d46d1062bc5b58a667ecf34c1717d5cd534642a60fa`:
994 pass / 335 fail, including 39 timeouts / four skips / zero not run.

Each of the 15 stock Octane suites runs separately with normal setup,
warmup, timing and correctness checks, not `--quick`. A 1800-second process
watchdog bounds each suite. RegExp and Mandreel are included. Commands:

```sh
artifacts/bootstrap-regression.exe ecma_tests_runner.js
artifacts/bootstrap-regression.exe octane_runner.js --diagnostics SUITE
```

Full logs and per-process time/RSS receipts:
`artifacts/bootstrap-final-suites/`. Previous full comparison:
[November 13 validation](FULL_VALIDATION_2026-11-13.md). Different-revision
single observations alone do not attribute a timing change to a particular
bootstrap fix.

## ECMA complete

- 1333 selected / 1329 executed / **996 passed / 333 failed**, including
  **39 timeouts**, four pre-existing configured skips, zero not run.
- Exact comparison of all 1333 filename statuses with the archived acceptance
  log: **zero lost passes, two gained passes, zero missing results**. The only
  changed statuses are FAIL to PASS:
  - `ecma/Date/15.9.5.23-6.js` (uses current-time input; the archived failure
    expected fractional milliseconds, so do not claim this as a Date fix).
  - `ecma_2/String/split-002.js` (archived failure: non-callable value).
- All 994 baseline-passing files still pass. Known failures remain failures;
  exit 1 is expected for this corpus and is not silently counted as success.
- Harness elapsed 617095.672 ms; process 618.73 seconds; peak RSS 463860 KiB.
  Previous full executable observation: 654.192 s harness / 654.485 s process,
  463832 KiB RSS. One observation is not a controlled timing attribution.

## Stock Octane complete: 15/15 passed

All 15 processes exited zero, each emitted its stock score, and none reported
`FAILED`, an unsupported-opcode exit or a segmentation fault. No watchdog
expired. No VM or test code changes were made during this sweep.

Scores are higher-is-better single observations. The comparison column is
the November 13 full snapshot run, not a freshly paired control. Revisions
and launchers differ, so a score change alone does not establish that one of
the bootstrap fixes caused it. Keep lower observations visible.

| Suite | Nov 13 score | Current executable score | Process seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| Richards | 94.2 | 91.2 | 3.51 | 21632 |
| DeltaBlue | 89 | 96.7 | 4.47 | 59264 |
| Crypto | 169 | 182 | 25.47 | 39040 |
| RayTrace | 261 | 273 | 10.27 | 320384 |
| EarleyBoyer | 443 | 460 | 26.44 | 467712 |
| RegExp | 2.82 | 2.97 | 553.71 | 467840 |
| Splay | 692 | 647 | 4.15 | 395264 |
| NavierStokes | 275 | 256 | 10.75 | 25600 |
| PdfJS | 829 | 753 | 20.02 | 224672 |
| Mandreel | 516 | 338 | 128.80 | 500624 |
| Gameboy | 1070 | 800 | 17.52 | 96256 |
| CodeLoad | 100 | 90.2 | 32.60 | 272768 |
| Box2D | 396 | 391 | 15.18 | 92800 |
| zlib | 612 | 528 | 289.98 | 104320 |
| Typescript | 1496 | 1092 | 129.13 | 467632 |

### Performance qualification and outstanding work

This is **not** an all-clear performance result. The geometric mean of the
15 current/November-13 score ratios is **0.91894 (8.11% lower)**. In particular:

- Mandreel: 338 versus 516, **34.50% lower**.
- Gameboy: 800 versus 1070, **25.23% lower**.
- Typescript: 1092 versus 1496, **27.01% lower**.
- zlib: 528 versus 612, **13.73% lower**.
- PdfJS and CodeLoad are also about 9--10% lower. Other suites improve;
  those improvements must not hide the individual decreases.

These large differences warrant investigation, not dismissal as ordinary
noise. The historical comparison spans earlier VM cleanup changes as well
as the bootstrap bring-up and is not a fresh paired experiment. It does not
isolate which revision caused each decrease. Establish that with frozen,
paired images before attributing or fixing it. One code-review candidate is
the general integer/radix formatting path, whose wider unsigned support now
uses quotient decomposition; its workload contribution has **not** been
profiled here. No benchmark-specific workaround or timing-limit relaxation
was introduced to make the results look better.

### Why the remaining validation took this long

One serial ECMA pass took 618.73 seconds, followed by 1272.00 seconds total
for the 15 Octane processes: **31 minutes 31 seconds** altogether, excluding
minor supervision overhead. RegExp alone took 553.71 seconds, zlib 289.98,
and the ECMA run included 39 existing ten-second per-test watchdog limits.
No complete corpus or Octane sweep was repeated in this final testing task.
The previously completed bootstrap, Test262, core and demo checks were not
rerun here.

## Final status

- No previously passing ECMA filename was lost; all 994 baseline passes
  remain passing, with the two additional passes identified above.
- The full bootstrap, Test262, all stock Octane suites, core, structural GC,
  self-hosting and bounded demo/server checks pass in their documented scope.
- ECMA still has 333 failures (39 timeouts included) and four pre-existing
  configured skips. Do not call the complete historical corpus passing.
- Performance concerns above remain outstanding. This task finishes the
  testing and records them; it does not claim to have resolved them.
