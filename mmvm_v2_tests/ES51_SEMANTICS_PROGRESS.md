# Efficient ES5.1 semantic bring-up

## Scope of this checkpoint

Improve the shared frontend's statement completion handling and early-error
validation, with more passing Test262 cases and no workload-specific paths.
Keep ordinary function execution free of completion-record allocations and
additional interpreter dispatch. Preserve the existing kernel backends,
guest-owned execution, and genuine self-hosted snapshot rebuilding.

The immutable input corpus remains `../../js_tests/tests/test262`. No changes
to that tree or the demos are needed. Full-suite outcomes and failure counts
belong in `TEST262_STATUS.md`; this document explains the implementation and
performance tradeoffs rather than replacing that ledger.

## Statement values without allocating completion objects

ES5.1 distinguishes an empty statement completion from the value `undefined`.
For normal statement-list execution, an empty completion preserves the
preceding value. The compiler can implement that rule with an accumulator
register in eval code, rather than allocating records for every statement.

- Initialize the eval accumulator to `undefined` at entry, corresponding to
  an entirely empty script result.
- An expression statement copies its evaluated value into the accumulator.
  The copy is important: a later variable assignment must not mutate the
  already evaluated statement value.
- Empty and declaration statements do not update it. Conditions, loop
  initializers and updates are expressions, not expression statements, and
  must not update it either.
- Blocks, branches, loops, labels, switch and with bodies compile their
  statement lists using the same accumulator. Their normal/empty value
  propagation needs no new opcode or heap record.
- A catch path restores the prefix value from before its try block: values
  computed before an exception must not leak into an empty catch completion.
- A finally body starts with the prefix from before the try. On normal
  completion, discard its statement value and restore the pending try/catch
  result. An abrupt finalizer must retain its own completion instead.

Only compilation explicitly requesting a script completion value enables
this machinery. Ordinary functions and normal source/module loading keep
their existing bytecode and register behavior. Save/restore registers are
needed only for try statements in completion-producing code.

Eval selects a completion-aware statement entry on its compiler instance.
Expression statements are handled there; all other statements use the shared
ordinary lowering body, whose recursive calls retain the selected mode.
Ordinary compilation therefore has no new per-expression mode check. This
uses standard JS method selection, not compiler-only variable semantics, AST
mutation, or a duplicate statement compiler.

This first stage handled normal statement values. The protected-edge lowering
below extends it to abrupt exits; catch lexical environments remain separate
work. Existing runtime exception search remains responsible for throws.

## Protected-edge lowering

The compiler now keeps a single lexical region stack for installed exception
handlers, with scopes, and finally handlers. Each break/continue/label target
records the region depth it retains. A transfer emits cleanup only for the
regions it actually leaves, in innermost-first order:

- Handler: emit `POP_CATCH`, including pure try/catch handlers. Leaving one
  installed after a jump can incorrectly catch a later unrelated exception.
- With scope: emit `LEAVE_WITH` and adjust compiler-visible scope resolution
  while lowering any enclosing finalizers.
- Finally handler: pop its handler, then lower its finalizer in the lexical
  enclosing region/loop/label context, not in an inner loop of its try body.

Ordinary loop jumps that stay at the same depth emit the same jump as before.
The metadata exists only during compilation; there is no runtime region stack
or per-iteration allocation beyond the VM's existing exception machinery.
Handler/with markers are shared immutable compiler objects. Finalizers retain
the lexical target depths they need; ordinary loops use their existing patch
arrays as target records rather than adding separate wrapper records.

Unwind lowering copies compiler stacks only when a scope change or finalizer
needs them, then restores the original state for other control-flow paths.
Pure handler cleanup walks the original stack without allocating copies;
ordinary same-depth jumps do not call the unwind helper. Each finalizer is lowered with
only its own enclosing jump targets visible. This matters when a finalizer's
break/continue overrides a pending exit from a loop inside its try block.
An abrupt finalizer exits before the pending transfer is emitted/executed.
There is one lowering implementation, not separate ad hoc return, break and
continue cleanup algorithms.

Returns use the same region walk, stopping after the outermost finalizer.
The return boundary itself discards the frame's remaining handlers and
environments, so pure try/catch returns need no explicit cleanup bytecodes.
When a finalizer exists, snapshot the evaluated return value only if it is
held in a mutable named-binding register. Those occupy the compiler's initial
binding-register prefix; private temporaries, constants and environment-load
results are already independent values. Assignment to the original binding
must not change an already evaluated return value. Catch binding
instantiation/shadowing is not implemented by this region stack and must not
be claimed fixed by these changes.

Finalizers currently retain the preexisting inline-lowering policy. Shared
epilogues/continuations are a possible later code-size improvement for very
large finalizers with many abrupt exits; they would need to preserve the
ordinary-path performance that inline cleanup provides.

### Protected-edge validation, 2026-10-28

The first complete standalone run of this lowering completed all 3,292
authored tests: **3,179 passed / 113 failed / 0 not run**, with the same six
timeouts included in failures. Exact failure-ID comparison with `ec5e517`
shows **11 new passes and zero new failures**. Elapsed 414.29 seconds, user
CPU 411.47 seconds, peak RSS 549,536 KiB. Raw log:
`artifacts/unwind-test262.log`. This is the initial implementation's result.
The final compiler-allocation/return refinements have now completed the same
inventory with **3,179 passed / 113 failed / 0 not run / 6 timeouts**, exactly
the same failing IDs, in **431.43 seconds**, user CPU 423.77 seconds, peak RSS
549,496 KiB. Log: `artifacts/unwind-final-test262.log`. These measurements
span a reboot; a fresh old-image control is pending to distinguish execution
performance from changed machine conditions.

Those refinements pass both host project suites (12 guest programs / 270
assertions each) and produce byte-identical Node, js_min and genuine self-hosted
snapshots. Self-hosted construction measured 102.05 seconds versus the
preceding checkpoint's 111.39 seconds, but the js_min build-performance gate
remains open: recent measurements vary from 92.53 to 96.73 seconds versus
an isolated baseline's 90.37 seconds. Do not infer non-regression from image
identity or from the faster self-hosted build alone.

Focused build profiles after reboot show inclusive compiler time of 41.42
seconds for the changed source versus 43.18 seconds for the baseline, while
parsing and program registration vary in the opposite direction. These are
instrumented, overlapping timings, not throughput numbers. A fresh ordinary
control/change pair subsequently completed in **103.29 seconds for the
baseline / 99.26 seconds for the changed build**, with peak RSS 331,308 /
329,344 KiB. The changed image is identical to all three previously built
release images. This same-session comparison does not show a build slowdown;
the spread across runs also prevents a statistical speedup claim.

The final workload gates pass:

- All ten previously working standalone Octane quick selections: Richards,
  DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes, Box2D, Gameboy
  and zlib. RegExp remains excluded at the user's request. Changed-image zlib
  took 36.75 seconds; a fresh old-image control took 36.47 seconds, with peak
  RSS 126,080 / 126,208 KiB. This is quick correctness, not a stock score or
  evidence of a meaningful throughput difference.
- Bounded native GC workload: 24 rounds / 47 native collections.
- Live demos 1–8 at 320x240 / 20 FPS cap, input and clean exit, with demo8
  garage and free-drive autopilot. These are bounded interaction checks, not
  long soaks or guarantees of sustained frame rate.
- Both HTTP servers: text, byte-identical binary snapshot, directory listing.

No demo, external test, benchmark source or runtime/kernel implementation was
changed for this checkpoint. No generated image is checked in.

## Frontend representation and early errors

Compact literal ASTs represent `0`, `false`, and the empty string directly.
An optional expression must therefore be tested against its absence sentinel,
not by truthiness. In particular, a switch's default arm has a null test;
`case 0`, `case false`, and `case ""` are not default arms.

Function-body context belongs to the parser. Tracking function nesting at
the common function-body entry point covers ordinary functions and accessor
bodies, and allows top-level return to be rejected before execution. Nested
function creation still uses ordinary JS scoping, not compiler-only variable
semantics or extra host behavior.

## Validation policy

Run heavy tests serially. Record fresh baseline and changed build timings for
Node, js_min and a genuine self-hosted rebuild. Require byte-identical images
across all three build paths at each checkpoint. Compare full Test262 failing
IDs, not merely totals; previously passing tests must remain passing.

Also retain the both-host project suites, standalone Octane quick-correctness
checks (excluding the requested RegExp benchmark), bounded GC stress, HTTP
binary/text serving and short live demo interactions. Quick correctness runs
are not stock Octane scores; a frame-limited demo check is not an interpreter
throughput measurement. Use measured results rather than claiming V8-jitless
parity from conformance progress alone.

## Measurements, 2026-10-28

Fresh baseline at `4ea036a`, with heavy commands run serially:

- Node snapshot build: 6.57 seconds, peak RSS 254,376 KiB.
- js_min snapshot build: 95.01 seconds, peak RSS 327,588 KiB.
- Genuine self-hosted snapshot build: 120.72 seconds, peak RSS 483,328 KiB.
- All three baseline images compare byte-identical.
- Complete standalone Test262 baseline, instruction limit 20,000:
  3,139 passed / 153 failed / 0 not run, including six timeouts;
  403.81 seconds, peak RSS 549,396 KiB.
- Standalone zlib quick correctness baseline: passed in 35.51 seconds,
  peak RSS 125,824 KiB. This is not a stock Octane score.

An initial completion-mode check in every expression-statement compilation
passed the Node suite and three-way image identity, but build times were
98.18 seconds under js_min and 126.33 seconds self-hosted. Replaced that
avoidable common-path check with the eval-specific method entry described
above. The optimized Node build measured 6.35 seconds and the Node project
checks still passed (12 guest programs / 270 guest assertions).
Remaining final measurements are recorded after completion, not inferred from
the initial experiment or historical runs on another boot.

Final full standalone Test262 run: **3,168 passed / 124 failed / 0 not run**,
including the same six timeouts. Exact failing IDs show **29 new passes and
zero new failures** against the fresh baseline. Elapsed 396.74 seconds,
user CPU 394.80 seconds, peak RSS 549,476 KiB. The improvements comprise
thirteen loop/enumeration completion cases, five switch cases, one strict
try/eval case and ten early-error cases. See the status ledger for scope and
remaining failures.

The optimized genuine self-hosted build measured **111.39 seconds**, user CPU
110.56 seconds, peak RSS 484,096 KiB, and compares byte-identical with the
optimized Node image. This and the Node measurement are single-run results,
not evidence of statistical significance.

Final js_min build: **90.40 seconds**, user CPU 89.79 seconds, peak RSS
331,324 KiB, versus the fresh baseline's 95.01 seconds. All three final
images compare byte-identical. These builds do not substitute a disk-backed
compilation cache or copy an existing snapshot in place of compilation. Normal
reuse of parsed function bodies within the build pipeline remains enabled in
both the baseline and changed builds.

Final workload gates:

- Both complete project suites pass: 12 guest programs / 270 assertions per
  host, plus embedding, heap, GC, compiler and command-line checks.
- Standalone zlib quick correctness passes in **34.90 seconds**, user CPU
  34.74 seconds, peak RSS 126,080 KiB, versus the fresh baseline's 35.51
  seconds. These are single-run end-to-end quick measurements, not stock
  scores or proof of a significant interpreter throughput change.
- The other nine previously working standalone Octane quick runs pass:
  Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes,
  Box2D and Gameboy. The requested RegExp benchmark exclusion is unchanged.
- The dedicated GC workload passes 24 rounds / 47 native collections.
- Live demos 1–8 open at 320x240/20 FPS and exit cleanly; demo8 also visits
  garage and free-drive auto-pilot. These are short interaction checks, not
  long soak tests or sustained-FPS guarantees.
- Both HTTP servers serve text, a byte-identical binary snapshot and directory
  listings. No demo or external test source was changed.

V8-jitless reference for the same quick zlib wrapper:

```sh
node --jitless octane_node_runner.js --quick zlib
```

Node v24.14.1 passed in **17.54 seconds**, user CPU 17.34 seconds, peak RSS
46,952 KiB. The guest's 34.90-second run is about **1.99 times** this elapsed
time, so it has not reached jitless parity on this workload. This comparison
includes startup, parsing, setup and teardown; it is one quick workload, not
a stock-score or comprehensive interpreter comparison. Keep it as a reference
for subsequent general runtime improvements rather than optimize for a zlib
name or source pattern.
