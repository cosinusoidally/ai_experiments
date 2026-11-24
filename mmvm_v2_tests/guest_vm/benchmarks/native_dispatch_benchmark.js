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
    var workload = hostArguments.length > 1 ? String(hostArguments[1]) :
                   "arithmetic";
    if (iterations < 1 || iterations !== Math.floor(iterations)) {
        throw new RangeError("iteration count must be a positive integer");
    }
    if (workload !== "arithmetic" && workload !== "property" &&
        workload !== "call" && workload !== "array") {
        throw new RangeError(
            "workload must be arithmetic, property, call, or array");
    }

    var source = "var benchmarkResult = (function () {\n";
    if (workload === "property") {
        source += "    var benchmarkObject = {" +
            "p0: 1, p1: 2, p2: 3, p3: 4, p4: 5, p5: 6, p6: 7, p7: 8," +
            "p8: 9, p9: 10, p10: 11, p11: 12, p12: 13, p13: 14," +
            "p14: 15, p15: 16};\n";
    } else if (workload === "call") {
        source += "    function benchmarkAdd(left, right) {" +
                  " return left + right; }\n";
    } else if (workload === "array") {
        source += "    var benchmarkArray = [];\n" +
                  "    var setupIndex = 0;\n" +
                  "    while (setupIndex < 64) {\n" +
                  "        benchmarkArray[setupIndex] = setupIndex;\n" +
                  "        setupIndex = setupIndex + 1;\n" +
                  "    }\n";
    }
    source +=
        "    var benchmarkIndex = 0;\n" +
        "    var benchmarkSum = 0;\n" +
        "    while (benchmarkIndex < " + iterations + ") {\n" +
        (workload === "property" ?
        "        benchmarkSum = benchmarkSum + benchmarkObject.p0 + " +
        "benchmarkObject.p15;\n" :
        workload === "call" ?
        "        benchmarkSum = benchmarkAdd(benchmarkSum, 1);\n" :
        workload === "array" ?
        "        benchmarkSum = benchmarkSum + " +
        "benchmarkArray[benchmarkIndex & 63];\n" :
        "        benchmarkSum = benchmarkSum + benchmarkIndex;\n") +
        "        benchmarkIndex = benchmarkIndex + 1;\n" +
        "    }\n" +
        "    return benchmarkSum;\n" +
        "}());\n";
    var expected = workload === "property" ? iterations * 17 :
                   workload === "call" ? iterations :
                   workload === "array" ?
                       Math.floor(iterations / 64) * 2016 +
                       (iterations % 64) * ((iterations % 64) - 1) / 2 :
                   iterations * (iterations - 1) / 2;

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
        if (workload === "property") {
            var object = {p0: 1, p1: 2, p2: 3, p3: 4, p4: 5, p5: 6,
                p6: 7, p7: 8, p8: 9, p9: 10, p10: 11, p11: 12,
                p12: 13, p13: 14, p14: 15, p15: 16};
            while (index < iterations) {
                sum += object.p0 + object.p15;
                index++;
            }
        } else if (workload === "call") {
            function add(left, right) { return left + right; }
            while (index < iterations) {
                sum = add(sum, 1);
                index++;
            }
        } else if (workload === "array") {
            var array = [];
            while (array.length < 64) array.push(array.length);
            while (index < iterations) {
                sum += array[index & 63];
                index++;
            }
        } else {
            while (index < iterations) {
                sum += index;
                index++;
            }
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
        print("native dispatch benchmark: " + workload + ", " + iterations +
              " loop iterations");
    } else console.log("native dispatch benchmark: " + iterations +
                       " " + workload + " loop iterations");
    report(runDirect());
    report(runGuest({}, "semantic guest interpreter"));
    report(runGuest({nativeInterpreter: true}, "kernel-native guest interpreter"));
}(NativeDispatchBenchmarkArguments));
