/* Measures the backend cost of a statically compiled kernel helper call.
 * This is deliberately independent of the guest bytecode interpreter.
 *
 *   js_min.exe guest_vm/benchmarks/kernel_call_benchmark.js [iterations]
 */
(function (root, runnerArguments) {
    if (typeof module !== "undefined" && module.exports) {
        var KernelCompiler = require("../aot/kernel_compiler.js");
        var JSBackend = require("../aot/backend_js.js");
        var X86Backend = require("../aot/backend_x86.js");
        runnerArguments = process.argv.slice(2);
    } else {
        load("guest_vm/guest_vm.js");
        KernelCompiler = GuestVMKernelCompiler;
        JSBackend = GuestVMKernelJSBackend;
        X86Backend = GuestVMKernelX86Backend;
    }

    function inlineLoop(value, iterations) {
        while (iterations > 0) {
            value = (value * 3 + 1) | 0;
            iterations = iterations - 1;
        }
        return value;
    }

    function calledLoop(value, iterations) {
        while (iterations > 0) {
            value = calledStep(value);
            iterations = iterations - 1;
        }
        return value;
    }

    function calledStep(value) {
        return (value * 3 + 1) | 0;
    }

    var iterations = runnerArguments.length ?
        Number(runnerArguments[0]) : 10000000;
    if (!(iterations > 0)) throw new Error("iterations must be positive");
    iterations = Math.floor(iterations);
    var compiler = new KernelCompiler();
    var backend = typeof get_dlsym === "function" ?
        new X86Backend({captureAssembly: false}) : new JSBackend();
    var inlineResult = backend.compile(compiler.compile(inlineLoop));
    var calledResult = backend.compile(compiler.compileGraph(calledLoop, {
        calledStep: calledStep
    }));
    try {
        var memory = typeof get_dlsym === "function" ? undefined : {
            readU32: function () { return 0; },
            writeU32: function () {}
        };
        function invoke(result) {
            return result.backend === "i386" ?
                result.fn(1, iterations) : result.fn(memory, 1, iterations);
        }
        var started = new Date().getTime();
        var inlineValue = invoke(inlineResult);
        var inlineMilliseconds = new Date().getTime() - started;
        started = new Date().getTime();
        var calledValue = invoke(calledResult);
        var calledMilliseconds = new Date().getTime() - started;
        if (inlineValue !== calledValue) {
            throw new Error("kernel call benchmark results differ");
        }
        var output = typeof print === "function" ? print : function (line) {
            console.log(line);
        };
        output("kernel backend: " + calledResult.backend);
        output("iterations: " + iterations);
        output("inline ms: " + inlineMilliseconds);
        output("called ms: " + calledMilliseconds);
        output("helper overhead: " +
               (calledMilliseconds - inlineMilliseconds) + " ms");
    } finally {
        if (inlineResult.destroy) inlineResult.destroy();
        if (calledResult.destroy) calledResult.destroy();
    }
}(this, arguments));
