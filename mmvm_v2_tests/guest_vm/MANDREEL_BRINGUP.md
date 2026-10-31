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
