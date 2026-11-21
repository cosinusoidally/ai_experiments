# Shared semantics and execution contracts: November cleanup

Work begins on guestVM-refactor after `2f44748`. This is forward refactoring,
not a second interpreter, application specialization or a change to ES5.1
semantics. No external tests or demos are modified. Heavy gates run serially.

## Sequence and acceptance

1. **Instruction operands.** Make the existing bytecode schema authoritative
   for register representation. Introduce compiler-checked instruction/operand
   access and migrate opcode families in bounded groups. Reject constant-pool,
   lexical-slot or branch operands presented as registers. Keep mixed canonical
   and predecoded execution views without runtime representation branches.
2. **Property keys.** Give allocation-free classification and primitive names
   one owner. Share conversion between property-operation families, preserving
   dense integer paths. Callback-bearing coercion remains a traced guest
   activation, not a host fallback or an unrooted progress object.
3. **Semantic modules.** Extract coherent implementations from the interpreter
   as they acquire shared ownership, not merely to shorten a file. Preserve
   explicit graph bindings and existing inlining. Remove superseded code.
4. **Execution convergence.** Move operation families to shared kernels and
   guest continuations, deleting competing semantic implementations after
   acceptance. Embedders retain scheduling and external services, not a second
   language authority. This is staged, not a claimed complete conversion.
5. **Lifetimes.** Encapsulate collection-capable boundaries, temporary roots,
   retained programs and suspended execution ownership. Keep the non-moving
   heap and avoid new work in allocation-free leaf operations.
6. **Diagnostics/register.** Identify the rejected operation/coercion, retain
   source/stack information and reconcile dated issues with current receipts.

Use existing broad integration/compiler/GC coverage during each cutover.
Compare native instructions for representation-only changes. Measure build
cost separately: byte-identical native code does not prove compiler speed.
At meaningful combined checkpoints run Test262, exact ECMA filename comparison,
representative Octane, bounded demos/HTTP/GC and genuine self-hosted fixed-point
checks. Do not repeat every full suite for every small edit.

## Working log

2026-11-21, operand boundary implementation:

- `instructionRegisterCellAddress(base, registers, opcode, position, operand)`
  lowers through the existing indexed-address IR. Opcode and position must be
  constants and identify a register in `bytecode.js`; the private execution
  register mask selects the stride. No new backend IR or runtime branch.
- Dynamic property-read and numeric-write accesses use this boundary. Remaining
  opcode families still use the older accessors and require migration; the
  introduction is not completion of step 1.
- The default native kernel is byte-identical to the pre-cleanup image:
  699151 bytes. Compiler integration coverage exercises both views/backends
  and rejection of a constant-pool operand. Node and i386 js_min core suites
  pass (12 programs / 321 assertions plus embedding/compiler/GC checks).
- Genuine self-hosted build reproduces the Node image byte for byte:
  82.34 s / 479712 KiB peak RSS, versus the preceding measured 82.72 s /
  479756 KiB. These single observations show no material regression; they
  are not a statistical speedup claim. Receipts: ignored
  `artifacts/cleanup-operands-*`. Full suites are deferred to the combined
  semantic checkpoint rather than repeated for byte-identical instructions.
