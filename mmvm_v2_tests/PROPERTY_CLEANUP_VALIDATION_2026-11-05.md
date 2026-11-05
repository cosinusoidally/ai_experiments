# Property/root cleanup validation — 2026-11-05

Implementation checkpoint: 0937e5d. Starting checkpoint: 46b4518.
This is a live audit log; pending gates are not passing results.

## Implemented and checked in

- f7fef84: extract allocation-free string-key operations; share packed lookup,
  insertion and clearing across the native and portable record paths. Explicit
  checks remain at the checked API boundary and allocator ownership remains
  outside the leaf operations. Retain rejects foreign-runtime values; public
  root operations reject use after runtime destruction.
- 9537d4f: one execution-root enumerator includes context executions and nested
  synchronous callbacks in both collectors. This fixes the pre-existing JSON
  sequence failure: a live parse result was reclaimed by portable GC because
  only the native collector visited Runtime.activeExecutions.
- 0937e5d: share linked named-property lookup too, including equal-content
  noninterned string references and views. Existing record integration checks
  cover packed and function-owned entries with those keys.

The detailed boundary map and rationale are in
[property-unification.md](guest_vm/docs/property-unification.md).
No demos, C sources, external tests, corpus harnesses or execution limits changed.
Heavy jobs run serially, without threads, Python, downloads or emulation.

## Completed gates

- Node and actual i386 js_min project/core checks pass at the final checkpoint:
  12 guest programs / 270 guest assertions per host, plus existing internal
  compiler, record, embedding, context and execution tests.
- Runtime root integration includes rejection of foreign values and retention
  of an object/Buffer graph across creating-context teardown and collection.
- After the root correction, the unchanged portable JSON sequence passes all
  12 files / 908 assertions on both Node and js_min. Before the correction,
  the complete sequence failed one file on both the baseline and candidate.
- Structural GC passes on both hosts after the root correction: 27 audits,
  111888 checked edges, 221 property-index audits and 74 embedding collections.
  Maximum bumps remain 3531120 / 3531472 bytes under the 8 MiB cap. These
  stress runs precede the final linked-lookup-only change.
- Standalone stress after the packed cutover passes 24 rounds / 48 native
  collections. A final-image repeat is pending.
- Final Node, js_min and true self-hosted builds are byte-identical:
  7110976 bytes, SHA-256
  `c296b7964e3d88084882dbae31ce60243da6f587ffb23258f87246baf07c3538`.
  The snapshot is 2568 bytes larger than the baseline; generated interpreter
  instructions shrink from 630331 to 623304 bytes. No compression or debug
  information stripping was introduced.

Build observations (process wall seconds / peak RSS KiB):

- Node: 8.57 / 290784 (previous checkpoint observation 9.06 / 309252).
- js_min: 99.91 / 321840 (previous observation 106.25 / 322828).
- Self-hosted from the new image: 79.56 / 481696 (previous adjacent candidate
  observation 87.22 / 481592).

These are individual observations, not same-boot controlled speedup claims.
Self-host RSS is effectively flat. An isolated old-source archive is available
for an adjacent control if later measurements require attribution.

## Frozen-source broader audit — pending

- Full imported Test262: running, started around 17:27 UTC.
- Full historical ECMA and exact passing-filename comparison: queued.
- Paired stock Octane against the starting image, excluding RegExp: pending.
- Final-image structural/standalone GC, bounded interactive demos and HTTP:
  pending.

Raw output stays in ignored artifacts/property-* files. Existing ECMA
failures, configured exclusions and the separate standalone dynamic-library
integration gap are not reclassified as passes by this cleanup.
