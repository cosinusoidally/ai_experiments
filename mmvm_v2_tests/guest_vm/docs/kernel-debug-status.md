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
