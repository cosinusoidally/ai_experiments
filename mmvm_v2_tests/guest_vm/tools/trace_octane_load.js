/* Diagnostic loader for unchanged Octane inputs. No benchmark is rewritten.
 * Run with Node, js_min, or a standalone image, followed by octane_runner
 * arguments, for example: IMAGE guest_vm/tools/trace_octane_load.js Mandreel.
 * File-load timing includes guest parse/compile/top-level execution, not the
 * subsequently timed benchmark iterations. Optional --compile-progress logs
 * guest function compilation boundaries, never individual bytecode operations.
 * --no-source-locations is a diagnostic A/B override of frontend metadata
 * capture; it is never used for acceptance scores or normal image execution.
 */
var traceOctaneGlobal = this;
if (typeof load === "undefined") {
    var traceOctaneFS = require("fs"), traceOctaneVM = require("vm");
    traceOctaneGlobal = global;
    global.arguments = process.argv.slice(2);
    global.require = require;
    global.print = function (message) { console.log(message); };
    global.load = function (filename) {
        traceOctaneVM.runInThisContext(
            traceOctaneFS.readFileSync(filename, "utf8"), {filename: filename});
    };
}
var traceOctaneArgs = traceOctaneGlobal.arguments;
var traceOctaneArgumentIndex = 0;
while (traceOctaneArgumentIndex < traceOctaneArgs.length) {
    if (traceOctaneArgs[traceOctaneArgumentIndex] === "--no-source-locations") {
        traceOctaneArgs.splice(traceOctaneArgumentIndex, 1);
        if (typeof GuestStandaloneFrontend === "undefined") {
            throw new Error("source-location comparison requires the standalone frontend");
        }
        /* Diagnostic A/B policy only: do not modify benchmark source or the
         * production image's default. Compare loading with the same heap cap. */
        var traceOctaneCompileExecutable = GuestStandaloneFrontend.compileExecutable;
        GuestStandaloneFrontend.compileExecutable = function (
                source, filename, anchor, global, captureLocations) {
            return traceOctaneCompileExecutable(source, filename, anchor, global, false);
        };
        print("diagnostic source-location capture disabled");
    } else if (traceOctaneArgs[traceOctaneArgumentIndex] === "--compile-progress") {
        traceOctaneArgs.splice(traceOctaneArgumentIndex, 1);
        if (typeof GuestVMCompiler !== "function" ||
                typeof GuestStandaloneFrontend === "undefined") {
            throw new Error("compile progress requires the standalone frontend");
        }
        /* The snapshot frontend is primed with this constructor. Requiring
         * compiler.js would create another module, not observe the seed. */
        var traceOctaneCompiler = GuestVMCompiler;
        var traceOctaneCompileFunction = traceOctaneCompiler.prototype.compileFunction;
        traceOctaneCompiler.prototype.compileFunction = function (expression) {
            var name = expression.name || "<anonymous>";
            var started = new Date().getTime();
            print("compile begin: " + name + "; statements=" + expression.body.body.length);
            var result = traceOctaneCompileFunction.call(this, expression);
            print("compile end: " + name + "; elapsed ms: " +
                (new Date().getTime() - started));
            return result;
        };
        print("guest compiler progress enabled");
    } else traceOctaneArgumentIndex++;
}
var traceOctaneOriginalLoad = traceOctaneGlobal.load;
traceOctaneGlobal.load = function (filename) {
    print("load begin: " + filename);
    var started = new Date().getTime();
    var result = traceOctaneOriginalLoad(filename);
    print("load end: " + filename + "; elapsed ms: " +
        (new Date().getTime() - started));
    return result;
};
load("octane_runner.js");
