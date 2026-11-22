# Standard-semantics cleanup toward the Node-passing ECMA set

## Target and exclusions

The target is each specific historical ECMA corpus file which passes the
direct Node control but fails the guest VM, not equality of aggregate counts.
All corpus files remain unchanged. Existing raw full-suite statuses, including
extension failures, remain visible; extension-only failures do not drive VM
implementation. Do not add SpiderMonkey syntax, APIs, class tags or exact
error messages merely to satisfy this corpus. Preserve ES5.1 semantics where
modern Node has edition differences. Keep the four existing configured skips
and runner policies unchanged.

## Current architecture and sequence

Ordinary descriptor acceptance already uses `ordinaryDescriptorDecisionKernel`
in both implementations. Preserve that shared policy. The remaining work is
around descriptor normalization, storage lookup, mutation and array exotics:

1. Refresh the direct Node filename pass set. Compare it with the retained
   guest matrix and reproduce selected standard-relevant gaps on a fresh
   standalone control image.
2. Remove native DefineProperty's backward entry scan. Resolve entries through
   the existing shared guarded lookup, as Get/Put and descriptor reads do.
   Measure the descriptor workloads rather than assuming their timeouts are
   correctness bugs or that this change will eliminate them.
3. Unify array-length mutation and descriptor application without a second
   accept/reject policy. Array index and length behavior must agree across
   dense and sparse descriptors. Large sparse indices must not force dense
   allocation, and truncation must respect non-configurable blockers without
   scanning every absent integer. This representation cutover requires an
   audit of all element accesses and cannot be claimed from a local patch.
4. Address additional Node-only standard failures in shared operations,
   preserving callback order, rooted values, exception identity and strictness.

No new language micro-test files are required: use the external corpus and
existing high-level integration/GC coverage. Keep guest language support in
guest/kernel code; no host fallback or benchmark-specific branch. Keep heavy
tests serial. Freeze implementation at meaningful checkpoints, run the broad
regression gates, record exact filename deltas and performance, and commit
working changes rather than accumulating a large migration.

## Initial observations, 2026-11-22

The contract-117 control reproduces all four selected failures:

- Sparse array truncation with non-configurable indices attempts an
  805306392-byte allocation, rather than storing those indices sparsely.
- Sparse indexed truncation rejects dense backing growth at index 987654321.
- Splice/enumeration visits an index deleted before it is visited. The test
  cites standard ES5 enumeration suppression; its directory is not sufficient
  evidence that this is a proprietary requirement.
- The selected middle-redefinition descriptor test reaches the unchanged
  ten-second worker watchdog.

## Direct Node pass-set control

Fresh Node v24.14.1, `TZ=UTC`, unchanged default skips and no Node timeout:
**1218 passed / 111 failed / four configured skips / zero timeouts or unrun**;
1333 selected, 1329 executed, process **132.43 s / 162664 KiB peak RSS**.
Comparison against the retained contract-117-equivalent guest matrix gives
**967 common passes / 251 Node-only passes / 30 guest-only passes**.
Of the 251 gaps, **81 are in Date directories and 170 are outside them**.
The non-Date target is **874/1044 specific Node passes matched** before this
checkpoint. Guest-only passes do not cancel missing Node passes.

An initial ambient Europe/London control reports 1172 passes / 157 failures,
not the historical UTC baseline. Keep that result separate; timezone-dependent
corpus expectations must not become VM implementation changes. Receipts:
`artifacts/ecma-node-parity-control.*` and `artifacts/ecma-node-parity-utc.*`.

## Enumeration cutover, contract 118

The shared entry lookup removes DefineProperty's competing backward scan.
The selected descriptor workload still times out, so this is not claimed as
its performance fix.

The compiler's for-in lowering now:

- Captures the source identity in a private register, rather than following
  subsequent reassignments to its original binding.
- Evaluates an allowed var initializer once before the source expression.
- Takes a candidate-name snapshot; its private, immutable length is read
  once outside the loop. The compiler-owned index uses int32 arithmetic,
  bounded by the guest vector size limit.
- Emits `HAS_ENUMERATION_KEY(result, key, source)` before visiting each key.
  A deleted candidate branches to the normal increment/continue target,
  without assigning the loop target or executing the body.
- Evaluates member-expression assignment targets once per actual visit.

The new instruction has explicit width, destination/source register metadata,
verifier rules and canonical operands. Both compiled kernel backends use the
same allocation-free `hasEnumerationKeyKernel`: it checks property presence,
not property values, and cannot invoke an accessor. Primitive sources use
their ToObject-equivalent virtual properties/prototypes without allocating
wrappers. The portable interpreter uses its corresponding Runtime operations.
The optional legacy structured-source compiler declines the new opcode;
the shared compiled JS interpreter supports it normally.

GET_KEYS for number/boolean sources now includes inherited enumerable names,
as ES5.1 requires. Null/undefined still produce an empty enumeration. Numeric
keys already held as strings use shared indexed lookup after virtual-element
checks; only raw numeric operands need decimal comparison without allocation.

The existing integration fixture covers deletion, reassignment of the source
binding, member targets, initializer order and primitive prototype properties.
No new language micro-test files or external corpus edits are introduced.
Two selected Node-passing external files pass in the standalone candidate:
`ecma/Statements/12.6.3-1.js` and
`ecma_5/Array/splice-suppresses-unvisited-indexes.js`.
## Combined acceptance, `a80c661` (2026-11-22)

- Full guest ECMA (`TZ=UTC`): **1000 passed / 329 failed (39 timeouts
  included) / four skips / zero unrun**, 1333 selected / 1329 executed.
  **Three gains / zero lost passes / zero missing or extra files** against
  the retained contract-117-equivalent filename matrix. Gains are
  `ecma/Statements/12.6.3-1.js`, `ecma_2/Statements/forin-001.js`, and
  `ecma_5/Array/splice-suppresses-unvisited-indexes.js`; all three pass Node.
  Process **608.84 s / 463944 KiB**, versus preceding 609.64 s / 463792 KiB.
- Specific Node parity: **970/1218 common passes / 248 Node-only passes /
  30 guest-only passes**. Date-directory gap remains 81; non-Date gap falls
  from **170 to 167**, with **877/1044** non-Date Node passes matched.
  Proprietary or edition-specific Node failures do not become implementation
  targets; directory names alone do not classify a requirement as proprietary.
- Full Test262: **3292/3292 passed**, zero failures, timeouts or unrun;
  **330.24 s / 512456 KiB**, preceding observation 341.87 s / 512372 KiB.
- Node and i386 js_min core suites pass: 15 programs / 321 intrinsic assertions,
  plus integration fixture checks on portable/kernel/predecoded configurations.
- All seven standalone program gates and eleven demo/server application gates
  pass with the source snapshot moved aside. GC: 24 rounds / 30 structural
  audits / 141980 edges / 254 property-index audits / 84 embedding collections /
  one runtime bound function, 8 MiB heap cap, maximum bump 432824 bytes.
- Node, js_min and genuine self-build snapshots are byte-identical, SHA-256
  `ca44a61cf7340053b5019eb26d5ea2b8cc6120390b71367375f7ce91088b1fcb`.
  Snapshot 7673496 bytes; native code 687018 bytes. Self-build **80.75 s /
  483220 KiB**, preceding observation 82.97 s / 481636 KiB. The initial
  pre-hoist candidate took 88.16 s; redundant loop-length lookup was not kept.
- js_min build **97.79 s / 314272 KiB**, preceding observation 92.06 s /
  315256 KiB. This observation is slower; do not claim universal build-time
  parity or dismiss it as measured noise. A serial repeat is **101.22 s /
  314548 KiB**, producing the identical snapshot hash. The slower hosted
  build observation remains an open performance concern; the repeat does
  not establish whether all of the difference is attributable to this change.
- Paired stock Octane checks, fresh serial processes: Box2D **380 -> 411**,
  CodeLoad **90.2 -> 92.6**, correctness enabled and exit zero. These selected
  pairs are not a new all-suite score claim; no full stock Octane sweep or
  fresh Windows/debugger audit is claimed for this checkpoint.

Receipts use `artifacts/ecma-parity-*`. The broad acceptance run followed
the final loop-length hoist; earlier targeted results do not substitute for
these final gates. Raw logs are ignored build artifacts, not corpus changes.
