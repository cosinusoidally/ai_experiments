# Executable kernel debugging: final acceptance

Completed 2026-11-12. This closes the requested executable `-g` / `-O0`
delivery, not every broader experiment in the original debug plan.

## Use

From the mmvm_v2_tests directory:

```sh
node guest_runner.js --vm-native -g -O0 --snapshot artifacts/debug.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/debug.snap artifacts/debug.exe --debug-info artifacts/debug.snap.dbg
gdb --args artifacts/debug.exe hello.js
```

Omit `-O0` for the optimized policy. There is no generic `-O` level interface.
Both the builder and packager also support js_min and self-hosted execution;
the developer acceptance supervisor uses installed Node/GDB/objdump, not the
production build path. No gcc, binutils, native development objects or debug
tools are required to generate the executable.

GDB can break and step at original project-relative kernel source lines,
inspect scalar parameters/locals, unwind native and inline frames, and show
source-interleaved disassembly. Objdump can disassemble sized kernel symbols
with source. Optimized locals without a proven live location are honestly
unavailable; `-O0` preserves authoritative stack homes. This is kernel debug
information, not guest application JavaScript frame/local debugging.

## Final checks

- Shared kernel compiler integration passed on Node and i386 js_min.
- Deterministic kernel debug checks passed on Node. Existing genuine Node,
  js_min and self-hosted build receipts were verified against current source
  and artifact hashes; the final artifact driver passed all-host packaging
  and bit-identity checks for both optimization policies. No copying of a
  prior snapshot substitutes for self-hosted compilation.
- Real GDB checks passed for both executable policies: parameters, initialized
  locals, optimized-out storage, native/inline backtraces and source disassembly.
  Editing an `-O0` local changed subsequent native computation as expected.
- Backtraces passed at function entry, after the frame-pointer push, after
  frame establishment, and at the emitted return instruction for both policies.
  Return addresses are obtained from disassembly, not guessed byte offsets.
- Objdump source-interleaved disassembly passed.
- Optimized debug executable: core suite passed, 12 guest programs / 270
  assertions, 104.566 seconds; bounded GC stress passed, 24 rounds / 48
  native-counter collections, 0.510 seconds.
- `-O0` debug executable: the same core suite passed in 144.020 seconds;
  the same GC workload passed in 0.601 seconds.
- All executable debugger/core/GC checks ran with the four original snapshot
  and sidecar inputs actually unlinked. Inputs were restored and hash-checked
  afterward. Both executable hashes remained unchanged.

Checks run serially. Generated logs and JSON receipts remain under
`artifacts/kernel-debug-cold/` and are not checked in. The acceptance script
is `guest_vm/tools/check_kernel_debug_gdb.js`; add `--core` for core/GC checks.
Production code, C, demos and external test corpora were unchanged in this
final acceptance step.

## Performance and remaining scope

The [benchmark report](kernel-debug-benchmarks.md) records full build and
runtime measurements. Debug metadata does not change emitted kernel or heap
payload bytes. Paired Richards medians were 99.4 default versus 98.9 with
`-g`, and 63.2 `-O0` versus 63.1 with `-g -O0`. `-O0` is intentionally slower.

The completed default Test262 run passed 3292/3292, but its 447.58-second time
was about 4.3% above the paired pre-debug control. This observation remains
open; whole-VM performance parity is not claimed. The completed ECMA run
retained all baseline passes (994 pass, 335 known failures, four approved
skips). The interrupted broader Octane sweep and remaining whole-policy/demo
matrix are parked, not relabeled passes. The user explicitly narrowed this
final task to executable debug work. Automatic symbol loading for an mmap
snapshot in js_runner remains deferred; the relocatable sidecar design does
not preclude it.
