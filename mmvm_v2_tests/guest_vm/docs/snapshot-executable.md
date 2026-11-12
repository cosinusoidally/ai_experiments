# Packaging a standalone snapshot as an executable

Optional DWARF incorporation uses `--debug-info INPUT.snap.dbg`. See
[kernel-debugging.md](kernel-debugging.md) for `-g`/`-O0`, debugger use,
binding validation and variable-availability limitations. Omitting this option
preserves the ordinary executable layout.

`guest_vm/tools/snapshot_to_exe.js` wraps an existing version-2 standalone
snapshot in an i386 ELF executable. It does not compile the VM, regenerate its
snapshot, or specialize it for a program. No compiler, linker, binutils, crt
objects, development libraries, npm packages, or downloads are needed.

Run from `mmvm_v2_tests`, using any of these hosts:

```
node guest_vm/tools/snapshot_to_exe.js artifacts/bar.snap artifacts/bar.exe
node guest_vm/tools/snapshot_to_exe.js artifacts/bar.snap artifacts/debug.exe --debug-info artifacts/bar.snap.dbg
js_min.exe guest_vm/tools/snapshot_to_exe.js artifacts/bar.snap artifacts/bar.exe
./artifacts/js_runner.exe artifacts/host.snap guest_vm/tools/snapshot_to_exe.js artifacts/bar.snap artifacts/bar.exe
```

The output must not already exist. The tool sets mode 0755. Configure
`LD_LIBRARY_PATH` as usual when starting the existing js_min shell; the
packager does not rebuild it or add an rpath. Once packaged:

```
./artifacts/bar.exe hello.js
./artifacts/bar.exe demo8_runner.js demo8.js
./artifacts/bar.exe guest_runner.js --vm-native --snapshot artifacts/rebuilt.snap
```

The original snapshot file is not needed to run `bar.exe`. Application sources
and any ordinary application assets are still external files. Relative source
paths use the current working directory, exactly as with `js_runner.exe`.
There is no extra snapshot argument when invoking the packaged executable.
Invoking it without a program returns exit status 64. VM errors and normal
program exit statuses retain the snapshot's existing behavior.

## Loader contract

The output is ELF32 little-endian **ET_EXEC**, EM_386, with the conventional
non-PIE load base **0x08048000**. Its instructions remain position independent:
the launcher finds its PC with a macro-assembled call/pop and uses PC-relative
offsets to the GOT, `main`, and the embedded snapshot entry. There are no text
relocations, relocated snapshot pointers, or changes to snapshot payload bytes.
Fixed virtual addresses occur in ELF metadata, not in launcher instructions.

The kernel starts `/lib/ld-linux.so.2`. The ELF dynamic section explicitly lists
`libc.so.6`, `libm.so.6`, and `libdl.so.2` as separate `DT_NEEDED` dependencies.
It uses a SysV symbol hash and two `R_386_GLOB_DAT` relocations for
`__libc_start_main` and `dlsym`. No symbol version requirements, GNU hash, IFUNC,
RELR, TLS, rpath, or modern startup objects are introduced by the wrapper.
In particular it does not acquire a GLIBC_2.34 version requirement merely
because it was generated on a recent system. This deliberately uses the
longstanding i386 libc startup ABI. Compatibility with old glibc is intended,
not a claim that every old glibc/kernel combination has been tested.

`_start` preserves the dynamic loader's finalizer and original process stack,
aligns the call stack, and calls `__libc_start_main`. `main` invokes the embedded
entry with `(argc - 1, argv + 1, dlsym_address)`. Thus libc initialization and
normal libc exit handling run; there is no handcrafted libc substitute. The
wrapper provides no additional VM services. The snapshot still allocates its
linear heap independently and resolves its own bindings at startup.

The normal `js_runner.c` loader and snapshot format are unchanged. Shared format
constants now live in `aot/standalone_format.js`, used by the backend and the
packager. Packaging does not change the native contract or standalone format.
The subsequent whole-suite bring-up uses native contract 103 for independent
Math/String coercion fixes; standalone format version 2 remains unchanged.

## File layout and mutability

- Offset 0: one 4096-byte RX load segment containing ELF/program headers,
  interpreter name, launcher code, dynamic strings/symbols, hash, relocations.
- Offset 4096: one 4096-byte RW load segment containing import slots and the
  dynamic section (`DT_DEBUG` may be written by the loader).
- Offset 8192: one RWX load segment containing **exactly the original snapshot**,
  not its reserved heap capacity. Permissions match the existing snapshot
  loader, whose bootstrap patches process-local bindings in the image.
- After the payload: section names and ELF section headers, not mapped as
  another load segment. Named sections expose the launcher, dynamic metadata,
  and `.snapshot`; the snapshot's own inspectable contents are retained.

The stack is marked non-executable with `PT_GNU_STACK`. Executable file-backed
segments use the kernel's private mappings: runtime writes affect private/COW
pages, not the executable file. Neither the executable nor the source snapshot
is opened for writing during execution. Output has about 8.5 KiB of packaging
overhead, with no compression and no sparse-file allocation tricks.

## Implementation and safe output

`snapshot_exe_elf.js` constructs deterministic ELF bytes and invokes the existing
`aot/x86_assembler.js` to build the launcher. It has no file I/O or native
execution dependency. The assembler's named stack-adjustment and `ud2` macros
encode single instructions; no raw instruction blobs are embedded in the tool.
`build(header, fileLength, Assembler, format)` returns `prefix`, `suffix`,
`snapshotOffset`, and the launcher macro `assembly` for inspection.

`snapshot_exe_io.js` handles file operations through either Node's built-in fs
or named libc wrappers over HostFFI. Copying uses a 64 KiB buffer, not a JS copy
of the whole snapshot. The header is validated against the ordinary standalone
loader's bounds/format rules; the tool also rejects oversized i386 layouts.
This is structural validation, not authentication or verification of arbitrary
machine code. Only package trusted snapshots.

Output is written to an exclusively created sibling temporary file, closed,
made executable, and published with `link`, which atomically refuses an
existing destination. The temporary link is then removed. This avoids a rename
race overwriting an existing file or the input snapshot. Failures clean up only
the tool's own temporary file. A killed process may leave its temporary file;
the tool does not overwrite it on a later run. Publication requires a filesystem
supporting hard links. The input must be seekable and must not be modified
concurrently; size changes during copy are detected, not arbitrary same-size
concurrent edits. No runtime integrity hash is added.

## Validation

```
node guest_vm/tools/check_snapshot_exe.js artifacts/bar.snap
```

This serial developer driver uses Node built-ins, the existing js_min binary,
and an existing `artifacts/js_runner.exe`. It does **not** build the loader.
Paths can be configured with `JS_MIN_BINARY`, `FIREFOX_LIB_DIR`, and
`JS_RUNNER_BINARY`. The packager itself does not depend on Node.

The checks inspect ELF metadata in JS, compare output across all three hosts,
compare the embedded payload byte for byte, run independent programs and live
environment/argument checks, invoke the packager under the generated executable,
check unchanged ordinary-loader execution, and exercise invalid input,
no-clobber, and file-immutability behavior. Artifacts, including the launcher
macro dump, remain beneath a per-process directory in `artifacts/`.

See [the dated acceptance record](snapshot-executable-validation.md) for the
checks actually completed and their scope.

For the full two-launcher sweep, including deletion of the source snapshot
before **every executable-phase job**:

```
node guest_vm/tools/validate_snapshot_exe_suites.js artifacts/bar.snap artifacts/bar.exe artifacts/launcher-acceptance
```

This serial supervisor runs core/GC/JSON checks, the live application matrix,
complete imported Test262 and historical ECMA, all fifteen stock Octane suites,
and genuine source rebuilds. It intentionally deletes the supplied snapshot
after the snapshot phase, so use a reproducible build artifact. It records
per-job logs, timing/RSS, image hashes and deletion/absence evidence. Reinvoking
the same command resumes at the last completed job. Do not modify VM sources
between jobs; a rebuild must use the same source as the loaded image to test
the fixed point. Existing ECMA failures remain failures, not hidden passes.
An optional `--ecma-baseline LOG` compares the exact historical filename sets.
Do not run another heavy suite concurrently.

Final analysis sets `accepted` and returns a nonzero status for unexpected
failures, missing/mismatched results, new skips, missing snapshot-deletion
evidence, or changed executable bytes. Known ECMA failures stay classified as
failures but do not invalidate acceptance when they match the supplied baseline.
If `--recover-test262-summary` adopts a completed worker log after its
supervisor vanished, it records the missing process exit explicitly; this is
not enough for final acceptance. Supply a clean confirmation receipt with
`--test262-confirmation PREFIX`. The receipt is `PREFIX.log` plus
`PREFIX.time.json`, recorded using:

```
/usr/bin/time -f '{"wall":%e,"rssKiB":%M,"exitStatus":%x}' -o PREFIX.time.json ./artifacts/bar.exe test262_runner.js > PREFIX.log 2>&1
```

Run that only after removing the source snapshot, and wait for completion.
The analyzer checks exit status zero and exact Test262 file-result agreement.
It does not repeat completed expensive suites when refreshing the report.

`validate_snapshot_exe_apps.js SNAP EXE OUTDIR` can also run the bounded graphics
and HTTP matrix alone, deleting SNAP between its phases. `--only-programs`
selects the additional structural GC, raw-FFI, frontend, native-compiler,
demo8 I/O and multi-context programs. `--phase snapshot|exe` lets the full
supervisor manage deletion itself; executable mode rejects an existing SNAP.
