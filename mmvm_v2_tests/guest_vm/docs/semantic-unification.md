# Ordinary property semantics and root ownership

## Current continuation cutover (2026-11-06, acceptance in progress)

Callback-bearing Object.defineProperty conversion now has a guest-bytecode
implementation attached to the public intrinsic's traced implementation
closure. A supported native call avoids descriptor-normalization allocations.
Otherwise intrinsic dispatch enters that implementation as an ordinary guest
frame, preserving receiver, arguments, return destination and exception chain.
There is no separate host callback state machine or host-owned progress object.

The library captures a private native primitive before attaching the public
continuation. Normalization checks the target, converts the key with a string
hint, and reads descriptor fields in ES5.1 order. Field results live in a
null-prototype guest object and activation locals, both traced across calls,
reentrancy and collections. The normalized call uses the private primitive,
so an unsupported exotic case cannot recursively restart normalization.
Replacing the public method does not replace a composite built-in's captured
primitive. Actual exotic definition support is a separate cutover below;
this does not claim every normalized primitive case is implemented yet.

Dynamic named getter reads now enter guest frames just like constant and
indexed getter reads. These forms share enterPropertyGetterKernel; absent
getters still produce undefined without entering a frame. Getter receiver is
the original receiver, not the prototype that owns the descriptor.

Object.getOwnPropertyNames now has a named native intrinsic and shares key
collection with Object.keys/for-in through explicit EnumerationMode values.
Own names include nonenumerable named entries and implicit true-array length;
for-in retains nearest-owner shadowing and per-owner insertion order. Exotic
virtual-property coverage is still being consolidated. Contract 100 prevents
stale embedded interpreter-code reuse after the intrinsic/dispatch change.

Existing integration coverage is extended by object_operations_integration.js,
which runs on stock Node and guest entrypoints. It covers conversion order,
reentrant mutation, inherited getters, thrown-value identity and captured
primitive lifetime. Complete acceptance remains pending; intermediate focused
passes must not be confused with a full corpus/demo/performance sweep.

Follow-up to the storage/root cutover, starting from 77a2954.

## Boundaries and sequence

1. Share ordinary descriptor validation/attribute transitions. Runtime currently
   validates ToPropertyDescriptor in observable ES5 order and roots getter
   results. The native define-property path accepts callback-free descriptor
   fields and otherwise declines to the existing continuation. Both separately
   implement non-configurable/non-writable rules. Replace those duplicated
   rules with a pure kernel-dialect decision function; keep coercion, callbacks,
   SameValue computation, allocation and error construction with their callers.
2. Share ordinary assignment decisions and prototype resolution, preserving
   receiver identity, guarded owner/entry handles and explicit exotic handling.
3. Audit remaining root categories and temporary lifetimes. Share enumeration
   where ownership is shared, not permanent retention or moving collection.
4. Delete superseded implementations at each working cutover and retain named
   rejection reasons, rather than numeric diagnostics or silent new fallbacks.

Arrays/arguments/string/typed-view special cases remain explicit. No parser,
substring, source-sharing, C, demo or external corpus changes are in scope.
The pure decision layer must run as ordinary ES3-compatible JS and compile
through the existing shared kernel pipeline; no fake local constants or
descriptor allocations per ordinary assignment are acceptable.

## Validation

Use existing embedding/descriptor/context integration checks and bounded GC
audits at intermediate commits. Freeze the final source for one combined
corpus, benchmark, self-host/cross-host build and graphical/HTTP audit.
Compare exact ECMA pass sets. Preserve raw failures and timing/RSS observations
in ignored artifacts, run heavy work serially and commit working checkpoints.

## Remaining acceptance work

The completed corpus audit for 4b24556 preserves all 3292 Test262 passes and
the exact historical ECMA pass/fail sets (990/339), but does not gain ECMA
passes. The injected-exception ownership correction fe35c1b is a later,
separately tested change: a suspended execution owns its injected guest value
until resume or abort, including the interval after failHostCall and before
resume. The core suite passes on both hosts and bounded native GC structural
stress passes. Broader standalone demo/HTTP, Octane and cross-host self-build
acceptance remains open; do not treat the architectural cutovers as completed
acceptance of those gates. See the dated semantic cleanup validation report.

## Descriptor decision checkpoint

property_semantics_kernel.js now owns ordinary descriptor rejection and flag
transitions. Runtime calls the ordinary JS function; the native graph compiles
that same function with explicit read-only field/attribute/rejection namespaces.
Normalized input consists only of presence bits, requested attribute bits and
SameValue mismatch bits. It retains no descriptor/heap references and allocates
nothing. Both old validation/flag-update blocks have been removed. Observable
getter order, callable validation, value rooting and exotic handling remain
with the adapters, before entry resolution and publication.

Node core passes (12 guest programs / 270 assertions plus internal checks),
and i386 focused embedding/context integration passes. The latter entry point
reuses the existing broad integration checks, not a new micro-feature suite.
Four selected existing Object.defineProperty tests pass under standalone
execution: define-over-method, function-length, miscellaneous, new-definition.
They take 26.047 runner seconds versus 28.356 on the unchanged old debug image
in an adjacent control. This is a focused observation, not full acceptance or
a claimed general speedup. Node builds the candidate in 9.57 seconds /
302840 KiB peak RSS. Broader build/corpus/performance gates remain pending.

## Assignment and resolution checkpoint

The shared ordinaryWriteActionKernel selects data write, setter invocation,
missing setter or non-writable rejection. Runtime and native assignment use
that function; strict/sloppy effects and guest call-frame entry stay with the
execution adapter. Existing native rejection exits are not yet removed.

createNamedPropertyOwnerResolver uses ordinary JS dependency injection to bind
own-entry lookup and prototype access. Runtime binds its existing guarded own
cache and checked records; native compilation binds the corresponding kernel
helpers. The traversal source is identical. It returns a logical owner offset;
the positive cache supplies the subsequent entry read, without allocating a
descriptor pair or keeping a raw cell address. Prototype chains are not cached
as a whole: mutations/shadowing retain their existing visibility rules.
The native setter's duplicate prototype/type/list scan has been removed.

Node core, i386 focused embedding/context checks and standalone JSON (12 files /
908 assertions) pass. These are intermediate gates, not a completed full audit.

## Root ownership cutover

visitRuntimeRecordRoots now enumerates common heap owners for native root
seeding and portable graph traversal: globals, registered contexts/callbacks,
retained programs, live snapshots, engine services and in-progress function
construction. visitEmbeddingRoots covers explicit retain tokens and active
embedding register/environment stacks. visitExecutionRoots is the one frame
and pending-call walk, used by both collectors through marking visitors.

Constructor receivers are now explicit in the portable walk too; pending
callables are explicit alongside their receiver/arguments. These references
last only as long as the owning frame/request. No new permanent roots or
moving collection are introduced. Frame/register diagnostic labels are built
only when reporting an invalid root, rather than concatenating a string for
every live register at each collection.

Existing context integration now collects while a host call is suspended;
existing automatic-GC coverage constructs an instance while its constructor
allocates without reading this. Node embedding, automatic GC, full core and
bounded structural stress pass during this cutover. i386 embedding/context and
structural GC also pass (27 audits / 111888 edges / unchanged maximum bump).
The combined acceptance audit is still pending. Immutable source sharing
and substring policy remain unchanged.

## Native rejection and descriptor reader checkpoint

Ordinary named-write rejection no longer automatically leaves the native
interpreter. Sloppy writes advance through the internal native continuation;
strict writes construct TypeError and enter an available guest handler. Error
construction/handler transition is shared with null-property access. Failure
to allocate or an uncaught error retains the existing exit protocol; this is
not a new claim of complete uncaught-exception handling. Named message slots
are appended to runtime support and the native contract is bumped to 99.

The descriptor reader now resolves the six canonical named fields, rather than
recognising them using numeric character-code comparisons. Field indices derive
from the existing descriptorFieldNames table. Nearest-owner resolution means
a shadowed ancestor accessor no longer causes an unnecessary decline. An
actual accessor field still returns DESCRIPTOR_FIELD_NEEDS_CALLBACK; its guest
continuation remains future work, not a hidden host-language implementation.
Cell views are temporary, with no callback/GC before consumption; target append
still saves aliased descriptor values before moving its property backing.

Node core passes. A focused standalone run preserves all seven baseline
outcomes: six passes and the existing proto-property-change-writability-set
failure. Its four descriptor tests report 88.619/4102.491/126.852/5049.005 ms,
versus adjacent old-image 122.281/5457.150/149.149/6209.712 ms in the same
selection order. These are observations, not an aggregate benchmark claim.
There are no measured new ECMA passes yet. A candidate Node build takes 8.23
seconds / 299908 KiB; the final source is now frozen for combined acceptance.
