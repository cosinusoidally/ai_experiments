# Guest property continuations and exotic adapters — 2026-11-06

Branch: guestVM-cleanup3. Baseline implementation: fe35c1b. Working cutovers:
c3ea340 (guest continuations/dynamic getters), 966fab9 (array/arguments/string
adapters), followed by the shared enumeration/view cutover. Native contract 101.
The design reference is [semantic-unification.md](guest_vm/docs/semantic-unification.md).

## Completed focused gates

- Broad object-operations integration passes on stock Node, Node-hosted
  portable guest and standalone i386 execution. The standalone aggressive-GC
  variant also passes and reports a native collection during the workload.
- Final Node core passes: 12 guest programs / 270 guest assertions plus
  compiler, heap, native interpreter, embedding and structured compiler checks.
- Final bounded Node-hosted native structural GC passes; detailed metrics
  remain in artifacts/object-exotics-final-node-gc.log.
- Seven unchanged external array-length files pass during the adapter cutover,
  covering nonwritable length, partial truncation, frozen arrays, throwing
  conversion and conversion call counts. This is focused coverage, not the
  full historical ECMA corpus result.
- Earlier working-cutover standalone GC (24 rounds / 48 native collections)
  and JSON (12 files / 908 assertions) pass. Final-image repeats remain pending.

One i386 core audit was deliberately interrupted after native interpreter
checks while correcting the shared-policy source-loading determinism hazard.
It is not counted as a complete final suite pass. The policy now loads one
checked-in source file rather than storing host-specific Function.toString
pretty-printing in the guest program. Final cross-host identity remains a gate.

## Combined acceptance — pending

- Complete final i386 core and structural GC; Node/js_min/self-hosted image
  identity, build timings and peak RSS.
- Full imported Test262: baseline 3292 passed / zero failures or skips.
- Full historical ECMA: baseline 990 passed / 339 failed (39 timeouts),
  four configured skips; compare exact passing/failing filename sets.
- Paired stock Octane against a rebuilt baseline image, excluding RegExp.
- Bounded standalone/direct-Node demo matrix, Demo8 mode switching, HTTP,
  JSON and remaining existing integrations.

No source reader, test selection, timeout or instruction limit is relaxed to
obtain passes. No C, demos, external corpora, downloads, Python, threads or
emulation. Heavy runs are serial. Raw/generated files stay under ignored
artifacts/. Pending gates must not be read as passing results.
