var guestRunnerIsNode = typeof process !== "undefined" && process.argv &&
                        typeof require === "function";
var GuestRunnerVM;
var GuestRunnerNodeEnvironment;
var guestRunnerArguments = [];
var guestRunnerProfile = false;
var guestRunnerVerifyHeap = false;
var guestRunnerThreaded = false;
var guestRunnerNative = false;

if (guestRunnerIsNode) {
    GuestRunnerVM = require("./guest_vm/vm.js");
    GuestRunnerNodeEnvironment = require("./guest_vm/node_environment.js");
    guestRunnerArguments = process.argv.slice(2);
} else {
    load("guest_vm/guest_vm.js");
    load("guest_vm/node_environment.js");
    GuestRunnerVM = GuestVM;
    GuestRunnerNodeEnvironment = GuestNodeEnvironment;
    for (var guestArgumentIndex = 0;
         guestArgumentIndex < arguments.length; guestArgumentIndex++) {
        guestRunnerArguments.push(arguments[guestArgumentIndex]);
    }
}

var guestRunnerProgramArguments = [];
for (var guestRunnerOptionIndex = 0;
     guestRunnerOptionIndex < guestRunnerArguments.length;
     guestRunnerOptionIndex++) {
    if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-profile") {
        guestRunnerProfile = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-verify-heap") {
        guestRunnerVerifyHeap = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-threaded") {
        guestRunnerThreaded = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-native") {
        guestRunnerNative = true;
    } else {
        guestRunnerProgramArguments.push(guestRunnerArguments[guestRunnerOptionIndex]);
    }
}
guestRunnerArguments = guestRunnerProgramArguments;

if (!guestRunnerArguments.length) {
    var guestUsage = "usage: guest_runner.js [--vm-profile] " +
                     "[--vm-verify-heap] [--vm-threaded] " +
                     "[--vm-native] program.js";
    if (typeof print === "function") print(guestUsage);
    else console.error(guestUsage);
    if (guestRunnerIsNode) process.exit(2);
    else quit(2);
}

var guestProgramPath = guestRunnerArguments[0];
var guestProgramSource = guestRunnerIsNode ?
    require("fs").readFileSync(guestProgramPath, "utf8") : read(guestProgramPath);
var guestProgramVM = new GuestRunnerVM({rawFFI: !guestRunnerIsNode,
                                        profile: guestRunnerProfile,
                                        verifyNativeHeap: guestRunnerVerifyHeap,
                                        gcThreshold: 16384,
                                        nativeInterpreter: guestRunnerNative,
                                        threadedCompile: !guestRunnerNative &&
                                            (!guestRunnerIsNode ||
                                             guestRunnerThreaded)});
var guestNodeEnvironment = new GuestRunnerNodeEnvironment(
    guestProgramVM, guestRunnerArguments);
var guestRunnerDeferredCleanup = false;
var guestRunnerCleaned = false;
var guestRunnerFailure = null;

function guestRunnerDescribeError(error) {
    var properties = error && error.properties;
    function guestErrorProperty(name) {
        if (!error || !error.guestType) return undefined;
        try {
            return guestProgramVM.runtime.getProperty(error, name);
        } catch (ignored) {
            return undefined;
        }
    }
    var filename = error && (error.guestFilename || error.fileName) ||
                   properties && properties.$fileName ||
                   guestErrorProperty("fileName") || "<guest>";
    var line = error && (error.guestLine || error.lineNumber) ||
               properties && properties.$lineNumber ||
               guestErrorProperty("lineNumber") || 1;
    var column = error && (error.guestColumn || error.columnNumber) ||
                 properties && properties.$columnNumber ||
                 guestErrorProperty("columnNumber") || 1;
    var name = properties && properties.$name || guestErrorProperty("name") ||
               error && error.name || "Error";
    var message = properties && properties.$message || error && error.message ||
                  guestErrorProperty("message") ||
                  String(error);
    return filename + ":" + line + ":" + column + ": " + name +
           (message ? ": " + message : "");
}

function guestRunnerCleanup() {
    if (guestRunnerCleaned) return;
    guestRunnerCleaned = true;
    if (guestRunnerProfile) guestProgramVM.runtime.reportProfile();
    guestNodeEnvironment.destroy();
    guestProgramVM.destroy();
}

try {
    guestProgramVM.installGlobal("arguments",
        guestProgramVM.runtime.arrayFrom(guestRunnerArguments.slice(1)));
    var guestExecution = guestProgramVM.start(guestProgramSource, guestProgramPath);
    while (true) {
        var guestExecutionResult = guestExecution.resume(
            guestProgramVM.runtime.synchronousExecutionBudget());
        if (guestExecutionResult.status === "budget") {
            /* The command-line embedder grants another cooperative time slice. */
        } else if (guestExecutionResult.status === "hostCall") {
            guestExecution.serviceHostCall();
        } else if (guestExecutionResult.status === "completed") {
            break;
        } else if (guestExecutionResult.status === "threw") {
            if (guestNodeEnvironment.isExit(guestExecutionResult.exception)) break;
            throw guestExecutionResult.exception;
        } else {
            throw new Error("unknown guest execution status: " +
                            guestExecutionResult.status);
        }
    }
    if (!guestNodeEnvironment.exiting) {
        guestNodeEnvironment.run();
    }
    if (guestRunnerIsNode) {
        guestRunnerDeferredCleanup = true;
        process.on("exit", guestRunnerCleanup);
    }
} catch (guestRunnerError) {
    guestRunnerFailure = guestRunnerError;
    var guestRunnerDescription = guestRunnerDescribeError(guestRunnerError);
    if (typeof print === "function") print(guestRunnerDescription);
    else if (typeof console !== "undefined" && console.error) {
        console.error(guestRunnerDescription);
    }
} finally {
    if (!guestRunnerDeferredCleanup) guestRunnerCleanup();
}

if (guestRunnerFailure) {
    if (!guestRunnerIsNode && typeof quit === "function") quit(3);
    throw guestRunnerFailure;
}

if (!guestRunnerIsNode) quit(guestNodeEnvironment.exitCode);
