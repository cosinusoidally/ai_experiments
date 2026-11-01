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

## Flat compiler tables and phase measurements

Compiler products use either ordinary arrays or explicitly paged tables. The
compiler, optimizer, register packer, verifier and descriptor adopter now
select the representation at the enclosing operation and access it directly,
rather than calling the generic table dispatcher for each constant access.
This does not change the public representation or compilation algorithm.

`tools/profile_frontend.js` is an optional guest-side phase diagnostic using
the seeded parser/compiler constructors. It reports parsing, outermost
compilation, function analysis, optimization and register packing for each
stock benchmark component. Compilation includes optimization, which includes
packing: these are overlapping measurements, not additive phases. Timed
benchmark functions and external input files are not replaced. Instrumented
scores must not substitute for clean benchmark runs.

One paired diagnostic run of CodeLoad measured 18 Closure loads and 16 jQuery
loads on each image:

- Closure: candidate/control parse 946.79/924.63 ms; compile
  1144.27/1044.71 ms; packing 208.57/164.44 ms.
- jQuery: candidate/control parse 11245.11/11415.80 ms; compile
  13049.87/16315.29 ms; packing 2280.28/2710.33 ms.

Thus the small-source packing overhead is not a general parsing regression;
the larger source compiles appreciably faster. Clean CodeLoad repetitions
still vary, and neither this instrumented result nor improved whole-process
time establishes score parity. The complete final regression/performance
gate remains outstanding.

The complete unchanged Test262 corpus passes on this working point:
3,292 passed, zero failed/not run/timeouts, runner time 442.941048 s and
summed test time 425.934102 s. The pre-Mandreel checkpoint recorded
490.724332 runner seconds: about 9.7% more time is removed in this observation.
See `../TEST262_STATUS.md` for the full chronological ledger. This closes the
whole-Test262 correctness gate, not the remaining Octane/build/demo gates.

## Built-in call classification

The contract-92 project gate passed on both bootstrap hosts (12 guest
programs and 270 assertions per host plus embedding, compiler, CLI and
context checks), taking 179.16 s combined. The program/environment-independent
snapshot gate passed js_min/Node byte identity and a genuine self-compiled
fixed point in 275.44 s combined. A separate uninstrumented self-build took
76.84 s (76.23 user seconds, 480304 KiB RSS), versus the fresh pre-Mandreel
control's 98.55 s. Both structural and standalone GC stress passed, including
102242 checked edges and 48 standalone collections respectively.

Paired live demos1--7 rendered and closed through X11 input on both images.
The simpler blitting workloads exposed a remaining throughput difference:
alternating demo3 runs at 320x240/20 FPS limit measured about 4.0--4.1 FPS
on contract 92 versus about 4.3 on the control. These demos are not claimed
to achieve their requested cap under either interpreter. No demo source was
changed. The existing thread-free libc `profil` diagnostic attributed about
28--30% of demo3's native samples to built-in call handling, while collection
and allocator functions were minor in the sampled interval.

Native built-in calls classified minimum argument counts through a long
intrinsic-ID comparison chain on every call. `native_intrinsics.js` now owns
the declarative minimum-count policy, materialized once per runtime as a
GC-traced guest value vector. Validated native IDs index that table directly.
These counts describe handler acceptance, not public `Function.length` or
new restrictions on ES5.1 calls. Invalid IDs are rejected before indexing;
forwarding, receiver handling, argument conversion and exceptions are
unchanged. An exhaustive refactoring comparison agreed for all 131 IDs.
Contract 93 identifies the new runtime-support table.

Initial alternating demo3 observations with this change are about 4.1--4.2
FPS on each image. Integration and 48-collection native stress pass. The
complete conformance, Mandreel, build, demo and stock-performance rechecks
for this newer working point remain pending; the contract-92 results above
are deliberately not relabeled as contract-93 results.

### Contract-93 completed conformance and Mandreel checks

The unchanged complete Test262 suite passes: 3292 passed, zero failed/not
run/timeouts; runner elapsed 430.384625 s, external wall 431.01 s, user CPU
427.83 s, RSS 511028 KiB. This is about 2.8% less runner time than contract
92 and 12.3% less than the pre-Mandreel observation. Stock Mandreel passes
at throughput 202, latency 1322 and combined score 517; wall 102.81 s,
user 101.74 s, RSS 486616 KiB. The preceding indexed-image observation was
combined 488 and wall 112.37 s. These are completed ordinary runs, not
profiling windows or benchmark-specific substitutes.

Final contract-93 project tests pass on both Node and js_min: all 270
guest assertions per host, compiler/embedding checks, CLI paths and the
three-context demo. Combined wall 186.82 s, user 185.25 s, RSS 271444 KiB;
the earlier contract-92 run was 179.16 s, so this single observation does not
establish a project-gate speedup. Cross-host/program/environment-independent
snapshots and the genuine self-built byte-identical fixed point pass in
282.17 s combined (278.35 user seconds, 480320 KiB RSS). The preceding
contract-92 combined gate was 275.44 s; these totals include multiple builds,
not just one self-build. The bounded structural GC audit passes 27 audits,
102269 edges, 221 property-index audits and 74 embedding collections, with
maximum bump 3523240 bytes under the unchanged 8 MiB cap. Its full wall time
is 15.35 s. Stock-performance and live-demo wrap-up results follow separately.
