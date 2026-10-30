# Native execution cursor

Planned next change: keep an execution-view instruction address rather than a
word-index PC in the native interpreter's hot loop. The canonical program,
bytecode operands, saved frame PCs, verifier, budget protocol and diagnostics
remain word-indexed. Both backends execute the same kernel algorithm.

The current loop retains a bytecode base and a word PC in registers and forms
`base + (pc + operand) * wordBytes` for each operand. A cursor instead reads
operands relative to the current instruction and advances by instruction bytes.
This should simplify decoding and make a register available for the lexical
environment. It is not opcode fusion, program-specific specialization or JIT
compilation of guest programs.

## Representation boundaries

- Execution cursor: transient native/linear-memory address, never a new pointer
  stored in a guest frame or program record.
- Canonical PC: `(cursor - executionBase) >>> wordIndexShift`. Derive it when
  suspending, reporting an error, entering a call or recording a handler.
- Jump/resume target: convert its canonical word offset to an execution address.
- Operand reads: use named flat-bytecode accessors rather than repeated raw
  address calculations. Word geometry comes from the heap's shared definition.
- Ordinary instruction advance: advance the cursor by width times word bytes.
- Frame changes: refresh the execution base, constants, register bank and
  environment, then reconstruct the cursor from the new saved word PC (or zero
  for a new callee).

## Correctness audit

Audit ordinary/conditional jumps, fused comparison branches, indexed-read
conversion fusion, call/apply/construct/eval, accessor calls, returns, throws,
catch/with handlers, budget suspension, GC stress and unsupported-operation
exits. Helpers outside the main dispatch loop continue to accept canonical PCs.

`ProgramSetCode` invalidation is particularly important: save the current word
PC before replacing the cached execution base, then reconstruct the cursor
from that saved PC. Retaining an address into the invalidated execution view
would silently execute stale code. Existing code-editing demos must keep working.

An initial implementation will retain existing bounds checks and fusion rules;
hoisting execution limits is a separate decision, not an assumed invariant.

## Acceptance

First measure zlib and a long repeated-eval Test262 selection against the
unchanged image, serially. Require project/GC correctness, full Test262, supported
Octane selections, actual demos and HTTP examples before the final checkpoint.
Verify genuine three-way Node/js_min/self-hosted snapshot identity and build
cost. Reject the change if it merely shifts cost to cold-but-frequent call paths
or regresses snapshot generation. No threads, C changes, demo edits or implicit
disk cache are involved.
