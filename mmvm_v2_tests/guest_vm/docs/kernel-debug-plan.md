# Deterministic kernel debugging and -O0: implementation plan

Recorded 2026-11-12, following the completed native-contract-103 launcher
acceptance. **This is a design and acceptance plan, not implemented support.**
The current runner has neither kernel `-g` nor `-O0`; the packager has no
DWARF incorporation option. Commands below describe the proposed interface.
No debug-mode benchmark results exist yet.

## Scope and required outcomes

Add debugging for the **native-compiled kernel dialect**: the interpreter,
collector and their compiled helper graph. This is not DWARF for the guest's
JavaScript bytecode, its execution frames or its application variables.

Required outcomes:

- An explicit `-g` builds a separate `foo.snap.dbg` beside `foo.snap`.
  The sidecar contains DWARF and the information needed to relocate it.
- The executable packager can optionally incorporate that information.
- GDB can break/step at kernel source lines, unwind native kernel frames,
  inspect parameters and locals, and display source alongside disassembly.
- objdump can disassemble actual kernel functions, with source interleaving
  when debug info and the corresponding source are available.
- An independent `-O0` selects a debug-friendly kernel compilation policy.
  Benchmark that policy rather than assuming how much it costs or saves.
- Build artifacts contain no absolute source/build paths, output basenames,
  timestamps, runtime addresses or other process/environment-dependent data.
- Renaming outputs must not change bytes: identical debug-enabled foo.snap
  and bar.snap imply identical foo.snap.dbg and bar.snap.dbg; incorporating
  equivalent debug info produces identical foo.exe and bar.exe.
- Preserve PIC kernel code, the independently allocated linear heap, the
  fixed ET_EXEC executable load base and ordinary snapshot loading behaviour.

Implementation remains ES3-compatible JavaScript, shared by Node, js_min and
the standalone guest build. No GCC, linker, binutils, crt objects, npm, Python,
downloads or new C support are build dependencies. GDB/objdump are optional
external consumers/validation tools, not programs invoked to produce artifacts.
If a needed validation tool is unavailable, ask the user; do not download it.

## Proposed interface and independent options

From mmvm_v2_tests, proposed examples are:

```
js_min.exe guest_runner.js --vm-native -g --snapshot artifacts/foo.snap
js_min.exe guest_runner.js --vm-native -g -O0 --snapshot artifacts/debug.snap
node guest_runner.js --vm-native -g -O0 --snapshot artifacts/node-debug.snap
./artifacts/js_runner.exe artifacts/host.snap guest_runner.js --vm-native -g -O0 --snapshot artifacts/rebuilt.snap
node guest_vm/tools/snapshot_to_exe.js artifacts/foo.snap artifacts/foo.exe --debug-info artifacts/foo.snap.dbg
```

Use the existing js_min binary with its normal LD_LIBRARY_PATH setup. Do not
rebuild it. The same packager interface must work on js_min and js_runner;
Node is not a requirement for producing the executable or sidecar.

| Configuration | Compilation policy | Separate DWARF |
| --- | --- | --- |
| Default | Existing optimized policy | no |
| `-g` | Same optimized policy | yes |
| `-O0` | Debug-friendly policy | no |
| `-g -O0` | Debug-friendly policy | yes |

Do not invent an `-O2` spelling as an already-supported mode. Record the
effective options explicitly and propagate them through all build hosts.
These flags affect kernel compilation, **not** the guest language dialect,
guest bytecode optimizer, instruction-budget semantics or library algorithms.
They must not turn off native interpretation or introduce another interpreter.
Building a new -O0 image under an optimized image still uses the optimized
host interpreter to run the compiler; target policy and build-host policy
must not be confused.

`-g` must preserve the generated kernel instructions and optimization choices.
It may add small debug-binding metadata to the snapshot; complete -g and
non--g snapshots therefore need not be identical. There is no requirement for
-O0 code to match optimized code. Equality tests compare equal configurations.

## Current foundations and missing compiler information

The existing implementation provides:

- `aot/x86_assembler.js`: instruction-byte positions and label/fixup tracking,
  independently of whether bytes use JS arrays or temporary native storage.
- `aot/backend_x86.js`: function labels, register selection, frame layout,
  local-to-storage assignments and a human-readable allocation summary.
- `aot/kernel_compiler.js`: parameter/local names, a shared IR, deterministic
  helper-graph discovery/order, and small-helper inlining.
- `aot/kernel_slots.js`: liveness-based stack-storage reuse.

It does **not** yet provide sufficient source or variable-location tracking:
kernel parsing explicitly disables source locations; transformations do not
carry a complete debug provenance chain; the allocation summary is not a
per-instruction location description. Do not derive DWARF from macro text or
guess location ranges from that summary.

### Canonical source provenance

Register each source function using a normalized project-relative filename,
its original source span and canonical source text/identity. Examples of
stored paths are `guest_vm/aot/native_interpreter.js` and
`guest_vm/property_storage_kernel.js`. Omit the actual working directory;
omit DW_AT_comp_dir or use a fixed `.`. Use consistent relative separators.

Do not obtain original line numbers from Function.toString(): Node, js_min
and the guest can format functions differently. A location measured in the
synthetic `var __kernel = ...` parser wrapper is not an original file location.
Retain/validate the connection to the original file AST and source span.
Define deterministic provenance for generated accessors, not invented lines
in a handwritten file. Mark artificial code appropriately. Where generated
source is needed for display, materialize deterministic text under an explicit
artifact directory with stable virtual relative names; do not check it in or
record the artifact directory's absolute location in DWARF.

Carry source statement/expression IDs through lowering, branch transformations,
store combining and inlining. At emission, record the corresponding native
instruction ranges using the assembler's authoritative byte position. Retain
inline call-site and callee origins instead of attributing all helper code
to one caller line. Optional detailed expression positions can follow reliable
statement-level information.

Location capture must remain opt-in. Prepared parses without positions cannot
silently satisfy a debug build: include the needed capture/provenance policy
in reuse keys or prepare the appropriate tree explicitly. Prefer compact side
tables over duplicating source strings/location objects throughout the IR.
Release build-only debug graphs; do not accidentally serialize them as guest
heap objects into the runtime snapshot.

### Local-variable locations and types

Use logical source binding identities distinct from reused physical storage.
The backend must publish location changes at exact instruction offsets:

- Stack homes and parameter locations, relative to the defined frame base.
- Register residence, initialization, assignments, spills and register borrowing.
- Valid ranges when a stack slot changes owner or a register is repurposed.
- Constant values where the binding has genuinely been folded to a constant.
- Unavailable/optimized-out ranges where no valid recoverable value remains.

Never show a stale stack copy or another local's reused slot. A function-wide
register assignment is insufficient. A source variable may remain in scope
after its last machine-level use, yet be unavailable in optimized code.

Describe actual lowered types: i32/u32, binary64 where present, and pointers
only where their meaning is established. Do not label a guest-heap offset as
an absolute pointer, or guess a variable's type solely from its name. Values
held in guest memory can be inspected through their addresses; rich record
types may later be generated from canonical layout catalogs, not duplicated
offset constants. Expression temporaries need not all appear as named locals.

GDB has no general JavaScript expression evaluator. The initial debugger view
uses scalar types and C-style expressions, not arbitrary JavaScript evaluation.
Choose/document a supported language view and identify the kernel dialect in
producer metadata; validate how GDB consumes its DWARF language tagging.
The .js source suffix does not prevent source-line display. No Python extension
should be required for the baseline experience.

### Native unwind information

Emit call-frame information for function entry, prologue, saved registers,
stack adjustment and epilogue, so backtraces and variable frame bases work.
Derive CFI from assembler/backend events and named ABI/register definitions,
not hand-maintained instruction offsets. The assembler's existing temporary
cdecl argument counter is not, by itself, a complete unwind description.

## -O0 policy

Use the same compiler/front end, shared IR, intrinsic semantics and backend,
with explicit policy switches rather than a second code-generation pipeline.

- Disable helper inlining and optional tail-call/frame-eliding transformations.
- Disable liveness-based sharing of named-local stack slots.
- Give named parameters/locals stable canonical stack homes; assignments keep
  those homes authoritative and subsequent reads observe them.
- Do not retain the only authoritative named-variable value in a register.
  Temporary expression calculations may still use registers and x87 operations.
- Disable optional source-obscuring folding/fusion/pruning optimizations.
  Keep required validation, constant-namespace resolution, instruction
  selection and intrinsic lowering. Unsupported syntax must still be rejected.
- Keep straightforward stack frames and function-call boundaries.
- Preserve the same observable kernel semantics, evaluation order and effects
  as optimized mode. Do not reinterpret a declaration under different rules
  merely because -O0 was selected.

The legacy local-constant mode documented in compilation.md is an existing
semantic debt. Debug metadata must honestly distinguish such configured
constants from runtime locals; -O0 is not permission to introduce or silently
change that convention. Continue moving actual configuration to explicit
namespaces as separate, tested work.

At -O0, locals should be inspectable after their values have been established,
at sensible statement boundaries. Before initialization, report the actual
state or unavailability rather than inventing a value. Intermediate instructions
may still be between evaluation and assignment; source stepping is not one
instruction per source line. Validate debugger writes too: changing a writable
canonical local should affect later reads, without an invisible cached copy.
Optimized -g does not promise visibility of every discarded variable value.

## Sidecar, snapshot binding and deterministic ELF incorporation

Start with a conservative **DWARF 4** subset for broad consumer compatibility:
compile units, source files/line tables, subprograms, parameters/variables,
base types, location/range lists and native call-frame information. Add proper
abstract-origin/inline descriptions as optimized debugging is brought up.
Use named DWARF/ELF constants and typed encoders, not scattered magic numbers.

The proposed .dbg is a versioned ELF32 i386 relocatable debug container.
Its kernel addresses are section-relative and have explicit relocation
information. It does not capture the code's build-process mmap address or
assume the runtime heap has a fixed base. It need not duplicate instruction
bytes merely to let objdump inspect the sidecar; the executable supplies code.
Validate this representation with actual GDB before freezing the format.

Identical machine code alone does not determine source lines: different source
text/provenance can compile to the same instructions. To meet the strict
identical-snapshot/identical-sidecar requirement, debug-enabled snapshots must
**bind the canonical debug provenance/payload**, not rely only on a code hash.
Define a small versioned binding record in snapshot metadata; choose its exact
placement after checking existing reserved fields/loader compatibility. This
must not require changes to the ordinary C loader or add runtime DWARF parsing.

Avoid a circular hash dependency:

1. Finalize code-relative canonical debug payload P and its relocation records.
2. Bind its content digest in the debug-enabled snapshot metadata.
3. Finalize snapshot S, then wrap P in the sidecar with S's content identity.

P must not depend on the final snapshot digest or packaging addresses. If the
binding needs to identify a range, use a stable section identity/relative
offset, not a layout-dependent process address. The packager verifies the
binding before applying relocations; a mismatched sidecar must be rejected.
An identical debug-enabled snapshot cannot silently name different provenance.

Deterministic serialization rules:

- Canonical source/unit/function order and stable DIE, abbreviation, string,
  symbol and relocation ordering; no host-object enumeration accidents.
- Fixed format versions, endianness, padding, producer text and defaults.
- No dates, random IDs, PIDs, actual directories, output file names or environment.
- No foo.snap/foo.snap.dbg/foo.exe name in artifact contents. CLI output paths
  determine only where files are written. Do not embed a basename-dependent
  `.gnu_debuglink`; source-unit names identify canonical source, not outputs.
- No mandatory runtime source-fingerprint verification or automatic disk cache.
- If a content identifier is emitted, derive it only from canonical contents.

For the executable, resolve code addresses from its existing load base,
snapshot payload placement, snapshot code offset and function-relative offsets.
Append non-allocated DWARF sections and symbol/string tables. Leave the embedded
snapshot bytes unchanged, preserve PIC, and do not add runtime allocations for
debug data. Renaming source/output artifacts alone must leave the whole EXE
bit-identical. No executable file is modified when it runs.

## GDB, objdump and section layout

The current packager describes the entire snapshot with an executable
`.snapshot` section, including heap data. Refine its section descriptions into
precise ranges such as `.text.launcher`, `.text.bootstrap`, `.text.kernel`,
snapshot metadata and heap data. Do not expose the heap as instructions for
ordinary `objdump -d`. Function symbols need accurate start/end/size information,
not a guessed extent that includes the next function's padding.

Section descriptions can change without moving payload bytes or changing the
existing program load segments. This need not change runtime permissions or
the normal snapshot loader. The packager must handle both debug and non-debug
inputs with the same deterministic code-section description policy.

Target debugger/inspection usage, after implementation:

```
gdb artifacts/foo.exe
```

Within GDB, with the project source available:

```
break intrinsicCallKernel
disassemble /s intrinsicCallKernel
layout split
info args
info locals
```

And for the executable:

```
objdump -d artifacts/foo.exe
objdump -d -S artifacts/foo.exe
```

Source lookup is an external debugger setting, not an absolute build path
stored in artifacts. Unwind/line/variable checks must execute actual kernel
code; dumping plausible DWARF is not sufficient acceptance. Raw .snap is not
ELF, so ordinary objdump -d on it is not promised to discover its code
automatically.

### Deferred: GDB annotation of a js_runner-loaded snapshot

Priority clarification, 2026-11-12: packaged-executable debugging comes first.
An end-to-end GDB workflow for an mmap-loaded snapshot is **lower priority**
and is not an initial delivery gate. However, preserving the ability to use
the same sidecar this way is a **required design constraint from the start**.
Do not select a representation that would require redesigning debug emission
or changing the VM execution model to support it later.

The future workflow starts the ordinary loader under GDB:

```
gdb --args artifacts/js_runner.exe artifacts/foo.snap hello.js
```

After the snapshot is mapped, determine its actual mapping base and read the
kernel code offset from snapshot metadata:

```
runtime kernel address = snapshot mapping base + snapshot kernel-code offset
```

This address is unrelated to the independently allocated guest linear-heap
base. Supply the code load address to GDB with add-symbol-file. A companion
whose primary .text section represents the kernel can use a positional text
address; multiple named code sections require their individual section load
addresses. Choose and validate the exact command when implementing this
workflow, rather than promising an untested section convention now.

Design constraints that cannot be deferred:

- Keep the canonical sidecar's addresses section-relative, with enough
  section identity/relocation information to apply an arbitrary load base.
- Relocate function symbols, line addresses, variable-location ranges and
  unwind data consistently, not just symbol names.
- Preserve code boundaries and snapshot layout information needed to derive
  the load addresses; use the authoritative format fields, not guessed offsets.
- Do not make the sidecar usable only at the packaged executable's fixed
  address. Applying EXE relocations must not modify the original sidecar.
- Keep runtime addresses out of the artifacts and their content identity.
  No fixed heap placement, disabling ASLR, normal-loader changes, new C hooks
  or debugger-time snapshot rewriting should be needed.

Deferred convenience work includes discovering the mapping, providing a
documented stop after mmap but before guest startup, and an optional JS helper
that prints the correct GDB command. Source lookup remains a debugger setting.
Once implemented, validate kernel breakpoints, source-interleaved disassembly,
backtraces and local inspection through js_runner as well as the packaged EXE.

## Required -O0 benchmarking

Benchmarking is a deliverable, **not an optional follow-up**. No speed or size
claim is justified until measured. Keep one heavy job at a time, without
multithreading or changes to benchmarks/demos/external tests.

Measure all four configurations (default, -g, -O0, -g -O0), from the same frozen
source, with the same runtime heap, dispatch, predecode and workload settings.
Do not accidentally compare different guest bytecode optimization policies.

Record:

- Parse/provenance, fingerprint, lowering, allocation and assembly times.
- Whole image build/standalone preparation/serialization times separately;
  distinguish faster compilation from faster snapshot writing.
- Build-host wall/CPU time and peak RSS on Node, existing js_min and genuine
  self-hosted builds. Distinguish an optimized host building -O0 from an -O0
  host rebuilding itself, and measure both self-hosted cases where practical.
- Kernel machine-code bytes, maximum/representative native frame sizes,
  snapshot bytes, debug-file bytes, and executable bytes with/without DWARF.
- Load/startup/hello latency separately from build time, with no debugger
  attached and no new startup hash check.
- Stock per-suite Octane correctness/scores, wall/CPU time and peak RSS.
  Use all fifteen suites, including RegExp/Mandreel/zlib/Typescript; quicker
  existing correctness modes can triage before the full measurement but are
  not stock scores. Record latency scores separately where relevant.
- Test262 and historical ECMA result sets and elapsed time, structural/native
  GC stress, and bounded demo performance at the same resolution/FPS/mode.
  Include demo8 garage and free-drive/auto-drive at 320x240. Do not run a
  seven-minute graphical stress test; reuse bounded demos and dedicated GC.

Warm the file cache consistently, record the policy, and use paired/interleaved
serial runs for the short representative controls, with at least three
observations where practical. Report medians and spread, not just a favourable
single sample. Full expensive corpora/stock suites need not be repeated for
each intermediate edit; run the final matrix on frozen sources. Record every
timeout and the time limit, with no fabricated score or omitted slow suite.

Use the same official harness limits for mode comparisons. -O0 may turn an
otherwise passing wall-clock-limited test into a timeout; retain that result
as a measured slowdown. An explicitly labelled diagnostic rerun with a larger
wall limit may distinguish speed from semantics, but must not replace the
official result or silently weaken acceptance limits. Guest instruction
budgets retain their existing meaning.

The report must compare -O0/default ratios, -g overhead at each policy,
build-host differences and the unchanged optimized path against its own
pre-change baseline. Do not use node --jitless as a substitute for measuring
our optimized interpreter. If default mode regresses materially, fix that
forward before calling the implementation accepted.

## Implementation stages and acceptance gates

1. Add explicit optimization/debug options and canonical source provenance.
   Verify no-debug/default instruction bytes and behaviour remain unchanged.
2. Implement -O0 using the same pipeline. Run existing broad compiler/core/GC
   coverage, inspect frames/stack homes, and establish an initial performance
   and size comparison before spending time on elaborate optimized metadata.
3. Bring up -g -O0 end to end: deterministic sidecar, binding, precise ELF code
   sections/symbols, lines, parameters/locals and unwind information.
4. Exercise real GDB/objdump with the packaged executable: source-interleaved disassembly, breakpoints,
   nested calls/backtraces, prologue/epilogue unwinding and known local values.
   Prefer existing representative kernel paths over a forest of micro-tests.
5. Support optimized -g location ranges, storage reuse and inline provenance;
   deliberately verify unavailable variables are not displayed with stale data.
6. Finish the correctness/performance matrix and write the measured -O0 report.

The js_runner/add-symbol-file workflow is deferred beyond these initial gates.
Review its relocation requirements during sidecar/ELF format design now; do
not postpone that compatibility review until the convenience tooling is built.

For each -g policy, build under Node and js_min and genuinely rebuild under the
guest. Compare snapshot **and sidecar** bytes. Rebuild under different relative
output names, output directories, working-checkout locations, launch arguments
and irrelevant environment values. The source paths in the artifacts remain
canonical and relative; no system-specific example paths are checked in.
Compare debug-incorporated executables across those builds as well.

Test -g/no--g machine-code equality at the same optimization policy, wrong
sidecar rejection, missing optional sidecar behaviour, non-debug loader
compatibility, and executable execution after the snapshot/sidecar inputs have
been removed. Check file hashes before/after execution. Preserve all existing
passing files/demos; known failures stay explicit. Follow versioned native/
snapshot metadata compatibility rules if the implementation requires a change.

Commit working stages and update these docs to distinguish plans from actual
support/results. Keep generated images, sidecars and debug-source material in
ignored artifacts directories; check in source, implementation documentation
and measured status reports, not generated debug files.
