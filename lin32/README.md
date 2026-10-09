# lin32

lin32 is a proposed Linux i386 compatibility runtime for Windows 98 onward.
The required deliverable is one identical 32-bit `lin32.exe` for every supported
Windows release. Linux instructions execute directly on the CPU: there will be
no x86 interpreter, instruction emulation, or dynamic binary translation.
Only 32-bit x86 Linux binaries are in scope.

This directory contains the initial runtime implementation and its staged plan.
The runtime targets static ELF32/i386 programs using `int 0x80`. It now supports
`exit`, `read`, `write`, `open`, `close`, and a growing `brk` heap, sufficient
for the included dynamically allocated, self-hosting C-subset compiler.
The extended 14-case regression suite passes on the supplied Windows XP image.
The original 12-test XP acceptance run is retained in TEST_RESULTS.md; current
self-hosting and extended regression evidence is in SELFHOST_RESULTS.md.
See [TEST_RESULTS.md](TEST_RESULTS.md) for the captured evidence and executable
hash. Validation on other Windows releases remains required.

See [WORK_LOG.md](WORK_LOG.md) for the timestamped development record. Maintain
both this README and the work log in Markdown. Append log entries for substantive
work, decisions, verification results, and outstanding issues, using ISO 8601
timestamps with an explicit timezone offset. Retrospective entries must identify
their timestamp source and must not imply tests were performed when they were not.

## Build and run the initial version

Run all scripts from the `lin32/` directory. Paths are relative to that working
directory; the XP base is `../../xp/winxp.img`. Build with the supplied local toolchain:

```sh
./build.sh
```

This produces `build/share/lin32.exe`, static Linux test fixtures, and `run.cmd`.
The toolchain is the user's selected installation at `/tmp/tcc-cross`.
Set `LIN32_TCC_ROOT` to override that installation prefix. The installed compiler
finds its own headers, libraries, and startup objects; the build supplies no
`-B`, `-I`, or `-L` paths. The Windows launcher uses normal
`int main(int argc, char **argv)` and TCC's standard Windows startup, importing
`kernel32.dll` and `msvcrt.dll`. The target Windows machine needs those DLLs;
it does not need a compiler.
The build uses `i386-win32-tcc` for the Windows runtime and `i386-tcc` for the
original Linux fixtures, including assembly and linking. No GNU assembler or
linker is used. Building the runtime and all test fixtures requires only a POSIX
shell, TCC, and standard file utilities (`mkdir`, `cp`, and `dd`); Python is not
required. All generated artifacts are ignored under `build/`.

The eight executable Linux fixtures are C programs in `tests/`, each with a normal
`main`. `tests/linux.h` supplies a minimal freestanding Linux/i386 entry stub
and inline syscall wrappers, so they can be linked statically without a Linux
libc. The program logic is C; there is no standalone assembly test program.
The six malformed ELF inputs are produced by altering the C hello program's ELF.
The two representative compiler commands are:

```sh
/tmp/tcc-cross/bin/i386-win32-tcc -Wall lin32.c entry.S -o build/share/lin32.exe
/tmp/tcc-cross/bin/i386-tcc -nostdlib -static -Wl,-Ttext=0x08048000 tests/hello.c -o build/share/hello.elf
```

To clean from this directory:

```sh
./clean.sh
```

This removes the entire `build/` directory, including executables, fixtures,
transfer disks, the disposable XP overlay, screenshots, and raw test logs, plus
any local `__pycache__` directories. Stop the XP test VM first; cleaning refuses
while its monitor socket exists. The source, Markdown reports, and original XP
image are retained. Run `./build.sh` to rebuild afterward. Cleaning requires only
the shell and `rm`.

Python is used only by the optional PE audit and XP test helpers, not by build
or clean. To inspect the built executable, run `python3 -B audit_pe.py`.
Use `python3 -B` when running those support scripts to prevent bytecode caches.
The scripts also disable bytecode writes for their own imports. For syntax
verification, compile source in memory rather than using `py_compile`, which
explicitly writes `.pyc` files even with `-B`.

On Windows:

```bat
lin32.exe hello.elf
lin32.exe --trace hello.elf
lin32.exe checks.elf alpha "two words"
```

`hello.elf` prints `Hello from native Linux i386 on Windows!` and requests exit
status 37. `--trace` writes native entry and syscall exception details to stderr.
Successful guest exit returns its low eight bits as the Windows process status;
loader errors and unhandled guest faults return 125, and missing arguments return 2.

The initial version supports a single thread, `ET_EXEC`, an empty guest
environment, up to 32 command-line tokens including the launcher, a 16 MiB input
file, a 64 MiB mapped image span, and a fixed 1 MiB guest stack. Segment addresses
must fit below 2 GiB and be available in the Windows process. ELF `PT_INTERP`
and `PT_TLS` are rejected. Unknown syscalls return `-ENOSYS`. File I/O supports 32 descriptor slots
(including stdin/stdout/stderr), relative ANSI paths, access modes and basic
create/exclusive/truncate flags, with guest-buffer validation and errno mapping.
Absolute paths, drive prefixes and unsupported flags are rejected. This is a
minimal Windows-backed filesystem view; Windows path/case/permission semantics
apply, and traversal is not confined to a guest root. `brk` grows contiguous
native mappings in Windows allocation-granularity blocks as needed, returning
the previous break on allocation failure. Shrinking updates the logical break
but retains committed backing; this is sufficient for cc_min’s growing allocator. TLS, alternate syscall-entry mechanisms, and dynamic executables
are future work. On hosts without hardware-enforced execute permissions, page
protection cannot enforce non-executable data pages.

## Transfer programs into XP and run them

All commands below start from the host's `lin32/` directory unless identified as
guest commands. The base image is `../../xp/winxp.img`. No files are
inserted into that image and it is never attached as a writable guest disk.

1. **Build on the host.** Run `./build.sh`. This creates the Windows launcher,
   C-built Linux ELF files, malformed inputs, and `run.cmd` in `build/share/`.
   Record the base disk's contents before testing:

   ```sh
   sha256sum ../../xp/winxp.img > build/xp-base-before.sha256
   ```

2. **Create a separate transfer disk.** Run `python3 -B transfer.py`. The helper
   formats its own 16 MiB temporary volume with `mkfs.vfat`, copies every file
   from `build/share/` into FAT16 clusters/root-directory entries, and writes an
   MBR containing one partition beginning at sector 2048. The result is
   `build/transfer.img`, with volume label `LIN32TEST`. It does not open the XP
   base disk.

3. **Create and boot the writable overlay.** Run `python3 -B start_vm.py`. If
   absent, it creates the overlay with the equivalent of:

   ```sh
   qemu-img create -f qcow2 -F raw -b "$(cd ../../xp && pwd -P)/winxp.img" build/xp-overlay.qcow2
   ```

   QEMU's block graph opens the base file and raw backing node explicitly with
   `read-only=on`. Only the QCOW2 overlay is writable. XP reads unchanged sectors
   from the backing image and writes changed sectors to the overlay. The overlay
   is the primary IDE disk; the FAT16 transfer disk is a second IDE disk attached
   with `snapshot=on`, so its guest writes also go to a temporary overlay.
   Networking is disabled. No host mount or direct write to the XP base is used.

4. **Open a guest command prompt.** QEMU runs headlessly. Run
   `python3 -B vm.py screen` to save a screenshot at `build/screen.png`. I open
   the Run dialog using `python3 -B vm.py key meta_l-r`, wait for it, type `cmd`
   with `python3 -B vm.py type cmd`, and press Enter with
   `python3 -B vm.py key ret`. The monitor helper sends ordinary keyboard events;
   it does not install a guest agent. Its typing mapping matches the image's UK
   keyboard. Wait for each dialog or command to finish before the next input.

5. **Copy the files within XP.** Find the disk labeled `LIN32TEST` using `dir D:`
   (or another letter if the guest assigned one). In the current explicit-block
   configuration it is D:; earlier runs with QEMU's default devices assigned E:.
   Type these commands in the XP command prompt:

   ```bat
   mkdir C:\lin32
   cd /d C:\lin32
   copy /y D:*.* .
   ```

   This copies the launcher and fixtures from the separate transfer disk into
   XP's C: filesystem. That C: filesystem is backed by the QCOW2 overlay, so the
   copied files change only `build/xp-overlay.qcow2`, never `winxp.img`.

6. **Run through the Windows launcher.** In that same guest directory, run
   `run.cmd` for the suite, or run an individual program:

   ```bat
   lin32.exe --trace hello.elf
   echo %ERRORLEVEL%
   ```

   XP starts the PE executable `lin32.exe`. The runtime opens `hello.elf`, maps
   its Linux segments, creates its Linux stack, and enters its native x86 code.
   Its Linux syscalls enter the SEH compatibility bridge. XP does not launch the
   ELF directly. The hello program should print its message and return status 37.

7. **Collect results.** The batch redirects each program's stdout/stderr into
   `.out`/`.err` files, records `%ERRORLEVEL%`, and assembles `C:\lin32\result.txt`.
   It configures COM1 at 115200 baud and sends that report with
   `type result.txt > com1`. QEMU's serial-file backend captures the bytes in
   host file `build/xp-serial.txt`. Run `python3 -B verify.py` on the host to check
   every status and expected diagnostic, including the completion marker.

8. **Shut down and confirm preservation.** In XP run `shutdown -s -t 0`; QEMU
   exits on guest shutdown. Then on the host run:

   ```sh
   sha256sum -c build/xp-base-before.sha256
   ```

   An `OK` result verifies the base image's contents are unchanged. The overlay
   can be reused or discarded with `./clean.sh`. Preserve raw logs first if
   needed. Starting another VM session replaces the serial capture file.

`python3 -B vm.py command quit` is an emergency stop and can leave the disposable
guest filesystem dirty. Do not rebuild the transfer disk while its VM is running.

## Compatibility contract

Build a single PE32 console executable against the Windows 98 API baseline.
Use normal Windows C startup and audit its system DLL dependencies.
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

## Architecture and future extensions

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
- **Syscall interception:** the initial version installs a thread-local x86
  structured exception handling (SEH) frame around native execution. Test how
  each additional host reports an attempted `int 0x80`, recognize it only at a verified guest code
  address, read syscall arguments from the saved registers, dispatch the call,
  store its return value in EAX, advance EIP by two bytes, and resume execution.
  Do not depend on vectored exception handling, which is unsuitable as a required
  Windows 98 baseline API. The trap mechanism is validated on the supplied XP
  image, but remains a feasibility gate for other target Windows releases.
- **Host transition:** keep Windows FS/TEB and SEH requirements intact in the
  initial fixtures. Later Linux TLS and segment-register use need an explicit
  transition design so exceptions and host calls still work. Provide sufficient
  stack space for exception delivery; investigate a host stack switch for syscall
  work. Do not treat a Linux stack as automatically safe for every Windows API.
- **Linux syscall layer:** implement the i386 syscall ABI, validate pointers
  against known guest mappings, translate structures and flags, and return Linux
  negative errno values. Currently support file `open`, `read`, `write`, `close`, heap `brk`, and `exit`;
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
   `/tmp/tcc-cross/bin/i386-win32-tcc`. Execute a locally written x86 snippet containing `int 0x80`
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
   locally with TCC, map their segments at the specified addresses, create their
   initial stack, and jump to their entry point. Support `write` and `exit` through the
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

Both installed cross-compilers in `/tmp/tcc-cross/bin` report version 0.9.27.
Their default search paths find the necessary Windows headers, import
definitions, startup objects, and compiler support libraries. No explicit
include/library path configuration is needed in `build.sh`.

The current build uses the user-selected `/tmp/tcc-cross` installation exclusively,
including its integrated assembler and linker. Test support uses QEMU for
i386/x86-64, `qemu-img`, Python 3,
gzip, `mkfs.vfat`, and Pillow for screenshots. The XP resource is
`~/src/gpt/xp/winxp.img.gz`; it has been unpacked in that directory as
`winxp.img`, a 4 GiB raw disk image, with the compressed original retained. QEMU is a
Windows test environment; it is not part of lin32's execution architecture.

The initial runtime is implemented and tested on XP without fetching code.
XP boot, FAT16 file transfer, serial result capture, and native syscall exception
continuation have been verified. `transfer.py` prepares the partitioned FAT16
disk with the installed formatter and original Python image-writing code;
no ISO builder or guest filesystem editor is required. `audit_pe.py` checks the
PE headers and import list using Python rather than GNU binutils. No additional
compiler or downloaded runtime is required for the fixtures.

## Development constraints and risks

All project files and commits belong under `ai_experiments/lin32/`. Inspect only
that directory, necessary repository metadata, the supplied `tinycc` and
`xp` resources, and the explicitly authorized `/tmp/tcc-cross` toolchain.
Do not fetch code or inspect unrelated project directories.
Keep executables and disposable guest disks out of commits. Preserve the XP base
image during VM tests. Use only TCC for compilation, assembly, and linking;
do not use the GNU assembler or linker.

The key risks are syscall trap delivery across Windows families, Linux/Windows
address-space conflicts, guest-stack exception delivery, TLS/SEH interactions,
and later Linux process semantics. Native execution removes the need to implement
x86 instructions but makes those ABI and host integration constraints central.
The static ELF message-and-exit milestone is complete on XP. Next work is to
validate the identical executable on Windows 98 and other available hosts, then
expand supported Linux syscalls and binary forms in tested increments.

## Self-hosting C compiler and dynamic storage

[cc_min.c](cc_min.c) is an original freestanding C-subset compiler which writes
static Linux/i386 ELF executables directly. It generates native instructions,
ELF headers, code, strings and BSS mappings itself. It invokes no assembler,
linker, other compiler or subprocess. There is no embedded compiler executable.
The `__TINYC__` bootstrap block supplies Linux entry and five primitive functions
when TCC compiles stage 0; cc_min emits equivalent entry/primitives itself.

All compiler buffers and symbol/local/relocation tables allocate at runtime via
Linux `brk`, using growable vectors. There are no fixed maximum source, code,
string, identifier, symbol, local or argument counts. Vector capacity starts
small and grows geometrically; allocation failure and i386 address/integer
representability bound actual sizes. The allocator retains old vector storage
until process exit rather than implementing a general-purpose free/realloc.
Generated strings and globals use relocation records, so they have no fixed
reserved areas or artificial spacing limits. Parser recursion uses the process
stack; lin32’s existing guest stack and loader limits still apply to execution.

The supported language is deliberately small: int-returning functions with int
parameters; int/char globals, constant-size global arrays and scalar locals;
blocks, if/else, while and return; arithmetic, comparisons, bitwise operations,
short-circuit logical operators, assignment, calls, global array indexing,
address-of, int casts, strings/chars and comments. Memory addresses are represented
as 32-bit integers. `load8`, `load32`, `store8`, `store32`, and `syscall3` are
compiler-provided intrinsics. Locals require a single uninitialized scalar per
declaration and have function-wide scope. There are no general pointer types,
structs, typedefs, for loops, general preprocessor or libc. This is a real
self-hosting compiler for that subset, not a general ISO C compiler.

Build and verify on Linux, with no Python dependency:

```sh
./stages.sh
./test_growth.sh
```

`stages.sh` first invokes `build.sh` to create `cc0.elf` using TCC. Then:

1. `cc0.elf cc_min.c lc1.elf` creates stage 1.
2. `lc1.elf cc_min.c lc2.elf` creates stage 2 under itself.
3. `lc2.elf cc_min.c lc3.elf` creates stage 3 under itself.

The script compares stages 1/2 and 2/3 byte-for-byte, then uses stage 3 to compile
[cc_demo.c](cc_demo.c) and checks the generated program’s output/exit status 42.
The demo exercises recursion, arrays, argument order, arithmetic and short-circuit
side effects. `test_growth.sh` uses awk to generate a source exceeding the old
buffer/table sizes, compares bootstrap and self-built output, and checks exit 42.
Its awk/cmp/wc utilities are optional test support; build.sh remains shell/TCC.
All files produced by these scripts remain in the ignored build directory.

For XP, run both host scripts before creating the transfer disk in the eight-step
procedure above. This includes `cc0.elf`, both C sources, `lc1/2/3.elf`, the Linux
demo/growth reference executables, and `stages.cmd` in the files copied to C:\lin32.
After `run.cmd`, execute `stages.cmd` in that guest command prompt. It runs:

```bat
lin32.exe cc0.elf cc_min.c wc1.elf
lin32.exe wc1.elf cc_min.c wc2.elf
lin32.exe wc2.elf cc_min.c wc3.elf
```

XP’s `fc /b` compares all Windows stages with each other and with the matching
Linux stages. Stage 3 also compiles/runs the independent demo and growth test,
and compares their ELF outputs with Linux reference outputs. The batch records
all statuses and comparisons in `stages.txt` and sends it through COM1 into the
same host serial capture as the regression suite. Verify both on the host:

```sh
python3 -B verify.py
python3 -B verify_stages.py
```

The Linux ELF compiler is identical across both environments, and the Windows
launcher remains the same single native PE executable. Only XP has been tested;
the other Windows releases still need validation with that executable.

## Boot XP interactively

Run `./boot_xp.sh` from this directory to open XP in a GTK QEMU window. The Bash
launcher creates `build/xp-interactive.qcow2` on its first run and reuses it on
later runs, with the original XP base explicitly read-only. If `build/transfer.img`
exists, it also attaches that disk with temporary guest writes. Ctrl+Alt+G releases
mouse/keyboard capture. Shut down from XP's Start menu. `clean.sh` removes this
interactive overlay along with the other build artifacts.
