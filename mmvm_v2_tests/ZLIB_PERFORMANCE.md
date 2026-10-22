# Zlib correctness and performance investigation

The purpose is to improve the general guest interpreter, not to recognize or
replace zlib operations. External Octane sources remain untouched. RegExp is
outside the current performance investigation.

## Repeatable progress and correctness monitoring

From this directory, first generate an independent reference using Node's
builtin APIs (no npm):

```
node octane_zlib_monitor.js --record artifacts/zlib-reference
```

Then run exactly the same benchmark work in the standalone VM:

```
./artifacts/js_runner.exe artifacts/octane-comparison.snap \
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

Current architectural investigation: the standalone builder copied parsed numeric
constants as DOUBLE cells, unlike the canonicalizing host writer. This can turn
small literal operands in integer loops into repeated floating-point operations.
The new constant-installation canonicalizer and integer-only IEEE-754 ToInt32
kernel are being validated in a fresh standalone image. Preserve -0 and every
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

Native execution serves the query entirely inside the kernel. It does not
transition to the host or expose a raw heap pointer. Ordinary snapshots retain
compile-time-disabled counting: no per-opcode profiling work is added to them.
