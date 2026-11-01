# Performance recovery after Mandreel bring-up

## 2026-11-01, morning: controlled starting point

Mandreel passes at `6f2b295`, as recorded in
[the bring-up report](MANDREEL_BRINGUP.md). Its very slow loading and an
apparent self-bootstrap regression require investigation, not a benchmark
exception or moving collector. The artifact directory was cleared after an
interruption; the previous incomplete full Test262 run has no usable result.

The control is an isolated detached checkout of `6aadc41` (the pre-Mandreel
Typescript checkpoint). All heavy runs are serial on this machine, with fresh
Node-built images and the same unchanged i386 launcher. The worktree and all
generated images/logs are below ignored `artifacts/`. No external test/demo
source, C source, heap ceiling or kernel configuration is changed.

The first recovery change replaces separate generic paged liveness tables
with bounded integer scratch-record pages. One page lookup serves all fields
for a register visit. Named field indices describe the layout; first-PC
fields use pc+1 so zero or an ES3 fallback hole means unseen. Typed pages use
four bytes per field rather than a sixteen-byte guest tagged cell. The ES3
host fallback uses ordinary arrays and does not initialize unused holes.
Public compiler products and the packing algorithm are unchanged.

Richards, TypeScript-compiler and Mandreel compilation products agree with the
earlier allocator algorithm, including the executable frontend's temporary
reuse. Node and js_min comparisons pass. Standalone integration and bounded
GC stress (24 rounds / 48 native collections) pass. A preliminary packed
image also rebuilt byte-identically through js_min and genuine self-hosting.

### Fresh bootstrap comparison

Full GNU-time measurements, not the overlapping/cumulative internal stage
messages:

- Pre-Mandreel js_min construction: 98.62 s wall, 97.51 s user,
  333932 KiB peak RSS.
- Preliminary packed-metadata js_min construction: 98.72 s wall, 97.95 s
  user, 318340 KiB peak RSS.
- Pre-Mandreel genuine self-build: 98.55 s wall, 97.50 s user,
  545664 KiB peak RSS.
- Preliminary packed-metadata genuine self-build: 135.50 s wall, 133.07 s
  user, 480216 KiB peak RSS.

Thus the historical 249-versus-353-second combined gate is not by itself a
controlled estimate. Fresh js_min construction is effectively unchanged,
while self-hosting is about 37.5% slower. Runtime preparation accounts for
most of that difference: its stage reports 55.702 s in the control versus
83.962 s in the candidate. The reduction of approximately 64 MiB in target
RSS is consistent with the reserved-tail placement policy; it is not proof
of the precise CPU bottleneck. These are single observations, not statistical
confidence intervals. The final fallback change and allocator work still
need their own measurements.

### Initial paired stock Octane checks

The checked-in measurement supervisor now accepts `--reference-snapshot` to
pair two guest images suite-by-suite. `--include` selects an explicit subset.
It records both image hashes, scope, stock score, status, time and RSS, and
still supports its original Node / Node-jitless reference modes.

```sh
node octane_compare.js --reference-snapshot artifacts/pre-mandreel.snap \
  --snapshot artifacts/recovery.snap \
  --include Richards,DeltaBlue,RayTrace,NavierStokes \
  --output artifacts/octane-recovery-initial --timeout 180
```

All eight engine/suite runs pass. Scores (higher is better):

- Richards: control 93.2, candidate 94.8; wall 3.35 / 3.32 s.
- DeltaBlue: control 90.5, candidate 86.7; wall 4.55 / 4.48 s.
- RayTrace: control 234, candidate 235; wall 12.78 / 12.08 s.
- NavierStokes: control 273, candidate 271; wall 10.06 / 10.17 s.

This subset does not establish an all-Octane result or a significant gain.
Mandreel was not a passing control benchmark and must be revalidated on the
final candidate. The other suites, complete Test262, project tests, HTTP
servers, live demos, GC invariants and cross-host/self-hosted identity remain
in the final serial regression gate.

### Next architectural work

Native reclaimed regions are currently a size-sorted singly linked list.
Both selection past undersized holes and insertion of a returned suffix can
walk that list. The reserved tail increases dependence on that reuse path.
Replace repeated linear searches with a bounded size-class index while
retaining an authoritative region chain for ownership transfer and inspection.
Keep named field accessors, deterministic indexing, full-capacity fallback,
nonmoving references and the large-span protection required by Mandreel.

## Indexed allocator working point

The [nonmoving size-class index](NATIVE_FREE_INDEX.md) is implemented. The
initial image passes stock Mandreel through the ordinary runner: throughput
190, latency 1254, combined score 488, wall 112.37 s, user CPU 110.70 s,
peak RSS 486704 KiB. The previous passing observation was 844.18 s under the
diagnostic loader, combined score 476. These are not paired repetitions,
but the large loading improvement is distinct from the small score change.

The genuine self-build now completes in 80.80 s (user 79.97 s, RSS 480096
KiB) and is byte-identical to its Node-built input. This is about 40% faster
than the 135.50 s packed/linear-index candidate and 18% faster than the fresh
98.55 s pre-Mandreel control. Runtime preparation is 36.777 s instead of
83.962 / 55.702 s respectively. Final diagnostics and broad regressions are
pending; these working-point results are not an all-suite completion claim.

## Native frontend consistency and bulk word appends

The initial indexed-image sweep completed twelve paired suites before being
deliberately stopped at the start of zlib. All completed jobs passed; zlib
and RegExp have no completed result in that partial sweep. It identified a
CodeLoad slowdown (103 versus 94.1) despite the larger TypeScript improvement
(998 versus 1386). Small score differences elsewhere require repetitions,
not treating a single result as an exact performance guarantee.

Instruction producers now batch already-canonical integer words through
ordinary `Int32Array.set`. WordBuffer's checked append remains available;
only compiler/optimizer-owned words use the trusted producer method. The ES3
plain-array path retains its existing append algorithm. Empty appends remain
no-ops, capacity grows through one shared method, and no new VM intrinsic or
benchmark-specific instruction is added. Compilation products for Richards,
TypeScript and Mandreel continue to agree. Bulk append by itself did not
establish CodeLoad parity (98 versus 94.6 in a subsequent pair).

Inspection showed that native eval and Function frontends still retained
private ASTs and built hint/location graphs discarded by native adoption.
They now share the existing native frontend's owned-AST/packed-word policy,
including whole-statement temporary reuse. Public AST/structured compilation
keeps its defaults. Strict/sloppy eval declaration rules and exact function
source remain unchanged. Parser errors retain their token filename/position;
only metadata which adoption does not store is omitted. Object property
TypeError checks are also placed inside primitive-receiver handling rather
than repeated on the reference fast path. The native contract is 92.

This working point passes integration, 24-round/48-collection GC stress and
2071 selected ch11/ch12/ch13 Test262 cases, with zero failures/not run/timeouts.
Runner elapsed is 73.849 s versus the prior 109.405 s selected observation.
CodeLoad passes at 97.1 versus a fresh 99.3 control; whole-process wall improves
to 28.66 versus 30.16 s and RSS to 266368 versus 308480 KiB. The score still
needs repetition/component measurement before claiming parity. Optional
`octane_runner.js --diagnostics` now prints the stock harness's completed
per-benchmark means, without wrapping timed benchmark callbacks or modifying
the external inputs. Complete tests, builds, demos and final full Octane
performance parity remain pending.
