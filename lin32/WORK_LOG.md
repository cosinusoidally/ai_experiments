# lin32 work log

Record substantive work, design decisions, verification results, and remaining
issues here as development proceeds. Entries use ISO 8601 timestamps with an
explicit timezone offset. Both this log and `README.md` are Markdown files.

## 2026-10-09T14:12:33+01:00 — Initial plan (retrospective)

Timestamp source: author timestamp of the initial README commit in the current
repository history.

- Created `lin32/README.md` and committed the initial runtime design and staged
  implementation plan.
- Recorded the permitted local toolchain and XP resources, the restriction on
  fetching code, and the requirement to keep project commits under `lin32/`.
- The initial design proposed an x86 interpreter. This was superseded by the
  user's native-execution requirement in the next entry.
- No runtime implementation or Windows execution test was completed.

## 2026-10-09T14:20:45+01:00 — Native execution plan (retrospective)

Timestamp source: author timestamp of the revised README commit. This entry
summarizes that work session; individual tool calls were not separately timestamped.

- Revised the design to require one identical `lin32.exe` on every supported
  Windows release, direct execution of Linux instructions, and only Linux
  ELF32/i386 binaries. Removed instruction emulation and translation from the plan.
- Proposed native ELF loading, a Linux startup stack, and an SEH-based
  `int 0x80` syscall bridge. Exception delivery and continuation remain untested.
- Confirmed the local i386 Windows and Linux TCC compilers report version 0.9.27.
  Checked the supplied Windows headers and import definitions and availability
  of QEMU, disk-image tools, assembler/linker, Python, and related build tools.
- Built a temporary PE32 console probe with custom startup and only
  `kernel32.dll` imports: `GetStdHandle`, `WriteFile`, and `ExitProcess`.
  `objdump` reported subsystem version 4.0. The initial linker-entry option was
  unsupported; subsequent inspection of local TCC startup selection established
  that the custom C entry must be named `_start`. The final probe built
  successfully and was removed. It was not executed under Windows.
- With the user's authorization, unpacked `xp/winxp.img.gz` into `xp/winxp.img`,
  retaining the compressed original. Subsequent `qemu-img info` inspection
  identified the unpacked image as a 4 GiB raw disk. XP has not been booted.
- Remaining work: prove the syscall bridge, establish XP boot/file transfer and
  result capture using disposable overlays, then implement the static ELF
  message-and-exit demonstration. Other Windows images are needed to validate
  the same executable across the full target range.

## 2026-10-09T14:22:01+01:00 — Establish Markdown work log

Timestamp source: local system clock at the start of this documentation update.

- Added this timestamped Markdown log and retrospective records of completed
  work, with timestamp sources and untested assumptions stated explicitly.
- Linked the log from `README.md` and recorded the requirement to maintain both
  documents in Markdown and append substantive development updates here.
- Updated the README to reflect the completed XP image unpacking.
- Verification: reviewed the documentation changes and checked whitespace with
  `git diff --check`. No runtime code or guest execution tests were added.

## 2026-10-09T14:34:18+01:00 — Initial runtime built; XP execution pending

Timestamp source: local system clock during implementation.

- Implemented the initial ELF32 loader, fixed-address mappings and page
  protections, Linux startup stack, native assembly entry, and thread-local SEH
  bridge for `int 0x80`. Added Linux `write` and `exit` plus explicit errors for
  unsupported syscalls and invalid buffers.
- Built the PE32 runtime with TCC and no C runtime dependency. Inspected its
  native entry instructions and imports with `objdump`: only `kernel32.dll` is
  imported; OS and subsystem versions are 4.0.
- Generated original static Linux fixtures with the installed GNU assembler
  and linker. The hello fixture runs directly on the Linux host and exits 37.
  The Windows-specific ABI fixture exits 99 on Linux because it deliberately
  requires lin32's empty environment; it is not a general Linux reference test.
- Booted the supplied XP image to the desktop using a disposable QCOW2 overlay.
  QEMU directory-backed FAT attachment failed, so added a local partitioned
  FAT16 transfer-image builder. XP detected the transfer volume as drive E:.
  Fixed invalid FAT file dates seen during directory listing and accounted for
  the supplied image's UK keyboard layout in the monitor input helper.
- The first attached-disk VM process was terminated by the execution service
  before the runtime was run. Added a detached VM launcher with PID/log output
  and explicit monitor shutdown. Restarted XP on the same disposable overlay.
- Added a generated XP test batch, serial result capture, and a host result
  verifier. Python syntax checks and whitespace checks pass. Guest runtime
  execution and syscall continuation have not yet been verified.

## 2026-10-09T14:39:04+01:00 — First XP results and TCC-only correction

Timestamp source: local system clock after the first XP test run.

- The first XP run completed all 12 tests with expected statuses and diagnostics.
  The hello ELF printed its message and exited 37; XP delivered `int 0x80` as
  exception `0xc0000005`, and the bridge resumed native execution after `write`.
- The ABI fixture passed argument/quote parsing, stack alignment, empty
  environment, BSS initialization, syscall return values, invalid descriptor and
  buffer errors, zero-length writes, and direction-flag preservation. Fault and
  malformed-input tests also passed. Serial output identified XP 5.1.2600.
- Fixed the host report parser to accept trailing spaces produced by XP `echo`.
  The verifier then confirmed all 12 results. Saved that preliminary capture as
  `build/xp-serial-gnu-fixtures.txt`, since its fixtures used GNU tools.
- The user required TCC as the only compiler/assembler/linker. Replaced both GNU
  build steps with `i386-tcc`'s integrated assembler/linker and converted fixture
  selection to preprocessor conditionals. TCC rejected subtraction of unresolved
  forward labels; moving the data declarations before their references resolved
  that without another assembler. Removed the previous generated object files.
- Rebuilt all fixtures using TCC only. The runtime's SHA-256 remained
  `b09a491eabea56d431354cc8ddbdb89cb4268d8ed6f474f1eaf28eb32a77973b`.
  The new TCC hello ELF ran directly on the Linux host and exited 37 with the
  expected output. The TCC fixture ELF layout differs, so XP must be rerun.
- Shut down XP cleanly from the guest. Next: regenerate the transfer disk and
  rerun the entire suite with the TCC-built fixtures before recording final
  acceptance evidence.

## 2026-10-09T14:41:35+01:00 — Switch to the requested installed toolchain

Timestamp source: local system clock during the final XP boot.

- The user selected `/tmp/tcc-cross`. Inspected only that authorized installation
  and changed the build's default prefix and include/library paths accordingly.
- Built the Windows executable with `/tmp/tcc-cross/bin/i386-win32-tcc` and
  every Linux fixture with `/tmp/tcc-cross/bin/i386-tcc`. Both report version
  0.9.27. Assembly and linking use TCC exclusively.
- The Windows executable's SHA-256 remains unchanged from the preliminary run.
  Regenerated the transfer disk and restarted XP for final validation of this
  toolchain's complete artifact set.
- Added a Python PE audit so subsequent import/header verification does not
  require GNU binutils. Prior `objdump` inspection is recorded above as historical
  work, not a current build dependency.

## 2026-10-09T14:44:03+01:00 — TCC-only initial version passes Windows XP tests

Timestamp source: local system clock immediately after final result verification.

- Copied the `/tmp/tcc-cross`-built runtime and all TCC-built Linux fixtures
  from the FAT16 transfer disk into the disposable XP filesystem and ran the
  generated batch. The final capture identifies Microsoft Windows XP 5.1.2600.
- `verify.py` passed all 12 tests, checking actual exit statuses and expected
  output/diagnostics from `build/xp-serial.txt`. The hello ELF printed its message
  and exited 37. Trace evidence shows native entry at `0x08048000`, `write` at
  `0x08048014`, and `exit` at `0x08048035`, with both Linux syscalls delivered
  through XP exception `0xc0000005`.
- Verified startup arguments including a quoted argument, 16-byte stack
  alignment, empty environment, zeroed BSS, syscall continuation and errno
  returns, a guest stack write buffer, and preserved guest direction flag.
  Invalid memory reads, illegal instructions, read-only text writes, truncated
  files, invalid header/segment bounds, unsupported ELF type/interpreter, and an
  unmapped entry point all returned the expected diagnostic and status 125.
- The Python PE audit confirmed a 9,216-byte i386 PE32 console executable,
  OS/subsystem version 4.0, and exactly the expected 13 `kernel32.dll` imports.
  No C runtime DLL is imported. SHA-256:
  `b09a491eabea56d431354cc8ddbdb89cb4268d8ed6f474f1eaf28eb32a77973b`.
- Saved the final evidence in `TEST_RESULTS.md` and documented build, runtime
  limits, test reproduction, and clean VM shutdown in `README.md`.
- Windows 98 and other Windows releases remain untested. The single-executable
  requirement and native execution architecture remain unchanged.

## 2026-10-09T14:45:36+01:00 — Final documentation and VM cleanup

Timestamp source: local system clock during final review.

- Shut down the final XP test session with the guest's `shutdown -s -t 0` command;
  QEMU exited and removed its monitor socket. The base XP image remains the
  backing file for the disposable overlay, not a writable VM disk.
- Reviewed the README and final Markdown evidence against the captured results.
  All Python support scripts pass syntax compilation, and documentation/source
  whitespace checks pass. Generated binaries, disks, screenshots, and raw logs
  remain ignored under `build/`.
- Prepared the initial implementation, original fixtures, reproducible build/test
  support, README, test report, and work log for a commit confined to `lin32/`.

## 2026-10-09T14:49:47+01:00 — Build cleaning and bytecode cache prevention

Timestamp source: local system clock at the start of this update.

- Added `python3 -B build.py --clean` to remove all generated build artifacts,
  including the disposable XP overlay and raw logs, plus local Python caches.
  The command refuses to clean while the VM monitor socket exists.
- Removed the existing `lin32/__pycache__` directory. Every support script now
  disables bytecode writes for its imports; documented `python3 -B` invocation.
- Replaced syntax verification through `py_compile` with in-memory `compile`
  checks, which do not create `.pyc` files. All support scripts pass these checks,
  the clean option appears in command help, and whitespace checks pass.
- Retained the existing tested build artifacts; the documented clean command
  removes them when requested. The runtime source and XP acceptance results are
  unchanged.

## 2026-10-09T14:53:11+01:00 — Shell-only build and clean entry points

Timestamp source: local system clock after clean/rebuild verification.

- Replaced `build.py` with executable POSIX `build.sh`. It directly invokes
  `/tmp/tcc-cross/bin/i386-win32-tcc` for the runtime and `i386-tcc` for the six
  executable Linux fixtures. TCC handles compilation, assembly, and linking.
- Recreated the six malformed ELF inputs using shell `printf`, `cp`, and `dd`.
  Added the XP batch as source-controlled `run.cmd`; the shell build copies it
  with Windows CRLF line endings. No Python is needed to build any test input.
- Added executable `clean.sh`, which removes generated build files and the local
  Python cache directory and refuses to run while the VM monitor socket exists.
  Updated the README and fixture comments to use the shell entry points.
- Shell syntax checks pass. Compared every shell-generated binary, malformed ELF
  input, and batch file against the previously XP-tested artifacts: all match
  byte for byte. Then ran `clean.sh` and rebuilt using `build.sh` without invoking
  Python; all artifact hashes matched again and no cache directory was created.
- Cleaning removed the disposable VM disks, screenshots, and raw captures;
  source-controlled `TEST_RESULTS.md` retains the XP evidence. No further XP run
  was needed because every test artifact and the runtime are unchanged in bytes.
- Python remains limited to optional PE inspection and XP test support. All
  project changes remain confined to `lin32/`.

## 2026-10-09T14:54:39+01:00 — Update generated-file ignore rules

Timestamp source: local system clock at the start of this update.

- Updated `lin32/.gitignore` to explain that `/build/` covers shell build outputs
  and optional XP disks, logs, and screenshots. Retained the recursive Python
  cache-directory ignore and added `*.py[cod]` for standalone bytecode files.
- Confirmed the ignore rules match representative build artifacts, cache
  directories, and standalone bytecode paths. Bytecode creation remains disabled
  in the optional Python helpers; ignoring it does not replace that requirement.

## 2026-10-09T14:57:25+01:00 — Move ignore rules to the repository root

Timestamp source: local system clock at the start of this update.

- At the user's explicit request, moved the lin32 ignore rules into the parent
  repository `.gitignore` and removed `lin32/.gitignore`. This root-file change is
  authorized by the latest instruction despite the earlier lin32-only scope.
- Scoped build and recursive Python bytecode/cache patterns to `/lin32/`,
  preserving the root file's existing rules for other projects.
- Verified that representative lin32 binaries, test disks, logs, screenshots,
  cache directories, and standalone bytecode files are still ignored.

## 2026-10-09T15:12:34+01:00 — Normal Windows main, C fixtures, and protected XP testing

Timestamp source: local system clock after base-image hash verification.

- Replaced the Windows `_start` function with normal `main(argc, argv)` and
  removed the custom command-line parser. TCC's normal startup supplies argv.
  The build now uses the installed cross-compilers' default search paths, with
  no explicit `-B`, `-I`, or `-L` settings and no Windows `-nostdlib` option.
- Replaced the assembly test-program source with six C programs under `tests/`.
  Their common header provides only minimal freestanding Linux entry/syscall
  support. Each program's behavior is written in C and enters through `main`.
  Linux `-nostdlib -static` avoids an external libc dependency for the fixtures.
- The C hello fixture runs directly on Linux and exits 37. The C ABI checks also
  pass directly on Linux with an empty environment and return 0.
- Rebuilt with `/tmp/tcc-cross` and audited the new 9,728-byte PE32 executable.
  Normal startup imports `msvcrt.dll` in addition to `kernel32.dll`; updated
  the import audit accordingly. OS/subsystem versions remain 4.0. Runtime SHA-256:
  `0c007ca0395816af2c266644af3468d5024fa48875a3d7936b93eb8e8382796a`.
- Changed the QEMU launcher to an explicit block graph with both the base file
  and its raw backing node marked `read-only=on`. The QCOW2 overlay is the only
  writable XP disk. Attached the separate FAT16 transfer disk using a temporary
  snapshot. This configuration assigned the transfer volume to D:.
- Used monitor keyboard input to open XP's command prompt, created `C:\lin32`,
  copied `D:*.*` there, and ran `run.cmd`. These guest C: writes go into the QCOW2
  overlay. All 12 tests passed under XP 5.1.2600, captured through COM1 and checked
  by the host verifier. Updated `TEST_RESULTS.md` with this run's evidence.
- Shut down XP cleanly. `sha256sum -c build/xp-base-before.sha256` returned `OK`,
  confirming the 4 GiB base image's contents were unchanged. Base SHA-256:
  `ceb0f4f85a63679ecd6943091e40db0331886c663ce29e8dfb43e21ec3c778bb`.
- Added the complete host build, FAT transfer, overlay boot, guest copy/run,
  serial capture, and shutdown/hash-verification procedure to the README.
  Shell syntax, optional Python in-memory syntax, and whitespace checks pass;
  no Python cache directory was created. Other Windows hosts remain untested.

## 2026-10-09T15:56:22+01:00 — Dynamic self-hosting compiler, Linux verification

Timestamp source: local system clock during development. The earlier fixed-buffer
prototype was preliminary and was replaced following the user's dynamic-memory
instruction; its hashes are not acceptance results.

- Added original `cc_min.c`, a freestanding C-subset compiler which directly emits
  static Linux/i386 ELF machine code. TCC creates stage 0; generated compilers
  compile the same source without invoking another compiler or using an embedded
  compiler image. Added independent `cc_demo.c`, shell staging and XP staging.
- Replaced every compiler buffer and symbol/local table with dynamically allocated
  vectors backed by Linux `brk`. Removed fixed source, code, name, string, symbol,
  local and call-argument ceilings. Added data relocations and adjacent ELF
  code/data placement instead of a fixed strings reservation/data-address gap.
  Vector allocation retains old storage until process exit. Integer/address
  representability, allocation success and the process stack remain constraints.
- Extended lin32 with Windows-backed relative-path open/read/write/close, errno
  mapping and growable native `brk` mappings. Added C file-I/O and heap-growth
  regressions. Heap shrinking retains committed backing, documented explicitly.
- Linux stages 1/2/3 are byte-identical (34,015 bytes), SHA-256
  `115dc285a2629de8ff7accb656cfa40db999d07a510f0bd9f42516053ca5bdc2`.
  Stage 3's independent demo executes and exits 42. Both new syscall fixtures
  also pass directly on Linux.
- Growth regression exceeds all former compiler buffer/table/argument ceilings:
  294,034-byte source, 557,425-byte ELF, 2,600 globals, 300 locals, 5,000-character
  identifier, 70,000-byte string, 12 arguments. Bootstrap/self-built output matches
  and native Linux execution exits 42.
- PE audit passes for the 11,776-byte runtime, SHA-256
  `f01e6bc7c2e16cb81830aaaaaf36218d9a6841d69bc2eb180c21555ceb32bbcb`.
  Imports remain kernel32/msvcrt; GetLastError is added for errno translation.
- Stopped the preliminary VM, regenerated the separate transfer disk, and started
  a fresh disposable XP overlay with the base explicitly read-only. Copied the
  files from D: into C:\lin32 using guest keyboard input. XP acceptance testing
  is still running at this entry; no XP stage result is claimed yet.

## 2026-10-09T16:06:32+01:00 — XP self-hosting acceptance and unchanged base image

Timestamp source: local system clock after all verifiers and base hash completed.

- Ran `run.cmd` and `stages.cmd` in XP 5.1.2600. The host verifier accepted all
  14 runtime cases, including file I/O and heap growth. The staging verifier
  accepted all 14 stage/status records and seven successful `fc /b` comparisons.
- Windows stages 1/2/3 are byte-identical to one another and the three Linux
  stages, so all six compiler files share SHA-256
  `115dc285a2629de8ff7accb656cfa40db999d07a510f0bd9f42516053ca5bdc2`.
  Stage 0 remains the distinct TCC bootstrap. No other compiler is invoked by
  any self-built stage, and no guest instruction emulation is added to lin32.
- XP stage 3 compiled and executed the independent demo and large dynamic-growth
  source. Both guest programs exited 42; each generated ELF matched its Linux
  reference byte-for-byte. The growth case takes longer in QEMU because the
  minimal compiler uses linear symbol lookup; it completed successfully.
- Shut down XP normally and confirmed QEMU exited. Post-shutdown base-image hash
  check returned `OK`, preserving SHA-256
  `ceb0f4f85a63679ecd6943091e40db0331886c663ce29e8dfb43e21ec3c778bb`.
- Updated README with compiler subset, allocation behavior, shell-only staging,
  limitations and exact XP commands; recorded normalized COM1 stage evidence in
  SELFHOST_RESULTS.md. Marked TEST_RESULTS.md as the historical 12-case report.
- Shell/helper syntax and git whitespace checks pass. No fixed compiler arrays,
  Python caches or bytecode files remain. Parent ignore rules continue to cover
  build outputs. Only lin32 source/scripts/Markdown reports are checked in.
  Windows 98 and other hosts remain to be validated with the identical runtime.
