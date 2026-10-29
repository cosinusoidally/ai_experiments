# Interpreter architecture and CPU cost

Investigation checkpoint: 2026-10-29, `guestVM-cleanup`.

The small declaration-walker/base-address experiments are parked, not retained
as the solution. Production VM sources are unchanged from the pre-investigation
implementation. The objective is substantial general-purpose improvement by
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

## Current working-tree checkpoint

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
