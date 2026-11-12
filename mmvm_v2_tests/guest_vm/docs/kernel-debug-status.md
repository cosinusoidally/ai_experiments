# Kernel debug implementation work log

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
