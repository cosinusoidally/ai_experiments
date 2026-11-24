# Native/semantic allocator handoff

The native interpreter and portable semantic engine allocate in the same
runtime-owned heap. In a standalone image the semantic engine is guest code,
not an external JavaScript host. A synchronous semantic call can re-enter a
different context. A legacy wrapper-owned arena must relinquish ownership
before such entry. The current engine-owned allocator instead has a single
runtime-wide authoritative cursor: nested contexts share it, and every native
entry republishes the portable tail. Portable construction can reserve spans
through that same compiled allocator. CALL/CONSTRUCT therefore do not themselves require an
engine-owned allocator handoff. This is not permission to share stale,
per-execution cursors.

## Shared reservation service

`Heap.setRecordAllocationProvider()` installs a runtime-owned provider.
While native ownership is active, `NativeInterpreter.reserveRecordSpan()`
reserves an aligned span through the compiled kernel entry. Frame zero selects
this allocation-only entry mode; the budget argument carries the requested
byte count rather than an execution allowance. It is an internal calling
convention, not guest bytecode or a language feature. Normal frames retain
their existing instruction-budget semantics. Both compiler backends execute
the same `reservePortableRecordKernel` and `reserveNativeAllocationKernel`.

Reservation never collects: partially constructed objects may not yet have
their final roots. It preserves execution counters and the previous allocation
failure status. On success it publishes valid reserved/free headers, advances
the authoritative cursor and materializes the remaining arena suffix. The
ordinary heap initializer still performs zeroing, including the existing
separately allocated Buffer-backing metadata rule. On failure the provider
releases ownership, allowing the ordinary allocator to reuse or grow storage;
automatic collection remains at established safe points.

This avoids copying the whole free-space index whenever the portable tail is
full but native-owned regions are mostly empty. A logical heap limit is not
proof of live-memory exhaustion. Verbose Test262 diagnostics include the
logical bump/limit, collection pressure, collection count, record-allocation
checkpoint and last indexed-free total to distinguish those conditions.

## Previously unbounded work

The old handoff rebuilt the portable free-block index by walking every heap
record whenever native allocation changed its borrowed domain. Repeated eval
therefore scanned an increasing number of allocated program records on each
iteration. A Unicode RegExp test's consecutive 100,000-instruction slices took
approximately 8, 19, 35, 51 and 65 seconds. The test heap itself was only a few
MiB; reducing source parsing alone would not remove the repeated heap walk.

## Exhaustive tracked domain

At entry to native execution, link small free records into the retired domain
instead of leaving their addresses in a separate portable index. Available
free storage is represented by:

- The native reusable-region list.
- The native retired-record list.
- The unused suffix of the active native arena, if any.
- Free records published by portable operations while native ownership was
  retained; these remain in the portable allocator's disjoint index.

When an ownership handoff is needed and no native collection has occurred
since borrowing the domain, these lists form the complete free set. Publish
the active suffix and clear native ownership. The shared kernel-dialect
`recoverTrackedFreeBlocksKernel` drains the lists through named record
accessors, validates ordinary-free headers and emits their addresses through
the existing collector workspace protocol. It never inspects allocated
records. Coalescing/tail trimming remain collector work, not a sort at every
handoff. Workspace exhaustion clears all links and uses the full indexer;
corrupt headers raise an error. The structural GC audit separately verifies
record boundaries and duplicate/overlapping allocator entries.

The native allocator must link even a header-sized exhausted-arena remainder
into its retired list. Such a remainder was previously discoverable only by
a complete heap walk; omitting it would make the tracked set incomplete.
Cached frames remain a distinct, flagged domain and are not ordinary free
records available to the portable allocator.

## Collections and uncertainty

Native collection can coalesce/reclaim records, invalidating the original
portable index. If the native collection counter changed, native return
immediately relinquishes ownership and uses the authoritative complete
rebuild, before portable code can allocate from stale addresses. Collection
preparation itself still discards
derived indexes and rebuilds from the post-collection record graph. The
existing stricter unchanged-domain certificate can also restore an untouched
borrowed index directly.

The native return path also preserves increases in the native tail/pressure
limit. `Heap.growToFit` synchronizes logical growth within the existing
reservation, and `resetHeapPressureBump` carries adaptive post-GC headroom
forward. Without this synchronization, the next entry reinstalls an older
portable limit and repeatedly collects at the same boundary. Neither the
reserved address span nor the configured maximum is increased.

## Portable allocation priority index

The portable allocator no longer linearly searches all free blocks for every
allocation. It consumes a sufficient maximum from the existing binary max
heap. Ordinary frees and split remainders maintain that heap incrementally in
O(log n); bulk producers invalidate it and heapify once when first queried.
An allocation split decreases the existing root in place rather than popping
and reinserting a nearly identical largest block. The common case keeps its
maximum with only the root/child comparisons, avoiding two unnecessary tree
walks per small record.
An allocation larger than the maximum fails the free-space probe in O(1),
then uses the tail/growth path. The allocation-search counters now count the
single candidate inspected rather than hypothetical first-fit iterations.
No record lifetime or zero-initialization guarantee changes.

## Compilation pressure

At ordinary GC safe points, allocation debt also considers the heap's
monotonic record-allocation counter. Program descriptors, bytecode and
constant pools otherwise allocate without necessarily creating object
handles, so handle-only debt can postpone cleanup of their weak metadata.
The checkpoint resets after collection. This adds no callback to allocation
and never collects while a program record is partially constructed. Native
allocations retain their existing byte-pressure/allocator-exhaustion policy.

This is a general allocator protocol, not an eval/source/test cache. It does
not weaken instruction limits or alter guest-visible allocation lifetimes.
Both JavaScript and i386 backends use the same native kernel source; the
portable ownership operations are ES3-compatible JavaScript and can themselves
execute in the standalone VM. Validation includes bounded structural GC
auditing, reentrant/context project tests, snapshot rebuild identity and the
unchanged external Test262 workloads.
