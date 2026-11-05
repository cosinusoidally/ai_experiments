# Property and embedding ownership cutover

Work started 2026-11-05 on guestVM-cleanup3, from checkpoint 46b4518.

## Existing paths and boundaries

The native dispatcher resolves named properties through the property storage
kernel and its guarded owner/entry cache. Ordinary objects have packed,
insertion-ordered storage and an optional hash index. Other record kinds
retain linked named descriptors. Indexed and exotic properties have explicit
semantic paths; they must not be silently treated as ordinary named entries.

The embedding/portable Runtime uses guardedOwnPropertyEntries and
heapOwnPropertyEntry. Its guards cover owner identity, storage, epoch and GC
generation. HeapRecords separately probes packed indexes and scans entries;
that duplicates native lookup and converts equal-content keys to host strings.
Both paths already share resolved descriptor addressing. Sharing addressing
does not yet share lookup, mutation policy or ES5 descriptor validation.

Native string comparison already handles Latin-1, UTF-16, slices and ropes
without materializing host strings. Its implementation currently lives in the
large interpreter module, preventing the record layer from reusing it without
depending on interpreter construction. Extracting this allocation-free layer
is the first dependency cut, before sharing entry probing.

## Intended sequence

1. Measure existing property/build paths with the existing profiling tools.
   Separate inclusive host instrumentation from uninstrumented throughput.
2. Extract shared string-key operations without changing their algorithm;
   share packed lookup using the same compiler and backend pipeline. Keep
   allocation/index preparation and site caches outside allocation-free reads.
3. Share ordinary entry mutation primitives. Preserve public checked accessors,
   descriptor rules, insertion order and explicit exotic dispatch. Remove old
   implementations only after each cutover passes existing tests.
4. Audit retain/release and context teardown ownership. Runtime-owned roots
   must reject foreign values, remain live through collection, and have an
   explicit lifetime independent of a context. Do not introduce moving GC.
5. Investigate the portable JSON sequence failure as a divergence example;
   do not assume property handling is its cause.

## Acceptance

Use existing record, embedding and language integration checks; extend them
with high-level coverage where required, not implementation-shape assertions.
Run bounded structural GC stress and targeted performance/build controls at
working checkpoints. Run the full Test262/ECMA, selected stock Octane and live
demo/HTTP audit at the meaningful combined cutover, rather than per small edit.
Preserve exact passing filenames, not merely aggregate counts. Keep generated
artifacts ignored, run heavy processes serially, and record regressions rather
than masking them with harness or demo changes.

Progress and measurements will be added below as cutovers complete. This
document is a work plan, not a claim that the migration is finished.

## First cutover: shared storage operations

Implemented the dependency cut through string_key_kernel.js: key comparison,
canonical hashing and code-unit access now live outside the interpreter.
Native execution keeps the same functions, and HeapRecords can compile their
graph through the existing JS backend without constructing an interpreter.
The cached generated functions retain code only, never memory or a runtime.

Both paths now use findPropertyStorageEntryKernel for optional-index probing
and packed scanning, appendPropertyStorageEntryKernel for publishing an entry,
and clearPropertyStorageEntryKernel for deletion. The checked record API still
checks span/capacity, references and deleted entries. Native callers operate
on already validated records. Allocation, growth, index preparation/retirement
and ES5 descriptor validation deliberately remain outside these leaf kernels.
Insertion order, one-based entry IDs and structure-epoch invalidation remain
unchanged. Deletion clears all fields, including padding and value payloads.

A short inclusive host profile of the existing standalone language integration
fixture recorded 1818 record lookups (43 ms inclusive), 12197 propertyStorageKey
calls (27 ms) and 15631 entry-offset checks (16 ms). The fixture later stops at
its unsupported Node dynamic-library operation; these numbers describe only
the executed prefix. They locate duplicated record-layer work, not a native
CPU profile, complete successful workload, or a demonstrated throughput gain.

Node and i386 js_min core checks pass after the first cutover. A Node snapshot build takes
8.03 seconds / 287036 KiB peak RSS in one observation. An old-seed standalone
rebuild from the new source is byte-identical to that Node image (81.56 seconds /
483700 KiB peak RSS). Remaining snapshot cross-host, GC, full-corpus,
performance and interactive gates are pending;
the previous checkpoint's results are not substituted for those gates.

The root audit found that Runtime.retain lacked the foreign-runtime check
already used by other embedding APIs. Retain now checks ownership, and public
root operations reject use after JSRuntime destruction. Existing context
integration coverage now retains an object/Buffer graph, destroys its context,
collects, verifies the graph, and releases it. Root tokens keep their existing
runtime-local, reusable-slot contract; no new token representation is added.

## Callback-root correction

The portable JSON failure was a GC defect, not JSON syntax handling. A caught
exception reported a freed 144-byte record while assigning the parse result
to its lexical slot. Synchronous guest-library calls publish nested executions
in Runtime.activeExecutions. Native root seeding visited those executions;
the portable collector visited only context.execution, omitting their live
registers and environments. A threshold collection during the full sequence
therefore reclaimed a live JSON result. Running the selected file alone did
not reach the same collection point.

visitRuntimeExecutions now enumerates context-owned and nested executions for
both collector paths. Their marking mechanics remain backend-specific, but
root ownership has one enumerator. The unchanged twelve-file JSON integration
now passes 908 assertions under the Node-hosted portable interpreter, where
the prior implementation failed. No JSON-specific retention or parser change
was required. The same JSON sequence passes 12/908 under js_min portable
execution. Node core and bounded structural GC on both hosts also pass after
the fix (unchanged 27 audits / 111888 edges / maximum bumps).

## Linked named entries

The non-ordinary named-property scan is now findLinkedPropertyEntryKernel.
Both native lookup entry points and the record-layer numeric-key API use it.
This removes the record layer's pointer-only string match: equal-content
noninterned strings now find the same entry as interned atoms. Existing
record integration coverage exercises packed and function-owned entries with
fresh strings and slice views. Host-text low-level lookup remains an explicit
embedding convenience, not a native execution path.

The final Node and i386 js_min core suites pass, and the Node image builds in 8.57 seconds /
290784 KiB peak RSS in one observation. The combined checkpoint is frozen
for cross-host builds and broader validation. This does not yet establish
performance parity or completion of all descriptor/exotic-policy unification.
