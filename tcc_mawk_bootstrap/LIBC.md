# Musl-Derived Glibc-ABI Runtime

This document describes a possible path to replacing the Slackware 10.2 initrd
glibc runtime with a musl-derived libc that preserves binary compatibility for
the existing initrd binaries.

The target is not "use musl instead of glibc" in the usual sense. The target
is:

- keep the initrd binaries unchanged
- keep them as `ELF32` i386 binaries
- replace the glibc runtime they load with a new implementation
- allow the initrd to keep running as before

## Goal

The immediate compatibility goal is:

1. take the existing Slackware 10.2 initrd
2. replace its glibc runtime pieces with a musl-derived implementation
3. keep the existing initrd binaries working without recompilation

This is a binary-compatibility target, not merely a source-compatibility
target.

The scope is intentionally narrow:

- i386 only
- Slackware 10.2 initrd only
- no TLS requirement
- no requirement to support arbitrary third-party binaries at first

## What The Initrd Uses

The current initrd contains 32-bit binaries using:

- interpreter: `/lib/ld-linux.so.2`
- `libc.so.6`

Some binaries also depend on:

- `libm.so.6`
- `libpthread.so.0`
- `libdl.so.2`
- `librt.so.1`
- `libcrypt.so.1`
- `libutil.so.1`
- `libnsl.so.1`
- `libresolv.so.2`
- `libanl.so.1`
- `libnss_files.so.2`
- `libnss_dns.so.2`

The initrd also includes third-party libraries such as:

- `libext2fs.so.2`
- `libcom_err.so.2`
- `libe2p.so.2`
- `libuuid.so.1`
- `libblkid.so.1`
- `libncurses.so.5`

Those third-party libraries are themselves glibc-linked, so the replacement
runtime must be compatible enough for them too.

## Core Observation

For this project, ABI layout compatibility matters more than source-level API
compatibility.

During the `tar` work, the important fact was:

- musl i386 `struct stat` matches glibc i386 `struct stat64`
- musl i386 `struct dirent` matches glibc i386 `struct dirent64`

That is the kind of issue this runtime must solve systematically.

The new runtime will succeed or fail mostly on:

- structure layouts
- symbol names
- symbol versions
- loader behavior
- stdio behavior
- process/signal semantics

not on whether plain POSIX functions happen to exist.

## What Has To Be Replaced

At minimum, the replacement runtime must provide:

1. a compatible loader at `/lib/ld-linux.so.2`
2. a compatible `libc.so.6`
3. enough companion libraries under glibc sonames for the initrd to start

That likely means providing these sonames:

- `libc.so.6`
- `libm.so.6`
- `libpthread.so.0`
- `libdl.so.2`
- `librt.so.1`
- `libcrypt.so.1`
- `libutil.so.1`
- `libnsl.so.1`
- `libresolv.so.2`
- `libanl.so.1`

Some of these may internally be thin wrappers or aliases, but the visible ABI
must match what the binaries expect.

## Loader Requirements

The loader is a first-class part of the problem.

It must:

- live at `/lib/ld-linux.so.2`
- load the existing initrd binaries unchanged
- resolve the needed shared libraries
- honor the required relocation behavior for those binaries
- understand the symbol versioning used by the old glibc-linked binaries

Without a compatible loader, even a mostly-correct `libc.so.6` is not enough.

## Libc ABI Requirements

The replacement `libc.so.6` must provide:

- glibc-compatible startup ABI
- glibc-compatible exported symbols
- glibc-compatible data layout for exposed types used by initrd binaries

Important examples include:

- `__libc_start_main`
- `__errno_location`
- ctype accessor symbols
- stdio entry points and `FILE` layout
- `stat`/`fstat`/`lstat` family
- `opendir`/`readdir`/`closedir` family
- signal APIs
- `setjmp`/`longjmp`
- environment handling
- pwd/grp and basic resolver hooks if used

## Symbol Versioning

Broad glibc binary compatibility normally requires symbol versioning.

For the initrd-scoped target, the practical approach is:

1. audit which versioned symbols the initrd binaries actually require
2. provide only that set first

The point is not to emulate all of glibc immediately. The point is to satisfy
the exact binary population we care about.

## TLS And Threads

This design explicitly assumes no TLS requirement for the first phase.

That helps, but it does not make the project small.

Without TLS, a first-phase runtime may still be able to:

- run the initrd shell and utilities
- support mostly single-threaded binaries
- provide a minimal `libpthread.so.0` as a compatibility library

But even without TLS, these still remain hard:

- loader ABI
- symbol versioning
- stdio ABI
- directory and stat layout compatibility
- resolver/NSS behavior

## NSS And Resolver

The initrd ships:

- `libnss_files.so.2`
- `libnss_dns.so.2`

So the runtime must choose one of these approaches:

1. implement enough glibc-style NSS loading for the existing modules
2. replace the NSS modules with compatible substitutes
3. avoid runtime paths that require NSS during the initrd stage

For a true drop-in replacement, option 1 or 2 is required eventually.

## Realistic Implementation Strategy

The least risky plan is to treat this as an initrd-specific compatibility
runtime rather than a general glibc replacement.

### Phase 1: Audit

Collect the exact ABI surface of the initrd:

- list every dynamic binary
- list every `DT_NEEDED`
- list every versioned symbol import
- list every glibc-family library actually required at runtime

Deliverable:

- machine-generated manifest of the initrd runtime ABI target

### Phase 2: Loader And Core Libc Skeleton

Create a musl-derived runtime layout that can be installed into the initrd:

- `/lib/ld-linux.so.2`
- `/lib/libc.so.6`
- placeholder companion sonames

Goal:

- start a trivial dynamically linked i386 binary built against the target ABI

### Phase 3: Layout-Compatible Interfaces

Implement the high-risk layout-sensitive interfaces first:

- `stat64`-compatible path
- `dirent64`-compatible path
- stdio
- `setjmp`/`longjmp`
- signals
- process and file-descriptor basics

Goal:

- run simple existing initrd binaries correctly

### Phase 4: Companion Libraries

Provide working compatibility libraries for:

- `libm`
- `libdl`
- `librt`
- `libpthread`
- `libcrypt`
- `libutil`
- `libnsl`
- `libresolv`
- `libanl`

Some may be wrappers around one internal implementation, but sonames and
exports must match.

### Phase 5: NSS

Support the initrd's hostname/user lookup requirements:

- either compatible `libnss_*`
- or a replacement approach with the same observable ABI

### Phase 6: Initrd Trial Replacement

Drop the runtime into a copied initrd and test:

- shell startup
- mount utilities
- archive utilities
- installer scripts
- filesystem tools

Goal:

- existing initrd binaries continue running without recompilation

## What This Is Not

This is not:

- a small patch to musl
- a normal musl port
- a direct consequence of building more Slackware packages with TCC

It is a separate runtime project that happens to benefit from the ABI
knowledge gained while building packages in the airlock.

## Why This May Still Be Feasible

The target is narrow enough to make the work conceivable:

- one architecture
- one distro release
- one initrd population
- no TLS requirement

That is much smaller than trying to replace glibc for a whole general-purpose
Linux distribution.

So the right framing is:

- not "replace glibc everywhere"
- but "build a musl-derived glibc-ABI runtime sufficient for the Slackware
  10.2 initrd"

## Current Recommendation

Do not start by writing code blindly.

Start with an ABI audit of the actual initrd binaries and libraries, then
define the minimum required compatibility set from that audit.

That audit should drive:

- which sonames must exist
- which versioned symbols must exist
- which structure layouts must be matched
- which subsystems can be stubbed at first

Once that is written down, implementation work can proceed in a bounded and
measurable way.
