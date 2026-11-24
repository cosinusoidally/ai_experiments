/* Real consumer acceptance, using the interpreter rather than synthetic
 * language micro-tests. Optional developer dependency: installed gdb/objdump.
 * Usage: node guest_vm/tools/check_kernel_debug_gdb.js artifacts/BUILD_DIRECTORY [--core]
 * Snapshot/sidecar inputs are unlinked during every executable check and
 * restored in finally. The optional core runs are serial and bounded. */
(function () {
    var fs = require("fs"), cp = require("child_process"), directory = process.argv[2];
    var paths = require("path"), crypto = require("crypto");
    if (!directory || paths.resolve(directory).indexOf(paths.resolve("artifacts") + paths.sep) !== 0) {
        throw new Error("usage: check_kernel_debug_gdb.js artifacts/BUILD_DIRECTORY [--core]");
    }
    if (process.argv.length > 4 || process.argv.length === 4 && process.argv[3] !== "--core") {
        throw new Error("unknown debugger check option");
    }
    var report = {checks: [], runs: [], inputsAbsent: false, inputsRestored: false, success: false};
    function digest(path) { return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"); }
    var sourceFile = "guest_vm/aot/native_interpreter.js";
    var source = fs.readFileSync(sourceFile, "utf8"), start = source.indexOf("function nativeExecutionKernel(");
    var position = source.indexOf("budget = budget - instructionsCompleted;", start);
    if (start < 0 || position < 0) throw new Error("could not locate representative kernel assignment");
    var line = source.substring(0, position).split("\n").length;
    function run(name, command, args, timeout) {
        console.log("RUN " + name);
        var started = new Date().getTime();
        var result = cp.spawnSync(command, args, {encoding: "utf8", timeout: timeout || 60000, maxBuffer: 8 * 1024 * 1024});
        var log = (result.stdout || "") + (result.stderr || "");
        fs.writeFileSync(directory + "/" + name + ".log", log);
        report.runs.push({name: name, elapsedMilliseconds: new Date().getTime() - started,
            status: result.status, signal: result.signal, error: result.error ? String(result.error) : null});
        if (result.error || result.status !== 0) throw new Error(name + ": " + (result.error || result.status));
        return log;
    }
    function check(condition, description) {
        if (!condition) throw new Error(description);
        report.checks.push(description);
        console.log("PASS " + description);
    }
    var executable = directory + "/debug-o0-gdb.exe";
    if (fs.existsSync(executable)) fs.unlinkSync(executable);
    run("gdb-package-o0", process.execPath, ["guest_vm/tools/snapshot_to_exe.js",
        directory + "/node-g-o0.snap", executable, "--debug-info", directory + "/node-g-o0.snap.dbg"]);
    var optimized = directory + "/debug.exe";
    var originalExeHash = digest(executable), originalOptimizedHash = digest(optimized);
    report.optimizedSHA256 = originalOptimizedHash;
    report.o0SHA256 = originalExeHash;
    var inputNames = ["node-g.snap", "node-g.snap.dbg", "node-g-o0.snap", "node-g-o0.snap.dbg"];
    var savedInputs = [];
    try {
        for (var inputIndex = 0; inputIndex < inputNames.length; inputIndex++) {
            var inputPath = directory + "/" + inputNames[inputIndex];
            savedInputs.push({path: inputPath, bytes: fs.readFileSync(inputPath),
                mode: fs.statSync(inputPath).mode & 511});
            fs.unlinkSync(inputPath);
        }
        report.inputsAbsent = true;
        for (inputIndex = 0; inputIndex < savedInputs.length; inputIndex++) {
            check(!fs.existsSync(savedInputs[inputIndex].path), "input absent: " + inputNames[inputIndex]);
        }
        checkDebuggers();
        if (process.argv[3] === "--core") {
            var configurations = [{name: "optimized", path: optimized}, {name: "o0", path: executable}];
            for (var configuration = 0; configuration < configurations.length; configuration++) {
                var config = configurations[configuration];
                var coreLog = run("exe-" + config.name + "-core", paths.resolve(config.path),
                    ["guest_vm/tests/run_tests.js"], 300000);
                check(coreLog.indexOf("guest VM suite passed: 12 guest program(s),") !== -1,
                    config.name + " executable core suite passes without snapshot/sidecar");
                var gcLog = run("exe-" + config.name + "-gc", paths.resolve(config.path),
                    ["guest_vm/tests/gc_stress_workload.js"]);
                check(gcLog.indexOf("GC stress workload passed: 24 rounds, 48 native-counter collections") !== -1,
                    config.name + " executable bounded GC stress passes");
            }
        }
        check(digest(executable) === originalExeHash && digest(optimized) === originalOptimizedHash,
            "debugging and execution do not mutate either executable");
        report.success = true;
    } finally {
        for (var restoreIndex = 0; restoreIndex < savedInputs.length; restoreIndex++) {
            var saved = savedInputs[restoreIndex];
            fs.writeFileSync(saved.path, saved.bytes, {mode: saved.mode});
        }
        report.inputsRestored = savedInputs.length === inputNames.length;
        for (restoreIndex = 0; restoreIndex < savedInputs.length; restoreIndex++) {
            saved = savedInputs[restoreIndex];
            if (digest(saved.path) !== crypto.createHash("sha256").update(saved.bytes).digest("hex")) {
                report.inputsRestored = false;
            }
        }
        report.success = report.success && report.inputsRestored;
        var receipt = process.argv[3] === "--core" ? "/exe-debug-acceptance-core.json" : "/exe-debug-acceptance.json";
        fs.writeFileSync(directory + receipt, JSON.stringify(report, null, 2) + "\n");
        if (!report.inputsRestored) throw new Error("debugger check inputs were not fully restored");
    }

    function checkDebuggers() {
        var args = ["-q", "-batch", executable];
        var commands = ["break " + sourceFile + ":" + line, "run hello.js",
            "printf \"DEBUG_BEFORE budget=%d completed=%d\\n\", budget, instructionsCompleted",
            "print reason", "set variable instructionsCompleted = 0", "next",
            "printf \"DEBUG_AFTER budget=%d completed=%d\\n\", budget, instructionsCompleted",
            "bt 5", "disassemble /s nativeExecutionKernel", "disable breakpoints", "continue"];
        for (var i = 0; i < commands.length; i++) args.push("-ex", commands[i]);
        var log = run("gdb-o0-live", "gdb", args);
        var before = /DEBUG_BEFORE budget=(-?\d+) completed=(-?\d+)/.exec(log);
        var after = /DEBUG_AFTER budget=(-?\d+) completed=(-?\d+)/.exec(log);
        check(before && after && Number(before[2]) !== 0 && before[1] === after[1] && Number(after[2]) === 0,
            "GDB writes to canonical local affect subsequent native computation");
        check(log.indexOf("nativeExecutionKernel (heapBase=") !== -1 && log.indexOf("$1 =") !== -1,
            "GDB recovers parameters and initialized locals");
        check(log.indexOf("budget = budget - instructionsCompleted;") !== -1 && log.indexOf("<+") !== -1,
            "GDB source-interleaved native disassembly");
        check(log.indexOf("exited normally") !== -1, "debugged program exits normally");
        log = run("gdb-optimized-live", "gdb", ["-q", "-batch", optimized,
            "-ex", "break interpreterKernel", "-ex", "run hello.js", "-ex", "info args",
            "-ex", "bt 5", "-ex", "disable breakpoints", "-ex", "continue"]);
        check(/heapBase = -?\d+/.test(log) && log.indexOf("nativeExecutionKernel") !== -1 &&
            log.indexOf("executeInterpreterTransitionsKernel") !== -1,
            "optimized parameter locations and native/inline unwinding");
        var numericFile = "guest_vm/number_format_kernel.js";
        var numeric = fs.readFileSync(numericFile, "utf8");
        var numericPosition = numeric.indexOf("if (loadRaw8(candidate) === ASCII_MINUS)");
        if (numericPosition < 0) throw new Error("could not locate optimized local probe");
        var numericLine = numeric.substring(0, numericPosition).split("\n").length;
        log = run("gdb-optimized-locals", "gdb", ["-q", "-batch", optimized,
            "-ex", "tbreak " + numericFile + ":" + numericLine,
            "-ex", "run guest_vm/tests/standalone_language_integration.js",
            "-ex", "printf \"DEBUG_OPTLOC negative=%d input=%d\\n\", negative, input",
            "-ex", "info locals", "-ex", "continue"]);
        check(log.indexOf("DEBUG_OPTLOC negative=0 input=0") !== -1 && /count = <optimi[sz]ed out>/.test(log),
            "optimized locals recover initialized values and hide uninitialized storage");
        var dump = run("objdump-kernel", "objdump", ["-d", "-S", "--disassemble=interpreterKernel", optimized]);
        check(dump.indexOf("<interpreterKernel>:") !== -1 && dump.indexOf("setEngineAllocationFailed") !== -1,
            "objdump disassembles actual sized kernel symbol with source");
        checkMachineFrames(executable, "o0");
        checkMachineFrames(optimized, "optimized");
    }

    function checkMachineFrames(binary, policy) {
        var dump = run("objdump-frames-" + policy, "objdump",
            ["-d", "--disassemble=interpreterKernel", binary]);
        var returns = /^\s*([0-9a-f]+):[^\r\n]*\bret\b/gm;
        var match, returnAddress = null;
        while ((match = returns.exec(dump))) returnAddress = match[1];
        if (!returnAddress) throw new Error("could not locate emitted interpreter return instruction");
        /* Obtain instruction addresses from the consumer disassembly, not
         * guessed prologue lengths or compiler-specific function offsets. */
        var commands = ["break *interpreterKernel", "run hello.js",
            "printf \"FRAME_ENTRY\\n\"", "bt 5", "stepi",
            "printf \"FRAME_PUSHED\\n\"", "bt 5", "stepi",
            "printf \"FRAME_ESTABLISHED\\n\"", "bt 5", "disable breakpoints",
            "tbreak *0x" + returnAddress, "continue",
            "printf \"FRAME_RETURN\\n\"", "bt 5", "continue"];
        var args = ["-q", "-batch", binary];
        for (var index = 0; index < commands.length; index++) args.push("-ex", commands[index]);
        var log = run("gdb-frame-boundaries-" + policy, "gdb", args);
        var markers = ["FRAME_ENTRY", "FRAME_PUSHED", "FRAME_ESTABLISHED", "FRAME_RETURN"];
        for (index = 0; index < markers.length; index++) {
            var begin = log.indexOf(markers[index] + "\n");
            var end = index + 1 < markers.length ? log.indexOf(markers[index + 1] + "\n", begin + 1) : log.length;
            var frame = begin >= 0 && end > begin ? log.substring(begin, end) : "";
            check(frame.indexOf("interpreterKernel") !== -1 &&
                frame.indexOf("executeInterpreterTransitionsKernel") !== -1 &&
                frame.indexOf("nativeExecutionKernel") !== -1,
                policy + " unwind at " + markers[index]);
        }
        check(log.indexOf("exited normally") !== -1, policy + " frame-boundary probe exits normally");
    }
}());
