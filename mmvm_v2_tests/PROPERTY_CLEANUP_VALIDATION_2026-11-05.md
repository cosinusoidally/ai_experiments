# Property/root cleanup validation — 2026-11-05

Implementation checkpoint: 0937e5d. Starting checkpoint: 46b4518.
The combined audit is complete within the stated scope. Additional Node-hosted
guest graphics limits below are not silently converted into passing results.

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
- Final-checkpoint structural GC passes on both hosts: 27 audits,
  111888 checked edges, 221 property-index audits and 74 embedding collections.
  Maximum bumps remain 3531120 / 3531472 bytes under the 8 MiB cap. These
  stress runs were repeated after the final linked-lookup change.
- Final-image standalone stress passes 24 rounds / 48 native collections.
- Final Node and i386 snapshot audits agree: 37936 reachable records / zero
  missing marks. They report 456 unreachable occupied records / 85984 bytes,
  versus baseline 455 / 85784; this occupancy is not claimed to be eliminated.
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

## Frozen-source broader audit — completed

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
- Final-image structural/standalone GC and snapshot audits: pass, as above.
- Bounded standalone demos 1–8, direct-Node demos 1–7 and HTTP checks: pass
  in the paths detailed below. The extended Node-hosted guest graphics matrix
  is incomplete and must not be confused with direct Node execution.

Raw output stays in ignored artifacts/property-* files. Existing ECMA
failures, configured exclusions and the separate standalone dynamic-library
integration gap are not reclassified as passes by this cleanup.

## Graphics, HTTP and remaining integration checks

- Standalone demos 1–7 and direct-Node demos 1–7: opened at 320x240 / 20 FPS
  limit, accepted keyboard/pointer input, produced captures and exited normally.
  All fourteen captures were visually inspected. Demos 6/7 left attract mode
  and accepted driving input. This is bounded functional coverage, not a claim
  that every standalone demo sustains 20 FPS.
- Standalone Demo8: garage dragging, manual free drive, auto drive, reset to
  rolling mode and menu exit pass. Garage/field/auto captures were inspected.
  Initialization took 2168 ms, including 957 ms for the procedural sky.
  Warm auto logs report 20.0 and 19.8 FPS; a transition-containing interval is
  16.0 FPS. The field capture reports 20 FPS. No VM or heap error occurred.
  These checks are not a long soak or a universal minimum-FPS guarantee.
- Additional Node-hosted guest probes use --vm-native at 160x120, distinct
  from direct Node: demos 1 and 3 have rendered captures and normal exits.
  An initial Demo2 readiness probe did not finish within its orchestration
  bound; a matched old/current retry exits normally on both, but both captures
  at four seconds are still black. This is not accepted as a visual pass.
  A broader probe stops at Demo4 before initialization; the previous source
  also fails to initialize Node-native Demo4 within a 20-second observation.
  A current portable Demo4 observation likewise ends before initialization.
  These observations do not establish a new regression, a complete guest-Node
  graphics matrix, or performance parity for that slow backend path. Guest-Node
  demos 5–7 were not reached by the stopped probe. The ordinary direct-Node
  matrix and complete standalone matrix above are separate successful runs.
- Standalone net.js and node_web.js: generated listing without index.html,
  default index.html after its creation, exact text/PNG bytes, HEAD with exact
  Content-Length and 404 all pass on localhost. Test fixtures remain ignored
  under artifacts/. Server shutdown after requests is intentional.
- Final standalone, Node-hosted portable/native guest, shared-codec and stock
  Node reference JSON runs each pass 12 files / 908 assertions. The js_min
  portable run after the root correction also passes 12/908. The existing JSON
  sequence is the regression coverage for the callback-root fix; no JSON-only
  retention rule or new language micro-test suite was introduced.
- Standalone NativeCompiler dependency integration passes seven functions,
  nested calls, mutual recursion, nine arguments, lifetime and declaration
  errors. Runner IO passes its 94-byte round trip, BE word and Xauthority
  checks. The three-context multiplexing demo passes on Node and js_min,
  completing exactly 100 calls before shutting down cx_a/cx_b and then cx_c.
- The existing extra standalone_language_integration.js still exits 70 at
  CALL PC 391 / detail 1078 during dynamic-library loading. It is unchanged
  from the baseline and is not hidden by the project-suite pass.

## Scope, remaining work and validation cost

Shared storage lookup/publication/clearing is implemented. ES5 descriptor
policy, exotic dispatch and other higher-level Runtime/native overlap remain
explicit; this is not a claim that all semantic duplication has disappeared.
The root correction unifies execution ownership, not every collector operation.

One full imported Test262 sweep took 7m08s process wall, one complete ECMA
sweep took 11m17s (including 39 ten-second watchdog failures), and the paired
stock Octane sweep took about 22 minutes. Both benchmark images were measured
serially for a current controlled comparison. No complete corpus sweep was
repeated for an intermediate edit. Intermediate core/build/GC gates and the
additional Node graphics probes add time; the latter did not yield a complete
matrix and their limits are retained above. Future small cutovers should prefer
focused existing record/context checks before the final broad gate.

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
