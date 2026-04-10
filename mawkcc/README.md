# mawkcc

`mawkcc` is a tiny C compiler written in `awk` and intended to run under
`mawk`.

This version targets real 32-bit x86 Linux executables. It emits a raw
ELF32 binary directly, without invoking an assembler or linker.

Repository status:

- stage0 compiler: implemented in `mawk`
- backend target: ELF32/i386 Linux
- self-hosting: not reached yet; see `BOOTSTRAP.md`

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
  assignment to globals
- source style: the accepted function bodies are chosen to be valid
  inside C, JavaScript, and `awk` with `function` treated as a C type
  name
- arithmetic and logic go through builtin calls such as `add(x, y)` and
  `lt(x, y)`
- memory builtins are available for unsigned 8-bit and signed 32-bit
  reads and writes

Current non-goals:

- full ISO C support
- preprocessing
- variables
- `continue`
- native toolchain integration

Files:

- `cc.awk`: compiler from a tiny C subset to ELF32/i386 Linux
- `BOOTSTRAP.md`: definition of self-hosting for this project and the
  staged path to reach it
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

Builtin set:

- arithmetic: `add`, `sub`, `mul`, `div`, `neg`
- comparisons: `eq`, `ne`, `lt`, `le`, `gt`, `ge`
- logic/bitwise: `and`, `or`, `xor`, `not`
- memory: `ri32`, `wi32`, `ri8`, `wi8`

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
