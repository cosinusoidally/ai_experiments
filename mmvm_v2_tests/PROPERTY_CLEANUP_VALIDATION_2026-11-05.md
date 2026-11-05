# Property/root cleanup validation — 2026-11-05

Implementation checkpoint: 0937e5d. Starting checkpoint: 46b4518.
This is a live audit log; pending gates are not passing results.

## Implemented and checked in

- f7fef84: extract allocation-free string-key operations; share packed lookup,
  insertion and clearing across the native and portable record paths. Explicit
  checks remain at the checked API boundary and allocator ownership remains
  outside the leaf operations. Retain rejects foreign-runtime values; public
  root operations reject use after runtime destruction.
- 9537d4f: one execution-root enumerator includes context executions and nested
  synchronous callbacks in both collectors. This fixes the pre-existing JSON
  sequence failure: a live parse result was reclaimed by portable GC because
  only the native collector visited Runtime.activeExecutions.
- 0937e5d: share linked named-property lookup too, including equal-content
  noninterned string references and views. Existing record integration checks
  cover packed and function-owned entries with those keys.

The detailed boundary map and rationale are in
[property-unification.md](guest_vm/docs/property-unification.md).
No demos, C sources, external tests, corpus harnesses or execution limits changed.
Heavy jobs run serially, without threads, Python, downloads or emulation.

## Completed gates

- Node and actual i386 js_min project/core checks pass at the final checkpoint:
  12 guest programs / 270 guest assertions per host, plus existing internal
  compiler, record, embedding, context and execution tests.
- Runtime root integration includes rejection of foreign values and retention
  of an object/Buffer graph across creating-context teardown and collection.
- After the root correction, the unchanged portable JSON sequence passes all
  12 files / 908 assertions on both Node and js_min. Before the correction,
  the complete sequence failed one file on both the baseline and candidate.
- Structural GC passes on both hosts after the root correction: 27 audits,
  111888 checked edges, 221 property-index audits and 74 embedding collections.
  Maximum bumps remain 3531120 / 3531472 bytes under the 8 MiB cap. These
  stress runs precede the final linked-lookup-only change.
- Standalone stress after the packed cutover passes 24 rounds / 48 native
  collections. A final-image repeat is pending.
- Final Node, js_min and true self-hosted builds are byte-identical:
  7110976 bytes, SHA-256
  `c296b7964e3d88084882dbae31ce60243da6f587ffb23258f87246baf07c3538`.
  The snapshot is 2568 bytes larger than the baseline; generated interpreter
  instructions shrink from 630331 to 623304 bytes. No compression or debug
  information stripping was introduced.

Build observations (process wall seconds / peak RSS KiB):

- Node: 8.57 / 290784 (previous checkpoint observation 9.06 / 309252).
- js_min: 99.91 / 321840 (previous observation 106.25 / 322828).
- Self-hosted from the new image: 79.56 / 481696 (previous adjacent candidate
  observation 87.22 / 481592).

These are individual observations, not same-boot controlled speedup claims.
Self-host RSS is effectively flat. An isolated old-source archive is available
for an adjacent control if later measurements require attribution.

## Frozen-source broader audit — pending

- Full imported Test262: **3292 passed / 0 failed / 0 timed out / 0 skipped /
  0 not run**. Runner 426.882453 seconds, summed test time 408.995028 seconds;
  process wall 427.56 seconds / peak RSS 524244 KiB. Previous same-day runner
  observation 471.851133 seconds / 524532 KiB: 9.5% lower time in this run,
  essentially flat memory, not a controlled attribution of the whole change.
- Full historical ECMA: **990 passed / 339 failed**, including 39 watchdog
  timeouts; four configured skips / zero not run. All 1329 executable files
  ran. Exact passing and failing filename sets match the baseline: zero lost
  passes / zero gains / zero new failures / zero missing results. Runner
  elapsed 675.626443 seconds, process wall 677.15 seconds / peak RSS 463484 KiB,
  versus previous 675.248083 seconds / 463636 KiB: effectively flat.
- Paired stock Octane against the starting image, excluding RegExp: completed
  17:47–18:09 UTC. **28 passes / zero failures, crashes or timeouts**. All
  fourteen selected suites pass on both images. This is not a fifteen-suite
  stock run; RegExp was not repeated.
- Final-image structural/standalone GC, bounded interactive demos and HTTP:
  pending.

Raw output stays in ignored artifacts/property-* files. Existing ECMA
failures, configured exclusions and the separate standalone dynamic-library
integration gap are not reclassified as passes by this cleanup.

## Paired stock Octane scores and peak RSS

Before is the starting cleanup10 image (46b4518 / cdc4539 implementation);
after is 0937e5d. Scores are higher-is-better, not process wall-time ratios.
RSS is process peak KiB, not live guest bytes. Adaptive iteration and GC
boundaries can substantially change individual peaks.

| Suite | Before score | After score | Before RSS KiB | After RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| Richards | 95.1 | 96.3 | 20864 | 20864 |
| DeltaBlue | 90.5 | 92.3 | 56192 | 56576 |
| Crypto | 182 | 181 | 37888 | 38016 |
| RayTrace | 242 | 247 | 270208 | 326784 |
| EarleyBoyer | 441 | 447 | 466944 | 466944 |
| Splay | 697 | 700 | 411136 | 413312 |
| NavierStokes | 265 | 265 | 24576 | 24704 |
| PdfJS | 839 | 842 | 240284 | 239484 |
| Mandreel | 476 | 469 | 487384 | 487260 |
| Gameboy | 1002 | 1019 | 95996 | 95976 |
| CodeLoad | 90.4 | 93.2 | 262656 | 262912 |
| Box2D | 360 | 375 | 92672 | 92416 |
| zlib | 567 | 560 | 103680 | 103808 |
| Typescript | 1327 | 1313 | 467100 | 467108 |

The geometric mean of the fourteen after/before ratios is **1.008526**
(+0.85%): essentially flat aggregate performance, not a major CPU gain.
Mandreel, zlib and Typescript have small lower scores; these observations are
retained, not hidden in the aggregate. zlib wall time is 270.05 versus 273.50
seconds. Most RSS observations are close; RayTrace peaks higher by 56576 KiB.
Earlier same-image RayTrace observations also varied substantially with
adaptive GC boundaries. This pair does not establish a general RSS reduction.

```sh
node octane_compare.js --reference-snapshot artifacts/cleanup10-final.snap \
  --snapshot artifacts/property-final.snap --exclude RegExp \
  --output artifacts/property-final-octane --timeout 900
```
