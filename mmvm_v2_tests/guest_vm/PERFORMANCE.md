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

Use the host-side opcode profiler by placing `--vm-profile` before the guest
program path:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js --vm-profile demo2.js --size 64x64 --fps 20 \
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

