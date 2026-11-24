# Windows mishmashvm compatibility

## Scope and acceptance

Use one standalone guest VM image for Node-compatible and JS-shell APIs.
Run the existing, unmodified `mishmashvm/bootstrap.bat`, followed by
`test(0)`, `test(1)`, `test(2)` and `test(16)`. No native-to-JS callbacks are
required. Do not change mishmashvm or use a separate checkout. Preserve the
reference Windows jsshell and required DLLs. Run heavy jobs serially.

Before each bootstrap, clear only the eight generated object files named by
`libc_portable_proto/04_check_sha256.js`. Preserve existing objects in ignored
validation artifacts rather than destroying them. The batch files select
`../../jsshell/js.exe` from each bootstrap subdirectory: temporarily substitute
the guest executable there and restore the original shell after testing.

Stop immediately on any object-hash inconsistency. Successful process exit
alone is insufficient; the batch script does not stop on every child failure.

## Implementation sequence

1. Add bounded literal/character support to the kernel compiler. Keep ordinary
   JS semantics, no special function-local compile-time assignments. Replace
   manually spelled numeric character sequences in Infinity handling with
   readable literals and shared matching/copying operations. Both backends
   must use the same lowering.
2. Unify standalone globals: retain `process`/`require` while exposing
   `ctypes`, `scriptArgs`, `printErr` and the existing shell APIs. Give binary
   `read` consistent typed-array semantics. Accept `--shell` as a legacy no-op.
   Preserve error source locations independently of environment selection.
3. Build/package one snapshot, test Linux regressions, then substitute its
   PE executable for the reference `js.exe`. Implement missing platform/FFI
   support in the VM, not application-specific rewrites. Check Windows ABI
   behaviour explicitly; name resolution alone is insufficient.
4. Run clean Windows bootstrap, check all eight hashes, then the four demos.
   Keep byte-identical cross-host/self-hosted snapshot generation, full
   Test262 coverage and bounded GC/Linux demo checks at working checkpoints.

## Reference run, 2026-11-15

The supplied Windows jsshell completed a clean `bootstrap.bat` under the
supplied 32-bit Wine prefix. All four final objects and their `.new` versions
match both the pre-existing Linux-compatible objects and the project's
expected SHA-256 values:

- `my_libc.o`: `0e8e02c852a11ebec585650d3c6fa5917fb51d7b66dd1d458d3e51680c660964`
- `stubs.o`: `0cdb519efb42f22eba96bf90407e10b87868355e1d793d3a70271f09d47aa403`
- `tcc_bin/libtcc1.o`: `59483d03266a9eadb84ceafaf4ed8a37e5a5231aaf773f296a7ca097679307b3`
- `tcc_bin/tcc_boot3.o`: `b64ff3010f2de6eb50762169fc5309b66ef704924cfc21648e7b75f088af3365`

Raw reference receipt: ignored
`artifacts/mishmashvm-win32/reference-bootstrap.log`. Existing binaries were
moved to `artifacts/mishmashvm-win32/existing/`; required DLLs were untouched.
This records a Wine run, not a physical Windows validation.

## Unified-environment bring-up

The bounded kernel literal operations are documented in
[compilation](compilation.md#bounded-kernel-string-literals); `Infinity` and
`NaN` matching/formatting no longer spell their text as numeric byte sequences.
The ordinary shell integration workload now checks simultaneous Node/shell
APIs and binary read identity, and passes in both ELF and PE executables.
The existing compiler integration workload exercises literal copy/length/
character lowering on both backends rather than adding a separate micro-suite.

Exposing Node globals makes Emscripten select its Node branch. That branch
requires `process.platform`, stdout/stderr writes, and event registration.
Platform identification is resolved at process startup, never captured from
the snapshot producer. Event operations share NodeEventEmitter rather than
introducing a separate process-only implementation.

As in the documented Linux bring-up, build the bootstrap image with
`--vm-max-heap-mib 1024`. The 512 MiB image cannot supply the contiguous logical
128 MiB ArrayBuffer reservation after compilation fragments its heap. This
is the existing backing representation/placement limitation, not a new eager
Windows commitment or an application-specific memory-size override.

The first two failed batch attempts produced no object files: first the
512 MiB allocation failure, then missing `process.platform`. Batch hash
checks consequently printed BAD for missing files, not differing generated
objects. Neither attempt is a successful bootstrap or evidence of hash parity.

After supplying the shared process services, isolated guest stage
`01_mk_tcc.js` passes, producing the Emscripten-stage object SHA-256
`080182b567eabf208f60fcba6182d9c7a11c5f2421398dec530bc9dded852004`, matching
the recorded Linux/jsshell first-stage object. This hash intentionally differs
from the final native-stage `b64ff301...` object above. The original shell is
restored after each test using an EXIT trap; interrupted-machine recovery
can restore the preserved `js.spidermonkey-reference.exe` if needed.

## Full guest bootstrap acceptance

The clean guest run of the unmodified `bootstrap.bat` completed under Wine.
All eight final objects have the reference hashes listed above, including
the final native-stage compiler. Direct filesystem hashing confirms the
batch's own hash report; no generated-object differences were observed.
Receipt: ignored `artifacts/mishmashvm-win32/guest-bootstrap-final.log`.
The reference shell was restored afterwards. This checkpoint uses the unified
image built with the existing 1024 MiB maximum-reservation option, and needs
no extra flags in the batch file or command line used by mishmashvm.

## Interactive Wine acceptance

With the same executable temporarily substituted at the existing jsshell
path, all four unmodified demos pass:

- `test(0)`: native return values 70, 2, 102, 105 and libc example 10 match
  the snippets; setjmp/longjmp prints `second` then `main`, and exits zero.
- `test(1)`: 640x360 animated colour static; inspected captures differ,
  injected key-down/up events are logged, normal window close exits zero.
- `test(2)`: injected `a`, `b`, `c` produce the expected key logs and visible
  green bitmap `abc` over the animated grayscale framebuffer. Normal close
  exits zero.
- `test(16)`: the Penguin Puzzle board/penguin render, movement/undo/reset
  key events are logged, observed application FPS is approximately 27--32,
  normal window close exits zero. This is a bounded interactive smoke run,
  not a performance benchmark or exhaustive game validation.

Mishmashvm loads its supplied runtime/SDL DLLs through ordinary detection and
ctypes. No callback implementation, application-name dispatch or edited
demo source is involved. Log messages about unused missing symbols and JPEG
assets are not claimed to be newly implemented APIs. Receipts/captures are
ignored `artifacts/mishmashvm-win32/test{0,1,2,16}*`; no bitmap is checked in.
The original reference shell is restored and mishmashvm's worktree is clean.

## Reproduce on Windows

From `ai_experiments/mmvm_v2_tests`, using a supplied Node build host:

```bat
node guest_runner.js --vm-native --vm-max-heap-mib 1024 --snapshot artifacts/bootstrap.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/bootstrap.snap artifacts/js.exe --win32
```

Preserve `jsshell/js.exe` before substituting the generated executable; do
not overwrite an existing backup. Leave the supplied DLLs in that directory.
From the unchanged mishmashvm directory, clear the eight identified generated
objects (or move them into a backup), then run:

```bat
cmd /c bootstrap.bat
..\jsshell\js.exe -e "load('mishmashvm.js');test(0)"
..\jsshell\js.exe -e "load('mishmashvm.js');test(1)"
..\jsshell\js.exe -e "load('mishmashvm.js');test(2)"
..\jsshell\js.exe -e "load('mishmashvm.js');test(16)"
```

Each graphical test is interactive; close it normally before starting the
next. `cmd /c` keeps the batch's working-directory changes inside its child
shell. Require all eight printed hashes and all four OK summaries, not merely
the batch exit status. Restore the reference shell after comparison. These
commands need neither `--shell` nor changes to the batch files; the input
snapshot is not required to run the executable. No Windows compiler, SDK or
import libraries are required to build it.

## Regression and build measurements

At `5163ff6`, Node and js_min core suites pass (12 guest programs / 310
assertions each, plus the existing internal checks and new literal operations).
Full Test262 is 3292 passed, zero failed/timed-out/not-run on both Linux and
Windows/Wine: 366.852 and 362.603 seconds respectively. These are slower than
the preceding 337.164/356.477-second observations, not an attribution result.
The bounded structural GC run passes 27 audits, 113184 edges, 221 property
indexes and 74 embedding collections under its 8 MiB guest cap.

Default snapshots are 7,534,408 bytes, identical from Node, js_min, Linux
self-hosting and Windows/Wine self-hosting. The legacy `--shell` flag produces
the same bytes as omitting it. Observed Linux self-build is 82.64 s / 481828
KiB RSS; js_min build 101.94 s / 314184 KiB; Windows/Wine self-build 91.74 s /
488424 KiB. Previous Linux/js_min observations were 78.66/97.16 seconds;
these unpaired differences are recorded rather than declared neutral.

Selected stock Octane comparisons (current / preceding `b83d43f` executable):
Richards 89 / 94.6, Gameboy 795 / 820, CodeLoad 94.2 / 93.5. A subsequent
three-pair alternating Richards check shows substantial machine/run variation:
current 79.2, 83.5, 84.2 (median 83.5), preceding 82.4, 84, 85.8 (median 84).
The alternating medians differ by about -0.6%; neither the initial pair nor
this small sample establishes a broad interpreter speedup/regression. This
is not a new full ECMA or 15-suite Octane sweep.

Raw build/core/GC/Test262/Octane receipts are ignored under
`artifacts/mishmashvm-win32/`. The published `artifacts/js.exe` is the
1024 MiB-reservation PE used for bootstrap/demo acceptance; regression suites
use a separate default-cap image. Original snapshot files are preserved under
`saved-snapshots/` when checking executable independence, not deleted.

After moving the actual default source snapshot out of its original path,
the Linux executable matrix passes all eight demos and three HTTP servers
again (`regression-apps-source-absent.log`). The published PE also runs
`test(16)` with its actual original snapshot absent, reporting approximately
26--30 FPS and exiting zero on normal close (`test16-source-absent.log`).
The preserved Windows jsshell is restored with SHA-256
`e0ea478780584e2ef1c862af07a21a845dd8ff6d10faef699afa80e324c415c5`.

## Win32 TCC package (`mk_tcc_win32.ps1`), 2026-11-15

PowerShell is not installed in the test environment. The existing script's
preparation was reproduced manually: preserve/clear its generated artifacts,
create `artifacts/tcc_win32/lib`, copy the Win32 headers, common TCC headers
and `.def` files, then execute its unchanged JS command through Wine:

```text
../jsshell/js.exe -e "load('mishmashvm.js'); test(25)"
```

Run the reference shell first, preserve its complete package and eleven
temporary runtime objects, then recreate clean outputs and substitute the
guest VM at the same jsshell path. The existing bootstrapped objects remain
inputs; this is not another compiler-bootstrap run. No mishmashvm or VM source
changes were needed. PowerShell's own command/alias behaviour was not tested.

Both runs succeed. All **86 package files** match byte-for-byte, including
the generated executable/archive, and all **11 newly generated runtime
objects** match separately. SHA-256:

- `artifacts/tcc_win32/tcc.exe` (257024 bytes):
  `760c7ee4bb4dab0559fd087354976890f7413981dcfb1754607c2e54e474c609`
- `artifacts/tcc_win32/lib/i386-win32-libtcc1.a` (27026 bytes):
  `f0cf2e086a5f1047d8c159adfb9d631592587a6c83e491549728504f6bc04064`

The built compiler reports `tcc version 0.9.27 (i386 Windows)`. Each compiler
then compiled the existing `tcc_src/win32/examples/fib.c`, using the same
output pathname and arguments. The resulting PE files are byte-identical
(SHA-256 `8bcd9d038259ffbbfd681003373a5d83b020a42c02bc71ddfef6b94a2016dbfb`)
and run successfully with `10`, printing `fib(10) = 55`.

Observed test(25) wall times/peak RSS: reference **3.02 s / 94016 KiB**,
guest **10.99 s / 177352 KiB**, single serial observations under Wine.
Receipts and preserved reference outputs are ignored under
`artifacts/mk-tcc-win32/`. The generated guest package remains in mishmashvm's
artifacts directory, the tracked placeholder is preserved, and the reference
jsshell is restored. No generated binaries are checked in.
