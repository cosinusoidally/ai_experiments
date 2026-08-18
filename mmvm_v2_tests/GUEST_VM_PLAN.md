# JavaScript guest VM and Node compatibility plan

## Objective

Build a JavaScript-in-JavaScript guest virtual machine that can run unchanged
Node-style programs under the minimal MMVM shell without modifying its C
sources. The guest VM must own JavaScript property access, object identity,
Buffer indexing, shared Buffer views, roots, and garbage collection. This
makes exact Buffer lifetime possible even though the host SpiderMonkey does
not provide JavaScript-visible native classes, property hooks, finalizers,
typed arrays, proxies, or weak references.

The long-term invocation remains:

```sh
artifacts/js_min.exe node_runner.js node_hello.js
```

During development, keep the existing compatibility runner working and use a
separate entry point so that the two implementations can be compared:

```sh
artifacts/js_min.exe guest_runner.js node_hello.js
```

The guest compiler will have one portable bytecode format and three execution
paths:

```text
guest JavaScript source
          |
          v
  lexer / parser / compiler
          |
          v
    portable bytecode
          |
          +------> reference bytecode interpreter in JavaScript
          |
          +------> bytecode-to-JavaScript compiler under Node.js
          |
          +------> mixed bytecode/i386 execution under js_min.exe
```

The reference interpreter establishes semantics. The generated-JavaScript
backend tests the compilation pipeline and permits V8 to optimize it. The i386
backend accelerates suitable hot regions without making native compilation a
prerequisite for correctness.

## Hard constraints

- Do not change `js_min.c`, `js.c`, `js_min_linux.c`, `js_min_win32.c`, or any
  other C source.
- Do not add native functions to `js_min.exe`.
- Implement the guest VM, compiler, runtime, garbage collector, and code
  generators in JavaScript.
- Do not use npm packages or other third-party JavaScript dependencies.
- Do not fetch anything from the Internet. Ask the user to provide any
  external material that becomes necessary.
- Keep implementation-source syntax compatible with the old SpiderMonkey
  host and theoretically with Node.js 0.10.
- Keep raw `ffi_call` operations behind named host or libc wrappers.
- Preserve the existing compatibility runner until the guest runner has
  passed equivalent tests.
- Continue to use `LD_LIBRARY_PATH` when running MMVM. Do not add an rpath.
- Continue to build `artifacts/js_min.exe` with `mk_min`.
- Treat 32-bit x86 Linux as the first native-code target. A Win32 backend may
  be added later but is not part of the first implementation.
- Prefer Linux system interfaces available in the Linux 2.4 series. This is a
  source and interface target, not a claim that the current binary and shared
  libraries execute on an actual Linux 2.4 installation.

## Scope and compatibility contract

The first end-to-end application target is the unchanged `node_hello.js`.
Later targets are `node_web.js`, the X11 modules, and selected demos.

The first guest language target is the useful ECMAScript 5-era subset needed
by those programs. It does not initially include classes, arrow functions,
generators, promises, `let`, `const`, destructuring, ES modules, or other later
syntax.

Node versions do not have one timeless Buffer contract. Node.js 0.10 legacy
Buffer behavior and modern Buffer/Uint8Array behavior differ. The runtime must
therefore name its compatibility profile rather than silently combining
incompatible answers. The proposed order is:

1. Implement a documented Node.js 0.10-compatible Buffer profile, except that
   numeric allocation is deliberately zero-filled.
2. Add modern constructors used by the examples, including `Buffer.from` and
   `Buffer.alloc`, without changing legacy behavior selected by the profile.
3. Add a modern typed-array-compatible profile only if exact modern reflection
   and inheritance later become requirements.

The guest object machinery can support multiple profiles, but a single Buffer
object cannot simultaneously reproduce contradictory version-specific
behavior.

## Existing host capabilities

The current 32-bit MMVM shell exposes the primitives needed to bootstrap this
design:

```text
load
read
print
quit
gc
get_dlsym
ffi_call
peek8 / poke8
peek32 / poke32
```

`peek8`, `poke8`, `peek32`, and `poke32` operate on process addresses. The
32-bit operations are little-endian by virtue of the target x86 machine.
Generated code and runtime structures should still use aligned word accesses
unless an explicitly byte-packed format requires otherwise.

The current FFI directly calls a 32-bit cdecl-shaped function pointer with
eight integer or pointer arguments and an integer return value:

```c
typedef int (*ffi_entry)(
    int a1, int a2, int a3, int a4,
    int a5, int a6, int a7, int a8
);
```

This is sufficient to enter generated machine code. A future JIT entry can be
shaped as:

```js
var exitReason = ffi_call(codeAddress,
                          vmStateAddress,
                          frameAddress,
                          bytecodeAddress,
                          constantsAddress,
                          instructionBudget,
                          0, 0, 0);
```

The FFI does not provide a native-to-JavaScript callback trampoline. Generated
x86 therefore cannot call arbitrary JavaScript runtime helpers directly. It
must either call a known native ABI function or return a side-exit reason to
the JavaScript dispatcher.

## Proposed source layout

Develop the new VM alongside the existing `node_compat` implementation:

```text
guest_vm/
    lexer.js
    parser.js
    compiler.js
    bytecode.js
    verifier.js

    runtime.js
    values.js
    objects.js
    properties.js
    functions.js
    environments.js
    exceptions.js
    gc.js
    buffer.js

    interpreter.js

    backend_js.js
    backend_x86.js
    x86_assembler.js
    x86_runtime.js

    host.js
    host_node.js
    host_mmvm.js

    modules.js
    commonjs.js

guest_runner.js
```

Files may be combined while bootstrapping if the old shell's loading behavior
makes that useful, but the architectural boundaries must remain explicit.

## Frontend

The host shell cannot expose its parser, AST, or bytecode to JavaScript, so the
guest VM needs its own lexer and parser. The initial frontend should support:

- primitive, regular-expression, array, and object literals as required;
- expression precedence and short-circuit evaluation;
- `var` declarations;
- function declarations and function expressions;
- closures and lexical environments;
- calls, constructors, and `new`;
- named and indexed property access;
- `if`, `switch`, loops, `break`, and `continue`;
- `return`, `throw`, `try`, `catch`, and `finally` as required;
- unary, binary, comparison, and assignment operators;
- CommonJS source wrapping.

The parser should retain source locations so that syntax errors and guest
stack traces refer to the original file and line.

Compilation must be deterministic across hosts. Given identical source, Node
and MMVM should produce identical bytecode and constant-pool contents. Tests
should compare serialized compiler output rather than relying only on program
output.

## Register bytecode

Use a register bytecode rather than a simple operand stack. A common compact
instruction can be a 32-bit word:

```text
31              24 23      16 15       8 7        0
+----------------+----------+----------+----------+
|     opcode     | operand A| operand B| operand C|
+----------------+----------+----------+----------+
```

Extension words carry large register numbers, constant indices, call
metadata, and branch offsets. Representative instructions include:

```text
LOAD_CONST       destination, constant
LOAD_UNDEFINED   destination
MOVE             destination, source
ADD              destination, left, right
STRICT_EQ        destination, left, right
GET_PROPERTY     destination, object, name
SET_PROPERTY     object, name, value
GET_INDEX        destination, object, index
SET_INDEX        object, index, value
NEW_OBJECT       destination
NEW_ARRAY        destination
MAKE_CLOSURE     destination, function
CALL             destination, function, call-info
CONSTRUCT        destination, function, call-info
JUMP             target
JUMP_IF_FALSE    condition, target
THROW            value
RETURN           value
HOST_CALL        destination, binding, call-info
```

A register VM performs fewer dispatches than a basic stack machine, exposes
temporary lifetimes, maps naturally to generated JavaScript and x86 registers,
and makes numeric hot regions easier to recognize.

Initially store bytecode in ordinary host arrays. Do not assume a packed
native bytecode stream is faster for the JavaScript interpreter: every
`peek32` crosses a C/JSAPI boundary and converts a number. Benchmark array
indexing against `peek32` before changing the interpreter representation. A
packed native copy will still be required by the x86 backend.

Every function should carry:

- its bytecode and constant pool;
- register and argument counts;
- exception-handler ranges;
- source-location metadata;
- nested-function descriptors;
- profiling counters;
- optional generated-JavaScript and generated-x86 entries.

A verifier must reject invalid opcodes, register indices, constants, branches,
exception ranges, and malformed call descriptors before execution or native
compilation.

## Guest values and objects

The reference interpreter does not need to encode all values in raw memory.
It may use host JavaScript primitives for guest primitives while representing
guest heap objects by internal records or integer handles.

Guest objects must not be exposed directly as ordinary host objects. All guest
semantics pass through runtime operations such as:

```js
GuestRuntime.getProperty(object, key);
GuestRuntime.setProperty(object, key, value, strictMode);
GuestRuntime.deleteProperty(object, key, strictMode);
GuestRuntime.defineProperty(object, key, descriptor);
GuestRuntime.hasProperty(object, key);
GuestRuntime.ownPropertyKeys(object);
```

The object model must grow to include:

- own data and accessor descriptors;
- prototype traversal;
- extensibility, sealing, and freezing as required;
- arrays with special `length` behavior;
- functions, constructors, and prototype objects;
- primitive boxing;
- a defined property enumeration order;
- exotic object hooks for Buffer and later typed arrays.

This central property boundary is what allows `buffer[index]` to have genuine
Buffer semantics. It also provides the place for later hidden shapes,
structure identifiers, and inline caches.

## Native Buffer representation

A guest Buffer is a view, not an allocation. Its internal state is:

```text
BufferView
    backingStoreId
    byteOffset
    byteLength
    compatibilityProfile
    prototype
    ordinary named properties
```

The shared backing-store record is:

```text
BufferBackingStore
    nativePointer
    allocationLength
    allocationKind
    guest tracing/liveness state
```

Slices refer to the same backing record:

```text
one backing store
    ^
    +-- view: offset 0,   length 4096
    +-- view: offset 100, length 200
    +-- view: offset 128, length 512
```

Canonical numeric-index recognition happens in the guest property runtime.
Indexed reads and writes access the backing store through `peek8` and `poke8`,
with `peek32` and `poke32` fast paths for aligned word operations. Bounds,
out-of-range behavior, enumeration, descriptors, and aliases follow the
selected compatibility profile.

Backing stores are allocated with zero-filled native memory. The first
implementation may use `calloc` and `free`. Large stores or later executable
and page-protection work may use `mmap` and `munmap` through named libc
wrappers.

## Guest garbage collection and exact lifetime

Start with a non-moving mark-and-sweep guest collector. Moving collection is
not necessary to solve lifetime and would complicate host handles.

The guest heap table owns every guest object record. Its roots include:

- the guest global object;
- active call frames and registers;
- lexical environments and closures;
- pending exceptions;
- the CommonJS module cache;
- timer callbacks;
- pending socket and filesystem callbacks;
- buffers retained by outstanding operations;
- explicit host handles.

The collector marks guest references, including Buffer views. A backing store
remains live while any marked view or other marked object refers to it. Sweep
releases a native backing store after its final referring view becomes
unreachable.

This does not require a SpiderMonkey finalizer:

1. The VM strongly retains allocated guest records in its heap table.
2. The guest collector decides which records are reachable.
3. Sweep removes unreachable records from the table.
4. Sweep explicitly frees unreferenced native backing stores.
5. The host GC may later reclaim the removed implementation records.

Host subsystems must never retain an unregistered raw guest implementation
object. They retain guest handles, and those handles remain in the guest root
table until released. A pending write, for example, roots both its callback and
its Buffer view until completion:

```text
PendingWrite
    callbackHandle
    bufferHandle
    byteOffset
    remainingLength
```

Removing the pending operation also removes those roots. This models native
Node operations retaining buffers and callbacks while the operation is in
flight.

Collection should initially be triggered by guest allocation thresholds. Add
stress modes that collect after every eligible allocation and vary thresholds
reproducibly; these are essential for exposing missing roots.

## Host service boundary

Retain the working libc, polling, socket, filesystem, and X11 mechanisms as
host services during the transition. Guest code reaches them through a narrow
numbered host-call ABI rather than receiving host objects.

Representative operations are:

```text
HOST_OPEN
HOST_CLOSE
HOST_READ
HOST_WRITE
HOST_SOCKET
HOST_BIND
HOST_LISTEN
HOST_ACCEPT
HOST_POLL_REGISTER
HOST_TIMER_REGISTER
HOST_CLOCK_NOW
HOST_X11_CONNECT
```

`HOST_CALL` exits from the guest interpreter or compiled code into a dispatcher
which validates arguments and registers any asynchronous roots. Under MMVM the
dispatcher invokes the current named libc wrappers. Under Node it invokes a
Node-backed equivalent. Tests may install a deterministic mock host.

Most Node APIs should eventually be guest JavaScript libraries over small
internal bindings. For example, guest `net` can be implemented above an
internal socket binding rather than duplicating all stream and EventEmitter
behavior in the host bridge.

## CommonJS and runner integration

The guest runner will:

1. Load the guest compiler, runtime, interpreter, and host adapter.
2. Read the requested source file.
3. Wrap it as a CommonJS module function.
4. Compile and verify its bytecode.
5. Install guest `process`, `console`, `Buffer`, timers, and `require`.
6. Execute top-level code.
7. Run the existing readiness-based host event loop while guest work remains.
8. Dispatch callbacks by resolving rooted guest handles and entering the VM.
9. Return the guest exit status to the shell.

The module loader initially needs relative JavaScript files and selected
built-in names only. npm and general `node_modules` resolution remain outside
the first target.

## Generated-JavaScript backend

Under Node.js, translate verified bytecode into JavaScript functions which
operate on the same guest runtime. The initial output may use a dispatch loop:

```js
function compiledGuestFunction(vm, frame) {
    var registers = frame.registers;
    var pc = frame.pc;
    while (true) {
        switch (pc) {
        case 0:
            registers[0] = 1;
            pc = 1;
            continue;
        case 1:
            registers[2] = vm.add(registers[0], registers[1]);
            pc = 2;
            continue;
        case 2:
            return vm.complete(registers[2]);
        }
    }
}
```

Later output may use structured control flow and guarded primitive fast paths.
It must continue to use guest object and Buffer operations; substituting the
host Node Buffer would invalidate semantic comparisons.

The reference interpreter is the oracle. For identical source and input, the
interpreter and generated-JavaScript backend must agree on results,
exceptions, output, side effects, and guest heap state.

## i386 machine-code backend

The first native backend targets 32-bit i386 cdecl, matching the current MMVM
executable and FFI. Executable memory management should be:

1. Allocate pages read/write with `mmap`.
2. Emit code with `poke8` and aligned `poke32` operations.
3. Resolve labels and relocations.
4. Validate block boundaries and branch targets.
5. change the mapping to read/execute with `mprotect`.
6. Enter it through `ffi_call`.
7. Release it with `munmap` on invalidation or VM shutdown.

Do not leave pages writable and executable. x86 has coherent instruction and
data caches for this purpose, so the protection transition does not require an
instruction-cache flush.

Generated functions preserve the i386 callee-saved registers `EBX`, `ESI`,
`EDI`, and `EBP`, return an exit reason in `EAX`, and treat all pointers as
32-bit values. Address conversion must account for the host FFI converting
arguments through signed 32-bit integers even though JavaScript can represent
all 32-bit addresses exactly.

The initial native subset should support:

- signed and unsigned 32-bit arithmetic;
- integer comparisons and branches;
- pointer arithmetic;
- fixed-layout byte and word loads and stores;
- checked Buffer byte and word operations;
- numeric loops;
- selected framebuffer and rasterizer kernels.

It should not initially compile arbitrary property access, strings, closures,
exceptions, allocation, or fully polymorphic arithmetic.

Because generated x86 cannot call JavaScript directly, guards and complex
operations return side exits:

```text
EXIT_COMPLETE
EXIT_BUDGET
EXIT_TYPE_GUARD
EXIT_PROPERTY
EXIT_ALLOCATION
EXIT_HOST_CALL
EXIT_EXCEPTION
EXIT_DEOPTIMIZE
```

The JavaScript dispatcher performs the requested slow operation, updates VM
state, and may re-enter generated code.

## Compilable kernel-JavaScript subset

Permit performance-sensitive runtime routines to be written in a deliberately
restricted subset of guest JavaScript and compiled through both portable
backends:

```text
kernel JavaScript -> bytecode -> generated JavaScript
kernel JavaScript -> bytecode -> i386 machine code
```

The initial kernel subset permits:

- statically resolved functions;
- integer and pointer locals;
- `if`, `while`, and bounded loops;
- fixed-layout fields;
- explicit raw byte and word operations;
- no closures or dynamic property names;
- no allocation or exceptions in compiled regions;
- explicit signed and unsigned coercions.

For example:

```js
function copyWords(destination, source, count) {
    var index = 0;
    while (index < count) {
        store32(destination + (index << 2),
                load32(source + (index << 2)));
        index = index + 1;
    }
}
```

Candidate kernel routines include Buffer copy/fill, encoders and decoders,
framebuffer clears and blits, rasterizer spans, hashing, fixed-layout GC mark
scans, and selected bytecode helpers.

Do not begin by compiling the whole interpreter. The restricted kernel can
deliver useful native speed while keeping the trusted compiler small.

## General performance strategy

The optimization path is:

```text
dynamic and object-heavy guest code
    reference interpreter
        +-- specialized bytecodes
        +-- hidden shapes and structure identifiers
        +-- monomorphic inline caches
        +-- generated JavaScript under Node

numeric and Buffer-heavy guest code
    specialized bytecodes
        +-- fused operations
        +-- guarded native loops
        +-- i386 hot blocks under MMVM
```

Early optimizations that do not require a JIT include:

- register bytecode;
- dense-array element instructions;
- canonical property names;
- shape identifiers;
- monomorphic property caches;
- specialized integer arithmetic;
- direct Buffer bytecodes;
- fused common instruction sequences;
- per-function and per-loop profiling counters;
- allocation-free interpreter dispatch paths.

For example, a generic indexed read can specialize after observing a Buffer:

```text
GET_INDEX       result, object, index
```

becomes:

```text
BUFFER_GET_U8   result, object, index, expected-shape
```

The interpreter can execute the specialized form, the JavaScript backend can
emit a direct guarded helper, and the x86 backend can emit a bounds check and
native byte load.

Do not assume that native memory access is always the fastest representation
for the interpreter. `peek` and `poke` are valuable when data must already be
native, when syscalls require a pointer, and within generated x86. Ordinary JS
arrays may be faster for bytecode, registers, and metadata in the host
interpreter. Benchmark each boundary.

## Validation strategy

Run every semantic test through all available execution paths:

```text
guest source
    +-- interpreter under Node.js
    +-- interpreter under js_min.exe
    +-- generated JavaScript under Node.js
    +-- mixed interpreter/i386 under js_min.exe
```

Compare:

- return values and thrown exceptions;
- output and callback ordering;
- object properties and enumeration;
- Buffer contents and aliases;
- module state;
- guest heap and backing-store liveness;
- deterministic bytecode output.

Buffer tests must cover:

- indexed reads and writes;
- out-of-bounds operations;
- canonical and non-canonical numeric property names;
- named properties and enumeration;
- `slice` aliasing;
- overlapping copies;
- signed and unsigned integer operations;
- little-endian and big-endian access;
- string encoding and decoding;
- buffers retained by pending asynchronous operations;
- reclamation after the final view and operation become unreachable.

Where a selected Node runtime is locally available, run the same public API
tests against real Node and the guest. Record deliberate version-profile
differences and the permitted zero-filled allocation difference.

Add deterministic compiler fuzzing without external dependencies: generate
small programs from fixed seeds and compare the interpreter,
generated-JavaScript, and native results. Add a native-code instruction budget
and validate bytecode before compiling it so malformed guest input cannot emit
unchecked arbitrary control flow.

## Implementation milestones

### Milestone 0: specification and harness

- Finalize the guest language and Buffer version profiles.
- Define bytecode, runtime-value, host-call, and native side-exit ABIs.
- Add backend-neutral result recording and tests.
- Keep the existing runner unchanged.

Exit criterion: a source test can be routed to multiple backends and its
result, exception, output, and heap summary can be compared.

### Milestone 1: compiler and primitive interpreter

- Implement lexer, parser, AST, register allocator, bytecode emitter, and
  verifier.
- Implement primitives, calls, call frames, branches, loops, and returns.
- Add closures and basic source-mapped errors.

Exit criterion: deterministic bytecode on Node and MMVM, with arithmetic,
loops, recursion, and closure tests passing on both.

### Milestone 2: object semantics

- Implement ordinary objects, arrays, prototypes, functions, and constructors.
- Implement descriptors, accessors, enumeration, and required standard
  built-ins.
- Implement exceptions and exception-handler tables.

Exit criterion: meaningful ECMAScript 5 programs run without borrowing host
object semantics.

### Milestone 3: guest GC and native Buffer

- Implement the non-moving mark-and-sweep heap.
- Implement the explicit host root registry and GC stress modes.
- Allocate zero-filled native backing stores.
- Implement Buffer indexed exotic-object behavior and shared slices.
- Implement the initial Buffer methods and conformance suite.
- Free backing stores after the final guest reference and asynchronous root
  disappear.

Exit criterion: indexed access and aliases are correct, asynchronous roots
retain buffers, and backing stores are reclaimed without host finalizers. This
milestone proves the original Buffer semantics and lifetime approach.

### Milestone 4: CommonJS and hello server

- Implement CommonJS wrapping, relative modules, built-in lookup, and cache.
- Bridge timers and the readiness event loop through rooted guest handles.
- Expose minimal guest `events`, `net`, `http`, `process`, and `console` APIs.
- Run unchanged `node_hello.js`.

Exit criterion:

```sh
artifacts/js_min.exe guest_runner.js node_hello.js
```

serves the expected response with guest-executed application and compatibility
code.

### Milestone 5: generated-JavaScript backend

- Translate verified bytecode to executable JavaScript.
- Preserve the same guest runtime and object semantics.
- Add primitive fast paths, structured output, and side exits.
- Differentially test it against the interpreter.

Exit criterion: interpreter and generated-JavaScript execution are
behaviorally identical and compiled execution is materially faster under
Node.js.

### Milestone 6: i386 assembler and kernel compiler

- Implement the read/write to read/execute code allocator.
- Implement an i386 byte emitter, labels, relocations, and ABI tests.
- Define native VM-state, frame, and exit records.
- Compile integer, branch, memory, and Buffer kernels.
- Test bytecode, generated JavaScript, and emitted x86 against one another.

Exit criterion: the same kernel programs execute correctly through all three
backends and invalid inputs take checked side exits.

### Milestone 7: profiling and mixed-mode JIT

- Add function and loop hotness counters.
- Compile eligible hot regions.
- Add type, shape, bounds, and generation guards.
- Cache native code by bytecode identity and assumptions.
- Resume interpreted execution after deoptimization or runtime exits.

Exit criterion: suitable Buffer and framebuffer loops spend most of their time
in generated x86 while dynamic code continues correctly in the interpreter.

### Milestone 8: broader Node compatibility

- Move more compatibility code into guest JavaScript over small host bindings.
- Add the asynchronous and synchronous filesystem APIs required by
  `node_web.js`.
- Run `node_web.js`, then the X11 modules and selected demos.
- Extend the language and standard library only in response to concrete tests.

Exit criterion: existing examples execute through the guest VM without
weakening Buffer ownership, GC, or host-root rules.

## Recommended execution order

Implement through Milestone 3 before starting native-code generation. That is
the decisive semantic proof: the VM parses source itself, controls all property
access, implements indexed native Buffers, traces shared views, and frees the
backing allocation correctly with no C changes.

Then complete Milestone 4 so the unchanged hello server runs. Add the
generated-JavaScript backend before the x86 backend; it tests compiler lowering
and specialization on a mature engine while retaining the interpreter as an
oracle. Only then add executable-memory and i386 work.

The JIT should accelerate a correct VM rather than be required to make the VM
correct. This ordering provides a portable reference implementation, a fast
Node test backend, and an incremental path to useful `js_min.exe` performance
from the same source compiler and bytecode.
