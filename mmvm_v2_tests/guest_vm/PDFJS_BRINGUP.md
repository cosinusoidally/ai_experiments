# PdfJS standalone bring-up

The target is the unchanged external Octane PdfJS benchmark, executed by
`artifacts/js_runner.exe`. A run is not a pass unless its original teardown
accepts every canvas log: length 36788 and hash 939524096. No benchmark source
or demo is modified. General runtime changes, not workload recognition, must
resolve each unsupported operation.

## 2026-10-30 / 2026-10-31: decoding and guest callbacks

The initial quick run failed at `PDFDocument_getFingerprint`, CALL pc 81,
intrinsic ID zero. This was `Array.prototype.forEach`, not a missing CALL
opcode. The array runtime now supplies an ordinary strict guest algorithm;
it snapshots length, visits only present properties and forwards the
specified receiver, value, index and source to each guest callback.

The subsequent malformed PDF command `eq` was an independent correctness
bug. The native property readers returned undefined for typed-array
`byteLength`. PdfJS's decompression-buffer growth consequently copied no old
bytes. A character trace compared with Node first diverged at call 4174,
where the guest returned zero bytes instead of the decoded text. Both
computed and constant property readers now share byteLength/byteOffset
metadata access, with byte units distinguished from element counts.
After this fix the character trace agrees past that divergence and reaches
font decoding instead of reporting the malformed PDF command.

Bound functions use native-function records with a dedicated intrinsic and
a traced closure vector containing the target, bound receiver and arguments.
They forward to the normal bytecode/intrinsic dispatchers, retaining the
original caller's return slot. Constructors ignore bound this and use the
target's prototype; instanceof unwraps the bound target. There is no public
prototype property, and caller/arguments use the existing poison accessors.
The portable bind implementation remains available on hosted paths.
Native paths still decline unsupported observable conversions/accessors
rather than inventing results; this checkpoint is not a claim of complete
standalone ES5.1 compliance.

Other general gaps encountered in font loading were typed-array copying
constructors, String.prototype.trim and Math.tan. Copying typed views uses
independent backing storage (not a shared subarray), preserving raw floating
bits for equal element kinds and converting values between different kinds.
Trim executes as guest bytecode using the existing ES5 whitespace predicate,
without a regular expression or host callback. Tan uses the kernel's
binary64 sine/cosine operations with the existing trigonometric range guard.

The existing standalone language integration test also exercises callback
visitation, typed-view metadata, bound calls, bound construction and
instanceof. A forwarding bug caught by this integration test was corrected:
the constructed result and receiver belong to the actual caller's frame,
not the temporary argument register vector.

## Diagnostics

`guest_vm/tools/inspect_native_exit.js` reports the program/function,
operands and intrinsic IDs before portable fallback. It now inspects both
CALL and CONSTRUCT. Example:

```
node guest_vm/tools/inspect_native_exit.js --opcode CALL --pc 81 --vm-native octane_runner.js --quick PdfJS
```

`guest_vm/tools/trace_pdfjs.js` runs the unchanged benchmark with bounded
String.fromCharCode tracing after setup. It works directly under Node or
under the standalone image; diff the two logs to find a first decoding
disagreement. It still invokes the original checksum validation. Diagnostic
traces and generated snapshots belong in ignored artifacts, not in git.

Object.keys also reuses the native enumeration routine in own-only mode.
PdfJS now reaches a dynamically resolved `PdfJS_window` read (GET_NAME pc 0)
in a callback. The next step is guest-owned lexical binding metadata and
native dynamic resolution, not a special case for that global name.

Checkpoint validation: project Node suite 12 programs / 270 assertions;
standalone language integration passed; standalone bounded GC workload
passed 24 rounds / 47 collections; CodeLoad quick correctness passed.
These are checkpoint checks, not a replacement for the final full Test262,
cross-host/self-hosted snapshot and demo regression runs.

## 2026-10-31: stock correctness pass

The unchanged stock suite now passes under js_runner: score **800**, wall
**18.75 s**, CPU **18.45 s**, peak RSS **261140 KiB**. The quick run passed
in 15.21 s including source loading and compilation. These are distinct
stock/quick observations, not a full new Octane sweep.
The final portable-adapter checkpoint rerun scores **813**, wall **18.60 s**,
CPU **18.31 s**, peak RSS **305632 KiB**; CodeLoad quick correctness also
passes. The preceding observation is retained rather than silently replaced.

The remaining general changes were:

- Environment-backed programs now own an optional slot-to-binding-name value
  vector. A previously unused program payload word stores its reference, so
  program records stay the same size. Register-only programs need no vector.
  Bootstrap registration and self-hosted adoption populate it; both collectors
  trace it, and the portable adapter reconstructs names from it. Native
  GET_NAME walks declarative/catch environments before global lookup. It
  declines object environments that require unsupported observable handling
  rather than silently skipping them. This is not a claim that with/direct
  eval support is now complete in the native interpreter.
- hasOwnProperty handles primitive-wrapper ownership, including strings'
  length/character indices, without allocating a temporary wrapper. Primitive
  payloads are no longer treated as heap references before tag validation.
- Join lazily converts doubles/booleans into a temporary guest vector using
  the existing number formatter and canonical boolean strings. It preserves
  the source array and retains the no-temporary integer/string-only path.
- Native-created bound functions can be adopted by portable/embedding code
  without retaining their target/receiver/arguments in host-only closures or
  pinning every dynamic function as a permanent bootstrap root.

An intermediate stock run crashed in bind's length lookup: the packed-object
cache was incorrectly used with a function's linked descriptors. A new
representation-aware own-property lookup selects packed caching only for
ordinary objects and linked traversal for other owners. The stock rerun above
validates that fix; the earlier quick pass alone was insufficient.

The strengthened bounded GC workload retains both bound-function state and
dynamically resolved closures. Checkpoint results: 24 rounds / 48 native
collections; structural driver 27 audits / 102049 edges / 221 property-index
audits / 76 embedding collections, maximum bump 4570856 bytes within an
8 MiB cap, 11.542 s. Node project suite still passes 12 programs / 270
assertions and standalone language integration passes.

Full Test262 rerun at `ead65d4`, contract 86: **3292 passed / 0 failed /
0 not run / 0 timed out**, 494.46 s external wall, 489.63 s user CPU,
576524 KiB peak RSS. Runner time 493.888339 s, summed per-test time
477.015331 s. The preceding clean checkpoint took 490.09 s; no substantive
timing improvement is claimed. See TEST262_STATUS.md for the permanent
whole-suite ledger. Wider Octane/demo and build validation follow.

### Hosted i386 collector ownership correction

Cross-host GC validation exposed a legacy root-scanning assumption: the
hosted i386 marker treated every NATIVE_FUNCTION record as an embedding root.
That is wrong now that guest bound functions use that record kind. Their
targets retained discarded graphs; audits grew with every round and the
js_min check was interrupted after exceeding seven minutes. That run is not
reported as a pass. Merely removing repeated eval from the new lifetime
fixture did not resolve the retention; tracing identified the root rule.

Host-created callbacks now join an explicit heap-linked callback-root list
at creation. The runtime seeds that head for hosted collection, and the
native engine owns the same head for standalone collection. Dynamically
created bound functions do not join it. The old type-wide structural-root
rule is removed, without a bound-function-ID exception in the collector.
Portable marking follows the same callback list. The native constructor
also no longer rebuilds roots by scanning a mixed metadata cache.

The corrected js_min audit completed 27 audits / 101999 edges / 221 index
checks / 76 embedding collections in 38.538 s of workload/check time, after
18.859 s runtime construction, maximum bump 4602832 bytes under the same
8 MiB cap. Live edges plateau instead of growing each round. The driver
now reports construction separately, accepts optional `--trace-host-calls`
for diagnostic transitions/audit progress and asserts discarded guest bound
functions are collected after execution. The lifetime fixture retains
dynamic lookup without repeatedly benchmarking eval compilation.

Contract 87 checkpoint: Node structural audit including the final ownership
assertion passes (27 audits / 101999 edges / 76 collections, 12.131 s,
maximum bump 4573544 bytes), native workload passes 24 rounds / 48
collections, standalone integration passes, and stock PdfJS scores 738 in
20.97 s, CPU 20.65 s, peak RSS 254760 KiB. This lower score is retained;
the earlier 813 is not presented as the latest observation. Broader final
checks below use the collector-corrected image.

### Cross-host snapshot builds

The contract-87 Node, js_min and genuine self-hosted builds are bit-identical,
6538776 bytes, SHA-256
`8816444bc3c279687fd583efd372ef2d5dd92c7c88dd7d558816a5a39005cab8`.
The self-hosted log includes source loading, parsing/fingerprinting, lowering
and assembly; this is a rebuild, not copying an existing image.

- Node cross-build: 3.728 s reported by the builder.
- js_min: 99.05 s external wall, 97.49 s user CPU, 331876 KiB peak RSS.
- Self-hosted: 110.05 s external wall, 108.33 s user CPU, 545448 KiB peak RSS.
- A matched control extracted from pre-work commit `6b5703f` into ignored
  artifacts rebuilt the old 6376920-byte snapshot with its exact recorded
  hash (`aedbdf036bdbd2fe4e0c464095c8e2438ae71058e66004073cf7aabae8a2f706`).
  It took 94.72 s, CPU 93.81 s, 338792 KiB peak RSS. Thus the new js_min
  build observation is about 4.6% longer; no build-speed improvement is claimed.
  These are single serial observations, not confidence intervals. The image
  also now includes the lexical metadata and general operations described above.

### Collector-corrected conformance rerun

The complete contract-87 Test262 run passes **3292 / 3292**, zero failures,
zero not run, zero timeouts. External wall 497.68 s, CPU 494.82 s, peak
RSS 576552 KiB; runner 497.095636 s, summed per-test time 480.131866 s.
The complete earlier contract-86 pass is retained above. No corpus, demo or
C source was modified to obtain these results.

### Final stock sweep and live regression checks (2026-10-31)

The final unchanged stock PdfJS run scores **776**, wall **19.45 s**, peak
RSS **254752 KiB**, versus Node v24.14.1 `--jitless` score **5042**. Its
original canvas-log length and hash checks pass. The full fifteen-suite
Octane comparison completes with thirteen guest passes and two known
failures (Mandreel allocation pressure; Typescript's missing `module`
platform module); the jitless reference passes all fifteen. The complete
scores, negative observations, resources and reproduction command are in
[the October 31 comparison](../OCTANE_COMPARISON_2026-10-31.md).

Final live standalone checks also passed demos 1–7 (at least fifteen
seconds of active rendering each), demo8 rolling/garage/free-drive auto
pilot, and byte-checked text/binary/index/listing requests through both
HTTP servers. Demo8 garage reached 20.0 FPS and auto-drive logged
19.4–20.0 FPS at 320x240; the earlier demos remained low-single-digit FPS.
All windows closed cleanly through their normal controls. These are bounded
regression checks, not a claim of long-duration stability or universal
20 FPS performance. No changes to demos were needed.
