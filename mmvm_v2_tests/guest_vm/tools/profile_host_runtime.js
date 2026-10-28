/* Inclusive host phases around the real guest runner. ES3-compatible.
 * Run from mmvm_v2_tests with js_min or Node, followed by guest_runner's
 * normal options/program, optionally preceded by --frontend for build phases.
 * Wrappers add overhead: this locates costs, not
 * throughput. Noncapturing wrappers avoid Firefox 1 activation/FFI hazards. */
var GuestHostPhaseNode = typeof module !== "undefined" && module.exports;
/* Focused build profiling avoids timing every property lookup. Removing the
 * flag here leaves the ordinary guest_runner command line unchanged. */
var GuestHostPhaseFrontend = GuestHostPhaseNode ?
    process.argv[2] === "--frontend" : arguments[0] === "--frontend";
if (GuestHostPhaseFrontend) {
    if (GuestHostPhaseNode) process.argv.splice(2, 1);
    else arguments.shift();
}
var GuestHostPhaseRoot = GuestHostPhaseNode ? global : this;
var GuestHostPhaseRuntime, GuestHostPhaseRecords, GuestHostPhaseNative;
if (GuestHostPhaseNode) {
    GuestHostPhaseRuntime = require("../runtime.js");
    GuestHostPhaseRecords = require("../heap_records.js");
    GuestHostPhaseNative = require("../aot/native_interpreter.js");
} else {
    load("guest_vm/guest_vm.js");
    GuestHostPhaseRuntime = GuestVMRuntime;
    GuestHostPhaseRecords = GuestVMHeapRecords;
    GuestHostPhaseNative = GuestVMNativeInterpreter;
}
GuestHostPhaseRoot.GuestHostPhaseRegistry = {samples: [],
    destroy: GuestHostPhaseRuntime.prototype.destroy};

function GuestHostPhaseWrap(prototype, group, names) {
    var index = 0;
    while (index < names.length) {
        var name = names[index++];
        if (typeof prototype[name] !== "function") throw new Error("missing profile phase " + name);
        var samples = GuestHostPhaseRoot.GuestHostPhaseRegistry.samples;
        var sampleIndex = samples.length;
        samples.push({name: group + "." + name, original: prototype[name],
            calls: 0, totalMs: 0, maximumMs: 0});
        prototype[name] = Function(
            "var phase = GuestHostPhaseRegistry.samples[" + sampleIndex + "];" +
            "var started = new Date().getTime(); phase.calls++;" +
            "try {return phase.original.apply(this, arguments);}" +
            "finally {var elapsed = new Date().getTime() - started;" +
            "phase.totalMs += elapsed;" +
            "if (elapsed > phase.maximumMs) phase.maximumMs = elapsed;}");
    }
}
function GuestHostPhaseReport() {
    var samples = GuestHostPhaseRoot.GuestHostPhaseRegistry.samples.slice(0);
    samples.sort(function (left, right) {
        return right.totalMs - left.totalMs ||
            (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    });
    function output(message) {
        if (GuestHostPhaseNode) console.log(message);
        else print(message);
    }
    output("Host runtime inclusive phase profile (instrumented, not throughput):");
    var index = 0;
    while (index < samples.length) {
        var sample = samples[index++];
        output(sample.name + ": calls=" + sample.calls +
            " totalMs=" + sample.totalMs + " maximumMs=" + sample.maximumMs);
    }
}
GuestHostPhaseRoot.GuestHostPhaseReport = GuestHostPhaseReport;
if (GuestHostPhaseFrontend) {
    var frontendParser = GuestHostPhaseNode ? require("../parser.js") : GuestVMParser;
    var frontendCompiler = GuestHostPhaseNode ? require("../compiler.js") : GuestVMCompiler;
    GuestHostPhaseWrap(frontendParser.prototype, "parser", ["parseProgram"]);
    GuestHostPhaseWrap(frontendCompiler.prototype, "compiler", ["compile", "compileFunction"]);
    GuestHostPhaseWrap(GuestHostPhaseRuntime.prototype, "runtime", ["registerProgram", "collect"]);
    GuestHostPhaseWrap(GuestHostPhaseNative.prototype, "native", ["run"]);
} else {
    GuestHostPhaseWrap(GuestHostPhaseRuntime.prototype, "runtime", [
    "getBinding", "setBinding", "getGlobal", "setGlobal", "hasOwnProperty",
    "heapOwnPropertyEntry", "readPropertyEntry", "writePropertyEntry",
    "readHeapValue", "readHeapString", "adoptEnvironment", "environmentParent",
    "registerProgram", "collect"
    ]);
    GuestHostPhaseWrap(GuestHostPhaseRecords.prototype, "records", [
    "findOwnPropertyEntry", "ownPropertyEpoch", "ownPropertyGeneration",
    "propertyStorageEntryOffset", "stringHash", "readString",
    "propertyStorageLength", "propertyStorageKey"
    ]);
    GuestHostPhaseWrap(GuestHostPhaseNative.prototype, "native", [
    "prepareSemanticFallback", "releaseAllocationRegionForCollection",
    "installNativeFreeRegions", "run"
    ]);
}
GuestHostPhaseRuntime.prototype.destroy = Function(
    "try {return GuestHostPhaseRegistry.destroy.apply(this, arguments);}" +
    "finally {GuestHostPhaseReport();}");

if (GuestHostPhaseNode) require("../../guest_runner.js");
else load("guest_runner.js");
