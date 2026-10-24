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

- `runtime.js` has persistent `propertyAddresses` maps on its heap proxies.
  They must become owner/entry caches guarded by the storage reference/epoch.
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
