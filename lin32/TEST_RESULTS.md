# Windows XP test results: normal main and C fixtures

This is the earlier 12-case acceptance run. The updated runtime, 14-case suite,
and dynamic compiler self-hosting verification are recorded in
[SELFHOST_RESULTS.md](SELFHOST_RESULTS.md).

Verified at **2026-10-09T15:12:34+01:00** using the supplied Windows XP disk image
through a disposable QCOW2 overlay. Tests ran in Microsoft Windows XP
**5.1.2600** under installed QEMU 6.2.0. The Windows executable and every Linux
program were compiled, assembled, and linked using **TCC 0.9.27 from
`/tmp/tcc-cross` exclusively**, with no explicit include/library search paths.
Building requires the shell and TCC; Python is only optional test support.

The Windows launcher now has a normal `main(argc, argv)` and TCC standard
startup. All six executable Linux fixtures are C programs with normal `main`
functions; their shared header supplies minimal freestanding entry/syscall
wrappers. The six malformed inputs are derived from the C hello ELF. This
report supersedes the earlier assembly-fixture/custom-startup acceptance report;
[WORK_LOG.md](WORK_LOG.md) retains the history.

## Executable identity

- Artifact: `build/share/lin32.exe`
- Size: 9728 bytes
- Format: i386 PE32 console executable
- OS and subsystem versions: 4.0
- SHA-256: `0c007ca0395816af2c266644af3468d5024fa48875a3d7936b93eb8e8382796a`
- DLL dependencies: `kernel32.dll` and `msvcrt.dll`.

The Python PE audit found these imports:

- `kernel32.dll`: `WriteFile`, `ExitProcess`, `CreateFileA`, `GetFileSize`, `VirtualAlloc`, `ReadFile`, `CloseHandle`, `VirtualProtect`, `GetCurrentProcess`, `FlushInstructionCache`, `GetStdHandle`, `SetErrorMode`.
- `msvcrt.dll`: `__set_app_type`, `_controlfp`, `__argc`, `__argv`, `_environ`, `__getmainargs`, `exit`, `_XcptFilter`, `_exit`, `_except_handler3`.

These header/import checks support the intended baseline; they do not establish
runtime compatibility with an untested Windows release.

## Base image preservation

QEMU opened `/home/foo/src/gpt/xp/winxp.img` through an explicit read-only file
node and read-only raw backing node. Only `build/xp-overlay.qcow2` was writable.
The separate transfer disk was attached with temporary snapshot writes.

After the guest shut down cleanly, `sha256sum -c build/xp-base-before.sha256`
returned:

```text
/home/foo/src/gpt/xp/winxp.img: OK
```

The base image's SHA-256 before and after was:

```text
ceb0f4f85a63679ecd6943091e40db0331886c663ce29e8dfb43e21ec3c778bb
```

The programs were copied from the transfer disk, assigned D: in this run, into
`C:\lin32` inside XP. C: writes were captured by the QCOW2 overlay. No program
files or guest filesystem changes were written to the base image.

## Results

`python3 -B verify.py` checked the complete report captured through XP COM1 and
confirmed **all 12 tests passed**. Expected error statuses deliberately test
failure handling.

| Fixture | Expected and observed status | Verified behavior |
| --- | ---: | --- |
| `hello` | 37 | C program output, correct write return value, syscall continuation and exit |
| `checks` | 0 | C startup arguments/quoting, aligned initial stack, empty environment, BSS, errno results, zero-length write, direction flag |
| `stack` | 0 | Linux write from a C local stack buffer |
| `badmem` | 125 | Invalid memory read diagnosed |
| `illegal` | 125 | Illegal instruction diagnosed |
| `readonly` | 125 | Write to read-only executable text diagnosed |
| `short` | 125 | Truncated ELF header rejected |
| `headers` | 125 | Out-of-file program header table rejected |
| `dynamic` | 125 | Unsupported ELF type rejected |
| `bounds` | 125 | Invalid load-segment bounds rejected |
| `entry` | 125 | Unmapped entry point rejected |
| `interp` | 125 | Unsupported dynamic interpreter rejected |

Linux reference runs also passed: the C hello ELF exited 37; the C ABI checks
exited 0 when launched with an empty environment using `env -i`.

The XP trace shows `int 0x80` delivered as exception `0xc0000005`. The SEH handler
recognizes the instruction, dispatches the syscall, updates EAX/EIP, and resumes
native execution. The runtime contains no CPU interpreter or translator. QEMU
supplies the Windows test machine.

## Final serial capture

Line endings and trailing whitespace are normalized for Markdown. This capture
comes from `build/xp-serial.txt` after the normal-main/C-fixture XP run.

```text
Microsoft Windows XP [Version 5.1.2600]
TEST hello EXIT 37 EXPECT 37
Hello from native Linux i386 on Windows!
lin32: native entry=0x08048000 esp=0x0050efa0
lin32: int80 exception=0xc0000005 eip=0x08048035 syscall=0x00000004
lin32: int80 exception=0xc0000005 eip=0x0804801b syscall=0x00000001

TEST checks EXIT 0 EXPECT 0
ABI checks passed

TEST stack EXIT 0 EXPECT 0
stack
TEST badmem EXIT 125 EXPECT 125
lin32: guest fault exception=0xc0000005 eip=0x0804806e

TEST illegal EXIT 125 EXPECT 125
lin32: guest fault exception=0xc000001d eip=0x0804806e

TEST readonly EXIT 125 EXPECT 125
lin32: guest fault exception=0xc0000005 eip=0x08048073

TEST short EXIT 125 EXPECT 125
lin32: truncated ELF header

TEST headers EXIT 125 EXPECT 125
lin32: invalid ELF program header table

TEST dynamic EXIT 125 EXPECT 125
lin32: expected little-endian static ELF32/i386 ET_EXEC

TEST bounds EXIT 125 EXPECT 125
lin32: invalid ELF load segment bounds

TEST entry EXIT 125 EXPECT 125
lin32: ELF entry is outside a readable executable segment

TEST interp EXIT 125 EXPECT 125
lin32: dynamic ELF interpreter not supported yet

LIN32_TESTS_COMPLETE
```

## Limits of this validation

This validates the supplied XP image and the documented initial static Linux
ELF/syscall subset. Windows 98 and other releases have not been tested. Dynamic
linking, Linux TLS, threads, signals, process creation, and alternate syscall
entry mechanisms remain future work. See [README.md](README.md) for the full
transfer/run procedure and current limits.
