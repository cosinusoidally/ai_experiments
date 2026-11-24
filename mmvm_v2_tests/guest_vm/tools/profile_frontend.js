/* Guest-owned frontend timing, intended for a standalone snapshot:
 *   js_runner.exe IMAGE guest_vm/tools/profile_frontend.js CodeLoad
 * Uses the seeded constructors, not a second required compiler module.
 * Timed benchmark functions/inputs are untouched. Diagnostic scores include
 * instrumentation overhead and must not replace clean performance runs. */
var frontendProfileGlobal = this;
if (typeof GuestVMParser !== "function" || typeof GuestVMCompiler !== "function" ||
        typeof GuestStandaloneFrontend === "undefined") {
    throw new Error("frontend profiling requires a standalone guest frontend");
}
var frontendProfile = {
    parseCount: 0, parseMs: 0, compileCount: 0, compileMs: 0, compileDepth: 0,
    analysisMs: 0, optimizeMs: 0, packingMs: 0
};
function frontendProfileNow() { return new Date().getTime(); }

var frontendProfileParse = GuestVMParser.prototype.parseProgram;
GuestVMParser.prototype.parseProgram = function () {
    var started = frontendProfileNow();
    try { return frontendProfileParse.apply(this, arguments); }
    finally {
        frontendProfile.parseCount++;
        frontendProfile.parseMs += frontendProfileNow() - started;
    }
};

function frontendProfileCompilerMethod(original) {
    return function () {
        var outermost = frontendProfile.compileDepth === 0;
        var started = outermost ? frontendProfileNow() : 0;
        frontendProfile.compileDepth++;
        try { return original.apply(this, arguments); }
        finally {
            frontendProfile.compileDepth--;
            if (outermost) {
                frontendProfile.compileCount++;
                frontendProfile.compileMs += frontendProfileNow() - started;
            }
        }
    };
}
GuestVMCompiler.prototype.compile = frontendProfileCompilerMethod(GuestVMCompiler.prototype.compile);
GuestVMCompiler.prototype.compileFunction = frontendProfileCompilerMethod(GuestVMCompiler.prototype.compileFunction);

function frontendProfilePhase(original, field) {
    return function () {
        var started = frontendProfileNow();
        try { return original.apply(this, arguments); }
        finally { frontendProfile[field] += frontendProfileNow() - started; }
    };
}
if (typeof GuestVMFunctionAnalysis !== "undefined") {
    GuestVMFunctionAnalysis.analyze = frontendProfilePhase(GuestVMFunctionAnalysis.analyze, "analysisMs");
}
GuestVMBytecodeOptimizer.optimize = frontendProfilePhase(GuestVMBytecodeOptimizer.optimize, "optimizeMs");
GuestVMRegisterAllocator.pack = frontendProfilePhase(GuestVMRegisterAllocator.pack, "packingMs");

function frontendProfileSnapshot() {
    return {parseCount: frontendProfile.parseCount, parseMs: frontendProfile.parseMs,
        compileCount: frontendProfile.compileCount, compileMs: frontendProfile.compileMs,
        analysisMs: frontendProfile.analysisMs, optimizeMs: frontendProfile.optimizeMs,
        packingMs: frontendProfile.packingMs};
}
function frontendProfileReport(name, previous, current) {
    print("frontend " + name + ": parses=" + (current.parseCount - previous.parseCount) +
        "; parse_ms=" + (current.parseMs - previous.parseMs) +
        "; compiles=" + (current.compileCount - previous.compileCount) +
        "; compile_ms=" + (current.compileMs - previous.compileMs) +
        "; analysis_ms=" + (current.analysisMs - previous.analysisMs) +
        "; optimizer_ms=" + (current.optimizeMs - previous.optimizeMs) +
        "; packing_ms=" + (current.packingMs - previous.packingMs));
}
var frontendProfileOriginalLoad = frontendProfileGlobal.load;
var frontendProfileAttached = false;
frontendProfileGlobal.load = function (filename) {
    var result = frontendProfileOriginalLoad(filename);
    if (!frontendProfileAttached && typeof BenchmarkSuite === "function") {
        frontendProfileAttached = true;
        var originalStep = BenchmarkSuite.prototype.NotifyStep;
        BenchmarkSuite.prototype.NotifyStep = function (measurement) {
            var previous = this.__frontendProfilePrevious || frontendProfileSnapshot();
            var current = frontendProfileSnapshot();
            originalStep.call(this, measurement);
            frontendProfileReport(measurement.benchmark.name, previous, current);
            this.__frontendProfilePrevious = current;
        };
        var originalStart = BenchmarkSuite.prototype.RunStep;
        BenchmarkSuite.prototype.RunStep = function (runner) {
            this.__frontendProfilePrevious = frontendProfileSnapshot();
            return originalStart.call(this, runner);
        };
    }
    return result;
};
load("octane_runner.js");
