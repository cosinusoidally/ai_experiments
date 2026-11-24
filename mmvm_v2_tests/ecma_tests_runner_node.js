/* Direct Node control, no guest VM and no npm. Same discovery/result policy
 * as the guest runner. Each test has a bare, fresh Node vm context. */
(function () {
    var fs = require("fs"), path = require("path"), vm = require("vm");
    var childProcess = require("child_process");
    var args = [], timeout = 0, scripts = {};
    var worker = process.argv[2] === "--worker";
    var request = worker ? JSON.parse(fs.readFileSync(0, "utf8")) : null;
    if (worker) timeout = request.timeout;
    for (var index = worker ? process.argv.length : 2; index < process.argv.length; index++) {
        if (process.argv[index] === "--timeout-ms") {
            timeout = Number(process.argv[++index]);
            if (!(timeout >= 0) || timeout !== Math.floor(timeout) || timeout > 2147483647) {
                throw new Error("--timeout-ms requires an integer from 0 to 2147483647 (0 disables timeouts)");
            }
        } else if (process.argv[index] === "--instruction-limit") {
            throw new Error("Node uses --timeout-ms, not --instruction-limit");
        } else args.push(process.argv[index]);
    }
    function read(filename) { return fs.readFileSync(path.resolve(__dirname, filename), "utf8"); }
    function errorResult(error, phase, filename) {
        var stack = String(error && error.stack || ""), location = stack.indexOf(filename + ":");
        var parts = location < 0 ? [] : stack.substring(location + filename.length + 1).split(":");
        return {status: error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : "threw",
            phase: phase, name: String(error && error.name || "ThrownValue"),
            message: String(error && error.message !== undefined ? error.message : error),
            filename: filename, line: parseInt(parts[0], 10) || 0, column: parseInt(parts[1], 10) || 0};
    }
    var backend = {
        runTest: function (filename, source, harnessFiles, negative) {
            if (!worker) {
                var spawnOptions = {input: JSON.stringify({filename: filename, source: source,
                        harnessFiles: harnessFiles, negative: negative, timeout: timeout}),
                     encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 1024 * 1024};
                if (timeout > 0) spawnOptions.timeout = timeout + 1000;
                var child = childProcess.spawnSync(process.execPath,
                    process.execArgv.concat(["--max-old-space-size=128", __filename, "--worker"]), spawnOptions);
                if (child.error || child.status !== 0) {
                    return {status: child.error && child.error.code === "ETIMEDOUT" ? "timeout" : "threw",
                        phase: "worker", name: child.error && child.error.code === "ETIMEDOUT" ?
                            "TimeoutError" : "WorkerError", filename: filename, line: 0, column: 0,
                        message: child.error ? String(child.error.message) :
                            "worker " + (child.signal || child.status) + ": " + String(child.stderr).slice(-500)};
                }
                return JSON.parse(child.stdout);
            }
            /* Modern Node can supply an ordinary realm global rather than a
             * contextifying proxy (which spuriously rejects preventExtensions).
             * Older Nodes retain the documented proxy-global limitation. */
            var context = vm.createContext(vm.constants && vm.constants.DONT_CONTEXTIFY || {});
            var phase = "harness", current = filename;
            context.load = function () {
                for (var item = 0; item < arguments.length; item++) {
                    var relative = String(arguments[item]);
                    if (relative.charAt(0) === "/" || relative.indexOf("..") >= 0) {
                        throw new Error("load path must be relative to the corpus: " + relative);
                    }
                    var previous = current;
                    try { harness("../../js_tests/tests/" + relative); }
                    finally { current = previous; }
                }
            };
            function harness(file) {
                current = file;
                if (!scripts[file]) scripts[file] = new vm.Script(read(file), {filename: file});
                runScript(scripts[file]);
            }
            function runScript(script) {
                return script.runInContext(context, timeout > 0 ? {timeout: timeout} : {});
            }
            try {
                harness("ecma_tests_harness.js");
                harness("../../js_tests/tests/shell.js");
                for (var item = 0; item < harnessFiles.length; item++) harness(harnessFiles[item]);
                current = filename;
                phase = "compile";
                var script = new vm.Script(source, {filename: filename});
                phase = "runtime";
                runScript(script);
                if (!negative) { phase = "assertions"; harness("ecma_tests_verify.js"); }
                return {status: "completed", phase: phase, name: "", message: ""};
            } catch (error) { return errorResult(error, phase, current); }
        },
        destroy: function () {}
    };
    if (worker) {
        process.stdout.write(JSON.stringify(backend.runTest(request.filename,
            request.source, request.harnessFiles, request.negative)));
        return;
    }
    /* spawnSync blocks the event loop. Synchronous progress writes also work
     * when stdout is a pipe, without waiting for buffered console callbacks. */
    var progressConsole = {
        log: function (message) { fs.writeSync(1, String(message) + "\n"); },
        error: function (message) { fs.writeSync(2, String(message) + "\n"); }
    };
    var control = vm.createContext({arguments: args, console: progressConsole, process: process,
        EcmaTestsBackend: backend,
        EcmaTestsClock: function () { var time = process.hrtime(); return time[0] * 1000 + time[1] / 1000000; },
        require: function (name) {
            if (name !== "fs") throw new Error("unexpected runner dependency: " + name);
            return {
                readFileSync: function (file, encoding) { return fs.readFileSync(path.resolve(__dirname, file), encoding); },
                readdirSync: function (file) { return fs.readdirSync(path.resolve(__dirname, file)); },
                statSync: function (file) { return fs.statSync(path.resolve(__dirname, file)); },
                existsSync: function (file) { return fs.existsSync(path.resolve(__dirname, file)); }
            };
        }});
    new vm.Script(read("ecma_tests_runner.js"), {filename: "ecma_tests_runner.js"}).runInContext(control);
}());
