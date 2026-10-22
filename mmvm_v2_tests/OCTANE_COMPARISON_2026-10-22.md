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
  grace period. Core dumps disabled. No suite is silently skipped.
- Start: 2026-10-22 07:55 UTC. One stock measurement per engine/suite; these
  are single-run baselines, not statistical confidence intervals.

Higher scores are better. The score advantage is Node score divided by guest
score, rounded to one decimal. It is the normalized Octane comparison, not
the ratio of process elapsed times: adaptive stock suites execute different
repetition counts on different engines. Splay's score includes latency.
Neither engine uses Node's native zlib library for the zlib workload: both
execute Octane's JavaScript implementation.

## Stock scores and status

The sweep is in progress. Pending rows are not passes or failures.

| Suite | Node score | Guest score/status | Node score advantage |
| --- | ---: | ---: | ---: |
| Richards | 21,089 | 57.9 | 364.2x |
| DeltaBlue | 51,420 | 65.6 | 783.8x |
| Crypto | 26,717 | 98.5 | 271.2x |
| RayTrace | 43,351 | 201 | 215.7x |
| EarleyBoyer | 40,534 | 91.6 | 442.5x |
| RegExp | 4,941 | Pending | -- |
| Splay | 5,288 | Pending | -- |
| NavierStokes | 31,102 | Pending | -- |
| PdfJS | 22,631 | Pending | -- |
| Mandreel | 27,144 | Pending | -- |
| Gameboy | 35,219 | Pending | -- |
| CodeLoad | 19,285 | Pending | -- |
| Box2D | 38,960 | Pending | -- |
| zlib | 67,054 | Pending | -- |
| Typescript | 34,111 | Pending | -- |

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
