# CodeLoad standalone bring-up, 2026-10-30

The unchanged stock CodeLoad suite now passes under i386 `js_runner`, including
both its Closure and jQuery workloads: **score 104**, elapsed **28.60 s**, CPU
27.98 s, peak RSS **393,600 KiB**. This is a stock run, not quick correctness.
Current jitless Node scores 17,757 (170.7x the guest score); default-JIT Node
scores 17,817 (171.3x). Passing does not establish acceptable
compiler throughput. No external benchmark or demo source was changed.

The initial working point scored 96.4 in 30.07 s, CPU 29.27 s, peak RSS
393,216 KiB. It remains a historical observation, not the latest score.

## Original diagnostics were masking the cause

The previously recorded ADD exit (detail 4119) was in the wrapper's
`reportError`, concatenating a string with an Error object. It was not a
diagnosis of the original benchmark fault. `octane_runner.js --diagnostics`
now prints stored error fields before that conversion, without changing
external benchmark execution or validation. The original standalone failure
was an incorrect undefined result from indirect eval. The portable path
also exposed borrowed array methods treating array-like Objects as Arrays.

`tools/inspect_native_exit.js` is a Node/js_min development diagnostic which
stops before the selected native exit falls back to portable semantics. It
reports record types, bounded string/data-property previews and CALL operands
without guest coercion. It supports `--opcode NAME`, `--file FILENAME` and
`--pc NUMBER`, followed by normal guest_runner arguments. It terminates the
process rather than throwing through an unreconciled engine frame. It is
not part of ordinary execution, a benchmark shortcut, or a performance test.

## General implementation changes

- Indirect eval uses completion-preserving compilation, not ordinary script
  compilation. Strict indirect eval uses its own declaration environment.
  Parsing, compilation and adoption remain guest-owned.
- Computed named reads return undefined after exhausting a supported chain
  for functions and other object kinds, just as constant-key reads do.
- Computed string-key writes share the existing constant-key write machinery,
  including inherited descriptors and setters. The old weaker duplicate
  writer was removed. Dense/typed numeric indexing retains its separate path.
- A guarded String-wrapper key conversion checks the first visible toString
  method before unwrapping. Custom methods/getters decline the shortcut; no
  observable callback is silently skipped.
- Object.prototype.toString classifies guest representations directly.
  Date/Error identity is recorded in named object-class flag bits, not
  inferred from mutable public prototypes. Class labels/constants share one
  authoritative list. Arguments objects are distinguished from true Arrays.
- Generic push/slice algorithms are ordinary guest bytecode, reached from
  native dispatch for non-array receivers. Existing real-array native paths
  remain. Invalid receivers throw guest TypeErrors, allowing normal catch
  handling (jQuery intentionally probes this).
- Native-to-bytecode setup can forward an explicit receiver together with
  argument-register descriptors. The helper call is a normal resumable guest
  frame; no host callback supplies array semantics. Helper functions are
  retained by runtime-support value cells and traced by the collector.
- Explicit join and guarded default Array string conversion share one native
  join implementation. Default conversion validates valueOf, toString and
  join identities. Indexed descriptors, holes and element types requiring
  callbacks decline rather than taking an unobservable dense shortcut.
- Apply-to-native normalizes supplied Array values into a transient guest
  value vector and register-descriptor vector, then uses the ordinary intrinsic
  dispatcher. The real caller frame and result cell remain separate from
  those temporary argument registers. This also permits a native target to
  enter a generic guest-bytecode helper and return to the original callsite.
  Bytecode targets retain their existing apply path. No thread, C helper,
  source substitution or host-language service is added.

The first working point uses native executable contract 83. Its whole-suite
Test262 run exposed two object-literal definition regressions (3290 pass /
2 fail). The shared writer had revealed the compiler's conflation of literal
definition and ordinary assignment. Contract 84 adds DEFINE_DATA_PROPERTY,
with distinct own-definition semantics across the portable interpreter,
structured JS backend and native kernel. Object-literal definitions ignore
inherited setters/read-only properties; normal assignments do not. The
affected 39-test chapter passes in full. Default-separator join also uses the
guarded path rather than assuming holes/indexed descriptors are unobservable.
The complete regression history is retained in `../TEST262_STATUS.md`.
The complete contract-84 rerun passes all **3292 tests, zero failures/timeouts/
unrun**, in **490.09 s**, CPU 486.00 s, peak RSS 576,304 KiB. This restores
the two intermediate regressions at comparable time and memory to the prior
493.30 s clean result.

## Final image reproducibility and follow-up stock result

Node, js_min and genuine self-hosted builds produce identical 6,376,920-byte
images, SHA-256
`aedbdf036bdbd2fe4e0c464095c8e2438ae71058e66004073cf7aabae8a2f706`.
The first comparison found eight different bytes in two **freed string
payloads**, not in live string contents or valid lookup hashes. Serialization
now clears free-record payloads in the existing heap walk, through the named
Heap accessor. Allocator headers/links/flags, live data and retained function
source are preserved. No new startup work, hashing check or pass over source
is introduced. The final native kernel code bytes match the contract-84
image used for the complete Test262 run.

Final js_min build: 92.07 s, CPU 91.44 s, peak RSS 338,512 KiB. Final genuine
self-hosted build: 102.73 s, CPU 102.03 s, peak RSS 545,120 KiB; source loading
15.343087 s. The preceding source-loading
checkpoint measured 86.79 s for js_min and 103.67 s self-hosted. Self-hosted
total is comparable; js_min's extra approximately five seconds is recorded,
not described as a build speedup. Snapshot string-sharing/serialization is
slower in these observations. These are single-run comparisons with a larger
implementation, not confidence intervals.

The final image repeats stock CodeLoad at **104**, external **28.60 s**,
CPU 27.98 s, peak RSS **393,600 KiB**. The earlier 96.4 result above remains
historical. Relative to the current Node scores, the final normalized score
gap is **170.7x jitless**, **171.3x default JIT**. This is a correctness
milestone, not interpreter/compiler performance parity.

Final-image GC stress and expanded language integration pass. The structural
GC test passes 27 audits, 87,576 edges, 221 property-index audits and 76
embedding collections, maximum bump 4,546,840 bytes under the 8 MiB cap.
Build a new snapshot for
these changes; generated snapshots/logs remain ignored in `artifacts/`.

## Boundaries and validation

This is not a claim that every implicit conversion or apply subcase is now
native. In particular, arbitrary array-like/getter-bearing apply lists and
custom conversion callbacks still need their general continuation paths.
The guarded paths above must not be broadened by skipping observable behavior.

The existing standalone language integration includes an end-to-end dynamically
loaded library scenario using completion values, borrowed array methods,
boxed string keys, native apply, caught receiver errors and class tags. It
also checks strict indirect-eval declaration isolation. There is no new
collection of language micro-test files.

Initial working-point checks: stock and quick CodeLoad, Node-hosted project
suite (12 guest programs / 270 assertions plus CLI/context checks), native
GC stress (24 rounds / 47 collections), and expanded standalone language
integration all pass. All eleven previously passing standalone Octane suites
also pass serial quick correctness, including RegExp (73.31 s) and zlib
(33.67 s). These quick runs are not stock score measurements.
The measured stock image SHA-256 is
`fac263379fbb0a55f49ddbadc1a492f4f57597b7583a844a5fd2a92c042bf4b9`.
Final regression checks (serial, no concurrent benchmark workloads):

- All twelve working Octane suites pass final-image quick correctness:
  Richards, DeltaBlue, Crypto, RayTrace, EarleyBoyer, RegExp, Splay,
  NavierStokes, Gameboy, Box2D, zlib and CodeLoad. Final RegExp quick time
  68.80 s; zlib quick 31.00 s. No new stock scores are claimed for the other
  eleven suites. PdfJS, Mandreel and Typescript remain outside this bring-up.
- Node and js_min project/CLI/context suites pass 270 guest assertions.
  The final Node suite is repeated after serialization cleanup. js_min's
  complete project/CLI/context run takes 164.11 s, peak RSS 195,176 KiB.
- Final native GC workload: 24 rounds / 47 collections; final expanded
  standalone language integration passes. Both Node and js_min structural
  GC runs pass 27 audits, 87,576 edges, 221 property-index audits and 76
  embedding collections under the 8 MiB cap. js_min's maximum observed
  bump is 4,570,552 bytes and workload/check time is 34,572 ms.
- Live demos 1--7 run at 320x240 for about 15 seconds after window creation
  and exit through their input path. Their measured rates stay in the prior
  low-single-digit range; this is not a claim of 20 FPS for these paths.
- Demo8 runs rolling, garage and free-drive auto-pilot, then exits via its
  menu. Garage/free-drive frames are captured and inspected. After an initial
  16.9 FPS transition sample it reports 19.7--19.9 FPS at the 20 FPS limit.
  These are bounded interaction checks plus separate GC stress, not a
  long-duration stability or sustained-frame-rate certification.
- Both net.js and node_web.js serve the default index, a directory listing,
  text and a byte-identical binary file over loopback. Fixtures are ignored
  temporary files below artifacts, not new tracked assets.

Raw logs use the ignored `artifacts/codeload-*` prefix. Reproduction:

```sh
artifacts/js_runner.exe artifacts/snap octane_runner.js CodeLoad
artifacts/js_runner.exe artifacts/snap octane_runner.js --quick --diagnostics CodeLoad
node guest_vm/tools/inspect_native_exit.js --opcode ADD --vm-native octane_runner.js CodeLoad
```
