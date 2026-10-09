# Initial Windows XP test results

Verified at **2026-10-09T14:44:03+01:00** using the supplied Windows XP disk image
through a disposable QCOW2 overlay. The original raw image was not modified by
VM writes. Tests ran in Microsoft Windows XP **5.1.2600** under installed QEMU
6.2.0. The final Windows executable and every Linux fixture were compiled,
assembled, and linked using **TCC 0.9.27 from `/tmp/tcc-cross` exclusively**.
The preliminary GNU-built fixture run is not the acceptance run reported here.

## Executable identity

- Artifact: `build/share/lin32.exe`
- Size: 9,216 bytes
- Format: i386 PE32 console executable
- OS and subsystem versions: 4.0
- SHA-256: `b09a491eabea56d431354cc8ddbdb89cb4268d8ed6f474f1eaf28eb32a77973b`
- Imports: only `kernel32.dll`, with no C runtime DLL dependency.

The Python PE audit found these imports: `WriteFile`, `ExitProcess`, `GetCommandLineA`, `VirtualAlloc`, `CreateFileA`, `GetFileSize`, `ReadFile`, `CloseHandle`, `VirtualProtect`, `GetCurrentProcess`, `FlushInstructionCache`, `GetStdHandle`, `SetErrorMode`.
These header/import checks support the intended Windows 98 baseline; they do
not establish runtime compatibility with an untested Windows release.

## Results

`python3 verify.py` checked the complete report captured through XP COM1 and
confirmed **all 12 tests passed**. Expected error statuses are deliberate tests
of failure handling, not successful execution of the invalid programs.

| Fixture | Expected and observed status | Verified behavior |
| --- | ---: | --- |
| `hello` | 37 | Native Linux output, correct write return value, syscall continuation and exit |
| `checks` | 0 | Startup arguments/quoting, aligned stack, empty environment, BSS, errno results, zero-length write, direction flag |
| `stack` | 0 | Linux write from a guest stack buffer |
| `badmem` | 125 | Invalid memory read diagnosed |
| `illegal` | 125 | Illegal instruction diagnosed |
| `readonly` | 125 | Write to read-only executable text diagnosed |
| `short` | 125 | Truncated ELF header rejected |
| `headers` | 125 | Out-of-file program header table rejected |
| `dynamic` | 125 | Unsupported ELF type rejected |
| `bounds` | 125 | Invalid load-segment bounds rejected |
| `entry` | 125 | Unmapped entry point rejected |
| `interp` | 125 | Unsupported dynamic interpreter rejected |

The trace demonstrates that XP reports the Linux `int 0x80` entry as exception
`0xc0000005`. The SEH handler recognizes the instruction, dispatches the syscall,
updates EAX/EIP, and resumes native execution. The runtime contains no CPU
interpreter or instruction translator. QEMU supplies the Windows test machine.

## Final serial capture

The following capture has line endings and trailing whitespace normalized for
Markdown. It was read from `build/xp-serial.txt` after the final TCC-only run.

```text
Microsoft Windows XP [Version 5.1.2600]
TEST hello EXIT 37 EXPECT 37
Hello from native Linux i386 on Windows!
lin32: native entry=0x08048000 esp=0x0050efa0
lin32: int80 exception=0xc0000005 eip=0x08048014 syscall=0x00000004
lin32: int80 exception=0xc0000005 eip=0x08048035 syscall=0x00000001

TEST checks EXIT 0 EXPECT 0
ABI checks passed

TEST stack EXIT 0 EXPECT 0
stack
TEST badmem EXIT 125 EXPECT 125
lin32: guest fault exception=0xc0000005 eip=0x08048005

TEST illegal EXIT 125 EXPECT 125
lin32: guest fault exception=0xc000001d eip=0x08048000

TEST readonly EXIT 125 EXPECT 125
lin32: guest fault exception=0xc0000005 eip=0x08048000

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
ELF/syscall subset. Windows 98 and other Windows releases have not been tested.
Dynamic linking, Linux TLS, threads, signals, process creation, and alternate
Linux syscall entry mechanisms remain future work. See [README.md](README.md)
for reproducible commands and current runtime limits.
