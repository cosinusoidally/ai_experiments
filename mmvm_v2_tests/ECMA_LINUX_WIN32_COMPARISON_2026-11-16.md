# ECMA: existing Linux harness versus Windows harness

## Result

**No Windows-only failures were found among any of the 997 Linux-passing
files. All 997 passed through the Windows in-process harness under Wine.**
There were zero Windows timeouts, fatal exits or untested files in that set.

The Linux baseline is a fresh complete run of the existing fork-supervised
harness, not an in-process Linux replacement or just the previous TSV. Both
executables embed exactly the same supplied contract-109 snapshot. Neither
the VM nor either harness was changed for this comparison.

## Scope and method

1. Run all four ECMA trees through the ordinary Linux harness, preserving its
   default exclusions, per-test fork isolation and ten-second process watchdog.
2. Collect the exact passing filenames and execute every one through the new
   Windows in-process harness with its cooperative ten-second deadline. Use
   existing filename selectors, not corpus edits or new skips.
3. Compare by filename. A test already failing Linux cannot be an additional
   Windows failure relative to this baseline, so it needs no Windows execution
   to answer the question.

Windows selections used three serial invocations (393, 360 and 244 files) to
keep command lines bounded. All three exited successfully. This does not
establish that an uninterrupted Windows whole-suite invocation can finish:
the known shared-failing substring case still aborts it, as documented in
`ECMA_WIN32_STATUS.md`. Nor does it exercise every cross-test interaction after
the 332 Linux-failing files. No Windows pass/fail status is inferred for those
excluded-from-comparison cases.

## Fresh Linux baseline

- Selected: **1333**; executed: **1329**.
- **997 passed / 332 failed**, including **39 timeouts**.
- **4 existing configured skips / 0 not run**.
- All 1333 filename statuses exactly match the tracked `5163ff6` column in
  `ECMA_TEST_RESULTS.tsv`: zero changed or missing statuses.
- Process **609.77 seconds**, peak RSS **463900 KiB**; harness 609461.509 ms.

## Windows results for the full Linux-pass set

| Tree | Linux-passing files selected | Windows passed | Windows non-passes |
| --- | ---: | ---: | ---: |
| `ecma` | 473 | 473 | 0 |
| `ecma_2` | 149 | 149 | 0 |
| `ecma_3` | 177 | 177 | 0 |
| `ecma_5` | 198 | 198 | 0 |
| Total | **997** | **997** | **0** |

No candidates required isolated reruns. Reinvoking the completed supervisor
also confirmed resume handling without launching another test process.

Measured Windows process times by batch: 65.89, 48.39 and 52.34 seconds;
peak RSS: 443276, 320880 and 336592 KiB. Do **not** compare their sum with
the full Linux time as an interpreter-speed claim: Windows did not execute
the 332 Linux failures, many of which consume a full ten-second watchdog.
Supervisor/stream-shutdown time adds overhead beyond these process timings.
The local Wine version was `wine-11.0`, using the supplied 32-bit prefix.
Only one test process was active at a time.

## Reproduction

From `mmvm_v2_tests`, with executables built from the same snapshot:

```sh
mkdir artifacts/ecma-platform-comparison
/usr/bin/time -v ./artifacts/ecma-linux.exe ecma_tests_runner.js --verbose \
  > artifacts/ecma-platform-comparison/linux-full.log 2>&1

. ../../wine/32.sh
node guest_vm/tools/compare_ecma_windows.js \
  artifacts/ecma-platform-comparison/linux-full.log \
  artifacts/test.snap artifacts/ecma-linux.exe artifacts/js.exe \
  artifacts/ecma-platform-comparison/windows
```

Linux returns status 1 for its known failures; inspect its complete summary
before invoking the tool. The tool requires a complete baseline and verifies
that both executables contain the exact input snapshot. It records per-file
Windows results, batch logs and input hashes. Reinvoke with unchanged inputs
to resume. Non-passing candidates make its final exit status nonzero. An
infrastructure SIGSYS stops the comparison, without workarounds or retries.

Node supervises this diagnostic only: it provides no guest test semantics and
is not a dependency of the Windows ECMA runner. No C changes, corpus edits,
threads or Windows process-management implementation were introduced.

## Image and receipt identity

- Snapshot: `9c79d33d589a16b297b5b389ce9d1d3ee2dc67450589e2cc328cee7776fd2c42`.
- Linux ELF: `f969d8183ccb3c92ce8636b2e956eada73338c671e8e143409150c9f4d33f1bf`.
- Windows PE: `3222fb8bb907f4c04d6e25d57aca0253ab47b27f17314a81d4b85906b11c5a3c`.
- Linux log: `b8b9cb15a65cfa3fee0bb3f9ad1ffbe0353e1d528203f6bf747c7f48351be8f3`.
- Harness digest: `8201900e6b0641d233caae8bfe681de51276abffccf2d9f056468fb313292913`.
- Corpus/input-shell digest: `e89298fc7d96f9d9b93d0fa18870c5190c0ceb10630b8c4e2e1fd641d655a48f`.

Detailed receipts are temporary in `artifacts/ecma-platform-comparison/`;
this report preserves the result when artifacts are cleared.
