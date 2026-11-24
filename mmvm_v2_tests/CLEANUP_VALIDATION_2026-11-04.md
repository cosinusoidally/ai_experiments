# Full cleanup validation, 2026-11-04

Status: **complete**, runs 20:15--22:06 UTC. This report validates the frozen implementation at
`430cad1` on `guestVM-cleanup3` against pre-cleanup `fa54ddb`. Documentation-only
commits during the run do not change the implementation under test.

All heavy jobs run serially. No external corpus, demo or VM implementation is
modified for this audit. Logs, generated images, the baseline source archive
and measurement output stay in ignored `artifacts/cleanup-full.j9oRH8/`.

**Conclusion:** no newly lost correctness pass was found in the controlled
ECMA comparison, imported Test262, project checks or stock Octane. All demos
and HTTP examples complete their bounded checks. This is not an all-green
VM: ECMA retains 339 failures and extra standalone executions expose existing
gaps on both revisions. Performance is broadly close but not proved identical:
self-hosted build pairs vary, and Gameboy's one paired score is 7.1% lower.
Those qualifications must not be replaced with a blanket no-regression claim.

## Completed results

- 2026-11-04 20:15--20:23 UTC: complete imported Test262 under the standalone
  image: **3292 files / 3292 variants / 3292 executed / 3292 passed / 0 failed /
  0 timed out / 0 not run**. Harness elapsed time 501932.639 ms; summed test
  time 480969.830 ms; process wall time 502.65 seconds; peak RSS 517576 KiB.
  This corpus does not contain every ES5.1 built-in chapter. Controls and the
  repeat below were used rather than attributing a difference from an older
  machine-condition observation to code.
- 2026-11-04 20:45--20:53 UTC: complete archived baseline Test262 also passes
  **3292 / 3292, with 0 failed / 0 timed out / 0 not run**. Harness elapsed
  451377.470 ms; summed test time 435002.697 ms; process wall 452.04 seconds;
  peak RSS 527488 KiB. The first current run is approximately **11.2% slower**
  in harness elapsed time. This was retained as a performance concern rather
  than discarded because generated native code matches.
- 2026-11-04 21:58--22:05 UTC: full current repeat passes **3292 / 3292, with
  0 failed / 0 timed out / 0 not run**, in 436840.919 ms harness elapsed,
  418677.428 ms summed test time, 437.49 seconds process wall, 511672 KiB peak
  RSS. This is 3.2% faster than baseline, so the first 11.2% loss does not
  reproduce. The three observations do not establish a stable speedup either.
- Direct Node control completes all 3292 files: **3253 passed / 39 failed /
  0 timed out / 0 not run**, in 30477.862 ms harness elapsed, 30.61 seconds
  process wall, 760960 KiB peak RSS. These modern-V8/ES5.1 differences remain
  separate from the guest's all-pass result; see `TEST262_NODE_STATUS.md`.
- 2026-11-04 20:23--20:35 UTC: full configured ECMA selection completed under
  the current image: **1333 selected / 1329 executed / 990 passed / 339 failed
  (including 39 watchdog timeouts) / 4 configured skips / 0 not run**. Harness
  elapsed 685095.617 ms; process wall 686.53 seconds; peak RSS 463576 KiB.
  Per-root counts match the preceding audit: `ecma` 472/148 (11 timeouts),
  `ecma_2` 148/24, `ecma_3` 175/50 (1 timeout, 4 skips), `ecma_5` 195/117
  (27 timeouts). The exact completed comparison is recorded below.
- 2026-11-04 20:35--20:40 UTC: project suite passes on both Node and js_min,
  including 12 guest programs / 270 guest assertions per host, compiler,
  native/predecode, heap, embedding, CLI and context-multiplexing checks.
  Both bounded embedding GC runs pass 27 audits / 111888 checked edges /
  221 property-index audits / 74 embedding collections. Maximum bumps are
  3531120 / 3531472 bytes within an 8 MiB cap. Standalone passes 24 rounds /
  48 native-counter collections.
- 2026-11-04 20:40--20:45 UTC: complete snapshot gate passes, including
  program/environment independence, Node/js_min byte identity, fresh launch
  environment and a genuine source rebuild to the identical fixed point.
  Gate process wall time is 306.31 seconds; this is a multi-build test duration,
  not an individual self-hosted build time.

## Fresh image identities and initial build observations

The fresh archived baseline image reproduces the earlier audited `fa54ddb`
image exactly. Fresh current construction reproduces the preceding cleanup
image exactly. Default native interpreter/collector segments are byte-identical:
630331 bytes, SHA-256
`4928ab88ef0d77786f22c13f381b712f6714a3fda810df2f7827699e543dcffb`.
This establishes instruction identity, not a substitute for timing the builds
or executing the full suites.

- Baseline image: 7082992 bytes, SHA-256
  `64797ec1df9d1373589759f032c8d0a7fcc9328b57d691052c00678868651a5c`.
- Current image: 7087288 bytes, SHA-256
  `b48ccc23dc9f40c3ed130cc05bae1886eaaadfd43f2bf5f2dfc25d1ed7888e86`.
- Fresh Node build pair: baseline 8.97 seconds / 310428 KiB peak RSS;
  current 8.85 seconds / 263440 KiB. No build-speedup claim from one pair.
- Fresh js_min pair: baseline 111.72 seconds / 330476 KiB; current 113.82
  seconds / 331888 KiB, a 1.9% increase in this pair. Both match their own
  Node-built images exactly.
- Genuine self-hosted pair: baseline 88.98 seconds / 481428 KiB; current
  93.52 seconds / 483588 KiB, a 5.1% current increase.
- Reversed self-hosted pair: current 90.02 seconds / 483720 KiB; baseline
  90.54 seconds / 481616 KiB, a 0.6% current decrease. All four outputs match
  their revision's fresh Node image. Both orderings include source loading,
  parsing, lowering, assembly, setup and serialization, not copying an image.
- The two-order self-hosted observations span -0.6% to +5.1%; their simple
  means are 89.76 seconds baseline / 91.77 current (+2.2%). This is not a
  precise stable-regression estimate, nor grounds for claiming a speedup.
  The first pair's loss is retained rather than discarded as noise.

## Full ECMA comparison

Baseline completes in 685452.750 ms harness elapsed / 685.78 seconds process
wall, peak RSS 463568 KiB: **990 passed / 339 failed, including 39 timeouts /
4 configured skips / 0 not run**. Its specific pass filenames are identical
to current: **990 preserved / 0 gained / 0 lost**. Current's 685095.617 ms
is effectively tied. No newly excluded test or changed limit contributes.

The four default slow exclusions remain the previously user-requested ones;
this is the full configured selection, not a claim that all 1333 files ran.

Direct Node completes in 125631.019 ms / 125.78 seconds wall, peak RSS
149556 KiB: **1218 passed / 111 failed / 0 timed out / 4 skipped / 0 not run**.
Current preserves 961/1218 specific Node passes (78.90%); 257 remain failing,
unchanged from the preceding audit. Guest-only passes do not offset those gaps.

## Full stock Octane

All fifteen current suites pass: **15 passed / 0 failed / 0 timed out /
0 crashed / 0 skipped**. Fourteen suites also pass on baseline in paired
stock mode (28 successful processes). RegExp runs in full stock mode on
current, not quick mode; there is no fresh baseline RegExp measurement.

| Suite | Baseline score | Current score | Current change | Baseline wall s | Current wall s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 86.2 | 83.9 | -2.7% | 3.41 | 3.30 |
| DeltaBlue | 85.6 | 85.2 | -0.5% | 4.47 | 4.37 |
| Crypto | 174 | 170 | -2.3% | 26.40 | 26.47 |
| RayTrace | 239 | 239 | 0.0% | 12.03 | 11.58 |
| EarleyBoyer | 410 | 409 | -0.2% | 29.68 | 29.62 |
| Splay | 640 | 639 | -0.2% | 4.13 | 4.09 |
| NavierStokes | 251 | 251 | 0.0% | 10.95 | 10.97 |
| PdfJS | 784 | 777 | -0.9% | 20.16 | 20.08 |
| Mandreel | 472 | 456 | -3.4% | 115.33 | 117.79 |
| Gameboy | 947 | 880 | -7.1% | 15.55 | 16.52 |
| CodeLoad | 84.5 | 84.2 | -0.4% | 33.99 | 34.58 |
| Box2D | 355 | 353 | -0.6% | 16.31 | 16.40 |
| zlib | 537 | 537 | 0.0% | 285.29 | 284.90 |
| Typescript | 1252 | 1301 | +3.9% | 113.88 | 109.93 |
| RegExp | not rerun | 3.00 | not paired | not rerun | 549.78 |

These are one stock pair per suite, not statistically established code-cost
changes. **Gameboy is the main score concern requiring focused follow-up**;
it must not be hidden under overall pass status. No further full sweep is
needed just to investigate that case. zlib's paired result is unchanged.

Peak RSS is broadly similar in most pairs, but CodeLoad varies from 195712
to 261376 KiB and RayTrace from 341120 to 244992 KiB. Because stock Octane
adapts its workload, use fixed-workload diagnostics before attributing those
opposite changes to an allocator improvement or regression. Raw paired logs,
scores, wall times and RSS remain in `octane-paired/results.json` below the
audit artifact directory; they are not checked in as generated files.

## Additional tests: passes and inherited standalone gaps

- Everyday JSON: all 12 files / 908 assertions pass in direct Node, shared
  codec on Node, js_min-hosted guest and standalone.
- NativeCompiler dependency graph passes under Node, direct js_min runner
  and standalone: nested/mutual calls, nine arguments, lifetime and errors.
- Self-hosted frontend executable integration and compilation of `demo8.js`
  pass under the standalone image.
- Raw-FFI file tests pass in hosted native mode and standalone. Demo8's exact
  inlined file/Buffer/Xauthority parser probe passes under standalone.
- The extra `standalone_language_integration.js` fails on **both** revisions
  at CALL PC 391, detail 1078, exit 70, as in the previous audit.
- Running the twelve ordinary guest-program files directly under standalone
  gives seven passes and five failures. These five also fail on baseline at
  the same opcode/PC/reject detail; they are not newly lost passes:

  - `closure_fallback.js`: CALL PC 10, detail 20.
  - `functions_objects.js`: CALL PC 738, detail 20.
  - `standard_library.js`: CALL PC 60, detail 20.
  - `typed_arrays.js`: INSTANCEOF PC 190, detail 0.
  - `buffer_guest.js`: CALL PC 460, detail 20.

These files pass in the default embedding-host project suite, but not in all
standalone paths. Report that distinction explicitly rather than claiming the
entire collection of test files passes everywhere. CALL detail 20 is the named
intrinsic-ID rejection reason, not absence of the CALL opcode itself. No new
invalid/freed guest-heap-reference diagnostic was found in this audit's logs.

## Live demos and HTTP

Demos 1--7 run on Node and standalone at 320x240, 20 FPS requested, receive
keyboard/mouse input, produce visually inspected captures and exit normally.
Early standalone demos remain slow: respectively 2.1--2.3, 1.8--2.2, 3.1,
2.8--2.9, 1.6--2.0, 1.3--1.5 and 2.1--2.3 FPS. Node samples are approximately
20--20.5 FPS. These are functional checks, not new early-demo speedups.

Demo8 completes attract, garage/camera drag, manual free-drive and auto-drive
then menu exit on baseline standalone, current standalone and hosted js_min.
Captures show the floor, car/windows/wheels, field and sky. Current standalone
settles around 19.6--20.1 FPS, with 19.1/19.3 warm-up samples and a 16.1 FPS
garage-transition sample; baseline settles around 19.6--20.1, transition 16.2.
Hosted samples include 18.6--20.0 steady readings and a 14.8 transition. These
bounded sequences do not establish perfectly sustained 20 FPS or long-term
stability. The instrumented GC workload supplies the separate structural gate.

Both HTTP file servers pass listing, index, text, exact PNG bytes, HEAD and 404
checks on localhost. `node_hello.js` responds correctly on direct Node and
standalone. Test server termination is intentional; no external network is used.

## Why it took this long, and avoidable repetition

The serial jobs run from 20:15:25 to 22:06:12 UTC: **1 hour 50 minutes 47
seconds**. Most of that time is real suite work, but the audit was broader
than necessary for one cleanup checkpoint:

- Paired stock Octane takes 23m03s, with current RegExp another 9m10s.
- Current/baseline ECMA take about 11m26s each; direct Node another 2m06s.
- Current/baseline Test262 take 8m23s and 7m32s. The extra full current repeat
  adds 7m17s and direct Node another 31s. The repeat disproves the first timing
  loss, but a focused follow-up would have been a tighter initial plan.
- The multi-build snapshot gate overlaps some timed construction work.
  Future audits should instrument and reuse those same builds rather than
  run a separate gate and then reconstruct all timing outputs again.
- The unchanged direct-Node graphical sweep is additional reference work,
  not necessary to prove a VM-only cleanup safe. The guest graphical paths
  and different hosting paths are the important checks.

Do not repeat this entire audit for every small refactor. Use one full current
correctness run, retain its per-file outcomes, reuse gate outputs for build
timings, and apply targeted reversed-order measurements to actual outliers.
Run a new broad baseline only when its retained outcomes or changed scope
cannot support the requested comparison. No extra tests are still running.

## Interpretation rules

The pre-cleanup full audit already has ECMA gaps and an extra standalone
integration failure. A no-regression result must preserve specific existing
passes, not merely a total count. A timeout is a failure. Keep fixed workload
outcomes separate from timing variation, and distinguish inherited performance
problems from costs introduced by cleanup. Self-hosted measurements must load
sources, parse, lower, assemble and serialize; copying an image is not a build.

The preceding audit remains available in [VALIDATION_STATUS.md](VALIDATION_STATUS.md)
and [its stock Octane comparison](OCTANE_COMPARISON_2026-11-04.md). Those results
describe `fa54ddb` versus `28b131f`, not this cleanup comparison.
