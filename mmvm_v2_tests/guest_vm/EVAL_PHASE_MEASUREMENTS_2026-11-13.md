# Heavy Test262 eval: measurements and proposed work

Measured on 2026-11-13, implementation `75860af` (documentation-only audit
commits through `e06469c` do not change the VM). This task adds diagnostic
tooling and this proposal, **not a performance implementation**. All runs are
serial. No VM/C/demo/test corpus source, instruction limit, regex matching
implementation, threading policy or snapshot format was changed.

## Conclusion

The first target is **program registration and its typed record/native-call
boundary**, not regex matching, verification or GC. Do not begin by replacing
the compiler's output representation wholesale. The measured payload is tiny;
the dominant issue is the cost of constructing/installing it through many
general-purpose operations, not transferring a large number of bytes.

One important correction to the earlier proposal: default standalone Test262
does not select `--self-hosted-eval`. Its inner test runtime falls back into
`JSContext.compileEval` and `Runtime.registerProgram`, implemented as guest JS
executing in the standalone control runtime. The optional
`self_hosted_frontend.compileEvalExecutable` / `adoptProgramDescriptor` path
is different. These are not callbacks to js_min, Node or another external JS
engine; the control runtime itself is running in the standalone guest VM.
Any shared construction service should ultimately serve both paths, but
optimizing only the optional adoption setters would miss the measured path.

## Input and identity

Representative unchanged test:
`ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js`.

This traverses all 65536 UTF-16 code units, excludes 15 characters, and makes
**65521 eval compilations**. It constructs regex literals and checks their
source; it is not a large-string matching/backtracking workload. The other
three long cases were timed in the full audit, not separately profiled here.

Snapshot SHA-256:
`d788779e0427855d5bd79938d172cc9a02b67308257c4b3ae0849d6dbd42138d`.
The native sampling sidecar was constructed separately; its snapshot is
byte-identical to this existing input. The loader/js_min were not rebuilt.

## Clean results and observer effects

All complete workload executions below pass the selected test. The native
CPU window is deliberately stopped after sampling, not claimed as a complete
conformance run.

| Run | Test seconds | Runner seconds | Process seconds | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: |
| Clean seeded snapshot, before | 81.402 | 93.915 | 94.52 | 471408 |
| Sparse phases, every 64 evals | 86.384 | 98.641 | 99.64 | 466840 |
| Sparse detailed phases, every 127 evals | 89.309 | 102.315 | 103.35 | 471128 |
| Read-only external stack sampler | 92.503 | 106.484 | 107.32 | 471120 |
| Unwrapped diagnostic-module-reload control | 90.714 | 103.866 | 104.84 | 471032 |
| Clean seeded snapshot, after | 97.976 | 111.808 | 112.47 | 471156 |

The two clean test times differ by **20.4% without a code change**. This
prevents a precise attribution of wall-time differences to instrumentation.
The roughly 6% difference initially seen between sparse timing and the first
control must **not** be presented as a measured stable profiler overhead.
The machine is a two-vCPU KVM guest; no causal claim about the source of the
variation, or machine-wide tuning, follows from that observation.

Sparse timing also has method-specific observer effects. It temporarily
replaces methods, invalidates caches, allocates bookkeeping, and reloads vm.js
to capture its lexical verifier binding. The unwrapped control retains that
reload; it is not identical to using only the seeded methods. Fine-grained
timers add cost *inside* a parent's interval. Raw detailed timer shares are
therefore not reliable exclusive percentages of an unmodified execution.
Use the external stack/native profiles below for prioritization, not these
runs as a speedup claim. No absolute optimization result is claimed.

## Unmodified guest stack sample: primary phase evidence

The existing read-only parent sampler takes stopped-process stack snapshots
at approximately 200 ms intervals, maximum depth 64. It does not replace the
workload's functions. The complete test passes with observed process exit 0.

- Total stack samples: 538.
- Exclude the first 15 seconds to remove runtime/kernel construction: 75.
- Measured window: **463 samples**, **0 truncated / 0 unknown completeness**.
- `compileEval` present: **254/463 = 54.9%**.
- Outside `compileEval`: **209/463 = 45.1%**.

The direct-child breakdown gives disjoint compilation phases for these
samples; nested descendants are charged to that child, not added again:

| Phase | Samples | All measured samples | Within compileEval |
| --- | ---: | ---: | ---: |
| Program registration | 149 | 32.2% | 58.7% |
| Sloppy eval lowering, including compiler construction | 65 | 14.0% | 25.6% |
| Parser construction and parseProgram, 16 each | 32 | 6.9% | 12.6% |
| Verification | 5 | 1.1% | 2.0% |
| compileEval itself / uncategorized direct work | 3 | 0.6% | 1.2% |
| Outside compileEval | 209 | 45.1% | — |

These are finite wall-sampling observations, not exact instruction accounting.
The whole-test run includes one test; do not automatically assign this exact
breakdown to every test or to a self-hosted snapshot build.

Inside the **149 registration samples**, direct children are:

- Constant import/write: 44 (29.5%).
- Program-record allocation/initialization: 33 (22.1%).
- Bytecode allocation/ingress: 25 (16.8%).
- Constant value-vector allocation: 20 (13.4%).
- Registration's own body: 14 (9.4%).
- Integer-vector normalization/interning: 6 (4.0%).
- Vector-cell access: 6 (4.0%).
- Classifying argument-list constants: 1 (0.7%).

Within registration, the generic native-result wrapper that constructs an
argument array is the leaf in **22/149 samples (14.8%)**. Range checking is
the leaf in 14/149 (9.4%). Across the whole steady window, argument packing
is the leaf in 32/463 (6.9%). Parent/child and leaf percentages overlap;
they must not be summed as independent opportunities.

The relevant wrapper is duplicated across native-result creation in
`aot/backend_x86.js`. It allocates `args`, reads `arguments`, applies Number
and int32 conversion per argument, then calls HostFFI.call/callNative, which
unpacks the array again. Even small existing kernel helpers traverse this
adapter. This is a general internal ABI/lifetime boundary, not an eval-only
issue.

## Sparse phase timing: supporting evidence

`tools/profile_eval_phases.js` samples complete compileEval calls without
rewriting their bodies. It temporarily wraps parser, lowering, scope and
registration methods only during a selected compilation. The verifier is
captured through a diagnostic-only vm.js reload. Reentrant timing is charged
once; registration children have explicit parent labels and are inclusive.

The coarse run samples **1024/65521** calls:

- Sampled compileEval: 799.843 ms.
- Registration: 437.242 ms, **54.7% of that instrumented interval**.
- Lowering: 169.675 ms; parseProgram: 55.436 ms.
- Verification: 34.028 ms; caller scopes: 5.775 ms.
- Residual, including parser construction and timer/wrapper work: 97.687 ms.

The detailed run samples 516 calls and raises the registration share to about
70%; the external profile does not support interpreting that as the true
exclusive share. Do not extrapolate its small-method clock totals into a
precise whole-test cost.

Both sampling rates report **12 bytecode words / 3 constants / 3 registers
per sampled program**, and approximately **four inner-runtime record
allocations per compiled program**. This allocation counter excludes ordinary
compiler/AST objects in the outer control runtime. The detailed run observes
no calls to internProgramSource for these programs: source interning is not
the leading target for this particular input. Tiny data volumes argue
against starting with a new bulk-copy routine alone.

## Native CPU profile

The existing libc profil diagnostic samples the image's native code, without
guest threads, while the same test runs. A 25-second warmup is followed by a
30-second window: **2900 native samples**. This counts samples in the image's
code mapping, not every address in the process, and is separate from the
wall-stack sample. It is a bounded diagnostic, terminated intentionally after
the window.

| Native function/category | Samples, percent |
| --- | ---: |
| interpreterKernel | 47.3% |
| bytecodeCallKernel | 10.8% |
| intrinsicCallKernel | 7.2% |
| Cached own-property lookup | 5.1% |
| Copy program constants into activation registers | 4.7% |
| Return from bytecode | 4.7% |
| Property storage lookup | 3.0% |
| String-key equality | 1.9% |
| Register-bank initialization | 1.4% |
| Heap mark / sweep | 0.8% / 0.4% |

Call/setup/return/register-init/constant-copy helpers sum to **21.6%** of
these native samples. The CALL dispatch region is another approximately
4.3%, already included in interpreterKernel above. The constant-property-read
region is approximately 15.6%, likewise included there. Region attribution
is approximate because dispatch/loop code can lie between handler labels;
function-level attribution is firmer. These CPU categories overlap the
*semantic phases* of the stack profile and must not be added to them.

## Recommended implementation, in order

Historical guardrail: the earlier investigation in
`EVAL_COMPILATION_PERFORMANCE.md` rejected bulk-initialization/grouped-
allocation experiments after their completed measurements did not justify
retaining them. Do not revive those as a stand-alone fix. The new proposal
must remove dynamic call/marshalling/layering work at the boundary, not merely
move the same stores into another helper behind the same expensive adapter.

### 1. Consolidate signature-aware kernel call bindings

The generic argument-array adapters should become one implementation with a
defined internal fixed-signature integer-call entry. Internal typed helpers
should not reconstruct an arguments object/array and then unpack it on every
invocation. Keep public/general adaptation where required; preserve coercion
order, errors and the existing wider-arity bridge. Do not silently narrow the
public FFI or assume all JS arguments are already int32.

Bindings must retain executable ownership and enforce lifetime, with code
pointers as rebindable data, not process addresses embedded in generated JS
source. This must continue to support relocatable deterministic snapshots.
Use this single binding boundary across result creation, not four slightly
different wrappers. Benefits should extend beyond program construction.
This is the enabling boundary for the next step, not a claim that removing
the argument-packing leaf alone fixes the workload.

### 2. A shared, typed program-construction boundary

Keep the existing parser, scope handling and verifier initially. Introduce
one named program-construction service below registerProgram, also usable by
the self-hosted adoption path. Its reservation, value import, initialization
and publication responsibilities must be explicit.

- Batch fixed-layout record initialization and related writes into kernel-
  dialect helpers, compiled by the existing shared IR/backends. Use named
  field accessors/shared layout constants; no handwritten machine-code chunks
  or literal-offset duplication. In particular, allocateProgram currently
  constructs an options object and performs many separate scalar field writes
  for a very small record. Call a complete typed constructor instead.
- Preserve the existing bulk bytecode ingress; removing its surrounding
  allocation/call overhead matters more than copying these 12 words faster.
- Import constants according to their type/runtime ownership. **Never memcpy
  reference cells between distinct JSRuntime heaps.** Keep mutable values and
  fresh RegExp objects distinct, and preserve descriptor/argument-list rules.
- Reserve and root incomplete state under the existing GC protocol; initialize
  it and publish it only once valid. Errors must release construction roots.
  Source/debug data and Function.prototype.toString must remain correct.
- Compile shared helpers once, not once per program. Preserve the Node JS
  backend and the js_min build path; do not require another runtime or C API.

This starts by improving the installed representation's construction, not by
forcing a new compiler output form. It removes call/layering redundancy while
leaving eval semantics alone.

### 3. Remeasure before a compiler-sink or frame-layout rewrite

If registration remains dominant, evolve the shared construction service into
a compiler output builder, so executable tables need not be materialized and
re-imported. Retain a descriptor output adapter for public APIs; do not fork
parsing/language semantics into an eval-only compiler. This was the earlier
proposal, but current measurements justify doing the lower boundary first.

The separate call/frame costs are also real. Sharing immutable constant data
instead of copying it into every activation may be a later general change,
but the measured constant-copy helper alone is 4.7% of native samples. It is
not grounds to claim that it explains or fixes the whole bottleneck.

## Expected scale and acceptance

Illustration, **not a promised speedup**: if registration really occupies 32%
of a heavy case, halving it saves about 16% of that case. If representative of
the four cases that account for about 76% of the full suite, that saves about
12% of total suite time before any benefits to the other tests. Removing all
registration cannot by itself halve the whole suite. A much larger gain
requires improving general call/property/execution costs too; these domains
overlap, so their profile percentages cannot simply be added.

Validate each working change with completed clean heavy cases, separately
timed non-outlier tests, RSS/allocation observations and paired genuine
snapshot construction. Preserve full Test262 passes, exact ECMA pass filenames,
all Octane suites, bounded demos/HTTP, structural/native GC, Node/js_min build
identity and genuine self-hosted identity. Repeat full matrices at stable
boundaries, not after every diagnostic edit. No benchmark-specific source
recognition, parse cache, regex shortcut, extra threads or weakened tests.

## Reproduction and diagnostic validation

Run from mmvm_v2_tests; images/log prefixes must exist or be fresh as appropriate.

```sh
./artifacts/js_runner.exe artifacts/full-jsmin.snap test262_runner.js ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
./artifacts/js_runner.exe artifacts/full-jsmin.snap guest_vm/tools/profile_eval_phases.js --every 64 test262_runner.js ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
./artifacts/js_runner.exe artifacts/full-jsmin.snap guest_vm/tools/profile_eval_phases.js --every 127 --detail test262_runner.js ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
node guest_vm/tools/profile_process_memory.js --stack-only --stack-depth 64 artifacts/full-jsmin.snap artifacts/eval-measure-stack test262_runner.js ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
node guest_vm/tools/summarize_stacks.js artifacts/eval-measure-stack.jsonl --after-ms 15000 --ancestor 'function (source, filename, strict,'
node guest_vm/tools/build_profile_image.js --vm-native --snapshot artifacts/eval-cpu.snap
node guest_vm/tools/profile_native_vm.js --after-seconds 25 artifacts/eval-cpu.snap 30 test262_runner.js ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
```

The sparse tool uses ES3 syntax and scalar report lines, requiring no JSON API
in the shell. Existing eval conformance test
`ch10/10.4/10.4.2/S10.4.2_A1.1_T10.js` passes with a one-sample phase report
on standalone, direct Node-hosted guest and js_min-hosted guest. On Node/js_min,
pass `--vm-native test262_runner.js TEST` after the profiler flags. js_min's
native quit does not unwind finally; the diagnostic reports immediately before
that existing quit, after the runner's cleanup, preserving the exit status.
Node/js_min clocks are coarser; their short smoke timings are not the native
phase measurement above. `--every 0` disables observation/counters but retains
the diagnostic module reload. This is synchronous test tooling, not a profiler
for asynchronous applications.

One early detailed workload completed its test, then its JSON-based reporter
failed with unsupported CALL / FUNCTION_CALL (detail 1044). A short existing
eval test reproduced the reporting failure. That run is **excluded as a
completed diagnostic**; no phase results were recovered from it. Reporting
was changed to scalar lines (also needed by js_min), then the detailed run
was repeated successfully. No JSON/VM semantics fix is claimed here; this
serialization limitation is recorded separately from the performance issue.

Raw observations remain in ignored `artifacts/eval-measure-*`,
`eval-phases-*`, `eval-stack-*` and `eval-native-cpu.log`. Generated profiles,
symbols, binaries and snapshots are not checked in. Only this human-authored
report and the reusable diagnostic source are committed.
