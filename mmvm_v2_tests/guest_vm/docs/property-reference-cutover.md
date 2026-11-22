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
conversion, reentrancy, thrown identity and GC in callbacks. Compare common
semantics with stock Node, but do not use modern Node as the oracle for ES5.1
reference formation: ES5.1 section 11.2.1 converts the computed key while
forming the reference; modern Node defers conversion in simple assignment
and can convert twice in compound assignment. The new ordering cases target
ES5.1 explicitly. Validate both compiled backends/operand modes, broad
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
- Private guest operations bootstrap is implemented (contract 113). A traced
  runtime-owned vector holds the callables; its temporary factory result is
  rooted in the bootstrap context until publication. Constructor failure
  destroys the partially initialized runtime. Descriptor operations and the
  portable property-key path share the guest converter; the old duplicate
  descriptor ToPrimitive implementation is removed.
- Existing Node core (both operand modes), pre-cutover property integration on
  js_min/native and standalone execution pass. Genuine old-seed snapshot
  construction completes in 83.26 s / 480204 KiB peak RSS, but comparison found
  one differing cached string-hash word. Fixed-point acceptance is pending
  resolution of that mismatch; successful construction alone is not acceptance.
  Native opcode callback conversion and captured-write reference preparation
  are the next step; new end-to-end fixture cases are being developed for it.
- The cached-hash mismatch is fixed at the string producers (contract 114),
  not by rewriting snapshot bytes. Unhashed strings now initialize the cache
  to zero; the existing canonical key-hashing routine computes and validates
  it lazily using exact word arithmetic. Removed unused eager hashes and
  hash-only character scans from number formatting, concatenation, conversion,
  URI processing and other string producers. Canonical numeric property-key
  hashes remain unchanged. Node and i386 js_min core pass, including both
  operand modes (12 guest programs / 321 assertions on each host).
  The Node, i386 js_min and genuine old-seed self-build snapshots are bit identical:
  SHA-256 `ee466c9950224928899802684c699140b68b6495fb751d5e15aa6c50d451343d`.
  Self-build: 83.88 s / 479452 KiB peak RSS (previous 83.26 s / 480204 KiB).
  The js_min build takes 94.17 s / 388588 KiB peak RSS; the prior combined
  checkpoint took 97.85 s / 380776 KiB. These single-run measurements do not
  establish a speedup, but show no large build-time regression.
  This resolves the preceding fixed-point failure; the new reference cases
  remain work in progress and are not part of this checkpoint's pass claim.
- Standalone validation with the snapshot physically moved aside passes all
  seven program jobs and all eleven demo/server jobs. The committed property
  integration fixture also passes (the additional ES5.1 reference cases in
  development are not included in that claim). The GC stress test now records
  exact baseline bound-function identities after collection, rather than
  incorrectly requiring zero bound functions in a runtime which deliberately
  captures a pristine bound call helper. No workload bound functions survive:
  24 rounds, 27 structural audits, 123498 checked edges, 221 property-index
  audits, 81 embedding collections, 8 MiB heap cap, one runtime bound function.
  Native code decreases from 699070 to 697391 bytes; snapshot size decreases
  from 7637080 to 7630336 bytes compared with contract 113.
  Full Test262/ECMA/Octane runs have not been repeated for this intermediate
  producer cleanup; the previous combined-checkpoint results remain the broad
  suite baseline, not a new acceptance claim for the reference cutover.
