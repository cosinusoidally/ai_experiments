/* Running applications can use the existing standalone runtime. Rebuilding
 * must instead execute the ordinary constructor/compiler/serializer below;
 * exporting the image that launched us is not a self-hosted rebuild. */
function guestRunnerRequestsSnapshot(runnerArguments) {
    var index = 0;
    while (index < runnerArguments.length) {
        var option = runnerArguments[index++];
        if (option === "--snapshot") return true;
        if (option === "--with-snapshot" ||
            option === "--vm-max-heap-mib" ||
            option === "--vm-profile-duration") index++;
        else if (option.charAt(0) !== "-") return false;
    }
    return false;
}

if (typeof __guestVMStandaloneRunGuestRunner === "function" &&
    !guestRunnerRequestsSnapshot(arguments)) {
    __guestVMStandaloneRunGuestRunner(arguments);
} else {
var guestRunnerIsNode = typeof process !== "undefined" && process.argv &&
                        process.versions && process.versions.node &&
                        typeof require === "function";
var GuestRunnerVM;
var GuestRunnerNodeEnvironment;
var guestRunnerArguments = [];
var guestRunnerProfile = false;
var guestRunnerNativeSamples = false;
var guestRunnerSampler = null;
var guestRunnerTraceExceptions = false;
var guestRunnerVerifyHeap = false;
var guestRunnerThreaded = false;
var guestRunnerNative = false;
var guestRunnerPredecode = false;
var guestRunnerSnapshot = null;
var guestRunnerWithSnapshot = null;
var guestRunnerSkipSnapshotHash = false;
var guestRunnerForbidHostCalls = false;
var guestRunnerLogHostCalls = false;
var guestRunnerProfileDuration = 0;
var guestRunnerGCStress = false;
var guestRunnerMaxHeapBytes;
var guestRunnerBuildSourcesStarted = new Date().getTime();

if (guestRunnerIsNode) {
    var print = function (message) { console.log(message); };
    var read = function (filename) {
        return require("fs").readFileSync(filename).toString("utf8");
    };
    GuestRunnerVM = require("./guest_vm/vm.js");
    GuestRunnerNodeEnvironment = require("./guest_vm/node_environment.js");
    guestRunnerArguments = process.argv.slice(2);
} else {
    if (typeof __guestVMStandaloneRunGuestRunner === "function" &&
        guestRunnerRequestsSnapshot(arguments)) {
        /* The loaded implementation is the bootstrap compiler, not the build
         * input. Reload the implementation from disk so source changes are
         * reflected in the newly compiled image. */
        GuestVM = undefined;
        GuestNodeEnvironment = undefined;
        print("loading guest VM build sources");
        if (typeof read !== "function") {
            read = function (filename) {
                return require("fs").readFileSync(filename).toString("utf8");
            };
        }
    }
    if (typeof GuestVM === "undefined") load("guest_vm/guest_vm.js");
    if (typeof GuestNodeEnvironment === "undefined") {
        load("guest_vm/node_environment.js");
    }
    if (typeof __guestVMStandaloneRunGuestRunner === "function" &&
        guestRunnerRequestsSnapshot(arguments)) {
        print("loaded guest VM build sources");
    }
    GuestRunnerVM = GuestVM;
    GuestRunnerNodeEnvironment = GuestNodeEnvironment;
    for (var guestArgumentIndex = 0;
         guestArgumentIndex < arguments.length; guestArgumentIndex++) {
        guestRunnerArguments.push(arguments[guestArgumentIndex]);
    }
}

var guestRunnerBuildSourcesElapsed = new Date().getTime() -
    guestRunnerBuildSourcesStarted;
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
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-native-samples") {
        guestRunnerNativeSamples = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-trace-exceptions") {
        guestRunnerTraceExceptions = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-verify-heap") {
        guestRunnerVerifyHeap = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-gc-stress") {
        guestRunnerGCStress = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-max-heap-mib") {
        var guestRunnerHeapMiB = Number(
            guestRunnerArguments[++guestRunnerOptionIndex]);
        if (!(guestRunnerHeapMiB >= 64 && guestRunnerHeapMiB <= 1024 &&
                guestRunnerHeapMiB === Math.floor(guestRunnerHeapMiB))) {
            throw new RangeError("--vm-max-heap-mib requires an integer from 64 to 1024");
        }
        guestRunnerMaxHeapBytes = guestRunnerHeapMiB * 1024 * 1024;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-threaded") {
        guestRunnerThreaded = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-native") {
        guestRunnerNative = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] === "--vm-predecode") {
        guestRunnerPredecode = true;
        guestRunnerNative = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-no-host-calls") {
        guestRunnerForbidHostCalls = true;
    } else if (guestRunnerArguments[guestRunnerOptionIndex] ===
               "--vm-log-host-calls") {
        guestRunnerLogHostCalls = true;
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

if (!guestRunnerArguments.length && !guestRunnerSnapshot) {
    var guestUsage = "usage: guest_runner.js [--vm-profile] " +
                     "[--vm-native-samples] " +
                     "[--vm-trace-exceptions] " +
                     "[--vm-verify-heap] [--vm-threaded] " +
                     "[--vm-gc-stress] " +
                     "[--vm-max-heap-mib 64..1024] " +
                     "[--vm-no-host-calls] " +
                     "[--vm-log-host-calls] " +
                     "[--vm-profile-duration milliseconds] " +
                     "[--vm-native] [--vm-predecode] [--snapshot file | " +
                     "--with-snapshot file [--skip-snapshot-hash]] " +
                     "[program.js]";
    if (typeof print === "function") print(guestUsage);
    else console.error(guestUsage);
    if (guestRunnerIsNode) process.exit(2);
    else quit(2);
}

var guestProgramPath = guestRunnerArguments[0];
var guestProgramSource;
if (guestRunnerSnapshot) {
    var guestRunnerSourceTiming = "guest VM source loading: " +
        guestRunnerBuildSourcesElapsed + " ms";
    if (typeof print === "function") print(guestRunnerSourceTiming);
    else console.log(guestRunnerSourceTiming);
}
var guestRuntimeConstructionStarted = guestRunnerSnapshot ?
    new Date().getTime() : 0;
if (guestRunnerNativeSamples) {
    if (guestRunnerIsNode || typeof __guestVMStandaloneImageBase === "undefined" ||
            !__guestVMStandaloneImageBase) {
        throw new Error("--vm-native-samples requires a self-hosted standalone build");
    }
    load("guest_vm/native_sampler.js");
    guestRunnerSampler = new GuestVMNativeSampler(__guestVMStandaloneImageBase);
}
var guestProgramVM = new GuestRunnerVM({rawFFI: !guestRunnerIsNode || !!guestRunnerSnapshot,
                                        rawFFIBridge: guestRunnerIsNode && guestRunnerSnapshot ?
                                            require("./guest_vm/host_ffi.js").snapshotBindings() : null,
                                        profile: guestRunnerProfile,
                                        traceExceptions:
                                            guestRunnerTraceExceptions,
                                        forbidHostCalls:
                                            guestRunnerForbidHostCalls,
                                        logHostCalls:
                                            guestRunnerLogHostCalls,
                                        verifyNativeHeap: guestRunnerVerifyHeap,
                                        maxHeapBytes: guestRunnerMaxHeapBytes,
                                        gcThreshold: 16384,
                                        nativeInterpreter: guestRunnerNative,
                                        nativeOperandPredecode: guestRunnerPredecode,
                                        snapshot: guestRunnerSnapshot,
                                        deferSnapshotWrite:
                                            !!guestRunnerSnapshot,
                                        withSnapshot: guestRunnerWithSnapshot,
                                        skipSnapshotHash:
                                            guestRunnerSkipSnapshotHash,
                                        threadedCompile: !guestRunnerNative &&
                                            (!guestRunnerIsNode ||
                                             guestRunnerThreaded)});
if (guestRunnerSnapshot) {
    print("constructed guest runtime in " +
        (new Date().getTime() - guestRuntimeConstructionStarted) + " ms");
}
var guestEnvironmentConstructionStarted = guestRunnerSnapshot ?
    new Date().getTime() : 0;
var guestNodeEnvironment = new GuestRunnerNodeEnvironment(
    guestProgramVM, guestRunnerSnapshot ? ["guest_runner.js"] :
                                          guestRunnerArguments,
    !!guestRunnerSnapshot);
if (guestRunnerSnapshot) {
    print("installed guest environment in " +
        (new Date().getTime() - guestEnvironmentConstructionStarted) + " ms");
}
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
    if (guestRunnerSampler) {
        var samplerReport = guestRunnerSampler.finish(
            guestProgramVM.runtime.nativeInterpreter.nativeResult.symbols,
            guestProgramVM.runtime.nativeInterpreter.snapshotMetadata.sourceHash);
        for (var samplerLine = 0; samplerLine < samplerReport.length; samplerLine++) {
            print(samplerReport[samplerLine]);
        }
    }
    if (guestRunnerProfile) guestProgramVM.runtime.reportProfile();
    guestNodeEnvironment.destroy();
    guestProgramVM.destroy();
}

try {
    if (guestRunnerSnapshot) {
        /* Snapshot a fixed, generic command-line boundary before the requested
         * application is opened or represented in the guest heap.  The
         * temporary environment deliberately has fixed arguments, so the
         * emitted bytes cannot depend on the program run after this point. */
        print("preparing standalone runtime");
        var guestStandalonePreparationStarted = new Date().getTime();
        guestNodeEnvironment.prepareStandaloneRuntimeSnapshot();
        print("prepared standalone runtime in " +
            (new Date().getTime() - guestStandalonePreparationStarted) + " ms");
        var guestSnapshotSerializationStarted = new Date().getTime();
        var guestSnapshotExecution = guestProgramVM.start(
            read("guest_vm/standalone_source_runner.js"),
            "guest_vm/standalone_source_runner.js");
        if (!guestProgramVM.runtime.nativeInterpreter.writeStandaloneSnapshot(
                guestRunnerSnapshot, guestSnapshotExecution, null)) {
            throw new Error("could not write standalone snapshot: " +
                            guestRunnerSnapshot);
        }
        guestSnapshotExecution.abort();
        if (typeof print === "function") {
            print("wrote standalone snapshot: " + guestRunnerSnapshot +
                " in " + (new Date().getTime() -
                    guestSnapshotSerializationStarted) + " ms");
        } else if (typeof console !== "undefined" && console.log) {
            console.log("wrote standalone snapshot: " + guestRunnerSnapshot);
        }
    }

    if (guestProgramPath) {
        if (guestRunnerGCStress) guestProgramVM.runtime.gcThreshold = 256;
        if (guestRunnerGCStress && guestProgramVM.runtime.nativeInterpreter) {
            guestProgramVM.runtime.heapRecords.setEngineGCStressInterval(
                guestProgramVM.runtime.nativeInterpreter.stateAddress, true);
        }
        guestNodeEnvironment.setRunnerArguments(guestRunnerArguments);
        /* Application I/O is intentionally after the snapshot boundary. */
        if (guestRunnerIsNode) {
            guestProgramSource = require("fs").readFileSync(
                guestProgramPath, "utf8");
        } else if (typeof NodeFs !== "undefined") {
            guestProgramSource = NodeFs.readFileSync(guestProgramPath).
                toString("utf8");
        } else guestProgramSource = read(guestProgramPath);
        guestProgramVM.installGlobal("arguments",
            guestProgramVM.runtime.arrayFrom(guestRunnerArguments.slice(1)));
        var guestExecution = guestProgramVM.start(
            guestProgramSource, guestProgramPath);
        var guestRunnerProfileStarted = new Date().getTime();
        var guestRunnerStoppedForProfile = false;
        var guestRunnerResumeBudget = guestRunnerProfileDuration > 0 ?
            1000000 : guestProgramVM.runtime.synchronousExecutionBudget();
        while (true) {
            var guestExecutionResult = guestExecution.resume(
                guestRunnerResumeBudget);
            if (guestExecutionResult.status === "budget") {
                /* The command-line embedder grants another cooperative time slice. */
            } else if (guestExecutionResult.status === "hostCall") {
                guestExecution.serviceHostCall();
            } else if (guestExecutionResult.status === "completed") {
                break;
            } else if (guestExecutionResult.status === "threw") {
                if (guestNodeEnvironment.isExit(
                        guestExecutionResult.exception)) break;
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
        if (guestRunnerStoppedForProfile) {
            if (typeof print === "function") {
                print("guest runner: stopped at an instruction-budget " +
                      "boundary after " + guestRunnerProfileDuration + " ms");
            } else console.log(
                "guest runner: stopped at an instruction-budget boundary " +
                "after " + guestRunnerProfileDuration + " ms");
        } else if (!guestNodeEnvironment.exiting) {
            guestNodeEnvironment.run();
        }
        if (guestRunnerIsNode) {
            guestRunnerDeferredCleanup = true;
            process.on("exit", guestRunnerCleanup);
        }
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
