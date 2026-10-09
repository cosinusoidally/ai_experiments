# lin32

lin32 is a proposed Linux i386 compatibility runtime for Windows 98 onward.
The required deliverable is one identical 32-bit `lin32.exe` for every supported
Windows release. Linux instructions execute directly on the CPU: there will be
no x86 interpreter, instruction emulation, or dynamic binary translation.
Only 32-bit x86 Linux binaries are in scope.

This directory currently contains the plan only. No runtime has been implemented
or validated across Windows versions yet.

See [WORK_LOG.md](WORK_LOG.md) for the timestamped development record. Maintain
both this README and the work log in Markdown. Append log entries for substantive
work, decisions, verification results, and outstanding issues, using ISO 8601
timestamps with an explicit timezone offset. Retrospective entries must identify
their timestamp source and must not imply tests were performed when they were not.

## Compatibility contract

Build a single PE32 console executable against the Windows 98 API baseline.
Use a minimal custom startup and avoid a dependency on an installed C runtime.
Audit every imported function, PE header, and compiler helper. Where host behavior
needs different handling, select the path at runtime inside the same executable;
do not produce separate Windows 9x and NT builds. Test the exact same artifact,
identified by its hash, on every host in the validation matrix.

The Windows target must support execution of 32-bit x86 Windows applications.
Windows systems without that capability cannot run this PE32 executable under
these constraints. Available CPU instruction sets also bound which Linux binaries
can execute. Neither condition is solved by adding instruction emulation.

Begin with static ELF32/i386 `ET_EXEC` programs, a single thread, and direct
`int 0x80` Linux syscalls. The first fixture writes a message and exits. Dynamic
linking, TLS, signals, threads, and process creation follow in later milestones.

## Proposed architecture

- **ELF loader and real address mappings:** validate ELF headers and segment
  bounds, reserve and commit segments at their Linux virtual addresses, copy
  contents, zero BSS, and apply appropriate page protections. Place the Windows
  launcher away from the initial fixture address range. Reject address conflicts
  explicitly; arbitrary fixed-address ELF executables cannot simply be moved
  without relocation information. Account for allocation granularity, shared
  pages between segments, host DLLs, and host address-space limits.
- **Native entry:** construct a Linux stack with `argc`, `argv`, environment,
  and auxiliary vector, then use a small assembly entry stub to set the guest
  stack and registers and jump to the ELF entry point. Preserve Windows thread
  state needed to call host APIs and handle exceptions.
- **Syscall interception:** first prototype a thread-local x86 structured
  exception handling (SEH) frame around native execution. Determine how each host
  reports an attempted `int 0x80`, recognize it only at a verified guest code
  address, read syscall arguments from the saved registers, dispatch the call,
  store its return value in EAX, advance EIP by two bytes, and resume execution.
  Do not depend on vectored exception handling, which is unsuitable as a required
  Windows 98 baseline API. The trap mechanism is a feasibility gate to test,
  not an already validated property of all target Windows releases.
- **Host transition:** keep Windows FS/TEB and SEH requirements intact in the
  initial fixtures. Later Linux TLS and segment-register use need an explicit
  transition design so exceptions and host calls still work. Provide sufficient
  stack space for exception delivery; investigate a host stack switch for syscall
  work. Do not treat a Linux stack as automatically safe for every Windows API.
- **Linux syscall layer:** implement the i386 syscall ABI, validate pointers
  against known guest mappings, translate structures and flags, and return Linux
  negative errno values. Initially support `write` to stdout/stderr and `exit`;
  unsupported calls return `-ENOSYS`. Treat unrelated faults as execution errors.
- **Windows backend:** wrap console/file I/O, allocation, and later time,
  process/thread, and networking facilities behind a Windows 98-compatible base.
  Optional newer APIs may be resolved dynamically within the shared executable.
- **Filesystem view:** later add an explicit guest root, working directory,
  path translation, descriptors, and documented Linux/Windows semantic differences.

Later syscall entry forms such as `sysenter` and vDSO calls need separate
handling. Do not assume that they fault safely or can use the `int 0x80` bridge.
The first version rejects unsupported binary forms and documents its supported
ABI. It executes trusted fixtures and provides no security isolation.

## Implementation plan

1. **Prove the native syscall bridge.** Build one minimal PE32 executable with
   the local TCC. Execute a locally written x86 snippet containing `int 0x80`
   under XP, record exception code and saved registers, and verify continuation
   after the instruction. Verify SEH registration, native entry, and stack
   behavior before implementing the full loader. Windows 98 verification is
   also required before claiming the bridge works across the full target range.
2. **Establish repeatable XP testing.** Unpack the supplied image in its own
   directory, retain the compressed original, inspect the disk format, and use
   disposable QEMU overlays for boot testing. Transfer fixtures using an attached
   FAT disk or another locally available mechanism. Capture output and exit
   status through a guest test script or test harness. Determine the image's boot
   and login behavior without modifying the base disk.
3. **Load and execute a static ELF.** Generate original ELF32/i386 fixtures
   locally, map their segments at the specified addresses, create their initial
   stack, and jump to their entry point. Support `write` and `exit` through the
   proven bridge. Acceptance: `lin32.exe hello.elf` executes native Linux code,
   prints the expected bytes, and exits with the requested status under XP.
4. **Harden the first version.** Test truncated/malformed ELF files, overflow,
   mapping conflicts, permissions, invalid syscall buffers, unknown syscalls,
   argument passing, and unrelated faults. Unsupported cases must give useful
   diagnostics rather than silently execute with incorrect behavior.
5. **Validate the same artifact across Windows.** Audit imports and PE startup,
   then test the same executable hash on Windows 98, 98 SE, Me, 2000, XP, and
   later available releases. Add runtime-selected compatibility paths only where
   necessary. Additional OS images are needed for tests beyond the supplied XP
   image; XP success alone does not establish Windows 98 compatibility.
6. **Expand static-program syscalls.** Add `read`, file open/close/seek, metadata,
   `brk`, and memory mapping in tested increments. Preserve native address
   semantics and handle structures, offsets, flags, and errno explicitly.
7. **Support dynamic ELF binaries.** Add `PT_INTERP` and a locally available
   Linux dynamic linker, appropriate startup data, mappings, relocations as
   required, and TLS. Assess actual local libc requirements without downloading
   dependencies. Design supported syscall-entry mechanisms before running them.
8. **Add complex Linux process behavior.** Develop signals, threads, futexes,
   process creation, pipes, polling, and sockets as separate milestones. Resolve
   Windows 9x limitations within the single executable architecture.
9. **Maintain compatibility evidence.** Publish supported binary forms,
   syscalls, host releases, and reproducible test commands. Optimize host
   transitions and syscall handling only after correctness is established;
   guest CPU instructions continue to execute natively.

## Local readiness

The installed `tinycc/i386-win32-tcc` and `tinycc/i386-tcc` report version 0.9.27.
Windows headers, import definitions, and compiler support libraries are present.
A temporary probe successfully built a PE32 console executable with custom
startup and only `kernel32.dll` imports (`GetStdHandle`, `WriteFile`, and
`ExitProcess`); its subsystem version is 4.0. The probe was removed after inspection
and has not been executed in Windows.

Installed tools include QEMU for i386/x86-64, `qemu-img`, Python 3, gzip, GNU
assembler/linker, `objdump`, `make`, `mkfs.vfat`, and Wine. The XP resource is
`~/src/gpt/xp/winxp.img.gz`; it has been unpacked in that directory as
`winxp.img`, a 4 GiB raw disk image, with the compressed original retained. QEMU is a
Windows test environment; it is not part of lin32's execution architecture.

There is enough information and local tooling to write and build the minimal
native prototype and static ELF demonstration without fetching code. XP boot,
file transfer, and exception continuation still need practical validation.
Dedicated ISO creation and guest-filesystem editing tools were not found in the
checked command paths; an attached FAT disk can be prepared with the tools above
and, if necessary, a small original local image-writing script. No additional
compiler or downloaded runtime is required for the first fixtures.

## Development constraints and risks

All project files and commits belong under `ai_experiments/lin32/`. Inspect only
that directory, necessary repository metadata, and the supplied `tinycc` and
`xp` resources. Do not fetch code or inspect unrelated project directories.
Keep executables and disposable guest disks out of commits. Preserve the XP base
image during VM tests.

The key risks are syscall trap delivery across Windows families, Linux/Windows
address-space conflicts, guest-stack exception delivery, TLS/SEH interactions,
and later Linux process semantics. Native execution removes the need to implement
x86 instructions but makes those ABI and host integration constraints central.
The immediate deliverable is the native syscall bridge prototype, followed by
the static ELF message-and-exit runtime.
