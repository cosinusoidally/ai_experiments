# Mishmashvm compiler bootstrap bring-up

Scope: run the unchanged `tcc_js_bootstrap/01_mk_tcc.js`,
`02_mk_libc_wrap.js`, and `03_mk_libc_stubs.js` with a freestanding guest VM
executable named `artifacts/js`. Stop before bringing up
`libc_portable_proto/bootstrap_tcc.sh`. No mishmashvm source changes, callbacks,
downloads, Node/native addon dependency, or C implementation changes.

Run both engines **in the original mishmashvm directory**, sequentially, with
clean output files. Preserve the jsshell reference objects outside that tree,
then compare the guest-produced objects by both SHA-256 and byte comparison.
Separate copied workspaces are not valid acceptance runs for this project.

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

## Working checkpoint

The first guest compiler stage now completes in the original source tree.
Its `tcc_boot3.o` has the reference SHA-256 above and passes a direct byte
comparison. Observed process time: 86.84 seconds; peak RSS: 554312 KiB.
The wrapper/stub stages and final regression checks are not complete yet.

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
