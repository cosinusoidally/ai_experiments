/* Serial, resumable acceptance of both standalone launchers. Node is only a
 * process supervisor; every tested program executes inside the guest VM.
 * Usage: node guest_vm/tools/validate_snapshot_exe_suites.js SNAP EXE OUTDIR
 * Optional: --ecma-baseline LOG. Reinvoke the same command to resume.
 * The input snapshot is deliberately deleted between the two full passes.
 * Run from mmvm_v2_tests. No compiler, external corpus writes, or threads. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var crypto = require("crypto");
    var args = process.argv.slice(2), snapshot = args[0], executable = args[1], output = args[2];
    if (!output || args.length !== 3 && (args.length !== 5 || args[3] !== "--ecma-baseline")) {
        throw new Error("usage: validate_snapshot_exe_suites.js SNAP EXE OUTDIR [--ecma-baseline LOG]");
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
        if (args[4]) report.baseline = {sha256: digest(args[4]), files: records(fs.readFileSync(args[4], "utf8"))};
        save();
    }
    var jobs = [];
    function job(name, programArgs, expected, seconds) {
        jobs.push({name: name, args: programArgs, expected: expected, seconds: seconds || 180});
    }
    job("hello", ["hello.js"], "Hello, world!");
    job("alternate", ["guest_vm/tests/standalone_alternate_program.js"], "Alternate standalone workload");
    job("core", ["guest_vm/tests/run_tests.js"], "guest VM suite passed: 12 guest program(s), 270 guest assertion(s)", 900);
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
            if (args[4] && report.baseline) {
                if (digest(args[4]) !== report.baseline.sha256) throw new Error("baseline log changed");
                report.baseline.files = records(fs.readFileSync(args[4], "utf8"));
            }
            compare(); save(); line("completed report comparisons refreshed"); return;
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
                compare(); save(); line("completed both full passes; see results.json"); return;
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
    next();
}());
