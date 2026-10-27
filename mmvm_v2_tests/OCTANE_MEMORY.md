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
