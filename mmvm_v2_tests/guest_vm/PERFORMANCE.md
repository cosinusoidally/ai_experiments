# Guest VM performance notes

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
