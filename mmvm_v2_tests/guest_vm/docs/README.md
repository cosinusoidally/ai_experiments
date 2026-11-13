# Guest VM: current implementation reference

This directory is the authoritative maintainer and embedder documentation
initially audited at `fa54ddb` (native interpreter contract 98), reviewed
2026-11-04 and updated with the cleanup work tracked below. It describes what
the code does, not the intended endpoint of the earlier plans. Update these
documents alongside implementation changes.
Source definitions remain the final authority for binary layouts and flags.

The current native interpreter uses contract **103**, which adds the Math and
String semantic continuation handoffs described in
[semantic-unification.md](semantic-unification.md). The Object-operation cutover
introduced contract 102. See
[semantic-unification.md](semantic-unification.md) for guest built-in
continuations, private normalized primitives and shared exotic-property
policy. Its current acceptance results are tracked separately from older
completed cleanup reports; do not infer a full-suite pass from focused checks.

Ongoing work is tracked in [the cleanup approach and issue register](cleanup.md).
It separates completed changes from remaining architectural work and records
the validation required at each working point.

Start here:

1. [Architecture and source map](architecture.md): terminology, execution
   modes, ownership boundaries and where to look in the code.
2. [Heap and data structures](data-structures.md): values, objects, property
   indexes, strings, arrays, environments, programs, frames and buffers.
3. [Execution and collection](execution-and-gc.md): dispatch, calls, yielding,
   exceptions, root publication, allocator ownership and GC.
4. [Compilation](compilation.md): guest JavaScript to bytecode, and kernel
   JavaScript to shared IR to JavaScript/i386 code.
5. [Self-hosting and snapshots](self-hosting.md): the bootstrap layers,
   actual rebuild process, image format, relocation and launch-time state.
6. [Embedding API](api.md): constructors, options, methods, execution results,
   host callbacks, rooting and lifecycle rules, with runnable examples.
7. [Commands and maintenance](maintenance.md): runner options, diagnostics,
   tests, compatibility changes and safe development workflows.
8. [Snapshot executables](snapshot-executable.md): pure-JS ELF packaging,
   startup ABI, file layout, host support, and validation.
9. [Native kernel debugging](kernel-debugging.md): `-g`, `-O0`, DWARF sidecars,
   executable incorporation, variable availability and debugger use.
10. [Standalone kernel debugger](kernel-debugger.md): interactive/batch
    `kernel_debugger.js`, Linux/i386 tracing, ELF/DWARF, source/variable
    inspection and native disassembly without installed development tools.

Design and acceptance checklist:

- [Deterministic kernel debugging and -O0](kernel-debug-plan.md): separate
  DWARF, GDB/objdump, variable locations, debug-friendly compilation,
  reproducible artifact identity and required -O0 benchmarks.

Important current facts:

- The language target is ES5.1, authored in old-shell-compatible JavaScript.
  This is **not yet a fully compliant ES5.1 implementation**. Buffer, typed
  arrays, FFI and the narrow Node-like environment are extensions; Intl is
  neither required nor provided.
- An embedded `JSContext` gives a fresh global object, not an independently
  cloned set of built-in prototypes. Contexts in one runtime share objects
  unless explicitly copied. A runtime, not a context, owns their memory.
- Ordinary objects use packed property entries with an optional hash index.
  Arrays, functions and other special kinds still use linked named-property
  descriptors. Neither “all objects are linked lists” nor “all objects are
  packed hash tables” describes the implementation.
- Embedding mode still has JavaScript-side execution/metadata adapters and
  semantic fallbacks. A standalone image has no outer JavaScript VM; an
  unsupported operation cannot fall back to js_min and terminates instead.
- `forbidHostCalls` rejects explicit embedding callbacks. It is **not** a
  universal detector of every semantic fallback or outer-VM operation.
- Source is retained for function `toString`. Snapshot compactness does not
  mean deleting source, compressing files or hard-coding an application.
- Kernel configuration uses explicit scalar bindings and constant namespaces.
  Legacy constant-local options have been removed; normal mutable JS locals
  are not reinterpreted as compile-time constants.
  See [Compilation](compilation.md).

The older documents alongside `runtime.js` are historical design notes,
bring-up reports and performance investigations. They can explain decisions,
but this directory supersedes conflicting claims about the current API or
architecture. Current measured correctness/performance is recorded separately
in [the validation checkpoint](../../VALIDATION_STATUS.md) and
[Octane comparison](../../OCTANE_COMPARISON_2026-11-04.md). Passing the imported
Test262 selection is not a claim to pass all ES5.1 built-in coverage.
Subsequent cleanup validation is recorded in [cleanup.md](cleanup.md);
dated reports retain their original source identity rather than silently
acquiring the newest implementation's status.
