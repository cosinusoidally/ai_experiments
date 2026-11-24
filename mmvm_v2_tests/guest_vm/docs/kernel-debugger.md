# Native kernel debugger

`kernel_debugger.js` runs from mmvm_v2_tests under js_min or a standalone
guest executable. Linux/i386 and libc's ptrace interface are required. No
GDB, binutils, Node, npm, compiler or native helper is used by the debugger.
The target must be a fixed-address ELF32/i386 executable with incorporated
kernel DWARF4, produced by the repository's `-g` build/packager pipeline.
Source display additionally needs the original project-relative source files.
Use source files from the build being debugged; the debugger does not run a
startup source fingerprint check. If a source file is missing, native address,
line-number, register and variable inspection remain available.

To prepare a target without native development tools:

```sh
js_min.exe guest_runner.js --vm-native -g -O0 --snapshot artifacts/debug.snap
js_min.exe guest_vm/tools/snapshot_to_exe.js artifacts/debug.snap artifacts/debug.exe --debug-info artifacts/debug.snap.dbg
```

Use js_min's usual library environment. Omit `-O0` for optimized output.
Neither the snapshot nor the sidecar is needed when debugging the resulting
executable; the debugger consumes its incorporated debug sections.

```sh
js_min.exe kernel_debugger.js artifacts/debug.exe
```

The debugger loads symbols without starting a child. At its prompt:

```text
(kdbg) break interpreterKernel
(kdbg) run hello.js
(kdbg) info args
(kdbg) backtrace
(kdbg) delete 1
(kdbg) continue
(kdbg) run
(kdbg) quit
```

`run` reuses the last argument list. `set args ...` and `show args` manage it
without starting the target. A live interactive inferior requires confirmation
before restart. Batch mode restarts explicitly without prompting.
At an exit stop, the debugger reports the child's exit status; that status
does not itself make the debugger fail (as distinct from a command error).

Newly packaged executables also support `break main`: launcher `main` is
compiled kernel JS in `guest_vm/tools/snapshot_launcher.js`, with its own
DWARF compilation unit. Its four parameters are argc, argv, snapshotEntry and
dlsym. `_start` and `_main_abi_entry` resolve through ELF symbols and support
instruction-level debugging, not JS locals. Older executables need repackaging
to gain these symbols and launcher DWARF; their original snapshots are reusable.
`snapshot_bootstrap_entry` now also has an exact ELF symbol/range and CFI, and
the ABI bridge has CFI. A backtrace from the interpreter therefore reaches the
bootstrap, JS main and bridge instead of ending at an unnamed bootstrap
address. Any final unnamed frame in external libc is outside the supplied
executable's kernel symbols/CFI; arbitrary shared-library debugging is still
outside this implementation.

```sh
./artifacts/guest_vm.exe kernel_debugger.js --batch \
  --ex 'break interpreterKernel' --ex 'run hello.js' \
  --ex 'info args' --ex backtrace --ex 'delete 1' --ex continue \
  artifacts/debug.exe
```

`--commands FILE` reads one command per line; `--ex COMMAND` appends a command.
Command errors abort batch mode with a nonzero shell/guest exit. Interactive
errors return to the prompt. Quit/end of input terminates and reaps a live
inferior, restores terminal settings and frees owned native buffers.

Commands: `help`, `run`, `break FUNCTION|FILE:LINE|*ADDRESS`, `delete ID`,
`continue [SIGNAL]`, `stepi`, `step`, `next`, `finish`, `backtrace`, `frame N`,
`registers`, `info breakpoints|args|locals`, `print NAME|$REGISTER|INTEGER`,
`set variable NAME = VALUE`, `list [FUNCTION|FILE:LINE|*ADDRESS]`, `x/COUNTwx ADDRESS`,
`x/COUNTbx ADDRESS`, `assert NAME|$REGISTER == VALUE`, `quit`.
`disassemble [/r] [FUNCTION|*ADDRESS]` (alias `disas`) uses the debugger's own x86
decoder, with source interleaving when source files are available. Named
functions can be disassembled before the inferior is started. Live
disassembly reads original bytes at patched breakpoint sites. It prints at
most 200 instructions per invocation and explicitly stops on unsupported
encodings; it does not guess the next instruction boundary.
The GDB-compatible `/r` modifier adds the instruction bytes in hexadecimal,
in memory order: `disassemble /r main`. Attached forms such as
`disas/r main` also work. Without `/r` there is no raw-byte column.

`list main` lists ten source lines around main's declaration and works before
`run`; the declaration's own compilation-unit file table determines the file.
`list FILE:LINE` and `list *ADDRESS` select an explicit source location;
argument-free `list` uses the selected stopped frame. Assembly-only symbols
without source mappings report an error rather than inventing source lines.
This is a subset of GDB's list syntax, not its complete paging/range grammar.
Common short forms include `r`, `b`, `c`, `si`, `s`, `n`, `bt`, `f`, `p`, `l`, `q`.
Arguments support quotes and backslash escaping, not shell expansion.

## Execution and inspection contract

The engine is single threaded. A stopped child is inspected through ptrace;
running waits use WNOHANG and poll. Interactive Ctrl-C interrupts the child;
typing `interrupt` followed by Enter also works while it runs. The debugger
suppresses delivery of its own interrupt when continuing, so Ctrl-C followed
by `continue` pauses/resumes rather than killing the child. Other program
signals remain pending for delivery; `continue 0` suppresses one explicitly,
and `continue SIGNAL` requests delivery of a numeric signal.
Only interrupt input is accepted while running; other commands need a stopped
inferior. Live-child restart and quit ask for confirmation interactively.
The debugger
owns stdin; the child receives `/dev/null`, with stdout/stderr inherited.
Interactive target input and terminal-job control are not yet supported.

`--timeout-ms N` bounds running waits (default 30000 ms in batch, unlimited
interactively; explicit zero means unlimited). Timeout requests a stop and
leaves the inferior inspectable interactively; it is an error in batch mode.
Source stepping also has a
100000-instruction limit. It uses ptrace stepping and temporary return
breakpoints and is not intended for executing long loops instruction by
instruction. Next/finish use stack-qualified return breakpoints so a deeper
recursive activation returning to the same PC does not satisfy the intended
return. Named breakpoints include emitted inline instances. Breakpoint
definitions survive restarts; patched bytes exist
only in child memory. Executable and snapshot files are opened read-only.

Variables are kernel signed 32-bit scalars. The reader respects location-list
PC ranges, including optimized-out/uninitialized intervals. Caller registers
are recovered only when CFI says how; a caller-saved register without a rule
is unavailable. Register writes require frame 0; address-backed scalar writes
can use an unwound frame. Native backtrace includes applicable inline names;
inline variables without concrete locations are not fabricated.
Inline entries are annotations on physical frames, not separately selectable
frames with invented registers. Backtraces are bounded to 64 physical frames
and stop when the target leaves the supplied kernel CFI.
The supplied CFI includes the assembly bootstrap and libc ABI bridge; they
remain instruction-level frames without invented JS locals or source lines.

Only the emitted DWARF subset is supported. Unknown forms, line opcodes and
unwind operations fail explicitly. Backtrace preserves preceding frames and
reports an unwind error instead of making register inspection impossible.
This is not a general C debugger or guest JavaScript debugger.
Attach, separate debug-file loading, shared-library symbols, PIE, follow-fork/
exec, hardware watchpoints, full expression parsing and command history are
outside this initial implementation. There is no automatic extension loader.

## Implementation

- `debugger/linux_i386.js`: sole libc/FFI tracing and I/O boundary, signed-word
  normalization, register fields, owned native buffers and terminal cleanup.
  Source text conversion uses bounded chunks and one final join, avoiding
  quadratic whole-file string appends on flat-string hosts.
- `debugger/image.js`: bounds-checked native-memory file views and ELF reader.
- `debugger/dwarf.js`: producer constants, DIEs/origins, lines, location lists
  and CFI interpretation. Multiple compilation/line units retain their own
  reference bases and file tables. The executable image is held once in native memory.
- `debugger/engine.js`: lifecycle, breakpoint ownership, stepping and frames.
- `debugger/commands.js`: command registration, interactive/batch UI and scalar
  evaluation. Future extensions can use the engine's target-access APIs and
  `UI.registerCommand`; no guest heap layouts are built into the core.
- `debugger/x86.js`: the emitted i386 integer/x87 subset, including ModRM/SIB,
  displacements and immediate operands. Unknown encodings fail closed.
- `debugger/format.js`: shared fixed-width formatting and source-location
  parsing, independent of primitive boxing or host-specific libraries.

### Internal interfaces and ownership

`Engine(target, image, debug, options)` owns session state, not native buffers.
`options.timeout` is milliseconds (zero disables it), `stepLimit` bounds source
stepping and optional `runningInput()` services UI input on the same thread.
The main state transitions are not-started → stopped → running → stopped or
exited/terminated. `start()` uses `args`; `resume(step, signal)`, `sourceStep`,
`finish`, `interrupt`, `frames`, `variable`, `value`, and `setVariable` provide
the target-independent command boundary. No method interprets guest bytecode.

Stop events contain `kind`, `signal`, `pc` and optional `breakpoint`,
`temporary`, `interrupted` or `timeout`. Exit events carry `code`; signal
termination carries `signal`. `pendingSignal` excludes internal step traps,
breakpoint traps, debugger interrupts and timeout stops.

Breakpoint groups preserve user intent/IDs across runs; unique-address sites
own saved instruction bytes and a list of group owners. On a hit, EIP is
rewound and the original byte restored. Resume executes it once, then
reinstalls a still-owned site. Temporary ownership does not delete a user's
breakpoint at the same address. New processes always receive fresh patches.

The Linux backend owns allocations and the child; `destroy()` kills/reaps a
live child, restores a changed terminal, then frees all buffers. `Image` owns
one native file allocation; bounded `Reader` views borrow it and must not
outlive the image. DIEs, rows and CFI reference those views; destroy the image
only after all debugger operations finish. CFI is interpreted from CIE/FDE
rules, not guessed from instruction patterns or presumed frame sizes.
At packaging time, bootstrap/bridge CFI comes from the same macro-emitted ABI
frame plans as the code. Existing bootstrap frame boundaries must match that
plan exactly before CFI is incorporated. The live unwinder does not perform
instruction-pattern inference.

## Acceptance

The checked-in real-kernel driver runs on both hosts:

```sh
js_min.exe guest_vm/tools/check_kernel_debugger.js artifacts/debug.exe
./artifacts/guest_vm.exe guest_vm/tools/check_kernel_debugger.js artifacts/debug.exe
```

It exercises complete kernel decoding, source/variable edits where available,
optimized variable availability, stepping, unwinding, restart persistence,
signals, and interrupt/resume of the bounded GC workload.
It additionally checks full interpreter → bootstrap → main → bridge unwinding,
reads main parameters through the bootstrap, and tests caller PC/SP/EBP/EBX/
ESI/EDI recovery at bootstrap and bridge prologue/epilogue boundaries.

Command-path testing:

```sh
js_min.exe kernel_debugger.js --batch --commands guest_vm/tools/kernel_debugger_acceptance.commands artifacts/debug.exe
```

See [recorded acceptance](kernel-debugger-status.md) for the tested host/target
matrix. Generated logs remain temporary artifacts, not checked-in test output.

The additional `guest_vm/tools/kernel_debugger_main.commands` workflow checks
ELF entry-symbol fallback, compiled main arguments/locals/source stepping and
return into its ABI bridge under both debugger hosts.

See [the plan](kernel-debugger-plan.md) for scope and implementation stages.
