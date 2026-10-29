/* Direct Node comparison backend for test262_runner.js. No guest VM, npm,
 * transpilation or test-source cache. Keep this wrapper ES3-compatible.
 *
 * node test262_runner_node.js [--timeout-ms 10000] [all|path ...]
 * Common selection/reporting flags are implemented by test262_runner.js.
 */
(function () {
    var fs = require("fs");
    var path = require("path");
    var vm = require("vm");
    var timeoutMs = 10000;
    var runnerArguments = [];
    var index = 2;
    while (index < process.argv.length) {
        var argument = process.argv[index++];
        if (argument === "--timeout-ms") {
            timeoutMs = Number(process.argv[index++]);
            if (!(timeoutMs > 0) || timeoutMs !== Math.floor(timeoutMs) ||
                    timeoutMs > 2147483647) {
                throw new Error("--timeout-ms requires an integer from 1 to 2147483647");
            }
        } else if (argument === "--instruction-limit" ||
                argument === "--test-heap-bytes" ||
                argument === "--test-max-heap-bytes" ||
                argument === "--self-hosted-eval") {
            throw new Error(argument + " is guest-VM-only; Node uses --timeout-ms");
        } else runnerArguments.push(argument);
    }

    function readSource(filename) {
        return fs.readFileSync(path.resolve(__dirname, filename), "utf8");
    }

    function errorResult(error, phase, filename) {
        var name = error && error.name || "Error";
        var message = error && error.message || String(error);
        var stack = String(error && error.stack || "");
        var location = stack.indexOf(filename + ":");
        var line = 0, column = 0;
        if (location >= 0) {
            var parts = stack.substring(location + filename.length + 1).split(":");
            line = parseInt(parts[0], 10) || 0;
            column = parseInt(parts[1], 10) || 0;
            if (!column && phase === "compile") {
                var lines = stack.split("\n");
                if (lines.length > 2) column = lines[2].indexOf("^") + 1;
            }
        }
        return {
            status: error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ?
                "timeout" : "threw",
            phase: phase, name: String(name), message: String(message),
            filename: filename, line: line, column: column,
            instructions: "unavailable (direct Node)"
        };
    }

    var harnessPrograms = null;
    var service = {
        runVariant: function (filename, source, strict, harnessFiles) {
            var context, program, harnessIndex, harnessFilename;
            try {
                if (!harnessPrograms) {
                    var preparedHarness = [];
                    harnessIndex = 0;
                    while (harnessIndex < harnessFiles.length) {
                        harnessFilename = harnessFiles[harnessIndex++];
                        var harnessSource = readSource(harnessFilename);
                        if (harnessFilename === "../../js_tests/tests/test262/shell.js") {
                            /* Match the existing guest embedding's repair of
                             * inconsistent quoted DST sentinels in this old
                             * harness. The external file remains untouched. */
                            harnessSource = harnessSource.split("'\"first\"'").join("\"first\"").
                                split("'\"last\"'").join("\"last\"");
                        }
                        preparedHarness.push({filename: harnessFilename,
                            script: new vm.Script(harnessSource,
                                {filename: harnessFilename})});
                    }
                    harnessPrograms = preparedHarness;
                }
                /* Never expose require/process or runner bookkeeping to a
                 * test. Each context owns fresh built-ins and harness globals;
                 * only immutable compiled harness scripts are reused. */
                context = vm.createContext({});
                harnessIndex = 0;
                while (harnessIndex < harnessPrograms.length) {
                    var harnessProgram = harnessPrograms[harnessIndex++];
                    harnessFilename = harnessProgram.filename;
                    harnessProgram.script.runInContext(context, {timeout: timeoutMs});
                }
            } catch (harnessError) {
                return errorResult(harnessError, "harness", harnessFilename || filename);
            }
            try {
                program = new vm.Script(strict ? "\"use strict\";\n" + source : source,
                    {filename: filename});
            } catch (compileError) {
                return errorResult(compileError, "compile", filename);
            }
            try {
                program.runInContext(context, {timeout: timeoutMs});
            } catch (runtimeError) {
                return errorResult(runtimeError, "runtime", filename);
            }
            return {status: "completed", phase: "runtime", name: "", message: "",
                filename: filename, line: 0, column: 0,
                instructions: "unavailable (direct Node)"};
        }
    };

    /* Reuse the exact manifest, authored strict/sloppy policy, negative-test
     * classification, selectors and output logic. This control context does
     * not execute tests; those receive separate, bare contexts above. */
    var control = vm.createContext({
        arguments: runnerArguments, console: console, process: process,
        Test262VM: service,
        Test262Clock: function () {
            var time = process.hrtime();
            return time[0] * 1000 + time[1] / 1000000;
        },
        require: function (name) {
            if (name !== "fs") throw new Error("unexpected runner dependency: " + name);
            return {readFileSync: function (filename, encoding) {
                return fs.readFileSync(path.resolve(__dirname, filename), encoding);
            }};
        },
        load: function (filename) {
            new vm.Script(readSource(filename), {filename: filename}).runInContext(control);
        }
    });
    if (runnerArguments.indexOf("--help") >= 0) {
        console.log("usage: node test262_runner_node.js [--fail-fast] [--verbose] " +
            "[--quiet] [--summary-only] [--fresh-contexts] [--list] " +
            "[--strict-only|--non-strict-only] [--timeout-ms COUNT] [all|path ...]");
        console.log("Default timeout: 10000 ms per script execution. " +
            "Contexts are always fresh; guest-VM-specific options are unavailable.");
        return;
    }
    new vm.Script(readSource("test262_runner.js"),
        {filename: "test262_runner.js"}).runInContext(control);
}());
