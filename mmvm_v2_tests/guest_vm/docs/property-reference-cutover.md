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

## Follow-up sequence

1. Investigate build costs before changing runtime behavior.
2. Prepare ES5.1 write references before RHS evaluation, retaining their key.
3. Enter shared guest conversion continuations from native property operations.
4. Extract property execution helpers and delete competing paths, preserving
   explicit completion/frame-entry/exception/allocation outcomes.

2026-11-22 build investigation: the existing ES3 phase profiler now accepts
`--hashing`. A serial instrumented js_min snapshot build reports 7171
`Records.stringHash` calls, 147 ms combined (48 ms maximum, including first-use
kernel compilation); 60 `readString` calls take 3 ms. Kernel preparation takes
8751 ms; standalone preparation is 65024 ms, versus the earlier 64102 ms and
the more recent 69701 ms observations. Hash-call cost is therefore far too
small to explain the eight-second whole-build difference. Keep one shared
hash implementation; do not add an unmeasured host-text fast path. These
inclusive instrumented times locate costs, not establish throughput parity.
Receipt: ignored `artifacts/property-build-hash-profile.log`.

## Contract 116 implementation checkpoint

All four follow-up implementation stages are now present. The implementation
checkpoint is `d656ede`. The combined acceptance results below distinguish
completed gates from measurements still in progress.

- `CHECK_PROPERTY_BASE` and `PREPARE_PROPERTY_KEY` have explicit register
  schemas, verifier rules and portable/native implementations. The compiler
  prepares assignment/update references before RHS evaluation, retaining the
  converted key separately. Primitive syntax and effect-free RHS proofs avoid
  unnecessary preparation/checks. Constant property names are verified strings.
- Native object-key Get/Put/Delete/Has and prepared-key conversion enter the
  same private traced guest operations as descriptor/portable conversion.
  Argument vectors are temporary guest records, not host arrays; frame entry
  preserves the caller PC/result and callback progress through GC/budgets.
- `executeNamedPropertyGetKernel` serves constant and computed reads, replacing
  duplicate prototype/descriptor walks. `executeNamedPropertySetKernel` owns
  named writes, setter entry, creation and rejection; it uses shared entry
  lookup rather than manual representation-offset selection. Operation results
  explicitly distinguish completion and entered frames from engine exits.
  Small guarded own-data read/write probes remain ordinary inlining candidates;
  the read probe is 67 IR nodes. Getters use canonical result-cell addressing
  in both operand views. Canonical numeric strings reuse indexed storage.
- Standard unlabelled loop `break` is supported in the kernel compiler, CFG
  and both backends, rather than replacing prototype loops with control flags.
  `for` break skips the update; labelled break/continue remain rejected.
- The common converter captures a distinct String primitive callable. Capturing
  the mutable public callable caused portable recursion after fallback install;
  the full standard-library fixture exposed and now covers this. String() with
  no argument is distinguished from String(undefined).
- The existing property integration fixture now covers early/one-time key
  conversion, callback allocation/throwing, strict deletion, membership order,
  converted array indices/length and UTF-16 string access. It runs in the core
  suite with the guest standard library on portable, kernel and predecoded
  configurations. Node and i386 js_min core suites pass: 15 guest programs /
  321 assertion-intrinsic calls, plus the fixture's own throwing checks.
- Fresh standalone property integration passes. One Box2D observation after
  extraction initially fell to 361; this was not accepted. Separating guarded
  inlinable own-data probes restores 413, versus a paired pre-change 404. This
  is single-run regression evidence, not a controlled speedup claim.
- The optional legacy structured-source compiler declines new reference-op
  programs instead of using modern host reference timing. Shared kernel JS
  execution is fully supported. No demo or external corpus files are changed.

## Combined acceptance, 2026-11-22

- Node, js_min and genuine standalone self-build snapshots are bit identical:
  SHA-256 `09a5ce1753a1832f70ccb044950065e704577dad3f627cffad2981764768fa8d`.
  js_min builds in **93.91 s / 315292 KiB peak RSS**; the executable builds
  itself in **82.13 s / 481424 KiB**. Previous observations were 102.04 s /
  319156 KiB and 84.58 s / 479500 KiB respectively. These individual runs
  show no observed build-time regression, not a controlled speedup estimate.
- Native code is **679397 bytes**, down 13361 bytes from contract 115;
  the snapshot is **7651280 bytes**, up 21784 bytes from additional guest
  runtime data. No compression, discarded function source or host specialization.
- Core suites pass under Node and i386 js_min: **15 guest programs / 321
  assertion-intrinsic calls**, plus the property fixture's throwing checks.
- Standalone executable gates pass **all seven programs and all eleven
  demo/server applications**, with the source snapshot moved aside. This
  includes the garage/autodrive scenarios and binary HTTP responses.
- Strengthened GC stress passes **24 rounds / 30 structural audits / 141980
  checked edges / 254 property-index audits / 84 embedding collections**;
  only the expected one runtime bound function survives. Maximum observed
  bump is 419208 bytes under an **8 MiB heap cap**. Collection is forced
  inside key conversion and accessor callbacks; a fresh substring key must
  survive the read/modify/write. Process **38.86 s / 330912 KiB** including
  runtime construction. The bare-runtime fixture uses its supported substring
  primitive, not the standard-library-only slice method.
- Full Test262: **3292 executed / 3292 passed / 0 failed / 0 timed out /
  0 not run**, **365.42 s / 512452 KiB**. The preceding observation was
  357.06 s; this run is 2.3% longer, so no timing-parity claim is made.
- Full ECMA: **997 passed / 332 failed (39 timeouts included) / 4 skips /
  0 not run**, **603.69 s / 463860 KiB**. All 1333 files were compared:
  1332 statuses match the preceding full run, and the sole changed result
  is the previously documented watchdog-boundary descriptor test. See
  `ECMA_TESTS_STATUS.md`; this is not an additional semantic pass claim.
- Octane acceptance is in progress; do not substitute the earlier Box2D
  spot check for a full fresh benchmark run.

Receipts are ignored files prefixed `artifacts/property-accepted-`, including
the `-jsmin`, `-self`, `-programs`, `-apps`, `-gc-final`, `-test262` and `-ecma`
logs and timings. Source snapshots remain moved aside during executable gates.

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

## Hash consolidation before further reference work (2026-11-22)

Contract 115 consolidates string-hash arithmetic and constants in
`string_hash.js`. Heap-record hashing now calls the existing shared
`stringKeyHashKernel` rather than decoding the string and repeating the
character fold in portable JavaScript. Cached hash reads keep their prior
path; uncached calls validate the string record before entering the kernel.
Numeric access and descriptor probing share `integerPropertyKeyHashKernel`,
passing their already-computed decimal length rather than recomputing it.
Compiler token fingerprints use the same exact arithmetic through an explicit
UTF-16LE byte adapter. Their former rounded multiplication is removed.
The diagnostic number samples also obtain the constants from this module.
Native producers call `initializeUnhashedStringKernel` instead of scattered
zero-cache writes. This named allocation-time operation requires a new header
whose hash-valid flag is clear. It deliberately does not hash every temporary
string; the common hashing kernel computes and publishes a cache only on use.

The ES3 shell loader, Node imports, shell executable packager and kernel debug
source catalog include the new module. This change does not advance the
unfinished reference bytecodes or their additional integration cases.

Validation of the consolidation:

- Core suites pass on Node and i386 js_min; the final Node rerun also passes
  after the named initializer was added (12 programs / 321 assertions).
- Node, js_min and genuine self-hosted snapshots are bit identical:
  SHA-256 `0555438748449421503ebe1f43b23b0316688a10bb7f37c614680e3cf26fc32d`.
  Final self-build: 84.58 s / 479500 KiB peak RSS, versus the previous
  83.88 s / 479452 KiB observation. Final js_min build: 102.04 s /
  319156 KiB, versus 94.17 s / 388588 KiB previously. The js_min observation
  is slower despite lower RSS; do not claim build-time improvement or full
  performance neutrality from these individual runs.
- All seven standalone program checks and all eleven demo/server checks pass
  with the source snapshot moved aside. GC stress passes 24 rounds, 27 audits,
  123498 checked edges, 221 property-index audits and 81 embedding collections
  under an 8 MiB heap cap; only the one expected runtime bound function survives.
- Full Test262: 3292 executed / 3292 passed / 0 failed / 0 timed out /
  0 not run, 357.06 s / 512396 KiB peak RSS. See `TEST262_STATUS.md`.
- Native code is 692758 bytes (previous 697391); the snapshot is 7629496
  bytes (previous 7630336). Full ECMA and full Octane are not rerun for this
  consolidation; their older results are not new acceptance claims.
- Paired stock Octane observations against the preceding contract-114
  executable: CodeLoad 92 -> 93, Box2D 395 -> 405, PdfJS 759 -> 781. Each
  benchmark completes with its normal correctness checks. These individual
  pairs show no regression in the sampled workloads, not controlled speedups.
- The executable packager runs under Node, js_min and the standalone guest;
  all three produce bit-identical executables from the same snapshot bytes.
- An optimized `-g` snapshot build completes with the updated source catalog.
  The committed property integration fixture passes under the standalone
  executable; the additional unfinished ES5.1 reference cases remain outside
  this checkpoint. No new full debugger or ECMA acceptance run is claimed.
