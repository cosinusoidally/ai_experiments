# JavaScript VM Bootstrap Plan

## Purpose

Build a JavaScript VM written in the mawkcc bootstrap dialect. The VM project
is independent of the `../mawkcc` project: all VM source, scripts, fixtures,
tests, artifacts, and documentation live under `jsvm/`. The `../mawkcc` tree
may be used as a read-only upstream fixture and byte-identity oracle, but
creating the VM must not require modifying files under `../mawkcc`.

The initial implementation targets the current mawkcc subset: a deliberately
small language shape that is valid as C, JavaScript, and AWK input. From that
shared subset, the accepted JavaScript language grows in small audited steps
until the VM reaches ECMAScript 5.1.

The VM is a bytecode-first JavaScript interpreter with a later native JIT path
for the mawkcc subset. JavaScript source is parsed into compact internal
bytecode, then executed by an explicit bytecode interpreter unless a function
is selected for mawkcc-subset native compilation. JavaScript code must be able
to call JIT-compiled mawkcc-subset C code, and JIT-compiled code must be able
to call back into JavaScript through an explicit, tested call boundary.

The built VM route should be able to run `../mawkcc/mawkcc_self.c` and emit the
same mawkcc compiler output as the existing upstream routes. It should accept
the same command-line contract, including `-c`, `-o output`, and source input,
but its build and verification scripts are owned by `jsvm/`.

The guiding invariant is the same as the rest of this repository:

- every accepted bootstrap route must emit a byte-identical mawkcc compiler
  binary
- every emitted compiler binary must rebuild itself byte-identically
- the JS VM route must preserve the same bootstrap closure and CLI behavior
  without editing the upstream `../mawkcc` tree
- JS-to-JIT and JIT-to-JS calls must be deterministic, testable, and covered
  before being used by bootstrap code
- new JavaScript behavior must be covered by small tests before being used
  by the next layer


## Target Shape

Add a new source file, tentatively `jsvm_self.c`, written in the same
restricted dialect as `../mawkcc/mawkcc_self.c`. The starting point may be
mechanically derived from the upstream source, but once copied it is owned by
`jsvm/` and evolves independently.

Add self-contained VM build and verification scripts under `jsvm/`:

```sh
scripts/build-jsvm.sh
scripts/run-tests.sh
scripts/verify-mawkcc-output.sh
```

Those scripts should build `jsvm_self.c`, run local VM fixtures, and optionally
ask the VM to execute `../mawkcc/mawkcc_self.c` as an integration fixture. The
resulting mawkcc executable should be compared from inside `jsvm/` against a
reference output produced by an existing upstream route. Do not add the VM
route to upstream verification while developing `jsvm`.
If the early bootstrap build needs an existing mawkcc compiler, pass it to the
`jsvm` script as a toolchain input; do not modify upstream scripts or write
artifacts into the upstream tree.

Keep the existing SpiderMonkey route as the oracle while the VM is being
built. Spidermonkey route will be retained even when we are done to give
us more diverse bootstrap paths.

## Project Boundary

`jsvm/` is the build root for the JavaScript VM.

Owned by `jsvm/`:

- `jsvm_self.c`
- VM build scripts
- VM test scripts
- source fixtures
- expected-output fixtures
- generated artifacts
- VM bootstrap and architecture notes

Read-only upstream inputs:

- `../mawkcc/mawkcc_self.c`
- `../mawkcc/BOOTSTRAP_DIALECT.txt`
- existing upstream mawkcc build scripts used only during verification to
  produce comparison artifacts
- existing upstream SpiderMonkey route used only as an oracle

Do not modify `../mawkcc` while implementing `jsvm`. If the VM exposes a
mawkcc bug or missing upstream feature, record the finding in `jsvm/` and keep
the VM change blocked until the upstream project is intentionally updated in a
separate task.

## Initial VM Contract

The first milestone is "can run `../mawkcc/mawkcc_self.c` as JavaScript". That means:

- parse `function name(args) { ... }`
- parse `var name;` globals
- parse integer literals and double-quoted string literals needed by
  `../mawkcc/mawkcc_self.c`
- parse call expressions, assignment, `return`, `if`, `else`, `while`, and
  `break`
- parse expression statements
- support only the call-style operator/runtime names used by the bootstrap
  dialect: `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`, `NOT`, `EQ`, `NE`,
  `LT`, `LE`, `GT`, `GE`, `AND`, `OR`, `XOR`, `SHL`, `SHR`, `brk`, `ri8`,
  `wi8`, `ri32`, `wi32`, `mks`, `mkC`, `open`, `read`, `write`, `close`,
  and `exit`
- support the `main(argc, argv)` call convention used by the current JS
  runner
- expose the mawkcc-compatible command-line behavior:
  `mawkcc [-c] [-o output] source`
- compile accepted JavaScript functions to internal bytecode
- run JavaScript bytecode with a deterministic interpreter
- JIT compile the mawkcc subset used by `../mawkcc/mawkcc_self.c` only after
  the bytecode path is tested
- allow explicit calls from JavaScript into JIT-compiled mawkcc-subset C code
- allow explicit callbacks from JIT-compiled code into JavaScript code

The first VM may reject all other JavaScript syntax with a clear diagnostic.
It should not pretend to implement features that are only partially wired.


## Representation Choices

Use memory-backed tables, not host arrays or structs. The implementation
must remain in the mawkcc bootstrap dialect, so the VM should follow the
storage style used by `../mawkcc/mawkcc_self.c`:

- one growable byte heap for source text, strings, bytecode, objects, and
  runtime memory
- integer handles instead of pointers to host objects
- table rows with fixed-width fields for symbols, functions, bytecode
  instructions, string entries, and call frames
- explicit lengths and capacities for every table
- helper accessors for table fields once repeated offset arithmetic becomes
  hard to audit

For the initial VM, compile every accepted JavaScript function into compact
internal bytecode and execute it with the bytecode interpreter. Add the
mawkcc-subset native compilation path after the bytecode path can run small
fixtures and has stable dumps for debugging. The mawkcc-subset path should
emit the same kind of native compiler output that mawkcc already emits, but it
must share the bytecode VM's value representation, call ABI, and primitive
runtime so crossing between JS and JIT-compiled code is explicit and
auditable.

Suggested initial bytecode:

- load integer constant
- load string handle
- load global
- store global
- load argument/local slot
- store argument/local slot
- call user function
- call primitive
- conditional jump
- unconditional jump
- return
- pop

Because the bootstrap dialect has no true local declarations, user function
parameters can be treated as the only local slots at first. If the VM needs
temporary interpreter locals, keep them as fields in explicit VM state.


## Phase 0: Specify The Subset

Before changing compiler behavior, mechanically inventory what
`../mawkcc/mawkcc_self.c` actually uses in the shared C/JS/AWK mawkcc subset:

1. add a small source scanner or use existing lexer code to list reserved
   words, punctuation, string escapes, builtin names, maximum arity, maximum
   function arity, and maximum nesting depth
2. save the result as a checked-in fixture, for example
   `fixtures/mawkcc_bootstrap_subset.txt`
3. document the accepted initial subset in a short companion file or in the
   header of `jsvm_self.c`

Exit criteria:

- the inventory is reproducible
- the accepted subset is narrow enough to implement without guesswork
- unsupported syntax has a named diagnostic path


## Phase 1: Create Independent `jsvm_self.c`

There is no prototype implementation in a different dialect. The first working
VM source is `jsvm_self.c`, built under `jsvm/`. It may start by copying or
mechanically deriving code from `../mawkcc/mawkcc_self.c`, but after that copy
all changes happen in `jsvm/`.

Preserve these pieces from `../mawkcc/mawkcc_self.c` at the start:

1. mawkcc command-line parsing: `[-c] [-o output] source`
2. source loading, diagnostics, output file handling, and stdout output
3. primitive runtime calls: `brk`, `ri8`, `wi8`, `ri32`, `wi32`, `mks`,
   `mkC`, `open`, `read`, `write`, `close`, and `exit`
4. byte-identical binary and object output expectations
5. the storage style, table layout discipline, and integer-only bootstrap
   assumptions

Then replace compiler-specific pieces with mixed VM/JIT pieces in layers:

1. recognizer for the shared C/JS/AWK mawkcc subset
2. JavaScript parser and bytecode path for the accepted bootstrap subset
3. C JIT path for functions that stay inside the mawkcc subset
4. shared symbol, string, value, and call-frame tables
5. explicit JS-to-JIT and JIT-to-JS call adapters
6. primitive call dispatch shared by both execution paths
7. compatibility path that uses the mawkcc CLI shape without changing
   upstream build scripts

Exit criteria:

- `jsvm_self.c` builds through `jsvm/scripts/build-jsvm.sh`
- the derived executable still accepts mawkcc-compatible arguments
- no host-only implementation or alternate-dialect prototype exists
- no files under `../mawkcc` are changed
- every semantic decision is captured in tests or notes before it is used by
  the next layer


## Phase 2: Build The VM And JIT In The Bootstrap Dialect

Continue implementing `jsvm_self.c` directly in the restricted source shape
documented by `../mawkcc/BOOTSTRAP_DIALECT.txt`.

Build in layers:

1. source buffer and diagnostics
2. lexer
3. symbol table and string table
4. parser skeleton for top-level `var` and `function`
5. statement parser
6. expression parser for calls, literals, identifiers, and assignment
7. bytecode emitter
8. bytecode interpreter
9. C JIT emitter for the mawkcc subset
10. JS-to-JIT and JIT-to-JS call adapters
11. primitive runtime
12. mawkcc-compatible `main(argc, argv)`

At each layer, add a tiny input fixture and a script that can run the VM
under at least one existing route. Temporary trace modes are fine, but all
implementation logic remains in the mawkcc bootstrap dialect.

Exit criteria:

- `jsvm_self.c` builds through `jsvm/scripts/build-jsvm.sh`
- the compiled VM can execute small bootstrap-subset programs
- no host-only data structures, alternate-dialect implementation, or hidden
  JavaScript behavior remain


## Phase 3: Run `../mawkcc/mawkcc_self.c` Through The VM

Add `jsvm/scripts/verify-mawkcc-output.sh`.

The script should:

1. build `jsvm_self.c` through `jsvm/scripts/build-jsvm.sh`
2. execute the resulting VM with mawkcc-compatible arguments:
   `-o output ../mawkcc/mawkcc_self.c`
3. chmod the emitted compiler
4. compare the emitted compiler with a reference compiler output generated
   from an existing upstream route
5. write all generated files under `jsvm/artifacts/`

The VM runtime should emulate the current JS runner's environment:

- byte-addressable heap
- `brk`
- `ri8`, `wi8`, `ri32`, `wi32`
- stable `mks` string interning
- `mkC`
- read-only file open/read for the compiler source
- stdout/stderr write behavior
- close and exit
- synthetic `argv` containing the VM route name, output option, and source path

Exit criteria:

- `jsvm/scripts/verify-mawkcc-output.sh` emits a compiler binary under
  `jsvm/artifacts/`
- that binary matches a reference output generated from an existing upstream
  route
- the emitted binary can rebuild `../mawkcc/mawkcc_self.c` identically
- the VM-built executable can use the same CLI shape as mawkcc without
  changing any upstream scripts


## Phase 4: Promote Inside The JSVm Verification Matrix

Once the route is stable, update `jsvm` verification:

1. add the mawkcc-output check to `jsvm/scripts/run-tests.sh`
2. document the route in `jsvm/SELFHOST.txt` and `jsvm/ARCHITECTURE.txt`
3. keep SpiderMonkey JS in the matrix as an independent host reference
4. continue treating `../mawkcc` as read-only input

Do not weaken byte identity to make the new route pass. Differences should
be debugged as either VM semantic bugs, runtime primitive bugs, or hidden
host assumptions in `../mawkcc/mawkcc_self.c`.

Exit criteria:

- `jsvm/scripts/run-tests.sh` passes
- the route is described as experimental or stable explicitly in docs
- failures point to a small VM test before relying on the full compiler run
- no upstream `../mawkcc` files are modified


## Phase 5: Self-Host The VM Route

After `jsvm_self.c` can be built through the local `jsvm` build script and can
run `../mawkcc/mawkcc_self.c`, make the VM rebuild path explicit:

1. build VM with `jsvm/scripts/build-jsvm.sh`
2. use that VM to run `../mawkcc/mawkcc_self.c` and produce a mawkcc compiler
3. use that compiler to rebuild `jsvm_self.c`
4. use the rebuilt VM to run `../mawkcc/mawkcc_self.c` again
5. compare both emitted mawkcc binaries

This proves the VM source is inside the bootstrap closure and that the VM route
has the same self-rebuild characteristics as the existing mawkcc route.

Exit criteria:

- VM built by a VM-produced compiler behaves the same as VM built by the
  reference route
- VM rebuild differences are either byte-identical or intentionally
  explained by allowed executable-layout differences
- the closure check is scripted
- the rebuilt VM still supports the mawkcc-compatible CLI shape
- JS-to-JIT and JIT-to-JS calls still behave identically after the rebuild
- all scripts and artifacts remain under `jsvm/`


## Phase 6: Grow Toward Real JavaScript

After the bootstrap VM is reliable, extend the accepted language in small
groups. Each group should have:

- syntax tests
- runtime tests
- at least one negative test
- notes on where it differs from ECMAScript 5.1 if incomplete
- no dependency from the compiler path until the feature is verified

Recommended order:

1. comments and whitespace exactly as ES5.1 expects
2. expression grammar with infix precedence while preserving call-style
   bootstrap expressions
3. block-scoped parser structure for normal JavaScript statement syntax,
   while keeping ES5 `var` function/global semantics
4. booleans, `null`, `undefined`, and JavaScript truthiness
5. double-precision numbers or a documented temporary integer-only number
   mode with tests that isolate the limitation
6. strings, indexing, concatenation, length, and common escape sequences
7. objects with property get/set and prototype links
8. arrays and array length behavior
9. function objects, closures, scope chains, `this`, and `arguments`
10. `new`, constructors, and built-in prototypes
11. exceptions: `throw`, `try`, `catch`, `finally`
12. `eval` only after the parser/runtime boundary is robust
13. standard ES5.1 built-ins in dependency order

Keep a feature matrix, for example `JS_VM_ES51_MATRIX.txt`, with columns
for parser support, runtime support, tests, and known deviations.


## ECMAScript 5.1 Completion Strategy

Use the ECMAScript 5.1 specification as the behavioral target, but do not
try to implement the whole standard in one pass. Split completion into
conformance layers:

1. lexical grammar and source text handling
2. syntactic grammar
3. execution contexts and scope chains
4. type model and conversions
5. object model and property descriptors
6. function semantics
7. built-in objects
8. strict mode
9. eval
10. JSON, Date, RegExp, and other library-heavy areas

When the VM becomes capable of running external JavaScript tests, import a
small pinned conformance subset first. Avoid adding a large test suite until
the harness can report small, actionable failures.


## Testing And Debugging

Add tests at three levels:

- lexer/parser golden tests: source to token stream or bytecode summary
- VM unit tests: tiny programs with expected integer output or byte output
- JIT tests: mawkcc-subset functions selected for native compilation
- interop tests: JavaScript calling JIT-compiled code and JIT-compiled code
  calling back into JavaScript
- bootstrap route tests: full `../mawkcc/mawkcc_self.c` run and byte comparison

Useful debug modes:

- token trace
- bytecode dump
- primitive call trace
- function call trace with depth limit
- memory bounds checks
- deterministic allocation log

All debug output should be opt-in through an environment variable or command
line flag so byte-identical build output stays clean.


## Risks

The biggest technical risks are:

- accidentally implementing the bootstrap dialect instead of JavaScript, then
  discovering the architecture cannot grow
- mismatched signed 32-bit behavior between the VM and SpiderMonkey runner
- string interning or file I/O differences that perturb emitted bytes
- recursive parser/interpreter depth exceeding the tiny bootstrap runtime's
  practical limits
- JS-to-JIT value, stack, or calling-convention mismatches
- command-line or output-mode drift that prevents the VM executable from using
  the mawkcc-compatible CLI shape
- accidental coupling to upstream `../mawkcc` scripts or generated artifacts
- growing ES5.1 objects and closures without first stabilizing a clear object
  representation

Mitigations:

- define bytecode, call-frame, and object layouts before broad feature work
- keep bytecode execution as the first semantic implementation path; add JIT
  only after bytecode fixtures pass
- keep the bootstrap VM tests independent from the full compiler run
- compare against the existing SpiderMonkey route until the VM is mature
- run compatibility checks through the same mawkcc CLI shapes used by the
  existing scripts, but from `jsvm/scripts`
- keep the JS/JIT call ABI small, documented, and covered by direct tests
- record every intentional ES5.1 deviation in the feature matrix
- preserve the existing mawkcc bootstrap invariants at every step
- keep upstream `../mawkcc` read-only during VM work


## Near-Term Checklist

1. Generate and check in a `../mawkcc/mawkcc_self.c` shared C/JS/AWK subset
   inventory under `jsvm/fixtures/`.
2. Decide final filenames for the VM source, tests, and build script.
3. Create `jsvm_self.c` under `jsvm/`; it may be mechanically derived from
   `../mawkcc/mawkcc_self.c`, but all future edits stay under `jsvm/`.
4. Preserve and test the mawkcc-compatible CLI before changing VM behavior.
5. Implement the subset recognizer, bytecode emitter, and bytecode interpreter
   directly in `jsvm_self.c`.
6. Add the mawkcc-subset C JIT path after bytecode fixtures pass.
7. Add direct JS-to-JIT and JIT-to-JS call fixtures.
8. Add small VM fixtures before attempting the full compiler run.
9. Prove `jsvm_self.c` can emit a byte-identical mawkcc compiler.
10. Add `jsvm/scripts/build-jsvm.sh`.
11. Add `jsvm/scripts/verify-mawkcc-output.sh`.
12. Add the JS VM route to `jsvm/scripts/run-tests.sh` only after it is
    byte-identical.
