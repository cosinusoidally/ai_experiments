# Guest VM performance notes

## 2026-08-28: runtime-owned Buffer storage

Buffer backing bytes moved from per-allocation host objects into inline,
non-moving `BUFFER_BACKING` heap records. Native `Buffer.alloc` zeroes and
publishes the backing plus its first view in one kernel operation, and native
`Buffer.copy` performs overlap-safe byte movement without a semantic exit. This
is a representation change, not a demo-specific copy shortcut: Node reads the
same record through the JavaScript memory backend and GC traces the view-to-
backing edge normally.

The host-side copy loop was a major whole-demo cost. In an initial uncontaminated
`demo5.js` sample at 64x64, the first five-second window increased from roughly
1.2--1.6 FPS to about 4.3 FPS. A later window in that run received live keyboard
input and is not a valid comparison. `demo1.js` at 320x240 reached about 5.6 FPS,
up from the prior 5.2 FPS checkpoint and remaining above the approximately
3.6--3.8 FPS direct-`js_min.exe` baseline measured earlier.

## 2026-08-28: native/semantic boundary profiling

The opcode profiler now reports cumulative time and invocation count for the
kernel-native engine. In a 28-second `demo5.js` sample at 64x64, the engine
spent only about 0.99 seconds executing 23.7 million bytecodes. Approximately
5,000 unsupported-operation transitions consumed nearly all remaining time.
This rules out dispatch, double arithmetic, and GC as the current dominant
whole-demo cost.

The portable dispatch benchmark now has arithmetic, property, call, and array
workloads. On `js_min.exe`, 800,025 bytecodes reading properties from a
16-property object took about 22 ms natively versus 24 ms in direct host
JavaScript. A 5,000-iteration guest-call workload took about 5 ms natively
versus 6 ms directly, and a 700,332-bytecode indexed-array workload took about
12 ms natively versus 102 ms directly. These focused results are diagnostic,
not a substitute for demo FPS.

The first boundary-reduction pass keeps `Math.round`, common-range `Math.sin`
and `Math.cos`, Buffer `length`, numeric indexing, 16-bit endian operations,
and zero-copy Buffer slicing inside the native interpreter. At roughly 15.4
million `demo5` bytecodes this reduced cumulative semantic exits from about
3,900 to about 2,940, while native execution time remained around 0.64 seconds.
The demo was still around 1.5 FPS at that scene angle, so eliminating the
remaining general semantic transitions is still the leading work item.

## 2026-08-28: kernel-native collector checkpoint

The authoritative guest heap is now marked and swept by kernel-dialect code
compiled to i386 on `js_min.exe`. In a sustained `demo5.js` run, collection of
a roughly 12 MiB used heap measured about 6--7 ms for graph marking and about
80--85 ms for the coalescing sweep. The previous hybrid host graph mark and
uncoalesced host free-list rebuild each took seconds on the same workload.

The native dispatch benchmark remains healthy after the collector change:
1,000,007 native bytecodes took approximately 13 ms, compared with 53 ms for
the direct host loop and 5,235 ms for the semantic guest interpreter on the
development machine. A longer graphics run still slows while approaching the
next collection and then recovers. That steady-state decay is therefore a
separate allocation or execution issue, not the collector pause, and should
not be hidden by quoting only the post-collection frame rate.

## 2026-08-27: kernel-native dispatch checkpoint

`guest_vm/benchmarks/native_dispatch_benchmark.js` is a portable, X11-free
benchmark for the resumable bytecode engine. It runs under both supported host
VMs and keeps compilation/VM setup outside the timed region. From
`mmvm_v2_tests`, run:

```sh
node guest_vm/benchmarks/native_dispatch_benchmark.js 200000

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_vm/benchmarks/native_dispatch_benchmark.js 200000
```

On the development machine, the `js_min.exe` run completed 200,000 loop
iterations (1,400,006 guest bytecodes) in approximately 45 ms in the native
engine, versus approximately 59 ms for the equivalent direct JavaScript loop
in the old host shell and 6,736 ms in the semantic guest interpreter. There
were three intentional semantic exits for setup/call operations which have not
yet migrated. These figures demonstrate dispatch/arithmetic parity for this
narrow kernel; they do not yet claim whole-demo parity.

`guest_runner.js --vm-native program.js` selects the new engine explicitly.
Unsupported bytecodes currently execute one semantic step in the reference
interpreter and then re-enter native dispatch. Normal Node-hosted runs still
use their existing path, so the slower JavaScript emulation of the kernel does
not replace or regress Node's default backend.

## 2026-08-25: demo2 interpreter baseline and first compiler pass

The live benchmark command was run from `mmvm_v2_tests` against the locally
built minimal shell:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo2.js --size 64x64 --fps 20 \
  --no-fps-counter --debug-events
```

The initial guest interpreter took roughly 5.5--6.8 seconds per steady frame,
or about 0.15--0.18 FPS. After numeric lexical slots, register-resident leaf
bindings, direct numeric array indices, frame-initialized constants,
semantics-aware register reads and updates, MOVE-run dispatch, and register-list
call arguments, steady frames took roughly 3.1--3.7 seconds, or about 0.27--0.32
FPS. These are development-machine observations, not portable guarantees. The
change is approximately a 40% reduction in steady frame time, but demo2 remains
far from interactive under the guest interpreter.

Use the host-side opcode profiler as a reserved runner option.  With
`js_min.exe`, place it after the guest program path because the shell consumes
leading options itself:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo2.js --vm-profile --size 64x64 --fps 20 \
  --no-fps-counter --no-debug-events
```

The profiler is disabled in ordinary runs. When enabled it aggregates opcode
counts across the initial program and asynchronous callback executions and
prints cumulative reports every one million instructions. It changes timing,
so use it to understand instruction mix rather than to quote FPS.

The original profile was dominated by `MOVE` (about 45%) and `CONST` (about
12%). Frame-initialized constants removed dynamic `CONST` dispatch. Direct
register reads and update destinations reduced `MOVE` to about 27% at the
two-million-instruction sample. At that point branches consumed roughly 18%,
arithmetic and bitwise instructions roughly 25%, property operations roughly
8%, and global accesses roughly 5%. This broader mix is the point where a
kernel-dialect/native dispatch engine becomes more valuable than adding narrow
source-pattern special cases.

The benchmark deliberately uses a small framebuffer to expose interpreter
costs without waiting minutes for each sample. Higher resolutions still work
but are not yet practical through the guest interpreter.

## 2026-08-25: portable structured backend checkpoint

The portable bytecode-to-JavaScript backend now emits structured control flow,
compiles closure-backed callbacks, uses fixed-arity calls, caches compiled
programs and call sites, guards object/array shapes once per function, and
propagates proven return and array-element shapes.  It does not evaluate the
original guest source.  Finite-budget execution and failed specialization
guards retain the general interpreter path.

At the same 64x64, 20 FPS settings, steady `js_min.exe` observations are:

- direct `node_runner.js demo2.js`: approximately 19.6--19.8 FPS;
- `guest_runner.js demo2.js`: approximately 11.0--11.9 FPS;
- the earlier structured backend before the cache-order correction: about
  2.1 FPS;
- the opcode interpreter before the structured backend: about 0.3 FPS.

The large gain from 2.1 FPS came from fixing the compiled-program cache order:
the old path rescanned all 1,148 rasterizer bytecode words on every call before
checking the cache.  Guarded compound property writes and direct guarded array
`push` operations produced the next largest portable improvements.

Two diagnostic builds were measured and then reverted: omitting only
`rasterTriangle` and `clearFramebuffer` reached about 17.5 FPS, while omitting
the entire draw callback reached about 20.2 FPS.  These no-op substitutions are
not present in the repository.  They establish that parity now requires both a
native numeric/pixel kernel and further reduction of geometry/object overhead;
optimizing only the rasterizer cannot honestly meet the target.

An attempted mirrored/direct host-property cache is also absent.  A coherence
bug initially made the FPS counter cumulative and falsely showed more than 20
FPS.  Once corrected, the layout was substantially slower on old SpiderMonkey.
Measurements must therefore be checked for stable per-interval frame counts,
not merely a rising displayed number.

## 2026-08-25: demo1--demo7 correctness sweep

After completing the ES5.1 Math surface required by the later demos, a live
64x64 structured-tier sweep under `js_min.exe` measured approximately:

- demo1: 13.5 FPS;
- demo2: 12.2 FPS;
- demo3: 19.1 FPS;
- demo4: 17.0 FPS;
- demo5: 4.5 FPS.

These results are stable with, or slightly above, the immediately preceding
compiled-tier observations (12.8, 11.7, 18.9, 16.4, and 4.2 FPS respectively).
They are smoke-test measurements on the development machine, not portable
performance guarantees.

At 160x120, demo6 rendered its complete road/hills/car scene at roughly
0.8--1.0 FPS. Demo7 rendered its complete scene at roughly 0.4--0.6 FPS. An
earlier demo6/demo7 observation around 1.3--1.6 FPS is invalid as a performance
baseline: absent `Math.PI` made every generated track coordinate `NaN`, so that
run drew the HUD and background but skipped all rasterized scene geometry.
Correctness was confirmed by capturing the live X11 windows; no capture or
generated framebuffer is stored in the repository.

A Node 24.14.1 host running the same guest structured tier sustained about
19.5 FPS for demo7 at 64x64. Direct Node execution of demos 1--7 remained at
the configured 20 FPS cap in the same smoke sweep.

## 2026-08-25: demo8 guest startup checkpoint

The js_min-only demo8 command documented in `README.md` now opens its X11
window, parses Xauthority through the inlined Buffer implementation, generates
the 512x64 procedural skybox, initializes the 320x240 rally scene, and enters
attract mode with the compiled-native triangle rasterizer selected. A timed
smoke test established correct startup and continued execution; it did not
produce a trustworthy steady-state FPS sample, so no new frame-rate claim is
recorded here.

Functions constructing guest-defined classes stay in the semantic interpreter
to avoid a Firefox 1 generated-function receiver defect. Built-in construction
and constructor-free renderer functions retain structured/native compilation.
Demo8 is not a Node-host compatibility target.

## 2026-08-25: authoritative-heap migration gate

An experimental live handle-to-heap shadow allocation was tested and reverted.
With bytewise record clearing it reduced demo2 at 64x64 from roughly 11 FPS to
3.8 FPS. Relying on the bump heap's already-zeroed memory improved that to
about 5--6 FPS, still below the accepted baseline. No slow live switch is
present in the committed runtime; demo2 returned to 11.0--11.4 FPS.

The shared kernel IR now emits a bulk record initializer through JavaScript on
Node and generated i386 macro assembly on MMVM. Both backends produce identical
tested heap words. Live object migration must use this bulk path, rather than
scattered per-field peek/poke calls, before it can pass the performance gate.

## 2026-08-25: trusted fixed-layout accessor checkpoint

After the live heap migration, a 64x64 demo1 run could not complete enough
frames to print one five-second sample within 18 seconds. The common accessor
path was re-reading and validating a record's type and size for every fixed
field access, multiplying native `peek32` traffic throughout all demos.

`HeapRecords` now performs fixed-layout accesses through trusted internal
`Heap` primitives after its public accessor has established the relevant
record/index invariant. This does not mirror guest values in host objects and
does not expose raw heap addresses to guest code. The same 18-second command
then reported 5 frames in 6.5 seconds, or 0.8 FPS. This is a working migration
checkpoint, not an acceptable final result; the pre-migration demo1 reference
remains approximately 13.5 FPS at this resolution.

The next compiler checkpoint caches module-global and closure-cell values in
the generated activation, writes mutations through to the heap, spills local
environment registers before re-entrant guest calls, and reloads synchronized
state afterwards. Functions which require heap environments because they
contain nested callbacks now use this compiled path instead of unconditionally
falling back to the interpreter. Demo1 consequently improved to approximately
1.6--1.8 FPS at 64x64. This remains an intermediate result well below the
pre-migration reference; no parity claim is made.

Trusted value-cell operations now also bypass the duplicate generic
`LinearMemory.checkRange` pass while retaining the host allocation bounds
check. Heap-native array inline caches retain vector addresses and structural
versions, but never element values. After these changes, demo1 measured about
2.1--2.2 FPS at 64x64 and demo2 measured about 0.6 FPS at 64x64. The accepted
pre-migration references remain 13.5 and 12.2 FPS respectively.

## 2026-08-29: native guest-call and function-prototype checkpoint

The native interpreter now enters ordinary guest bytecode closures directly,
including calls forwarded by `Function.prototype.apply`. Function methods live
on a real runtime-owned guest function prototype, so fetching `.apply` also
stays in native prototype-chain lookup. This removes the repeated
`Function.apply` semantic call exits and bytecode-function `.apply` property
misses from demo8's macro-assembler recorder.

Native own-property queries subsequently removed `Object.hasOwnProperty` from
the recorder's fallback-call profile. With that addition the same initialization
timer reported about 23.4 seconds. The continuing post-initialization hotspot
is still the recorder's repeated Array join/string construction; own-property
queries no longer appear in the fallback-call table.

At 320x240 with a 20 FPS limit, demo8 continued to initialize correctly in
about 24.1 seconds as measured by its own initialization timer, versus roughly
26.1 seconds at the preceding source-processing checkpoint. This is a startup
improvement, not a steady-frame-rate claim: the first complete rendered frame
still did not finish during the subsequent 70-second observation window.

A native fast path for `Array.prototype.join` was measured and rejected. It
increased demo8's reported initialization time to about 45.2 seconds because
its allocation and character-copy cost exceeded the existing complete bridge.
The rejected path is not enabled or retained in the interpreter. The remaining
recorder profile is dominated by Array join/string construction and later
rasterizer specialization, so string allocation/interning must be improved as
a general facility before revisiting native join.
