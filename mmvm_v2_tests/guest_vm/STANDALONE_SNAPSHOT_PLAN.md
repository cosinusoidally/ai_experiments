# Standalone guest VM snapshot plan

## Goal

Produce a 32-bit x86 Linux snapshot that can be loaded by a deliberately small
ANSI C launcher and can execute a JavaScript source file without support from
`js_min.exe` or another JavaScript host:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --snapshot artifacts/snap hello.js

gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl

./artifacts/js_runner.exe ./artifacts/snap hello.js
```

The C launcher may load/map the image, pass `argc` and `argv`, supply the
address of `dlsym`, transfer control to the image entry point, and return its
status. It must not implement guest allocation, parsing, JavaScript semantics,
GC, filesystem operations, FFI dispatch, or any other VM service.

The eventual fixed-point test is stronger:

```sh
./artifacts/js_runner.exe artifacts/snap guest_runner.js --vm-native \
  --snapshot artifacts/snap2 hello.js
cmp artifacts/snap artifacts/snap2
```

`snap2` must be independently serialized by the snapshot-hosted runtime. It
must not be produced by merely copying the input image.

## Non-goals and constraints

- Do not change MMVM or Firefox C sources.
- Preserve the existing Node and `js_min.exe` guest paths throughout.
- Keep the existing code-only snapshot format readable until its replacement
  has equivalent tests; introduce a new image format/version for standalone
  images.
- Do not fix the guest heap or executable mapping at a predetermined virtual
  address. ASLR and arbitrary available mappings must remain valid.
- Do not serialize process-local pointers, libc addresses, timestamps, PIDs,
  GC marks, nondeterministic cache state, or uninitialized padding.
- Resolve operating-system services from the one supplied `dlsym` address.
- Keep generated i386 code in the macro assembler/compiler pipeline. Do not
  embed opaque machine-code byte strings in JavaScript or C.
- Use Linux interfaces available in the Linux 2.4 era where practical.
- Keep temporary images and executables under ignored `artifacts/`.

## Current checkpoint

As of 2026-09-14, implementation stage 2 is working. The version-2 image
contains a position-independent macro-assembled bootstrap, expected program
name, relocatable native interpreter text, prepared guest frame/context, and a
canonical guest heap template. The exact requested command prints
`Hello, world!` and exits zero. Independently generated images are byte-for-byte
identical, and the version-2 container remains readable through the existing
`--with-snapshot` js_min path.

The older version-1 format is a 32-byte header followed by relocatable native
interpreter text. It remains readable for compatibility. Its internal entry
ABI takes VM implementation arguments:

```text
heap base, frame, context, array-length key, array prototype,
runtime-support vector, instruction budget, engine state
```

Repeated generation of this code-only image is already deterministic. Two
215479-byte images generated on 2026-09-14 were byte-identical and had SHA-256
`59cf54b8d65c1d85ceed5698333a746c43413ea1d685f4a01f99b38903a4d119`.
The hash is evidence for deterministic code emission, not a permanent golden
file and not a substitute for the full fixed-point test.

The stage-2 bootstrap currently accepts the single completed native return
needed by `hello.js`; it does not yet implement allocation-exit recovery, GC,
heap growth beyond the reserved mapping, exceptions, budget resumption, or
general source loading. Those lifecycle items, followed by self-hosted image
generation, are the principal remaining work.

## External launcher ABI

The image exposes a position-independent entry point equivalent to:

```c
int snapshot_entry(int argc, char **argv, void *dlsym_address);
```

The header stores an entry offset, never an absolute function pointer. The
launcher maps the image, computes `mapping + entry_offset`, and calls it with
the arguments following the snapshot filename. The image owns argument
conversion and all subsequent execution.

For the first bring-up checkpoint the entry may execute precompiled
`hello.js`; later it must treat `argv[0]` as the source program and expose the
remaining values as that program's arguments.

## Standalone image format

Use a versioned container with explicit, bounds-checked offsets and lengths:

```text
header
  magic, format version, architecture, ABI version
  total image length and checksum
  entry offset
  RX code offset/length
  read-only data offset/length
  writable heap template offset/length
  boot metadata offset/length
  external-binding table offset/count

RX code
  entry/bootstrap routine
  native bytecode interpreter and helpers
  allocator, collector, direct FFI trampoline

heap template
  runtime roots and built-ins
  interned strings
  runtime support vector
  initial context/program/frame or boot program

boot metadata
  heap root offsets, initial limits, program/context offsets
  slots that must be rebound at process startup
```

All in-image references are segment-relative offsets or guest-heap offsets.
At startup the image allocates a writable heap at any address, copies or maps
the canonical template, installs the supplied `dlsym`, resolves required libc
symbols into cleared platform slots, and enters the native VM loop.

## Deterministic serialization rules

- Emit functions, constants, strings, properties, and roots in stable order.
- Use stable bytecode register allocation and macro-assembly layout.
- Zero header reservations, alignment padding, unused cell fields, caches,
  scratch cells, GC marks, and free-record payload bytes.
- Serialize offsets rather than executable, heap, Buffer-data, or libc
  pointers.
- Rebind native pointers after mapping and before guest execution.
- Canonicalize allocator/free-list state at the snapshot boundary.
- Use a defined snapshot phase: runtime built-ins and boot program installed,
  no application execution in progress, no pending host operation.
- Hash exactly the canonical bytes covered by the format, with the checksum
  field itself defined as zero during hash calculation.

## Implementation stages

### 1. Minimal C loader and native entry — complete

Add `js_runner.c` and a standalone header parser. The loader validates all
offset/length arithmetic, maps executable memory, and passes only `argc`,
`argv`, and `dlsym`. Initially exercise a compiler-generated entry that
resolves `puts`, prints a fixed diagnostic, and returns. This validates the
external ABI and position independence but is not accepted as the hello goal.

### 2. Precompiled hello boot image — complete

Extend snapshot generation with a canonical heap template containing the
runtime support required by precompiled `hello.js`. Add a native boot loop
that binds platform services, restores runtime root offsets, and executes the
initial frame entirely in native code. The accepted output is exactly
`Hello, world!`; no hard-coded hello or renderer/application intrinsic is
permitted.

This is the requested first end-to-end milestone:

```sh
./artifacts/js_runner.exe ./artifacts/snap hello.js
```

The filename must be checked against or used to select the snapshotted program;
the runner must not ignore it and print a built-in string.

The implemented bootstrap resolves `strcmp` through the supplied `dlsym` to
check that filename, rebinds the heap's named dlsym capability cell, and calls
the real native bytecode interpreter with the serialized guest offsets. All
process-local platform pointers are cleared while copying the heap and restored
in the still-running js_min instance afterwards. The file includes only the
initialized heap prefix. The bootstrap resolves `mmap` and `memcpy` through the
supplied `dlsym`, creates a zero-filled anonymous heap reservation, and copies
the compact template into it before entering the interpreter. Heap capacity
therefore does not inflate the snapshot file or constrain its load address.

### 3. Native runtime lifecycle

Keep allocation failure, free-region selection, collection, heap growth,
exception propagation, context teardown, and instruction-budget resumption
inside the standalone entry loop. Remove dependence on JavaScript-side frame
synchronization and weak-metadata cleanup. Platform calls use heap-resident
request/result records or direct trusted FFI as appropriate.

### 4. Self-hosted loading and front end

Implement filesystem loading through guest/native libc calls. Run the
regexp-free tokenizer, ES5.1 parser, bytecode compiler, and verifier as guest
programs using guest heap objects. A standalone image must then load arbitrary
supported source rather than only its precompiled bootstrap program.

### 5. Guest-side image creation

Move image canonicalization and serialization into the snapshot-hosted VM.
Resolve `open`, `write`, `close`, `rename`, and related operations through
`dlsym`. Never serialize rebound process addresses.

### 6. Fixed-point reproduction

Generate `snap` under js_min, boot it with `js_runner.exe`, independently
generate `snap2`, and require byte identity. Run the comparison with ASLR and
with deliberately different available mapping addresses to catch hidden
absolute pointers.

## Regression gates

Every stable checkpoint must keep these paths working:

1. `guest_vm/tests/run_tests.sh both`.
2. `hello.js`, `net.js`, and `node_web.js` through the existing guest runner.
3. Demo help/compile checks already in the suite.
4. Exact demo8 native startup at its default viewport:

   ```sh
   LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
     ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
     demo8_runner.js demo8.js
   ```

5. Snapshot generation and existing `--with-snapshot` loading while the
   code-only format remains supported.
6. Standalone images at varying mapping addresses once the C runner exists.

No demo source may be altered to accommodate the standalone runtime. A failure
in any previously passing gate is fixed before the next checkpoint is committed.

## Acceptance criteria for the first standalone milestone

- `js_runner.c` builds using exactly `gcc -ansi -m32 ... -ldl`.
- The C source contains only image loading/validation/mapping, ABI transfer,
  cleanup, and exit-status handling.
- `js_runner.exe` supplies no VM semantic or platform wrapper beyond `dlsym`.
- The image is load-address independent.
- `./artifacts/js_runner.exe ./artifacts/snap hello.js` prints exactly
  `Hello, world!` and exits zero.
- `hello.js` is executed as guest bytecode; the output is not hard-coded in
  the C runner or native bootstrap.
- Existing Node and js_min guest execution, tests, and demos do not regress.
