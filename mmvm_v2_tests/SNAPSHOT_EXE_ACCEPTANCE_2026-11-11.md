# Full snapshot / executable acceptance — 2026-11-11

Status: **complete, 2026-11-12**. Final acceptance analysis returns
`accepted=true`, with **zero unexpected failures**. Historical progress and
power-down notes below are retained as a work log; their pending statements
describe those checkpoints, not the final result.

VM implementation frozen at `bfc122f`, native contract 103. No C, demo, corpus
files, test assertions, selection policies or instruction limits changed.
Runs are serial; Node supervises processes, not guest language execution.

## Final verdict

Both launchers preserve every previously passing test. The executable was
tested after unlinking the input snapshot; it has no dependency on that file.
The complete main matrix contains **54 jobs**, with **14 additional paired
program checks** and a clean executable Test262 exit confirmation. Known ECMA
failures are explicitly retained, not counted as passes.

| Coverage | Snapshot via js_runner | Standalone executable |
| --- | --- | --- |
| Full core / embedding / heap / compiler | 12 programs, 270 assertions, internal checks pass | same, pass |
| Tokenizer | 84 checks pass | same, pass |
| Language and object integration | pass | pass |
| Selected JSON | 12 files / 908 assertions pass | same, pass |
| Imported Test262 | 3292 pass, 0 fail/timeout/skip/not-run | same, clean exit 0 |
| Historical ECMA | 994 pass / 335 known failures | identical filename statuses |
| Stock Octane | 15/15 pass | 15/15 pass |
| Bounded graphics / HTTP | demos 1–8, all three servers pass | same, pass |
| Native GC workload | 24 rounds / 48 collections, pass | same, pass |
| Supplemental programs | 7/7 pass | 7/7 pass |
| Genuine self-hosted rebuild | bit-identical, 83.118 s | bit-identical, 83.516 s |

ECMA's 335 failures **include** 39 watchdog timeouts. The same four previously
configured slow exclusions remain; zero files are unexpectedly unrun or newly
skipped. All 1333 selected per-file statuses match between launchers. Relative
to the archived 990-pass baseline: **990 preserved / 4 gained / 0 lost**.
This is not a claim of complete ES5.1 compliance.

The final clean executable Test262 run observes **exit status 0**: 3292 files /
variants / executed / passed; zero failures, timeouts, skips or not-run files.
Runner **422.092762 seconds**, process wall **422.82 seconds**, peak RSS
**512044 KiB**. It was deliberately repeated once to replace the missing exit
receipt from the recovered all-passing run; its exact file results match.
The first recovered observation remains in the logs and is not presented as
an observed process exit.

Supplemental coverage passes on both launchers: structural GC, raw FFI file
I/O, self-hosted frontend/adoption, frontend compilation of net.js, recursive
native compiler dependencies, demo8 runner I/O and three-context multiplexing.
Structural GC on each launcher checks **27 audits / 111996 edges / 221 property
indexes / 74 embedding collections**, maximum bump **3531768 bytes** under the
**8388608-byte** cap. Structural-driver process times are **35.423 / 36.498 s**
(snapshot/executable). The separate native workload supplies automatic native
collection coverage; the structural driver reports embedding collections.

The supplemental snapshot was independently rebuilt from unchanged sources
and matched the frozen image hash. It was **deleted before all seven
supplemental executable checks**. Both snapshot inputs remain absent. The
executable hash is unchanged. No heap-corruption, freed-reference or
segmentation-fault diagnostic was found in the acceptance logs.

The final existing js_min host also independently rebuilds the snapshot to
the same SHA-256. Node, js_min, snapshot-hosted and executable-hosted source
builds therefore agree byte for byte. Only LD_LIBRARY_PATH was configured;
js_min and the C loader were not rebuilt. The extra js_min confirmation
snapshot was hash-checked and deleted after this check. A final executable
hello run succeeds with every task-generated valid snapshot input removed.

Final analysis is reproducible without rerunning the suites:

```
node guest_vm/tools/validate_snapshot_exe_suites.js artifacts/launcher-final.snap artifacts/launcher-final.exe artifacts/launcher-acceptance --ecma-baseline ../../ai_experiments_bak8/mmvm_v2_tests/artifacts/cleanup-full.j9oRH8/ecma-current.log --test262-confirmation artifacts/launcher-acceptance/exe-test262-confirm
```

It returns exit status 0 with `accepted=true` and an empty `unexpected` list.
Without the clean confirmation it deliberately fails closed rather than
claiming that the recovered run's process exit was observed. No further VM
fixes were needed during the November 12 run; changes after `bfc122f` improve
the test supervisor/evidence handling and update the status documentation.

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
- Final snapshot **all 15 stock Octane suites pass**, including RegExp,
  Mandreel, zlib and Typescript. Scores and process times are below.
- Genuine self-hosted source rebuild passes in **83.118 seconds** and produces
  the same snapshot SHA-256 listed above. The rebuild output was removed.
- The original snapshot was **unlinked at 17:03:42 UTC**. The supervisor
  records deletion at `2026-11-11T17:03:42.847Z`; independent filesystem checks
  confirm both the input and rebuild output are absent. The executable-only
  matrix subsequently completes, with absence checked before every job.

## Stock Octane — both launchers

These are stock per-suite overall scores (including latency results where the
suite defines them), not quick-correctness scores. They are single observations,
not a controlled performance comparison against an earlier VM revision.

| Suite | Snapshot score | Exe score | Snapshot s | Exe s |
| --- | ---: | ---: | ---: | ---: |
| Richards | 84.1 | 96.2 | 3.404 | 3.523 |
| DeltaBlue | 69.8 | 91 | 4.580 | 4.413 |
| Crypto | 144 | 175 | 28.832 | 26.430 |
| RayTrace | 256 | 266 | 10.875 | 10.501 |
| EarleyBoyer | 438 | 451 | 27.779 | 27.278 |
| RegExp | 2.93 | 2.85 | 561.948 | 577.356 |
| Splay | 707 | 699 | 4.017 | 4.087 |
| NavierStokes | 273 | 270 | 10.082 | 10.225 |
| PdfJS | 820 | 736 | 18.726 | 19.098 |
| Mandreel | 509 | 495 | 106.117 | 108.635 |
| Gameboy | 1058 | 1004 | 13.875 | 14.663 |
| CodeLoad | 98.6 | 89.5 | 28.743 | 32.317 |
| Box2D | 391 | 374 | 14.820 | 15.629 |
| zlib | 600 | 595 | 255.000 | 257.428 |
| Typescript | 1430 | 1456 | 100.436 | 98.920 |

The first complete launcher phase takes approximately 43 minutes. Most of
that is the actual Test262/ECMA/stock Octane workload, including slow regex
cases and the unchanged ECMA watchdog failures. The second full launcher pass
is deliberate, not another repeat of an intermediate VM revision.

## Power-down checkpoint and resume

The supervisor and its active executable Test262 worker were terminated at the
user's request on 2026-11-11, approximately 17:07 UTC. No tests were left running.

- The entire snapshot phase is complete, including all 15 stock Octane suites
  and the bit-identical self-hosted rebuild.
- The input snapshot and rebuild output remain **absent**.
- Executable-only core, tokenizer, language, objects, GC and JSON checks pass.
- Executable-only live demos 1–8 and all three HTTP examples pass; application
  matrix time **79.551 seconds**. Every executable job started with the source
  snapshot absent.
- Executable Test262 was interrupted about 52 seconds into its run. It is
  **not** counted as complete. Executable ECMA, stock Octane and self-build
  remain pending. The saved checkpoint is phase `exe`, next job index `9`.

Resume from mmvm_v2_tests using the same command; completed jobs are not rerun:

```
node guest_vm/tools/validate_snapshot_exe_suites.js artifacts/launcher-final.snap artifacts/launcher-final.exe artifacts/launcher-acceptance --ecma-baseline ../../ai_experiments_bak8/mmvm_v2_tests/artifacts/cleanup-full.j9oRH8/ecma-current.log
```

The first snapshot argument is deliberately a nonexistent path in this phase.
Keep `artifacts/launcher-final.exe` and `artifacts/launcher-acceptance/` across
the reboot; they contain the executable and resumable results. The interrupted
Test262 job restarts, but completed snapshot suites and executable core/apps
are retained. Do not modify VM sources before the remaining acceptance runs.

After the main sweep, invoke the same command again to refresh the exact-file
analysis from saved logs (including the completed stdout-only ECMA baseline).
Additional `--only-programs` acceptance still needs both launchers: structural
GC, raw FFI, frontend/adoption, native compiler dependencies, demo8 I/O, and the
three-context demo. Because the main snapshot has been removed, generate a
fresh temporary snapshot, verify its hash matches the frozen image above, run
that supplemental two-phase driver, and let it delete the temporary snapshot
before its executable half. No supplemental pass is claimed yet.

The first interrupted corpus probe used an older preflight image and is not
counted as a completed suite run. The final frozen-image run is the acceptance
run; no whole corpus is being repeated for intermediate edits.

## Resume on 2026-11-12

The existing executable still runs i386 code after the power-down; its image
hash and preserved checkpoint are unchanged. The input snapshot is still
absent. No VM rebuild or source change was required to resume.

The resumed executable Test262 worker produced a complete summary:
**3292 executed / 3292 passed / 0 failed / 0 timed out / 0 not run**, runner
**465.797257 seconds**. Its supervisor disappeared before recording completion;
the worker's process exit status was not captured. Explicit recovery validates
the complete all-passing summary and every per-file result against the image
identity, records `processExitObserved: false` and a null status rather than
inventing exit code zero, then resumes at ECMA. The original log is retained.
ECMA/Octane/rebuild and supplemental checks remain pending at this checkpoint.

Executable ECMA subsequently completes on 2026-11-12, approximately
07:49–08:00 UTC: **994 passed / 335 known failures**, including **39 timeouts**,
**4 configured skips / 0 not run**. All **1333** per-file statuses match the
snapshot run exactly. Runner **661.512067 seconds**, process wall **663.26
seconds**, peak RSS **463720 KiB**. Stock Octane and the remaining checks are
still running; this is not yet a final all-suite completion statement.
