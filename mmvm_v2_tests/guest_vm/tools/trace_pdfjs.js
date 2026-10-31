/* Diagnostic of the unmodified external PdfJS workload. Compare character calls
 * between a standalone image and Node, without rewriting benchmark sources.
 * Node: node guest_vm/tools/trace_pdfjs.js
 * Guest: js_runner.exe IMAGE guest_vm/tools/trace_pdfjs.js
 * The first 100000 String.fromCharCode calls are logged after PDF setup;
 * compare the logs with diff to locate an initial decoding divergence.
 * The stock teardown still validates the complete rendering checksum.
 */
if (typeof load === "undefined") {
    var traceFS = require("fs"), traceVM = require("vm");
    global.print = function (message) { console.log(message); };
    global.load = function (filename) {
        traceVM.runInThisContext(traceFS.readFileSync(filename, "utf8"),
            {filename: filename});
    };
}
load("../../js_tests/octane/base.js");
load("../../js_tests/octane/pdfjs.js");
BenchmarkSuite.ResetRNG();
setupPdfJS();
var traceOriginalCharacter = String.fromCharCode;
var traceCharacterCount = 0;
String.fromCharCode = function (code) {
    if (traceCharacterCount < 100000) {
        print("character " + traceCharacterCount + " " + code);
    }
    traceCharacterCount++;
    return traceOriginalCharacter.apply(String, arguments);
};
runPdfJS();
tearDownPdfJS();
print("PdfJS correctness passed; character calls " + traceCharacterCount);
