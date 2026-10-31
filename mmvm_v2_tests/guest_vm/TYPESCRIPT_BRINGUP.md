# Typescript standalone bring-up

## Contract

Run the unchanged external Octane Typescript benchmark through standalone
`artifacts/js_runner.exe`. Its original parse-error count and emitted-output
checksum remain authoritative. No external benchmark or demo is patched.
All standalone language operations and module services execute within the
guest VM, not through a JavaScript host.

## 2026-10-31: initial failures and general fixes

- The previous full sweep failed while importing the Node platform module
  `module`. The compiler's Node adapter imports it unconditionally; its
  relevant API is `_nodeModulePaths`. The standalone module interface now
  exposes ancestor `node_modules` search-path construction, including the
  rule against appending `node_modules` directly to another `node_modules`
  component. This does not add package loading or claim the entire Node
  `Module` API is implemented. `path.dirname` is also exposed using the
  standalone runner's existing directory helper.
- After that import succeeded, a quick run threw `TypeError: value is not
  callable`. Octane's error reporter then hit an unsupported string-plus-Error
  coercion; ADD was a secondary failure, not the original compiler problem.
  Portable exception tracing located the call at
  `typescript-compiler.js:22341:9`, in `isFileOfExtension`: the missing
  `String.prototype.toLocaleUpperCase` method.
- Locale upper/lower case methods now have distinct callable objects and
  share the existing ordinary case-conversion intrinsic IDs. ES5.1 permits
  the locale methods to use ordinary case conversion. This does not introduce
  Intl or a host locale dependency. The current standalone intrinsic handles
  ASCII; this change does not claim complete Unicode case support. The stock
  benchmark exercises the ASCII filename path.
- The hosted embedding exposes the same module search-path API. Its builtin
  export objects need lifetime roots because the module cache itself lives
  in the embedder. Bootstrap-only host export objects are not retained in
  the standalone snapshot: guest services replace them before serialization.
  An intermediate image with those extra host roots failed its first
  collection with an invalid ROOT_SLOT target; that image is not a validated
  result. The bootstrap/ordinary embedding lifetime distinction fixes this.
- The existing bytecode inspection tool can now report candidate functions
  for an opcode/PC pair without executing a workload. This narrows ambiguous
  standalone diagnostics; it is not an execution trace and candidates must
  still be confirmed. No benchmark-specific execution shortcut was added.
- The next standalone stop was computed GET_PROPERTY pc 42. The added
  property-pair diagnostic reported an ordinary object and an integer key.
  Ordinary numeric-property lookup unnecessarily rejected negative integers,
  although its shared canonical-decimal helpers already handle all signed
  int32 values. That restriction is removed for ordinary objects. The write
  dispatcher likewise no longer rejects an ordinary-object write after the
  helper has successfully installed its signed property name. Dense-array
  and typed-array offset rejection is unchanged. Existing integration
  coverage now includes own, inherited, absent and INT32_MIN signed keys.

## Working checkpoint

The unchanged standalone quick run passes in **66.91 s**, CPU **66.05 s**,
peak RSS **322504 KiB**. The subsequent full stock benchmark passes with
score **889**, wall **156.23 s**, CPU **154.25 s**, peak RSS **532060 KiB**.
Its parse-error count and emitted-output checksum are unchanged. This is a
successful completion, unlike the previous missing-module observation; it
also reveals substantially greater memory consumption over the full run.

The stock checkpoint image is 6547696 bytes, SHA-256
`a27b8118f72f36b6240992c23f13ce25d440e7fa131cf5d3efeb9f1d4d7c0ba6`.
The final module argument-type guard was added subsequently; a fresh image
and regression measurements are recorded separately below, not attributed
to that earlier binary.

## Validation commands

From `mmvm_v2_tests`, using an ignored temporary image:

```sh
node guest_vm/tools/build_profile_image.js --vm-native --snapshot artifacts/typescript.snap
./artifacts/js_runner.exe artifacts/typescript.snap octane_runner.js --quick Typescript
./artifacts/js_runner.exe artifacts/typescript.snap octane_runner.js Typescript
```

The expanded existing standalone integration program also exercises the
module paths and case-method installation alongside its other language,
callback, memory and module-loading checks. Results are recorded below when
the corresponding run completes.

### Final-source working-point regression checks

- Fresh image: 6548264 bytes, SHA-256
  `5ad9b4e0210f7f1b88b82d1767cec8c407596a3304e0dee4eaafb22815a67bcb`.
- Expanded standalone integration passes, including signed writes/reads,
  inherited and absent signed keys, INT32_MIN, module paths and locale-method
  installation. No external test or demo source changed.
- Project suite passes on both Node and js_min: 12 programs / 270 assertions
  per host, structured compiler checks, hello/stdout, CLI paths and the
  three-context multiplexing demonstration. Combined elapsed 189.62 s.
- Structural GC workload passes: 27 audits, 102215 edges, 221 property-index
  audits, 76 embedding collections, maximum observed bump 4573704 bytes
  under an 8388608-byte cap; workload/check time 12.442 s.
- Standalone GC workload passes: 24 rounds, 48 native collections, 0.49 s.
