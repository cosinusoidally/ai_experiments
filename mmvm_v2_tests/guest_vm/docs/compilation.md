# Compilation pipelines

There are two different compilers. Keep their products and optimization
contracts separate.

Implemented kernel `-g`/`-O0` support is described in
[native kernel debugging](kernel-debugging.md); the original
[deterministic debugging plan](kernel-debug-plan.md) also records the broader
optimization/build/runtime benchmark matrix and deferred gates.

`X86Backend({installExecutable: false})` emits the same instruction bytes and
optional debug metadata without allocating executable memory or installing
a callable function. Its result has `fn: null` and `pointer: 0`; normal
compilation defaults to installation on MMVM hosts. This is an output policy,
not another dialect/backend or a change to generated code. The snapshot
executable packager uses it to compile `tools/snapshot_launcher.js` without
executing native build artifacts. Its main is an ordinary kernel function
with explicit argc/argv/snapshotEntry/dlsym inputs; startup ABI glue alone is
macro assembly.

Installed i386 results retain the general `fn` entry and expose internal
fixed-signature `callI32` bindings for up to `HostFFI.MAX_NATIVE_ARGUMENTS`
integer words. The fixed entry avoids creating an arguments array and then
unpacking it across the FFI. It is for typed internal callers, not arbitrary
guest argument conversion. Entries close over a small executable-lifetime token,
not the compilation result and its IR/dump/byte arrays. Retaining a callable
therefore need not retain its compiler products. `pointer` is an inspection
field; `destroy()` invalidates the shared token and all retained callable
variants before unmapping. Code pointers are data, not generated literals.
The wider-arity vector bridge remains available through `fn`.

`callMemoryI32(memory, offset, ...)` translates a memory view into the current
native base. `callMemoryOffset` additionally translates a nonzero returned
native address into an allocation-relative offset, preserving null zero.
These adapters let shared storage kernels retain the JS backend's memory-view
contract without publishing native pointers as guest record references.

`KernelDWARF.build(debug, codeLength, sectionBases)` optionally accepts byte
bases named `abbreviations`, `lines`, `locations`, and `frames`. These rebase
section-relative references when adding another compilation unit. Defaults
are zero and preserve existing sidecar bytes; DIE references stay CU-relative.
The shared `KernelDWARF.buildFrames(functions, sectionBase)` emitter can also
produce a CFI-only section for assembly frames. Its inputs are recorded macro
instruction positions and register save/restore events, not JS source ranges.
The packager uses it for validated bootstrap/ABI-bridge plans. These extra
FDEs live in the executable debug suffix, not in the original snapshot sidecar.
The declarative `snapshot_frames.js` plans are shared with the actual bootstrap
emitter. `begin`/`end` invoke named macro instructions and record offsets;
`describeBootstrap` validates an existing payload's frame boundaries against
those same emitted instructions. `absolute` relocates the recorded metadata
for ELF linking, not the snapshot code or its heap. Helpers are loaded lazily
by snapshot construction and do not run in the interpreter's dispatch path.

## Guest ES5.1 source to bytecode

[`tokenizer.js`](../tokenizer.js) scans characters without regular expressions.
It handles escapes, source positions, comments, literal spelling and Unicode
identifier classification using the checked-in authoritative Unicode data.
[`parser.js`](../parser.js) builds the AST and enforces grammar/strict-mode
early errors. Sloppy is the default; a directive prologue can enable strict
mode. Parser options used by build paths can suppress raw/location/function
source graphs; they do not select a modern language dialect.

[`function_analysis.js`](../function_analysis.js) supplies function/scope
analysis. [`compiler.js`](../compiler.js) emits register bytecode, constants,
binding/register maps, argument/parameter slots, nested program descriptors,
strict/eval flags, source and optional locations/hints. It preserves evaluation
order and lowers structured exception/finally behavior into executable
control flow. Register-backed locals avoid unnecessary environment traffic;
dynamic scope and closures use explicit lexical environments.

[`bytecode.js`](../bytecode.js) defines opcode numbers, widths and operand
metadata. PCs address the logical word stream, not instruction ordinals or
machine-code offsets. A CALL includes a constant-table argument-register
vector; its arity is not encoded by appending arbitrary operand words.
Use the opcode metadata rather than hard-coded numeric dispatch knowledge.

[`register_allocator.js`](../register_allocator.js) conservatively shares
single-definition, single-basic-block temporaries; bindings/constants and
cross-edge values remain private. Exception/dynamic-scope cases it cannot
safely analyze are not approximately packed. Large functions have bounded,
paged scratch analysis and can bypass optional packing. Optimizer passes in
[`bytecode_optimizer.js`](../bytecode_optimizer.js) likewise must preserve
observable order and mutation semantics.

[`verifier.js`](../verifier.js) validates compiler products before execution
or adoption. Runtime registration then materializes a traced program graph.
This is not the same as keeping the AST alive. Compact bytecode, constant
pools, integer vectors, source slices and execution caches are described in
[data structures](data-structures.md).

Compiler options such as `consumeAst`, `captureLocations`, `captureHints`,
`packedWords`, paged tables, reusable word arenas and `finishFunction` are
internal build policies. `consumeAst` permits releasing processed AST data.
`finishFunction` can adopt a nested function immediately rather than retain
every nested descriptor until the outer compile finishes. A callback may
retain descriptors unless scratch reuse is explicitly selected; reusing a
word arena behind a retained descriptor would corrupt compiler output.

## Kernel JavaScript to shared IR

[`aot/kernel_compiler.js`](../aot/kernel_compiler.js) parses function source
obtained from `Function.toString()` with the same parser. Its kernel is a
restricted, low-level dialect, not the guest language specification. It
supports integer locals, assignments, expressions, conditionals, loops,
returns, known helper calls, and recognized memory/numeric primitives.
Unsupported syntax/calls must fail compilation, not silently execute as an
arbitrary host closure.

### Operator catalogs and grammar views

Integer operators, binary64 operations and binary64 comparisons have private,
module-owned catalogs. Expression lowering reads this immutable vocabulary;
it does not allocate and populate an operator dictionary at every recursive
visit. IR operation names have one definition instead of separate copies in
the straight-line and control-flow front ends.

The existing straight-line grammar is narrower than the control-flow grammar.
Its integer and binary64 maps are derived once as explicit subsets of the
canonical catalogs. This preserves existing acceptance/rejection behavior;
it is not a claim that the two front ends or their IR forms are unified.
Unifying those paths remains separate work. Binary64 catalog lookup requires
an own entry, so inherited object methods cannot masquerade as intrinsics and
produce malformed IR. These catalogs are ordinary private JavaScript data,
not local-variable initializers given hidden compile-time semantics.

### Compilation transaction and function scopes

External scalar/namespace descriptors belong to one compilation transaction.
`compileGraph` validates input configuration, discovers reachable helpers and
their local declarations, then constructs one explicit external binding
environment. It does not rebuild and revalidate that entire environment
for every member. Both public entry points use the same private lowering
routine; graph member lowering does not re-enter the public `compile` method.
The public signatures/options are unchanged; method interception is not a
documented graph-member hook.

Each function has a distinct writable scope for its parameters, locals and
lowering bookkeeping. It inherits read-only external descriptors through an
ES3-compatible prototype. One scope constructor belongs to the transaction,
not to each member and not to mutable compiler-global state. Parameters and
locals shadow external names; a caller's local cannot leak into a
callee. The compiler never mutates an inherited descriptor. Once resolved,
these environments do not introduce runtime symbol/property lookups in the
generated kernel. No local declaration becomes an external binding for another
graph member, regardless of capitalization or initializer.

Identifier keys are `$`-prefixed; internal bookkeeping is outside that key
namespace. Previously the bookkeeping keys accidentally reserved valid locals
named `kernelFunctions` and `kernelFunctionName`. That collision is fixed,
and the unused function-name bookkeeping field is removed. The existing graph
integration check exercises those names as normal mutable/local bindings.

`compile(fn, options)` lowers one function. `compileGraph(entry, dependencies,
options)` discovers reachable named helpers through the supplied dependency
map, checks names/arities, sorts graph members deterministically and lowers
the graph. It supports recursive helper graphs; it does not discover every
JavaScript object dependency automatically. Prepared source can reuse parsed
function trees after source-equivalence checks. This is build-work reuse, not
a cache of application parser results.

The IR has explicit integer/float/memory operations and structured/control-flow
forms. It is shared by JavaScript and i386 backends. Named record helpers are
ordinary graph dependencies; eligible small functions can be inlined while
preserving argument evaluation and private local storage. `kernel_slots.js`
computes CFG/liveness-based reusable stack homes. The i386 backend also
selects registers and dispatch strategy; backend settings are not guest-JS
language semantics.

`constantBindings` supplies external integer bindings. In normal mode a local
`var` declaration still creates a mutable local and shadows an external
constant of the same name. New kernel work should use actual shared constants
and named accessor dependencies, not duplicated record offsets or variables
whose assignment is secretly treated as a configuration declaration.

`constantNamespaces` supplies explicit immutable integer namespaces, for
example `{CollectorLayout: HeapRecords.KernelConstants}`. Kernel source can
then read `CollectorLayout.FRAME_CONTEXT` or a static string-bracket field.
The namespace is an ordinary lexical object in the source; the compiler
specializes its selected own int32 fields to immediate values in shared IR.
It emits no object-property access in the running kernel. Treat the metadata
as immutable configuration and recompile if it changes. Dynamic field names,
arbitrary object reads, namespace reassignment and non-int32 selected fields
are not supported. Parameters and normal-mode locals shadow namespace names
normally; a local declaration is not reinterpreted as an external binding.

The shared marker, sweeper, free-block indexer and free-link release kernel
now use this facility and no longer enable `legacyConstantLocals`. Their
record constants come from HeapRecords; collector status codes have one named
namespace shared by compiled execution and error reporting. The interpreter
graph explicitly supplies those namespaces instead of depending on layout
declarations hidden in the marker's body.
The interpreter now reads fields already exported by HeapRecords through its
own `RecordLayout` namespace, rather than redeclaring their literal offsets or
zero-valued placeholders in the dispatch body. Its constructor still supplies
canonical scalar bindings for accessor dependencies, but does not repeat those
bindings individually in the options object. The completed cutover removed
copied opcode/intrinsic IDs and runtime-support slot
placeholders from the dispatch graph. It reads `Bytecode`, `NativeIntrinsics`
and `RuntimeSupportLayout` as explicit lexical namespaces. Imported helpers
that still use scalar names receive the same canonical values explicitly;
they no longer depend on ID declarations in `interpreterKernel`.

`nativeKernelBindings(profileOpcodes, recordConstants, operandPredecode)` owns
the integer configuration used by graph compilation and build fingerprinting.
It collects canonical tables once, alongside explicit mode-dependent values.
The constructor no longer reassembles a partially overlapping bindings table.
Legacy overrides and constant-local semantics have been removed; local
declarations retain ordinary mutable JS semantics.
The collector-driving native entry has also dropped its zero-valued layout
placeholders. The post-GC minimum headroom is defined once by `Heap.GCPolicy`
and exported through HeapRecords for the compiled path, rather than copied
as literals in native and embedding collection.

Namespace-field lowering has a separate helper so that its locals and
temporaries do not enlarge every recursive expression-lowering activation
in a self-hosted build. The first inline version expanded that hot function
from 424 to 471 guest registers; factoring limits it to 432. This matters
because ordinary compiler implementation functions are themselves guest
bytecode during self-hosting, not magically optimized native compiler code.

### Explicit interpreter dependencies

The native interpreter uses the same local-variable semantics as every other
kernel graph. Its `nativeKernelBindings` builder supplies external scalar
dependencies explicitly; layout namespaces point to the authoritative module
tables. Record offsets/sizes derive from `HeapRecords`, primitive tags from
`ValueCells`, and imported helpers receive the same graph environment. Modes
such as opcode profiling and operand predecoding are explicit configuration
arguments, not replacements for placeholder declarations in function bodies.

`legacyConstantLocals` and `constantOverrides` have been removed. Supplying
either obsolete option is an error, rather than silently compiling a different
program. Local uppercase names are mutable and shadow external names just as
other JS locals do. Graph discovery collects local names and dependency edges
in one traversal; it no longer discovers or merges constants from source.

The large kernel also retains inline layout calculations alongside named
accessor dependencies. The existence of accessor/compiler infrastructure is
not a claim that every old call site has completed that refactor.

## Shared IR to JavaScript or i386

[`backend_js.js`](../aot/backend_js.js) generates ordinary JavaScript functions
using a leading `memory` adapter and explicit memory operations. It is Node's
kernel execution path and an equivalence reference, not an FFI emulator.

Ordinary property policy is shared without adding a special compiler mode:
property_semantics_kernel.js contains ordinary JS decision functions over
normalized integer flags. Runtime calls them directly; the native graph compiles
the same bodies with explicit constant namespaces. Named prototype traversal
is produced by a normal JS factory binding its lookup/prototype helpers.
Native graph dependencies bind those same named kernel helpers explicitly;
this is not general closure compilation or mutable-local constant inference.
The portable factory binds the existing checked/cached record operations.

The shared policy also owns descriptor presence/attribute construction,
virtual-property attributes, key-enumeration inclusion and indexed-view
descriptor validation. Storage adapters compute inputs rather than repeat
the language rules. The indexed-view validation leaf has no external bindings;
standard-library installation loads indexed_view_policy.js into the guest
as well. Reading identical source text avoids bootstrap-host differences in
Function.toString pretty-printing. This uses the application parser/compiler, not
a new kernel-language mode or a host callback at execution time.

Callback-bearing Object operations are guest-bytecode continuations. Public
intrinsics retain fast native cases and a traced implementation closure;
unsupported conversion work enters a normal guest frame. Private primitive
copies have no continuation closure and receive normalized inputs, preventing
recursive normalization. No new special-purpose host progress objects or
snapshot relocation category is required. See semantic-unification.md for
the supported adapters and the current acceptance boundaries.

The compile result includes `.fn`, generated `.source`, `.ir` and backend
identity; a graph result also exposes generated helper functions.

[`backend_x86.js`](../aot/backend_x86.js) lowers the same IR through
[`x86_assembler.js`](../aot/x86_assembler.js). The assembler owns instruction
encoding, labels, relative calls/jumps, code storage and fixups. Higher-level
code should compose named assembler operations, not inject opaque sequences
of machine-code bytes. Native calls are i386 ABI operations, not calls to an
outer JavaScript function. Floating-point memory values are binary64 even
when control/address calculations use 32-bit integers.

On js_min the executable result can own mapped native code and a callable
entry. Node can cross-build the i386 bytes and snapshot without executing
them. Deferred symbol bindings during a Node image build are placeholders
for loader rebinding, not implementations of libc calls. Backend/native
compilation objects have lifetimes and destruction; retaining a function
after its code mapping is destroyed is invalid.

## Other compilation paths

`threaded_compiler.js` generates structured JS from guest bytecode, with
`aot/bytecode_numeric_backend.js` supplying a narrower numeric path. These
are legacy/optional embedding paths. “Threaded” does not mean multithreading.
They do not replace the native bytecode interpreter used by a standalone
image. Likewise, the Demo8 NativeCompiler is application code; its API and
rasterizer are not public GuestVM entry points.

## Compatibility discipline

Changing bytecode metadata, native assumptions, intrinsic IDs, record layouts,
assembler behavior or snapshot representation can break old images. The
native contract version in `heap_records.js` is explicit and currently 98;
the standalone file format is independently versioned. Do not assume a source
fingerprint at launch will detect every incompatible image: loading currently
uses version/mode checks rather than source re-fingerprinting.
