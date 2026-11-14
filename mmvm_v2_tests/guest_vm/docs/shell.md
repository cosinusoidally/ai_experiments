# Shell source actions and the mishmashvm SDL demo

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
