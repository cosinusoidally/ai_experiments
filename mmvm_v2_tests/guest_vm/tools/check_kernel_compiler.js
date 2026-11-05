/* Run the existing broad kernel/backend integration checks without rebuilding
 * unrelated VM tests. From mmvm_v2_tests, use Node or js_min as the host. */
(function () {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var check, Compiler, JSBackend, X86Backend, Heap;
    if (nodeHost) {
        check = require("../tests/kernel_compiler_test.js");
        Compiler = require("../aot/kernel_compiler.js");
        JSBackend = require("../aot/backend_js.js");
        X86Backend = require("../aot/backend_x86.js");
        Heap = require("../heap.js");
    } else {
        load("guest_vm/guest_vm.js");
        load("guest_vm/tests/kernel_compiler_test.js");
        check = GuestVMRunKernelCompilerTest;
        Compiler = GuestVMKernelCompiler;
        JSBackend = GuestVMKernelJSBackend;
        X86Backend = GuestVMKernelX86Backend;
        Heap = GuestVMHeap;
    }
    var result = check(Compiler, JSBackend, X86Backend, Heap);
    if (nodeHost) console.log(result);
    else print(result);
}());
