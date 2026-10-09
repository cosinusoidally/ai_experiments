# Dynamic cc_min self-hosting verification

This report records the dynamically allocated compiler and native lin32 runtime.
The compiler source, staging scripts and growth regression were written locally;
no external compiler source or embedded compiler binary is used. TCC 0.9.27 in
`/tmp/tcc-cross` creates the Windows executable and Linux stage-0 compiler using
its own assembler/linker. Subsequent stages are emitted directly by cc_min.

## Stage definitions and Linux results

Stage 0 is the TCC bootstrap. Three further generations compile exactly the same
`cc_min.c` source: stage 0 creates stage 1, stage 1 creates stage 2, and stage 2
creates stage 3. Stage 0 is not expected to match cc_min-generated code.
`./stages.sh` performs these builds and `cmp` comparisons on native Linux.

| Artifact | Size in bytes | SHA-256 |
| --- | ---: | --- |
| TCC bootstrap `cc0.elf` | 22100 | `509dabd25d7027bbbeae5e82e2275b1be89c719b91d858bc554a02f3257b9cbd` |
| Linux stage 1 `lc1.elf` | 34015 | `115dc285a2629de8ff7accb656cfa40db999d07a510f0bd9f42516053ca5bdc2` |
| Linux stage 2 `lc2.elf` | 34015 | `115dc285a2629de8ff7accb656cfa40db999d07a510f0bd9f42516053ca5bdc2` |
| Linux stage 3 `lc3.elf` | 34015 | `115dc285a2629de8ff7accb656cfa40db999d07a510f0bd9f42516053ca5bdc2` |

Both `cmp` calls returned 0. Stage 3 compiled `cc_demo.c`, which printed
`ok` and `cc_min generated program OK` and exited 42 on Linux. Demo ELF SHA-256:
`b030076d6fd1d569b2182fe9d621148e8d42bd21f6f8cd318d25a448892d9a42`.

## Dynamic growth regression

`./test_growth.sh` generates a 294,034-byte source containing 2,600 globals,
300 locals, a 5,000-character identifier, a 70,000-character string and a
12-argument call. Its repeated expressions produce a 557,425-byte ELF, exceeding
the old fixed source/code/string/name/table/argument capacities. The TCC bootstrap
and self-built stage 3 produce byte-identical ELF files; execution exits 42.
Growth ELF SHA-256:
`52671a6bc58dfb910b9bc0f3a4ae165409c59884ad3afcf0b774500825213999`.

All compiler buffers/tables use growable runtime allocations via Linux brk.
The allocator keeps old vector storage until process exit. Available memory,
i386 arithmetic/address representability and the process stack bound sizes;
the compiler has no fixed resource-count ceilings. lin32 still has its documented
initial loader/stack limits. This compiler implements the documented C subset,
not all of ISO C. Identical self-hosted output demonstrates stabilization and
repeatability; it does not establish correctness for every accepted program.

## Windows artifact and XP test procedure

The single Windows runtime is 11,776 bytes, PE32/i386 console, with OS/subsystem
versions 4.0 and imports only from kernel32.dll/msvcrt.dll. PE audit passed.
Runtime SHA-256:
`f01e6bc7c2e16cb81830aaaaaf36218d9a6841d69bc2eb180c21555ceb32bbcb`.

The host ran the Linux stages and growth test before creating the separate FAT16
transfer image. QEMU opened winxp.img explicitly read-only beneath a fresh writable
QCOW2 overlay. Through monitor keyboard events, XP copied D:*.* into C:\lin32,
then ran run.cmd and stages.cmd. Those guest writes affect only the overlay.
The batches send their reports via COM1 to build/xp-serial.txt; verify.py and
verify_stages.py validate actual output/status/comparison records. The README
contains each host and guest step, including shutdown and base-image hashing.

## Windows XP results

Windows XP 5.1.2600 completed every stage successfully. `fc /b` returned 0 for
Windows stage 1/2, stage 2/3, and each Windows/Linux stage pair. All six generated
compiler files therefore have the same 34,015-byte contents and SHA-256 shown
above for Linux stage 1. Windows stage 3 generated the demo and growth ELF files;
both matched their Linux reference byte-for-byte and executed under lin32 with
exit 42. There were seven successful binary comparisons in total.

The extended regression suite passed all 14 cases: hello, ABI checks, stack,
bad-memory fault, illegal instruction, read-only fault, truncated header, bad
header table, wrong ELF type, invalid segment bounds, invalid entry, interpreter
rejection, file I/O and dynamic heap growth. The heap test preserves bytes while
growing beyond 64 KiB and 128 KiB boundaries.

Captured self-hosting COM1 evidence (line endings normalized):

```text
Microsoft Windows XP [Version 5.1.2600]
STAGE win1 EXIT 0 EXPECT 0 
STAGE win2 EXIT 0 EXPECT 0 
STAGE win3 EXIT 0 EXPECT 0 
Comparing files wc1.elf and WC2.ELF
FC: no differences encountered

STAGE win12 EXIT 0 EXPECT 0 
Comparing files wc2.elf and WC3.ELF
FC: no differences encountered

STAGE win23 EXIT 0 EXPECT 0 
Comparing files wc1.elf and LC1.ELF
FC: no differences encountered

STAGE cross1 EXIT 0 EXPECT 0 
Comparing files wc2.elf and LC2.ELF
FC: no differences encountered

STAGE cross2 EXIT 0 EXPECT 0 
Comparing files wc3.elf and LC3.ELF
FC: no differences encountered

STAGE cross3 EXIT 0 EXPECT 0 
STAGE demo_compile EXIT 0 EXPECT 0 
ok
cc_min generated program OK
STAGE demo_run EXIT 42 EXPECT 42 
Comparing files wdemo.elf and LDEMO.ELF
FC: no differences encountered

STAGE demo_cross EXIT 0 EXPECT 0 
STAGE growth_compile EXIT 0 EXPECT 0 
STAGE growth_run EXIT 42 EXPECT 42 
Comparing files wgrowth.elf and LGROWTH.ELF
FC: no differences encountered

STAGE growth_cross EXIT 0 EXPECT 0 
WIN_SELFHOST_COMPLETE
```

## Base-image preservation and final checks

XP shut down normally using `shutdown -s -t 0`, and its QEMU process exited.
The post-shutdown `sha256sum -c build/selfhost-base-before.sha256` returned `OK`.
The unchanged 4 GiB base image SHA-256 is:
`ceb0f4f85a63679ecd6943091e40db0331886c663ce29e8dfb43e21ec3c778bb`.

Shell syntax, Python helper syntax compiled in memory, and git whitespace checks
passed. No Python cache/bytecode artifacts exist under lin32. Build and staging
scripts require no Python; Python remains optional XP/audit support. Generated
executables, guest overlays and raw logs stay in the ignored build directory.
Other Windows releases have not been tested with this executable.

Final verification timestamp: **2026-10-09T16:06:32+01:00** (local system clock after hash verification).
