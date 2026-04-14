# mawkcc

`mawkcc` is a tiny C compiler written in `awk` and intended to run under
`mawk`.

This version targets real 32-bit x86 Linux. It can emit a raw ELF32
executable directly, without invoking an assembler or linker, and can
also emit a small ELF32 relocatable object for linking with `gcc -m32`.

Repository status:

- stage0 compiler: implemented in `mawk`
- backend target: ELF32/i386 Linux executables and relocatable objects
- self-hosting: reached through `mawkcc_self.c`; see `SELFHOST.txt`

Current implemented scope:

- input program shape: a list of function definitions
- function syntax: `function name(arg1, arg2) { ... }`
- all function arguments are implicit 32-bit integers
- global syntax: `var name;`
- global declarations are file-scope only and cannot have initializers
- accepted statements: blocks, expression statements, `return expr;`,
  `if` / `else if` / `else`, `while`, and `break;`
- accepted expressions: decimal integer literals, parameter references,
  global references, grouping, builtin calls, user-function calls, and
  assignment to globals and parameters
- source style: the accepted function bodies are chosen to be valid
  inside C, JavaScript, and `awk` with `function` treated as a C type
  name
- arithmetic and logic go through builtin calls such as `add(x, y)` and
  `lt(x, y)`
- memory builtins are available for unsigned 8-bit and signed 32-bit
  reads and writes
- `brk(n)` allocates `n` bytes from the process break and returns the
  base address of the allocated block
- file I/O builtins map directly to Linux i386 syscalls and operate on
  numeric file descriptors plus NUL-terminated path buffers in memory
- `mks("...")` materializes a NUL-terminated string and returns its
  address
- `_start` now calls `main(argc, argv)` using C-style process startup
  arguments
- object output exports generated functions as i386 ELF symbols that can
  be linked with GCC-built 32-bit objects
- object output can call functions supplied by other object files and
  can read/write 32-bit integer variables declared with `var name;`
- generated function calls use the i386 System V cdecl argument order

Current non-goals:

- full ISO C support
- preprocessing
- variables
- `continue`
- full native toolchain integration beyond the current simple object
  output mode

Local-variable convention:

- the compiler still does not implement true locals
- to simulate locals, write an internal worker function whose parameter
  list includes both real arguments and extra slots for locals
- expose a wrapper that supplies zero values for those extra slots

Example:

```c
function foo_(a, b, tmp1, tmp2) {
    tmp1 = add(a, b);
    tmp2 = mul(tmp1, 2);
    return tmp2;
}

function foo(a, b) {
    return foo_(a, b, 0, 0);
}
```

This is a coding convention for bootstrap-oriented source. The compiler
still does not implement true local declarations, but parameter
assignment makes the convention usable.

Files:

- `cc.awk`: compiler from a tiny C subset to ELF32/i386 Linux
- `ARCHITECTURE.txt`: maintainer-oriented guide to the compiler
  implementations, pipeline, invariants, and build routes
- `SELFHOST.txt`: current self-hosting status and build routes
- `BOOTSTRAP.md`: original staged bootstrap notes
- `examples/ret42.c`: minimal sample program
- `tests/test_ret42.sh`: minimal regression test for the first example
- `artifacts/`: persistent test compilation outputs
- `scripts/empty-artifacts.sh`: empties `artifacts/`
- `scripts/run-tests.sh`: runs all shell tests in `tests/`

Usage:

```sh
mawk -f cc.awk examples/ret42.c > ret42
chmod +x ret42
file ret42
```

Object output:

```sh
mawk -v format=obj -f cc.awk source.c > source.o
cc -m32 -c driver.c -o driver.o
cc -m32 -no-pie driver.o source.o -o linked-program
```

In object mode, `var name;` emits a 32-bit common object symbol. This
lets generated objects provide their own global storage while still
allowing a strong definition from another object file to satisfy the same
symbol at link time. Undefined function calls are emitted as external
`R_386_PC32` relocations, and integer loads/stores use `R_386_32`
relocations. Function arguments are pushed right-to-left and read at
standard cdecl stack offsets, so mawkcc-generated objects can call and be
called by GCC-built i386 code.

Self compiler executable:

```sh
mawk -f cc.awk mawkcc_self.c > artifacts/mawkcc.exe
chmod +x artifacts/mawkcc.exe
artifacts/mawkcc.exe -c mawkcc_self.c > artifacts/mawkcc_self.self.o
```

Executable output places its data segment after the final generated code, so
large compiler executables do not need a manually supplied code-page size.

The C reference implementation must also be built as a 32-bit ANSI C
program:

```sh
cc -ansi -m32 -g -O0 mawkcc_orig.c -o artifacts/mawkcc_orig
artifacts/mawkcc_orig source.c > source-standalone
artifacts/mawkcc_orig -c source.c > source.o
```

Builtin set:

- arithmetic: `add`, `sub`, `mul`, `div`, `neg`
- comparisons: `eq`, `ne`, `lt`, `le`, `gt`, `ge`
- logic/bitwise: `and`, `or`, `xor`, `not`
- memory: `ri32`, `wi32`, `ri8`, `wi8`
- heap allocation: `brk`
- file I/O: `open`, `read`, `write`, `close`
- strings: `mks`

Memory builtins operate on absolute addresses. Globals compile to fixed
absolute addresses in the writable data region, and `brk` returns
absolute addresses in the process heap.

Example source:

```c
var answer;

function times(a, b) {
    return mul(a, b);
}

function main() {
    answer = times(6, 7);
    return answer;
}
```

The resulting executable is an ELF 32-bit LSB Linux binary whose
process exit status is the returned value, modulo normal shell
truncation.
