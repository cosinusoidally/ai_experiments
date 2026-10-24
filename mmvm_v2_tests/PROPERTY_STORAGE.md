# Ordered object properties: migration contract

The target representation is a growable array of **inline entries**, in
insertion order, plus an optional hash index from a name to an entry ID. It is
not a linked list with faster searching, nor an array of pointers to separately
allocated property records. The existing linked representation remains active
until its consumers have been converted; the new packed component is not yet
the default object representation.

## Entries and ordering

`PROPERTY_STORAGE` is a runtime-heap record with length, capacity, live count
and an optional index reference. Each 32-byte inline entry contains a string
key, descriptor attributes, setter reference and a 16-byte tagged value cell.
The remaining word is alignment padding. There is no per-entry heap header or
next pointer. Layouts are authoritative in `heap_records.js`; consumers use
named field accessors.

Entry IDs are one-based array slots, with zero meaning not found. New names
append. Updating a value or descriptor does not move the entry. Deletion clears
the entry, leaving a tombstone; recreating that name appends a new entry.
Enumeration scans live entries forward, filtering enumerable attributes when
required. Hash bucket order is never enumeration order. Ordinary numeric-looking
string names retain insertion order too; existing dense-array index behaviour
is a separate concern.

Growth allocates a larger backing store and bulk-copies entries without
changing IDs. Stable compaction copies live entries in their current order,
but changes IDs. Both operations return a new storage reference. The storage
record flags hold a mutation epoch. An optional hash must contain entry IDs,
not raw entry addresses, and must be invalidated/rebuilt when appropriate.

## Address/lifetime audit

These existing consumers prevent a safe one-step layout replacement:

- `runtime.js` now has owner-scoped `propertyEntries` maps on its heap proxies.
  Their guards are backing identity, heap structural epoch and GC generation;
  host-side `propertyVersion` alone is insufficient for native mutations.
- The threaded compiler's monomorphic/polymorphic caches now retain guarded
  owner/entry references, not persistent value-cell addresses. They resolve
  an ephemeral cell only when performing an access. Descriptor operations
  continue through the semantic property access API, including inherited
  getter/setter receiver handling.
- Native interpreter property-cache entries currently contain property-record
  addresses. They must cache the owning object and entry ID instead.
- Property traversal currently returns raw property records, including after
  a prototype walk. The found owner must remain available separately from the
  original receiver; accessor `this` must still be the receiver.
- Some low-level APIs return a value-cell address. Such an address is
  ephemeral: callers must not retain it across storage growth, compaction or
  re-entrant guest code. JavaScript references spanning an RHS/getter/setter
  evaluation retain the owner and key and resolve the entry when needed.
- The collector currently follows property-list links. Packed storage instead
  traces each live entry's key, setter and tagged value, plus the optional
  index. Tombstones retain nothing.

Owner-and-entry accessor conversion precedes the default-layout cutover. The
legacy records may serve as a temporary implementation behind those accessors;
they are not the final storage. Descriptor, prototype and permission handling
must remain separate from lookup acceleration.

## Working increments

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

## Owner/entry conversion checkpoint, 2026-10-24

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

Remaining before the default-layout cutover: convert the other native lookup,
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
