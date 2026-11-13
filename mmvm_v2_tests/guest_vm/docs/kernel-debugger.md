# Native kernel debugger

`kernel_debugger.js` runs from mmvm_v2_tests under js_min or a standalone
guest executable. Linux/i386 and libc's ptrace interface are required. No
GDB, binutils, Node, npm, compiler or native helper is used by the debugger.
The target must be a fixed-address ELF32/i386 executable with incorporated
kernel DWARF4, produced by the repository's `-g` build/packager pipeline.
Source display additionally needs the original project-relative source files.

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
`set variable NAME = VALUE`, `list [FILE:LINE]`, `x/COUNTwx ADDRESS`,
`x/COUNTbx ADDRESS`, `assert NAME|$REGISTER == VALUE`, `quit`.
Common short forms include `r`, `b`, `c`, `si`, `s`, `n`, `bt`, `f`, `p`, `l`, `q`.
Arguments support quotes and backslash escaping, not shell expansion.

## Execution and inspection contract

The engine is single threaded. A stopped child is inspected through ptrace;
running waits use WNOHANG and poll. Interactive Ctrl-C interrupts the child;
typing `interrupt` followed by Enter also works while it runs. The debugger
owns stdin; the child receives `/dev/null`, with stdout/stderr inherited.
Interactive target input and terminal-job control are not yet supported.

`--timeout-ms N` bounds each running wait (default 30000 ms); timeout requests
a stop and leaves the inferior inspectable. Source stepping also has a
100000-instruction limit. It uses ptrace stepping and temporary return
breakpoints and is not intended for executing long loops instruction by
instruction. Breakpoint definitions survive restarts; patched bytes exist
only in child memory. Executable and snapshot files are opened read-only.

Variables are kernel signed 32-bit scalars. The reader respects location-list
PC ranges, including optimized-out/uninitialized intervals. Caller registers
are recovered only when CFI says how; a caller-saved register without a rule
is unavailable. Register writes require frame 0; address-backed scalar writes
can use an unwound frame. Native backtrace includes applicable inline names;
inline variables without concrete locations are not fabricated.

Only the emitted DWARF subset is supported. Unknown forms, line opcodes and
unwind operations fail explicitly. Backtrace preserves preceding frames and
reports an unwind error instead of making register inspection impossible.
This is not a general C debugger or guest JavaScript debugger.

## Implementation

- `debugger/linux_i386.js`: sole libc/FFI tracing and I/O boundary, signed-word
  normalization, register fields, owned native buffers and terminal cleanup.
- `debugger/image.js`: bounds-checked native-memory file views and ELF reader.
- `debugger/dwarf.js`: producer constants, DIEs/origins, lines, location lists
  and CFI interpretation. The executable image is held once in native memory.
- `debugger/engine.js`: lifecycle, breakpoint ownership, stepping and frames.
- `debugger/commands.js`: command registration, interactive/batch UI and scalar
  evaluation. Future extensions can use the engine's target-access APIs and
  `UI.registerCommand`; no guest heap layouts are built into the core.

See [the plan](kernel-debugger-plan.md) for scope and implementation stages.
