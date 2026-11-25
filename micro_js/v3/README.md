# JSVM — braced self-hosted edition

## Build

    gcc -std=c90 -pedantic-errors -Wall -Wextra -O2 jsvm.c -lm -o jsvm

`jsvm.c` is the complete standalone C translation unit. `js.h` is an optional
copy of the public API declarations, not a build dependency. `jsvm.js` is the
checked-in faithful JavaScript port (same opcodes and guest structures).
No Python, Node.js, generator, Makefile, or other build step is required.
The engine uses C90 and the C standard library; the bytecode format assumes
8-bit bytes, at least 32-bit integers and IEEE binary64 doubles.

## Command line

    ./jsvm program.js
    ./jsvm -c program.js -o program.bc
    ./jsvm -b program.bc

Four bootstrap paths:

    ./jsvm -c jsvm.js -o jsvm.bc
    ./jsvm jsvm.js -c jsvm.js -o jsvm2.bc
    ./jsvm -b jsvm.bc -c jsvm.js -o jsvm3.bc
    ./jsvm jsvm.js jsvm.js -c jsvm.js -o jsvm4.bc
    cmp jsvm.bc jsvm2.bc
    cmp jsvm.bc jsvm3.bc
    cmp jsvm.bc jsvm4.bc

The last command uses two interpreted JavaScript VM levels: the C VM
executes the first JS VM, which compiles and executes the second JS VM,
which independently compiles the source and serializes its bytecode.
Neither interpreter delegates compilation to a host native compiler.
The JBC1 record encoding remains unchanged, but this release gives opcode 20
(older versions reserved it as INIT) a dense integer switch dispatch meaning,
and NAME operands may carry local-slot hints. Older executors are not promised
to accept newer bytecode. All four outputs from this release must agree.

Optional: `sh verify.sh` rebuilds and runs all four bootstrap paths,
bytecode comparisons and execution regressions. The shell script is not
needed to build or run the VM. The `verification/` files are test evidence,
not dependencies. See `verification/results.txt` for measured results.

When arguments follow a source script and include an option beginning with
`-`, the full remaining argument list is passed in the global `scriptArgs`
array. With `-b`, every argument after the bytecode path is passed to the
loaded script. Ordinary successive source filenames without options retain
the previous multi-file evaluation behavior. This standalone CLI requires
an explicit filename (unlike the old CLI's no-argument stdin mode).

## Host services

The CLI provides generic binary I/O, byte conversion and an argument array.
The JavaScript CLI forwards these functions as native guest callbacks at
each nesting level, and forwards the remaining arguments as `scriptArgs`.

| Function | Behaviour |
|---|---|
| `fopen(path, mode)` | `rb` or `wb`; numeric handle, or zero if open fails |
| `fclose(fd)` | Close; returns C status (zero on success) |
| `fgetc(fd)` | Read byte 0–255, or -1 at EOF |
| `fputc(byte, fd)` | Write byte 0–255; returns byte or -1 on error |
| `fread(fd, count)` | Read up to count bytes as a length-aware string; empty at EOF; max count 1 MiB |
| `fwrite(fd, bytes)` | Write exactly the supplied string bytes (including NUL); returns number written |
| `readFile(path)` | Convenience whole-file binary read |
| `byteCharHost(byte)` | Convert byte 0–255 to one-byte string |

Handles are CLI-owned numeric slots (up to 64 open files); invalid handles
and invalid arguments raise a host callback error. All remaining streams
are closed when the native CLI exits. This is deliberately not a sandbox.
The JavaScript interface to `fread`/`fwrite` is length-aware and differs
from the C pointer/count API. File handles are forwarded unchanged through
all interpreter levels. `writeHexFile` has been removed.

The JS serializer writes binary strings directly in buffered chunks of
approximately 4 KiB. This preserves embedded NULs and every byte value.
The JS compiler independently lexes, parses, emits instructions and
serializes its own function tree. There is no native compiler callback,
and neither `eval` nor `Function` is used for guest execution.

## Execution optimizations

The engine remains a single-pass compiler and stack interpreter, with
explicit guest objects, lexical environments, reference values, and
mark-and-sweep collection. The C and JS compilers independently implement
the same language and instruction semantics. Key changes since the
previous optimized release:

- C tagged values use a tagged union with an index field for local and
  numeric references (16 bytes on the tested x86-64 ABI, formerly 24).
- Local variable slots and safe reuse of non-captured activation
  environments reduce repeated lexical lookups and allocations.
- Numeric references to arrays retain the array and integer index, rather
  than allocating reference cells and converting indices to strings.
  References remain valid across RHS evaluation, GC and array resizing.
- Dense array buffers start at four slots, grow geometrically, preserve
  holes and fall back to the hash table for sparse/named properties.
- Both compilers emit direct dispatch for suitable dense integer switches;
  general switch statements retain strict-equality comparison chains.
- The JS VM uses named fields for the VM, function, parser, lexer, frame,
  handler and other control records. Values, instructions and managed heap
  records retain compact dense arrays, with symbolic field indices declared
  at the top of `jsvm.js`. Long dense record constructors annotate their
  fields. There are no raw numeric record offsets. Literal cases in dense
  switches have enum-name comments so the existing jump-table optimization
  continues to apply. These are representations of guest structures, not
  substitutions of host JavaScript's compiler or object semantics.
- Shared immutable small-number records and bounded short-string caches
  reduce repeated allocations. The JS short-string cache is discarded at GC;
  the C short-string cache is weak and cleared before sweep.
- The original 8192-cell GC threshold offset is retained. Physical memory
  for the JS port is still reclaimed by its host VM, in addition to the
  explicit guest mark-and-sweep traversal.
- The C CLI shares execution, teardown and binary stream code instead of
  duplicating it. The implementation was 2997 physical lines before enforcing braces on
  all control bodies. No implementation logic has changed in this revision.

Both files are shipped as standalone source; no generation step is needed.

## Formatting revision

- Every conditional and loop body is braced. Conventional `else if` chains
  are retained; their individual bodies are always braced. This includes
  `do` loops and `for...in` loops.
- Existing expression parentheses in C are preserved. The JavaScript source
  was regenerated using the previous formatting pipeline with the removal
  of parenthesized expressions disabled. The resulting JS syntax tree
  contains 450 parenthesized expressions, versus 50 in the preceding release.
- Independent statements are not packed onto individual lines. No artificial
  line compression was used to reach a line-count goal.
- C: 3688 physical lines (previously 2997); JS: 3548 (previously 3212).
  The C source therefore exceeds the earlier 3000-line target. Achieving
  that target with this brace policy requires real code reduction.
- The same GCC C90 optimized build produces an identical executable to the
  preceding Readable Edition. The compiled JS bytecode is also identical to
  the preceding edition (268859 bytes). This revision is formatting-only,
  not a change to compiler or execution behavior.
- The earlier fully named-object and symbolic-switch experiments are not
  shipped in this formatting revision. Named field indices and annotated
  dense opcode cases are retained from the Readable Edition.

See `verification/results.txt` for actual measurements and test coverage.
The measured timings are specific to this execution environment.

## JBC1 binary format

The format contains no process pointers, C structure padding, addresses,
source paths, timestamps or platform-native integer or double dumps.
The same compiler output is encoded deterministically in the following
order. All words are four-byte little-endian values. Signed operands and
exponents use two's complement. Counts are nonnegative words.

    4 bytes: ASCII JBC1
    function record

A function record contains:

    value: name (undefined for top-level or anonymous function)
    word: parameter count
    word: variable count
    word: hoisted function count
    word: exception handler count
    word: instruction count
    parameter names (values)
    variable names (values)
    hoisted functions (each: name value, then nested function record)
    exception handlers (each: start, end, target, finish, iter words,
                         followed by catch name value)
    instructions (each: opcode byte, operand word, value;
                  a CLOSURE instruction adds a nested function record)

Values begin with a tag byte (0 undefined, 1 null, 2 boolean, 3 number,
4 string). Undefined/null have no payload. Boolean has one byte, 0 or 1.
String has a word length followed by exactly that many raw bytes, including
embedded NULs. Number has a class byte (0 nonnegative finite, 1 negative
finite, 2 +infinity, 3 NaN, 4 -infinity). Finite numbers have an additional
three words: signed binary exponent e, high 32 bits of integer mantissa M,
low 32 bits of M. Their magnitude is M * 2^(e-53). Nonzero finite numbers
are normalized to 2^52 <= M < 2^53. Zero is encoded with exponent and
mantissa zero. This preserves finite binary64 magnitudes without relying on
native floating-point byte layout, and canonicalizes NaNs and signed zero.
Source negative zero is represented by a unary minus instruction.

The original opcode numbering and function metadata are retained, with
opcode 20 now used for dense switch dispatch and NAME using an optional
local-slot hint. The internal AREF value tag is never serialized. The file format is a serialized function tree, not a dump of `Ins`
structures. The loader reconstructs the existing in-memory representations.
The C loader rejects bad magic, truncation, unknown value tags, some invalid
operands/counts, and trailing bytes; it is not a comprehensive bytecode
verifier. Its per-record count/length limit is 1,000,000 and its nested
function limit is 512. The JS loader has similar count/nesting limits but
less comprehensive validation. Only load trusted bytecode. The VM also
exposes file I/O in the CLI and is not a sandbox for untrusted scripts.

## Scope and limitations

This is still the original compact ES5-style subset, not a full ES5.1
implementation. The language subset remains essentially unchanged; the
execution, compiler and CLI optimizations are described above. Existing
limitations include byte-oriented strings, no regular expressions, JSON,
strict mode, eval or Function constructor, no finally, and incomplete
standard-library and coercion semantics. The successful bootstrap verifies
compiler agreement on the VM source; it is not proof of equivalence for
all ES5.1 programs, all numeric inputs, or all platforms. No independent
cross-architecture or full Test262 run was performed. The codec's raw byte
string model is aligned with the C VM rather than ECMAScript UTF-16.
