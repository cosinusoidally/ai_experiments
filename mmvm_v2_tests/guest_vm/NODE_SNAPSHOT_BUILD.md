# Building standalone i386 snapshots under Node

Node is an additional cross-build host, not a new target or an executable
memory provider. All source remains ES3-compatible. There are no npm packages,
FFI addons, compiler subprocesses, emulator processes or C support changes.
Only Node's builtin filesystem API is needed to emit the image.

From `mmvm_v2_tests`:

```sh
node guest_runner.js --vm-native --snapshot artifacts/node.snap
gcc -ansi -m32 js_runner.c -o artifacts/js_runner.exe -ldl
./artifacts/js_runner.exe artifacts/node.snap hello.js

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js --vm-native \
  --snapshot artifacts/jsmin.snap
cmp artifacts/node.snap artifacts/jsmin.snap

./artifacts/js_runner.exe artifacts/node.snap guest_runner.js --vm-native \
  --snapshot artifacts/self.snap
cmp artifacts/node.snap artifacts/self.snap
```

No application is opened before the ready-to-process-arguments snapshot
boundary. Application arguments and the build process's environment are not
part of the image. The target reads its actual environment at launch.

## Shared compiler, target bootstrap and serializer

Both hosts parse/lower the same kernel source through the same compiler and
emit i386 bytes through the macro assembler. Node also compiles the shared IR
to JavaScript to execute construction workloads against emulated linear memory;
it never executes the emitted i386 code. The guest heap representation and
target bootstrap sources are identical on both build hosts.

`prepareStandaloneRuntimeSnapshot` loads the guest VM implementation and
libc-backed compatibility modules into the target context on either host.
Build-time source reads use the embedder's filesystem adapter. Node's builtin
network/filesystem objects are not serialized as target services.

`HostFFI.snapshotBindings()` is a restricted build-time symbol-binding
service. It supplies a nonzero deferred address for successful symbol lookup,
including the native interpreter's C-string argument form. It rejects actual
native function execution and raw native memory access; it does not pretend
to implement libc under Node. The common snapshot writer clears transient
addresses and records symbol names/binding locations. The i386 bootstrap
resolves those bindings through the launcher's supplied `dlsym`.

The image layout, bootstrap assembly, header definitions, pointer scrubbing
and heap-copy boundary are shared. `aot/snapshot_output.js` only adapts output:

- Native hosts retain libc bulk code copies and writes from native memory.
- Node copies generated code bytes and emulated heap bytes into bounded,
  fully written chunks using builtin `fs`. Files are dense, not sparse.
- Both write a temporary file and rename after successful completion. The
  common writer releases its staging allocation and heap copy on failure.

Prepared immutable string searches use native bulk byte search on MMVM.
Emulated memory decodes each prepared span once and uses the existing exact
UTF-16 search, avoiding a byte-accessor call for each comparison. The match
selection/order and serialized string identities are unchanged.

## Validation and maintenance

The high-level regression includes different application/environment inputs,
arbitrary-program execution, launch-time environment checks and a genuine
compiler invocation during self-rebuild:

```sh
guest_vm/tests/run_standalone_snapshot_test.sh both
```

The script's default `js_min` selection does not require Node. `NODE_BINARY`,
`JS_MIN_BINARY` and `FIREFOX_LIB_DIR` can select installed hosts.

Byte identity across Node, js_min and a genuine self-build is the acceptance
criterion, not merely a successful hello. Keep host selection out of target
allocation order and target layouts. Do not introduce host pointers, clock
values or environment data into the serialized ready state. Building on Node
does not make arbitrary FFI-dependent applications executable inside Node;
run the emitted image through `js_runner` for that capability.
