# Architecture cleanup: approach and issue register

Started 2026-11-04 on `guestVM-cleanup3`, from implementation `fa54ddb` and
documentation checkpoint `64c772c`. This is a forward refactor, not permission
to weaken tests, alter demos, add benchmark-specific fast paths or introduce
another temporary interpreter. Update this register as each change lands.

## Direction

Converge on one interpreter/semantic implementation used during bring-up,
Node execution and standalone self-hosting. Shared kernel source/IR should
select JS or i386 backends; guest-owned library algorithms should handle
general language semantics above explicit low-level primitives. Keep embedding
scheduling/resource adapters, but remove alternate semantic authority rather
than retaining a disposable bring-up implementation.

First address representation contracts and ownership at the collector/kernel
boundary. Marking/sweeping are already shared; duplicated layout declarations
and legacy compiler substitutions around them are unnecessary sources of
drift. Make those dependencies ordinary named JavaScript bindings without
adding runtime loads or calls to hot code.

## Working rules and acceptance

- Keep one heavy validation process at a time. No downloads, Python, threads,
  emulation, demo edits or changes to external test corpora.
- Capture the current working image before changes. For representation-only
  refactors, compare generated i386 code byte for byte as well as behavior.
  Identical dispatch/collector instructions are stronger evidence of no
  execution-cost increase than a noisy short benchmark alone.
- Measure build cost separately: equivalent machine code does not establish
  compiler/bootstrap performance parity. Check Node and js_min construction
  and genuine self-hosted fixed-point identity where the pipeline changes.
- Use existing broad kernel/embedding/GC tests, imported corpora and live
  integrations. Extend existing compiler coverage for a real new compiler
  facility, not a proliferation of language micro-tests.
- Check in verified working points. Update the implementation reference and
  this register together; do not claim an incomplete migration is complete.

## Current issue register

1. **Duplicate semantic paths — open.** Portable Runtime/Execution, native
   intrinsics, guest libraries and structured-JS compilation overlap. Embedded
   semantic fallback can mask missing standalone support. The goal is shared
   implementation, not a second permanent reference interpreter.
2. **Allocator/root authority — open.** Portable/native free-span ownership,
   cached frames, temporary roots and partially reloaded register arrays
   require careful synchronization. GC corruption is a release blocker.
   Improve encapsulation without changing to a moving collector.
3. **Kernel semantics/layout duplication — first cutover implemented.** The
   shared collector now uses explicit constant namespaces and normal local
   semantics, with canonical record exports rather than duplicate offsets.
   The native interpreter supplies its accessor layout explicitly rather than
   inheriting declarations from the marker. Its collector-driving entry also
   has no fake zero-valued layout declarations; minimum post-GC headroom has
   one owner in `Heap.GCPolicy`. Remaining dispatch/helper legacy constants,
   overrides and inline layout calculations are still open. The subsequent
   interpreter cutover below removes its 94 declarations for already exported
   fields; other legacy declarations have not yet migrated.

   Update 2026-11-05: the remaining legacy-local cutover is implemented.
   Interpreter constants are explicit graph inputs and canonical record/tag
   bindings, not declarations whose meanings are changed by the compiler.
   The compiler's detection, cross-function merging and override machinery
   have been removed. Inline layout calculations still need further migration
   to named accessors; this does not close that separate part of the issue.
4. **Context versus realm — open.** Fresh globals share built-in objects and
   prototypes. The API documents this, but does not model independent realms
   explicitly. Do not silently change sharing semantics during unrelated work.
5. **Embedding lifetime APIs — open.** Value roots, cached-program retention,
   callback registration and context snapshots have different lifetimes.
   Callback registrations have no public per-callback disposal API; root-token
   slots can be reused. Long-lived embedders need a clearer ownership model.
6. **Mixed property representation — open.** Ordinary packed entries and
   exotic linked descriptors share an accessor boundary but still duplicate
   representation handling. Preserve indexed-special-object semantics while
   moving toward common named-property ownership.
7. **Performance — open.** The latest controlled audit finds repeated
   Richards/zlib score losses and increased self-host build cost. RegExp,
   CodeLoad, allocation peaks and early framebuffer demos remain expensive.
   Architecture cleanup must not add to those regressions. See the dated
   [validation](../../VALIDATION_STATUS.md) and
   [Octane comparison](../../OCTANE_COMPARISON_2026-11-04.md).
8. **Diagnostics — open.** Adopted executables lack full per-PC locations;
   native unsupported-case reports remain less descriptive than desirable.
   Preserve source/debuggability when changing storage or compiler output.
9. **Compliance and existing integration gap — open.** Imported Test262 passes
   3292/3292, but the historical ECMA corpus still has 339 failures including
   39 timeouts and four default skips. An extra standalone language-integration
   script fails on both audited revisions in its dynamic eval/property path.
   These are not erased by a successful refactor or a green core suite.
10. **Host-transition auditing — open.** `forbidHostCalls`/`logHostCalls` cover
    explicit host-mode calls, not all intrinsic callbacks or semantic exits.
    Their current names must not be used as proof of host independence.

## Progress

- 2026-11-05: audited string interning. The portable/bootstrap runtime already
  canonicalizes strings per runtime and prunes the weak index after marking;
  native strings compare by value and do not depend on universal interning.
  Removed the write-only transient classification and redundant atom subset:
  one spelling-to-address index now serves atoms, computed strings and source
  views. GC rebuilds two dictionaries instead of four (including decoded
  text). Address-returning interning no longer round-trips through decoded
  text on an atom miss. No native record layout, kernel instructions or root
  policy changes; computed allocation-debt accounting is preserved. This is
  a bounded ownership/data-structure cleanup, not a new string execution tier.

- 2026-11-04: recorded the direction and complete current issue register;
  capturing a fresh pre-change standalone image and build timing. No runtime
  behavior has changed at this checkpoint.
- 2026-11-04: implemented named int32 namespace reads in the shared kernel
  compiler and migrated the common collector off legacy locals. Extended the
  existing loop/checksum and function-graph integration tests rather than
  creating new language micro-tests. Node and js_min project/CLI checks pass.
  The 630331-byte integrated interpreter/collector code segment is byte-identical
  to baseline (SHA-256
  `4928ab88ef0d77786f22c13f381b712f6714a3fda810df2f7827699e543dcffb`).
  Node build observations are 8.75 seconds baseline / 8.25 candidate, not a
  statistical speedup claim. Full images are 7082992 / 7089264 bytes: the
  image grows 6272 bytes despite fewer source lines; no snapshot-size gain is
  claimed. Paired js_min/self-host build and bounded GC gates were still in
  progress at this development point; final results follow below.
- 2026-11-04: the first namespace implementation increased the hot recursive
  `lowerKernelExpression` guest register bank from 424 to 471 registers and
  showed an 86.23-second self-host build versus the 80.37-second baseline.
  Factored namespace resolution into its own logical helper rather than
  imposing its locals/temporaries on every recursive lowering call. The bank
  is now 432 registers. This is an architectural factoring change, not a
  benchmark-specific path or a new execution tier.
- 2026-11-04: final generated i386 interpreter/collector code remains exactly
  the baseline's 630331 bytes and hash above. All five generated JS collector
  service sources (mark, sweep, free-index, tracked-index, link release) are
  also exactly equal to baseline. No executable-contract bump is needed for
  unchanged instructions/layout/semantics. Node/js_min final images are
  byte-identical, and genuine self-hosted construction reproduces that image.
  Final file size is 7089824 bytes, 6832 bytes above baseline; this is not a
  snapshot-size optimization.

### Build observations for the first cutover

Sequential wall seconds / peak RSS KiB, using unchanged source in an isolated
baseline archive versus the final source tree:

| Host | Baseline | Final |
| --- | ---: | ---: |
| Node | 8.75 / 290364 | 8.07 / 288496 |
| js_min | 100.65 / 330648 | 99.54 / 329140 |
| Standalone self-host | 80.37 / 483604 | 80.04 / 483524 |

An adjacent baseline self-host repeat takes 80.09 seconds / 483552 KiB. These
observations find no final build regression; they do not establish a precise
speedup. The slower inline-namespace development observation is kept above
instead of being represented as the final implementation.

### Verified working point

- Final project suite passes on both Node and js_min: 12 programs / 270
  assertions per host, CLI/stdout checks and three-context multiplexing.
- Final bounded GC checks pass on both hosts: 27 audits, 111888 checked
  edges, 221 property-index audits and 74 embedding collections. Maximum
  observed bump remains 3531120 / 3531472 bytes within the 8 MiB test cap.
  Standalone passes 24 rounds / 48 native-counter collections.
- All fifteen Octane suites pass **quick correctness**, each in its own
  serial process with a 180-second bound. This is not a new full stock sweep
  and does not replace the dated complete Octane score report.
- Selected paired **stock** runs pass, with baseline -> final scores:
  Richards 93.4 -> 93.4; NavierStokes 274 -> 276; CodeLoad 97.6 -> 98.2.
  Small differences are not a statistically established speedup. Combined
  with exact native/JS collector code equivalence, these observations find
  no additional execution regression in the exercised paths.
- Net checked-in JavaScript line count decreases by 62, including the small
  compiler feature and extensions of existing integration checks. The real
  benefit is one owner for layout/policy values and removal of hidden
  compiler dependencies, not line-count reduction by itself.
- The complete ECMA/Test262 and fifteen-suite stock sweeps were not repeated
  for this representation-only cutover. Their prior results remain dated
  observations, not freshly claimed passes. No demo, harness, external corpus
  or C implementation was modified.

### Live integration follow-up (2026-11-04)

Validated implementation checkpoint `2b2f16b` with the final standalone image,
one process at a time. These are bounded interaction/smoke checks, not an
extended soak or a replacement for the instrumented GC checks above.

- Demos 1 through 7 each rendered at 320x240 with a 20 FPS requested limit,
  accepted keyboard/mouse input and closed normally through their UI. Demo1
  displayed typed text at the pointer location; demos 6/7 entered human play.
  Captures were visually inspected. The early demos still run at roughly
  1-3 FPS in this path; a successful smoke check does not imply 20 FPS.
- Demo8 rendered attract, garage, manual free-drive and auto-drive modes,
  accepted garage camera dragging and driving input, then exited through its
  menu. Captures show the car, garage floor and driving terrain. Observed
  steady readings are approximately 19.7-20.1 FPS, with a 16.7 FPS reading
  spanning the garage transition. No crash was observed during this bounded
  run; this is not a claim that every possible GC/interactivity bug is gone.
- Both `net.js` and `node_web.js` served a temporary localhost directory:
  listing, text, default index, byte-identical PNG, HEAD and missing-file 404
  checks passed under the standalone image. Fixtures, logs and captures stay
  in ignored `artifacts/`; no generated files are checked in.

The next architectural work remains the open issues above, especially shared
execution/root ownership and migration of the remaining legacy constant-local
users. This first cutover changes dependency ownership, not language semantics
or the interpreter's execution algorithm.

## Next cutover: interpreter record-layout dependencies (2026-11-04)

Migrate the interpreter's uses of already exported HeapRecords
fields to an explicit `RecordLayout` namespace. Remove 94 literal/placeholder
declarations from kernel bodies and 87 duplicated compiler-option bindings.
The namespace references the same canonical table as the collector, rather
than maintaining a second table. Canonical scalar bindings remain available
to named accessor dependencies. This does not yet remove every older offset,
legacy algorithm/opcode declaration or inline address calculation.

Node/js_min images are identical; a genuine self-hosted build reproduces the
same image. The generated 630331-byte native interpreter/collector code is
byte-identical to the preceding working point, with the same SHA-256 recorded
above. No native contract bump is needed. Source line count falls by 180, but
explicit qualification increases source text: image size is 7108856 bytes,
19032 bytes above the preceding checkpoint. This is not a size optimization.

Adjacent sequential build observations, wall seconds / peak RSS KiB:

- Node: baseline 8.56 / 304464; cleanup repeat 8.54 / 303216. The first cleanup
  observation was 9.39 / 289236; do not represent isolated timing noise as a
  demonstrated speedup or slowdown.
- js_min: baseline 105.78 / 329204; cleanup 108.64 / 332984. The cleanup is
  2.7% slower in this pair; no build speedup is claimed. Explicit namespace
  syntax adds AST work, so this remains a build-cost consideration as the
  remaining declarations migrate.
- Standalone self-host: baseline 85.33 / 483616; cleanup 84.65 / 483664.

Baseline comes from an isolated archive of `4d8745f`, not a branch switch or
changes to the working tree. Its self-hosted output also matches the previous
baseline image exactly.

Working-point validation:

- Project suite passes under Node and js_min: 12 guest programs / 270 guest
  assertions per host, internal compiler/heap/embedding checks, CLI checks and
  three-context multiplexing.
- Bounded GC checks pass on Node and js_min: 27 structural audits, 111888
  checked edges, 221 property-index audits and 74 embedding collections per
  host. Maximum observed bumps are 3531120 / 3531472 bytes within an 8 MiB cap.
  Standalone passes 24 workload rounds / 48 native-counter collections.
- Follow-up on implementation `1a5345a`: all 15 Octane quick-correctness checks
  passed serially under the new standalone image, including RegExp, PdfJS,
  Mandreel, Gameboy, Box2D, zlib and TypeScript. Each ran in a fresh process
  with a 180-second bound. This verifies the quick workloads, not stock scores.
  No complete ECMA, Test262 or stock Octane sweep is claimed for this cutover.
  The previous live-demo/HTTP checks above remain explicitly dated to their
  checkpoint. All generated images/logs remain ignored artifacts.

## Full cleanup audit closure (2026-11-04 20:15--22:06 UTC)

The [complete audit](../../CLEANUP_VALIDATION_2026-11-04.md) validates frozen
implementation `430cad1` against pre-cleanup `fa54ddb`, not just quick checks.
Test262 passes 3292/3292; ECMA preserves exactly all 990 baseline passes with
0 gained / 0 lost; all 15 current stock Octane suites pass. Project, bounded
GC, cross-host snapshot/fixed-point, demo/input and HTTP checks pass.

Existing gaps remain: 339 configured ECMA failures and an extra standalone
integration failure. Additional direct standalone executions of five default
guest-program files fail on both images, despite passing in embedding hosts.
The report names the files and matching native exits; they are not silently
omitted from the result.

Self-hosted pairs vary from -0.6% to +5.1% (means +2.2%); the initial Test262
timing loss does not reproduce in a full repeat. Gameboy's one stock score
pair is 7.1% lower and needs focused follow-up before claiming full performance
parity. No VM source was changed during this audit. Future small cleanup
batches should reuse instrumented build gates and target outliers rather than
unnecessarily repeat this entire broad audit.

### Remaining constant migration: avoid a new spelling convention

Do not replace the uppercase-local convention with another implicit compiler
rule. At `1a5345a` the dispatch body still had 379 literal declarations, including
opcode IDs, intrinsic IDs, diagnostics, algorithm constants and older offsets.
The appropriate owners differ:

- Opcode/intrinsic/runtime-support IDs should refer to their existing canonical
  modules through explicit bindings, not copied numeric declarations.
- Missing record fields should gain canonical named accessors/exports. A
  namespace qualifier alone does not make inline address arithmetic desirable.
- Actual function-local constants should remain normal JavaScript locals.
  If needed for efficient generated code, implement ordinary IR constant
  propagation with proper write/use and control-flow checks, rather than
  interpreting their names or overriding their initializers.

Complete these migrations before disabling legacy mode for the whole graph.
Keep allocator/root ownership unification as a separate, behaviorally sensitive
change, not an incidental part of a constant/layout rewrite.

## Shared IDs and compiler-configuration ownership (2026-11-04)

Cutover after `2b5dcea`: remove 208 further literal/placeholder declarations
from the dispatch graph. Opcode IDs, intrinsic IDs and runtime-support slots
now use their canonical `Bytecode`, `NativeIntrinsics` and
`RuntimeSupportLayout` lexical namespaces. Some imported helpers previously
inherited these values from declarations inside the dispatch function; they
now receive explicit scalar bindings from the canonical owners.
The dispatch body's remaining literal declarations fall from 379 to 171.
Normal-local constant propagation is still a planned compiler improvement,
not something this ID/configuration cutover has implemented.

Consolidate the configuration in `nativeKernelBindings`: selected profile and
operand modes plus canonical tables are assembled once, not separately for
fingerprinting, overrides and partial constructor bindings. The existing
legacy compatibility option consumes that same table. Names do not grant
locals new semantics, and no benchmark/application-specific paths are added.

The cutover removes 311 net JS lines. Its 630331-byte interpreter/collector
code is byte-identical to the preceding working point; image size falls from
7108856 to 7087288 bytes. Build observations, wall seconds / peak RSS KiB:

- Node: initial 9.24 / 304704. The adjacent repeat is baseline 9.18 / 314624,
  cleanup 9.26 / 306040; the rebuilt cleanup image is identical. This is build
  parity within the observed variation, not a speedup claim.
- js_min: 109.78 / 331768, versus the preceding batch's 108.64 / 332984.
- Genuine standalone self-host: 88.12 / 483724. The adjacent baseline repeat
  takes 89.10 / 483676 and reproduces the preceding image exactly. This supports
  build parity, not an inference of regression from the earlier 84.65-second
  observation or a statistically established speedup.

Node, js_min and genuine self-hosted construction produce byte-identical
images. The complete project suite passes on both hosts (12 guest programs /
270 assertions per host, internal compiler/heap/native/predecode/embedding
checks, CLI paths and three-context multiplexing). Bounded GC checks pass on
both hosts: 27 audits, 111888 edges, 221 property-index audits, 74 embedding
collections and maximum bumps 3531120 / 3531472 bytes within an 8 MiB cap.
Standalone passes 24 rounds / 48 native-counter collections.

Follow-up on implementation `4124217`: all 15 Octane quick-correctness checks
pass serially under the new standalone image, including RegExp, PdfJS,
Mandreel, Gameboy, Box2D, zlib and TypeScript. Each uses a fresh process and a
180-second bound. No full ECMA/Test262 or stock Octane sweep is newly claimed
here, and no demo or external corpus source was modified. The live-demo/HTTP
checks above remain dated to their own checkpoint, not silently relabelled as
new runs. Generated logs and images remain ignored artifacts.

## Graph-owned compiler environments (2026-11-04, after `aafd6a3`)

The next cutover separates external binding ownership from per-function local
scope. Previously every graph member re-entered public compilation, revalidated
the whole external table and recreated all scalar/namespace descriptors. A
graph now constructs that environment once; each member gets its own mutable
scope with the graph environment as parent. The scope constructor is itself
graph-owned, rather than created per function. No mutable compiler-global
binding cache or new configuration-as-local-variable rule is introduced.

Public `compile` and `compileGraph` share private lowering. Initial option
validation remains at their entry points; graph discovery also checks merged
legacy constants against namespace names once before lowering. Existing graph
integration coverage now checks mutable local shadowing, isolation of callers'
locals from callee external reads, and merged namespace conflicts. Both hosts
pass the existing broad kernel checks, including actual native i386 execution.
The focused entry point is documented in maintenance; no new language test
files or external test changes were added.

The default native interpreter/collector segment remains byte-identical to the
audited baseline (630331 bytes). Legacy constants and wider execution/root
ownership work remain open. This is compilation-resource ownership work, not
a new interpreter or a claim that all old offsets have been migrated.

The scope audit also fixes a pre-existing name collision: internal bookkeeping
used `$kernelFunctions` and `$kernelFunctionName`, the exact keys used by normal
source identifiers. Bookkeeping now stays outside the identifier key namespace;
the unused function-name field is removed. Those names work as ordinary locals,
and the same broad graph test exercises them on both backends.

Development timing is kept separate from final results: an initial per-member
scope-constructor version lowered self-hosted kernel lowering from 6.71 to
5.81 seconds but increased whole-build time from 86.37 to 90.85 seconds. It
was not committed as a performance win. The final graph-owned constructor
passes the focused checks; before the final bookkeeping fix its adjacent Node
builds were 8.79 seconds baseline / 8.62 candidate. The final observations follow
below rather than relabelling that development image as the final one.

### Focused working-point validation

- Final broad kernel/backend integration checks pass on Node and actual i386,
  including mutable local shadowing, cross-function scope isolation, metadata
  name collisions and merged graph/namespace conflict rejection. No external
  corpus or demo source was modified.
- Final Node, js_min and genuine self-hosted images are byte-identical:
  7091976 bytes, 4688 bytes above the audited baseline. This is not a snapshot
  size reduction. The interpreter/collector remains exactly the same 630331
  machine-code bytes; the executable contract is unchanged.
- Final Node construction: 8.95 seconds / 303668 KiB, versus the batch's
  archived baseline observation of 8.79 / 301868.
- Final self-hosted source rebuild: 88.91 seconds / 481640 KiB. Archived
  baseline observations are 86.37 / 483584 before the candidates and 87.49 /
  483616 on follow-up. Thus there is a small 1.6--2.9% whole-build increase
  in these observations, not an established whole-build improvement.
  Self-hosted kernel lowering itself takes 5.95 seconds versus baseline 6.71
  (about 11% less); other stages prevent calling that a whole-build speedup.
- Final js_min construction: 107.18 seconds / 322100 KiB. No fresh paired
  baseline js_min measurement is claimed in this focused batch.
- The focused stock Gameboy pair passes: audited/pre-batch image 976,
  scope-ownership candidate 955. After the bookkeeping fix, the final-image
  candidate-only check also passes, score 957 / 15.47 seconds / 95744 KiB.
  These do not establish a benchmark speedup or prove the earlier audit's
  Gameboy concern fixed; they are not a new full Octane sweep.
- Final standalone GC workload passes 24 rounds / 48 native-counter
  collections. Broader ECMA/Test262, all-Octane and live-demo results remain
  explicitly tied to the preceding full audit. They were not repeated here.

This cutover reduces repeated compiler binding allocation/validation and fixes
source-name semantics. It does not claim a general interpreter throughput gain,
nor removal of the remaining legacy constant-local mode. Build cost remains
an explicit follow-up concern. Generated measurements stay in `artifacts/`.

## Diagnostic caller migration (2026-11-05)

The offline reachability audit still compiled the shared marker with the old
legacy-local/override options and no namespace bindings. Its marking mode
failed with `unsupported kernel namespace field`, even though read-only
statistics modes continued to work. Reproduced that failure before changing it.

The tool now supplies explicit `CollectorLayout` and `MarkStatus` namespaces
and no longer enables legacy substitution. Historical packed-layout overrides
remain in the inspected layout table, so the marker and its field accessors
use the same adjusted values. No collector algorithm or runtime code changes.

Node and js_min/i386 audits of the preceding 7091976-byte snapshot agree:
37829 reachable records, zero missing marks, and 455 unreachable occupied
records / 85784 bytes. The unreachable inventory is diagnostic output, not
a missing-mark failure. No full suite or snapshot rebuild was needed for this
tool-only repair; logs stay in ignored `artifacts/cleanup7-audit-*.log`.

## Compiler operator catalogs (2026-11-05)

Before adding more optimization machinery, remove an existing source of
repeated compiler metadata allocation: integer/binary64 expression lowering
recreated fixed operation dictionaries for each expression. Some IR names
were also repeated between the two front ends. The catalogs now belong to the
module and are read-only inside the compiler. The older straight-line grammar
gets explicitly derived subset views once at initialization; its capabilities
are not silently broadened. Both front ends still exist, and legacy local
constant substitution in the interpreter remains open work.

Binary64 lookups now require an own catalog entry. The existing broad numeric
integration test also verifies that an inherited `toString` method is rejected
as unsupported source by both front ends rather than returned as a bogus IR
operation. No new language micro-test file or external-corpus change is added.

Focused validation against an isolated archive of `648ec87`, sequentially:

- Existing compiler/backend integration passes under Node and js_min, including
  actual i386 execution. The interpreter/collector's default 630331-byte code
  segment is byte-identical to baseline; executable contract remains 98.
- Node build observations: candidate 8.73 seconds / 300956 KiB, baseline
  8.69 / 303196. No meaningful difference or Node speedup is claimed.
- Genuine self-hosted builds: candidate 81.32 seconds / 481468 KiB; baseline
  84.49 seconds / 481732 KiB (about 3.8% lower candidate wall time).
  Kernel lowering is 5.23 / 5.54 seconds. Both source builds reproduce their
  own reference images exactly. These are one-pair observations, not a
  statistically established speedup percentage.
- js_min builds: candidate 102.07 seconds / 322196 KiB; baseline 104.39 /
  322088 (about 2.2% lower candidate wall time). Each is byte-identical to
  the corresponding Node image. No caches or application-specialized builds
  are used, and js_min itself was not rebuilt.
- Final Node, js_min and self-hosted candidate images are identical, 7099216
  bytes. This is 7240 bytes larger than baseline: the change reduces transient
  expression-lowering allocations, not snapshot size.
- Final standalone GC workload passes 24 rounds / 48 native collections.
  Node and i386 reachability audits of the final image agree: 37864 reachable
  records, zero missing marks, and the same 455 unreachable occupied records /
  85784 bytes as the prior image. The audit works on a private inspection copy.

This is compiler resource ownership and vocabulary consolidation, not a claim
of faster guest execution or a new whole-suite result. No demo, benchmark,
test262/ECMA harness or C source was modified. Full suites were not rerun for
this focused change. Raw outputs remain in ignored `artifacts/cleanup7-*`.

### String-index consolidation validation (2026-11-05)

- Core project/CLI/multiplexing checks pass on Node and native i386 js_min:
  12 guest programs / 270 guest assertions per host, plus the existing
  internal compiler, heap, embedding and continuation checks. The existing
  runtime/context integration check verifies that a computed spelling shares
  the canonical live atom address and independent runtimes have separate maps.
- Bounded structural GC checks pass on both hosts: 27 audits, 111888 checked
  edges, 221 property-index audits, 74 embedding collections. Maximum bumps
  remain 3531120 / 3531472 bytes under the 8 MiB cap. Standalone workload:
  24 rounds / 48 native collections. Offline JS-backend marking finds 37860
  reachable records and zero missing marks, with the same 455 unreachable
  occupied records / 85784 bytes as the previous audit.
- Node, js_min and genuine standalone self-host builds produce byte-identical
  7097728-byte images, down 1488 bytes. The 630331-byte native interpreter/
  collector instruction segment is unchanged from the pre-change image.
- Sequential Node build observations: baseline 9.49 seconds / 303052 KiB
  peak RSS; final 8.70 seconds / 297964 KiB. An intermediate candidate was
  9.69 seconds / 296844 KiB. The final self-host build is 82.05 seconds /
  481904 KiB. These are single-run observations, not statistically established
  CPU improvements. Removing duplicate index entries and survivor dictionaries
  is the definite storage/work reduction; it does not halve whole-process RSS.
- Adjacent js_min source builds: final 107.70 seconds / 323416 KiB, unchanged
  backup baseline 106.64 seconds / 322136 KiB (about 1.0% slower wall time /
  0.4% higher RSS in this pair). This does not demonstrate an i386 build
  improvement; the native execution code itself remains identical. Unlike
  the Node pair, whole-process peak RSS is not reduced on this host.
- No demo, C code, external corpus or test harness changed. Full Test262,
  ECMA, Octane and interactive demo sweeps were not repeated for this bounded
  change; their earlier dated audit is not represented as a new run here.

## Explicit interpreter bindings: legacy mode removed (2026-11-05)

Removed 191 constant-style declarations from interpreter/helper bodies.
`nativeKernelBindings` now supplies the full graph environment explicitly;
59 previously private record offsets/sizes are exported as expressions of
their authoritative HeapRecords definitions, not copied numeric literals.
Value tags/attributes and intrinsic bounds use their module definitions.
Opcode profiling and operand-predecode choices remain explicit inputs.

The compiler no longer infers constants from local spelling, merges them
between graph members, or overrides initializer values. It discovers locals
and helper edges in one traversal. Obsolete legacy options are rejected.
The existing broad backend check now verifies mutable uppercase locals
shadow external bindings, alongside immutable external bindings and graph
namespace validation. No additional language micro-test file was introduced.

The default 630331-byte integrated native instruction segment is identical
to the pre-change image. Focused compiler checks pass on Node/i386, and the
full core/CLI/multiplexing suite passes on both hosts (12 programs / 270 guest
assertions each, plus internal checks). Bounded GC checks pass on both hosts:
27 audits, 111888 edges, 221 property-index audits, 74 collections, maximum
bumps 3531120 / 3531472 within the 8 MiB cap.

Final-source Node construction is 9.22 seconds / 305764 KiB peak RSS; a
standalone source rebuild is 84.13 seconds / 481732 KiB and matches the Node
image from the same source. These observations do not establish a build
speedup. Final js_min identity and another seed-to-identical-output self-host
gate are in progress at this checkpoint; their results will follow.

The next ownership cleanup removes the legacy wrapper-owned refill arena.
Only its retry/release code still mentions its cursor: current native run
entry uses the engine-owned allocator instead. Carrying both models obscures
which index/cursor owns a reusable span and can temporarily hide a claimed
free span from the allocator that actually executes. Preserve the compiled
allocator, borrowed-index certificate and GC-safe retry policy; remove this
obsolete third arena rather than building another layer around it.
