# Airlock Stage2 Bootstrap

This directory contains an "airlock" bootstrap path that rebuilds `tcc-0.9.27`
inside a rootless Slackware 10.2 environment.

The entry point is:

- [test-airlock-bootstrap-stage2.sh](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/test-airlock-bootstrap-stage2.sh)
- [test-airlock-bootstrap-portable.sh](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/test-airlock-bootstrap-portable.sh)

## Goal

The goal is to start from a host-built seed `stage2/tcc`, inject only source
inputs and that seed compiler into a Slackware 10.2 initrd, and then perform a
3-stage TCC bootstrap inside the airlock.

The important final product is a relocatable `tcc-portable/` directory. That
bundle can be tarred up, moved to another host, unpacked anywhere, and then
used through `tcc-glibc` without rewriting embedded paths.

The first airlock produces both:

- a `tcc-portable/` directory tree
- a normalized `tcc-portable.tar`

The second airlock takes that tarball, injects it into a fresh Slackware 10.2
airlock, extracts it inside the airlock, uses the extracted `tcc-glibc`, and
regenerates the same tarball again.

## Inputs

The outer script expects these inputs in `tcc_mawk_bootstrap`:

- `tcc-0.9.27.tar.bz2`
- `musl-1.1.24.tar.gz`
- `unbz2.c`
- `untar.c`
- `M2libc/bootstrappable.c`
- `M2libc/bootstrappable.h`
- `airlock/crt.c`
- `airlock/seed-headers/*`
- `airlock/inside-airlock.sh.in`

It also expects:

- `../../slackware-10.2/iso/isolinux/initrd.img`
- `~/src/woody_mawk/mawk`
- a previously built seed compiler at
  `artifacts/bootstrap-i386-mawk/stage2/tcc`

That seed compiler is produced by:

- [bootstrap-i386-mawk.awk](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/bootstrap-i386-mawk.awk)

## What Gets Injected

The outer script unpacks the Slackware initrd with `debugfs`, then injects:

- `mawk`
- the seed `stage2/tcc`
- `unbz2.c`
- `untar.c`
- `bootstrappable.c`
- `bootstrappable.h`
- `tcc-0.9.27.tar.bz2`
- `musl-1.1.24.tar.gz`
- minimal seed headers from `airlock/seed-headers/`
- `airlock/crt.c`
- a copied `inside-airlock.sh` derived from `airlock/inside-airlock.sh.in`

No prebuilt `libtcc1.a` is injected.

For the second airlock run, the injected compiler input is:

- `artifacts/airlock-bootstrap-stage2/tcc-portable.tar`

In that mode, no separate seed `tcc` binary is injected. The extracted
portable tarball is the compiler input.

## Outer Script

The outer script does four jobs:

1. Unpack the Slackware initrd into `artifacts/airlock-bootstrap-stage2/rootfs`.
2. Prepare a writable work tree at
   `artifacts/airlock-bootstrap-stage2/work`.
3. Copy the static airlock support files into that work tree.
4. Run the inner script with `bwrap` in a rootless environment.

No musl headers are pre-generated on the host. They are derived inside the
airlock from `musl-1.1.24.tar.gz`.

For `test-airlock-bootstrap-stage2.sh`, the outer script also writes a
normalized tarball after the airlock run:

- `artifacts/airlock-bootstrap-stage2/tcc-portable.tar`

That tarball is the input to `test-airlock-bootstrap-portable.sh`.

## Inner Script

The inner script is:

- [airlock/inside-airlock.sh.in](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/inside-airlock.sh.in)

At runtime it is copied to `/work/inside-airlock.sh` and placeholder-expanded.

Inside the airlock it does this:

1. Obtain the bootstrap compiler:
   - first airlock: use the injected seed `stage2/tcc`
   - second airlock: extract `tcc-portable.tar` and use the extracted
     `tcc-glibc`
2. Build `unbz2`.
3. Build `untar`.
3. Extract `tcc-0.9.27.tar.bz2`.
4. Extract `musl-1.1.24.tar.gz`.
5. Generate a local musl include tree inside `/work/bootstrap/musl-headers`.
6. Install wrapper headers and driver scripts used to keep the TCC build off
   host headers and host startup objects.
7. Build `libtcc1.o`, `alloca86.o`, and `libtcc1.a` inside the airlock from
   TCC source.
8. Build `stage0/tcc` with the injected seed compiler.
9. Build `stage1/tcc` with `stage0/tcc`.
10. Build `stage2/tcc` with `stage1/tcc`.
11. Assemble `tcc-portable/` from the final compiler, headers, and runtime
    objects.
12. Print `stage2/tcc -v`.

The compiler stages are built in `ONE_SOURCE=1` style: each stage compiles
`tcc.c` once to `tcc.o`, with `-DONE_SOURCE=1`, and then links that single
object into `tcc`.

After `bwrap` exits, the outer script checks that:

- `stage1/tcc`
- `stage2/tcc`

are bit-identical.

For the second airlock, the outer script also compares:

- input `tcc-portable.tar`
- regenerated `tcc-portable.tar`

and expects them to match byte-for-byte.

## Seed Headers And CRT

The minimal headers under:

- [airlock/seed-headers](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/seed-headers)

exist only to compile `unbz2.c` and `untar.c` with the seed `tcc`.

The startup object source:

- [airlock/crt.c](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/crt.c)

provides a tiny i386 `_start` entry point so this path does not depend on
injecting `crt1.o`, `crti.o`, or similar startup objects.

## Driver Model

The in-airlock bootstrap does not patch the extracted TCC sources.

Instead it uses a generated driver script around each stage compiler. That
driver is responsible for forcing the build environment:

- `-nostdinc`
- wrapper headers from `airlock/build-headers`
- musl include paths generated inside the airlock
- `-nostdlib` at link time
- `airlock/crt.c`
- `libtcc1.o`
- `alloca86.o`
- dynamic glibc linkage through `libc.so.6`, `libm.so.6`, and `libdl.so.2`

This keeps the build off host headers and startup objects while still producing
a glibc-dynamically-linked compiler.

There are two distinct header layers:

- `airlock/seed-headers/` is only for building `unbz2.c` and `untar.c` with
  the injected seed compiler.
- `airlock/build-headers/` is used by the TCC stage drivers and wraps the
  musl headers generated inside the airlock.

## Host-Usable Final Compiler

The airlock run emits a portable bundle at:

- `work/bootstrap/tcc-portable`

and a normalized tarball at:

- `artifacts/airlock-bootstrap-stage2/tcc-portable.tar`
- `artifacts/airlock-bootstrap-portable/tcc-portable.tar`

The important files inside that directory are:

- `bin/tcc`
- `bin/tcc-driver`
- `bin/tcc-glibc`
- `include/`
- `include/musl/`
- `lib/tcc/include/`
- `lib/tcc/libtcc1.a`
- `lib/tcc/libtcc1.o`
- `lib/tcc/alloca86.o`
- `lib/tcc/crt.c`

`bin/tcc-driver` is the explicit driver with all include and library overrides.
`bin/tcc-glibc` is a thin wrapper over that driver and is the intended
user-facing entry point.

The driver is relocatable. It derives its own root from `dirname "$0"` and then
finds:

- the compiler binary at `../bin/tcc`
- wrapper headers at `../include`
- musl headers at `../include/musl`
- TCC runtime objects at `../lib/tcc`

For glibc linkage it searches standard 32-bit library directories at runtime
for:

- `libc.so.6`
- `libm.so.6`
- `libdl.so.2`

So the directory itself can be moved freely as long as the destination host has
compatible i386 glibc shared libraries available in standard locations, or via
`TCC_GLIBC_LIBDIRS`.

The raw `bin/tcc` binary is included as part of the bundle, but the supported
way to use the portable compiler is through `tcc-glibc`.

## Artifacts

The airlock run writes into:

- [artifacts/airlock-bootstrap-stage2](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/artifacts/airlock-bootstrap-stage2)

Important outputs are:

- `work/bootstrap/stage0/tcc`
- `work/bootstrap/stage1/tcc`
- `work/bootstrap/stage2/tcc`
- `work/bootstrap/tcc-portable/`
- `tcc-portable.tar`
- `work/bootstrap/common/lib/tcc/libtcc1.a`
- `work/bootstrap/common/lib/tcc/libtcc1.o`
- `work/bootstrap/common/lib/tcc/alloca86.o`

## Typical Run

Build the host seed first:

```sh
cd /home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap
./run-i386.sh mawk -f bootstrap-i386-mawk.awk
```

Then run the airlock bootstrap:

```sh
cd /home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap
./test-airlock-bootstrap-stage2.sh
```

Expected completion line:

```text
airlock stage2-seeded bootstrap complete
```

After that, the portable outputs are at:

```text
artifacts/airlock-bootstrap-stage2/work/bootstrap/tcc-portable
artifacts/airlock-bootstrap-stage2/tcc-portable.tar
```

Then run the second airlock from that tarball:

```sh
cd /home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap
./test-airlock-bootstrap-portable.sh
```

Expected completion line:

```text
airlock portable bootstrap complete
```

Example host usage:

```sh
cd /tmp
tar -cf tcc-portable.tar -C /home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/artifacts/airlock-bootstrap-stage2/work/bootstrap tcc-portable
mkdir moved
tar -xf tcc-portable.tar -C moved
PATH=/tmp/moved/tcc-portable/bin:$PATH tcc-glibc hello.c -o hello
```

## Current Shape

This is a pragmatic bootstrap path, not a pristine upstream TCC build.

The important properties are:

- rootless Slackware 10.2 airlock
- only source inputs plus the seed `stage2/tcc` and `mawk` are injected
- no TCC source patching inside the airlock
- no host-side generated musl header artifacts
- `libtcc1` is built inside the airlock from TCC source
- stage compilers are built through a driver with explicit `-nostdinc` and
  `-nostdlib` control
- `tcc.c` is compiled in `ONE_SOURCE=1` mode for each compiler stage
- `stage1/tcc` and `stage2/tcc` match
- the airlock emits a relocatable `tcc-portable/` bundle
- the first airlock also emits a normalized `tcc-portable.tar`
- the second airlock rebuilds from only that tarball using extracted
  `tcc-glibc`
- the regenerated portable tarball matches the input tarball byte-for-byte
- `tcc-glibc` from that bundle works after copying the directory elsewhere on
  the host
