# Embedding API reference

This is the implemented JavaScript embedding API, not the C image-launch ABI
or an arbitrary Node-compatible API. Sources: [`vm.js`](../vm.js),
[`interpreter.js`](../interpreter.js), [`runtime.js`](../runtime.js),
[`node_environment.js`](../node_environment.js). Examples use ES3 syntax and
assume the working directory is `mmvm_v2_tests`.

## Loading and exports

CommonJS, with no package manifest:

```js
var VM = require("./guest_vm/guest_vm.js");
// require("./guest_vm/vm.js") returns the same constructor.
```

js_min shell:

```js
load("guest_vm/guest_vm.js");
var VM = GuestVM;
```

Exports are `VM`, `VM.JSRuntime`, `VM.JSContext`, `VM.Execution` and
`VM.Frontend` (Parser, Compiler, verify). Shell aliases include
`GuestVMJSRuntime` and `GuestVMJSContext`. Use the single loader rather than
manually duplicating its module load order. A bare constructor supplies
language built-ins and VM facilities, **not** filesystem/module/timer/socket
services from the example command-line environment.

## Constructors and ownership

`new VM(options)` creates `.jsRuntime`, its default `.context`, and the
underlying semantic `.runtime`. `new VM.JSRuntime(options)` creates a runtime
without an application context; call `.createContext()`. Context creation is
normally through that method, not directly constructing `JSContext`.

Guest object values crossing the API are opaque runtime-owned handles, with
implementation fields such as `guestType` and `heapAddress`. Do not mutate
those fields or use JS property access on a handle to read a guest property.
Use runtime operations. Primitive values can cross as JS primitives. Host
objects/functions cannot be stored directly in guest cells: translate them
to guest records or use `makeHostFunction`. Never pass a guest handle or
registered program to another runtime. Same-runtime contexts can share guest
values. Numeric heap offsets are not transferable ownership tokens.

Host `String(handle)` or `Number(handle)` is not guest object coercion. A
bridge implementing guest-observable conversion must use Runtime's
`toString`/`toNumber` operations rather than converting the opaque host
handle. The numeric callback example below intentionally receives primitives.

Contexts have separate globals but share the runtime's built-in objects and
prototypes. They are not fully isolated realms. Keep independently mutated
built-in state in separate runtimes or use a deliberate reset protocol.

### Constructor options

All booleans default false unless stated otherwise.

| Option | Current behavior |
| --- | --- |
| `heapBytes` | Initial logical capacity; default 64 MiB. Integer >=4096. |
| `maxHeapBytes` | Maximum capacity; default 512 MiB if `heapBytes` omitted, otherwise the explicit initial size. Must be >=initial and <=1 GiB. |
| `gcThreshold` | Positive allocation-debt/record threshold; default 8192. Not a byte limit or time interval. |
| `gcStress` | Sets embedding GC threshold to 1. Not identical to the runner's native stress mode. |
| `nativeInterpreter` | Compile/load the kernel interpreter; JS backend on Node, i386 on js_min. |
| `nativeOperandPredecode` | Select predecoded native operand mode; image compatibility includes this mode. |
| `threadedCompile` | Optional structured-JS compilation path; not threads. Prefer one execution strategy rather than combining it with native interpretation. |
| `rawFFI` | Expose raw FFI/memory globals. Unsafe; real native execution unavailable on ordinary Node. |
| `rawFFIBridge` | Explicit bridge used when installing raw FFI. Node snapshot builds supply the deferred-symbol bridge; it is not general libc emulation. |
| `profile` | Opcode/function/native profile accounting. |
| `traceExceptions` | Additional exception diagnostics. |
| `forbidHostCalls` | Reject explicit host-mode CALL/CONSTRUCT with HostCallError. Does not reject every portable semantic fallback. |
| `logHostCalls` | Log those explicit embedding transitions, names/locations/value kinds. Not a trace of every FFI operation or native exit. |
| `verifyNativeHeap` | Additional native-heap/frame/free-index verification; diagnostic overhead. |
| `retainNativeBuildIR` | Keep normally discarded build IR for diagnostics. |
| `compactProgramStorage` | Compact retained program storage; defaults true for snapshot output, false otherwise. Does not change JS semantics. |
| `snapshot` | Explicit output path; requires native interpretation. Low-level kernel/image builder option, not an application checkpoint API. |
| `deferSnapshotWrite` | Defer output so the runner can prepare the generic standalone runtime. |
| `withSnapshot` | Load interpreter code from an explicit snapshot into an embedding runtime; requires native interpretation. Does not launch its saved standalone application environment. |
| `skipSnapshotHash` | Compatibility option requiring `withSnapshot`; current loading checks contract/modes without recomputing source fingerprints. |

`snapshot` and `withSnapshot` are mutually exclusive. Constructing a complete
standalone image requires the runner's preparation sequence, not just setting
`snapshot` on a VM and serializing arbitrary application state. Internal
lower-level components have additional options; they are not implicitly
options of `VM` unless Runtime reads them.

## JSRuntime methods

- `createContext()` -> `JSContext`. Registers a fresh context/global in this
  runtime. Throws after runtime destruction.
- `installStandardLibrary(readSource)` -> no specified result. Idempotent
  once successfully installed. `readSource(relativeFilename)` must return
  source text synchronously. Loads the guest array/object/Math/JSON/number/
  regexp/Buffer algorithms in a private registered bootstrap context and
  updates shared built-ins. This does not install the Node-like I/O layer.
- `internString(value)` -> primitive string representation backed by a live
  interned record. It does not return an address or permanently root the atom.
- `retain(value)` -> integer root token; `retained(token)` -> value;
  `release(token)` -> no specified result. Tokens are one-based slots and
  can be reused after release; stale tokens must not be reused. They are not
  heap addresses. Retain guest values the embedder keeps across allocations/
  collection, then release exactly once. Merely keeping a handle in a host
  variable does not keep its guest record alive.
- `collect()` -> implementation diagnostic count, **not bytes freed**.
  Requests immediate collection; normally collection is automatic. Do not
  build portable policy around the numeric result.
- `inspectHeapRecord(address)`, `inspectExecution(execution)`,
  `inspectNativeFrames(maximumFrames)` -> diagnostic descriptions; see below.
- `destroy()` -> no specified result. Destroys registered contexts, runtime
  allocations and compiled code. Idempotent. Every guest/native pointer and
  runtime-owned handle becomes unusable afterwards.

## JSContext methods

### Compilation and entry

- `compile(source, filename)` -> verified, runtime-registered program
  descriptor. Throws lexical/parse/verification errors before execution.
- `compileEval(source, filename, strict, callerProgram, callerEnvironment)`
  -> eval program with the selected strict/caller scope. This is a lower-level
  integration entry; normal guest eval should use the installed eval function.
- `start(source, filename)` -> Execution, equivalent to compile then
  `startProgram`.
- `startProgram(program)` -> Execution. Requires no active execution;
  instantiates global declarations before entering the script.
- `startFunction(callable, receiver, args)` -> Execution. The callable must
  be a guest **bytecode function** from the same runtime; `args` is an
  embedding JS array of guest values/primitives. It honors the function's
  home context and closure. It is not an entry for a host callback handle.

Program descriptors are internal-shaped, not immutable portable bytecode
files. Do not edit their code/maps by hand or move registered programs to
another runtime. An unexecuted cached program is not kept alive merely
because the embedder stores its descriptor. The current internal cache APIs
are `jsRuntime.runtime.retainProgram(program)` and `releaseProgram(program)`;
retention is set-like, not reference-counted. Use these deliberately for
long-lived compiled-program caches, and pair release only when the cache
is finished. This is different from retaining a normal guest object value.

### Synchronous execution

- `run(source, filename)` -> script return value; normal script compilation
  returns **undefined**, not the last expression's value.
- `runProgram(program)` -> run a program to completion.
- `runExecutionToCompletion(execution)` -> service explicit host callbacks
  and keep resuming until completed/threw; returns value or throws exception.
- `runEval(source, filename)` -> eval-style completion value, with eval
  declaration/strictness rules.
- `evaluateProgram(program)` -> run with cleanup/abort in a finally block
  and clear the published frame even on abnormal exit. It is not a synonym
  for “evaluate the last expression” on a normal script program.

Synchronous methods do not give the embedder a scheduling turn at every
budget boundary; they grant more budget internally. Native/threaded helpers
currently choose Infinity; portable helpers use finite slices. For explicit
cooperative scheduling, use `start` and `resume` yourself.

### Globals, callbacks and lifecycle

- `installGlobal(name, value)` -> result of Runtime's global write.
- `makeHostFunction(name, callback)` -> guest-callable host-mode function.
  Callback signature is `(receiver, args, callContext)`; it may return a guest
  value/primitive or throw. It does not automatically install the global.
  Host-created callbacks are registered runtime roots in the current
  implementation; there is no public per-callback unregister method.
  Destroying a context or releasing a separate retain token does not remove
  that callback root. Avoid creating unbounded ephemeral embedding callbacks
  in one long-lived runtime.
- `shareGlobalObject(otherContext)` -> no specified result. Both contexts
  must be live and belong to the same JSRuntime. Shares, not copies, global
  object identity and updates the heap context record.
- `destroy()` -> abort active execution and unregister this context;
  idempotent. Does not destroy the runtime or every object/function created
  by the context. A reachable function can retain the heap home-context state
  after the embedding handle is destroyed.
- `createSnapshot()` -> in-memory `{context, heapState}` token; context must
  be live and idle. `restoreSnapshot(token)` -> same context, also idle.
  This is a mutable-graph reset mechanism used by embedding test facilities,
  **not** a standalone disk image or a general OS/I/O checkpoint. It pins
  saved property storage and retains immutable graph roots. Restore requires
  the exact originating context. Saved graphs can include shared built-ins,
  so coordinate other contexts. Tokens live in the runtime until teardown or
  explicit internal `runtime.destroyHeapStateSnapshot(token.heapState)`;
  there is no `JSContext.destroySnapshot` method.

## Convenience VM methods

`VM` delegates these methods to its default context/runtime:

| VM method | Delegate |
| --- | --- |
| `compile`, `run`, `start`, `startProgram`, `installGlobal` | corresponding JSContext method |
| `execute(program)` | `context.runProgram(program)` |
| `makeNativeFunction(name, callback)` | `context.makeHostFunction`; despite the name, this is an embedding callback, not arbitrary machine code |
| `installStandardLibrary`, `retain`, `retained`, `release`, `collect` | JSRuntime methods |
| `inspectHeapRecord`, `inspectExecution`, `inspectNativeFrames`, `destroy` | JSRuntime methods |

There is no convenience `VM.createContext`, `VM.runEval` or `VM.internString`
method. Use `vm.jsRuntime` or `vm.context` as appropriate. `.runtime` exposes
internal Runtime operations, not a second JSRuntime facade.

## Execution protocol

`execution.resume(budget)` accepts a nonnegative integer or Infinity; omitted
means Infinity. Zero yields without running an instruction. Invalid budgets
throw RangeError. A pending host call must be completed/failed before resume;
terminal completed/threw/aborted executions cannot be resumed.

Every returned result has `status`, `instructions` (this resume call) and
`totalInstructions`. Status-dependent fields:

| Status | Fields and action |
| --- | --- |
| `budget` | No completion value. Grant more budget later or abort. |
| `hostCall` | `call: {name, receiver, arguments}`. Complete/fail it; do not resume first. |
| `completed` | `value`. The context is available for another execution. |
| `threw` | `exception`. The context is available for another execution. |

Internal `.status` can also be ready/running/aborted. Aborted is not a normal
resume result. Budgets are not wall-clock watchdogs, and cannot preempt a
blocking native call or guarantee a strict bound on every intrinsic's work.

- `completeHostCall(value)` publishes the return value and makes execution
  ready. It can reach a GC safe point; keep external values rooted as needed.
- `failHostCall(error)` queues an exception at the suspended call. Guest
  exception handling happens when resumed, not when this method is called.
- `serviceHostCall()` invokes the stored callback, then completes or fails
  the pending call. It catches callback exceptions; internal completion/GC
  failures are not disguised as a second callback failure.
- `abort()` drops frames and pending call/exception state and clears the
  context's active execution. It does not run guest finally handlers.

`VM.Execution.fromFunction(...)` exists as an internal static constructor;
prefer `context.startFunction` so active-execution ownership is registered.
Do not construct `Execution` or modify `.frames` directly in an embedder.
`serviceHostCall` is synchronous and does not await a Promise. For an async
embedder operation, keep the execution suspended and call `completeHostCall`
or `failHostCall` when the operation finishes, retaining any guest values
held by the pending external work.

## Minimal examples

### A synchronous callback

```js
var VM = require("./guest_vm/guest_vm.js");
var vm = new VM();
try {
    vm.installGlobal("hostAdd", vm.makeNativeFunction("hostAdd",
        function (receiver, args, callContext) {
            return Number(args[0]) + Number(args[1]);
        }));
    vm.run("var answer = hostAdd(20, 22);", "example.js");
    var answer = vm.runtime.getProperty(vm.context.globalObject, "answer");
    if (answer !== 42) throw new Error("wrong answer");
} finally {
    vm.destroy();
}
```

### Scheduling without automatically serving the callback

```js
var VM = require("./guest_vm/guest_vm.js");
var rt = new VM.JSRuntime();
var cx = rt.createContext();
try {
    cx.installGlobal("out", cx.makeHostFunction("out",
        function (receiver, args) { return undefined; }));
    var execution = cx.start("out(6 * 7);", "scheduled.js");
    while (true) {
        var result = execution.resume(1000);
        if (result.status === "budget") continue;
        if (result.status === "hostCall") {
            // The embedder could queue this request and return to its event loop.
            if (result.call.arguments[0] !== 42) throw new Error("wrong request");
            execution.completeHostCall(undefined);
        } else if (result.status === "completed") break;
        else if (result.status === "threw") throw result.exception;
    }
} finally {
    rt.destroy();
}
```

Within a live VM setup, before running application code, install the shared
library on Node as follows:

```js
var fs = require("fs");
vm.installStandardLibrary(function (filename) {
    return fs.readFileSync(filename, "utf8");
});
```

On js_min supply `function (filename) { return read(filename); }` instead.
Do this on a live VM before running code that needs the guest algorithms.

## Guest-visible extension boundary

With `rawFFI` explicitly installed, guest globals include:

| Function | Contract |
| --- | --- |
| `get_dlsym()` | Return the native symbol-lookup pointer. |
| `ffi_call(pointer, arg0, ...)` | Call a native address with up to eight arguments, in the supported i386 word ABI. Numbers/pointers and string marshalling are supported paths, not a general C type/signature system. |
| `peek8(pointer)`, `poke8(pointer, value)` | Raw byte access. |
| `peek32(pointer)`, `poke32(pointer, value)` | Raw little-endian word access. Treat pointers/words as 32-bit bit patterns; use explicit signed/unsigned coercion where needed. |

These are native process addresses, not guest record offsets. They bypass
ordinary JS memory safety and are not bounded by the guest heap. A pointer
does not retain a Buffer/backing; keep the owning value rooted while using
it. String marshalling is NUL-terminated byte-oriented data, not an implicit
universal UTF-8 conversion or permission for C to retain the temporary pointer.
Floating-point native helpers in the kernel do not turn this into a generic
by-value C double/struct/callback ABI. Node cross-build symbol placeholders
cannot execute such calls. `host_ffi.js` defines the embedding bridge and
`ffiCallKernel` defines the native guest path.

Buffer/typed-array globals are runtime facilities implemented by `buffer.js`,
`buffer_runtime.js` and `typed_array.js`, not the host's Buffer objects. They
support the checked-in workloads; do not promise full current Node Buffer or
modern typed-array APIs. Their ownership/view representation is described in
[data structures](data-structures.md).

The runner environment additionally installs `arguments`, `process`,
`console`, `require`, `load`, `read`, `print`, `quit` and timer/frame scheduling
facilities. These are not all present on a bare VM. Standalone `require`
recognizes `fs`, `net`, `http`, `path`, `module`, and relative `.js` modules
with CommonJS-style wrappers/cache. It is not Node's general package resolver.
`load(filename)` executes source against the runner's global namespace;
`require` executes a module wrapper. Guest source is read/compiled at runtime,
not fetched from a cache of the named application's bytecode.

## Internal extension APIs and diagnostics

For embedders implementing a bridge, `vm.runtime` provides `makeObject`,
`arrayFrom`, `getProperty`, `setProperty`, `defineDataProperty`, `getGlobal`
and `setGlobal` plus heap/value accessors. `getGlobal(context, name)` and
`setGlobal(context, name, value)` are the explicit-context forms; prefer them
over legacy implicit-context overloads. These APIs operate on guest handles,
not host-object mirrors. Reentrant callbacks, accessors and allocation can
collect; use persistent roots and do not preserve temporary descriptor cells.
This is an internal integration surface, not a promise that every Runtime
prototype method is a stable external API.

`inspectHeapRecord(address)` checks liveness and returns type/size/mark/flags
plus type-specific fields. `inspectExecution(execution)` returns status,
instruction count and frame descriptions; native runs include run/instruction/
semantic-exit counters. `inspectNativeFrames(limit)` returns the published
native caller chain with program/name/filename/source-preview details where
available, without materializing all host registers. It returns an empty
array without a native interpreter. These are cooperative inspection APIs,
not concurrent thread-safe sampling. Avoid calling arbitrary guest `toString`
while diagnosing potentially corrupt records.

`GuestNodeEnvironment` is a separate example embedder, loaded from
`node_environment.js`. `new GuestNodeEnvironment(vm, runnerArguments,
snapshotBootstrap)` installs I/O globals and shared libraries. The runner
uses `setRunnerArguments(args)`, `run()` for its event loop, `isExit(value)`,
`exitCode`/`exiting`, `prepareStandaloneRuntimeSnapshot()` and `destroy()`.
Destroy the environment before the VM to release timer/callback/resource
roots. On Node it bridges built-in Node I/O; on js_min it uses `node_compat`.
It is a narrow compatibility environment, not a full Node implementation,
and is not automatically created by `new VM()`.
