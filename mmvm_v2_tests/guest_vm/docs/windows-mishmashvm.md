# Windows mishmashvm compatibility

## Scope and acceptance

Use one standalone guest VM image for Node-compatible and JS-shell APIs.
Run the existing, unmodified `mishmashvm/bootstrap.bat`, followed by
`test(0)`, `test(1)`, `test(2)` and `test(16)`. No native-to-JS callbacks are
required. Do not change mishmashvm or use a separate checkout. Preserve the
reference Windows jsshell and required DLLs. Run heavy jobs serially.

Before each bootstrap, clear only the eight generated object files named by
`libc_portable_proto/04_check_sha256.js`. Preserve existing objects in ignored
validation artifacts rather than destroying them. The batch files select
`../../jsshell/js.exe` from each bootstrap subdirectory: temporarily substitute
the guest executable there and restore the original shell after testing.

Stop immediately on any object-hash inconsistency. Successful process exit
alone is insufficient; the batch script does not stop on every child failure.

## Implementation sequence

1. Add bounded literal/character support to the kernel compiler. Keep ordinary
   JS semantics, no special function-local compile-time assignments. Replace
   manually spelled numeric character sequences in Infinity handling with
   readable literals and shared matching/copying operations. Both backends
   must use the same lowering.
2. Unify standalone globals: retain `process`/`require` while exposing
   `ctypes`, `scriptArgs`, `printErr` and the existing shell APIs. Give binary
   `read` consistent typed-array semantics. Accept `--shell` as a legacy no-op.
   Preserve error source locations independently of environment selection.
3. Build/package one snapshot, test Linux regressions, then substitute its
   PE executable for the reference `js.exe`. Implement missing platform/FFI
   support in the VM, not application-specific rewrites. Check Windows ABI
   behaviour explicitly; name resolution alone is insufficient.
4. Run clean Windows bootstrap, check all eight hashes, then the four demos.
   Keep byte-identical cross-host/self-hosted snapshot generation, full
   Test262 coverage and bounded GC/Linux demo checks at working checkpoints.

## Reference run, 2026-11-15

The supplied Windows jsshell completed a clean `bootstrap.bat` under the
supplied 32-bit Wine prefix. All four final objects and their `.new` versions
match both the pre-existing Linux-compatible objects and the project's
expected SHA-256 values:

- `my_libc.o`: `0e8e02c852a11ebec585650d3c6fa5917fb51d7b66dd1d458d3e51680c660964`
- `stubs.o`: `0cdb519efb42f22eba96bf90407e10b87868355e1d793d3a70271f09d47aa403`
- `tcc_bin/libtcc1.o`: `59483d03266a9eadb84ceafaf4ed8a37e5a5231aaf773f296a7ca097679307b3`
- `tcc_bin/tcc_boot3.o`: `b64ff3010f2de6eb50762169fc5309b66ef704924cfc21648e7b75f088af3365`

Raw reference receipt: ignored
`artifacts/mishmashvm-win32/reference-bootstrap.log`. Existing binaries were
moved to `artifacts/mishmashvm-win32/existing/`; required DLLs were untouched.
This records a Wine run, not a physical Windows validation.

## Unified-environment bring-up

The bounded kernel literal operations are documented in
[compilation](compilation.md#bounded-kernel-string-literals); `Infinity` and
`NaN` matching/formatting no longer spell their text as numeric byte sequences.
The ordinary shell integration workload now checks simultaneous Node/shell
APIs and binary read identity, and passes in both ELF and PE executables.
The existing compiler integration workload exercises literal copy/length/
character lowering on both backends rather than adding a separate micro-suite.

Exposing Node globals makes Emscripten select its Node branch. That branch
requires `process.platform`, stdout/stderr writes, and event registration.
Platform identification is resolved at process startup, never captured from
the snapshot producer. Event operations share NodeEventEmitter rather than
introducing a separate process-only implementation.

As in the documented Linux bring-up, build the bootstrap image with
`--vm-max-heap-mib 1024`. The 512 MiB image cannot supply the contiguous logical
128 MiB ArrayBuffer reservation after compilation fragments its heap. This
is the existing backing representation/placement limitation, not a new eager
Windows commitment or an application-specific memory-size override.

The first two failed batch attempts produced no object files: first the
512 MiB allocation failure, then missing `process.platform`. Batch hash
checks consequently printed BAD for missing files, not differing generated
objects. Neither attempt is a successful bootstrap or evidence of hash parity.

After supplying the shared process services, isolated guest stage
`01_mk_tcc.js` passes, producing the Emscripten-stage object SHA-256
`080182b567eabf208f60fcba6182d9c7a11c5f2421398dec530bc9dded852004`, matching
the recorded Linux/jsshell first-stage object. This hash intentionally differs
from the final native-stage `b64ff301...` object above. The original shell is
restored after each test using an EXIT trap; interrupted-machine recovery
can restore the preserved `js.spidermonkey-reference.exe` if needed.
