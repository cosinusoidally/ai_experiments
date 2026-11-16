/* Serial Linux-hosted Wine comparison supervisor, not a guest language host.
 * First obtain a complete ordinary fork-supervised Linux ECMA log. Then:
 *   . ../../wine/32.sh
 *   node guest_vm/tools/compare_ecma_windows.js LINUX_LOG SNAPSHOT LINUX_EXE WINDOWS_EXE artifacts/NEW_DIRECTORY
 * Only Linux-passing files need Windows execution to answer which Windows
 * failures are not Linux failures. Known Linux failures are not called Windows
 * passes or skips. No harness/corpus edits or extra guest dependencies.
 * Reinvoke unchanged inputs to resume. At most one Wine test process is active.
 * Syntax is ES3; supervision uses Node built-ins and existing Wine/GNU time. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var crypto = require("crypto"), args = process.argv.slice(2);
    if (args.length !== 5) throw new Error("expected LINUX_LOG SNAPSHOT LINUX_EXE WINDOWS_EXE artifacts/OUTPUT_DIRECTORY");
    var linuxLog = args[0], snapshot = args[1], linuxExe = args[2];
    var executable = path.resolve(args[3]), directory = args[4];
    if (path.resolve(directory).indexOf(path.resolve("artifacts") + path.sep) !== 0) {
        throw new Error("comparison output must be below artifacts/");
    }
    var MAX_SELECTOR_CHARACTERS = 12000, STARTUP_WATCHDOG_MS = 120000;
    var TEST_WATCHDOG_MS = 60000, DEFAULT_TEST_TIMEOUT_MS = 10000;
    function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
    var sourceFiles = ["ecma_tests_runner.js", "ecma_tests_guest.js", "ecma_tests_process.js",
        "ecma_tests_harness.js", "ecma_tests_capture.js", "ecma_tests_verify.js"];
    var sourceDigest = crypto.createHash("sha256");
    for (var sourceIndex = 0; sourceIndex < sourceFiles.length; sourceIndex++) {
        sourceDigest.update(sourceFiles[sourceIndex]);
        sourceDigest.update(fs.readFileSync(sourceFiles[sourceIndex]));
    }
    var imageBytes = fs.readFileSync(snapshot);
    if (fs.readFileSync(linuxExe).indexOf(imageBytes) < 0 ||
            fs.readFileSync(executable).indexOf(imageBytes) < 0) {
        throw new Error("Linux and Windows executables must embed the same supplied snapshot");
    }
    imageBytes = null;
    var identity = {linuxLog: hash(linuxLog), snapshot: hash(snapshot),
        linuxExe: hash(linuxExe), executable: hash(executable),
        harness: sourceDigest.digest("hex"), winePrefix: process.env.WINEPREFIX || ""};
    var text = fs.readFileSync(linuxLog, "utf8").replace(/\r/g, "");
    var summary = /test files: (\d+); executed: (\d+); passed: (\d+); failed: (\d+); timed out: (\d+); skipped: (\d+); not run: (\d+)/.exec(text);
    if (!summary || Number(summary[7]) !== 0 || /i386 worker received SIGSYS/.test(text)) {
        throw new Error("a complete Linux run is required; stop on SIGSYS, never work around it");
    }
    var baseline = {}, passing = [], rows = text.split("\n");
    for (var row = 0; row < rows.length; row++) {
        var match = /^(PASS|FAIL|SKIP) ((?:ecma|ecma_2|ecma_3|ecma_5)\/[^;: ]+)/.exec(rows[row]);
        if (!match) continue;
        if (baseline[match[2]]) throw new Error("duplicate Linux result: " + match[2]);
        baseline[match[2]] = match[1];
        if (match[1] === "PASS") passing.push(match[2]);
    }
    if (passing.length !== Number(summary[3]) || Object.keys(baseline).length !== Number(summary[1])) {
        throw new Error("Linux log records do not match its summary");
    }
    var corpusDigest = crypto.createHash("sha256"), corpusFiles = {};
    function addCorpusFile(filename) {
        if (fs.existsSync(filename)) corpusFiles[filename] = true;
    }
    var allFiles = Object.keys(baseline);
    addCorpusFile("../../js_tests/tests/shell.js");
    for (var fileIndex = 0; fileIndex < allFiles.length; fileIndex++) {
        var name = "../../js_tests/tests/" + allFiles[fileIndex];
        addCorpusFile(name);
        var parts = allFiles[fileIndex].split("/"), parent = "../../js_tests/tests";
        for (var part = 0; part < parts.length - 1; part++) {
            parent += "/" + parts[part]; addCorpusFile(parent + "/shell.js");
        }
    }
    allFiles = Object.keys(corpusFiles).sort();
    for (fileIndex = 0; fileIndex < allFiles.length; fileIndex++) {
        corpusDigest.update(allFiles[fileIndex]); corpusDigest.update(fs.readFileSync(allFiles[fileIndex]));
    }
    identity.corpus = corpusDigest.digest("hex");
    var stateFile = path.join(directory, "results.json"), state;
    if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (JSON.stringify(state.identity) !== JSON.stringify(identity)) throw new Error("resume inputs changed");
    } else {
        if (!fs.existsSync(directory)) fs.mkdirSync(directory);
        state = {identity: identity, started: new Date().toISOString(),
            linuxSummary: {selected: Number(summary[1]), executed: Number(summary[2]),
                passed: Number(summary[3]), failed: Number(summary[4]),
                timedOut: Number(summary[5]), skipped: Number(summary[6])},
            passing: passing, windows: {}, batches: [], nextBatch: 0};
    }
    function save() {
        var completed = 0, passed = 0, candidates = [], filename;
        for (filename in state.windows) {
            if (!Object.prototype.hasOwnProperty.call(state.windows, filename)) continue;
            completed++;
            if (state.windows[filename].status === "PASS") passed++;
            else candidates.push(filename);
        }
        state.comparison = {linuxPassing: passing.length, windowsPassed: passed,
            windowsNonPass: candidates.length, notYetCompared: passing.length - completed,
            candidates: candidates.sort()};
        fs.writeFileSync(stateFile + ".tmp", JSON.stringify(state, null, 2) + "\n");
        fs.renameSync(stateFile + ".tmp", stateFile);
    }
    var child = null, cancelled = false;
    function stop() {
        cancelled = true;
        if (child) {
            try { process.kill(-child.pid, "SIGKILL"); } catch (error) { /* Already exited. */ }
        }
    }
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    function next() {
        save();
        if (cancelled) { process.exitCode = 130; return; }
        var batch = [], selected = {}, characters = 0;
        for (var index = 0; index < passing.length; index++) {
            var filename = passing[index];
            if (state.windows[filename]) continue;
            var cost = JSON.stringify(filename).length + 1;
            if (batch.length && characters + cost > MAX_SELECTOR_CHARACTERS) break;
            batch.push(filename); selected[filename] = true; characters += cost;
        }
        if (!batch.length) {
            state.finished = new Date().toISOString(); save();
            console.log("Completed: " + JSON.stringify(state.comparison));
            process.exitCode = state.comparison.windowsNonPass ? 1 : 0;
            return;
        }
        var number = state.nextBatch++, stem = path.join(directory, "windows-" + number);
        var log = fs.openSync(stem + ".log", "wx"), started = Date.now();
        var lastActivity = started, lastStarted = null, timedOut = false, pending = {};
        var completed = {}, buffers = ["", ""];
        save(); console.log("START Windows batch " + number + ": " + batch.length + " Linux-passing tests");
        var launch = ["-f", "%e %M", "-o", stem + ".time", "wine", executable,
            "ecma_tests_runner.js", "--verbose", "--timeout-ms", String(DEFAULT_TEST_TIMEOUT_MS)].concat(batch);
        child = cp.spawn("/usr/bin/time", launch, {stdio: ["ignore", "pipe", "pipe"], detached: true});
        function line(value) {
            var run = /^RUN (.+)$/.exec(value), result = /^(PASS|FAIL) ([^;: ]+)/.exec(value);
            if (run && selected[run[1]]) {
                lastStarted = run[1]; pending[run[1]] = true; lastActivity = Date.now();
            }
            if (result && selected[result[2]]) {
                if (completed[result[2]]) throw new Error("duplicate Windows result: " + result[2]);
                completed[result[2]] = true; delete pending[result[2]];
                state.windows[result[2]] = {status: result[1], detail: value, batch: number};
                lastActivity = Date.now();
            }
        }
        function receive(stream, data) {
            fs.writeSync(log, data);
            buffers[stream] += data.replace(/\r/g, "");
            var end;
            while ((end = buffers[stream].indexOf("\n")) >= 0) {
                line(buffers[stream].substring(0, end));
                buffers[stream] = buffers[stream].substring(end + 1);
            }
        }
        child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
        child.stdout.on("data", function (data) { receive(0, data); });
        child.stderr.on("data", function (data) { receive(1, data); });
        var timer = setInterval(function () {
            if (Date.now() - lastActivity > (lastStarted ? TEST_WATCHDOG_MS : STARTUP_WATCHDOG_MS)) {
                timedOut = true;
                try { process.kill(-child.pid, "SIGKILL"); } catch (error) { /* Already exited. */ }
            }
        }, 1000);
        child.on("error", function (error) { throw error; });
        child.on("close", function (code, signal) {
            clearInterval(timer); child = null;
            for (var stream = 0; stream < buffers.length; stream++) if (buffers[stream]) line(buffers[stream]);
            fs.closeSync(log);
            if (signal === "SIGSYS" || /SIGSYS|Bad system call/.test(fs.readFileSync(stem + ".log", "utf8"))) {
                state.infrastructureError = "i386 execution received SIGSYS; comparison stopped";
                save(); throw new Error(state.infrastructureError);
            }
            var unresolved = Object.keys(pending);
            if (!cancelled && unresolved.length) {
                if (unresolved.length !== 1) throw new Error("ambiguous aborted test; inspect " + stem + ".log");
                state.windows[unresolved[0]] = {status: timedOut ? "SUPERVISOR_TIMEOUT" : "ABORT",
                    detail: "process exit " + code + ", signal " + signal, batch: number};
            } else if (!cancelled && Object.keys(completed).length !== batch.length) {
                throw new Error("worker did not start an identifiable test; inspect " + stem + ".log");
            }
            state.batches.push({number: number, files: batch, elapsedMs: Date.now() - started,
                exitStatus: code, signal: signal, supervisorTimeout: timedOut,
                completed: Object.keys(completed).length, aborted: unresolved});
            console.log("END Windows batch " + number + ": completed " + Object.keys(completed).length +
                ", aborted " + unresolved.length + "; exit " + code);
            next();
        });
    }
    next();
}());
