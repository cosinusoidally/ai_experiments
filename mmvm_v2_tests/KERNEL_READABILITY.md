# Kernel readability and semantic cleanup

## Direction

Kernel source should be a restricted JavaScript program, not JavaScript-looking
source with hidden replacement rules. A local `var` remains a local variable
regardless of capitalization. Layout constants come from their authoritative
modules; field access uses named accessors. The shared front/middle end should
remove the cost of readable abstraction for both JS and i386 backends.

This cleanup does not change guest ES5.1 semantics, demo source, or C source.
It is a staged migration, not a claim that the existing integer kernel dialect
already implements every observable JavaScript behaviour.

## 2026-10-04: first migration checkpoint

- Default kernel compilation no longer classifies uppercase local declarations
  as immutable constants or shares them across unrelated functions. Local
  declarations shadow external bindings. Mutable uppercase locals and distinct
  same-named locals in different graph members are exercised in the existing
  cross-backend compiler checks.
- Explicit `constantBindings` describe an external integer environment. Values
  must be int32 numbers, not values silently coerced into int32. Kernel authors
  must provide the same stable values that their ordinary JavaScript closure
  sees. These bindings are not replacements for local variable initializers.
- The free-region cleanup kernel now has real closure bindings derived from
  Heap, instead of zero-valued declarations overridden by the compiler.
- Property cloning now uses record/property accessors and `copyValueCell`.
  Header, property and value-cell layouts are exported from their authoritative
  definitions, rather than copied as numerical offsets in the cloning code.
- Address lowering folds the static offsets of nested value-cell accessors.
  The refactored property-cloning kernel emits exactly the same macro assembly
  as the previous implementation: readability does not add runtime operations.
- Ordinary `for` loops, empty statements, and standalone prefix/postfix
  increment/decrement lower into the existing shared control-flow IR. Both
  backends are compared against ordinary JS with a nested-loop checksum.
  Expression-valued updates and break/continue remain unsupported; they are
  rejected rather than given incorrect loop/update semantics.

## Compatibility boundary and remaining work

`legacyConstantLocals: true` explicitly retains the former uppercase-local
constant convention. `constantOverrides` is rejected unless this temporary
compatibility mode is selected. It is still needed by the main native
interpreter graph, the marker/sweeper/indexer, and the snapshot heap audit.
Those call sites are marked explicitly so the debt is visible and new kernels
do not inherit the convention accidentally.

The main interpreter migration remains substantial. It must remove placeholder
declarations, export missing layout/enum definitions, and bind the actual
external values without changing their generated instructions or accidentally
capturing per-runtime state in module-level mutable variables. Profiling flags
need an explicit runtime or specialization boundary, not initializer rewriting.
Graph compilation must eventually stop exporting legacy function-local values
as shared graph bindings altogether.

Other outstanding debt includes raw field arithmetic in interpreter helpers,
duplicated layouts and diagnostic codes, and the integer dialect's initialization
and arithmetic restrictions. Standard JS equivalence requires an explicit
supported input domain (including overflow/coercion), or stronger type/range
validation. Do not describe existing wrapping i386 arithmetic as unrestricted
JavaScript arithmetic.

Future compiler improvements should be driven by readable real kernels:
ordinary compound assignments, structured loop exits, ordinary constant
namespace member access, and inlining small accessor/helper functions. They
must preserve evaluation order and effects, use the shared IR, and reject
unsupported constructs instead of changing their meaning.

## Verification

Use the existing dual-host suite and kernel call benchmark:

```sh
guest_vm/tests/run_tests.sh both
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_vm/benchmarks/kernel_call_benchmark.js 10000000
```

Tests and measurements are recorded at working checkpoints below. Generated
logs, snapshots and executables belong in ignored artifacts, not in git.

- 2026-10-04: final dual-host suite passed: 12 guest programs / 269 assertions
  per host, plus kernel, heap/embedding/GC, context multiplexing and runner
  command-line checks. net.js and node_web.js compile/help paths passed.
- Property-clone macro assembly is exactly identical to the pre-refactor
  implementation, including local allocation and instruction order.
- i386 kernel-call benchmark, 10 million iterations: before, inline 29 ms /
  called 47 ms; after, inline 33 ms / called 46 ms. These short timings are
  noisy and do not establish a speedup or replace demo measurements.
