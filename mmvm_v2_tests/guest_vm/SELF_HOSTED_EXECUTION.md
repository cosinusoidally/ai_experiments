# Self-hosted execution direction

## Objective

The MMVM-hosted guest VM must eventually use `js_min.exe` only to bootstrap.
After loading the VM and entering its execution engine, normal guest execution
must not return to SpiderMonkey for instruction budgets, intrinsic operations,
timers, I/O, garbage collection, or host-call dispatch. The engine may call
libc and operating-system services directly.

The Node.js backend necessarily remains different: without a native-code entry
mechanism it must execute the low-level engine as JavaScript and return to
Node's event loop for asynchronous services. Both backends must nevertheless
share bytecode semantics, heap layouts, field accessors, and platform-service
contracts.

This is a direction and a migration contract. The current interpreter has not
yet reached this endpoint.

The concrete authoritative record layouts, handle/cache rules, shared compiler
IR, dual-backend boundary, and migration gates are specified in
`HEAP_AND_COMPILER_DESIGN.md`.

## Current migration checkpoint

The current implementation has completed these preparatory steps:

- function locals are resolved to numeric lexical slots;
- non-capturing leaf bindings and constants have fixed VM register numbers;
- `JSRuntime` lazily owns a private `Heap` and `ValueCells` accessor;
- explicit 16-byte non-NaN-boxed cells round-trip primitive values and heap
  references through Node-emulated and MMVM-native linear memory;
- fixed authoritative layouts cover strings, properties, arrays, environments,
  functions, frames, registers, regexps, and Buffer records;
- one kernel front/middle end emits executable JavaScript and native i386, with
  a bulk heap-store kernel tested against identical heap results;
- high-bit word writes are normalized at the central `HostMemory` boundary;
- opcode profiling spans asynchronous callback executions;
- a portable structured backend compiles bytecode/AST metadata to JavaScript
  without evaluating original guest source, including environment-backed
  closures and guarded shape-specialized paths;
- finite instruction budgets continue to select the resumable interpreter,
  while the command runner's unlimited slices may use compiled callbacks.

Objects, arrays, frames, environments, strings, programs, bytecode, contexts,
Buffer views, and inline Buffer bytes now have authoritative runtime-heap
records, and the kernel-compiled marker/sweeper collects that graph. Host
handles and metadata maps remain transitional caches used by semantic exits;
they are no longer guest storage. The principal unfinished boundary is core
builtin and slow-path execution: unsupported JavaScript semantics still return
to host JavaScript callbacks. Those operations must move behind the shared
kernel builtin/service ABI. Raw integer/pointer FFI is now entered directly by
the native engine. Higher-level MMVM platform services—including timers,
polling, sockets, files, output, and scheduling—must use this native service
path instead of returning to SpiderMonkey. Node implements the same service
contract with JavaScript and its event loop.

The first part of that service ABI is now live. Shared kernel IR has a typed
`callNativeI32(pointer, ...)` operation accepting up to eight cdecl arguments.
The i386 backend emits the indirect call exclusively through named macro
assembler operations; the JavaScript backend invokes the same operation
through the linear-memory service contract. Guest `get_dlsym` and `ffi_call`
are native interpreter intrinsics on MMVM. Integer/pointer arguments and
temporary NUL-terminated string arguments are prepared in runtime-owned memory,
then libc is entered without a semantic exit to SpiderMonkey. This is the
foundation for the remaining timer, polling, file, socket, output, and event
scheduler services.

Bootstrap-resolved native entry points live in a dedicated
`PLATFORM_SERVICES` heap record referenced by `ENGINE_STATE`; they are not
mixed with guest strings, objects, or host JavaScript metadata. The collector
keeps the table alive through that named engine-state edge, while treating its
contents as native pointers rather than guest references.

## Execution boundary

The intended MMVM startup sequence is:

1. `js_min.exe` loads the ES3-compatible bootstrap.
2. The bootstrap allocates the runtime's private linear memory and resolves the
   small libc surface needed by the platform backend.
3. The kernel compiler emits the native execution engine from checked-in
   JavaScript kernel-dialect functions. Raw machine-code blobs are forbidden.
4. Control enters the generated engine.
5. The engine runs guest bytecode, collects garbage, schedules contexts, and
   services platform operations without returning to the host JavaScript VM.
6. Control returns to `js_min.exe` only for final process shutdown or an
   unrecoverable bootstrap/engine failure.

Calling libc from generated engine code does not count as returning to the host
VM. Calling a SpiderMonkey JavaScript callback does.

Under Node.js, steps 3--5 are represented by a JavaScript implementation with
the same accessor and service interfaces. It may yield to Node for timers and
nonblocking I/O.

## Guest value representation

NaN boxing is prohibited. Guest values use explicit tagged value cells. A
value cell has a 32-bit tag and a separately stored payload. The concrete
linear-memory layout will reserve enough aligned payload space for an IEEE-754
double, a 32-bit heap reference, or an immediate boolean/null/undefined value.
Numbers therefore remain unboxed in frames and temporary value cells; storing
a floating-point result must not allocate a heap object. Heap object fields use
the same value-cell format.

References are 32-bit offsets into the owning `JSRuntime` linear heap. They are
never host pointers and cannot refer to another runtime. Strings, objects,
arrays, functions, environments, bytecode metadata, and Buffer views are heap
records reached through those offsets. Native backing-store addresses are
platform resources referenced by heap-owned records, not guest object identity.

All layout offsets and raw memory operations live behind named accessors. The
interpreter, collector, built-ins, and embedders must not scatter `peek8`,
`poke8`, `peek32`, or `poke32` calls.

## Frames and lexical bindings

Named host-object dictionaries are not an acceptable steady-state frame
representation. Compilation resolves function-local bindings to numeric
`(environment depth, slot)` pairs. Frames and closure environments store value
cells in fixed slots. Only true global/object property operations perform
name-based lookup.

The migration is deliberately staged:

1. Resolve lexical names to numeric slots while retaining JavaScript arrays as
   temporary storage.
2. Put bytecode, program metadata, frame records, environment links, and slot
   cells in runtime-owned linear memory behind accessors.
3. Port the bytecode dispatch loop and numeric/property hot paths to the kernel
   dialect.
4. Compile that kernel implementation through the checked-in native compiler
   on MMVM; keep the JavaScript form as the Node backend and reference model.

Each stage must preserve closures, shadowing, declaration instantiation,
multiple contexts, instruction budgets on the embedding API, and automatic GC.
The final MMVM command-line runner may grant an unlimited internal slice even
though the general embedding API continues to support budgets.

## Platform services

The current `hostCall` status remains useful to general embedders and to Node,
but the MMVM command-line backend must replace its frequent callback round trips
with internal platform services. At minimum these include:

- monotonic and wall-clock time;
- timer scheduling and cancellation;
- nonblocking file, socket, and poll operations;
- standard streams and process exit;
- allocation and release of runtime heap regions;
- the controlled libc/FFI surface required by existing MMVM examples.

An internal service may suspend one guest context and schedule another without
leaving the engine. Completion is written into the suspended frame's destination
cell before it is made runnable again. Node maps the same request/completion
contract onto its built-in event loop.

The raw `peek`/`poke` memory primitives are exceptional fast intrinsics. They
must be bounds-checked or capability-scoped where required by the embedding,
but they do not need to become asynchronous host calls.

## Performance policy

Performance work should remove structurally expensive operations rather than
special-case a demo. Priorities are:

1. numeric lexical slots instead of string environment lookup;
2. numeric array/Buffer indices without string conversion;
3. compact bytecode and frame/register access;
4. monomorphic property caches or shapes after the heap representation exists;
5. a kernel-dialect dispatch loop compiled to native code on MMVM.

Every optimization needs focused semantic tests, full Node and MMVM regression
runs, and a before/after demo measurement at the same resolution and frame cap.
