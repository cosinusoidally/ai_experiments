# Octane guest-VM bring-up and performance approach

## Objective

The external Octane 2.0 checkout is a demanding integration workload for the
ES5.1 guest VM. The immediate goal is to execute every suite correctly. Once
that is true, its stock score will help guide improvements to general-purpose
guest JavaScript performance.

The longer-term architectural goal remains a VM whose guest heap, bytecode
execution, language semantics, garbage collector, and native services are
independent of the bootstrap host. On MMVM, ordinary execution should stay in
the native interpreter and use the guest's native service/FFI boundary. The
Node backend must implement the same observable VM using the shared front and
middle ends, although Node necessarily remains the low-level execution host.

## External test tree

Octane is expected at `../../js_tests/octane`, relative to
`mmvm_v2_tests`. That external tree is read-only for this work. The checked-in
`octane_runner.js` loads the original files in place and contains the selection
and reporting logic needed by the guest VM. It must never copy, rewrite, or
patch an Octane source file.

The normal form for an individual stock run is:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js --vm-native octane_runner.js Richards
```

Passing `all` selects every suite. With no suite argument, all suites are also
selected. `--quick` changes each loaded benchmark to one deterministic,
non-warmup iteration. This mode is only a bring-up and correctness diagnostic;
it does not produce or claim an Octane score. A suite counts as fully working
only after its original, stock timing and warmup configuration completes with
all of its own validation checks enabled.

## Correctness sequence

Suites are brought up individually in their original order. For each failure:

1. Reproduce the smallest relevant language-level behaviour without modifying
   the external suite.
2. Decide whether the failure is missing ES5.1 semantics, a VM correctness
   defect, exhausted guest resources, or unsupported host-facing behaviour.
3. Implement the general VM facility at its proper layer. Add coverage to an
   existing high-level language, embedding, heap, or compiler test when that
   protects a meaningful contract.
4. Run the complete Node-hosted and js_min-hosted guest test suites.
5. Recheck already-working Octane suites and the existing demo smoke tests
   before committing a stable milestone.

The original Octane assertions, checksums, and error paths remain authoritative.
Completing a script or printing a timing is not by itself a pass.

## Performance policy

No optimization may recognize an Octane suite, benchmark function, source
string, filename, constant, or call site. There will be no benchmark-specific
bytecode, intrinsic, native helper, precomputed answer, source rewrite, or
special allocation policy.

Profiling data is used to identify general costs such as:

- bytecode dispatch and operand decoding;
- guest property lookup, shapes, prototypes, and inline caches;
- calls, frames, closures, and lexical environments;
- numeric representation and integer/binary64 operations;
- arrays, strings, regular expressions, and typed-array-like storage;
- allocation rate, tracing, collection, and heap growth;
- semantic exits from the native interpreter;
- compilation, program registration, and startup work;
- native service and FFI transitions.

Improvements should make the underlying operation faster for arbitrary guest
programs and should normally be expressed in the kernel dialect, shared IR,
heap-record accessors, or reusable runtime data structures. Named record-field
accessors remain mandatory; raw offset arithmetic must not spread through the
interpreter. Native code must be produced through the JavaScript macro
assembler rather than embedded instruction blobs.

The shared front and middle ends remain the semantic authority for both
backends. Where a fast native implementation is introduced, the Node backend
gets the corresponding general implementation and equivalence coverage. Work
should progressively remove dependence on host objects and callbacks rather
than making a fast path that only functions because SpiderMonkey owns part of
the guest state.

## Measurements and regression gates

Before score optimization, record stock per-suite time and score plus native
interpreter profile data. Compare changes at the same host, snapshot mode,
suite selection, and build. Startup/compilation time and measured benchmark
time are reported separately.

An improvement is accepted only if:

- all previously passing guest language, buffer, heap, embedding, compiler,
  networking, and context tests still pass under Node and js_min;
- already-working Octane suites retain correctness;
- the existing demo command paths continue to compile and run correctly;
- representative interactive demos do not lose frame rate or stability; and
- Node-hosted guest performance is not needlessly regressed by an MMVM-native
  optimization.

Octane score work begins only after all suites complete correctly with stock
settings. Optimization commits should state the affected general mechanism,
the before/after measurements, and the regression checks performed.

## Bring-up status

The following baselines include native-interpreter compilation and process
startup in the wall-clock time. They are not directly comparable with the
score's internal benchmark interval.

| Suite | Stock correctness | Score | Total wall time | Notes |
| --- | --- | ---: | ---: | --- |
| Richards | passing | 76.4 | 15.36 s | Native loose equality reduced a quick run to about 40 semantic exits. |
| DeltaBlue | passing | 116 | 15.45 s | Native `Function.call`, `Array.pop`, and `Array` construction reduced a quick run from 2,912 semantic exits to 40. |
| Crypto | passing | 129 | 48.02 s | Required general compound `<<=`, `>>=`, and `>>>=` parsing and bytecode lowering. |
| RayTrace | passing | 104 | 37.66 s | Passed with the existing ES5.1 and native-interpreter facilities. |
| EarleyBoyer | passing | 138 | 119.65 s | Added `in`, native `instanceof`, `try`/`finally`, script-level `this`, and extensible guest string prototypes. |
| RegExp | bring-up passing on Node; native stock baseline pending | — | — | Added regexp literals beginning with `=`, `String.match`, regexp `split`, cached host patterns, native substring/fromCharCode, and corrected the single-character replace fast path so semantic escapes cannot be treated as literal characters. Native execution remains dominated by general RegExp semantic transitions. |
| Splay | quick correctness passing; stock baseline pending | — | 20.07 s quick | Added `Date.now`. The quick run reaches a 269,996,280-byte guest bump with no collection after the default maximum was raised to 512 MiB. The old 256 MiB maximum could not contain the live tree and caused futile repeated collections. |

The times above were measured on the current development machine with no
snapshot. They are working baselines, not claimed stable performance numbers
for other systems.

For memory context, the quick Splay run peaks at 442,860 KiB RSS in the guest
VM. Node v24.14.1 running the same unmodified suite and quick wrapper peaks at
134,792 KiB RSS and takes 0.43 s. The guest's current representation stores
each ordinary property in a separate 48-byte linked heap record and each value
cell in 16 bytes. Splay creates roughly half a million recursively nested
payload objects, so compact per-object property storage and denser value cells
are high-value general representation work, independent of Octane.

Native heap-pressure profiling reports bump, current logical limit, reserved
maximum, next pressure point, growth count, and collection count. Once a full
collection leaves a large live graph above the normal three-quarter pressure
mark, the next pressure point is placed at least 1 MiB above the surviving
bump. Actual allocation failure still forces collection; an unchanged live set
does not cause collection again at every semantic boundary.

The RegExp workload also exposed a cross-context collector invariant: a yield
must publish the youngest active frame separately for each owning `JSContext`.
Publishing a loaded script's callee under the entry context could leave a freed
frame reachable after return. Frame construction is now rooted before any
allocation-capable value conversion, frame release clears its owning context,
and yielded executions publish active roots per context.
