/* Serial, resumable acceptance of both standalone launchers. Node is only a
 * process supervisor; every tested program executes inside the guest VM.
 * Usage: node guest_vm/tools/validate_snapshot_exe_suites.js SNAP EXE OUTDIR
 * Optional: --ecma-baseline LOG. Reinvoke the same command to resume.
 * --test262-confirmation PREFIX supplies a clean .log/.time.json receipt if
 * an earlier completed summary was recovered without its process exit code.
 * The input snapshot is deliberately deleted between the two full passes.
 * Run from mmvm_v2_tests. No compiler, external corpus writes, or threads. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var crypto = require("crypto");
    var args = process.argv.slice(2), snapshot = args[0], executable = args[1], output = args[2];
    var baselinePath = null, recoverTest262 = false, confirmationPrefix = null;
    for (var option = 3; option < args.length; option++) {
        if (args[option] === "--ecma-baseline") baselinePath = args[++option];
        else if (args[option] === "--recover-test262-summary") recoverTest262 = true;
        else if (args[option] === "--test262-confirmation") confirmationPrefix = args[++option];
        else throw new Error("unknown validation option: " + args[option]);
    }
    if (!output) {
        throw new Error("usage: validate_snapshot_exe_suites.js SNAP EXE OUTDIR [--ecma-baseline LOG] [--recover-test262-summary] [--test262-confirmation PREFIX]");
    }
    if (path.resolve(output).indexOf(path.resolve("artifacts") + path.sep) !== 0) {
        throw new Error("results must be beneath artifacts/");
    }
    var runner = process.env.JS_RUNNER_BINARY || "artifacts/js_runner.exe";
    executable = path.resolve(executable);
    var stateFile = path.join(output, "results.json"), report;
    function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
    function save() {
        fs.writeFileSync(stateFile + ".tmp", JSON.stringify(report, null, 2) + "\n");
        fs.renameSync(stateFile + ".tmp", stateFile);
    }
    function line(message) {
        var text = new Date().toISOString() + " " + message;
        console.log(text); fs.appendFileSync(path.join(output, "progress.log"), text + "\n");
    }
    function records(log) {
        var result = {}, lines = log.split("\n"), i, match;
        /* Old completed ECMA logs retained stdout only. Every test has RUN,
         * while FAIL went to stderr. A completed run's RUN-without-PASS is
         * therefore a failure, not a missing/implicitly passing result. */
        var completeECMA = log.indexOf("ECMA ES1--ES5.1 corpus summary") >= 0 &&
            /not run: 0(?:\s|$)/.test(log);
        for (i = 0; i < lines.length; i++) {
            match = /^(PASS|FAIL|SKIP|RUN) ([^; :]+)(?:[; :]|$)/.exec(lines[i]);
            if (match && (match[1] !== "RUN" || completeECMA)) {
                result[match[2]] = match[1] === "RUN" ? "FAIL" : match[1];
            }
        }
        return result;
    }
    if (fs.existsSync(stateFile)) {
        report = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (report.snapshot !== snapshot || report.executable !== executable ||
                report.exeSHA256 !== digest(executable)) throw new Error("resume inputs changed");
        if (report.phase === "snapshot" && report.snapshotSHA256 !== digest(snapshot)) {
            throw new Error("snapshot changed during validation");
        }
    } else {
        fs.mkdirSync(output);
        report = {started: new Date().toISOString(), snapshot: snapshot, executable: executable,
            snapshotSHA256: digest(snapshot), exeSHA256: digest(executable), phase: "snapshot",
            nextJob: 0, sourceDeleted: null, results: [], baseline: null};
        if (baselinePath) report.baseline = {sha256: digest(baselinePath), files: records(fs.readFileSync(baselinePath, "utf8"))};
        save();
    }
    var jobs = [];
    function job(name, programArgs, expected, seconds) {
        jobs.push({name: name, args: programArgs, expected: expected, seconds: seconds || 180});
    }
    job("hello", ["hello.js"], "Hello, world!");
    job("alternate", ["guest_vm/tests/standalone_alternate_program.js"], "Alternate standalone workload");
    job("core", ["guest_vm/tests/run_tests.js"], "guest VM suite passed: 12 guest program(s),", 900);
    job("tokenizer", ["guest_vm/tests/run_tokenizer_tests.js"], "tokenizer tests passed: 84");
    job("language", ["guest_vm/tests/standalone_language_integration.js"], "standalone integration: passed");
    job("objects", ["guest_vm/tests/object_operations_integration.js"], "object operations integration passed");
    job("gc", ["guest_vm/tests/gc_stress_workload.js"], "GC stress workload passed: 24 rounds");
    job("json", ["json_runner.js"], "12 passed, 0 failed");
    jobs.push({name: "apps", external: true, expected: "application matrix finished", seconds: 900});
    job("test262", ["test262_runner.js"], "Test262 ES5.1 summary", 1800);
    job("ecma", ["ecma_tests_runner.js"], "ECMA ES1--ES5.1 corpus summary", 1800);
    var suites = ["Richards", "DeltaBlue", "Crypto", "RayTrace", "EarleyBoyer", "RegExp",
        "Splay", "NavierStokes", "PdfJS", "Mandreel", "Gameboy", "CodeLoad", "Box2D", "zlib", "Typescript"];
    for (var i = 0; i < suites.length; i++) {
        job("octane-" + suites[i], ["octane_runner.js", "--diagnostics", suites[i]], "Score (version", 1800);
    }
    var rebuild = path.join(output, "rebuild.snap");
    job("self-build", ["guest_runner.js", "--vm-native", "--snapshot", rebuild], "wrote standalone snapshot:", 300);
    var environment = {}, key;
    for (key in process.env) environment[key] = process.env[key];
    environment.TZ = "UTC";

    function compare() {
        var comparisons = [], baseline = report.baseline && report.baseline.files;
        for (var j = 0; j < jobs.length; j++) {
            var name = jobs[j].name, a = null, b = null;
            for (var r = 0; r < report.results.length; r++) {
                var entry = report.results[r];
                if (entry.name === name) {
                    if (entry.phase === "snapshot") a = entry; else b = entry;
                }
            }
            if (!a || !b) continue;
            var item = {name: name, snapshotPass: a.pass, exePass: b.pass,
                lostPasses: [], gainedPasses: [], differingStatuses: []};
            if (a.files && b.files) {
                for (key in a.files) {
                    if (a.files[key] !== b.files[key]) item.differingStatuses.push(key);
                    if (a.files[key] === "PASS" && b.files[key] !== "PASS") item.lostPasses.push(key);
                    if (a.files[key] !== "PASS" && b.files[key] === "PASS") item.gainedPasses.push(key);
                }
                for (key in b.files) {
                    if (a.files[key] === undefined) item.differingStatuses.push(key);
                }
                if (name === "ecma" && baseline) {
                    item.baselineLostPasses = []; item.baselineGainedPasses = [];
                    for (key in baseline) {
                        if (baseline[key] === "PASS" && a.files[key] !== "PASS") item.baselineLostPasses.push(key);
                        if (baseline[key] !== "PASS" && a.files[key] === "PASS") item.baselineGainedPasses.push(key);
                    }
                }
            }
            comparisons.push(item);
        }
        report.comparisons = comparisons;
    }
    function analyze() {
        if (baselinePath && report.baseline) {
            if (digest(baselinePath) !== report.baseline.sha256) throw new Error("baseline log changed");
            report.baseline.files = records(fs.readFileSync(baselinePath, "utf8"));
        }
        compare();
        var unexpected = [], seen = {}, baseline = report.baseline && report.baseline.files;
        var confirmation = null, index, name, item, jobKey;
        if (confirmationPrefix) {
            var confirmationLog = fs.readFileSync(confirmationPrefix + ".log", "utf8");
            var confirmationMetrics = JSON.parse(fs.readFileSync(confirmationPrefix + ".time.json", "utf8"));
            var confirmationFiles = records(confirmationLog);
            if (confirmationMetrics.exitStatus !== 0 ||
                    confirmationLog.indexOf("Test262 ES5.1 summary") < 0 ||
                    !/\n  failed:\s+0\s/.test(confirmationLog) ||
                    !/\n  timed out:\s+0\s/.test(confirmationLog) ||
                    !/\n  not run:\s+0\s/.test(confirmationLog)) {
                throw new Error("clean Test262 confirmation did not pass");
            }
            confirmation = {prefix: confirmationPrefix, metrics: confirmationMetrics,
                logSHA256: digest(confirmationPrefix + ".log")};
            for (index = 0; index < report.results.length; index++) {
                item = report.results[index];
                if (item.phase !== "exe" || item.name !== "test262") continue;
                for (name in item.files) {
                    if (item.files[name] !== confirmationFiles[name]) unexpected.push("confirmation mismatch: " + name);
                }
                for (name in confirmationFiles) {
                    if (!item.files[name]) unexpected.push("unexpected confirmation file: " + name);
                }
            }
        }
        for (index = 0; index < report.results.length; index++) {
            item = report.results[index]; jobKey = item.phase + ":" + item.name;
            if (seen[jobKey]) unexpected.push("duplicate result: " + jobKey);
            seen[jobKey] = true;
            if (item.phase === "exe" && !item.sourceAbsent) unexpected.push("snapshot present: " + jobKey);
            if (item.name === "ecma") {
                if (!item.completed || !baseline) unexpected.push("incomplete ECMA/baseline: " + jobKey);
                if (item.files && baseline) {
                    for (name in item.files) {
                        if ((item.files[name] === "FAIL" || item.files[name] === "SKIP") &&
                                baseline[name] !== item.files[name]) unexpected.push(jobKey + ": " + name);
                    }
                    for (name in baseline) {
                        if (!item.files[name]) unexpected.push("missing ECMA result: " + name);
                    }
                }
            } else if (!item.pass) unexpected.push("failed: " + jobKey);
            if (item.name === "test262" && item.processExitObserved === false && !confirmation) {
                unexpected.push("clean Test262 exit confirmation required: " + jobKey);
            }
        }
        for (index = 0; index < jobs.length; index++) {
            if (!seen["snapshot:" + jobs[index].name] || !seen["exe:" + jobs[index].name]) {
                unexpected.push("missing launcher result: " + jobs[index].name);
            }
        }
        for (index = 0; index < report.comparisons.length; index++) {
            item = report.comparisons[index];
            if (item.differingStatuses.length) unexpected.push("launcher file-status differences: " + item.name);
        }
        if (!report.sourceDeleted || fs.existsSync(snapshot)) unexpected.push("source snapshot not deleted");
        if (digest(executable) !== report.exeSHA256) unexpected.push("executable changed");
        report.test262ExitConfirmation = confirmation;
        report.unexpected = unexpected; report.accepted = unexpected.length === 0;
        if (!report.accepted) process.exitCode = 1;
    }
    function next() {
        if (report.phase === "finished") {
            /* Reconstruct comparisons from the immutable per-run logs, also
             * allowing corrected analysis without repeating expensive runs. */
            for (var r = 0; r < report.results.length; r++) {
                var saved = report.results[r];
                if (saved.name === "ecma" || saved.name === "test262") {
                    saved.files = records(fs.readFileSync(path.join(output,
                        saved.phase + "-" + saved.name + ".log"), "utf8"));
                }
            }
            if (baselinePath && report.baseline) {
                if (digest(baselinePath) !== report.baseline.sha256) throw new Error("baseline log changed");
                report.baseline.files = records(fs.readFileSync(baselinePath, "utf8"));
            }
            analyze(); save(); line("completed report comparisons refreshed; accepted=" + report.accepted); return;
        }
        if (report.nextJob === jobs.length) {
            if (report.phase === "snapshot") {
                if (digest(snapshot) !== report.snapshotSHA256) throw new Error("source snapshot mutated");
                if (digest(executable) !== report.exeSHA256) throw new Error("executable mutated");
                fs.unlinkSync(snapshot);
                report.sourceDeleted = new Date().toISOString();
                report.phase = "exe"; report.nextJob = 0; save();
                line("DELETED source snapshot: " + snapshot + "; starting executable-only phase");
            } else {
                report.phase = "finished"; report.finished = new Date().toISOString();
                analyze(); save(); line("completed both full passes; accepted=" + report.accepted + "; see results.json"); return;
            }
        }
        if (report.phase === "exe" && fs.existsSync(snapshot)) throw new Error("source snapshot must remain absent");
        var current = jobs[report.nextJob], stem = report.phase + "-" + current.name;
        var logFile = path.join(output, stem + ".log"), metrics = path.join(output, stem + ".time.json");
        var command = report.phase === "snapshot" ? [path.resolve(runner), snapshot] : [executable];
        if (current.external) {
            command = [process.execPath, "guest_vm/tools/validate_snapshot_exe_apps.js", snapshot,
                executable, path.join(output, report.phase + "-apps"), "--phase", report.phase];
        } else command = command.concat(current.args);
        var fd = fs.openSync(logFile, "w"), started = new Date().getTime();
        line("START " + stem + (report.phase === "exe" ? " (source snapshot absent)" : ""));
        var child = cp.spawn("/usr/bin/time", ["-f", '{"wall":%e,"rssKiB":%M}', "-o", metrics,
            "/usr/bin/timeout", "--kill-after=5", String(current.seconds)].concat(command),
            {env: environment, stdio: ["ignore", fd, fd]});
        fs.closeSync(fd);
        child.on("error", function (error) { throw error; });
        child.on("close", function (status, signal) {
            var log = fs.readFileSync(logFile, "utf8");
            var entry = {phase: report.phase, name: current.name, status: status, signal: signal,
                elapsedMs: new Date().getTime() - started, pass: status === 0 && log.indexOf(current.expected) >= 0,
                sourceAbsent: !fs.existsSync(snapshot)};
            if (current.name === "ecma" || current.name === "test262") entry.files = records(log);
            if (current.name === "test262") entry.pass = entry.pass && /failed:\s+0\s/.test(log);
            if (current.name === "ecma") entry.completed = log.indexOf(current.expected) >= 0;
            if (current.name.indexOf("octane-") === 0) entry.pass = entry.pass && log.indexOf("FAILED") < 0;
            if (current.name === "self-build" && fs.existsSync(rebuild)) {
                entry.rebuildSHA256 = digest(rebuild);
                entry.pass = entry.pass && entry.rebuildSHA256 === report.snapshotSHA256;
                fs.unlinkSync(rebuild);
            }
            if (digest(executable) !== report.exeSHA256) throw new Error("execution modified executable");
            report.results.push(entry); report.nextJob++; save();
            line("END " + stem + " status=" + status + " pass=" + entry.pass + " elapsed_ms=" + entry.elapsedMs);
            next();
        });
    }
    if (recoverTest262) {
        /* Explicit recovery for a completed worker whose supervisor vanished
         * before checkpointing. Do not invent an observed process exit code.
         * Partial logs, failed runs and mismatched images cannot be adopted. */
        if (!jobs[report.nextJob] || jobs[report.nextJob].name !== "test262") {
            throw new Error("recovery requires Test262 to be the pending job");
        }
        if (report.phase === "exe" && fs.existsSync(snapshot)) throw new Error("source snapshot must be absent");
        var completedLog = fs.readFileSync(path.join(output, report.phase + "-test262.log"), "utf8");
        var summaryAt = completedLog.lastIndexOf("Test262 ES5.1 summary\n");
        var summary = completedLog.substring(summaryAt), counts = {}, countNames =
            ["test files", "variants", "executed", "passed", "failed", "not run", "timed out"];
        for (var countIndex = 0; countIndex < countNames.length; countIndex++) {
            var countMatch = new RegExp("(?:^|\\n)  " + countNames[countIndex] + ":\\s+(\\d+)").exec(summary);
            if (!countMatch) throw new Error("incomplete Test262 summary");
            counts[countNames[countIndex]] = Number(countMatch[1]);
        }
        var elapsed = /(?:^|\n)  elapsed ms: ([0-9.]+)\s*$/.exec(summary);
        var completedFiles = records(completedLog), completedCount = 0;
        for (var completedName in completedFiles) {
            if (completedFiles[completedName] !== "PASS") throw new Error("recovery log contains a non-pass");
            completedCount++;
        }
        if (summaryAt < 0 || !elapsed || counts.failed || counts["not run"] || counts["timed out"] ||
                counts.executed <= 0 || counts.executed !== counts.passed ||
                counts.executed !== counts.variants || completedCount !== counts.executed) {
            throw new Error("Test262 recovery requires a complete all-passing run");
        }
        report.results.push({phase: report.phase, name: "test262", status: null, signal: null,
            elapsedMs: Number(elapsed[1]), pass: true, files: completedFiles,
            recoveredFromCompleteSummary: true, processExitObserved: false,
            sourceAbsent: !fs.existsSync(snapshot)});
        report.nextJob++; save(); line("RECOVERED complete Test262 summary; process exit status was not observed");
    }
    next();
}());
