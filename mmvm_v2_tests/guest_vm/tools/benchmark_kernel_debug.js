/* Frozen-image, serial, resumable final performance/correctness matrix.
 * This optional Node supervisor does not implement any guest language feature.
 * Usage: node guest_vm/tools/benchmark_kernel_debug.js artifacts/BUILD_DIRECTORY
 * Images are produced by check_kernel_debug_artifacts.js. */
(function () {
    var fs = require("fs"), cp = require("child_process"), crypto = require("crypto");
    var directory = process.argv[2];
    if (!directory) throw new Error("usage: benchmark_kernel_debug.js artifacts/BUILD_DIRECTORY");
    var short = process.argv.indexOf("--short") !== -1;
    var controlOption = process.argv.indexOf("--control");
    var control = controlOption !== -1 ? process.argv[controlOption + 1] : null;
    var ecmaOption = process.argv.indexOf("--ecma-baseline");
    var ecmaBaseline = ecmaOption !== -1 ? process.argv[ecmaOption + 1] : null;
    var file = directory + (short ? "/short-matrix.json" : "/full-matrix.json");
    var modes = ["node-default", "node-g", "node-o0", "node-g-o0"];
    if (control) modes.push("control");
    function snapshot(mode) { return mode === "control" ? control : directory + "/" + mode + ".snap"; }
    var suites = ["Richards", "DeltaBlue", "Crypto", "RayTrace", "EarleyBoyer", "RegExp",
        "Splay", "NavierStokes", "PdfJS", "Mandreel", "Gameboy", "CodeLoad", "Box2D", "zlib", "Typescript"];
    var report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) :
        {cachePolicy: "serial runs, ordinary OS file cache; no cache drops", images: {}, results: []};
    function digest(path) { return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"); }
    function save() { fs.writeFileSync(file + ".tmp", JSON.stringify(report, null, 2) + "\n"); fs.renameSync(file + ".tmp", file); }
    var index;
    for (index = 0; index < modes.length; index++) {
        var mode = modes[index], hash = digest(snapshot(mode));
        if (report.images[mode] && report.images[mode] !== hash) throw new Error("frozen matrix image changed: " + mode);
        report.images[mode] = hash;
    }
    save();
    function records(log) {
        var lines = log.split("\n"), result = {}, i;
        for (i = 0; i < lines.length; i++) {
            var match = /^(PASS|FAIL|SKIP) ([^; :]+)(?:[; :]|$)/.exec(lines[i]);
            if (match) result[match[2]] = match[1];
        }
        return result;
    }
    if (ecmaBaseline) {
        var baselineHash = digest(ecmaBaseline);
        if (report.ecmaBaseline && report.ecmaBaseline.sha256 !== baselineHash) {
            throw new Error("archived ECMA baseline changed");
        }
        report.ecmaBaseline = {sha256: baselineHash, files: records(fs.readFileSync(ecmaBaseline, "utf8"))};
        save();
    }
    function run(mode, name, args) {
        var id = mode + "-full-" + name, previous;
        for (var i = 0; i < report.results.length; i++) {
            if (report.results[i].id === id) { previous = report.results[i]; break; }
        }
        if (previous) { console.log("RESUME completed " + id); return; }
        console.log("RUN " + id);
        var start = new Date().getTime();
        var result = cp.spawnSync("/usr/bin/time", ["-f", "%e %U %S %M", "-o", directory + "/" + id + ".time",
            "./artifacts/js_runner.exe", snapshot(mode)].concat(args), {
            encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 3600000, env: process.env
        });
        var log = (result.stdout || "") + (result.stderr || "");
        fs.writeFileSync(directory + "/" + id + ".log", log);
        var time = fs.existsSync(directory + "/" + id + ".time") ?
            fs.readFileSync(directory + "/" + id + ".time", "utf8").trim().split(/\s+/) : [];
        var entry = {id: id, mode: mode, workload: name, status: result.status,
            error: result.error ? String(result.error) : null,
            elapsedMilliseconds: new Date().getTime() - start};
        /* time may prefix a nonzero-exit diagnostic. Its final line is numeric. */
        if (time.length >= 4) {
            time = time.slice(-4); entry.realSeconds = Number(time[0]);
            entry.userSeconds = Number(time[1]); entry.systemSeconds = Number(time[2]); entry.maxRSSKiB = Number(time[3]);
        }
        var score = /Score \(version 9\): ([^\r\n]+)/.exec(log);
        if (score) entry.score = score[1];
        var latency = /benchmark [^:]+: mean_us=([^;]+); latency=([^\r\n]+)/g, match;
        entry.benchmarks = [];
        while ((match = latency.exec(log))) entry.benchmarks.push({meanMicroseconds: Number(match[1]), latency: Number(match[2])});
        if (name === "test262" || name === "ecma") {
            entry.files = records(log); entry.counts = {PASS: 0, FAIL: 0, SKIP: 0};
            for (var key in entry.files) entry.counts[entry.files[key]]++;
            entry.complete = name === "test262" ? log.indexOf("Test262 ES5.1 summary") >= 0 :
                log.indexOf("ECMA ES1--ES5.1 corpus summary") >= 0;
            var baseline = name === "ecma" ? report.ecmaBaseline : null;
            for (i = 0; i < report.results.length; i++) {
                if (report.results[i].mode === "node-default" && report.results[i].workload === name) baseline = report.results[i];
            }
            entry.lostPasses = [];
            if (baseline) for (key in baseline.files) {
                if (baseline.files[key] === "PASS" && entry.files[key] !== "PASS") entry.lostPasses.push(key);
            }
        }
        report.results.push(entry); save();
        console.log("DONE " + id + ": status " + entry.status + ", " + entry.realSeconds + " s, score " + (entry.score || "n/a"));
        /* Native execution failures need investigation, not emulation or an
         * automatic flood of further processes. Ordinary corpus failures are
         * recorded and the matrix continues to reveal every result. */
        if (result.signal || result.error || result.status >= 126) {
            throw new Error("matrix process failed: " + id + ": " + (result.signal || result.error || result.status));
        }
    }
    if (short) {
        for (var round = 0; round < 3; round++) {
            for (index = 0; index < modes.length; index++) {
                mode = modes[(index + round) % modes.length];
                run(mode, "richards-round-" + round, ["octane_runner.js", "--diagnostics", "Richards"]);
                run(mode, "hello-round-" + round, ["hello.js"]);
            }
        }
        console.log("paired serial controls completed: " + file); return;
    }
    for (index = 0; index < modes.length; index++) {
        mode = modes[index];
        run(mode, "test262", ["test262_runner.js"]);
        run(mode, "ecma", ["ecma_tests_runner.js"]);
        for (var suite = 0; suite < suites.length; suite++) {
            run(mode, "octane-" + suites[suite], ["octane_runner.js", "--diagnostics", suites[suite]]);
        }
    }
    console.log("full serial kernel-policy matrix completed: " + file);
}());
