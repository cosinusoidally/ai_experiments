# Package Roadmap

This file tracks the package set needed to make the airlock self-hosted.

## Series View

At the moment, everything still needed for the self-hosted airlock sits in the
Slackware `a/` series.

Already built in `a/`:

- `patch`
- `gzip`
- `mawk`

Still needed from `a/`:

- `tar`
- `sed`
- `bash`
- `coreutils`

## Already Built

- `gzip`
- `patch`
- `mawk`

These are currently produced into the repo-style package tree:

- `artifacts/airlock-bootstrap-portable/work/repo/a/`

and are exercised by:

- [test-airlock-rebuild-portable-packaged.sh](/home/foo/src/gpt/ai_experiments/tcc_mawk_bootstrap/test-airlock-rebuild-portable-packaged.sh)

That harness installs the packaged `gzip`, `patch`, and `mawk` into a fresh
Slackware 10.2 airlock and then rebuilds `tcc-portable`.

## Next Packages

These are the remaining `a/`-series packages or `a/`-series tool payloads the
current airlock still relies on from the base system or from injected
binaries.

1. `tar`
Reason: the airlock still relies on `/bin/tar-1.13` for unpacking package
payloads and portable tarballs.

2. `sed`
Reason: musl header generation in `airlock/inside-airlock.sh.in` still uses
`sed -f` with musl's `tools/mkalltypes.sed`.

3. `bash`
Reason: the long-term shell target should be `bash`, not `busybox`. The
current airlock still runs with the initrd shell and userland.

4. `coreutils`
Reason: the long-term target is to replace the initrd userland, not just the
compiler-specific tools. The current airlock scripts still rely on the base
system's `cp`, `mv`, `mkdir`, `rm`, `ln`, `chmod`, `cat`, `cmp`, and related
utilities.

## Preferred Order

1. `tar`
2. `sed`
3. `bash`
4. `coreutils`

This order removes the most immediate package-build dependencies first, then
replaces the shell layer and finally the bulk of the base command set.

## Do We Need Other Series?

For the current airlock bootstrap path: probably not yet.

The current remaining runtime/tooling dependencies all map to `a/`:

- shell: `bash`
- base file and text utilities: `coreutils`
- archive handling: `tar`
- text transformation: `sed`

`patch` has now been rebuilt as its own package under `slackware-packages/a/patch`
and is exercised by the packaged rebuild airlock.

So the package work needed to make the current airlock self-hosted can stay
within `a/`.

Other Slackware series may become relevant later when the target expands beyond
the bootstrap/tooling layer. For example:

- `d/` for a broader development-tool replacement story
- `l/` for additional libraries beyond the current glibc-based runtime setup

But for the current question, the remaining required package work is entirely
in `a/`.

## Scope Note

The target here is to make the airlock self-hosted with normal Slackware-style
packages and a `bash`-based shell environment.

This explicitly means:

- build `bash`, not `busybox`
- keep using the mirrored Slackware-style package tree under
  `slackware-packages/<series>/<name>/`
- emit final package artifacts into the repo-style package directory under
  `work/repo/<series>/`
