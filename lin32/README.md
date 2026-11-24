# lin32

lin32 is a proposed user-space Linux compatibility runtime for Windows. Its
long-term goal is to run Linux executables on Windows releases from Windows 98
onward, using a small runtime that can be built with the local Tiny C Compiler
0.9.27 toolchain.

This directory currently contains the design and implementation plan only.
There is no working runtime yet. Compatibility with every Windows release is a
goal to validate, not a claim about the current project.

## Initial scope

Start with little-endian, 32-bit x86 Linux ELF executables and the Linux i386
system-call ABI. The first supported programs will be small, statically linked,
single-threaded test executables that use a documented subset of Linux system
calls. The first demonstration will write a message and exit with a requested
status under Windows XP.

Support will grow through explicit, tested compatibility milestones. Arbitrary
Linux distributions, x86-64 binaries, kernel modules, containers, and Linux GUI
applications are outside the initial scope. On later Windows systems, the host
must be able to run the 32-bit Windows launcher; systems without that facility
will require a separate host port or emulator. The Windows 98 baseline refers
to x86 installations. Windows 98, 98 SE, Me, 2000, XP, and subsequent Windows
families need separate validation rather than an assumption that XP results
apply everywhere.

## Proposed architecture

Build a 32-bit Windows PE launcher with an ELF loader, an x86 execution engine,
and a Linux system-call compatibility layer. Keep the Windows host interface
separate from guest Linux behavior.

Use an interpreter for guest x86 instructions initially. It makes Linux syscall
entry, guest memory permissions, faults, and guest address-space layout explicit
without depending on newer Windows exception mechanisms or executable-memory
facilities. It also avoids assuming that a Linux program can execute directly
in the launcher's Windows address space. This is slower than native execution,
but gives a controllable foundation for compatibility. A translator or native
fast path can be considered after correctness is established.

The principal components will be:

- **ELF loader:** validate ELF32/i386 headers and bounds, load `PT_LOAD`
  segments, zero BSS, set up the entry point, and reject unsupported formats
  with useful diagnostics.
- **Guest memory:** maintain a 32-bit virtual address space backed by host
  allocations, with checked access, segment permissions, and defined handling
  of unmapped addresses. Do not allocate an entire 4 GiB host buffer; use sparse
  regions and account for the limited address space of a 32-bit host.
- **CPU engine:** implement the instruction, register, flag, and fault behavior
  needed by the initial fixtures, then expand coverage. Route `int 0x80` into
  the syscall layer; add other Linux entry mechanisms when tests require them.
- **Process startup:** construct the Linux stack containing `argc`, `argv`,
  environment strings, and an appropriate auxiliary vector. Keep guest
  pointers and structures independent of Windows layouts.
- **Syscall layer:** decode i386 syscall numbers and guest data structures,
  validate guest buffers, and translate results into Linux return values and
  negative errno values. Unsupported calls return an explicit error, normally
  `-ENOSYS`, rather than silently succeeding.
- **Windows backend:** wrap file handles, console I/O, time, memory allocation,
  and later process/thread facilities. Use the Windows 98 API subset for the
  base launcher; resolve optional newer APIs at runtime. Audit PE imports and
  compiler runtime dependencies before claiming Windows 98 support.
- **Filesystem view:** provide a configurable guest root and explicit path
  translation, including absolute paths, relative paths, and a guest working
  directory. Define case sensitivity, permissions, links, and special files
  as compatibility work rather than pretending Windows semantics match Linux.

The runtime is a compatibility tool, not a security sandbox. The initial
fixtures are trusted programs; running hostile binaries would require a
separate security design and audit.

## Implementation plan

1. **Establish the local build and test loop.** Inspect only the supplied
   `~/src/gpt/tinycc` toolchain and `~/src/gpt/xp` image as needed. Determine the
   available cross-compilation commands, headers, libraries, QEMU invocation,
   and a reproducible way to transfer test files into a disposable XP image
   overlay. Build a minimal Windows console executable and verify its output
   and exit status in XP. Keep the original filesystem image unchanged.

2. **Create deterministic Linux fixtures.** Write small, original i386 test
   programs locally, using the available compiler/assembler where supported
   or a small local ELF fixture generator. Start with direct syscalls so the
   first tests do not depend on a Linux libc. Record the build commands and
   expected output and status alongside the fixtures.

3. **Implement loading and guest memory.** Add strict ELF validation, sparse
   memory regions, segment loading, BSS initialization, and stack construction.
   Test malformed and truncated files, integer overflow, overlapping segments,
   and invalid guest addresses before executing guest instructions.

4. **Deliver the first end-to-end runtime.** Implement enough x86 execution
   for the small fixtures, including `int 0x80`, and support Linux `write` and
   `exit`. Acceptance: the PE launcher runs a static Linux ELF in QEMU/XP,
   prints the expected bytes, returns the expected status, and diagnoses
   unsupported instructions and invalid memory access without crashing the
   launcher. This milestone proves only the instructions and syscalls tested.

5. **Expand static-program compatibility.** Add tested instruction coverage
   and file descriptor management, then `read`, `open`, `close`, seeking,
   metadata queries, `brk`, and memory mapping as required by fixtures. Define
   guest structure packing, 64-bit offsets, Linux flags, and errno translation
   explicitly. Compare guest behavior with Linux reference runs where a local
   Linux execution environment supports the fixtures.

6. **Validate the oldest Windows baseline.** Check PE machine type, subsystem
   version, imported DLLs/functions, startup code, and toolchain dependencies.
   Exercise the launcher on Windows 98 and 98 SE when suitable test images are
   provided, then Me and NT-family releases. The supplied XP image alone cannot
   validate those systems. Record exact versions tested and observed limits in
   a compatibility table.

7. **Add dynamic executables.** Support `PT_INTERP`, load a locally available
   Linux dynamic linker into guest memory, and implement the startup, mapping,
   TLS, and syscall behavior it needs. Preserve the distinction between loading
   the interpreter and implementing a linker ourselves. Assess locally
   available libc binaries and their requirements before choosing a target;
   do not download dependencies.

8. **Add harder process semantics.** Address signals, TLS and segment behavior,
   threads, futexes, process creation, pipes, polling, and sockets in separate
   milestones. Specify limitations imposed by Windows 98 and define how Linux
   operations will be emulated. Extend tests before advertising each feature.

9. **Optimize and broaden validation.** Profile representative supported
   programs, then consider instruction caching or translation. Run regression
   fixtures across the available Windows matrix and publish supported syscall,
   instruction, binary, and host-version coverage with reproducible commands.

## Development constraints

- All project source, documentation, test definitions, and committed changes
  belong under `ai_experiments/lin32/`.
- Use the local `~/src/gpt/tinycc` toolchain and installed QEMU. Use the supplied
  `~/src/gpt/xp` filesystem image for XP testing through disposable overlays.
- Do not fetch code from the internet or inspect unrelated directories under
  `~/src/gpt` or elsewhere in `ai_experiments`.
- Keep generated executables, guest images, overlays, and other large build
  artifacts out of commits. Add local ignore rules when those outputs exist.
- Keep build instructions reproducible and avoid requiring modern Windows APIs
  or an installed compiler on the target Windows machine.

## Main feasibility risks

The largest effort is implementing enough x86 and Linux behavior for real
programs, especially libc startup, signals, TLS, threads, and process creation.
Windows 98 adds tighter memory limits and different OS behavior from the NT
family. The compiler's ability to emit a Windows executable does not by itself
prove that its imports and startup code work on Windows 98.

The proposed sequence makes these assumptions testable early. The immediate
next deliverable after this plan is the minimal PE build and XP test loop,
followed by the static ELF message-and-exit demonstration.
