# Bootstrap compatibility regression validation — 2026-11-14

Status: ECMA complete; Octane in progress. VM implementation under test:
`8767315`; documentation checkpoint `9140cbf`. No external corpus, application
source, test selection or execution-limit changes.

## Method and already completed checks

Run one memory-heavy workload at a time. Existing i386 binaries execute
directly; no emulation, threads, downloads or C modifications. Generated
snapshots, executables, logs and timing receipts remain in ignored artifacts.

- The unchanged mishmashvm full bootstrap passes in its original directory,
  with all eight final objects byte-identical to a sequential local jsshell
  reference. Guest 233.45 seconds / 558340 KiB peak RSS; jsshell 12.10 seconds /
  79616 KiB. This is functional, not performance parity.
- Node and js_min core suites pass: each 12 guest programs / 270 assertions,
  plus the internal heap/compiler/interpreter checks.
- Standalone shell/FFI integration passes, including native pointers, typed
  byte sources, radix formatting and binary-read type identity.
- The default standalone image genuinely rebuilds itself from source and
  produces a byte-identical image. Image SHA-256:
  `bb81fe1510cac443237486f912b50c9f97c725d300a9604c227fa686c2f79b91`.
- Full Test262: 3292 passed / zero failed / zero timed out / zero not run.
  Harness elapsed 340626.683 ms versus previous 340013.538 ms; this single
  0.18% difference is not evidence of a performance regression.
- Packaged default executable: all eight bounded demos, three HTTP servers
  and seven supplementary checks, including structural GC, pass with its
  input snapshot absent. These are not long endurance tests.

See [bootstrap details and reproduction](guest_vm/MISHMASHVM_BOOTSTRAP.md).

## Remaining full-suite runs

The measured default executable is `artifacts/bootstrap-regression.exe`:
SHA-256 `4f93cd633eb7112cf5f6c3ef8637e108084d0bde47600b14d4dcaeb7285575c7`.
It is distinct from the shell-policy `artifacts/js` used by mishmashvm.

ECMA uses the existing default four configured skips, no total instruction
cap and its unchanged 10-second per-test watchdog. Preserve known failures
as failures and compare actual filenames, not just pass totals. The complete
archived acceptance log has SHA-256
`e46a60d6ef05b0dd94b40d46d1062bc5b58a667ecf34c1717d5cd534642a60fa`:
994 pass / 335 fail, including 39 timeouts / four skips / zero not run.

Each of the 15 stock Octane suites runs separately with normal setup,
warmup, timing and correctness checks, not `--quick`. A 1800-second process
watchdog bounds each suite. RegExp and Mandreel are included. Commands:

```sh
artifacts/bootstrap-regression.exe ecma_tests_runner.js
artifacts/bootstrap-regression.exe octane_runner.js --diagnostics SUITE
```

Full logs and per-process time/RSS receipts:
`artifacts/bootstrap-final-suites/`. Results will be recorded below once
the serial run completes. Previous full comparison:
[November 13 validation](FULL_VALIDATION_2026-11-13.md). Different-revision
single observations alone do not attribute a timing change to a particular
bootstrap fix.

## ECMA complete

- 1333 selected / 1329 executed / **996 passed / 333 failed**, including
  **39 timeouts**, four pre-existing configured skips, zero not run.
- Exact comparison of all 1333 filename statuses with the archived acceptance
  log: **zero lost passes, two gained passes, zero missing results**. The only
  changed statuses are FAIL to PASS:
  - `ecma/Date/15.9.5.23-6.js` (uses current-time input; the archived failure
    expected fractional milliseconds, so do not claim this as a Date fix).
  - `ecma_2/String/split-002.js` (archived failure: non-callable value).
- All 994 baseline-passing files still pass. Known failures remain failures;
  exit 1 is expected for this corpus and is not silently counted as success.
- Harness elapsed 617095.672 ms; process 618.73 seconds; peak RSS 463860 KiB.
  Previous full executable observation: 654.192 s harness / 654.485 s process,
  463832 KiB RSS. One observation is not a controlled timing attribution.
