# Native kernel interpreter design

## Required endpoint

On the MMVM host, SpiderMonkey is a bootstrap compiler driver only. It parses
the guest VM implementation, builds the native engine with the checked-in
macro assembler, allocates the runtime image, and enters the engine once.
Normal execution after that entry does not call a JavaScript callback. The
engine owns bytecode dispatch, frames, values, objects, allocation, collection,
context scheduling, and MMVM platform services. Approved libc and Linux system
calls are native services and do not return to SpiderMonkey.

Node uses the same kernel source, typed IR, layouts, bytecode, and exit/service
contracts. Its backend lowers the IR to JavaScript and necessarily returns to
Node for event-loop services. Backend differences must not change guest-visible
ECMAScript 5.1 semantics.

## Native ABI

The initial i386 cdecl entry uses the existing eight-word `ffi_call` bridge:

```text
engine(heap_base, runtime_state, context, budget,
       service_table, 0, 0, 0) -> exit_reason
```

All arguments are integers or native pointers. `runtime_state` and `context`
are offsets within `heap_base`; they are never host JavaScript objects. The
engine writes result, exception, pending service, and continuation data into
heap records before returning.

The general embedding API retains resumable exits for completion, exception,
budget exhaustion, and an external host call. The standalone MMVM runner uses
an internal scheduler and native service table, so budget and service events
switch native contexts without returning to SpiderMonkey. Process shutdown and
an unrecoverable bootstrap failure are the only normal returns to the shell.

## Kernel dialect and compiler

The interpreter is ordinary checked-in JavaScript in the kernel dialect. The
compiler obtains its source with `Function.prototype.toString()`. Raw machine
code and handwritten instruction byte arrays are forbidden.

The control-flow kernel subset consists of:

- signed and unsigned 32-bit parameters, locals, constants, and assignments;
- explicit binary64 loads, stores, arithmetic, and comparisons;
- `if`/`else`, `while`, `break`, `continue`, and `return`;
- bitwise, shift, integer arithmetic, and comparison operators;
- named `load8`, `load32`, `store8`, `store32`, `loadF64`, and `storeF64`
  intrinsics;
- named value-cell, record-field, allocator, collector, and platform-service
  intrinsics whose layouts are defined by the shared middle end.

The front end lowers this subset to typed basic blocks with explicit branches.
Validation rejects implicit coercions, dynamic property access, allocation of
host objects, exceptions, closures, and calls outside the intrinsic table.
The JavaScript and i386 backends consume the identical IR.

Native calls are represented in shared IR as `call_native_i32`, produced by
the kernel-dialect `callNativeI32(pointer, ...)` intrinsic. The i386 backend
places the target beneath right-to-left cdecl arguments and performs a named
macro-assembler indirect call. The JavaScript backend sends the identical
pointer and argument vector through `LinearMemory.callNativeI32`. Native FFI is
therefore an execution-backend operation rather than a SpiderMonkey callback
or an MMVM-specific instruction sequence scattered through guest semantics.

## Execution migration

The migration remains runnable at each checkpoint:

1. Compile typed control flow and raw heap loads/stores through both backends;
   compare return values and heap snapshots.
2. Run a native dispatch kernel over heap-resident bytecode, frames, and value
   cells. Unsupported opcodes produce a documented migration exit.
3. Move primitive arithmetic, comparisons, branches, constants, moves, local
   slots, and returns into the native kernel.
4. Add native strings, shapes/property lookup, arrays, Buffer views, calls,
   constructors, and exceptions. Each operation is first expressed as a
   kernel helper and tested through both backends.
5. Move allocator and tracing collector into kernel helpers. Native stack maps
   name every live value cell at collection points.
6. Replace migration exits with the native platform-service scheduler and
   libc-backed MMVM services. Keep external-host-call exits for general
   embedders and the Node backend.
7. Switch the MMVM command runner to the native engine by default and retain an
   explicit reference-engine switch until all semantic and performance gates
   pass.

## Heap independence

The linear heap is authoritative. Engine registers may cache decoded words,
but every value that survives a safepoint is in a 16-byte tagged heap cell.
Object identity, properties, array vectors, lexical environments, frames,
contexts, programs, bytecode, strings, Buffer metadata, roots, allocator state,
free lists, and GC marks are heap records. Native code addresses records as
`heap_base + offset`.

Host handles, parsed ASTs, compiler analysis, generated-code addresses, and
libc symbol addresses are bootstrap metadata only. The native engine cannot
dereference or call a host handle.

Native bytecode-to-bytecode calls support both register-bound functions and
functions that require lexical environments. A `PROGRAM` record carries its
binding count as part of the authoritative heap layout. For an
environment-bound call, the dispatch kernel allocates and initializes the
`ENVIRONMENT` record itself, links it to the callable's closure, and places
parameters, `this`, and a referenced `arguments` value into named slots. An
`arguments` array is allocated only when static compiler analysis says the
function observes it; without `eval`, omitting an unobservable array preserves
semantics while avoiding substantial short-lived allocation. All record-field
access in this path goes through the kernel compiler's named accessors.

Native return caches frame storage, so a frame address is not a call-incarnation
identity. If an unsupported semantic operation yields to the reference
interpreter, the bridge always refreshes the frame PC, return slot, context,
and lexical-environment handle from the authoritative heap record—even when
the address and program equal a previously seen frame. Host environment
metadata is created lazily at that boundary only; uninterrupted native calls
do not create host environment objects. This rule is essential for closures
created by repeated calls, because each closure must retain that call's
distinct guest-heap environment.

`MAKE_FUNCTION` follows the same rule. The native opcode allocates the
bytecode-function record, its ordinary prototype object, and the reciprocal
`prototype`/`constructor` properties in one checked guest-heap allocation.
The callable records its program, home context, and current lexical
environment directly. If a later semantic exit needs a host-visible callable,
the runtime lazily reconstructs only a handle from those fields; function
identity, reachability, and closure lifetime continue to come from the guest
heap.

`CONSTRUCT` stays in the native dispatch loop when its target is guest
bytecode. The engine resolves the callable's `prototype` property (falling
back to `Object.prototype` when it is not an object), allocates the receiver,
roots it in the caller's destination cell, and enters an ordinary guest frame
with that receiver as `this`. A constructor frame is distinguished by a named
frame flag. On return, an object result replaces the receiver and a primitive
result is ignored, as required by ECMAScript. Constructors implemented as
host/native functions still take the complete semantic fallback until their
individual service contracts are moved into the native engine.

Objects and function prototypes allocated by native opcodes do not acquire
host wrappers eagerly. If a later semantic exit traverses such a reference,
the runtime adopts a wrapper from the authoritative record type and address at
that boundary. Prototype traversal must use this lazy-adoption operation,
rather than assuming that the host wrapper table already contains every
reachable guest object.

Frequently used ES5 string operations remain ordinary, general runtime
intrinsics rather than application hooks. The native engine currently handles
`typeof`, the character-class subset of `RegExp.prototype.test`, and global
single-character regular-expression replacements. Unsupported regular
expressions and replacement substitutions still yield to the complete
semantic implementation. This keeps tokenizer and source-generation loops in
native execution without claiming a partial matcher has full ES5 RegExp
semantics.

## Correctness and performance gates

Every native operation must pass:

- JavaScript-backend versus i386 return-value and heap-snapshot equivalence;
- Node and js_min language, Buffer, GC, context, and embedding suites;
- unchanged `hello.js`, `net.js`, and `node_web.js` integration tests;
- demos1 through demo8, including completed render loops for the later demos;
- error filename, line, and column checks;
- performance comparisons at identical resolution, FPS limit, scene, and
  measurement duration.

The acceptance target is at least parity with direct `js_min.exe`. A migration
exit, demo-specific shortcut, larger heap used to conceal a leak, or native
path that calls back into SpiderMonkey does not satisfy the endpoint.
