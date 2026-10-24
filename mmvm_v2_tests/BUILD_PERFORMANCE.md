# Guest build performance investigation

The objective is substantially faster genuine snapshot construction under
both js_min and the standalone guest, ultimately favoring the standalone
guest. No source/parse cache, snapshot-copy shortcut, benchmark-specific
replacement or C support code is part of the approach. Existing demo sources
and the external `js_tests` tree remain untouched.

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
