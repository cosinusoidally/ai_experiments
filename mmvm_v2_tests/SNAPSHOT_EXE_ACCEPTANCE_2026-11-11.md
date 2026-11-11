# Full snapshot / executable acceptance — 2026-11-11

Status: **in progress**. This file distinguishes completed checks from the
pending full-corpus results. The earlier packaging-only report is not a full
suite acceptance claim.

VM implementation frozen at `bfc122f`, native contract 103. No C, demo, corpus
files, test assertions, selection policies or instruction limits changed.
Runs are serial; Node supervises processes, not guest language execution.

## Images and independence check

- Snapshot: 7,299,928 bytes, SHA-256
  `13bda0d7ac9bb0a44fb9447f32092fa599575ed166dea0e3bf63546604187712`.
- Executable: 7,308,640 bytes, SHA-256
  `f9fcf926f32f98d978eeeda640cc273587fda3c734109c89adb26c1e3e73515e`.
- Five superseded, task-generated preflight snapshots were removed before
  the final sweep. They can be regenerated from source; generated binaries
  and snapshots are not committed.
- The full supervisor first runs the snapshot matrix, then **unlinks the input
  snapshot**, logs the deletion timestamp, and checks absence before every
  executable job. It does not rename the input to a backup or restore it
  during that phase. Source rebuild outputs are hashed and removed immediately.
- The executable hash is checked after every job. Results and logs stay in
  ignored `artifacts/launcher-acceptance/`.

## Baseline and scope

- Imported Test262: last full baseline **3292 passed / 0 failed**.
- Historical ECMA: last full baseline **990 passed / 339 failed**, including
  **39 timeouts**, plus **4 configured slow skips**, **0 not run**. The exact
  filename sets are compared, not merely the totals. Focused later Object
  fixes were not previously counted as a whole-suite total.
- Octane: all **15** suites have recorded successful stock runs, including
  RegExp and Mandreel. This sweep runs each suite independently in stock mode,
  with setup, warmup, timed work and correctness checks intact, not quick mode.
- Live applications: demos 1–8 at 320x240, demo8 garage/auto-drive switching,
  net.js, node_web.js and node_hello.js. GUI runs are bounded, not seven-minute
  stress runs. HTTP checks include directory listing, default index, binary
  fidelity, HEAD/length, redirects, missing files and unsupported methods.

## Completed preflight and discovered gaps

- Full core passes on direct Node and i386 js_min: 12 guest programs /
  270 assertions plus internal integration checks.
- The embedding-oriented core driver initially failed when itself executed
  in a snapshot. This was not waived as a known failure. Diagnostic runs found
  an outer isFinite callback dependency and missing native-to-guest semantic
  handoffs for Math/String; exception conversion also needed guest-owned
  Error.prototype.toString. These were fixed in `bfc122f` using the existing
  guest builtin/activation mechanism. No tests were weakened.
- The final snapshot completes the full uninstrumented core driver in
  109.062 seconds, including ordinary/predecoded native engines and the
  structured compiler checks.
- The 41 packaging/launch checks pass on the final image, including packaging
  under Node, js_min and js_runner with identical output.
- Final snapshot tokenizer, language integration, object operations, bounded
  native GC (24 rounds / 48 collections), and selected JSON (12 files /
  908 assertions) pass.
- Final snapshot demos 1–8 and all three HTTP examples pass the bounded live
  application matrix (81.386 seconds).
- Final snapshot complete imported Test262: **3292 / 3292 passed, zero failures,
  timeouts, skips or not-run tests**; runner **453.320431 seconds**, process
  wall **453.981 seconds**.
- Final snapshot complete historical ECMA: **994 passed / 335 failed**,
  including the same **39 timeouts / 4 configured skips / 0 not run**. All
  **990** baseline passing filenames remain passing; **4** gained passes:
  ecma/GlobalObject/15.1.2.7.js, ecma_3/Array/regress-387501.js,
  ecma_5/Object/15.2.3.7-01.js and ecma_5/Object/propertyIsEnumerable.js.
  Runner **665.285013 seconds**, process wall **666.74 seconds**,
  peak RSS **463724 KiB**. The old complete stdout-only baseline log lists
  RUN/PASS but not stderr FAIL lines; its completed RUN-without-PASS files
  are retained as failures in the analysis, not treated as unexecuted tests.
- Stock Octane and the snapshot-absent executable matrix remain pending.

The first interrupted corpus probe used an older preflight image and is not
counted as a completed suite run. The final frozen-image run is the acceptance
run; no whole corpus is being repeated for intermediate edits.
