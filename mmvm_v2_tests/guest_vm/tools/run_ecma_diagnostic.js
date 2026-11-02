/* Run an unchanged ECMA file through the portable guest backend, without
 * fork/transport masking the original VM implementation stack. This is a
 * debugger entry point, not a replacement for either scored suite runner.
 * node guest_vm/tools/run_ecma_diagnostic.js ecma/path/file.js [budget]
 */
var fs = require("fs");
var Heap = require("../heap.js");
var VM = require("../vm.js");
global.GuestVM = function (options) {
    /* The reference backend emulates memory, not raw i386 FFI. Language
     * execution and the existing ECMA embedding otherwise stay unchanged. */
    options.rawFFI = false;
    return new VM(options);
};
global.GuestVM.prototype = VM.prototype;
global.GuestNodeEnvironment = require("../node_environment.js");
var relative = process.argv[2], budget = Number(process.argv[3] || 20000000);
if (!relative || relative.indexOf("..") >= 0 || !/^ecma(?:_[235])?\//.test(relative) ||
        !(budget > 0 && budget === Math.floor(budget))) {
    throw new Error("expected corpus-relative ecma/file.js and optional positive instruction budget");
}
var reported = false, requireRecord = Heap.prototype.requireRecord;
Heap.prototype.requireRecord = function () {
    try { return requireRecord.apply(this, arguments); }
    catch (error) {
        if (!reported) {
            reported = true;
            console.error("First heap validation failure:\n" + error.stack);
        }
        throw error;
    }
};
var root = "../../js_tests/tests/", filename = root + relative;
var parts = relative.split("/"), directory = root, harness = [];
for (var index = 0; index < parts.length - 1; index++) {
    directory += parts[index] + "/";
    if (fs.existsSync(directory + "shell.js")) harness.push(directory + "shell.js");
}
harness.push("ecma_tests_capture.js");
var backend = require("../../ecma_tests_guest.js").create(fs);
try {
    var result = backend.runTest(filename, fs.readFileSync(filename, "utf8"),
        harness, /-n\.js$/.test(relative), budget);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "completed") process.exitCode = 1;
} finally { backend.destroy(); }
