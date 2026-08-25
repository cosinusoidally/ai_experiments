var guestRunnerIsNode = typeof process !== "undefined" && process.argv &&
                        typeof require === "function";
var GuestRunnerVM;
var guestRunnerArguments = [];

if (guestRunnerIsNode) {
    GuestRunnerVM = require("./guest_vm/vm.js");
    guestRunnerArguments = process.argv.slice(2);
} else {
    load("guest_vm/guest_vm.js");
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
try {
    guestProgramVM.installGlobal("arguments",
        guestProgramVM.runtime.arrayFrom(guestRunnerArguments.slice(1)));
    var guestExecution = guestProgramVM.start(guestProgramSource, guestProgramPath);
    while (true) {
        var guestExecutionResult = guestExecution.resume(1000000);
        if (guestExecutionResult.status === "budget") {
            /* The command-line embedder grants another cooperative time slice. */
        } else if (guestExecutionResult.status === "hostCall") {
            guestExecution.serviceHostCall();
        } else if (guestExecutionResult.status === "completed") {
            break;
        } else if (guestExecutionResult.status === "threw") {
            throw guestExecutionResult.exception;
        } else {
            throw new Error("unknown guest execution status: " +
                            guestExecutionResult.status);
        }
    }
} finally {
    guestProgramVM.destroy();
}
