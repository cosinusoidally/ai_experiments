# JSVM — ANSI C / JavaScript bootstrap edition

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

The three bootstrap paths:

    ./jsvm -c jsvm.js -o jsvm.bc
    ./jsvm jsvm.js -c jsvm.js -o jsvm2.bc
    ./jsvm -b jsvm.bc -c jsvm.js -o jsvm3.bc
    cmp jsvm.bc jsvm2.bc
    cmp jsvm.bc jsvm3.bc

All three were run successfully. They produced exactly 223355 bytes each,
with SHA-256:

    9c9a1a87d04adf841effc39cf656edeafda8b9a901f705119af3c8beeef7b735

The original measured source-hosted and bytecode-hosted compilation times
were 12.94 s and 13.22 s, respectively. Peak RSS was about 142 MiB in both
cases. These are measurements on one Linux x86-64 machine, not performance
claims for other systems. The actual three outputs and logs are included
under `verification/`. The final standalone C translation unit was rebuilt
and its native compiler output checked against those recorded outputs.

Optional: `sh verify.sh` rebuilds, repeats the bootstrap comparison, and runs
execution regressions, including a small guest program under both source-
and bytecode-loaded JavaScript VM. The shell script is not needed to build
or run the VM. The `verification/` files are test evidence, not dependencies.

When arguments follow a source script and include an option beginning with
`-`, the full remaining argument list is passed in the global `scriptArgs`
array. With `-b`, every argument after the bytecode path is passed to the
loaded script. Ordinary successive source filenames without options retain
the previous multi-file evaluation behavior. This standalone CLI requires
an explicit filename (unlike the old CLI's no-argument stdin mode).

## Host services

The C CLI supplies `readFile(path)`, `writeHexFile(path, hexBytes)` and
`byteCharHost(n)`, plus `scriptArgs`. The JS compiler independently lexes,
parses, emits instructions and serializes its own function tree. The hex
string passed to the file-writing primitive is a transport representation
only: output files contain raw binary bytes. There is no native compiler
callback and neither `eval` nor `Function` is used for execution. These
host services are available to scripts in the native CLI; they are not
a complete OS API for arbitrary depths of guest interpreters.

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

The opcode numbering and function metadata are unchanged from the original
VM. The file format is a serialized function tree, not a dump of `Ins`
structures. The loader reconstructs the existing in-memory representations.
The C loader rejects bad magic, truncation, unknown value tags, some invalid
operands/counts, and trailing bytes; it is not a comprehensive bytecode
verifier. Its per-record count/length limit is 1,000,000 and its nested
function limit is 512. The JS loader has similar count/nesting limits but
less comprehensive validation. Only load trusted bytecode. The VM also
exposes file I/O in the CLI and is not a sandbox for untrusted scripts.

## Scope and limitations

This is still the original compact ES5-style subset, not a full ES5.1
implementation. The bytecode and language semantics have not been changed
beyond adding portable serialization, loading, and CLI services. Existing
limitations include byte-oriented strings, no regular expressions, JSON,
strict mode, eval or Function constructor, no finally, and incomplete
standard-library and coercion semantics. The successful bootstrap verifies
compiler agreement on the VM source; it is not proof of equivalence for
all ES5.1 programs, all numeric inputs, or all platforms. No independent
cross-architecture or full Test262 run was performed. The codec's raw byte
string model is aligned with the C VM rather than ECMAScript UTF-16.
