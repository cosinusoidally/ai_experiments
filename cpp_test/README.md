# mawkcc C++ port

This directory contains two independent C++17 implementations of `mawkcc`:

- `mawkcc.cpp` is the frozen historical port and remains buildable as
  `mawkcc_cpp_original`.
- the actively maintained implementation is split into focused components and
  builds as `mawkcc_cpp`.

The historical file is deliberately frozen: the maintained implementation
does not include it, link it, or generate code from it. This keeps the first
working port available as a buildable reference while allowing the new code
to evolve independently.

Both accept the same restricted input language and emit the same ELF32/i386
executable or relocatable-object bytes as the implementations in `../mawkcc`.

New maintainers should use this README for daily commands, then read
[DESIGN.md](DESIGN.md) before changing compiler behavior or architecture. The
design document records invariants, component contracts, data flow, target
conventions, test strategy, and safe extension points.

## Prerequisites

- CMake 3.16 or newer
- a C++17 compiler (tested with `g++`)
- the self-hosted reference executable at
  `mawkcc/artifacts/mawkcc.self.exe`

If the reference executable is missing, build it from the `mawkcc` directory:

```sh
cd mawkcc
scripts/build-mawkcc-self.sh
cd ..
```

## Build

From the `ai_experiments` repository root:

```sh
cmake -S cpp_test -B cpp_test/artifacts/build
cmake --build cpp_test/artifacts/build
```

This produces both `cpp_test/artifacts/build/mawkcc_cpp` and
`cpp_test/artifacts/build/mawkcc_cpp_original`. The ignored `artifacts`
directory contains all generated files.

Three convenience scripts configure and build separate trees beneath
`artifacts`:

```sh
cpp_test/build-debug.sh
cpp_test/build-release.sh
cpp_test/build-unoptimized.sh
```

They produce `artifacts/debug`, `artifacts/release`, and
`artifacts/unoptimized`, respectively. Arguments are forwarded to
`cmake --build`, so a parallel build can be requested with, for example,
`cpp_test/build-release.sh -j 4`. `Debug` follows CMake's debug configuration
(including debug information), `Release` enables the toolchain's release
optimizations, and `Unoptimized` explicitly uses `-O0` without otherwise
selecting the Debug configuration.

The normal build enables strict warnings. An optional sanitizer build can be
created in a separate directory under `artifacts`:

```sh
cmake -S cpp_test -B cpp_test/artifacts/sanitize \
  -DMAWKCC_ENABLE_SANITIZERS=ON
cmake --build cpp_test/artifacts/sanitize
ctest --test-dir cpp_test/artifacts/sanitize --output-on-failure
```

Maintained code can be audited with additional warnings promoted to errors;
the frozen historical target is intentionally exempt from style diagnostics:

```sh
cmake -S cpp_test -B cpp_test/artifacts/developer \
  -DCMAKE_BUILD_TYPE=Debug -DMAWKCC_DEVELOPER_MODE=ON
cmake --build cpp_test/artifacts/developer
ctest --test-dir cpp_test/artifacts/developer --output-on-failure
```

## Test

Run the complete port test through CTest:

```sh
ctest --test-dir cpp_test/artifacts/build --output-on-failure
```

CTest runs both C++ compilers on `../mawkcc/mawkcc_self.c`, then compares each
emitted executable byte-for-byte with
`../mawkcc/artifacts/mawkcc.self.exe`. If the reference is absent, the test
stops and tells you how to build it.

It also runs focused tests for the checked byte writer, lexer, x86 encoder,
compiler state, ELF image writer and semantic builder, in-memory API,
command-line behavior, representative example programs, generated i386
runtime behavior, object-file output, and invalid-input diagnostics.

To run the same verification script directly:

```sh
cpp_test/verify-self-host.sh cpp_test/artifacts/build/mawkcc_cpp
```

The verification script creates a unique directory below
`cpp_test/artifacts` and removes that test directory automatically on exit.
To clear every generated CMake and test artifact, run:

```sh
cpp_test/empty-artifacts.sh
```

The script removes generated content inside `cpp_test/artifacts` and then
recreates the tracked `placeholder` file. Ignore rules for this directory
live in the repository-root `.gitignore`. Re-run the build commands above
afterward to regenerate the compiler.

## Use

The command-line interface matches mawkcc:

```sh
cpp_test/artifacts/build/mawkcc_cpp source.c -o program.exe
cpp_test/artifacts/build/mawkcc_cpp -c source.c -o source.o
```

## Maintained implementation

The refactored compiler is organized around small ownership boundaries:

- `mawkcc_refactored_main.cpp` owns command-line parsing and file I/O, then
  reports exceptions at the process boundary.
- `mawkcc_refactored.cpp` owns parsing, symbols, relocations, and compilation
  policy; `mawkcc_core` exposes an in-memory `mawkcc::compile` API independently
  from the executable driver.
- `compiler_state.hpp` and `compiler_state.cpp` own parameter scope, aligned
  static data, typed symbol records, duplicate-safe symbol lookup, and deferred
  call/relocation/data/break fixups.
- `lexer.hpp` and `lexer.cpp` own source traversal and token construction.
- `x86_emitter.hpp` and `x86_emitter.cpp` own i386 instruction bytes and
  relative-branch patching through typed target words and condition codes.
- `elf32_writer.hpp` and `elf32_writer.cpp` own checked little-endian output
  serialization.
- `elf32_builder.hpp` and `elf32_builder.cpp` own typed executable/object
  layout, ELF headers, sections, symbols, relocations, string tables, and
  target-range validation.
- `byte_writer.hpp` provides bounds-checked byte storage and patching.
- `mawkcc_types.hpp` distinguishes target words, code offsets, data offsets,
  argument counts, and loop identifiers.

The public API accepts a `std::string_view` plus a typed `OutputKind` and
returns the complete output as `std::vector<std::uint8_t>`. This makes the core
usable without files or synthetic command-line arguments and permits repeated
compilations in one process.

`CompileError` reports an owning diagnostic message together with the source
byte offset and one-based line and column.

C++17 is used because it provides the vocabulary this small compiler needs
(`std::string_view`, `std::optional`, and `std::from_chars`) while remaining
widely available in the stated CMake 3.16 and `g++` environment. Newer
language modes would not currently simplify the implementation enough to
justify raising the toolchain requirement.

`DESIGN.md` is the authoritative maintainer guide for the maintained C++
implementation. Keep its component contracts and this README’s shorter file,
build, and test summaries synchronized with code changes.
