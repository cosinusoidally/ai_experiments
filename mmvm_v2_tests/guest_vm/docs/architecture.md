# Architecture and source map

## Three meanings of “host”

Distinguish these before debugging or changing a boundary:

- **Bootstrap JavaScript host:** Node or js_min, when running `guest_runner.js`
  to construct an embedded runtime or build an image.
- **Embedder:** code scheduling `Execution` objects, providing callbacks and
  source readers. In a standalone process the runner/embedder is itself
  guest JavaScript; it is not a JavaScript service in `js_runner.c`.
- **Native platform:** libc and operating-system services reached through
  FFI. Direct guest FFI does not imply an outer-JavaScript callback.

“Self-hosted” means the implementation's JavaScript modules execute as guest
code when rebuilding the VM. It does not mean the i386 machine-code dispatch
loop interprets itself, or that every JavaScript implementation module has
been AOT-compiled. The kernel compiler AOT-compiles selected low-level
functions; the guest interpreter executes the remaining implementation JS.

## Layers

```text
Application / self-hosted VM implementation modules
                  |
        tokenizer -> parser -> compiler -> verifier
                  |
            guest register bytecode
                  |
     +------------+----------------------+
     |                                   |
portable Execution adapter      compiled kernel interpreter
and Runtime semantics           (shared IR -> JS or i386)
     |                                   |
     +------------- guest heap ----------+
             named record accessors
                  |
        LinearMemory -> HostMemory / native memory
                  |
             FFI / libc / OS
```

The arrows are not all required runtime callbacks. The i386 interpreter can
execute bytecode calls, allocation, collection and supported intrinsics
without returning to the portable adapter. The adapter remains important in
embedding mode when a native operation declines a case or a host callback is
requested. A standalone bootstrap handles native engine exit reasons without
an outer JS interpreter.

## Runtime, context and execution

[`vm.js`](../vm.js) exports the convenience `VM` constructor and the
`JSRuntime`, `JSContext`, `Execution` and `Frontend` properties. A `JSRuntime`
owns a semantic [`Runtime`](../runtime.js), the heap, atom/metadata tables,
built-ins, native engine and registered contexts. `VM` creates one runtime
and one context and delegates methods to them.

A `JSContext` owns a context record and a global object and can have one
active execution through this API. Its initial globals are shallow-copied
from the runtime template: global bindings can diverge, but Math, constructors
and built-in prototypes are shared. `shareGlobalObject` can deliberately
share the global itself. Do not promise realm isolation based solely on
`createContext()`. A separate runtime is the clear isolation boundary for
guest-owned state; neither runtime is a security sandbox when FFI is exposed.

An `Execution` owns the resumable call stack, pending embedding call and
instruction accounting. In portable mode it also has JS frame/register
arrays. In native mode heap frames/register cells are authoritative while
the kernel is running. Published roots tie all of these layers together.
Objects/functions can outlive the embedding context handle that created
them. A reachable function retains its home context; destroying a context
unregisters/aborts its embedding execution, not all reachable objects.

## Supported execution configurations

| Configuration | Dispatch | Platform boundary |
| --- | --- | --- |
| `new VM()` on Node | portable JS interpreter by default | explicit embedder callbacks; no real raw FFI |
| `nativeInterpreter: true` on Node | generated JS for the kernel IR | emulated linear memory, not x86 execution |
| `nativeInterpreter: true` on js_min | AOT i386 kernel plus embedding adapter | js_min provides raw FFI for construction/embedding |
| `js_runner.exe IMAGE program.js` | image's i386 kernel and guest runner | direct guest FFI; C only maps image and passes argc/argv/dlsym |

`threadedCompile` selects an older structured JavaScript compilation path,
not OS threads. It is distinct from the kernel interpreter and from compiling
the application's bytecode into machine code. The CLI defaults differ from
the bare constructor: see [maintenance](maintenance.md).

## Source map

| Area | Main files and responsibility |
| --- | --- |
| Entry/API | `guest_vm.js` single shell loader; `vm.js` runtime/context facade |
| Language front end | `tokenizer.js`, Unicode data, `parser.js`, `compiler.js`, `function_analysis.js`, `register_allocator.js`, `bytecode_optimizer.js`, `verifier.js` |
| Portable execution | `interpreter.js` scheduling/frames/fallback; `runtime.js` semantics, roots, metadata and built-in construction |
| Heap | `host_memory.js`, `linear_memory.js`, `heap.js`, `value_cell.js`, `heap_records.js` |
| Shared low-level operations | `property_storage_kernel.js`, `object_operations_kernel.js`, `lexical_environment_kernel.js`, `memory_transfer_kernel.js`, `native_free_index_kernel.js`, `number_format_kernel.js` |
| AOT | `aot/kernel_compiler.js`, `kernel_slots.js`, `backend_js.js`, `backend_x86.js`, `x86_assembler.js` |
| Native engine/collector | `aot/native_interpreter.js`, `heap_sweeper.js`, `free_index_kernel.js`, `record_initializer.js` |
| Guest libraries | `array_runtime.js`, `object_runtime.js`, `math_runtime.js`, `number_runtime.js`, `regexp_runtime.js`, `buffer_runtime.js`, shared `json.js` |
| Binary/platform facilities | `binary64.js`, `buffer.js`, `typed_array.js`, `date.js`, `error.js`, `host_ffi.js` |
| Self-hosting | `self_hosted_frontend.js`, `standalone_source_runner.js`, `standalone_test262.js`, `node_environment.js` |
| Outer project | `guest_runner.js`, `js_runner.c`, `node_compat/`, external-corpus runners and demos |

There is deliberate overlap between portable semantics, guest-library
algorithms and native intrinsics. A change to one path is not automatically a
change to the others. Intrinsic IDs in `native_intrinsics.js`, record contracts
in `heap_records.js`, and tests connecting both backends are the coordination
points. The implementation still has transition-era metadata tables and
legacy property layouts; the documentation must not present migration plans
as completed work.
