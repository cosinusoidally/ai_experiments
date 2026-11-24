/* Sequential stock Octane measurement harness. Requires Node only to run
 * the reference engine and supervise separate child processes: the guest
 * command is still js_runner snapshot octane_runner.js SUITE, with no host
 * JavaScript support. GNU time/timeout measure and bound both engines.
 *
 * node octane_compare.js --snapshot artifacts/snap --output artifacts/run
 * node octane_compare.js --node-jitless --snapshot artifacts/snap --output artifacts/run-jitless
 * --reference-snapshot IMAGE compares two guest images, paired by suite,
 * instead of using Node as the reference. --include A,B selects a diagnostic
 * subset; the exact selection and both image identities are recorded.
 * Generated logs/results go exclusively in the requested artifact directory.
 * --node-jitless changes only the reference Node process. Exclusions and
 * reference flags are recorded explicitly in results.json. This harness does
 * not modify the external Octane checkout or VM sources.
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
        output: null, timeout: 900, exclude: "", include: "",
        referenceSnapshot: null, nodeJitless: false};
    var argumentIndex = 2;
    while (argumentIndex < process.argv.length) {
        var argument = process.argv[argumentIndex++];
        if (argument === "--node-jitless") {
            options.nodeJitless = true;
            continue;
        }
        if (argument !== "--snapshot" && argument !== "--runner" &&
                argument !== "--output" && argument !== "--timeout" &&
                argument !== "--exclude" && argument !== "--include" &&
                argument !== "--reference-snapshot") {
            throw new Error("unknown option: " + argument);
        }
        if (argumentIndex >= process.argv.length) {
            throw new Error("missing value for " + argument);
        }
        var value = process.argv[argumentIndex++];
        if (argument === "--reference-snapshot") options.referenceSnapshot = value;
        else options[argument.substring(2)] = value;
    }
    options.timeout = Number(options.timeout);
    if (!(options.timeout >= 1 && options.timeout <= 3600) ||
            options.timeout !== Math.floor(options.timeout)) {
        throw new Error("--timeout must be an integer from 1 to 3600 seconds");
    }
    if (!options.output) throw new Error("--output is required");
    if (options.referenceSnapshot && options.nodeJitless) {
        throw new Error("--node-jitless cannot select a guest-image reference");
    }
    var excluded = options.exclude ? options.exclude.split(",") : [];
    var exclusionIndex = 0;
    while (exclusionIndex < excluded.length) {
        if (suites.indexOf(excluded[exclusionIndex++]) === -1) {
            throw new Error("unknown excluded suite: " + options.exclude);
        }
    }
    var included = options.include ? options.include.split(",") : suites.slice(0);
    var selected = [], selectionIndex = 0;
    while (selectionIndex < included.length) {
        var selectedSuite = included[selectionIndex++];
        if (suites.indexOf(selectedSuite) === -1) {
            throw new Error("unknown included suite: " + selectedSuite);
        }
        if (excluded.indexOf(selectedSuite) === -1 && selected.indexOf(selectedSuite) === -1) {
            selected.push(selectedSuite);
        }
    }
    if (!selected.length) throw new Error("no suites selected");
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
    var referenceMetadata = null;
    if (options.referenceSnapshot) {
        options.referenceSnapshot = path.resolve(options.referenceSnapshot);
        var referenceBytes = fs.readFileSync(options.referenceSnapshot);
        referenceMetadata = {
            snapshotBytes: referenceBytes.length,
            snapshotSHA256: crypto.createHash("sha256").update(referenceBytes).digest("hex")
        };
        referenceBytes = null;
    }
    fs.mkdirSync(outputDirectory);
    var report = {started: new Date().toISOString(), finished: null,
        nodeVersion: process.version, nodeArchitecture: process.arch,
        nodeFlags: options.nodeJitless ? ["--jitless"] : [],
        platform: os.type() + " " + os.release(), cpu: os.cpus()[0].model,
        timeoutSeconds: options.timeout, mode: "stock", snapshotBytes: snapshotBytes,
        snapshotSHA256: snapshotHash, referenceSnapshot: referenceMetadata,
        selectedSuites: selected, excludedSuites: excluded, results: []};
    var jobs = [];
    var hostIndex = 0;
    var hosts = options.referenceSnapshot ? ["reference_js_runner", "js_runner"] :
        ["node", "js_runner"];
    if (options.referenceSnapshot) {
        for (selectionIndex = 0; selectionIndex < selected.length; selectionIndex++) {
            jobs.push({host: hosts[0], suite: selected[selectionIndex]});
            jobs.push({host: hosts[1], suite: selected[selectionIndex]});
        }
    } else {
        while (hostIndex < hosts.length) {
            var suiteIndex = 0;
            while (suiteIndex < selected.length) {
                var suite = selected[suiteIndex++];
                jobs.push({host: hosts[hostIndex], suite: suite});
            }
            hostIndex++;
        }
    }
    var totalJobs = jobs.length;
    function save() {
        fs.writeFileSync(path.join(outputDirectory, "results.json"),
            JSON.stringify(report, null, 2) + "\n");
    }
    function runNext() {
        if (!jobs.length) {
            report.finished = new Date().toISOString();
            save();
            console.log("All " + totalJobs + " stock runs completed; results: " + options.output);
            return;
        }
        var job = jobs.shift();
        var stem = job.host + "-" + job.suite;
        var logFile = path.join(outputDirectory, stem + ".log");
        var metricsFile = path.join(outputDirectory, stem + ".time.json");
        var command = job.host === "node" ?
            [process.execPath].concat(options.nodeJitless ? ["--jitless"] : [],
                ["octane_node_runner.js", job.suite]) :
            [options.runner, job.host === "reference_js_runner" ?
                options.referenceSnapshot : options.snapshot, "octane_runner.js", job.suite];
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
