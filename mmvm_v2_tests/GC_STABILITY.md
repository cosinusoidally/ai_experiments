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

## 2026-10-02: reusable arena suffixes and native pause diagnostics

Useful remainders of abandoned native allocation arenas now return directly
to the allocator's reusable-region list. Previously those remainders were
parked until the next full collection even when subsequent smaller requests
could use them. Smaller suffixes retain the existing retirement policy. All
ownership changes still publish a complete free record before reuse.

The isolated standalone demo8 verification ran for ten minutes, including
garage and automatic free driving, then exited normally through the menu.
Garage was generally 18–19 FPS at 320x240 with a 20 FPS limit; automatic
driving was generally 18–19 FPS, with some five-second samples near 17 FPS.
RSS readings settled around 480–483 MiB during the final several minutes.
No second benchmark, VM build or test-suite workload ran concurrently.
This establishes that the reproduced corruption is fixed in this run; it is
not proof that every long-running workload has bounded memory consumption.

Native GC now keeps named engine-state diagnostics for the last mark, sweep
and allocator-index phases, total collector time, maximum observed pause and
post-collection occupied bytes. They use microseconds from the existing libc
gettimeofday service, without allocating guest objects or entering the host
VM. Mark time includes root/cache preparation; the timings exclude resumed
guest execution. Clock discontinuities are clamped for diagnostics only and
do not affect collection policy. `--vm-profile` reports these counters;
`--heap-stats` reports them for a sufficiently recent quiescent heap dump.
Snapshot serialization clears these process-specific counters temporarily,
then restores them, so timings cannot leak into the deterministic image.

The marker failure path no longer dereferences its rejected diagnostic target.
That word may be an invalid address or, for a malformed record, a size. A
controlled collector failure must not cause a second invalid read or retry.

Both host suites pass again: 12 guest programs, 266 assertions and all
ancillary checks. The updated standalone snapshot runs hello.js and reproduces
itself byte-for-byte. The JS kernel audit finds 58,832 reachable records and
zero missing marks. The reported long-pause issue remains under measurement;
the native counters distinguish collector work from other frame-time stalls.

## 2026-10-02: hosted collector preparation

The hosted native demo8 profile completed a 90-second execution sample,
including garage mode, without a crash. Reported mark/sweep work ranged from
about 93 to 130 ms. Those old totals excluded allocator preparation, so they
must not be presented as complete pause measurements. Host wrapper/metadata
maintenance accounted for roughly 55–60 ms of that work.

Collection now discards derived native allocator indexes and rebuilds them
only after sweeping. Previously releasing allocation arenas and cached frames
each rebuilt an index which the sweep immediately replaced. Normal ownership
transitions outside collection still rebuild immediately. Free-list mark-word
links are cleared before weak-cache filtering, and no guest allocations occur
while the index is deferred.

Both host suites pass again, and a second 90-second hosted demo8 profile
completed without a crash. The profile now includes preparation and total
pause time. Later samples measured 63–72 ms of preparation and total pauses
of 175–222 ms. This reveals another real bottleneck: traversing retired native
arena links through host accessors. Moving that bulk operation into kernel
code is the next pause-reduction step; the pause issue is not declared fixed.

The updated standalone snapshot also passes Octane quick correctness for
Richards, DeltaBlue, Crypto, RayTrace, Splay/SplayLatency, NavierStokes and zlib.

## 2026-10-02: kernel-owned free-link cleanup

Free-region and retired-fragment link cleanup now runs in a shared kernel
function instead of crossing the accessor layers once per fragment. Header
offsets and alignment come from the allocator's named ABI exports. The same
front end compiles the operation to JS for Node and native i386 for js_min.
It checks reference bounds, alignment and FREE record type before reading a
link, and reports an invalid chain rather than dereferencing arbitrary memory.

The repeated isolated 90-second hosted demo8 profile completed without a
crash. Preparation measured 1–2 ms instead of the earlier 63–72 ms. Later
garage collection totals were 119–147 ms, versus 175–222 ms in the preceding
sample; the scenes were comparable but allocation histories are not identical.
Steady garage samples were approximately 20 FPS. Both regression suites pass
again (12 programs, 266 assertions and ancillary checks).

The reproduced heap-corruption crashes are fixed in the recorded stress
runs. Collector pauses have improved, but are still above a 50 ms frame
budget. Remaining measured costs include mark/sweep/index traversal and
host-side weak wrapper/metadata maintenance. No claim is made here that the
collector has become incremental or that host compatibility bookkeeping has
been fully eliminated. Tests and profiles run sequentially to bound memory
pressure; generated images, logs and debugger dumps remain ignored artifacts.

Final checks on the current working point:

- A newly generated standalone snapshot runs hello.js and regenerates an
  identical file under js_runner (`cmp` exits successfully).
- The compiled i386 heap audit finds 58,898 reachable records and zero
  missing marks.
- A three-minute standalone demo8 attract/garage smoke reaches rendering
  without a crash before its explicit timeout. This is additional coverage,
  not a replacement for the earlier ten-minute garage/automatic-driving run.
- Both net.js and node_web.js serve text, binary and directory-listing
  requests under `js_min guest_runner.js --vm-native`. Text and binary bodies
  compare byte-for-byte with the source files; all requests return HTTP 200.
  This verifies the hosted guest paths, not the outstanding standalone HTTP
  intrinsic gaps described earlier.
- Temporary servers and test workloads are stopped after verification.

## 2026-10-02: demo1 standalone input exits

Reproduced the reported demo1 failure using the existing `artifacts/snap`.
The window rendered until input arrived; the reproduced failures were native
unsupported-call exits (status 70), not segmentation faults or freed-record
errors:

- Keyboard input with the default debug logging called `Number.toString(16)`.
  The native number-to-string implementation accepted only decimal output.
  Its diagnostic was `CALL` at bytecode PC 37, detail 1083 (intrinsic 83).
- After enabling radix conversion, mouse input reached `Buffer.readInt16LE`
  while decoding X11 pointer coordinates. That method had no native intrinsic
  ID and therefore attempted an unavailable embedding callback. The diagnostic
  was `CALL` at bytecode PC 4, detail 20 (unrecognized intrinsic).

The compiled guest kernel now formats signed 32-bit integers in bases 2–36,
including exact integer-valued doubles and the minimum signed integer. The
formatter writes and hashes a UTF-16 string on the guest heap; it does not call
the host VM. Fractional/out-of-range number formatting and nonnumeric radix
coercions remain semantic fallbacks; this is not a claim of complete native
Number.prototype.toString support. Buffer.readInt16LE now shares the existing
native buffer bounds/backing-store access path and sign-extends its two bytes.
The new intrinsic ID is defined in native_intrinsics.js and supplied to the
kernel as a shared compile-time constant.

A regenerated standalone snapshot successfully processes typed characters,
button-1 press/release and pointer dragging, then closes normally on Escape
(exit 0). The existing dual-host suite passes on Node and js_min: 12 guest
programs and 269 assertions on each host, plus embedding, lifetime, automatic
GC, context, kernel and CLI checks. Existing buffer coverage already exercises
signed 16-bit reads; the standard-library coverage additionally checks zero,
base-36 digits and the signed integer boundary. No demo or C source changed.

At 320x240 the standalone demo1 rendering observed during this reproduction
is only about 1 FPS. This input-correctness fix does not claim to resolve that
separate performance limitation or to constitute a new long-duration GC audit.

Final snapshot verification also passes a short demo8 attract/garage/automatic
free-driving smoke at 320x240, including a clean menu quit. Automatic driving
reports approximately 17–19 FPS after switching modes; the short run is not a
sustained-performance or long-duration stability claim. Running guest_runner.js
under the new snapshot regenerates a bit-identical snapshot and runs hello.js.
The temporary artifacts/snap is replaced with the verified image; its previous
contents are retained as artifacts/snap.before-demo1-fix. Generated snapshots,
executables and test logs are not checked in.

## 2026-10-03: longer demo runs and optional forced collection

Added the opt-in `--vm-gc-stress` runner option, documented in guest_vm/README.md.
The native engine requests collection at every one million opcode boundaries;
the normal pressure policy remains unchanged when the option is absent.
The forced safepoint uses the normal frame publication and native collector.
It publishes the current tail bump even when no failed allocation has done so,
and internal collections now preserve the caller's remaining instruction
budget and total executed-instruction count. The engine state uses named
accessors and shared layout/default constants. No demo or C source changed.

Longer-run log (sequential workloads, 320x240, 20 FPS limit):

- demo1, approximately 3 minutes 8 seconds under js_runner with GC stress:
  typing and two button-1 drags, then Escape; exit 0, 1,486 native collections.
  Sampled RSS increased from about 68 MiB near startup to 240 MiB near the end.
  Rendering under stress was roughly 0.6–0.9 FPS. This is a crash/lifetime test,
  not a performance result or evidence that memory use has reached a plateau.
  Log: ignored artifacts/stability-demo1-stress.log.

Further demo runs and regression results are recorded below as they complete.

- demo2, 3m26s monitored: keyboard and two button-1 drags, Escape, exit 0;
  2,058 native collections; maximum sampled RSS 283 MiB.
- demo3, 3m24s: continuously animated full-frame blits plus input, Escape,
  exit 0; 1,538 native collections; maximum sampled RSS 304 MiB.
- demo4, 3m24s: continuously animated lighting/normal-mapped full-frame blits
  plus input, Escape, exit 0; 1,509 collections; sampled RSS 343 MiB.
- demo5, 3m25s: textured 3D rendering, keyboard and two drags, Escape,
  exit 0; 1,564 collections; sampled RSS 255 MiB.
- demo6, 3m09s: attract mode, Space and held-forward driving input, Escape,
  exit 0; 1,400 collections; sampled RSS 223 MiB.
- demo7, 3m09s: attract mode, Space and held-forward driving input, Escape,
  exit 0; 1,044 collections; sampled RSS 247 MiB.

These runs total 10,599 native collections with no fatal VM exits or signals.
Durations for demos2–7 are measured by the monitor (demo2 was already running
when monitoring began). RSS is sampled, not an exact process high-water mark.
Each process is stopped before starting the next. Logs are ignored artifacts
named stability-demoN-stress.log. They are finite stress runs, not proof that
every collector bug is absent or that RSS remains bounded indefinitely.

The dual-host regression suite also passes after adding stress mode: 12 guest
programs and 269 assertions per host, plus the embedding/lifetime/context/GC,
kernel and command-line checks. Standalone snapshot regeneration with the
stress flag produces a bit-identical image (the flag is applied after writing).

- demo8, approximately 10 minutes under standalone GC stress at 320x240,
  20 FPS limit: attract mode, garage with two mouse drags, autodrive,
  manual free driving with simultaneous acceleration/turning and then
  braking/turning, back to garage and autodrive. Exit 0 using Escape, q;
  no fatal VM error or signal. Rendering generally reported 13–16 FPS,
  reaching about 20 FPS when stationary. Last sampled RSS was 520 MiB.
  The q path invokes process exit, so it bypasses the final collection-count
  message; no collection total is claimed for this run. Log:
  ignored artifacts/stability-demo8-stress.log.

The X11 input driver now accepts simultaneous held keys, for example
`--hold w+a:8000` and `--hold s+a:8000`. This was exercised under both Node
and js_min with node_runner.js. It does not change any demo source.
Continued RSS growth in the stress runs remains an open investigation;
these results must not be interpreted as proving bounded memory use.
