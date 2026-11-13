# Kernel debugger acceptance — 2026-11-13

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
