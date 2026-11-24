# Native nonmoving free-space index

The kernel in `native_free_index_kernel.js` replaces repeated linear searches
and insertions in a sorted free-region list. It is shared by the JavaScript
and x86 kernel backends. It uses no host callbacks, allocation, threads,
moving collector or application-specific recognition. Contract 91 adds the
derived index fields to engine state.

## Ownership and representations

The authoritative record graph is unchanged. Ordinary free records have type
FREE, zero flags, an aligned size, and no live object payload. Protected free
frames/regions are not indexed. Regions smaller than the existing native
minimum remain on the retired chain for ordinary recovery/collection.

There are two views of each indexed region:

- An authoritative doubly linked ownership chain. Its forward link remains
  in the free header's mark word, preserving the existing portable handoff
  and recovery protocol. The previous link occupies dead free payload.
- A doubly linked size-bin chain, also in dead free payload. Engine state
  holds bin heads, occupancy words and a summary bitmap. These are derived
  weak allocator metadata, not GC object roots.

All offsets and class boundaries are defined once in `heap_records.js`.
Kernel and diagnostic code use named field accessors. New links fit well
inside the existing minimum native region; small/protected records never
receive them. Removing a region unlinks both chains before its bytes can be
handed to an object constructor.

Small aligned sizes through 4096 bytes have exact classes. Larger regions
use eight subdivisions per power-of-two range through the supported maximum
heap reservation. This gives 631 bins and 20 occupancy words, summarized by
one word. The metadata costs about 2.6 KiB per engine, not per object.

## Allocation

Selection uses occupancy bitmaps rather than walking all smaller holes.
Exact small classes need no within-class search. For a large request whose
size lies inside a coarse class, selection first tries the next populated
class with a sufficient lower bound. If no larger class exists, it searches
the one partial class for a fitting region. The fallback is important: class
rounding must not cause false out-of-memory while a usable span exists.

The allocator preserves its header allowance, minimum record alignment and
overflow checks. A chosen large extent supplies only the required span or a
normal small bump arena; its untouched suffix is immediately returned to the
index. Both suffix insertion and ordinary unlinking are constant-time.

The existing reserved-tail preference remains in place so late contiguous
code/buffer allocations are not prevented by small-object fragmentation.
Its full-capacity release behavior is unchanged. Neither this index nor the
preference raises the heap ceiling or commits an additional heap reservation.

## Collection and portable handoff

Native sweeping coalesces adjacent free records as before. Index rebuilding
then walks the authoritative graph once and inserts eligible records into
the ownership and bin chains. There is no reclaimed-list merge sort.

Portable ownership handoff invalidates the bin cache. On next native use,
the cache is reconstructed from the transferred region chain without allocating
workspace. Portable recovery continues to consume that chain and the retired
chain; it does not need to interpret bin metadata. Deterministic transfer
ordering remains explicit so host sorting differences cannot affect rebuilds.

Canonical snapshot handling already clears dead free payload. Bin links are
therefore not a new source of serialized stale object data. Snapshot ready
state still contains no application or environment state. A genuine rebuilt
image, not a file copy, remains subject to byte-identity checks.

## Verification and observed working point

`Records.verifyNativeFreeIndex(state)` checks ordinary-free ownership,
duplicate/cyclic links, reciprocal previous links, exact coverage between
the two views, class bounds, occupancy words and summary bits. It returns
counts for inspectors. Invalidated caches are reported as such, not mistaken
for corrupt live indexes. `--vm-verify-heap` embedding checks invoke it before
an ownership transition can discard the native view. It is not on the default
allocation/dispatch hot path.

The initial indexed image passes integration, 24-round/48-collection native
GC stress and quick Richards/DeltaBlue/RayTrace/EarleyBoyer/Splay/NavierStokes.
The structural embedding audit passes 27 audits, 102242 edges and 221 property
indices under an 8 MiB cap. Its maximum bump is 3521104 bytes. The ordinary
stock Mandreel command passes in 112.37 seconds, score 488, versus the prior
passing measurement's 844.18 seconds and score 476.

The genuine self-build finishes in 80.80 seconds and reproduces the Node-built
image byte-for-byte. Fresh controls measured 98.55 seconds before Mandreel
bring-up and 135.50 seconds with packed compiler metadata but the linear free
index. The final diagnostic additions, js_min identity and complete regression
and Octane measurements are still being checked; see
[performance recovery](PERFORMANCE_RECOVERY.md) for the final ledger.
