# Test262 execution plan

Ongoing measurements and failure groups are recorded in
`TEST262_STATUS.md`.

## Scope and immutable corpus

The guest VM targets ECMAScript 5.1.  Its applicable Test262 corpus is the
unmodified tree at `../../js_tests/tests/test262`, relative to this directory.
The runner and VM work must never modify, copy generated files into, or create
results beneath `../../js_tests/tests`.  Core ES5.1 chapters are in scope;
`intl402` is reported as outside the ES5.1 target unless ECMA-402 is made an
explicit additional target.

`test262_runner.js` is the checked-in entry point.  It follows the Octane
wrapper's command-line shape:

```sh
js_min.exe guest_runner.js --vm-native test262_runner.js
js_min.exe guest_runner.js --vm-native test262_runner.js ch11/11.4
js_min.exe guest_runner.js --vm-native test262_runner.js --fail-fast ch11
js_min.exe guest_runner.js --vm-native test262_runner.js --strict-only ch09
js_min.exe guest_runner.js --vm-native test262_runner.js --summary-only
js_min.exe guest_runner.js --vm-native test262_runner.js --fresh-contexts ch09
js_min.exe guest_runner.js --vm-native test262_runner.js --self-hosted-eval ch10/10.1
```

With no selector, or with `all`, the runner discovers every applicable test.
Selectors may name a chapter, subtree, or individual test relative to the
Test262 root.  A normal run continues after failures and prints a complete
summary.  `--fail-fast` is an optional diagnostic mode, never the default.
`--strict-only` and `--non-strict-only` select tests explicitly authored for
the requested mode. They are diagnostic filters; tests in the other mode are
reported as not run.

By default every executed test prints a `PASS` or `FAIL` line followed by its
elapsed milliseconds, for example:

```text
PASS ch06/6.1.js (non-strict); elapsed: 25.412 ms
```

The measurement surrounds the backend's entire test call: context preparation,
harness installation, test compilation, execution and explicit teardown where
applicable. It excludes reading the test source and printing its result.
The first call also includes any one-time harness compilation performed by
that backend. `test ms` in the summary is the sum of individual test-call
times; `elapsed ms` includes test-runtime construction, source reads, reporting
and final teardown, but excludes initial manifest discovery and argument
handling. Guest runs use their existing `Date` clock; direct Node uses the
monotonic `process.hrtime()` clock. Three decimal places are formatting, not
a guarantee of microsecond clock precision.

`--verbose` adds read/run diagnostics and guest instruction counts. `--quiet`
suppresses successful per-test lines, while failures still include timings.
`--summary-only` suppresses all per-test lines; both summary time totals remain
available. Use the same output mode on both backends for throughput comparisons.

## Direct Node comparison (no guest VM)

```sh
node test262_runner_node.js
node test262_runner_node.js ch11/11.4
node test262_runner_node.js --fail-fast ch11
node test262_runner_node.js --strict-only ch09
node test262_runner_node.js --summary-only
node --jitless test262_runner_node.js --summary-only
node test262_runner_node.js --timeout-ms 30000 ch07
```

This entry point uses only Node's built-in `fs`, `path` and `vm` APIs. It never
loads `guest_vm`. It supplies a direct V8 backend to the existing
`test262_runner.js`, so both paths use exactly the same manifest, selectors,
authored strict/sloppy policy, negative-test classification and result/timing
reporting. Relative source paths are resolved from the wrapper's own directory;
there are no machine-specific paths or downloads. The external tests are read
in place and unchanged.

Every Node test receives a fresh context with fresh built-ins and harness
globals, without `require` or `process`. Compiled harness scripts are reused,
not mutable harness state or compiled test programs. This matches the guest
embedding's existing in-memory repair of the root harness's inconsistent DST
sentinels; neither backend edits the external harness. `--fresh-contexts` is
accepted but redundant for Node, which always creates fresh contexts. Node's
`vm` context isolation is not a security boundary for hostile code.

V8 cannot count guest bytecodes. Node therefore offers `--timeout-ms` (default
10,000 ms) per script execution in place of `--instruction-limit`. Compilation
and context creation are included in timings, but not interrupted by that
execution timeout. A timeout fails the test and is also counted in `timed out`;
it cannot satisfy a negative test. Guest-only instruction-limit, test-heap and
self-hosted-eval options are rejected rather than silently ignored. Node's
verbose instruction count is explicitly reported as unavailable.

Modern Node is not an ES5.1-only engine: tests of rules changed in later
editions can legitimately disagree with this historical corpus. Preserve and
report those results rather than patching Node's semantics. The measured Node
inventory and differences are recorded in `TEST262_NODE_STATUS.md` separately
from guest conformance totals.

`--summary-only` performs the identical selection, execution, classification,
and exit-status calculation while suppressing per-failure diagnostics and
progress lines. It is intended for repeatable whole-suite throughput
measurements when the failure inventory is already known. It never skips a
test or converts a failure into a pass; omit it when producing the detailed
failure log used for VM bring-up.

`--fresh-contexts` is a diagnostic comparison path. It creates and destroys a
real `JSContext` for each variant and evaluates the already compiled harness
programs in it. The default retains the context-snapshot checkpoint while the
fresh path is brought to equivalent end-to-end speed. Neither mode reparses
the harness, and both provide a fresh guest-visible global state.

`--self-hosted-eval` is the explicit frontend-migration diagnostic. It loads
the guest-owned tokenizer/parser/compiler once and routes subsequent direct
eval compilation through guest bytecode and authoritative program records.
The default remains the faster transitional eval frontend until this general
path reaches throughput parity; the flag does not change test selection or
expected semantics.

Under `js_runner` the default embedding frontend is already guest-executed
code in the control runtime, not a host-JS parser. In that configuration
`--self-hosted-eval` moves eval compilation into the test runtime itself; it
is not required to make the process independent of a host JavaScript engine.

The runner has no Python, Node.js, npm, or SpiderMonkey dependency.  The
external corpus is supplied by the user and is read in place.

`test262_manifest.js` is the reproducible list of the 3,292 applicable ES5.1
test files. It avoids thousands of transitional host-call yields during
discovery. Every descendant `shell.js` in this particular corpus is empty;
the nonempty root harness remains explicit. Regeneration verifies those facts
from the read-only external tree and never writes into that tree.

## Runtime and context lifetime

### Standalone embedding

The same wrapper can be launched from a generic standalone image:

```sh
./artifacts/js_runner.exe artifacts/snap test262_runner.js --instruction-limit 20000
./artifacts/js_runner.exe artifacts/snap test262_runner.js --verbose ch06
./artifacts/js_runner.exe artifacts/snap test262_runner.js --list ch09
```

`guest_vm/standalone_test262.js` supplies the embedding service when running
inside an image. A snapshot's old hosted service descriptor is not executable
and must not be mistaken for a working service merely because its global
exists. Listing/help do not construct a test runtime.

Rebuild the generic image from the current sources before using this adapter;
it requires the guest embedding library's `runTest262Variant` interface.
The standalone source runner is the control runtime. The adapter constructs
one persistent, independent test `JSRuntime`, then uses the existing embedding
library's `runTest262Variant` scheduler for context isolation, budgets and
structured exceptions. That library itself executes as guest JavaScript in
the control runtime; it does not call Node, SpiderMonkey, a subprocess, or a C
VM-support API. Filesystem reads use the control runtime's libc-backed `fs`.
Result objects are explicitly copied across the runtime boundary as primitive
fields rather than exposing another runtime's heap references.

This is genuine guest execution of the embedding implementation, **not** a
claim that every operation executes in the test runtime's native kernel.
Semantic exits from that kernel can run the portable interpreter/runtime
implementation in the control guest VM. Thus the standalone run still exposes
missing native operations needed by that implementation. The two runtimes
have separate heaps, so memory figures must include both. Test execution is
serial. Neither runtime is restarted for every test, and no benchmark/test
source is cached specially. The adapter destroys its test runtime at normal
completion, including a reported fail-fast stop.

Consult `TEST262_STATUS.md` for completed versus interrupted runs. Do not
present hosted totals as standalone totals or an interrupted inventory as a
complete result.

The test service owns one persistent `JSRuntime` for the whole selection.
The standalone control runtime described above is separate. Each test observes a freshly
restored `JSContext` environment within that runtime. Source is evaluated as
authored (and is therefore sloppy by default); `@onlyStrict` explicitly asks
the runner to prepend a strict directive. Contexts share runtime-owned immutable infrastructure and compiled
native interpreter code, but never mutable state from an earlier variant.

Constructing the ES5 harness from source for every variant is not part of the
test and formerly dominated the run. The environment is therefore initialized
once and captured with the general `JSContext.createSnapshot()` facility.
Before every variant, `restoreSnapshot()` restores all mutable guest-heap
records reachable from that context: its global, objects, prototypes,
properties, arrays, environments, and functions. Immutable strings, programs,
and bytecode remain runtime-shared. Execution frames and engine/platform state
belong to the caller which requested the run and are deliberately outside the
snapshot. Consequently restoration cannot rewind the Test262 scheduler, while
changes a test made to globals or shared builtin prototypes cannot leak into
the next variant.

For each variant the runner:

1. restores the initialized context snapshot;
2. retains the already compiled and initialized root harness;
3. compiles and runs the test, adding a strict prologue when required;
4. records completion, exception phase, source position, and instruction use;
5. clears execution roots; the next restore discards the variant's observable
   mutations and automatic collection reclaims unreachable allocations.

Automatic heap-pressure collection reclaims dead context, source, parser,
AST, bytecode, and execution records in batches.  The runner does not force a
full collection after every variant.

## Harness and metadata

The suite's own `shell.js` files provide `$ERROR`, `$FAIL`, `runTestCase`, and
the other conformance helpers.  They are evaluated in root-to-leaf order in
the same isolated global as the test.

This Mozilla import expects a driver-provided
`testPassesUnlessItThrows()` hook; `test262_harness.js` supplies it as guest
JavaScript. The imported root harness also contains generated values with
literal quote characters for its `"first"`/`"last"` DST selector, although
the consumer compares unquoted values. The runner applies that exact
in-memory normalization while leaving the external corpus unchanged. These
two compatibility steps are harness integration, not guest-language
semantics, and are kept explicit and reviewable.

The runner recognizes the old corpus's comment directives without depending
on regular expressions:

- `@onlyStrict` asks the harness to prepend `"use strict"`;
- `@noStrict` documents that the authored source uses the default sloppy mode;
- with neither marker, the source is run exactly as authored—no synthetic
  strict copy is invented;
- `@negative` inverts the expected outcome and may constrain the acceptable
  failure.

This distinction is important for this Mozilla-era suite. Its unannotated
files are complete test programs, many imported from Sputnik before modern
Test262 dual-variant metadata existed. Automatically prepending strict mode to
all of them creates tests whose behavior contradicts ES5.1; it is not added
coverage. Strict-mode conformance comes from the suite's explicit strict tests
and strict directives in authored source. Separate focused dual-mode tests may
be used during VM development, but are not counted as corpus results.

Negative tests retain the distinction between lexical/parse or other early
errors and runtime exceptions. The pattern `^((?!NotEarlyError).)*$` excludes
the corpus's sentinel, so a missing early error cannot pass such a test.
The plain `NotEarlyError` pattern has the opposite meaning: it expects the
sentinel, for example to prove that parsing did not incorrectly reject valid
syntax. The wrapper must not classify these two directives identically. Result
classification uses structured VM status rather than scraping console text.

## Execution and containment

The default per-variant allowance is **20,000,000 instructions**. The much
smaller `--instruction-limit 20000` setting used in historical bring-up logs
is a bounded diagnostic run, not a sufficient conformance budget: six Unicode
range tests each exercise up to 65,536 iterations and cannot finish within
20,000 bytecode instructions. Use the default for a complete conformance run;
do not mistake low-budget timeouts for demonstrated language failures. An
explicitly requested smaller limit remains enforced without exceptions for
particular files. `--verbose` also reports each variant's instruction count
and elapsed time, including failed/timed-out variants.

For allocator diagnostics, standalone runs accept `--test-heap-bytes bytes`
and `--test-max-heap-bytes bytes`. These configure only the inner test runtime;
they do not change the control runtime or any instruction allowance. Without
these options the normal VM defaults apply. The existing hosted test service
rejects these options rather than silently ignoring a requested heap size.
Verbose progress includes logical heap bounds and collection/allocation
counters, useful for distinguishing live-memory pressure from allocator
handoff overhead. An intentionally small instruction limit still produces a
timeout; such a probe is not recorded as a conformance pass.

Every variant receives a finite cumulative instruction allowance.  Exhausting
one slice yields to the Test262 scheduler; it does not alter JavaScript state.
The scheduler may grant another slice until the per-variant limit is reached.
At that point the result is a timeout, the context is destroyed, and—unless
`--fail-fast` was selected—the next variant runs.  Thus an infinite loop cannot
prevent a full-suite result.

The final report uses three mutually exclusive outcome counts:

- `passed`: an executed applicable variant satisfied its expectation;
- `failed`: an executed applicable variant did not, including every timeout;
- `not run`: an applicable variant was left unexecuted by an explicit
  diagnostic filter or by `--fail-fast`.

Consequently `passed + failed + not run = variants`, while `timed out` is a
diagnostic subset of `failed`, not a fourth outcome. A normal unfiltered
whole-suite run must report `executed = variants` and `not run = 0`.
Unsupported ES5.1 behavior is a failure; it is never called a skip or moved to
`not run`. Files outside the stated ES5.1 corpus, such as `intl402`, are outside
the denominator rather than hidden skips.

Failure output includes the relative test name, variant, phase, error class,
filename, line, and column. Any failed or timed-out applicable variant makes
the command exit nonzero after the summary.

## Self-hosting boundary

The finished MMVM Test262 path performs discovery, file reads, tokenization,
parsing, bytecode compilation, verification, context scheduling, and result
classification without an embedder `hostCall` transition.  Guest `load()` is
implemented using the guest's direct libc/FFI filesystem service and the
self-hosted front end, and evaluates in the requesting context.  Direct,
capability-controlled native FFI is an MMVM facility, not a callback into the
host JavaScript engine.

The initial checked-in runner is deliberately separated from the execution
service by a small `Test262VM` interface.  During bootstrap that interface may
be backed by the existing embedder-side parser/context machinery.  That is a
transitional implementation, not conformance with the self-hosting boundary.
Migration moves the same operations behind the interface into guest/native
runtime services without changing test selection, reporting, or semantics.

`guest_runner.js --vm-no-host-calls` is the executable audit for this boundary.
Any attempted callback fails with `HostCallError` at its guest source
location. A Test262 run is not considered self-hosted until it completes in
that mode; ordinary conformance counts and the remaining bootstrap-call count
are tracked separately.

The required end state is:

```text
js_min.exe
  `-- guest_runner.js
        `-- one guest JSRuntime
              `-- test262_runner.js
                    |-- restored JSContext: harness + test variant
                    |-- clear execution roots
                    |-- restore JSContext: harness + test variant
                    `-- ...
```

Node-hosted execution remains useful for general VM development, but it is
not a dependency or substitute for the `js_min.exe` conformance run.

## Development policy

Failures are grouped into VM semantic defects, runner/harness defects,
unsupported facilities, and individually documented out-of-scope tests.
Skips must never silently inflate the pass count.  Work should fix general
language/runtime behavior instead of recognizing individual Test262 files.
Existing demos, networking programs, Octane correctness, and established
performance measurements remain regression gates while conformance improves.
