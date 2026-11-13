# Kernel debugger acceptance — 2026-11-13

## Follow-up: bootstrap and ABI-bridge unwind coverage

The missing interpreter caller now resolves as `snapshot_bootstrap_entry`,
with a function symbol covering exactly `.text.bootstrap`. New CFI covers
both that frame and `_main_abi_entry`, connecting the native interpreter's
call chain to compiled JS main and then the libc ABI bridge. No JS source
lines or locals are invented for the assembly frames. A final external libc
address remains outside the executable's supplied symbols/unwind information.

- `aot/snapshot_frames.js` is the single declarative frame plan for bootstrap
  and bridge emission. It records instruction positions and saved-register
  slots while invoking macro assembly. The packager validates compatible old
  bootstrap prologue/epilogue bytes against the same emitted plan. Unknown
  shapes fail explicitly. No snapshot-format change or payload patching.
- js_min → old -O0 snapshot executable and standalone → newly built optimized
  executable pass real-kernel acceptance. At an interpreter stop, both recover
  the bootstrap, main, bridge and main's argc/snapshotEntry parameters.
- Caller PC, SP, EBP, EBX, ESI and EDI are compared against the entry-state
  baseline at **11 bootstrap boundaries** and **8 bridge boundaries**, including
  each save/restore and leave. Both hosts pass, as do normal completion and
  bounded GC workload interrupt/resume (24 rounds / 48 native collections).
- Packager acceptance passes **47 plain** and **49 debug** checks: all-host
  executable byte identity, unchanged embedded snapshot and source/executable
  hashes, ordinary loader behavior, exact bootstrap symbol range, and refusal
  to publish debug output for a deliberately mismatched bootstrap prologue.
- The kernel DWARF regression still emits the original native kernel bytes
  and sidecar hashes for both optimization policies. CFI emission is factored
  into shared `KernelDWARF.buildFrames`, with zero-base output unchanged.
- A genuine optimized self-hosted `-g` rebuild completed in **102.57 seconds**
  wall time (single observation, not a paired performance benchmark). Snapshot
  and sidecar are bit-identical to the fresh Node build. The existing js_runner
  binary runs that rebuilt snapshot; it was not recompiled.
- Optional installed-GDB validation, with debuginfod disabled, also unwinds
  interpreter → bootstrap → main → bridge and continues hello normally.
  This introduces no external debugger dependency into the runtime/tool.

The older snapshot used for retrofit testing was generated before the shared
frame-emitter change. All checks ran serially; raw `artifacts/bootstrap-*`
outputs remain ignored. No C, demos, test corpus, interpreter opcode execution
or runtime heap-layout changes were made. These are focused metadata/build/
debugger checks, not a new whole-corpus performance run.

## Follow-up: compiled launcher main

The executable packager now compiles `tools/snapshot_launcher.js` through the
existing kernel compiler. `_start` and the branch-free libc argument bridge
remain assembly; main's argument validation, argv adjustment, snapshot call
and returned status are JS. Bootstrap entry/dlsym are explicit parameters,
not initialized VM services or hidden compile-time local-variable semantics.

- All packaged executables expose `_start`, `_main_abi_entry`, and `main` ELF
  symbols. Debug packaging adds a separate launcher DWARF compilation unit
  without changing the original snapshot/sidecar. Debugger unit/reference/file
  bases are now independent, and assembly-only names fall back to ELF symbols.
- The checked-in `kernel_debugger_main.commands` passes under js_min and
  standalone hosts: break `_start`, then main, inspect four parameters, source
  step, assert `guestArgc`, inspect locals and finish back into the ABI bridge.
  Optimized main also passes under the optimized standalone executable.
- The existing ELF/launch integration now passes **45 checks**, including
  startup-symbol coverage, ordinary-loader compatibility, all-host executable
  identity, arbitrary program/environment/argument forwarding, status 64 for
  missing program, no-clobber and snapshot/executable immutability.
- Debug-packaged Node/js_min/self-hosted executable bytes match. The x86
  backend's emit-only option avoids installing temporary executable code
  during packaging; default compilation/installation is unchanged.
- The real-kernel debugger acceptance passes with js_min → -O0 and standalone
  → optimized, including interrupted/resumed bounded GC stress. The decoder
  covers 270 functions including main: **141938** instructions for -O0 and
  **170970** for optimized output, all ending on exact function boundaries.
- The core suite through the new launcher passes **12 guest programs / 270
  assertions**. Shared kernel/compiler checks pass on Node and native i386;
  the default-base DWARF regression retains the original kernel instruction
  bytes and sidecar hashes for both policies.
- Installed GDB was additionally used as an independent DWARF consumer:
  `break main`, source display, all four arguments, disassembly and normal
  continuation pass. This is an optional developer cross-check, not a runtime
  dependency of either the packager or kernel_debugger.

No C, normal js_runner loader, existing demos or external corpus files changed.
This is focused launcher/debug/compiler acceptance, not a new full corpus or
Octane performance sweep. Logs and binaries remain ignored artifacts.

## Initial debugger delivery

Scope: native kernel code in the repository's ELF32/i386 executables with
incorporated DWARF4. Entry point `kernel_debugger.js`; implementation plan
committed as `191f4df`, first js_min tracing/inspection working point `18ca06c`.
The completed follow-up adds both-host acceptance, disassembly and CLI coverage.

## Completed functional checks

- js_min hosting the debugger against an -O0 kernel executable: real source
  breakpoint; read/edit `instructionsCompleted`; source-step the following
  `budget` assignment and verify the edit affects execution; normal hello exit.
- Standalone hosting the debugger against another instance of itself: native
  breakpoints, arguments, CFI backtraces and successful continue/exit.
- Final real-kernel acceptance passes with js_min → -O0 and optimized
  standalone → optimized. Earlier focused runs additionally covered standalone
  → -O0 and js_min → optimized. Optimized unavailable locations are reported
  rather than guessed; the source-step check still runs. The -O0 test requires
  the initialized source local to be readable/writable.
- Named, source-line and raw-address breakpoints; fresh patch installation
  after a live-child restart; arguments retained across runs; temporary return
  breakpoints and `finish`; CFI at entry, after the frame push and after frame
  establishment; explicit signal delivery.
- A debugger interrupt pauses the existing bounded GC workload; normal
  continuation suppresses that debugger-generated SIGINT and completes all
  24 rounds / 48 native-counter collections. Both final hosts pass.
- CLI command-file workflow passes under js_min → -O0 and standalone →
  optimized: arguments, break/run, scalar assertion, registers, memory,
  parameters/locals, backtrace/frame, source listing, next/stepi/finish,
  breakpoint deletion, continue and subsequent run.
- Static named-function disassembly works before launching a child.
  Unknown commands and explicit batch timeouts fail nonzero with contextual
  diagnostics; timeout cleanup leaves no inferior running. The command entry
  catches/reports errors before exiting, instead of relying on the host VM's
  unhandled-exception diagnostics.
- Interactive PTY checks passed under js_min: symbol loading without a child,
  `run hello.js`, show/reuse args, rejecting then confirming live restart,
  breakpoint continuation, Ctrl-C interrupt and quit/terminal restoration.
  The final automatic driver checks Ctrl-C's corrected pause/resume signal
  policy independently of the command interface.

## Instruction decoding

The in-JavaScript decoder traversed all 269 concrete kernel functions, matching
every function-end boundary exactly:

- -O0: **141899 instructions**, 545244 emitted native bytes.
- Optimized: **170929 instructions**, 672705 emitted native bytes.

Live source-interleaved disassembly passes for both policies. Breakpoint bytes
are hidden using the saved original instruction bytes. No external assembler,
disassembler, debugger or symbol utility was invoked for these checks.
Boundary coverage is not a proof for arbitrary x86 code: unknown encodings
still stop explicitly, and general C/PIE/shared-library debugging is out of scope.

## Evidence and regression scope

The pure-JS snapshot builder/packager prepared disposable debug executables at
`artifacts/kdbg.exe` and `artifacts/kdbg-opt.exe`. The debugger's only child
process is its target. Validation drivers are checked in at
`guest_vm/tools/check_kernel_debugger.js` and
`guest_vm/tools/kernel_debugger_acceptance.commands`; raw `artifacts/kdbg-*`
logs/images are ignored, not checked in. Executable SHA-256 values are unchanged
after execution, variable writes, breakpoints and signal/GC checks. Hashing was
an external validation check, not a debugger runtime dependency.

No existing VM/compiler/C/demo/corpus code changed for this debugger. The
existing full Test262/ECMA/Octane sweeps were not repeated for this additive
tool; these are focused debugger and bounded workload results, not a new
whole-suite performance/compliance claim. Processes were tested serially.

See [usage, API and limitations](kernel-debugger.md). Kernel scalar inspection
is implemented; guest JavaScript frames/objects, general C expressions, attach,
watchpoints, separate sidecars and a plugin loader remain outside this release.
