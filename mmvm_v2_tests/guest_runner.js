var guestRunnerIsNode = typeof process !== "undefined" && process.argv &&
                        typeof require === "function";
var GuestRunnerVM;
var guestRunnerArguments = [];

if (guestRunnerIsNode) {
    GuestRunnerVM = require("./guest_vm/vm.js");
    guestRunnerArguments = process.argv.slice(2);
} else {
    load("guest_vm/tokenizer.js");
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
    GuestRunnerVM = GuestVM;
    for (var guestArgumentIndex = 0;
         guestArgumentIndex < arguments.length; guestArgumentIndex++) {
        guestRunnerArguments.push(arguments[guestArgumentIndex]);
    }
}

if (!guestRunnerArguments.length) {
    var guestUsage = "usage: guest_runner.js program.js";
    if (typeof print === "function") print(guestUsage);
    else console.error(guestUsage);
    if (guestRunnerIsNode) process.exit(2);
    else quit(2);
}

var guestProgramPath = guestRunnerArguments[0];
var guestProgramSource = guestRunnerIsNode ?
    require("fs").readFileSync(guestProgramPath, "utf8") : read(guestProgramPath);
var guestProgramVM = new GuestRunnerVM({rawFFI: !guestRunnerIsNode});
guestProgramVM.run(guestProgramSource, guestProgramPath);
var guestResultText = guestProgramPath + ": passed " +
                      guestProgramVM.runtime.assertions + " assertion(s)";
if (typeof print === "function") print(guestResultText);
else console.log(guestResultText);
