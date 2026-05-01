# Airlock Stage2 Bootstrap

This directory contains an "airlock" bootstrap path that rebuilds `tcc-0.9.27`
inside a rootless Slackware 10.2 environment.

The entry point is:

- [test-airlock-bootstrap-stage2.sh](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/test-airlock-bootstrap-stage2.sh)

## Goal

The goal is to start from a host-built seed `stage2/tcc`, inject only source
inputs and that seed compiler into a Slackware 10.2 initrd, and then perform a
3-stage TCC bootstrap inside the airlock.

The final in-airlock-built `stage2/tcc` is still intended to run on the host.

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

## Outer Script

The outer script does four jobs:

1. Unpack the Slackware initrd into `artifacts/airlock-bootstrap-stage2/rootfs`.
2. Prepare a writable work tree at
   `artifacts/airlock-bootstrap-stage2/work`.
3. Precompute the generated musl headers that are awkward to synthesize inside
   the airlock:
   - `bits/alltypes.h`
   - `bits/syscall.h`
4. Run the inner script with `bwrap` in a rootless environment.

The outer script also substitutes host-specific placeholders in
`inside-airlock.sh`:

- `__HOST_COMMON_TCCDIR__`
- `__HOST_CRT_PREFIX__`
- `__HOST_LIB_PATHS__`
- `__HOST_LIBC_SO__`

These are baked into the final compiler so the final `stage2/tcc` can run on
the host rather than only inside `/work/...` in the airlock.

## Inner Script

The inner script is:

- [airlock/inside-airlock.sh.in](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/inside-airlock.sh.in)

At runtime it is copied to `/work/inside-airlock.sh` and placeholder-expanded.

Inside the airlock it does this:

1. Build `unbz2` with the injected seed `tcc`.
2. Build `untar` with the injected seed `tcc`.
3. Extract `tcc-0.9.27.tar.bz2`.
4. Extract `musl-1.1.24.tar.gz`.
5. Build a local musl header overlay.
6. Patch the extracted TCC sources.
7. Build `libtcc1` objects and `libtcc1.a` inside the airlock.
8. Build `stage0/tcc` with the injected seed compiler.
9. Build `stage1/tcc` with `stage0/tcc`.
10. Build `stage2/tcc` with `stage1/tcc`.
11. Print `stage2/tcc -v`.

After `bwrap` exits, the outer script checks that:

- `stage1/tcc`
- `stage2/tcc`

are bit-identical.

## Seed Headers And CRT

The minimal headers under:

- [airlock/seed-headers](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/seed-headers)

exist only to compile `unbz2.c` and `untar.c` with the seed `tcc`.

The startup object source:

- [airlock/crt.c](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/airlock/crt.c)

provides a tiny i386 `_start` entry point so this path does not depend on
injecting `crt1.o`, `crti.o`, or similar startup objects.

## Why The TCC Sources Are Patched

The in-airlock bootstrap applies a few targeted source patches to the extracted
TCC tree.

### 1. Remove `sscanf`-based version parsing

`libtcc.c` is patched to parse `TCC_VERSION` with `strtol` instead of
`sscanf`. This avoids the old-glibc incompatibility around
`__isoc99_sscanf`.

### 2. Adjust header ordering for musl headers

`tcc.h` and `include/stdarg.h` are patched so the mixed musl-header setup does
not trip over `va_list` ordering and alias definitions.

### 3. Avoid the archive indexed loader path

`tccelf.c` is patched so the archive "alacarte" path is disabled during this
bootstrap. In this environment, the self-built TCC could crash or spin while
loading indexed archives.

### 4. Special-case `libtcc1`

`tccelf.c` is patched so `TCC_LIBTCC1` resolves to:

- `libtcc1.o`
- `alloca86.o`

from the TCC library directory, instead of relying on archive member selection
at ordinary link time.

This keeps the runtime source inside the TCC tree and avoids the problematic
archive path for the final compiler's normal operation.

### 5. Force libc as a direct file

The runtime-addition code is patched so libc is added as a direct
`libc.so.6` path instead of relying on `-lc` resolution through older
linker-script or archive logic on the host.

## Why `alloca86-bt.o` Is Built

`alloca86-bt.o` is still built into `libtcc1.a` because the archive itself is
meant to be complete, but the direct runtime sidecar path only uses:

- `libtcc1.o`
- `alloca86.o`

The bounds-check variant is not used in the default no-bcheck compiler path.

## Artifacts

The airlock run writes into:

- [artifacts/airlock-bootstrap-stage2](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/artifacts/airlock-bootstrap-stage2)

Important outputs are:

- `work/bootstrap/stage0/tcc`
- `work/bootstrap/stage1/tcc`
- `work/bootstrap/stage2/tcc`
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

## Current Shape

This is a pragmatic bootstrap path, not a pristine upstream TCC build.

The important properties are:

- rootless Slackware 10.2 airlock
- only source inputs plus the seed `stage2/tcc` and `mawk` are injected
- `libtcc1` is built inside the airlock from TCC source
- `stage1/tcc` and `stage2/tcc` match
- final `stage2/tcc` works on the host
