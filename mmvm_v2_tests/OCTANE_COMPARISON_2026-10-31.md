# Octane: standalone guest versus Node --jitless, 2026-10-31

## Measurement contract

This comparison runs the unchanged stock Octane workloads, not quick
correctness. Their original setup, timed work and correctness checks remain
enabled. Each engine/suite runs in a fresh process, one workload at a time.
No files under the external `../../js_tests` checkout are changed.

- Guest VM source: collector-corrected PdfJS checkpoint `4e0745e`.
- Guest executable: i386 `artifacts/js_runner.exe`, unchanged C launcher.
- Native contract: 87. Snapshot size: 6538776 bytes; SHA-256
  `8816444bc3c279687fd583efd372ef2d5dd92c7c88dd7d558816a5a39005cab8`.
- Node reference: v24.14.1, x86-64, **--jitless** explicitly enabled. This is
  not the default-JIT reference from the October 30 report.
- Host: Linux 6.8.0-138-generic, QEMU Virtual CPU version 2.5+.
- Limit: 900 seconds per engine/suite, TERM then five seconds KILL grace.
  Core dumps are disabled. No concurrent benchmark workloads.
- First batch began 2026-10-31 09:47:35 UTC: fourteen suites, initially
  excluding the deferred Mandreel bring-up. A separate bounded Mandreel
  measurement completes coverage of all fifteen without implementing fixes
  for that workload.

Reproduce the first batch from `mmvm_v2_tests` with a fresh output directory:

```sh
node octane_compare.js --node-jitless --snapshot artifacts/pdfjs-gc-fixed.snap --exclude Mandreel --output artifacts/octane-pdfjs-jitless-2026-10-31 --timeout 900
```

The supervisor uses Node only to run the reference engine and orchestrate
separate processes. Guest language execution is the standalone image, invoked
as `artifacts/js_runner.exe SNAPSHOT octane_runner.js SUITE`; no JavaScript
host implements its operations. The comparator records reference flags in
results.json. Raw JSON, logs, images and binaries stay in ignored artifacts.

Scores are higher-is-better single observations, not confidence intervals.
Node score / guest score is a normalized score advantage, **not a wall-time
ratio**: Octane adapts repetition counts. Wall times include source loading,
compilation, setup, execution and teardown, but exclude snapshot generation.
Splay's suite score combines throughput and latency.

## Results

The first batch completed at 10:09:22 UTC: **guest 13 passed / 1 semantic
exit**, **Node --jitless 14 passed**. All thirteen previously working guest
suites, including the newly brought-up PdfJS, pass the original stock checks.
Mandreel's separate measurement is in progress; no aggregate guest Octane
score is valid while suites remain failing or unfinished.

| Suite | js_runner score/status | Node --jitless score | Node score advantage |
| --- | ---: | ---: | ---: |
| Richards | 96.6 | 636 | 6.58x |
| DeltaBlue | 92.2 | 801 | 8.69x |
| Crypto | 190 | 659 | 3.47x |
| RayTrace | 239 | 1989 | 8.32x |
| EarleyBoyer | 446 | 2911 | 6.53x |
| RegExp | 2.57 | 1426 | 554.86x |
| Splay, combined | 665 | 3840 | 5.77x |
| NavierStokes | 280 | 923 | 3.30x |
| PdfJS | 776 | 5042 | 6.50x |
| Mandreel | measurement pending | 1489 | -- |
| Gameboy | 1012 | 3824 | 3.78x |
| CodeLoad | 96.6 | 19058 | 197.29x |
| Box2D | 378 | 2089 | 5.53x |
| zlib | 581 | 896 | 1.54x |
| Typescript | semantic exit: unsupported module | 10187 | -- |

Per-suite wall time / peak RSS (guest versus Node --jitless):

- Richards: 3.36 s / 20736 KiB versus 2.27 s / 44012 KiB.
- DeltaBlue: 4.32 s / 56448 KiB versus 2.09 s / 47088 KiB.
- Crypto: 23.47 s / 39424 KiB versus 9.58 s / 45160 KiB.
- RayTrace: 12.16 s / 235776 KiB versus 3.09 s / 47340 KiB.
- EarleyBoyer: 29.22 s / 403200 KiB versus 6.26 s / 110256 KiB.
- RegExp: 639.42 s / 532224 KiB versus 2.25 s / 55196 KiB.
- Splay: 4.10 s / 396672 KiB versus 2.37 s / 279284 KiB.
- NavierStokes: 9.97 s / 24576 KiB versus 4.44 s / 49304 KiB.
- PdfJS: 19.45 s / 254752 KiB versus 1.24 s / 104748 KiB.
- Gameboy: 14.33 s / 111480 KiB versus 2.87 s / 78652 KiB.
- CodeLoad: 31.12 s / 395008 KiB versus 2.14 s / 158392 KiB.
- Box2D: 15.07 s / 113792 KiB versus 2.24 s / 65976 KiB.
- zlib: 263.41 s / 116480 KiB versus 170.68 s / 48288 KiB.
- Typescript failure: 12.90 s / 134872 KiB versus the passing reference's
  12.75 s / 217556 KiB. Guest error: `unsupported guest module: module`,
  followed by THROW pc 288. This is a missing platform module, not a claim
  that the CALL opcode itself is absent.

The prior October 30 guest observations were Richards 98.5, DeltaBlue 91.1,
Crypto 190, RayTrace 247, EarleyBoyer 445, RegExp 2.66, Splay 669,
NavierStokes 281, Gameboy 1051, Box2D 376 and zlib 588. Most current scores
are within about four percent; this is not evidence of a causal speedup.
CodeLoad is lower than the later 104 observation (31.12 s versus 28.60 s),
and close to its initial 96.4 stock pass. The lower result is recorded rather
than claiming uniformly improved performance. PdfJS previously failed and
now passes; comparison with a previous failing time is not a speedup ratio.

## Independent regression validation

- Project suite passed under Node and js_min: 12 guest programs / 270
  assertions, plus the command-line and three-context checks.
- Complete Test262 on the collector-corrected image: 3292 passed, zero
  failed, zero not run, zero timed out; 497.68 s external elapsed. See
  TEST262_STATUS.md for the historical pass/fail ledger and prior timings.
- Bounded GC workload: 24 rounds / 48 standalone native collections.
  Structural audit passes 27 audits / 101999 edges / 76 embedding collections
  under an 8 MiB cap, including the final bound-function ownership assertion.
  Node workload/audit time 12.131 s; js_min 38.723 s after 18.795 s runtime
  construction. A hosted i386 retention regression found during validation
  was fixed using explicit callback ownership, not hidden by shortening runs.
- Node, js_min and genuine self-hosted snapshot builds compare byte-identical.
  Matched js_min build: 99.05 s versus 94.72 s for the old-image control
  (about 4.6% longer); self-hosted rebuild 110.05 s. No build-speed
  improvement is claimed. See guest_vm/PDFJS_BRINGUP.md for mechanisms and
  intermediate failures as well as successful checks.
