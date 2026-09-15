if (typeof __guestVMStandaloneRunGuestRunner === "function") {
    __guestVMStandaloneRunGuestRunner(arguments);
} else {
var guestRunnerIsNode = typeof process !== "undefined" && process.argv &&
                        process.versions && process.versions.node &&
                        typeof require === "function";
var GuestRunnerVM;
var GuestRunnerNodeEnvironment;
var guestRunnerArguments = [];
var guestRunnerProfile = false;
var guestRunnerTraceExceptions = false;
var guestRunnerVerifyHeap = false;
var guestRunnerThreaded = false;
var guestRunnerNative = false;
var guestRunnerSnapshot = null;
var guestRunnerWithSnapshot = null;
var guestRunnerSkipSnapshotHash = false;
var guestRunnerForbidHostCalls = false;
var guestRunnerProfileDuration = 0;

if (guestRunnerIsNode) {
    GuestRunnerVM = require("./guest_vm/vm.js");
    GuestRunnerNodeEnvironment = require("./guest_vm/node_environment.js");
    guestRunnerArguments = process.argv.slice(2);
} else {
    if (typeof GuestVM === "undefined") load("guest_vm/guest_vm.js");
    if (typeof GuestNodeEnvironment === "undefined") {
        load("guest_vm/node_environment.js");
    }
    GuestRunnerVM = GuestVM;
    GuestRunnerNodeEnvironment = GuestNodeEnvironment;
    for (var guestArgumentIndex = 0;
         guestArgumentIndex < arguments.length; guestArgumentIndex++) {
        guestRunnerArguments.push(arguments[guestArgumentIndex]);
    }
}

var guestRunnerProgramArguments = [];
var guestRunnerFoundProgram = false;
for (var guestRunnerOptionIndex = 0;
     guestRunnerOptionIndex < guestRunnerArguments.length;
     guestRunnerOptionIndex++) {
    if (guestRunnerFoundProgram) {
        guestRunnerProgramArguments.push(
            guestRunnerArguments[guestRunnerOptionIndex]);
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-profile") {
        guestRunnerProfile = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-trace-exceptions") {
        guestRunnerTraceExceptions = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-verify-heap") {
        guestRunnerVerifyHeap = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-threaded") {
        guestRunnerThreaded = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-native") {
        guestRunnerNative = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-no-host-calls") {
        guestRunnerForbidHostCalls = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--snapshot" ||
               guestRunnerArguments[guestRunnerOptionIndex] ===
               "--with-snapshot") {
        var guestSnapshotOption = guestRunnerArguments[guestRunnerOptionIndex];
        guestRunnerOptionIndex++;
        if (guestRunnerOptionIndex >= guestRunnerArguments.length) {
            throw new Error(guestSnapshotOption + " requires a snapshot file");
        }
        if (guestSnapshotOption === "--snapshot") {
            guestRunnerSnapshot =
                guestRunnerArguments[guestRunnerOptionIndex];
        } else {
            guestRunnerWithSnapshot =
                guestRunnerArguments[guestRunnerOptionIndex];
        }
        guestRunnerNative = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--skip-snapshot-hash") {
        guestRunnerSkipSnapshotHash = true;
        guestRunnerNative = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-profile-duration") {
        guestRunnerOptionIndex++;
        if (guestRunnerOptionIndex >= guestRunnerArguments.length) {
            throw new Error("--vm-profile-duration requires milliseconds");
        }
        guestRunnerProfileDuration =
            Number(guestRunnerArguments[guestRunnerOptionIndex]);
        if (!(guestRunnerProfileDuration > 0)) {
            throw new Error("--vm-profile-duration must be positive");
        }
        guestRunnerProfile = true;
    } else {
        guestRunnerProgramArguments.push(guestRunnerArguments[guestRunnerOptionIndex]);
        guestRunnerFoundProgram = true;
    }
}
guestRunnerArguments = guestRunnerProgramArguments;

if (!guestRunnerArguments.length) {
    var guestUsage = "usage: guest_runner.js [--vm-profile] " +
                     "[--vm-trace-exceptions] " +
                     "[--vm-verify-heap] [--vm-threaded] " +
                     "[--vm-no-host-calls] " +
                     "[--vm-profile-duration milliseconds] " +
                     "[--vm-native] [--snapshot file | " +
                     "--with-snapshot file [--skip-snapshot-hash]] program.js";
    if (typeof print === "function") print(guestUsage);
    else console.error(guestUsage);
    if (guestRunnerIsNode) process.exit(2);
    else quit(2);
}

var guestProgramPath = guestRunnerArguments[0];
var guestProgramSource;
if (guestRunnerIsNode) {
    guestProgramSource = require("fs").readFileSync(guestProgramPath, "utf8");
} else if (typeof NodeFs !== "undefined") {
    guestProgramSource = NodeFs.readFileSync(guestProgramPath).toString("utf8");
} else guestProgramSource = read(guestProgramPath);
var guestProgramVM = new GuestRunnerVM({rawFFI: !guestRunnerIsNode,
                                        profile: guestRunnerProfile,
                                        traceExceptions:
                                            guestRunnerTraceExceptions,
                                        forbidHostCalls:
                                            guestRunnerForbidHostCalls,
                                        verifyNativeHeap: guestRunnerVerifyHeap,
                                        gcThreshold: 16384,
                                        nativeInterpreter: guestRunnerNative,
                                        snapshot: guestRunnerSnapshot,
                                        deferSnapshotWrite:
                                            !!guestRunnerSnapshot,
                                        withSnapshot: guestRunnerWithSnapshot,
                                        skipSnapshotHash:
                                            guestRunnerSkipSnapshotHash,
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
    if (guestRunnerSnapshot && guestProgramPath === "guest_runner.js") {
        guestNodeEnvironment.prepareStandaloneRuntimeSnapshot();
    }
    guestProgramVM.installGlobal("arguments",
        guestProgramVM.runtime.arrayFrom(guestRunnerArguments.slice(1)));
    var guestExecution = guestProgramVM.start(
        guestRunnerSnapshot && guestProgramPath === "guest_runner.js" ?
            read("guest_vm/standalone_source_runner.js") : guestProgramSource,
        guestRunnerSnapshot && guestProgramPath === "guest_runner.js" ?
            "guest_vm/standalone_source_runner.js" : guestProgramPath);
    if (guestRunnerSnapshot) {
        if (!guestProgramVM.runtime.nativeInterpreter.writeStandaloneSnapshot(
                guestRunnerSnapshot, guestExecution,
                guestProgramPath === "guest_runner.js" ? null :
                    guestProgramPath)) {
            throw new Error("could not write standalone snapshot: " +
                            guestRunnerSnapshot);
        }
        if (typeof print === "function") {
            print("wrote standalone snapshot: " + guestRunnerSnapshot);
        } else if (typeof console !== "undefined" && console.log) {
            console.log("wrote standalone snapshot: " + guestRunnerSnapshot);
        }
    }
    var guestRunnerProfileStarted = new Date().getTime();
    var guestRunnerStoppedForProfile = false;
    var guestRunnerSnapshotOnly = guestRunnerSnapshot &&
        guestProgramPath === "guest_runner.js";
    var guestRunnerResumeBudget = guestRunnerProfileDuration > 0 ?
        1000000 : guestProgramVM.runtime.synchronousExecutionBudget();
    while (!guestRunnerSnapshotOnly) {
        var guestExecutionResult = guestExecution.resume(
            guestRunnerResumeBudget);
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
        if (guestRunnerProfileDuration > 0 &&
            new Date().getTime() - guestRunnerProfileStarted >=
                guestRunnerProfileDuration) {
            guestRunnerStoppedForProfile = true;
            break;
        }
    }
    if (guestRunnerSnapshotOnly) {
        /* The generic entry obtains its real argc/argv from js_runner. */
    } else if (guestRunnerStoppedForProfile) {
        if (typeof print === "function") {
            print("guest runner: stopped at an instruction-budget boundary " +
                  "after " + guestRunnerProfileDuration + " ms");
        } else console.log(
            "guest runner: stopped at an instruction-budget boundary after " +
            guestRunnerProfileDuration + " ms");
    } else if (!guestNodeEnvironment.exiting) {
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
}
