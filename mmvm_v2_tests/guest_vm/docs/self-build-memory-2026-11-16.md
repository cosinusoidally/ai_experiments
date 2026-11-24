# Default snapshot-build and executable-packaging memory

## Settings and scope

Fresh measurements at source `b9ea1bd`, native contract 109. These measure
building the guest VM itself, not the mishmashvm bootstrap. No VM code was
changed for the measurement.

- Default guest settings: initial logical heap 64 MiB, maximum 512 MiB;
  no `--vm-max-heap-mib` override on either the running VM or target builder.
- Normal kernel optimization; no `-O0`, debug sidecar, optional backing-sharing
  pass or snapshot-cache loading option.
- Node v24.14.1, x64, with ordinary JIT settings or `--jitless`. That flag
  changes the Node host, not the target kernel optimization setting.
- Linux and Windows standalone executables are i386 and embed the same
  default seed snapshot. Genuine self-builds reload sources, lower/assemble
  the kernel and construct/serialize a new runtime; they do not copy the seed.
- Every job ran serially in a new process. These are individual observations,
  not repeated averages or deliberately cold-filesystem-cache measurements.
- GNU `/usr/bin/time -v` provides maximum RSS (its Linux kbytes are KiB).
  Windows results are Wine-run RSS, not a native Windows peak working set or
  the sum of all Wine-prefix processes. The provided 32-bit prefix was used.

## Snapshot construction

| Build host | Elapsed seconds | Peak RSS, KiB | Peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Guest VM, Linux, self-hosted | 81.06 | 483964 | 472.62 |
| Guest VM, Windows under Wine, self-hosted | 84.11 | 484268 | 472.92 |
| Node, JIT enabled | 5.24 | 266584 | 260.34 |
| Node, `--jitless` | 17.27 | 226604 | 221.29 |

The observed Windows/Linux difference is only **304 KiB (0.30 MiB, about
0.06%)**. This pair does not establish a meaningful platform-dependent memory
difference. Node jitless uses about 39.0 MiB less RSS than ordinary Node in
these runs. Both Node modes use substantially less memory than the guest
self-build, but all figures include host/runtime overhead, not just live
guest objects.

The initialized snapshot heap is 6,891,128 bytes, its native kernel is 699,048
bytes and the complete file is 7,595,640 bytes. Its default per-runtime
reservation is 640 MiB (512 MiB heap plus 128 MiB collector workspace), not
640 MiB eagerly resident. A self-hosted build also constructs a target runtime:
the measured process peak is not the initialized image size or the reservation
of just one runtime.

## `snapshot_to_exe.js` packaging, measured separately

All conversions consume the same seed snapshot. ELF and PE output were each
measured under all four hosts. Peak RSS is for the whole fresh process,
including its runtime startup/source loading, not incremental allocations
attributable only to the copying loop.

| Packaging host | ELF seconds | ELF peak KiB (MiB) | PE seconds | PE peak KiB (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Node, JIT enabled | 0.11 | 54656 (53.38) | 0.19 | 59060 (57.68) |
| Node, `--jitless` | 0.11 | 45564 (44.50) | 0.17 | 48572 (47.43) |
| Guest VM, Linux | 4.45 | 76544 (74.75) | 4.77 | 87424 (85.38) |
| Guest VM, Windows under Wine | 5.83 | 81064 (79.16) | 5.01 | 91636 (89.49) |

Subsecond process-time differences should not be interpreted as stable
performance rankings from one observation. There are no compiler/binutils
invocations or new native support code in the packager.

## Correctness and identity

All five snapshots (initial Node seed plus the four measured builds) are
byte-identical, SHA-256:

`9c79d33d589a16b297b5b389ce9d1d3ee2dc67450589e2cc328cee7776fd2c42`

All four measured ELF outputs match the initial Linux executable, SHA-256:

`f969d8183ccb3c92ce8636b2e956eada73338c671e8e143409150c9f4d33f1bf`

All four measured PE outputs match the initial Windows executable, SHA-256:

`3222fb8bb907f4c04d6e25d57aca0253ab47b27f17314a81d4b85906b11c5a3c`

The Linux-guest-generated ELF and Windows-guest-generated PE also run hello
successfully. The snapshot input was not modified. This is focused build and
packaging acceptance, not another full ECMA/Test262/Octane/demo sweep.

## Reproduction

From `mmvm_v2_tests`, use a new output directory: packager destinations must
not already exist.

```sh
mkdir artifacts/self-build-default
node guest_runner.js --vm-native --snapshot artifacts/self-build-default/seed.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/self-build-default/seed.snap artifacts/self-build-default/linux.exe
node guest_vm/tools/snapshot_to_exe.js artifacts/self-build-default/seed.snap artifacts/self-build-default/windows.exe --win32

/usr/bin/time -v ./artifacts/self-build-default/linux.exe guest_runner.js --vm-native --snapshot artifacts/self-build-default/linux.snap
. ../../wine/32.sh
/usr/bin/time -v wine artifacts/self-build-default/windows.exe guest_runner.js --vm-native --snapshot artifacts/self-build-default/windows.snap
/usr/bin/time -v node guest_runner.js --vm-native --snapshot artifacts/self-build-default/node-jit.snap
/usr/bin/time -v node --jitless guest_runner.js --vm-native --snapshot artifacts/self-build-default/node-jitless.snap
```

Time each packager invocation independently, selecting one of these hosts:
`node`, `node --jitless`, `./artifacts/self-build-default/linux.exe`, or
`wine artifacts/self-build-default/windows.exe`. Its arguments are
`guest_vm/tools/snapshot_to_exe.js INPUT.snap NEW_OUTPUT.exe`; append `--win32`
for PE output. Do not run these measurements concurrently.

Raw logs, snapshot files and executable outputs are temporary beneath
`artifacts/self-build-default/`. The exact RSS/time observations are preserved
here so clearing artifacts does not discard the results.

## Peak attribution: follow-up investigation

The Linux read-only parent profiler now accepts `--executable FILE`, allowing
the existing standalone image to be inspected without building a C runner:

```sh
node guest_vm/tools/profile_process_memory.js --executable artifacts/self-build-default/linux.exe artifacts/self-build-default/seed.snap artifacts/self-build-default/memory-profile guest_runner.js --vm-native --snapshot artifacts/self-build-default/profile.snap
```

This follow-up took 33 stopped-process samples. Sampling perturbs timings and
can change GC timing, so these are allocation/phase observations, not new stock
performance scores. The sampled maximum was 471,968 KiB (460.91 MiB), compared
with the independent uninstrumented maximum of 472.62 MiB above. The output
snapshot remained byte-identical to the reference.

At that sampled maximum:

- Outer execution heap resident pages: about 444.26 MiB.
- Everything outside that heap range: about 16.65 MiB. This includes the
  target runtime, executable/image mappings, libraries and native allocations;
  this measurement does not separate those components individually.
- Occupied outer-heap records: 162.06 MiB.
- Free outer-heap record space: 282.09 MiB.
- Latest post-GC occupied measurement: 146.93 MiB, from collection 13.
- Resident collector workspace: only 108 KiB, not its 128 MiB reservation.
- Spare vector capacity: 13.99 MiB; spare property capacity: 12.40 MiB.

Occupied records can contain garbage not yet collected. The last post-GC
measurement is historical, not a new reachability audit at the peak. Heap
residency uses Linux pagemap present bits; shared zero-page and boundary-page
accounting prevent treating this as an exact additive smaps breakdown. At
least 79.77 MiB of wholly interior pages of free records were present at this
sample; free records also share many boundary pages with occupied records.
Thus 282.09 MiB is free *record space*, not a claim that precisely that many
MiB of RSS could immediately be released.

The clearest allocation burst occurred late in standalone-runtime preparation:
375,197,656 occupied bytes (357.82 MiB), before collection 13. Major categories
at that instant were:

- Value vectors: 155.15 MiB, 1,054,861 records.
- Property storage: 78.44 MiB, 410,544 records.
- Strings: 54.14 MiB, 1,037,744 records.
- Array headers: 28.51 MiB; ordinary object headers: 12.74 MiB.
- Individual property records: 9.67 MiB.

The active function was the bytecode verifier at that sample. This identifies
the phase, **not** ownership of every accumulated allocation. Earlier samples
also caught parsing, kernel AST substitution and ordinary runtime property
operations. A following collection reduced occupied storage to about 150 MiB,
while RSS remained high. The outer heap had already grown to accommodate the
temporary construction workload; collecting objects did not unmap its pages.

### Node phase observations

Separate serial diagnostic builds recorded `process.memoryUsage()` immediately
before existing progress messages. Both produced the same reference snapshot.
These are phase samples, not exact peak measurements or retained-object audits.

- JIT: RSS about 51.8 MiB after source loading, 151.8 MiB after assembly,
  169.4 MiB before standalone preparation, 250.6 MiB after preparation,
  and 265.1 MiB after serialization.
- Jitless: about 48.7, 138.8, 135.2, 213.5 and 221.3 MiB at those boundaries.
- At the end, JIT reported 117.6 MiB JS heap used / 178.2 MiB heap capacity;
  jitless reported 118.7 / 160.2 MiB. These are not forced-GC live sizes.
- External memory was about 18 MiB in either mode, including about 15 MiB
  array-buffer storage. Array-buffer bytes are a subset of external bytes,
  not an additional category to add to them.

The JIT/jitless RSS difference cannot all be labelled generated machine code:
JS heap capacity, collector timing and other V8 overhead differ too. Both
hosts show a large preparation-phase rise, so that phase is a useful shared
optimization target rather than a Wine-specific problem.

### Recommended reductions, not implemented by this investigation

1. Reduce temporary frontend representations and their overlap. Trace retained
   owners through parse/lower/verify/adopt boundaries; release consumed trees,
   analysis state and temporary tables when their last consumer finishes.
   Existing consuming/paged frontend paths should be extended, not duplicated.
   Preserve source text required by function `toString` and debugging.
2. Use compact representations for compiler-internal data, where their semantics
   permit it. Million-record vector/property populations are a larger target
   than allocator slack alone. For example, the int32 analysis stores the three
   states UNKNOWN/INT32/ZERO in ordinary JS arrays and clones incoming states;
   a packed state table/workspace could avoid tagged-value overhead. Its
   current state/work caps already exist; measure its share before prioritizing
   it over other frontend tables. Do not change ordinary guest array semantics.
3. Make collection pressure account for temporary allocation growth and reusable
   free space. Earlier phase-aware collection could avoid growth during
   construction, but collecting too often or scanning fragmented free lists
   can hurt CPU time. Prototype and compare RSS, build time and GC time together;
   merely adding a final GC cannot undo the peak already incurred.
4. Investigate build-local workspace ownership/lifetimes so nonescaping scratch
   storage can be reused instead of becoming scattered heap garbage. No moving
   guest GC, page advice, source loss or application-specific shortcuts are
   proposed. Peak savings remain unquantified until prototyped.
5. For executable packaging, load only the selected target backend and required
   debug machinery. Currently both hosts load ELF/PE and debug-related modules
   even without debug output; the guest path also reloads frontend modules.
   Safe reuse needs module-identity/lifetime review. The file-copy loop already
   streams in 64 KiB chunks, so replacing it with another streaming loop is not
   a useful proposal.

Shrinking the 7.24 MiB final snapshot or reducing the untouched 640 MiB virtual
reservation alone would not address the dominant resident construction peak.
The Windows follow-up was not re-profiled internally; the prior near-identical
whole-process peak suggests common build allocation is the first place to work,
but does not prove identical Windows allocation attribution.
