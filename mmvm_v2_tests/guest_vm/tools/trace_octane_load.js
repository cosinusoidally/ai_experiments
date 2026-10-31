/* Diagnostic loader for unchanged Octane inputs. No benchmark is rewritten.
 * Run with Node, js_min, or a standalone image, followed by octane_runner
 * arguments, for example: IMAGE guest_vm/tools/trace_octane_load.js Mandreel.
 * File-load timing includes guest parse/compile/top-level execution, not the
 * subsequently timed benchmark iterations. No per-operation hooks are added.
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
