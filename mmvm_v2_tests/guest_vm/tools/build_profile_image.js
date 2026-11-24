/* Optional build diagnostic on Node or js_min. Symbols never enter the image.
 * Node writes the existing JSON sidecar; both hosts print function offsets
 * so cross-host instruction selection can be compared without a JSON API in
 * the old shell. Use the ordinary runner arguments after this file, or
 * --kernel-source NAME to inspect a function's host-visible input source
 * without serializing a snapshot. */
var profileNodeHost = typeof module !== "undefined" && module.exports;
var fs, Backend;
if (profileNodeHost) {
    fs = require("fs");
    Backend = require("../aot/backend_x86.js");
} else {
    load("guest_vm/guest_vm.js");
    Backend = GuestVMKernelX86Backend;
}
var profileArguments = profileNodeHost ? process.argv.slice(2) : arguments;
if (profileArguments[0] === "--kernel-source") {
    var ProfileVM = profileNodeHost ? require("../vm.js") : GuestVM;
    var compileProfileKernel = Backend.prototype.compile;
    var profileSource = null;
    Backend.prototype.compile = function (ir) {
        if (ir.functions) {
            for (var index = 0; index < ir.functions.length; index++) {
                if (ir.functions[index].name === profileArguments[1]) profileSource = ir.functions[index].source;
            }
        }
        return compileProfileKernel.call(this, ir);
    };
    var profileVM;
    try {
        profileVM = new ProfileVM({nativeInterpreter: true});
        if (profileSource === null) throw new Error("unknown kernel function: " + profileArguments[1]);
        if (profileNodeHost) console.log(profileSource);
        else print(profileSource);
    } finally {
        Backend.prototype.compile = compileProfileKernel;
        if (profileVM) profileVM.destroy();
    }
} else {
var writeSnapshot = Backend.prototype.writeStandaloneSnapshot;
Backend.prototype.writeStandaloneSnapshot = function (
        path, result, runtime, execution, programPath, metadata) {
    var written = writeSnapshot.call(this, path, result, runtime, execution,
        programPath, metadata);
    if (written && profileNodeHost) fs.writeFileSync(path + ".symbols.json", JSON.stringify({
        sourceHash: metadata.sourceHash >>> 0,
        codeLength: result.length,
        registerAllocation: result.registerAllocation,
        symbols: result.symbols
    }));
    if (written) {
        for (var name in result.symbols) {
            if (Object.prototype.hasOwnProperty.call(result.symbols, name) &&
                name.indexOf("kernel_function_") === 0) {
                var line = "kernel-symbol " + name + " " + result.symbols[name];
                if (profileNodeHost) console.log(line);
                else print(line);
            }
        }
    }
    return written;
};
if (profileNodeHost) require("../../guest_runner.js");
else load("guest_runner.js");
}
