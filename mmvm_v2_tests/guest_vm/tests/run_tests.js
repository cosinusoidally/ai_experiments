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
        var fs = require("fs");
        var path = require("path");
        readSource = function (relativePath) {
            return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
        };
    } else {
        load("guest_vm/tokenizer.js");
        load("guest_vm/tests/tokenizer_test.js");
        load("guest_vm/parser.js");
        load("guest_vm/bytecode.js");
        load("guest_vm/compiler.js");
        load("guest_vm/verifier.js");
        load("guest_vm/host_ffi.js");
        load("guest_vm/host_memory.js");
        load("guest_vm/buffer.js");
        load("guest_vm/runtime.js");
        load("guest_vm/interpreter.js");
        load("guest_vm/vm.js");
        load("guest_vm/tests/buffer/buffer_lifetime_test.js");
        load("guest_vm/tests/embedding_api_test.js");
        VM = GuestVM;
        runBufferLifetimeTest = GuestVMRunBufferLifetimeTest;
        runEmbeddingAPITest = GuestVMRunEmbeddingAPITest;
        readSource = function (relativePath) {
            return read("guest_vm/tests/" + relativePath);
        };
    }

    var guestTests = [
        {path: "language/arithmetic.js"},
        {path: "language/for_loop.js"},
        {path: "buffer/buffer_guest.js"}
    ];
    if (!isNode) guestTests.push({path: "../../hello.js", options: {rawFFI: true}});
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

    var summary = "guest VM suite passed: " + guestTests.length +
                  " guest program(s), " + totalAssertions +
                  " guest assertion(s)";
    if (typeof print === "function") print(summary);
    else console.log(summary);
}());
