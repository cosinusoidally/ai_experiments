# Shell source actions and the mishmashvm SDL demo

## Unified standalone environment

Standalone images now expose both Node-compatible globals (`process`,
`require`) and shell APIs (`ctypes`, `scriptArgs`, `printErr`, `read`, `load`,
`print`, `quit`). `--shell` is accepted as a legacy build no-op, not a separate
image policy. `read(path, "binary")` consistently returns a Uint8Array;
Node-style consumers obtain Buffer through `require("fs").readFileSync`.
Application scripts and loaded scripts retain source locations independently
of the compatibility flag. Process exposes synchronous stdout/stderr writes
and the shared event-emitter registration/dispatch operations.

The dated shell-policy acceptance notes below describe historical builds;
they do not imply two current standalone configurations.

## Command-line contract

All implementation code is ES3-compatible. No Node addons, npm, downloads,
new C helpers or application-source modifications are involved.

```sh
node guest_runner.js -e 'print(40 + 2)'
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native -e 'print(40 + 2)'
artifacts/js -e 'print(40 + 2)'
```

- `-e SOURCE` compiles and executes a script named `-e`, without an implicit
  print of its result. Empty source is valid; missing source is an error.
- Repeated `-e` actions execute in order and share their global bindings.
  Each action is parsed as a separate script, not concatenated source.
- `-f FILE` adds a file action without ending option parsing.
- A positional filename adds the final file action; remaining operands are
  its script arguments, not VM options. `--` permits a dash-prefixed filename.
- Shell-policy images expose those arguments as `scriptArgs`; the existing
  guest `arguments` compatibility global is retained. With no positional
  file there are no trailing script arguments. `--no-ion` remains a no-op.
- Inline source uses the same compiler, guest context, FFI and event-loop
  machinery as a file. There is no host eval or alternative interpreter.
- Generic standalone executables and snapshots accept
  `--vm-max-heap-mib 64..1024` before a positional program. This selects the
  live heap reservation/allocator maximum before allocation, without rebuilding
  or mutating the image. `-e`/`-f` operands and script arguments are not scanned
  as VM options. See [runtime memory reduction](MEMORY_REDUCTION.md) for the
  distinction between the maximum, reserved address space and resident memory.
- Missing source, syntax errors and unhandled JS exceptions report through
  libc stderr with a nonzero exit; they do not require console initialization
  or get rethrown as misleading unsupported-opcode exits. Actual unsupported
  native VM operations retain their kernel diagnostics.

`shell_command_line.js` is the shared pure parser. Its `parse(args)` result
contains `actions`, `programName` and `scriptArguments`. An action has a
`filename` and, for inline code, a `source` string. No file is opened and no
code is executed by this parser. Host runners filter their VM-build options
before invoking it. Standalone execution uses the same parser after decoding
live argv. Script bytes and arguments are not installed into the VM before
the generic snapshot boundary.

## Bring-up method and result

1. Confirm repeated inline actions and file/argument ordering against the
   existing local jsshell.
2. Execute unchanged `load("mishmashvm.js");test(0)` in the original mishmashvm
   directory, then continue to `test(1)`.
3. Implement missing general runtime behavior, not a rewritten demo or shim
   that substitutes a different typed-array conversion.
4. Verify a 640x360 SDL window, changing framebuffer contents, key events and
   normal window-close handling. Keep captures/logs in ignored artifacts.

Both tests now run. Test 0 compiles, links and calls the C snippets, including
its setjmp example. Test 1 displays animated coloured static in its SDL window.
Two captures differ; injected key events are reported. Closing through
WM_DELETE_WINDOW completed with process exit 0. Mishmashvm sources are unchanged.

The existing 32-bit SDL 1.2 library, configured mishmashvm temp directory and
bootstrapped TCC objects are required. From the sibling mishmashvm directory:

```sh
export PATH="$(cd ../ai_experiments/mmvm_v2_tests/artifacts && pwd):$PATH"
js -e 'load("mishmashvm.js");test(0)'
js -e 'load("mishmashvm.js");test(1)'
```

## Runtime changes

Uint8ClampedArray is a distinct heap-backed view kind, not an alias for
Uint8Array. Construction, indexed writes, subarrays and set use the ordinary
backing/view machinery. Conversion saturates to [0,255], maps NaN to zero,
and rounds halves to even. Native code decodes the bounded double payload
directly; the portable path implements the same conversion. Overlapping
signed-byte set copies preserve the original bytes before saturation.
This does not claim every cross-element-kind copying case or modern
typed-array API is implemented; existing standalone conversion limits remain.

The constructor has its own intrinsic ID and prototype-support slot, rather
than colliding with the older contiguous typed-array constructor IDs. Native
contract 107 includes this support and the engine's PRNG field. Rebuild old
images to use the new globals and command-line parser.

The demo exposed the old Math.random instruction-count mapping as visible
bands. Native random generation now advances guest-engine xorshift32 state,
seeded lazily from the existing direct-FFI clock, with a nonzero fallback.
It returns 30-bit fractions in [0,1), is not cryptographic, does not use
threads and does not depend on instruction-budget boundaries. Clock seeding
does not happen when constructing the generic snapshot.

`tools/x11_send_keys.js WINDOW_ID --close` sends WM_DELETE_WINDOW using its
own X11 wire bindings; it does not kill the client. Like its key mode, it can
run with Node built-ins or under js_min through `node_runner.js`.

## Validation checkpoint, 2026-11-14

- Inline execution checked on Node-hosted guest_runner, js_min-hosted
  guest_runner and the packaged executable. Repeated actions share globals;
  mixed file actions, positional arguments, `--`, empty source, missing source,
  syntax errors and quit-status propagation were exercised. A dash-prefixed
  filename is not mistaken for a self-hosted snapshot request.
- Node and js_min core suites pass 12 guest programs / **310 assertions**,
  including the new constructor/indexed/set clamping and overlapping-view
  coverage. Native shell/FFI integration also checks clamped-view pointer
  aliasing and saturation.
- Node-built, js_min-built (with an inline program after snapshot generation)
  and genuine self-hosted shell snapshots are byte-identical. Final SHA-256:
  `3cb65c661a2e53d500a744d4e82706f6c87fad2c7f9389f8d3368483a721ca6d`.
  The executable's source snapshot was moved aside for application runs.
- Full Test262 on the contract-107 interpreter: **3292 passed / zero failed /
  zero timed out / zero not run**, 368949.880 ms harness elapsed. This single
  observation is about 8.3% slower than the preceding 340626.683-ms run; it is not
  a performance-neutral result or a freshly paired attribution experiment.
  The later diagnostic-only entrypoint follow-up was covered by focused CLI,
  app/GC and final snapshot-identity checks, not another full corpus sweep.
- Structural GC passed 27 audits / 113184 checked edges / 221 property-index
  audits, maximum observed guest bump 3532584 bytes under an 8 MiB cap.
- All eight bounded demos, three HTTP servers and seven supplementary
  standalone checks pass under the final default executable with its source
  snapshot absent. These are not long-duration endurance tests.
- Full unchanged mishmashvm bootstrap passed in 245.15 seconds, peak RSS
  553984 KiB. All eight objects match the preserved pre-change objects
  byte-for-byte and have the recorded jsshell SHA-256 values. This was before
  the diagnostic-only entrypoint follow-up. Final test(0) also matches all
  nine reference C return values and exits zero (5.73 seconds / 110976 KiB).
- SDL acceptance includes captures of changing 640x360 RGB static, reported
  key events, and WM_DELETE_WINDOW exits zero. The close helper was exercised
  under both Node and js_min. No mishmashvm source changes were needed.
  The final published executable ran the unchanged demo for 106.76 seconds
  including startup, peak RSS 117468 KiB, then exited zero on normal close.

Logs, snapshots and captures are ignored under `artifacts/eval-*`. The existing
ECMA/Octane performance concerns in the [full earlier validation report](../../FULL_VALIDATION_2026-11-14.md)
remain outstanding; those long sweeps were not repeated for this CLI task.

## PortableGL Penguin test(16) follow-up

The unchanged game exposed three additional native-runtime gaps, not an SDL
or PortableGL failure:

- ADD did not perform guarded default object conversion while constructing
  disabled debug-log arguments. The shared object-operation kernel now handles
  default ordinary-object/view conversion through the actual class-string
  operation, alongside the existing array conversion.
- The game's undo buffer uses `snapshots[-1]`. Negative numeric property names
  now enter named-property lookup/write with standard numeric string conversion,
  rather than being rejected as dense-array offsets. Negative fractional keys
  work too; negative zero remains index zero. Accessors and named properties
  use the existing descriptor/prototype machinery.
- A later debug message concatenates the frame callback. Guarded default
  bytecode-function conversion now uses the function's actual retained source.

Conversion guards inspect the resolved valueOf/toString descriptors and do not
skip getters or overridden methods. This extends known built-in conversion
cases; it does not claim the standalone engine implements every custom
ToPrimitive continuation. No application-specific names, log suppression,
external-source edits, host-language callbacks or new C helpers are used.

The existing object-operation integration test covers object/function
concatenation and negative numeric names, including accessors and -0. Initial
game acceptance ran for 213.05 seconds, observed approximately 30--35 FPS,
rendered the board/penguin, accepted movement/undo/reset keys and exited zero
through WM_DELETE_WINDOW. Peak RSS was 703696 KiB; this is a whole-process
observation, not proof of a small or bounded game allocation footprint.
Regression validation on November 14, 2026:

- The unchanged triangle test(15) also renders correctly and closes normally:
  exit zero, 24.39 seconds including startup and inspection, 162752 KiB peak RSS.
- Both Node and js_min core suites pass 12 guest programs / 310 assertions,
  including the server/demo command-line and three-context checks. The existing
  object-operation integration test passes on Node and the standalone shell.
- Full Test262: 3292 executed / 3292 passed / zero failed, timed out, skipped or
  not run; 352.095 seconds harness elapsed, 334.841 seconds summed tests.
  The earlier interrupted attempt was rerun, not counted as a pass.
- Structural GC: 27 audits, 113184 checked edges, 221 property-index audits and
  74 embedding collections; maximum observed bump 3532584 bytes under an 8 MiB
  guest-heap cap.
- A genuine self-hosted shell snapshot rebuild is byte-identical to the
  Node-built shell snapshot. The rebuild compiles the current sources; it does
  not copy the input snapshot.
- With the default executable's source snapshot moved aside, all eight bounded
  demos, all three HTTP servers and all seven supplementary checks pass. The
  latter cover structural GC, raw FFI, self-hosted frontend/file compilation,
  native compiler dependencies, demo8 I/O and multiple contexts. These are
  bounded acceptance runs, not long-duration endurance tests.
- Paired single-run stock Octane scores, pre-fix control then fixed executable:
  Richards 95.8 / 93.3; Splay 727 / 746; Gameboy 881 / 844; CodeLoad 97.7 / 98.4.
  All pass. The mixed changes are approximately -4.2% to +2.6%; these observations
  do not establish a speed improvement or prove performance neutrality.

Temporary logs and captures use ignored `artifacts/penguin-*` paths. This
follow-up does not rerun the full ECMA corpus, all fifteen Octane benchmarks or
the entire mishmashvm bootstrap; the earlier recorded results remain distinct.
