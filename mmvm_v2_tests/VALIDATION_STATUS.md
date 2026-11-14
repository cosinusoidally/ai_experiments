# Validation checkpoint, 2026-11-04

Shell-eval/SDL checkpoint, 2026-11-14: contract 107 adds shared `-e`/`-f`
source actions, Uint8ClampedArray and guest-owned native PRNG state. Unchanged
mishmashvm test(0) matches all nine jsshell C return values; test(1) displays
changing 640x360 static, accepts keys and exits zero on normal window close.
Core passes 12 programs / 310 assertions on Node and js_min; full Test262
passes 3292/3292 (368.95 s, slower than the preceding 340.63-s observation).
GC, all bounded demo/server/supplementary checks and the full bootstrap pass.
Final Node/js_min/self-hosted shell snapshots match byte-for-byte, including
a build with inline source after snapshot generation. Diagnostic-only CLI
follow-up uses focused checks rather than another full corpus run. No new
ECMA/Octane sweep or performance-neutrality claim is made. See
[the implementation and validation record](guest_vm/docs/shell.md).

Latest bootstrap regression audit, 2026-11-14: implementation `8767315`,
packaged default executable completes full Test262 **3292/3292** and all
**15 stock Octane suites**. Historical ECMA: **996 pass / 333 fail**, including
39 timeouts / four configured skips / zero not run; all 994 archived passing
filenames are preserved, with exactly two FAIL-to-PASS changes. Core on Node
and js_min, structural GC, genuine bit-identical self-build, and bounded
demos 1--8/HTTP/supplementary checks pass. The unchanged full mishmashvm
bootstrap produces all eight objects byte-identically to jsshell.
**Performance is not uniformly preserved against the older full-run
baseline:** Octane score-ratio geometric mean is 8.11% lower, with significant
Mandreel, Gameboy, Typescript and zlib decreases requiring investigation.
This is not a newly paired attribution experiment. See the
[complete results and qualifications](FULL_VALIDATION_2026-11-14.md).

Latest full audit, 2026-11-13: implementation `75860af`, both standalone
launchers complete **54 jobs / zero unexpected failures**. Test262 is
3292/3292 on each; ECMA is 994 pass / 335 known failures, with the exact
1333 filename statuses unchanged. All 15 stock Octane suites, demos 1–8,
HTTP, core, GC and both genuine bit-identical self-builds pass. Portable
Node/js_min core, four-path structural GC, 14 supplemental checks, packaging
and debugger checks also pass. No correctness fixes were needed. See
[full results, timings, RSS and baseline comparisons](FULL_VALIDATION_2026-11-13.md).
In particular, the short demo samples are not sustained-performance proof,
and known ECMA failures are not counted as passes.

Latest completed acceptance, 2026-11-12: frozen `bfc122f`, native contract 103,
runs the complete core, imported Test262, historical ECMA, all 15 stock Octane
suites, bounded demos 1–8/HTTP, GC and supplementary integration through both
the normal snapshot loader and the packaged executable. Snapshot inputs were
deleted before executable runs. Test262 is 3292/3292 with clean exit 0; ECMA
is 994 passed / 335 known failures (39 timeouts included), four pre-existing
configured skips, zero unrun tests. All per-file statuses match between
launchers; no previously passing baseline file is lost. Both genuine
self-hosted rebuilds are bit-identical. The structural GC audit and all seven
supplementary programs pass on both paths. Final acceptance reports zero
unexpected failures. See [the complete report and score comparison](SNAPSHOT_EXE_ACCEPTANCE_2026-11-11.md).
The older checkpoints below remain historical observations, not the current
acceptance totals.

2026-11-05 follow-up: [property/root unification validation](PROPERTY_CLEANUP_VALIDATION_2026-11-05.md)
is complete for implementation `0937e5d`. Test262 passes 3292/3292; ECMA
preserves the exact 990 passing and 339 failing filenames. All fourteen
selected stock Octane suites pass on both images, with +0.85% aggregate score
and small individual slowdowns retained in the report. Node/js_min/self-host
images match; GC and snapshot audits pass. Standalone demos 1–8, direct-Node
demos 1–7 and HTTP checks pass in bounded paths. The portable JSON GC defect
is fixed. Extra Node-hosted guest graphics probes have documented bounds and
are not a complete passing matrix; the older standalone integration gap remains.

2026-11-05: the next [combined cleanup audit](CLEANUP_VALIDATION_2026-11-05.md)
is complete for `cdc4539`. Core/GC and cross-host/self-hosted snapshot
gates pass; complete Test262 passes 3292/3292. ECMA preserves the exact
990-pass / 339-failure sets (39 timeouts / 4 skips / 0 not run). All fourteen
selected stock Octane suites pass on both images; aggregate scores are flat
(+0.13%). RegExp was not repeated. Live demos 1–8 and HTTP checks pass in the
documented bounded paths. Existing standalone and portable JSON gaps remain.
Slower historical Test262 timings are recorded, with targeted controls, rather
than claimed as a performance improvement. See the report for scope and RSS.

The subsequent [full cleanup validation](CLEANUP_VALIDATION_2026-11-04.md) is
complete for implementation `430cad1`: no lost ECMA pass, complete Test262 and
all 15 stock Octane suites pass, project/GC/snapshot gates and live demos pass.
Existing standalone-only gaps remain; Gameboy's paired score is lower and
build timings vary. See that report for the current qualifications. The results
below remain the earlier `fa54ddb`/`28b131f` audit, not cleanup measurements.

This checkpoint validates the manually committed `fa54ddb` against its
predecessor, `28b131f`. It does not introduce further VM features or change
the external corpora, demo sources, test selection or execution limits.
Measurements run sequentially, with no concurrent heavy workloads.

**Conclusion:** no newly lost correctness pass was found in the controlled
ECMA comparison, the complete imported Test262 suite, or the stock Octane
sweep. Demos and HTTP examples work in the exercised paths. However,
**Richards and zlib performance regressed**, and self-hosted builds take
longer in both measured orderings. There is also an existing failure in an
extra standalone language-integration script on both revisions. This is not
an all-green or performance-neutral checkpoint.

## Image identity and completed structural checks

- Native interpreter contract: 98.
- Current image: 7,082,992 bytes; SHA-256
  `64797ec1df9d1373589759f032c8d0a7fcc9328b57d691052c00678868651a5c`.
- Predecessor image: 7,036,912 bytes; SHA-256
  `a1a83f6fe84bd25e0b1ddc6bd88c06ed9f6e4d0a5d18c0b9e28bcfba0160b334`.
- Project suite passes under both Node and js_min: 12 guest programs and
  270 assertions on each host, plus runner stdout, CLI and three-context
  multiplexing checks.
- Bounded GC stress passes on both embedding hosts: 27 structural audits,
  111,888 checked edges, 221 property-index audits and 74 embedding
  collections per host. Maximum observed heap bump is 3,531,120 bytes on
  Node and 3,531,472 on js_min, below the configured 8 MiB cap.
- Standalone GC stress passes 24 rounds with 48 native-counter collections.
- The snapshot gate passes: different launch arguments/environments do not
  change the image; Node and js_min builds are byte-identical; the standalone
  VM genuinely rebuilds from source to the same fixed point. Hello, an
  alternate program and fresh launch-environment checks pass.

The bounded GC checks are evidence against the exercised corruption paths,
not proof that every possible GC lifetime defect has been eliminated.

## Reproduction and scope

Run from this directory. `artifacts/` contains temporary output only.

```sh
guest_vm/tests/run_tests.sh both
node guest_vm/tests/gc_stress.js
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_vm/tests/gc_stress.js
./artifacts/js_runner.exe artifacts/validation-current.snap \
  guest_vm/tests/gc_stress_workload.js
guest_vm/tests/run_standalone_snapshot_test.sh both
```

The ECMA comparison uses `TZ=UTC` on both guest revisions and direct Node.
The predecessor runs from an isolated archive of its own source tree: its
embedding tests must not accidentally load the current standard-library
files. The external `js_tests` tree is read-only throughout.

## ECMA corpus

The fresh current-image run completes in 666.732540 seconds:

- Selected: 1,333 files; executed: 1,329; not run: 0.
- Passed: 990; failed: 339, including 39 watchdog timeouts.
- Skipped: the same four documented slow cases; no new exclusions.
- `ecma`: 472 passed / 148 failed / 11 timed out.
- `ecma_2`: 148 passed / 24 failed / 0 timed out.
- `ecma_3`: 175 passed / 50 failed / 1 timed out / 4 skipped.
- `ecma_5`: 195 passed / 117 failed / 27 timed out.

The predecessor completes in 670.498398 seconds with 963 passes / 366
failures, including 39 timeouts, and the same four skips. Specific filenames
confirm **963 preserved / 27 gained / 0 lost**. These reproduce the preceding
documented correctness results. The approximately 0.6% elapsed difference
is not a meaningful performance gain.

Direct Node completes in 127.018057 seconds: 1,218 passed / 111 failed /
0 timed out / 4 skipped / 0 not run. The guest matches 961/1,218 specific
Node passes (78.90%); 257 remain failing, comprising 81 in `/Date/`
directories and 176 elsewhere. Non-Date directory parity is 868/1,044
(83.14%). The earlier status prose's 867/1,043 was an off-by-one reporting
discrepancy. The 29 guest-only passes do not compensate for any Node-only
failure. No current ECMA failure line reports an invalid/freed heap reference
or heap corruption.

## Test262

The complete imported suite passes **3,292 / 3,292**, with **0 failed /
0 timed out / 0 not run**. Elapsed time is **455.714562 seconds**, with
439.551291 seconds summed per-test time. The same final image previously
took 489.537720 seconds; this repeated observation is not a code speedup.
Selection, harness and limits are unchanged. This import does not include
every ES5.1 built-in chapter, so this result is not full ES5.1 compliance.

## Additional existing integration checks

- Everyday JSON selection: all 12 files / 908 assertions pass in stock
  Node, the shared codec on Node, the js_min-hosted guest and the standalone
  image.
- NativeCompiler dependency test passes on Node, direct js_min and the
  standalone image: seven recursively collected functions, nested/mutual
  calls, nine arguments, lifetime checks and declaration errors.
- `guest_vm/tests/self_hosted_frontend_test.js` completes successfully under
  the standalone image. The existing self-hosted file compiler also compiles
  `demo8.js` successfully.
- **Outstanding existing failure:** the extra
  `guest_vm/tests/standalone_language_integration.js` exits 70 during its
  dynamic-library/indirect-eval section, at CALL bytecode PC 391, detail 1078
  (intrinsic diagnostic base plus `OBJECT_DEFINE_PROPERTY`). The predecessor
  fails at the same opcode, PC and detail. This is not a newly lost pass,
  but means the entire collection of integration scripts is not green.
  Earlier typed-view, buffer, source-retention and numeric checks in that
  file complete; later checks are not reached. It is not part of the default
  twelve-program project suite.

## Live demos

Demos 1--7 pass live X11 smoke checks on both Node and the standalone image:
320x240, 20 FPS requested, approximately 18 seconds of animation per demo
before input/capture/shutdown. The sweep sends pointer/keyboard input and
starts human control in the rally demos, then exits through Escape with
status zero. Captures were visually inspected for expected content.

Observed console FPS ranges, including startup samples:

| Demo | Node | Standalone guest |
| --- | ---: | ---: |
| 1 | 19.5--20.0 | 2.2--2.4 |
| 2 | 20.0--20.3 | 1.9--2.2 |
| 3 | 20.0--20.2 | 3.1--3.2 |
| 4 | 20.0--20.1 | 3.0--3.1 |
| 5 | 20.0--20.4 | 1.7--2.1 |
| 6 | 20.0--20.4 | 1.4--1.6 |
| 7 | 20.0--20.3 | 2.2--2.4 |

The early guest demos remain slow; requesting 20 FPS is not achieving it.
These are bounded functional observations, not a controlled predecessor
performance comparison or a substitute for the separate collector audits.

Demo8 passes the same approximately 85-second mode sequence on both current
and predecessor images: attract, garage and camera drag, manual free-drive
with held steering/throttle, and track auto-drive, followed by menu quit.
Captures show the garage floor, car/windows/wheels, field, sky and auto-drive
scene. Current steady garage samples are 19.7--20.0 FPS; free-drive
19.6--20.0; auto-drive 19.8--20.1. The predecessor is respectively
19.5--20.0, 19.6--20.0 and 19.7--20.1. Garage transition samples are 16.5
and 16.7 FPS. This finds no material Demo8 performance difference, but is
not a claim of a perfectly sustained 20 FPS or long-duration stability.
Demo8 uses the compiled-native rasterizer by default; it is not a direct
Node-compatible demo. No demo code was changed.

## HTTP examples

Both `net.js` and `node_web.js` pass live localhost checks under the current
standalone image: generated directory listing, default index selection,
byte-identical text and PNG responses, HEAD, and missing-file 404. The
fixtures remain temporary ignored artifacts; no external network is used.

## Full snapshot generation

Fresh builds from each revision's own sources, each byte-identical to its
corresponding image (wall seconds / peak RSS KiB):

| Build host | Predecessor | Current | Current wall change |
| --- | ---: | ---: | ---: |
| Node | 8.49 / 304344 | 8.50 / 305432 | +0.1% |
| js_min | 102.78 / 327524 | 104.40 / 330464 | +1.6% |
| Standalone self-host | 80.30 / 483456 | 86.15 / 483636 | +7.3% |

These are actual source-loading, parsing, lowering, assembly, runtime setup
and snapshot construction runs, not image copies. A reversed-order
self-hosted repeat takes **87.77 seconds current / 85.44 predecessor**
(+2.7%), with peak RSS 483732 / 483436 KiB. Both orderings show higher
current build time, but the size varies (+2.7% to +7.3%); two pairs do not
establish a precise stable percentage. All repeated outputs are again
byte-identical to their revision's reference. Successful fixed-point checks
do not cancel out the measured build-cost increase. Node is v24.14.1 with
its default JIT for builds; the separate Octane reference uses `--jitless`.

## Octane regression comparison

**All fifteen current stock suites pass**, including RegExp: **15 passed /
0 failed / 0 timed out / 0 crashed / 0 skipped**. RegExp scores 2.93 in
563.66 seconds and remains very slow; passing it is not a performance claim.
The fourteen main suites also pass both images in paired stock mode:
28 passes, no failures, timeouts or crashes. Eight selected reversed-order
follow-up runs also pass. However, **performance parity is not preserved**:

- Richards scores are 6.2% lower current in the first pair and 7.9% lower
  in reversed order.
- zlib scores are 7.9% lower current in the first pair and 10.2% lower in
  reversed order. Wall times are 251.40 -> 273.02 seconds, then
  260.83 -> 290.59 seconds; peak RSS remains approximately 101 MiB.
- CodeLoad's first 4.8% lower score does not reproduce: the reversed pair
  is effectively tied. RayTrace score/RSS observations vary substantially
  and require fixed-workload follow-up before attributing an exact cost.

Direct Node `--jitless` also passes **15 / 15**, with no failures, timeouts,
crashes or skips. All fifteen original guest process wall times sum to
1215.65 seconds (20.26 minutes), versus Node's 263.24 seconds (4.39 minutes).
This is total suite turnaround, not an Octane score ratio. See
[the full stock comparison](OCTANE_COMPARISON_2026-11-04.md) for every score,
process time, peak RSS and measurement limits.

## Why this audit is lengthy

This is a controlled full audit, not just replaying the current correctness
suite. The full current/predecessor/Node ECMA runs take about 24.4 minutes;
Test262 7.6 minutes; the fourteen-suite paired stock Octane sweep 21.4
minutes; selected reversed benchmark repeats 10.8 minutes; current RegExp
another 9.4 minutes. Project tests, bounded GC checks, cross-host snapshot
gates, timed bootstrap repeats, live demos and Node references add further
runtime. Heavy jobs run serially to respect the machine's memory limits.
The repeats were necessary to distinguish persistent Richards/zlib losses
from inconsistent observations such as CodeLoad, but this scope should not
be confused with a fast smoke-test turnaround.
