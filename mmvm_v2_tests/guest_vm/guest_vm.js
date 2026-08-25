/* Public guest-VM bootstrap. Shell embedders load this file once; CommonJS
 * embedders may require it as the package-free entry point. */
(function (root) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = require("./vm.js");
        return;
    }

    if (typeof root.GuestVM === "undefined") {
        load("guest_vm/tokenizer.js");
        load("guest_vm/parser.js");
        load("guest_vm/bytecode.js");
        load("guest_vm/compiler.js");
        load("guest_vm/verifier.js");
        load("guest_vm/host_ffi.js");
        load("guest_vm/host_memory.js");
        load("guest_vm/linear_memory.js");
        load("guest_vm/heap.js");
        load("guest_vm/value_cell.js");
        load("guest_vm/heap_records.js");
        load("guest_vm/aot/kernel_compiler.js");
        load("guest_vm/aot/backend_js.js");
        load("guest_vm/aot/x86_assembler.js");
        load("guest_vm/aot/backend_x86.js");
        load("guest_vm/aot/record_initializer.js");
        load("guest_vm/threaded_compiler.js");
        load("guest_vm/buffer.js");
        load("guest_vm/runtime.js");
        load("guest_vm/interpreter.js");
        load("guest_vm/vm.js");
    }
}(this));
