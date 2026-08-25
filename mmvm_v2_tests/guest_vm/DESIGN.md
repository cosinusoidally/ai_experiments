# Guest VM design

## Status and contract

The guest VM is an interpreter-first JavaScript-in-JavaScript implementation.
Its guest-language target is ECMAScript 5.1 while its implementation remains
runnable under the old SpiderMonkey used by `js_min.exe` and under Node.js. The
current checkpoint is deliberately smaller than ES5.1: it provides enough
parsing, bytecode, execution, object plumbing, collection, standard-library
behavior, and Buffer behavior to run the focused tests plus unchanged `net.js`.

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
| `guest_runner.js` | Quiet command-line source reader and one-program runner. |

Node modules load dependencies with relative `require`. Under `js_min.exe`, an
embedder must load them in this order:

```text
tokenizer.js
parser.js
bytecode.js
compiler.js
verifier.js
host_ffi.js
host_memory.js
buffer.js
runtime.js
interpreter.js
vm.js
```

Each module exports through CommonJS when available and otherwise installs a
single `GuestVM...` name on the shell global object. Modules do not depend on
npm packages.

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

`interpret(program, runtime, receiver, arguments, closure, callable)` owns one
call frame's register array, environment, numeric `pc`, and a 10,000,000-
instruction safety budget. The dispatch loop performs representation
movement and control flow directly. Semantically observable operations call the
runtime, notably globals, properties, calls, truthiness, addition, and loose
equality.

Several primitive operators still use host numeric operations after explicit
`Number` conversion. This is sufficient for the current tests but is not a
claim of complete ES5 conversion semantics. As object coercion is implemented,
these operations must move behind complete guest helpers.

`VM.execute` clears the active-register root set in a `finally` block, including
when parsing-independent runtime execution throws. The lower-level interpreter
also clears it on normal return. Embedders should call the facade, not invoke
`interpret` directly.

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

## Collector and roots

The collector is a non-moving mark/sweep collector over `Runtime.heapObjects`.
`gcGeneration` avoids clearing mark bits on every object before tracing. Current
roots are:

- every value in the guest global table;
- opaque values retained in the embedder host-root table;
- every active interpreter register;
- every active call environment and each captured closure environment;
- the internal Buffer prototype and objects reachable through marked property
  maps.

Marking a Buffer view marks its shared backing store for the same generation.
Sweep first removes unmarked guest object records, then asks `BufferSupport` to
free each unmarked backing store. Multiple views therefore do not cause multiple
frees, and one reachable slice retains the allocation.

Collection is automatic. Every tracked guest object charges one allocation
unit; a native Buffer backing additionally charges one unit per 64 bytes,
rounded up. The default threshold is 1,024 units. Reaching the threshold marks
collection pending, and the interpreter collects at the next safe point after
an allocation-producing instruction or native call, or at a backward branch.
Deferring collection to a safe point ensures that a newly returned object is in
an active guest register before marking begins.

`VM.collect`, `Runtime.collect`, and the test-only `guestCollect` global request
an immediate full collection, but normal guest programs and embedders do not
need to call them. `new VM({gcThreshold: n})` selects a positive allocation-unit
threshold. `new VM({gcStress: true})` makes every eligible allocation request a
collection at the next safe point. The portable suite runs threshold and stress
modes under both hosts to expose missing roots.

Registers are conservatively rooted for an entire active program because
bytecode liveness is not yet available. Sweep compacts both the guest heap table
and the Buffer backing table so repeated automatic collections do not retain an
ever-growing list of dead records.

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

The backing record owns exactly one host-memory allocation. `slice` creates a
new view with adjusted offset/length and does not allocate or copy bytes.
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
- `readUInt8`, `writeUInt8`, `readUInt32LE`, and `writeUInt32LE`.

This is not yet the complete Node.js 0.10 Buffer profile. Encoding methods,
constructor compatibility, signed values, other endian widths, enumeration,
descriptors, and exact error variations remain future work.

Under `js_min.exe`, `host_memory.js` asks `host_ffi.js` to resolve and call
`calloc` and `free`. `host_ffi.js` owns the only raw `ffi_call` sites in
`guest_vm`; the memory adapter accesses data
with `peek8`/`poke8` or aligned `peek32`/`poke32`. Under Node it uses a zero-filled
ordinary array behind the identical private interface; it does not substitute a
Node Buffer into guest semantics.

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
