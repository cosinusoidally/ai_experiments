# Octane: standalone guest versus Node, 2026-10-30

## Measurement contract

This is a stock Octane sweep, not quick correctness. All 15 suites are in
scope, including RegExp and Mandreel. Each suite runs in a fresh process,
one at a time: Node first, then the standalone guest. The external Octane
sources and their correctness checks are unchanged. No VM implementation,
benchmark or demo changes were made for this measurement.

- VM revision: `bb91f12b89113917b02a2669d17cbdf8e06ea6a4`.
- Node: v24.14.1, x86-64, default JIT enabled.
- Guest: i386 `js_runner.exe`, built from unchanged `js_runner.c` using
  `gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl`.
- Snapshot: 6,119,112 bytes; SHA-256
  `5142d6df3d331a02c338d06a2e680f3bf85709d7db80d55cfc08496174612aaa`.
  Freshly cross-built from the current sources using the existing Node
  builder; this is the same hash verified across Node, js_min and genuine
  self-hosted builds at this checkpoint. Snapshot construction is excluded
  from benchmark times.
- Host kernel: Linux 6.8.0-138-generic; QEMU Virtual CPU version 2.5+.
- Limit: 900 seconds per suite, followed by TERM and a five-second KILL
  grace period. Core dumps disabled. No concurrent benchmark workloads.
- Start: 2026-10-30 15:18:10 UTC.
- Finish: 2026-10-30 15:46:14 UTC; about 28 minutes for the complete sweep.

Reproduction from `mmvm_v2_tests` (use a new output directory):

```sh
node octane_compare.js --snapshot artifacts/regexp-check.snap --output artifacts/octane-2026-10-30 --timeout 900
```

The supervisor uses Node only for orchestration and the direct Node reference.
The guest executes as `artifacts/js_runner.exe SNAPSHOT octane_runner.js SUITE`;
Node does not implement guest language operations. Raw logs and machine-readable
results stay ignored under `artifacts/octane-2026-10-30/`.

Scores are higher-is-better single observations, not statistical confidence
intervals. Node score divided by guest score is the normalized score advantage,
not a process-time ratio: stock Octane adapts repetition counts. Wall time
includes source loading, compilation, setup, warmup, execution and teardown.
Splay's suite score combines throughput and latency.

## Results

**Guest: 11 passed / 4 failed / 0 timed out / 0 crashed / 0 skipped.**
**Node: 15 passed / 0 failed / 0 timed out / 0 crashed / 0 skipped.**

All 30 engine/suite runs completed. Standalone results are listed below;
failed runs have no valid score and their elapsed times measure time to failure.
There is no valid full guest Octane aggregate score while suites remain failing.

| Suite | Node score | Guest score/status | Node score advantage | Guest wall s | Guest peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 20,182 | 98.5 | 204.9x | 3.26 | 19,968 |
| DeltaBlue | 51,089 | 91.1 | 560.8x | 4.36 | 55,424 |
| Crypto | 26,526 | 190 | 139.6x | 23.52 | 38,784 |
| RayTrace | 42,655 | 247 | 172.7x | 11.23 | 234,624 |
| EarleyBoyer | 35,022 | 445 | 78.7x | 28.33 | 531,584 |
| RegExp | 4,582 | 2.66 | 1722.6x | 618.63 | 525,440 |
| Splay | 11,979 | 669 combined | 17.9x | 4.07 | 402,304 |
| NavierStokes | 29,917 | 281 | 106.5x | 9.78 | 24,064 |
| PdfJS | 18,080 | Native semantic exit (70) | -- | 13.51 | 164,956 |
| Mandreel | 24,931 | Native allocation exit (70) | -- | 629.95 | 532,276 |
| Gameboy | 30,362 | 1051 | 28.9x | 13.81 | 110,720 |
| CodeLoad | 17,817 | Native semantic exit (70) | -- | 0.49 | 23,680 |
| Box2D | 36,219 | 376 | 96.3x | 15.08 | 113,792 |
| zlib | 62,348 | 588 | 106.0x | 260.40 | 115,968 |
| Typescript | 31,623 | Loader failure / native THROW (70) | -- | 11.68 | 134,616 |

Splay guest throughput is 420 and latency 1067; Node throughput is 9241 and
latency 15528. The combined suite scores, not throughput alone, are compared.

The full RegExp run passes the unchanged stock checks. It needs 618.63 s,
including setup, warmup and at least 16 measured iterations; the earlier
180-second attempt therefore did not allow enough time. The prior quick pass
(71.63 s) reduced iteration counts and was not a stock score. RegExp's
1722.6x score gap is the largest measured here. This sweep did not separately
profile the regex matcher, allocation, or its JavaScript harness, so that gap
is not attributed to one component without further measurement.

The stock zlib pass retains its existing validation. This sweep does not
rerun the separate compressed/decompressed byte-for-byte monitor; it must not
be represented as an additional binary-output comparison.

### Node process measurements

These are whole-process timings, not the durations used directly to compute
Octane's scores. They include each suite's startup and compilation.

| Suite | Wall s | Peak RSS KiB |
| --- | ---: | ---: |
| Richards | 2.08 | 56,972 |
| DeltaBlue | 2.06 | 73,044 |
| Crypto | 4.07 | 61,868 |
| RayTrace | 2.05 | 65,088 |
| EarleyBoyer | 4.12 | 125,092 |
| RegExp | 2.18 | 84,508 |
| Splay | 2.27 | 294,308 |
| NavierStokes | 2.06 | 60,528 |
| PdfJS | 1.25 | 182,148 |
| Mandreel | 1.69 | 116,692 |
| Gameboy | 1.15 | 103,216 |
| CodeLoad | 2.16 | 158,848 |
| Box2D | 1.10 | 107,496 |
| zlib | 2.51 | 67,196 |
| Typescript | 4.23 | 264,972 |

### Outstanding failures

- PdfJS: `CALL` (opcode 23), PC 81, detail 20
  (`CALL_REJECT_INTRINSIC_ID`), allocation 0. This is the same recorded call
  rejection category, not an absence of ordinary function-call support. The
  log does not identify the rejected callable. Six collections; last live
  bytes 31,289,720.
- Mandreel: `CALL`, PC 112, detail 1011 (`Array.push`, intrinsic 11),
  allocation 1. The guest allocator reaches its 536,870,912-byte maximum:
  14 collections, last live bytes 106,218,432, allocation tail 536,833,256.
  This remains an allocation subcase, not an unimplemented CALL opcode.
  It fails after 629.95 s versus 63.38 s in the previous complete sweep:
  a **9.94x longer time to failure**, not benchmark progress or a score.
  The elapsed regression is recorded; this measurement does not establish
  its root cause. A lower last-live count is not proof of a smaller peak
  working set or a successful allocation strategy.
- CodeLoad: `ADD` (opcode 7), PC 81, detail 4119, allocation 0. The existing
  reference-operand coercion case still fails; numeric addition is implemented.
- Typescript: `unsupported guest module: module`, followed by `THROW`
  (opcode 35), PC 288, detail 0. The environment/loader requirement remains
  unresolved; the failure is not a Typescript correctness pass.

## Comparison with the previous standalone sweep

The [October 27 sweep](OCTANE_SCORES_2026-10-27.md), revision `160e2f4`, had
10 passes and four failures, with RegExp excluded. All ten previous passes
still pass. RegExp is now additionally verified in stock mode; the same four
other suites remain failing. This is a fresh stock rerun, not a comparison
against quick-mode timings.

| Suite | October 27 score | October 30 score | Score change |
| --- | ---: | ---: | ---: |
| Richards | 99.5 | 98.5 | -1.0% |
| DeltaBlue | 90.3 | 91.1 | +0.9% |
| Crypto | 183 | 190 | +3.8% |
| RayTrace | 234 | 247 | +5.6% |
| EarleyBoyer | 442 | 445 | +0.7% |
| Splay, combined | 703 | 669 | -4.8% |
| NavierStokes | 272 | 281 | +3.3% |
| Gameboy | 995 | 1051 | +5.6% |
| Box2D | 311 | 376 | +20.9% |
| zlib | 560 | 588 | +5.0% |

These runs span different source revisions and days. Small differences are
not evidence of a causal improvement or regression without matched repeated
measurements. In particular, Richards and Splay are lower, not uniformly
faster. Box2D has the largest positive observed score change; no benchmark-
specific optimization was added for this sweep.

Memory/performance qualifications:

- zlib's peak RSS is 115,968 KiB versus 263,424 KiB in the previous full
  sweep, **56.0% lower**. A later October 27 memory-focused stock check had
  already reduced it to 133,888 KiB (score 501, 305.42 s); compared with
  that check, current peak RSS is 13.4% lower and the score is 17.4% higher.
  This is not a new claim that all of the memory saving happened since
  the most recent work.
- EarleyBoyer peak RSS increased from 480,000 to 531,584 KiB, **10.7% higher**,
  despite similar scores. The memory improvement is not universal.
- Mandreel's time to failure increased from 63.38 to 629.95 s at similar
  peak RSS (532,096 versus 532,276 KiB). This is an outstanding negative
  result, not hidden by reporting only successful-suite scores.

The fresh default-JIT Node results above supersede the older Node baseline
for this comparison. There is no new `--jitless` run here and no valid full
guest aggregate score. Per-suite score gaps remain substantial even where
correctness passes; the suite is not yet complete or near V8 performance.

## Subsequent CodeLoad bring-up (not a new full sweep)

General guest eval, property and call-forwarding fixes now make CodeLoad pass
both stock workloads. The final standalone image scores **104**, in **28.60 s**,
CPU 27.98 s, peak RSS 393,600 KiB. Current reference scores are 17,817 for
default-JIT Node and 17,757 for jitless Node: respective score gaps 171.3x and
170.7x. The original failing row above remains the historical full-sweep
result, not silently replaced with a later observation.

All eleven previously passing suites also pass quick correctness following
the initial CodeLoad fix; these are not new stock scores. There are now twelve
known stock passes; PdfJS, Mandreel and Typescript remain unresolved. Full
Test262 passes 3292/3292 after the literal-definition correction. See
[CodeLoad bring-up and validation](guest_vm/CODELOAD_BRINGUP.md) for mechanisms,
intermediate regressions, cross-host snapshot identity and follow-up checks.
