# Self-hosted source-loading cost

## What the timer includes

The `guest VM source loading` line in `guest_runner.js` does not measure disk
I/O alone. A standalone rebuild deliberately reloads the implementation from
the current files. Each `load` reads/decodes the source, parses it, lowers it
to guest bytecode, verifies/adopts its programs and executes its module setup.
The seed image is the compiler running these steps, not cached build input.

The initial actual self-hosted build measured 21.819675 s in this phase.
Per-file measurements show that compilation dominates, not module execution.
The largest file, `aot/native_interpreter.js`, is approximately 1 MiB and
initially costs about 6.3--6.7 s to compile. Source reads include UTF-8 decoding
and buffer handling, so their measured time is not a raw filesystem latency.

## Changes

- The tokenizer uses a local cursor for whitespace/comments and identifiers,
  committing public positions at token/escape boundaries. The trivia state
  machine preserves CRLF normalization, all ES5.1 line terminators, ASI's
  line-before flag and unterminated-comment positions. ASCII identifier runs
  avoid repeated classification/method calls; non-ASCII and escaped names
  continue through the same authoritative Unicode data and validation.
  No regular expressions are used for token recognition.
  Token dispatch also avoids entering the trivia state machine for an ASCII
  token that cannot start whitespace or a comment. The conservative gate
  leaves controls and Unicode to the authoritative full scanner.
- Consuming compilation uses a scope-aware function summary rather than
  repeatedly walking the same bodies for declarations, eval/arguments,
  captures, return annotations and identifier sets. See
  `FUNCTION_ANALYSIS.md` for ownership and fallback rules. Public mutable ASTs
  retain fresh analyses. Every body is still parsed and lowered.

Neither change copies the seed snapshot, substitutes its implementation for
the current files, skips syntax checking, caches parsed source, introduces
threads or relies on host language semantics.

## Measurements, 2026-10-30

Instrumented source-loading totals, one serial observation per version:

- Before: **22.111055 s**.
- Local tokenizer cursors: **18.542945 s**.
- Cursors plus function summaries: **15.791575 s** (28.6% below the first).

Non-overlapping measured subphases across loaded files:

- Reads/decoding: 1.688 s before, 1.591 s after.
- Parsing: 11.416 s before, 7.530 s after.
- Lowering/analysis: 7.986 s before, 5.685 s after.
- Nested verification/adoption: 0.961 s before, 0.930 s after.

These diagnostic wrappers add overhead. Inclusive outer module execution
timings contain nested loads and must not be added to the child-file totals.

An ordinary, uninstrumented self-hosted rebuild confirms source loading at
**15.874355 s**, versus **21.819675 s** previously (27.2% lower). Whole-build
external elapsed improves from **103.40 to 98.85 s**, not by the same percentage:
other phases dominate and kernel lowering is slower in this observation.
User CPU is 97.40 s and peak RSS 519,552 KiB. Node and genuine self-hosted
outputs compare byte-identically. These are single observations, not a claim
of statistical confidence or a subsecond source-loading implementation.

Final scanner-dispatch follow-up: an uninstrumented self-hosted rebuild loads
the sources in **15.962222 s**, still 26.8% below the original 21.819675 s.
Node, js_min and self-hosted outputs compare byte-identically. The js_min
build takes 86.79 s (85.96 s user CPU; 347,524 KiB peak RSS), versus 90.63 s
at the preceding checkpoint. The final self-hosted whole build takes 103.67 s
(102.96 s CPU; 518,400 KiB peak RSS); runtime preparation takes 68.225 s in
this observation and offsets the source-loading gain. Thus the repeatable
improvement claimed here is in source loading, not in total self-hosted build
time. Runtime preparation remains a separate large cost.

## Reproduction and diagnostics

From `mmvm_v2_tests`, using a freshly built seed image:

```
artifacts/js_runner.exe artifacts/snap guest_vm/tools/profile_source_loading.js
artifacts/js_runner.exe artifacts/snap guest_runner.js --vm-native --snapshot artifacts/rebuilt.snap
```

The first command stops after loading the current libraries, before another
runtime is constructed. It reports per-file read/compile/execute timing and
splits parsing from analysis/lowering and nested verification/adoption. It
instruments the seed frontend so reloading global library names cannot switch
the measured compiler halfway through the operation. No snapshot is generated.

The second command is the actual rebuild and provides the normal aggregate
source-loading measurement. Its output must still be compared with Node and
js_min builds. Improvements to the bootstrap compiler require a fresh seed;
an old seed necessarily processes sources using its older compiler first.

The full Test262 regression check passed all 3,292 tests (no failures,
timeouts or unrun tests). The scanner-dispatch follow-up took 493.30 s;
an adjacent rerun of the unchanged earlier image took 496.28 s at the same
heap settings and effectively identical peak RSS. These are comparable
execution times, not evidence of a significant execution speedup. The older
467.46 s observation and an intermediate 502.26 s run are retained in
`../TEST262_STATUS.md`, rather than being omitted from the timing history.

Raw logs/images remain ignored under `artifacts/source-loading-*`,
`artifacts/source-cursor-*` and `artifacts/source-analysis-*`. The optional
`tools/compare_compilation.js` checks both compilation paths on real sources;
it runs under Node and js_min without golden bytecode or external fixtures.
