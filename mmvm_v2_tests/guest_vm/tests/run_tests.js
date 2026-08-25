/* Portable guest-VM suite driver. Run this file with either Node.js or
 * js_min.exe; run_tests.sh selects one host or both. */
(function () {
    var isNode = typeof module !== "undefined" && module.exports;
    var VM;
    var readSource;

    if (isNode) {
        require("./tokenizer_test.js");
        VM = require("../vm.js");
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
        load("guest_vm/runtime.js");
        load("guest_vm/interpreter.js");
        load("guest_vm/vm.js");
        VM = GuestVM;
        readSource = function (relativePath) {
            return read("guest_vm/tests/" + relativePath);
        };
    }

    var languageTests = [
        "language/arithmetic.js",
        "language/for_loop.js"
    ];
    var totalAssertions = 0;
    var testIndex = 0;
    while (testIndex < languageTests.length) {
        var testPath = languageTests[testIndex];
        var vm = new VM();
        vm.run(readSource(testPath), testPath);
        totalAssertions += vm.runtime.assertions;
        var result = testPath + ": passed " + vm.runtime.assertions +
                     " assertion(s)";
        if (typeof print === "function") print(result);
        else console.log(result);
        testIndex++;
    }

    var summary = "guest VM suite passed: " + languageTests.length +
                  " guest program(s), " + totalAssertions +
                  " guest assertion(s)";
    if (typeof print === "function") print(summary);
    else console.log(summary);
}());
