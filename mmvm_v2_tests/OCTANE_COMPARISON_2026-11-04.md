# Octane validation, 2026-11-04

This checkpoint measures the manually committed `fa54ddb` and its predecessor
`28b131f` using unchanged stock Octane workloads. It supersedes the October
31 report as the current checkpoint; the older report remains historical.

## Measurement contract

- Standalone guest: existing i386 ANSI-C launcher, freshly built snapshots
  from each revision's own sources. Image sizes and SHA-256 identities are
  recorded in [VALIDATION_STATUS.md](VALIDATION_STATUS.md).
- Reference engine: Node v24.14.1, x86-64, explicitly `--jitless` for the
  direct-Node comparison. Node is a supervisor/reference, not a guest
  language implementation dependency.
- Host: Linux 6.8.0-138-generic, QEMU Virtual CPU version 2.5+.
- One benchmark process at a time; 900-second wall limit, TERM followed by
  five-second KILL grace. No multithreaded VM optimization is used.
- Stock setup, timed work and correctness checks remain enabled. No files
  under the external `../../js_tests` tree are modified.
- Fourteen suites are paired predecessor/current. The current RegExp suite
  is measured separately because of its much longer runtime; it is not
  silently excluded from the current-status accounting.
- Scores are higher-is-better single observations, not confidence intervals.
  Score ratios are not wall-time ratios: stock Octane adapts repetition
  counts. RSS is process peak resident memory, not just the guest heap.

Reproduce the paired sweep with a fresh output directory:

```sh
node octane_compare.js \
  --reference-snapshot artifacts/validation-control.snap \
  --snapshot artifacts/validation-current.snap \
  --exclude RegExp --output artifacts/validation-octane-paired --timeout 900
```

Direct Node reference invocation for each suite:

```sh
node --jitless octane_node_runner.js SUITE
```

## Predecessor/current stock comparison

The paired sweep ran 13:59--14:20 UTC: **28 passes / 0 failures / 0
timeouts / 0 crashes**. All fourteen selected suites pass both revisions.
RegExp is accounted for separately below. No full-fifteen aggregate is
inferred from this fourteen-suite result.

| Suite | Predecessor score | Current score | Score change |
| --- | ---: | ---: | ---: |
| Richards | 93.2 | 87.4 | -6.2% |
| DeltaBlue | 88.2 | 85.4 | -3.2% |
| Crypto | 177 | 175 | -1.1% |
| RayTrace | 233 | 236 | +1.3% |
| EarleyBoyer | 429 | 421 | -1.9% |
| Splay | 641 | 629 | -1.9% |
| NavierStokes | 251 | 253 | +0.8% |
| PdfJS | 837 | 821 | -1.9% |
| Mandreel | 482 | 509 | +5.6% |
| Gameboy | 1112 | 1072 | -3.6% |
| CodeLoad | 102 | 97.1 | -4.8% |
| Box2D | 394 | 390 | -1.0% |
| zlib | 609 | 561 | -7.9% |
| Typescript | 1362 | 1383 | +1.5% |

The first zlib pair takes 251.40 versus 273.02 seconds, both with 103680
KiB peak RSS. RayTrace's first peak RSS increases from 310016 to 334848
KiB, despite a similar score and process time. These are retained as
potential regressions, not hidden by correctness passing.

### Reversed-order follow-up, 14:21--14:31 UTC

Current runs first in each pair here; the initial sweep runs predecessor
first. All eight follow-up stock runs pass.

| Suite | Predecessor score | Current score | Score change |
| --- | ---: | ---: | ---: |
| Richards | 96.7 | 89.1 | -7.9% |
| RayTrace | 246 | 230 | -6.5% |
| CodeLoad | 87.5 | 87.4 | -0.1% |
| zlib | 587 | 527 | -10.2% |

**Richards and zlib show reproducible lower scores on the current image
across both orderings.** These are performance regressions, not correctness
failures. zlib's repeat takes 260.83 seconds predecessor versus 290.59
current, with 103680 versus 103808 KiB peak RSS. The first CodeLoad decrease
does not reproduce consistently; the follow-up is effectively tied.
RayTrace scores are mixed across pairs and its adaptive-run peak RSS varies:
the repeat is 212608 KiB predecessor versus 340864 current. That warrants
further fixed-workload memory investigation, not a claim that the exact RSS
difference is a stable per-operation cost. No implementation fix is mixed
into this validation checkpoint.

## Complete current status

**All fifteen current stock suites pass: 15 passed / 0 failed / 0 timed out /
0 crashed / 0 skipped.** The separate RegExp measurement completes at
14:44 UTC: score **2.93**, wall **563.66 seconds**, peak RSS **467072 KiB**.
Its direct Node `--jitless` reference scores **1368**, wall **3.39 seconds**,
peak RSS **55772 KiB**. RegExp remains an extreme guest performance weakness;
it is executed and passing, not skipped or declared optimized.

The direct Node reference also passes **15 / 15**, with zero failures,
timeouts, crashes or skips. The table uses the original current sweep, not
cherry-picked repeat scores. The fourteen main Node references run after
RegExp, ending approximately 14:49 UTC. These are same-machine observations
but not a simultaneous/interleaved Node-versus-guest experiment.

| Suite | Current js_runner score | Node --jitless score | Node score advantage |
| --- | ---: | ---: | ---: |
| Richards | 87.4 | 556 | 6.36x |
| DeltaBlue | 85.4 | 711 | 8.33x |
| Crypto | 175 | 569 | 3.25x |
| RayTrace | 236 | 1923 | 8.15x |
| EarleyBoyer | 421 | 2783 | 6.61x |
| RegExp | 2.93 | 1368 | 466.89x |
| Splay, combined | 629 | 3142 | 5.00x |
| NavierStokes | 253 | 833 | 3.29x |
| PdfJS | 821 | 4586 | 5.59x |
| Mandreel | 509 | 1335 | 2.62x |
| Gameboy | 1072 | 3470 | 3.24x |
| CodeLoad | 97.1 | 13854 | 142.68x |
| Box2D | 390 | 1804 | 4.63x |
| zlib | 561 | 812 | 1.45x |
| Typescript | 1383 | 9188 | 6.64x |

### Process time and memory

Wall times include startup, loading/compilation, setup, timed work and
teardown, but exclude snapshot generation. Peak RSS is converted from GNU
time's KiB to MiB (1024 KiB); these are separate-process peaks, not totals
that were resident simultaneously. Adaptive iteration counts and GC phases
can change the observed peaks between runs.

| Suite | Guest wall (s) | Node wall (s) | Guest RSS (MiB) | Node RSS (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Richards | 3.28 | 2.12 | 20.3 | 43.3 |
| DeltaBlue | 4.52 | 2.09 | 53.5 | 46.1 |
| Crypto | 26.23 | 9.55 | 36.8 | 44.4 |
| RayTrace | 12.19 | 3.11 | 327.0 | 46.5 |
| EarleyBoyer | 29.68 | 7.28 | 456.1 | 107.8 |
| RegExp | 563.66 | 3.39 | 456.1 | 54.5 |
| Splay | 4.03 | 2.49 | 378.6 | 270.6 |
| NavierStokes | 10.96 | 4.35 | 23.9 | 48.5 |
| PdfJS | 19.34 | 1.36 | 234.9 | 102.2 |
| Mandreel | 108.15 | 17.42 | 475.8 | 96.0 |
| Gameboy | 13.75 | 3.14 | 93.8 | 77.1 |
| CodeLoad | 28.66 | 2.15 | 256.0 | 129.6 |
| Box2D | 14.80 | 2.52 | 90.3 | 64.6 |
| zlib | 273.02 | 188.17 | 101.3 | 47.5 |
| Typescript | 103.38 | 14.10 | 456.2 | 212.7 |

The fifteen original guest process wall times sum to **1215.65 seconds**
(20.26 minutes); Node sums to **263.24 seconds** (4.39 minutes). This is
total suite turnaround, not an Octane score ratio. Both engines execute
Octane's JavaScript zlib code, not Node's native compression module.

The main remaining weaknesses are RegExp and CodeLoad execution/startup,
large allocation/GC peaks in several object-heavy suites, and the newly
measured Richards/zlib regressions. Passing Mandreel and Typescript is
preserved; the historical October report's failures are no longer current.

Raw logs, measurement JSON, images and binaries remain ignored temporary
artifacts; this report records the completed observations.
