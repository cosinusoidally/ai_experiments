# Mandreel bring-up: non-moving implementation work

## Scope

Bring up the unchanged stock Octane Mandreel benchmark under standalone
js_runner. Do not add a moving GC, change external benchmark/demo files,
raise the heap ceiling, or introduce benchmark-name-dependent behavior.
The diagnosed compilation-time fragmentation is documented in
[the memory investigation](MANDREEL_MEMORY_INVESTIGATION.md).

## Growable compiler word storage

Bytecode emission is an integer-stream problem, not a general JS-array
problem. `Bytecode.WordBuffer` provides logical length, append, patchable
storage and final indexed word views. Public compiler descriptors retain the
plain-array default. The self-hosted frontend requests packed words, using
growable Int32Array storage when the execution environment supplies it, with
an ES3 ordinary-array fallback on the old shell. No host callback supplies
the standalone buffers: their typed arrays belong to the guest heap.

The optimizer's rewrite output uses the same builder, so it does not recreate
the original 16-byte-per-word allocation problem immediately after emission.
Instruction copying accepts indexed word views without requiring ES2015
TypedArray.slice. Register allocation and verification continue to inspect
the same integer words and retain their normal algorithms.

Program adoption accepts validated dense integer arrays or Int32Array ranges
and copies their words directly to executable bytecode. Typed-array `.set`
now supports equal-kind source views, including overlap-safe copying and
preservation of exact floating-point bit patterns. This is general typed-view
support, not a compiler/benchmark recognizer. Different-kind conversions and
other unsupported forms remain outside this incremental change.

All existing records remain non-moving during collection. Growing a private
word buffer creates a new backing, as ordinary array growth already did;
this is not relocation of live objects by the collector.

## Initial validation and progress

- Node compilation comparison: packed consuming compilation agrees with
  public plain-array compilation for the unchanged Richards and Typescript
  compiler sources, including instruction words, constants and bindings.
- A rebuilt standalone image runs hello and passes Richards quick correctness
  through the packed self-hosted compilation/adoption path.
- The new buffers exposed a previously unsupported typed-source `.set` call;
  same-kind support is implemented rather than bypassing the method through
  host JavaScript. A subsequent portability issue in the instruction-copy
  helper was removed by testing for the slice operation rather than requiring
  typed views to pass the native Array instanceof path.
- Mandreel load/setup is being rerun at the unchanged 512 MiB maximum. No
  stock pass or memory/performance improvement is claimed until measured.

### Next compiler-storage barrier and statement lifetimes

Packed words alone did not finish loading: the diagnostic next exited at
SET_PROPERTY PC 58 with allocation flag 1, 15 collections, live 101543408,
tail 536706680 and maximum 536870912. Wall 561.59 s, user CPU 558.06 s,
peak RSS 536784 KiB. This is a moved failure, not a pass or proof of a
performance improvement. Source-level candidates include dense register-hint
storage. Native adoption consumes no register hints, so that metadata is now
disabled explicitly for this consumer, just as unused locations already are.
Public/compiler-to-JS consumers retain hint capture by default.

The same native frontend requests conservative whole-statement temporary
reuse. A function's constant registers and named bindings are persistent;
temporary slots return to a pool only after a complete outer statement has
been emitted. Loop, switch, handler and finalizer state is therefore not
released between its internal statements. Immutable constant slots never
enter that pool. Hints and reuse cannot be requested together: a reused slot
cannot carry one stable threaded-compiler call hint. Defaults remain unchanged.
No bytecode operation, observable evaluation order or collector relocation
rule is changed by this allocation policy.

The native contract is bumped to 88 so stale kernels cannot be combined with
the new typed-word adoption interface through unchecked snapshot loading.
The load tracer's optional `--compile-progress` observes the snapshot's seed
compiler, not a second freshly required compiler module; it logs function
boundaries only and is disabled by default.

Working-point gates:

- Both project hosts pass 12 programs / 270 assertions each, structured
  compiler checks, CLI/stdout and three-context checks; combined wall 196.10 s.
- Expanded standalone integration passes, including both overlapping typed
  copy directions and exact NaN-payload/negative-zero bit preservation.
- Richards, DeltaBlue, Crypto, RayTrace and EarleyBoyer pass quick correctness.
- Contract-88 focused Test262 (ch11/ch12/ch13): 2071 passed, zero failures,
  zero not run within the selected scope, zero timeouts; wall 97.63 s, user
  CPU 93.16 s, peak RSS 393376 KiB. This is not a new complete-suite result.
- GC structural checks pass: 27 audits, 102215 edges, 221 property indices,
  76 embedding collections, maximum bump 4573704 under an 8 MiB cap.
  Standalone workload passes 24 rounds / 48 native collections.
- Optional compiler-progress smoke check emits 75 function-start records
  for Richards load/setup and completes successfully.

Mandreel itself and the full final regression/build gate remain pending at
this checkpoint. No claim of a stock Mandreel pass is made here.

### Bounded pre-parse word workspace

The next diagnostic reached `global_init` but failed in WordBuffer.append's
Int32Array constructor: 13 collections, live 71087920 bytes, tail 536854328,
limit/maximum 536870912, largest free record 3583640. Occupied storage fell
to about 67.8 MiB, but a typed buffer still required a contiguous span. GDB
completed the raw heap dump, then crashed internally during inferior shutdown;
that debugger crash is not a guest segmentation fault. No pass is inferred.

The frontend now reserves a bounded private word workspace before parsing.
It estimates one word per source character, capped at 4 million words
(16 MiB), with a small minimum. This is scratch memory, not a source/program
cache. Nested compiler streams take stack slices; the optimizer can append
rewrite streams without overwriting its input. A function's workspace mark
is restored only after the adoption sink has copied and validated its code.
Parent streams therefore survive nested compilation. Retained public products
do not use this arena. Underestimation falls back to a separately growing
typed buffer rather than introducing a language/program-size limit.

The reservation uses existing guest-owned typed-array backing and ordinary
memory accounting, at the unchanged heap cap. Its purpose is to avoid placing
growing compiler buffers among already-fragmented AST records, not to move
live heap objects or hide allocations outside the budget. The outer source
compilation releases the arena normally after adoption; no persistent cache
or special recognition of Mandreel/global_init is involved.

Workspace working-point validation:

- Fresh image passes standalone integration and Richards/DeltaBlue/Crypto
  quick correctness. Node image construction reports 3.513 s.
- Focused Test262 ch12/ch13: 751 passed, zero failures, not run or timeouts;
  wall 43.24 s, user CPU 41.54 s, RSS 273492 KiB. This is a selected scope,
  not an updated full-suite total.
- Standalone GC workload passes 24 rounds / 48 native collections.
- Mandreel load/setup is rerunning with function-boundary diagnostics and a
  fatal heap capture. Full stock and final regression gates remain pending.

Validation commands from `mmvm_v2_tests`:

```sh
node guest_vm/tools/compare_compilation.js ../../js_tests/octane/richards.js ../../js_tests/octane/typescript-compiler.js
node guest_vm/tools/build_profile_image.js --vm-native --snapshot artifacts/mandreel-words.snap
./artifacts/js_runner.exe artifacts/mandreel-words.snap guest_vm/tools/trace_octane_load.js --setup-only Mandreel
./artifacts/js_runner.exe artifacts/mandreel-words.snap octane_runner.js Mandreel
```

The pending regression gate includes the existing project/integration and GC
checks, Test262, prior Octane passes, live demos and cross-host/self-hosted
snapshot identity and build timing. Generated images and logs remain ignored.

### 2026-10-31, about 19:50 — paged compiler tables

The workspace attempt reached `global_init` and failed in `emitConstant`, not
the word buffer. The failing write expanded `constantRegisters` beyond index
131071: its old tagged element vector occupied 2097176 bytes and doubling
needed approximately 4 MiB contiguously. The captured heap contained
428217464 free bytes, 106186336 post-GC occupied bytes and the reserved
16 MiB word backing. Thirteen collections had run. The unchanged program
still did not complete load; this is not a benchmark pass.

Executable compilation now uses compiler-private paged constant and
constant-register tables. A page holds at most 1024 entries. Shared table
accessors are used by lowering, verification, optimization, register packing
and adoption; consumers do not depend on the backing layout. Logical length
and undefined holes are preserved. Public descriptors retain ordinary arrays;
no guest heap format, collector movement or heap-cap change is involved.
Scratch word reuse is now explicitly requested only by `compileExecutable`,
whose adoption sink consumes descriptors synchronously, rather than inferred
from the presence of an arbitrary frontend callback.

Working-point checks:

- Node image write completes in 3.999 s as reported by the build diagnostic.
- Standalone integration passes.
- Richards, DeltaBlue, Crypto, RayTrace and EarleyBoyer pass quick correctness.
- Richards and TypeScript-compiler public/consuming compilation comparisons
  agree, including paged constant/register tables and packed code.
- Focused Test262 ch12/ch13: 751 passed, zero failed/not run/timed out;
  runner elapsed 45.779 s. This is not a new full-suite result.
- A fresh full Mandreel attempt is running with function progress and fatal
  heap capture. Stock completion and the final regression gate remain pending.

### 2026-10-31, later evening — optimizer metadata and adoption

The paged-constant attempt finished lowering `global_init` but failed in
register packing's liveness metadata at index 65536. The old vector occupied
1048600 bytes; the required next vector could not fit the largest free span
of 2026456 bytes. Live storage was 82061392 bytes. The allocator's inability
to satisfy a large contiguous request remained the problem, not live capacity.

Register packing now uses the same bounded-page tables for its per-register
metadata in executable compilation. Public-array compilation remains
supported. Both Richards/TypeScript compiler comparisons agree, standalone
integration and the five quick Octane checks pass, and focused Test262
ch12/ch13 passes all 751 cases (zero failures/not run/timeouts, 42.723 s).

The subsequent unchanged Mandreel attempt gets through lowering and register
packing, then fails in `adoptProgramDescriptor`'s native program constructor.
The captured heap has 75505504 occupied bytes, 461247256 free bytes and a
largest ordinary free record of 3108272 bytes. Twelve collections ran;
diagnostic wall time was 663.16 s. This is still not a Mandreel pass.
Executable program records require contiguous storage, so bounded compiler
metadata alone is insufficient: allocation policy must preserve large spans
against fragmentation by small records, within the same nonmoving heap cap.

### Native large-span placement policy (validation in progress)

Small tail allocations now prefer the first seven eighths of the existing
maximum reservation. Requests at least as large as the normal 64 KiB native
arena may use the final eighth normally. Interior reclaimed free regions
remain available regardless of request size. This keeps one tail span from
being filled with small, interleaved AST/object records before later code and
buffer allocations need contiguous storage. It allocates no extra memory,
does not relocate live objects, and does not change the 512 MiB default cap.

This is a preference, not an artificial capacity limit. If an instruction
still cannot allocate immediately after collection at the maximum logical
limit, the dispatcher releases the preference once and retries. It therefore
does not repeatedly collect just to enforce placement, or reject otherwise
usable space for a genuinely large small-object graph. Portable embedders
with no standalone reservation bound retain their previous allocation path.
The release state is a named engine field; contract 89 rejects stale kernels.

The first build check caught the portable zero-limit sentinel being treated
as a cap. That was fixed before acceptance: the fresh Node image then wrote
in 3.824 s. Standalone integration, 24-round/48-collection GC stress, five
quick Octane checks and all 751 selected ch12/ch13 Test262 cases pass (runner
elapsed 45.907 s). The full unchanged Mandreel run and final broad regression
gate are still pending; no score or complete-suite pass is claimed yet.

### Allocation barrier passed; catchable property errors

The placement-policy run compiles and adopts `global_init` successfully
(35.585 s within the diagnostic wrapper). It then executes far enough to
reach the benchmark's browser feature probe. That probe intentionally reads
`prototype` from an undefined value inside a try/catch. The native engine
incorrectly reports unsupported GET_PROPERTY instead of throwing the guest
TypeError. No browser API stub or benchmark change is appropriate.

This run exits for semantics, not allocation: allocation flag zero, thirteen
collections, last-GC live 127777696 bytes, tail 480568312 of 536870912 bytes.
Diagnostic wall 833.08 s, user CPU 817.74 s, debugger-tree RSS 503808 KiB.
The slower compilation versus the previous 663.16 s allocation failure is
recorded explicitly; successful placement is not a loading-speed win. The
latest heap still contains much uncollected temporary storage, so occupied
record bytes must not be mistaken for reachable/live bytes.

Both computed and constant-key null/undefined reads now allocate a guest
TypeError and unwind guest handlers. A cold internal transition restarts
dispatch at the caught frame entirely inside native execution. It preserves
instruction accounting, does not recurse on the native stack, and adds no
per-opcode exception flag or host-language callback. A private scratch value
leaves source operands intact if allocation must collect and retry. The
existing integration workload checks cross-frame catch/finally and TypeError
identity. Contract 90 covers the new support-table/transition contract.

Working-point validation: integration passes; GC stress passes 24 rounds /
48 native collections; Richards/DeltaBlue/Crypto/RayTrace/EarleyBoyer pass
quick correctness; selected Test262 ch11/ch12/ch13 passes 2071/2071 with
zero failures, not run or timeouts. Runner elapsed 109.405 s versus 97.63 s
at the earlier packed-word checkpoint. The fresh Node image writes in
3.903 s. The next full unchanged Mandreel attempt and final broad gate remain
pending. There is still no stock Mandreel score at this checkpoint.
