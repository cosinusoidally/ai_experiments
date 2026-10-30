# Interpreter architecture and CPU cost

Investigation checkpoint: 2026-10-29, `guestVM-cleanup`.

The small declaration-walker/base-address experiments are parked, not retained
as the solution. The baseline investigation left production VM sources unchanged;
the first architectural implementation is described at the end of this document.
The objective is substantial general-purpose improvement by
reducing repeated semantic work and improving the compiler/interpreter design,
not accumulating benchmark-specific paths or superficial source rewrites.

## Evidence: distinguish workloads before choosing a redesign

These measurements sample **native instruction addresses**, not just guest JS
stacks. `tools/build_profile_image.js` writes the ordinary snapshot plus an
ignored symbol sidecar. `tools/profile_native_vm.js` starts one native process;
libc `profil` accumulates counters without threads, guest callbacks or a host
language implementation. The parent reads counters from its own child.

The optional `--after-seconds` excludes startup by subtracting two readings.
The child is briefly stopped for each read and terminated after the window.
These are bounded diagnostic runs, **not completed benchmark correctness runs
or scores**. The profiler reports an incomplete window as an error rather than
silently presenting it as a measurement. Counter percentages are exclusive
native-PC attribution, not inclusive guest-language costs.

Commands, run serially from the tests directory:

```sh
node guest_vm/tools/build_profile_image.js --vm-native \
  --snapshot artifacts/architecture-profile.snap
node guest_vm/tools/profile_native_vm.js --after-seconds 20 \
  artifacts/architecture-profile.snap 25 test262_runner.js \
  ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js
node guest_vm/tools/profile_native_vm.js --after-seconds 15 \
  artifacts/architecture-profile.snap 15 octane_runner.js --quick zlib
```

### Repeated eval: 2,420 native samples

- Interpreter function itself: 43.9%.
- Bytecode call setup: 12.2%.
- Native allocation reservation: 6.8%.
- Intrinsic dispatch: 6.6%.
- Bytecode return: 5.1%.
- Cached own-property lookup: 4.4%.
- Indexed own-property lookup: 4.4%.
- Copying program constants into activation registers: 3.7%.
- Initializing the register bank: 1.4%.
- Individual mark/sweep routines: approximately 0.5% / 0.3%.

Within the interpreter's machine-code regions, constant-property reads account
for 15.5% of all samples and CALL for 4.5%. Together with the external lookup
helpers, property work is a substantial cost. Call/setup/return and register
initialization/copying are another substantial, separate cost. These categories
must not be double-counted as inclusive guest stack percentages.

### zlib hot execution: 1,495 native samples

- Interpreter function itself: **99.1%**.
- Bytecode call setup: 0.4%; constant copying and register initialization 0.2%
  each; return 0.1%. Allocation and GC helpers are negligible in this window.
- Indexed GET_PROPERTY region: 25.0% of all samples.
- GET_LOCAL: 9.2%; SHIFT_RIGHT: 8.2%; ADD: 7.2%; BIT_OR: 6.1%;
  SET_PROPERTY: 5.6%; SHIFT_UNSIGNED_RIGHT: 3.5%.

A second zlib window (10 seconds after 10 seconds of warmup, 994 samples)
again attributes 99.1% to the interpreter function. This confirms the broad
location of the cost, not an exact stable percentage for every opcode.

Opcode-region attribution is approximate: dispatch/loop-accounting instructions
can fall between handler labels. It is not an exact breakdown of dispatch
versus handler bodies. Function-level attribution is the firmer result.

Raw logs are ignored artifacts: `architecture-eval-native.log` and
`architecture-zlib-native.log`. The symbol file is tied to the image's source
hash and code length; the reader rejects a mismatched sidecar.

**Conclusion:** optimizing parser allocation, GC or function entry alone cannot
substantially accelerate the zlib hot loop. Conversely, improving a numeric
loop alone does not remove the property/call costs of self-hosted compilation.
The next work must address both through general interpreter/compiler facilities.

## Architectural shortcomings confirmed by source/code inspection

1. **Structured expression-tree IR is emitted almost directly to i386.**
   `allocateKernelRegisters` chooses a few values for the whole function by
   usage counts/preferences. It does not assign registers from basic-block
   liveness. The current interpreter has 639 lowered locals; its persistent
   register choices leave most handler-specific intermediates in stack homes.
   This is an architectural limitation, not proof that all sampled time is
   spills. The generated indexed-read entry visibly writes and rereads operand
   addresses/tags/state flags through stack slots.

2. **Control flow lacks an explicit canonical block representation.** The
   emitter recursively expands structured conditionals, and reconvergence can
   produce chains of jumps to the immediately following instruction. The
   indexed-read receiver-tag guard is a concrete example. Adding peepholes for
   that one expression would leave the same issue in other handlers.

3. **Property semantics and execution dispatch are entangled.** Indexed reads
   use a large supported-state flag machine covering primitives, strings,
   ordinary objects, arrays and typed views. Ordinary named reads also pass
   through exotic-property handling and multiple lookup guards. This makes
   hot paths hard to audit and makes the compiler optimize a very large body.
   A coherent type-directed property subsystem is preferable to another
   collection of unrelated early-return shortcuts.

4. **Activation layout copies immutable data per call.** Every activation
   initializes a register bank and copies program constants into it. Constants
   are immutable program data but occupy activation slots. Call handling also
   mixes ordinary bytecode calls, constructors and call/apply normalization.
   These costs matter in eval/compiler workloads, although not in the sampled
   zlib loop. The current frame cache does not eliminate the copying work.

5. **The middle end is limited to local tree rewrites.** Existing single-use
   forwarding and small-function inlining help, but do not provide explicit
   control-flow edges, def/use information or call/memory-effect boundaries
   suitable for general allocation and redundancy elimination. More inlining
   or manually selected register preferences is not a substitute.

## Next architectural cut: compiler foundation, then semantic decomposition

First establish a shared, explicit control-flow/dataflow representation beneath
the existing standard-JS-subset frontend. It must make blocks, edges, value
definitions/uses and effects inspectable by name. Canonicalize empty blocks and
fallthrough at that level; allocate short-lived native values from their actual
lifetimes rather than granting one fixed set of locals registers for an entire
function. Preserve source/function associations for diagnostics.

This is not a mandate to introduce expensive whole-program SSA/optimization.
Start with bounded function/block-local analyses and account for their build
cost. Do not repeatedly traverse or clone the complete interpreter for each
opcode. Retain the structured JS backend until the common representation can
be consumed without regressing that path; do not force a slower switch-loop
emulation onto Node merely for representational symmetry.

Then decompose property operations by receiver/key category, with explicit
named outcomes for value, missing property, getter invocation and exception.
Keep coercion, descriptor, prototype and arguments-aliasing semantics shared.
The compiled hot path must not reconstruct the complete generic decision tree
for a simple indexed read. Any adaptive specialization must be a general VM
facility with mutation/GC guards and a correct generic fallback, not a check
for a demo or benchmark function name.

Treat activation/program layout as a separate measured cut: distinguish
immutable program operands from writable activation state, prepare stable call
layout data once, and keep argument/receiver/environment semantics explicit.
Do not casually change the value representation, assume away aliasing, retain
host objects as runtime state, or disable zeroing/root validation to save time.

Named field accessors and authoritative shared layouts remain required.
The compiler should eliminate accessor overhead. Kernel source must remain an
ordinary JS subset; do not add more compile-time reinterpretations of local
`var` declarations. Native instructions must use the macro assembler.

## Acceptance and build-cost controls

- Measure complete, unchanged workloads with the same budget. Report the four
  long Test262 cases and other tests separately. Include zlib hot execution and
  self-hosted compilation: neither is a proxy for every workload.
- Retain 3,292/3,292 Test262 passes. Existing project tests, bounded structural
  GC audit, supported Octane cases, servers and live demos must still work.
- Check Node, js_min and genuine self-hosted snapshot builds, including bit
  identity and build-stage timings. Do not replace rebuilding with copying,
  caches or cached parsing results. Do not hide a build-time regression behind
  a runtime gain.
- Keep generated artifacts ignored. Execute heavy runs serially. Use bounded
  GC stress rather than long unattended demo8 runs.
- Diagnostic sampling may perturb timings. Benchmark results must come from
  separate unprofiled runs. No substantial speedup is claimed at this point.

## Baseline investigation checkpoint

The iterative local-refactor candidate passed all 3,292 tests, both hosts'
12-program / 270-assertion project suites, Node/js_min bounded GC audits
(27 audits each) and the standalone 24-round / 47-collection GC workload.
It measured only 3.4% lower whole-suite elapsed time in one matched pair and
was parked at the user's request for architectural work. Its source patch is
an ignored artifact, not part of the production VM.

The queued js_min snapshot build was deliberately stopped when the work was
redirected; the subsequent self-hosted rebuild did not run. No completed
three-way snapshot or new live-demo/Octane regression claim is made for this
parked candidate. The profiling runs also deliberately terminate their child
after the sample window; they must not be counted as benchmark passes.

## First implementation: explicit dispatch-region blocks

`KernelCompiler.buildControlFlow(body, selectTest)` now provides the initial
shared block representation. It borrows expression and operation nodes; it
does not clone the interpreter IR or reparse source. The optional test selector
lets opcode dispatch prune constant tests during block discovery, rather than
building a full specialized tree first.

Each block has an ID, an ordered operation list and exactly one terminator:

- `branch`: evaluate the test once, then take the consequent/alternate edge.
- `jump`: unconditional successor, including loop backedges.
- `return`: the existing return operation and its ABI/inline-return semantics.
- `finish`: natural completion of this region, not a function return.

The builder preserves source/effect order and omits unreachable statements
after returns. Empty jump-only blocks are redirected with path compression.
Loop headers retain an explicit branch, including for constant loop tests, so
an empty infinite loop is not mistaken for an empty acyclic jump chain.
An empty conditional still evaluates its test; side effects are not discarded.

The native dispatch emitter consumes canonical edges and physical successors,
omitting jumps when the successor is the next block. This replaces its former
recursive conditional emitter. The ordinary JS backend remains unchanged.
The pre-existing structured emitter is still used outside dispatch regions;
this is a staged cutover, not yet a whole-function register allocator. Native
contract version is bumped to 75 so old cached native kernels are not reused.

Inspection (both bootstrap hosts and the standalone runner are supported):

```sh
node guest_vm/tools/inspect_kernel_build.js --blocks interpreterKernel
```

Initial evidence, not the final architectural performance target:

- Node project suite: 12 guest programs / 270 assertions pass.
- Snapshot executes `hello.js` and completes zlib quick correctness.
- zlib external elapsed: 33.68 s candidate / 35.78 s unchanged control;
  user CPU 33.29 / 35.52 s. These single runs are only preliminary evidence.
- Kernel code size: 411,214 -> 407,634 bytes. This is code size, not full
  snapshot size. Smaller code is not itself proof of a substantial speedup.
- Node-built snapshot: 2.992 s reported build time, including preparation and
  writing, comparable to the prior approximately 3 s builds.
- js_min project suite passes 12 guest programs / 270 assertions, including
  native execution. Standalone bounded GC passes 24 rounds / 47 collections.
- Genuine Node/js_min/self-hosted builds produce byte-identical snapshots.
  js_min external build time: 85.21 s, user CPU 84.30 s, peak RSS 356,272 KiB.
  Self-hosted external build time: 100.67 s, user CPU 99.75 s, peak RSS
  501,632 KiB. Matched unchanged-source controls take 83.98 s under js_min
  (83.43 s user CPU, 355,032 KiB RSS) and 101.97 s self-hosted (101.18 s CPU,
  508,544 KiB RSS). The small differences, +1.5% / -1.3% elapsed, do not
  establish a build-speed change. The control also passes three-way identity.
- Full standalone Test262: **3,292 passed / 0 failed / 0 timed out / 0 not
  run**. External elapsed 538.51 s, user CPU 535.97 s, peak RSS 576,032 KiB.
  Summed long-case time is 387.451 s, other-test time 135.002 s. Against the
  earlier unchanged control (636.82 s external; 481.531 / 138.635 s test
  categories), these are 15.4% / 19.5% / 2.6% lower, respectively. These are
  single-run comparisons: earlier historical baseline runs were approximately
  534--540 s, so do not present the 15.4% as an established repeatable gain.
- All ten supported Octane quick-correctness selections pass: Richards,
  DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes, Box2D, Gameboy
  and zlib. These checks are not stock scores or a claim that every Octane
  benchmark is supported. RegExp remains outside this work.
- The block-inspection tool successfully reports the bytecode-call graph.
- Demos 1--7 render and close from a synthetic Escape event at 320x240 / a
  requested 20 FPS limit. Demo8 visits garage and free-drive autopilot through
  the menu, renders, and exits cleanly. Final autodrive samples are around
  19--20 FPS. This is bounded smoke coverage, not a long soak or proof that the
  slow pure-JS demos achieve the requested frame rate. Demos 2/3 initially hit
  the harness timeout because their readiness messages differed; corrected
  readiness checks and normal render/close reruns pass. No demo source changed.
- `net.js` and `node_web.js` each serve byte-identical `hello.js`, the binary
  snapshot, and a directory listing containing `runtime.js`, over localhost.
- Both hosts' bounded structural GC audits pass: 27 audits / 87,198 references /
  221 property-index audits / 76 embedding collections. Maximum observed bump
  is 4,546,016 bytes under Node and 4,569,728 under js_min, with an 8 MiB cap.
  These complement the native 24-round / 47-collection workload above.
- Logs: `artifacts/flow-*`, all ignored. All heavy runs were serial; no new
  demo/benchmark sources, external-corpus edits, C changes, downloads or
  generated tracked files were required.

Next: extend the representation's useful scope and add def/use/lifetime
information without creating a second semantic implementation. The intended
benefit is general register/dataflow optimization and a smaller, clearer
interpreter implementation; branch cleanup alone is not the objective.

## 2026-10-29: rejected scalar-allocation experiments

Three straight-line scalar register-allocation variants passed their bounded
correctness probes but did not improve execution. zlib quick-correctness took
37.48, 37.08 and 37.58 seconds, respectively, against the then-validated block
emitter's 33.68 seconds (an earlier unchanged control was 35.78 seconds).
Those timings are not stock Octane scores. The extra register-boundary,
canonical-home and predecessor-handoff machinery did not earn its complexity;
none of these execution paths is retained in production. A liveness-only
experiment took 32.39 seconds, which also does not establish the requested
substantial gain. These experiments must not be described as successful
register allocation or as an improvement in general VM performance.

A further candidate used the existing block representation and emitter to
propagate integer constants through forward edges, refine equality edges and
intersect facts at joins. It discarded facts on backedges, without an iterative
analysis. It reduced code by only 793 bytes beyond the setter cleanup and took
31.71 seconds for zlib, versus 31.87 seconds for that cleanup and 31.14 seconds
for the current-session unchanged control. These results do not justify the
additional analysis/maintenance surface, so that pass is not retained either.
None of these changes used threads or a benchmark-specific execution path.

## Named-accessor checkpoint (not a performance win)

Fifty four-word scalar/reference/tag-only writes in the native interpreter
now use the existing named value-cell setters. The generated 407,634-byte
native code section is **byte-identical** to the unchanged control. This
removes 171 lines of repeated offset calculations without changing execution.

An experiment also made the compiler's named setters omit inactive words,
as permitted by the language-level tagged-union contract. It passed all
3,292 Test262 tests in 501.14 seconds and the project suite, but did not make
zlib faster (31.87 seconds versus the current-session 31.14-second control).
More importantly, Node/js_min snapshots then differed in retained inactive
payload words. The current writer preserves those bytes. Full-width writes
are therefore restored; do not reintroduce the omission without a measured
benefit and a deterministic serialization design. A whole-heap normalization
pass is not justified for an execution optimization that did not pay off.

The substantial execution-performance target remains open. Neither smaller
source nor this maintenance checkpoint should be reported as meeting it.

### Retained checkpoint validation, 2026-10-30 approximately 00:03 UTC

- Revision `88f94d5`, executable contract 77. Node/js_min/genuine self-hosted
  rebuilds produce byte-identical 5.8 MiB images. SHA-256 for all three:
  `d6d62044aebbcf75668ab588fef6898cd052b49f8cbdb173d42fa0ad188b5ad3`.
  Node reports 2.737 s for construction/preparation/writing (not external
  elapsed). js_min external elapsed 81.19 s, CPU 80.48 s, peak RSS 356,420
  KiB. Genuine self-hosted external elapsed 97.07 s, CPU 96.30 s, peak RSS
  508,800 KiB. These single observations are consistent with the existing
  build baseline, not evidence of a substantial build-speed improvement.
- Project suites pass on both hosts: 12 guest programs / 270 assertions,
  plus compiler, command-line and context-multiplexing checks.
- Native bounded GC workload: 24 rounds / 47 native-counter collections.
  Structural audits on both hosts: 27 audits / 87,198 references / 221
  property-index audits / 76 embedding collections, within an 8 MiB guest
  cap. Maximum observed bump: 4,546,016 bytes on Node, 4,569,728 on js_min.
- Ten supported Octane selections pass in fresh processes: Richards,
  DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes, Box2D,
  Gameboy and zlib. These are quick-correctness checks, not stock scores.
  Zlib takes 31.14 s external / 30.93 s CPU / 126,464 KiB peak RSS, matching
  the current-session unchanged control's 31.14 s external / 30.88 s CPU.
- A combined process loading all ten selections fails during zlib at the
  512 MiB guest allocation limit, after the first nine pass. The unchanged
  control reproduces the same opcode/PC/allocation failure. This is an
  existing cumulative-run limitation, not a new regression or a passing
  combined run. Keep it separate from the fresh-process checks above.
- Actual demos 1--7 render for 15 seconds after readiness and close via
  Escape, at 320x240 / a requested 20 FPS limit. Demo8 visits garage and
  free-drive autopilot and closes via the menu. Its samples are around
  19--20 FPS outside the garage-entry interval (one 16.9 FPS sample).
  These bounded smoke checks do not assert 20 FPS for the slower JS demos
  or constitute a long stability soak. No demo source changed.
- Both `net.js` and `node_web.js` serve byte-identical text and binary image
  downloads plus a directory listing over localhost.
- Latest complete Test262 result is recorded in `../TEST262_STATUS.md`:
  3,292 passes, zero failures/timeouts/not-run, for the subsequently rejected
  inactive-word experiment. The retained implementation's entire native
  code section matches the earlier validated control byte-for-byte; no new
  full-suite result is claimed for the final image.
- Raw logs/images are ignored `artifacts/accessors-*` and
  `artifacts/value-*`. All heavy workloads ran serially, except for one
  accidental brief overlap of the first zlib candidate with the Node project
  suite; that contaminated zlib timing was discarded. No threads, C changes,
  external-corpus changes or generated tracked files were introduced.
