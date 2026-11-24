# Windows PE32 snapshot executable: investigation and implementation plan

Date: 2026-11-14. Source reviewed at `b516654`.
Original status: planning only. Initial implementation began 2026-11-15; see
[current Windows bring-up](windows-snapshot.md) for actual support and validation.
The proposals and open alternatives below remain the original planning record,
not an assertion that every planned feature is implemented.
The source investigation was local; no Internet access or downloads were used.

## Goal and constraints

Proposed invocation, from `mmvm_v2_tests`:

```sh
node guest_vm/tools/snapshot_to_exe.js artifacts/bar.snap artifacts/bar.exe --win32
```

The same tool must remain usable through Node, js_min and the standalone
guest VM. The JavaScript implementation must remain ES3-host-compatible.

- Embed the **exact input snapshot bytes** used for Linux packaging. Do not
  rebuild, specialize, patch or otherwise mutate the input snapshot.
- Preserve existing ELF packaging and ordinary `js_runner.exe` snapshot loading.
- Use a PE32/i386 executable with a conventional fixed preferred image base;
  retain position-independent snapshot code. The PE launcher may need its own
  relocation records; these must not become snapshot relocation requirements.
- Statically import from `msvcrt.dll` and `kernel32.dll`. Additional DLLs may be
  loaded explicitly at runtime through the loader interface described below.
- No GCC, binutils, import libraries, CRT startup objects, development SDK,
  npm packages or external runtime helper DLLs are required to build the file.
- Produce deterministic output: no timestamps, absolute build paths, random
  identifiers, captured environment or build-machine addresses. Renaming an
  otherwise identical input/output must not change executable contents.
- Keep the snapshot's existing heap/bytecode/native-code ownership model.
  No moving GC, host-JS dependency for execution, or background commit thread.

The existing version-2 snapshot bootstrap is position-independent i386 code.
It receives `(argc, argv, resolverPointer)` and uses the supplied resolver to
obtain platform addresses afresh. This is the main portability seam. The code
is address-independent but its current native contracts are Linux/POSIX-based.

## Proposed architecture

```text
snapshot_to_exe.js
    existing ELF backend -> Linux launcher -> unchanged input snapshot
    new PE32 backend     -> Windows launcher + compatibility layer
                                             -> unchanged input snapshot
```

Keep container writers separate. Share input format validation, byte storage,
the kernel compiler/macro assembler and applicable launcher logic. Do not
duplicate the interpreter, heap implementation or bytecode compiler.

The Windows launcher initializes the CRT facilities it needs, obtains command
line/environment state from the running process, initializes native compatibility
state and invokes the snapshot. Use an established CRT argument parser/export
where available rather than an approximate whitespace split. Verify the chosen
CRT startup/argument exports on the eventual minimum Windows target. Do not
assume a custom PE entrypoint automatically receives C `argc`/`argv`.

All executable wrapper code should be kernel JS compiled by the existing
compiler, with macro-assembler bridges only where required. No opaque manually
injected instruction sequences and no external C helpers.

## `dlsym`-compatible resolver

Expose a native **cdecl** function with the existing signature:

```text
pointer resolve(handle, nulTerminatedName)
```

For `handle == 0`, use a deterministic default search order:

1. Named compatibility wrappers.
2. Exact exports from `msvcrt.dll`.
3. Exact exports from `kernel32.dll`.

For a nonzero real module handle, use `GetProcAddress(handle, name)`.
Return zero for unresolved symbols, preserving the current resolver contract.
Keep compatibility-wrapper lookup distinct from lookup in an explicitly named
DLL: requesting an actual DLL export must not accidentally return an unrelated
POSIX replacement. Define behavior for any synthetic loader handles explicitly.

The compatibility table also exposes `dlsym`, `dlopen` and `dlclose`:

- `dlsym` returns/uses this resolver, including the zero-handle default search.
- `dlopen(name, flags)` adapts `LoadLibraryA`, returning its module handle or
  zero. Define supported flags; do not claim full POSIX loader semantics.
- `dlclose(handle)` adapts `FreeLibrary`, translating success/failure to the
  expected POSIX-style return convention and respecting handle ownership.

Example existing guest FFI pattern:

```js
var resolve = get_dlsym();
var openLibrary = ffi_call(resolve, 0, "dlopen");
var handle = ffi_call(openLibrary, "example.dll", 1);
var address = ffi_call(resolve, handle, "example_function");
```

This discovers an address; it does **not** establish how that address must be
called. Most i386 Win32 APIs use stdcall; ordinary CRT functions generally use
cdecl. The resolver's own Win32 calls need ABI bridges. Arbitrary guest calls
to stdcall exports need an explicit FFI calling-convention facility or a known
native adapter. Do not infer calling convention from the name or DLL, or return
stdcall pointers while pretending existing cdecl `ffi_call` can safely call them.
Guest-to-C callbacks are not required for the initial port. A native memory-fault
handler, if used, is kernel machine code, not a callback into guest/host JS.

## Audited native dependencies

This is an inventory of named dependencies in the current VM and supplied
support code. Arbitrary guest FFI calls can request additional functions.
Not all entries are ISO C or even libc: loader, POSIX and Linux-only interfaces
are distinguished below. Repeated names across groups are intentional.

### Snapshot bootstrap and interpreter services

```text
mmap memcpy
malloc calloc free memset
strtod snprintf gettimeofday
dlsym
```

Sources: `aot/backend_x86.js` bootstrap; `runtime.js`'s
`standaloneNativeBindings`; `aot/native_interpreter.js` platform initialization.

### Shared Node-compatible runtime: complete current symbol table

```text
socket connect setsockopt getsockopt bind listen accept getsockname
inet_aton fcntl poll
open read write close
calloc free memmove
signal gettimeofday getenv __errno_location
fopen fseek ftell fread fclose
opendir readdir closedir
```

Source: `../../node_compat/libc.js`. The snapshot currently rebinds these
symbols at startup, including functions not used by the first guest program.
Initial hello-world bring-up must account for eager resolution; it cannot just
ignore unavailable symbols until later. Unsupported optional services should
resolve to explicit, correct failure adapters when necessary, not fake success.

Real Windows sockets require Winsock, not just the two imported DLLs. Winsock
can be loaded dynamically through kernel32, with explicit initialization and
ABI adapters. POSIX file descriptors and Windows SOCKETs are not interchangeable;
`read`/`write`/`close`, polling, errors and nonblocking control need a coherent
handle abstraction. This is a later portability milestone, not hello-world's
minimal implementation.

### Shell, native compilation and snapshot I/O: additional names

```text
exit dprintf dlopen dlclose
realloc mprotect munmap lseek rename unlink getpid
```

These reuse the memory/file operations above. `shell_ctypes.js` resolves
application-specified names from opened libraries. Native assembler storage uses
`realloc`; executable allocation uses mapping/protection operations; snapshot
output uses temporary files and rename.

### Executable packager's native I/O adapter: complete table

```text
open close read write lseek calloc free
chmod link unlink getpid __errno_location
```

Source: `../tools/snapshot_exe_io.js`. Node uses a separate filesystem adapter.
Producing PE on Linux is distinct from running this adapter on Windows; the
latter must preserve exclusive creation/publication and failure cleanup rather
than pretending Windows has identical `link`/`rename` semantics.

The existing Linux ELF launcher imports `__libc_start_main` and `dlsym`.
The Windows launcher replaces that startup mechanism; it does not emulate
`__libc_start_main`.

### Optional tooling and process-supervised tests

Native sampling additionally uses `profil`; normal execution does not need it.

The ECMA process-isolation helper uses this complete table:

```text
fork pipe close read write waitpid kill usleep _exit
calloc free fflush prctl getpid getppid setrlimit
```

Source: `../../ecma_tests_process.js`. This is not an interpreter requirement.
Windows isolation should use a Windows child-process backend, not a superficial
`fork` shim. Keep execution serial and retain watchdog/crash reporting.

The optional Linux kernel debugger uses:

```text
ptrace fork execv _exit waitpid kill
calloc free strdup open close lseek read write poll dup2 setpgid
__errno_location isatty tcgetattr tcsetattr
```

Source: `../debugger/linux_i386.js`. Windows debugging is outside initial scope.

The separate Linux C snapshot loader uses `open`, `fstat`, `close`, `mmap`,
`munmap`, `dlsym` and `fprintf`. These belong to `js_runner.c`, not the snapshot's
interpreter, and need not be carried into the new PE launcher.

The ELF file declares libm as a dependency, but that is not evidence of a
corresponding list of imported Math functions. Current generated math includes
x87 instructions/kernel algorithms; do not invent imports for every Math API.

## Semantic compatibility, not just symbol aliases

Audit wrappers by actual signatures, return values, flag constants, structures,
error reporting and ownership. In particular:

- Translate POSIX `open` flags and mode arguments. Force binary descriptor I/O;
  implicit CRLF conversion must not corrupt sources, buffers or snapshots.
- Implement the exact `gettimeofday` layout expected by i386 guest code.
- Preserve `snprintf`'s required return/termination behavior; older CRT
  `_snprintf` is not automatically an equivalent alias. Check number formatting,
  locale and conversion behavior for reproducible self-builds.
- Provide compatible error-state access, not merely a differently named pointer
  with unrelated error values. Keep CRT descriptors and Windows handles distinct.
- Implement the directory-entry layout consumed by the runtime, not the native
  Windows enumeration structure. Do not add `stat` to the VM's current core
  inventory merely because the JS-facing compatibility API has a stat method.
- Match mapping failure conventions, page rounding, protection and unmapping.
- Audit CRT allocation ownership and floating-point control state. Do not mix
  custom-reserved allocations with unmodified CRT `free`/`realloc`.

## Reserve address space; commit incrementally

The current heap reserves its maximum range and a collector-workspace suffix
up front, keeping native addresses stable. Logical growth currently has no OS
commitment callback. The standalone bootstrap calls anonymous `mmap` for the
combined capacity; native-host linear memory uses `calloc`.

With collector workspace enabled, its reservation is approximately one quarter
of the maximum guest heap:

| Maximum guest heap | Collector workspace | Combined reservation |
| --- | ---: | ---: |
| 512 MiB | 128 MiB | 640 MiB |
| 1 GiB | 256 MiB | 1.25 GiB |

Windows virtual reservation, commitment and resident physical memory are three
different quantities. Committing all pages need not immediately make them
resident, but it consumes commit allowance unnecessarily. A naive
`VirtualAlloc(MEM_RESERVE | MEM_COMMIT)` for the whole maximum is not acceptable.

Reserve the range with `MEM_RESERVE`, commit the initial heap prefix, and grow
commitment in bounded chunks. Commit the collector suffix independently, not
the whole unused gap before it. Never relocate the base or use a background
thread. Handle commitment failure explicitly. Audit external buffer and compiler
allocations too: fixing the primary mapping does not fix large CRT `calloc`s.

There are two possible mechanisms:

1. **Existing snapshot unchanged:** a native lazy-commit fault handler can
   supply demand-zero pages within registered reserved mappings. This best
   matches the immediate exact-input requirement, but needs careful handling of
   read/write faults, protection, allocation failure and reentrancy. It must not
   hide unrelated faults, allocate recursively through itself or resume an
   instruction after failed commitment. Use preallocated/native handler state.
   Validate on the selected minimum Windows target before relying on it.
2. **Future shared-runtime improvement:** explicit platform commitment hooks
   could provide clearer failure handling and avoid routine page-fault dispatch.
   Linux and Windows could still share one newly built snapshot, but today's
   snapshot would need rebuilding. This is a separately approved runtime change,
   not something the packager may silently apply to the input snapshot.

Neither approach is implemented or selected by this document. Preserve the
exact-input constraint unless the user approves changing the common runtime.

### 32-bit address-space limits

Typical user virtual-address ceilings are 2 GiB without large-address awareness,
up to 3 GiB for appropriately configured 32-bit Windows, and up to 4 GiB for a
large-address-aware 32-bit executable on 64-bit Windows. They are not physical
RAM quotas or guarantees of one contiguous free range. DLLs, stacks, executable
mappings and buffers consume/fragment that space.

Initially target the ordinary 2 GiB model. Reserve early, fail clearly when no
suitable contiguous range exists, and test realistic buffer pressure. A 1.25 GiB
reservation is substantially more restrictive than 640 MiB. Do not enable
large-address awareness before auditing signed native-pointer comparisons and
arithmetic above `0x7fffffff`. Guest offsets and native pointers are distinct.

## Staged implementation and acceptance

1. **Finalize the platform contract.** Select the minimum Windows version,
   confirm required CRT exports/startup behavior, choose the commitment strategy
   with the user, and specify unsupported optional services. Keep this inventory
   tied to the current code rather than growing incidental import tables.
2. **PE writer and launcher.** Add a separate PE backend, named format constants,
   deterministic sections/imports, console startup and argument forwarding.
   Compile wrapper/launcher code using the existing kernel toolchain. Preserve
   existing ELF output bytes and Linux debug behavior.
3. **Resolver and core compatibility.** Supply deterministic default lookup,
   library loading, allocation/commitment, timing, formatting, filesystem and
   error reporting. Make ABI support explicit. Run hello-world, inline `-e`,
   arguments, missing-file/error paths and binary-I/O acceptance first.
4. **Compiler and self-hosting.** Run kernel compilation and snapshot output
   under Windows. Require snapshots rebuilt from the same sources/options to be
   byte-identical across Node/Linux js_min/Linux standalone/Windows standalone.
   Investigate CRT numeric differences rather than masking them with caches.
5. **Broader portability.** Bring up applicable language suites and stock Octane
   with their correctness checks; add Windows test isolation where needed.
   Dynamically loaded Winsock support is separate from basic interpreter bring-up.
   Linux X11 demos and native Linux application objects are not made portable
   merely by packaging the interpreter as PE.
6. **Performance and memory gates.** Record serial build timings, startup,
   benchmark scores, peak RSS/working set, committed memory and reserved space.
   Test allocation failure and bounded GC stress. Reject whole-heap commitment,
   hidden host-language fallbacks, extra threads and application-specific hacks.

Cross-host packaging acceptance must compare executable bytes built from the
same snapshot through Node, js_min and the standalone VM. Test execution after
the source snapshot is removed, verify the input snapshot remains unchanged,
and check output naming/environment do not change deterministic bytes. Keep
records in tracked documentation; generated binaries/logs stay in artifacts.

The existing separate DWARF metadata is based on code offsets. Preserve that
design and precise PE code/data ranges. PE incorporation and Windows debugger
support need their own design/validation; do not promise existing ELF/GDB tooling
works unmodified. Do not embed absolute paths or discard source/debug metadata.

## Assessment and open decisions

The PE writer and dual-DLL resolver are straightforward. The substantive work
is preserving native contracts, incremental commitment and ABI correctness.
There is no identified fundamental obstacle to one snapshot serving both OSes,
but this has not yet been demonstrated on Windows.

Before implementation, resolve the minimum Windows target, exact-existing-image
versus approved common-runtime memory hooks, and the desired initial scope for
optional networking/test isolation. Do not expand the initial task into a
general POSIX emulation layer or Windows debugger port.
