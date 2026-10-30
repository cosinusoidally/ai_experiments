# Compiler-owned function analysis

`function_analysis.js` computes syntax facts for consuming compilation. It is
not a source/bytecode cache and performs no name resolution against a runtime
environment. Every input is still tokenized, parsed, checked and lowered.

The parser constructs a normal AST. When `Compiler` owns that AST through its
existing `consumeAst: true` option, the analyzer walks each function once and
temporarily attaches `guestFunctionAnalysis` to the function node. Nested
functions are summarized bottom-up; an enclosing function combines their
identifier sets rather than repeatedly walking all their bodies.

The summary contains ordered local declarations, distinct own and descendant
identifier names, direct-eval and arguments-reference flags, conservative
environment requirements, and the existing coarse return annotation. Nested
references deliberately retain the compiler's conservative capture rule:
matching an enclosing binding pins that binding even if an inner declaration
could shadow it. Try/with/eval conservatism is preserved.

Local name ordering and duplicate handling match the existing declaration
walk. Own identifiers exclude nested function bodies. Descendant identifiers
are used only for capture analysis, not as references in the enclosing body.
Bindings are resolved later against each compiler's actual lexical scope
stack. The summary therefore cannot capture a stale catch/with/finally scope.

The traversal follows explicit AST child fields. It ignores source locations,
cached program descriptors and other non-syntax metadata. Unknown node shapes
decline the optimized path. Functions with a with statement in their own body
also retain the existing binding-collection path. This is a conservative
compatibility boundary, not a decision to omit with semantics.

## Ownership and embedding

Public mutable-AST compilation keeps the existing fresh analyses. It does not
trust a memo from an earlier compilation or require embedders to invalidate
syntax facts after editing an AST. `consumeAst: true` already gives the compiler
permission to release function bodies/completed statements; that ownership is
also required for this memo. Do not reuse a consumed AST.

Summaries contain names/flags, not body back-references, runtime addresses or
resolved bindings. Releasing consumed AST nodes can release the memo as well.
No runtime-wide table keeps those nodes alive. Ordinary program metadata is
unchanged; function source remains available to `Function.prototype.toString`.

## Refactoring diagnostics

`tools/compare_compilation.js` compiles real source files through both public
and consuming paths and reports the first bytecode/metadata difference. It
uses no golden bytecode and is a diagnostic for this refactor, not a constraint
that future optimizers must always produce identical instruction sequences.
It works under Node and js_min, from the suite directory:

```
node guest_vm/tools/compare_compilation.js guest_vm/compiler.js demo8.js
js_min.exe guest_vm/tools/compare_compilation.js guest_vm/compiler.js demo8.js
```

Use the usual `LD_LIBRARY_PATH` setup for js_min. The diagnostic discards AST
references from the first program before compiling the second, and processes
files serially. Full language/workload and reproducible-build checks remain
necessary in addition to this structural comparison.
