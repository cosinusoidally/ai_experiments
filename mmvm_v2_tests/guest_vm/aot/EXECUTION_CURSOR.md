# Native execution cursor

## Experiment outcome (2026-10-30)

The cursor rewrite was implemented and exercised, but is not retained in the
production interpreter. Zlib quick correctness passed; measured variants were
34.42 s (cursor alone), 32.78 s (general memory-operand selection), 33.38 s
(integer operand legalization), and 33.41 s (loop-controller register priority).
Fresh old-PC controls were approximately 31--32 s. The cursor/register-reuse
variant also passed 12 project programs / 270 assertions and native GC stress,
but did not earn its additional representation and boundary-conversion cost.
Do not describe smaller machine code or a register-resident budget as proof
of a CPU bottleneck or an execution win. An isolated old-PC/address-selection
image took 31.36 s; the refreshed production control took 31.41 s.

The uncommitted cursor, selector-rematerialization and controller-selection
experiment is parked as an ignored `artifacts/rejected-execution-cursor.patch`.
The independently committed stack-home/instruction-selection work remains;
the runtime still uses its canonical word-index PC. The register-inspection
tool and optional profile-image sidecar retain actual allocation descriptions
to make subsequent decisions evidence-based. No failed cursor variant is
enabled behind an implicit mode or cache.

## Original design and acceptance criteria

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
