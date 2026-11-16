# Default snapshot-build and executable-packaging memory

## Settings and scope

Fresh measurements at source `b9ea1bd`, native contract 109. These measure
building the guest VM itself, not the mishmashvm bootstrap. No VM code was
changed for the measurement.

- Default guest settings: initial logical heap 64 MiB, maximum 512 MiB;
  no `--vm-max-heap-mib` override on either the running VM or target builder.
- Normal kernel optimization; no `-O0`, debug sidecar, optional backing-sharing
  pass or snapshot-cache loading option.
- Node v24.14.1, x64, with ordinary JIT settings or `--jitless`. That flag
  changes the Node host, not the target kernel optimization setting.
- Linux and Windows standalone executables are i386 and embed the same
  default seed snapshot. Genuine self-builds reload sources, lower/assemble
  the kernel and construct/serialize a new runtime; they do not copy the seed.
- Every job ran serially in a new process. These are individual observations,
  not repeated averages or deliberately cold-filesystem-cache measurements.
- GNU `/usr/bin/time -v` provides maximum RSS (its Linux kbytes are KiB).
  Windows results are Wine-run RSS, not a native Windows peak working set or
  the sum of all Wine-prefix processes. The provided 32-bit prefix was used.

## Snapshot construction

| Build host | Elapsed seconds | Peak RSS, KiB | Peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Guest VM, Linux, self-hosted | 81.06 | 483964 | 472.62 |
| Guest VM, Windows under Wine, self-hosted | 84.11 | 484268 | 472.92 |
| Node, JIT enabled | 5.24 | 266584 | 260.34 |
| Node, `--jitless` | 17.27 | 226604 | 221.29 |

The observed Windows/Linux difference is only **304 KiB (0.30 MiB, about
0.06%)**. This pair does not establish a meaningful platform-dependent memory
difference. Node jitless uses about 39.0 MiB less RSS than ordinary Node in
these runs. Both Node modes use substantially less memory than the guest
self-build, but all figures include host/runtime overhead, not just live
guest objects.

The initialized snapshot heap is 6,891,128 bytes, its native kernel is 699,048
bytes and the complete file is 7,595,640 bytes. Its default per-runtime
reservation is 640 MiB (512 MiB heap plus 128 MiB collector workspace), not
640 MiB eagerly resident. A self-hosted build also constructs a target runtime:
the measured process peak is not the initialized image size or the reservation
of just one runtime.

## `snapshot_to_exe.js` packaging, measured separately

All conversions consume the same seed snapshot. ELF and PE output were each
measured under all four hosts. Peak RSS is for the whole fresh process,
including its runtime startup/source loading, not incremental allocations
attributable only to the copying loop.

| Packaging host | ELF seconds | ELF peak KiB (MiB) | PE seconds | PE peak KiB (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Node, JIT enabled | 0.11 | 54656 (53.38) | 0.19 | 59060 (57.68) |
| Node, `--jitless` | 0.11 | 45564 (44.50) | 0.17 | 48572 (47.43) |
| Guest VM, Linux | 4.45 | 76544 (74.75) | 4.77 | 87424 (85.38) |
| Guest VM, Windows under Wine | 5.83 | 81064 (79.16) | 5.01 | 91636 (89.49) |

Subsecond process-time differences should not be interpreted as stable
performance rankings from one observation. There are no compiler/binutils
invocations or new native support code in the packager.

## Correctness and identity

All five snapshots (initial Node seed plus the four measured builds) are
byte-identical, SHA-256:

`9c79d33d589a16b297b5b389ce9d1d3ee2dc67450589e2cc328cee7776fd2c42`

All four measured ELF outputs match the initial Linux executable, SHA-256:

`f969d8183ccb3c92ce8636b2e956eada73338c671e8e143409150c9f4d33f1bf`

All four measured PE outputs match the initial Windows executable, SHA-256:

`3222fb8bb907f4c04d6e25d57aca0253ab47b27f17314a81d4b85906b11c5a3c`

The Linux-guest-generated ELF and Windows-guest-generated PE also run hello
successfully. The snapshot input was not modified. This is focused build and
packaging acceptance, not another full ECMA/Test262/Octane/demo sweep.

## Reproduction

From `mmvm_v2_tests`, use a new output directory: packager destinations must
not already exist.

```sh
mkdir artifacts/self-build-default
node guest_runner.js --vm-native --snapshot artifacts/self-build-default/seed.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/self-build-default/seed.snap artifacts/self-build-default/linux.exe
node guest_vm/tools/snapshot_to_exe.js artifacts/self-build-default/seed.snap artifacts/self-build-default/windows.exe --win32

/usr/bin/time -v ./artifacts/self-build-default/linux.exe guest_runner.js --vm-native --snapshot artifacts/self-build-default/linux.snap
. ../../wine/32.sh
/usr/bin/time -v wine artifacts/self-build-default/windows.exe guest_runner.js --vm-native --snapshot artifacts/self-build-default/windows.snap
/usr/bin/time -v node guest_runner.js --vm-native --snapshot artifacts/self-build-default/node-jit.snap
/usr/bin/time -v node --jitless guest_runner.js --vm-native --snapshot artifacts/self-build-default/node-jitless.snap
```

Time each packager invocation independently, selecting one of these hosts:
`node`, `node --jitless`, `./artifacts/self-build-default/linux.exe`, or
`wine artifacts/self-build-default/windows.exe`. Its arguments are
`guest_vm/tools/snapshot_to_exe.js INPUT.snap NEW_OUTPUT.exe`; append `--win32`
for PE output. Do not run these measurements concurrently.

Raw logs, snapshot files and executable outputs are temporary beneath
`artifacts/self-build-default/`. The exact RSS/time observations are preserved
here so clearing artifacts does not discard the results.
