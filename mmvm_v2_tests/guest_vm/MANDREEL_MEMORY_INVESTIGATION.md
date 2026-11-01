# Mandreel memory investigation — 2026-10-31

Follow-up: [the nonmoving bring-up report](MANDREEL_BRINGUP.md) records the
successful stock run on 2026-11-01. The capture below is the original failure
diagnosis, retained as evidence rather than a statement of the current status.

## Finding

The reproduced allocation failure is **external fragmentation while compiling
Mandreel**, not a requirement for 512 MiB of live game data. The failing
`Array.push` belongs to `Compiler.prototype.emit`: it is appending guest
bytecode words to `this.code` while compiling the benchmark's very large
`global_init` function. Mandreel setup and timed execution have not started.

An 8 MiB contiguous allocation fails despite approximately 410 MiB free.
The largest ordinary free record is only 5.2 MiB. The earlier suggestion of
base64-decoder allocation pressure was an unconfirmed possibility; this
capture establishes a different failure site.

No allocator, collector, compiler or benchmark behavior was changed for this
investigation. Only diagnostic tools and this report were added/extended.
The external `../../js_tests` tree remains unchanged.

## Reproduction and evidence

- Current source checkpoint: Typescript implementation `6aadc41`, with its
  subsequent documentation commits. Native contract 87. Fresh snapshot:
  6548264 bytes, SHA-256
  `5ad9b4e0210f7f1b88b82d1767cec8c407596a3304e0dee4eaafb22815a67bcb`.
- Unchanged i386 launcher, existing js_min binary verified operational.
  No emulation, C source changes, downloads or Python were used.
- A generic diagnostic loader prints before/after each unchanged source load.
  It starts `octane_runner.js --setup-only Mandreel`. This mode is sufficient
  because the failure occurs before the file finishes compiling, before setup.
- The last loading message is `load begin: ../../js_tests/octane/mandreel.js`.
  No matching load-completion, setup or benchmark-running message follows.
- Mandreel source: 5000408 bytes / 277403 lines. `global_init` starts at line
  123784 and contains the large generated static-initialization sequence.
- GDB stops at the standalone bootstrap's fatal `dprintf`, before its exit.
  The target is single-threaded. Network debug downloads and auto-loading are
  disabled. A 780-second process bound is used; capture finishes in 617.01 s.
  Only this heavy workload runs. The debugger dumps the guest heap and kills
  only its owned diagnostic inferior. The target's observed RSS is 532800 KiB
  (520.3 MiB). GNU time's 558464 KiB peak for the debugger process tree is not
  presented as a clean target-only benchmark measurement.
- Fatal fields: opcode CALL, bytecode PC 112, intrinsic Array.push (detail
  1011), allocation flag 1, 15 collections, live 106470624 bytes, tail
  536684424, limit/maximum 536870912. This is consistent with the previous
  stock failure's CALL/PC/intrinsic and approximately 101.5 MiB live data.

The saved frame chain identifies:

```text
Compiler.emit: this.code.push(arguments[index])
  Compiler.readReference
  Compiler.compileExpression
  Compiler.compileStatement
  Compiler.compile
  Compiler.compileFunction: AST name=global_init, type=FunctionDeclaration
  Compiler.compile
  self_hosted_frontend.compile
  self_hosted_frontend.compileExecutable
  file loader
```

The code array has length/capacity **262144 / 262144**. Its current element
record is **4194328 bytes**: 24 bytes of header/metadata plus 16 bytes per
value cell. The shared geometric policy grows capacity to **524288** for
the next append, requesting **8388632 bytes**. That request must fit in one
contiguous span. The old vector remains live until copying/publishing the new
one; current growth is allocate-copy-replace, not in-place extension.

## Heap at the failure

All numbers below are guest-heap accounting, not process RSS.

| Item | Bytes | MiB |
| --- | ---: | ---: |
| Heap ceiling | 536870912 | 512.0 |
| Published heap extent | 536684424 | 511.8 |
| Occupied records / last-GC live bytes | 106470624 | 101.5 |
| Free records | 430213736 | 410.3 |
| Largest ordinary free record | 5466000 | 5.2 |
| Required new code vector | 8388632 | 8.0 |
| Remaining tail below ceiling | 186488 | 0.178 |

There are 387140 free records. Of these:

- 148493 records / **413179936 bytes (394.0 MiB)** meet the native arena
  index's minimum size, obtained from the shared layout constant (272 bytes).
- 238645 records / **17028616 bytes (16.2 MiB)** are below that minimum.
- Two protected free records account for just 5184 bytes.

Thus small unindexed holes are real overhead, but are **not the primary
explanation**: hundreds of MiB already meet the region-index policy and no
individual free record can satisfy this allocation. This is not evidence that
the allocator simply lost an existing 8 MiB free block. Sweeping already
coalesces adjacent ordinary free records; live records separate these holes.

The record immediately after the old vector is free but only **533920 bytes**.
In-place growth would need another **4194304 bytes**, so extending into that
immediate hole cannot solve this particular request.

### Occupied record breakdown

| Record class | Bytes | MiB |
| --- | ---: | ---: |
| Property storage | 41626112 | 39.7 |
| Value vectors | 28801848 | 27.5 |
| Strings | 16146328 | 15.4 |
| Object headers | 8236576 | 7.9 |
| Array headers | 5322944 | 5.1 |
| Bytecode records | 4117088 | 3.9 |
| All other record classes | 2219728 | 2.1 |

There are 257393 ordinary objects and 166342 arrays. This is a substantial
guest-owned frontend graph, not just the final executable bytecode.
Property storage has 660288 live entries versus 1043426 capacity slots;
unused/tombstone slots occupy **12260416 bytes (11.7 MiB)**. Value-vector
spare capacity occupies **10371824 bytes (9.9 MiB)**. These amounts overlap
the rows above; they must not be added again to the occupied total.

The collector reports **6.22 seconds total GC time** and **0.729 seconds
maximum pause** over 15 collections. Most of the roughly ten-minute run is
therefore not GC execution. More frequent full collections are not a remedy
for either the proven fragmentation or the principal compilation CPU cost.
The matching occupied/last-GC-live totals also mean that this failure cannot
be explained simply by saying hundreds of MiB await their first collection.
This capture does not establish absence of all leaks; it establishes why
this allocation cannot be satisfied.

## Fresh Node --jitless reference

Node v24.14.1 x86-64, separate serial processes, unchanged external source:

- Diagnostic source load/setup: Mandreel file load **248 ms**; setup **2544 ms**;
  whole process **2.92 s**, peak RSS **97488 KiB (95.2 MiB)**.
- Full stock benchmark: **pass**, combined score **1446**, wall **16.09 s**,
  user CPU **15.82 s**, peak RSS **97796 KiB (95.5 MiB)**.
- The previous complete-sweep reference peaked at 92596 KiB (90.4 MiB).
  That remains the correct historical observation; this is a fresh run.

The guest fails during compilation; Node's full-run RSS includes successful
setup and execution. Neither RSS is the same quantity as the guest's live
heap. V8's frontend/compilation policy and representations also differ, so
these measurements do not prove identical work during the file-load phase.
They do show that the workload need not inherently consume half a GiB.

## Potential solutions, in recommended order

### 1. Remove mandatory large contiguous growth for ordinary arrays

Introduce a general large-array storage strategy, keeping small arrays on
their current fast contiguous path. Candidate designs are paged backing
storage or GC-owned separately allocated large element backings. Either
avoids requiring a new monolithic vector at every doubling.

- Paged storage can grow using bounded chunks from existing free regions and
  does not copy the whole prefix at every capacity increase. Keep register
  vectors and other deliberately contiguous VM records distinct; do not turn
  every VALUE_VECTOR into a paged structure indiscriminately.
- Separately allocated backings can reuse the ownership approach already used
  for large buffer data. Tagged array cells still require GC tracing; external
  bytes must count toward memory pressure, be freed correctly, and serialize
  canonically without fixed native addresses. This is not permission to hide
  allocations outside the heap budget.
- Centralize the element access/storage policy in named accessors, with kernel
  inlining where useful, rather than scattering storage-kind branches.
- Preserve holes versus undefined, length/descriptor/prototype behavior,
  mapped arguments, enumeration, GC ownership and snapshot reproducibility.

This directly addresses the failure class for any large guest array, not
just this compiler or benchmark. Exact chunk sizing/thresholds need measured
evaluation. Avoid assuming a particular page size solves every fragmented heap.

### 2. Pack homogeneous integer arrays instead of using 16-byte cells

The failing code array contains integer bytecode words. A general int32
element representation would use **four bytes per element**, cutting this
growth from about 8 MiB to about **2 MiB** and its old backing from 4 MiB to
1 MiB. It would benefit other numeric arrays, optimizer work lists and
self-hosted builds without recognizing compiler/benchmark names.

Promote to the general representation when required; do not coerce non-int32
values, lose negative zero/doubles/references, or confuse holes with zero.
This requires no NaN boxing. GC can skip reference scanning for integer-only
storage. It is a broader representation change than the immediate diagnosis
and needs the existing conformance/demo/build checks.

An alternative, more localized compiler architecture is a growable/chunked
typed word builder shared by emission and optimization, avoiding generic
tagged arrays for known bytecode words. This is a legitimate domain-specific
representation, not a Mandreel shortcut, but must work on all supported hosts
and avoid slowing js_min builds through extra accessor-call overhead. Do not
blindly flatten it into another large tagged array at the next pipeline stage.

Neither estimate proves a single change makes the entire benchmark pass:
later optimizer/adoption allocations and other runtime features still need
measurement once this compilation barrier is removed.

### 3. Reduce frontend peak live storage and slack

Property storage and value vectors dominate the occupied graph. Measure and
refine capacity policies for long-lived AST/analysis data, avoiding shrink/
regrow churn. Move suitable compiler-internal records toward compact schemas
or arenas with named fields rather than ordinary multi-property guest objects.

The frontend already suppresses unused location tables, shares identifiers,
uses compact literals, consumes completed AST bodies and adopts completed
nested programs. Those are existing mechanisms, not new proposed fixes.
Further work should reduce whole-function/whole-program overlap or use a
validated compact frontend representation. Lazy compilation is longer-term:
ES5.1 early syntax/strict errors must still be detected in uncalled functions,
and exact function source/toString behavior must remain available.

### Useful secondary measures, not sufficient fixes here

- Small-record free bins could recover the 16.2 MiB in sub-arena holes and
  improve general allocation density. They cannot alone supply the missing
  contiguous 8 MiB extent at this captured layout.
- In-place vector extension helps when adjacent space permits it, but the
  measured adjacent hole is too small here. It is not a complete solution.
- Moving/compacting GC could assemble larger extents, but is a much riskier
  change given native cached addresses, FFI-visible storage and recent GC
  stability work. It would need explicit pinning/relocation contracts.
- Raising the heap ceiling may postpone this failure but does not remove
  representation overhead or fragmentation. More frequent collection cannot
  merge holes separated by live records. Neither is the recommended first fix.
- No threads, compression, madvise policy or benchmark-source rewrites are
  required by the recommended approaches.

## Diagnostic tools and reproduction

```sh
node guest_vm/tools/build_profile_image.js --vm-native --snapshot artifacts/mandreel-investigate.snap
./artifacts/js_runner.exe artifacts/mandreel-investigate.snap guest_vm/tools/trace_octane_load.js --setup-only Mandreel
node --jitless guest_vm/tools/trace_octane_load.js --setup-only Mandreel
node --jitless octane_node_runner.js Mandreel
```

For the saved debugger dump, inspection uses record/field accessors:

```sh
node guest_vm/tools/audit_snapshot_heap.js --heap-stats artifacts/mandreel-heap.bin
node guest_vm/tools/audit_snapshot_heap.js --heap-frame 456793856 artifacts/mandreel-heap.bin
```

The frame address is this capture's heap-relative offset; obtain a new one
from the inspector's `native engine ... current frame` line for another run.
The debugger stops at `*dprintf` after `start`, with debuginfod/auto-load off.
At that instruction the bootstrap frame is intact: its named HEAP_BASE_LOCAL
slot is 2, represented at `ebp - (2 + 1) * 4` by the x86 assembler. The fatal
format's tail argument is stack word 9. These debugger ABI observations are
derived from `backend_x86.js` and `x86_assembler.js`, not new runtime fields.
Dump from the heap base for that tail length, then stop only the owned inferior.
Do not dump the entire reserved heap plus collector workspace unnecessarily.

Raw heap dumps, binaries, logs and snapshots are ignored temporary artifacts,
not checked-in generated data. The load tracer also passed a Richards setup
smoke run under js_min. The heap inspector is checked on Node and js_min;
the actual large raw-heap investigation runs only after the benchmark process
has stopped, avoiding concurrent memory-heavy workloads.
