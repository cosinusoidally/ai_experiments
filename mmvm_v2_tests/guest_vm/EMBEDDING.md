# Embedding the guest VM

## Current API status

The API documented here is the supported bootstrap embedding surface. It is
small on purpose and will grow as the VM implements more ECMAScript 5.1 and
Node behavior.
The parser and AST records are internal; the `VM` facade, runtime value handles,
and native-callback convention are the intended integration points.

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

The minimal shell has no CommonJS loader. Load the implementation in dependency
order:

```js
load("guest_vm/tokenizer.js");
load("guest_vm/parser.js");
load("guest_vm/bytecode.js");
load("guest_vm/compiler.js");
load("guest_vm/verifier.js");
load("guest_vm/host_ffi.js");
load("guest_vm/host_memory.js");
load("guest_vm/buffer.js");
load("guest_vm/runtime.js");
load("guest_vm/interpreter.js");
load("guest_vm/vm.js");

var vm = new GuestVM();
try {
    vm.run("var bytes = Buffer.alloc(4); bytes[0] = 17;", "embed.js");
} finally {
    vm.destroy();
}
```

Run the shell with the Firefox library directory supplied through
`LD_LIBRARY_PATH`; do not add an rpath. `host_memory.js` resolves `calloc` and
`free` when it detects the MMVM FFI primitives.

## Compile, execute, and run

`VM.run(source, filename)` is the convenience path. It tokenizes, parses,
compiles, verifies, and executes source against the VM's persistent runtime.
Globals therefore survive subsequent `run` calls on the same VM.

For caching or inspection, split the operations:

```js
var program = vm.compile("var answer = 6 * 7;", "answer.js");
var result = vm.execute(program);
```

`compile` returns an internal verified program record containing flat bytecode,
constants, and a register count. Treat it as immutable. Bytecode has no stable
serialization/version contract yet; do not persist it between VM revisions.

The compiler currently appends an implicit `return undefined`. `execute`
returns the value of the executed `RETURN`, normally `undefined` for top-level
test programs. Runtime and guest errors propagate as JavaScript exceptions to
the embedder. `execute` always clears its active-frame GC roots in `finally`.

## Installing globals and native functions

Install a primitive or existing guest value with:

```js
vm.installGlobal("hostVersion", "bootstrap-1");
```

Create a callable guest function with:

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
Throwing propagates out of guest execution; guest `try/catch` is not implemented
yet.

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
