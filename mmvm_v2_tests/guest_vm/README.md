# Guest VM bootstrap

This directory contains the interpreter-first JavaScript guest VM described in
[`../GUEST_VM_PLAN.md`](../GUEST_VM_PLAN.md). It is intentionally a bootstrap,
not yet a complete ECMAScript 5 implementation. The currently implemented
language and Buffer features are always exercised by checked-in tests under
both Node.js and `js_min.exe`.

Read these documents before changing or embedding the VM:

- [`DESIGN.md`](DESIGN.md) defines the architecture, internal representations,
  invariants, bytecode ABI, collector, Buffer ownership, and extension rules.
- [`EMBEDDING.md`](EMBEDDING.md) documents the public bootstrap API, host loading,
  native functions, explicit roots, execution, errors, and shutdown.
- [`../GUEST_VM_PLAN.md`](../GUEST_VM_PLAN.md) records the intended route from
  this bootstrap to an ES5.1-capable interpreter and later optional kernel AOT.

Run the complete current suite with either host or both:

```sh
guest_vm/tests/run_tests.sh node
guest_vm/tests/run_tests.sh js_min
guest_vm/tests/run_tests.sh both
```

The runner accepts `NODE_BINARY`, `JS_MIN_BINARY`, and `FIREFOX_LIB_DIR`
environment overrides. It derives its default paths from the repository layout
and contains no machine-specific absolute paths.

Run one guest program directly with:

```sh
node guest_runner.js guest_vm/tests/language/for_loop.js

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js guest_vm/tests/language/for_loop.js
```

The exact relative paths in the second example assume the current working
directory is `mmvm_v2_tests` and the Firefox and MMVM directories are siblings
of the repository containing it.
