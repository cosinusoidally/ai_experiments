# Self-hosting and standalone snapshots

An existing standalone snapshot can also be wrapped in a dynamically linked
i386 executable without a compiler or linker. See
[Snapshot executables](snapshot-executable.md). This is packaging only: it
does not change the snapshot format, normal loader, independent linear heap,
or self-hosted source-rebuild process described here.

Object-library preparation captures private property primitives and installs
guest-bytecode conversion continuations on the public intrinsics. A shared
indexed-view descriptor-policy leaf is also loaded from indexed_view_policy.js
during setup, not from host-specific Function.toString output. Both bootstrap hosts and a self-hosted rebuild
execute this same setup; these functions/closures are ordinary traced heap
records in the image. Their arguments and suspended progress are not saved
as host callback state. Contract 102 also includes bytecode targets reached
through chained Function.prototype.call forwarding.

## What is being built

A standalone snapshot contains executable i386 interpreter code, a small
machine-code bootstrap and an initialized guest heap. That heap includes
bytecode for the implementation modules, the self-hosted front end and the
generic source runner. It is not just a cache of the interpreter's machine
code and is not a snapshot of the requested application's execution.

Three independent boundaries matter:

1. **Build the interpreter kernel:** JavaScript function source -> shared IR
   -> i386 instructions through the macro assembler.
2. **Prepare the guest implementation:** execute module loading/library setup
   inside a guest runtime, making its parser/compiler/VM source modules into
   guest-owned bytecode/functions/objects.
3. **Capture the generic entry:** start `standalone_source_runner.js` but do
   not execute its application-loading instructions; serialize that initial
   frame and its reachable initialized runtime state.

The next launch supplies argv and environment. The program filename need not
exist during image generation. Different applications or snapshot output
paths must not change the generic image bytes.

## Initial build under js_min or Node

Read [`guest_runner.js`](../../guest_runner.js),
[`node_environment.js`](../node_environment.js),
[`aot/native_interpreter.js`](../aot/native_interpreter.js) and
[`aot/backend_x86.js`](../aot/backend_x86.js) in that order.

The runner constructs `VM` with native interpretation, snapshot output and
deferred writing. Its temporary environment has fixed arguments and suppresses
capturing process environment values. Construction compiles the native
interpreter's helper graph. Builders compute a deterministic source
fingerprint and can reuse the prepared parse while lowering; this is build
metadata, not a launch-time validation pass.

`GuestNodeEnvironment` installs the guest libraries. Its
`prepareStandaloneRuntimeSnapshot()` then executes a guest bootstrap which
loads `guest_vm.js`, `node_environment.js` and the libc/events/process/net/fs/
http compatibility modules **as guest code**. It loads
`self_hosted_frontend.js`, installs guest direct/indirect eval and Function
compilers, and supplies guest JSON operations.

In the initial js_min/Node bootstrap, the outer implementation necessarily
compiles the seed modules before they can execute as guest code. Once the
standalone image runs, its resident guest front end performs subsequent
source loading/compilation. Self-hosting does not mean there was no initial
bootstrap compiler; it means a rebuilt image no longer needs that outer JS
host to compile and run the next stage.

The runner starts the generic standalone source runner, yielding a single
initial frame at the application-independent boundary. It calls
`writeStandaloneSnapshot(path, execution, null)`, then aborts that temporary
execution in the builder. Only afterwards, if a program argument was given,
does it open and execute that application. Snapshot-only invocation exits
without an application.

Node cross-building uses sparse emulated linear memory and the same compiler
and assembler. `HostFFI.snapshotBindings()` assigns deferred symbol identities
for resolution; it refuses actual native execution. The x86 output is emitted
as bytes and never invoked on Node. On js_min, the native backend can also
execute its generated code. Both routes must emit the same target image.

## Standalone launch

[`js_runner.c`](../../js_runner.c) validates basic image header/section bounds,
maps the file, resolves the address of `dlsym` and calls the entry as:

```c
int entry(int argc, char **argv, void *dlsym_address);
```

`argc/argv` begin with the requested program, not the C launcher's own name
or snapshot filename. C does not parse JavaScript, expose VM objects, service
guest calls, implement GC or compile source. It currently maps the image
read/write/execute; this is a trusted executable image, not a safe data file.

The generated bootstrap locates its mapped image position, resolves libc
services through the supplied dlsym, maps anonymous runtime heap capacity,
copies only the initialized heap prefix, rebinds native platform/function and
buffer pointers, stores argc/argv/image metadata, initializes engine roots
and enters the initial frame. Relative code references and heap-relative
record references avoid requiring a fixed process heap address. The heap
stays nonmoving during that run, but the next process can allocate it elsewhere.

`standalone_source_runner.js` decodes live argv, installs the process and
shell/module APIs, reads the requested file with guest filesystem code,
compiles it with the guest front end, adopts the result and executes it.
It then runs the compatibility event loop. Environment-dependent services
read the new process environment; serialized native symbol addresses are not
valid process-independent values and are rebound before guest execution.
Exit status is propagated through guest libc exit where needed.

## How guest compilation becomes executable without a host mirror

[`self_hosted_frontend.js`](../self_hosted_frontend.js) runs the same tokenizer,
parser/compiler and verifier as ordinary guest modules. Its temporary ASTs,
tables and descriptors are consequently guest objects. Native compile options
consume processed AST state, use packed/paged builders and a reusable word
arena, and adopt nested functions through `finishFunction` as they complete.

`adoptProgramDescriptor` uses `__guestVMProgramCreate`, SetCode, SetConstant,
SetVector and SetBindingName intrinsics to allocate/populate executable
`PROGRAM` graphs and callable records directly. It recursively adopts nested
descriptors, roots the source descriptor and incomplete target callable, and
releases these construction roots in finally blocks. It does not marshal
the whole result into an outer-host AST/program object for execution.

The module's introductory comment referring to adoption as a “next
integration boundary” predates this implemented path; the actual
`adoptProgramDescriptor` and program-builder intrinsics are the current code.

`compileExecutable(source, filename, contextAnchor, owningGlobal)` returns a
guest wrapper that instantiates global declaration names and invokes the
adopted callable. Exact source is retained, but this executable-adoption path
currently disables the separate per-PC source-location table. Do not promise
the same line/column fidelity as a location-rich portable compile.

Direct eval, indirect eval and Function have different compiler entry points.
Direct eval may extend the caller's environment; indirect eval is global code;
strict eval owns its declarations; Function validates parameter grammar and
creates a global-scope function body. The native engine enters the installed
guest compiler through bytecode continuations, not a callback to js_min.

The self-hosted module's internal entry points are:

| Export | Result/purpose |
| --- | --- |
| `parse(source, filename)` | AST |
| `compileAst(ast, consumeAst)` | Verified compiler descriptor |
| `compile(source, filename, options)` | Verified descriptor; options include location capture, word arena and nested-function sink |
| `adoptProgram(program, contextAnchor)` | Runtime-owned executable callable |
| `compileExecutable(source, filename, contextAnchor, owningGlobal)` | Wrapper performing global declaration setup and execution |
| `compileEvalExecutable(source, filename, inheritedStrict)` | Direct-eval callable with declaration metadata |
| `compileIndirectEvalExecutable(source)` | Global eval callable with global declaration metadata |
| `compileFunctionExecutable(arg0, ...)` | Construct a function from parameter strings and final body string |
| `installEvalCompiler(frontend)` | Install the three guest compiler callbacks through the program-builder intrinsic |

These are guest frontend integration APIs, not aliases of the embedding
`JSContext.compile` API. Adoption requires the guest program-builder
intrinsics; merely requiring the module on stock Node does not supply them.

## Rebuilding the implementation under itself

When a launched snapshot runs `guest_runner.js` without `--snapshot`, a fast
path can use the already prepared standalone runtime to execute another file.
That is normal application execution, not a rebuild.

When `--snapshot` is present, the runner explicitly bypasses that fast path.
It clears the loaded implementation entry names, reloads the current build
sources from disk through the guest loader, constructs a **new runtime**, and
runs the full kernel compiler, standard-library setup, generic-runtime
preparation and image writer in the guest interpreter. The original image
is the stage that executes this compiler, not the output bytes to copy.

There are therefore two guest heap domains during this work: the running
bootstrap VM's objects, and the new target runtime's linear memory managed
by the implementation running inside it. FFI/memory operations service the
target allocation. Do not confuse “a target heap pointer represented as a
number in the builder” with an owning reference in the bootstrap heap.

For unchanged sources, build options and target contracts, the new image
must be bit-identical to the first. A source change should instead affect the
new image. Copying/exporting the launching image would hide the source change
and is not an acceptable fixed-point test. The existing gate checks emitted
lowering/assembly progress as well as the final `cmp`.

## On-disk format and normalization

There are **two** snapshot families in `backend_x86.js`:

- Legacy code-only image: magic `0x31535647`, format 1, 32-byte header;
  loads interpreter code into an embedding runtime.
- Standalone image: magic `0x32535647`, format 2, 128-byte header;
  includes bootstrap, symbol-name data, code and initialized heap prefix.

`X86Backend.StandaloneHeaderFields` defines file/entry/code/heap offsets and
lengths, reserved heap capacity, initial frame/context, dlsym cell, native
contract, profile mode and source fingerprint. Operand mode is also stored.
Header offsets and executable contracts are not interchangeable versions.
The C launcher performs format/section checks; the embedded code loader
additionally checks the current native contract and profile/operand modes.
Neither path re-fingerprints all current JS sources on ordinary startup.
`--skip-snapshot-hash` remains a compatibility option; it is not needed to
disable a source-verification pass that currently does not run.

The writer retires/publishes outstanding allocator regions, shares remaining
string backings and builds a heap template. It temporarily zeros platform
pointers, binding payloads and buffer pointers, normalizes engine diagnostics/
root state, copies external buffer contents into the template, then restores
the live builder's process-local state. The output concatenates concrete
header/data/code/heap bytes; the unused reserved capacity is not a giant
sparse-file tail. Bootstrap allocates that capacity anonymously at launch.

Compact strings, source slices, integer metadata and bytecode/constant-pool
packing reduce retained representation redundancy without compressing the
file or stripping debugging source. Spare capacity and free spans can still
exist inside the captured prefix: this is not a fully relocating heap
compactor, and the GC remains nonmoving.

## Reproduce the contract

From `mmvm_v2_tests`, with the existing js_min and Firefox libraries prepared:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js \
  --vm-native --snapshot artifacts/snap
gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl
./artifacts/js_runner.exe artifacts/snap hello.js
./artifacts/js_runner.exe artifacts/snap guest_runner.js \
  --vm-native --snapshot artifacts/snap2
cmp artifacts/snap artifacts/snap2

node guest_runner.js --vm-native --snapshot artifacts/node.snap
cmp artifacts/snap artifacts/node.snap
```

Do not rebuild js_min just to run it; set `LD_LIBRARY_PATH`. No application
is required for `--snapshot`. No downloads, Node runtime, source hash cache
or package manager are required to launch an already built standalone image.
Rebuilding under itself does require the implementation source files on disk.
