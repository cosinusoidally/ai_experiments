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
549,496 KiB. Log: `artifacts/unwind-final-test262.log`. The preceding
396.74-second checkpoint run was before a reboot. A fresh same-boot old-image
control now completes in **415.19 seconds**, user CPU 412.49 seconds, peak
RSS 549,608 KiB, with its original **3,168 passed / 124 failed / 0 not run /
6 timeouts** and identical failing IDs. Log:
`artifacts/unwind-control-test262.log`. The changed image is about **3.9%
slower elapsed / 2.7% more user CPU** in this single pair; the peak RSS is
essentially unchanged. This is an outstanding suite-time difference, not
evidence of performance parity or a statistically established slowdown.
The zlib/build comparisons below do not erase that observation.

Those refinements pass both host project suites (12 guest programs / 270
assertions each) and produce byte-identical Node, js_min and genuine self-hosted
snapshots. Node construction measured 6.69 seconds; genuine self-hosted
construction measured 102.05 seconds versus the preceding checkpoint's
111.39 seconds. Self-hosted peak RSS was higher: **543,360 KiB versus
484,096 KiB**. A faster build does not establish a memory improvement; the
extra peak remains a separate optimization concern. Initial js_min
measurements varied from 92.53 to 96.73 seconds versus an isolated baseline's
90.37 seconds and therefore required the fresh comparison below. Image
identity alone is not a performance gate.

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

### Function descriptors and lexical declarations (contract 67)

Bytecode function creation now has one shared kernel initializer for ordinary
`MAKE_FUNCTION`, frontend program adoption and dynamic Function construction.
The callable has an own, immutable, non-enumerable, non-configurable `length`
derived from its program's parameter vector. Its `prototype` is writable but
neither enumerable nor configurable. The new prototype's `constructor` is
writable/configurable and non-enumerable. The reference execution path builds
the same guest-heap descriptors; `Function.prototype.length` is zero.

Functions still use the existing function-record linked-property layout;
ordinary objects use packed owner-relative entries. Mixing those entry-ID
conventions is invalid. The common callable allocation-size constant lives
with the heap layout, and all three native construction sites reserve that
size before initialization. The data-property initializer accepts real value
tags rather than a separate undocumented numeric value-kind convention.

Boolean conversion now inspects a referenced guest string's length; empty
strings are false without treating empty String wrapper objects as false.
Named property lookup cannot overwrite a failed null/undefined receiver
guard merely because its key is a string.

`this` expression lowering bypasses dynamic identifier resolution: a with
object cannot shadow the execution context's `this` binding. Function-local
receiver bindings retain their lexical environment depth, including intervening
with environments; script code uses the existing global-this opcode. Variable
declaration collection now descends through labels and with bodies, without
descending into nested functions. This hoists even unreachable declarations
while leaving their initializers in place. Strict catch bindings named `eval`
or `arguments` are rejected by the parser before execution.

The historical Test262 wrapper also distinguishes a positive `NotEarlyError`
exception pattern from the negative-lookahead pattern that excludes that
sentinel. This is harness interpretation, not a VM semantic improvement or a
corpus exception. The external tests remain unchanged. Validation results are
recorded in `TEST262_STATUS.md` after completed runs.

The first complete contract-67 run is **3,227 passed / 65 failed / 0 not run**,
including six instruction-limit timeouts: 48 new passes, zero new failing IDs.
Of these gains, 45 are VM semantics and three are wrapper interpretation.
The Node project suite passes 12 programs / 270 assertions; all ten previously
working standalone Octane quick selections pass, as does the bounded GC
workload (24 rounds / 47 collections). Quick zlib took 33.34 seconds, user
CPU 33.10 seconds, peak RSS 126,208 KiB; this is not a stock score.

Node, js_min and genuinely self-hosted snapshots compare byte-identical.
The js_min build took 92.22 seconds (90.96 user, 331,168 KiB peak RSS);
self-hosted construction took 114.77 seconds (113.65 user, 480,768 KiB peak
RSS). These are individual measurements, not statistically significant
performance comparisons. The complete js_min project suite also passes
(12 programs / 270 assertions plus embedding/CLI checks). Live demos 1–8
pass bounded 320x240/20-FPS-cap interaction checks, including demo8 garage
and free-drive autopilot, and both HTTP servers pass text/binary/listing
checks. No demo, external test or benchmark source was modified. This
checkpoint is revision `ec3347f`; subsequent work uses a newer contract.

### Restricted accessors and arguments instantiation (contract 68)

Strict functions have non-enumerable, non-configurable `caller` and
`arguments` accessors. Strict arguments objects have the corresponding
`caller` and `callee` accessors. All getters and setters in a runtime refer
to its single ThrowTypeError callable, also used by bound-function restricted
properties. That callable now has a native intrinsic: it allocates a guest
TypeError and uses the interpreter's existing exception unwinder, never a
host JavaScript exception callback. Its declared length is zero.

The runtime-support vector roots the thrower and shares the property keys
and message. Native callable sizing/initialization is shared; only strict
functions reserve the additional descriptor records. Strict arguments objects
are marked unmapped even when their function uses a register frame, rather
than accidentally retaining its enclosing environment as a parameter map.
The named unmapped sentinel is shared by reference and native implementations.
Callable descriptor linkage preserves creation order when reflected: length,
prototype, then the restricted properties.

A formal parameter named `arguments` supplies that binding itself; function
entry must not replace it with an arguments object. The compiler records no
automatic arguments slot in that case. Otherwise direct eval conservatively
requires an arguments binding, even without an explicit arguments identifier
in the parsed body. Reference frame setup now avoids constructing unobserved
arguments objects, matching the native path instead of paying an allocation
for every ordinary call. This does not implement the still-missing permanent
parameter-map detachment after deleting an arguments index.

The complete initial contract-68 implementation passed **3,262 / 3,292**
tests, with 30 failures including six instruction-limit timeouts, zero not
run, and **35 new passes / zero new failures** against contract 67. Elapsed
417.71 seconds, user CPU 414.60 seconds, peak RSS 549,752 KiB. Both the initial
implementation and a subsequent call-setup refactor pass the Node project
suite. That refactor reuses the immutable callee flags instead of loading
them repeatedly for receiver/arguments setup; its focused selection passes
35 of the prior 59 non-timeout failures, leaving the same 24.

All ten previous standalone Octane quick selections and bounded GC stress
pass the initial implementation. The flag-reuse build also passes GC stress
and zlib quick correctness. Recent zlib timings were 35.33 seconds for a fresh
contract-67 control, 36.46 for the initial implementation and 37.19 for the
flag-reuse build. These individual runs indicate a possible small cost, not
a speedup or proven throughput parity. The final combined changes need a
fresh full-suite and complete workload/build regression sweep. Neither of
the separately prepared formatting/lexical kernel modules is loaded by the
contract-68 checkpoint.

### Canonical number formatting (contract 69)

`number_format_kernel.js` separates shortest-digit selection from ES5.1
9.8.1 presentation. For finite nonzero binary64 values it searches decimal
precision 1–17, using guest-owned libc snprintf/strtod to choose the smallest
precision that round-trips to the original value. The search takes at most
five trials and one final formatting call. A separate formatter applies the
standard's fixed/scientific thresholds, explicit positive exponent sign and
absence of leading exponent zeroes. Zero, negative zero, NaN and infinities
retain their existing explicit spelling. There is no host JS conversion or
per-number cache.

The caller reserves one string record with bounded scratch storage. Candidate
digits, formatting pattern and final ASCII occupy named non-overlapping
regions; widening to UTF-16 happens only after conversion. All services use
the existing guest FFI. Signed int32 values bypass libc and use the existing
integer radix formatter, also avoiding an oversized per-integer scratch record.

The complete imported number-to-string section passes **10/10**, including
all four previously failing files. The Node project suite, bounded GC stress
and standalone zlib quick correctness also pass (36.40 seconds / 36.19 user /
126,592 KiB peak RSS). This is a focused checkpoint, not a new whole-suite
total or an assertion of complete decimal-library conformance. The combined
changes still require the final complete workload and snapshot fixed-point
checks before the overall task is done.

### Object operations and inherited enumeration (contract 70)

The numeric-NaN shortcut no longer bypasses observable object coercion when
the other operand is undefined. In particular, addition must let ToPrimitive
select string concatenation before deciding its result. Unhandled object
coercions use the guest-executed semantic interpreter, not a host JS engine.
Likewise, an unsuccessful integer-index probe in `in` does not imply a
missing property: negative/fractional/nonfinite numbers still require a
property-key conversion. Array length deletion now respects its immutable
non-configurable descriptor, including strict-mode error routing.

`object_operations_kernel.js` centralizes representation-specific prototype
selection and implements the `isPrototypeOf` intrinsic. It also supplies
enumeration shadow checks: a nearer non-enumerable own property suppresses
an inherited enumerable name just as an enumerable own property would.
For-in enumeration visits the prototype chain in nearest-owner order and
preserves each owner's insertion order. Ordinary own-entry loops avoid
duplicate probes; inherited candidates consult the existing property lookup
machinery. Indexed source-array elements retain their ordering. Unhandled
exotic/indexed prototype cases use the matching guest semantic enumeration.

The reference interpreter now distinguishes inherited enumeration from
`Object.keys`, which remains own-only. Standard prototype methods and
constructor links are installed with writable/configurable, non-enumerable
attributes via one helper; user assignments keep ordinary property semantics.

The full standalone inventory completes **3,277 passed / 15 failed / 0 not
run**, including six instruction-limit timeouts: 15 new passes, zero new
failing IDs against contract 68. Elapsed 335.34 seconds, user CPU 328.94,
peak RSS 549,644 KiB. Node project checks and bounded GC stress pass. This
run follows a reboot, so its faster elapsed time alone is not proof of an
interpreter-throughput improvement. Nine non-timeout failures remain.

All ten previously supported standalone Octane quick correctness selections
also pass: Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay,
NavierStokes, Box2D, Gameboy and zlib. The serial zlib run took 35.29 seconds
(35.03 user CPU, 126,464 KiB peak RSS). These are correctness gates, not
stock benchmark scores. RegExp remains excluded as requested.

Compact literal ASTs represent `0`, `false`, and the empty string directly.
An optional expression must therefore be tested against its absence sentinel,
not by truthiness. In particular, a switch's default arm has a null test;
`case 0`, `case false`, and `case ""` are not default arms.

Function-body context belongs to the parser. Tracking function nesting at
the common function-body entry point covers ordinary functions and accessor
bodies, and allows top-level return to be rejected before execution. Nested
function creation still uses ordinary JS scoping, not compiler-only variable
semantics or extra host behavior.

### Catch scope and permanent arguments detachment (contract 71)

Catch entry now constructs a fresh one-binding declarative environment rather
than overwriting a function/global variable. The compiler exposes that scope
to nested closures and counts it when resolving outer lexical slots and
`this`. Normal and abrupt exits share the existing lexical cleanup mechanism.
Synthetic exceptional-finally continuations use the same scope representation,
including when nested inside `with`; their private exception name is no longer
hoisted into the user variable environment.

The environment's existing reserved reference is now explicitly scope data:
an object for `with`, a name string for catch, or a lazy integer bitset for
detached arguments aliases. Named flags/accessors distinguish these meanings.
Both collectors trace the raw reference, while semantic object-environment
lookup excludes declarative scope data. Native catch construction reserves
storage before changing the handler/frame state, allowing allocation failure
to use the normal GC/retry protocol without losing the pending exception.

Deleting a mapped argument index permanently detaches its parameter alias.
Recreating the index cannot reconnect it. The bitset is allocated only on a
detaching operation; ordinary calls and unmodified arguments objects keep
their compact shared parameter-slot layout. Missing actual arguments cannot
acquire aliases through a later assignment. Both execution paths use the same
representation and retain the existing duplicate-parameter rules.

See [the lexical-environment design](guest_vm/LEXICAL_ENVIRONMENTS.md) for
layout, lifetime, embedding and validation details. The unchanged nine
previously failing non-timeout Test262 cases now all pass in the focused
standalone run. Full-suite and workload gates are recorded after completion;
this focused result alone is not a new whole-suite total.

The complete standalone run then finished **3,286 passed / 6 failed / 0 not
run**. Every remaining failure is one of the same six diagnostic-budget
timeouts; the failing-ID comparison finds nine new passes and no regressions.
Elapsed 354.71 seconds, user CPU 347.00 seconds, peak RSS 549,676 KiB.
The final image also specializes native dispatch for the new opcode and
handles equivalent string/numeric argument-index deletions consistently.

Initial regression gates pass on the final image: the complete Node project
suite (12 programs / 270 assertions plus embedding/compiler/CLI checks),
standalone GC stress (24 rounds / 47 native collections), and bounded
structural GC auditing (27 audits / 87,198 checked edges / 76 embedding
collections). The audit's maximum observed guest bump is 4,545,888 bytes
within its 8 MiB cap. The retained graph now includes escaped catch closures
and permanently detached arguments, and the audit validates their scope-data
record kinds. Further build/demo/benchmark gates are recorded separately.

Three-way rebuilding on the frozen contract-71 source succeeds. Node, js_min
and a genuine standalone self-hosted build produce byte-identical 6,235,792
byte images (SHA-256
`61bc055000832223f055da0cf50312cb58722f0784df1b55ed7823302154c57d`).
No source/environment/program state is copied from the input snapshot to
substitute for compilation.

- Node: 7.04 seconds elapsed / 7.78 user CPU / 279,240 KiB peak RSS.
- js_min: 100.38 seconds / 99.11 user CPU / 344,660 KiB peak RSS.
- Genuine self-hosted: 125.23 seconds / 123.92 user CPU / 504,192 KiB peak RSS.

These are end-to-end single builds. They are slower than the contract-67
92.22/114.77-second js_min/self measurements, which preceded this batch's
additional language/kernel implementations and a reboot. Do not present them
as proof of unchanged build performance or throughput parity. The original
2026-10-28 starting-build measurements below remain available for context;
runtime workload checks are tracked independently.

Final contract-71 workload gates (2026-10-29, serial execution):

- Both complete project suites pass: 12 guest programs / 270 assertions per
  host, plus embedding, compiler, heap, command-line and context checks.
- Bounded GC structural auditing passes under both hosts: 27 audits,
  87,198 checked edges and 76 embedding collections. Maximum observed guest
  bumps are 4,545,888 bytes (Node) and 4,569,600 bytes (js_min), with an 8 MiB
  cap. The separate standalone workload passes 24 rounds / 47 collections.
- All ten supported standalone Octane quick correctness selections pass:
  Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, Splay, NavierStokes,
  Box2D, Gameboy and zlib. The requested RegExp exclusion is unchanged.
  Final zlib: 35.67 seconds / 35.47 user CPU / 126,592 KiB peak RSS. A fresh
  same-boot contract-70 image control passes in 35.06 seconds / 34.85 user CPU
  / 126,464 KiB. Single quick runs do not establish exact throughput parity;
  the measured difference is about 1.7%, not a large runtime change.
- Live demos 1–8 open at 320x240 with a 20 FPS limit, run through multiple
  frame reports, and exit cleanly. Demo8 additionally visits garage and
  free-drive auto-pilot; its later reports are around 19.5–20 FPS, with a
  slower 17.1 FPS mode-transition interval. The garage capture shows its
  rendered car and floor. These are short interaction checks, not soak tests.
  The older interpreted demos do not sustain the configured 20 FPS limit:
  demo1 reports 2.6–2.8 FPS; the fresh older-image control reports 2.7–2.8 FPS.
  Do not misrepresent a configured frame limit as measured throughput.
- The unchanged NativeCompiler dependency workload passes under js_runner:
  nested calls, mutual recursion, nine arguments, lifetime and error paths.
- Both HTTP servers serve text, a byte-identical 6,235,792-byte binary image,
  and directory listings. No demo, C source or external test file was changed.

Raw generated logs/captures remain ignored under `artifacts/es51-final-*`;
none are committed.

After every gate above, the final byte-identical image completes the entire
unchanged Test262 inventory again: **3,286 passed / 6 failed / 0 not run**,
with all six failures being the exact same diagnostic-budget timeouts.
Elapsed **336.51 seconds**, user CPU **334.19 seconds**, peak RSS **549,788
KiB**. The earlier same-boot scope checkpoint was 354.71 seconds; this is a
second complete measurement, not an isolated proof of which cleanup caused
the difference. Against contract 70, nine formerly failing cases pass and
no previously passing ID fails. There are no remaining non-timeout failures
in the imported 3,292-file corpus. This is not a claim that an imported subset
exhaustively proves every ES5.1 library behavior.

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
