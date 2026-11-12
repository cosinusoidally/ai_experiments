# Kernel debug implementation work log

Current implementation: `-g`, independent `-O0`, deterministic bound DWARF,
executable incorporation and real debugger checks are implemented. Final
cross-host identity passes both policies, including -O0 self-hosting. Broad
acceptance is still running; the full Test262 timing caveat remains explicit.
See [measured results](kernel-debug-benchmarks.md). Entries below are
chronological working points, not contradictory descriptions of current API.

## 2026-11-12: first -O0 working point

The runner accepts `-O0` for native kernel construction, with the same shared
IR/backends. It disables graph inlining, stack-home reuse, register residency,
single-use forwarding, store fusion, optional branch pruning and native tail
frame elimination. Required kernel intrinsics/accessor lowering remain.
Snapshot metadata distinguishes the optimization policy and code-only loads
reject a mismatched policy. DWARF/-g is not yet implemented at this checkpoint.

Completed checks:

- Existing broad kernel/compiler integration passes on Node and i386 js_min,
  including the same helper graph/effects compiled with the -O0 policy.
- Default optimized kernel instructions are byte-identical to the pre-change
  control: 672705 bytes, SHA-256
  `3ef0776560227fa90a3acaca5af7a2e1fa83ae6f8f8144f9b94d8905084faedd`.
- An -O0 standalone image builds on Node, runs hello and the existing
  standalone-language integration, and passes the bounded native GC workload:
  24 rounds / 48 collections.
- Initial -O0 kernel size: 545244 bytes, snapshot 7175976 bytes. Smaller code
  here is not a speed claim; omitted inlining can reduce size while increasing
  execution cost. The required build/runtime benchmark matrix is pending.

The full debug plan and later acceptance gates remain in
[kernel-debug-plan.md](kernel-debug-plan.md). These focused checks do not
constitute a new whole-corpus or all-demo acceptance result.

## 2026-11-12: canonical provenance working point

The debug-only source registry resolves every compiled graph function against
the original project-relative parser AST, structurally validating reformatted
host function source rather than guessing decompiler line numbers. Unknown or
ambiguous origins fail closed. Lowering retains statement locations, and the
backend records authoritative instruction offsets and frame boundaries.

`guest_vm/tools/check_kernel_debug.js` runs on Node and js_min and compares the
actual interpreter/collector graph with and without provenance. Both hosts pass:

- Optimized: all 672705 instruction bytes unchanged; 269 canonical functions;
  18597 statement positions.
- -O0: all 545244 instruction bytes unchanged; 269 canonical functions;
  25066 statement positions.

Source metadata is excluded from the inliner's eligibility calculation. This
is essential: metadata must not alter the generated program. The source-reader
embedding option remains internal plumbing, not a completed public `-g` API.
DWARF serialization and debugger acceptance remain in progress.

## 2026-11-12: DWARF and executable incorporation

The runner now builds bound ELF32 DWARF sidecars with `-g`. The pure-JS
packager accepts `--debug-info`, validates the snapshot's SHA-256 binding,
relocates section-relative kernel addresses and adds nonallocated DWARF plus
sized native function symbols. Ordinary snapshot loading is unchanged.

Implemented records include function/statement coordinates, parameter locations,
conservative definitely-assigned -O0 local ranges, inline origins/call sites,
and frame-pointer/saved-register/tail-epilogue CFI. Optimized locals are
deliberately unavailable rather than incorrectly described using a reused
slot. See [kernel-debugging.md](kernel-debugging.md) for the precise API and
limitations.

Completed consumer checks:

- objdump decodes the relocatable sidecar's units, lines, locations and frames.
- objdump disassembles sized kernel functions in `.text.kernel` in the exe.
- GDB breaks at canonical source statements and interleaves native instructions
  with original JS source.
- GDB recovers live kernel parameters and unwinds the optimized helper graph,
  including an inline frame. -O0 locations before initialization are now
  unavailable rather than showing garbage stack contents.

The full-graph debug check passes on Node and js_min, with matching sidecar
SHA-256 on both hosts as well as unchanged instruction bytes. Renaming snapshot
and executable outputs preserves bytes. A genuine self-hosted artifact check
and serial -O0 benchmark/GC/runtime matrix are currently running. Those pending
gates are not yet a completed whole-suite acceptance result.

The first end-to-end working point additionally passes:

- Genuine self-hosted debug snapshot **and sidecar** equality with Node/js_min.
- Node/js_min/self-hosted debug executable equality.
- Default standalone core: 12 guest programs / 270 assertions plus internal
  compiler/heap checks; native GC: 24 rounds / 48 collections; stock Richards.

The unchanged optimized code SHA-256 remains
`3ef0776560227fa90a3acaca5af7a2e1fa83ae6f8f8144f9b94d8905084faedd`.
Other runtime configurations, the full final matrix and the benchmark report
remain pending at this checkpoint.

## 2026-11-12: optimized ownership and consumer refinements

The optimized pass now tracks logical ownership of physical local storage,
including actual register locations and EDX's canonical write-through home.
Reused slots invalidate prior bindings, joins intersect ownership, and loops
drop uncertain backedge ownership. Inline callers conservatively keep locals
unavailable until richer return-edge analysis exists. The full-graph check
also verifies that two bindings never simultaneously claim reused storage.

Both executable modes now expose exact launcher/bootstrap/kernel code sections
and non-executable header/binding/padding/heap sections, without moving any
PT_LOAD or changing snapshot payloads. Sidecar relocation does not materialize
the NOBITS code section as a spurious copy of debug data. The binding version
has one authoritative definition in the shared snapshot format.

The first four-policy runtime matrix completed successfully: every policy
passes the existing core suite, native GC workload and stock Richards. The
debug executable also passes the core suite with its input snapshot path
absent. Real GDB verifies that editing an initialized -O0 local changes later
native computation, alongside live parameters, native/inline backtraces,
normal program exit and source-interleaved GDB/objdump disassembly.

An optimized-ownership self-host bring-up exposed a native dynamic negative
array-index lookup limitation: the range builder read its empty list at -1.
The builder now explicitly checks for a predecessor, avoiding an unnecessary
out-of-range lookup. The self-hosted build completes after this correction.
This is not a claim that the independent general negative-key VM limitation
has been implemented or that language tests were changed to work around it.

Pre-debug Node build control at `b93e08e`: 10.19 s user CPU / 9.40 s wall,
315884 KiB peak RSS. The first new default build observed 10.07 s user CPU /
12.90 s wall, 316176 KiB RSS; the subsequent default build observed 10.20 s CPU /
9.47 s wall. No CPU build regression is apparent; wall-clock variance is why
the final short controls use serial interleaved repetitions.

The final expanded build matrix is running. It includes both debug policies
on Node/js_min/optimized self-host, plus an -O0 host rebuilding itself. The
complete corpus/stock-suite report remains a separate pending acceptance gate.

The final metadata review additionally clips optimized local ranges across
tail-frame teardown and gives inline functions separate abstract-origin DIEs,
without inheriting a concrete callee's machine homes. Native return types are
explicit i32. The high-level graph check confirms 333 optimized locals and
2794 -O0 locals with conservative availability, unchanged native instructions,
and no simultaneous claims on a reused slot.

GDB consumer checks pass after these changes, including initialized optimized
locals in the number formatter while its uninitialized bindings remain
unavailable. The earlier ambiguous developer `--cross-host-only` option has
been replaced by `--resume-builds`, guarded by source-content identity and
artifact hashes. Final cross-host checks are running on that frozen source set.

## 2026-11-12: default-runtime cost investigation

The first complete default corpus run passes all 3292 Test262 files and matches
the archived ECMA set exactly: 994 passes, 335 known failures and four approved
skips, with zero lost passes. Test262 took 477.19 s. A freshly built pre-debug
`b93e08e` control passes the same 3292 files in 428.98 s; that paired result
establishes an approximately 11% slowdown, not merely a comparison with an old
favourable historical run.

Optional source-registry/DWARF modules were still loaded into every generic
image. They are now loaded on demand through the backend's internal support
accessor. CommonJS resolution is captured in the defining module; the shell
loader remains the current guest-owned loader, not an obsolete bootstrap
callback. No interpreter instruction changes or benchmark-specific fast paths
are involved.

Images drop from 7453608 to 7325704 bytes (optimized), and from 7326632 to
7198728 (-O0). The isolated existing eval-heavy file
`ch07/7.8/7.8.5/S7.8.5_A1.4_T2.js` passes in 85.531 s versus the control's
86.440 s (test-body time, separate fresh processes). A full post-change
Test262 run passes 3292/3292 in 447.58 s: an improvement over 477.19 s, but
still about 4.3% slower than the one full control observation. Do not describe
that as established full-corpus performance parity.

The first three interleaved short controls give Richards medians 93.8 for
pre-debug and default, 93.6 for -g, and 59.7 for each -O0 policy. Those data
precede the on-demand-loading refinement; fresh final controls and the remaining
stock/corpus/application matrix are pending. Actual GDB variable editing,
optimized local availability, inline unwinding and source-interleaved objdump
checks pass with the on-demand-loading build.

The final on-demand build now passes Node/js_min/standalone snapshot-and-sidecar
identity for both policies, plus an -O0 host rebuilding itself. All three
packager hosts produce the same executable. Same-size damaged sidecars are
rejected; execution succeeds while both build input files are unlinked and
does not mutate the executable. Resume rejects changed source identities.
The final short controls give Richards medians 99.4 default / 99.3 pre-debug,
98.9 -g, 63.2 -O0 and 63.1 -g -O0. The final remaining ECMA/stock matrix is
running serially with live per-job logs and resumable receipts.

## 2026-11-12: crash recovery and requested pause

Recovered the committed work from the sibling `ai_experiments_bak9` checkout
into the fresh `guestVM-cleanup3` branch by local Git transfer and fast-forward.
The recovered HEAD and tree match the backup exactly at `412c036`; no source
changes were left uncommitted in the backup. The backup remains untouched.
Saved cold-build artifacts, control receipts and the archived ECMA baseline
were copied into the new checkout's ignored artifacts directory. Generated
snapshots, executables and sidecars remain untracked.

Bounded post-recovery checks pass:

- Existing i386 js_runner executes hello with the recovered -g snapshot.
- Broad kernel/compiler checks pass on Node and existing i386 js_min (using
  LD_LIBRARY_PATH, without rebuilding the binary).
- Full-graph Node debug checks preserve all optimized/-O0 instruction bytes,
  verify canonical provenance and reject overlapping reused-slot ownership.
- Artifact resume checks accept the unchanged source identity and saved hashes;
  renamed outputs, damaged-sidecar rejection, snapshot-free execution and
  non-mutating execution checks pass.
- Real GDB/objdump checks pass, including local edits affecting native execution,
  optimized availability, inline/native unwinding and source disassembly.
- Native GC stress passes 24 rounds / 48 collections.

The saved final-image corpus results are Test262 3292 pass / zero fail or
timeout, and historical ECMA 994 pass / 335 known fail (including 39 timeouts)
/ four approved skips / zero newly lost passing files. Default stock Octane
completed Richards, DeltaBlue, Crypto, RayTrace and EarleyBoyer successfully.
The machine crash interrupted RegExp before an exit receipt or score was
recorded: it is **incomplete**, not counted as a pass or a VM failure. Remaining
stock suites, other-policy full sweeps and final bounded application acceptance
are still pending. The approximately 4.3% full-Test262 timing caveat remains.

At the user's request, stop after committing this recovery checkpoint. Do not
restart the long matrix as part of this recovery. A later explicit continuation
can resume the saved completed jobs with:

```
node guest_vm/tools/benchmark_kernel_debug.js artifacts/kernel-debug-cold --ecma-baseline artifacts/launcher-acceptance/exe-ecma.log
```

The driver retries the interrupted RegExp job and reuses completed receipts;
it does not fabricate a score from the partial log.
