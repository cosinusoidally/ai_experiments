# Running, debugging and maintaining the VM

Commands below run from `mmvm_v2_tests`. They use existing local binaries and
the read-only sibling `js_tests` checkout. No npm, Python or downloads are
required. See the project README for preparing Firefox/js_min files; do not
rebuild js_min because its shared library path is missing.

The current standalone native target is **i386 Linux** with a 32-bit word/
pointer ABI and available libc symbols. Node can be a 64-bit build host; that
does not change the target. This is not a promise of a Win32/x86-64 launcher
or a particular historical kernel/libc combination without further work and
testing. If existing i386 executables stop running in the environment, stop
and diagnose that execution failure rather than introducing emulation.

## Entrypoints and command-line options

```sh
# Portable embedding on Node; not the same as direct Node application execution.
node guest_runner.js program.js argument1

# Native kernel inside the existing js_min shell.
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js \
  --vm-native program.js argument1

# Standalone application, with no outer JavaScript host.
./artifacts/js_runner.exe artifacts/snap program.js argument1
```

The ordinary runner parses options **before the first program filename**;
remaining arguments belong to the program. It has no general unknown-option
rejector: an unrecognized token can become the filename. Do not assume GNU
argument-parser behavior. The runner installs guest `arguments` without the
program filename and a Node-like `process.argv` through its environment.

Ordinary `guest_runner.js` options:

| Flag | Effect |
| --- | --- |
| `--vm-native` | Kernel interpreter: i386 on js_min, generated JS on Node. |
| `--vm-predecode` | Native interpretation with predecoded operand mode; build/load mode must agree. |
| `--vm-threaded` | Structured-JS compilation. On js_min the non-native runner already enables it; bare VM constructors do not. |
| `--snapshot FILE` | Build a generic standalone image before opening the optional application; implies native mode. Explicit, never an automatic disk cache. |
| `--with-snapshot FILE` | Reuse interpreter code in an embedded VM; not equivalent to launching the saved standalone environment. |
| `--skip-snapshot-hash` | Accepted with `--with-snapshot`; current loader does not re-fingerprint source anyway. |
| `--vm-max-heap-mib N` | Integer maximum from 64 to 1024 MiB; initial runtime limit remains the runner default. |
| `--vm-gc-stress` | After bootstrap, lower embedding threshold to 256 and enable native stress interval when native mode is present. |
| `--vm-profile` | Opcode/function/native profiling. |
| `--vm-profile-duration MS` | Positive duration; requests finite instruction slices and stops at a checked slice boundary, not a hard wall-time preemption. |
| `--vm-trace-exceptions` | More exception diagnostics. |
| `--vm-verify-heap` | Extra native heap/index verification. |
| `--vm-no-host-calls` | Reject explicit embedding callbacks; not all portable intrinsic/semantic fallbacks. |
| `--vm-log-host-calls` | Log explicit callback transitions; not every native FFI/semantic service. |
| `--vm-native-samples` | Specialized sampler for a self-hosted standalone build; rejects ordinary Node/js_min usage without standalone metadata. Not normal execution mode. |

Snapshot output can omit the program. Without a snapshot output path, a
program is required. `--snapshot` and `--with-snapshot` cannot be combined.
The runner's allocation threshold is 16384 before the optional stress setting,
different from the bare Runtime default.

The C launcher itself accepts only `IMAGE program.js [arguments...]`; it does
not parse the JS runner's options. To use the already-loaded standalone
runner's limited options:

```sh
./artifacts/js_runner.exe artifacts/snap guest_runner.js \
  --vm-native --vm-profile demo8_runner.js demo8.js
```

That fast path accepts `--vm-native` (already native), `--vm-profile` and
`--vm-gc-stress`; it rejects other options, including changing predecode mode
at launch. A request to rebuild via `--snapshot` deliberately selects the
full source-reloading build path instead. Do not document all ordinary-runner
flags as available to this fast path. See [self-hosting](self-hosting.md).

## Tests and what they prove

The default project suite covers both embedding hosts, language/Buffer
workloads, heap/AOT internals, command-line smoke paths and multi-context
scheduling:

```sh
guest_vm/tests/run_tests.sh both
```

For a kernel front/middle-end change, start with the existing broad compiler
and backend integration checks alone, on both hosts:

```sh
node guest_vm/tools/check_kernel_compiler.js
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/check_kernel_compiler.js
```

This entry point reuses `kernel_compiler_test.js`; it does not define another
language micro-test suite. Node checks shared IR/JS and macro output; js_min
also executes the generated i386 code. It is not a claim that unrelated full
corpora or graphical paths were rerun.

Bounded GC audits check graph integrity without a long graphical run:

```sh
node guest_vm/tests/gc_stress.js
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_vm/tests/gc_stress.js
./artifacts/js_runner.exe artifacts/snap guest_vm/tests/gc_stress_workload.js
```

The embedding stress driver performs structural edge/property-index audits;
the standalone workload exercises surviving data with native collections.
Neither proves all possible lifetimes safe. The snapshot gate verifies
program/environment independence, Node/js_min identity, actual standalone
source rebuild and the byte-identical fixed point:

```sh
guest_vm/tests/run_standalone_snapshot_test.sh both
```

External suite commands use existing wrappers; do not modify the corpora:

```sh
./artifacts/js_runner.exe artifacts/snap test262_runner.js
TZ=UTC ./artifacts/js_runner.exe artifacts/snap ecma_tests_runner.js --verbose
TZ=UTC node ecma_tests_runner_node.js --verbose
./artifacts/js_runner.exe artifacts/snap octane_runner.js zlib
node --jitless octane_node_runner.js zlib
```

Default ECMA selection has four documented slow exclusions; timeouts are
failures, not passes. Imported Test262 coverage does not contain all built-in
chapters. Octane quick correctness and stock timed runs are different
contracts. A stock suite score is not a process wall-time ratio. Follow the
wrapper documentation when selecting full sweeps or explicit subsets.
Run memory-heavy jobs serially on the current machine. No multithreading is
needed to measure or improve the interpreter.

The [latest cleanup validation](../../PROPERTY_CLEANUP_VALIDATION_2026-11-05.md) records current passing
tests, known ECMA gaps, an existing extra standalone integration failure,
Demo8 mode checks and performance regressions. Do not treat an older bring-up
report or one green smoke test as the current complete status.

## Diagnostics

- `inspectHeapRecord`, `inspectExecution` and `inspectNativeFrames` expose
  bounded, structured state without arbitrary guest coercion; see [API](api.md).
- `tools/inspect_native_exit.js` stops at an unsupported native instruction
  with opcode/file/PC filters and bounded value/record descriptions. It
  supports standalone use; read its header for the different host invocations.
  Its rejection details use the same `NativeInterpreter.CallDiagnostics`
  catalog as kernel bindings and profile output, not a positional name list.
  `NativeInterpreter.describeCallRejectReason(code)` formats named simple
  reasons and encoded payloads; intrinsic/value-tag/heap-type payloads include
  enum names when known. Composite pair/GC payloads remain numeric rather
  than dereferencing potentially corrupt guest values. The raw code protocol
  used by the standalone entry stub is unchanged.
  `NativeInterpreter.sourceLocation(program, pc)` returns filename/line/column
  from available program metadata; unavailable positions are zero, not an
  invented line 1. This does not create missing source maps for adopted code.
- `tools/run_ecma_diagnostic.js` adds focused ECMA exception/imported-prototype
  and instruction diagnostics. It is optional tooling, not a VM dependency.
- `tools/inspect_kernel_build.js`, `inspect_native_exit.js` and the profiling
  tools help distinguish frontend, lowering, assembly, allocation and guest
  execution time. `retainNativeBuildIR` is opt-in because build IR is normally
  released after compilation.
- `tools/build_profile_image.js` can expose kernel/build information under
  the supported build hosts. Generated captures belong in ignored artifacts.

An “unsupported opcode CALL” diagnostic means the kernel declined that call
case. Inspect intrinsic ID/reject reason, frame/program and allocation flag;
do not infer that all calls or all of that intrinsic are unimplemented.
Diagnostic reason bases are named constants in source. Do not add numeric
reason offsets at call sites without a shared name.

Location-rich portable programs can report filename/line/column. Adopted
self-hosted executables currently retain source but omit the full per-PC
location table; native exits may report only PC/detail. The API must not
promise uniform full stack/location metadata across all paths.

## Change checklist

1. Identify whether the operation exists in portable Runtime, a guest library,
   a native kernel helper or several of these. Preserve semantics on every
   supported route, including strictness, descriptors, coercion callbacks,
   negative zero and holes.
2. For new heap fields, add named accessors/constants and all tracing edges,
   native marking, snapshot normalization/rebinding and introspection. Keep
   raw offsets inside layout/memory modules, not scattered semantic code.
3. Root temporary graphs before allocation; publish frames before spills.
   Reacquire property descriptors after a callback/mutation. Never share a
   free span between portable and native allocator indexes.
4. Check both kernel backends and cross-host image identity. The old shell's
   `Function.toString()` is a decompiler and has historically changed source
   binding structure; a Node-only image comparison cannot detect that.
5. Bump `HeapRecords.NativeInterpreterContractVersion` for executable
   incompatibility; update image format/loader validation if the file ABI
   changes. Ordinary loading does not rebuild a source fingerprint to save
   you from a stale contract version.
6. Run bounded correctness/GC gates, then relevant live integrations and
   controlled stock benchmarks/builds. Compare filenames, not just total pass
   counts. Preserve the old working image/source tree for paired comparisons.
7. Update these docs, status histories and known limitations. Check in working
   code regularly. Keep logs, binaries, images and generated build products
   under ignored `artifacts/`, not in version control.

Useful invariants are explained in [execution and GC](execution-and-gc.md).
Do not repair a VM regression by changing a demo or special-casing a corpus
filename. Do not claim a planned representation migration has landed merely
because its infrastructure exists.
