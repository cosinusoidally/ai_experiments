# Property references and guest key conversion

Follow-up to the shared-property checkpoint `d89d99d`. Work is staged; this
document distinguishes the intended cutover from completed acceptance.

## Required semantics

Computed member evaluation captures the base and key once. CheckObjectCoercible
and object-key ToString happen while forming the reference, not after an
assignment's right-hand side. A compound assignment/update must not convert an
object key once for the read and again for the write. Membership validates its
right operand before key conversion. Delete preserves the caller's strictness.
Callbacks may mutate objects, throw arbitrary values, reenter the VM or cause
collection. Their progress and live values must be ordinary traced guest frames.

## Execution design

- Property register access is schema-checked, including shared instruction
  branches. A constant opcode family is accepted only when every member has
  the named register operand and the same execution-view representation.
- Capture write references in compiler-owned registers before the RHS. Primitive
  keys retain the existing index/name fast paths. Object keys convert through
  one pristine guest implementation, shared with descriptor operations and
  portable property-key conversion. Do not substitute host String/ToPrimitive
  for guest callbacks.
- Receiver checking and key preparation have explicit bytecode contracts.
  Avoid extra preparation where a syntactic proof makes it unnecessary; do
  not infer a variable's type from its spelling or specialize for demos.
- Cold object-key reads, membership and deletion can enter small guest
  continuations which call the same normalized operation. This avoids retry
  flags, mutating source registers, or a second callback state machine.
- Private conversion/operation callables are runtime-owned traced references,
  initialized using deterministic source, not bootstrap-host Function.toString.
  Capture pristine invocation and error primitives before user code runs.
- Extract execution helpers by semantic contract. Keep allocation/getter/
  exception/frame-entry outcomes explicit, with caller PC and result destination
  preserved. Do not hide an unsupported operation in a host callback.

## Acceptance and performance

Use the existing property integration fixture for conversion order, one-time
conversion, reentrancy, thrown identity and GC in callbacks. Compare observable
results with stock Node. Validate both compiled backends/operand modes, broad
language suites and bounded application/GC gates at combined checkpoints.
Measure actual hot-loop/build cost; byte-identical instructions are strong
evidence for representation-only changes, not for new reference preparation.
Preserve genuine cross-host/self-hosted fixed-point snapshot construction.

## Progress

- Property operand migration and instruction-family validation implemented
  (contract 112). Node and i386 js_min core pass both operand modes. A genuine
  standalone build reproduces the Node snapshot byte for byte (87.25 s /
  479188 KiB peak RSS). The earlier old-seed construction was 86.25 s /
  478800 KiB; final build comparisons remain required after conversion work.
  General callback conversion is not implemented by this representation step.
