# Historical ECMA test bring-up

## Current target: all Node-passing files except Date first

### Binding-name lifetime and library checkpoint, 2026-11-02

Complete default standalone run (native interpreter contract 97):

- Selected: 1333 files; executed: 1329; not run: 0.
- Passed: **963**; failed: **366**, including **39 watchdog timeouts**.
- Skipped: the same four documented cases; no new exclusions.
- Elapsed: **664.163363 seconds**. A fresh contract-94 control took
  **661.972992 seconds**, with 906 passes / 423 failures / 38 timeouts.
- `ecma`: 458 passed / 162 failed / 11 timed out.
- `ecma_2`: 148 passed / 24 failed / 0 timed out.
- `ecma_3`: 173 passed / 52 failed / 1 timed out / 4 skipped.
- `ecma_5`: 184 passed / 128 failed / 27 timed out.
- Specific-file comparison: **906 preserved / 57 gained / 0 lost**.

Summed test time for those same 906 passing files is **177.274921 seconds
before / 172.081522 seconds after**. This single pair is a small observation,
not evidence of a general speedup. Full elapsed time remains dominated by
watchdog waits and is essentially unchanged; the additional timeout is not
hidden by the higher pass count.

Command: `TZ=UTC ./artifacts/js_runner.exe artifacts/ecma-stable97.snap ecma_tests_runner.js --verbose`.
Timeouts are included in failures, not an additional category. The ten-second
watchdog and the existing four default skips are unchanged; Test262's harness
has not been modified.

The fresh direct-Node control completed in **140.469850 seconds**, with
1218 passes / 111 failures / zero timeouts / four skips / zero not run.
Comparing the **specific filenames** that pass:

- **934 / 1218 Node passes matched (76.68%)**, previously 884 / 1218.
- **284 Node-passing files remain failing**, previously 334.
- Of that gap, **84** are in Date directories and **200** are outside them.
- Outside Date directories: **843 / 1043 matched (80.82%)**, previously
  793 / 1043 (76.03%). Date implementation work remains deferred.
- **29 guest-only passes** do not compensate for any Node-only failure.

The batch therefore gains 57 guest passes and closes 50 specific Node-parity
gaps, not 100. Work was frozen for the requested stabilisation and check-in.
Directory classification is provisional: files outside Date may exercise Date.

The control has one explicit heap-reference-error file. An intermediate,
unaccepted candidate had 27 and lost seven previously passing files. The
completed fixed run has **zero explicit heap/reference-error files** and
restores all seven. The shared defect was an unpublished live length on the
program binding-name vector, allowing its strings to be reclaimed; subsequent
frame cleanup masked that first error. See [the lifetime investigation](ECMA_HEAP_LIFETIME.md)
for the evidence, diagnostics and structural invariant checks. This is not a
claim that every remaining failure has been proved free of memory defects.

Feature changes use guest bytecode for composite Object, Array and JSON
operations, behind native-shaped public builtins and retained fast paths.
They also fix prototype-sensitive Array reads and wrapper coercions. The
algorithms execute inside the guest; they are not delegated to host JavaScript.

Completed regression gates for this batch:

- Project suite on Node and js_min: 12 programs / 270 guest assertions on
  each host, runner/HTTP CLI checks and the three-context demo; all pass.
- Bounded structural GC stress on both hosts: 27 audits, 111888 checked
  edges, 221 property-index audits and 74 embedding collections each.
  Maximum observed bumps: 3531120 / 3531472 bytes, under the 8388608-byte cap.
  The binding-name vector invariant is included in those existing audits.
- Standalone GC workload: 24 rounds / 48 native collections; passes.
- Full unchanged Test262: **3292 passed / 0 failed / 0 timed out / 0 not run**,
  **449.266334 seconds** elapsed, versus 470.868855 seconds at the preceding
  committed checkpoint. This is a single-run observation, not a general
  speedup claim.
- Snapshot gate: program/environment-independent builds, Node/js_min byte
  identity, arbitrary-program execution, live launch-environment reads and a
  genuine self-hosted byte-identical fixed point; all pass.

The portable js_min CLI gate initially exposed a host call-object cleanup
crash and then incorrect compiled `typeof` behaviour for undeclared names.
Centralising builtin callback installation and using the existing lexical
`typeOfBinding` operation fixes both. The final project suite above includes
the previously crashing unchanged `hello.js`, with exactly its expected stdout.

Octane correctness coverage for contract 97:

- All 14 non-deferred suites pass separate-process quick correctness runs:
  Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes,
  PdfJS, Mandreel, Gameboy, CodeLoad, Box2D, zlib and Typescript.
- These are explicitly quick correctness results, **not stock scores**.
  The expensive standalone RegExp performance benchmark remains deferred;
  ECMA and Test262 RegExp correctness tests are not excluded.
- Eight suites also complete paired **stock** runs on contract 94 and 97:
  all 16 runs pass. Scores below are **contract 94 / contract 97**:
  - Richards: 92.5 / 92.7.
  - RayTrace: 237 / 231.
  - Splay: 649 / 661.
  - NavierStokes: 275 / 256.
  - Box2D: 364 / 358.
  - Gameboy: 1033 / 1040.
  - CodeLoad: 99.3 / 92.3.
  - PdfJS: 864 / 824.

Command:
`node octane_compare.js --reference-snapshot artifacts/ecma-start.snap --snapshot artifacts/ecma-stable97-fixed.snap --include Richards,RayTrace,Splay,NavierStokes,Box2D,Gameboy,CodeLoad,PdfJS --output artifacts/ecma-stable97-octane-paired --timeout 600`.
This is a selected performance comparison, not a new full stock sweep.
Reverse-order stock repeats also pass, but confirm a modest performance cost:

- NavierStokes: current 267 / control 284 (10.38 / 9.70 seconds elapsed).
- CodeLoad: current 95 / control 101 (30.42 / 27.78 seconds elapsed).

Command:
`node octane_compare.js --reference-snapshot artifacts/ecma-stable97-fixed.snap --snapshot artifacts/ecma-start.snap --include NavierStokes,CodeLoad --output artifacts/ecma-stable97-octane-reverse --timeout 600`.
These repeats leave both current scores about 6% lower. That is an outstanding
performance regression in this correctness/stabilisation checkpoint, not
noise to discard and not a claim of restored performance parity. The broader
Array/property semantics and their fast-path guard costs need a subsequent
controlled investigation; no benchmark-specific workaround was added.

Live standalone checks, serial at 320x240 with a 20-FPS cap:

- Demos 1--7 render live framebuffers and exit cleanly through Escape.
  The older JS rasterizers remain slow, consistent with the previous
  checkpoint; the requested cap is not a claim of 20 FPS for those demos.
- Demo8 runs attract, garage, mouse camera drag, manual free drive,
  acceleration/steering, then auto drive and a clean menu/Q exit.
  Samples span 19.4--20.2 FPS in steady state, with a 16.2-FPS transition
  sample. Inspected captures show the garage floor/car and free-drive track,
  sky, vehicle and skid marks. This is a bounded live check, complemented
  by structural GC stress, not a long-duration stability proof.
- No demo source was changed.
- Live `net.js` and `node_web.js`: directory listings, exact text and binary
  responses, default `index.html`, HEAD and missing-file 404 checks pass on
  both unchanged servers. Fixtures and captures remain ignored artifacts.

The tested fixed image is 7036912 bytes, SHA-256
`a1a83f6fe84bd25e0b1ddc6bd88c06ed9f6e4d0a5d18c0b9e28bcfba0160b334`.
The fresh contract-94 control is 6822592 bytes, SHA-256
`fe33774feb8122adb701d02d27899c05c9ebe3c55c453043196aa81aec57460b`.
An earlier contract-97 image supplied the complete ECMA run above. The final
callback-factory/portable-`typeof` corrections were then validated by the
project, GC, Test262, snapshot, Octane and live application gates. They do not
change the native interpreter kernel used for that ECMA pass-set comparison.

### Stabilisation checkpoint, 2026-11-02, approximately 12:48 UTC

Complete default standalone run (native interpreter contract 94):

- Selected: 1333 files; executed: 1329; not run: 0.
- Passed: **906**; failed: **423**, including **38 watchdog timeouts**.
- Skipped: 4, the same previously documented slow cases; no new exclusions.
- Runner elapsed: **661.264714 seconds**.
- `ecma`: 456 passed / 164 failed / 11 timed out.
- `ecma_2`: 148 passed / 24 failed / 0 timed out.
- `ecma_3`: 167 passed / 58 failed / 1 timed out / 4 skipped.
- `ecma_5`: 135 passed / 177 failed / 26 timed out.

Command: `TZ=UTC ./artifacts/js_runner.exe artifacts/ecma-contract94.snap ecma_tests_runner.js --verbose`.
As explicitly approved, the ECMA default no longer imposes a total instruction
cap. Finite execution slices and the 10-second worker watchdog remain;
`--instruction-limit COUNT` still allows an explicit total cap. Test262's
policy and harness are unchanged. Earlier capped runs below remain historical
measurements, not equivalent-policy performance controls.

Filename-set comparison with the preceding complete 890-pass guest run:
**890 preserved / 16 gained / 0 lost**. The gained files include decimal
parsing, Array length conversion and descriptor handling, sparse-array sort,
function-length definitions and RegExp instance-property introspection.
Two Date files also now pass; Date implementation work remains deferred.
The summed elapsed time of the 890 common passing files is 163.527321 seconds
versus 301.301653 seconds previously. This is a single-run observation that
also includes the separately committed harness-preparation improvement,
not a controlled VM-only speedup claim.

Specific-file parity against the completed direct-Node control (1218 passes):

- **884** files pass on both engines: **72.58%** of Node's passing set.
- **334** Node-passing files remain failing in the guest (previously 346).
- **84** of those files are in Date directories (previously 86).
- **250** are outside Date directories (previously 260).
- Outside Date directories: **793 / 1043 Node passes matched (76.03%)**.
- **22** additional guest-only passes do not offset any Node-only failures.

Directory names are only a provisional feature classification: some files
outside Date also exercise Date. The remaining non-Date-directory gaps
include extensions (49), Object (33), Array (25), strict (20), JSON (16),
String (16), RegExp (13), Math (12), FunctionObjects (9), and other smaller
groups. No claim of non-Date parity is made. The authoritative comparison is
the individual filename pass set, not the difference between total passes.

This checkpoint adds guest-owned shared-library installation, retained-context
recovery, precise collector failure diagnostics, rooted descriptor conversion,
ordinary native descriptor operations, Array-length fixes and RegExp matcher
improvements. Dense/sparse Array descriptor semantics, object integrity,
legacy Function behaviour, coercions and Math edge cases remain incomplete.
Completed regression gates at this checkpoint:

- Project suite on Node and js_min: 12 programs / 270 guest assertions on
  each host, plus the runner/HTTP CLI and three-context checks; all pass.
- Bounded structural GC stress on both hosts: 27 audits, 110585 checked
  edges, 221 property-index audits and 74 embedding collections each;
  maximum observed bumps 3530632 / 3531072 bytes under the 8388608-byte cap.
- Standalone GC workload: 24 rounds / 48 native collections; passes.
- Full Test262: 3292 passed / 0 failed / 0 timed out / 0 not run;
  470.868855 seconds elapsed. The preceding candidate took 445.004271
  seconds; this run is 5.8% slower, not evidence of a performance gain.
- Snapshot gate: program/environment independence, Node/js_min byte identity
  and a genuine self-hosted byte-identical fixed point; passes.

The core working point is committed as `3a4b8f7`. The remaining gates below
completed afterwards on the same VM source; no VM implementation changed
during validation.

### Completed final validation, 2026-11-02, approximately 13:36 UTC

All 28 stock Octane runs pass: 14 suites on the preceding stable image and
14 on contract 94. RegExp's expensive standalone stock benchmark remains
explicitly excluded under the existing deferred priority; the full ECMA and
Test262 RegExp correctness coverage above is still executed. Each engine/suite
runs serially in a fresh process, with the unchanged external workloads and
their stock correctness checks. No quick-mode scores are substituted.

Command:
`node octane_compare.js --reference-snapshot artifacts/ecma-final.snap --snapshot artifacts/ecma-contract94.snap --exclude RegExp --output artifacts/ecma-stable-octane --timeout 600`.
The sweep ran approximately 13:05--13:27 UTC. Scores below are
**preceding stable image / current image**, higher is better:

- Richards: 95 / 88.
- DeltaBlue: 71 / 80.2.
- Crypto: 178 / 185.
- RayTrace: 240 / 234.
- EarleyBoyer: 425 / 423.
- Splay: 641 / 648.
- NavierStokes: 266 / 269.
- PdfJS: 867 / 855.
- Mandreel: 481 / 486 (110.20 / 109.22 seconds process elapsed).
- Gameboy: 1002 / 1006.
- CodeLoad: 93.8 / 96.2.
- Box2D: 352 / 350.
- zlib: 562 / 574 (272.56 / 266.59 seconds process elapsed).
- Typescript: 1362 / 1266 (104.84 / 112.36 seconds process elapsed).

Richards and Typescript were repeated in reverse image order to investigate
the larger downward observations. All four additional stock runs pass:

- Richards: current 101 / preceding 104; process elapsed 3.28 / 3.27 seconds.
- Typescript: current 1314 / preceding 1331; elapsed 107.56 / 107.07 seconds.

Reverse command:
`node octane_compare.js --reference-snapshot artifacts/ecma-contract94.snap --snapshot artifacts/ecma-final.snap --include Richards,Typescript --output artifacts/ecma-stable-octane-reverse --timeout 600`.
These repeats do not reproduce the original roughly 7% score gaps. They
support broadly similar performance, not a statistically established speedup
or proof that every path has identical cost. The slower full-Test262 elapsed
observation above is retained rather than hidden by the Octane results.

Snapshot identities (raw images/results remain ignored build artifacts):

- Preceding: 6719976 bytes, SHA-256
  `1178e462645ce2596a15e4762303df66c32feddd7c219236cbc8c6d1b685770a`.
- Current: 6822592 bytes, SHA-256
  `fe33774feb8122adb701d02d27899c05c9ebe3c55c453043196aa81aec57460b`.

Live standalone checks, sequential at 320x240 with a 20-FPS cap:

- Demos 1--7: live windows/framebuffers captured and inspected; all exit
  cleanly through Escape. The older JS rasterizers remain slow, consistent
  with preceding logs; the cap is not a claim of 20 FPS achieved by each demo.
- Demo8: attract, garage, mouse camera drag, manual free drive, acceleration
  and steering/powerslide, then auto drive; clean menu/Q exit. Steady-state
  log samples approximately 19.5--20.1 FPS, with one 16.4-FPS garage-transition
  sample. Captures show the garage floor, vehicle, sky and field rendering.
  This is a short interactive check, complemented by the separate bounded
  structural GC stress, not a claim of a long-duration soak test.
- `net.js` and `node_web.js`: directory listing, text body, byte-identical
  binary PNG, default index, HEAD and 404 all pass using ignored fixtures.
- Native-exit introspection: the standalone diagnostic reports the known
  unsupported Math CALL with filename, bytecode PC, callable, receiver and
  argument values, then deliberately stops before semantic reconciliation.

No demos, external corpus files, C implementation or Test262 harness files
were modified. No concurrent heavy workloads, downloads or emulation were
used. Work pauses here; the 250 non-Date-directory Node-only passes remain
the next parity target, not completed work.

### Preceding complete comparison

2026-11-02: parity is a filename-set requirement, not a matching pass total.
The last complete comparison has 1218 Node passes and 890 guest passes:
872 common passes, 18 guest-only passes and **346 Node-only passes**. Of
those Node-only files, **86 are under Date directories and 260 are outside
them**. Date implementation work is deferred until the other features work.
Some files outside Date directories also exercise Date; those require source
review rather than silently treating the directory count as a feature count.
Date tests remain in full-suite reports, and existing Date passes must not
regress. No new exclusion or corpus modification accompanies this priority.

Current focused work, not yet a new full-suite result:

- The guest `parseFloat` fast path now recognizes the ES decimal prefix
  before calling libc for binary64 conversion. Boolean/null inputs no longer
  use numeric coercion; hexadecimal, libc-only spellings and incomplete
  exponents follow the JS grammar. Signed zero and Unicode leading whitespace
  are handled on the guest side. Both historical GlobalObject parseFloat
  tests and `ecma_5/Global/parseFloat-01.js` pass; the second historical test
  previously reported 44 failing cases.
- Ordinary property descriptors now read inherited fields in the ES5.1
  order, preserve absent attributes, validate getters/setters and enforce
  non-configurable properties using SameValue (including NaN and signed zero).
  Descriptor getter results are rooted across subsequent guest callbacks.
- Valid/rejected ordinary definitions and ordinary/function descriptor reads
  have native kernel paths. Descriptor result objects are ordinary guest-heap
  objects with normal property attributes, not benchmark-specific objects.
  Exotic/dense indexed properties still need their separate semantic work.
- `15.2.3.6-function-length.js` and `15.2.3.6-new-definition.js` now pass
  focused checks under the normal limits. Dictionary redefinition part 1
  progresses to the instruction limit in about 5.7 seconds rather than
  exhausting the wall-clock watchdog; it is still counted as outstanding.
- The portable array own-property check no longer reports holes as present
  or detaches argument mappings merely by reading ownership. Property-key
  conversion now uses guest ToString instead of stringifying a VM facade.

The project/regression gates for these additions are in progress. The
Test262 harness is not being changed for this work. The separately committed
ECMA preparation optimization and its measurements are described in
[ECMA_HARNESS_PERFORMANCE.md](ECMA_HARNESS_PERFORMANCE.md).

## VM parity work: built-in initialization

2026-11-01: the repeated uncapped Node control remains **1218 passed / 111
failed / 0 timed out / 4 skipped / 0 not run**, in **130.489515 seconds**.
The parity target is the set of Node-passing files, not merely the same total
pass count. ES5.1 semantics take precedence over modern Node differences and
historical SpiderMonkey extensions; the external corpus remains unchanged.

The first runtime changes address shared initialization rather than adding
test-specific execution paths:

- Standard native function formal lengths have explicit ES5.1 metadata,
  separate from the native interpreter's minimum supported argument counts
  and the embedding callback's implementation signature.
- Built-in constructor `prototype` properties are immutable and
  non-enumerable. Prototype `constructor` properties and static methods use
  the ordinary writable/configurable, non-enumerable built-in attributes.
- String, Number and Boolean prototypes carry the same internal primitive
  value slot as their respective wrappers. Date.prototype carries NaN.
- Date, Math, Object, JSON and Error method installation consistently uses
  built-in property attributes instead of ordinary assignment attributes.

These changes leave dispatch, object lookup, allocation and GC algorithms
unchanged. Frozen before/after images are compared serially with identical
default limits (10-second watchdog, 20 million instructions):

- Before: **811 passed / 518 failed / 10 timed out / 4 skipped / 0 not run**,
  569.218517 seconds; 1333 selected, 1329 executed.
- Initialization candidate: **868 passed / 461 failed / 32 timed out / 4
  skipped / 0 not run**, 767.432632 seconds; the same selection.
- **57 new passes, zero lost passes**, checked by filename. Node-only passes
  decrease from **417 to 366**; the candidate passes 852 files also passed by
  Node and 16 files failed by Node. This is progress, not parity.
- For the **811 files passing in both guest images**, summed per-file time
  is **279.830 seconds before / 272.572 seconds after**. One pair is not
  statistically conclusive, but does not show a common-work slowdown.
- The 22 additional timeouts are all descriptor-combination tests under
  `ecma_5/Object/15.2.3.6`: eight dictionary-redefinition, eight
  middle-redefinition, four redefinition, function-length and new-definition.
  They formerly stopped at an early assertion (whose error formatting then
  referenced missing `uneval`); they now get farther and reach the unchanged
  watchdog. Their failure classifications and total runtime increase are
  retained, not hidden by a timeout/skip-policy change.

The first project regression gate also caught portable Date construction
writing an internal slot through ordinary assignment. The slot now uses the
internal-value accessor for construction and setters. The small internal
two-runtime isolation fixture uses fixed 64 KiB heaps instead of 32 KiB to
fit the new standard descriptors; its isolation checks and fixed-capacity
behavior are unchanged. No production or benchmark heap ceiling is raised.
The full candidate counts above precede that portable Date-write follow-up;
subsequent regression gates are recorded separately.

Follow-up checks on the Date-write correction:

- Node and js_min project runners pass: 12 guest programs / 270 assertions
  each, compiler/embedding checks, unchanged server/demo CLI entry points,
  and three-context multiplexing.
- Structural GC stress passes on both hosts: 27 audits, 110018 checked edges,
  221 property-index audits and 74 embedding collections each. Maximum
  observed bumps are 3530056 / 3530496 bytes under the unchanged 8 MiB cap.
- The final standalone image passes 24 GC workload rounds / 48 native
  collections. Node construction of that image takes 8.00 seconds wall.
- Full standalone Test262 passes **3292 / 3292**, with zero failures,
  timeouts or not-run files: **424.389549 seconds** runner elapsed versus
  430.384625 seconds at the preceding checkpoint. These are single runs.
- Cross-host snapshot gate passes: program/environment-independent js_min
  images, identical Node output and a genuine self-hosted byte-identical
  rebuild. The complete serial gate takes 289.90 seconds; this includes
  multiple builds and is not an individual build-time measurement.
- Eight paired stock Octane workloads pass on both frozen images, serially.
  Scores before / after: Richards **101 / 102**, DeltaBlue **95.4 / 96.1**,
  RayTrace **248 / 252**, NavierStokes **273 / 271**, Box2D **364 / 367**,
  Gameboy **1061 / 1063**, TypeScript **1315 / 1309**, Mandreel **492 / 491**.
  TypeScript wall time is 108.23 / 108.46 seconds; Mandreel 107.38 / 107.60.
  These matched observations show no clear regression, not proof of a
  speedup or a new measurement of the remaining Octane suites. Command:
  `node octane_compare.js --reference-snapshot artifacts/ecma-before.snap --snapshot artifacts/ecma-final.snap --include Richards,DeltaBlue,RayTrace,NavierStokes,Box2D,Gameboy,Typescript,Mandreel --output artifacts/ecma-initialization-octane --timeout 600`.
  Snapshot bytes increase from 6686024 to 6719976 (33952 bytes, about 0.51%).
- Live unchanged demos1--7 render at 320x240, emit multiple FPS samples,
  have their window captures inspected and close cleanly through X11 input.
  Demo8 passes attract, garage, mouse dragging, free-drive auto pilot and
  manual acceleration/steering, then menu quit. Steady sampled rates are
  19.8--20.0 FPS in the garage and 19.5--20.1 in free drive; a transition
  sample is 16.9. These are bounded smoke checks, not long GC soaks.
- Both unchanged HTTP programs pass localhost directory listing, exact text
  and PNG binary comparisons, automatic index.html selection, HEAD length
  and missing-file 404 checks. All demo/server processes exit or are stopped.
  Captures, fixtures and raw logs remain ignored artifacts, not tracked data.

Next architectural step: separate guest-written standard-library bootstrap
from the Node-compatible embedding. Currently `GuestNodeEnvironment` installs
the owned Array/RegExp/String/Number algorithms, whereas a bare embedded VM
does not. Provide one VM installation API with an explicit source-reader
callback, use it from both embeddings, and install once before preparing
isolated test contexts. This must not introduce a Node dependency into the VM
or a second implementation of the algorithms. Then use the new corpus to
drive generic descriptor, coercion and sparse-array support, preserving the
existing native fast paths rather than replacing them with test-specific
behavior. Per-file pass preservation remains a regression gate.

## Shared guest-library migration (in progress)

2026-11-01, approximately 22:15 UTC:

- The next complete candidate run executes the same 1329 files: **888
  passed / 441 failed / 40 timed out / 4 skipped / 0 not run**, in
  **832.469084 seconds**. Compared by filename with the initialization
  checkpoint, this is 21 new passes and one lost pass, not yet a stable
  parity checkpoint. No corpus source, limit or default skip was changed.
- The candidate exposes the existing guest-written Array, String, Number
  and RegExp libraries through one runtime installation API, rather than
  making their availability depend on the Node-compatible embedding.
  Bootstrap bindings live in a private runtime-owned context.
- The lost pass is `ecma_3/extensions/regress-103087.js`. Running the
  owned matcher, rather than an outer interpreter's regex callback, made
  its work visible to the unchanged instruction limit. A diagnostic run
  completes correctly with a larger explicit budget; that is not counted
  as a default-budget pass.
- Follow-up matcher work removes impossible backtracking choices when a
  greedy character repeat and its following mandatory literal are proven
  disjoint in both case modes. It does not cross captures or assertions.
  The lost file now passes a focused default-budget run in **457.253 ms /
  2904106 instructions**. The HTML replacement regression and RegExp exec
  tests also pass. A fresh full run is still required before replacing
  the whole-suite counts above.
- Project suites pass on both Node and js_min: 12 programs / 270 assertions
  each, plus compiler, CLI and three-context checks. The consuming compiler
  fix is checked in separately as `da624af`: replayed finally subtrees
  retain nested function ASTs until their owning statement is released.
- New optional native-frame sampling reads published heap frames at normal
  budget yields. It is diagnostic-only, uses no threads, and is excluded
  from clean timing runs. The default runner reports remain unchanged
  except that `--verbose` also reports guest instruction counts.

Follow-up complete run, approximately 22:37 UTC:

- **890 passed / 439 failed / 38 timed out / 4 skipped / 0 not run**;
  1333 selected / 1329 executed, **835.356120 seconds** elapsed.
- Compared by filename with the 868-pass initialization checkpoint:
  **22 new passes and zero lost passes**. The summed per-file time for
  all 868 common passes is **293.988 seconds before / 295.617 seconds
  after** (about 0.6% higher in this pair). The overall run includes
  additional progress into previously failing expensive combinations;
  total elapsed time alone is not a common-work throughput comparison.
- Full Test262 passes **3292 / 3292**, with no failures, timeouts or
  not-run files, in **445.004271 seconds**. This is 4.9% above the
  preceding single 424.389549-second run and is retained as a performance
  follow-up, not called a speedup or silently discarded.
- Three previously failing descriptor-combination files now report the
  portable collector's generic marker error instead of timing out. That
  error label also covers invalid-edge/layout statuses, so it must not
  yet be classified as proven workspace exhaustion. The collector now
  distinguishes these statuses and reports the stored bad-edge details;
  focused diagnosis is in progress.

The uncommitted library migration is not yet claimed regression-free:
collector diagnosis and the remaining periodic gates are still pending.

2026-11-02 collector follow-up: the marker status was an **invalid reference**,
not actual workspace exhaustion: a context's active-frame edge pointed at a
reclaimed frame. A loaded script can export functions and then close its
embedding context handle. Frame synchronization formerly substituted the
caller's context when the original handle was absent from the registry,
publishing a foreign frame into the wrong context. It now reconstructs a
borrowed facade from the retained heap context; function invocation does the
same for cached handles that have since been destroyed. Reused frames refresh
their context metadata as well as their environment and PC. Borrowed facades
are not registered as permanent roots. The reproducer gets past its former
invalid edge and reaches the ordinary test limit instead. Bounded structural
GC stress passes on both hosts: 27 audits / 110423 checked edges / 221
property-index audits / 74 embedding collections, with maximum bumps
3530328 and 3530768 bytes under the unchanged 8 MiB cap. These stress results
precede the subsequent descriptor kernel additions; their gates are pending.

## Default-policy update

The four pathological Array/RegExp cases from the initial Node timeout list
are now skipped by default on both engines. `--include-slow` restores them.
Default full runs select 1333 files, execute 1329, and report four skips
separately from failures and not-run files. Node now has no timeout by default;
positive `--timeout-ms` enables its optional cap, and zero disables it.
The guest's existing watchdog and instruction budgets remain unchanged.

Default PASS/FAIL/elapsed output remains enabled. Node now writes these lines
synchronously so redirected/pipe output does not wait for event-loop callbacks
while the supervisor is blocked in a worker. `--quiet` and `--summary-only`
remain explicit opt-outs. Historical full-corpus results below retain their
original all-tests/no-skips policy and bounded-run settings; they have not
been silently reclassified as new default-run measurements.

### Completed uncapped Node default run

2026-11-01, approximately 16:59 UTC:
`TZ=UTC node ecma_tests_runner_node.js` (no timeout option).
**1218 passed / 111 failed / 0 timed out / 4 skipped / 0 not run**;
1333 selected files, 1329 executed; runner elapsed **139.106478 seconds**.
Default per-file PASS/FAIL/timing lines were emitted during execution.

- `ecma`: 598 passed / 22 failed / 0 skipped.
- `ecma_2`: 163 passed / 9 failed / 0 skipped.
- `ecma_3`: 203 passed / 22 failed / 4 skipped.
- `ecma_5`: 254 passed / 58 failed / 0 skipped.

The four fewer failures than the original five-second run are exactly the
four configured skips, not fixes to test expectations or VM language support.
The original failure review retains its four timeout entries as historical
results. A new full guest baseline has not been substituted for the earlier
one; guest default selection and mixed skipped/positive/negative behavior are
checked separately.

Policy validation: default Node/guest `--list` output agrees (1329 runnable,
1333 selected, four skipped); `--include-slow --list` restores 1333 runnable.
A guest mixed selection executes its positive and negative tests successfully
and reports all four skips. Explicit Node `--timeout-ms 0` passes the same
positive/negative pair. Re-enabling the four slow cases with a 50 ms explicit
Node cap reports four timeouts and zero skips, demonstrating that optional
limits still work. Fail-fast accounting keeps four configured skips separate
from one executed failure and one not-run file. No corpus or VM code changed.

## Original all-tests bounded baselines

2026-11-01, approximately 16:22--16:25 UTC. Both engines execute all
**1333 files, zero not run and zero skipped**. Timeout counts below are
subsets of failures, not additional outcomes. All source files are unchanged.

- **Standalone guest: 800 passed / 533 failed / 28 timed out / 0 not run**.
  Pass rate 60.02%; runner elapsed **552.318344 seconds**. Command:
  `TZ=UTC ./artifacts/js_runner.exe artifacts/ecma.snap ecma_tests_runner.js --verbose --timeout-ms 5000 --instruction-limit 2000000`.
  - `ecma`: 392 passed / 228 failed / 17 timed out, 620 files.
  - `ecma_2`: 146 passed / 26 failed / 0 timed out, 172 files.
  - `ecma_3`: 144 passed / 85 failed / 5 timed out, 229 files.
  - `ecma_5`: 118 passed / 194 failed / 6 timed out, 312 files.
- **Direct Node: 1218 passed / 115 failed / 4 timed out / 0 not run**.
  Pass rate 91.37%; runner elapsed **161.120027 seconds**. Command:
  `TZ=UTC node ecma_tests_runner_node.js --timeout-ms 5000`.
  Node v24.14.1 with an ordinary, non-contextified global realm.
  - `ecma`: 598 passed / 22 failed / 0 timed out, 620 files.
  - `ecma_2`: 163 passed / 9 failed / 0 timed out, 172 files.
  - `ecma_3`: 203 passed / 26 failed / 4 timed out, 229 files.
  - `ecma_5`: 254 passed / 58 failed / 0 timed out, 312 files.

The runs are serial. They have the same watchdog setting but different
resource models: the guest additionally has an instruction budget and an
inner guest-heap cap; Node has a V8 old-space limit and worker startup grace.
These are bounded bring-up observations, not unbounded compliance scores or
an interpreter speed comparison. Defaults and resource details are in
[ECMA_TESTS.md](ECMA_TESTS.md).

Cross-engine outcomes: **790 pass both**, **428 pass Node but fail guest**,
**10 pass guest but fail Node**, and **105 fail both**. Node-passing cases
give useful next targets, but source review is still required before treating
every difference as a standard ES5.1 defect. See the complete
[Node failure review](ECMA_NODE_FAILURE_REVIEW.md); no failure is waived.

## Guest gaps exposed by the new coverage

Of 533 failed files, the initial diagnostic breakdown is:

- 459 structured JavaScript/assertion failures, including standard-library
  gaps, legacy expectations and missing proprietary facilities.
- 10 failures explicitly reporting heap/storage limits (notably huge sparse
  arrays); these are not automatically proof of incorrect scalar semantics.
- 28 timeouts: 13 instruction-budget and 15 wall-clock watchdog limits.
- 36 worker terminations: **33 native exit-70 unsupported paths**, **one
  SIGSEGV**, and **two explicit early exit-0 cases with no result**. Early
  quits are not treated as passes. Some are authored shell skips, not crashes.

The SIGSEGV is `ecma_5/RegExp/exec.js`. Representative exit-70 cases include
`ecma/Date/15.9.5.2-1.js`, several Math coercion/edge-case tests,
`ecma/String/15.5.4.11-1.js`, `ecma_3/Statements/switch-001.js`, and
`ecma_5/Number/toString-radix-handling.js`. These are missing/unsupported
execution forms or stability defects, not failures of every CALL opcode.
The supervising i386 process remains working and continues the suite.

Some useful standard-library coverage subsets within `ecma_5`:

- JSON: 20 passed / 16 failed.
- Object: 10 passed / 38 failed.
- Array: 8 passed / 15 failed.
- Function: 4 passed / 8 failed.
- Strict: 19 passed / 24 failed.

This materially extends the earlier Test262 chapter selection: it exercises
Date/Math/String coercions, built-in descriptors, array algorithms, JSON,
Object operations and additional strict behavior. The initial task establishes
the baseline; it does not implement those missing VM features or proprietary
SpiderMonkey APIs.

## Scope

The original baseline executed all 1333 standalone test files in the unchanged
external `ecma`, `ecma_2`, `ecma_3` and `ecma_5` directories. Infrastructure/helper files are
handled as described in [ECMA_TESTS.md](ECMA_TESTS.md). Current defaults exclude
only the four explicitly reported cases above; `--include-slow` restores
all-test execution. This ledger measures raw coverage
for the ES1--ES5.1 VM project, not a claim that every historical expectation
is standard ES5.1 behavior. No VM, C, demo or external-test source changes
are part of this bring-up.

## Initial complete control run

- 2026-11-01, approximately 15:54 UTC, Node v24.14.1, `TZ=UTC`,
  `node ecma_tests_runner_node.js --timeout-ms 1000`:
  **1184 passed / 149 failed / 0 not run**; 35 failures were timeouts.
  All 1333 files executed; runner elapsed 131.966976 seconds. Node used
  serial bounded workers, but this first run used the default contextifying
  global proxy. The subsequent baseline uses Node's ordinary realm global
  where available and a larger five-second limit; do not combine the two as
  if they were one run.
  - `ecma`: 588 passed / 32 failed / 10 timed out.
  - `ecma_2`: 163 passed / 9 failed / 0 timed out.
  - `ecma_3`: 203 passed / 26 failed / 4 timed out.
  - `ecma_5`: 230 passed / 82 failed / 21 timed out.

## Investigation notes

- The first nonisolated Node attempt hung inside native `Array.splice` on a
  length-4294967295 sparse array, despite a VM-script timeout. An external
  process watchdog now records the failure and continues. No test was removed.
- An early guest attempt created contexts without restoring intrinsics;
  an Array.prototype mutation contaminated later tests. That run was discarded.
- The guest currently has a native exit in `ecma/Date/15.9.5.2-1.js`.
  Serial fork workers now contain such failures and preserve a complete
  denominator instead of stopping at the first native exit. The known-good
  `ecma/Array/15.4.4.1.js` passes in the same smoke run; the Date native exit
  counts as failed, not as a passing negative test.
- The rebuilt generic image has SHA-256
  `5aa7f3a8f837676eaac5073e736b5e1f68c0c74b95ced3ba613e6f0419668cf0`,
  identical to the preceding performance checkpoint. The interpreter has not
  been changed to make these tests pass.
- The complete five-second baselines are recorded above. Increasing Node's
  timeout resolved 31 earlier timeouts. Using an ordinary global fixed three
  harness artifacts: `ecma_5/Global/adding-global-var-nonextensible-error.js`,
  `ecma_5/Object/proto-property-change-writability-set.js`, and
  `ecma_5/misc/function-definition-eval.js`. These must not be mislabeled as
  Node language defects or fixed by weakening the tests. Interrupted and
  contaminated attempts are not pass-rate baselines.
- Final runner checks: Node and guest `--list` output are byte-identical for
  1333 files; a known positive plus a `-n.js` expected-exception test pass on
  both engines; `--fail-fast` on two failing files reports one executed failure
  and one not run on both. Control characters in failure messages are escaped
  for single-line readable logs. The review inventory was cross-checked against
  every one of the 115 Node failures. All workers have exited or been reaped.
