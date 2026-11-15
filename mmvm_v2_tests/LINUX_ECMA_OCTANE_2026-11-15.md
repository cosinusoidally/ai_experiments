# Linux ECMA and Octane audit — 2026-11-15

## Scope and provenance

Fresh default optimized standalone executable built from `ae0e709`; VM source
checkpoint `5163ff6`. No VM, harness or external corpus changes during this
audit. Node v24.14.1 is the build host, not the benchmark execution engine.
The executable runs the native i386 guest interpreter on Linux
`6.8.0-149-generic`. Its original input snapshot is moved aside before tests.

- Snapshot: 7,534,408 bytes; SHA-256
  `30b44eac1e4ea85fd59be8305ecd32825fd6f929ce6224cef2756f85957c556c`.
- Executable SHA-256:
  `8423ff1ffe303280190d2988bfee404618c16b349a406d63269dcca31d6f11cc`.
- Raw per-test/per-benchmark logs and GNU time receipts:
  ignored `artifacts/linux-suites-2026-11-15/`.
- ECMA runs first with the existing 10-second per-file watchdog, no total
  instruction cap, and the four explicitly configured historical skips.
- All fifteen stock Octane suites follow, one fresh process per suite, with
  stock correctness checks and `--diagnostics`, not `--quick`. Each suite has
  an outer 1800-second watchdog. No multithreading or overlapping heavy tests.

These are serial measurements, not a controlled attribution experiment.
Historical score comparisons use the latest full executable sweep in
[the November 14 performance audit](PERFORMANCE_AUDIT_2026-11-14.md), not
the more recent three-suite smoke runs.

## ECMA results

- **1333 selected / 1329 executed / 997 passed / 332 failed**, including
  **39 timeouts / 4 configured skips / 0 not run**. Timeouts are included in
  failures. Process exit 1 reflects the existing failing tests.
- Harness elapsed **606.922158 s**; process **608.69 s** (566.45 user,
  32.86 system); peak RSS **463788 KiB**.
- Per-directory pass/fail: ecma **473/147**, ecma_2 **149/23**, ecma_3
  **177/48**, ecma_5 **198/114**. Timeouts respectively **11/0/1/27**;
  all four configured skips are in ecma_3.
- Exact comparison of all 1333 filenames against the previous tracked
  `fa4b98f` results: **996 old passes preserved / 1 gained / 0 lost /
  0 missing statuses**. Only `ecma_5/Number/tonumber-string-hex.js` changes,
  FAIL to PASS. This verifies the shared hexadecimal StringNumericLiteral
  conversion introduced during Windows bring-up; no VM fix was made in
  this measurement turn.
- The previous full run was 996 passed / 333 failed (39 timeouts), four skips,
  zero not run; process **609.22 s**, peak RSS **463836 KiB**. Current time is
  **0.09% shorter**, effectively unchanged in these individual observations.
- [ECMA_TEST_RESULTS.tsv](ECMA_TEST_RESULTS.tsv) retains both historical
  columns and adds the current full per-file result column.

## Stock Octane results

Run in progress. The first five suites pass. RegExp is running; the later
suites have not run yet. No partial benchmark is reported as a score.

| Suite | Nov 14 score | Current score | Change | Process seconds | Peak RSS KiB | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Richards | 92.6 | 93 | +0.43% | 3.36 | 22272 | PASS |
| DeltaBlue | 95.4 | 95.7 | +0.31% | 4.48 | 60160 | PASS |
| Crypto | 177 | 179 | +1.13% | 25.72 | 40704 | PASS |
| RayTrace | 269 | 285 | +5.95% | 10.39 | 210688 | PASS |
| EarleyBoyer | 468 | 482 | +2.99% | 25.12 | 467840 | PASS |
| RegExp | 2.88 | — | — | — | — | Running |
| Splay | 682 | — | — | — | — | Pending |
| NavierStokes | 256 | — | — | — | — | Pending |
| PdfJS | 756 | — | — | — | — | Pending |
| Mandreel | 336 | — | — | — | — | Pending |
| Gameboy | 770 | — | — | — | — | Pending |
| CodeLoad | 90.9 | — | — | — | — | Pending |
| Box2D | 419 | — | — | — | — | Pending |
| zlib | 531 | — | — | — | — | Pending |
| Typescript | 1274 | — | — | — | — | Pending |
