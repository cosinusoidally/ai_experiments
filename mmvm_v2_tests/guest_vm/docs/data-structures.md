# Heap and data structures

Read this with [`heap.js`](../heap.js), [`value_cell.js`](../value_cell.js),
[`heap_records.js`](../heap_records.js) and
[`property_storage_kernel.js`](../property_storage_kernel.js) and
[`string_key_kernel.js`](../string_key_kernel.js). Numerical
layouts below explain the current representation, not constants to duplicate
at call sites. Use the named accessors/exports when implementing changes.

## Address domains and allocation

A guest reference is a **32-bit byte offset from the runtime's heap base**.
Zero means no reference. A value-cell address, record address, entry ID and
native pointer are not interchangeable. Record offsets become native
addresses only at the memory/backend boundary. Native call results and FFI
pointers must not accidentally be traced as guest references.

All records have a 16-byte header: type, allocated size, mark generation,
flags (four 32-bit words). Allocations are 8-byte aligned and begin at offset
64; the initial reserved area is not an object. Header flags have meanings
specific to record kind. For example, string storage flags are not ordinary
object `[[Class]]` bits or descriptor attributes.

`Heap` tracks the logical allocation limit, reserved maximum, bump, reusable
blocks and allocator-provider handoff. Runtime defaults are 64 MiB initially
and 512 MiB maximum. Explicit `heapBytes` without `maxHeapBytes` makes the
runtime fixed-capacity. The lower-level `Heap` constructor alone defaults its
maximum to its initial capacity. Growth changes logical limits, not the
native base. Native reservation also includes collector work space after the
maximum heap. Reserving that space is not touching every page or putting
those pages in the snapshot.

`HostMemory` uses `calloc`/`free` on a raw-FFI host. On Node its current
allocation implementation uses sparse 64 KiB pages, normally Node Buffers,
with zero reads for absent pages. It is not one host JS object per guest
object, and not one eagerly allocated Buffer for the full reserved heap.
`LinearMemory` centralizes checked/trusted scalar, bulk, binary64 and raw
access. `Heap` owns record validation. `Records` owns specific field meanings.
The native kernel uses compiled named accessors with the same layouts.

## Values: explicit tags, not NaN boxing

A value cell is 16 bytes: tag, low payload, high payload, reserved auxiliary
word. Tags identify undefined, null, false, true, int32, binary64 or reference.
Int32/reference use the low word; a double uses low/high. Negative zero must
remain a double, not int32 zero. Nonfinite doubles and NaNs are real binary64
values. [`binary64.js`](../binary64.js) supplies portable bit conversion;
the native backend emits floating-point operations on native payloads.

Tag zero denotes an **absent vector element/hole**, not the language value
undefined. Inactive payload words are unspecified: a stale low word under an
undefined tag is not a reference. GC and every consumer must inspect the tag
first. This rule permits overwrites without clearing all sixteen bytes.
Root slots, registers, environment slots and ordinary data-property values
use this contract. Compact immutable constant pools have their own encoding.

## Ordinary objects and properties

An ordinary `OBJECT` has prototype, property-storage reference, extensible
state and a retained legacy property-index field in its payload. The active
packed-layout hash reference is in `PROPERTY_STORAGE`, not that legacy field.
Class flags distinguish internal Date/Error identity and primitive-wrapper
branding independently of public prototypes. PRIMITIVE_WRAPPER guards wrapper
slot lookup in constant time; changing a prototype does not remove the brand.
Wrapper payloads still use the existing internal-value entry, not a new host
object or a new record layout. The wrapper's implementation entry is omitted
from key enumeration. This is not a general migration of all private slots.

Ordinary named properties are a growable `PROPERTY_STORAGE` record:

```text
OBJECT -> PROPERTY_STORAGE
           length / capacity / live count / hash-index reference
           entry 1: key, attributes, setter, value cell, padding
           entry 2: ...
           deleted entry: key = 0
           -> optional PROPERTY_INDEX: buckets containing entry IDs
```

An entry is 32 bytes, without its own heap header. Entry IDs are one-based
slots relative to an owner, not pointers. Storage initially has capacity four
and grows geometrically; a grown backing can replace the old one. Deletion
leaves a dead slot; appending a re-created property puts it after existing
live entries. Replacement can compact dead slots and renumber live entries
while preserving order. Do not rely on a cell address surviving replacement or
an observable callback. A persistent reference needs the owner, entry and
validity guards; if invalidated, relookup by key before resolving the cell.

Descriptor attributes are writable, enumerable, configurable and accessor
bits. For an accessor entry the value represents the getter and the setter
has a separate reference. Operations must distinguish “descriptor absent”
from an existing data property whose value is undefined.

After lookup/guard validation, `resolvedOwnPropertyEntryDescriptor` uses the
same `ownPropertyEntryDescriptorKernel` as native execution. The portable
accessor lazily compiles that small graph through the shared front/middle end
and the storage-appropriate backend (JS for emulated memory, i386 for native
memory), once per loaded module/backend/result kind. Cached code receives the memory object
on each call; it captures no runtime, heap or owner. The wrapper retains owner
validation, and the explicitly checked entry API retains its bounds/deletion
checks. Do not replace a checked accessor with this resolved-only operation.

Small objects scan entries. At 32 live properties native packed lookup can
build an optional power-of-two, linear-probed `PROPERTY_INDEX`, with capacity at least twice
the indexed count. Hash buckets point into storage; they do not own property
values and do not define enumeration order. A cached FNV-style hash over
UTF-16 code units avoids rehashing each lookup; split partial multiplication
preserves the exact low 32 bits on the different JS hosts. String equality
still handles distinct records with
equal text. Optional indexes retain their owner/storage and epoch guards.
The native property cache is different: it retains only a numeric one-based
insertion-order slot, never an owner, key or storage pointer. A hint succeeds
only when it is in bounds in the current object's storage and the current
slot contains the actual requested key. Descriptor attributes/value are read
afresh. Deletion, compaction, reuse and collisions therefore cannot turn stale
hints into false hits. Missing properties and prototype chains are not cached.
Native contract 104 reserves the previous guard columns; it does not repurpose
them as GC roots. Explicit cache resets still occur at collection boundaries.

Portable Runtime also maintains derived handle-side `propertyEntries` caches.
Those do not own semantic property state and must be guarded against heap-side
mutations. Do not assume every portable object has a native hash index.

`findOwnPropertyEntryKernel`, `ownPropertyEntryDescriptor`,
`ownPropertyEntryValueCell`, `ownPropertyEntryKey` and related accessors form
the representation boundary. Arrays, functions, regexp and buffer-view
objects still retain **linked `PROPERTY` records** for named properties.
Those descriptors have their own header and next pointer; their entry IDs
are record addresses, unlike ordinary-object slots. Never pass one layout's
ID into the other's cache/storage helper.

### What `foo.bar` does

The compiler normally uses a constant-property opcode for a literal key.
The engine classifies the receiver, finds an own descriptor via its record
kind, optionally uses a guarded index/cache, then traverses prototypes if
absent. Data reads copy the value cell. Accessor reads call the getter with
the original receiver, using a continuation if needed. Numeric/length/string
and typed-view cases have specialized semantics before ordinary named lookup.
Writes additionally check descriptors, inherited restrictions, extensibility
and strictness. A shortcut must not resurrect a deleted prototype method or
treat an accessor as a raw data cell.

Storage preserves creation order independently of hashing. Enumeration
helpers exclude tombstones, account for enumerable attributes and suppress
shadowed prototype names. ES5.1 does not mandate every modern enumeration
rule; do not replace this with hash-bucket order or claim universal
modern-Node ordering compatibility.

## Arrays and arguments

An `ARRAY` holds prototype, named-property list, element-vector reference and
a reserved field used by arguments mapping. `VALUE_VECTOR` stores logical
length, capacity and inline tagged cells; capacity and logical length differ.
Absent cells are holes. Dense elements are not individually allocated objects.
Numeric explicit descriptors coexist with dense storage, so get/set/delete
must honor descriptor precedence and inherited semantics. Array length
changes and methods cannot be implemented as unconditional vector writes.

Virtual descriptor attributes have one policy in property_semantics_kernel.js.
The native/portable adapters feed ordinary descriptor decisions with the
current dense/mapped value. Materialization clears the superseded dense cell;
an own-index probe recognizes either representation. Array-length definition
is a storage adapter with descending deletion and partial-shrink rollback,
not a plain ordinary-property write. Callback conversions must revalidate
current length writability rather than restore a pre-callback value.

Arguments use mapping metadata linking selected indices to environment
slots. Strict/unmapped cases and detachment use explicit flags/sentinels.
Aliasing must survive ordinary index access, descriptor changes and deletion;
do not keep an untraced pointer into a replaced vector as the mapping.

Both descriptor queries and data redefinition consult live mapped parameters.
A non-writable redefinition snapshots that value before detaching. Enumeration
counts/fills the same index space, suppresses duplicate materialized entries,
honors their enumerability and emits numeric indices before named properties.

String-wrapper characters are immutable enumerable virtual data properties;
length is immutable/nonenumerable. Descriptor queries allocate an independent
one-code-unit result (or reuse the character table), never a parent-retaining
slice. Buffer/typed-view index adapters read/write backing storage, not shadow
named entries. Indexed-view descriptor restrictions have one leaf policy used
by Runtime, native code and guest conversion code. These extensions are not a
claim of complete modern typed-array semantics or complete ES5.1 compliance.

## Strings and interning

A `STRING` records code-unit length and cached hash. Flat strings are Latin-1
when every code unit fits a byte, otherwise UTF-16LE; unpaired surrogates are
preserved. Ropes hold left/right/depth; slices hold backing/start/length.
Length and indexing remain UTF-16 code-unit operations in every layout.
Slices normalize nested views to avoid repeated backing-chain traversal.

The portable runtime has one spelling-to-address index (`stringAddresses`)
for atoms, computed strings and program sources, plus an address-to-decoded-text
cache (`decodedStrings`). These are **not immortal roots**: collection prunes
them against marked records. Equal live indexed strings share identity while dead
atoms and their host spelling keys disappear. Heap properties/programs and
other reachable owners retain their actual string edges. The native engine
uses heap strings and hashes directly, not a host dictionary for each lookup.
Its `stringKeysEqualKernel` handles code-unit equality and
`stringKeyHashKernel`/`computeStringKeyHashKernel` own cached hashing;
`Records.findPropertyStorageEntry` provides the corresponding portable
property-lookup path. Hash equality alone is never string equality.

`internStringAddress` returns the canonical live heap address;
`internString` returns its decoded primitive text. `computedStringAddress`
uses the same index but accounts for newly allocated computed strings in the
allocation debt. There is no separate atom/transient ownership classification.
All spelling keys have a `$` prefix, keeping inherited Object prototype names
out of this dictionary's key space. The index is runtime-local, shared across
its contexts, and rebuilt after marking before freed addresses can be reused.

This is not universal interning: native concatenation, ropes and slices may
produce equal strings with distinct addresses. String equality and property
lookup must retain hash/code-unit comparison after their address fast path.
ES5.1 requires value equality, not canonical allocation identity. A native
weak atom index might help repeated dynamic property names, but universally
interning temporary strings would add hashing/probing and collector work;
it should not be introduced without workload measurements.

Program source can be a slice into an enclosing source. Snapshot finalization
also shares remaining identical/contained backings while preserving string
addresses and exact source text. It can retire unused suffix storage without
moving other records. Never delete source just because ASTs are disposable.

## Functions, lexical environments and frames

Function records contain prototype, named properties, closure, metadata,
home context and a native-function GC-link field. Bytecode-function metadata
points to a `PROGRAM`; native-function metadata identifies an intrinsic.
Guest built-ins attach a guest implementation through a closure vector.
Bound functions also use a traced closure vector, with target, bound `this`
and bound arguments defined by `NativeIntrinsics.BoundFunctionLayout`; they
are not untraceable host closures around a target handle.
Embedding callbacks additionally have JS callback metadata and registered
native-callback roots; a standalone image cannot invoke an arbitrary outer
JS callback from such a record.

`ENVIRONMENT` records hold parent, count, program/scope metadata and slots.
Register-backed bindings can avoid environments; closures, dynamic name
lookup, eval, with and arguments aliasing require environment-aware paths.
Scope/name data is part of the traced graph, including binding-name vectors.
`lexical_environment_kernel.js` implements native resolution; host metadata
is not a substitute for a missing heap edge.

A `FRAME` holds program, environment, caller, PC, return destination,
register count, handler chain, context and inline tagged registers. A handler
records target/binding/continuation scope information. The context points to
its published active frame. A native frame chain is executable state, not a
debug-only copy of the portable `Execution.frames` array.

## Program storage

A `PROGRAM` references bytecode, constants, register initialization maps,
binding/register maps, parameter slots, source and binding names, plus counts,
flags and metadata identity. A compiler descriptor is a temporary JS-facing
object; registration/adoption creates this runtime-owned record graph.

Bytecode is logically an integer-word stream with a width defined per opcode;
the storage record may pack words into 8- or 16-bit units with escape/wide
entries. An execution cache provides decoded words when required. Integer
metadata vectors use `INTEGER_VECTOR`, not 16-byte tagged cells per integer.
`CONSTANT_POOL` separates one-byte tags and four-byte low payloads; high
words for double constants occupy an additional ordered side run. It may
have a decoded execution cache. The collector traces live references in either
form, not inactive raw payloads. Sharing immutable metadata must use
copy-on-write before specialization changes it.

## RegExp, boxed primitives, Date and Error

A `REGEXP` record stores pattern/flags string references, prototype and named
properties, including observable state such as `lastIndex`. The installed
`regexp_runtime.js` supplies guest-owned parsing/matching/capture/backtracking
structures; native helpers handle supported cases. Portable Runtime still
has a transitional host RegExp cache, which is not the standalone engine's
language implementation or authoritative guest `lastIndex` state.

Primitive wrapper objects are ordinary objects with internal-value properties
and appropriate prototypes. Date and Error use ordinary-object class identity
flags plus their internal value/property data; they are not just whichever
public prototype happens to be installed. Primitive numbers in cells are not
heap-allocated `NUMBER` records per arithmetic result. Descriptor/coercion
rules must distinguish primitive values, wrappers and class identity.

## Buffers and typed views

`BUFFER_VIEW` references a `BUFFER_BACKING`, offset, length, prototype,
named properties and explicit kind. Buffer, ArrayBuffer and the eight typed
array kinds share the backing mechanism but not indexing semantics. A
subarray/slice view keeps its backing alive; a copy owns another backing.
Element count is not byte length for multi-byte kinds.

Small backing bytes are inline. On native hosts, backings at least 1 MiB
use a separately `calloc`-allocated block while retaining a logical heap
reservation for accounting/layout. GC frees the external block exactly when
its backing dies. Raw pointers are not owning roots. Native heap growth is
nonmoving; teardown still invalidates all pointers. Node emulates bytes
through the same accessor contract rather than executing libc.

Snapshot writing temporarily removes process pointers and copies backing
contents into the image representation. Bootstrap rebinds them for the new
allocation. This is why serializing a host pointer or treating a view's
address as its data pointer is incorrect.

## Engine and platform records

`ENGINE_STATE` holds current frame, exit/result/instruction fields, scratch
cells, allocator regions and bins, pointer-free property-slot hints, collector root heads,
workspace bounds and diagnostics. `PLATFORM_SERVICES` carries native service
pointers and arithmetic/FFI support. These are not public JS objects. Named
accessors and layout exports connect portable code, kernel code, collector
and snapshot bootstrap. Changing an edge or layout requires updating all
four, not just making the dispatch loop compile.
