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
