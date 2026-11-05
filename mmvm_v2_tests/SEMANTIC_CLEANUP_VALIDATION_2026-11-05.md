# Ordinary-semantics/root cleanup validation — 2026-11-05

Implementation: 4b24556 on guestVM-cleanup3; starting point 77a2954.
Native runtime-support contract: 99. This is an ongoing audit log; pending
checks must not be read as passes.

## Cutovers and scope

- ea69882: ordinary descriptor validation and attribute transitions have one
  kernel-dialect decision function, directly callable as ordinary JS. Inputs
  are normalized bits, not per-operation heap descriptor allocations.
- c662bb7: ordinary write decisions and inherited named-owner traversal are
  shared, with ordinary JS backend dependency injection. Positive entry caches
  retain logical references; no whole-chain cache or persistent cell pointer.
- 55dfa70: runtime-record and embedding/frame root ownership have shared
  enumerators. Constructor receivers and pending callables are explicit.
  Diagnostic frame/register labels are constructed only on error.
- 4b24556: ordinary named-write rejection uses a native continuation for sloppy
  ignores and caught strict TypeErrors. The descriptor reader resolves named
  fields using the existing canonical key table, replacing opaque character-
  code recognition and respecting shadowing. Message slots are appended and
  contract 99 rejects stale code-only snapshot loads.

Descriptor fields that need guest calls and the old uncaught-exception exit
protocol remain explicit limitations. Special/exotic behavior is not silently
folded into the ordinary layer. No C, demo, external corpus, corpus harness,
source-sharing or substring changes. No downloads, Python, threads or emulation.
See [the design/work log](guest_vm/docs/semantic-unification.md).

## Completed intermediate and build gates

- Final Node and i386 js_min core suites pass: 12 guest programs / 270 guest
  assertions plus compiler, heap, embedding/context and execution checks.
- Focused existing embedding/context tests pass on both hosts after ownership
  cutover. Existing automatic-GC integration includes constructor allocation
  without a this read; context integration collects during a suspended host call.
- Structural stress after root cutover passes on Node and i386: 27 audits /
  111888 edges / 221 property-index audits / 74 embedding collections; maximum
  bumps remain 3531120 / 3531472 bytes under the 8 MiB cap. Final-image repeat
  remains pending.
- Standalone focused ECMA preserves six passes and the same one failure in
  seven selected Object tests. There are no measured new corpus passes yet.
  Four descriptor tests take 88.619/4102.491/126.852/5049.005 ms versus adjacent
  old-image 122.281/5457.150/149.149/6209.712 ms. This is not a full-suite result.
- Node, js_min and the snapshot rebuilding itself from source produce identical
  7122440-byte images, SHA-256:
  `98dc44fe9c754aa14dbf331b99d38824b7cd4c5cea989ebb8b215da8bbffef79`.
  Old image: 7110976 bytes; generated x86 falls from 623304 to 615665 bytes.
  The file is not compressed or sparse; source/debug inspection is retained.

Build observations (wall seconds / peak RSS KiB):

- Node: 8.71 / 306704; preceding observation 8.57 / 290784.
- js_min: 103.70 / 316452; preceding 99.91 / 321840.
- Self-host: 80.92 / 483560; preceding 79.56 / 481696.

These are individual observations, not controlled proof of build-speed parity
or a speedup. Small slower timings are retained rather than hidden. The final
corpus/benchmark audit runs serially on frozen sources.

## Combined acceptance — pending

- Full imported Test262: **3292 passed / zero failures, timeouts, skips or
  not-run files**. Runner 405.860864 seconds; summed test time 389.599210
  seconds; process wall 406.50 seconds / peak RSS 511564 KiB. Previous
  observation 426.882453 seconds / 524244 KiB: 4.9% lower runner time and
  2.4% lower peak RSS in this observation, not a controlled attribution of
  the entire difference to the cleanup.
- Historical ECMA at 4b24556: 1333 selected / 1329 executed / 990 passed /
  339 failed (including 39 watchdog timeouts) / 4 configured skips / 0 not run.
  Exact passing and failing filename sets match the saved baseline: no gained
  or lost passes and no new failures. Runner 657.017358 seconds; process wall
  657.29 seconds / peak RSS 463540 KiB. The previous 675.626443-second run
  is an unpaired observation, not proof of a cleanup-specific speedup.
- Stock Octane: all 28 paired runs pass, excluding RegExp; see scores below.
- Final GC/heap audits and bounded demos/HTTP/remaining integration: pending.

Raw results stay in ignored artifacts/semantics-* files. The existing ECMA
failures and standalone dynamic-library integration gap are not reclassified
as passing. The extra Node-hosted guest graphics matrix had validation bounds
in the previous report; direct-Node and standalone execution are distinct.

## Follow-up: injected exception ownership

The embedding audit reproduced a freed guest reference when failHostCall
received a guest object and collection ran before resume. Suspended executions
now enumerate their injected exception as a root, and failHostCall rejects a
foreign-runtime value before consuming the pending request. The existing
context/execution integration covers collection in this interval and passes
under Node and i386 js_min. This follow-up is later than the full corpus runs
above; those runs must not be represented as validation of the follow-up.

Follow-up implementation fe35c1b also passes the complete core driver under
Node and i386 js_min: 12 guest programs / 270 guest assertions, plus the
compiler, heap, embedding/context, native interpreter and structured compiler
checks. Raw logs: artifacts/semantics-exception-root-{node,jsmin}-core.log.

The follow-up Node-hosted native GC stress run passes 24 workload rounds,
27 structural audits, 111969 edge checks, 221 property-index audits and 74
embedding collections. Maximum observed heap bump: 3531312 bytes with an
8388608-byte cap; construction 1472 ms and workload/check time 15065 ms.

A fresh follow-up standalone image (7122608 bytes; SHA-256
946639b0c3302012ed38bb87cabf20a20f47f5199959c63e726f527ef8867652)
runs hello.js and preserves the four selected descriptor-test passes. The
focused ECMA runner takes 24.038751 seconds. This is a smoke/focused check,
not a repeat of either complete corpus or a cross-host identity check.

The corrected image now also has byte-identical i386 js_min and genuine
self-hosted builds (same SHA-256 above). js_min wall time is 109.22 seconds /
316392 KiB peak RSS; self-host wall time is 84.91 seconds / 481684 KiB.
Earlier observations were 103.70 / 316452 and 80.92 / 483560 respectively.
The slower build-time observations require an adjacent old-source control
before asserting performance parity. Paired stock Octane against debug.snap
ran 2026-11-05 23:37--23:58 UTC, excluding RegExp; all 28 runs pass.

## Paired stock Octane: 77a2954 baseline versus fe35c1b

Baseline debug.snap SHA-256:
c296b7964e3d88084882dbae31ce60243da6f587ffb23258f87246baf07c3538.
Candidate identity is recorded above. Suites run consecutively, baseline then
candidate, with no concurrent heavy job. No failures, crashes or timeouts.
Scores are higher-is-better; RSS is process peak KiB, not live guest size.

| Suite | Before score | After score | Change | Before RSS KiB | After RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 93.2 | 93.7 | +0.54% | 20864 | 20736 |
| DeltaBlue | 87.5 | 88.3 | +0.91% | 55936 | 55424 |
| Crypto | 172 | 169 | -1.74% | 37760 | 37760 |
| RayTrace | 234 | 268 | +14.53% | 365184 | 234112 |
| EarleyBoyer | 428 | 463 | +8.18% | 467072 | 467072 |
| Splay | 659 | 674 | +2.28% | 396288 | 400640 |
| NavierStokes | 244 | 264 | +8.20% | 24576 | 24704 |
| PdfJS | 771 | 817 | +5.97% | 239416 | 239904 |
| Mandreel | 472 | 483 | +2.33% | 487152 | 487128 |
| Gameboy | 1064 | 1104 | +3.76% | 95744 | 95860 |
| CodeLoad | 98.4 | 101 | +2.64% | 262656 | 244096 |
| Box2D | 396 | 404 | +2.02% | 92416 | 92672 |
| zlib | 599 | 574 | -4.17% | 103680 | 103680 |
| Typescript | 1407 | 1507 | +7.11% | 467244 | 466976 |

Geometric-mean score change: +3.65%. This aggregate does not establish
per-suite parity: Crypto and zlib are slower in this pair. Zlib requires
follow-up, as do build-time observations. Adaptive iteration/GC boundaries
affect RSS; do not attribute RayTrace's entire decrease to a layout change.
Raw metadata, logs and metrics: artifacts/semantics-octane/.
