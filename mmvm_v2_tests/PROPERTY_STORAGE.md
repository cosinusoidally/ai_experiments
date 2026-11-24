# Ordered object properties

Ordinary objects now use a growable array of **inline entries**, in
insertion order, plus an optional hash index from a name to an entry ID. It is
not a linked list with faster searching, nor an array of pointers to separately
allocated property records. Empty objects have a null storage reference until
their first insertion. Arrays, functions, RegExp and Buffer records retain
their special indexed/internal layouts and legacy *named* entries behind the
same owner/entry accessor boundary. The cutover is for ordinary objects.

Both the reference implementation and the compiled interpreter use this
representation by default. Native constructors create packed entries directly;
there is no linked-list construction followed by a lazy conversion. The native
implementation is `property_storage_kernel.js`, compiled by the shared kernel
pipeline. Compiler contract 54 invalidates incompatible code-only snapshots.

## Entries and ordering

`PROPERTY_STORAGE` is a runtime-heap record with length, capacity, live count
and an optional index reference. Each 32-byte inline entry contains a string
key, descriptor attributes, setter reference and a 16-byte tagged value cell.
The remaining word is alignment padding. There is no per-entry heap header or
next pointer. Layouts are authoritative in `heap_records.js`; consumers use
named field accessors.

Packed and legacy named entries expose the same temporary descriptor view:
key, attributes, setter and value cell. Packed alignment padding is at the end
of the entry, so its binary64 payload remains eight-byte aligned. A semantic
read or write resolves this view once, rather than resolving the owner again
for each descriptor field. The view is not a cache reference: it must never
survive a callback, storage mutation or heap relocation. Persistent caches
still retain only guarded owners and entry IDs. The snapshot inspection tool
recognizes the preceding contract-51 value-cell layout when inspecting older
images; raw heap dumps are interpreted using the current layout.

The reference runtime distinguishes the checked descriptor API from the
resolved-entry API. The latter is used immediately after lookup or guarded
cache validation establishes a live entry, so it need not repeat slot bounds
and key checks. This is the same prevalidated-access pattern as
`vectorCellWithinLength`, not an unguarded persistent pointer cache. No callback
or structural mutation may intervene before the view is consumed.

Entry IDs are one-based array slots, with zero meaning not found. New names
append. Updating a value or descriptor does not move the entry. Deletion clears
the entry, leaving a tombstone; recreating that name appends a new entry.
Enumeration scans live entries forward, filtering enumerable attributes when
required. Hash bucket order is never enumeration order. Ordinary numeric-looking
string names retain insertion order too; existing dense-array index behaviour
is a separate concern.

The component's explicit growth operation preserves IDs; stable compaction
changes IDs while preserving order. Ordinary-object regrowth can compact at
the same time, so IDs must always be checked against their backing. Both
operations return a new storage reference. The storage
record flags hold a mutation epoch. An optional hash must contain entry IDs,
not raw entry addresses, and must be invalidated/rebuilt when appropriate.

The high flags bit is reserved for an embedding context-snapshot pin; the
remaining bits are the wrapping mutation epoch. Epoch updates preserve pins,
but replacement storage does not inherit them. A pin prevents eager retirement,
not mutation: the saved context owns a byte copy and retains the original
record boundaries until its last snapshot owner releases them. Ordinary GC
then reclaims any now-unreachable backings. Snapshot roots also retain immutable
targets of saved cells, even when the running context deletes those references.
Restoration invalidates native lookup caches, threaded property/array views and
handle entry maps: rolled-back epochs cannot validate views from an abandoned
execution timeline. This is a context-lifetime rule, not Test262-specific logic.

## Address/lifetime audit

The ownership boundary is shared by all execution paths:

- `runtime.js` now has owner-scoped `propertyEntries` maps on its heap proxies.
  Their guards are backing identity, heap structural epoch and GC generation;
  host-side `propertyVersion` alone is insufficient for native mutations.
- The threaded compiler's monomorphic/polymorphic caches now retain guarded
  owner/entry references, not persistent value-cell addresses. They resolve
  an ephemeral cell only when performing an access. Descriptor operations
  continue through the semantic property access API, including inherited
  getter/setter receiver handling.
- Native interpreter property-cache entries contain the owning object, its
  storage identity/epoch, GC generation and entry ID, not a persistent cell
  address. Slot resolution happens only after validating those guards.
- Property traversal preserves the found owner separately from the
  original receiver; accessor `this` must still be the receiver.
- Some low-level APIs return a value-cell address. Such an address is
  ephemeral: callers must not retain it across storage growth, compaction or
  re-entrant guest code. JavaScript references spanning an RHS/getter/setter
  evaluation retain the owner and key and resolve the entry when needed.
- The collector follows the owner's storage reference. Packed storage
  traces each live entry's key, setter and tagged value, plus the optional
  index. Tombstones retain nothing.

Descriptor, prototype and permission handling remain separate from lookup
acceleration. Reverse traversal is explicitly named: enumeration reverses it
to expose insertion order, while internal searches can start at the last slot.

## Growth, hashes and retirement

Ordinary insertion starts with capacity four and grows geometrically. When a
full backing is at least half tombstones, regrowth compacts into the current
capacity instead of growing it. Individual deletion never shifts later slots.
The optional open-addressed index starts at 32 live entries, stays at or below
half occupancy and stores slot IDs. It is not an enumeration structure.
Insertion updates a current index incrementally where capacity permits;
deletion, replacement or incompatible epochs discard it. Native index creation
uses only available arena space and falls back to scanning without forcing GC.

Superseded backings and discarded indexes are private implementation records.
Once the replacement is published, their payloads are cleared and their records
retired; the normal allocator/collector rebuild reclaims native retired records.
This is necessary for lifetime hygiene as well as deterministic snapshots:
obsolete copies of a libc-symbol dictionary must not retain producing-process
addresses after the live binding cells have been normalized. No serializer-only
copying/caching workaround or source/debug stripping is involved.

When free regions pass from the embedding allocator to native execution,
they are ordered by size and then address. ES5 does not promise stable
`Array.sort`; sorting by size alone allowed equal-sized regions to exchange
allocation order between hosts. An explicit tie-breaker makes that allocator
decision deterministic without changing guest identity semantics or rewriting
references in the serializer.

Descriptor operations that can append to their own source object preserve any
needed temporary value before regrowth. Raw cell addresses must not outlive
that mutation. Both collector backends trace only live entries, their keys,
setters and tagged values; tombstones retain nothing.

## Bulk access and allocator diagnostics, 2026-10-26

Small-table linear lookup rejects unequal UTF-16 lengths and canonical hashes
before decoding text. Hash collisions still receive exact string comparison;
pointer identity alone is never assumed to establish inequality. A complete
entry span can be validated once for a synchronous scan, then read through
the explicitly named `propertyStorageKeyWithinLength` accessor. The checked
per-entry API remains available. No callback or structural mutation may
intervene during the borrowed scan.

Bulk string decoding resolves slices/rope branches into checked flat spans,
reads their code units directly, and joins bounded chunks. It preserves UTF-16,
including lone surrogates, and avoids host-stack recursion or repeated view
resolution per character. This improves ordinary property lookup and source
decoding; it is not a workload-specific replacement or parse cache.

Native property retirement is published in the engine's retired-free list.
Allocator handoff may restore a dormant copy of the host free-block index only
when its bump bounds, free/retired heads, frame-cache head, collection count
and empty host free index certify an unchanged ownership domain. Allocation,
retirement, collection or uncertainty retains the full authoritative rebuild.
Profile output reports reuse/rebuild counts and rebuild time, plus optional
host allocation-search counts. These counters showed that this optimization
alone did not explain the slow scope-test range; string decoding was the
larger measured cost. See `BUILD_PERFORMANCE.md` for the portable diagnostic
tool and measurement limitations.

## Original migration sequence

1. Implement packed allocation, lookup, append/update, deletion, growth,
   compaction, enumeration and both collector backends. Validate the complete
   storage lifecycle in the existing heap-record regression, including exact
   value retention and deletion/reinsertion order.
2. Convert persistent caches and property access to owner/entry operations.
   Keep the existing representation working during this API migration.
3. Switch ordinary objects to packed storage, then cover the named-property
   parts of arrays/functions and other special objects without changing their
   indexed/internal data semantics.
4. Replace the transitional legacy-list accelerator with the optional
   slot-based hash. Remove old property-record allocation/traversal once no
   consumer relies on it.
5. Recheck enumeration/prototype/accessor behaviour, bounded GC stress, demos,
   Octane and Test262. Compare serial genuine builds under both hosts and
   verify byte-identical self-hosted snapshots.

No C support, host-language semantic delegation, generated files, npm or
external corpus modifications are part of this migration. Tests and benchmarks
remain serial. A component passing does not imply the object-layout cutover
or the snapshot performance-parity objective is complete.

## Cutover checkpoint, 2026-10-25

The ordinary-object cutover is enabled and passes both-host project suites,
the expanded bounded structural GC workload on both hosts, eight previously
working Octane quick suites and standalone language integration. Short demos
1–8 checks render, accept input and exit normally; demo8 visits garage and
free-drive auto pilot. Both web servers serve byte-identical text and ELF
data, generate a directory listing and select a supplied `index.html`.

The fresh image is 8,132,248 bytes and is bit-identical to its genuine
self-hosted rebuild. The independent heap/marker audit reports 32,908
reachable records and zero missing marks. Both the reference and native GC
stress runs perform 67 embedding collections and 27 audits over 72,842 edges,
including 221 property-index audits. Maximum observed guest bumps are 363,336
and 388,184 bytes, below the 8 MiB cap. The standalone workload exercises 47
native automatic collections. No demo or external corpus source was changed.

Initial serial build timings are 82.02 seconds under js_min and 79.59 seconds
self-hosted. A fresh exported pre-cutover baseline and full bounded Test262
comparison are still pending at this checkpoint; these timings alone do not
establish a build speedup. Raw logs/images use ignored `artifacts/packed-final`
and `artifacts/packed-retirement` prefixes.

## Historical owner/entry conversion checkpoint, 2026-10-24

The record layer provides named owner/entry accessors. Its legacy adapter
currently interprets entry IDs as legacy record IDs; callers must not calculate
addresses from them. This is deliberately not presented as packed storage.

The runtime-handle cache has an implicit owner (the handle), a table of entry
IDs and shared guards. Site caches additionally record the owner handle's
identity to reject recycled offsets. Failed lookups are not cached. Deletion,
reinsertion, collection, backing replacement or a structural epoch change
invalidate references even if host `propertyVersion` did not change.

The runtime's property read/write API takes the descriptor owner separately
from the receiver. Prototype lookup returns the owner; accessors still receive
the original receiver as `this`. The native constant-property path similarly
retains the found owner after walking the prototype chain, and resolves its
entry through compiled owner-aware helpers. These helpers are normal kernel
functions, not host callbacks or new dialect semantics.

At that checkpoint, remaining before the default-layout cutover: convert the other native lookup,
allocation, descriptor, enumeration, deletion and cloning paths, together with
the record-layer cloning/initialization implementations. Then change entry
resolution to packed slots and replace the transitional list index with the
optional slot index. No partial packed-default mode is enabled in the meantime.

The checkpoint's fresh js_min build takes 81.21 seconds versus 81.58 seconds
for the preceding baseline in the same serial session. Genuine self-hosted
generation takes 78.27 seconds and produces an exactly identical 8,099,232-byte
image. These are single-run build measurements, not a claim about sustained
demo FPS. Temporary images/logs use the ignored `artifacts/owner-entry` prefix.

Validation of this API stage, serially: both-host project suites pass (12 guest
programs / 270 assertions each), as do all eight previously working Octane
quick suites, standalone language integration and bounded GC stress (42 native
collections). The existing embedding regression now checks heap-side mutation
without a host-version change, collection invalidation and cached/inherited
accessor receivers. Short unchanged-demo checks cover demos 1–8 and demo8's
garage/free-drive auto-pilot transitions and normal exit. Demo8's brief 16.3 FPS
sample at 320x240 / 20 FPS cap matches the preceding checkpoint's sample; this
is not a sustained-performance guarantee. The focused Test262 selection has
the same 164 passes / one existing failure / zero not run or timed out.

### Reference traversal and GC ownership follow-up

The reference runtime now uses owner/entry accessors for global-attribute
initialization, enumeration, native-symbol snapshot binding discovery and
storage release. Reverse traversal is explicitly named `lastOwnPropertyEntry`
and `previousOwnPropertyEntry`: the legacy list is newest first, whereas
packed storage will walk slots backwards, preserving observable enumeration
order without exposing either representation's addresses or links.

Root discovery no longer performs a second layout-dependent property-marking
walk. `markAuthoritativeHeap` already traces marked owners through the record
visitor, including their storage, keys, values and setters. A packed entry is
not a heap record that root discovery may mark independently. The native
collector algorithm is unchanged by this follow-up.

Both-host project suites pass after this conversion. Bounded structural GC
stress passes on both hosts: 50 embedding collections, 27 audits, 84,041
checked edges and 142 property-index audits each. Maximum observed bumps are
176,264 bytes on Node and 175,480 bytes on js_min, under the fixed 8 MiB cap.
These validate the traversal follow-up; the snapshot timings and integration
inventory above describe the preceding owner/reference checkpoint, not an
additional build or full Test262 run of this follow-up.

## 2026-10-26: packed ordinary-object cutover verification

Ordinary objects now use insertion-ordered packed entries, with an optional
hash index. Special array/function/regexp/buffer named-property layouts are
not part of this cutover. Persistent references use guarded owner/entry
identities rather than pointers into movable storage. Saved-context backing
pins, immutable roots and cache invalidation on restore are required parts
of that lifetime contract, not optional performance features.

The complete bounded Test262 inventory executes 3,292 cases: 3,139 pass,
153 fail, zero not run. The failing IDs and variants exactly match the
pre-cutover reference; six instruction-limit timeouts are included among
failures. See TEST262_STATUS.md for the sequence of runs and fixes.

Both-host project suites, bounded GC audits, standalone language integration
and the eight previously supported Octane quick correctness selections pass.
The selections are Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay
(including latency), NavierStokes and zlib. These are correctness checks, not
stock benchmark scores or a claim that all Octane benchmarks work.

Actual X11 demos 1–8 were exercised from the packed-scan standalone image at
320x240 with a 20 FPS limit, including garage and free-driving autopilot
transitions in demo8. They rendered, accepted input and exited normally.
These were short interactive smoke checks, not long stability soaks or a
proof of sustained 20 FPS. The separate bounded GC workload completed 47
automatic native collections; independent snapshot tracing found no missing
marks across 33,172 reachable records.

The cutover does **not yet improve build speed**. Before the timer-bridge
follow-up, cold js_min construction took 76.20 seconds and genuine
self-hosted construction 79.97 seconds, versus 74.87 and 73.33 seconds for
the pre-cutover reference. The two new images were byte-identical, dense,
8,194,224-byte files. Whole-inventory Test262 time improved from the initial
587.10-second cutover run to 412.72 seconds, but remains slower than the
308.96-second pre-cutover repeat. Correctness recovery must not be confused
with performance parity.
