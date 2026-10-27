# Standalone memory work

## 2026-10-27: measured baseline and first target

Baseline source: `160e2f4`, native contract 61, using the generic image from
the current stock score report. No external benchmark or demo was modified.
The stock zlib run peaks at 263,424 KiB RSS. An independently sampled stock
run completes successfully with 56 samples, steady RSS 263,648 KiB. These
instrumented timings/scores must not replace uninstrumented stock results.

The read-only Linux parent-process sampler is optional diagnostic tooling:

```sh
node guest_vm/tools/profile_process_memory.js artifacts/snap \
  artifacts/zlib-memory octane_runner.js zlib
```

Node supplies supervision and inspection only, not guest execution or language
semantics. The child remains a standalone i386 `js_runner` process. The tool
briefly stops that child, confirms its stopped state, reads `/proc` mappings
and memory using a bounded cache, and resumes it. Authoritative heap field
accessors interpret the records; samples interrupted during record updates
are reported as unavailable, not used as valid totals. Pagemap present bits
attribute only whole interior pages, avoiding double counting shared record
boundary pages. Permissions must allow a parent to inspect its child. There
are no heap dumps, forced collections, page-discard operations or VM changes.
Inspection can fault pages and pauses execution, so use uninstrumented runs
for performance and peak-RSS comparisons.

A second quick-correctness run, with residency attribution enabled, passes
and produces 11 samples without rejected samples. A representative execution
sample reports:

- Total RSS: 263,256 KiB; heap mapping RSS: 255,976 KiB.
- Buffer backing records: 134,217,840 bytes, approximately 128 MiB. Their
  wholly interior resident pages account for 134,213,632 bytes.
- Free-record interiors: 110,608,384 resident bytes, approximately 105.5 MiB.
  Free bytes vary slightly between samples as arenas are consumed.
- Collector workspace resident pages: 36,864 bytes, not its much larger
  virtual reservation. Shrinking that reservation is not the RSS priority.
- In the stock profile, execution stabilizes around 143.2 MB of occupied
  records and 119.3 MB of free records. Occupied does not mean proven reachable;
  this sampler does not perform marking. The last collection before the large
  backing reported approximately 7.9 MB occupied, before the 128 MiB allocation.

The external benchmark requests a 128 MiB ArrayBuffer. The current native
allocator explicitly zeroes its full inline backing, making all its pages
resident. The first optimization target is therefore separately calloc-owned
bytes for large native backings. Keep the logical heap reservation to retain
existing byte accounting and snapshot layout; avoid dirtying its inline data.
Small buffers and the Node emulation remain inline. GC/destruction must free
the allocation exactly once, views retain their backing, and snapshots must
copy its contents into the canonical inline representation without relocating
the live allocation. This also avoids a new file format or C launcher changes.

Next investigate compilation allocation peaks responsible for retained free
pages. Without page discard, the remedy is avoiding those peaks or changing
their allocation ownership, not merely collecting the same memory again.
Do not lower heap caps blindly or force repeated collections. No `madvise`
work is in scope. Function source and working function `toString()` must be
preserved; source removal is not an accepted memory optimization.

## 2026-10-27: large native backings implemented

Native contract 62 uses directly called libc calloc for native Buffer and
ArrayBuffer backings of at least 1 MiB. The existing logical reservation is
kept, but its inline data is not initialized. This reduces physical residency,
not the configured virtual heap reservation. The shared sweeper, embedding
collector and runtime destruction release owned data. Snapshot copies convert
external backings back to canonical inline bytes without relocating live FFI
pointers. Node retains its inline emulation. No C or demo source changed.
See [the interpreter design](guest_vm/NATIVE_INTERPRETER_DESIGN.md) for ownership,
accounting and snapshot details.

The full stock zlib run passes with peak RSS **133,888 KiB**, down from
**263,424 KiB**, approximately **49% lower** (126.5 MiB saved). It reports
score **501**, wall **305.42 s**, user **303.95 s**. The earlier stock run
scored 560 in 273.53 s, so this is not presented as a speedup. A subsequent
same-session serial quick-correctness control measures the original image at
48.10 s (47.32 s user, 263,168 KiB RSS) and the new image at 46.91 s
(46.48 s user, 132,992 KiB RSS). Both pass; this pair shows no slowdown in
that workload, but is not a statistical stock-score comparison.

Working-point validation:

- Node and js_min project suites pass all 270 guest assertions and existing
  embedding/compiler/context checks. The expanded existing context check
  covers a large odd-length backing, two saved contexts, restoration after
  mutation/collection, canonical inline bytes/padding/flags/pointers, and
  preservation of the live pointer.
- The bounded native GC workload passes. Its instrumented driver reports
  75 collections, 27 audits and 72,575 checked edges within the 8 MiB guest
  cap (maximum observed bump 4,515,712 bytes). The workload now retains small
  views of replaced large backings. Further final regression checks are
  recorded below as they complete.
- The full three-host snapshot harness passes in 294.24 s: differing
  environments/program arguments, Node/js_min image equality, alternate
  application execution, live launch environment and genuine self-hosted
  recompilation producing a byte-identical image. No input-image copying.
- Standalone language integration passes, including function-source comment
  retention. Function source has not been removed.

The next measured target is compiler working storage: samples during register
packing and verification contain roughly 10--25 MiB of general value-vector
records, and earlier optimization samples contain about 12 MiB of packed
property storage. These are aggregate records present at those samples, not
proof that the currently executing function owns all of them. Spare vector
and property capacity totals only about 4 MiB at those points. Prioritize
numeric/control-flow working representations and overlapping lifetimes over
blanket growth-factor changes or dropping retained source. The remaining
resident free pages cannot be eliminated merely by another mark/sweep pass.

The final workload alternates large Buffer slices and typed-array subarrays.
This exposed a pre-existing pending-host-call synchronization error: a call
that had yielded to the embedder had not produced its result yet, but the
fallback synchronizer spilled a stale host-side destination handle. Additional
collections made that old handle refer to a freed view. Pending calls now
leave the destination authoritative in the heap until `completeHostCall`
publishes the result, just as scheduled bytecode callees already did.
The mixed workload's instrumented audit then passes with 75 collections,
27 audits, 72,746 checked edges and maximum bump 4,516,168 bytes within the
8 MiB cap. The Node project suite also passes after the boundary correction.
This is an embedding boundary correction, not a new host language-service
dependency or a workaround recognizing a benchmark.

Both native inline and external backings already carry the authoritative
native data pointer. Embedding byte/word access now uses that pointer for
both, rather than testing ownership flags on every access and then validating
the record again for the inline case. Record type/lifetime and byte bounds
checks remain in place. Node uses its original logical heap addressing.
Ownership flags remain a GC/serialization concern. Both project suites pass
after this access-path simplification; standalone kernel code is unchanged.

Context snapshot ownership discovery is now done once at creation and retained
with the snapshot. Restore visits only that captured list; snapshots without
external backings do no discovery work. Backing addresses and lengths remain
stable while the snapshot roots own them. Destruction releases the captured
metadata along with the private byte copy. This avoids adding a retained-record
scan to every context restore. The Node project suite and native embedding
context/snapshot integration pass after this change.

## Final validation, 2026-10-27 approximately 18:10 UTC

Source checkpoint: `c918b07`. The canonical `artifacts/snap` is now the
validated final image. Its independently generated Node, js_min and genuine
self-hosted outputs compare byte-for-byte. Size: **5,978,640 bytes**, normal
non-sparse output (11,680 allocated 512-byte blocks), SHA-256
`e2e9e67f935bc01be78c456019f88e0c59bf34266c084fc80f6b66f48415e442`.
Final js_min build: 95.41 s; self-hosted build: 96.98 s. These are single-run
measurements. The earlier full environment/program-independence harness also
passed; the final three builds really recompile, rather than copying an image.

- The final image's 395,812 native interpreter code bytes are identical to
  the image used for the stock zlib measurement above. Later follow-ups affect
  embedding access and context-snapshot bookkeeping, not that native kernel.
- All ten previously working Octane suites pass quick correctness with the
  final image. Final zlib quick: **44.85 s**, user 44.69 s, peak RSS
  **132,480 KiB**. This is a quick result, not a new stock score. Earlier
  follow-up stock runs also pass Box2D (305, 19.02 s) and Gameboy
  (1059, 15.18 s). The four unresolved suites were not retested in this memory
  follow-up; no claim that they are fixed. RegExp remains excluded.
- Node and js_min project suites pass 270 guest assertions after the native
  access simplification. The final snapshot-metadata refinement additionally
  passes the Node suite and the native context/snapshot integration check.
- Final standalone GC stress: 24 rounds, 47 automatic native collections.
  The final instrumented embedding run passes 75 collections, 27 structural
  audits, 72,746 checked edges and 221 property-index audits, with maximum
  bump 4,516,168 bytes under the 8 MiB cap; workload/check phase 32,682 ms.
  Large Buffer slices and typed-array subarrays are both exercised.
- The independent deployed-image heap audit finds 29,220 reachable records and
  zero missing marks. The selected standalone JSON integration passes all
  12 files and 908 assertions. Source-retention and large-copy integration
  pass, including the function's original comment in `toString()`.
- All demos 1--8 are rerun with the final image in live X11 windows at
  320x240, 20 FPS limit. Demos 1--7 run about five seconds after window
  creation and exit cleanly; demo8 additionally exercises garage and
  auto-drive, with both screenshots inspected and a clean menu exit. These
  are bounded smoke checks plus the separate GC stress test, not exhaustive
  interaction/long-duration or sustained-20-FPS certification.
- Both net.js and node_web.js pass final-image loopback text and byte-identical
  binary serving, directory listing and default-index checks. No demo or
  external test files were changed; fixtures/logs/images remain ignored temp
  artifacts. No background test/server processes remain after validation.
- Full Test262 authored-program counts remain **3,139 pass, 153 fail, zero
  not run, six timeouts included in failures**. Failing IDs/variants compare
  identically across all three fresh memory-work runs. Timings progress from
  486.95 s to 454.49 s to **428.99 s** after access/restore refinements; the
  historical comparison is 415.93/423.15 s, not a new controlled baseline.
  Final hosted-suite peak RSS is **319,592 KiB**, higher than the preceding
  281,080 KiB run. The standalone zlib saving is therefore not evidence of a
  universal RSS reduction, and hosted peak variation remains to be profiled.
  Full run history is in [TEST262_STATUS.md](TEST262_STATUS.md).

Recommended next work is still compiler working-set reduction, beginning
with compact control-flow bitsets and integer register/liveness scratch
tables, then reducing overlapping compilation/adoption representations.
Measure allocation ownership before assigning the entire sampled vector total
to scratch storage. Preserve source spans, source positions and function
`toString()`. Reprofile both peak and steady RSS, and separately investigate
the hosted Test262 peak, before claiming broader gains. Do not substitute
smaller heap caps, repeated collection, snapshots of application parsing or
page-discard operations for reducing the actual working set.
