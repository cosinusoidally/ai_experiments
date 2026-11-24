# Standalone Octane stock scores, 2026-10-27

## Measurement contract

Fresh measurements using source revision `160e2f4`, not quick correctness.
Each unchanged external Octane suite runs in its own i386 `js_runner` process,
one at a time. No benchmark, demo, external test or VM implementation changes
were made for this sweep. RegExp remains excluded at the user's request.
Node was not rerun; these are current standalone scores, not a new paired
Node comparison.

The launcher was compiled from the unchanged `js_runner.c` with
`gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl`. The generic image
was freshly built with js_min and the Firefox library directory supplied in
`LD_LIBRARY_PATH`. Build time was 94.06 s, excluded from benchmark timings.

- Snapshot size: 5,945,208 bytes.
- Snapshot SHA-256:
  `dcc73c1e8fde99b54226bfcf1dacd6f36847a17e29c131d7feedc6e481d88e74`.
- Host kernel: Linux 6.8.0-138-generic.
- Per-suite limit: 900 wall-clock seconds, TERM then five seconds before KILL.
  Core dumps disabled. No concurrent benchmark processes.
- Start: 2026-10-27 15:19:25 UTC; finish: 15:27:38 UTC.

The command for each suite is:

```sh
./artifacts/js_runner.exe artifacts/snap octane_runner.js SUITE
```

GNU `time` measures the entire process, including startup, guest source
compilation, warmup, measured execution and teardown. Raw output and timing
files are temporary artifacts in `artifacts/octane-2026-10-27/`; only this
human-readable report is checked in. Failed runs have no valid score, and
their times measure time to failure rather than benchmark performance.
Scores are single-run observations, not statistical confidence intervals.

## Results

All 14 requested suites were attempted: **10 passed, four failed, zero timed
out and zero crashed**. RegExp is excluded, not an attempted failure. There
is no valid full Octane aggregate score while four suites remain incomplete.

| Suite | Stock score/status | Wall seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: |
| Richards | 99.5 | 3.44 | 21,248 |
| DeltaBlue | 90.3 | 4.57 | 57,088 |
| Crypto | 183 | 25.22 | 44,672 |
| RayTrace | 234 | 12.29 | 262,912 |
| EarleyBoyer | 442 | 29.15 | 480,000 |
| Splay | 703 combined | 4.04 | 414,720 |
| NavierStokes | 272 | 10.21 | 25,344 |
| PdfJS | Native semantic exit (70) | 16.24 | 187,776 |
| Mandreel | Native allocation exit (70) | 63.38 | 532,096 |
| Gameboy | 995 | 15.97 | 116,992 |
| CodeLoad | Native semantic exit (70) | 0.59 | 24,704 |
| Box2D | 311 | 18.74 | 133,888 |
| zlib | 560 | 273.53 | 263,424 |
| Typescript | Native semantic exit (70) | 15.34 | 180,096 |
| RegExp | Excluded at user request | -- | -- |

Splay reports throughput **458** and latency **1077**; its combined stock
score is **703**. All reported passes retain the stock correctness checks.
This run does not add the separate zlib byte-for-byte monitoring comparison:
stock zlib's existing `strcmp` check is weaker than full binary comparison,
as documented in the October 22 report.

## Failure diagnostics

- PdfJS: `CALL` (opcode 23), PC 81, detail 20
  (`CALL_REJECT_INTRINSIC_ID`), allocation 0. The intrinsic ID is outside
  the native interpreter's supported range; this diagnostic does not name
  the particular callable. GC count 11, last live bytes 51,108,720.
- Mandreel: `CALL`, PC 98, detail 1011 (`Array.push`, intrinsic 11),
  allocation 1. This reproduces compiler allocation pressure at the existing
  536,870,912-byte guest-heap maximum: 17 collections, last live bytes
  287,598,904, allocation tail 536,869,976. Ordinary CALL and Array.push
  are implemented; this is an allocation subcase, not an absent opcode.
- CodeLoad: `ADD` (opcode 7), PC 81, detail 4119, allocation 0. This
  remains a reference-operand coercion exit, not missing numeric addition.
- Typescript: `unsupported guest module: module`, followed by `THROW`
  (opcode 35), PC 285, detail 0, allocation 0. Seven collections, last live
  bytes 43,203,568. No score is assigned.

## Comparison with the previous complete sweep

The October 22 sweep had eight passes and six failures. Box2D and Gameboy
now pass full stock execution; the other eight previously passing suites
still pass. PdfJS, Mandreel, CodeLoad and Typescript remain unresolved.

For example, zlib's stock score is now 560 versus 229, with process elapsed
time 273.53 s versus 667.38 s. These are different source revisions and
single runs on different days, not controlled statistical measurements.
Splay's combined score is now 703 versus 586, while its throughput subscore
is 458; do not compare the throughput subscore with the earlier combined
score. There is no fresh Node result in this report. The historical paired
comparison is [OCTANE_COMPARISON_2026-10-22.md](OCTANE_COMPARISON_2026-10-22.md).

