# Direct Node Test262 comparison

This is a separate reference inventory, not the guest VM's conformance ledger.
The Node entry point loads no guest-VM implementation. Both backends share
`test262_runner.js` for discovery, authored strict/sloppy mode, negative-test
classification and reporting; execution is supplied directly by Node's `vm`
API here. No test under `../../js_tests/tests` is modified or skipped.

## Measurements

- 2026-10-29, Node v24.14.1, default per-test result/timing output:
  `node test262_runner_node.js`. Complete inventory: **3,292 executed /
  3,253 passed / 39 failed / 0 not run / 0 timed out**. First full measurement:
  **29.59 seconds elapsed**, user CPU **24.51 seconds**, peak RSS **557,580
  KiB**. Summed test-call time: 26,877.500 ms; runner elapsed time: 29,497.521
  ms. Outer command timing also includes Node startup/discovery. A 10,000 ms
  per-script execution timeout was enabled. Raw log:
  `artifacts/test262-direct-node-full.log`.

- 2026-10-29, final backend repeat with the same default command: identical
  **3,253 passed / 39 failed / 0 not run / 0 timed out** and identical failure
  IDs. **30.10 seconds elapsed**, user CPU **25.94 seconds**, peak RSS
  **541,844 KiB**; test-call sum 29,333.165 ms, runner elapsed 30,013.188 ms.
  Raw log: `artifacts/test262-direct-node-final.log`. These are individual
  runs, not a statistically controlled throughput claim.

The preceding guest result is 3,292/0/0 in 534.16 seconds, recorded in
`TEST262_STATUS.md`. That historical command used verbose output and predates
the new default timing format: it is not a newly paired benchmark. For a clean
comparison, run both current backends with the same selection and reporting
mode; use external wall-clock timing as well if startup cost matters:

```sh
time node test262_runner_node.js --summary-only
time ./artifacts/js_runner.exe artifacts/snap test262_runner.js --summary-only
```

`node --jitless test262_runner_node.js --summary-only` is also available, but
no new whole-suite jitless measurement is claimed here. Node's wall-clock
timeout and the guest's bytecode instruction limit are different mechanisms;
they must not be interpreted as equal execution budgets.

## Interpretation

Modern V8 implements a later ECMAScript edition, not an ES5.1-only mode.
Differences include U+180E whitespace handling, strict arguments/function
properties, duplicate object-literal properties, `__proto__` object-literal
semantics and statement-completion rules. These differences are reported, not
patched away. This inventory is useful for timing and inspection, but a modern
Node pass/failure is not an authoritative answer for every historical ES5.1
test. The guest suite's current all-pass result is kept separate.

## Exact failing IDs

All IDs are relative to `../../js_tests/tests/test262`. The run continues after
each failure and exits nonzero after its full summary.

- `ch09/9.3/9.3.1/S9.3.1_A2.js`
- `ch09/9.3/9.3.1/S9.3.1_A3_T1.js`
- `ch09/9.3/9.3.1/S9.3.1_A3_T2.js`
- `ch10/10.6/10.6-13-b-1-s.js`
- `ch10/10.6/10.6-13-b-2-s.js`
- `ch10/10.6/10.6-13-b-3-s.js`
- `ch10/10.6/10.6-14-1-s.js`
- `ch10/10.6/10.6-14-b-1-s.js`
- `ch10/10.6/10.6-14-b-4-s.js`
- `ch11/11.1/11.1.5/11.1.5-2gs.js`
- `ch11/11.1/11.1.5/11.1.5-4-4-a-1-s.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-b-1.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-b-2.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-c-1.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-c-2.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-d-1.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-d-2.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-d-3.js`
- `ch11/11.1/11.1.5/11.1.5_4-4-d-4.js`
- `ch11/11.13/11.13.1/11.13.1-1-1.js`
- `ch11/11.13/11.13.1/11.13.1-1-2.js`
- `ch11/11.13/11.13.1/11.13.1-1-3.js`
- `ch11/11.13/11.13.1/11.13.1-1-4.js`
- `ch11/11.4/11.4.1/11.4.1-5-a-28-s.js`
- `ch12/12.1/S12.1_A4_T2.js`
- `ch12/12.14/S12.14_A16_T4.js`
- `ch12/12.6/12.6.3/S12.6.3_A9.1.js`
- `ch12/12.6/12.6.3/S12.6.3_A9.js`
- `ch12/12.6/12.6.4/S12.6.4_A15.js`
- `ch13/13.2/13.2-15-1.js`
- `ch13/13.2/13.2-29-s.js`
- `ch13/13.2/13.2-30-s.js`
- `ch13/13.2/13.2-31-s.js`
- `ch13/13.2/13.2-32-s.js`
- `ch13/13.2/13.2-33-s.js`
- `ch13/13.2/13.2-34-s.js`
- `ch13/13.2/13.2-35-s.js`
- `ch13/13.2/13.2-36-s.js`
- `ch13/13.2/S13.2.3_A1.js`
