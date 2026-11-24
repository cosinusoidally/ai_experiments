# Serial ECMA, Octane and build audit — 2026-11-14

## Scope and provenance

Measured implementation: `fa4b98f`, including Penguin runtime fix `3dd1363`.
The only subsequent changes during this run were result documentation/data
(`1a1c7e4`); no VM, harness or external test source was changed.

The artifacts directory had been cleared. A fresh default optimized snapshot
was built with Node and packaged using the repository's JavaScript tool.
The resulting i386 executable passed a small execution check. ECMA ran first,
then all fifteen Octane suites in separate processes, then a genuine
self-hosted snapshot rebuild, then a js_min build. Heavy workloads never
overlapped. No old backup code/executable, C rebuild, Internet fetch, emulation,
new dependency or test-limit relaxation was used.

- Snapshot SHA-256:
  `fe139a4fc965781bc9f9b330f4f8d8c6e13bcf3acfdd1dc7f10a9221e0f4ad2b`.
- Executable SHA-256:
  `5fda56345173eb6aebc62c78593e11068d257bf1fd36dadd8432d23b5c7bb7c0`.
- Temporary raw logs and elapsed-time/RSS receipts: `artifacts/perf-audit/`.
- This is a measurement checkpoint, not a performance fix. Historical
  comparisons are single observations across revisions, not paired attribution
  experiments. Results do not establish that performance was preserved.

## Historical ECMA: one additional non-Date pass, unchanged net total

- **1333 selected / 1329 executed / 996 passed / 333 failed / 39 timed out /
  4 configured skips / 0 not run.** Timeouts are included in failures.
- Harness elapsed **607.564339 s**; process **609.22 s**, peak RSS
  **463836 KiB**, exit **1** (existing failing corpus tests).
- Previous full run: 996 passes / 333 failures, process 618.73 s. Current
  process time is **1.54% shorter**; this is not a paired experiment.
- Newly passing: `ecma_3/Regress/regress-419152.js`. It exercises negative
  numeric array/string properties, the general behavior fixed for Penguin.
- The unchanged total hides that gain: `ecma/Date/15.9.5.23-6.js` fails again
  on fractional-millisecond expectations. Its preceding current-time-sensitive
  pass was explicitly not credited as a Date implementation fix.
- A complete historical **test log only** was recovered from the backup
  checkout; no code or executables were used from it. Its 994/335 totals and
  665285.013-ms time match the documented `bfc122f` run. Exact filename
  comparison: **994 old passes preserved / 2 gained / 0 lost / 0 missing
  statuses**. Gains are the already documented `ecma_2/String/split-002.js`
  and the new `ecma_3/Regress/regress-419152.js`.
- The latest old 996-pass raw log was not recovered; comparison to it uses its
  documented changes, not a claimed raw-log comparison.

All 1333 historical/current statuses are now checked in as
[ECMA_TEST_RESULTS.tsv](ECMA_TEST_RESULTS.tsv). This closes a recordkeeping gap:
the previous per-file records lived only in disposable artifacts.
Full interpretation and historical provenance:
[ECMA_TESTS_STATUS.md](ECMA_TESTS_STATUS.md).
Current ECMA raw-log SHA-256:
`978c16d338263331a02c2f3bae080b3055ff0ccd4b4c6b7b677fb02a3be59757`.

## Stock Octane: all fifteen pass; performance remains below older baseline

All fifteen processes exit **0**, emit their stock aggregate scores and
complete with stock correctness checks. No unsupported-opcode exit, crash or
1800-second watchdog expiry occurred. These are not `--quick` runs.

Scores are higher-is-better. “Nov 13 exe” is the executable column in
[FULL_VALIDATION_2026-11-13.md](FULL_VALIDATION_2026-11-13.md).
“Previous” is the immediately preceding full sweep in
[FULL_VALIDATION_2026-11-14.md](FULL_VALIDATION_2026-11-14.md).
The change column compares current against Previous, not against Nov 13.

| Suite | Nov 13 exe | Previous | Current | Change vs previous | Process s | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 99.9 | 91.2 | 92.6 | +1.54% | 3.36 | 21888 |
| DeltaBlue | 94.8 | 96.7 | 95.4 | -1.34% | 4.56 | 59520 |
| Crypto | 180 | 182 | 177 | -2.75% | 26.05 | 39040 |
| RayTrace | 280 | 273 | 269 | -1.47% | 10.36 | 326784 |
| EarleyBoyer | 483 | 460 | 468 | +1.74% | 26.34 | 467712 |
| RegExp | 2.98 | 2.97 | 2.88 | -3.03% | 570.92 | 467712 |
| Splay | 723 | 647 | 682 | +5.41% | 4.03 | 401792 |
| NavierStokes | 277 | 256 | 256 | +0.00% | 10.75 | 25600 |
| PdfJS | 837 | 753 | 756 | +0.40% | 19.59 | 242536 |
| Mandreel | 511 | 338 | 336 | -0.59% | 127.62 | 500712 |
| Gameboy | 1073 | 800 | 770 | -3.75% | 17.91 | 96364 |
| CodeLoad | 101 | 90.2 | 90.9 | +0.78% | 30.70 | 271488 |
| Box2D | 396 | 391 | 419 | +7.16% | 14.16 | 92672 |
| zlib | 611 | 528 | 531 | +0.57% | 288.10 | 104320 |
| Typescript | 1495 | 1092 | 1274 | +16.67% | 112.35 | 430956 |

- Geometric mean of current/previous aggregate scores: **+1.31%**.
- Geometric mean against the older **executable** scores: **-9.71%**.
- For continuity with the preceding report's different comparison, geometric
  mean against its November 13 **snapshot-launcher** score column: **-6.90%**.
  The preceding report's -8.11% figure used that snapshot column, not the
  executable column. These two historical baselines must not be conflated.
- Relative to the preceding sweep, Gameboy is **3.75% lower**, RegExp
  **3.03% lower**, Crypto **2.75% lower**; Typescript is **16.67% higher**,
  Box2D **7.16% higher**, Splay **5.41% higher**. Improvements do not erase
  the individual decreases or the larger older regressions.
- Total Octane process time: **1266.80 s**, versus **1272.00 s** previously.
  ECMA plus Octane: **1876.02 s (31 min 16 s)**, excluding build/packaging.

These measurements do not isolate which earlier VM change caused the older
regressions, nor prove that the extra numeric-key classification in the latest
patch is free. No performance attribution is claimed without profiling and
controlled comparison.

## Genuine self-hosted build: 9.26% slower than recorded build baseline

The current default executable loads and compiles the current build sources,
reconstructs the runtime and writes a fresh snapshot. The result is compared
byte-for-byte with the Node-built snapshot. It is not copied from the input
snapshot. Both genuine self-hosted and js_min results are identical to the
Node image, with the snapshot SHA-256 above.

| Builder | Process s | Peak RSS KiB | Exit | Snapshot identical |
| --- | ---: | ---: | ---: | --- |
| Node | 9.56 | 299988 | 0 | reference |
| Current standalone executable | 91.77 | 484896 | 0 | yes |
| Existing js_min binary | 110.82 | 305644 | 0 | yes |

The November 13 report records **83.996 s** for its genuine default executable
self-build. Current **91.77 s** is **7.774 s / 9.26% slower**. That is a
historical observation across revisions, not an isolated measurement of the
Penguin change. The old timed executable is no longer available in the current
artifacts directory, so no fresh paired control was run.

On current sources self-hosting is **17.19% faster than js_min**, but has higher
peak RSS. Node remains much faster. No comparable immediate historical js_min
build receipt was recovered, so this report does not claim that js_min build
performance has been preserved.

Logged current build phases, seconds:

| Phase | Self-hosted | js_min | Node |
| --- | ---: | ---: | ---: |
| Source loading, including guest parsing/compilation/module setup | 19.595 | 0.254 | 0.097 |
| Kernel parse and fingerprint | 6.026 | 8.118 | 0.310 |
| Kernel lowering | 6.619 | 11.797 | 0.379 |
| Kernel assembly | 4.546 | 4.531 | 0.613 |
| Runtime construction, including kernel work above | 18.073 | 26.205 | 1.637 |
| Environment installation | 2.044 | 2.971 | 0.306 |
| Standalone runtime preparation | 41.014 | 65.599 | 2.641 |
| Remaining string backing sharing, inside snapshot writing | 10.267 | 14.094 | not separately logged |
| Snapshot writing, including sharing | 10.718 | 14.611 | 4.737 |

Parent/child timings overlap; do not sum all rows. These phases identify where
current time is spent, not where the historical extra 7.774 seconds originated.
In particular, self-hosted “source loading” is not merely disk I/O, and snapshot
writing is not the main cost: standalone preparation and source loading are
larger. The build does not use a native-code cache or skip validation flags.

## Commands

Run from `mmvm_v2_tests`; temporary artifacts stay ignored.

```sh
node guest_runner.js --vm-native --snapshot artifacts/perf-audit/current.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/perf-audit/current.snap artifacts/perf-audit/current.exe
artifacts/perf-audit/current.exe ecma_tests_runner.js

# Each suite runs in its own process, serially:
for suite in Richards DeltaBlue Crypto RayTrace EarleyBoyer RegExp Splay NavierStokes PdfJS Mandreel Gameboy CodeLoad Box2D zlib Typescript; do
    timeout 1800 artifacts/perf-audit/current.exe octane_runner.js --diagnostics "$suite"
done

artifacts/perf-audit/current.exe guest_runner.js --vm-native --snapshot artifacts/perf-audit/self.snap
cmp artifacts/perf-audit/current.snap artifacts/perf-audit/self.snap

LD_LIBRARY_PATH=../../firefox-1.0.8/lib ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native --snapshot artifacts/perf-audit/jsmin.snap
cmp artifacts/perf-audit/current.snap artifacts/perf-audit/jsmin.snap
```

Measured processes used `/usr/bin/time` to save elapsed seconds, maximum RSS
and exit status separately. No Test262 or graphics sweep was repeated for this
request; the preceding Penguin validation remains a separate result.
