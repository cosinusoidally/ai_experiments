/* Portable native-dispatch microbenchmark. It intentionally exercises the
 * bytecode loop rather than X11, timers, or the Node compatibility layer.
 * Run it under either Node.js or js_min.exe from the repository directory. */
var NativeDispatchBenchmarkArguments =
    typeof process !== "undefined" && process.argv ?
        process.argv.slice(2) :
        typeof arguments !== "undefined" ? arguments : [];
(function (shellArguments) {
    var isNode = typeof module !== "undefined" && module.exports;
    var VM;
    var hostArguments = [];
    if (isNode) {
        VM = require("../vm.js");
        hostArguments = shellArguments;
    } else {
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
        var argumentIndex = 0;
        while (argumentIndex < shellArguments.length) {
            hostArguments.push(shellArguments[argumentIndex++]);
        }
    }

    var iterations = hostArguments.length ? Number(hostArguments[0]) : 200000;
    if (iterations < 1 || iterations !== Math.floor(iterations)) {
        throw new RangeError("iteration count must be a positive integer");
    }

    var source =
        "var benchmarkResult = (function () {\n" +
        "    var benchmarkIndex = 0;\n" +
        "    var benchmarkSum = 0;\n" +
        "    while (benchmarkIndex < " + iterations + ") {\n" +
        "        benchmarkSum = benchmarkSum + benchmarkIndex;\n" +
        "        benchmarkIndex = benchmarkIndex + 1;\n" +
        "    }\n" +
        "    return benchmarkSum;\n" +
        "}());\n";
    var expected = iterations * (iterations - 1) / 2;

    function runGuest(options, label) {
        var vm = new VM(options);
        try {
            var program = vm.compile(source, "<native-dispatch-benchmark>");
            var started = new Date().getTime();
            vm.execute(program);
            var value = vm.runtime.getGlobal(vm.context, "benchmarkResult");
            var elapsed = new Date().getTime() - started;
            if (value !== expected) {
                throw new Error(label + " result mismatch: " + value);
            }
            var nativeEngine = vm.runtime.nativeInterpreter;
            return {label: label, elapsed: elapsed,
                    nativeInstructions: nativeEngine ?
                        nativeEngine.instructionCount : 0,
                    unsupportedExits: nativeEngine ?
                        nativeEngine.unsupportedExitCount : 0};
        } finally {
            vm.destroy();
        }
    }

    function runDirect() {
        var started = new Date().getTime();
        var index = 0;
        var sum = 0;
        while (index < iterations) {
            sum += index;
            index++;
        }
        var elapsed = new Date().getTime() - started;
        if (sum !== expected) throw new Error("direct host result mismatch");
        return {label: "direct host JavaScript", elapsed: elapsed,
                nativeInstructions: 0, unsupportedExits: 0};
    }

    function report(result) {
        var line = result.label + ": " + result.elapsed + " ms";
        if (result.nativeInstructions) {
            line += ", " + result.nativeInstructions + " native bytecodes" +
                    ", " + result.unsupportedExits + " semantic exits";
        }
        if (typeof print === "function") print(line);
        else console.log(line);
    }

    if (typeof print === "function") {
        print("native dispatch benchmark: " + iterations + " loop iterations");
    } else console.log("native dispatch benchmark: " + iterations +
                       " loop iterations");
    report(runDirect());
    report(runGuest({}, "semantic guest interpreter"));
    report(runGuest({nativeInterpreter: true}, "kernel-native guest interpreter"));
}(NativeDispatchBenchmarkArguments));
