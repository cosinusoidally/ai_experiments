# Catch scope and arguments-map design

Design of the contract-71 scope/mapping implementation. The shared kernel
functions live in `lexical_environment_kernel.js`, compiled through the same
front/middle end for both JavaScript and i386 execution.

## Environment scope data

Keep the existing environment record size. Give its reserved reference a
named `environmentScopeData` accessor, and discriminate its meaning with
record flags:

- Ordinary function/eval environment: no extra scope data.
- Existing object environment (`with`): the reference is the binding object.
- Single-binding declarative environment: the reference is the binding-name
  string; slot zero contains its current value.
- Function environment with detached arguments mappings: the reference is a
  mutable integer-vector bitset of permanently detached argument indices.

The latter two kinds use distinct flags. `environmentObject` must return
zero for both declarative kinds, rather than treating a string or vector as
a with object. The collector traces the raw scope-data reference in every
kind. Reference and native collectors must agree; do not change only the
semantic getter and accidentally stop tracing the binding name or bitset.

## Catch entry and exit

Introduce a scope-creating catch-handler opcode alongside the existing
synthetic-finally handler. Its binding operand is a constant-pool string key,
not an outer variable slot. A handler flag records this interpretation.

When selecting such a handler, construct a fresh one-binding environment
whose parent is the handler's saved environment. Copy the thrown value into
slot zero. Only then publish the new active environment and pop the handler.
Allocation failure must leave the original exception/handler/PC state intact
so normal collection and retry remain valid.

The compiler lowers the handler with this lexical scope visible, including
when compiling nested closures. It must not hoist the catch parameter as a
function/global variable. `var` declarations inside catch still belong to the
outer variable environment, while an initializer's identifier lookup can
resolve to the catch parameter. Normal completion leaves the environment;
abrupt exits reuse the existing lexical-region cleanup mechanism. `this`
continues to bypass identifier lookup, counting intervening lexical scopes
when reaching the function receiver binding.

Use the same scope-pop operation for with/catch environments, with a clearer
name while retaining the old numeric opcode/API alias where necessary.
Portable exception handling and native unwinding must implement the same
semantics. The portable runtime reconstructs a catch environment's name map
from its heap-owned scope-data string, never from an unrelated function's
binding-slot map.

## Permanent arguments-map detachment

Keep the existing shared parameter-slot layout as the compact representation
for an unmodified sloppy arguments object. Strict arguments remain unmapped.
Materialize a detached-index bitset only when an alias is broken. This avoids
an extra map allocation on every call using arguments, while making a deleted
index stay detached after a later assignment recreates that element.

Both reference and native mapping lookup check the bitset before applying
the existing parameter-slot/duplicate-name rules. Deletion must detach before
clearing the element. Creating a previously absent index in the mapped range
must detach before writing it, so missing call arguments do not acquire new
aliases. Descriptor changes that break mapping should use the same operation,
not a second independent detachment convention.

The bitset belongs to the activation environment already referenced by the
arguments object. It contains integer bits, not native pointers, and is
traced through scope data. Reserve/initialize/publish it atomically on the
native path; the reference path must retain the thrown value/environment or
argument object across any allocation safe point. Do not put mapping state
in value-cell spare bits: ordinary value copying must not transport internal
alias metadata into unrelated values.

## Validation

Use the unchanged Test262 catch/arguments cases, then the full imported suite.
No new language micro-test files are needed. Also run both host project
suites, bounded GC stress, previously passing Octane quick selections, live
demos/HTTP checks, and three-way snapshot identity. In particular, stress
escaped closures/arguments through collection and inspect heap references;
the environment's new scope-data uses must survive both collectors and
snapshot relocation without making the heap position fixed.
