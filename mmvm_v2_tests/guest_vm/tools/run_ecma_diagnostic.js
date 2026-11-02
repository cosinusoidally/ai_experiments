/* Run an unchanged ECMA file through the portable guest backend, without
 * fork/transport masking the original VM implementation stack. This is a
 * debugger entry point, not a replacement for either scored suite runner.
 * node guest_vm/tools/run_ecma_diagnostic.js ecma/path/file.js [budget]
 *     [--trace-exceptions] [--compare-instanceof] [--compare-in] [--trace-file PATH]
 */
var fs = require("fs");
var Heap = require("../heap.js");
var VM = require("../vm.js");
var SemanticRuntime = require("../runtime.js");
var relative = process.argv[2], budget = 20000000;
var traceExceptions = false, compareInstanceof = false, compareIn = false;
var traceFile = null;
for (var optionIndex = 3; optionIndex < process.argv.length; optionIndex++) {
    var option = process.argv[optionIndex];
    if (option === "--trace-exceptions") traceExceptions = true;
    else if (option === "--compare-instanceof") compareInstanceof = true;
    else if (option === "--compare-in") compareIn = true;
    else if (option === "--trace-file") traceFile = process.argv[++optionIndex];
    else if (/^[0-9]+$/.test(option)) budget = Number(option);
    else throw new Error("unknown diagnostic option: " + option);
}
function diagnosticValue(value) {
    return value && value.heapAddress ? "<" + value.guestType + "@" + value.heapAddress + ">" : String(value);
}
if (compareInstanceof || compareIn || traceFile) {
    var NativeInterpreter = require("../aot/native_interpreter.js");
    var bytecode = require("../bytecode.js");
    var runNative = NativeInterpreter.prototype.run;
    NativeInterpreter.prototype.run = function (frame, program, slice, context) {
        var runtime = this.runtime, records = runtime.heapRecords;
        var pc = records.framePC(frame), code = program.code;
        var expected, value, constructor, comparable = false;
        var opcode = code[pc];
        if (traceFile && program.filename === traceFile) {
            var text = "step " + frame + " pc=" + pc + " " + bytecode.NAMES[opcode];
            var mask = bytecode.NATIVE_REGISTER_MASKS[opcode];
            for (var operand = 1; operand < bytecode.WIDTHS[opcode]; operand++) {
                if (mask & (1 << operand)) {
                    var register = code[pc + operand];
                    if (register >= 0) text += " r" + register + "=" + diagnosticValue(
                        runtime.readHeapValue(records.frameRegisterCell(frame, register)));
                }
            }
            console.error(text);
        }
        if ((compareInstanceof && opcode === bytecode.INSTANCEOF) ||
            (compareIn && opcode === bytecode.IN)) {
            value = runtime.readHeapValue(records.frameRegisterCell(frame, code[pc + 2]));
            constructor = runtime.readHeapValue(records.frameRegisterCell(frame, code[pc + 3]));
            if (opcode === bytecode.IN && constructor && constructor.heapAddress) {
                comparable = true;
                expected = runtime.hasProperty(constructor, value);
            } else if (constructor && constructor.heapAddress) {
                var entry = runtime.heapOwnProperty(constructor, "prototype", false);
                comparable = !!entry && !(records.ownPropertyEntryAttributes(
                    constructor.heapAddress, entry) & records.constructor.Attributes.ACCESSOR);
                if (comparable) expected = runtime.instanceOf(value, constructor);
            }
        }
        /* Debug-only single stepping makes completed native instructions
         * observable, not just unsupported exits. No source is rewritten. */
        var result = runNative.call(this, frame, program, Math.min(slice, 1), context);
        if (comparable) {
            var actual = runtime.readHeapValue(records.frameRegisterCell(frame, code[pc + 1]));
            console.error(bytecode.NAMES[opcode] + " " + program.filename + ":pc=" + pc +
                " value=" + diagnosticValue(value) +
                " constructor=" + constructor.heapAddress +
                " native=" + actual + " reference=" + expected);
        }
        return result;
    };
}
if (traceExceptions) {
    var reportException = SemanticRuntime.prototype.reportExceptionState;
    SemanticRuntime.prototype.reportExceptionState = function (error, frame) {
        reportException.call(this, error, frame);
        var address = frame && frame.heapAddress, depth = 0;
        while (address && depth++ < 8) {
            var program = this.adoptHeapProgram(this.heapRecords.frameProgram(address));
            var pc = this.heapRecords.framePC(address), location = null, scan = pc;
            while (program.sourceLocations && scan >= 0 && !location) location = program.sourceLocations[scan--];
            console.error("  frame " + (program.name || "<script>") + " " +
                program.filename + ":" + (location && location.line || 0) +
                ":" + (location && location.column || 0) + " pc=" + pc);
            address = this.heapRecords.frameCaller(address);
        }
    };
    var importException = SemanticRuntime.prototype.importCaughtException;
    SemanticRuntime.prototype.importCaughtException = function (error) {
        var value = importException.call(this, error);
        console.error("caught exception: source=" + (error && error.name || typeof error) +
            "; message=" + (error && error.message || "") +
            "; value=" + (value && value.guestType || typeof value) +
            "; prototype=" + (value && value.heapAddress ? this.heapRecords.objectPrototype(value.heapAddress) : 0) +
            "; TypeError.prototype=" + (this.errorPrototypes && this.errorPrototypes.$TypeError ?
                this.errorPrototypes.$TypeError.heapAddress : 0));
        return value;
    };
}
global.GuestVM = function (options) {
    /* The reference backend emulates memory, not raw i386 FFI. Language
     * execution and the existing ECMA embedding otherwise stay unchanged. */
    options.rawFFI = false;
    options.traceExceptions = traceExceptions;
    return new VM(options);
};
global.GuestVM.prototype = VM.prototype;
global.GuestNodeEnvironment = require("../node_environment.js");
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
