# Windows snapshot executable: implementation and bring-up

Updated 2026-11-15. Initial scope: hello.js and Test262, not networking/X11.
This is the implementation companion to [the original plan](windows-snapshot-plan.md).

## Build and run

From `mmvm_v2_tests`:

```sh
node guest_runner.js --vm-native --snapshot artifacts/win.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/win.snap artifacts/win.exe --win32
node guest_vm/tools/snapshot_to_exe.js artifacts/win.snap artifacts/linux.exe
node guest_vm/tools/check_snapshot_pe.js artifacts/win.snap artifacts/win.exe
```

The snapshot input is identical for both containers; the PE writer does not
patch or specialize its bytes. Building PE requires no Windows compiler,
linker, import library, SDK or TCC. Both native-shell and standalone-VM hosts
can also run the JavaScript packager with the same `--win32` option.

For the supplied local Wine installation, source `32.sh` in the supplied
`wine` directory before testing. That script selects the existing prefix;
the packager itself does not depend on that prefix or any machine-specific path.

```sh
WINEDEBUG=-all wine artifacts/win.exe hello.js
WINEDEBUG=-all wine artifacts/win.exe test262_runner.js ch06
WINEDEBUG=-all wine artifacts/win.exe test262_runner.js
```

For native Windows execution, run the generated executable directly from the
test directory. The external test corpus remains at the runner's existing
relative location. Do not modify the corpus or demo sources.

Use a **default runtime** snapshot for Test262. A `--shell` snapshot intentionally
does not provide the same top-level CommonJS environment; using one makes the
runner's `require` fail on Linux as well as Windows. The shell-mode hello/eval
path is separately supported. PE `--debug-info` incorporation is not implemented
and is rejected before output creation. Existing ELF debug handling is unchanged.

## Architecture and source map

- `../tools/snapshot_to_exe.js`: shared CLI and streaming copy; selects a
  container backend. Default output remains ELF.
- `../tools/snapshot_exe_pe.js`: deterministic PE32 headers, two direct DLL
  import tables, position-independent startup/ABI thunks and opaque snapshot
  section. Preferred image base is `0x00400000`; large-address-aware and ASLR
  flags are not enabled. Input bytes remain inspectable in `.snap`.
- `../tools/windows_platform.js`: integer/kernel-JS native platform boundary,
  compiled using the existing compiler/front end and i386 backend. No second
  interpreter, GC, parser or JS-language implementation is introduced.
- `../aot/x86_assembler.js`: a single new `retPopBytes` instruction macro for
  native stdcall returns. Ordinary compiled-kernel calls remain cdecl.
- `../tools/check_snapshot_pe.js`: structural/payload/import acceptance without
  binutils. The developer test driver uses Node built-ins, not build-time tools.

The PE entry initializes API pointers from its import address table, obtains
DLL handles and uses the CRT's `__getmainargs` parser. It forwards the existing
snapshot entry ABI `(argc, argv, resolver)`, excluding the executable name.
No command line, environment or process address is captured at package time.
Thunks derive image-relative addresses at execution time; PE metadata stores RVAs.
Linking verifies import-bridge sizes because x86 displacement encodings vary.

Default resolver order is compatibility wrappers, msvcrt exports, kernel32
exports. Explicit module handles use `GetProcAddress`. `dlopen`/`dlclose` adapt
LoadLibraryA/FreeLibrary; arbitrary stdcall guest FFI is not yet implemented.
Internal Win32 API calls use generated cdecl-to-stdcall bridges, and the
native exception callback uses a callee-cleanup return. CRT calls use cdecl.

Most support remains shared: the exact same interpreter, filesystem/module
logic, language semantics and test runner execute from the same snapshot.
Windows code handles OS/CRT contracts, not alternative language semantics.
CRT formatting glue uses `_vscprintf`/`_vsnprintf` to supply the C99 bounded
format contract expected by the common number-formatting code. It does not
duplicate the VM's number formatter. Any uncovered numeric-semantic difference
must be fixed in shared guest support, not a separate Windows language path.

## Memory and resource lifetime

Anonymous mappings reserve their full range with VirtualAlloc/MEM_RESERVE.
No whole-heap MEM_COMMIT request is made. A native vectored fault handler
commits demand-zero chunks (currently 64 KiB) inside registered reserved ranges.
The handler runs synchronously on the faulting thread, with no guest/host JS
callback, worker thread or extra process.

Mapping records are a native linked list with named base/length/protection/next
accessors. VirtualQuery ensures an already committed-page fault is not swallowed;
unrelated addresses/protection faults and failed commitments are passed onward.
A recursion guard prevents recursive handler allocation. The GC suffix commits
independently when accessed, leaving the unused heap gap reserved only.

Large allocations (at least 1 MiB) also use this reservation mechanism;
small allocations delegate to the CRT. The paired free/realloc adapters preserve
ownership and do not pass VirtualAlloc storage to CRT free. Current mappings
support anonymous private zero-offset allocations and whole-range unmapping;
other mmap shapes fail rather than pretending file-backed mappings work.
Executable protection changes commit their requested range before changing it.

This is initial support, not a general mmap implementation. Partial protection,
allocation-pressure behavior, high native addresses and allocator edge cases
need continued auditing. The target remains an ordinary 2 GiB process address
space; reserving a range does not remove fragmentation or commitment limits.

## Unsupported facilities and current portability limits

- Socket entrypoints fail with a clear stderr message and exit status 3.
  Polling real descriptors is unsupported; an empty poll may sleep for timers.
  No Winsock library is imported or loaded, and no X11/demo code is changed.
- Linux's signal facility has no implementation here; initial compatibility
  permits the compatibility layer's signal setup. Broader signals are not a
  claimed feature.
- Directory enumeration adapts Win32 records to the existing runtime's expected
  directory-name layout. Initial filesystem acceptance uses ANSI-compatible
  paths; full UTF-8/Unicode Windows filename support is not claimed.
- There is no fork/ptrace/Linux process-isolation emulation. The Test262 runner
  does not require the ECMA process supervisor. A Windows ECMA supervisor and
  Windows kernel debugger remain separate work.
- The implementation currently imports vectored-exception APIs, so Windows
  versions predating that facility are not supported. The supplied 32-bit Wine
  prefix is the initial execution target; real-Windows coverage remains pending.

## Initial working-point validation

- Existing Linux executable still runs hello.js.
- Node-packaged Linux debug executable is byte-identical to the preexisting
  executable built from that same snapshot/debug sidecar.
- Node and js_min produce byte-identical PE output from the existing shell
  snapshot; the Windows executable prints hello and exits zero under Wine.
- Fresh default snapshot runs hello under Wine and passes the ch06 Test262
  selection: one selected/executed/passed, zero failed/timeouts/not run.
- PE structural acceptance checks header/import bounds, deterministic timestamp,
  preferred address, and exact embedded payload; only kernel32.dll/msvcrt.dll
  appear as direct imports.

The initial complete Wine run executed all 3292 tests: **3261 passed / 31 failed /
zero timed out / zero not run**, harness 338.994 s, process 340.96 s, peak RSS
498296 KiB. This exposed CRT dependencies, not a reason to change test selection.

### Shared numeric support follow-up

The Windows CRT's strtod lacks the hexadecimal/Infinity behavior the VM was
implicitly obtaining from glibc. Conversion of ES hexadecimal strings and signed
Infinity now belongs to shared kernel code in `aot/native_interpreter.js` on
**both** platforms. Hexadecimal conversion retains 53 significand bits with
guard/sticky rounding, ties-to-even, without allocating a temporary native string.
Signed hex strings and hexadecimal floating syntax are rejected. parseFloat
uses the same exact Infinity-word recognition and constructs infinity directly.
Decimal conversion continues using the platform decimal service; a complete
shared correctly-rounded decimal parser is not claimed or required for this fix.

The focused Windows numeric selection passes **129/129**; the existing standalone
language integration passes under both PE/Wine and ELF, including boundary
rounding, signed Infinity and malformed hex checks. A direct portable-host run
of that whole integration file is not an acceptance gate: it reaches an existing
object-runtime recursion failure after the numeric checks, so no portable full
integration pass is claimed. Core Node tests are checked separately.

The full Windows rerun and Linux regression gates are pending at this checkpoint.
Temporary builds and logs use ignored `artifacts/win-*` paths. Subsequent full
results are recorded below when completed; a focused selection is not a full pass.
