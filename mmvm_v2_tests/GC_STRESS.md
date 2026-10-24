# Short, bounded guest-GC stress checks

Run from `mmvm_v2_tests`. This replaces long demo runs as the primary GC
regression probe; short interactive demo checks still cover rendering/input.
The test is ES3-compatible JavaScript and needs no npm, Python or new C code.

## Instrumented embedding test

```sh
export LD_LIBRARY_PATH=../../firefox-1.0.8/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
../../mmvm_v2/artifacts/js_min.exe guest_vm/tests/gc_stress.js
node guest_vm/tests/gc_stress.js
```

The same driver runs the real native kernel under js_min and the shared
kernel's JS backend under Node. Its guest heap starts at 512 KiB and cannot
grow beyond **8 MiB**. That is not a total-process RSS limit: constructing
the interpreter also uses the host's compilation heap. Initial measurements
were about 161 MiB peak RSS under js_min and about 190 MiB under Node. Run one
stress process at a time; do not multiply those processes on a small machine.
An external `timeout -k 2s 60s` may be used to bound a diagnostic invocation.

The fixed workload has 24 rounds, eight retained graph slots, and 12 discarded
graphs per round. It covers cycles, shared children, closures, binary64 values,
48-name dictionaries with deletion/reinsertion across collection checkpoints,
wide/lone-surrogate strings, rope/substring backing, byte canaries and Buffer
views whose original Buffer object has gone away. Replacing slots and dropping
the final slot array exercises reclamation/reuse rather than monotonic retention.

At each checkpoint the driver:

- Checks mandatory engine-state links **before** attempting collection.
- Forces a collection with the existing native-frame/mark-graph verifier on.
- Independently walks record boundaries and validates record types and sizes.
- Checks value-vector lengths/capacities against their physical record bounds.
- Checks optional property-index capacity, occupancy and live property targets,
  and packed property-storage bounds and live-entry counts.
- Checks every visited reference targets a real, non-free record boundary,
  not merely an aligned address which could be inside another record.
- Checks the free-list index for missing/duplicate/invalid entries.
- Rechecks all retained graph data after collection, including every Buffer
  byte and independently reconstructed substring characters.

The output reports audit/edge counts, embedding-side collections, observed
post-collection heap bump and the configured cap. The embedding driver invokes
collections across resumable execution boundaries; the native per-entry
counter may therefore be zero even when embedding collection counts increase.

## Standalone automatic-collection test

After producing a **fresh** snapshot from the current source:

```sh
./artifacts/js_runner.exe artifacts/snap guest_vm/tests/gc_stress_workload.js
```

This runs the same graph/data checks without an embedding checkpoint hook.
It enables collection every 50,000 opcode boundaries and requires at least
three native collections. It does not contain the embedding-side independent
record walk; use both paths. Its live dataset is bounded by the same fixed
slot/round counts, but the runtime's normal snapshot heap reservation still
applies, not the embedding driver's 8 MiB cap.

With the scratch-layout correction, the standalone test completed in 0.38 s,
used about 20 MiB peak RSS, and reported 35 native collections. The instrumented
js_min test completed in 33.80 s including compilation, reporting 48 embedding
collections, 27 audits, 70,509 checked edges and an observed bump of 148,872
bytes. These are initial measurements, not hard time thresholds.

With dictionary/index coverage added, the instrumented js_min run reports
50 collections, 27 audits, 84,041 checked edges and 142 property-index audits,
with a maximum observed heap bump of 175,480 bytes (35.72 seconds including
compilation). The packed-storage lifecycle regression separately exercises
its collector edges on both hosts before ordinary objects migrate to it.

## Corruption found during bring-up

The test caught an overwritten platform-services link before a later native
call could segfault. Array search cleared a complete 16-byte temporary value
in an engine scratch slot reserved as one word. A binary64 temporary in the
neighboring slot also overlapped following state fields. The resulting pointer
was zero or part of a floating-point encoding; later register initialization
could try calling address 1.

The authoritative layout now reserves a full value cell for each scratch
area. Clock timeval word access is separate from the right scratch slot, and
boolean/null arithmetic conversions initialize tagged cells rather than just
their first word. All derived offsets and collector accessors follow that
layout. Native compiler contract **50** rejects incompatible old code caches.
Regenerate snapshots with js_min after this change; an old snapshot still
contains its old interpreter, including its old corruption bug.
