# Runtime-owned linear heap

This document defines the mandatory guest-heap representation. It supersedes
the bootstrap's host-object record representation. The migration is staged,
but the destination contract is not optional: no guest-managed heap field may
be stored in or read from a host JavaScript object graph.

## Ownership boundary

Every `JSRuntime` owns one `Heap`, and every `Heap` owns one `LinearMemory`.
The memory is a byte-addressed allocation private to that runtime. Two runtimes
may use the same numeric offsets, but those offsets name bytes in different
allocations and must never alias.

Under `js_min.exe`, the allocation is obtained through `calloc`; byte and word
operations terminate in `peek8`, `poke8`, `peek32`, and `poke32`. Under Node.js,
`HostMemory` emulates those operations over a zero-filled host array. No guest
semantic layer is allowed to distinguish the backends except when requesting
an optional native address for external I/O.

The raw-access dependency is strictly layered:

```text
runtime / interpreter / collector / Buffer / bindings
                    |
             named Heap accessors
                    |
          LinearMemory read/write/copy
                    |
      HostMemory peek/poke or Node emulation
```

Only `host_ffi.js` contains raw MMVM `peek*`/`poke*` calls. `host_memory.js`
adapts them to allocation-relative operations. `linear_memory.js` owns bounds
checking and translation within the runtime allocation. `heap.js` owns record
headers, layout validation, and named typed field access. Consumers must not
add a field offset to a record address themselves.

## References and values

Zero is the null heap reference. Valid records begin at offset 64 and are
eight-byte aligned. During the completed migration, interpreter registers,
roots, properties, array slots, environment bindings, and pending host-call
arguments are explicit value cells in runtime-owned memory. A value cell is 16
bytes: a 32-bit tag, two 32-bit payload words, and one reserved auxiliary word.
The payload holds an unboxed IEEE-754 double, a signed integer, an immediate
Boolean/null/undefined value, or a 32-bit heap-record offset.

NaN boxing is explicitly prohibited. The tag is a physically separate word;
no floating-point bit pattern is also a tag or reference, and semantic NaN
payloads never participate in value-kind dispatch. Reference-valued cells are
validated with `Heap.recordType` before their target layout is accessed.

Undefined, null, false, true, signed int32, and double have distinct cell tags.
Numbers do not allocate heap records. Strings, objects, arrays, native
functions, bytecode functions, regexps, Buffer views, and Buffer backings use
reference-valued cells. Strings store a character count followed by UTF-16 code
units in their referenced record. The old `NUMBER` heap type is reserved during
migration and is not the destination numeric representation.

`value_cell.js` implements the first executable form of this contract. It uses
only named `Heap` field accessors and has portable Node/MMVM tests for int32,
normal and subnormal doubles, infinities, NaN, negative zero, and references.
The live interpreter has not yet switched its frames to these cells.

Conversion to a host primitive is restricted to explicit embedder
ingress/egress helpers and semantic operations that call a host service; it is
never the authoritative guest representation.

## Common record header

Every allocation starts with this 16-byte header:

| Offset | Width | Accessor | Meaning |
|---:|---:|---|---|
| 0 | 4 | `recordType` | `Heap.Types` discriminator |
| 4 | 4 | `recordSize` | aligned size including header |
| 8 | 4 | `mark` / `setMark` | collector generation |
| 12 | 4 | `flags` / `setFlags` | type-specific flags |

Payload offsets are relative to byte 16. `checkPayload` validates the record,
expected type, offset, width, and allocation boundary before any field access.

## Planned payload layouts

New fields require a named accessor and documentation update in the same
commit. Consumers must not duplicate these offsets.

### Object

| Payload offset | Field |
|---:|---|
| 0 | prototype reference |
| 4 | first property-entry reference |
| 8 | last property-entry reference |
| 12 | property count |

### Property entry

| Payload offset | Field |
|---:|---|
| 0 | interned key-string reference |
| 4 | next property-entry reference |
| 8 | attributes |
| 12 | reserved/alignment |
| 16 | 16-byte value cell |

Properties initially use an insertion-ordered linked list. A later hash index
must itself live in linear memory and remain an optimization behind the same
accessor API.

### Array

| Payload offset | Field |
|---:|---|
| 0 | prototype reference |
| 4 | first named-property reference |
| 8 | logical length |
| 12 | element-vector reference |
| 16 | element capacity |

The element vector contains 16-byte value cells. A dedicated tag or array-slot
flag represents a hole distinctly from guest undefined.

### Function

| Payload offset | Field |
|---:|---|
| 0 | object prototype reference |
| 4 | first property reference |
| 8 | function name-string reference |
| 12 | closure environment reference |
| 16 | program or native-callback registry index |
| 20 | home-context registry index |
| 24 | call-mode flags |

Program bytecode and trusted native callbacks are immutable code/embedder
registries, not guest heap state. Heap records contain only integer registry
indices. Registry entries never contain authoritative guest properties,
bindings, strings, or other guest values.

### Environment and binding

Compilation resolves lexical bindings to numeric `(environment depth, slot)`
pairs. An environment stores its parent reference, slot count, and a contiguous
vector of 16-byte value cells. Closure access therefore needs no name lookup.
Debug/name metadata belongs to immutable program metadata rather than the
semantic environment. There is no host `{bindings: ...}` object.

### Buffer

A Buffer backing record owns a byte range inside the runtime allocation. A
Buffer view stores backing reference, byte offset, visible length, prototype,
and named-property-list reference. Slices alias one backing reference. All byte
and word access goes through Buffer-specific accessors which delegate to
`LinearMemory`; guest code never receives the backing record layout.

## Allocation and collection

The initial allocator is an aligned bump allocator so layout and access can be
validated before collector migration. The completed allocator adds free-block
reuse and coalescing. Exhaustion triggers collection before reporting an
out-of-memory error.

Marking starts from reference-tagged cells in runtime globals, context globals,
explicit root slots, active interpreter registers, pending calls, and execution
frames. Type-specific tracing reads child cells and references through layout accessors.
Sweep walks record headers in address order, changes unreachable records to
`FREE`, and links/coalesces free blocks. It never consults host object identity.

## Host boundary

`retain` stores a guest value cell in a heap root-slot record and returns
an opaque host handle which is not itself a guest address. Asynchronous host
work may retain that opaque handle, but not a host representation of a guest
object. Callback ingress converts host primitives and byte sequences into heap
records. Callback egress converts only explicitly requested values.

Raw FFI pointers are trusted host pointer primitives, not guest heap
references. APIs must keep the two domains distinct.

## Migration completion check

At the end of each checkpoint, tests must remain green on Node and
`js_min.exe`. Completion requires no semantic access to `guestType`,
`.properties`, `.elements`, `.bindings`, `.closure`, `.backing`, or `.gcMark`.
Collector and Buffer lifetime tests must inspect public accessors rather than
host records.
