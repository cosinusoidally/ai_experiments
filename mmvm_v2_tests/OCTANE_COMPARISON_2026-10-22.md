# Octane: standalone guest versus Node, 2026-10-22

## Measurement contract

This is a fresh stock Octane 2.0 sweep, not quick correctness and not a
js_min-hosted guest run. Every suite runs in its own process. The original
external sources and validation are unchanged. Node runs all suites first;
the standalone guest then runs them in the same order, one at a time.

- VM source baseline: `31c9ab8` (VM changes through `ef510c9`). Comparison
  harness: `2660824`.
- Node: v24.14.1, x86-64, ordinary default JIT execution.
- Guest: i386 `js_runner.exe`, compiled from the unchanged ANSI C launcher;
  native bytecode interpreter from a freshly generated generic snapshot.
- Host: Linux 6.8.0-138-generic, QEMU Virtual CPU version 2.5+, approximately
  2 GiB RAM. No concurrent benchmark processes.
- Snapshot: 16,266,056 bytes, SHA-256
  `a4cbe306e8cb3214fc3047acaae440d2ed6e59587677e9fa49de7456f95c8dc0`.
  This matches the verified self-hosting image. Its fresh build took 111.96 s,
  excluded from benchmark process times.
- Limit: 900 wall-clock seconds per suite, then TERM with a five-second KILL
  grace period. Core dumps disabled. RegExp was explicitly excluded during
  the run at the user's request; the other 14 suites remain in scope.
- Start: 2026-10-22 07:55 UTC; finish: 08:28 UTC. One stock measurement per engine/suite; these
  are single-run baselines, not statistical confidence intervals.

Higher scores are better. The score advantage is Node score divided by guest
score, rounded to one decimal. It is the normalized Octane comparison, not
the ratio of process elapsed times: adaptive stock suites execute different
repetition counts on different engines. Splay's score includes latency.
Neither engine uses Node's native zlib library for the zlib workload: both
execute Octane's JavaScript implementation.

## Stock scores and status

The requested 14-suite sweep is complete: Node passed all 14; the standalone
guest passed eight and returned native semantic exits for six. None of those
14 runs crashed or timed out. RegExp is excluded at the user's request.
There is no valid full Octane aggregate score for the guest.

| Suite | Node score | Guest score/status | Node score advantage |
| --- | ---: | ---: | ---: |
| Richards | 21,089 | 57.9 | 364.2x |
| DeltaBlue | 51,420 | 65.6 | 783.8x |
| Crypto | 26,717 | 98.5 | 271.2x |
| RayTrace | 43,351 | 201 | 215.7x |
| EarleyBoyer | 40,534 | 91.6 | 442.5x |
| RegExp | 4,941 | Excluded at user request | -- |
| Splay | 5,288 | 586 | 9.0x |
| NavierStokes | 31,102 | 179 | 173.8x |
| PdfJS | 22,631 | Native semantic exit | -- |
| Mandreel | 27,144 | Native semantic exit | -- |
| Gameboy | 35,219 | Native semantic exit | -- |
| CodeLoad | 19,285 | Native semantic exit | -- |
| Box2D | 38,960 | Native semantic exit | -- |
| zlib | 67,054 | 229 | 292.8x |
| Typescript | 34,111 | Native semantic exit | -- |

The Node RegExp measurement had already finished before the exclusion. Its
guest process was manually terminated after 888.76 seconds. The raw
supervisor result therefore says `signal` (exit 143); that is the requested
cancellation, not a native crash, a completed timeout, or a correctness result.
There is no RegExp paired performance result, and no additional RegExp work
is included in this comparison.

## Process elapsed time and peak resident memory

These include startup, source loading/compilation, warmup, measured execution,
and teardown. For failed runs they are time/memory until failure, not valid
performance results. Peak RSS is for the process, not just the guest heap.

| Suite | Node wall (s) | Guest wall (s) | Node RSS (MiB) | Guest RSS (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Richards | 2.08 | 3.65 | 55.5 | 38.3 |
| DeltaBlue | 2.07 | 5.74 | 71.7 | 59.5 |
| Crypto | 4.09 | 40.89 | 59.6 | 55.5 |
| RayTrace | 2.06 | 14.09 | 66.6 | 369.5 |
| EarleyBoyer | 4.10 | 132.68 | 122.1 | 480.0 |
| Splay | 2.27 | 4.82 | 293.3 | 291.6 |
| NavierStokes | 2.07 | 15.55 | 58.8 | 42.5 |
| PdfJS (failed) | 1.28 | 29.25 | 176.5 | 183.9 |
| Mandreel (failed) | 1.64 | 113.11 | 111.9 | 529.3 |
| Gameboy (failed) | 1.14 | 8.83 | 105.8 | 94.9 |
| CodeLoad (failed) | 2.13 | 1.00 | 165.3 | 41.5 |
| Box2D (failed) | 1.09 | 7.60 | 96.7 | 99.4 |
| zlib | 2.33 | 667.38 | 68.0 | 228.1 |
| Typescript (failed) | 3.91 | 24.37 | 260.1 | 175.1 |

## Standalone failures observed

All listed failures returned status 70; no score is assigned. The diagnostic
names below come from the shared bytecode/intrinsic definitions. A CALL exit
is a rejected target or call form, not an unimplemented CALL opcode.

- PdfJS: CALL at PC 81, detail 20 (`CALL_REJECT_INTRINSIC_ID`), allocation 0.
  A native callable's intrinsic ID is outside the supported range; this log
  does not identify the particular callable.
- Mandreel: CALL at PC 98, detail 1011 (intrinsic 11, `Array.push`), allocation
  request 1. This is not evidence that all Array.push calls are unsupported;
  the allocation/call subcase needs separate diagnosis.
- Gameboy: SET_PROPERTY_CONST at PC 472, detail 0, allocation 0.
- CodeLoad: ADD at PC 84, detail 4119, allocation 0. The arithmetic diagnostic
  encodes two reference-tagged operands; ordinary numeric ADD is implemented.
- Box2D: CALL at PC 1024, detail 1078 (intrinsic 78,
  `Object.defineProperty`), allocation 0. This run did not reproduce the
  older recorded SIGSEGV.
- Typescript: the loader reports `unsupported guest module: module`, followed
  by THROW at PC 285, detail 0, allocation 0.

## Interpretation

RayTrace and EarleyBoyer now complete stock standalone runs, and this is the
first recorded full stock standalone zlib score. The zlib result is a normal
ten-iteration Octane run, not its earlier quick check or hosted score of 257.
Its score gap to Node is 292.8x; process elapsed time is 667.38 versus 2.33 s.
For other adaptive suites, the score advantage is the useful normalized
comparison, not the elapsed-time ratio. Splay is closest at a 9.0x score gap;
the other passing suites show approximately 174--784x gaps.

Passing means the unchanged benchmark completed with its own checks. It is
not proof of full ES5.1 conformance or complete bytewise output validation.
Inspection for the subsequent zlib-monitoring work found that this corpus's
driver compares decompressed data with `strcmp`, even though its generated
input starts with NUL. A future diagnostic must compare the entire 100,000
bytes; stock pass/score above is deliberately reported separately from that
stronger validation.

## Reproduction and raw measurements

Run from `mmvm_v2_tests`, using the Node binary to be measured:

```sh
node octane_compare.js --snapshot artifacts/octane-comparison.snap \
  --output artifacts/octane-comparison-new-run --timeout 900
```

The output directory must not already exist. This run's raw logs, individual
GNU time measurements, and incremental JSON results are in ignored
`artifacts/octane-comparison-20261022/`; the supervisor log is
`artifacts/octane-comparison-20261022.log`. Generated files are not committed.
The checked-in supervisor and Node adapter use builtin Node APIs only, ES3
syntax, GNU time/timeout, and the existing `octane_runner.js`. They add no VM
implementation dependency on Node and do not alter guest code or test data.
