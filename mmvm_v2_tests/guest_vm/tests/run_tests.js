/* Portable guest-VM suite driver. Run this file with either Node.js or
 * js_min.exe; run_tests.sh selects one host or both. */
(function () {
    var isNode = typeof module !== "undefined" && module.exports;
    var VM;
    var readSource;

    if (isNode) {
        require("./tokenizer_test.js");
        VM = require("../vm.js");
        var runBufferLifetimeTest = require("./buffer/buffer_lifetime_test.js");
        var runEmbeddingAPITest = require("./embedding_api_test.js");
        var runAutomaticGCTest = require("./automatic_gc_test.js");
        var runRuntimeContextExecutionTest = require(
            "./runtime_context_execution_test.js");
        var runErrorLocationTest = require("./error_location_test.js");
        var Heap = require("../heap.js");
        var ValueCells = require("../value_cell.js");
        var runHeapAccessTest = require("./heap_access_test.js");
        var runValueCellTest = require("./value_cell_test.js");
        var runRuntimeLinearHeapTest = require("./runtime_linear_heap_test.js");
        var fs = require("fs");
        var path = require("path");
        readSource = function (relativePath) {
            return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
        };
    } else {
        load("guest_vm/guest_vm.js");
        load("guest_vm/tests/tokenizer_test.js");
        load("guest_vm/tests/buffer/buffer_lifetime_test.js");
        load("guest_vm/tests/embedding_api_test.js");
        load("guest_vm/tests/automatic_gc_test.js");
        load("guest_vm/tests/runtime_context_execution_test.js");
        load("guest_vm/tests/error_location_test.js");
        load("guest_vm/tests/heap_access_test.js");
        load("guest_vm/tests/value_cell_test.js");
        load("guest_vm/tests/runtime_linear_heap_test.js");
        VM = GuestVM;
        runBufferLifetimeTest = GuestVMRunBufferLifetimeTest;
        runEmbeddingAPITest = GuestVMRunEmbeddingAPITest;
        runAutomaticGCTest = GuestVMRunAutomaticGCTest;
        runRuntimeContextExecutionTest = GuestVMRunRuntimeContextExecutionTest;
        runErrorLocationTest = GuestVMRunErrorLocationTest;
        Heap = GuestVMHeap;
        ValueCells = GuestVMValueCells;
        runHeapAccessTest = GuestVMRunHeapAccessTest;
        runValueCellTest = GuestVMRunValueCellTest;
        runRuntimeLinearHeapTest = GuestVMRunRuntimeLinearHeapTest;
        readSource = function (relativePath) {
            return read("guest_vm/tests/" + relativePath);
        };
    }

    var guestTests = [
        {path: "language/arithmetic.js"},
        {path: "language/for_loop.js"},
        {path: "language/functions_objects.js"},
        {path: "language/standard_library.js"},
        {path: "language/try_update.js"},
        {path: "language/object_control.js"},
        {path: "language/declaration_hoisting.js"},
        {path: "language/closure_fallback.js"},
        {path: "buffer/buffer_guest.js"}
    ];
    var totalAssertions = 0;
    var testIndex = 0;
    while (testIndex < guestTests.length) {
        var test = guestTests[testIndex];
        var testPath = test.path;
        var vm = new VM(test.options || {});
        vm.run(readSource(testPath), testPath);
        totalAssertions += vm.runtime.assertions;
        var result = testPath + ": passed " + vm.runtime.assertions +
                     " assertion(s)";
        if (typeof print === "function") print(result);
        else console.log(result);
        vm.destroy();
        testIndex++;
    }

    var lifetimeResult = runBufferLifetimeTest(VM);
    if (typeof print === "function") print(lifetimeResult);
    else console.log(lifetimeResult);
    var embeddingResult = runEmbeddingAPITest(VM);
    if (typeof print === "function") print(embeddingResult);
    else console.log(embeddingResult);
    var automaticGCResult = runAutomaticGCTest(VM);
    if (typeof print === "function") print(automaticGCResult);
    else console.log(automaticGCResult);
    var runtimeContextResult = runRuntimeContextExecutionTest(VM);
    if (typeof print === "function") print(runtimeContextResult);
    else console.log(runtimeContextResult);
    var errorLocationResult = runErrorLocationTest(VM);
    if (typeof print === "function") print(errorLocationResult);
    else console.log(errorLocationResult);
    var heapAccessResult = runHeapAccessTest(Heap);
    if (typeof print === "function") print(heapAccessResult);
    else console.log(heapAccessResult);
    var valueCellResult = runValueCellTest(Heap, ValueCells);
    if (typeof print === "function") print(valueCellResult);
    else console.log(valueCellResult);
    var runtimeLinearHeapResult = runRuntimeLinearHeapTest(VM);
    if (typeof print === "function") print(runtimeLinearHeapResult);
    else console.log(runtimeLinearHeapResult);

    var netCompileVM = new VM();
    netCompileVM.compile(readSource("../../net.js"), "net.js");
    netCompileVM.destroy();
    var netCompileResult = "unchanged net.js compiled";
    if (typeof print === "function") print(netCompileResult);
    else console.log(netCompileResult);

    var nodeWebCompileVM = new VM();
    nodeWebCompileVM.compile(readSource("../../node_web.js"), "node_web.js");
    nodeWebCompileVM.destroy();
    var nodeWebCompileResult = "unchanged node_web.js compiled";
    if (typeof print === "function") print(nodeWebCompileResult);
    else console.log(nodeWebCompileResult);

    var threadedVM = new VM({threadedCompile: true});
    threadedVM.run(readSource("language/functions_objects.js"),
                   "threaded_functions_objects.js");
    if (threadedVM.runtime.assertions !== 22) {
        throw new Error("threaded compiler assertion count changed");
    }
    threadedVM.destroy();
    var threadedResult = "structured compiler closures passed: 22 assertion(s)";
    if (typeof print === "function") print(threadedResult);
    else console.log(threadedResult);

    var threadedControlVM = new VM({threadedCompile: true});
    threadedControlVM.run(readSource("language/object_control.js"),
                          "threaded_object_control.js");
    if (threadedControlVM.runtime.assertions !== 8) {
        throw new Error("threaded compiler control-flow assertion count changed");
    }
    threadedControlVM.destroy();
    var threadedControlResult =
        "structured compiler object/control flow passed: 8 assertion(s)";
    if (typeof print === "function") print(threadedControlResult);
    else console.log(threadedControlResult);

    var summary = "guest VM suite passed: " + guestTests.length +
                  " guest program(s), " + totalAssertions +
                  " guest assertion(s)";
    if (typeof print === "function") print(summary);
    else console.log(summary);
}());
