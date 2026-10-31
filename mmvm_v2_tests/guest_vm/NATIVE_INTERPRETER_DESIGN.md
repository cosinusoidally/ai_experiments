# Native kernel interpreter design

## Callable ownership and lexical metadata (2026-10-31)

Native contract 87 distinguishes a native *record representation* from an
embedding registration. `Runtime.makeNativeFunction` explicitly links its
host-created callback into the runtime's callback-root list. The engine owns
the same head in its state record. Hosted marking seeds this list; standalone
marking receives it as an explicit root. The collector does not root every
NATIVE_FUNCTION record merely because of its type. Guest-created bound
functions own traced closure vectors and are collected normally. A portable
adapter is materialized only if an embedding read/fallback needs one; that
adapter is not a new permanent callback registration.

Environment-backed programs have an optional value vector mapping slots to
identifier strings. A previously unused program payload word holds its
reference, with named accessors and marking edges on both backends; program
record size is unchanged. Bootstrap registration and self-hosted adoption
populate the same representation. Native dynamic reads search declarative
and catch environments before global lookup. Object environments requiring
unsupported observable operations decline rather than being skipped.

Ordinary-object property caches accept owner-local packed entry IDs, not
linked function descriptors. `findOwnPropertyEntryKernel` selects the
appropriate representation; a caller that may receive a function must not
call the packed-only cache directly. Stock multi-iteration PdfJS exposed
this distinction in bind's length lookup.

The bounded structural GC driver checks both root-head agreement and that
discarded guest bound functions disappear after execution. Its optional
`--trace-host-calls` reports phase/audit progress and semantic transitions.
See [PdfJS bring-up](PDFJS_BRINGUP.md) for mechanisms and validation history.

## Portable conversion paths (2026-10-28)

Native `Number` uses the shared `convertValueToNumberKernel` rather than a
second copy of its string parser. Invalid complete string conversions,
including embedded NUL characters, yield NaN instead of requesting a semantic
exit merely because libc did not consume the full text. Existing guarded
ordinary-object/date handling is shared with the other numeric operations.
This does not claim that libc's entire accepted numeric grammar is ES5.1's.

Native `String` recognizes the canonical `[object Object]` result only after
the existing method-identity/accessor guards establish unchanged ordinary
conversion behavior. Overridden conversion methods still require the general
callback-capable semantic path; they are not ignored.

The portable `String.fromCharCode` implementation converts arguments in order
to UTF-16 units and joins their strings, rather than building an unbounded
variadic `apply` call into its embedding engine. This avoids an external
argument-count/stack limit and permits the same implementation to execute
inside a standalone guest embedding. Native `Function.apply` forwarding to
all intrinsic targets remains separate unfinished work.

The executable contract is version 65; rebuild generic images after these
changes rather than expecting an older image's native semantics to change
when loading new application source.

The portable frame initializer also recognizes negative constant-register
entries as unmapped, matching the native initializer. Heap-adopted programs
use these sentinels where source descriptors used holes; they must not become
named negative-index properties on the interpreter's register array.

## Program installation and property lookup (2026-10-28)

The internal builder `__guestVMProgramSetCode(callable, start, words)` accepts
either one integer word (the existing form) or a dense guest array of integer
words. The range form validates all source tags and destination bounds before
writing. It uses the same writable-bytecode/copy-on-write path and invalidates
the execution cache once after installation. Source code, source locations,
verification and the public JS language are unchanged. The self-hosted frontend
uses the range form rather than paying a full guest call for each emitted
word. Both the structured runtime and native kernel implement this internal
API; native installation neither materializes host objects nor calls the host
VM. Interpreter contract version 64 requires images containing this API.

Small ordinary objects retain their insertion-ordered packed entries without
requiring a hash index. Their linear lookup checks identity, length and hash
before invoking general string equality; hash equality is never sufficient to
accept a key. The property cache is indexed by key hash. Its fully guarded
owner hit remains valid only for the same owner, storage, epoch and generation.
Across owners the cached entry is merely a slot-number hint: bounds and the
current slot's key must match before resolving the current descriptor. This
does not assume shared shapes, retain an interior property address, or bypass
getters. A cleared cache owner invalidates both the full hit and the hint, so
cached keys are never consulted after collection invalidates the table.

Optional single-threaded native sampling is documented in
[native profiling](tools/NATIVE_PROFILING.md). Sampling percentages locate
costs; they are not substituted for end-to-end timing or correctness runs.

## Ordered ordinary-object properties (2026-10-25)

Ordinary objects now own packed entry storage rather than linked property
records. `property_storage_kernel.js` supplies named owner/entry helpers to
the same kernel compiler and both backends. Native constructors create packed
storage directly; global, computed and constant-name lookups use guarded slot
references. Temporary descriptor views resolve multi-field accesses once,
but never survive a callback or mutation. See
[ordered property storage](../PROPERTY_STORAGE.md) for the complete layout,
cache, insertion-order, retirement and saved-context ownership contract.

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

### Kernel compiler data movement

The shared IR also supports `loadRawF32(address)` and
`storeRawF32(address, value)`. Values participate in binary64 expressions, but
the memory operation reads/writes IEEE binary32. The i386 backend uses named
x87 `fld_f32_ptr_eax` / `fstp_f32_ptr_ecx` macros. The JS backend uses the
memory boundary's shared binary32 conversion, including round-to-nearest,
ties-to-even, subnormals, signed zero and overflow. Typed-array indexed access
uses these operations; it does not leave the native interpreter for Float32
reads or writes. Buffer slices and typed-array subarrays share the view
construction path, with offsets scaled by the actual element size.

Dynamic `Function` construction can enter a guest bytecode compiler installed
alongside the eval compilers. Its native continuation returns the adopted
callable without executing it and re-homes it to the calling context. The
compiler validates parameter and body syntax and adopts ordinary program
records. Its continuation flag and call/construct modes are real shared
lexical constants supplied as external compiler bindings, not additional
compiler-local pseudo-constants. Parser-owned compilations may use the compiler's `consumeAst` option
to detach completed function bodies after scope/return analysis and lowering;
the default non-consuming API retains ASTs for the structured backend and
embedders. Adopted executable closures do not retain their temporary compiler
descriptor graph.

For failed standalone runs, `guest_vm/tools/audit_snapshot_heap.js
--heap-frame ADDRESS raw-heap-dump` displays the suspended frame chain,
function source prefixes, instruction operands and referenced record kinds.
This is read-only diagnostic tooling usable on Node or js_min, not a test
which fixes private instruction layouts in place.

The compiler forwards single-definition, single-use locals through runs of
integer assignments without calls, writes or control-flow boundaries. It
invalidates a candidate when an input local is assigned. Loads may move only
within such a write-free region with valid kernel addresses. The first writing
statement can consume an address/value before its effect, but forwarding never
continues through that effect. This is an IR optimization, not altered semantics
for source-level variable declarations. Introspection reports the number of
eliminated assignments. Named `copyValueCell` operations let both backends see
an entire copy instead of unrelated field-access statements.

Standalone calls with discarded results are supported as ordinary expression
statements. They retain their effects and do not require dummy result variables.
Both backends lower the same expression-statement IR.

The native backend supports an optional fourth register (`registerCount: 4`),
used by the interpreter for its heap base. EDX is write-through: assignments
also update its normal argument/local stack slot. While code generation borrows
EDX as scratch, references use that slot; afterwards EDX is reloaded without
clobbering the result in EAX or the x87 stack. Generated four-register callees
preserve EDX, and external native calls use the same borrowing protocol. Copies,
grouped field stores and signed division/remainder explicitly borrow EDX.
Variable shifts exchange EAX/ECX directly and no longer need EDX as a temporary.
No SSE, new processor feature, OS thread or newer Linux interface is required.

Constant byte/word stores use immediate memory instructions. Simple value
stores avoid argument-stack traffic, and pure affine sums use LEA. Complex
operands keep the evaluation-order-preserving general emitter.

The loop derives completed instruction counts from its initial and remaining
budget, rather than incrementing a redundant counter. Both fusion paths consume
the extra budget unit explicitly, so budget exits, host exits and returns retain
their original accounting. The GC-stress interval is cached for an invocation
and refreshed after CALL: only its control intrinsic can mutate it while this
kernel is executing. Embedder changes enter through a new invocation. The
remaining-stress count remains in shared engine state and is not cached.

Callable diagnostic state is meaningful on an unsupported exit, not on every
successful instruction. Generic exits clear that state on their cold path;
call entry and accessor-call entry initialize it before invoking helpers.
Explicit numeric failures, computed-property failures and call failures use
a detail-preserving exit. Rejected computed reads encode the receiver and
key kinds using the named property-pair base and value-kind radix. Reference
kinds additionally encode the heap record type. This distinguishes, for
example, an ordinary object's signed numeric key from an array offset without
requiring a slower hosted replay. The encoding is diagnostic only; it does
not change property semantics or add writes to successful reads.
This avoids a diagnostic write per ordinary opcode without attributing a stale
call rejection to a later unrelated failure.

### Fingerprint construction

Every build still parses and visits the complete canonical syntax tree.
Repeated canonical tokens (field names, node types, punctuation and scalar
representations) have per-build memoized digests. The ordered structural stream
mixes these token digests using exact binary64 integer arithmetic. This changes
the non-cryptographic fingerprint format and invalidates old image contracts;
it is not a persistent source, parser or compiled-program cache. The temporary
dictionary is discarded with the compilation transaction.

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

Value cells are tagged unions, not four independently meaningful words.
INT32 and REFERENCE use the low payload word; DOUBLE uses both payload words;
undefined, null and booleans need only their tag. Inactive payload words and
the reserved auxiliary word are unspecified. Consumers, including GC, must
check the tag before interpreting payload. This was already the contract of
`ValueCells.writePrimitiveAt` and `writeReferenceAt`. Native named setters
still clear inactive words, and value copying copies all four words. Although
the language does not require clearing, the snapshot writer currently retains
these words: omitting the stores loses cross-host byte identity. Fifty
hand-expanded native write sequences now use the same named setters instead
of duplicating field offsets. This is a readability cleanup, not an execution
speedup; its complete native code section is byte-identical to the unchanged
control's code section.
Allocation/explicit clearing still zeroes storage. No cell size,
field offset, tag, bytecode layout or snapshot relocation rule changes.

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

Loading does not stringify, parse or fingerprint current kernel source.
Compatibility is determined by the executable contract version and header
mode/layout checks. Maintainers must bump the contract for incompatible
kernel/backend changes; a source edit alone is not a compatibility check.
Builds still record a deterministic source fingerprint as diagnostic metadata.
The old `skipSnapshotHash` option / `--skip-snapshot-hash` flag is retained as
a compatibility no-op and is invalid without `withSnapshot`.

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

Execution consumes a native return value before reclaiming its frame. At that
lifetime boundary, `Execution.releaseFrame` unpublishes both the context's
active-frame root and the engine's current-frame root before freeing storage.
The engine root moves to the caller (which may belong to another context), or
to zero at the end of the chain. Otherwise a collection between completed
executions can follow an engine root into a freed frame. Raw NativeInterpreter
embedders which manage frame storage themselves must call `releaseFrameRoot`
before reclaiming the frame; a returned frame remains rooted until consumed.

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
are linked in heap storage. The standalone collector sorts reclaimed arenas
by size using an allocation-free linked-list merge sort. First-fit then
preserves large holes without an exhaustive best-fit search for every small
record. Reusable suffixes are inserted in size order. Selecting a large extent
does not give all its remaining space to unrelated bump allocations: the
active window is at most the request plus its sentinel, bounded below by
`PREFERRED_NATIVE_REGION_BYTES` (64 KiB); any useful excess remains on the free
list immediately. No object or native Buffer address moves. Once a suffix is too small
for an allocation it is retired for that native slice instead of being
reconsidered on every later allocation.
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

After collection the tail headroom is at least half the live graph, half the
reclaimed storage, or the minimum post-collection headroom, whichever is
largest, bounded by the configured heap maximum. A non-moving heap can contain
many small free holes which cannot satisfy a contiguous vector allocation;
reclaimed storage alone is therefore not a useful growth-pressure metric.
The live-graph term amortizes tracing cost during frontend construction without
moving references or increasing the maximum heap reservation.

Integer-keyed ordinary objects use the same optional hash index as string-keyed
objects. Decimal length/digits and the authoritative string-hash step compute
the probe without allocating a string on a hit; collision checks compare exact
canonical decimal text, so `"01"` is not key `1`. Only a missing write allocates
its key (Latin-1 ASCII). Hash-index construction may switch allocator arenas,
but remains optional and never forces collection or masks an existing
allocation-failure flag. Requiring the index to fit only the current arena
would silently turn large dictionaries back into linear searches.

Host handles are bootstrap metadata only; the native engine cannot dereference
or call one. The standalone source frontend's ASTs and compiler analysis are
ordinary guest-owned objects. Generated-code and libc addresses are native
process capabilities, rebound where necessary when an image starts.

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

### Experimental native operand preparation

`--vm-predecode` selects an opt-in execution representation when constructing
the native kernel. It implies `--vm-native`; embedders use
`nativeOperandPredecode: true`. It is not the default. For example:

```
js_min.exe guest_runner.js --vm-native --vm-predecode --snapshot artifacts/predecoded
./artifacts/js_runner.exe artifacts/predecoded hello.js
```

An existing standalone image already contains its selected kernel; do not add
`--vm-predecode` to its application arguments. Code-only snapshot loading checks
the operand mode as well as the compiler/source/profile contract. The mode is
an explicit header field, not an overloaded compiler version or profile bit.

Canonical bytecode remains unchanged. Verification, debugging, source positions,
program adoption and the ordinary reference interpreter continue to use it.
The execution view has the same instruction widths and word-indexed PCs, but
selected value/storage instructions carry register byte offsets rather than
logical register numbers. Constants, lexical depths/slots, jump targets, call
argument vectors, and unconverted instruction families retain their canonical
representation. `bytecode.js` derives the register-position masks from its
shared source/destination metadata; it is the single authority for preparation.
`bytecodeRegisterCellAddress` expresses the selected scale without manual
address arithmetic. No source names or object shapes select this optimization.

The complete layout table lives in the guest heap and is rooted by the runtime
support vector. `prepareExecutionBytecodeKernel` lazily creates a guest BYTECODE
record, validates instruction boundaries and offset overflow, then publishes
it through the canonical record's `bytecodeExecutionCache` field. That field
uses an existing reserved word; record sizes and canonical word positions do
not move. Both collectors trace the link. The prepared record holds only
relative offsets, never the heap base or fixed native addresses. It therefore
survives logical heap growth without rebasing and is freed with its owner.
This is in-memory operand decoding, not a disk/source/parser cache.

Preparation runs in the kernel on either backend. Allocation failure publishes
the frame/PC and completed-instruction count and uses the existing collection
and retry boundary; it does not execute a partially prepared record. Frame
entry/return/exception transitions obtain the appropriate view. ProgramSetCode
invalidates it on both embedding and native paths; a normal intrinsic CALL
also refreshes an invalidated active program before the next instruction.
Callbacks and unsupported operations still have canonical bytecode available.

The existing native integration scenarios run in both modes, including a
collection between budget suspension and resume. Performance and sustained
demo validation of the opt-in mode are tracked in `ZLIB_PERFORMANCE.md`; passing
small integration scenarios alone is not sufficient to make it the default.

### Register initialization and compiler analysis

String construction has the same initialize-before-read requirement as other
heap records. A reserved allocation is private but not necessarily zeroed;
its previous flag word may select a rope layout. Builders must initialize the
flat header (including flags and length) before calling layout-aware character
readers to compute a hash, and publish the allocation only after construction.
The integer/radix builder follows this order as well. Array enumeration uses
that builder for numeric keys, so a violation can surface during self-hosted
compiler traversal rather than an explicit Number.toString call.

Named property lookup must also account for dense array cells: the string key
`"0"` produced by enumeration denotes the same element as integer `0`. For
each object in the prototype chain, lookup checks explicit descriptors, then
a present indexed cell when the object is an array, before following its
prototype. Holes do not shadow inherited properties, and mapped arguments
cells retain their parameter alias. This lookup executes in the kernel; a
recursive compiler traversal must not silently lose children stored in arrays.
Enumeration also accepts null/undefined (no iterations) and the own-property
view of number/boolean primitives (no own enumerable keys), without a host
callback. Reference kinds not yet handled by this kernel still take an
explicit unsupported exit; this does not claim complete prototype enumeration
or all string/typed-view enumeration semantics.

Call setup uses named initialization and constant-mapping helpers. On native
memory it can zero registers through libc memset and then write undefined tags;
all payload and auxiliary words remain zero. The Node memory-adapter path keeps
the ordinary field-writing algorithm. Memset is a process-local FFI capability
cleared during serialization and rebound through dlsym at startup, not a
host-language callback or a C support API. A program-owned initialization-vector
experiment was slower in repeat measurements and was removed.

Constant-branch pruning runs after source validation/lowering but before use
counting and inlining. Disabled diagnostic/configuration paths therefore do
not inhibit ordinary dataflow optimization. Both source branches are validated,
and flattening blocks preserves the kernel's function-scoped var bindings.

`bytecode.js` owns instruction widths, destination and source-operand metadata. The
verifier, interpreter fallback synchronizer, and bytecode optimizer share this
layout rather than keeping independent opcode lists.

`bytecode_optimizer.js` performs a forward must-analysis before a compiled
program is published. Each basic block receives facts about register values:
unknown, signed int32, or positive zero. Constant registers seed the entry
state. Moves propagate facts; signed bitwise operations produce int32 values;
other destinations invalidate their previous facts. At control-flow joins a
fact survives only if every incoming path supports it. The worklist reaches a
fixed point before any instructions are rewritten, including loop backedges.

Join propagation caches the successor input vector and lazily builds a sparse
list of facts which can still weaken. Unknown facts cannot become known at a
must-analysis join; preloaded constants are excluded only after the shared
write analysis proves their registers unwritten. Facts which weaken to unknown
are removed from that list. This preserves the same lattice/fixed point while
avoiding repeated scans of unknown temporaries and immutable constant banks.
The analysis-work budget counts the actual visited/joined cells, not a guessed
full-vector cost for each sparse join.

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

### Compiler-owned AST and nested-program lifetimes

The public parser continues to return independent mutable nodes. The consuming
self-hosted frontend explicitly enables `shareIdentifiers`: within one parse,
immutable Identifier leaves with the same name share a descriptor. These leaves
have no source location, binding slot, or scope state. Where location capture is
enabled, statement/function locations remain per occurrence. Exact function
source is retained, and binding resolution still
occurs in each compiler's lexical scope. No function bodies are shared.

In consuming mode the compiler completes whole-function scope, return-kind,
and nonlocal-binding analysis before lowering, then clears completed root
statements. It does not clear nested statement lists: a `finally` body can be
lowered on several control-flow paths. Default compilation remains
non-destructive for embedders retaining an AST.

`Compiler` also accepts an optional `finishFunction(program)` sink, inherited
by nested compilers. It runs only after the function descriptor is complete.
The executable frontend verifies and adopts each completed function through
the existing guest program intrinsics, returning its callable template to the
parent's constant table. Program-constant installation converts that template
to its program reference; `MAKE_FUNCTION` still creates each actual closure
with the execution-time lexical environment. This avoids retaining all child
compiler vectors until the entire source file has been lowered. Descriptor
APIs without a sink retain their existing return format. Adoption roots protect
both the source descriptor and the incomplete destination during collection.

The executable-adoption interface does not accept a per-instruction location
table. That path therefore disables temporary AST/bytecode location-table
capture instead of retaining unused tables until adoption finishes. This does
not remove data from executable programs or snapshots: the interface did not
retain those tables previously. Tokenizer/parser error coordinates, filenames,
exact function source, and the public parser/descriptor compiler's default
location tables remain available. `captureLocations` is an explicit compiler
option inherited by nested compilers, not a change to JavaScript semantics.

Declaration bodies are lowered in their original source order. Experimental
largest-first scheduling and call-count-based builder preallocation were not
retained: AST lifetime management and completed-function adoption provide a
clearer general interface without depending on source-shape heuristics.

Optional register packing also has an explicit `MAX_PACKING_REGISTERS` analysis
budget. Above it the emitted program retains its original register numbering;
the compiler does not allocate the many full-sized liveness vectors merely to
save some temporary registers. This is a compilation-resource limit, not a
language limit, and is separate from the int32 dataflow-state budget.

The int32 pass bounds repeated work as well as resident state. Its
`MAX_ANALYSIS_WORK` accounts for copied/joined register cells and traversed
bytecode words. If convergence exceeds that budget it returns the unmodified
program before rewriting any instructions, exposing
`optimizationStats.int32AnalysisBudgetExceeded` for inspection. Ordinary
control-flow analysis is not allowed to become unbounded compilation work.

Native assignment to a plain dense array's `length` updates the vector's
logical length, not a shadow ordinary property. Shrinking clears removed
elements/references; growing creates absent slots, and spare capacity can be
retained. Descriptor-bearing arrays and unsupported coercions leave this fast
path rather than silently bypassing property semantics. This operation is a
general array runtime operation, not a special compiler allocation API.

### Fused wrapping arithmetic

`ADD_INT32` and `SUBTRACT_INT32` represent addition/subtraction followed by
ToInt32. The optimizer emits them only when both inputs are proven signed
int32 values, the immediately following instruction is a positive-zero OR,
the intermediate register has exactly one use, and the pair is inside one
basic block. Int32 sums and differences are exactly representable as binary64,
so wrapping word arithmetic gives the same observable result, including
overflow. Multiplication is deliberately not included: an int32 product can
exceed binary64's exact-integer range.

Use counting follows the shared source/destination operand descriptions and the
register vectors referenced by CALL/CONSTRUCT. Constant indices, lexical slots
and jump targets are not register uses. Rewrites preserve
the final destination and relocate branches as for coercion elimination.

### Adjacent temporary coalescing

A second pass retargets an eligible producer directly into the destination of
an immediately following MOVE or ToInt32. The old temporary must have one
definition and one read, must not be a named binding or preloaded constant,
and no branch may enter between producer and consumer. Producers which do not
snapshot their operands cannot overwrite an input. CALL, construction and
allocation are not eligible producers. A ToInt32 consumer is retained, with
identical source/destination, and cannot move its intermediate result into a
named binding: conversion may call user code or throw before assignment.
Self-copies are removed. Exception/with functions are left unchanged, as in
the integer analysis. `optimizationStats.coalescedCopies` reports the count.

This changes register destinations, not the bytecode register-bank layout or
constant storage. Neither pass changes the guest program or recognizes
benchmark names. The diagnostic monitor's optional `--bytecode-summary` reports
these statistics using an additional ordinary compilation; its initialization
timing must not be compared with an uninstrumented benchmark.

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

Eligibility captures the original body and a copy of its local-name map before
any graph member is rewritten. Later expansion of a preceding function cannot
silently enlarge a candidate, change its local indices, or make the one-level
budget depend on function order. Named array-index resolution is a separate
helper, so decimal-key parsing need not enlarge the dispatch entry's working
set simply to support ordinary string-key access.

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
## Large native byte backings (2026-10-27)

Buffers and ArrayBuffers of at least `Heap.BufferBackingPolicy.LARGE_BYTES`
(currently 1 MiB) use directly called libc `calloc` for their bytes on the
native backend. The backing record still reserves its complete logical span
in the non-moving guest heap. Only its header/metadata are initialized inline;
the reserved payload is not needlessly written. Smaller backings and Node's
reference implementation remain inline. This is an allocation policy, not a
special case for an application or benchmark.

Keeping the reservation preserves existing record walks, GC byte accounting,
heap limits and canonical snapshot layout. It costs virtual address space in
addition to the external allocation, but avoids committing the inline payload
solely to initialize zero bytes. The external pointer is owned by the guest
backing record, never by a host JS object. Views mark the backing normally.
The native sweeper calls libc `free` before reclaiming an unreachable external
backing; embedding-side collection, explicit record release and runtime
destruction perform the equivalent release. Reused storage must still be zero
initialized; the optimization relies on calloc's contract, not an assumption
that a reused guest-heap range is clean.

`BUFFER_BACKING_EXTERNAL_FLAG` distinguishes the pointer from an inline data
pointer. Native indexed access already uses backing pointers; constructors
and embedding accessors now honor the same representation. FFI pointers stay
stable for the entire lifetime of a live backing. Function source storage and
function `toString()` are unchanged.

Portable snapshots remain canonical inline images. In the private snapshot
copy, serialization copies external data into its reserved inline span,
normalizes alignment padding, clears external ownership and clears native
pointers. The existing bootstrap reconstructs inline pointers on load. The
live allocation is never relocated or freed during serialization. This does
not change the C loader or snapshot container format. A snapshot containing a
large live backing still includes its full bytes, just as it did before.

In-process context snapshots retain the original backing as a GC root and
save/restore its contents at the same external address. Such snapshots can
temporarily increase RSS through their private copies; they are not part of
the normal benchmark execution path. Creation captures the external-backing
list from retained addresses. Those records remain rooted and their pointers
stay stable until the snapshot is destroyed, so restoration visits only that
list. A snapshot with no external backings performs no backing-discovery scan
on restore.

Native contract 62 invalidates old compiled kernels. The calloc service uses
the platform-services record's previously reserved final word. No thread,
page-discard operation, compression or host-language callback is introduced.

### Logical UTF-16 access and numeric property keys

Native contract 66 corrects the logical `stringCharacterCodeUnit` accessor,
including its indirect-string path. The flat storage primitive performs a
word load; the logical accessor now masks that load to one UTF-16 code unit.
Previously most callers supplied their own mask, but numeric property-key
matching compared the unmasked result. Bytes beyond a one-character key could
therefore affect lookup: an assembler scale table could contain `"2": 1` and
resolve `table["2"]` correctly while `table[2]` incorrectly returned undefined.
The extra bytes depended on storage history, explaining the intermittent
self-hosted assembly failures. Fixing the accessor's contract, rather than
coercing keys in the assembler, also protects every other logical caller.
