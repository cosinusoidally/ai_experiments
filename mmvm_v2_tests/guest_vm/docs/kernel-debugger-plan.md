# Standalone kernel debugger plan

The entry point is `kernel_debugger.js`, runnable with js_min or a standalone
guest executable. All implementation is ES3-compatible JavaScript. Runtime
dependencies are libc, Linux/i386 ptrace and the target's incorporated DWARF;
there is no binutils, GDB, compiler, Node, npm or C-helper dependency.

Starting the debugger reads symbols but does not launch the target. At the
`(kdbg)` prompt, `run hello.js` starts a traced child with that argument.
`run` reuses arguments; `set args` and `show args` manage them. Breakpoints
persist across restarts; restarting a live child requires confirmation.

Implementation sequence:

1. Named libc wrappers, owned native buffers, traceable child launch,
   registers/memory, wait/status decoding and guaranteed child cleanup.
2. ELF32/i386 reader and DWARF4 reader for the existing kernel producer.
   Share producer constants, interpret line programs, DIE origins, variable
   location lists and CFI; reject unsupported input explicitly.
3. Stateful software breakpoints, continue/single-step, signal stops and
   native stack inspection. Restore the original instruction, rewind EIP,
   execute it once and reinstall a breakpoint on resumption.
4. Interactive and batch commands: run/arguments, break/delete, continue,
   instruction/source stepping, next/finish, registers/memory, source,
   backtrace/frame, scalar locals/parameters and supported variable writes.
5. Validate real kernel workloads under both hosts without external debugger
   tools. Exercise restart, breakpoint persistence, variables, unwinding and
   normal/crash exits; retain logs only in ignored artifacts.

The debugger is single threaded. Running-state input uses poll and nonblocking
waitpid. Signals and debugger-generated traps must remain distinguishable.
Linux tracing restrictions are diagnosed, not bypassed with emulation.
No target executable/snapshot is modified on disk.

Initial scope is native kernel code and the DWARF subset emitted by this repo,
not arbitrary C or guest JS debugging. Unsupported/unavailable variable
locations are never guessed. Source display reads project-relative files.
An optional future `guest_vm_debugger.js` can consume the core's target-access
and command-registration APIs; the core must not know guest heap/bytecode
layouts. A full plugin framework is not required now.

Implementation and command limitations are documented separately in
`kernel-debugger.md` as working stages are completed.

Implemented 2026-11-13: the five stages above now have focused both-host
acceptance. See [recorded results](kernel-debugger-status.md) and
[current usage/implementation](kernel-debugger.md). This closes initial kernel
debugger bring-up, not the deliberately deferred general-C/guest-JS extensions.
