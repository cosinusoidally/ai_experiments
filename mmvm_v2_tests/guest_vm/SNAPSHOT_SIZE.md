# Snapshot size and compact strings

## 2026-10-23: one-byte flat strings

This is a representation change, not compression or debug stripping. All 90
JavaScript files under guest_vm and node_compat were ASCII at the start of
this work. Source literals such as `"\u20ac"` can nevertheless produce wide
runtime values, so the VM must continue to preserve every UTF-16 code unit.
No source text, comments, whitespace, bytecode or inspection metadata is removed.

The preceding image occupied 16,995,576 bytes. Its initialized heap was
16,626,936 bytes, including 9,486,680 bytes of strings. Program-source strings
accounted for 9,145,256 bytes of that string storage. Native code occupied
only 362,365 bytes. The large image was not a dump of unused heap capacity.

The compact-string image with bulk ingress occupies 12,399,160 bytes, a saving
of 4,596,416 bytes (about 27%). String records occupy 4,864,656 bytes:

- 7,261 one-byte flat records: 4,843,664 bytes.
- One UTF-16 flat record: 32 bytes.
- 524 rope records: 20,960 bytes.

These counts describe the tested bootstrap image, not a restriction on future
runtime values. Runtime builders may still produce UTF-16 flat strings whose
contents happen to be Latin-1. Both representations are valid and inspectable.

## Record and accessor contract

Strings retain the existing STRING record type, logical length, hash and
character-payload offset. Record size describes the actual allocated bytes.
The flags distinguish rope records, one-byte flat strings, and ordinary
two-byte UTF-16LE flat strings. The authoritative flag values are exported
through HeapRecords.KernelConstants; they are not duplicated by callers.

- `stringLength` counts UTF-16 code units in every representation.
- `stringCharacterCodeUnit` resolves rope leaves, then reads the appropriate
  flat width. It returns the same code unit regardless of storage width.
- `stringIsLatin1` and `stringIsRope` expose the representation to inspectors.
- `readString` reconstructs the exact text, including NULs and lone surrogates.
- The collector treats both flat kinds as leaves; only rope flags introduce
  child references. No new reference layout or moving collection is required.

HeapRecords.allocateString selects width during its existing hash scan. Text
with any code unit above 255 stays UTF-16; it is not transcoded through lossy
UTF-8. Flat headers are initialized before publication. Kernel-created UTF-16
strings keep their old layout, and mixed-width rope leaves remain supported.

The heap/memory layers provide checked Latin-1 string ingress alongside UTF-16
ingress. Native memory packs four bytes into each little-endian poke32; Node's
paged adapter uses identical packing. A byte tail never overwrites adjacent
fields or padding. Wide input is rejected rather than truncated by the Latin-1
writer. The allocator has already established that its selected input fits.

The shared kernel IR has an ordinary heap-byte load operation, emitted as a
byte read by the JS backend and a zero-extending load by the i386 macro
assembler. The native reader uses the same flag contract as the reference
accessors. Compiler contract version 47 prevents stale cached native engines
from being silently combined with the new heap representation.

## Inspection

The existing inspector understands both old UTF-16 images and the new flags.
It can read the image directly without extracting a raw heap dump:

```sh
node guest_vm/tools/audit_snapshot_heap.js --snapshot-stats artifacts/snap
node guest_vm/tools/audit_snapshot_heap.js --sources artifacts/snap
node guest_vm/tools/audit_snapshot_heap.js --string ADDRESS artifacts/snap
```

ADDRESS is a decimal or hexadecimal heap string-record address from the source
listing. The final command prints its encoding, logical length and complete
text. No source files outside the snapshot are needed to decode retained text.
The same tool runs under js_min.exe with LD_LIBRARY_PATH configured as usual;
Node is an optional inspection host, not a VM or snapshot dependency.

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js \
  --snapshot-stats artifacts/snap
```

## Validation checkpoint

The seed and genuine self-hosted rebuild are byte-identical, both SHA-256
`f0a00c23fbcbef665d4d42517ef8e5da0fdb11a4fd0c2f6a8976d5b40f514e3b`.
Both are non-sparse files. The rebuilt image runs hello.js. The existing
Node/js_min suite passes (12 programs / 270 assertions per host), including
canonical/predecoded native execution, heap/GC, embedding and compiler checks.
The existing string round-trip samples include Latin-1 boundaries, NULs,
wide code units and lone surrogates.

The inspector's compiled-marker check reports 62,593 reachable records and
zero missing marks. Node and js_min produce identical complete text for the
inspected source record. Old UTF-16 images still decode through the same tool.
No source stripping, compression or C changes are involved.

The first byte-at-a-time ingress experiment built in about 107 seconds and
was replaced by the bulk writer. The bulk image's reported cold stages were
18.089 seconds for runtime construction, 1.559 for environment installation,
70.286 for standalone preparation and 0.955 for writing (about 90.9 seconds).
The genuine self-hosted stages were 57.016 + 1.505 + 90.290 + 1.597 seconds
(about 150.4 seconds), versus the previous checkpoint's 162.6-second stages.
These are reported build-stage totals, not isolated repeated performance
benchmarks. Raw artifacts use the ignored `artifacts/latin1-` prefix.

The compact image verified two 60-round zlib diagnostic batches at
27.796/27.399 seconds. The pre-change image, run serially afterwards, verified
at 26.888/27.033 seconds. The compact image's two-batch mean is about 2.4%
longer; this is a measured small execution cost, not a claimed speedup. Every
batch compared all 100,000 decompressed and 25,906 compressed bytes against
the independent Node reference. These are diagnostic timings, not Octane
scores or statistically isolated repeated trials. Logs: ignored
`artifacts/latin1-zlib.log` and `artifacts/latin1-zlib-control.log`.

## Remaining opportunities

This phase does not remove overlapping source copies. The prior audit found
1,805 program-source strings that are exact substrings of 170 larger retained
sources. Shared source backing with explicit ranges is the next structural
opportunity, but it must preserve exact Function.toString results, source
inspection, GC edges, deterministic snapshots and parsing performance. Equal
string interning alone saved little: exact duplicate records were only about
11 KB in that image.
