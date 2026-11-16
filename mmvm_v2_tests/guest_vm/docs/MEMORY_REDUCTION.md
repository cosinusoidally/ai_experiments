# Runtime memory reduction

## Objective and constraints

Run mishmashvm with the ordinary guest executable, without a special image
containing a larger maximum heap. Reduce peak resident memory through general
allocation and lifetime improvements. Preserve non-moving GC, FFI pointer
stability, source/debug information, deterministic snapshots and both platform
backends. Do not use threads or page-discard advice.

## Measurements, 2026-11-15

A fresh default-512-MiB snapshot, built from the current source before this
change, fails in mishmashvm's `01_mk_tcc.js` at `tcc_em.js:1167`, creating the
128-MiB ArrayBuffer. GNU time reports 40.97 seconds and 454,508 KiB peak RSS.
The failure reports ten collections, 27,602,392 live bytes, heap tail
464,531,488, and maximum 536,870,912 bytes. The generated final bootstrap object
was unchanged by this failed run. This is evidence of a contiguous-allocation
problem, not a 512-MiB live working set.

The same default-cap image with the runtime override to 1024 MiB completes
stage 01 in 99.97 seconds, peaking at 635,196 KiB RSS. Its initial compiler
object SHA-256 is
`080182b567eabf208f60fcba6182d9c7a11c5f2421398dec530bc9dded852004`,
matching the reference stage-01 object. The pre-test final native-bootstrap
object was preserved and restored after this check. No mishmashvm source was
modified. This established the override's usefulness, not a memory saving;
the descriptor cutover below subsequently fixes the default-cap failure.

Historical whole-bootstrap measurements, before the recent compact source-map
change: SpiderMonkey 79,616 KiB RSS, guest 558,340 KiB. These are not fresh
whole-bootstrap measurements of this change.

## Runtime maximum

Generic standalone images accept:

```sh
guest.exe --vm-max-heap-mib 1024 program.js
js_runner.exe runtime.snap --vm-max-heap-mib 1024 program.js
```

The option must precede the positional program (or `--`). Values are decimal
integers from 64 through 1024 MiB. `-e` and `-f` operands are skipped while
scanning options, and program arguments are never interpreted as VM options.
The selected maximum must accommodate the initialized heap image. Invalid
values fail before allocation, with an explanation and status 64.

The image retains its built-in default when the option is absent. Native
startup scans argv before mapping the heap. The kernel-compiled startup
functions select the maximum and configure the copied engine's allocator and
GC workspace bounds. The bootstrap assembly performs only ABI calls and
mapping/copying; no C loader change is needed. The shell parser consumes the
option so it does not appear in source actions or script arguments.

Collector workspace reserves one quarter of the selected main-heap maximum:
512 MiB plus 128 MiB by default, or 1024 MiB plus 256 MiB at the current upper
bound. Reservation is not resident memory. The option is not a process-RSS
limit: native code, libraries, external buffer payloads and other allocations
also consume memory. Startup changes only the anonymous runtime heap, never
the snapshot file or embedded executable image. The outer runtime selection
does not change the builder's explicit/default target options.

## Implemented: external buffer descriptors (contract 109)

Large native backings now use a 32-byte GC-managed descriptor instead of a
payload-sized linear-heap reservation. The stable calloc payload remains owned
by that backing and shared by all views. Native engine fields track external
bytes, collection headroom and a pending request. Crossing the threshold yields
to the existing collector before allocation; post-sweep indexing recounts live
payloads and grants enough headroom for the request. External bytes are bounded
by the selected maximum independently of the linear heap. This is not a hard
bound on combined process RSS.

Canonical serialization copies payloads into an aligned area before the heap
template and stores image-relative offsets in external descriptors. Kernel JS
startup reconstructs them after binding libc services. Context snapshots append
payloads after record regions and restore directly to the same native pointer.
Neither form relocates live backings or writes payloads into a shadow span.
The normal loader, application sources and libc interfaces are unchanged.

The live-buffer snapshot test also exposed an omitted GC ownership edge:
embedding collection could reclaim persistent-root chain nodes still owned by
the native engine. Both reference and kernel graph visitors now trace engine
global/context/callback/persistent-root heads. The fixture reloads and survives
49 forced collections with its bytes and slice aliasing intact; a heap graph
audit also passes. No collection was disabled to avoid the failure.

Initial default-cap stage-01 result: **91.91 s / 476,680 KiB peak RSS**, down
from the same-image runtime-override baseline of **99.97 s / 635,196 KiB**.
That is approximately 25% less peak RSS, with the reference compiler-object
hash preserved. Unlike the baseline, this succeeds at the ordinary 512-MiB
maximum without a runtime override. Full-bootstrap acceptance is separate.

## Remaining investigation

### Goal acceptance, 2026-11-16

The full unmodified mishmashvm `bootstrap.sh` completes with the ordinary
default-512-MiB snapshot executable: no larger build setting and no runtime
heap override. The eight existing output objects were moved to a recoverable
artifact directory first; all eight newly generated outputs compare byte for
byte with those preserved references. The bootstrap's four own hash checks
also report OK. Source trees and external test corpora are unchanged.

- Whole bootstrap: **236.36 seconds / 476,612 KiB peak RSS**.
- Historical whole-bootstrap guest result: 233.45 seconds / 558,340 KiB.
  Peak RSS is approximately 14.6% lower; the elapsed times are similar, but
  this is not a controlled repeated timing comparison.
- The stronger matched-stage comparison above reduces peak RSS by about 25%.
- Reference SHA-256 values (each `.new` counterpart is identical):
  - `my_libc.o`: `0e8e02c852a11ebec585650d3c6fa5917fb51d7b66dd1d458d3e51680c660964`
  - `stubs.o`: `0cdb519efb42f22eba96bf90407e10b87868355e1d793d3a70271f09d47aa403`
  - `tcc_bin/libtcc1.o`: `59483d03266a9eadb84ceafaf4ed8a37e5a5231aaf773f296a7ca097679307b3`
  - `tcc_bin/tcc_boot3.o`: `b64ff3010f2de6eb50762169fc5309b66ef704924cfc21648e7b75f088af3365`

Additional focused acceptance: the Node core suite passes after the engine-root
ownership fix; js_min core passes with compact backings; a js_min-built image
containing a live external backing reloads, passes 49 forced collections and
preserves slice aliasing. Its graph audit reports 40,219 reachable records and
zero missing marks. Full ECMA/Test262/Octane, all graphical demos, fresh normal
cross-host/self-hosted fixed-point builds and Windows acceptance have **not**
been rerun for contract 109. The contract-108 checkpoint below must not be
mistaken for those missing fresh checks. Work paused at the user's request
after the stated bootstrap-memory goal was achieved.

### Remaining substantial space use (not implemented)

The read-only profiler now ignores mutable GC marks when locating the heap
and recognizes a heap occupying the suffix of a merged anonymous mapping.
The first attempted profile collected no heap samples because the old locator
assumed a stable full header at the mapping start; its timing was not used.
The corrected run collected 26 samples and completed with the correct initial
compiler-object hash; the final native-bootstrap object was restored afterward.

The remaining peak is principally frontend temporary storage, not another
128-MiB backing shadow. Around 31 seconds, the sample has 169,236,248 bytes of
VALUE_VECTOR records, 59,752,616 bytes of property storage and 84,411,360 bytes
of FREE records; the executing function is `propagateRegisterState` in the
bytecode optimizer. Spare vector capacity is only 8,577,744 bytes, so simply
reducing growth slack would miss most of that vector footprint. Around 38
seconds, after compilation and collection, occupied records fall to 29,470,680
bytes while free spans total about 440.5 MB; the 128-MiB external buffer is
separate and its tracked byte count agrees with the record walk. Resident
pages previously touched by frontend work remain mapped. Profile timings are
perturbed by stopped-process inspection, not stock performance measurements.

Future work should examine the optimizer's dataflow-state representation and
lifetime before changing general GC policy or adding allocator tricks. No such
optimization was started after the user requested a pause.

Profile frontend working storage and phase lifetimes. Prioritize retained
temporary data and oversized integer metadata/capacity, preserving function
source, locations and build speed. Use the existing read-only process memory
profiler to distinguish resident free pages, live records, external payloads,
workspace and spare capacity. Its stopped-process samples perturb timing, so
use separate ordinary timed runs for performance comparisons.

## Acceptance

Test serially: core checks on Node/js_min, native startup/packaging and malformed
options, Windows startup, buffer/view GC ownership and snapshot restoration,
self-hosted and cross-host snapshot identity, then mishmashvm's unmodified
bootstrap with the default cap. Compare all eight bootstrap object hashes and
stop on any mismatch. Run existing GC, demos, Test262 and Octane regression
checks at stable checkpoints; record missing coverage explicitly.

### Runtime-limit checkpoint, 2026-11-15

- Node and js_min core suite: 12 guest programs, 310 assertions per host,
  including native/predecoded execution, buffer lifetime/context snapshots,
  CommonJS demos 1/2 and net/node_web command-line paths.
- Shared kernel/backend checks pass on Node and native i386, including exact
  NUL-terminated native literal comparison and rejection of prefix matches.
- Executable acceptance: 51 checks; Node, js_min, js_runner and executable
  packagers produce identical ELF output. Checks cover 64/1024-MiB startup,
  malformed/missing values, inline operands, argument forwarding, unchanged
  input/output bytes and the normal js_runner path.
- Wine: one identical embedded snapshot runs hello at 64 and 1024 MiB.
- Bounded embedding GC stress: 27 structural audits, 113,184 reference edges,
  221 property-index audits and 74 embedding collections; maximum observed
  bump 3,532,584 bytes under an 8-MiB cap.
- Final standalone GC workload at a 64-MiB runtime maximum: 24 rounds,
  48 native-counter collections, surviving data checks pass. This exercises
  collection with the runtime-selected workspace rather than just parsing
  the option or launching hello.
- Final Node/js_min snapshot bytes match. js_min construction takes 102.72 s,
  peak RSS 378,152 KiB. The preceding recorded run was 101.76 s/333,396 KiB:
  elapsed time is similar, but this unpaired run has a higher RSS high-water
  mark and must not be represented as a build-memory improvement.
- Self-hosted final rebuild under a 1024-MiB outer maximum: 87.34 s,
  482,884 KiB peak RSS; its default-target image is bit identical to Node
  and js_min. All three images are 7,567,408 bytes with SHA-256
  `bfc8b7d8f290e9ce9931344944c0103974cbe6c58280fe7cb84b3761f56fbdfd`.
  Thus the live outer limit does not leak into the rebuilt target.
- Full Test262, ECMA, Octane, graphical-demo and full mishmashvm bootstrap
  suites have not been rerun for this startup-only checkpoint. Their prior
  results are not fresh acceptance results for this change.
