# WSH build bring-up

Implementation in progress. Acceptance requires genuine builds from the same
checkout/options to produce bit-identical snapshots and executables under WSH,
Node, js_min and the native guest. No native extension, precompiled compiler,
snapshot-copy shortcut or changes to the existing native memory fast path.

Plan: prove bounded hex/binary transport; provide explicit WSH filesystem,
console/argument/scheduling services; select packed-word emulated memory once
at host construction; reuse the shared JS/x86 kernel backends and serializer;
then validate binary identity, execution and existing-host build performance.

The initial VBScript transport uses FSO with a checked reversible single-byte
code page, because Wine's ADO SaveToFile is unimplemented. Unsupported mappings
must error, never silently substitute bytes. End-to-end all-byte and binary
image comparisons are required in addition to the mapping preflight.

## Working points

2026-11-17:

- `wsh_binary.vbs` round-trips 65,537 bytes containing all byte values, NULs,
  chunk boundaries and an odd final byte under the supplied Microsoft WSH.
- `wsh_memory.js` is selected once when loading HostMemory. Existing Node/native
  scalar paths do not acquire new checks. It uses sparse word pages, preserving
  little-endian byte access and unaligned operations. `check_wsh_host.js` compares
  131,089 logical bytes and binary output against Node, including overlapping
  moves, cross-page strings and lone UTF-16 surrogates; checksum -626689220.
- The cscript PE converter, using chunked hex I/O, emits a complete executable
  byte-identical to Node from the same snapshot. Its no-clobber publication and
  temporary descriptors use the existing packager protocol, not a second PE
  writer. More negative-path checks remain before final acceptance.
- Node core suite passes 12 programs / 310 assertions plus existing checks.
  Fresh Node snapshot construction: 4.69 s / 283372 KiB maximum RSS. The earlier
  reference was 5.24 s / 266584 KiB; one pair does not isolate a change, but there
  is no observed build-time regression. Other host gates are still pending.
- First full WSH attempt was stopped during preparation near 1 GiB RSS, before
  exhausting the 2 GiB host. No OOM occurred. It took 225446 ms to construct the
  runtime, then 8395 ms for environment setup. A no-op result destructor could
  retain its compiler activation on classic engines, and the JS execution path
  unnecessarily kept diagnostic IR. Shared cleanup now respects the existing
  retainNativeBuildIR option on both backends, preserving live JS functions and
  target x86 bytes. WSH requests a host collection after runtime construction;
  this is not a manual-collection requirement on the guest heap.

## Invocation and boundaries

```bat
cscript //nologo guest_vm/tools/wsh_runner.js guest_runner.js --vm-native --snapshot artifacts/a.snap
cscript //nologo guest_vm/tools/wsh_runner.js guest_vm/tools/snapshot_to_exe.js artifacts/a.snap artifacts/a.exe --win32
```

Outputs currently require fresh names. WSH snapshot publication refuses an
existing file; it never deletes an old valid image before a replacement exists.
The adapter is build-oriented: filesystem callbacks use a synchronous queue,
and network/timer requests fail explicitly. It does not impersonate Node or
provide native FFI. Source text uses the ASCII fast path only when safe; UTF-8
input is decoded from actual bytes. WSH module wrappers supply explicit shell
arguments and IIFE global roots because classic indirect eval inherits caller
arguments. Guest load/module execution semantics remain the shared VM's own.

The full source-build snapshot identity, execution and self-hosted acceptance
remain in progress. Do not infer a successful full WSH bootstrap from packaging
an existing snapshot.
