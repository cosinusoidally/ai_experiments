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
