/* Sequential stock Octane measurement harness. Requires Node only to run
 * the reference engine and supervise separate child processes: the guest
 * command is still js_runner snapshot octane_runner.js SUITE, with no host
 * JavaScript support. GNU time/timeout measure and bound both engines.
 *
 * node octane_compare.js --snapshot artifacts/snap --output artifacts/run
 * Generated logs/results go exclusively in the requested artifact directory.
 * This harness does not modify the external Octane checkout or VM sources.
 */
(function () {
    var fs = require("fs");
    var path = require("path");
    var childProcess = require("child_process");
    var os = require("os");
    var crypto = require("crypto");
    var suites = ["Richards", "DeltaBlue", "Crypto", "RayTrace",
        "EarleyBoyer", "RegExp", "Splay", "NavierStokes", "PdfJS",
        "Mandreel", "Gameboy", "CodeLoad", "Box2D", "zlib", "Typescript"];
    var options = {snapshot: "artifacts/snap", runner: "artifacts/js_runner.exe",
        output: null, timeout: 900};
    var argumentIndex = 2;
    while (argumentIndex < process.argv.length) {
        var argument = process.argv[argumentIndex++];
        if (argument !== "--snapshot" && argument !== "--runner" &&
                argument !== "--output" && argument !== "--timeout") {
            throw new Error("unknown option: " + argument);
        }
        if (argumentIndex >= process.argv.length) {
            throw new Error("missing value for " + argument);
        }
        options[argument.substring(2)] = process.argv[argumentIndex++];
    }
    options.timeout = Number(options.timeout);
    if (!(options.timeout >= 1 && options.timeout <= 3600) ||
            options.timeout !== Math.floor(options.timeout)) {
        throw new Error("--timeout must be an integer from 1 to 3600 seconds");
    }
    if (!options.output) throw new Error("--output is required");
    process.chdir(__dirname);
    var outputDirectory = path.resolve(options.output);
    var artifactDirectory = path.resolve("artifacts") + path.sep;
    if (outputDirectory.indexOf(artifactDirectory) !== 0) {
        throw new Error("--output must be a new directory below artifacts/");
    }
    if (fs.existsSync(outputDirectory)) {
        throw new Error("refusing to overwrite existing results: " + options.output);
    }
    options.runner = path.resolve(options.runner);
    options.snapshot = path.resolve(options.snapshot);
    fs.statSync(options.runner);
    var snapshot = fs.readFileSync(options.snapshot);
    var snapshotHash = crypto.createHash("sha256").update(snapshot).digest("hex");
    var snapshotBytes = snapshot.length;
    snapshot = null;
    fs.mkdirSync(outputDirectory);
    var report = {started: new Date().toISOString(), finished: null,
        nodeVersion: process.version, nodeArchitecture: process.arch,
        platform: os.type() + " " + os.release(), cpu: os.cpus()[0].model,
        timeoutSeconds: options.timeout, mode: "stock", snapshotBytes: snapshotBytes,
        snapshotSHA256: snapshotHash, results: []};
    var jobs = [];
    var hostIndex = 0;
    var hosts = ["node", "js_runner"];
    while (hostIndex < hosts.length) {
        var suiteIndex = 0;
        while (suiteIndex < suites.length) {
            jobs.push({host: hosts[hostIndex], suite: suites[suiteIndex++]});
        }
        hostIndex++;
    }
    function save() {
        fs.writeFileSync(path.join(outputDirectory, "results.json"),
            JSON.stringify(report, null, 2) + "\n");
    }
    function runNext() {
        if (!jobs.length) {
            report.finished = new Date().toISOString();
            save();
            console.log("All 30 stock runs completed; results: " + options.output);
            return;
        }
        var job = jobs.shift();
        var stem = job.host + "-" + job.suite;
        var logFile = path.join(outputDirectory, stem + ".log");
        var metricsFile = path.join(outputDirectory, stem + ".time.json");
        var command = job.host === "node" ?
            [process.execPath, "octane_node_runner.js", job.suite] :
            [options.runner, options.snapshot, "octane_runner.js", job.suite];
        job.started = new Date().toISOString();
        console.log(job.started + " START " + job.host + " " + job.suite);
        var logDescriptor = fs.openSync(logFile, "wx");
        var measured = ["-q", "-f",
            '{"wallSeconds":%e,"userSeconds":%U,"systemSeconds":%S,' +
            '"peakRssKiB":%M,"exitCode":%x}', "-o", metricsFile,
            "timeout", "--signal=TERM", "--kill-after=5s",
            String(options.timeout) + "s", "sh", "-c",
            'ulimit -c 0; exec "$@"', "octane-measurement"].concat(command);
        var child = childProcess.spawn("time", measured, {
            cwd: __dirname, stdio: ["ignore", logDescriptor, logDescriptor]
        });
        fs.closeSync(logDescriptor);
        child.on("error", function (error) { throw error; });
        child.on("close", function (exitCode, signal) {
            job.finished = new Date().toISOString();
            job.exitCode = exitCode;
            job.signal = signal;
            job.metrics = JSON.parse(fs.readFileSync(metricsFile, "utf8"));
            var log = fs.readFileSync(logFile, "utf8");
            var score = /^Score \(version [^)]+\): ([0-9.eE+\-]+)$/m.exec(log);
            job.score = score ? Number(score[1]) : null;
            job.status = exitCode === 0 && job.score !== null ? "pass" :
                exitCode === 124 || (exitCode === 137 &&
                    job.metrics.wallSeconds >= options.timeout) ? "timeout" :
                exitCode === 70 ? "semantic-exit" :
                exitCode >= 128 || signal ? "signal" : "failure";
            job.log = stem + ".log";
            report.results.push(job);
            save();
            console.log(job.finished + " END " + job.host + " " + job.suite +
                " " + job.status + " score=" + job.score +
                " wall_s=" + job.metrics.wallSeconds +
                " peak_rss_kib=" + job.metrics.peakRssKiB);
            if (signal === "SIGSYS" || exitCode === 159 ||
                    /Bad system call|Exec format error|cannot execute binary/.test(log)) {
                throw new Error("execution/sandbox failure; stopping rather than working around it");
            }
            runNext();
        });
    }
    save();
    runNext();
}());
