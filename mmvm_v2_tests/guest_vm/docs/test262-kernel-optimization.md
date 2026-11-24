# Test262: optimized versus -O0 inner kernel

Runs completed 2026-11-12, approximately 15:42–15:57 UTC; results recovered
and verified 2026-11-13 following interruption. Source base: `de5e3f5` plus
the accompanying Test262 policy-forwarding change.

## Method

One complete run per policy, serially, using the same optimized standalone
executable. Only the inner test runtime's `kernelOptimization` changes.
The existing corpus, variant selection, 20-million-instruction test limit,
context lifecycle and per-test timing remain unchanged. No test is skipped.
No changes were made beneath `../../js_tests/tests`.

```sh
./artifacts/test262-policy.exe test262_runner.js --kernel-optimization default
./artifacts/test262-policy.exe test262_runner.js -O0
```

The executable was generated with the normal Node snapshot builder and pure-JS
snapshot packager. Its outer kernel is optimized in both runs. These results
do **not** measure changing the outer harness/frontend to -O0 as well.
The harness reports the actual inner runtime policy at startup and in its
summary, rather than inferring it from the launcher filename or flags.

## Complete-suite results

| Metric | Optimized (`default`) | `-O0` (`none`) | Change with -O0 |
|---|---:|---:|---:|
| Files / variants / executed | 3292 / 3292 / 3292 | 3292 / 3292 / 3292 | Identical |
| Passed | 3292 | 3292 | Identical test identities |
| Failed / timed out / not run / skipped | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | None |
| Runner total | 438.576678 s | 439.218511 s | +0.641833 s (+0.15%) |
| Summed variant time | 419.183136 s | 428.843015 s | +9.659879 s (+2.30%) |
| Outside summed variants | 19.393542 s | 10.375496 s | -9.018046 s |

Both processes exited successfully. Variant timings include parsing,
per-test setup and execution, not just native dispatch. The final row is
subtraction, not separately instrumented compilation time; it includes runtime
construction, teardown and suite-level/reporting overhead. Its reduction
offsets most of the increased summed variant time.

The -O0 process's external time receipt records 439.90 seconds wall,
436.67 seconds user CPU, 1.50 seconds system CPU and 512136 KiB peak RSS.
The optimized run did not have an external resource receipt; its sampled RSS
reached 514920 KiB, which is not a measured final peak. Do not treat these as
a controlled memory-usage comparison.

## Slow-test breakdown

All paths below are under `ch07/7.8/7.8.5/`; all are non-strict variants.

| Test | Optimized seconds | -O0 seconds |
|---|---:|---:|
| `S7.8.5_A1.1_T2.js` | 83.275100 | 82.332361 |
| `S7.8.5_A1.4_T2.js` | 82.322590 | 86.433831 |
| `S7.8.5_A2.1_T2.js` | 82.751006 | 89.264319 |
| `S7.8.5_A2.4_T2.js` | 78.987773 | 83.892169 |
| Four-test total | 327.336469 | 341.922680 |
| Remaining 3288 tests | 91.846666 | 86.920339 |

The four tests account for about 78% of optimized summed variant time.
The remaining tests happened to be faster in the -O0 run. With only one pair,
neither small aggregate differences nor that subset establish a repeatable
speedup. The suite includes substantial frontend/setup work in the unchanged
outer VM, so it is not a pure inner-interpreter throughput benchmark. These
results do not contradict the larger Richards optimized-versus-O0 difference;
they measure a different workload. No new profiling-based causal attribution
is claimed here.

## Validation and retained evidence

- Parsed both logs and compared every passing test/variant identity: 3292 each,
  no missing counterpart.
- Focused hosted Node/guest_runner -O0 check: `ch06` passes and reports `none`.
- Direct Node comparison backend: `ch06` passes without guest-only flags.
- A hosted policy mismatch, an invalid policy, and guest-kernel flags supplied
  to direct Node are rejected explicitly.
- Standalone `ch06` without policy flags passes and reports `default`.

Raw logs, build image and external time receipt are temporary files under
`artifacts/test262-*`, not checked-in generated data. See
[harness instructions](../../TEST262.md) for supported flags and hosted versus
standalone behavior. This is not a new all-demo/Octane acceptance run.
