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

Stock correctness and wider regression validation are still in progress. The
historical failing scores in the Octane ledger are deliberately unchanged
until a stock pass has actually been measured.
