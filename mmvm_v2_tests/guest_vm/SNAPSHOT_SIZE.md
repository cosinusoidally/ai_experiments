# Snapshot size and compact strings

## 2026-10-26: compact canonical instruction storage

The next checkpoint is 6,832,648 bytes, down from the 8,230,816-byte baseline.
Canonical bytecode uses 16-bit logical words, a dedicated -1 sentinel, and
an ordered index/full-int32 table for operands that do not fit. Logical PCs,
all operand bits and source/debug information remain intact. The format is
selected only when smaller than ordinary 32-bit storage; this is not a
general-purpose compression stream or a snapshot-load decompression pass.

The kernel prepares a 32-bit execution view on first use, retaining the same
direct word loads in dispatch. The existing execution-cache edge is traced
by both collectors. There are 95 warm execution views (158,784 bytes) in this
checkpoint, versus 1,074,880 bytes of compact canonical instructions. Mutation
uses an owner-aware writable 32-bit view, preserving shared record addresses
and predecoded execution semantics. Small units are written in paired LE
words so native construction does not double its JS/C byte-write crossings.
Compiler contract 56 describes this format.

Both Node and js_min project suites pass 12 programs/270 assertions, including
the predecoded kernel. Standalone hello, the bounded 47-collection workload
and independent mark audit pass. Cross-host fixed-point, performance and
full integration checks remain required after the remaining large reductions.

## 2026-10-26: integer-only program maps

The fresh Node-built baseline is 8,230,816 bytes. Register/parameter maps
consume about 813 KiB because each signed slot index occupies a 16-byte
general value cell. Dedicated INTEGER_VECTOR records retain named length,
index and setter accessors but store each element as one signed int32.
The collector treats their contents as leaves, never potential references.
Ordinary mutable JS arrays and value vectors are unchanged. Shared compiler
maps retain copy-on-write behavior in both host and native program builders.
Compiler contract 55 prevents old execution kernels from reading this layout.

At the first integer-map checkpoint, maps occupy 235,152 bytes rather than
813,000 bytes; the initialized heap falls from 7,849,888 to 7,281,512 bytes.
The Node project suite passes all 12 programs/270 assertions; standalone
hello, the 24-round/47-collection GC workload and independent marking audit
pass. Broader validation and further large-payload reductions follow; this
checkpoint is not a final size or performance claim.

## Accepted checkpoint, 2026-10-24

The current dense image is **8,326,112 bytes (7.94 MiB)**, below the 8 MiB
target without compression, sparse storage, source stripping or C changes.
The genuine self-hosted rebuild is byte-identical, SHA-256
`7cd604ea1c285b90751063d3084279fffe526f9be9821c7129991c357ef53947`.
This is about 33% smaller than the preceding 12,399,160-byte Latin-1 image,
and about 51% smaller than the earlier 16,995,576-byte UTF-16 image.

The largest low-cost reductions were shared source backing, shared private
argument lists with exact capacity, and shared immutable register/parameter
maps with copy-on-write editing. Tiny strings remain inline where a view
cannot reduce their record size. The native string reader keeps flat reads
eligible for ordinary bounded inlining. There is no new load-time decoder or
metadata reconstruction pass. See [build/run commands](#build-run-and-inspect)
and the chronological design/measurement notes below.

Final validation:

- Both-host project suite passes: 12 guest programs / 270 language assertions
  per host, plus the embedding, GC, compiler and native-engine checks.
- Seed and true self-build images match using cmp; both run hello.js and the
  alternate standalone workload. Producing logs contain source loading,
  lowering and assembly, not an image-copy shortcut.
- The heap graph/compiled-marker audit finds 37,983 reachable records and
  zero missing marks. The profitable-backing audit reports zero remaining
  duplicated backing with avoidable bytes. Its 1,322 tiny inline strings are
  counted separately because views could not shrink those records.
- Demo8 ran for just over seven minutes across rally, garage and free-drive
  autopilot and exited normally. Late garage/free-drive samples were roughly
  19–20 FPS at 320x240/20 FPS. This is a stability check, not a frame-time
  guarantee or proof against every possible GC failure.
- An earlier metadata image also ran demo1 for nearly six minutes with typing
  and a mouse drag. Both final and earlier metadata images load all demo1–7
  command-line/help paths. No demo sources were changed.
- net.js and node_web.js served hello.js and the runner ELF binary from the
  final image; both downloads matched with cmp on each server.

Paired idle-machine startup checks found no regression. Three alternating
demo8 command-line startup trials had medians of about 3.532 seconds for the
Latin-1 baseline and 3.508 seconds for the final image. The ranges overlap;
this is not a claimed large parsing speedup. Warm hello trials had medians of
about 19.9 versus 11.5 ms. These are launch-to-exit/command-line proxies, not
cold-filesystem or first-frame measurements.

The final zlib diagnostic verified both complete output buffers in two
60-round batches: 26.069/26.848 seconds, versus 26.545/26.455 seconds for the
older image run serially afterwards. The means are essentially unchanged
(26.459 versus 26.500 seconds). Initialization was 17.569 versus 18.686
seconds. This is a diagnostic, not an Octane score or evidence of the older
unmet 2x performance target being achieved.

The final cold build's reported stages were 17.214 + 1.241 + 54.136 + 15.665
seconds, about 88.3 seconds total. The true self-build was run concurrently
with project tests and reported 74.875 + 1.690 + 87.731 + 37.856 seconds;
those concurrent stages are not an isolated generation-speed comparison.
Generation remains a real compiler build, separate from image load time.

Validated temporary images: `artifacts/fruits-profitable1.snap` and
`artifacts/fruits-profitable2.snap`. Logs use the matching ignored prefix.
Snapshots, downloads, reference data and logs are not checked in. Detailed
Test262 scope/status remains in `TEST262_STATUS.md`; a whole-suite rerun was
not performed for this size change.

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

The focused native Test262 selection `ch09/9.5 ch11/11.6 ch11/11.7` executed
165 variants: 153 passed, the same 12 failed, 0 not run/timeouts. Failure IDs
were compared with the pre-change log. This is not a whole-suite claim.

The compact self-built image also passed these integration checks:

- js_min loaded it through `--with-snapshot` and ran hello.js.
- net.js and node_web.js served text and the js_runner ELF binary on temporary
  loopback ports; all downloads matched the originals with cmp.
- Demo1 ran for over five minutes at 320x240, accepted typing/mouse dragging,
  and exited normally. Its roughly 1.1–1.3 FPS remains poor; this was not an
  isolated speed comparison.
- Demo8 ran for over six minutes at 320x240/20 FPS across rolling, garage and
  free-drive autopilot, and exited normally through Escape/Q. The demos
  overlapped for part of the stability check. After demo1 exited, late
  free-drive samples with demo8 alone were about 20 FPS. Late RSS was about
  528 MiB. These runs do not constitute an exhaustive visual or GC proof.

Raw integration logs remain ignored `artifacts/latin1-*.log` files. No demo,
C, external corpus, or generated snapshot files were checked in.

## 2026-10-23: immutable backing views

Strings now also support an immutable view representation. A view stores its
logical length, hash (zero means not precomputed, as for ropes), backing string
reference and starting UTF-16 code-unit offset. Its minimum allocation is 32
bytes. The slice flag and named field offsets live in HeapRecords.KernelConstants;
both kernel backends and the collector use those same definitions. Compiler
contract version 48 invalidates older code-only caches. No C changes are needed.

There are two complementary construction paths:

- Program registration passes the enclosing source to nested programs. An
  exact contained source becomes a view immediately, before allocating a
  redundant character buffer. Existing equal-string interning still wins
  first, preserving atom identity.
- The native substring implementation also creates views instead of copying
  code units. This applies to ordinary guest programs, including guest-side
  parsing, not just the seed builder. Empty and whole-string results retain
  their existing canonical handling. Creating a view of another view folds
  its offsets; a view can also reference a rope. The common character reader
  resolves both node kinds before reading the flat storage width.

The collector follows a view's backing reference in both its reference walk
and compiled marker. It must not mistake the backing fields for characters,
or collect backing text while any view survives. Retaining a small view can
keep a larger backing alive; this is the usual immutable-view memory tradeoff,
not an ownership transfer or dependence on a host string's lifetime.

At the final snapshot boundary a largest-first pass also finds atoms which
were allocated before their containing source was available. These existing
records become views **in place**: their addresses, observable contents and
allocation sizes do not change. Their unused payload is explicitly zeroed.
The pass never moves an object or rewrites native pointers. Retaining allocation
padding avoids imposing a moving-heap requirement merely to save a few small
atom records. Sources, which account for the significant saving, already use
minimum-sized views from the first construction path.

Owners are selected by text length, with heap address as a deterministic tie
break. An owner is always a flat record, never another newly shared view, so
the pass cannot introduce cycles. Pre-existing views can acquire an additional
backing edge through this finalization; the reader supports that case too.
The pass runs before copying the heap template and before any application
argument is opened. It is part of a genuine rebuild, not a saved-image copy.

The final pass uses bounded raw-byte search for flat Latin-1 data. The memory
layer can call libc `memmem` on native allocations, with a reference fallback
if that symbol is unavailable or the memory is emulated. Wide strings retain
code-unit search rather than risk an unaligned UTF-16 byte match. This is a
bulk memory operation through the VM's FFI, not a host-language parser/string
service. No downloaded dependency or new helper C function is involved.

The following inspection command reports remaining flat strings whose text
is already contained in another flat backing and can become a view without
enlarging the allocation:

```sh
node guest_vm/tools/audit_snapshot_heap.js --string-sharing artifacts/snap
```

It reports addresses, ranges and avoidable bytes, without dumping source
text into the log. `--sources` and `--string ADDRESS` now show a view's backing
address and starting offset; the latter still prints the complete exact text.
Inspection does not require access to the original files or a decoder for a
compressed format. Sub-view character ranges remain directly inspectable.

The first source-view image, before final atom sharing, was 10,157,064 bytes.
It contained 1,815 minimum-sized views, occupying 58,144 bytes, and reduced
total string storage from 4,864,656 to 2,651,688 bytes. The remaining audit
found only 58,240 avoidable bytes of flat backing, in small names/literals;
there were no further large overlapping source buffers. Final validation
and measurements are recorded below when complete.

The validated string-sharing checkpoint occupies 10,188,328 bytes (19,904
allocated 512-byte blocks, not sparse). A genuine self-hosted rebuild is byte
identical, SHA-256 `489978fd6549503e9c2491baa5924fa882f4845538e98dba45e4d4d8d6166d62`.
The private-copy sharing audit reports zero remaining duplicated flat backing
strings and zero avoidable backing bytes. The compiled-marker audit reports
62,944 reachable records and zero missing marks. The Node/js_min project
suite passes 12 programs / 270 assertions per host. The rebuilt image runs
hello.js. Demo8 ran for just over five minutes across rally, garage and
free-drive autopilot, exiting normally through Escape/Q; much of that run
overlapped the self-hosted build, so its FPS is not an isolated comparison.

The cold build reported 18.787 seconds runtime construction, 1.310 environment
installation, 57.578 preparation and 24.831 serialization/final sharing.
The concurrent self-hosted build reported 60.246 + 1.441 + 102.732 + 69.991
seconds. Final sharing alone was 24.097/68.108 seconds: this is still excessive
build work, not an accepted claim of faster snapshot generation. Loading an
already-built image does not execute this pass. Pointer values passed through
the old shell's FFI retain its signed-pointer convention; unsigned values are
used only when calculating the returned relative offset. The diagnostic
`--share-backings` mode performs this pass on a private image copy and then
checks sharing and GC edges, without modifying the input image.

These checks do not constitute whole-suite Test262 or an exhaustive demo/GC
proof. Load/startup and isolated execution comparisons remain required for
the next metadata checkpoint. Raw logs/images have the ignored
`artifacts/fruits-` and `artifacts/shared-strings-` prefixes.

## Build, run and inspect

Run these commands from `mmvm_v2_tests`. Use the existing js_min binary; there
is no need to rebuild it or add rpath. Set its Firefox library directory in
the launch environment:

```sh
export LD_LIBRARY_PATH=../../firefox-1.0.8/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --snapshot artifacts/snap
```

The application argument is optional. With no application the command builds
a generic ready-to-run image and exits. Appending `hello.js` builds the same
image and then runs hello; application contents/arguments and the producing
process's environment do not belong in the snapshot.

Use the existing standalone runner for arbitrary programs:

```sh
./artifacts/js_runner.exe artifacts/snap hello.js
./artifacts/js_runner.exe artifacts/snap node_web.js --bind 127.0.0.1 8000
./artifacts/js_runner.exe artifacts/snap demo8_runner.js demo8.js --size 320x240 --fps 20
```

To genuinely rebuild the VM under itself and compare its output:

```sh
./artifacts/js_runner.exe artifacts/snap guest_runner.js --vm-native \
  --snapshot artifacts/snap2
cmp artifacts/snap artifacts/snap2
sha256sum artifacts/snap artifacts/snap2
```

This path loads the current build sources and runs their compiler and assembler.
It is not a copy of `snap`. A byte-identical result requires the same source
revision and build options. Launch environment and the program subsequently
chosen are not build inputs.

The js_min-hosted runner can also load the matching image:

```sh
../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --with-snapshot artifacts/snap hello.js
```

For sizes and backing-sharing details:

```sh
../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js \
  --snapshot-stats artifacts/snap
../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js \
  --string-sharing artifacts/snap
../../mmvm_v2/artifacts/js_min.exe guest_vm/tools/audit_snapshot_heap.js \
  --sources artifacts/snap
```

Node can run these same inspection commands as an optional convenience; it
is not required for creating or launching the standalone image. Snapshots and
diagnostic logs belong in the ignored `artifacts` directory, not in git.

## Metadata audit and the next size checkpoint

`--metadata-sharing` inspects immutable compiler metadata separately from
ordinary mutable program values:

```sh
node guest_vm/tools/audit_snapshot_heap.js --metadata-sharing artifacts/snap
```

The first source-view image has these exact-duplicate opportunities (before
any metadata sharing):

- Argument-register descriptors: 16,167 records/pairs, 1,974,536 bytes;
  10,244 duplicate lists account for 1,234,528 bytes.
- Constant-register maps: 2,200 records, 882,800 bytes;
  769 duplicates account for 150,488 bytes.
- Binding-register maps: 1,948 records, 272,400 bytes;
  1,894 duplicates account for 221,632 bytes.
- Parameter-slot maps: 2,200 records, 114,032 bytes;
  2,182 duplicates account for 111,152 bytes.
- Bytecode: 2,200 records, 2,165,664 bytes;
  487 duplicates account for 244,056 bytes.

Sharing argument descriptors and the three maps first avoids changing the
execution format or adding an image-load decoder. Ordinary JS arrays and
objects must remain independently mutable. Compiler metadata setters must
retain independent behavior too: shared maps require copy-on-write before
an explicit construction/embedding mutation. Build-side lookup tables must
be weak, rather than retain every program compiled by a long-lived runtime.
Load/startup measurements are a separate acceptance check; a smaller file
alone is not proof that launching it is faster.

## 2026-10-24: shared compiler metadata, below 8 MiB

The first metadata image was **8,225,952 bytes (7.845 MiB)**, below the 8,388,608-byte
target. It is a dense file (16,072 allocated 512-byte blocks), not a sparse
heap-capacity dump. It is 1,962,376 bytes smaller than the preceding
10,188,328-byte string-sharing checkpoint and 4,173,208 bytes smaller than
the 12,399,160-byte one-byte-string image. All source/debug text is retained.

The seed and genuine self-hosted rebuild are byte-identical, SHA-256
`8d309d34620e52eaf63d06b226e59ccfbd9068c23a30aac3969860416cce5f53`.
Both run arbitrary programs, beginning at the generic argument boundary.
This is still a rebuild from the current source, not an image-copy shortcut.

### Construction and ownership

- Identical argument-register lists share one private array/vector pair, with
  exact capacity instead of the mutable-array allocator's default spare room.
  Compiler.argumentListConstant canonicalizes empty lists without hashing
  every call site's arguments. Other list contents are interned at runtime
  registration. Generic Compiler.constant(array) is unchanged. The first
  checkpoint also interned nonempty lists inside the compiler; this saved
  about 73 KiB more but added front-end work to application startup, so the
  lighter frontend policy is preferred.
- Runtime registration classifies bytecode uses before sharing an array
  constant. A list used by an ordinary CONST instruction is not shared, even
  if the same slot is also used by CALL. Embedder-built ordinary array values
  therefore keep independent mutability; this is not global array interning.
- Identical constant-register, binding-register and parameter-slot vectors
  share ordinary value-vector records, including sharing across roles when
  their contents match. No packed decoding format or extra execution-time
  accessor is introduced.
- A shared-map flag marks private immutable maps. Explicit program-vector
  editing clones that vector before writing, on both the reference and native
  paths, and updates only the edited program's named field. Call frames still
  read the same original layout. Normal execution never pays a COW check.
- The build lookup table is weak derived state. Its addresses are not GC
  roots. Registration checks the collector generation, including native
  collections, and discards stale entries before reusing a table. It must not
  reuse an address merely because the heap has since allocated something at
  the same numeric offset.

The metadata-sharing audit now reports zero duplicates in all four optimized
roles. There are 5,940 argument-list pairs occupying 575,440 bytes, 1,441
constant-register maps occupying 690,504 bytes, 54 binding-register maps
occupying 50,832 bytes, and 18 parameter maps occupying 2,880 bytes. Cross-role
sharing means these role totals are not an additive count of unique records.
The graph/compiled-marker audit reports 37,972 reachable records and zero
missing marks, versus 62,944 at the preceding string checkpoint.

The snapshot has no new load-time reconstruction, decompression, dictionary
expansion or fixup pass for this metadata. Relative guest references retain
their existing meaning. Neither the C runner nor the js_min binary changed.

### Native support needed by self-hosted construction

Validation exposed that native Array.join accepted string elements but not
int32 elements; host-assisted execution had hidden that gap. Integer metadata
keys need the latter. The native implementation now measures and writes
decimal int32 elements directly alongside strings/null/undefined. The
negative-domain digit algorithm handles INT32_MIN without overflowing an
absolute value. Named decimal/character constants are ordinary external
compiler bindings, not new compile-time meanings for function-local variables.

This is a general Array.join improvement, not a special metadata/benchmark
intrinsic. It neither changes the input array nor allocates a temporary string
for each number. It does not claim to implement every remaining generic join
coercion case. Compiler contract version 49 includes the shared-map/COW
contract; older code-only native caches are not silently reused.

### Verification scope and remaining opportunities

The Node/js_min project suite passes on both hosts: 12 guest programs / 270
language assertions per host, plus embedding, GC, error locations, compiler
and both native operand modes. Existing integration tests now also exercise
independent program-vector edits and mixed signed integer joining. A focused
Test262 run still has the same 153 passes / 12 failures / 0 not run / 0
timeouts across 165 variants; this is not a whole-suite conformance claim.

Under the standalone runner, net.js and node_web.js served both hello.js and
the runner's ELF binary on temporary loopback ports; downloads matched using
cmp. Demo8 ran for over six minutes across rally, garage and free-drive
autopilot and exited normally. During part of that stability run the
self-hosted rebuild ran concurrently; its FPS is not an isolated performance
comparison. Standalone hello and the rebuilt image both pass.

The remaining 488 identical bytecode records account for 244,528 bytes. They
are a smaller, separate opportunity: bytecode has a mutable execution-cache
link and an explicit code-editing API, so sharing it also needs mutation/cache
ownership treatment. More aggressive packed integer tables would require a
representation/ABI change. Neither is concealed by stripping source text or
compressing the file. Raw bytecode, distinct source backing and live mutable
objects now dominate instead of repeated compiler descriptors.

Raw measurements and images use the ignored `artifacts/fruits-final*` prefix.

### Startup refinements after the first metadata checkpoint

The final candidate is 8,326,112 bytes (7.94 MiB), still below 8 MiB. Two
refinements keep the representation work off ordinary startup's critical path:

- The frontend only canonicalizes empty argument lists. It does not build
  interning keys for every nonempty call site; runtime registration still
  shares the private descriptor records themselves.
- Flat character reads have a small 44-node kernel function, eligible for the
  existing bounded inliner. A separate shared function traverses ropes/views.
  No inlining threshold was increased and no application-specific fast path
  was introduced.
- Final backing sharing excludes flat records no larger than the minimum
  view record. In particular character-table strings and tiny atoms stay
  inline: a view could not make them smaller but would add indirection.
  `--string-sharing` explicitly counts these retained inline records separately
  from duplicated backing with avoidable storage. Large source sharing and
  exact source inspection are unaffected.

The earlier all-views image showed a small startup penalty, so it was not
accepted merely because its file was smaller. In the latest alternating,
otherwise-idle three-pair comparison, demo8_runner.js/demo8.js --help took
3.532/3.497/3.546 seconds with the one-byte baseline and
3.471/3.537/3.508 seconds with this candidate. Medians are approximately
3.532 versus 3.508 seconds; the ranges overlap and no startup regression is
observed. This is a command-line/front-end startup proxy, not a first-frame or
cold-filesystem benchmark. Earlier hello comparisons also favored the smaller
image. Final full verification is recorded in the follow-up checkpoint.
