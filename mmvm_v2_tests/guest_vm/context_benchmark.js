/* Measure runtime initialization separately from fresh context creation.
 *
 *   node guest_vm/context_benchmark.js 1000
 *   js_min.exe guest_vm/context_benchmark.js 1000
 */
(function (runnerArguments) {
    var VM;
    var nodeHost = typeof module !== "undefined" && module.exports;
    if (nodeHost) {
        VM = require("./vm.js");
        runnerArguments = process.argv.length > 2 ? [process.argv[2]] : [];
    } else {
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
    }
    var count = runnerArguments.length ? Number(runnerArguments[0]) : 1000;
    if (!(count > 0) || count !== Math.floor(count)) {
        throw new Error("context count must be a positive integer");
    }
    var runtimeStarted = new Date().getTime();
    var runtime = new VM.JSRuntime({
        nativeInterpreter: !nodeHost
    });
    var runtimeMilliseconds = new Date().getTime() - runtimeStarted;
    var contextsStarted = new Date().getTime();
    var index = 0;
    while (index < count) {
        var context = runtime.createContext();
        context.destroy();
        index++;
    }
    var contextMilliseconds = new Date().getTime() - contextsStarted;
    runtime.destroy();
    var line = "runtime_ms=" + runtimeMilliseconds +
        " contexts=" + count +
        " context_total_ms=" + contextMilliseconds +
        " context_average_ms=" + (contextMilliseconds / count);
    if (typeof print === "function") print(line);
    else console.log(line);
}(typeof arguments === "undefined" ? [] : arguments));
