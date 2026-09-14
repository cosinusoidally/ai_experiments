# Authoritative heap and dual-backend compiler design

## Contract

Every guest value owned by a `JSRuntime` has one authoritative representation
in that runtime's linear heap. A host JavaScript object may be used as an opaque
handle or a validated cache, but it must not contain guest state that cannot be
reconstructed from the heap. Object identity, type, prototype, properties,
indexed elements, lexical slots, closure links, frame registers, program
counters, and Buffer-view metadata belong to heap records.

Parsed ASTs, immutable compiler analysis, host callbacks, generated-code entry
addresses, libc symbols, operating-system requests, and address-to-handle caches
may remain in runtime-owned side tables. These are implementation metadata, not
guest state. Side-table entries use integer identifiers stored in heap records.

## Values and record access

Values are explicit 16-byte cells. NaN boxing is not used.

| Word | Meaning |
| --- | --- |
| 0 | tag: undefined, null, boolean, int32, double, or reference |
| 1 | int32, reference, or low binary64 word |
| 2 | high binary64 word |
| 3 | reserved auxiliary word |

References are unsigned 32-bit offsets into the owning runtime heap. Zero is a
null internal link and is never a guest reference. References cannot cross
runtime boundaries.

`value_cell.js` is the value-encoding boundary. `heap_records.js` is the
record-layout boundary. Interpreter, collector, built-ins, embedders, and
generated code use named accessors or compiler IR operations derived from
those accessors; they do not embed field offsets independently.

All records have the common 16-byte header from `heap.js`: type, total size,
mark generation, and flags. Current payloads are:

| Record | Payload |
| --- | --- |
| String | UTF-16 length, stable hash, UTF-16 code units |
| Object | prototype reference, property-list head, extensibility flags |
| Property | next reference, string-key reference, attributes, value cell |
| Value vector | logical length, capacity, consecutive value cells |
| Array | prototype, named-property head, value-vector reference |
| Environment | parent environment, slot count, consecutive value cells |
| Function | prototype, named-property head, closure, metadata identifier |
| Frame | program, environment, caller, PC, return slot, register count, cells |

Buffer views/backing stores, regexp records, bytecode, program descriptors,
contexts, and roots use the same rules as their live representations migrate.

## Handles and caches

Public embedder values become address-only handles containing `ownerRuntime`
and `heapAddress`. The runtime may canonicalize handles by address so host
identity comparisons remain cheap. A final handle exposes no mutable guest
properties, elements, prototype, or closure fields.

The JavaScript backend may maintain guarded property or element caches. A cache
entry contains a heap address, version/shape guard, and decoded value. Every
write updates the heap first and then updates or invalidates the cache. Cache
misses decode from the heap. GC scans heap records and never cache contents.
The x86 backend uses the same guards and side-exits on misses.

String interning is a weak canonicalization table, not a root set. A live
property key, program atom, value, or snapshot marks its string record through
the ordinary heap graph. After marking, the runtime rebuilds its address and
decoded-string caches from live entries before dead records are swept. This
both preserves address comparisons for live property atoms and permits a
long-lived runtime to discard strings belonging only to destroyed contexts.

The default heap reserves a stable maximum address range but initially exposes
only a smaller logical allocation limit. Native allocation stops at the
collection-pressure boundary and publishes its frame so automatic collection
can run first. The logical limit grows only when collection and reusable free
regions cannot satisfy an allocation, or after collection establishes that at
least two thirds of the current logical heap is genuinely live. It also grows
after collection when the contiguous tail is exhausted: cycling thousands of
small reusable blocks can otherwise make a native allocation-region workload
collect repeatedly despite a low total live-byte count. These adaptive cases
give a persistent renderer working set useful headroom without making reserved
address space permission to grow before attempting reclamation.

Reclaimed records of at least 272 bytes are handed to the compiled interpreter
as a size-ordered guest-heap list. The interpreter changes regions in native
code; exhausting a region does not yield to the host. A suffix that cannot
satisfy the current allocation moves to a separate retired list so later
compound allocations do not repeatedly scan known-small fragments. Both lists
remain ordinary `FREE` records linked through their otherwise-unused mark
field. They are returned directly to the host allocator index before a
collection. A semantic fallback may execute while the lists remain native-owned
because the host allocator can see only its disjoint tail and retained small
blocks. This avoids rebuilding allocator indexes for formatting or I/O calls
while preserving one authoritative heap and non-overlapping allocation ranges.

## Shared compiler pipeline

There is one semantic compiler pipeline and two execution backends:

```text
kernel-dialect JavaScript
        |
        v
kernel tokenizer/parser and validation
        |
        v
typed control-flow IR
        |
        v
range/type/alias analysis and lowering
        |
        +-----------------------+
        |                       |
        v                       v
JavaScript backend          i386 backend
(Node and reference)        (js_min/MMVM)
        |                       |
        v                       v
callable JS function        macro assembler -> executable memory
```

The front and middle end decide semantics, control flow, integer widths,
signedness, heap layouts, guards, safepoints, and side exits. Backends only
select concrete instructions and calling conventions. A handwritten x86
algorithm differing from the JavaScript backend is forbidden.

Initial IR operations cover signed/unsigned 32-bit arithmetic, comparisons,
branches, checked heap loads/stores by named field, value-cell tag and payload
operations, frame-register/environment-slot access, budget handling,
safepoints, side exits, and an explicitly enumerated libc/platform ABI.

The JavaScript backend lowers heap operations to the accessor contract. On
Node it may specialize emulated memory to its byte array after guarding the
allocation kind. The i386 backend lowers the same operations to aligned loads
and stores relative to the runtime heap base. Both execute identical IR tests
and must produce identical output heap snapshots.

## Native entry and side exits

The first MMVM ABI remains compatible with the existing eight-argument cdecl
`ffi_call` entry:

```text
engine(runtimeState, frame, bytecode, constants, budget, 0, 0, 0)
```

Native execution never calls a JavaScript callback. It performs a kernel
operation, calls an approved C ABI service, or writes a side-exit record and
returns an exit reason. Side exits cover unsupported bytecode, host calls,
exceptions requiring a slow semantic path during migration, budget expiry,
and GC safepoints.

Executable bytes must be emitted by the checked-in JavaScript macro assembler.
Raw machine-code arrays in source are prohibited.

## Collection

The collector traces record layouts, not host objects. Value-cell reference
tags are the general guest edges. Program metadata supplies stack maps for
compiled frames; the interpreter may conservatively scan every frame cell
until liveness maps exist. Generated code and metadata remain live through
marked function/program records and are released during sweep.

Host asynchronous operations retain integer root handles. Completion removes
the root after placing the result in the suspended frame. Native Buffer memory
is released only after no marked Buffer-view record refers to its backing.

## Migration and regression gates

The migration proceeds in working checkpoints:

1. Freeze and test layouts and embedded value cells.
2. Add shared kernel IR plus JavaScript/i386 backend equivalence tests.
3. Move strings/atoms and property keys to heap records.
4. Move ordinary objects/properties and arrays; retain guarded JS caches.
5. Move environments, frames, registers, contexts, functions, and programs.
6. Move Buffer metadata, regexps, roots, and collector tracing.
7. Switch GC authority from transitional host records to heap traversal.
8. Compile measured interpreter/accessor kernels through the shared pipeline.
9. Remove transitional guest fields and assert that handles contain none.

Every checkpoint must pass the complete Node and MMVM suites, backend heap-
snapshot equivalence, stress GC, unchanged demo smoke tests, and established
demo performance baselines at identical settings. If a representation flip
slows either host, it stays behind a runtime option until a shared-IR
optimization restores the baseline. Demo-specific semantic shortcuts are not
acceptable.

## Embedder-facing stability

`JSRuntime`, `JSContext`, `Execution`, retain/release handles, instruction
budgets, and host-call yields remain public. Embedders must treat guest values
as opaque. Inspecting transitional `guestType`, `properties`, `elements`, or
closure fields is unsupported.

Node and MMVM use the same bytecode, heap image, layouts, GC rules, host-call
request format, and compiler IR. Their only intended difference is the final
execution/platform backend.
