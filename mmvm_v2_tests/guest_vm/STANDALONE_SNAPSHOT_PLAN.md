# Standalone guest VM snapshot plan

## Goal

Produce a 32-bit x86 Linux snapshot that can be loaded by a deliberately small
ANSI C launcher and can execute a JavaScript source file without support from
`js_min.exe` or another JavaScript host:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --snapshot artifacts/snap

gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl

./artifacts/js_runner.exe ./artifacts/snap hello.js
```

The C launcher may load/map the image, pass `argc` and `argv`, supply the
address of `dlsym`, transfer control to the image entry point, and return its
status. It must not implement guest allocation, parsing, JavaScript semantics,
GC, filesystem operations, FFI dispatch, or any other VM service.

The fixed-point rebuild check is stronger:

```sh
./artifacts/js_runner.exe artifacts/snap guest_runner.js --vm-native \
  --snapshot artifacts/snap2
cmp artifacts/snap artifacts/snap2
```

`snap2` must be independently serialized by the snapshot-hosted runtime. It
must not be produced by merely copying the input image.

## Non-goals and constraints

- Do not change MMVM or Firefox C sources.
- Preserve the existing Node and `js_min.exe` guest paths throughout.
- Keep the existing code-only snapshot format readable until its replacement
  has equivalent tests; introduce a new image format/version for standalone
  images.
- Do not fix the guest heap or executable mapping at a predetermined virtual
  address. ASLR and arbitrary available mappings must remain valid.
- Do not serialize process-local pointers, libc addresses, timestamps, PIDs,
  GC marks, nondeterministic cache state, or uninitialized padding.
- Resolve operating-system services from the one supplied `dlsym` address.
- Keep generated i386 code in the macro assembler/compiler pipeline. Do not
  embed opaque machine-code byte strings in JavaScript or C.
- Use Linux interfaces available in the Linux 2.4 era where practical.
- Keep temporary images and executables under ignored `artifacts/`.

## Current checkpoint

### Self-hosted rebuild correction — 2026-10-07

The former standalone `--snapshot` path copied the immutable input image.
Matching hashes from that path were not evidence of an independent rebuild
or a self-hosting fixed point. That copying path has been removed.

Snapshot requests now bypass the application-runner shortcut and enter the
ordinary `guest_runner.js` constructor/compiler/serializer pipeline. When
the bootstrap host is itself a standalone guest VM, that pipeline reloads
the VM implementation from disk before creating the new runtime. The loaded
image remains the execution engine, not the source of the output bytes.
Heap helper kernels compile only the backend required by their memory host;
native rebuilding must not depend on generating unused JavaScript functions.

Bring-up has exposed general native language gaps used by the build itself:
`Function.prototype.call` forwarding to intrinsic functions, populated-array
enumeration, and array own-property checks. These are implemented in the
ordinary native dispatch/record kernels, not by rewriting build sources.
Intrinsic dispatch takes an explicit receiver so forwarded calls do not
modify the caller's bytecode. The kernel front/middle end and both backends
also support short-circuit `&&` and `||` for integer operands, preserving the
selected operand value and skipping evaluation of the unused operand.

The first from-source guest build completed, and its newly serialized image
executed hello, the alternate workload, and the demo8 and HTTP command line
paths. A subsequent fixed-source build completed in 222.29 seconds, including
lowering, assembly, runtime construction, and serialization. Its image also
executed hello, but was not yet a fixed point: local stack layout, eight
typed-array prototype properties, numeric payloads, and the fingerprint
differed. The build audit now compares named function/local reports and
record contents rather than trying to hide differences in serialized bytes.

The build fingerprint hashes parsed kernel syntax, not host-specific
`Function.prototype.toString()` whitespace or source locations. It also
normalizes redundant single-statement blocks: SpiderMonkey's decompiler
inserts those braces, but this kernel dialect has no block-scoped bindings.
All 124 kernel-function fingerprints now agree between Node's source-preserving
Function.toString and the bootstrap shell's decompiled form. The integer
kernel keeps descriptive local names such as `viewPrototype` and
`propertyAncestor`. The typed-array installer likewise uses `viewPrototype`;
bootstrap and guest builds now agree on the eight prototypes' own
`BYTES_PER_ELEMENT` properties. Compiler metadata version 11 identifies the
new binary64 floor/ceil lowering contract.

The numeric audit exposed a general native Math bug: the small-integer
`Math.round` path used modulo `ToInt32` on large arguments, corrupting the
binary64 serializer when the VM ran under itself. Native rounding now keeps
large values in binary64, uses macro-assembled x87 rounding with the caller's
control word restored, and leaves already-integral large values unchanged.
The existing small-number path remains available. Integer Math.round inputs
are copied directly. This is a language/runtime fix, not snapshot-specific
normalization. Bootstrap and guest diagnostics now agree on binary64 words
for MAX_VALUE, subnormals, and large products.

Diagnostic tools run with Node or js_min, and can also be loaded as programs
under a standalone snapshot:

```sh
# Named kernel functions, argument/local lists, and code offsets.
node guest_vm/tools/inspect_kernel_build.js
# A selected function's report and source.
node guest_vm/tools/inspect_kernel_build.js hasPropertyKernel
# Builtin prototype ownership, or binary64 conversion diagnostics.
node guest_vm/tools/inspect_kernel_build.js --builtins
node guest_vm/tools/inspect_kernel_build.js --numbers
# Inspect a debugger's raw heap dump without expanding it into a second heap.
node guest_vm/tools/audit_snapshot_heap.js --heap-stats artifacts/heap-dump
node guest_vm/tools/audit_snapshot_heap.js --heap-properties artifacts/heap-dump
```

Node is optional for these tools, not a dependency of the build. Substitute
the js_min executable, or `./artifacts/js_runner.exe artifacts/snap`, for
`node`. `retainNativeBuildIR` is an opt-in diagnostic VM constructor option;
normal native execution still releases compiler IR after assembly.

The independent fixed point was verified on 2026-10-07:

- Bootstrap from current sources under js_min: 106.00 seconds wall time.
- Rebuild those same sources under the bootstrap image: 229.44 seconds wall
  time, including lowering, assembly, startup construction, and serialization.
- Both images: 16,266,056 bytes; 31,776 allocated 512-byte disk blocks, so
  neither file is sparse.
- `cmp` succeeded over the entire files. Both SHA-256 digests were
  `a4cbe306e8cb3214fc3047acaae440d2ed6e59587677e9fa49de7456f95c8dc0`.
- The independently rebuilt image printed `Hello, world!`, ran the alternate
  workload, and read a deliberately changed DISPLAY/XAUTHORITY/HOME at launch.
- The complete `run_standalone_snapshot_test.sh` regression also passed:
  separate bootstrap builds with different program arguments and environments,
  alternate program execution, launch-time environment checks, and a genuine
  source rebuild under the test's newly compiled i386 launcher.
- The tested images are available as ignored `artifacts/snap` and
  `artifacts/snap2`; the previous images were retained as
  `artifacts/snap-before-selfhost-20261007` and
  `artifacts/snap2-before-selfhost-20261007`.

This verifies a source rebuild and independent serialization, not a template
copy, a machine-code cache load, or re-export of the loaded heap. The source
changes during bring-up produced different independently constructed images,
and the final unchanged sources produced the fixed point above.

A VM source change must affect the
rebuilt image where applicable: copying an input template cannot satisfy
this check. Existing application execution must remain independent of this
build path.

The full portable regression driver passed on both Node and js_min at this
checkpoint: 12 guest programs and 269 assertions per host, plus the heap,
collector, embedding, kernel compiler, native interpreter, CLI, and context
multiplexing checks. The native interpreter integration check now also
exercises large binary64 and int32 rounding boundaries. Application help
checks are smoke tests, not substitutes
for the longer interactive demo stability runs.

Additional checks against the independently rebuilt standalone image:

- All demo command-line help paths (1 through 8) completed; these are only
  module-loading/CLI checks for demos 2 through 7.
- Demo1 rendered at 320x240 for over a minute and closed via its Escape key
  handler without an error. Its roughly 0.9 FPS remains poor, but agrees with
  the previous image's 0.8--0.9 FPS in the same setup; this change does not
  claim to fix that performance gap.
- Demo8 ran through rolling, garage, and free-drive autopilot at 320x240,
  then closed normally through Escape/Q. Rolling intervals were about
  13.6--18.8 FPS. Garage was about 17--18 FPS after its transition interval,
  and autopilot about 17--18 FPS. Menu-only intervals reached about 20 FPS;
  these results do not establish sustained 20 FPS during active play.
- `net.js` and `node_web.js` served GET and HEAD requests on loopback.
  Response bodies matched both hello.js and the binary js_runner executable
  byte-for-byte. Test outputs remain ignored artifacts, not checked-in data.

The standalone language integration script still stops at its numeric-array
`join` check with native CALL rejection detail 1037. The previous bootstrap
image stops at the identical bytecode PC and reason: this is an existing
standalone semantic gap, not a new regression or evidence that the fixed
point test passed all ES5.1 features. The general language bring-up remains
tracked separately in HOST_CALL_STATUS.md.

The version-2 image now contains a position-independent macro-assembled
bootstrap, relocatable native interpreter text, initialized runtime, generic
guest command runner, and canonical guest heap template. It contains no
expected application name or application program state. The exact requested
command writes this generic boundary, then prints `Hello, world!` through the
ordinary post-snapshot execution path and exits zero. Independently generated
images made while running different applications are byte-for-byte identical,
and the version-2 container remains readable through the existing
`--with-snapshot` js_min path.

`program.js` is optional for snapshot creation. With no program remaining
after option parsing, both the js_min-hosted runner and snapshot-hosted runner
write the generic image and exit successfully. If a program is present, it is
still executed only after the immutable snapshot boundary has been written.

The older version-1 format is a 32-byte header followed by relocatable native
interpreter text. It remains readable for compatibility. Its internal entry
ABI takes VM implementation arguments:

```text
heap base, frame, context, array-length key, array prototype,
runtime-support vector, instruction budget, engine state
```

Repeated generation of this code-only image is already deterministic. Two
215479-byte images generated on 2026-09-14 were byte-identical and had SHA-256
`59cf54b8d65c1d85ceed5698333a746c43413ea1d685f4a01f99b38903a4d119`.
The hash is evidence for deterministic code emission, not a permanent golden
file and not a substitute for the full fixed-point test.

The standalone bootstrap now supports general source loading and the native
allocation/collection/growth and bytecode exception paths used by the demos.
Unsupported semantic operations still terminate with status 70. The current
remaining snapshot milestone is independent, deterministic self-hosted
rebuilding, followed by regression testing of the independently built image.

## External launcher ABI

The image exposes a position-independent entry point equivalent to:

```c
int snapshot_entry(int argc, char **argv, void *dlsym_address);
```

The header stores an entry offset, never an absolute function pointer. The
launcher maps the image, computes `mapping + entry_offset`, and calls it with
the arguments following the snapshot filename. The image owns argument
conversion and all subsequent execution.

For the first bring-up checkpoint the entry may execute precompiled
`hello.js`; later it must treat `argv[0]` as the source program and expose the
remaining values as that program's arguments.

## Standalone image format

Use a versioned container with explicit, bounds-checked offsets and lengths:

```text
header
  magic, format version, architecture, ABI version
  total image length and checksum
  entry offset
  RX code offset/length
  read-only data offset/length
  writable heap template offset/length
  boot metadata offset/length
  external-binding table offset/count

RX code
  entry/bootstrap routine
  native bytecode interpreter and helpers
  allocator, collector, direct FFI trampoline

heap template
  runtime roots and built-ins
  interned strings
  runtime support vector
  initial context/program/frame or boot program

boot metadata
  heap root offsets, initial limits, program/context offsets
  slots that must be rebound at process startup
```

All in-image references are segment-relative offsets or guest-heap offsets.
At startup the image allocates a writable heap at any address, copies or maps
the canonical template, installs the supplied `dlsym`, resolves required libc
symbols into cleared platform slots, and enters the native VM loop.

## Deterministic serialization rules

- Emit functions, constants, strings, properties, and roots in stable order.
- Use stable bytecode register allocation and macro-assembly layout.
- Zero header reservations, alignment padding, unused cell fields, caches,
  scratch cells, GC marks, and free-record payload bytes.
- Serialize offsets rather than executable, heap, Buffer-data, or libc
  pointers.
- Rebind native pointers after mapping and before guest execution.
- Canonicalize allocator/free-list state at the snapshot boundary.
- Use a defined snapshot phase: runtime built-ins and boot program installed,
  no application execution in progress, no pending host operation.
- Hash exactly the canonical bytes covered by the format, with the checksum
  field itself defined as zero during hash calculation.

## Implementation stages

### 1. Minimal C loader and native entry — complete

Add `js_runner.c` and a standalone header parser. The loader validates all
offset/length arithmetic, maps executable memory, and passes only `argc`,
`argv`, and `dlsym`. Initially exercise a compiler-generated entry that
resolves `puts`, prints a fixed diagnostic, and returns. This validates the
external ABI and position independence but is not accepted as the hello goal.

### 2. Precompiled hello boot image — complete

Extend snapshot generation with a canonical heap template containing the
runtime support required by precompiled `hello.js`. Add a native boot loop
that binds platform services, restores runtime root offsets, and executes the
initial frame entirely in native code. The accepted output is exactly
`Hello, world!`; no hard-coded hello or renderer/application intrinsic is
permitted.

This is the requested first end-to-end milestone:

```sh
./artifacts/js_runner.exe ./artifacts/snap hello.js
```

The filename must be checked against or used to select the snapshotted program;
the runner must not ignore it and print a built-in string.

The implemented bootstrap resolves `strcmp` through the supplied `dlsym` to
check that filename, rebinds the heap's named dlsym capability cell, and calls
the real native bytecode interpreter with the serialized guest offsets. All
process-local platform pointers are cleared while copying the heap and restored
in the still-running js_min instance afterwards. The file includes only the
initialized heap prefix. The bootstrap resolves `mmap` and `memcpy` through the
supplied `dlsym`, creates a zero-filled anonymous heap reservation, and copies
the compact template into it before entering the interpreter. Heap capacity
therefore does not inflate the snapshot file or constrain its load address.

### 3. Native runtime lifecycle

Keep allocation failure, free-region selection, collection, heap growth,
exception propagation, context teardown, and instruction-budget resumption
inside the standalone entry loop. Remove dependence on JavaScript-side frame
synchronization and weak-metadata cleanup. Platform calls use heap-resident
request/result records or direct trusted FFI as appropriate.

Status: caught guest throws now unwind heap-resident native frames and handlers
without leaving the engine. The handler restores its saved environment and
addresses either a function-local slot or a top-level name through the shared
signed binding descriptor. This also makes unchanged demo runners' normal
`process.exit` marker/catch path return the requested status in standalone
execution.

### 4. Self-hosted loading and front end

Implement filesystem loading through guest/native libc calls. Run the
regexp-free tokenizer, ES5.1 parser, bytecode compiler, and verifier as guest
programs using guest heap objects. A standalone image must then load arbitrary
supported source rather than only its precompiled bootstrap program.

### 5. Guest-side image creation

Move image canonicalization and serialization into the snapshot-hosted VM.
Resolve `open`, `write`, `close`, `rename`, and related operations through
`dlsym`. Never serialize rebound process addresses.

Status: the fixed-point runner path now performs canonical serialization in
the native bootstrap before the mutable heap template is copied and rebound.
It uses macro-assembled `open`/`write`/`close` calls and handles short writes.
Atomic temporary-file replacement remains future hardening; a failed write is
reported as a runtime failure and never accepted as a valid image.

### 6. Fixed-point reproduction

Generate `snap` under js_min, boot it with `js_runner.exe`, independently
generate `snap2`, and require byte identity. Run the comparison with ASLR and
with deliberately different available mapping addresses to catch hidden
absolute pointers.

Status: the documented `guest_runner.js --vm-native --snapshot ... hello.js`
command now writes `snap2`, runs the prepared hello payload, and produces a
byte-identical fixed point. The regression suite compares the complete files.

Snapshot production now has an explicit application-independent boundary.
The generic guest command runner and initialized runtime are serialized before
the outer invocation opens, parses, compiles, or installs its requested
application. The application executes only after the snapshot is complete.
The regression suite independently creates images while running two different
programs and under deliberately different `DISPLAY`, `XAUTHORITY`, and `HOME`
values, requires the complete files to be byte-identical, and cross-runs both
programs through the opposite image. Bootstrap-host environment strings are
not serialized, and the temporary bootstrap `process` object has no `env`
property. The standalone process constructs `process.env` from libc at launch.
Native Buffer backing pointers are
cleared while copying the template and rebuilt from the mapped heap base by
the macro-assembled bootstrap; process-local addresses therefore neither leak
into the file nor make independent images differ under ASLR.

The generic image now also loads arbitrary source filenames instead of
capturing `hello.js`. As of the 2026-09-23 checkpoint it runs unchanged
`demo1.js` through X11 for sustained execution, including guest-owned RegExp,
Number formatting, Buffer conversion, and primitive property lookup. On
2026-09-24 the next general runtime gaps were closed: Array construction now
accepts valid integral-double lengths and a shared native capacity-growth
kernel supports both `push` and `unshift`. The unchanged `demo2.js` consequently
runs through the generic image as well. Native zero-base `Math.pow` handling
then brought demos 3 through 7 across the same boundary without demo changes.
At 256x192, demo2 currently renders about 1.9--2.1 FPS and demos 6/7 about
1.2--1.7 FPS.

The 2026-09-24 standalone-lifecycle checkpoint also runs unchanged demo8. The
standalone engine now performs mark/sweep collection itself, rebuilds its
native free-region index, invalidates weak property-cache entries, and resumes
the interrupted bytecode without returning to a host VM. Recycled array
vectors initialize newly exposed sparse holes to `undefined`; self-hosted
program adoption retains function source text for `Function#toString`; and
native string concatenation covers finite fractional doubles, `NaN`,
infinities, and negative zero. At 256x192, an observed standalone run completed
loading, entered attract mode at roughly 18 FPS, and sustained 20 FPS after an
Escape/F transition into free-driving mode. Self-hosted parse/compile startup
previously took roughly two minutes because the application runner replaced
the loader's global `Buffer`, causing the next source read to fall back to its
byte-at-a-time compatibility implementation. The loader now retains its own
filesystem and intrinsic Buffer services. A profiled `demo8 --help` startup
fell from 109.04 seconds to 4.68 seconds; its two source reads take about 0.46
seconds and its two self-hosted compilations about 4.06 seconds. Menu Q exits
through a guest-resolved libc `exit`
call: the loader still supplies only `dlsym`, the requested status is
preserved, and shutdown requires no host-language exception or callback.

## Regression gates

Every stable checkpoint must keep these paths working:

1. `guest_vm/tests/run_tests.sh both`.
2. `hello.js`, `net.js`, and `node_web.js` through the existing guest runner.
3. Demo help/compile checks already in the suite.
4. Exact demo8 native startup at its default viewport:

   ```sh
   LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
     ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
     demo8_runner.js demo8.js
   ```

5. Snapshot generation and existing `--with-snapshot` loading while the
   code-only format remains supported.
6. Standalone images at varying mapping addresses once the C runner exists.

No demo source may be altered to accommodate the standalone runtime. A failure
in any previously passing gate is fixed before the next checkpoint is committed.

## Acceptance criteria for the first standalone milestone

- `js_runner.c` builds using exactly `gcc -ansi -m32 ... -ldl`.
- The C source contains only image loading/validation/mapping, ABI transfer,
  cleanup, and exit-status handling.
- `js_runner.exe` supplies no VM semantic or platform wrapper beyond `dlsym`.
- The image is load-address independent.
- `./artifacts/js_runner.exe ./artifacts/snap hello.js` prints exactly
  `Hello, world!` and exits zero.
- `hello.js` is executed as guest bytecode; the output is not hard-coded in
  the C runner or native bootstrap.
- Existing Node and js_min guest execution, tests, and demos do not regress.

## 2026-10-23: self-hosted rebuild regression

The reported `GET_PROPERTY` exit at PC 208 during lowering was a real guest
semantic bug, not an unsupported requirement of the compiler. Named array
lookup did not read dense elements for dynamic string keys such as `"0"`.
Consequently `for-in` traversal skipped IR children stored in arrays, the
inliner's size/mutation analysis was wrong, and it attempted to inline the
entire interpreter with invalid local mappings. Numeric-string array reads
now use the guest array storage, respecting explicit descriptors, holes,
prototype lookup and mapped argument cells.

Investigation also exposed two further blockers:

- The integer/radix string builder read its new record through a layout-aware
  hashing routine before initializing its header. Dirty allocation storage
  could look like a rope and cause a crash while generating enumeration keys.
  The flat header is now initialized before any such read.
- The assembler walks numbers in IR arrays with `for-in`. Native key
  enumeration rejected these primitives instead of returning no own keys.
  Null/undefined and number/boolean primitives now produce an empty own-key
  enumeration without a host callback. This is not a claim that all inherited
  or string/typed-view enumeration semantics are complete.

The existing object/control-flow test now includes one recursive traversal of
mixed object/array/primitive data. The unpatched standalone image returns an
incorrect count or exits on primitive enumeration; the repaired image passes.
Temporary inliner diagnostics used to identify the cause were removed.

An existing snapshot embeds the old engine. Rebuild the seed with js_min once;
merely loading changed build sources through an old image cannot repair the
engine that is executing those sources. For example, from this directory:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --snapshot artifacts/snap-fixed
./artifacts/js_runner.exe artifacts/snap-fixed guest_runner.js --vm-native \
  --snapshot artifacts/snap-rebuilt
cmp artifacts/snap-fixed artifacts/snap-rebuilt
./artifacts/js_runner.exe artifacts/snap-rebuilt hello.js
```

The repaired self-hosted build performed real parsing, lowering, assembly,
runtime preparation and serialization. It completed with a byte-identical
image; both tested images had SHA-256
`3fb97cb0f3eeac3cb2957b2f56a264fc059b0249a0174e8ce4b03a63782974df`.
The rebuilt image ran hello.js and the object/control-flow regression.
The complete existing Node/js_min regression script passed: 12 guest programs,
270 guest assertions per host, shared kernel/native integration (canonical and
predecoded), heap/GC/embedding checks, CLI demos and context multiplexing.
Measured self-hosted stages were 52.801 seconds for runtime construction
(including parsing/fingerprinting, lowering and assembly), 1.410 for
environment installation, 88.215 for standalone preparation and 1.593 for
writing: about 144 seconds, not a cached/copy-only snapshot export. The seed
build was about 83 seconds. These results establish correctness of this build,
not completion of the startup-performance target.

Validation artifacts remain ignored under the `self-build-fixed-stage1c` /
`self-build-fixed-stage2c` prefixes. The user's original snapshot was not
overwritten, no C or demo sources changed, and no generated image is checked in.

### Bounded-inlining follow-up

Serial zlib checks found an execution loss in the initial repair image. The
follow-up keeps named array-index resolution in a helper and makes the shared
inliner capture original bodies/local maps before rewriting graph members.
This preserves its one-level budget independently of function order. Compiler
contract version 46 invalidates earlier code caches rather than silently mixing
different generated-code policies. See `ZLIB_PERFORMANCE.md` for all measured
timings, including the remaining roughly 1.3% batch-mean difference in the
latest serial comparison; this is not a claimed execution speedup.

The final follow-up was also rebuilt under itself and compared with cmp.
`artifacts/self-build-bounded-stage1.snap` and
`artifacts/self-build-bounded-stage2.snap` are byte-identical, both SHA-256
`65e129a84e313a33fdd3daeebda097294dff9c2c36fe943416667be6629a40a0`.
The rebuilt image runs hello.js. Its reported build stages were 59.522 seconds
for runtime construction, 1.534 for environment installation, 99.562 for
standalone preparation and 2.010 for serialization (about 162.6 seconds total
for these stages). This validates a real rebuild, not a copy or cache export.
Hashes across different compiler revisions are expected to differ; the fixed
point is seed versus rebuilt output for the same source revision.
Both final images are non-sparse 16,995,576-byte files. The complete Node/js_min
regression script passed again with this follow-up (12 programs / 270 guest
assertions per host, including both native operand modes). Use the bounded
stage1/stage2 artifacts for this final checkpoint, or regenerate a seed from
the current sources using the commands above; earlier prefixes are retained
only as investigation evidence.
