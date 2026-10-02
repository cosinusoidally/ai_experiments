# Guest heap stability investigation

## 2026-10-01: native collector argument transport

The native heap marker's signature grew from five to sixteen arguments when
explicit runtime roots were introduced. The i386 backend's host-call wrapper
silently transported only eight arguments, matching the maximum accepted by
the js_min FFI. Hosted collections consequently read uninitialised stack words
as root arguments. This also affects collections while preparing a standalone
snapshot, before its native interpreter takes over.

The backend now installs a cdecl argument-vector bridge for signatures larger
than eight words. It emits the bridge using the existing macro assembler. The
host wrapper transports one vector pointer; the bridge pushes every argument
and calls the compiled kernel. Direct native calls between kernels keep their
existing calling convention. The vector is released after each call and the
bridge mapping is released with the compiled kernel.

`guest_vm/tools/audit_snapshot_heap.js` checks a standalone snapshot's heap by
traversing its engine roots through `HeapRecords.visitReferences`, then running
the kernel marker and checking that every reachable record was marked. Run it
from this directory:

```
node guest_vm/tools/audit_snapshot_heap.js artifacts/snap
LD_LIBRARY_PATH=../../firefox-1.0.8/lib ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js artifacts/snap
```

The Node invocation uses the JS kernel backend; js_min uses compiled i386.
The tool reads the snapshot without modifying it. Free-record inspection uses
`Heap.inspectRecordHeader`; heap layout stays in the allocator/accessor layer.

On the failing demo8 bootstrap snapshot, the reference traversal found 58,434
reachable records. Before the argument bridge, the i386 marker missed 69 of
them, while the JS marker missed zero. With the bridge, both missed zero.
This isolates a calling-convention defect independently of rendering code.

Demo8 stress verification is still in progress. Passing the audit establishes
collector agreement for the snapshot graph; it does not by itself establish
that every later frame and allocation lifetime is correct.

The backend fix is committed as `77e2e89`. The Node and js_min suites pass
(12 guest programs, 266 guest assertions, plus embedding, lifetime, context,
and kernel checks). The js_min command-line checks for net.js, node_web.js,
demo1.js, demo2.js, and the three-context demo also pass.

A fresh snapshot still fails in demo8 garage mode after recovering to about
19 FPS at 320x240 with a 20 FPS limit. The marker reports a stale reference in
a value vector. The bootstrap heap audit passes on the freshly built image
(58,527 reachable records, zero missing marks on the compiled i386 graph).
The remaining defect is therefore still being investigated during subsequent
native execution. Demo8 stability is not yet established.

## 2026-10-01: allocation ownership and frame lifetimes

The subsequent investigation found a compound-allocation failure in bytecode
calls. A failed native reservation switches from an interior free region back
to the tail arena. The call builder was comparing an address calculated for
the old region against the new arena's limit, and could publish overlapping
records despite the reservation failing. It now requires a successful
reservation before publishing any call records, returns a borrowed cached
frame on failure, and does not reserve storage for a zero-byte request.

Native collection also discarded the cached-frame list without removing its
frames' allocator-protection flags. Those free records could consequently
never be reused or coalesced. Collection now explicitly releases the cached
frames before sweeping. Runtime roots, context active frames and frontend
adoption roots are maintained explicitly; native and hosted allocation no
longer retain competing free-region ownership.

Verification of this working point:

- Node and js_min test suites pass: 12 guest programs and 266 assertions,
  plus embedding, GC/lifetime, contexts, kernel and command-line checks.
- A standalone demo8 run completed its ten-minute stress limit without a
  crash, switching between garage and automatic free driving at 320x240,
  with a 20 FPS limit. Steady frame rates were generally 18–19 FPS.
- The current snapshot's JS marker audit finds 58,578 reachable records
  and zero missing marks.
- Snapshot regeneration under js_runner is byte-identical.
- Standalone Octane quick checks pass Richards, DeltaBlue, Crypto and RayTrace.

Memory residency still grows during the long demo8 run. This checkpoint fixes
the reproduced corruption, but bounded long-running memory use remains under
investigation. Existing standalone language/HTTP semantic gaps also remain;
the command-line smoke checks do not establish full HTTP request coverage.

## 2026-10-02: accurate native heap-pressure accounting

The allocator rebuild now sums occupied record sizes in its existing scan.
Previously the pressure calculation subtracted only newly reclaimed bytes
from the bump pointer, counting older free regions as live storage. There is
no additional heap traversal and no change to object layout or placement.

Both host suites pass again (12 programs, 266 assertions and the ancillary
checks). The i386 bootstrap audit reports 58,578 reachable records with zero
missing marks, and standalone snapshot regeneration remains byte-identical.
Standalone Octane quick correctness passes Splay/SplayLatency, NavierStokes
and zlib. Demos 1–7 each reached rendering in timed standalone smoke runs;
these are correctness smokes, not performance measurements.

Before the session restart, the corrected demo8 run reached five minutes
without a crash. Its RSS levelled at about 531 MiB between the third and fifth
minutes. This is still high: investigation continues into occupied storage,
reusable regions and allocator fragmentation rather than treating RSS alone
as a reachability measurement.

The heap audit tool also accepts a raw, quiescent debugger heap dump:

```
node guest_vm/tools/audit_snapshot_heap.js --heap-stats artifacts/heap.dump
LD_LIBRARY_PATH=../../firefox-1.0.8/lib ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js --heap-stats artifacts/heap.dump
```

Dump from the native heap base through the allocator's authoritative tail
bump while execution is stopped. The tool validates record boundaries using
`Heap.inspectRecordHeader` and reports occupied/free bytes, protected free
records, the largest reusable region and a breakdown by record kind. Node
inspects the file through a borrowed read-only memory view; it does not expand
the dump into its array-emulated heap. Both hosts reported identical results
for the first live dump: 130,491,400 total bytes, 28,419,664 occupied bytes,
102,071,672 free bytes and 12,560 protected free bytes. Occupied bytes include
not-yet-collected garbage; they are not a post-mark reachability measurement.
