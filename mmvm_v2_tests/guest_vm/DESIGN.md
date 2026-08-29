# Guest VM design

The long-term MMVM execution boundary and the staged path away from host-VM
state are specified in `SELF_HOSTED_EXECUTION.md`. That document is normative
for new frame, value, platform-service, and native-engine work.

## Status and contract

The guest VM is an interpreter-first JavaScript-in-JavaScript implementation.
Its guest-language target is ECMAScript 5.1 while its implementation remains
runnable under the old SpiderMonkey used by `js_min.exe` and under Node.js. The
current checkpoint is deliberately smaller than ES5.1: it provides enough
parsing, bytecode, execution, object plumbing, collection, standard-library
behavior, and Buffer behavior to run the focused tests plus unchanged `net.js`.

The runtime-owned value-cell heap now has an executable, dual-host-tested
representation, but the live interpreter remains on the documented
transitional host-record representation. See `SELF_HOSTED_EXECUTION.md` for the
exact completed and outstanding migration boundaries.

Passing the current suite means only that the documented implemented subset is
working. It does not imply general ES5.1 conformance. Unsupported syntax must be
added with a focused test before another component relies on it.

Three language layers are kept separate:

1. Guest source is defined to have ECMAScript 5.1 semantics.
2. The VM implementation uses the ES3-like dialect accepted by `js_min.exe`.
3. The interpreter dispatch loop uses a low-level kernel style: numeric program
   counter, fixed opcode layouts, register arrays, and named semantic helpers.

Host JavaScript semantics are not the guest object model. Guest property access,
calls, Buffer indexing, and lifetime pass through `Runtime` methods.

Guest parser statements retain filename, one-based line, and one-based column
metadata. Bytecode instruction starts carry those locations into interpreted
errors, and generated functions annotate exceptions before they cross back to
the embedder. `guest_runner.js` therefore prints `filename:line:column` for both
guest Error objects and VM implementation errors.

The structured tier deliberately leaves functions constructing guest-defined
classes in the semantic interpreter on the Firefox 1 host. Runtime intrinsics
such as `Date`, `Array`, and `Error` remain compilable. The old engine does not
reliably preserve a guest constructor receiver across a generated `Function`
that recursively enters the compiler. This is a semantic boundary, not a
demo-specific Buffer special case: affected setup functions are interpreted,
while their leaf dependencies and rasterizer hot paths remain independently
eligible for compilation.

## Runtime, context, and execution ownership

The public embedding model has three levels:

```text
JSRuntime
    runtime-owned heap and collector
    interned strings and shared implementation metadata
    host-function definitions
    zero or more JSContexts
        independent global environment
        zero or one active Execution
            explicit guest call-frame stack
            pending host call, completion, or exception
```

A `JSRuntime` is one complete VM ownership domain. Guest objects, Buffer backing
stores, interned strings, and collector metadata never move between runtimes.
Multiple runtimes are fully independent. A runtime may own multiple
`JSContext`s; their globals and executions are independent, but every object
reachable from those contexts is allocated and collected by their common
runtime.

A context can retain a completed global environment and execute later programs
against it. Creating another context produces fresh globals and fresh built-in
bindings. Contexts in one runtime may deliberately share guest objects; passing
guest implementation records between runtimes is invalid and rejected at the
global, property, call, and host-completion boundaries. The current bootstrap
shares some runtime-owned intrinsic function objects between context binding
tables; completing independent ES5.1 realm intrinsics remains part of the
prototype/object-model work.

Each guest bytecode function records its home context as well as its lexical
closure. A frame uses that home context for global resolution, including when
the callable is installed in another context belonging to the same runtime.
`JSContext.startFunction` creates a resumable entry execution for a runtime-owned
bytecode function, which lets an embedder route a yielded cross-context request
without borrowing the caller's global environment.

`VM` remains a compatibility facade containing one runtime and one default
context. New embedders should use `JSRuntime.createContext()` explicitly.

## Resumable execution and host-call boundary

Interpreter state is represented by an `Execution`, not by recursion on the
host JavaScript stack. Each guest activation is an explicit frame containing
its program, program counter, registers, lexical environment, receiver, and the
caller destination register. Guest calls push frames and returns pop them.

`Execution.resume(budget)` runs until exactly one of these boundaries:

```text
completed   top-level guest execution returned
budget      the supplied instruction allowance reached zero
hostCall    guest code invoked an external host function
threw       an uncaught guest or implementation exception escaped
```

Budget exhaustion is an embedder scheduling result, not a guest exception. It
does not unwind frames and cannot be caught by guest code. A later `resume`
continues at the same bytecode instruction with a newly supplied budget. The
budget is shared by every frame executed during that resume call.

An external host call also preserves all frames and returns a request record to
the embedder. The embedder supplies either a return value or a failure, then
resumes execution. Arbitrary host callbacks are never executed implicitly by
the core dispatch loop.

Very small, explicitly classified implementation intrinsics may run inline.
The raw aligned and byte `peek`/`poke` primitives are the initial exception
because yielding for every framebuffer or memory byte would make their intended
use impractical. String, object, Buffer, and operator implementation helpers are
also internal semantic operations rather than embedder host calls. Potentially
blocking or externally observable services such as raw FFI, output, timers,
filesystem, and sockets must yield.

The i386 interpreter currently completes common numeric `Math` operations,
Buffer length/index access, zero-copy Buffer slicing, and selected endian reads
and writes inside that boundary. The same kernel IR has JavaScript equivalents
for the Node backend. Each intrinsic has a stable, named ID in
`native_intrinsics.js`; the dispatch source uses those names and the macro
assembler emits individual x87 operations for native sine and cosine. Inputs
outside the x87 argument-reduction range and uncommon numeric cases return to
the semantic implementation rather than silently changing ES5.1 behavior.

The MMVM Node profile also binds `NodeLibc.memmove` as an inline structured-tier
intrinsic for demo7's already-allocated Buffer spans. The embedder supplies the
native callback; the compiler contains no address or machine-code constant.
A Node-hosted guest has no native Buffer pointer and stays on the ordinary
Buffer-copy path, so it never invokes this intrinsic.

## Module boundaries and load order

| Module | Responsibility |
| --- | --- |
| `tokenizer.js` | Regexp-free character scanner and token source locations. |
| `parser.js` | Recursive-descent parser producing the bootstrap AST. |
| `bytecode.js` | Stable numeric opcode identifiers. |
| `compiler.js` | AST-to-register-bytecode lowering and branch patching. |
| `verifier.js` | Opcode, width, register, constant, call, and jump validation. |
| `interpreter.js` | Kernel-style bytecode dispatch loop. |
| `runtime.js` | Guest globals, calls, semantic helpers, objects, roots, and GC. |
| `host_ffi.js` | The sole raw FFI boundary and optional guest compatibility binding. |
| `host_memory.js` | Native or emulated byte storage over the host FFI boundary. |
| `buffer.js` | Buffer views, methods, backing stores, and Buffer GC integration. |
| `vm.js` | Embedder facade tying compilation, execution, roots, and shutdown together. |
| `guest_vm.js` | Single public bootstrap which loads internal modules in dependency order. |
| `guest_runner.js` | Quiet command-line source reader and one-program runner. |

Node modules load dependencies with relative `require`. A shell embedder loads
the complete VM with one public call:

```js
load("guest_vm/guest_vm.js");
```

`guest_vm.js` owns the internal load order shown in the module table. Consumers
must not repeat that dependency list. CommonJS users may likewise require
`guest_vm.js`; requiring `vm.js` directly remains compatible. Each internal
module exports through CommonJS when available and otherwise installs a single
`GuestVM...` name on the shell global object. Modules do not depend on npm
packages.

## Tokenizer

The tokenizer is a state machine over a source string. Its mutable state is the
UTF-16 source index, one-based line, and zero-based column. Named scanners handle
identifiers, numbers, strings, comments/trivia, punctuators, and regexp-literal
text. Each scanner must advance or throw a located `SyntaxError`.

Token records have this shape:

```text
kind        identifier, keyword, number, string, regexp, punctuator, or eof
value       decoded value or regexp pattern/flag record
raw         exact source slice
start/end   UTF-16 source offsets, with end exclusive
line/column start location
lineBefore  trivia before the token contained an ES5 line terminator
```

Token recognition must not use regexp literals, the host `RegExp` constructor,
regexp-backed string methods, or a helper hiding those operations. Guest regexp
literals are scanned manually. The caller passes a lexical-goal flag to
`Tokenizer.next` so `/` can mean regexp literal or division. The parser already
uses this flag for the implemented grammar; more statement contexts must retain
that invariant as the grammar grows.

ASCII identifiers use direct character-code checks. The current non-ASCII
identifier acceptance is intentionally provisional and must be replaced by
checked-in ES5.1 classification tables/ranges before conformance is claimed.

## Parser and current language subset

The parser is recursive descent with precedence climbing through named methods.
It currently supports:

- numeric, string, boolean, and null literals;
- identifiers resolved through function environments and then globals;
- function declarations and expressions, parameters, closures, local `var`,
  return values, and function `arguments` objects;
- object and array literals;
- regexp literals (scanned without regular expressions in the tokenizer);
- parentheses;
- member access with `.` and `[]`;
- calls and method receiver preservation;
- unary `!`, unary `+`, unary `-`, and `void`;
- arithmetic, remainder, equality, relational, bitwise, shift, conditional,
  `&&`, and `||` expressions;
- simple and arithmetic compound assignments;
- postfix increment and decrement;
- `var`, blocks, expression statements, `if`/`else`, `while`, `for`, `break`,
  `throw`, and `return`.

It does not yet support constructors, `try`/`catch`/`finally`, switch,
continue, labels, strict mode, declaration hoisting in every ES5.1 case, or
full automatic semicolon insertion. Those are milestones, not permitted host
fallbacks.

AST nodes are internal records. They are not a public API and may change while
the parser grows. Source locations currently live on tokens; propagating ranges
to every AST node and bytecode instruction remains required work.

## Register bytecode

Bytecode is currently a flat ordinary JavaScript array. Operands immediately
follow each numeric opcode. Ordinary arrays measured better than assuming every
interpreter fetch should cross the `peek32` C/JSAPI boundary. A packed form can
be added later without changing semantic helpers.

Current instruction layouts are:

| Instruction | Operands | Width |
| --- | --- | ---: |
| `CONST` | destination, constant index | 3 |
| `GET_GLOBAL` | destination, name constant (environment-aware) | 3 |
| `SET_GLOBAL` | name constant, source (environment-aware) | 3 |
| `MOVE` | destination, source | 3 |
| `GET_PROPERTY` | destination, object, key | 4 |
| `SET_PROPERTY` | object, key, value | 4 |
| arithmetic/comparison | destination, left, right | 4 |
| `NOT`, `NEGATE`, `POSITIVE` | destination, source | 3 |
| `JUMP` | absolute target | 2 |
| `JUMP_IF_FALSE` | condition, absolute target | 3 |
| `CALL` | destination, callable, receiver-or--1, first argument, count | 6 |
| `RETURN` | source | 2 |
| `MAKE_FUNCTION` | destination, nested-program constant | 3 |
| `MAKE_OBJECT`, `MAKE_ARRAY` | destination | 2 |
| `MAKE_REGEXP` | destination, pattern constant, flags constant | 4 |
| bitwise/shift | destination, left, right | 4 |
| `THROW` | source | 2 |

Registers are allocated monotonically during bootstrap compilation. Call
arguments are copied into a contiguous register block. There is no register
reuse or liveness map yet. The interpreter therefore treats all active frame
registers conservatively as collector roots.

The verifier walks instruction boundaries before execution. It rejects unknown
or truncated instructions, invalid registers/constants, malformed call ranges,
and branches that do not land on an instruction boundary. Future bytecodes must
be added to the opcode table, compiler, verifier, interpreter, and tests in the
same committed change.

## Interpreter and semantics boundary

`Execution` owns an explicit array of call frames. The last frame is active;
each frame owns its register array, lexical environment, numeric `pc`, and
caller destination register. The dispatch loop performs representation movement
and control flow directly. Guest calls push frames without invoking the host
interpreter recursively. Returns pop frames and place their value in the saved
caller register.

Each `resume(budget)` call uses one counter shared across all frames it runs.
Zero budget returns immediately, finite exhaustion returns `budget`, and
`Infinity` is accepted for trusted compatibility execution. No fixed lifetime
budget exists inside a frame.

The bundled synchronous embedders grant `Infinity` to the threaded or native
engine. This is an embedder policy, not a change to budget semantics: those
engines still yield for semantic services and allocation pressure, while an
embedder that needs multiplexing may continue to pass any finite budget. The
policy avoids materializing native frames merely to resume them immediately in
a command-line run that has no competing guest context.

Several primitive operators still use host numeric operations after explicit
`Number` conversion. This is sufficient for the current tests but is not a
claim of complete ES5 conversion semantics. As object coercion is implemented,
these operations must move behind complete guest helpers.

Suspended executions remain attached to their context and are collector roots.
Completed, failed, and aborted executions detach from the context. Embedders
must use `Execution.resume`, `completeHostCall`, `failHostCall`, and `abort`
rather than invoking dispatch internals.

## Guest values and properties

Guest primitive values currently use host `undefined`, null, booleans, numbers,
and strings. Guest heap values are implementation records identified by
`guestType`:

| `guestType` | Important fields |
| --- | --- |
| `object` | `properties`, `gcMark` |
| `function` | `callback`, `properties`, name |
| `bytecodeFunction` | nested program, captured environment, properties, name |
| `array` | indexed elements, named properties, `gcMark` |
| `regexp` | pattern, flags, named properties, `gcMark` |
| `buffer` | `properties`, prototype, backing, offset, length, `gcMark` |

Named own properties are stored as `$` plus the guest property key. This avoids
collisions with the host object's prototype without requiring `Object.create`,
which the old host cannot be assumed to provide. All lookup uses an explicit
own-property check. Buffer numeric keys bypass this map.

Function calls create an environment whose bindings contain parameters,
function-scoped `var` names, and a guest array used as `arguments`. Identifier
lookup walks captured parent environments before the global table. Assignments
update an existing binding or create a non-strict global when none exists.

The current ordinary object model has no guest prototypes or descriptors yet.
The Buffer prototype is an explicit internal object used by the Buffer exotic
lookup. Native functions are trusted implementation records whose callbacks
receive `(receiver, argumentsArray)`.

## Current standard-library bridge

The current application-driven subset includes `String`,
`String.fromCharCode`, the String methods used by `net.js`, `parseInt`, array
`push`/`sort`, regexp `test`, and regexp-backed String `replace`. Guest regexp
literals are always tokenized manually. Execution of the provisional regexp
objects currently delegates matching to the host regexp engine; this is not a
claim of complete ES5.1 RegExp semantics and must eventually be replaced or
conformance-qualified where the two supported hosts differ.

## Guest Node embedding profile

`node_environment.js` is an embedder adapter, not guest library source and not
part of ES5.1 semantics. `guest_runner.js` installs it under both supported
hosts. Under `js_min.exe` it loads the existing host-side `node_compat` libc,
event, process, network, filesystem, and HTTP layers. Under Node.js it selects
only built-in Node modules. Both backends install the same guest objects.

The boundary has three layers:

1. On `js_min.exe`, `node_compat/libc.js` is the only layer in this profile
   which issues raw libc FFI calls. It wraps allocation, file, socket, and poll
   operations. On Node, built-in `fs`, `net`, and `http` replace that layer.
2. The selected host stack owns file descriptors, nonblocking clients, HTTP
   parsing/serialization, filesystem work queues, and event dispatch.
3. `GuestNodeEnvironment` translates guest objects to those host APIs. Its
   properties are external host functions, so ordinary guest execution yields
   before the adapter performs an operation.

Guest callbacks never execute re-entrantly inside the interpreter frame that
registered them. A host operation first returns through its pending host call.
When an event or filesystem result is ready, the adapter queues a task in
`NodeRuntime`; that task calls `JSContext.startFunction` and resumes a new
`Execution`. Any host calls made by the callback are serviced through the same
yield boundary before the callback continues. This preserves the VM rule that
a context has at most one active execution.

Values held across asynchronous work are registered with `JSRuntime.retain`.
Long-lived server/listener values remain rooted until environment shutdown.
Request arguments and one-shot callbacks use temporary handles released in a
`finally` block after callback execution. Adding an asynchronous binding
without the corresponding root is a collector correctness bug; making every
callback permanent is a server-lifetime leak.

Filesystem errors are copied into ordinary guest objects. Directory entries
become guest arrays, stats become guest objects with intrinsic query methods,
and file bytes become guest Buffer backing stores. Response output converts a
guest Buffer back to the host compatibility buffer byte-for-byte; strings use
UTF-8. HTTP sockets remain nonblocking even though the current file adapters
perform their libc file work when their queued host task runs.

Node-hosted guest Buffer storage continues to use `host_memory.js` array
emulation. It does not substitute a host Node Buffer into guest semantics.
Byte and little-endian word operations implement the same private memory API
as MMVM's peek/poke-backed allocation. A Node-hosted guest receives no forged
numeric address, so code branches to guest Buffer access; MMVM-native backing
may expose its real address for the optimized path.

The installed CommonJS surface resolves `http`, `fs`, and `net`, and a relative
module loader executes JavaScript modules in separate contexts belonging to the
same runtime. A module is cached before execution for circular-reference
safety; its context receives `module`, `exports`, `require`, `__filename`, and
`__dirname`. Exported guest functions retain their home context and callbacks
resume there. Module contexts share runtime-owned objects and Buffer backing
stores but keep top-level variable environments isolated.

`process`, `console`, `Buffer.byteLength`, the required `Date` methods, and URI
component encoding functions are also installed. This is intentionally the
smallest documented profile needed by `node_web.js` and `demo1.js` through
`demo7.js`, not a
general Node.js implementation.

## Collector and roots

The collector is a non-moving mark/sweep collector over the authoritative
linear-heap record graph. `Runtime.heapObjects` and the other host maps are
derived handle/metadata caches; an object created entirely by native bytecode
does not need a host handle in order to survive. `gcGeneration` avoids clearing
mark bits on every record before tracing. Current roots are:

- every value in the guest global table;
- opaque values retained in the embedder host-root table;
- every register in every live or suspended execution frame;
- every live or suspended frame environment and captured closure environment;
- each pending host-call receiver and argument;
- every registered context, program, and strongly interned string;
- the native interpreter engine state and its current frame chain;
- the runtime-owned primitive method tables and internal Buffer prototype;
- transient function-construction records.

The record accessor layer owns graph traversal. It follows prototypes,
properties and property values, array vectors, lexical environments, function
closures and home contexts, frame registers/callers/handlers, program constant
vectors, Buffer view backings, contexts, and engine state. Collectors do not
duplicate record offsets.

On i386, both marking and sweeping are compiled from kernel-dialect JavaScript
through the shared kernel compiler and macro assembler. The marker uses the
unused portion of the runtime's linear heap as an explicit work stack; the
native allocation-pressure threshold deliberately leaves that space available.
It reports overflow instead of writing beyond the heap. During the remaining
hybrid transition, the host first seeds marks for roots that can still be held
in host-side frame/register caches. The native marker then traces the complete
authoritative record graph. A post-mark invariant checks every published frame
reference before and after sweeping, so a missing edge fails at collection time
rather than becoming delayed heap corruption. Node uses the corresponding
JavaScript graph walk.

Marking a Buffer view marks its shared backing store for the same generation.
Sweep first asks `BufferSupport` to free the external allocation belonging to
each unmarked backing record, then frees all other unmarked guest records.
Multiple views therefore do not cause multiple frees, and one reachable slice
retains the allocation. The native sweep coalesces adjacent ordinary free
records in the same linear pass before the host rebuilds its derived free-block
index. Flagged engine-owned regions remain separate. Node uses the equivalent
JavaScript pass.

Collection is automatic. Semantic host-side allocation uses the configurable
allocation-unit threshold. Native execution additionally requests a collection
when its bump allocation reaches three quarters of the heap, leaving stack and
allocation headroom. The request is serviced only after the native engine has
published its current frame and a semantic fallback has published its result;
the collector never runs over private register state.

Runtimes reserve a suffix of linear memory solely for the collector's mark work
list (including when only the collector, rather than the interpreter, uses its
native backend). The configured `heapBytes` remains entirely available for
guest records; the workspace is additional runtime-owned linear memory sized
for one entry per minimum-sized record. Guest allocation bounds exclude it, so
marking capacity cannot depend on how close allocation came to the end of the
heap.

The native allocator initially uses the heap tail. After a pressure collection
it may claim a coalesced ordinary free block as a private bump region. At every
yield it publishes the unused suffix as a flagged free record, keeping the heap
walkable while excluding that suffix from the host allocator. Returned native
call frames use a different existing flag and remain owned by the engine's
frame cache. Only unflagged free records enter the general host free-block
index. This ownership distinction prevents either allocator from reusing the
same bytes. Before a collection, the engine publishes any reserved suffix as
ordinary free space and invalidates its private cursor. Sweeping can then
coalesce the complete free graph, and the next native run claims a region from
the new layout rather than retaining stale pre-collection bounds. Returned
native call frames use an engine-private free list between collections; a
collection drains that cache into ordinary free records as well, preventing
inactive frames from withholding most of the heap under call-heavy workloads.
An unsupported operation normally leaves the private native region intact. If
the ordinary allocator has no useful tail or free block, the engine returns its
reserved suffix before entering semantic fallback, preventing a host-side
allocation from reporting false exhaustion while most memory is merely
reserved by the native allocator.

`VM.collect`, `Runtime.collect`, and the test-only `guestCollect` global request
an immediate full collection, but normal guest programs and embedders do not
need to call them. `new VM({gcThreshold: n})` selects a positive allocation-unit
threshold. `new VM({gcStress: true})` makes every eligible allocation request a
collection at the next safe point. The portable suite runs threshold and stress
modes under both hosts to expose missing roots.

Registers are conservatively rooted for an entire active program because
bytecode liveness is not yet available. Adjacent ordinary free records are
coalesced. A completely dead heap tail lowers the bump pointer without moving
live records; host allocations clear bump ranges because a lowered tail may
contain old bytes.

Host code must not retain a raw guest value across a point where collection may
occur. It calls `VM.retain(value)` and stores the returned integer handle, then
uses `VM.retained(handle)` and eventually `VM.release(handle)`. Releasing twice,
resolving a released handle, or using an invalid handle is an error.

## Buffer representation and lifetime

A Buffer is a view:

```text
Buffer view
    backing       shared backing-store record
    offset        byte offset into allocation
    length        visible byte length
    prototype     internal Buffer prototype
    properties    ordinary named properties
```

The backing record owns its bytes inline in the non-moving runtime heap.
`slice` creates a new view with adjusted offset/length and does not allocate or
copy bytes. On MMVM the record caches the native address of its inline data so
kernel code and native platform services can consume it directly. On Node that
pointer is zero and the same named record accessors read and write the emulated
linear memory. There is no per-Buffer host allocation object or backing-ID map.
Canonical decimal numeric property names read/write bytes; out-of-range numeric
writes are ignored and reads return `undefined`. Allocation is zero-filled.

Currently implemented public operations are:

- `Buffer.alloc(size[, fill])`;
- `Buffer.isBuffer(value)`;
- numeric indexed reads and writes;
- `length`;
- `slice(start[, end])` with negative offsets;
- numeric `fill(value[, start[, end]])`;
- overlap-safe `copy(target[, targetStart[, sourceStart[, sourceEnd]]])`;
- `readUInt8`, `writeUInt8`, `readUInt16LE`, `readUInt16BE`,
  `writeUInt16LE`, `writeInt16LE`, `readUInt32LE`, and `writeUInt32LE`.

This is not yet the complete Node.js 0.10 Buffer profile. Encoding methods,
constructor compatibility, signed values, other endian widths, enumeration,
descriptors, and exact error variations remain future work.

The runtime's one linear heap allocation remains behind `linear_memory.js` and
`host_memory.js`; individual Buffer backing stores do not call `calloc` or
`free`. The ordinary heap marker reaches a backing from every live view, and
the ordinary sweep reclaims an unreachable backing exactly once. Native
`Buffer.alloc`, indexing, endian operations, slicing, and overlap-safe copying
operate on these records without constructing a host object.

`get_dlsym` and `ffi_call` are not ordinary guest globals. Constructing a VM
with `{rawFFI: true}` installs compatibility functions so the unchanged
top-level `hello.js` example can run through the interpreter when hosted by
`js_min.exe`. Node cannot emulate this facility and rejects raw-FFI enablement.
Direct embedders are FFI-disabled by default because exposing arbitrary process
symbols is a powerful trusted-host capability, not an ES5 language feature.

`VM.destroy` explicitly frees every still-live backing store. It is required
even when the embedder believes collection has reclaimed everything.

## Testing policy

`tests/run_tests.js` is portable implementation-dialect JavaScript loaded by
either host. `tests/run_tests.sh` selects `node`, `js_min`, or `both` and supports
environment overrides for the executables and Firefox library directory.
Pass/fail and assertion-count reporting belongs exclusively to these test
runners. The general `guest_runner.js` prints no success banner or assertion
count; its stdout is the guest program's stdout. The `js_min` host launcher
captures the complete output of `guest_runner.js hello.js` and requires it to
equal exactly `Hello, world!`, making this boundary a regression test.

Focused guest files live under `tests/language` and `tests/buffer`. They contain
only features already implemented and must pass in every commit. When adding a
feature such as `for`, first add the smallest useful test that exercises it;
avoid turning one fixture into a comprehensive conformance corpus. Temporary
failures are acceptable only in the uncommitted feature currently being built.
Previously passing tests are not allowed to regress.

Implementation-level portable tests are appropriate for invariants guest code
cannot yet expose, such as exact backing-store reclamation. The Buffer lifetime
test runs the same root/collect/release sequence on both hosts and checks one
free for one shared allocation.

## Rules for extending the VM

1. Keep implementation syntax accepted by `js_min.exe`; test the actual shell,
   not only Node syntax checking.
2. Do not use regular expressions in the tokenizer or hide them in helpers.
3. Route guest-observable behavior through runtime operations.
4. Add a focused always-green guest test with each language feature.
5. Update compiler, verifier, interpreter, and documentation together for every
   bytecode change.
6. Register every guest heap record and trace every new reference-bearing field.
7. Retain guest values held by host asynchronous work with opaque host roots.
8. Keep raw FFI inside `host_ffi.js` and require explicit embedder opt-in before
   exposing it to guest source.
9. Preserve shared Buffer backing identity and one-owner freeing.
10. Measure the interpreter before adding kernel AOT or representation shortcuts.
