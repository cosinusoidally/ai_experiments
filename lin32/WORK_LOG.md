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
