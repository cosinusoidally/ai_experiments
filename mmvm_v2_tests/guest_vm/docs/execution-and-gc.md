# Execution, boundaries and garbage collection

Primary sources: [`interpreter.js`](../interpreter.js),
[`runtime.js`](../runtime.js), [`aot/native_interpreter.js`](../aot/native_interpreter.js),
[`aot/heap_sweeper.js`](../aot/heap_sweeper.js),
[`native_free_index_kernel.js`](../native_free_index_kernel.js).

## Dispatch and authority

Portable `Execution` dispatches register bytecode using JS frame/register
arrays and Runtime operations. A native-enabled execution first enters the
kernel with heap base, frame, platform/string support, budget and engine state.
The JS kernel backend receives a memory adapter; i386 receives native
addresses. Both execute the same lowered low-level program.

The kernel can create callee frames, return into callers, run supported native
intrinsics and guest-built-in bytecode, and collect without returning to the
outer JavaScript host. The kernel is an interpreter for guest bytecode, not a
JIT of each arbitrary guest function. Application NativeCompiler use in
Demo8 is a separate facility, not a special VM rasterizer operation.

Native exit reasons include budget, return, unsupported semantics and
allocation. In embedding mode `NativeInterpreter.run` publishes allocator
state and `Execution` reconciles frames, selectively reloads operands and can
execute the declined operation through portable semantics. It then resumes
native execution. This is what the code's “semantic exit” means: not an
unimplemented CALL opcode in general, but a particular operation/value case
not completed by that kernel path.

`frame.nativeHeapCurrent` records which representation is authoritative.
After a native run, an incompletely reloaded host register array must not be
spilled over live native registers. After portable fallback, changed values
and frame structure must be republished before native re-entry. Native
exceptions/continuations need the same discipline. Refreshing a frame must
recover its actual home context, not substitute the caller's context.

## Calls and built-ins

- Bytecode functions carry program, lexical closure and home context. Calls
  normalize `this` according to strictness and initialize binding/argument
  registers. Constructors additionally apply construction/prototype rules.
- Native function records identify intrinsics. A supported intrinsic executes
  directly in the kernel, including raw memory and FFI operations.
- Guest built-ins are callable records whose closure references a guest JS
  implementation. This permits general algorithms and observable coercion
  callbacks to use ordinary guest frames instead of outer JS semantics.
- Explicit embedding functions have `callMode === "host"`. Portable
  execution yields a `hostCall` result and waits for the embedder to complete
  or fail it. Ordinary intrinsic callbacks can instead run synchronously in
  portable fallback; they are not all represented by `hostCall` results.

The Math library illustrates the mixed design: public numeric intrinsics
keep their fast numeric entries, with guest fallbacks for observable
conversion/special cases. Private primitive callables avoid recursive
fallback loops. Array generic algorithms similarly complement native dense
paths. Prototype descriptors remain authoritative even when an old method
table contains an implementation handle.

## Cooperative scheduling and exceptions

`resume(budget)` runs until completion, throw, explicit host call or budget
exhaustion. A budget is instruction accounting, not milliseconds, a total
execution cap or preemption of a blocking FFI call. Exhaustion returns control
without throwing. Finite slices let an embedder multiplex contexts; no OS
thread is required. See [the API](api.md) for the precise result shapes.

Synchronous helpers automatically service host calls and grant further slices.
Their current budget policy is Infinity for native/threaded execution and
1,000,000 for portable interpretation. An old comment claiming all synchronous
native calls use finite artificial slices is not the actual policy.
Native allocation/semantic boundaries and internal collection still apply.

Handler records and compiler-generated control flow implement catch/finally,
scope restoration and abrupt completions. A host callback failure is injected
at the suspended call when execution resumes, so guest catch/finally can run.
An abort discards frames; it is not a guest exception or finally-unwind API.

## GC: explicit reachability, automatic scheduling

The heap is nonmoving mark/sweep. Native addresses and live record offsets
remain stable; dead addresses may later be reused. The host JavaScript GC
does not decide guest lifetime. `collect()` is an optional explicit API,
not a requirement for normal operation.

Embedding collection uses allocation debt/record counts and safe points,
with `gcPending` and collection-depth guards. Native execution has its own
allocation-pressure and optional stress boundaries; it can run native marking,
sweeping, free-index rebuild and growth before continuing. The embedding
collector synchronizes generations and allocator state with the native one.
Do not count only one side's collection counter when diagnosing a mixed run.

Roots include runtime built-ins and support records, registered contexts and
their active frames, live callee chains, explicit persistent root slots,
embedding callbacks, retained programs, and saved context graphs. Temporary
nested executions invoked by module loaders/callbacks are additional live
stacks, even if they do not replace `JSContext.execution`.

`HeapRecords.visitReferences` and native marking logic define the graph:
prototype/storage edges, only tagged reference payloads, closure/home-context
edges, program metadata/source/binding-name edges, array elements/mappings,
buffer view/backing edges, frame registers/handlers and so on. Add a field
without a corresponding tracing edge and the failure may appear much later
as an invalid/freed record in unrelated code.

Publication order is part of correctness. A frame must be rooted **before**
spilling values whose conversion can allocate. Program adoption roots both
the source descriptor and incomplete destination callable before recursive
allocation. An accessor callback can allocate or mutate property storage;
do not carry an unguarded descriptor-cell address across it. A JS local in
the embedder is not automatically a guest root.

## Allocator ownership and growth

The portable heap has reusable blocks; native allocation additionally uses a
current region, tail region and a segregated intrusive free index. Small
aligned size classes are indexed directly; larger sizes use subdivided
power-of-two classes with bitmap summaries. Free links are scratch in dead
records, not live object references. The portable largest-block structure is
not the native bin index.

Only one allocator may own a free span at a time. Native entry transfers
ownership. Ordinary embedding constructors reserve through the native engine
while it owns the spans; context creation explicitly returns ownership first.
Collection retires unused region tails, coalesces reusable
records, drops derived indexes and rebuilds ownership from the post-sweep
heap. An old portable free list must never allocate a span that native GC has
already reused. This is a correctness constraint, not just a performance knob.

The coordination API has three operations:

- `acquireAllocatorOwnership()` removes every reusable address from the
  portable index and installs the engine's region lists. The borrowed portable
  index is dormant and reusable only with an unchanged-domain certificate.
- `releaseAllocatorOwnership(deferIndexRebuild)` publishes remaining native
  spans and resets the engine allocator. It restores a certified index,
  recovers the tracked free spans or reconstructs the index from headers.
  Collection preparation defers that reconstruction until after sweep.
- `prepareForCollection()` owns the ordered handoff, cached-frame retirement
  and weak property-cache invalidation. No guest allocation may occur between
  that preparation and marking/sweeping. The runtime rebuilds the portable
  free index from the post-sweep graph once, not from pre-collection regions.

There is no wrapper-owned refill arena or per-execution allocation cursor.
An allocation exit enters the existing bounded collection/retry policy; it
does not claim a separate span which the engine-owned allocator cannot see.
Embedded exit dispatch uses `NativeInterpreter.Exit`, not duplicated numeric
IDs. Profiling reports `allocationExits` plus the existing index-handoff and
collection counters; the obsolete arena-refill counters have been removed.

The common collector source now reads `CollectorLayout` from HeapRecords and
uses normal kernel-local semantics, not repeated numeric declarations or
legacy initializer overrides. Embedding and standalone compilation use the
same explicit namespace. The main interpreter now also uses explicit graph
bindings; no legacy constant-local override mode remains in the compiler.

Pressure boundaries trigger collection before expanding logical capacity.
If live data still requires space, growth grants adaptive headroom up to the
reserved maximum without moving the heap base. Repeatedly collecting the
same mostly-live heap at an unchanged pressure boundary is pathological;
native-to-portable reconciliation must preserve newly granted headroom.

Weak string/metadata maps and property caches are invalidated or pruned after
collection. Cached frames cannot retain an untraced old graph indefinitely.
Large external buffer allocations are released with their backing records.
Pinned context-snapshot storage is an exception to eager retirement: its
saved record boundaries must survive until the snapshot is destroyed.

## Standalone behavior is stricter

The machine-code bootstrap can replenish/grow and re-enter on budget or
allocation exits, but it has no outer JS semantic interpreter. An unsupported
native operation prints diagnostics and exits 70; allocation failure can
exit 74. A guest library implementation is still independent execution:
it is guest bytecode calling guest/native services, not fallback to js_min.

`forbidHostCalls` and `logHostCalls` currently cover explicit host-mode CALL
and CONSTRUCT transitions. They do not constitute a full audit of every
intrinsic callback or native semantic exit. For that, inspect native exit
counters/tools and test in the standalone launcher. Do not use the flags as
proof that the embedding path is fully self-hosted.
