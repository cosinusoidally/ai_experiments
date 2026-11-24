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
- Full source builds exposed two classic-JScript host differences. Builtin
  Function methods now install in an explicit ordered catalog: JScript's
  DontEnum bug otherwise silently omits `Function.prototype.toString`.
  The tokenizer spells vertical tab as `"\x0b"`, because JScript interprets
  the host-source `"\v"` escape as `"v"`. Neither fix changes guest language
  semantics on the other hosts. The pre-fix images were compared structurally;
  they are not used as accepted bootstrap outputs.
- The extended binary integration check also covers streaming copy, exclusive
  output creation and refusal to publish over an existing destination. Both
  hosts preserve the original bytes after failed publication.

## Invocation and boundaries

```bat
cscript //nologo guest_vm/tools/wsh_runner.js guest_runner.js --vm-native --snapshot artifacts/a.snap
cscript //nologo guest_vm/tools/wsh_runner.js guest_vm/tools/snapshot_to_exe.js artifacts/a.snap artifacts/a.exe --win32
```

Run from `mmvm_v2_tests`, with an existing `artifacts` directory. The build
requires Microsoft JScript and VBScript, FSO and WScript.Shell; it needs neither
Node nor a compiler, native addon, ADO, MSXML or a seed snapshot. The VBScript
helper is launched using the same cscript executable as the parent. All source
paths are repository-relative. Temporary file names are transport details and
never enter the snapshot. Omit `--win32` for the normal Linux executable format.

The entry script is an adapter launcher, not another VM/compiler. Its `load`
wrapper passes shell arguments and the explicit global root to the existing
IIFE modules. `GuestNodeEnvironment` receives a small WSH service provider for
text/files, console, arguments and queued filesystem callbacks. Binary output
and packaging use the existing snapshot and executable writers, with a checked
hex transport at the filesystem boundary. Native symbols remain deferred
bindings in the cross-built snapshot; WSH does not emulate native FFI.

`wsh_memory.js` supplies sparse pages of signed 32-bit words. Unallocated words
read as zero; byte writes merge into the containing little-endian word, and
unaligned reads/writes preserve byte semantics. The provider is selected once
when HostMemory loads. There is no WSH branch in existing Node/native scalar
access. Copy/fill use word operations where alignment allows. This is host
storage for building, not a new guest heap format or runtime memory policy.

Compiler results release diagnostic IR unless `retainNativeBuildIR` is set.
The WSH build also requests host JScript collection at safe construction
boundaries. Neither changes the guest collector or makes its collection manual.
The shared no-op executable destructor deliberately has no closure over a
compiler activation, avoiding accidental retention on classic JScript.

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

## Resource limitations

The full build is much heavier than the transport check. On the supplied
Microsoft JScript 5.7 under Wine, the latest monitored run reached at least
1261724 KiB RSS (about 1.20 GiB), with swapping on a 2 GiB Linux host. Run builds
and regression suites serially. This is not a claim about native XP memory use.
GNU time on the Wine launcher does not measure the actual cscript process;
sample that process directly rather than reporting the launcher's small RSS.

JScript compilation of the JS execution backend and standalone-runtime
preparation dominate source building. The adapter deliberately shares the
compiler and serializer rather than introducing a WSH-specific compiler or
serialized seed. Hex conversion adds real I/O/CPU cost, but not nondeterministic
data to either output. Reuse the resulting executable for normal execution;
the WSH adapter is a source-build host, not a fast interactive guest launcher.
