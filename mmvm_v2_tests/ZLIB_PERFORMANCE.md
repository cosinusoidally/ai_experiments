# Zlib correctness and performance investigation

The purpose is to improve the general guest interpreter, not to recognize or
replace zlib operations. External Octane sources remain untouched. RegExp is
outside the current performance investigation.

Latest measured results (2026-10-22, evening): verified zlib diagnostic
batches 27.46–27.72 seconds, versus 44.65–45.04 seconds at the start of the
latest optimization pass and the initial 63–65 seconds. This is about 1.63x
faster than that latest starting point; the additional 2x target is about
22.4 seconds per batch and has not yet been reached. Complete cold snapshot
generation is about 85 seconds (best preceding checkpoint 88.76),
versus the original 117.89 seconds. The requested overall 10x
execution speedup is not achieved. Whole-suite Test262 was not rerun; focused
baseline comparisons and known limitations are recorded below.

## 2026-10-22 evening optimization measurements

- Follow-up compiler work: both direct-tree replication and extra opcode
  classification were slower or inconclusive and were removed. Replicated
  trees measured 35.956/36.082 seconds; the balanced tree remains the default.
- Four-register native backend and improved store/address instruction selection:
  30.132/30.129 seconds; initialization 13.792 seconds.
- Failure-only diagnostic clearing: 29.242/28.815 seconds, with full-buffer
  verification. Ordinary failures clear details on exit; callable and explicit
  numeric failures retain their details.
- GC configuration caching with CALL/re-entry invalidation, plus direct
  stack/register comparisons: 27.463/27.724 seconds; initialization 13.704
  seconds. Image: ignored `artifacts/zlib-loop-state.snap`. A subsequent removal
  of a redundant opcode range filter is not included in those measurements.
- Token-digest memoization reduced kernel fingerprinting from roughly 15.7 to
  3.3 seconds while retaining complete parse and semantic traversal. Latest
  build stages: runtime construction 16.681 seconds, environment 1.420,
  standalone preparation 65.765, writing 0.730. Preparation remains a major
  cold-build cost; it has not become a fast self-hosted rebuild.
- A profiled batch confirmed predominantly integer operands: signed right
  shift had 226,513,803 int32 left operands and one double; ToInt32 had
  202,117,026 int32 inputs and 92,622 doubles. Its 43.438-second instrumented
  duration is not an unprofiled performance result. The operand profile adds
  no work to ordinary images.
- The updated both-host regression script passed again after the compiler,
  four-register, budget/diagnostic and GC-configuration changes: 12 programs,
  269 assertions per host, plus the existing native/kernel, heap, automatic-GC,
  error-location, embedding and command-line checks. Discarded helper-call
  behavior is checked through the existing multi-function kernel integration
  test, not a separate language micro-test file.

- Typed-view early classification alone: 44.600 and 46.134 seconds. No
  convincing gain; the duplicate classification path was removed.
- Early integer ADD/SUBTRACT and bitwise-pair handling: 39.855 seconds.
- Direct signed integer comparisons as well: 37.780 seconds.
- Execution-local bytecode address, immediate masks/shifts and short-circuit
  condition branching: 36.380 seconds.
- Execution-local register-bank address and scaled register loads: 33.754 and
  33.570 seconds, initialization 15.166 seconds. Both batches verified every
  one of the 100,000 decompressed and 25,906 compressed bytes against the Node
  reference. Image: ignored `artifacts/zlib-register-fixed.snap`; logs use that
  same prefix. The final power-of-two multiplication lowering was exercised by
  the normal backend tests but is not included in those two batch measurements.
- Cold build at this checkpoint: runtime construction 27.493 seconds,
  environment installation 1.838, standalone preparation 62.474, image writing
  0.722. This pass improves execution, not yet cold generation time.
- Both-host regression script passed: 12 guest programs and 269 assertions per
  host, plus heap, GC, embedding, native/kernel backends, command-line and
  three-context checks. Full Test262 and a new stock Octane score have not been
  rerun at this point. The known standalone language limitations documented
  below are not being claimed fixed by the bootstrap-host suite.
- The register-address image then completed a five-minute demo8 soak at
  320x240/20 FPS requested, exercising rolling, garage and free-drive autopilot,
  and exited through Escape/Q. Garage settled around 19 FPS; free-drive samples
  were mostly 18–19.6 FPS. RSS was about 545 MiB near the end. This bounded run
  does not establish long-run memory bounds.

No benchmark source or demo was modified. Hardware performance counters are
unavailable under the system's current perf permissions; no system permissions
were changed. An intermediate register-address experiment crashed during
snapshot preparation because multiline address expressions still added the heap
base twice. Those expressions were fixed, as was the persistent return-state
offset conversion, before the successful image and measurements above.

## Repeatable progress and correctness monitoring

From this directory, first generate an independent reference using Node's
builtin APIs (no npm):

```
node octane_zlib_monitor.js --record artifacts/zlib-reference
```

Then run exactly the same benchmark work in the standalone VM:

```
./artifacts/js_runner.exe artifacts/snap \
  octane_zlib_monitor.js --reference artifacts/zlib-reference --iterations 10
```

The reference can also be checked by Node:

```
node octane_zlib_monitor.js --reference artifacts/zlib-reference --iterations 10
```

The output identifies initialization, each batch start, and each completed
batch with elapsed milliseconds. Each batch executes the original `runZlib`,
which performs 60 compression/decompression rounds. Ten batches reproduce the
stock benchmark's 600 rounds, but this diagnostic does not produce an Octane
score. Timing excludes the diagnostic's buffer comparison and includes all
work inside `runZlib`. Initialization is reported separately.

At each completed batch the adapter compares all 100,000 decompressed bytes
and all 25,906 compressed bytes against the Node reference. Reference creation
also independently regenerates the deterministic input and decompresses the
benchmark output using Node's builtin zlib. Reference files are temporary
artifacts, not checked-in benchmark answers or runtime inputs to the compressor.
The compressed reference is never supplied to the tested algorithm.

This is stronger than the original benchmark's data assertion: its `strcmp`
stops at the first NUL, and its deterministic input starts with a NUL. The
original length assertion is still exercised. Batch-boundary checks validate
the final round in each batch, not all 60 intermediate results individually.

The buffers are reused, not append-only output streams. Tailing them while
compression runs would observe partially overwritten data. The generated
program's `_printf` and `_puts` imports are no-ops, so stdout does not provide
internal-round progress either. Finer-grained inspection should use general VM
debugging/profiling support rather than instrumenting zlib's internal functions.

The adapter's named layout describes pointer slots in this particular external
generated C program, not guest heap fields. A length and FNV-1a fingerprint of
the evaluated source reject stale reference data after external source changes.
These checks are diagnostic guards, not cryptographic authenticity checks.
No source evaluation is skipped or cached.

## Baseline and method

- 2026-10-22: stock standalone Octane zlib passed, score 229, whole process
  667.38 seconds. Direct Node score 67,054 (292.8 times higher). See
  `OCTANE_COMPARISON_2026-10-22.md` for provenance and measurement limitations.
- 2026-10-22: Node diagnostic reference generation passed full independent input
  and builtin inflate validation. Initialization 46 ms; first batch 392 ms;
  verified 100,000 decompressed and 25,906 compressed bytes.
- 2026-10-22: unchanged standalone comparison snapshot passed the same complete
  buffer checks. Initialization 16,145 ms; first 60-round batch 65,295 ms.
  This is a single diagnostic batch, not a new Octane score.
- 2026-10-22: profiled standalone batch passed full-buffer verification in
  64,409 ms (initialization 15,606 ms). Highest executed operation counts:
  BIT_OR 388,762,825; GET_LOCAL 284,025,967; SHIFT_RIGHT 226,513,804;
  ADD 214,791,640; GET_PROPERTY 212,886,092; MOVE 152,285,473;
  SHIFT_UNSIGNED_RIGHT 80,224,114; SHIFT_LEFT 73,738,500;
  SET_PROPERTY 70,573,077. CALL only 551,474. These are frequency counts,
  not a CPU attribution: the next controlled optimization targets the avoidable
  seven-argument helper boundary on local reads, not benchmark function calls.
- 2026-10-22: lexical lookup/copy separation passed two complete-buffer batches
  at 63,869 and 63,737 ms; initialization 15,870 ms. The difference from the
  65,295 ms baseline is small and not a demonstrated architectural speedup.
  Existing tests passed under Node and js_min after this change and single
  stack-adjustment kernel-call cleanup (269 guest assertions, native kernel,
  heap/GC, compiler, CLI, and multiplexing checks).
- 2026-10-22: comparison-tree dispatch with single-adjustment call cleanup passed
  full-buffer verification at 64,998 ms (initialization 15,178 ms). No material
  speedup established.
- 2026-10-22: per-opcode position-discovery indexed dispatch passed verification
  at 77,526 ms. Rejected as a default because it regressed performance.
- 2026-10-22: cached-base indexed dispatch plus block-copy/store lowering passed
  two byte-verified batches at 82,350 and 81,493 ms. Also rejected as the default.
  Keep balanced dispatch while measuring the memory improvements independently.
  Hardware instruction/cycle profiling was unavailable (`perf_event_paranoid=4`);
  no system security settings were changed.
- 2026-10-22: default balanced dispatch with block-copy/store lowering passed
  two batches at 67,563 and 67,856 ms; unchanged baseline repeated at 62,687 ms.
  This candidate has not demonstrated a performance gain and is not a completed
  optimization checkpoint. Further compiler work is being measured before
  accepting this as the normal implementation.
- 2026-10-22: small-leaf inlining plus proven redundant-int32-coercion removal
  passed full-buffer verification at 60,857 ms (initialization 13,197 ms).
  This is modest progress, not the requested 10x. Subsequent inspection found
  call/accessor classification outside the dispatch specialization region;
  moving those conditions into the opcode handlers is the next measured step.
- 2026-10-22: direct opcode classification/constant logical folding passed
  byte verification at 55,427 ms with profiling enabled; initialization 12,978 ms.
  BIT_OR count fell only from 388,762,825 to 388,234,324, so the narrow redundant
  coercion rewrite is not a major contributor. The other leading counts stayed
  unchanged. The structural inliner expanded 374 sites before tail-call lowering.
- 2026-10-22: the existing Test262 ToInt32 section (`ch09/9.5`) completed under
  js_min-hosted native guest execution: 13 passed, 0 failed, 0 not run/timeouts.
  This validates the targeted section, not the entire Test262 suite.

An earlier architectural investigation found that the standalone builder copied parsed numeric
constants as DOUBLE cells, unlike the canonicalizing host writer. This can turn
small literal operands in integer loops into repeated floating-point operations.
The constant-installation canonicalizer and integer-only IEEE-754 ToInt32
kernel were validated in the fresh images recorded below. They preserve -0 and every
non-int32 value exactly; do not infer benchmark-specific integer types.

- 2026-10-22: fresh standalone image with numeric canonicalization, direct
  double conversion and kernel tail calls passed two fully byte-verified batches
  at 50,149 and 50,747 ms, initialization 14,102 ms. About 1.25–1.30x versus the
  baseline measurements, **not 10x**. The complete existing dual-host suite passed.
- 2026-10-22: standalone demo8 ran at 320x240/20 FPS requested in rolling, garage,
  and free-drive autopilot modes, then quit normally through its menu. No crash
  or semantic exit; observed rolling rates roughly 13–20 FPS and garage/autopilot
  roughly 18–20 FPS. This is a stability smoke run, not a matched demo benchmark.
- 2026-10-22: compared all 12 existing guest language/buffer scripts directly
  under old and new standalone images. Both passed the same seven language
  scripts and failed the same five scripts with identical diagnostic locations:
  functions_objects, standard_library, closure_fallback, typed_arrays, and
  buffer_guest. The typed-array failure is missing `Uint8Array.byteLength`;
  the other four exit at unsupported CALL with detail 20. These pre-existing
  standalone gaps remain; do not confuse the passing dual-host suite with full
  standalone feature coverage. No new failures in this comparison.

## Architectural performance target

- 2026-10-22: resumed with general register-bytecode must-analysis. Shared
  opcode layout metadata now drives verification and fallback destinations.
  The forward dataflow pass proves int32 facts across branches and loops before
  replacing redundant `| 0` conversions. It conservatively leaves exception and
  `with` functions unchanged and bounds analysis memory. Inspection of the
  unchanged decoded zlib source found 253 statically redundant conversions in
  198 compiled functions. This is not a dynamic operation count or a speedup
  claim. Both existing host test runs passed (12 programs, 269 assertions each,
  plus embedding, GC, numeric/kernel, networking CLI, and context checks).
  The first fresh standalone image passed full-buffer checks in 49,640 and
  49,435 ms per batch, with initialization 16,541 ms. This is only a small
  throughput change and adds frontend work. A cheap candidate scan now avoids
  CFG construction when there are no literal-zero OR conversions; its startup
  impact is being checked separately. No 10x claim is justified.
- 2026-10-22: general single-use integer arithmetic fusion found 531 sites in
  the unchanged decoded source. Both host suites passed. A fresh standalone
  image passed full-buffer verification at 47,733 and 47,646 ms per batch,
  initialization 16,733 ms. The preceding filtered-analysis image measured
  49,500 ms / 16,627 ms initialization: the early candidate filter did not
  recover the initialization cost on this program. Fusion is a measurable but
  modest throughput improvement; total gain remains roughly 1.3–1.4x, not 10x.
- 2026-10-22: the fused standalone image ran demo8 at 320x240 with a 20 FPS
  requested limit through rolling, garage, and free-drive autopilot, then
  closed normally via its menu. Observed frame rates remained in the prior
  broad ranges (roughly 15–20 rolling, 18–20 garage/autopilot). This checks
  stability and catches gross slowdowns; it is not a matched timing study.
- 2026-10-22: named bytecode payload accessors passed the dual-host suite and
  standalone full-buffer verification (48,246 ms batch, 17,055 ms startup).
  An intermediate accessor experiment retained a second bytecode pointer that
  was not refreshed on frame transitions; the standalone check caught it before
  commit. The fixed accessor reads through the interpreter's existing payload
  pointer, avoiding duplicated frame-dependent state.
- 2026-10-22: cold snapshot generation with this checkpoint took 117.89 seconds
  elapsed (117.08 user, 0.62 system), including compilation and runtime setup.
  A transaction-owned parsed-source preparation API now allows fingerprinting
  and lowering to share syntax trees, while still validating every build.
  Phase timings and actual reused/reparsed function counts are reported by
  snapshot generation. Cold-build improvement is being measured, not assumed.
- 2026-10-22: parsed-source reuse saved a modest amount: cold build 114.73 s
  versus 117.89 s, with 126 function trees reused and none reparsed. Its native
  machine-code segment and semantic fingerprint are byte-identical to the
  preceding image (387,385 code bytes; semantic fingerprint 2004592276).
  The zlib diagnostic passed at 52,452 ms; a following old-image repeat passed
  at 49,534 ms, so this does not establish a throughput improvement.
- 2026-10-22: expanded cold-build timing measured 115.45 s total: runtime
  construction 27,984 ms, environment installation 1,939 ms, standalone runtime
  preparation 83,882 ms, and serialization 795 ms. Kernel work is inside runtime
  construction. The final image is byte-identical with/without the additional
  runner progress timing. Runtime preparation, not writing the file, dominates.
- 2026-10-22: bounded bulk UTF-16 ingestion reduced the measured cold build
  from 115.45 to 96.63 seconds (95.62 user, 0.57 system). Standalone runtime
  preparation fell from 83,882 to 65,572 ms; kernel construction stayed near
  28 seconds. This is a whole-build improvement, not faster file writing.
  Both host suites passed, with extra code-unit roundtrips in the existing heap
  record test. The first standalone batch passed full-buffer verification in
  49,498 ms (startup 18,115 ms); the second batch is still running. This does not
  show a zlib startup/throughput gain: the demonstrated benefit is cold build.
- 2026-10-22: bulk-string image's second batch also passed, 49,178 ms.
- 2026-10-22: explicit ToInt32 lowering passed both host suites and two complete
  standalone buffer comparisons at 45,716 and 47,178 ms, startup 16,140 ms.
  Cold build remained 96.50 s (runtime preparation 65,402 ms). Throughput is
  modestly better, still roughly 1.4x baseline rather than the requested 10x.
- 2026-10-22: per-handler replicated successor dispatch passed the dual-host
  suite and both complete-buffer checks, but measured 53,321 and 53,197 ms per
  batch (startup 18,131 ms). Cold build 97.62 s. Native code grew from 389,300
  to 416,479 bytes. It is retained as an explicit backend strategy, **not** the
  default. Balanced dispatch is retained; direct comparison branches for while
  conditions remain a general backend improvement.
- 2026-10-22: compact literals at normal compilation entry points passed the
  dual-host suite after updating the structured emitter to share the parser's
  literal accessors and distinguish absent expressions from false/zero/empty
  literals. Focused Test262 selection (`ch09/9.5`, `ch11/11.6`, `ch11/11.7`):
  165 executed, 153 passed, 12 failed, 0 not run/timeouts. An isolated checkout
  of `9ff16dd` produced the same counts and identical failing IDs. These are
  existing coercion/conversion gaps, not a fully passing Test262 claim. No
  external test sources were changed. Logs remain in ignored artifacts.
- 2026-10-22: compact-literal frontend plus balanced dispatch/direct integer
  loop comparisons produced a cold image in 88.76 s (88.06 user, 0.50 system),
  versus 117.89 s at the earlier measured checkpoint: about 25% less elapsed
  time for the complete build. Runtime construction 25,922 ms; environment
  installation 1,367 ms; standalone preparation 59,900 ms; serialization
  710 ms. This is a new uncached compilation, not loading a previous image.
- 2026-10-22: the compact/balanced image passed both full-buffer zlib batches
  at 45,453 and 45,288 ms, initialization 16,324 ms. This is about 1.4x the
  original 63–65 second batch baseline, **not the requested 10x**. These remain
  diagnostic durations; no new stock Octane score has yet been measured.
- 2026-10-22: latest image ran demo8 for approximately 4.5 minutes at 320x240,
  20 FPS requested, through rolling, garage, and free-drive autopilot, then
  exited normally. Rolling samples approximately 15–20 FPS, garage/free-drive
  approximately 19 FPS. RSS rose to about 532 MiB. The preceding image also
  exhibits rising RSS (about 459 MiB after 4.5 minutes before free-drive).
  Mode timing was not identical, so this is not a precise memory comparison
  and does not establish bounded long-run memory usage. Keep this issue visible
  rather than treating an FPS/stability smoke pass as proof of GC health.
- 2026-10-22: preceding image then completed free-drive autopilot and exited
  normally after approximately 5.7 minutes; RSS about 503 MiB before exit,
  free-drive near 19 FPS. Rising RSS is present in that baseline too. These
  approximate, differently timed mode sequences do not isolate a small memory
  difference; a matched long-run GC/memory comparison remains outstanding.
- 2026-10-22: bounded non-leaf kernel inlining and adjacent typed-read ToInt32
  consumption passed both host suites and full-buffer checks at 45,040 and
  44,651 ms, initialization 16,319 ms. Native code grew from 385,812 to
  408,748 bytes; cold build 90.85 s versus the preceding 88.76 s. The small
  throughput difference is not a major architectural win or evidence for 10x;
  compare these numbers with the observed run-to-run variation. The shared
  primitive-conversion helpers avoid duplicating coercion code and preserve
  read results, budgets, profiler counts, and GC-stress opportunities.
- 2026-10-22: the same 165-file Test262 selection after non-leaf inlining/read
  conversion again reported 153 passed, 12 failed, 0 not run/timeouts. Failing
  IDs exactly match `9ff16dd`; full-suite conformance was not rerun.
- 2026-10-22: the latest image completed approximately 6.3 minutes of demo8
  rolling, garage and free-drive autopilot at 320x240/20 FPS requested, then
  exited normally through the menu. Free-drive samples stayed around 18–19 FPS;
  RSS was about 507 MiB at 5.2 minutes and 507 MiB at 6.3 minutes. This is
  reassuring for that interval, not a proof of long-run memory bounds.

The requested target is at least **10 times faster** than the initial standalone
baseline, not a succession of small percentage improvements. For this diagnostic
that means roughly 6.5 seconds or less per 60-round batch, with the full-buffer
checks still passing. Report stock Octane separately; do not equate a diagnostic
batch duration with its normalized score.

The opcode profile is evidence that dispatch and value movement/coercion need
architectural work. Merely accelerating native CALL cannot address hundreds of
millions of other instructions. Investigate these general mechanisms:

1. Replace the backend's comparison-tree opcode dispatch with relocatable,
   indexed dispatch. Keep image relocation and reproducible snapshot constraints.
2. Add general bytecode dataflow/peephole optimization and carefully selected
   superinstructions to avoid dispatching intermediate moves and repeated integer
   coercions. Preserve evaluation order, observable conversions, precise errors,
   instruction-budget resumability, and GC roots. No source/function recognition.
3. Improve primitive numeric/register handling and lexical access. Specialize
   only when compiler proof or runtime guards justify it; retain a fully correct
   general path for objects, accessors, eval, arguments aliasing, and exceptions.
4. Improve the kernel compiler's ordinary optimization/inlining rather than
   manually duplicating helper code or adding non-JavaScript constant semantics.

Measure each stage against unprofiled zlib and other existing workloads. Opcode
frequency alone is not enough to claim a CPU bottleneck or a 10x improvement.
The monitoring work establishes a correctness oracle and an initial profile;
the architectural target has **not yet been reached**.

Optimization procedure: establish the same full-buffer check under standalone,
profile general interpreter operations, change the dominant implementation costs,
then compare unchanged workloads without profiling enabled. Preserve the existing
Node backend and run the existing VM tests and representative demos. Do not add
zlib-specific opcodes, intrinsic replacements, parser caches or precomputed results.

## Standalone opcode profiling

Build an explicitly profiled image, then use the same diagnostic adapter:

```
LD_LIBRARY_PATH=../../firefox-1.0.8/lib ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js --vm-native --vm-profile --snapshot artifacts/zlib-profile.snap
./artifacts/js_runner.exe artifacts/zlib-profile.snap \
  octane_zlib_monitor.js --reference artifacts/zlib-reference
```

The private `__guestVMOpcodeCounterWord(index)` diagnostic returns the signed
low 32 bits of an executed-opcode counter. Index must be an int32 in the
counter vector's range. Disabled counting or invalid indices return undefined.
The adapter detects this facility and reports counter deltas in descending
order. Counts wrap modulo 2^32; compare batches short enough to avoid more than
one wrap of a given counter. Reading counters neither resets nor allocates them.
Sampling itself executes a small amount of guest code, so counts include that
small sampling overhead, but not the full-buffer verification after each batch.
This reports operation frequency, not attributed CPU time.
Following the ordinary opcode-count plane, the vector now contains left-operand
tag planes and then right-operand tag planes. Each plane has
`GuestVMBytecode.NAMES.length` words, indexed by opcode. Tag numbers come from
`GuestVMValueCells.Tags`, including the unused/empty zero tag. The monitor
derives the layout from those definitions, detects older shorter vectors, and
prints labels such as `SHIFT_RIGHT.left.INT32`. Numeric handlers and fused
typed-read conversions record their operands only in explicitly profiled
images. This distinguishes integer traffic from conversion traffic; it still
does not measure CPU time attributed to an opcode.

Native execution serves the query entirely inside the kernel. It does not
transition to the host or expose a raw heap pointer. Ordinary snapshots retain
compile-time-disabled counting: no per-opcode profiling work is added to them.
