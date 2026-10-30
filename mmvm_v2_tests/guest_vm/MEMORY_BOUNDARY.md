# Scalar and bulk memory boundaries

The guest heap remains independent of the JavaScript engine running the VM.
Record consumers use named `HeapRecords`/`ValueCells` accessors. `Heap` owns
record validation and translates fields to offsets; `LinearMemory` owns range
checks and the translation from offsets to storage operations. Compiler code
and record consumers do not use raw native pointers.

## Storage selection and lifetime

`LinearMemory` selects native scalar methods once when its allocation is
created. These shared functions read the instance's current allocation
pointer rather than capturing a derived address or owning another allocation.
Checked operations retain `checkRange`, including the destroyed-memory check.
Trusted operations still require the caller to establish lifetime and bounds.
The paged Node representation continues through `HostMemory`, without an FFI,
native addon or dense allocation for the complete guest heap.

Byte and word operations are little-endian. The native target is i386,
including unaligned word access. Word stores convert once to the signed low
32 bits on both backends. This avoids old-shell saturation of unsigned Numbers
passed to `poke32`. Negative fractions must be truncated before wrapping,
not wrapped by floating remainder before truncation.

## Word-array ingress

`LinearMemory.writeWords32LE(address, words)` validates the integer source
length and complete destination span once. The ordinary backend reads indices
in increasing order, converts each value with ToInt32 and stores its low bits.
Getters, conversions and exceptions retain that order; a thrown conversion
may leave the previously written prefix, just as successive scalar stores do.

Native storage can request the private raw-FFI primitive
`__guestVMTryCopyInt32Array(signedPointer, array)`. This is optional storage
acceleration, not an ECMAScript API or a compiler-specific intrinsic. It is
installed only with raw FFI. The portable implementation can return false;
the ordinary ordered-store fallback remains authoritative.

`memory_transfer_kernel.js` implements this operation in the kernel dialect,
using the same frontend/middle end and JS/x86 backends as the interpreter.
It needs no C helper, handwritten machine code, thread, source recognition
or benchmark-specific behavior.

The kernel accepts only ordinary arrays without explicit property storage
or arguments/exotic state, with a nonnegative length within dense-vector
capacity and an int32 value cell at every index. The entire source is
validated before the first store. Holes, descriptors, non-int32 values and
unsupported inputs return false without invoking guest accessors or writing
the destination. The caller then performs normal reads and conversions.
Consequently inherited indexed getters, user conversions and exceptions
are not accidentally suppressed by this optional path.

The destination must be independently owned native storage, disjoint from
the source array. `HostMemory` meets this condition with separately allocated
backing stores. Like raw `poke32`, this primitive is not a capability-safe
API for arbitrary pointers. It performs no allocation, collection, guest
callback or yield during validation/copying, and retains no pointers afterward.
The result is written after argument reads, preserving legal register reuse.

## Record consumers and snapshots

Wide bytecode and validated integer-vector construction use bulk ingress
instead of repeating scalar abstraction crossings. Compact bytecode, record
layouts, metadata interning, function source retention and snapshot inspection
remain unchanged. Program maps still validate signed integer values. This
is an execution-time memory operation, not a parsed-source/compilation cache.

The executable contract is bumped for the new intrinsic ID. Node, js_min and
genuine self-hosted builds must still produce identical snapshots. Native
pointers used by these operations are not serialized.
