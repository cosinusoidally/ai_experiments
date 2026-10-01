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
