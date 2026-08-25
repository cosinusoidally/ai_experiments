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
