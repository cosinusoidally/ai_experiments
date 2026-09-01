/* Guest-VM runner for the external, unmodified Octane 2.0 checkout.
 *
 * From mmvm_v2_tests:
 *   js_min.exe guest_runner.js --vm-native octane_runner.js Richards
 *   js_min.exe guest_runner.js --vm-native octane_runner.js --quick all
 *
 * The external suite is deliberately loaded in place.  Nothing below copies
 * or patches ../../js_tests/octane.
 */
(function (runnerArguments) {
    var octaneDirectory = "../../js_tests/octane/";
    var suiteFiles = {
        Richards: ["richards.js"],
        DeltaBlue: ["deltablue.js"],
        Crypto: ["crypto.js"],
        RayTrace: ["raytrace.js"],
        EarleyBoyer: ["earley-boyer.js"],
        RegExp: ["regexp.js"],
        Splay: ["splay.js"],
        NavierStokes: ["navier-stokes.js"],
        PdfJS: ["pdfjs.js"],
        Mandreel: ["mandreel.js"],
        Gameboy: ["gbemu-part1.js", "gbemu-part2.js"],
        CodeLoad: ["code-load.js"],
        Box2D: ["box2d.js"],
        zlib: ["zlib.js", "zlib-data.js"],
        Typescript: ["typescript.js", "typescript-input.js",
                     "typescript-compiler.js"]
    };
    var suiteOrder = [
        "Richards", "DeltaBlue", "Crypto", "RayTrace", "EarleyBoyer",
        "RegExp", "Splay", "NavierStokes", "PdfJS", "Mandreel",
        "Gameboy", "CodeLoad", "Box2D", "zlib", "Typescript"
    ];

    function fail(message) {
        throw new Error("octane runner: " + message);
    }

    function canonicalSuiteName(name) {
        var lowered = String(name).toLowerCase();
        var index = 0;
        while (index < suiteOrder.length) {
            if (suiteOrder[index].toLowerCase() === lowered) {
                return suiteOrder[index];
            }
            index++;
        }
        return null;
    }

    var quick = false;
    var requested = [];
    var argumentIndex = 0;
    while (argumentIndex < runnerArguments.length) {
        var argument = String(runnerArguments[argumentIndex++]);
        if (argument === "--quick") {
            quick = true;
        } else if (argument === "all") {
            requested = suiteOrder.slice(0);
        } else {
            var suiteName = canonicalSuiteName(argument);
            if (!suiteName) fail("unknown suite " + argument);
            requested.push(suiteName);
        }
    }
    if (!requested.length) requested = suiteOrder.slice(0);

    load(octaneDirectory + "base.js");
    var requestedIndex = 0;
    while (requestedIndex < requested.length) {
        var files = suiteFiles[requested[requestedIndex++]];
        var fileIndex = 0;
        while (fileIndex < files.length) {
            load(octaneDirectory + files[fileIndex++]);
        }
    }

    if (quick) {
        BenchmarkSuite.config.doWarmup = false;
        BenchmarkSuite.config.doDeterministic = true;
        var loadedSuiteIndex = 0;
        while (loadedSuiteIndex < BenchmarkSuite.suites.length) {
            var benchmarks = BenchmarkSuite.suites[loadedSuiteIndex++].benchmarks;
            var benchmarkIndex = 0;
            while (benchmarkIndex < benchmarks.length) {
                benchmarks[benchmarkIndex].deterministicIterations = 1;
                benchmarks[benchmarkIndex].minIterations = 1;
                benchmarkIndex++;
            }
        }
    }

    var failed = false;
    function reportResult(name, result) {
        if (quick) print(name + ": passed (quick correctness)");
        else print(name + ": " + result);
    }
    function reportError(name, error) {
        failed = true;
        reportResult(name, "FAILED: " + error);
    }
    function reportScore(score) {
        if (!failed && !quick) {
            print("----");
            print("Score (version " + BenchmarkSuite.version + "): " + score);
        }
    }

    BenchmarkSuite.RunSuites({
        NotifyStart: function (name) {
            print(name + ": running" + (quick ? " (quick correctness)" : ""));
        },
        NotifyResult: reportResult,
        NotifyError: reportError,
        NotifyScore: reportScore
    });

    if (failed) fail("one or more suites failed");
    if (quick) print("Octane quick correctness run passed");
}(arguments));
