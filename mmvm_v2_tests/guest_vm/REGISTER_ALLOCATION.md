# Conservative temporary-register packing

`register_allocator.js` is a shared bytecode-compiler pass, not native code
generation and not an application-specific fast path. Both hosts use the same
pass. Its purpose is to reduce register-bank initialization, frame size and GC
scanning without changing execution order or instruction/source positions.

The existing optimizer first performs integer specialization and copy
coalescing. Packing then uses the authoritative `SOURCE_OPERANDS`,
`DESTINATION_OPERANDS` and instruction widths from `bytecode.js`.

## Safety boundary

- Entry, branch targets and instructions following terminators delimit basic
  blocks. A reusable temporary must have exactly one definition, all accesses
  in one block, and no read before its definition.
- Named binding slots retain their original indices. Preloaded constants,
  hinted registers and values accessed from multiple blocks have private
  storage. This is deliberately not a whole-function liveness analysis.
- Catch/with instructions cause packing to decline the function entirely.
  The function still executes normally; only the optimization is omitted.
- CALL's negative receiver sentinels are not registers and are preserved.
- A slot is reusable only when its previous interval ends **before** the
  next interval starts. Inputs and destinations of one instruction never
  become aliases solely because of packing. This also covers instructions
  which suspend or enter a guest accessor.

These restrictions avoid relying on exception-edge approximations or hidden
JavaScript semantics. Escaping closures and dynamic eval still use the
compiler's existing binding/environment representation.

## Allocation and rewriting

One scan collects access intervals and block ownership. Private slots are
assigned first, in original-register order. Each eligible interval starts at
its only definition, with at most one destination per instruction. Instruction
order is therefore already allocation order; no interval objects or sort are
needed. Expired slots go on a free list. Ordering is deterministic across hosts.

Rewriting changes register operands, private CALL/CONSTRUCT argument vectors,
constant-register maps and hint maps. It does not change PCs, lexical slots,
constant indices, jump targets or source locations. Argument vectors are
replaced rather than mutating a potentially shared input array.

`program.optimizationStats.registersBeforePacking` and
`registersAfterPacking` expose the result for introspection without freezing
an exact register layout in language tests. A pass that cannot reduce the
bank leaves the descriptor unchanged. Storage is linear in bytecode/register
counts; there is no blocks-times-registers liveness matrix.

## Validation

The existing language, embedding, kernel and GC tests exercise the output;
Test262 and unchanged demos supply higher-level semantic coverage. A reduction
in register count is not itself a performance result. End-to-end snapshot
build timings and regressions are tracked in `../BUILD_PERFORMANCE.md`.
