# cscript bootstrap assessment and bounded host benchmark

2026-11-17, source base `bb1bf59`. Assessment only: no VM or host-adapter
implementation change. No downloads, native extensions or parallel test jobs.

## Acceptance requirement

A genuine source build under cscript must produce a **byte-identical snapshot
and executable** to builds from the same checkout with the same options under
the supported hosts. A successful hello alone is not sufficient. Compare full
binary files, not just machine-code sections or semantic results. Hex exchange
files are temporary transport, never the final snapshot format. Host environment,
COM objects, output filenames and absolute host paths must not enter the image.

The proposed binary boundary is chunked hex from/to JScript, with a small
VBScript helper performing the binary conversion. Keep COM outside the VM's
hot memory operations. Source loading must eventually preserve UTF-8 correctly;
the benchmark's selected implementation files are ASCII and validate that fact.

## Host checks

The provided 32-bit Wine prefix runs **Microsoft WSH 5.7**, cscript file version
**5.7.0.16535**, and **Microsoft JScript 5.7.16535**. Wine loader tracing confirms
cscript.exe and jscript.dll are native, not Wine built-ins.

`guest_runner.js` parses, as do the scanned core implementation files. A scan
including tools found 133/134 files parse: the unrelated Node-only QMP helper
has reserved-word property syntax rejected by classic JScript. The generated
shared JS kernel factory, **926386 characters**, also compiles and instantiates
under JScript, returning a callable entry. This does not prove full execution.

JScript lacks Buffer, ArrayBuffer, JSON, Object.create, Object.defineProperty
and Array.prototype.indexOf. Audit actual build dependencies rather than add a
full ES5 shim: the guest implements its own language semantics. Existing sparse
host memory and shared JS kernel backend already support a non-FFI cross-build.
GuestNodeEnvironment host selection and SnapshotOutput's Node-specific non-native
writer need explicit WSH service adapters; do not simulate a complete Node host.

The prefix has usable FSO and creatable MSXML/ADO objects, but its MSXML/ADO DLLs
are Wine built-ins. A direct binary probe exposed SAFEARRAY conversion trouble
and an explicitly unimplemented `msado15:stream_SaveToFile`. Thus a VBScript
helper using that exact Wine ADO method is not yet established as working here.
Validate the chosen helper first; this is separate from Microsoft cscript's
identity and from the VM architecture. No components were installed/replaced.

## Benchmark scope

`../tools/benchmark_bootstrap_host.js` runs unchanged under Node, Microsoft
cscript, js_min and the standalone native guest VM. It uses ES3 syntax, no
external packages and no explicit GC requests, FFI calls or runtime machine-code
generation.

The synthetic section runs two batches, each retaining 200000 eight-field
objects with small numeric arrays, distinct names/source-like strings, previous
links and a prefixed-key dictionary. Across both batches it creates roughly:

- 400000 node objects, plus dictionaries;
- 800000 small arrays, including slice copies;
- 1.6 million string-producing expressions (not necessarily distinct physical
  strings, because engines may intern/share them).

It measures allocation, named/dynamic property reads and writes, slice copies,
integer operations and own-field enumeration. Those operations occur throughout
the parser, compiler transforms, register analysis and structural fingerprinting.
For comparison, the previous self-build sample around its large transient burst
had about 417k object headers, 934k array headers and 1.04m string records.
**Cumulative synthetic allocations are not the same as those sampled record
populations or the bootstrap's peak live graph.** One synthetic batch is rooted
at a time, deliberately limiting memory on the 2 GiB host.

The real-source section loads the existing tokenizer/parser into an isolated
root, without replacing constructors used internally by the running guest VM.
It scans/hashes four passes over **1324689 ASCII characters** from:

- `guest_vm/aot/native_interpreter.js`
- `guest_vm/aot/kernel_compiler.js`
- `guest_vm/compiler.js`

It parses those files with the real parser and walks their fields. All hosts
visit **128424 object / 15531 array / 191606 string** values in that walk.
These are visits, not a unique-object/reachability audit.

Finally it initializes **8 MiB** of ordinary-array pages and performs one million
aligned 32-bit write/read/checksum operations. The second case represents the
same byte capacity with one array element per word rather than per byte. It
includes initialization cost, not just access throughput. Both are ordinary JS
arrays on every host: they do **not** measure Node Buffer or native guest heap
access, and the packed case does not cover byte-write read/modify/write costs.

## Results: one serial observation per host

All **11 per-phase checksums and the final checksum match across all five runs**.
Final checksum: **-790246891**. No warm-up runs, averages or repetitions were used.

| Host | Internal elapsed | Process wall | Memory observation |
| --- | ---: | ---: | --- |
| Node v24.14.1, JIT | 2.231 s | 2.32 s | peak 326584 KiB / 318.93 MiB |
| Node v24.14.1, jitless | 4.542 s | 4.66 s | peak 316760 KiB / 309.34 MiB |
| js_min | 50.660 s | 51.20 s | peak 488864 KiB / 477.41 MiB |
| Native guest VM, Linux ELF | 38.605 s | 38.72 s | peak 471168 KiB / 460.13 MiB |
| Microsoft JScript 5.7 under Wine | 231.149 s | 232.88 s | observed RSS at least 583920 KiB / 570.23 MiB; full peak not measured |

The Wine launcher reports only 14128 KiB maximum RSS and almost no CPU time via
GNU time, despite the actual cscript process being sampled above 570 MiB.
**Do not use the launcher's RSS/CPU counters as cscript's process measurements.**
The wall time includes waiting for script completion. The other listed peaks
are GNU time measurements of directly executed processes. During cscript,
sampled host MemAvailable remained above 700 MiB; no memory failure occurred.

### Phase times, seconds

| Phase | Node JIT | Node jitless | js_min | Native guest | JScript/Wine |
| --- | ---: | ---: | ---: | ---: | ---: |
| Allocation, both batches | 1.159 | 1.652 | 5.802 | 20.232 | 74.110 |
| Lookup/slice/update, both | 0.284 | 0.407 | 3.005 | 1.357 | 28.166 |
| Own-field enumeration, both | 0.073 | 0.227 | 6.953 | 2.606 | 69.303 |
| Source/parser setup | 0.012 | 0.093 | 2.987 | 2.148 | 1.663 |
| Source character hashing | 0.032 | 0.369 | 13.895 | 3.094 | 4.807 |
| Real parse and field walk | 0.344 | 0.718 | 7.068 | 7.291 | 15.787 |
| Plain-array byte pages | 0.254 | 0.825 | 7.732 | 1.337 | 33.336 |
| Plain-array packed-word pages | 0.053 | 0.238 | 3.218 | 0.539 | 3.973 |

The native guest's first allocation batch takes **19.071 s**, versus **1.161 s**
for the second. This pronounced first-batch cost has not been attributed and is
included in the total, not hidden by warming up or reporting only the fast
batch. This benchmark is not a complete VM performance diagnosis.

## Implications

- JScript/Wine is about **4.56x slower than js_min**, **5.99x slower than the
  native guest**, and **50.9x slower than Node jitless** on this mixture.
  These are **not full-build time multipliers**.
- The slowdown is not uniform. JScript hashes characters faster than js_min,
  but allocation and own-field enumeration dominate its total. Real parsing
  plus the walk is about 2.23x slower than js_min, not 50x.
- The packed-word case is about **8.39x faster** than byte pages on JScript.
  That supports investigating packed-word storage for the WSH host fallback,
  behind existing accessors. It does not justify replacing Node/native fast
  storage or claim an 8x whole-build improvement.
- Preserve existing schema-driven traversal/representation work. If cscript
  bootstrap performance is inadequate, reducing redundant object construction,
  field enumeration and copied intermediate tables is higher value than
  concentrating only on source character scanning or hex-file output.
- RSS is a warning that a full JScript build needs an early memory gate, not
  proof it cannot fit. This benchmark uses fewer real compiler structures and
  a different lifetime pattern. Do not allocate the whole logical heap eagerly.
- Wine runs the actual Microsoft engine but is not native Windows; especially
  COM/file-I/O performance must not be treated as an XP measurement.

Next implementation gates remain: prove helper byte fidelity; add thin WSH
services and reusable output transport; run a bounded guest workload; then do
one real source build with time/RSS monitoring and full snapshot/executable
identity checks against the other hosts. No benchmark-specific VM fast paths.

## Reproduction

From `mmvm_v2_tests`, run these **serially**, using an existing default native
guest executable (or build a snapshot and package an ELF first):

```sh
node guest_vm/tools/benchmark_bootstrap_host.js
node --jitless guest_vm/tools/benchmark_bootstrap_host.js
LD_LIBRARY_PATH=../../firefox-1.0.8/lib ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/benchmark_bootstrap_host.js
./artifacts/benchmark-vm.exe guest_vm/tools/benchmark_bootstrap_host.js
. ../../wine/32.sh
WINEDEBUG=-all wine cscript.exe //nologo guest_vm/tools/benchmark_bootstrap_host.js
```

Optional `--small` quarters synthetic node/memory/operation volumes but leaves
the real parser inputs unchanged. Do not compare that mode against default
results. Selected sources must remain ASCII for the current FSO reader; it
errors rather than silently benchmarking different text on cscript.

Raw logs and diagnostic artifacts are ignored under `artifacts/bootstrap-bench-*`.
No generated source, snapshot, executable or external test changes are committed.
