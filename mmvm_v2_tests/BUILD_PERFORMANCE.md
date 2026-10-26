# Guest build performance investigation

## 2026-10-26: Node cross-build host

Stock Node can now construct the same i386/Linux standalone image, without
executing native code or using addons. The final Node build took **5.91 s**
(6.72 user, 0.29 system), peak RSS **246,656 KiB**. The initial three-way
comparison measured 6.11 s under Node, 79.23 s under js_min, and 80.60 s for a
genuine self-hosted rebuild; all three files were byte-identical. Node was
about 13 times faster as a construction host in those individual measurements.
The js_min/self-hosted timings remain close to the preceding 77.12/79.26 s
checkpoint, not a demonstrated improvement to the guest interpreter itself.

After the output-adapter cleanup, the complete high-level standalone test
passed again in 241.33 s: two js_min builds with different environments and
application inputs, a Node build, executable-program/environment checks and
a genuine self-build, with byte comparisons. The final image is a dense
8,229,960-byte file; its independent heap audit reports 33,315 reachable
records and no missing marks. Temporary images are not checked in.

See [Node snapshot construction](guest_vm/NODE_SNAPSHOT_BUILD.md) for the
shared serialization design, deferred binding boundary and reproduction.

The objective is substantially faster genuine snapshot construction under
both js_min and the standalone guest, ultimately favoring the standalone
guest. No source/parse cache, snapshot-copy shortcut, benchmark-specific
replacement or C support code is part of the approach. Existing demo sources
and the external `js_tests` tree remain untouched.

## 2026-10-26 packed-object checkpoint

This cutover is a representation/lifetime improvement, not yet a build-time
win. The pre-cutover reference (`bfec626`) constructed a snapshot under js_min
in 74.87 seconds and genuinely rebuilt it under itself in 73.33 seconds.
The packed-scan checkpoint (`dfbdfca`) took 76.20 and 79.97 seconds respectively.
Both new images were byte-identical, 8,194,224 bytes, with no sparse-file
shortcut. Self-build peak RSS was 493,096 KiB versus 463,480 KiB for the
reference. These are individual same-machine measurements, not statistical
throughput estimates; they do not demonstrate the requested speedup.

The complete bounded Test262 inventory retains exactly the reference's
3,139 passing and 153 failing cases. Its 412.72-second wall time remains
above the 308.96-second reference repeat, although below the initial
587.10-second cutover run. Checked string-span decoding and length/hash
rejection before packed-key text comparisons recovered much of that loss.
Inclusive phase profiling is available below to guide further work rather
than attributing every cost to object lookup or GC.

After the independently validated platform timer-lifetime fix, the final
pair took 77.12 seconds (js_min) and 79.26 seconds (self-hosted); peak RSS was
304,676 and 492,780 KiB respectively. Both dense files are byte-identical at
8,201,744 bytes. That follow-up fixes raw Node timer objects crossing into
the guest heap; it is not a build-performance optimization.

## Locating host-side costs

From `mmvm_v2_tests`, the ES3-compatible phase profiler runs the real runner
and existing test inputs under either host, without npm or new C support:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/profile_host_runtime.js \
  --vm-native test262_runner.js --quiet --instruction-limit 20000 \
  ch10/10.4/10.4.2/S10.4.2_A1.1_T10.js

node guest_vm/tools/profile_host_runtime.js --vm-native test262_runner.js \
  --quiet --instruction-limit 20000 ch10/10.4/10.4.2/S10.4.2_A1.1_T10.js
```

It reports inclusive call counts, accumulated milliseconds and maximum call
time for runtime, record-layer and native-entry methods, including startup.
Child times overlap parent times: do not sum the rows. Wrappers and clocks add
overhead, so these are cost-location diagnostics, not throughput measurements.
The wrappers are noncapturing functions backed by an explicit diagnostic
registry. Capturing wrappers around these re-entrant methods triggered a
Firefox 1 activation-lifetime crash during startup; that form is not used.
No wrapper or registry is installed in ordinary runner execution.

## Preconditions and baseline, 2026-10-24

Before performance edits, rebuilt the unchanged ANSI i386 launcher and produced
an unmodified-source snapshot with the existing js_min binary/library path.
Its SHA-256 was `7cd604ea1c285b90751063d3084279fffe526f9be9821c7129991c357ef53947`,
matching the previous snapshot-size checkpoint. Artifacts had been cleared;
js_min itself was not rebuilt. All results/logs go under ignored `artifacts/`.

- Demo1/2 ran interactively, accepted input and exited; demo2 was also visually
  inspected. Demo3–7 each ran with a 25-second process cap; both rally demos
  completed course initialization and rendered. Demo8 ran with a 60-second
  cap, not a seven-minute soak. These are smoke checks, not exhaustive visual
  equivalence or GC tests. GC pressure now has its own bounded test.
- The eight previously stock-passing Octane suites were checked in separate
  processes using the wrapper's **quick correctness** mode, not stock scoring.
  Richards, DeltaBlue, Crypto, RayTrace and NavierStokes passed. EarleyBoyer,
  Splay and zlib segfaulted, so performance work was held pending diagnosis.
  RegExp remains out of scope, and the six previously failing suites are not
  silently presented as passing.
- A full authored Test262 language run with a **20,000-instruction diagnostic
  cap per test** crashed before completion. A verbose repeat captured 2,411
  passes and 59 failures before another crash. This is not a complete-suite
  total. The cap is explicit and is not an unbounded conformance result.

## Scratch corruption prerequisite fix

Hardware watchpoints showed the engine platform-services link being overwritten
by the native array-search temporary. See `GC_STRESS.md`. This was a VM memory
layout defect, not failure to execute i386 software or an Octane-specific case.

After expanding scratch slots and correcting typed temporary initialization:

- All eight previously passing suites pass quick correctness, including the
  three which crashed at baseline. Stock-score/longer-run validation remains
  separate; quick results are never reported as Octane scores.
- The bounded authored Test262 run completes all 3,292 tests: **3,139 pass,
  153 fail, 0 not run**. Six failures are diagnostic instruction timeouts.
  Elapsed 353.26 s; peak RSS 249,208 KiB. Comparing exact variant IDs preserves
  every one of the 2,411 recorded baseline passes; no passing-to-failing
  regression was observed in that inventory. A complete pre-fix control was
  impossible because it crashed.
- The bounded GC driver passes under Node and js_min. The standalone workload
  passes with 35 automatic native collections in 0.38 s / about 20 MiB RSS.

These prerequisite correctness changes precede the build optimizations. Raw
logs use `artifacts/build-precheck-*`, `artifacts/build-scratch-*` and
`artifacts/gc-stress-*` prefixes. Generated files are not committed.

## Optimization order and acceptance

The user-supplied serial build comparison was 84.043 s under js_min versus
176.013 s self-hosted. Parsing was near parity; the main phase outliers were
canonical AST fingerprinting (3.058 versus 26.285 s) and machine-code assembly
(1.791 versus 15.499 s). Final backing sharing was 13.939 versus 34.332 s.

1. Remove repetitive object enumeration/sorting and temporary token creation
   in canonical fingerprinting, retaining the same canonical hash semantics.
2. Improve general machine-code byte construction and fixups rather than
   replacing a particular compiler function with handwritten machine code.
3. Remove repeated search setup/validation from immutable-backing matching.
4. Time source loading explicitly as well as constructor/lowering/assembly.

Compare serial builds under both hosts, verify a genuine byte-identical
self-hosted rebuild, preserve the below-8-MiB image, and rerun correctness and
bounded GC checks at working points. Improvements must not depend on skipping
fingerprinting, caching a previous parse/build or changing demo programs.

## Canonical field-schema reuse, 2026-10-24

Fingerprint traversal now reuses validated sorted field schemas and field-token
digests within one compilation transaction. Each occurrence still enumerates
and validates every own semantic field; differing optional fields rebuild the
schema. Primitive values and child order remain in the canonical stream.
Nothing is retained across builds. Full interpreter/collector source hashes
match the previous implementation, as do mixed-shape sample hashes.

Both-host project regressions pass. A genuine self-hosted build is byte-identical
to its js_min seed; the dense image is 8,336,464 bytes (below 8 MiB).
The first self-hosted fingerprint stage took 7.718 seconds versus the earlier
26.285-second measurement. This is a phase observation, not an end-to-end
speedup claim: the first bootstrap overlapped regression tests, and this
self-build took 188.32 seconds overall with other stages slower than the older
measurement. Controlled serial measurements and remaining bottleneck work
are still required. Logs: ignored `artifacts/fingerprint-opt*.log`.

## Bounded string-search setup, 2026-10-24

The snapshot finalizer now prepares each flat string's length, encoding and
relative character offset once, rather than repeatedly validating record type
and reading flags for every candidate/owner pair. Descriptors are borrowed
only for the synchronous immutable-backing pass: owners remain flat, matched
candidates are discarded after conversion, and no descriptor enters the image.
Actual searches still pass through checked memory ranges. Wider strings use
the existing exact code-unit search, reusing decoded text within the pass.
Retired character payloads are cleared with the existing checked bulk fill.

Serial measurements on this machine (seconds):

- Fingerprint-only bootstrap: 89.80 total, 2.667 fingerprint,
  13.815 final backing sharing. Image matches the prior fingerprint seed.
- Bulk-clear bootstrap: 86.70 total, 13.690 sharing. Self-build: 177.56 total,
  37.841 sharing; byte-identical to that seed. Clearing alone is a small win.
- Prepared-search bootstrap: **74.65 total**, 2.478 fingerprint,
  **3.747 sharing**. Genuine self-build: **142.06 total**, 7.232 fingerprint,
  **8.853 sharing**; byte-identical to that seed. Image: **8,338,904 bytes**.
- Relative to the immediately preceding bulk-clear builds, these totals are
  about 14% faster under js_min and 20% faster self-hosted. They are individual
  serial observations, not statistical benchmark averages. The older
  user-supplied 84.043/176.013-second builds had different source revisions.

The guest still trails js_min end-to-end. Runtime preparation (71.840 versus
52.016 seconds) and assembly (15.163 versus 1.928 seconds) remain significant
targets. This is not a claim that the overall performance objective is done.
Logs: ignored `artifacts/fingerprint-serial.log`, `artifacts/bulk-clear*.log`
and `artifacts/prepared-search*.log`. No C, demo or external test source changed.

Validation at this working point:

- Both-host project suites pass: 12 guest programs / 270 guest assertions per
  host, plus embedding, native compilation and command-line paths.
- All eight previously working Octane suites pass quick correctness checks;
  these runs are not stock-score measurements. RegExp was not run.
- Standalone bounded GC workload passes with 35 automatic collections.
- Focused Test262 `ch09/9.5 ch11/11.6 ch11/11.7`, 20,000 instructions/test:
  165 executed, 164 passed, one failed, zero not run/timeouts. The single
  failing ID exactly matches the scratch-fixed full baseline. No complete
  suite rerun is implied by this focused check.
- Seed/rebuild SHA-256:
  `efca70e95bb14c987874158c7b0eeb1afa21b84cde5c0c40f8d2ba859a19943d`.

## Native macro-assembler storage, 2026-10-24

The x86 backend now accepts `captureBytes: false`. On an MMVM host this uses
an explicitly owned, growing native byte buffer; the ordinary array-backed
default remains available for inspection and Node. Instruction selection,
macro dumps, labels and fixups are unchanged. Packed little-endian writes and
a bulk copy install the code. Compilation's `finally` releases temporary
buffers, including when emission fails. The public result's `bytes` is null
only on the native opt-out path; its pointer, length and symbols remain usable.
The interpreter build explicitly selects that path. No machine-code literals
were added outside the existing macro instruction definitions.

The existing compiler regression compares both storage policies' instruction
bytes/macro dumps and executes both results. It caught a backward-fixup signed
conversion bug during development: shell poke32 must receive a signed word,
not an unsigned number outside the C int range. This was fixed before keeping
the candidate. The full 354,150-byte interpreter stream also matches the
preceding array-backed snapshot exactly, including buffer growth/fixups.

Serial bootstrap: 74.55 seconds total, 1.494 seconds assembly; genuine
self-build: 135.57 seconds total, 14.850 seconds assembly, byte-identical.
The self-hosted assembly gap remains: byte storage was not its dominant cost.
Prototype-method lookup in the guest interpreter is the next investigation,
not a reason to claim these figures close the overall performance gap.
Logs: ignored `artifacts/native-emission*.log`.
Both-host project suites, all eight previously working Octane quick suites and
the standalone bounded GC workload pass at this checkpoint. The instruction
stream is unchanged, so this is a storage-policy change, not a new language
implementation or a claim of new Test262 conformance.

## Optional native sampling

For a genuine self-build from a fresh snapshot matching the current kernel:

```sh
./artifacts/js_runner.exe artifacts/snap guest_runner.js --vm-native \
  --vm-native-samples --snapshot artifacts/profiled.snap
```

This opt-in diagnostic uses libc `profil` and its single-threaded signal
sampling, not threads, a JS timer callback or privileged perf events. A small
counter buffer covers only the executing interpreter's code range. Cleanup
disables sampling, maps counts through macro-assembler function symbols and
frees the buffer. A source-fingerprint guard rejects mismatched symbol maps.
Code/header offsets come from the backend's shared standalone-header fields.
It excludes time in libc and the initial source-loading setup before sampling
starts; percentages are not percentages of total build wall time. Do not
combine it with another SIGPROF-based profiler. Normal invocations do not load
the sampler or enable a signal timer.

An initial profile recorded 10,654 in-kernel samples: 53.2% in dispatch,
14.6% string-key equality, 8.6% indirect character lookup and 4.6% flat
character lookup. Register-bank initialization accounted for only 1.1%.
This is why subsequent work targets general string/property lookup rather
than assuming register initialization dominates. A first flat-storage
comparison experiment reduced wall time, but string equality and character
traversal still consumed roughly a third of samples; canonical key hashing
is being evaluated next. Raw profiles stay in ignored artifacts.

All tests and benchmarks are now run **serially**. An overlapping profiling
build was explicitly interrupted when the memory/concurrency requirement was
clarified; its partial timings are not used as performance measurements.

## Frontend, register and key-lookup work

The current candidate also contains these general changes:

- The standalone bootstrap passes `GuestVM.Frontend` explicitly to
  `installEvalCompiler(frontend)`. This bundle contains the already-loaded
  Parser, Compiler and verifier. CommonJS modules have fresh contexts, so
  looking for shell globals inside the module does not accomplish reuse.
  Dependency loading is lazy, with the existing require path retained when
  no bundle is supplied. This is same-runtime implementation reuse, not a
  source/parse cache or a snapshot-copy rebuild.
- A conservative bytecode register-packing pass reduces frame/register storage;
  see `guest_vm/REGISTER_ALLOCATION.md`. An initial backend compilation reduced
  7,046 register cells to 4,257, but that count alone did not improve total
  build time. Its compilation cost remains a target for refinement.
- Kernel inline-eligibility analysis stops once a function exceeds its budget,
  rather than traversing the remainder of a body that cannot be eligible.
- String equality resolves views once and compares complete bounded words
  where encodings match. Mixed widths and ropes retain exact code-unit checks.
- Canonical key hashes are lazy. One exact `HeapRecords.stringHashStep`
  implementation runs as ordinary JS and as a compiled kernel dependency.
  Partial-word multiplication avoids binary64 low-bit rounding differences.
  A validity flag distinguishes canonical hashes, including a valid zero,
  from constructor hashes not safe for rejection. Equal hashes are never
  accepted without exact comparison.
- The existing weak property cache is content-keyed, so newly constructed but
  equal computed keys can hit it. Constant/computed get and set paths share
  positive own-property lookup; prototype traversal and descriptor checks
  remain explicit. Record identity/version/head and GC invalidation guards
  are retained. No missing-property result or complete chain is cached.

The content-key cache seed builds in 75.72 seconds under js_min; its genuine
self-build is byte-identical and took 118.04 seconds with optional sampling
enabled. Assembly was 1.459 versus 6.370 seconds. These are progress figures,
not parity: unreported initial source-loading time accounts for much of the
remaining gap. Snapshot builds now log that phase explicitly.

Before canonical hashing/content-cache changes, the complete bounded authored
Test262 run again executed 3,292 variants: 3,139 passed, 153 failed, zero not
run, six timeouts included in failures (344.49 seconds, 270,516 KiB peak RSS).
The later key changes require their own regression inventory; do not present
that earlier full run as validation of those later changes. Logs are ignored
`artifacts/packed-registers-*` and `artifacts/content-key-cache-*`.

The content-key checkpoint passes both-host project suites (12 programs / 270
guest assertions each), all eight previously working Octane quick suites and
the standalone 35-collection GC workload, run serially. Demo8 also starts,
switches to garage and free-drive auto pilot, renders and exits normally in a
short controlled check at 320x240 with a 10 FPS cap. That is a correctness
smoke check, not evidence of a 20 FPS performance target or a long GC soak.
Its snapshot is 7,954,320 bytes, byte-identical to the genuine self-build.

## Lean compiler traversal, 2026-10-24

Compiler syntax walkers now skip the parser's actual `location` metadata
field, rather than an unused `loc` name. Capture-free nested functions no
longer force every enclosing binding into an environment: a conservative
identifier scan still pins bindings for possible captures, nested direct eval,
try and with. Shadowing may reject an optimization, never justify one.

Temporary allocation now follows single-definition instruction order. It
creates neither interval objects nor a comparison closure, and observes
operands directly instead of entering a capturing callback per access. This
reduces both compiler work and transient allocation without changing the
allocation ordering proved in `guest_vm/REGISTER_ALLOCATION.md`.

Serial seed build: **70.64 seconds**, source loading 0.189 seconds and runtime
preparation 49.276 seconds. Genuine self-build with optional sampling:
**110.24 seconds**, source loading **24.673 seconds**, preparation 51.854
seconds. Peak self-build RSS was **448,908 KiB**, versus 549,260 KiB in the
preceding cache build. Sampling/report overhead is included in the sampled
wall time, so a final unsampled comparison remains necessary. The image is
byte-identical to its seed. Both-host project suites, all eight previously
working Octane quick suites and standalone bounded GC stress pass, serially.

The gap is not closed. Long ordinary-object property-list scans still dominate
key comparisons. The next implementation is an optional compact heap-owned
index for larger objects, preserving authoritative property-list enumeration
and exact descriptor/prototype semantics. Logs: ignored
`artifacts/lean-compiler*.log`.

## Global lookup and ordered-storage foundation, 2026-10-24

Global reads, writes and `typeof` now use the existing guarded own-property
lookup cache instead of rescanning the global list on each access. Large
ordinary objects can additionally own a derived, optional lookup index. The
list remains authoritative during migration; descriptor handling, prototype
lookup and insertion-order enumeration are unchanged. This index is a bridge,
not the final packed-entry representation described in `PROPERTY_STORAGE.md`.

A genuine **unsampled**, serial build comparison now gives **72.12 seconds
under js_min versus 71.82 seconds self-hosted**. The two snapshots are byte
identical, **8,076,696 bytes** each. Peak RSS was 314,468 versus 457,916 KiB.
This closes the total wall-time gap in this run, not every individual phase:
build-source loading still takes 0.202 versus 20.865 seconds. Self-hosted
runtime construction takes 10.990 seconds and preparation 35.516 seconds;
js_min takes 15.399 and 50.133 seconds respectively. These are measured builds,
not cached parses or copies of the input snapshot. Logs are ignored
`artifacts/ordered-storage-stage1*.log`.

Packed ordered entries are implemented as a separately validated heap
component, including growth, stable compaction, tombstones, descriptors and
both collectors. Ordinary object storage has **not** switched to it yet.
Owner/entry APIs and cache lifetime conversion must precede that cutover.

Validation at this checkpoint, all heavy workloads serial: both-host project
suites (12 programs / 270 assertions per host), eight previously working
Octane quick correctness suites, and the bounded standalone GC workload
(42 collections) pass. Complete bounded Test262 has exactly the same 153
failing IDs/variants: 3,139 pass / 153 fail / zero not run, 312.21 seconds
and 319,440 KiB peak RSS. See `TEST262_STATUS.md` for the cap and baseline.
Short X11 checks of unchanged demos 1–8 render, accept input and exit normally;
demo8 visits garage and free-drive auto pilot. These are smoke checks, not
sustained performance tests: demo8 briefly reports 16.3 FPS at 320x240 with
a 20 FPS cap, and no claim of a sustained 20 FPS is made.
