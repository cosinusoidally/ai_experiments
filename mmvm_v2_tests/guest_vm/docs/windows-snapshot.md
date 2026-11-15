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

The full Wine rerun now passes **3292/3292**, zero failed/timed out/not run,
harness **344651.144 ms**, process **345.37 s**, peak RSS **516784 KiB**, exit 0.
Corpus, selection and instruction limits are unchanged. The following Linux
full run also passes **3292/3292**, zero failed/timed out/not run, harness
**343433.396 ms**, process **344.07 s**, peak RSS **513840 KiB**, exit 0.

### Packager host contracts

The native I/O adapter detects whether the host resolver supplies POSIX contracts
or only raw MSVCRT exports. The raw-CRT branch translates descriptor names and
open flags, uses binary mode, and uses MSVCRT's no-overwrite rename publication.
The existing POSIX hard-link publication remains unchanged. Both contracts use
the same streaming converter and container writers, not a second packager.

`check_snapshot_pe_crt.js` runs inside the Windows guest and restricts only its
I/O resolver to the actual msvcrt module. It performs a complete conversion and
checks that a second publication fails with EEXIST; there are no mocked file
operations. This passes, including byte-identical output and no clobber. The
test wrapper initially omitted peek32 needed for errno reporting; that fixture
defect was fixed before accepting the no-clobber result.

Final PE bytes agree across Node, Linux js_min, Linux standalone and Windows
standalone packaging, as well as the raw-CRT I/O contract. This is not a claim
that an actual native Windows Node/js_min binary was run: those binaries were
not supplied. No TCC or compiler-generated fixture was needed.

Temporary builds and logs use ignored `artifacts/win-*` paths. Subsequent Linux
and memory/build acceptance results are recorded below when completed.

### Linux compatibility and GC/build gates

- Both Node and js_min core suites pass 12 guest programs / 310 assertions,
  including CLI server/demo paths and three-context multiplexing.
- Dedicated structural GC passes under both PE/Wine and ELF: 27 audits,
  113184 checked edges, 221 property-index audits, 74 embedding collections,
  maximum observed guest bump 3532584 bytes under an 8 MiB guest cap.
- Genuine Linux self-hosting reproduces the Node snapshot byte-for-byte:
  **87.57 s / 485020 KiB peak RSS / exit 0**. The preceding recorded build was
  91.77 s; these historical single observations do not isolate a speedup.
- The full standalone language integration passes on Windows and Linux.
  No demo or external corpus code, C source, compiler binary or loader was changed.

The full current-snapshot SHA-256 is
`9f12d591102671059e3098bd936acf60977fe042453c6acf6baa078f2d5f5d13`.
The original source snapshot is not required by either packaged executable.
Broader Node-on-Windows compatibility is not claimed: the shared minimal process
API still reports its historical `linux` platform string, and drive/UNC path
semantics need explicit future platform work. This does not affect the completed
Test262 selection; do not use that result to claim a full Windows Node API.

### Final serial acceptance, 2026-11-15

- js_min rebuild: **105.73 s / 394040 KiB peak RSS / exit 0**, snapshot identical
  to Node and the genuine Linux self-build. Previous observation was 110.82 s;
  these are not paired attribution experiments. js_min itself was not rebuilt.
- With the source snapshot moved aside, Windows hello and the ch06 selection
  pass. A direct socket FFI call prints the explicit unsupported-operation
  message and exits **3**. No network connection or X11 program was attempted
  on Windows. Full Windows Test262 above ran before moving that source file;
  the later absence checks are separate focused acceptance, not a second full run.
- Wine's hello virtual-memory trace records the **640 MiB MEM_RESERVE** call
  (size `0x28000000`, allocation type `0x2000`), followed by **109 MEM_COMMIT
  calls of 64 KiB** inside that mapping: **7143424 bytes / 6.8125 MiB** committed.
  The initialized snapshot heap is 6795560 bytes. This is evidence of incremental
  commitment for that mapping, not a whole-process memory accounting or a claim
  that full-suite peak memory is 6.81 MiB. Memory observation used a separate
  hello run, not instrumented suite timings.
- All eight bounded Linux demos and all three HTTP servers pass with the source
  snapshot absent. These are not long endurance runs. No demo code was changed.
- Three stock Linux Octane checks pass: Richards **89.2** (previous 92.6),
  Gameboy **808** (770), CodeLoad **94.2** (90.9). Process seconds/RSS KiB:
  Richards **3.44 / 21632**, Gameboy **17.26 / 96500**, CodeLoad **30.19 / 281216**.
  Mixed single-run score changes are not proof of performance neutrality or an
  isolated regression. The full fifteen-suite Octane and historical ECMA sweeps
  were not repeated for this Windows bring-up.
- The unrelated portable-host standalone-language recursion limitation was
  confirmed with the **pre-numeric-test source from 05e732c**, supplied in memory
  to the current Node-hosted runner without editing files: the same object-runtime
  recursion occurs. Both native platforms pass that integration workload. Do not
  count the diagnostic portable run as a passing acceptance test.

Final PE SHA-256 (also identical across all five packaging contracts above):
`e6c6f0b36ceb4bc45d7cafc3e0f41831ff96389ef54f9e806b3c6d6ada13444c`.

All heavy tests/builds were serial. Logs, screenshots/application fixtures and
executables remain ignored in artifacts. No Windows system version other than
the provided Wine prefix was tested; a real-Windows run is still required before
claiming that coverage. The build never invoked TCC, GCC or binutils and added no
dependency on them.

## Windows self-hosting follow-up

The first explicit Windows source-to-snapshot attempt failed after kernel
compilation at `interpreter.js`'s `NativeInterpreter.Exit` initialization
(58.03 s, exit 3). Source-level bootstrap tracing showed that the preceding
1.1 MiB `native_interpreter.js` load had returned **zero characters**, not a
missing dependency in the checked-in loader order.

The cause is an OS memory/I/O contract: Windows kernel file operations can
reject uncommitted user buffers without delivering a user-mode exception to the
lazy-commit handler. A large calloc-backed read buffer was reserved but not
committed. Ordinary JS loads/stores had not touched that buffer before fread.

The Windows native boundary now wraps read/write/fread/fwrite and commits the
**actual borrowed buffer span** before entering native I/O. Existing committed
pages retain their contents; the unused reservation and GC suffix are not
committed. Native CRT-owned allocations need no action. Commitment failure
reports an explicit resource error rather than masquerading as EOF. Arbitrary
external native functions which submit buffers directly to the OS will need
the same explicit memory contract; a user-mode fault handler alone is not
sufficient for those interfaces either.

`../tools/check_native_file_io.js` exercises binary descriptor/buffered I/O
with 2 MiB-plus initially demand-zero allocations, markers at separated offsets,
unaligned interior spans and exclusive fixture creation/cleanup. It passes on
Node, Linux js_min and Wine with the new boundary. This does not require a C
fixture, external compiler or source-specific read workaround.

`../tools/trace_self_hosted_build.js` provides reusable source-load/dependency
and phase tracing for a genuine build. It reports missing bindings explicitly
without changing application/demo sources or substituting a copied snapshot.
Use a normal uninstrumented build for timings and final identity acceptance.

After the I/O fix the build passed preparation but stalled in backing sharing:
the optional GNU `memmem` optimization was absent and the old JS byte loop was
pathologically slow. That optional symbol was missing from the initial static
inventory. The subsequent shared compiled search implementation allowed
complete Windows/Wine self-builds with snapshots identical to Node/Linux.
The latest such sharing-enabled observations were 95.26 seconds on Wine and
93.02 seconds on Linux; Linux's former glibc-search observation was 87.57
seconds. These are individual measurements, not repeated-run averages.

Final string-backing sharing is now disabled by default; enable it explicitly
with `--snapshot-share-string-backings`. This pass retained the original
allocation spans, so converting their contents to views did not reduce the
snapshot length or make those bytes reusable. Existing source sharing and
interning are unchanged. See [the builder option](self-hosting.md#optional-final-string-backing-sharing).
