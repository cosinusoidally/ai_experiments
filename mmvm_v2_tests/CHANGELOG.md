# Changelog

This changelog records user-visible feature progress for the MMVM v2
JavaScript demos.

Versions are deliberately simple `0.x` progress releases, not semantic
versions. Every completed new feature or user-visible feature update advances
the point release by one (`0.1`, `0.2`, `0.3`, and so on). The major version
remains `0` for this development series.

## 0.62

Approximate completion: 2026-09-25 late evening BST

### Guest VM

- Fixed a native-collection root omission which could reclaim the runtime's
  platform-service table under zlib's allocation pressure. A later number
  formatting call then attempted to invoke a reused object field as the libc
  `snprintf` pointer and jumped to address `0x1`.
- The engine-state and platform-service records are now explicit roots of
  host-triggered native collection. The compiled entry parameter was renamed
  from the misleading `globalObject` to `platformServices` to document the
  actual ABI and internal-collector root.
- The unchanged zlib quick-correctness run now completes with its original
  checksum in 75.2 seconds at 305.5 MiB peak RSS. Both complete regression
  suites still pass 12 programs and 264 assertions.

## 0.61

Approximate completion: 2026-09-25 evening BST

### Guest VM

- Reworked escaped string-literal scanning to consume ordinary source runs
  directly and combine decoded fragments with a balanced reduction. The old
  path appended every character to an immutable prefix after the first
  escape, producing quadratic copying for generated sources with regular line
  continuations.
- Reduced a self-hosted compile of the unchanged 185 KiB zlib source from
  151.8 seconds and 540.8 MiB peak RSS to 19.2 seconds and 136.4 MiB. The new
  measurement includes native-interpreter compilation and front-end module
  loading.
- Re-ran the complete Node and js_min suites after the tokenizer change; both
  pass 12 guest programs and 264 guest assertions, together with the network,
  web, demo1, demo2, and multi-context command-line paths.

## 0.60

Approximate completion: 2026-09-25 evening BST

### Guest VM

- Implemented ES5 string-index property access in the compiled interpreter,
  including undefined out-of-range results and guest-heap one-character
  strings for non-Latin-1 code units.
- Removed zlib's remaining numeric string-property exits. A repeat startup
  profile reduced semantic exits from 23 to 20; the remaining transitions are
  calls and loose equality rather than indexed property access.

## 0.59

Approximate completion: 2026-09-25 evening BST

### Guest VM

- Moved `Boolean`, `Date.now`, `Array.prototype.reverse`,
  `encodeURIComponent`, Annex B `unescape`, `TypedArray.prototype.set`, and
  ArrayBuffer/typed-array construction into the compiled guest interpreter.
- Typed-array constructors now create their backing storage, ArrayBuffer
  record, and typed view directly in the relocatable guest heap. Length,
  ordinary-array-copy, and shared-ArrayBuffer forms use the same general path,
  with runtime-owned prototypes held in named support-vector slots.
- Corrected native `unescape` so malformed `%XX` and `%uXXXX` sequences remain
  literal rather than being partially consumed. The standalone integration
  test now covers malformed escapes and all three typed-array construction
  forms.
- A fresh 15-second zlib profile executes just over one million guest
  bytecodes after initialization without typed-array constructor or set host
  callbacks. The existing Node and js_min regression suites remain at 12
  programs and 264 assertions each.

## 0.58

Approximate completion: 2026-09-25 evening BST

### Guest VM

- Made EarleyBoyer quick correctness pass through the generic standalone
  `js_runner.exe` image. Non-strict calls now allocate primitive `this`
  wrappers directly on the guest heap instead of leaving the interpreter.
- Added a general native `Array.prototype.splice`; this lets the self-hosted
  compiler handle direct-eval scope insertion while compiling the unchanged
  EarleyBoyer source.
- Added a checked-in high-level front-end diagnostic which compiles an
  arbitrary source file through the guest-owned tokenizer, parser, compiler,
  and verifier without executing that source.

## 0.57

Approximate completion: 2026-09-25 evening BST

### Guest VM

- Removed RayTrace's remaining arithmetic exits with general guest-side
  string-to-number coercion, including whitespace trimming and direct libc
  conversion through the standalone platform table.
- Added native `Object` construction, boxed primitive lookup,
  `String.prototype.toString`/`valueOf`, boxed-string character access, and
  `Number.prototype.toString`. EarleyBoyer quick correctness now has only one
  benchmark-language transition remaining outside the compiled interpreter.

## 0.56

Approximate completion: 2026-09-25 afternoon BST

### Guest VM

- Kept DeltaBlue and Crypto quick-correctness execution inside the native
  guest interpreter by adding general native implementations of
  `Object.defineProperty`, `Number.prototype.toFixed`, and `Math.random`.
- Property descriptors and formatted-number results are read from and written
  to the runtime-owned guest heap. The standalone random-number sequence is
  derived entirely inside the interpreter and owns no host-VM state.

## 0.55

Approximate completion: 2026-09-25 afternoon BST

### Guest VM

- Made the generic standalone snapshot run the Octane wrapper and completed
  quick-correctness execution of Richards without bootstrap-host language
  callbacks.
- Added native guest implementations of `Array.prototype.indexOf`,
  `Math.log`, `Number.prototype.toPrecision`, Date construction, and numeric
  Date coercion. The x87 logarithm is emitted through the JavaScript macro
  assembler, while the Node backend uses the same kernel IR.
- Corrected self-hosted script declaration instantiation and passed the live
  platform-service table explicitly through the compiled-interpreter ABI.
  This also prevents allocation-heavy interpreter construction from leaving
  its service record outside the runtime root graph.

## 0.54

Approximate completion: 2026-09-25 morning BST

### Guest VM

- Removed bootstrap-host environment values from standalone images. Changes
  to `DISPLAY`, `XAUTHORITY`, or `HOME` no longer change snapshot bytes; when
  an outer invocation also runs a program, its real environment is installed
  only after the snapshot boundary.
- Removed the inert bootstrap `process.env` placeholder itself. The standalone
  launch path creates `process.env` only when it reads the new process's
  environment through libc.

## 0.53

Approximate completion: 2026-09-25 morning BST

### Guest VM

- Made the program argument optional when creating a standalone snapshot.
  `guest_runner.js --vm-native --snapshot FILE` now writes the generic image
  and exits, on both the js_min-hosted and snapshot-hosted runner paths.

## 0.52

Approximate completion: 2026-09-25 morning BST

### Guest VM

- Made `--snapshot` capture the initialized generic command runner before the
  requested application is read or represented in the guest heap. Images made
  while running different programs are now byte-identical and can each run any
  supported source file.
- Removed process-local Buffer backing addresses from serialized heap
  templates. The macro-assembled standalone bootstrap now reconstructs those
  pointers from the mapped heap base before guest execution.

## 0.51

Approximate completion: 2026-09-15 afternoon BST

### Guest VM

- Added standalone runner-image fixed-point reproduction. A relocatable image
  can now process `guest_runner.js --vm-native --snapshot FILE hello.js`, write
  itself through libc obtained from the loader's sole `dlsym` capability, and
  then execute the prepared guest hello program.
- Added a high-level regression requiring the regenerated non-sparse image to
  be byte-identical to its source, while keeping `js_runner.c` limited to image
  validation/mapping and the `argc`/`argv`/`dlsym` ABI transfer.
- Stored bytecode-function source in guest-heap program records and added
  native Buffer and Function string conversion paths needed by continued
  self-hosting work. Native allocator ownership is now released safely before
  re-entrant host call boundaries.

## 0.50

Approximate completion: 2026-09-15 morning BST

### Guest VM

- Replaced the sparse full-capacity heap extent in standalone snapshots with a
  genuinely compact initialized heap template. The current hello image is
  about 273 KiB as both an ordinary file and apparent file size.
- Made the native bootstrap resolve `mmap` and `memcpy` through its sole
  loader-supplied `dlsym` capability, reserve zero-filled anonymous heap memory
  at startup, and copy the compact template before entering the interpreter.
  The C runner still supplies no VM support.

## 0.49

Approximate completion: 2026-09-15 morning BST

### Guest VM

- Added the first complete standalone snapshot image: a macro-assembled native
  bootstrap, relocatable interpreter, precompiled guest program and initial
  frame/context, and a canonical sparse guest-heap template.
- Added the minimal ANSI C `js_runner.c` loader. It maps the image, supplies
  only `argc`, `argv`, and the address of `dlsym`, and transfers control; the
  snapshotted guest bytecode performs the `Hello, world!` libc FFI call.
- Made standalone image output deterministic by excluding process-local
  platform pointers. Two clean generations are byte-identical. Version-2
  images remain usable as native-interpreter inputs through `--with-snapshot`,
  and older version-1 code images remain readable.

## 0.48

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Identified the exact 0.46 crash: the kernel expression `loadI32F64(1)` tried
  to load and convert an int32 at native address `0x1`; it did not convert the
  immediate value one. This caused demo8's field-of-view `Math.atan` call to
  segfault during default-size initialization.
- Reintroduced native guest `Math.atan` using the established safe pattern:
  write the denominator one through the named engine-scratch accessor, then
  pass that scratch-cell address to `loadI32F64`. The exact reported demo8
  command now initializes and continues rendering, with observed 18.6 and
  19.8 FPS samples at its default 256x192 resolution.

## 0.47

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Removed the 0.46 native `Math.atan` intrinsic after the exact default demo8
  invocation exposed an i386 crash during field-of-view initialization. The
  established semantic `Math.atan` implementation is restored while the
  separately tested native `Math.atan2` path remains unchanged.
- Reproduced the original status-139 failure with
  `js_min.exe guest_runner.js --vm-native demo8_runner.js demo8.js`, then
  confirmed that the corrected build initializes and continues rendering at
  its default 256x192 resolution. Observed five-second samples were 18.7,
  19.6, and 18.5 FPS. The parser, allocator, `parseInt`, and signed-zero
  improvements remain enabled; no demo source was changed.

## 0.46

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Added a native guest `Math.atan` intrinsic. It uses the existing kernel/x87
  binary64 `atan2` operation with a denominator of one, so ordinary numeric
  calls no longer require the host Math implementation. `Math.atan2` retains
  its existing two-argument path.

## 0.45

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Combined kernel local-variable discovery with the mandatory graph walk that
  already finds constants and helper dependencies. Graph members carry their
  ordered local-name list into lowering, while standalone compiler users keep
  the original independent local collector.
- This removes one complete traversal of the native interpreter AST. Two cold
  builds measured about 4.40 and 4.46 seconds, down from 4.66--4.68 seconds at
  the preceding checkpoint and roughly 4.95 seconds before the parser work.
  The lowering-side local collection phase fell from 248--255 ms to 11 ms.

## 0.44

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Enabled the parser's compact literal representation for kernel AOT and made
  both kernel lowering paths consume primitive integer literals directly.
  Constant discovery preserves signed-int32 validation, including unary
  negative constants, and now distinguishes an initializer or return value of
  zero from the parser's absent-expression `null` sentinel.
- Two measured cold native-interpreter builds took about 4.66 and 4.68 seconds,
  down from roughly 4.70 seconds after the preceding metadata reduction.
  Kernel constant/dependency collection fell from 280--285 ms to 248--255 ms.

## 0.43

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Made parser statement locations and copied function-source text explicitly
  optional, while preserving both by default for guest programs and their
  source-located errors. Kernel compilation disables this metadata because its
  validation and lowering stages do not consume it.
- This reduces both parser allocation and the object graph traversed during
  kernel constant/dependency collection. Two measured cold native-interpreter
  builds fell from about 4.95 seconds to 4.70 seconds; collection of kernel
  constants and dependencies fell from roughly 355 ms to 280--285 ms.

## 0.42

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Fixed the native `Array.join` allocator contract. Join now bounds its result
  against the representable guest string-record size and leaves physical
  placement to the general native allocator, which can move from an exhausted
  reclaimed arena to another region or to tail space.
- Previously, join compared the result with only the current arena's suffix
  and entered host semantics before the allocator had a chance to switch.
  Demo8's recurring free-driving `Array.join` fallbacks dropped from 163 to
  zero; three consecutive post-transition samples held 20.0 FPS at
  320x240/20 FPS. No demo source was changed.

## 0.41

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Removed the native `Math.min`/`Math.max` fallback for signed zero. The
  compiled guest implementation now applies the ES5 tie rule directly:
  `Math.min` prefers negative zero and `Math.max` prefers positive zero, while
  returning the selected authoritative guest value cell.
- This removed hundreds of recurring host transitions from demo8 free-driving
  frames. At 320x240 with the 20 FPS limit, the measured post-transition
  samples were 19.9, 19.9, and 19.6 FPS after the initial heap growth and
  collection interval. No demo source was changed.

## 0.40

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Moved the ordinary ES5 `parseInt` string/radix path into the compiled guest
  interpreter. It handles ES whitespace, signs, radix inference, hexadecimal
  prefixes, ASCII digits through base 36, NaN, negative zero, and the complete
  signed-int32 result range without returning to the host. Inputs requiring
  wider binary64 accumulation or object/string coercion retain the exact
  semantic fallback rather than using an approximation.
- Added the named kernel operation `setValueCellDoubleBits` for readable NaN
  and signed-zero construction. The compiler lowers it to authoritative guest
  heap stores; callers do not repeat value-cell offset arithmetic.
- Confirmed that `parseInt` disappeared from demo8's profiled fallback-call
  list. At 320x240 with the 20 FPS limit, free-driving samples after the mode
  transition were 17.8, 18.6, and 20.0 FPS while the heap grew and collected;
  the final interval met the 20 FPS limit. No demo source was changed.

## 0.39

Approximate completion: 2026-09-14 evening BST

### Guest VM

- Added a 256-entry direct-mapped cache for native constant-name reads of own
  properties on ordinary guest objects. Entries live in the engine-state heap
  record and are guarded by receiver/key identity, the receiver's structural
  version, GC generation mark, and current property-head address. Values still
  come from the authoritative property value cell on every hit.
- Made property deletion advance the authoritative object structural version,
  and clear the weak cache at collection before dead addresses can be reused.
  The cache therefore cannot keep an object or property alive and cannot
  confuse a recycled address with its previous record.
- Fixed graph-wide kernel constant overrides. `--vm-profile` once again counts
  native dispatch opcodes after the interpreter was split into compiled helper
  functions, rather than reporting only semantic exits.
- A comparable profiled demo8 run improved from roughly 14.7 million to about
  15.3 million bytecodes per native-execution second. Sustained free-driving
  samples at 320x240/20 FPS held between 19.6 and 20.0 FPS after the mode-switch
  interval. No demo source was changed.

## 0.38

Approximate completion: 2026-09-14 afternoon BST

### Guest VM

- Removed redundant host-memory reads from post-mark weak-handle, program,
  environment, and string-cache filtering. A named collector-mark accessor
  now answers liveness directly; free records have mark zero and therefore
  cannot be mistaken for members of the current generation.
- Made the native free-block indexing pass report total reusable bytes during
  its existing record walk. Collection no longer performs a second complete
  host-side walk merely to calculate live occupancy.
- Restricted the expensive native-frame and heap-graph validation walks to the
  explicit `--vm-verify-heap` diagnostic mode. Normal execution still uses the
  same native tracing and sweep algorithms; only the redundant validation pass
  is omitted.
- On the development machine, demo8's first 50 MiB collection at 320x240 fell
  from approximately 239 ms to 71 ms (native mark 11 ms, native sweep 7 ms).
  After the free-driving mode-switch interval, five-second samples recovered
  to 18.9, 19.9, 20.0, 20.1, and 20.0 FPS; later collection-affected samples
  were 19.6, 19.8, and 18.6 FPS. No demo source was changed.

## 0.37

Approximate completion: 2026-09-14 afternoon BST

### Guest VM

- Added a general i386 indexed-address lowering for guest-heap reads. Named
  accessor expressions such as `heapBase + record + FIELD` now fold into one
  machine load without exposing layout offsets at call sites.
- The native interpreter's first 26 million demo8 bytecodes improved from
  approximately 1.75 seconds to 1.65 seconds. A 320x240 attract-mode sample
  with the 20 FPS limit ranged from 16.5 to 20.0 FPS and averaged about 18.2
  FPS, compared with about 18.8 FPS for direct `js_min.exe` in the same scene.
- Rejected two measured alternatives: indirect jump-table dispatch was about
  15 percent slower than balanced branch dispatch on this i386 host, and
  indexed stores/numeric x87 loads also regressed throughput. They are not
  retained in the implementation.

## 0.36

Approximate completion: 2026-09-14 afternoon BST

### Guest VM

- Moved reclaimed-region selection and switching into the compiled guest
  interpreter. All native allocation sites now reserve their complete record
  group through the same kernel allocator instead of yielding for each arena.
- Preserved undersized fragments on a named retired-region list and ordered
  available regions largest-first, removing lost free space and quadratic
  rescanning under renderer allocation churn.
- Kept native and semantic-fallback allocation ranges disjoint while allowing
  non-collecting fallbacks to run without rebuilding the entire host free-block
  index. At 320x240 with the 20 FPS limit, the post-fix attract-mode sample
  ranged from 14.8 to 19.8 FPS and no longer collapsed to 1--7 FPS after the
  first collection.
- Corrected the native engine-state opcode counter extent so opcodes 48--60
  cannot overwrite allocator state, and added named accessors for every new
  allocator field.

## 0.35

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Fixed reverse being unintentionally limited to roughly 2 mph after the spin
  protection in release 0.33. Crossing the 0.8 m/s qualification threshold had
  immediately cleared the reverse timer, so each held input delivered only one
  short pulse of reverse torque.
- Added an explicit reverse-gear state. Total world speed below 0.8 m/s for
  0.35 seconds qualifies the initial shift, after which reverse remains engaged
  while Down or S is held. Releasing the input or detecting renewed forward
  motion disengages it. A fast sideways-moving spin therefore still cannot
  select reverse accidentally.
- An eight-second reverse hold from rest reached 20.7 mph under `js_min.exe` at
  320x240. A forward-to-brake-to-reverse test reached 20.0 mph in reverse, and
  an overlapping accelerate/hard-turn/brake stress run completed without a
  crash or an unintended mid-spin reverse selection.

## 0.34

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Fixed a numerical-energy regression in the 0.33 tyre retune. With throttle
  released, sustained steering could increase actual world speed from about
  9.8 m/s to 16.5 m/s because the explicit lateral-force step overshot the
  desired slip correction. Engine, brakes, and rolling resistance now establish
  a per-step kinetic-energy ceiling: lateral tyre forces can redirect velocity
  or dissipate it through scrub, but cannot accelerate the car.
- Changed the free-drive MPH display from the car-body longitudinal component
  to the magnitude of world-space velocity. The speedometer now reports actual
  ground speed consistently while the body yaws during a slide.
- Increased baseline rolling resistance from 0.12 to 0.30 m/s^2 and slightly
  reduced its speed-squared term. Coasting speed now falls visibly instead of
  leaving the integer MPH display apparently stuck for several seconds, while
  retaining a progressive automatic power curve and high-speed resistance.
- Under `js_min.exe` at 320x240, repeated throttle-release/steering samples
  decreased monotonically from 9.62 to 8.34 m/s rather than gaining speed. A
  separate accelerate/hard-turn/brake run continued to initiate powerslides,
  reached rest normally, and did not reproduce the earlier spin crash.

## 0.33

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Fixed the crash exposed by accelerating, steering hard, and then braking
  into a spin. Reverse engagement now requires the car's complete world-space
  speed to remain below 0.8 m/s; a spinning car whose body-forward velocity
  merely crosses zero is no longer mistaken for a stopped car. The reverse
  torque calculation also uses a bounded, correctly named speed ratio.
- Made the mud less excessively slippery without replacing the two-axle tyre
  model: increased baseline and minimum rear grip, reduced the amount of rear
  traction consumed by engine power, increased lateral tyre response, and
  reduced maximum yaw rate. Ordinary powered cornering is consequently more
  planted, while a hard turn and brake-induced weight transfer can still
  initiate a controllable rear-wheel-drive slide.
- Raised the measured-slip thresholds for the `POWER SLIDE` indicator while
  retaining its 0.32-second exit hysteresis. This prevents modest cornering
  motion from being labelled as a sustained powerslide.
- Re-ran the reported accelerate/hard-turn/brake sequence at 320x240 under
  `js_min.exe`, including repeated slide entry and recovery. The frame loop
  continued without an exception. Reverse engagement from a genuine stop and
  the automatic free-drive controller were also exercised.

## 0.32

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Standardized vehicle motion on metres and seconds and changed every speed
  readout to an explicit miles-per-hour conversion (`m/s * 2.23693629`). The
  previous arbitrary display multiplier is gone.
- Retuned the automatic torque curve for approximately 7-8 seconds to 60 mph
  on loose mud and an attainable top end around 105-107 mph. Added explicit
  rolling/aerodynamic resistance, approximately 14 mph/s forward braking on
  mud, a brake-first 0.35-second transition into reverse, and an approximately
  25 mph reverse limit. Rally-mode player and competitor speeds now use the
  same physical unit convention.
- Reduced baseline mud grip and made rear-wheel-drive power consume rear
  lateral traction during a powered turn. A throttle-and-steering input can
  now start controllable power oversteer; a short brake tap produces extra
  forward load transfer and a stronger breakaway. Added timed exit hysteresis
  so the easier `POWER SLIDE` state does not chatter around its threshold.
- Brighten both rear lamp lenses whenever Down, S, or Space requests braking,
  including the brake-first pause before reverse and automatic-driver braking.
- Added two persistent world-space skid trails from the actual rear contact
  patches. Slip and heavy forward braking determine mark strength. A fixed
  36-pair circular history overwrites the oldest marks, while view/distance
  rejection prevents a long session from accumulating rendering cost.
- Enlarged the free-drive field from 200x160 to 200x200 units, providing more
  braking and sliding room around the existing painted course. Representative
  320x240 auto-drive measurements with a 30 FPS ceiling remain approximately
  20.7-22.3 FPS after the 36-pair skid-mark history has filled.

## 0.31

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Fixed visible garage-ground judder during the automatic camera orbit. The
  procedural checker source now represents each two-world-unit cell with a
  32x32 block inside a repeating 64x64 texture, rather than using one texture
  coordinate unit for an entire cell.
- Increased the perspective texture-gradient fixed-point scale from 32768 to
  262144. Checker boundaries consequently retain sub-cell precision as the
  camera moves, while nearest-neighbour sampling preserves hard bitmap edges.
  The same precision improvement applies to reflected window textures and
  remains within signed 32-bit range at the near plane.
- Representative 320x240 garage-orbit measurements with a 30 FPS ceiling
  remain approximately 21.6-22.3 FPS after the precision increase.

## 0.30

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Replaced the garage's individually submitted checker cells with one
  perspective-correct textured floor. A deterministic 2x2 nearest-neighbour
  checker texture is generated in JavaScript during initialization and wraps
  over the complete service bay; no bitmap asset is stored in the repository.
- Added UV-preserving near-plane clipping for textured world quads and
  generalized the NativeCompiler-generated reflected-window texture triangle
  routine to accept independent texture dimensions and wrap modes. The floor
  uses the normal reciprocal-depth buffer and does not overlap a second plane,
  eliminating the garage floor's depth flicker.
- Added mathematically exact opaque-face rejection for the detailed body,
  wheel tread/side faces, reflected windows, arch liners, and local boxes.
  Precomputed static garage/free-drive geometry and reusable world/UV scratch
  storage reduce interpreted allocation and transformation work without
  omitting model components.
- With a 30 FPS measurement ceiling under `js_min.exe`, representative
  320x240 runs sustain approximately 21-22.5 FPS in the automatic garage
  orbit and approximately 22-24.8 FPS while auto-driving around the free-drive
  course. Both therefore have rendering headroom for the 20 FPS target.

## 0.29

Approximate completion: 2026-08-23 late evening BST

### Demo 8

- Added `A  AUTO DRIVE` to the pause menu. It resets into free-driving mode and
  follows the painted field course using virtual steering, throttle, and brake
  inputs supplied to the same rear-wheel-drive physics used by the player.
- Auto drive selects a speed from upcoming course curvature and uses a
  speed-dependent look-ahead point. It does not move the car kinematically or
  bypass tyre slip, body roll, powerslide, camera, or perimeter collision.
- Added an `AUTO DRIVE` HUD label and stdout mode report so automated and human
  free-driving sessions are unambiguous.

## 0.28

Approximate completion: 2026-08-23 23:30 BST

### Demo 8 runner and NativeCompiler

- Added recursively compiled native function dependencies through explicit
  `function.nativeCompile.dependencies` name-to-function maps. Dependencies may
  declare further dependencies; the compiler handles nested, self-recursive,
  and mutually recursive graphs without returning through interpreted
  JavaScript at call boundaries.
- Added native `return` statements, internal stack arguments, left-to-right
  argument evaluation, relative native call fixups, and support for helpers
  with more than eight arguments. The external root retains its existing
  eight-argument FFI/specialization contract.
- Emit each specialized graph into one owned executable mapping. Destroying the
  compiled root releases every dependency together; macro-assembly dumps now
  show function labels and native calls, and each variant records its emitted
  function count.
- Added `native_compiler_dependencies_test.js`, compatible with Node.js and
  `js_min.exe`. The native run validates seven recursively collected functions,
  nested calls, mutual recursion, nine internal arguments, return values,
  evaluation order, destruction, and declaration errors. Existing Demo 8
  single-function rasterizers continue to initialize and pass their comparison
  test unchanged.

## 0.27

Approximate completion: 2026-08-23 23:00 BST

### Demo 8

- Removed the 0.24 car-local quadrant culling in full. The complete body shell,
  both sides and ends, all window panes and trim, front and rear details, and
  all four complete wheels are submitted at every camera angle. The depth
  buffer is again the sole visibility authority for the detailed saloon.
- Identified the underlying scratch-mesh regression: `project()` caches its
  result on a world-point object for the current frame. Reusing a mutable point
  without invalidation made later wheels reuse the back-left wheel's projected
  coordinates, explaining why only that tread remained visible.
- Added explicit projection-cache invalidation to every mutable car and wheel
  point transformation. Quad, box, window, and wheel scratch objects can now be
  reused without changing geometry or screen coordinates.
- Retained only topology-preserving wheel work: precomputed circle values,
  shared segment endpoints, 29 rather than 50 point transforms per wheel, and
  allocation-free scratch rings. At 320x240 with a 20 FPS limit, representative
  measurements reached about 15.5 FPS in free drive and 14.0-14.3 FPS in the
  garage with the complete model restored.

## 0.26

Approximate completion: 2026-08-23 22:30 BST

### Demo 8

- Restored all four complete wheel assemblies at every camera angle. Each now
  always submits its full double-sided tread ring, outside sidewall, and hub;
  the depth buffer handles occlusion by the carved body shell.
- Removed the remaining far-diagonal wheel and far-side disc culls because
  open arches, narrow tyres, and steering made them visibly discontinuous at
  oblique views. Retained precomputed circle values, shared ring vertices,
  scratch-object reuse, and the reduction from 50 to 29 point transforms per
  wheel.

## 0.25

Approximate completion: 2026-08-23 22:15 BST

### Demo 8

- Restored the complete double-sided tyre tread rings. The 0.24 generic
  back-face test could reject visible tread because wheel-side orientation and
  front-wheel steering change a tread quad's apparent winding.
- Retained the safe wheel optimizations: precomputed circle values, shared
  segment vertices, reusable scratch rings, reduced point transformations, and
  rejection of only the far-diagonal wheel.

## 0.24

Approximate completion: 2026-08-23 22:00 BST

### Demo 8

- Added object-space visibility selection to the detailed saloon. The renderer
  no longer submits its permanently hidden floor, far body side, far end,
  opposite glass, trim, lamps, or bumper to projection, clipping, and the
  z-buffer. Box details similarly submit only their top, near side, and near
  end faces; the visible model and texture resolution are unchanged.
- Corrected an initially over-aggressive two-wheel view-dot cull. Open wheel
  arches expose a third wheel at oblique angles, so the final rule rejects only
  the far diagonal wheel. Near-side sidewalls and hubs remain detailed, while
  the far-side exposed wheel submits its visible tread without a hidden outward
  face.
- Precomputed the eight-segment wheel circle, reused adjacent ring vertices,
  enabled back-face rejection on the opaque tread, and changed the wheel mesh
  to reuse preallocated scratch points. Each visible wheel now needs 29 rather
  than 50 local-to-world point transformations and creates no ring arrays or
  point objects during a frame.
- At 320x240 with a 20 FPS limit under `js_min.exe`, representative free-drive
  samples improved from about 14.1-14.4 FPS to 19.3-19.4 FPS, with individual
  intervals and the on-screen counter reaching the 20 FPS cap. Representative
  garage views improved from about 13.3-13.6 FPS to approximately 18 FPS. A
  runtime compiled-native -> JavaScript -> hand-ASM -> compiled-native cycle
  completed successfully after the changes.

## 0.23

Approximate completion: 2026-08-23 21:30 BST

### Demo 8

- Replaced coarse flat-color window subdivision with proper per-pixel texture
  mapping on all six panes of the detailed saloon in garage and free-drive
  modes. Each pane is two textured triangles sharing the normal depth buffer.
- Derived sky coordinates at the transformed window vertices from camera view
  vectors and reflected pane normals. The rasterizer perspective-corrects them
  by interpolating `u/z`, `v/z`, and `1/z`, then performs explicitly
  nearest-neighbour sampling from the wrapping procedural sky texture.
- Compiled the hot `windowTextureTriangleJS` bounding-box/edge/depth/texture
  loop through NativeCompiler. There is no hand-generated machine code. The
  complete car uses 12 textured window triangles instead of the discarded
  36-quad approximation.
- Changed the deterministic cloud synthesis to four anisotropy-compensated
  octaves with square high-frequency billows. The visible sky now forms compact
  mottled cloud banks rather than horizontal wisps, and the 512x64 texture has
  enough local detail to produce dense window reflections.
- At 320x240, the final build measured about 14.1-14.4 FPS in free drive and
  13.3-13.6 FPS through representative garage views. Procedural texture
  generation measured about 1.9-2.0 seconds and total initialization about
  3.4-3.7 seconds under `js_min.exe`.

## 0.22

Approximate completion: 2026-08-23 20:50 BST

### Demo 8

- Added a deterministic procedurally generated cloudy grey skybox texture to
  free-drive mode. Three wrapping value-noise octaves create layered slate,
  silver, and blue-grey clouds in a 512x64 in-memory panorama; no bitmap asset
  is stored or loaded.
- Mapped camera heading and horizontal field of view into the wrapping texture,
  with the vertical texture scaled to the pitched ground-plane horizon.
- Replaced an initial 2048x128 interpreted generation and per-row FFI design
  with the compact texture and a one-call nearest-neighbour blitter compiled
  from `freeDriveSkyboxBlitJS` by the existing NativeCompiler. At 320x240,
  texture generation fell from about 10.9 seconds to about 1.4 seconds and total
  initialization measured about 2.9-3.0 seconds.
- An A/B run at 320x240 found approximately 14.4-15.1 FPS with the sky enabled
  and 14.8-15.0 FPS with its draw call disabled. The sky pass therefore had no
  measurable effect on the existing free-drive rendering ceiling.

## 0.21

Approximate completion: 2026-08-23 20:25 BST

### Demo 8

- Added suspension-style body roll to the detailed saloon in free-drive mode.
  The roll target comes from the tyre model's actual lateral acceleration, so
  it depends on speed, grip, and sliding rather than steering input alone.
- Added a damped roll spring with a roughly +/-6.9-degree normal target and
  +/-8-degree safety limit. The sprung shell, glass, trim, lights, and bumpers
  tilt around a low longitudinal axis while the wheels remain upright.
- Converted every box-shaped detail on the saloon to the same rolled local-body
  transform, preventing the bonnet, boot, roof, lamps, or bumpers from becoming
  detached while the body leans.

## 0.20

Approximate completion: 2026-08-23 20:05 BST

### Demo 8

- Replaced the detailed saloon's solid lower body box with a body shell whose
  side-panel triangles are built around four real semicircular wheel openings.
  No body triangles are emitted inside those openings.
- Removed the external wheel-arch lips introduced in 0.19 and added recessed
  dark inner liners connected directly to the cut edges of the body shell.
- Returned all four thin 0.11-unit tyres to equal +/-0.80 wheel centres. The
  tyres are tucked nearly flush with the body again while the carved openings
  provide clearance for visible front steering. The 0.33-unit arch radius sits
  around the 0.32-unit tyre radius and meets the top of the lower shell without
  inverted or overlapping side-panel strips.

## 0.19

Approximate completion: 2026-08-23 19:45 BST

### Demo 8

- Corrected the equal-track wheel adjustment so it does not embed the detailed
  saloon's tyres in its solid body shell. Both axles now use wheel centres at
  +/-0.91: the front returns to its original clearance and the rear moves out to
  match it.
- Retained the thin 0.11-unit tread, visible front steering, and equal front and
  rear protrusion.
- Added body-coloured upper wheel-arch lips which visibly overlap the tyre edges,
  preventing the tyres from appearing to cut through the box-shaped side panels.

## 0.18

Approximate completion: 2026-08-23 19:28 BST

### Demo 8

- Moved the detailed saloon's front wheel centres inboard from +/-0.91 to
  +/-0.80, matching the rear axle. All four straight-ahead 0.11-unit tyres now
  have outer faces at approximately +/-0.855 and sit nearly flush with the body;
  the front wheels no longer protrude farther than the rear wheels.
- Retained visible front steering through the existing wheel-yaw geometry and
  travel-facing camera: during a turn, body yaw exposes the steered tyres without
  requiring an artificially wider front track.

## 0.17

Approximate completion: 2026-08-23 19:25 BST

### Demo 8

- Halved the detailed saloon tyre tread again, from 0.22 to 0.11 total
  simulation units. The tyres are now approximately 69 percent narrower than
  their original 0.36-unit form while retaining the 0.64-unit diameter.
- Moved the rear wheel centres slightly inboard from +/-0.83 to +/-0.80 so their
  outer faces sit nearly flush with the body. Retained the established +/-0.91
  front centres so the much thinner front tyres remain visible when steering,
  without restoring their former toy-like width.

## 0.16

Approximate completion: 2026-08-23 19:11 BST

### Demo 8

- Made the source-compiled native i386 triangle-half rasterizer the default at
  startup. F2 still retains all three implementations and now cycles from the
  default through JavaScript reference, hand-written ASM, and back to compiled
  native for direct correctness and performance comparisons.
- Reduced the detailed saloon tyre tread from 0.36 to 0.22 total simulation
  units, approximately 39 percent. Kept the 0.64-unit diameter, hubs, axle
  positions, and independently steerable front-wheel geometry unchanged.

## 0.15

Approximate completion: 2026-08-23 19:03 BST

### Demo 8

- Replaced the brake-held powerslide switch with a two-axle vehicle model.
  Front and rear slip velocities now generate independent lateral tyre forces
  and yaw torque, and `POWER SLIDE` is derived from measured lateral motion and
  yaw rather than control state.
- Made the rally saloon rear-wheel drive. Braking at forward speed transfers
  load away from the rear axle for a short-lived grip loss; after brake release,
  rear drive consumes part of the slipping tyres' traction budget so reapplied
  throttle can sustain the slide. Lifting power restores rear grip, while front
  tyre force makes countersteering arrest the yaw.
- Added hysteresis to physical slide detection, retained ordinary powered
  cornering and reverse steering, and preserved stationary and perimeter
  behavior. A high-speed full-throttle turn can also induce power oversteer
  without braking, as expected for rear-wheel drive.
- Expanded the checkerboard from 160-by-128 to 200-by-160 units to provide
  useful runoff for slide testing. Changed its squares from 16 to 20 units,
  keeping visible geometry cost bounded through the existing frustum rejection.

## 0.14

Approximate completion: 2026-08-23 18:45 BST

### Demo 8

- Replaced the free-driving outer-boundary centre-point clamp with collision
  limits derived from the saloon's rotated width and length. The complete body,
  wheels, and bumpers now remain inside every side and corner of the field.
- Removed outward velocity on perimeter contact while retaining the tangential
  component. Sustained throttle into an edge stops the car without repeatedly
  bouncing it across the boundary; glancing motion can continue along the edge,
  and reversing pulls the car back into the field normally.
- Kept the internal painted test-course lines non-colliding. Only the visible
  outer perimeter bounds free driving.

## 0.13

Approximate completion: 2026-08-23 18:39 BST

### Demo 8

- Expanded the free-driving field from 90-by-68 to 160-by-128 simulation units
  and replaced its subtle four-shade surface with a clearly alternating
  dark/light brown checkerboard of 16-unit squares.
- Painted two pale course-edge lines and a start/finish stripe directly onto
  the field, using a coarse version of the reproducible rally-course outline.
  The paint changes neither collision nor tyre grip, so the car can cross it or
  ignore it and continue free driving anywhere inside the outer field boundary.
- Moved the free-drive reset position to the painted start line and aligned the
  car with the course tangent. Added camera-frustum rejection for checker tiles
  and paint sections so the larger presentation remains near the 20 FPS target
  under `js_min.exe` at 320x240.

## 0.12

Approximate completion: 2026-08-23 18:13 BST

### Demo 8

- Fixed reverse drive repeatedly alternating between reverse acceleration and
  braking once it passed walking pace. Holding Down, S, or Space at low speed
  now supplies continuous reverse torque up to a 14-unit reverse-speed limit,
  doubled from 7, with stronger initial acceleration.
- Increased reverse steering authority by 50 percent while keeping yaw
  proportional to actual longitudinal motion. The car still cannot rotate in
  place, but it now develops a useful reverse turning arc promptly.
- Restricted brake-assisted rear-grip release to forward motion. Reverse and
  brake share an input, so this prevents ordinary reversing with steering from
  being misclassified as a powerslide; forward powerslides continue to work.

## 0.11

Approximate completion: 2026-08-23 18:03 BST

### Demo 8

- Replaced free drive's scalar movement with longitudinal and lateral velocity,
  tyre grip, inertial yaw rate, and velocity-aware boundary impacts. Turning
  the front wheels while stationary no longer rotates the body; vehicle yaw now
  requires actual forward or reverse motion.
- Added controllable powerslides. Brake with Space, Down, or S while steering
  above a modest road speed to release rear lateral grip; momentum continues
  along the previous trajectory while the body rotates, and grip progressively
  returns when the brake or steering is released.
- Made the travel-facing camera follow the real velocity vector, added a
  `POWER SLIDE` HUD indicator, and added slide start/end messages when debug
  event logging is enabled.

## 0.10

Approximate completion: 2026-08-23 17:51 BST

### Demo 8

- Decoupled the muddy-field camera heading from the saloon's body heading. The
  camera now follows a smoothed recent direction of travel, so steering visibly
  yaws the car relative to the view instead of rotating car and camera as one
  rigid unit.
- Made camera-heading convergence depend on wall-clock elapsed time, preserving
  the same turn-following behaviour at different requested and achieved frame
  rates. At rest the camera retains the last direction in which the car moved.

## 0.9

Approximate completion: 2026-08-23 17:42 BST

### Demo 8

- Fixed front-wheel steering in free drive. The visual steering-state update
  had accidentally been placed in rally physics, so free drive left the
  detailed model's wheel angle at zero even while the car itself turned.
- Moved the update into the free-drive physics step, increased visible steering
  lock to approximately +/-35.5 degrees, and moved the front tyres slightly
  farther outboard so their yaw is readable from the chase camera.
- Verified distinct held-left, centred, and held-right wheel geometry, smooth
  return to centre, and matching vehicle/wheel turn direction.

## 0.8

Approximate completion: 2026-08-23 17:37 BST

### Demo 8

- Reused the detailed 1970s two-door saloon model for the player's car in
  free-driving mode. Rally mode retains its lightweight player and AI models.
- Made the two front wheels yaw with free-drive left/right input while the rear
  wheels remain aligned with the body. Steering eases toward approximately
  +/-27.5 degrees and returns smoothly to centre when input is released.
- Rotated each front tyre's tread, sidewall, and hub geometry around the wheel's
  own vertical centre, so steering does not move the axle attachment points.

## 0.7

Approximate completion: 2026-08-23 17:33 BST

### Demo 8

- Corrected the garage saloon's side windows, which previously kept the wider
  sill width all the way to the roof and appeared to splay outward.
- Moved the upper side-glass edges and upper A/B/C-pillar vertices inward to
  meet the narrower roof and front/rear window surrounds. The lower sills stay
  at body width, producing the intended inward cabin taper on both sides.

## 0.6

Approximate completion: 2026-08-23 17:27 BST

### Demo 8

- Replaced the garage's lightweight rally-car representation with a detailed,
  boxy 1970s two-door rally saloon sized for four occupants, while leaving the
  performance-sensitive race and AI car path unchanged.
- Added four octagonal tyres with contrasting metal hubs, separate unlit front
  and rear lamp units, sloped windscreen and rear glass, divided side windows,
  painted external window surrounds and A/B/C pillars, and a highlighted
  painted-metal roof skin.
- Added a long wheelbase and cabin, distinct bonnet and boot, one outlined long
  door and handle per side, fixed rear quarter windows, a rectangular grille,
  and bright period-style bumpers. No rear-door seams or handles are present.

## 0.5

Approximate completion: 2026-08-23 17:14 BST

### Demo 8

- Changed `R RESTART GAME` to reset the race and return to rolling attract
  mode with `PUSH SPACE TO PLAY`. Space then starts a freshly reset
  human-controlled race.
- Defined Escape followed by Escape as pause/resume: the first press opens the
  menu and freezes the current mode; the second closes it and resumes without
  resetting player, AI, race, garage, or free-drive state.

## 0.4

Approximate completion: 2026-08-23 17:10 BST

### Demo 8

- Added the explicit `R RESTART GAME` label to the full pause menu and updated
  its help text and documentation.

## 0.3

Approximate completion: 2026-08-23 17:03 BST

### Demo 8

- Made the built-in 5x7 bitmap font scale proportionally with the viewport.
  The 320x240 presentation remains the 2x baseline, smaller displays use the
  1x source glyph, and larger displays select a correspondingly larger
  integral scale.
- Applied the same scaled glyph, character-advance, and line metrics to the
  HUD, loading screen, garage label, FPS counter, and menu layout.

## 0.2

Approximate completion: 2026-08-23 16:59 BST

### Demo 8

- Added a dedicated compact menu layout for demo8's supported 64-pixel minimum
  framebuffer width.

## 0.1

Approximate completion: 2026-08-23 16:58 BST

### Demo 8

- Added an Escape pause menu with resume, race restart, garage, free-drive,
  and quit actions.
- Added a garage scene rendered through demo8's software rasterizer. Its camera
  follows an elliptical automatic orbit with sinusoidal vertical motion.
  Holding mouse button 1 and dragging controls orbit angle and camera height;
  automatic motion resumes after release.
- Added free driving on a fixed 90-by-68-unit muddy field with deterministic
  surface variation, puddles, boundary posts, automatic-style vehicle physics,
  and collision handling at the field boundary.
- Extended the JavaScript-only X11 test driver with named key sequences,
  button-1 drags, and timed key holds. These controls work under both Node.js
  and `js_min.exe` through `node_runner.js`.
