# ECMA harness preparation performance

## 2026-11-02: share compiled support scripts across forked workers

The guest ECMA runner now reads and compiles selected ancestor `shell.js`
files, `ecma_tests_capture.js` and `ecma_tests_verify.js` once in the parent.
Workers inherit these immutable programs through the existing serial `fork`
isolation. Programs are explicitly retained across baseline restoration and
collection. Harness path discovery is also performed once before the test loop.

Previously, support programs compiled in a worker were cached only in that
worker. Its exit discarded the cache, so the next worker repeated the work.
For example, `ecma/shell.js` is about 17 KiB and applies even to simple
Boolean/Number tests. The root common harness was already prepared once;
this change extends reuse to the additional shared support scripts.

Directory setup still executes afresh for every test, in its original script
boundary and order. Its global declarations, Date initialization and other
side effects are not hoisted into the parent. Test source is still compiled
in its own worker; assertions and result checking still run normally. No
test results or generated files are cached on disk. Compilation failures in
preparation are retried and reported through normal per-file accounting.
Discovery failures likewise remain per-file failures, not suite aborts.

No VM implementation or Test262 harness change is part of this optimization.
Existing process isolation, heap limits, instruction budgets, watchdogs and
the four default exclusions are unchanged. There are no concurrent workers.

## Measurements

Serial runs on the same fixed working VM image, with `TZ=UTC`, selecting:

```sh
./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js --verbose \
    ecma/Number ecma/Boolean ecma_5/strict
```

All four runs execute **98 files: 74 passed / 24 failed / 0 timed out /
0 skipped / 0 not run**, with the same result for every filename. The guest
instruction counts are also identical for every file: harness execution was
not removed. Only preparation/discovery work was moved out of the workers.

| Run | Total runner time | Sum of per-file times |
| --- | ---: | ---: |
| Before optimization | 44.787 s | 32.349 s |
| Shared harness preparation | 26.846 s | 14.221 s |
| Control, preparation disabled | 44.196 s | 31.760 s |
| Shared preparation, repeated | 26.968 s | 14.220 s |

This is about **40% less total time (1.65x throughput)**, and about **55% less
per-file time (2.25x throughput)** on this selection. The first optimized
run prepares seven support programs in 238.722 ms. Total runner time includes
preparation; the gain is not merely a change to the per-file timing window.
The image used for these paired measurements has SHA-256
`a6f75936d2d39094aff3cfc8fcba09ee11927b92f85a5b8a2e4374c109085d16`.
That is a fixed development image, not a checked-in generated artifact.

The optimization is also validated separately from the pending VM/library
work: an exported copy of the staged harness-only changes, using the prior
stable image, executes the same 98 files with the same 74/24 result, in
24.122 seconds. This is a compatibility check, not another paired speedup
measurement. A direct Node positive/expected-exception smoke check passes.

These figures are not a new whole-suite timing or pass-rate baseline.
Expensive failing tests still consume their budgets/watchdogs, and some
directory harnesses perform substantial top-level work. Their execution
cost is deliberately preserved. Full-suite results belong in
[ECMA_TESTS_STATUS.md](ECMA_TESTS_STATUS.md).

## Control and remaining opportunities

Use `--no-harness-preload` on the guest runner to disable the shared source/
bytecode preparation for comparisons. Test semantics and isolation stay the
same. `--verbose` reports the number of prepared programs and preparation
time. The direct Node control accepts the common option but does not use
this guest-only preparation API.

The next useful investigation would separately measure remaining directory
setup execution, heap-state restoration and process transport. The supervisor
currently polls for child completion every 10 ms, which adds latency to very
short files, but changing that transport is not necessary for this first
substantial gain. No transport or VM/context architecture change was made.
