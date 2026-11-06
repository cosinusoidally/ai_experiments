/* Run the existing native interpreter integration in isolation. This is a
 * diagnostic entrypoint, not a second test implementation. Node or js_min:
 * check_native_interpreter.js [--predecode] [--allocation-stack] */
(function (shellArguments) {
    var node = typeof module !== "undefined" && module.exports;
    var VM, Heap, Native, bytecode, run, args, output;
    if (node) {
        VM = require("../vm.js");
        Heap = require("../heap.js");
        Native = require("../aot/native_interpreter.js");
        bytecode = require("../bytecode.js");
        run = require("../tests/native_interpreter_test.js");
        args = process.argv.slice(2);
        output = function (text) { console.log(text); };
    } else {
        load("guest_vm/guest_vm.js");
        load("guest_vm/aot/native_interpreter.js");
        load("guest_vm/tests/native_interpreter_test.js");
        VM = GuestVM; Heap = GuestVMHeap; Native = GuestVMNativeInterpreter;
        bytecode = GuestVMBytecode; run = GuestVMRunNativeInterpreterTest;
        args = shellArguments; output = print;
    }
    var predecode = false, stack = false;
    for (var index = 0; index < args.length; index++) {
        if (args[index] === "--predecode") predecode = true;
        else if (args[index] === "--allocation-stack") stack = true;
        else throw new Error("unknown option: " + args[index]);
    }
    var original = Heap.prototype.allocateRecordWords;
    if (stack) Heap.prototype.allocateRecordWords = function () {
        try { return original.apply(this, arguments); }
        catch (error) {
            output("allocation failure: " + error);
            output("allocation stack: " + new Error().stack);
            throw error;
        }
    };
    try { output(run(VM, Native, bytecode, predecode)); }
    catch (error) {
        output("integration failure: " + error);
        if (error && error.stack) output(error.stack);
        throw error;
    }
    finally { Heap.prototype.allocateRecordWords = original; }
}(typeof arguments === "undefined" ? [] : arguments));
