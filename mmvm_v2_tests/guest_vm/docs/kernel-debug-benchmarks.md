# Kernel debug measurements — 2026-11-12

Status: **executable debug acceptance complete; broader matrix parked**.
See [final executable checks](kernel-debug-exe-acceptance.md).
This records measured results, including
the performance concern, rather than declaring every planned gate complete.
Production code is frozen after the on-demand-support change. No C, demo,
external corpus, test assertion, instruction limit or watchdog policy changed.
One heavy process/job runs at a time; no threaded VM optimization is involved.

## Policies and interpretation

`-g` records kernel provenance and writes a separate bound DWARF file. `-O0`
changes kernel compilation policy. The snapshot's code and heap bytes after
its header are **identical** between default/-g and between -O0/-g -O0.
Only the inert debug-binding header fields differ. Debug data incorporated
into an executable is outside its load segments.

Stock Octane runs directly on the image's interpreter. Test262 also creates
an inner guest test runtime using the unchanged harness; its own constructor
defaults are not silently changed to inherit the outer image's `-O0` policy.
Its numbers therefore include the image's execution of the embedding/frontend
implementation, not simply an isolated inner dispatch-loop measurement.

## Artifact sizes and fixed native frames

| Policy | Kernel bytes | Snapshot bytes | Sidecar bytes |
| --- | ---: | ---: | ---: |
| Default | 672705 | 7325704 | none |
| -g | 672705 | 7325704 | 627500 |
| -O0 | 545244 | 7198728 | none |
| -g -O0 | 545244 | 7198728 | 573172 |

All 269 graph functions have canonical source provenance. The optimized graph
has 18597 recorded statement positions and 333 locals with conservative
availability ranges; -O0 has 25066 positions and 2794 such locals. Uncertain
inline-caller locals remain unavailable, not assigned another binding's slot.

The optimized entry's fixed native frame uses 156 bytes; the largest graph
frame uses 804 bytes. -O0 uses 192 and 2084 bytes respectively. These values
include saved EBP/general registers and local storage, but exclude the return
address, incoming arguments, transient expression/call pushes and callees.
They are derived from emitted CFI, not estimates of whole-process stack use.

The optimized kernel SHA-256 remains identical to the pre-debug control:
`3ef0776560227fa90a3acaca5af7a2e1fa83ae6f8f8144f9b94d8905084faedd`.
-O0 is about 19% smaller in native instructions, not faster at execution.

## Build-host observations

Final Node observations (single builds, plus a renamed-output -g repeat):

| Target | Wall seconds | User CPU seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: |
| Default | 9.12 | 10.23 | 313492 |
| -g | 9.60 | 10.96 | 336232 |
| -O0 | 8.65 | 9.60 | 305168 |
| -g -O0 | 8.97 | 10.15 | 336936 |
| Renamed -g | 9.56 | 10.89 | 331244 |

The independently built pre-debug `b93e08e` control observed 9.40 seconds wall,
10.19 seconds user CPU and 315884 KiB RSS. Node's own build-host engine can
use internal GC/JIT workers, so aggregate user CPU can exceed wall time; this
is not a multithreaded guest interpreter. No material default Node build CPU
regression is apparent. These are observations, not confidence intervals.

Final existing-js_min and genuine self-hosted observations:

| Build host / target | Wall seconds | User CPU seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: |
| js_min / -g | 152.43 | 150.93 | 338792 |
| Optimized standalone / -g | 101.30 | 100.07 | 528704 |
| js_min / -g -O0 | 136.28 | 135.43 | 344764 |
| Optimized standalone / -g -O0 | 93.38 | 92.35 | 540540 |
| -O0 standalone / -g -O0 | 128.49 | 127.66 | 540136 |

Every matching target snapshot and sidecar is bit identical across these
hosts. An optimized host building -O0 and an -O0 host building itself are
distinct measurements; neither is a snapshot-copy shortcut. The -O0 host uses
about 38% more CPU for this build than the optimized host building that same
target. The optimized self-host uses about two-thirds of js_min's CPU time.

Representative -g phase receipts, milliseconds:

| Phase | Node | Optimized self-host |
| --- | ---: | ---: |
| Source loading/module setup | 80 | 18124 |
| Kernel parse | 135 | 3570 |
| Kernel fingerprint | 164 | 1840 |
| Optional support/provenance setup | 234 | 6010 |
| Graph lowering/optimization/slot allocation | 428 | 6235 |
| Assembly | 651 | 4524 |
| Runtime construction, inclusive of kernel phases | 1889 | 23222 |
| Environment installation | 283 | 2032 |
| Standalone preparation | 2485 | 37731 |
| Image normalization/sharing/DWARF/write | 4753 | 19938 |

Inclusive rows must not be added to their components. Slot allocation is
included in graph lowering rather than independently instrumented; no isolated
allocation duration is invented. -O0 omits that allocation pass. Self-hosted
remaining-string sharing takes 9675 ms within the last inclusive phase.

## Paired short execution controls

Three rounds were interleaved serially with ordinary OS file caching, without
cache dropping, debugger attachment or changes to stock Octane. These first
controls precede the final on-demand-loading refinement:

| Image | Richards scores | Median | Hello process elapsed milliseconds |
| --- | --- | ---: | --- |
| Pre-debug control | 93.1, 93.8, 94.1 | 93.8 | 14, 15, 16 |
| Default | 93.1, 93.8, 94.1 | 93.8 | 16, 17, 19 |
| -g | 93.2, 93.6, 93.7 | 93.6 | 14, 17, 17 |
| -O0 | 59.0, 59.7, 59.7 | 59.7 | 14, 15, 16 |
| -g -O0 | 59.2, 59.7, 59.7 | 59.7 | 14, 21, 23 |

Scores are higher-is-better. The -O0 median is about 64% of default, implying
about 1.57 times the per-operation time on Richards. Stock Octane adapts its
repetition count; whole process wall time is not the reciprocal of score.
Hello measurements include the launcher/supervisor overhead and are too short
for fine-grained startup claims.

Final fresh controls after on-demand loading:

| Image | Richards scores | Median | Hello process milliseconds |
| --- | --- | ---: | --- |
| Pre-debug control | 98.8, 99.3, 99.4 | 99.3 | 12, 14, 16 |
| Default | 99.3, 99.4, 99.8 | 99.4 | 13, 16, 18 |
| -g | 95.2, 98.9, 99.4 | 98.9 | 14, 14, 19 |
| -O0 | 63.1, 63.2, 63.2 | 63.2 | 13, 14, 16 |
| -g -O0 | 62.5, 63.1, 63.2 | 63.1 | 13, 14, 14 |

The default/control medians agree within 0.1%; -g differs by about 0.5%.
The increase from the earlier control median 93.8 to 99.3 also demonstrates
why observations from different times cannot be treated as an exact baseline.

The first four-policy core/GC matrix passed every configuration: 12 guest
programs / 270 assertions plus existing internal compiler/heap checks, and
24 rounds / 48 native collections. Core wall observations were 110.38 seconds
default, 107.68 -g, 146.66 -O0 and 147.71 -g -O0. These are earlier working-point
measurements, not reruns of every minor metadata refinement.

## Corpus performance investigation

- First debug implementation, default: Test262 **3292 pass / 0 fail / 0 timeout**,
  477.19 seconds wall, 469.66 user CPU, 512108 KiB RSS.
- Paired pre-debug control: **3292 pass / 0 fail / 0 timeout**, 428.98 seconds wall.
- After optional debug modules were removed from unconditional runtime loading:
  **3292 pass / 0 fail / 0 timeout**, 447.58 seconds wall. This removes much of
  the approximately 11% slowdown, but remains about 4.3% slower than that full
  control observation. **Full-corpus performance parity is not established.**
- A separate fresh-process comparison of the existing eval-heavy
  `ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js` measures 85.531 seconds test-body time after
  the change versus 86.440 seconds control; both pass. Do not compare those
  isolated figures directly with the differently primed state halfway through
  a full corpus run.
- The first default historical ECMA run reports **994 pass / 335 known fail /
  4 approved skips**, with **zero lost previously passing files**, in 679.77
  seconds. The watchdogs and exclusions are unchanged.

The complete remaining corpus/stock-Octane/application matrix is pending.
Every slow suite, including RegExp, remains selected. Known historical ECMA
failures are not relabelled as successes. An -O0 watchdog timeout, if observed,
will be recorded as such, not hidden by a larger official test limit.

Final on-demand-image historical ECMA also completed: 994 pass / 335 known
fail / four approved skips / zero lost passes, in **661.00 seconds process
wall time** (660.159 seconds reported inside the harness). The 335 failures
include 39 watchdog timeouts.

Completed final default-image stock scores at the crash/recovery checkpoint:

| Suite | Score | Process wall seconds |
| --- | ---: | ---: |
| Richards | 97.0 | 3.33 |
| DeltaBlue | 92.0 | 4.47 |
| Crypto | 175 | 26.21 |
| RayTrace | 257 | 11.64 |
| EarleyBoyer | 468 | 25.73 |

All five exit successfully. The machine crash interrupted RegExp before its
result was recorded; no RegExp score or failure is inferred from that partial
run. Subsequent suites and other-policy full sweeps remain pending. Work is
paused after a checked-in recovery checkpoint at the user's explicit request.

## Reproduction and receipts

Run from `mmvm_v2_tests`, using the existing js_min with LD_LIBRARY_PATH set:

```
node guest_vm/tools/check_kernel_debug_artifacts.js --all-hosts --build-only --directory artifacts/debug-results
node guest_vm/tools/check_kernel_debug_gdb.js artifacts/debug-results
node guest_vm/tools/benchmark_kernel_debug.js artifacts/debug-results --short --control artifacts/pre-debug.snap
node guest_vm/tools/benchmark_kernel_debug.js artifacts/debug-results
```

Use `--resume-builds` for the artifact driver's existing results. It rejects
changed production source contents and modified artifacts. The benchmark driver
resumes completed jobs by frozen image/harness identities. It writes per-job
logs, `/usr/bin/time` receipts and JSON results under the selected ignored
artifact directory. `--only WORKLOAD` and `--only-mode MODE` select diagnostic
jobs without claiming a full-matrix completion.

No generated images, ELF sidecars or executable binaries are checked in. The
implementation log tracks later completed gates and any changed conclusions:
[kernel-debug-status.md](kernel-debug-status.md).
