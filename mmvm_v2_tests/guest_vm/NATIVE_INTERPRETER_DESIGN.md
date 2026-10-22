# Native kernel interpreter design

## Execution-local addresses and integer paths (2026-10-22)

The dispatch engine keeps absolute addresses of its current bytecode payload
and register bank in execution-local variables. Every frame transition refreshes
both. Helpers receiving these addresses use the same absolute-address contract;
heap records still contain relative references. In particular, an engine return
result converts its register-cell address back to a heap-relative offset before
storing it in persistent engine state. No new absolute pointer is serialized.
The native register preferences are register-bank address, PC and bytecode
address. The JS backend uses the same code with its ordinary memory adapter.

Integer ADD/SUBTRACT attempt their checked word operation before allocating
temporary state for concatenation or primitive conversion. Overflow does not
write the destination: aliased operands remain intact for the Number path.
Integer pairs also bypass general primitive classification for bitwise
operations and use signed word comparisons rather than x87 comparisons.
Mixed tags, doubles, strings and objects keep the existing semantic paths.

The x86 backend recognizes pure affine register addressing and emits scaled
loads through named assembler operations. Constant bit masks/shifts and
power-of-two word multiplication use immediate instructions. Condition contexts
branch directly through short-circuit AND/OR/NOT expressions; expression
contexts still materialize the original values. These optimizations neither
reorder effectful operands nor change guest bytecode, budgets or GC boundaries.

`guest_vm/tools/inspect_kernel_build.js --inlining` reports the structural
inlining candidates and expanded call-site count on either bootstrap host.

## Kernel memory lowering and dispatch experiments (2026-10-22)

The shared typed IR preserves `copyValueCell` as `copy_words`: source and
destination expressions are evaluated once, in call argument order, followed
by forward word copies. This is not memmove for partially overlapping ranges.
The four authoritative value-cell fields must be contiguous words; lowering
validates that requirement instead of silently assuming a different layout.
The x86 backend holds destination/source pointers in scratch ECX/EDX and emits
named load/store instructions. The JS backend uses
`LinearMemory.copyWordsTrusted`, which performs the same ordered accesses
through the host-memory adapter; native execution does not call that adapter.

The frontend also combines adjacent `store_u32` operations through the same
local/argument pointer into `store_fields`. Only literal/local/argument values
qualify. It never combines across a control-flow boundary or through a load,
call, or conversion. Offsets and store order are retained, including repeated
offsets. The native backend can therefore calculate the pointer once and use
direct immediate stores without changing observable memory effects. The JS
backend emits the original ordered trusted writes. Native scratch-register
use is safe because those value expressions cannot call code or use ECX/EDX.

Balanced comparison-tree opcode dispatch remains the default. The x86 backend
constructor accepts `dispatchStrategy: "indexed"` for explicit experiments;
this is not a guest language feature or a runner flag. Indexed tables contain
label differences, not process addresses. A backend-owned frame slot holds the
relocated code base, discovered once at function entry. Both table addressing
and table entries use assembler label-difference fixups, so whole-image
relocation does not change their contents. Bounds checks retain the ordinary
default handler. Experiments so far passed correctness but were slower, so
they must not silently become the normal execution path.

The snapshot compiler contract version changes with backend lowering changes.
Build a fresh image when measuring; an older snapshot embeds its older kernel
and frontend. See `../ZLIB_PERFORMANCE.md` for measurements and the outstanding
10x target. These IR improvements add no benchmark recognition, host language
fallbacks, handwritten rasterizer shortcuts, or special integer semantics in
the kernel source.

Small leaf calls can now carry an `inline_call_i32` body in the shared IR.
Eligibility depends on a bounded structural node count and absence of kernel
or native calls, never on a helper name. Only literal/local/argument actuals
qualify. Read-only parameters can alias those immutable caller operands;
parameters assigned by the callee receive private binding slots. Every callee
local receives a fresh caller-local index. Returns branch to a private inline
return label, not the enclosing function's return. Scope-free block wrappers
do not affect eligibility, since different host decompilers insert braces.
Unchanged IR subtrees are shared rather than cloned during the search.

The native backend lowers the inline body without a cdecl boundary. The JS
backend retains its canonical original call, allowing its host optimizer to
inline it; the callee remains in the graph. Both forms obey the same parameter,
local, return, and memory semantics. This is kernel compilation, not JIT
compilation or recognition of guest benchmark functions. `graph.inlining`
records eligible helper names/node counts and the number of expanded sites for
compiler introspection. The structural cutoff is a code-size heuristic, not an
ECMAScript language restriction.

Tail-position kernel calls are not expanded by the leaf inliner. The native
backend reuses the caller's cdecl frame when the callee's arguments fit in the
existing argument area. It evaluates all arguments first, then replaces the
argument words, restores callee-saved registers and the frame, and jumps to the
callee. Overlapping/swapped argument references therefore retain their values.
Calls needing a larger argument area keep the ordinary call/return path.
This is a kernel optimization, not a change to guest JS recursion semantics.

### Numeric canonicalization and ToInt32

Host-side `ValueCells.writePrimitiveAt` already chooses INT32 for exactly
representable signed 32-bit integers, except negative zero. The standalone
program builder must apply the same rule when copying parsed numeric constants.
Otherwise a literal `1` can force floating-point arithmetic and conversion in
every iteration of an otherwise integer loop. `canonicalizeNumberCellKernel`
checks IEEE-754 exponent/fraction words once at constant installation; it does
not round values or change -0, fractions, out-of-range integers, NaNs or infinities.
There is no source-pattern recognition or specialization of benchmark data.

`doubleCellToInt32Kernel` implements ES5.1 truncation/modulo from the explicit
double payload using shared binary64 layout constants and field accessors. Below
exponent zero the result is zero. At exponents 0..20 the high significand gives
the integer; at 21..51 both words contribute; at 52..83 only the shifted low word
can contribute modulo 2^32. From exponent 84 onward all finite representable
integers are multiples of 2^32, and exceptional exponents also map to zero. Sign
is applied after extracting the magnitude. This avoids x87 rounding-control
changes and handles values beyond int64 range correctly. Integer operands of
typed-array writes use their existing payload directly instead of passing through
an unnecessary floating-point conversion. Neither path calls a host VM.

The compiled entry's third argument is the guest-heap address of the
platform-service record, not the global object. It contains process-local libc
capabilities such as `snprintf` and is referenced from the engine-state record.
Host-triggered native collection explicitly roots the engine state, platform
services, and runtime support vector before invoking the shared marker. The
compiled collector likewise marks the platform-service entry argument before
sweeping. These explicit roots are intentional: reclaiming the table can turn
an ordinary reused heap word into an indirect native call target.

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

The middle end deliberately distinguishes ECMAScript `ToInt32` from the
signed i386 conversion at MMVM's raw-memory boundary. `to_i32_f64` implements
the language operation, including reduction modulo 2^32. The
`to_native_i32_f64` intrinsic is used for values passed to `poke8` and
`poke32`: it truncates an in-range double toward zero and produces i386's
integer-indefinite value (`INT32_MIN`) for NaN, infinity, or signed overflow.
Both backends implement that distinction. The i386 backend uses named x87
macro-assembler operations; the Node backend supplies the same observable
conversion in JavaScript. Raw-memory code must not silently reuse the language
coercion because large rasterizer edge coefficients depend on the native
boundary behaviour.

### Function graphs and accessor inlining

The kernel is a statically linked graph of named functions, not one monolithic
JavaScript function. `KernelCompiler.compileGraph(entry, dependencies)` treats
the dependency map as an available-function namespace, discovers the
transitive call graph from the parsed entry, and validates and emits only
reachable members with the same kernel rules. A call whose target is a member
of that graph becomes a typed `call_kernel_i32` IR node. Dynamic calls remain
forbidden. The JavaScript backend emits ordinary local function calls; the i386
backend emits relative calls through the named macro-assembler `call(label)`
operation. This supports transitive and recursive helper calls without
introducing host callbacks, native pointers in the heap, or raw instruction
bytes in semantic source.

Graph construction parses each member's `toString()` source exactly once and
reuses that immutable syntax tree for its signature, dependency discovery,
constant validation, and IR lowering. Dependency discovery shares the existing
constant-validation walk rather than adding another full-tree pass. This is an
important part of the abstraction boundary rather than merely a compiler
optimization: splitting a large kernel into maintainable helpers must not
multiply bootstrap parsing cost. Kernel-wide numeric constants are declared
once by the entry function and supplied as shared bindings to all members;
helper-local copies of layout or opcode constants are rejected.

Out-of-line calls are for logical operations: allocation, conversion, builtin
semantics, services, and substantial opcode families. They are not the
implementation of record access. Record fields, value-cell fields, bytecode
words, vector elements, and frame registers are expressed as named typed
accessors in kernel source. The middle end validates the record/index contract
and lowers an accessor directly to address arithmetic and a load or store; the
backend therefore inlines it without a native call. Raw `heapBase + record +
OFFSET` expressions are confined to the compiler's accessor lowering and are
not duplicated through interpreter semantics.

Current graph members include guest object/array/RegExp allocation, bytecode
call-frame construction and return, lexical binding access, `typeof`
classification, `instanceof` prototype traversal, property enumeration,
string-key comparison, self-hosted program construction, the complete
intrinsic dispatcher, Array/String/RegExp/Buffer/Math/Date builtin families,
direct FFI marshalling, and numeric-property lookup. The former multi-thousand
line call and builtin regions are now independently readable and compilable
units. Arithmetic, branching, general property access, and common interned-key
pointer comparisons deliberately remain in the dispatch entry because adding
a call to those smallest hot operations would be a performance regression.
Refactoring proceeds by semantic family, with the dual-host suite and native
benchmarks run at every committed boundary.

Field accessors are compiler intrinsics, not runtime helper functions. In
particular, the frame allocator and return path use names such as
`frameProgram`, `setFrameProgram`, `engineFreeFrame`, and
`setEngineCurrentFrame`; scratch storage that must be passed by address uses
`engineScratchLeftAddress`. Both backends inline these operations. Constants
such as `VALUE_CELL_BYTES` remain declared exactly once in the entry and are
injected as immutable bindings into reachable graph members.

`guest_vm/benchmarks/kernel_call_benchmark.js` compares a tight inline integer
loop with the same loop calling a one-operation kernel helper. On the current
development machine, 50 million native helper calls changed 174 ms to 229 ms:
about 1.1 ns per call. This is small enough for substantial helpers but large
enough to justify compiler-inlined field access in dispatch hot paths. The
benchmark is diagnostic rather than a fixed performance assertion.

## Optional native snapshots

Snapshot loading is deliberately opt-in. The command runner accepts
`--snapshot FILE` to compile the main interpreter with the ordinary kernel
front end and macro assembler and atomically write its code, and
`--with-snapshot FILE` to load that code on a later invocation. Neither option
is a default cache policy. Embedders expose the same choice as the mutually
exclusive `snapshot` and `withSnapshot` runtime options, both of which require
`nativeInterpreter: true` and an MMVM host.

An embedder which trusts a snapshot produced for the exact current checkout
may combine `withSnapshot` with `skipSnapshotHash: true`; the command-line form
is `--with-snapshot FILE --skip-snapshot-hash`. This avoids both
`interpreterKernel.toString()` and the source-hash pass. The loader continues
to validate every other header and file-layout field, but deliberately cannot
reject executable code generated from stale kernel source. The unchecked mode
is never implicit and is invalid without `withSnapshot`.

The loader accepts two image generations. Version 1 contains a 32-byte header
followed by the macro assembler's i386 output. Version 2 is the standalone
container described in `STANDALONE_SNAPSHOT_PLAN.md`: it adds a native entry,
prepared guest program/frame/context, and canonical guest heap while retaining
an explicitly located interpreter-code segment. Both headers record:

- the snapshot magic and file-format version;
- a manually maintained native compiler/ABI version;
- whether opcode profiling was compiled into the kernel;
- a hash of `interpreterKernel` source;
- the exact code length.

Loading validates the relevant fields and rejects an incompatible or truncated file.
It allocates a new anonymous mapping, reads the code into that mapping, and
changes it from read/write/execute to read/execute before entry. The snapshot
does not store a preferred code address, heap address, runtime record, libc
pointer, or lazy intrinsic-helper address. All internal branches are relative;
the heap base and runtime-owned platform-service table remain entry arguments.
Consequently snapshot use never fixes generated code at its original address.
Ordinary `--with-snapshot` execution still uses the independently allocated,
growable runtime heap. A standalone stage-2 file stores only its initialized
heap template. Its native bootstrap resolves `mmap` and `memcpy` through the
loader-supplied `dlsym`, reserves anonymous runtime memory independently of the
file, and copies that compact template before interpreter entry. A runner
image presented with `--snapshot FILE` also resolves `open`, `write`, and
`close` and serializes its untouched mapped image before interpreter entry.
Because executable code is PIC, the heap template contains no process-local
pointers, and heap capacity is not a file extent, this operation is a
byte-identical fixed point at any mapping address. Later stages will move
allocation, collection and further growth under the native runtime lifecycle.

Snapshots are architecture-, compiler-, profile-mode-, and source-specific
temporary build products. The checked-in runner documentation places them in
the ignored `artifacts/` directory, and `mk_clean` removes them. A backend or
macro-assembler change that can alter emitted code without changing
`interpreterKernel.toString()` must bump the snapshot compiler version in
`native_interpreter.js`.

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

The engine state also owns a native allocation cursor, the unused tail bounds,
and linked heads for available and retired free regions. Allocation helpers
reserve complete compound record groups before publishing any member. Region
selection and switching are compiled kernel operations; ordinary bytecode does
not call the host merely to obtain another reclaimed block. Available regions
are linked in heap storage and searched for the first region which can satisfy
the current request. Once a suffix is too small for an allocation it is retired
for that native slice instead of being reconsidered on every later allocation.
The host-coordinated collector handoff walks both named lists and restores
their records to the host index without scanning the entire heap.

A standalone snapshot has no host collector or allocator index. Its engine
state therefore publishes a collector generation and a separate mark-work
area above the logical heap limit. Allocation exhaustion marks from the active
frame and permanent runtime records, sweeps/coalesces dead records, rebuilds
the free-region chain, and retries the same bytecode in native code. Cached
frames and the weak property cache are invalidated before sweeping. Every
reference that survives this safepoint must be reachable through named record
fields or value cells; no host object participates in liveness. Program records
are not immortal structural roots: active programs are traced from frames,
callables, and constant references, while the host-coordinated path explicitly
seeds programs retained by its runtime metadata.

Host handles, parsed ASTs, compiler analysis, generated-code addresses, and
libc symbol addresses are bootstrap metadata only. The native engine cannot
dereference or call a host handle.

The engine-state record also owns a small direct-mapped constant-property
cache. It accelerates repeated own-property reads without changing object
layout or making cache contents authoritative. Receiver/key identity,
structural version, GC mark, and property-head guards must all match; the
property value itself is always loaded afresh. The collector does not trace
cache entries and clears them before reclaimed addresses become reusable.

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

`THROW` also remains inside the native engine when a guest handler exists. A
handler stores its continuation PC, saved lexical environment, and one signed
catch-binding descriptor. Non-negative descriptors are direct environment
slots; negative descriptors encode a top-level name-constant index as
`-index - 1`. The dispatcher finds the first handler through the heap frame
chain, copies the thrown value before recycling intervening native frames,
restores the handler environment, and resumes at its bytecode target. This
representation lets both the JS reference interpreter and native backend use
the same bytecode without consulting host compiler metadata. An uncaught throw
still uses the embedder exception boundary so it can be reported with source
location information.

Indirect `eval` uses the same frame machinery. The runtime retains two guest
front-end entry points: the lexical direct-eval compiler and a global-code
indirect-eval compiler. A non-empty indirect eval enters the latter as an
ordinary bytecode frame. That frame returns an executable guest function, and
a named `INDIRECT_EVAL_COMPILE` continuation rewinds only the internal call
site and invokes the executable through normal bytecode dispatch. No source,
AST, compiler product, or completion value crosses into a host parser. Direct
eval retains its separate lexical-environment path until that continuation is
migrated with its declaration-instantiation semantics intact.

The support-vector ABI used by compiled code is described once by
`RuntimeSupportLayout`. Kernel-local symbolic constants receive those values
through `constantOverrides`, so generated code retains immediate operands
without duplicating layout numbers throughout the implementation. The sorted
override names and values participate in the native snapshot source hash;
changing a support slot therefore invalidates an incompatible code snapshot.

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
## Register bytecode dataflow

`bytecode.js` owns instruction widths and destination-operand metadata. The
verifier, interpreter fallback synchronizer, and bytecode optimizer share this
layout rather than keeping independent opcode lists.

`bytecode_optimizer.js` performs a forward must-analysis before a compiled
program is published. Each basic block receives facts about register values:
unknown, signed int32, or positive zero. Constant registers seed the entry
state. Moves propagate facts; signed bitwise operations produce int32 values;
other destinations invalidate their previous facts. At control-flow joins a
fact survives only if every incoming path supports it. The worklist reaches a
fixed point before any instructions are rewritten, including loop backedges.

The first transformation replaces `int32Value | positiveZero` with a move,
or removes it when source and destination are identical. It does not remove
coercions of unknown values, fractional numbers, objects, or negative zero.
Rebuilding instruction storage relocates branch targets and source locations;
register numbering, binding layouts, and constants remain unchanged. The
descriptor's `optimizationStats.redundantInt32Conversions` exposes the number
of proven redundant conversions for diagnostics.

Functions with exception-handler or `with` instructions are currently left
unchanged: their extra control-flow edges require explicit modelling. A named
analysis-state limit bounds compiler memory; exceeding it leaves the function
unoptimized, never rejects an otherwise valid program. Neither limitation
changes guest semantics. This pass is shared by both host execution paths and
the standalone frontend; it contains no benchmark-specific recognition.

### Fused wrapping arithmetic

`ADD_INT32` and `SUBTRACT_INT32` represent addition/subtraction followed by
ToInt32. The optimizer emits them only when both inputs are proven signed
int32 values, the immediately following instruction is a positive-zero OR,
the intermediate register has exactly one use, and the pair is inside one
basic block. Int32 sums and differences are exactly representable as binary64,
so wrapping word arithmetic gives the same observable result, including
overflow. Multiplication is deliberately not included: an int32 product can
exceed binary64's exact-integer range.

Use counting conservatively includes every numeric bytecode operand and the
register vectors referenced by CALL/CONSTRUCT. Non-register operands can only
cause false uses (missed optimizations), never hide a use. Rewrites preserve
the final destination and relocate branches as for coercion elimination.

The native interpreter checks the input tags before using word arithmetic;
unexpected types yield to the ordinary semantic path rather than being
misinterpreted. The reference interpreter and threaded JS backend implement
addition/subtraction followed by ToInt32 through their normal runtime numeric
semantics. These instructions are general VM operations, not recognizers for
particular programs. Profiling-vector capacity follows the authoritative
opcode-name vector, so adding an instruction cannot overlap allocator fields.

### Cold snapshot compilation

`KernelCompiler.prepareSource(source)` performs the semantic fingerprint's full
parse and tree traversal and returns the fingerprint together with function
syntax trees and phase timings. `compileGraph` accepts this transaction-owned
result as `preparedSource`. It reuses a function tree only when the captured
function text matches the function being compiled (apart from surrounding ASCII
whitespace). A mismatch uses the normal parser. Declarations are adapted to
expression descriptors without modifying the fingerprinted tree.

This removes duplicate parsing within one cold build; it is not a disk cache,
does not reuse machine code, and does not omit fingerprint validation. The
fingerprint still ignores source formatting metadata and includes all semantic
fields. Prepared trees are not retained in the resulting IR or snapshot.
Diagnostics report parse/fingerprint, graph lowering, and assembly durations;
total process elapsed time also includes runtime preparation and serialization.
Timing values are diagnostic only and are not part of the fingerprint.

Host-string ingestion uses `Heap.writeStringFieldUTF16LE`, which validates the
complete destination record field and delegates to a bounded linear-memory
writer. The native memory layer packs two UTF-16 code units per word store;
the paged reference layer writes the same little-endian words. Odd trailing
code units use exactly two byte stores, never an overwrite of adjacent data.
Empty strings, embedded NULs, and lone surrogates retain their code units.
String hashing still follows the existing per-code-unit algorithm unchanged.
This is an ingestion operation, not an alternative host-backed guest string
representation: the resulting strings remain owned by the independent heap.

### Explicit ToInt32 bytecode

`TO_INT32 destination, source` implements ES5.1 numeric conversion followed by
signed 32-bit truncation/modulo. The optimizer emits it for binary OR only when
the right input is proven positive zero and the left input is not already
proven int32. It keeps the two-instruction arithmetic fusion and redundant
conversion elimination ahead of this rewrite. No result is inferred from an
unproven source type.

The native interpreter handles int32, binary64, booleans, null and undefined
directly. Binary64 conversion uses the shared IEEE-754 word algorithm, including
NaN, infinities, large exponents and negative zero. Other source types take the
ordinary semantic fallback, just as the original binary bitwise instruction
did. Both reference execution paths perform runtime ToNumber before truncation,
preserving object conversion side effects and ES5 string-number rules. A
number-only fast path in threaded JS avoids introducing host helper overhead.

The operation drops an otherwise unnecessary register operand and second
conversion from the instruction stream. Profiling identifies it by its shared
opcode name; heap-layout counter sizing remains automatic.

### Per-handler successor dispatch

The i386 backend accepts `dispatchStrategy: "replicated"` for structured loops
whose body contains a single direct `opcode_dispatch` operation. It emits each
handler once, but duplicates the loop continuation at each handler's end. That
continuation performs the original suffix (instruction/budget accounting), loop
condition, prefix (including GC safepoints), and an indexed successor jump in
that order. This provides a separate indirect branch site for each preceding
opcode. It is ordinary single-threaded execution, not OS threading.

There is one shared read-only handler table. Its entries are label differences
relative to the function's position-independent code anchor, so neither code
nor the guest heap acquires a new fixed-address requirement. Selector bounds
are checked before indexing. Out-of-range selectors execute the original
dispatch body; loops with unsupported shapes retain structured dispatch.
Only control-flow layout changes: guest semantics and the JS reference IR are
unchanged. Ordinary integer while conditions also use direct comparison
branches rather than materializing and retesting a temporary boolean.

This strategy remains explicit, not the VM default: its first two zlib batches
were slower than balanced dispatch. The VM retains the comparison tree while
keeping the general direct-comparison loop lowering.

### Compact literals at compilation entry points

Normal script compilation, eval, and Function-constructor compilation use the
same compact-literal parser representation as the self-hosted frontend.
Unescaped number/string/boolean literals need no individual AST wrapper object;
null retains an explicit node to distinguish it from an absent expression.
Escaped string nodes preserve directive-prologue flags, including the fact that
an escaped spelling is not a strict-mode directive. Source locations and raw
function text remain enabled. The parser's public default AST format is not
changed; this is an internal compiler allocation policy, not different language
semantics or a source-specific parse cache.

### Small helpers and adjacent typed-read conversions

Shared middle-end inlining accepts bounded small bodies that call other kernel
functions, not just leaf functions. It inserts a body at most once at a call
site; inserted bodies are not recursively expanded, so recursive dependency
graphs remain finite. Native-ABI calls remain excluded from eligibility, pure
actual-argument restrictions and private parameter/local bindings remain, and
tail-position calls keep their separate frame-reuse lowering. The JS backend
retains ordinary calls to the same functions.

Primitive ToInt32 conversion is factored into named kernel helpers, with the
int32 case separated from colder binary64/boolean/null/undefined handling.
Their tag constants come from `ValueCells.Tags`, not duplicated numeric tags.

After completing a typed-array indexed read, the interpreter may consume an
immediately following ToInt32 instruction using those helpers. It checks the
remaining budget, full lookahead instruction bounds, opcode and source-register
match, and disables the combination in GC-stress mode. The original read result
is preserved if the conversion has a different destination. The instruction
counter, budget and optional opcode counters account for both instructions.
Unsupported types leave the conversion for ordinary execution. This is an
interpreter operation-pair optimization, not source recognition or alternate
benchmark code; no guest bytecode format or JS reference semantics change.
