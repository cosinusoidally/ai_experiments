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

2026-11-21, property ownership boundary:

- Key/index classification, primitive name resolution and membership now
  belong to `object_operations_kernel.js`, alongside the existing wrapper,
  descriptor and enumeration rules. The interpreter supplies allocation and
  numeric formatting dependencies through the existing explicit graph.
- Removed six manual interpreter dependency registrations in favor of the
  module's single function catalog. No alternate copies remain in dispatch.
- Default native instructions remain byte-identical (699151 bytes), and Node
  core passes. This establishes the ownership boundary; it does not yet unify
  callback-bearing conversion or remove the portable execution implementation.

2026-11-21, shared named membership lookup (contract 111):

- Removed membership's private string-key entry scan. It now calls the same
  guarded own-entry lookup as named reads and descriptors; numeric-index and
  virtual-property handling is unchanged. Getter invocation is not involved.
- Optional index construction retains its existing allocation contract: it
  does not collect, preserves an existing allocation-failure flag and falls
  back to scanning if an accelerator cannot be allocated. No new root or
  allocation protocol is introduced by this caller.
- Node core passes. A genuine old-seed build matches the fresh Node image
  byte for byte, taking 86.25 s / 478800 KiB peak RSS. The preceding observation
  was 82.34 s / 479712 KiB; this difference is recorded rather than claimed as
  an improvement. Broader runtime/build comparisons are pending.

- Full standalone Test262: 3292/3292, zero failures/timeouts/unrun tests;
  process 339.23 s / 512532 KiB peak RSS, versus the prior 365.85 s /
  512660 KiB observation. No full-corpus performance regression observed;
  do not attribute the entire timing difference without paired measurements.
- Full standalone ECMA: 998 passes / 331 failures (38 timeouts) / four unchanged
  skips / zero unrun files. All 1333 filename statuses match the preceding
  full run exactly. Process 604.57 s / 463968 KiB peak RSS, versus 608.40 s /
  464080 KiB. Corpus and harness policies are unchanged.

2026-11-21, cold inspection diagnostics:

- `inspect_native_exit.js` prints labelled key/receiver cells for IN and dynamic
  deletion as well as reads/writes; ADD retains left/right labels. A controlled
  object-key IN rejection under the Node-backed compiled kernel prints both
  OBJECT operands and exits with the tool's expected status 70. This is tooling
  coverage, not a claim that all standalone rejection details are now named.

## Combined checkpoint acceptance

- Both full language suites complete, with no lost ECMA filename statuses and
  all Test262 cases passing (counts/timings above).
- Serial stock Octane pairs, old contract-110 executable then candidate:

  | Suite | Before | After | Score change |
  | --- | ---: | ---: | ---: |
  | Richards | 92.2 | 91.3 | -0.98% |
  | DeltaBlue | 93 | 93.9 | +0.97% |
  | Splay | 684 | 695 | +1.61% |
  | CodeLoad | 92.6 | 97.4 | +5.18% |
  | Box2D | 422 | 418 | -0.95% |
  | PdfJS | 753 | 796 | +5.71% |

  All six exit zero and emit stock scores/correctness results; no `--quick`.
  These are single pairs, not statistical attribution. No material regression
  is observed in these pairs; this is not a new full-Octane acceptance claim.
  Raw logs/time receipts use ignored `artifacts/cleanup-before-*` and
  `artifacts/cleanup-after-*` names.
- Bounded executable application matrix: all eight demos and net.js,
  node_web.js and node_hello.js pass (11 jobs). Demo8 includes garage and
  auto-drive transitions. The actual source snapshot was moved aside before
  execution and restored afterward; the image was not modified.
- All seven program/integration jobs pass, including frontend/net compilation,
  raw FFI, native compiler dependencies, demo8 I/O and multiplexed contexts.
- The GC job caps its guest heap at 8 MiB: 24 rounds, 27 audits, 113265 edges,
  221 property-index audits and 80 embedding collections pass. Workload/audits
  take 18.74 s, separate from 12.30 s runtime construction. This is a structural
  stress gate, not a claim of indefinite application soak stability.
- Application/program receipts: ignored `artifacts/cleanup-apps/` and
  `artifacts/cleanup-programs/`, including results.json and per-job logs.
- Final fresh js_min build: 97.85 s / 380776 KiB peak RSS, versus the preceding
  97.11 s / 380208 KiB observation. Genuine construction under the candidate
  standalone image: 81.34 s / 478848 KiB, versus 82.72 s / 479756 KiB before
  this cleanup. Both outputs match the Node image byte for byte. No material
  build-time or memory regression is observed; these are individual runs.
  Receipts: ignored `artifacts/cleanup-final-{jsmin,self}-build.*`.
- A fresh -g -O0 executable passes hello.js and primitive-key read/write/
  membership checks. The normal default and debug images remain distinct
  optimization configurations; only same-option images are compared for
  fixed-point identity.

## Remaining work, not closed by this checkpoint

- Other opcode families still use legacy operand accessors. Migrate by family
  with explicit schema positions, preserving mixed execution-view conventions.
- Key classification and lookup have one property-module owner, but general
  callback-bearing opcode conversion is not unified with the guest builtin
  continuations yet. Reference evaluation order must be preserved, especially
  assignment-key conversion relative to evaluation of its right-hand side.
- Call/return, string/numeric intrinsics and the larger execution dispatcher
  still need further decomposition. Portable Runtime/Execution semantics have
  not been removed or declared a disposable reference implementation.
- The lifetime audit confirms a shared root-owner walk and collection-preparation
  boundary already exist. Do not add another layer duplicating them. Remaining
  callback-disposal and stale-root-handle policies require explicit API design;
  this checkpoint preserves existing lifetime/API contracts.
- Cold inspection coverage improved; generic standalone semantic-exit details
  and host-transition audit coverage remain incomplete. Do not treat
  forbidHostCalls/logHostCalls as proof that every language operation is shared.
