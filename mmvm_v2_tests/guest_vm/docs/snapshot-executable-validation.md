# Snapshot executable validation — 2026-11-11

The subsequent [full two-launcher acceptance](../../SNAPSHOT_EXE_ACCEPTANCE_2026-11-11.md)
is complete on 2026-11-12 at native contract 103. It includes full Test262,
ECMA and all 15 stock Octane suites, supplemental integration, and executable
runs after deleting the source snapshots. The initial packaging-only scope
and limitations recorded below are historical, not the final acceptance scope.

Implementation checkpoint: `6d3fa90`, followed by named ELF field layouts and
this acceptance record. No C files, demos, external corpora, snapshot format,
or native interpreter contract changed. No compiler/binutils programs were
used. An existing, previously built js_runner binary was used to exercise the
ordinary loader; it was not rebuilt.

## Completed checks

- `node guest_vm/tools/check_snapshot_exe.js artifacts/elf-current.snap`:
  **41 checks passed**. Includes independent ELF metadata inspection,
  byte-identical packaging under Node/js_min/js_runner, running the tool under
  its own generated executable, exact payload preservation, arbitrary program
  selection, live environment and argument forwarding, ordinary-loader
  execution, missing-program exit status, invalid input, exclusive output
  publication, and source/executable file immutability.
- Complete `guest_vm/tests/run_tests.js` on Node: passed, **12 guest programs /
  270 assertions**, plus tokenizer, compiler, heap, embedding, native interpreter
  and structured compiler integration checks.
- The same complete core driver on js_min: passed, **12 guest programs /
  270 assertions**, including native and predecoded interpretation.
- Generated executable running `guest_vm/tests/standalone_language_integration.js`:
  passed, including linear heap/runtime isolation checks.
- Generated executable running `guest_vm/tests/object_operations_integration.js`:
  passed.
- Generated executable running `guest_vm/tests/gc_stress_workload.js`: passed,
  **24 rounds / 48 native collections**. This is the bounded surviving-data
  workload, not the separate embedding driver's structural heap audit.
- Demos **1–7** through the generated executable at **320x240**: each ran for
  several seconds and exited normally via its Escape handler. Demo **8** ran
  at **320x240**, then exercised garage and free-drive auto-pilot mode changes
  and exited normally through its menu. These are bounded graphical smoke
  checks, not exhaustive visual comparison or long-running GC/performance
  acceptance. No demo sources were changed.
- Self-hosted source rebuild through the generated executable completed:

  ```
  ./artifacts/elf-current.exe guest_runner.js --vm-native --snapshot artifacts/elf-rebuilt.snap
  ```

  `elf-rebuilt.snap` is byte-identical to the independently Node-built
  `elf-current.snap` and the independently js_min-built `elf-jsmin.snap`.
  SHA-256 of all three:
  `ef52b1c2a9bb2e9e22dd8318fe8c528e624be6f1635318601a95e488f893c3eb`.
  This was a real source/kernel rebuild, not copying the input snapshot.

The current snapshot is **7,294,904 bytes**; its executable is **7,303,616
bytes**, an overhead of **8,712 bytes**. Only the wrapper metadata/launcher is
added; the embedded snapshot's debug/inspection data and source are unchanged.

All VM/build/demo runs were serial. The X11 sender is a lightweight input
client used alongside the single running demo. Raw logs and generated files
are ignored temporary files under `artifacts/elf-*` and
`artifacts/snapshot-exe-check-*`, not committed artifacts.

## Scope and limitations

Execution was verified on the available i386-capable Linux/glibc environment.
Old glibc compatibility is designed for using the historical startup ABI,
separate libraries, SysV hash and unversioned imports; an old distribution was
not available for execution testing. No internet access or downloads were used.
The full external ECMA/test262/Octane corpora were not rerun for this packaging
change; these results do not supersede their existing compliance/performance
records. No VM language semantics or hot interpreter code changed.
