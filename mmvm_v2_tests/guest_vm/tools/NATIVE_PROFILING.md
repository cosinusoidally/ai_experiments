# Bounded native interpreter sampling

## Host build phases

For a focused profile of snapshot construction, run:

```
js_min.exe guest_vm/tools/profile_host_runtime.js --frontend --vm-native --snapshot artifacts/profile.snap
```

Use the same library-path setup as for an ordinary `js_min.exe` build. The
tool also accepts `node` in place of `js_min.exe`. `--frontend` is consumed
by the profiler; subsequent arguments belong to `guest_runner.js`. It times
whole parsing, compilation, program registration, collection and native-run
calls, rather than instrumenting every property lookup. Without this option
the existing broader runtime/property profile remains available.

Times are inclusive: recursive compilation and registration overlap, so do
not sum the rows. Wrappers themselves add overhead, and the instrumented
image is a diagnostic artifact, not the image to use for final throughput
or reproducibility checks. Compare a control and changed build using the
same instrumentation, then measure ordinary uninstrumented builds.

## Native execution samples

These optional Linux diagnostics use libc `profil` to sample the native
interpreter. They do not use threads, a C helper, guest timer callbacks, or
host implementations of guest language features. Node is only the external
cross-build/supervision tool; it is not required by the measured VM.

From `mmvm_v2_tests`, build an image with an ignored symbol sidecar:

```
node guest_vm/tools/build_profile_image.js --vm-native --snapshot artifacts/profile.snap
node guest_vm/tools/profile_native_vm.js artifacts/profile.snap 25 octane_runner.js Mandreel
```

The second command launches exactly one native runner. After the profiling
entry prints its counter-buffer address, it allows 25 seconds of execution,
stops the child, reads that buffer through `/proc/PID/mem`, and terminates the
child after reporting. This is a bounded investigation, **not** a completed
benchmark or an Octane score. The sample count excludes time outside the
native interpreter, including libc. Counter bins are two native code bytes;
the counters are unsigned 16-bit values and runs are limited to 120 seconds.

The sidecar records function/dispatch offsets, kernel source hash, and code
length. Use it only with the image that produced it. It is a development
artifact and must not be checked in. Normal snapshots do not gain a symbol
sidecar or profiling dependency. Diagnostic sidecar checks do not change
normal snapshot startup validation.

Function totals are useful for identifying dispatch, call setup, allocation,
and collector costs. Case-region totals are approximate: loop and dispatch
instructions between case labels can be charged to the preceding case.
Compare elapsed times and completed correctness workloads before drawing a
performance conclusion from changing sample percentages.

The entry currently uses `load` and passes the remaining global `arguments`
to the target. It is intended for shell-style workloads such as the Octane
wrapper; it does not recreate an application's direct-entry CommonJS/process
argument environment. Loading the diagnostic entry and its dependencies also
changes the starting heap, so use ordinary launches for final measurements.
