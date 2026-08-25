# Embedding the guest VM

## Current API status

The API documented here is the supported bootstrap embedding surface. It is
small on purpose and will grow as the VM implements more ECMAScript 5.1 and
Node behavior.
The parser and AST records are internal; the `VM` facade, runtime value handles,
and native-callback convention are the intended integration points.

The primary API uses explicit runtime and context ownership:

```js
var GuestVM = require("./guest_vm/vm.js");
var runtime = new GuestVM.JSRuntime();
var context = runtime.createContext();
```

`JSRuntime` owns the heap, garbage collector, Buffer backing stores, interned
strings, and every object created by its contexts. `JSContext` owns a fresh
global environment and its current resumable execution. A runtime can own many
contexts, and a process can own many independent runtimes. The legacy
`new GuestVM()` form remains a one-runtime/one-context convenience facade.

The resumable API is:

```js
var execution = context.start(source, "program.js");
var result = execution.resume(100000);

while (result.status === "budget") {
    result = execution.resume(100000);
}
```

Execution stops with `completed`, `budget`, `hostCall`, or `threw`. Exhausting
budget preserves the complete continuation and is not an ECMAScript exception.
A `hostCall` result must be completed or failed by the embedder before the next
resume. Inline low-level intrinsics are explicitly classified exceptions to
host-call yielding; arbitrary native callbacks are not.

## Resuming and scheduling execution

`context.start` compiles source and returns an execution without running guest
bytecode:

```js
var execution = context.start("work();", "work.js");
var result = execution.resume(50000);
```

The result records are:

```text
{status: "budget",    instructions, totalInstructions}
{status: "hostCall", instructions, totalInstructions, call}
{status: "completed", instructions, totalInstructions, value}
{status: "threw",    instructions, totalInstructions, exception}
```

Budget is local to one `resume` call and shared by every guest frame executed
during that call. A zero budget executes nothing. Exhaustion preserves the next
program counter, all registers, environments, and frames. It is not injected as
a guest exception:

```js
while (result.status === "budget") {
    result = execution.resume(50000);
}
```

Only one execution may be active in a context at present. Different contexts,
including contexts in the same runtime, can hold independent suspended
executions. `execution.abort()` discards a continuation and releases it as a GC
root.

A bytecode function records the context in which it was created. Its free
global names continue to resolve in that home context even when the function is
shared with and called from another context in the same runtime. An embedder can
also enter a bytecode function directly in its context:

```js
var execution = context.startFunction(callable, receiver, argumentsArray);
```

This is useful for routing a yielded call from one context into a handler owned
by another. See `demos/three_contexts.js` for a complete round-robin example.

## Servicing host calls

Create an external host function on the context and install it in that
context's globals:

```js
var readClock = context.makeHostFunction("readClock", function (receiver, args) {
    return hostClockMilliseconds();
});
context.installGlobal("readClock", readClock);
```

Calling it does not invoke the callback inside the interpreter. `resume`
returns first:

```js
var result = execution.resume(50000);
if (result.status === "hostCall") {
    result.call.name;       // "readClock"
    result.call.receiver;   // guest method receiver or undefined
    result.call.arguments;  // guest values
}
```

An embedder can dispatch by the public request fields and supply a result:

```js
execution.completeHostCall(clockValue);
result = execution.resume(50000);
```

Or inject a host failure on the next resume:

```js
execution.failHostCall(hostError);
result = execution.resume(50000); // currently returns `threw`
```

`execution.serviceHostCall()` is a trusted convenience that invokes the
callback registered in the host-function record and completes or fails the
request. `guest_runner.js` uses it as its host dispatcher. A more isolated
embedder can ignore the stored callback and dispatch solely from `result.call`.

Internal semantic functions have `callMode: "intrinsic"` and execute inline.
The raw `peek8`, `poke8`, `peek32`, and `poke32` bindings are deliberately
inline intrinsics. `get_dlsym`, `ffi_call`, output, and `quit` are external host
calls and yield before the command-line embedder invokes them. A synchronous
FFI callback such as libc `accept` can still block while the embedder services
that yielded call; continuation support does not make an arbitrary native
function asynchronous.

The VM is not a security sandbox. Guest bytecode is verified and interpreted
with an instruction budget, but native callbacks are trusted, resource limits
are incomplete, and the implemented language is not yet full ECMAScript 5.1.

## Node.js embedding

From `mmvm_v2_tests`:

```js
var VM = require("./guest_vm/vm.js");
var vm = new VM();

try {
    vm.run("var total = 0; for (var i = 0; i < 4; i++) total += i;", "embed.js");
} finally {
    vm.destroy();
}
```

The implementation avoids npm and does not expose a host Node Buffer to guest
code. Node uses the ordinary-array host-memory adapter while exercising the
same guest Buffer view and property logic.

## `js_min.exe` embedding

The minimal shell has no CommonJS loader. Load the complete implementation
through its single public bootstrap:

```js
load("guest_vm/guest_vm.js");

var vm = new GuestVM();
try {
    vm.run("var bytes = Buffer.alloc(4); bytes[0] = 17;", "embed.js");
} finally {
    vm.destroy();
}
```

The bootstrap owns the internal dependency order and installs `GuestVM`,
`GuestVMJSRuntime`, and `GuestVMJSContext`. Embedders should not load the
individual implementation modules themselves.

Run the shell with the Firefox library directory supplied through
`LD_LIBRARY_PATH`; do not add an rpath. `host_memory.js` resolves `calloc` and
`free` when it detects the MMVM FFI primitives.

### Command-line Node compatibility profile

The checked-in `guest_runner.js` additionally loads `node_environment.js` on
both Node.js and `js_min.exe`. This is a runner policy, not something performed
by the public VM bootstrap. It installs the limited host API required by
`node_web.js`, `demo1.js`, and `demo2.js`. The MMVM backend transfers control to its
libc-backed event loop after main guest execution; the Node backend leaves its
built-in asynchronous handles registered with Node's event loop.

An embedder wanting the same policy constructs the environment after its VM
and before compiling the program:

```js
load("guest_vm/guest_vm.js");
load("guest_vm/node_environment.js");

var vm = new GuestVM({rawFFI: true});
var environment = new GuestNodeEnvironment(vm,
    ["node_web.js", "--directory", "artifacts/www", "8000"]);
```

Run the main program with the ordinary resumable API, servicing each yielded
host call. Once it completes, call `environment.run()` to enter the event loop.
On shutdown call `environment.destroy()` before `vm.destroy()`. The environment
retains guest callbacks while libc work is pending, invokes each callback via
`JSContext.startFunction`, and releases one-shot roots automatically.

The adapter selects its backend at construction. A CommonJS embedder requires
it normally; a minimal-shell embedder loads it after `guest_vm.js`. The current
guest profile supports
`require("http")`, `require("fs")`, `require("net")`, and relative `.js`
modules. It is sufficient for `node_web.js` and the X11 module chains used by
`demo1.js` and `demo2.js`; embedders must not assume general Node compatibility.

## Compile, execute, and run

`VM.run(source, filename)` is the backwards-compatible convenience path. It
tokenizes, parses, compiles, verifies, automatically services yielded registered
host callbacks, and runs with unlimited budget against its one default context.
Globals therefore survive subsequent `run` calls on the same facade. Embedders
that need scheduling or host-call control use `JSContext.start` and
`Execution.resume` instead.

For caching or inspection, split the operations:

```js
var program = vm.compile("var answer = 6 * 7;", "answer.js");
var result = vm.execute(program);
```

`compile` returns an internal verified program record containing flat bytecode,
constants, and a register count. Treat it as immutable. Bytecode has no stable
serialization/version contract yet; do not persist it between VM revisions.

The compiler currently appends an implicit `return undefined`. Compatibility
`execute` returns that value and throws an uncaught execution failure. The
resumable API instead returns `completed` or `threw` records without losing the
continuation before a terminal state.

## Installing globals and native functions

Install a primitive or existing guest value with:

```js
vm.installGlobal("hostVersion", "bootstrap-1");
```

Create an external host function with the compatibility facade:

```js
var add = vm.makeNativeFunction("hostAdd", function (receiver, args) {
    return Number(args[0]) + Number(args[1]);
});
vm.installGlobal("hostAdd", add);
vm.run("assertEqual(hostAdd(20, 22), 42, 'native call');", "native.js");
```

The callback ABI is:

```text
callback(receiver, argumentsArray) -> guest-compatible value
```

For a method call, `receiver` is the guest object before the dot or brackets.
For a plain call it is currently `undefined`. Arguments are guest values.
Callbacks may return guest primitives or guest objects created by the runtime.
With the resumable API the call yields before this callback runs. A callback
failure is injected when the execution resumes; because guest `try`/`catch` is
not implemented yet, it currently becomes a terminal `threw` result.

Native callbacks are trusted. They must use runtime property operations rather
than reading arbitrary implementation fields when implementing guest-visible
behavior:

```js
var value = vm.runtime.getProperty(guestObject, "name");
vm.runtime.setProperty(guestObject, "name", "updated");
```

`Runtime.makeObject()` creates and registers an ordinary guest object. The
ordinary prototype/descriptor model is incomplete, so embedders should keep
custom objects simple until that milestone lands.

## Optional raw FFI compatibility

The VM does not expose process symbols by default. The unchanged repository
`hello.js` is a shell-FFI integration example, so `guest_runner.js` explicitly
constructs its VM with:

```js
var vm = new VM({rawFFI: true});
```

This installs guest-callable `get_dlsym`, `ffi_call`, `peek8`, `poke8`,
`peek32`, `poke32`, and `quit`. Under `js_min.exe` they
delegate through `host_ffi.js` to the real shell primitives. Node cannot emulate
arbitrary process symbols or MMVM's pointer-shaped call ABI; constructing a
Node-hosted VM with `rawFFI: true` therefore throws immediately. `hello.js` is
an MMVM-only integration test, while the language and Buffer suites run on both
hosts.

Raw FFI is a trusted embedding capability. An MMVM guest with it can resolve
and call arbitrary process symbols subject only to the shell's eight-argument
FFI shape. It is not a sandbox-safe API and should not be enabled for untrusted
guest source. The Buffer implementation can still use its private host-memory
boundary when raw FFI is not exposed to the guest.

`guest_runner.js` also converts every command-line value after the program path
to a guest array and installs it as the top-level `arguments` binding. Direct
embedders that want shell-style arguments can do the equivalent explicitly:

```js
vm.installGlobal("arguments", vm.runtime.arrayFrom(["--flag", "value"]));
```

`arrayFrom` is currently a bootstrap runtime helper rather than a frozen public
API; embedders should isolate this call so it can follow a later stable value
conversion API.

## Retaining values across host work

The collector cannot see a guest value stored only in an external host closure,
poll record, or asynchronous request. Retain it explicitly:

```js
var handle = vm.retain(guestValue);

/* Later, before or during a callback. */
var stillAlive = vm.retained(handle);

/* After the host operation can no longer refer to it. */
vm.release(handle);
```

Handles are positive integers and are opaque. A retained value is a collector
root. Releasing twice, resolving after release, or using an invalid handle
throws. Every successful `retain` must have one eventual `release`; `destroy`
invalidates all remaining handles.

For asynchronous I/O, retain the callback and every Buffer/view whose native
pointer may be used by the pending operation. Release them only after completion
or cancellation has removed every native use.

## Automatic collection

Guest garbage collection is automatic. Guest-object and Buffer allocations
accumulate allocation units; after the default 1,024-unit threshold, the
interpreter performs a mark-and-sweep collection at a safe point. Embedders and
ordinary guest programs do not need to call the collector.

An embedder may tune the threshold or enable the root-stress mode while testing:

```js
var tuned = new VM({gcThreshold: 256});
var stressed = new VM({gcStress: true});
```

`gcStress` requests collection after every eligible allocation and is intended
to expose missing roots, not for normal execution. Thresholds are positive
allocation-unit counts; each guest object costs one unit and Buffer backing
memory additionally costs one unit per 64 bytes, rounded up.

An embedder can still request an immediate full collection when useful for a
test, memory-pressure notification, or deterministic resource release:

```js
vm.collect();
```

Globals, active registers, internal runtime roots, and explicit host handles are
traced. A Buffer backing allocation remains alive while any marked view refers
to it. The guest `guestCollect` and `guestBackingStoreCount` globals exist for
bootstrap testing and should not be considered application APIs.

Because current bytecode lacks liveness maps, every active register is retained
until execution returns. Collection during one top-level program can therefore
be conservative. Host-root behavior and collection between executions are
precise for the implemented object graph.

## Buffer use

Guest programs currently create buffers with `Buffer.alloc`. Under MMVM the
allocation is native and zero-filled with `calloc`. Under Node the bytes are
privately emulated while retaining the same guest semantics.

Guest code must not receive raw backing records or pointers. Native integration
inside the VM can identify a Buffer through its `guestType`, then use
`runtime.bufferSupport` methods. External embedders should prefer public guest
methods until a stable internal-binding API is added.

Views created by `slice` alias the same backing allocation. Never free a view's
allocation directly. Collection and `VM.destroy` are the only owners of backing
store release.

## Shutdown

Always destroy the VM:

```js
try {
    vm.run(source, filename);
} finally {
    vm.destroy();
}
```

`destroy` frees every live native Buffer allocation, clears heap records and
host roots, and drops active registers. Do not use guest values, handles, or
compiled programs with that VM afterward. Calling `destroy` after normal GC is
safe because backing stores track whether they have already been freed.

## Errors and diagnostics

Tokenizer errors include filename, line, and column. Parser errors currently
reuse the current token location. Runtime errors and verifier failures propagate
to the host. `guest_runner.js` intentionally leaves exception reporting to the
host shell at this stage. On success it emits no runner-generated banner,
filename, pass status, or assertion count; stdout belongs to the guest program.

Embedders should supply a stable logical filename to `compile`/`run`; it need not
be an absolute path. Avoid exposing machine-specific paths in guest diagnostics
or checked-in tests.

## Testing an embedding

Before integrating a change, run:

```sh
guest_vm/tests/run_tests.sh both
```

Select only one host when diagnosing:

```sh
guest_vm/tests/run_tests.sh --host node
guest_vm/tests/run_tests.sh --host js_min
```

Override local executables without editing the runner:

```sh
NODE_BINARY=/path/to/node guest_vm/tests/run_tests.sh node
JS_MIN_BINARY=/path/to/js_min.exe \
FIREFOX_LIB_DIR=/path/to/firefox/lib \
guest_vm/tests/run_tests.sh js_min
```

Paths shown here are placeholders supplied by the embedder, not repository
defaults. The checked-in launcher derives its defaults relative to itself.

When adding a language feature, add a small guest source file or focused
assertion that demonstrates that feature. When adding a runtime representation
or lifetime invariant that guest syntax cannot yet express, add a portable
implementation-level test that runs identically under both hosts.
