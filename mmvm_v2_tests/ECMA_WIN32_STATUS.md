# ECMA under Win32/Wine

## 2026-11-16: complete comparison of all Linux-passing tests

Fresh existing Linux fork-supervised run: **997 passed / 332 failed (39
timeouts included) / 4 default skips / 0 not run**, 609.77 s, 463900 KiB RSS.
Every filename status matches the tracked Linux baseline.

All **997 Linux-passing filenames also pass on Windows**, using the same
snapshot and the new in-process harness. Zero Windows-only failures,
timeouts, aborted files or unfinished comparisons in that set. The 332 Linux
failures and four default skips were not selected for this Windows comparison;
they are not counted as Windows passes. The known shared substring failure
still prevents an uninterrupted whole-suite Windows invocation.

See [the matched-image comparison](ECMA_LINUX_WIN32_COMPARISON_2026-11-16.md)
for per-tree counts, exact scope, commands and input identities. This
supersedes the earlier partial comparison's limited coverage, not its receipt.

## 2026-11-16: initial in-process bring-up

The existing PE guest executable can discover and execute the ECMA corpus
through `ecma_tests_runner.js`. No Node engine, process supervisor, fork shim,
threads, corpus edits or C changes were added. The execution backend already
shares the Test262 harness/context machinery; Windows now calls it directly
instead of loading the Linux-only `ecma_tests_process.js`.

### Whole-suite attempt: incomplete

- Selected: **1333 files**; four previously configured slow cases excluded.
- Completed: **535 files**: **435 passed / 100 failed**, with **11 timeouts
  included in the failures**.
- One additional file started and aborted the VM:
  `ecma/String/15.5.4.10-1.js`.
- Not completed: **794**, comprising that aborted file plus **793 not yet
  started**. This is not a full-suite pass/fail measurement.
- Exact filename comparison with the recorded Linux `5163ff6` column in
  `ECMA_TEST_RESULTS.tsv`: **all 535 completed statuses match**; zero changed
  pass/fail statuses in that completed subset. No conclusion is drawn for
  the unfinished files.
- Whole attempted process: **223.53 seconds / 497672 KiB peak RSS**, exit 70.
- The runner continued after ordinary failures and cooperative timeouts;
  it stopped only when the outer standalone VM hit an unsupported operation.

### Blocking VM operation

The final diagnostic is opcode 23 (`CALL`), detail 1047, decoded by the existing
diagnostic catalog as `intrinsic+47 [STRING_SUBSTRING]`. It is not missing CALL
support in general. Running only the offending file in a fresh Wine process
reproduces the same fatal operation: **17.62 seconds / 205412 KiB RSS**, exit
70. This does not depend on the preceding 535 tests or their mutations.

The file is already FAIL in all recorded Linux columns. The Linux supervisor
can contain a fatal worker exit; the Windows in-process mode cannot. The
substring intrinsic's existing fast path accepts only exactly representable
int32 numeric indices and declines other numeric values. This legacy test
exercises fractional indices, NaN and infinities as well as generic receivers.
The specific first failing argument combination was not separately traced;
the confirmed blocker is the unhandled substring intrinsic. Completing its
standard coercion/clamping path is the next VM investigation, rather than
skipping the file, editing the test or adding a Windows-only language shim.

### Other checks

- Discovery: **1329 runnable / 1333 selected / 4 configured skips**.
- Wine `ecma/Boolean`: **19 passed / 0 failed / 0 timeouts / 0 not run**;
  process 19.18 s, peak RSS 206180 KiB, harness 17219.496 ms.
- Linux ELF packaged from the same snapshot: Boolean **19/19**, existing
  fork-supervised path, harness 16668.702 ms.
- Direct Node Boolean control: **19/19**, harness 1186.362 ms. No guest VM
  supplies the Node reference semantics.
- All checks ran serially. Test262's runner and shared execution code were
  not modified, nor were the external corpus files.

## Timeout contract

Windows retains the ten-second default as a **cooperative deadline**, checked
through the existing execution-slice observer and at phase boundaries. A
deadline aborts the execution through the existing cleanup path and returns a
timeout result. It is not an OS-enforced wall-clock bound: compilation, GC and
native operations must return before the harness can regain control, and
some recorded elapsed times exceed ten seconds. Native crashes and fatal
standalone semantic exits also cannot be contained in-process. Linux retains
its existing preemptive process watchdog and the direct Node path is unchanged.

No further files were skipped to conceal the abort. Full Windows compliance,
full Linux regression acceptance and a complete Windows timing are not claimed.

## Reproduction and image identity

From `mmvm_v2_tests`, using the supplied 32-bit Wine prefix:

```sh
. ../../wine/32.sh
wine artifacts/js.exe ecma_tests_runner.js --list
wine artifacts/js.exe ecma_tests_runner.js --verbose ecma/Boolean
wine artifacts/js.exe ecma_tests_runner.js --verbose
wine artifacts/js.exe ecma_tests_runner.js --verbose ecma/String/15.5.4.10-1.js
```

On Windows, invoke `artifacts\js.exe` directly with the same arguments. The
relative corpus layout is documented in `ECMA_TESTS.md`.

The existing supplied image was used without rebuilding it (native contract
109). SHA-256:

- PE executable: `3222fb8bb907f4c04d6e25d57aca0253ab47b27f17314a81d4b85906b11c5a3c`.
- Input snapshot: `9c79d33d589a16b297b5b389ce9d1d3ee2dc67450589e2cc328cee7776fd2c42`.

Raw receipts are ignored artifacts: `ecma-wine-list.log`,
`ecma-wine-smoke.log`, `ecma-wine-full.log`, `ecma-wine-substring.log`,
`ecma-linux-smoke.log` and `ecma-node-smoke.log`. This checked-in report
preserves the incomplete-run status if temporary artifacts are removed.
