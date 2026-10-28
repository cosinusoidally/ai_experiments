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

This is a first stage, not a claim of a complete abrupt-completion redesign.
Break/continue across protected regions and catch lexical environments still
need their own general unwinding/environment work. Existing exception and
return machinery remains in use during this checkpoint.

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
