# Test262 execution plan

## Scope and immutable corpus

The guest VM targets ECMAScript 5.1.  Its applicable Test262 corpus is the
unmodified tree at `../../js_tests/tests/test262`, relative to this directory.
The runner and VM work must never modify, copy generated files into, or create
results beneath `../../js_tests/tests`.  Core ES5.1 chapters are in scope;
`intl402` is reported as outside the ES5.1 target unless ECMA-402 is made an
explicit additional target.

`test262_runner.js` is the checked-in entry point.  It follows the Octane
wrapper's command-line shape:

```sh
js_min.exe guest_runner.js --vm-native test262_runner.js
js_min.exe guest_runner.js --vm-native test262_runner.js ch11/11.4
js_min.exe guest_runner.js --vm-native test262_runner.js --fail-fast ch11
```

With no selector, or with `all`, the runner discovers every applicable test.
Selectors may name a chapter, subtree, or individual test relative to the
Test262 root.  A normal run continues after failures and prints a complete
summary.  `--fail-fast` is an optional diagnostic mode, never the default.

The runner has no Python, Node.js, npm, or SpiderMonkey dependency.  The
external corpus is supplied by the user and is read in place.

## Runtime and context lifetime

One command invocation owns one `JSRuntime`.  Each test variant runs in a
fresh `JSContext` within that runtime.  A variant means the non-strict or
strict form selected by `@noStrict`, `@onlyStrict`, or the absence of either
marker.  Contexts share runtime-owned immutable infrastructure and compiled
native interpreter code, but never globals or mutable harness state.

For each variant the runner:

1. creates a fresh context;
2. evaluates the applicable `shell.js` files from the corpus root down to the
   test's directory;
3. compiles and runs the test, adding a strict prologue when required;
4. records completion, exception phase, source position, and instruction use;
5. destroys the context and removes its roots.

Automatic heap-pressure collection reclaims dead context, source, parser,
AST, bytecode, and execution records in batches.  The runner does not force a
full collection after every variant.

## Harness and metadata

The suite's own `shell.js` files provide `$ERROR`, `$FAIL`, `runTestCase`, and
the other conformance helpers.  They are evaluated in root-to-leaf order in
the same isolated global as the test.

The runner recognizes the old corpus's comment directives without depending
on regular expressions:

- `@onlyStrict` selects only the strict variant;
- `@noStrict` selects only the non-strict variant;
- neither selects both variants;
- `@negative` inverts the expected outcome and may constrain the acceptable
  failure.

Negative tests retain the distinction between lexical/parse or other early
errors and runtime exceptions.  In particular, the corpus's `NotEarlyError`
sentinel must not turn a missing early error into a pass.  Result
classification uses structured VM status rather than scraping console text.

## Execution and containment

Every variant receives a finite cumulative instruction allowance.  Exhausting
one slice yields to the Test262 scheduler; it does not alter JavaScript state.
The scheduler may grant another slice until the per-variant limit is reached.
At that point the result is a timeout, the context is destroyed, and—unless
`--fail-fast` was selected—the next variant runs.  Thus an infinite loop cannot
prevent a full-suite result.

The final report includes selected tests and variants, passes, failures,
timeouts, and explicit exclusions.  Failure output includes the relative
test name, variant, phase, error class, filename, line, and column.  Any failed
or timed-out applicable variant makes the command exit nonzero after the
summary.

## Self-hosting boundary

The finished MMVM Test262 path performs discovery, file reads, tokenization,
parsing, bytecode compilation, verification, context scheduling, and result
classification without an embedder `hostCall` transition.  Guest `load()` is
implemented using the guest's direct libc/FFI filesystem service and the
self-hosted front end, and evaluates in the requesting context.  Direct,
capability-controlled native FFI is an MMVM facility, not a callback into the
host JavaScript engine.

The initial checked-in runner is deliberately separated from the execution
service by a small `Test262VM` interface.  During bootstrap that interface may
be backed by the existing embedder-side parser/context machinery.  That is a
transitional implementation, not conformance with the self-hosting boundary.
Migration moves the same operations behind the interface into guest/native
runtime services without changing test selection, reporting, or semantics.

The required end state is:

```text
js_min.exe
  `-- guest_runner.js
        `-- one guest JSRuntime
              `-- test262_runner.js
                    |-- fresh JSContext: harness + test variant
                    |-- destroy context
                    |-- fresh JSContext: harness + test variant
                    `-- ...
```

Node-hosted execution remains useful for general VM development, but it is
not a dependency or substitute for the `js_min.exe` conformance run.

## Development policy

Failures are grouped into VM semantic defects, runner/harness defects,
unsupported facilities, and individually documented out-of-scope tests.
Skips must never silently inflate the pass count.  Work should fix general
language/runtime behavior instead of recognizing individual Test262 files.
Existing demos, networking programs, Octane correctness, and established
performance measurements remain regression gates while conformance improves.
