# Compilation pipelines

There are two different compilers. Keep their products and optimization
contracts separate.

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

### Active legacy exception

The current native interpreter constructor explicitly sets
`legacyConstantLocals: true` and supplies `constantOverrides`. In this mode,
recognized local constant-style declarations can become build-time constants.
`validateConstantOptions` rejects overrides without the legacy switch.
This compatibility mode is still used by the large interpreter kernel; its
removal is **not complete**. Do not infer ordinary JS-local equivalence for
that configured build merely because the compiler's default is now normal.
The named layout definitions and constants in `HeapRecords` are authoritative
for the generated code. See the actual compiler options in
[`aot/native_interpreter.js`](../aot/native_interpreter.js).
The large kernel also retains inline layout calculations alongside named
accessor dependencies. The existence of accessor/compiler infrastructure is
not a claim that every old call site has completed that refactor.

## Shared IR to JavaScript or i386

[`backend_js.js`](../aot/backend_js.js) generates ordinary JavaScript functions
using a leading `memory` adapter and explicit memory operations. It is Node's
kernel execution path and an equivalence reference, not an FFI emulator.
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
