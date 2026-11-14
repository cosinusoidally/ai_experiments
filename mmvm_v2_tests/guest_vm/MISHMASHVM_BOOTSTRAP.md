# Mishmashvm compiler bootstrap bring-up

Initial scope: run the unchanged `tcc_js_bootstrap/01_mk_tcc.js`,
`02_mk_libc_wrap.js`, and `03_mk_libc_stubs.js` with a freestanding guest VM
executable named `artifacts/js`. Stop before bringing up
`libc_portable_proto/bootstrap_tcc.sh`. No mishmashvm source changes, callbacks,
downloads, Node/native addon dependency, or C implementation changes.

Run both engines **in the original mishmashvm directory**, sequentially, with
clean output files. Preserve the jsshell reference objects outside that tree,
then compare the guest-produced objects by both SHA-256 and byte comparison.
Separate copied workspaces are not valid acceptance runs for this project.

## Full bootstrap extension

The scope was subsequently extended to the unchanged root `bootstrap.sh`,
including `libc_portable_proto/bootstrap_tcc.sh`: initial libtcc1 generation,
three native TCC/libtcc1 stages, two libc wrapper/stub stages and the existing
final hash verification. Keep the ctypes implementation callback-free.

Acceptance procedure: select local jsshell via PATH, run the full script in
the original tree, record and move all eight final `.o`/`.o.new` outputs into
ignored reference storage, then run the same script with `artifacts/js` first
in PATH. Compare every output by SHA-256 and direct byte comparison. Move the
packaged guest executable's source snapshot aside before running it. Do not
modify mishmashvm sources or rely on a copied workspace. Any fixes belong in
the general VM or shell/FFI layer, not benchmark-specific code.

## Implementation approach

1. Record a clean local jsshell `--no-ion` reference for all three stages.
2. Build a shell-policy image using `guest_runner.js --vm-native --shell
   --snapshot artifacts/mishmash-shell.snap`, then package it as `artifacts/js`.
   Default images retain their existing Node-compatible environment.
3. Accept `--no-ion` as a no-op, independently of shell policy. Shell images
   supply `load`, text/binary `read`, `print`, `printErr`, `scriptArgs`, `quit`
   and a JS ctypes polyfill over direct FFI. Do not expose Node environment
   detection globals to shell programs. User-relative loads resolve from cwd.
4. Follow the small scalar/pointer/library binding approach in mishmashvm's
   Duktape support. Do not implement JS-to-C callback trampolines. Buffer-view
   FFI marshalling must respect backing, byte offset and lifetime.
5. Reproduce and fix interpreter/frontend failures generally. Unsupported
   execution must identify the operation and source stack, rather than report
   only a numeric opcode. Keep compilation/heap use bounded and runs serial.
6. Require bit-identical outputs for all three stages, then run VM regression
   checks, document timings/results and commit working checkpoints.

## Local jsshell reference

The clean run in the original tree produced:

- `libc_portable_proto/tcc_bin/tcc_boot3.o`:
  `080182b567eabf208f60fcba6182d9c7a11c5f2421398dec530bc9dded852004`
- `libc_portable_proto/my_libc.o`:
  `0e8e02c852a11ebec585650d3c6fa5917fb51d7b66dd1d458d3e51680c660964`
- `libc_portable_proto/stubs.o`:
  `0cdb519efb42f22eba96bf90407e10b87868355e1d793d3a70271f09d47aa403`

## Verified checkpoint (2026-11-14)

All three stages complete in the original source tree. Each guest object has
the reference SHA-256 above and passes a direct byte comparison with the
preserved clean jsshell object. No mishmashvm source files were changed.
The final clean guest run used the packaged executable with its input snapshot
renamed out of the way. The executable does not need that snapshot file.

Whole-process measurements, including loading and compilation:

| Script | Local jsshell seconds | Guest executable seconds | Guest peak RSS (KiB) |
| --- | ---: | ---: | ---: |
| `01_mk_tcc.js` | 6.10 | 87.94 | 554472 |
| `02_mk_libc_wrap.js` | 1.13 | 46.73 | 546280 |
| `03_mk_libc_stubs.js` | 0.72 | 44.08 | 549616 |

These are correctness bring-up measurements, not performance parity. Expected
C compiler warnings occur with both engines. The later native bootstrap in
`libc_portable_proto/bootstrap_tcc.sh` has deliberately not been attempted.

Build from `mmvm_v2_tests` (Node is a build-host option, not an executable
runtime dependency):

```sh
node guest_runner.js --vm-native --shell --vm-max-heap-mib 1024 \
  --snapshot artifacts/mishmash-shell.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/mishmash-shell.snap artifacts/js
```

From the sibling `mishmashvm` directory, select the resulting shell and run
only these stages, in order:

```sh
export PATH="$(cd ../ai_experiments/mmvm_v2_tests/artifacts && pwd):$PATH"
cd tcc_js_bootstrap
js --no-ion 01_mk_tcc.js
js --no-ion 02_mk_libc_wrap.js
js --no-ion 03_mk_libc_stubs.js
```

Do not interpret this checkpoint as approval to run the entire `bootstrap.sh`:
that proceeds into the next, not-yet-validated phase.

The shell image uses the existing `--vm-max-heap-mib 1024` reservation option:
the Emscripten compiler requests a 128 MiB ArrayBuffer, and the current external
backing representation also reserves its logical span in the guest heap.
The initial 512 MiB image exhausted contiguous address space after source
compilation. This is a virtual reservation, not an eager 1 GiB physical fill.

General runtime changes so far include String.slice, byte-view set
interoperability, typed-view apply argument lists (for native and bytecode
functions), and preservation of the original call/apply operation when a fast
forwarding case declines. The shell/FFI integration checks native strings,
function-pointer casts, shared byte-view offsets and callback refusal.

Contract 106 adds a traced program debug reference and reserved word, growing
PROGRAM from 72 to 80 bytes including its header. Adopted programs retain a
compact filename/default-position/PC-line-column map; shell compilation
captures statement locations. Existing function source remains unchanged.
The common collector and portable record visitor trace this reference.
Unsupported standalone exits print a bounded native source backtrace through
an additional, explicitly exported kernel entrypoint. It uses libc scratch
allocation and does not re-enter failed guest code for formatting. No host
JavaScript callback or external debugger is required. Standard images keep
location capture disabled; they can still report filenames/default positions.

Generated snapshots, executables, logs and reference objects belong under
ignored `artifacts/`, not in commits.

The ctypes adapter is intentionally a subset: cdecl scalar/pointer declarations,
library lookup, native function-pointer casts and synchronous native calls with
up to eight arguments. Callback construction is rejected. It is not a complete
implementation of SpiderMonkey js-ctypes. Shell `read(path, "binary")` returns
a byte buffer; text reads decode UTF-8. `process` and `require` are not exposed
to shell programs, avoiding incorrect Node environment detection.

## Regression checks for this checkpoint

- Node and js_min core suites: each passed 12 guest programs and 270 guest
  assertions, plus the internal heap/compiler/interpreter checks.
- Default standalone image: all eight demo launch/render checks and the three
  HTTP server checks passed. Seven supplementary standalone checks passed,
  including structural GC, FFI, frontend compilation and context multiplexing.
- Standalone shell integration passed, including native pointer/view aliasing,
  callback refusal, typed-array apply and signed/unsigned byte copies.
- A default image rebuilt the VM from source under `js_runner`; the rebuilt
  snapshot was byte-identical to its Node-built input.
- Full Test262 under the default standalone image: 3292 executed, 3292 passed,
  zero failures, zero not run and zero timeouts; suite elapsed 340.014 seconds.

The bounded demo checks are not long-duration endurance runs. This checkpoint
does not claim a new full ECMA or Octane performance comparison.
