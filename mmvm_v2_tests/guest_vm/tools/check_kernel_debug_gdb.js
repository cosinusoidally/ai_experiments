/* Real consumer acceptance, using the interpreter rather than synthetic
 * language micro-tests. Optional developer dependency: installed gdb/objdump.
 * Usage: node guest_vm/tools/check_kernel_debug_gdb.js artifacts/BUILD_DIRECTORY */
(function () {
    var fs = require("fs"), cp = require("child_process"), directory = process.argv[2];
    if (!directory) throw new Error("usage: check_kernel_debug_gdb.js artifacts/BUILD_DIRECTORY");
    var sourceFile = "guest_vm/aot/native_interpreter.js";
    var source = fs.readFileSync(sourceFile, "utf8"), start = source.indexOf("function nativeExecutionKernel(");
    var position = source.indexOf("budget = budget - instructionsCompleted;", start);
    if (position < 0) throw new Error("could not locate representative kernel assignment");
    var line = source.substring(0, position).split("\n").length;
    function run(name, command, args) {
        var result = cp.spawnSync(command, args, {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
        var log = (result.stdout || "") + (result.stderr || "");
        fs.writeFileSync(directory + "/" + name + ".log", log);
        if (result.error || result.status !== 0) throw new Error(name + ": " + (result.error || result.status));
        return log;
    }
    function check(condition, description) {
        if (!condition) throw new Error(description);
        console.log("PASS " + description);
    }
    var executable = directory + "/debug-o0-gdb.exe";
    if (fs.existsSync(executable)) fs.unlinkSync(executable);
    run("gdb-package-o0", process.execPath, ["guest_vm/tools/snapshot_to_exe.js",
        directory + "/node-g-o0.snap", executable, "--debug-info", directory + "/node-g-o0.snap.dbg"]);
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
    var optimized = directory + "/debug.exe";
    log = run("gdb-optimized-live", "gdb", ["-q", "-batch", optimized,
        "-ex", "break interpreterKernel", "-ex", "run hello.js", "-ex", "info args",
        "-ex", "bt 5", "-ex", "disable breakpoints", "-ex", "continue"]);
    check(/heapBase = -?\d+/.test(log) && log.indexOf("nativeExecutionKernel") !== -1 &&
        log.indexOf("executeInterpreterTransitionsKernel") !== -1,
        "optimized parameter locations and native/inline unwinding");
    var numericFile = "guest_vm/number_format_kernel.js";
    var numeric = fs.readFileSync(numericFile, "utf8");
    var numericPosition = numeric.indexOf("if (loadRaw8(candidate) === ASCII_MINUS)");
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
}());
