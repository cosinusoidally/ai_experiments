# Native kernel debugging

The implementation debugs **compiled kernel functions**, not guest JavaScript
bytecode/application variables. The same compiler and IR implement optimized
and `-O0` modes. No external compiler, assembler, linker, Python or npm package
is used to produce the files. GDB and objdump are optional consumers.

Run commands from `mmvm_v2_tests`. Use the existing js_min binary with its
normal `LD_LIBRARY_PATH`; rebuilding it is not needed.

```
node guest_runner.js --vm-native -g -O0 --snapshot artifacts/debug.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/debug.snap artifacts/debug.exe --debug-info artifacts/debug.snap.dbg
gdb --args artifacts/debug.exe hello.js
```

Both build tools also run under js_min and the standalone guest VM. For
example, using an existing bootstrap image:

```
./artifacts/js_runner.exe artifacts/bootstrap.snap guest_runner.js --vm-native -g -O0 --snapshot artifacts/debug.snap
./artifacts/js_runner.exe artifacts/bootstrap.snap guest_vm/tools/snapshot_to_exe.js artifacts/debug.snap artifacts/debug.exe --debug-info artifacts/debug.snap.dbg
```

`-g` requires snapshot output and cannot be combined with `--with-snapshot`.
It records canonical source provenance without changing generated instructions.
`-O0` is independent and may be used without `-g`. Optimization is a build-time
property of the image, not a runtime switch for an already compiled image.
Executables without debug incorporation and ordinary `js_runner` snapshot
loading remain supported. Both packager modes describe exact code/heap ranges
without moving load segments or snapshot bytes. The packager refuses to overwrite an
existing output. Sidecars are never loaded implicitly by the runtime.

## Debugger use and limitations

Start GDB from the source-tree working directory so project-relative paths
resolve. A relocated checkout can instead use GDB's `directory` or
`set substitute-path` commands; the build does not embed its working directory.

```
break interpreterKernel
run
info args
info locals
next
bt
disassemble /s interpreterKernel
```

GDB's scalar view uses C-style expressions and the `kernel_i32` type. This is
the lowered signed 32-bit machine representation, not a JavaScript expression
evaluator or a claim that a guest reference is a native pointer. Use `p/x` for
addresses/offsets. Raw double arithmetic uses x87 expression temporaries and
addressed double cells, not fabricated named double-local stack locations.

At `-O0`, parameters and named locals use authoritative frame-relative stack
homes. Locals have conservative definite-assignment availability ranges;
before assignment or at uncertain control-flow joins they are unavailable.
Debugger edits to an available canonical home affect subsequent native reads.
This may under-report availability after a loop or a branch that cannot return.
It must not show an uninitialized slot as a source value.

Optimized parameters have register or canonical stack locations; tail-frame
replacement ranges are unavailable. Optimized locals use conservative ownership
ranges: reuse invalidates the previous binding, joins intersect ownership, and
loops discard uncertain backedge ownership. Register-resident values use their
actual register (EDX uses its write-through canonical home). Callers containing
inlined early returns currently leave locals unavailable; their full control
flow needs richer lifetime analysis. Inline ranges retain their callee origin
and source call site. Use `-O0` when inspecting or
editing named locals is important. Source stepping is statement-level; several
instructions and inline helpers may correspond to the same statement.

```
objdump -d --disassemble=interpreterKernel artifacts/debug.exe
objdump -S --disassemble=interpreterKernel artifacts/debug.exe
objdump --dwarf=info artifacts/debug.snap.dbg
objdump --dwarf=decodedline artifacts/debug.snap.dbg
```

The sidecar deliberately does not duplicate instruction bytes. Disassemble
the executable, which contains the actual `.text.kernel` section and sized
function symbols. Debug-only sections are not mapped into the running process.

## Implementation and file contract

- `aot/kernel_sources.js` parses canonical project-relative source files and
  structurally validates each graph member against its original AST. Host
  decompiler formatting is not used for original file/line coordinates.
- `aot/kernel_compiler.js` carries statement provenance through lowering and
  transformations. Metadata is excluded from inline eligibility estimates.
- `aot/backend_x86.js` records instruction offsets, function/frame boundaries,
  saved-register CFI events, inline ranges and parameter register allocation.
  Its internal `debugSupport()` accessor loads optional provenance/DWARF modules
  only when requested. Ordinary images do not retain these build-only module
  objects. Self-hosted debug rebuilds load the support sources on demand.
- `aot/kernel_debug_locations.js` computes conservative definite assignment
  and optimized slot ownership and turns emission events into availability
  ranges. Tail-frame teardown excludes both parameter and local locations.
- `aot/kernel_dwarf.js` emits DWARF 4 units, lines, scalar bindings, location
  lists, inline origins and native `.debug_frame` unwind information.
- `aot/debug_binary.js`, `debug_digest.js` and `debug_elf.js` implement binary
  encodings, SHA-256 binding and ELF32 relocatable sidecars, independently of
  Node buffers, host crypto libraries and native build tools.
- `tools/snapshot_exe_io.js` validates the sidecar binding before packaging;
  `snapshot_exe_elf.js` relocates debug addresses without changing PT_LOADs or
  any byte of the embedded snapshot.

Snapshot format v2 reserves header fields for `optimizationMode` (offset 52),
`debugVersion` (56), `debugLength` (60) and the 32-byte sidecar SHA-256 (96).
Named fields live in `aot/standalone_format.js`. Debug binding version 1 hashes
the entire ELF sidecar. Its `.guestvm.debug` section additionally binds the
native instruction SHA-256. Default images leave debug fields zero.

The sidecar is ELF32 i386 ET_REL. A NOBITS `.text` section describes kernel
extent without storing code. R_386_32 relocations refer to its section symbol;
no build-process machine address is retained. The packager relocates these to
the actual kernel virtual address in its fixed-base executable. This also
preserves the option of adding symbols for an mmap-loaded snapshot in GDB;
that convenience workflow is deferred, not an implemented automatic loader.

All ordering and producer metadata are fixed. No timestamps, absolute paths,
output names or debuglink basenames are stored. Debug-enabled snapshots bind
their provenance payload, so instruction equality alone cannot accidentally
select a different sidecar. Snapshot and sidecar are individually written via
the existing temporary-file/rename mechanism, not a two-file atomic transaction;
a failed build must not be treated as a complete artifact pair.

See [the implementation/validation log](kernel-debug-status.md) for completed
checks and remaining acceptance gates, and [the original plan](kernel-debug-plan.md)
for the requested benchmark and reproducibility matrix.

Developer acceptance tools run heavy jobs serially. The artifact driver accepts
`--build-only`, `--all-hosts`, `--directory artifacts/NAME` and `--resume-builds`.
Resume verifies a recorded SHA-256 of project JavaScript source contents as
well as every reused snapshot/sidecar hash. It rejects changed sources and old
reports without a source identity. The three supervisory debug/benchmark driver
scripts are excluded from that identity; production builder/packager sources
are included. Symlinked source trees are rejected by this developer check,
not by the production build tools. No executable instructions are loaded from
a build cache, and every newly requested self-hosted build runs compilation.

For executable consumer checks, run:

```sh
node guest_vm/tools/check_kernel_debug_gdb.js artifacts/BUILD_DIRECTORY --core
```

This expects the artifact driver's `node-g`/`node-g-o0` image pairs and
`debug.exe`. It temporarily unlinks both snapshot/sidecar pairs, runs GDB
and objdump checks against the executables, then restores and verifies inputs
in `finally`. Use only disposable generated artifacts: interruption by machine
failure cannot execute restoration. `--core` additionally runs the core suite
and bounded GC workload serially under both policies. Without it, only the
debugger checks run. JSON receipts are `exe-debug-acceptance-core.json` and
`exe-debug-acceptance.json`, respectively, within that artifact directory.
Both executable hashes must remain unchanged. See the
[final executable acceptance report](kernel-debug-exe-acceptance.md).
