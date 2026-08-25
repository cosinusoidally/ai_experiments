# JavaScript guest VM and Node compatibility plan

See `guest_vm/SELF_HOSTED_EXECUTION.md` for the bootstrap-only relationship
targeted for `js_min.exe`, the explicit non-NaN-boxed value-cell representation,
and the staged native execution-engine boundary.
See `guest_vm/HEAP_AND_COMPILER_DESIGN.md` for the concrete authoritative heap
layouts and the shared front/middle end with JavaScript and i386 backends.

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

The initial system has one required execution path: a bytecode interpreter.
Native compilation is deliberately not part of the correctness bootstrap:

```text
ECMAScript 5.1 guest source
            |
            v
 tokenizer / parser / compiler
            |
            v
      portable bytecode
            |
            v
 interpreter written in kernel JavaScript
            |
            v
ECMAScript 5.1 guest runtime and host services
```

The interpreter and runtime establish all guest semantics. They run as ordinary
JavaScript under both Node.js and `js_min.exe`; no generated code is required.
The first performance work refines the interpreter, bytecode, value
representations, object paths, and allocation behavior. Only measured hot
helpers are then moved into or further restricted to the kernel dialect so
that an eventual ahead-of-time compiler can accelerate them.

Three language levels must remain distinct:

1. **Guest language:** ECMAScript 5.1 semantics implemented by the VM.
2. **Implementation dialect:** the ES3-like JavaScript accepted by
   `js_min.exe`, also kept compatible with Node.js. The complete VM is written
   in this dialect.
3. **Kernel dialect:** a strict, statically analyzable subset of the
   implementation dialect. The interpreter dispatch core is written in this
   subset from the start. Later it may be AOT-compiled to i386.

The kernel dialect is not required to reproduce every general JavaScript edge
case. Its accepted programs avoid or define away those cases. For every valid
kernel program, however, execution as ordinary source under Node.js, execution
as ordinary source under `js_min.exe`, and eventual AOT execution must be
observably equivalent for the kernel contract. Correct ECMAScript 5.1 behavior remains a
responsibility of the guest runtime operations invoked by the interpreter,
not an accidental consequence of either host engine.

Execution ownership is additionally split into three explicit levels:

1. `JSRuntime` owns one heap, collector, intern/atom tables, Buffer backing
   stores, runtime metadata, and all guest objects in that ownership domain.
2. `JSContext` is nested under one runtime and owns an independent global
   environment plus at most one active execution. Runtimes and contexts may
   both have multiple instances.
3. `Execution` owns a resumable explicit guest frame stack. It runs until
   completion, uncaught failure, finite budget exhaustion, or an external host
   call. Budget exhaustion and host calls preserve the continuation and return
   control to the embedder.

Guest calls must not rely on recursive host-interpreter calls. External host
calls yield a request which the embedder completes or fails before resumption.
Explicitly classified low-level implementation intrinsics may execute inline;
the initial exceptions include byte and aligned-word peek/poke operations so
memory-intensive guest code does not cross the scheduling boundary per access.

## Hard constraints

- Do not change `js_min.c`, `js.c`, `js_min_linux.c`, `js_min_win32.c`, or any
  other C source.
- Do not add native functions to `js_min.exe`.
- Implement the guest VM, compiler, runtime, garbage collector, and code
  generators in JavaScript.
- Do not use npm packages or other third-party JavaScript dependencies.
- Do not fetch anything from the Internet. Ask the user to provide any
  external material that becomes necessary.
- Write the complete VM in the `js_min.exe` implementation dialect: roughly
  ES3 syntax and behavior, with any relied-upon host extensions explicitly
  identified and tested. Keep the same source runnable under Node.js 0.10 and
  current Node.js.
- Write the bytecode interpreter dispatch core in the stricter kernel dialect
  from the beginning, while retaining a normal JavaScript execution path on
  both hosts.
- Implement the source tokenizer without regular expressions. It must not use
  regexp literals, `RegExp`, or regexp-backed `String` operations to recognize
  tokens.
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

The guest VM target is ECMAScript 5.1. Implementation is incremental and driven
initially by the existing demos,
but the architecture must implement guest semantics itself rather than borrow
host behavior that differs between old SpiderMonkey and Node.js. The guest
does not include classes, arrow functions, generators, promises, `let`,
`const`, destructuring, ES modules, or other post-ES5 syntax.

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

This is sufficient to enter generated machine code. A future AOT kernel entry
can be shaped as:

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
    tokenizer.js
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

    kernel.js
    interpreter.js

    host.js
    host_node.js
    host_mmvm.js

    modules.js
    commonjs.js

guest_runner.js

guest_vm/aot/                  # deferred until the interpreter is mature
    kernel_parser.js
    kernel_ir.js
    backend_js.js
    backend_x86.js
    x86_assembler.js
    x86_runtime.js
```

Files may be combined while bootstrapping if the old shell's loading behavior
makes that useful, but the architectural boundaries must remain explicit. The
presence of a proposed `aot` layout does not authorize implementing it during
the interpreter milestones.

## Frontend

The host shell cannot expose its parser, AST, or bytecode to JavaScript, so the
guest VM needs its own tokenizer and parser. The frontend should grow to support
ECMAScript 5.1, with the existing demos determining the first useful
implementation slice. This includes:

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

The tokenizer must be an explicit character-by-character state machine. It
uses a source index, character-code classification, bounded lookahead, and
small named scanners for identifiers, whitespace and line terminators,
comments, numeric literals, strings and escapes, punctuators, and regexp
literal text. Token recognition must not use:

- JavaScript regexp literals;
- the host `RegExp` constructor;
- `String.prototype.match` or `search`;
- regexp arguments to `replace` or `split`;
- any helper that merely hides host regular-expression matching.

This restriction applies to tokenization, not to the ES5 language feature.
Guest source may contain regular-expression literals. The tokenizer must scan
their pattern, backslash escapes, character classes, closing slash, and flags
manually. The parser or tokenizer lexical-goal state must decide whether `/`
begins a regular-expression literal or represents division/division-assignment;
it must not guess by applying a host regexp to the remaining source.

Character classification should be explicit and deterministic across the old
SpiderMonkey and Node hosts. ASCII fast paths can use `charCodeAt`; ES5
identifier and whitespace code points outside ASCII require tables or range
checks derived from the language specification and checked into the repository.
Every scanner must either advance the source index or report a located syntax
error. Tokens record start/end offsets plus line and column information, with
line tracking covering all ES5 line terminators and string/comment rules.

Strict mode, ES5 object-literal details, automatic semicolon insertion,
identifier and numeric grammar, and early errors must eventually follow ES5.1
rather than the host parser. Features may be staged, but unsupported syntax
must fail explicitly instead of silently inheriting host behavior.

The parser should retain source locations so that syntax errors and guest
stack traces refer to the original file and line.

Compilation must be deterministic across hosts. Given identical source, Node
and MMVM should produce identical bytecode and constant-pool contents. Tests
should compare serialized compiler output rather than relying only on program
output. Token-stream tests must likewise compare token kind, source span,
decoded literal value, line-break metadata, and errors on both hosts. Add a
static source check for the tokenizer module so introducing a regexp literal,
`RegExp` construction, or a regexp-backed string operation fails the frontend
test suite.

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
temporary lifetimes, and makes numeric hot regions easier to recognize. It also
leaves an uncomplicated path to later kernel AOT compilation without requiring
that backend during bootstrap.

Initially store bytecode in ordinary host arrays. Do not assume a packed
native bytecode stream is faster for the JavaScript interpreter: every
`peek32` crosses a C/JSAPI boundary and converts a number. Benchmark array
indexing against `peek32` before changing the interpreter representation. A
packed native copy can be introduced later if an AOT backend requires it.

Every function should carry:

- its bytecode and constant pool;
- register and argument counts;
- exception-handler ranges;
- source-location metadata;
- nested-function descriptors;
- optional profiling counters.

A verifier must reject invalid opcodes, register indices, constants, branches,
exception ranges, and malformed call descriptors before execution. A future
AOT compiler must accept only separately validated kernel input.

## Guest values and objects

The runtime heap must be completely independent from the host JavaScript heap.
Guest primitives and heap objects are represented by integer handles into a
`JSRuntime`-owned linear memory; host objects are not authoritative guest
records. All record access goes through named layout accessors, which delegate
to one bounds-checked memory layer backed by peek/poke under `js_min.exe` and
equivalent emulation under Node.js. Raw field offsets and scattered peek/poke
calls are prohibited outside that memory/accessor boundary.

Do not use NaN boxing. Registers and heap fields contain ordinary 32-bit heap
references. Numbers are dedicated records containing two explicit 32-bit words
of IEEE-754 binary64 payload; special values use canonical dedicated records.

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

The bootstrap interpreter now implements this policy: allocation debt requests
collection, safe points perform it automatically, and configurable threshold
and collect-at-every-safe-point stress modes run in the portable test suite.
Explicit collection remains an embedder control for deterministic tests and
memory-pressure signals, not an application requirement.

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

## Kernel-JavaScript implementation dialect

The kernel dialect is a deliberately restricted subset of the ES3-like
implementation language. It is not guest JavaScript and does not promise the
full dynamic semantics of either ES3 or ES5. The bytecode interpreter's main
fetch/decode/dispatch loop must be written in this dialect from the start, even
while it is executed as ordinary JavaScript.

The initial kernel dialect permits:

- statically resolved functions;
- integer and pointer locals;
- `if`, `while`, and bounded loops;
- fixed-layout fields;
- explicit raw byte and word operations;
- no closures or dynamic property names;
- no allocation or exceptions in compiled regions;
- explicit signed and unsigned coercions.

It must also define the behavior of its accepted numeric operations,
overflows, shifts, comparisons, memory accesses, and control flow precisely
enough that all implementations agree. Constructs whose Node and old
SpiderMonkey behavior could diverge are rejected or normalized explicitly.
The contract is observational equivalence for valid kernel programs, not full
JavaScript reflection. For example, the contract need not preserve source
formatting, function prototype details, `arguments` aliasing, dynamic property
insertion, or coercion edge cases that kernel programs are forbidden to use.

The interpreter remains semantically complete because bytecodes delegate
guest operations to ES5 runtime helpers. A low-level kernel dispatch loop can
call a statically resolved `guestAdd` helper; that helper, not the host `+`
operator and not the kernel compiler, implements ES5 addition and coercion.

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

After profiling the interpreter, candidate routines for further kernelization
include bytecode decode/dispatch helpers, register moves, fixed-layout frame
access, Buffer copy/fill, encoders and decoders, hashing, and fixed-layout GC
mark scans. Object semantics, strings, coercion, allocation, and exceptions can
remain ordinary implementation-dialect helpers behind stable calls.

## Deferred AOT compilation

Only after the interpreter is correct, capable of running the existing demos,
and refined using measurements should the kernel compiler be implemented. Its
pipeline may be:

```text
kernel JavaScript source -> kernel IR/bytecode -> ordinary JavaScript
kernel JavaScript source -> kernel IR/bytecode -> i386 machine code
```

The ordinary-JavaScript output provides a differential backend under Node.js
and must also remain loadable by `js_min.exe` when that is useful. The i386
output targets 32-bit cdecl and is entered through the existing FFI. Both are
implementations of the narrow kernel contract; neither becomes an alternative
source of guest ECMAScript 5.1 semantics.

Executable memory management eventually uses `mmap`, emission through
`poke8`/aligned `poke32`, label and relocation validation, an `mprotect`
read/write-to-read/execute transition, `ffi_call` entry, and `munmap` release.
Pages must not remain writable and executable. Generated functions preserve
the i386 callee-saved registers and use checked side exits for operations that
remain in JavaScript.

## General performance strategy

The required optimization order is:

```text
correct ES5 interpreter
    -> measure complete demo workloads
    -> refine bytecode and interpreter dispatch
    -> remove avoidable allocation and host/FFI crossings
    -> specialize common object, array, and Buffer paths
    -> port measured helpers to the kernel dialect
    -> AOT-compile selected kernel helpers only when justified
```

Interpreter-first optimizations include:

- register bytecode;
- dense-array element instructions;
- canonical property names;
- shape identifiers;
- monomorphic property caches;
- specialized integer arithmetic;
- direct Buffer bytecodes;
- fused common instruction sequences;
- lightweight per-opcode, per-function, and per-loop profiling counters;
- allocation-free interpreter dispatch paths.

For example, a generic indexed read can specialize after observing a Buffer:

```text
GET_INDEX       result, object, index
```

becomes:

```text
BUFFER_GET_U8   result, object, index, expected-shape
```

The interpreter executes the specialized form first. If profiling later shows
that this handler is important, its checked fast path can be expressed in the
kernel dialect and eventually AOT-compiled without changing the bytecode's
fallback semantics.

Do not assume that native memory access is always the fastest representation
for the interpreter. `peek` and `poke` are valuable when data must already be
native, when syscalls require a pointer, and within generated x86. Ordinary JS
arrays may be faster for bytecode, registers, and metadata in the host
interpreter. Benchmark each boundary.

## Validation strategy

During the interpreter phase, run every applicable semantic test through the
same required execution path on both hosts:

```text
guest source
    +-- interpreter under Node.js
    +-- interpreter under js_min.exe
```

The VM, including its kernel-dialect interpreter, must produce the same guest
result on both. Host adapters may differ only at their documented service
boundary. There is no requirement to build a generated-JavaScript or native
backend before this comparison is useful.

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

For the bootstrap phase, the checked-in programs under `mmvm_v2_tests` are the
integration test suite. Bring them up incrementally: start with `hello.js` and
`node_hello.js`, then `node_web.js`, the X11 modules, and increasingly demanding
demos. A demo counts only when its observable output, files/network behavior,
event ordering, framebuffer behavior where applicable, and clean shutdown have
been compared with the existing execution path. Small focused parser/runtime
tests should be added alongside them for failures that a demo exposes.

Later, the user will provide the Test262 ECMAScript 5.1 tests from the Mozilla
SpiderMonkey source tree. Do not download or vendor that corpus now. When it is
provided, preserve its provenance, select the ES5.1-relevant tests with a
documented manifest, implement the required harness includes, and record
expected exclusions individually. Test262 then becomes the language
conformance suite; the existing demos remain the end-to-end host, Node API,
Buffer, event-loop, networking, filesystem, and graphics regression suite.

Add deterministic compiler and runtime fuzzing without external dependencies:
generate small ES5 programs from fixed seeds and compare the interpreter under
Node.js and `js_min.exe`. Once an AOT backend exists, add kernel-dialect
differential tests among ordinary Node execution, ordinary `js_min.exe`
execution, generated JavaScript, and emitted i386. Validate guest bytecode
before interpreting it, and separately validate kernel IR before compiling it.

## Implementation milestones

### Milestone 0: specification and harness

- Freeze the implementation-dialect and kernel-dialect contracts sufficiently
  to write portable source.
- Fix the guest target at ECMAScript 5.1 and finalize the Buffer version profiles.
- Define bytecode, runtime-value, and host-call ABIs. Defer native side-exit
  details.
- Add host-neutral result recording and tests under Node.js and `js_min.exe`.
- Keep the existing runner unchanged.

Exit criterion: one source test can be compiled once and interpreted under
both hosts, with result, exception, output, and heap summary compared.

### Milestone 1: compiler and primitive interpreter

- Implement the character-by-character, no-regular-expression tokenizer, then
  the parser, AST, register allocator, bytecode emitter, and verifier.
- Test ambiguous `/` lexical goals, comments and line terminators, longest
  punctuator matching, numeric forms, string escapes, identifier boundaries,
  regular-expression literal text, malformed tokens, and exact source spans
  under both Node.js and `js_min.exe`.
- Implement the fetch/decode/dispatch loop in the kernel dialect and execute it
  as ordinary JavaScript on both hosts.
- Implement primitives, calls, call frames, branches, loops, and returns using
  explicit guest-semantic helpers.
- Add closures and basic source-mapped errors.

Exit criterion: deterministic bytecode on Node and MMVM, with arithmetic,
loops, recursion, and closure tests passing on both.

### Milestone 2: ECMAScript 5.1 object and control semantics

- Implement ordinary objects, arrays, prototypes, functions, and constructors.
- Implement descriptors, accessors, enumeration, and required standard
  built-ins.
- Implement exceptions and exception-handler tables.
- Implement strict-mode behavior and the ES5 standard-library surface needed
  by the growing tests.

Exit criterion: meaningful ECMAScript 5.1 programs run without borrowing host
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

### Milestone 4: CommonJS and initial existing demos

- Implement CommonJS wrapping, relative modules, built-in lookup, and cache.
- Bridge timers and the readiness event loop through rooted guest handles.
- Expose minimal guest `events`, `net`, `http`, `process`, and `console` APIs.
- Run unchanged `hello.js` and `node_hello.js` through the interpreter.

Exit criterion:

```sh
artifacts/js_min.exe guest_runner.js node_hello.js
```

serves the expected response with guest-executed application and compatibility
code.

### Milestone 5: existing-demo breadth

- Move more compatibility code into guest JavaScript over small host bindings.
- Add the asynchronous and synchronous filesystem APIs required by
  `node_web.js`.
- Run `node_web.js`, then the X11 modules and selected demos.
- Extend ES5 language and standard-library coverage in response to both focused
  semantic tests and concrete demo failures.

Exit criterion: existing examples execute through the guest VM without
weakening Buffer ownership, GC, or host-root rules.

### Milestone 6: ES5.1 conformance corpus

- After the user supplies it, integrate the Test262 ES5.1 corpus from the
  Mozilla SpiderMonkey source tree without fetching external material.
- Add the Test262 harness, a reproducible ES5.1 manifest, negative-test
  handling, and per-test timeout/isolation.
- Classify every failure as a VM defect, harness defect, explicitly unsupported
  host facility, or documented test exclusion.

Exit criterion: the selected ES5.1 suite has reproducible results under both
Node-hosted and `js_min.exe`-hosted interpreters, with no unexplained failures.

### Milestone 7: interpreter refinement

- Profile complete demo workloads before choosing optimization targets.
- Improve dispatch, bytecode density, frame/register representation, property
  shapes, inline caches, allocation behavior, and Buffer fast paths.
- Keep the interpreter as the only required guest execution engine.
- Move measured runtime helpers into the kernel dialect where its restrictions
  improve predictability or prepare a genuine hot path for AOT compilation.

Exit criterion: representative demos show material, repeatable improvement on
`js_min.exe` without semantic divergence or a Node-hosted regression.

### Milestone 8: optional kernel AOT compiler

- Implement the kernel parser/validator and a small typed kernel IR.
- Generate ordinary JavaScript for differential testing.
- Implement the read/write-to-read/execute allocator, i386 macro assembler,
  labels, relocations, ABI checks, and checked exits.
- Compile only measured kernel helpers initially; do not compile arbitrary
  guest JavaScript or make native execution necessary for correctness.

Exit criterion: valid kernel functions are observably equivalent as ordinary
source under Node.js and `js_min.exe`, generated JavaScript, and emitted i386;
selected helpers produce a measured end-to-end improvement.

## Recommended execution order

Implement Milestones 0 through 5 entirely with the interpreter. This is the
decisive semantic and integration proof: the VM parses source itself, controls
all property access, implements indexed native Buffers, traces shared views,
frees backing allocations correctly, and runs real programs with no C changes.

Integrate the user-provided ES5.1 corpus when it becomes available, but do not
block early demo progress on material that is not yet in the repository. When
performance becomes the focus, refine the interpreter first and use workload
profiles rather than assumptions. Port only targeted runtime pieces to the
kernel dialect, even though the central interpreter dispatch loop already
obeys it.

AOT compilation is an optional later optimization of the kernel dialect. It is
not a guest-language backend, is not needed to establish ES5 correctness, and
must not displace a maintainable interpreter with a collection of ad hoc
native paths.
