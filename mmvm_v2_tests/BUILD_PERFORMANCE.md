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
