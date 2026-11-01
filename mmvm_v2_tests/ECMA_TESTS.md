# Historical ECMAScript coverage runners

These runners complement Test262 with the external SpiderMonkey corpus's
`ecma`, `ecma_2`, `ecma_3` and `ecma_5` trees: coverage written across the
ES1--ES5.1 period. The goal is standard-language coverage, not implementation
of SpiderMonkey's proprietary language modes, debugging APIs or extensions.
The corpus is read from `../../js_tests/tests`; nothing there is modified.

## Running

From `mmvm_v2_tests`, with a current generic standalone image:

```sh
./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js
node ecma_tests_runner_node.js
```

If needed, construct an image from the current sources with the existing
snapshot workflow; no C source or js_min rebuild is required:

```sh
node guest_runner.js --vm-native --snapshot artifacts/snap
```

Selectors are corpus-relative paths or directory prefixes. Overlapping
selectors execute each file only once. With no selector, all four trees run.

```sh
./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js ecma/Array
node ecma_tests_runner_node.js ecma_5/JSON
node ecma_tests_runner_node.js --list
./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js --fail-fast ecma_3
```

By default each completed file prints PASS/FAIL and elapsed milliseconds.
`--quiet` suppresses passing rows; `--summary-only` prints only totals;
`--verbose` also prints RUN before execution. `--fail-fast` is optional:
normally failures, native worker exits and timeouts do not stop the suite.
The summary gives per-tree and total pass/fail counts, timeout subsets,
executed/not-run counts and elapsed time. A failure produces exit status 1;
timeouts are failures, never passes or skips. Invalid selections are errors.

Both runners accept `--timeout-ms COUNT`, default 10000. The Node worker
also has a one-second startup/transport grace outside its VM-script timeout.
The guest runner additionally accepts `--instruction-limit COUNT`, default
20000000; Node rejects this flag because V8 has no equivalent counter.
Instruction and wall-clock limits measure different resources. Specify them
when recording a baseline, and do not mistake a bounded timeout for a proven
semantic defect. Timings include isolation/harness overhead and are not
interpreter-throughput benchmarks.

For reproducible Date tests, use the same timezone for both engines, e.g.:

```sh
TZ=UTC ./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js \
  --verbose --timeout-ms 5000 --instruction-limit 2000000
TZ=UTC node ecma_tests_runner_node.js --timeout-ms 5000
```

The Node control uses the installed Node engine directly, not the guest VM,
and only built-in Node modules. Modern Node's non-contextified realm global
is used when available so `Object.preventExtensions(this)` is not rejected
merely by a contextifying proxy. Older Node versions fall back to ordinary
`vm.createContext`, with that proxy limitation. The scripts use ES3-compatible
syntax; the Node supervisor requires `child_process.spawnSync`.

## Execution and isolation

The shared controller is `ecma_tests_runner.js`. It discovers JavaScript
files dynamically: no generated manifest is checked in. The infrastructure
files `shell.js`, `browser.js`, `jsref.js`, `template.js`, and
`ecma_5/Object/defineProperty-setup.js` (explicitly marked "not a test")
are not standalone tests. All other discovered files run, including
`extensions/` and files annotated as slow or skipped by Mozilla's driver.
Currently this selects 1333 files. Browser harnesses are not loaded.

Execution preserves separate script boundaries, filenames, and authored
sloppy/strict directives:

1. Install logging-only `print`/`dump`, then the unchanged root `shell.js`.
2. Run ancestor `shell.js` files from tree root to the test's directory.
3. Install the report-failure recorder and execute the original test script.
4. Check every legacy `gTestcases` entry and recorded `reportFailure` call.
   Original assertion functions and legacy comparison tolerances are retained.

`-n.js` files follow the historical expected-uncaught-exception convention;
typed `|reftest| error:...` directives constrain the exception name. Harness
errors, worker failures and timeouts cannot satisfy a negative expectation.
No synthetic strict variant is added. An ordinary completed crash-regression
test may legitimately have no assertions; a completed script containing
failed `TestCase` records is not considered passing.

`load(path)` executes a real script in the same global environment, resolving
paths relative to the corpus root. It does not paste source into another
script, use eval as a substitute, or alter a test's directives. The guest
embedding uses a temporary shared-global execution context for nested loads;
the loader, filesystem access, compilation and test semantics all execute
inside the standalone guest image. No Node or host JavaScript engine serves
guest language operations. Other engine-specific shell functions are not
faked to make tests pass.

Tests mutate fundamental prototypes, and some currently terminate native
guest execution or spend uninterruptible time in Node built-ins. Consequently
both backends isolate tests in **serial child processes**, not threads:

- Node starts one memory-bounded worker per file, with a fresh bare realm,
  a 128 MiB V8 old-space limit and an external kill/reap watchdog.
- The Linux/i386 guest supervisor prepares one test runtime, then uses libc
  `fork` and copy-on-write isolation. There is at most one worker executing a
  test. Each inherits the pristine parent state; test mutations never return
  to the parent. It also uses the existing Test262 baseline-restoration path,
  because a fresh context alone currently shares intrinsic objects. The
  inner runtime starts at 8 MiB with a 128 MiB guest-heap cap. A libc watchdog
  kills and reaps timed-out children; core dumps are disabled and children
  receive SIGKILL if the parent dies. No new C code is used.

These are heap limits, not promises that total RSS is below 128 MiB. Forked
RSS includes shared copy-on-write pages. No tests run concurrently. Ancestor
harness bytecode may be reused within an isolated worker; test source/results
are not cached. Native failures are reported as `WorkerExit`, including the
exit status or signal; line/column zero means the process returned no JS
exception location. SIGSYS stops the guest supervisor for environment
investigation rather than being worked around.

## Interpreting results

Raw corpus pass rate is not a pure ES5.1 compliance score. These historical
directories include unfinished tests, old Unicode tables, implementation-
specific error text, proprietary APIs, and expectations changed in later
ECMAScript editions. Modern Node is a useful control, not an ES5.1 mode.
Review source rather than teaching the guest VM nonstandard behavior to
match every Node failure. The bring-up ledger and reviewed discrepancies
are recorded in [ECMA_TESTS_STATUS.md](ECMA_TESTS_STATUS.md).
