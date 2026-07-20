# mawkcc C++ design

This document is the maintainer’s map for the actively developed C++ port.
Read [README.md](README.md) first for build, test, use, and cleanup commands;
use this document when changing compiler behavior or structure. The language
and output contract originate in `../mawkcc`, especially
`../mawkcc/DIALECT.txt`, `../mawkcc/BOOTSTRAP_DIALECT.txt`, and
`../mawkcc/ARCHITECTURE.txt`.

## Non-negotiable invariants

1. `mawkcc.cpp` is the frozen, historical first C++ port. It must remain
   buildable as `mawkcc_cpp_original` and independent of the maintained
   implementation. Do not edit it as part of refactoring the maintained code.
2. `mawkcc_cpp` must compile `../mawkcc/mawkcc_self.c` to an executable that
   is byte-for-byte identical to `../mawkcc/artifacts/mawkcc.self.exe`.
3. Executable and object output are ELF32, little-endian, i386. Host pointer
   size and host `long` size must not become part of the target format.
4. Generated files belong only below `cpp_test/artifacts`. That directory is
   ignored by the repository-root `.gitignore`; its tracked `placeholder`
   keeps the directory present in a clean checkout.
5. Any change to architecture, build/test workflow, component ownership, or
   a compiler invariant must update this document and the relevant concise
   summary in `README.md` in the same commit.

The historical source currently has SHA-256
`a55c74d4098a2c246e536e6fed5354c2e78371d61282764c461fb2d3641fb44e`.
The hash is a convenient accidental-edit check, not a substitute for building
and testing `mawkcc_cpp_original`.

## One-minute orientation

The maintained path is a single-pass recursive-descent compiler with deferred
fixups:

```text
CLI arguments and source file I/O
            |
            v
 mawkcc::compile(source, OutputKind)
            |
            v
        Lexer::next
            |
            v
 Compiler parser + symbol state -----> deferred calls/relocations/data patches
            |                                      |
            v                                      |
       X86Emitter <---------------------------------+
            |
            v
 typed executable/object layout in Elf32Builder
            |
            v
       Elf32Writer
            |
            v
      output stream
```

Parsing and instruction emission happen together. Forward function calls,
absolute data addresses, loop breaks, and object relocations are recorded and
patched once their targets or final layout are known. There is intentionally
no AST or optimizer.

## Build targets and dependency direction

`mawkcc_core` is a static library containing the maintained compiler. The
`mawkcc_cpp` executable adds only the command-line exception boundary.
`mawkcc_cpp_original` compiles only `mawkcc.cpp`; it neither links nor includes
the maintained core.

`build-debug.sh`, `build-release.sh`, and `build-unoptimized.sh` are the
supported convenience entry points. They create independent CMake trees at
`artifacts/debug`, `artifacts/release`, and `artifacts/unoptimized`. The last
configuration explicitly selects `-O0` without inheriting the other semantic
choices CMake associates with its Debug configuration. All three scripts
forward additional arguments to `cmake --build`.

The intended dependency direction is:

```text
mawkcc_refactored_main
          |
          v
mawkcc_refactored (parser and compiler policy)
     |          |              |              |
     v          v              v              v
   Lexer   Symbol/Fixup    X86Emitter    Elf32Builder
              state             \             |
                                 ByteWriter <- Elf32Writer
                                      |
                                 mawkcc_types
```

Lower layers must not depend on parser or symbol-table types. This keeps raw
byte mechanics independently testable and prevents target-format concerns
from leaking into the command-line driver.

## Component contracts

### `mawkcc_refactored_main.cpp`

This is the process boundary. It parses arguments into a typed `CommandLine`,
reads the source, calls `mawkcc::compile`, writes the returned image, reports a
caught `std::exception` on standard error, and returns failure. Language and
target-format work belong in the core; file and terminal concerns stay here.

### `mawkcc_refactored.cpp` and `.hpp`

`Compiler` owns one compilation’s mutable state:

- a borrowed source view, lexer, and current token;
- current parameters and structured `SymbolTable`/`FixupTable` instances;
- static data, typed output mode, and executable patch bookkeeping;
- one `X86Emitter`.

It owns language rules and output-layout policy. The public
`mawkcc::compile(std::string_view, OutputKind)` function constructs a fresh
compiler and returns an owning byte vector; implementation details remain
private to the translation unit.

The compiler resets all per-run collections in `reset_compilation`. Each API
call uses a fresh compiler, and `compiler_api_test` proves deterministic
repeated compilations in one process as well as both output modes and typed
`CompileError` handling. The input view only needs to remain alive for the
duration of the call.

### `compiler_state.hpp` and `.cpp`

`ParameterScope` owns the current function's parameter-to-i386-stack mapping,
and `StaticData` owns runtime storage, string placement, aligned global
allocation, capacity, and ELF32 overflow checks. `SymbolTable` owns global,
function, and external-symbol storage. It
centralizes lookup, duplicate rejection, stable declaration order, and
external deduplication. Its vector accessors are read-only because insertion
must preserve those invariants. `FixupTable` similarly owns pending calls,
ELF relocations, executable data patches, and loop-break patches and exposes
only named insertion operations plus immutable ordered views. Emission order
is observable in byte-identical ELF output, so neither type sorts its records.

### `lexer.hpp` and `.cpp`

`Lexer` borrows the complete source through `std::string_view`; the caller must
keep that source alive. `next` returns an owning `LexToken`, including its
source byte offset for diagnostics. It handles whitespace, line and block
comments, keywords, decimal target words, punctuation, and escaped string
literals.

Lexical failures throw `LexerError` with an offset. The compiler translates
that into its source-context diagnostic. Keep recognition here and grammar
decisions in the parser. `token_name` is the single mapping used to render
human-readable expected/actual token diagnostics.

### `x86_emitter.hpp` and `.cpp`

`X86Emitter` owns the generated text buffer and the exact i386 instruction
templates. Its public operations express the compiler’s small register and
stack vocabulary. Placeholder methods return the offset of a 32-bit relative
operand, not the start of the instruction; `patch_relative` therefore writes
`target - (operand_offset + 4)`.

Raw opcode-byte and word writes are private. The public interface uses
`TargetWord`, `TargetSignedWord`, `ArgumentCount`, and `X86Condition`, checks
relative-branch and stack-range conversions, and exposes named instruction
templates or address-operand placeholders. Parser code must not emit numeric
opcodes directly.

Compiler-specific choices remain above this layer. For example, the compiler
decides whether a global access needs an executable data patch or an ELF
relocation, then asks the emitter to write the opcode and operand. Do not give
the emitter access to symbols or output mode.

Generated function convention:

- i386 cdecl argument order, with callers cleaning the stack;
- `eax` holds expression results;
- `ebp` addresses parameters;
- generated prologues preserve `ebx`, which is used as scratch storage;
- binary builtins normally evaluate/push the first operand, evaluate the
  second into `eax`, and combine it with the saved operand.

### `elf32_writer.hpp` and `.cpp`

`Elf32Writer` owns the final byte image, little-endian byte/half/word writes,
checked forward padding, appending generated code, and transfer of the owned
image to its caller. File/stream output remains exclusively in the CLI. The
`Elf32Builder` owns the semantic format decisions layered above it.

### `elf32_builder.hpp` and `.cpp`

The builder calculates executable placement and owns the complete semantic
ELF32/i386 layout: identification and file headers, load headers, sections,
symbols, relocations, string tables, alignment, and host-size-to-target-range
checks. Its inputs are immutable code/data plus read-only `SymbolTable` and
`FixupTable` views. `Compiler` uses the calculated executable layout to patch
the entry call and absolute data addresses before handing the final bytes to
the builder. Object construction never reaches into parser state.

ELF types, section types, and flags are named target-domain enums. Declaration
and fixup order is preserved because symbol indices and byte identity depend
on it.

Executable mode patches absolute data addresses after code size and data base
are known. Object mode emits `R_386_32` absolute relocations and `R_386_PC32`
call relocations, plus symbols and section tables expected by the reference.
Changing apparently redundant fields or ordering can break byte identity.

### `byte_writer.hpp`

`ByteWriter` is the common checked byte container. It serializes 8-, 16-, and
32-bit little-endian values, bounds-checks patches, and rejects backward
padding. Use it instead of indexing raw output arrays. Out-of-range operations
throw exceptions and are process failures at the CLI boundary.

### `mawkcc_types.hpp`

Target-domain aliases make width assumptions visible:

- `TargetWord` and `TargetSignedWord` are exactly 32 bits;
- `DataOffset`, `ArgumentCount`, and `LoopId` are 32-bit target/domain values;
- `CodeOffset` is a host container offset (`std::size_t`) and must be checked
  before serialization into a target word.

Do not replace these with host `int` or `long`. Prefer adding another named
domain type when a value has different units or overflow rules.

## Front-end behavior

The accepted language is intentionally the bootstrap dialect, not general C.
Top-level declarations are `var name;` and
`function name(parameters) { ... }`. Statements are blocks, expression
statements, returns, conditionals, loops, and `break`. Expressions are decimal
numbers, strings used by literal builtins, parameter/global references and
assignments, grouping, builtin calls, and user calls.

There are no true locals. Bootstrap sources use extra assignable parameters
as local slots. Name resolution checks parameters and globals; forward user
function calls are legal because their call operands are deferred.

Builtin spelling, operation, and arity live together in the `Builtins` table.
Add aliases there rather than another string-comparison chain. `mks` and `mkC`
are parse-time literal operations; other entries dispatch through
`emit_builtin`. Preserve upper-case aliases used by cross-host bootstrap code.

## Errors and safety

Deep compiler code throws `CompileError`, `LexerError`, or a standard
exception. Only the CLI catches and prints. `CompileError` owns the rendered
message and exposes the source byte offset plus one-based line and column; the
message contains a short escaped source excerpt. Diagnostics are built with
`std::string`, not a fixed buffer or C variadic formatting. Do not call `exit`
inside the lexer, emitter, writer, or parser.

Every host-size-to-target-size conversion that can depend on input or emitted
size must go through an explicit range check such as `checked_target_word`.
Intentional two’s-complement instruction immediates are serialized through the
x86 emitter; avoid implementation-defined pointer punning and native-struct
ELF writes.

## Test strategy

The CTest suite has three layers:

1. Unit tests exercise `ByteWriter`, `Lexer`, symbol/fixup/static-data state,
   `X86Emitter`, `Elf32Writer`, `Elf32Builder`, and the in-memory compiler API,
   including repeated compilation and invalid semantic/lexical inputs.
2. `test-cli.sh` covers usage failures, source/output I/O failures, and stdout
   versus `-o` equivalence. `test-runtime.sh` executes representative generated
   i386 programs and checks their exit status.
3. `test-refactored.sh` compares executable bytes for every current example,
   compares representative object output, and checks selected invalid-input
   diagnostics.
4. `verify-self-host.sh` compiles `mawkcc_self.c` with each C++ implementation
   and compares it byte-for-byte with the self-hosted reference executable.

The self-host identity test is the release gate. Unit tests localize failures
but cannot replace it. For changes to parsing or code generation, add the
smallest focused unit/regression case and retain the full identity check.

The optional sanitizer configuration exercises the same suite with Address-
Sanitizer and UndefinedBehaviorSanitizer. All normal and sanitizer build trees
must remain below `cpp_test/artifacts`.

`MAWKCC_DEVELOPER_MODE` promotes the maintained targets' warning set to errors
and enables shadowing, old-style-cast, format, preprocessor, null-dereference,
and floating-promotion audits. The historical target remains buildable but is
deliberately exempt from new style rules so an audit never pressures
maintainers to rewrite the frozen reference.

## Common change recipes

When adding syntax, first update the lexer only if a new token is required,
then extend the recursive-descent parser and add valid/invalid regression
fixtures. When adding a builtin, update the descriptor table, parser handling
only if it has special literal syntax, `emit_builtin`, and the x86 emitter;
then add an emitter unit test and an end-to-end example.

When changing an instruction template, write its expected bytes in
`tests/x86_emitter_test.cpp` before relying on self-host comparison. When
changing ELF output, add a writer unit test for serialization and compare both
executable and object output. Inspect a byte difference before updating any
expected reference: reference output is owned by `../mawkcc`, not this port.

Before committing a maintained-code change, run:

```sh
cmake --build cpp_test/artifacts/build
ctest --test-dir cpp_test/artifacts/build --output-on-failure
git diff --check
```

For boundary, memory-safety, or serialization changes, also run the sanitizer
build documented in `README.md`. Commit coherent milestones only after the
suite is green.

## Known design pressure

`mawkcc_refactored.cpp` still combines recursive-descent parsing with the
policy that maps language operations to x86 operations and fixups. A future
parser/emission-policy split would be reasonable if a second consumer or a
substantial language feature justifies it. Preserve emission order and byte
identity; avoid introducing an AST or generalized backend without such a
concrete requirement.
