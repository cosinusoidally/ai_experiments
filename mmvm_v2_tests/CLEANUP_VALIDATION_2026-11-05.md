# Guest VM cleanup validation — 2026-11-05

Implementation checkpoint: `cdc4539` on `guestVM-cleanup3`.
Starting implementation: `a7fc652`. Documentation-only follow-ups do not
change the implementation under test. This report distinguishes completed
checks from the broader audit still running; it does not replace failures
with smoke-test passes.

## Scope

- Removed legacy constant-local/initializer-override semantics from the
  kernel compiler and interpreter. Dependencies are explicit graph inputs.
- Removed the obsolete wrapper-owned refill arena; named acquire/release
  operations and one collection-preparation boundary own the handoff.
- Shared resolved property-descriptor addressing between native execution
  and the portable JS backend. Checked accessors retain their validation.
- Removed no-op helper-install/retry paths and shared view-kind ABI IDs.
- Centralised native rejection IDs, profile names and cold diagnostic
  formatting/source-location lookup. No guest-pointer dereferences are
  introduced by formatting a rejection reason.

No demo, C source, external corpus, Test262/ECMA/Octane harness or language
feature was changed. Generated artifacts/logs are not checked in. All heavy
validation jobs run serially; no VM multithreading or emulation is used.

The checked-in JavaScript line count is 232 lines lower than `a7fc652`,
including comments and extensions of existing integration checks. This is
not by itself a performance or correctness argument.

## Native code and snapshot gates — completed

- The default integrated i386 interpreter/collector instruction segment is
  byte-identical throughout the series: 630331 bytes. Refactoring the
  embedding/compiler paths is not claimed to accelerate those instructions.
- Node, js_min and genuine same-seed self-host builds produce identical
  7108408-byte snapshots. SHA-256:
  `f8623d93b4a887acca4de62badc86f06b5e935bc921c08c5509e26e99257f3bc`.
- The final image is 10680 bytes larger than the starting image. Explicit
  metadata and retained diagnostic code have a cost; this is not a snapshot
  size reduction and no source/debug information was stripped.
- Self-hosting rebuilds from current sources. It is not a seed-image copy.
- The isolated `476c904` control reproduces its own reference image exactly.

Build observations (wall seconds / peak RSS KiB):

| Measurement | Control | Candidate |
| --- | ---: | ---: |
| Adjacent Node descriptor prototype | 9.20 / 302920 | 9.16 / 306168 |
| Final Node, including diagnostics | — | 9.06 / 309252 |
| Adjacent self-host, final source | 86.74 / 481408 | 87.22 / 481592 |
| Final js_min | — | 106.25 / 322828 |

The adjacent self-host control is the allocator checkpoint, before the shared
descriptor/diagnostic cutover. These are individual observations, not a
confidence interval or proof of a CPU speedup. Node peak RSS is modestly
higher in the observed pair; self-host RSS is essentially unchanged. Earlier
slower/faster build observations remain in `guest_vm/docs/cleanup.md`.

## Core, GC and heap audits — completed

- Project suite passes on Node and actual i386 js_min: 12 guest programs /
  270 guest assertions per host, plus internal compiler, native/predecoded,
  heap, embedding, continuation and error-location checks.
- CLI smoke paths pass for hello, net, node_web and demos 1/2. The
  three-context multiplexing demo passes on both hosts. These are not a new
  claim of graphical interaction for every demo.
- Bounded structural GC checks pass on both hosts: 27 audits, 111888 checked
  edges, 221 property-index audits and 74 embedding collections. New checks
  cover provider identity, exclusion of the portable free index during native
  ownership and release of borrowed-index state.
- Maximum observed guest-heap bumps remain 3531120 / 3531472 bytes under the
  8 MiB cap. This workload shows no guest-heap growth regression.
- Standalone workload passes 24 rounds / 48 native collections.
- Node and i386 offline marking agree: 37843 reachable records, zero missing
  marks, 455 unreachable occupied records / 85784 bytes. The latter are
  reported, not silently described as reachable or eliminated.

## Broader frozen-source audit — in progress

Started around 12:23 UTC. Run Test262, ECMA and a stock Octane image comparison
once for this combined checkpoint, not once per small source edit.

- Full imported Test262: completed around 12:30 UTC. **3292 passed / 0 failed /
  0 timed out / 0 not run / 0 skipped**, all 3292 authored files executed.
  Runner elapsed 471.851133 seconds; summed test time 453.062347 seconds.
  Process wall 472.58 seconds / peak RSS 524532 KiB. Previous cleanup repeat:
  436.840919 seconds / 511672 KiB. Correctness is preserved, but the observed
  8.0% time and 2.5% RSS increases are not silently called parity. Compare an
  adjacent slow-case baseline before attributing the difference to the code.
- Historical ECMA: pending. Compare specific passing filenames with the
  previous 990-pass result, not just its total. Previously: 339 failures
  including 39 timeouts, four explicitly configured default skips.
- Stock Octane: pending. Pair all fourteen suites other than RegExp against
  the starting snapshot. RegExp's much longer stock run is not repeated here;
  this exclusion must not be called a full-fifteen stock sweep.
- Live graphics/HTTP and additional integration checks: pending.

Commands and final results will be added when these runs complete. Raw
outputs stay in ignored `artifacts/cleanup10-*`.

Test262 command:

```sh
./artifacts/js_runner.exe artifacts/cleanup10-final.snap test262_runner.js
```

## Remaining architectural work

This is a first series of cutovers, not completion of every issue in the
[cleanup register](guest_vm/docs/cleanup.md). Ordinary/exotic lookup and
mutation still have overlapping implementations. Broader semantic unification,
embedding-root lifetime APIs, complete adopted source maps and exhaustive
host-transition auditing remain open. The standalone entry stub still prints
the raw diagnostic protocol; symbolic formatting is available to the inspector
and profiler, not claimed as a new default entry-stub feature.
