/* Serial developer acceptance/benchmark driver. Production builders themselves
 * need no Node or debugger. No compiler, binutils or external download is used
 * to generate an artifact; gdb/objdump are optional validation consumers. */
(function () {
    var fs = require("fs"), cp = require("child_process"), crypto = require("crypto");
    var format = require("../aot/standalone_format.js");
    var directory = "artifacts/kernel-debug-acceptance";
    var directoryOption = process.argv.indexOf("--directory");
    if (directoryOption !== -1) directory = process.argv[directoryOption + 1];
    var buildOnly = process.argv.indexOf("--build-only") !== -1;
    var resumeBuilds = process.argv.indexOf("--resume-builds") !== -1;
    var allHosts = process.argv.indexOf("--all-hosts") !== -1;
    for (var optionIndex = 2; optionIndex < process.argv.length; optionIndex++) {
        var option = process.argv[optionIndex];
        if (option === "--directory") {
            if (!process.argv[++optionIndex]) throw new Error("--directory needs a path");
        } else if (option !== "--build-only" && option !== "--resume-builds" && option !== "--all-hosts") {
            throw new Error("unknown check option: " + option);
        }
    }
    var paths = require("path");
    if (!directory || paths.resolve(directory).indexOf(paths.resolve("artifacts") + paths.sep) !== 0) {
        throw new Error("--directory must name a dedicated directory beneath artifacts/");
    }
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    var report = resumeBuilds ? JSON.parse(fs.readFileSync(directory + "/results.json", "utf8")) :
        {builds: [], executions: [], checks: []};
    function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
    function sourceIdentity() {
        var digest = crypto.createHash("sha256");
        function visit(path) {
            var stat = fs.lstatSync(path);
            if (stat.isSymbolicLink()) throw new Error("source identity requires ordinary files/directories: " + path);
            if (stat.isDirectory()) {
                var entries = fs.readdirSync(path).sort();
                for (var i = 0; i < entries.length; i++) {
                    if (entries[i] !== "artifacts" && entries[i] !== ".git" && entries[i] !== "node_modules") {
                        visit(path === "." ? entries[i] : path + "/" + entries[i]);
                    }
                }
            } else if (/\.js$/.test(path) && path !== "guest_vm/tools/check_kernel_debug_artifacts.js" &&
                path !== "guest_vm/tools/check_kernel_debug_gdb.js" && path !== "guest_vm/tools/benchmark_kernel_debug.js") {
                digest.update(path + "\u0000"); digest.update(fs.readFileSync(path));
            }
        }
        visit("."); return digest.digest("hex");
    }
    var sources = sourceIdentity();
    if (resumeBuilds && report.sourceSHA256 !== sources) {
        throw new Error("cannot resume: source contents changed or no source identity was recorded");
    }
    report.sourceSHA256 = sources;
    function run(name, command, args) {
        var start = new Date().getTime();
        console.log("RUN " + name);
        var result = cp.spawnSync("/usr/bin/time", ["-f", "%e %U %S %M", "-o",
            directory + "/" + name + ".time", command].concat(args), {
            encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 900000,
            env: process.env
        });
        fs.writeFileSync(directory + "/" + name + ".log", (result.stdout || "") + (result.stderr || ""));
        if (result.error || result.status !== 0) throw new Error(name + " failed: " +
            (result.error || result.status) + "; see " + directory + "/" + name + ".log");
        var time = fs.readFileSync(directory + "/" + name + ".time", "utf8").trim().split(/\s+/);
        return {name: name, elapsedMilliseconds: new Date().getTime() - start,
            realSeconds: Number(time[0]), userSeconds: Number(time[1]),
            systemSeconds: Number(time[2]), maxRSSKiB: Number(time[3])};
    }
    function check(condition, description) {
        if (!condition) throw new Error(description);
        report.checks.push(description); console.log("PASS " + description);
    }
    function save() { fs.writeFileSync(directory + "/results.json", JSON.stringify(report, null, 2) + "\n"); }
    function image(path) {
        var bytes = fs.readFileSync(path);
        var offset = bytes.readUInt32LE(format.fields.codeOffset);
        var length = bytes.readUInt32LE(format.fields.codeLength);
        return {bytes: bytes.length, sha256: hash(bytes), codeBytes: length,
            codeSHA256: hash(bytes.slice(offset, offset + length))};
    }
    function build(name, host, prefix, options) {
        var path = directory + "/" + name + ".snap";
        if (sourceIdentity() !== report.sourceSHA256) throw new Error("sources changed during build matrix");
        if (resumeBuilds) {
            for (var previousIndex = 0; previousIndex < report.builds.length; previousIndex++) {
                var previous = report.builds[previousIndex];
                if (previous.name === name) {
                    if (image(path).sha256 !== previous.image.sha256 ||
                        (previous.debugSHA256 && hash(fs.readFileSync(path + ".dbg")) !== previous.debugSHA256)) {
                        throw new Error("resume artifact changed: " + name);
                    }
                    console.log("RESUME build " + name); return previous;
                }
            }
            if (name.indexOf("node-") === 0 || name === "renamed") {
                throw new Error("--resume-builds needs completed Node builds: " + name);
            }
        }
        var result = run(name, host, prefix.concat(["guest_runner.js", "--vm-native"], options,
            ["--snapshot", path]));
        if (sourceIdentity() !== report.sourceSHA256) throw new Error("sources changed during " + name);
        result.image = image(path);
        if (options.indexOf("-g") !== -1) {
            var debug = fs.readFileSync(path + ".dbg");
            result.debugBytes = debug.length; result.debugSHA256 = hash(debug);
        }
        report.builds.push(result); save(); return result;
    }
    var normal = build("node-default", process.execPath, [], []);
    var debug = build("node-g", process.execPath, [], ["-g"]);
    var o0 = build("node-o0", process.execPath, [], ["-O0"]);
    var debugO0 = build("node-g-o0", process.execPath, [], ["-g", "-O0"]);
    var renamed = build("renamed", process.execPath, [], ["-g"]);
    check(normal.image.codeSHA256 === debug.image.codeSHA256, "optimized -g leaves code unchanged");
    check(o0.image.codeSHA256 === debugO0.image.codeSHA256, "-O0 -g leaves code unchanged");
    check(debug.image.sha256 === renamed.image.sha256 && debug.debugSHA256 === renamed.debugSHA256,
        "renamed snapshots and sidecars are bit identical");
    var tool = "guest_vm/tools/snapshot_to_exe.js";
    var executable = directory + "/debug.exe", secondExe = directory + "/renamed.exe";
    /* The production packager is intentionally no-clobber. */
    if (fs.existsSync(executable)) fs.unlinkSync(executable);
    if (fs.existsSync(secondExe)) fs.unlinkSync(secondExe);
    run("package-debug", process.execPath, [tool, directory + "/node-g.snap", executable,
        "--debug-info", directory + "/node-g.snap.dbg"]);
    run("package-renamed", process.execPath, [tool, directory + "/renamed.snap", secondExe,
        "--debug-info", directory + "/renamed.snap.dbg"]);
    check(hash(fs.readFileSync(executable)) === hash(fs.readFileSync(secondExe)), "renamed debug executables are bit identical");
    var snapshotPath = directory + "/node-g.snap", debugPath = snapshotPath + ".dbg";
    var snapshotBytes = fs.readFileSync(snapshotPath), debugBytes = fs.readFileSync(debugPath);
    check(snapshotBytes.slice(format.headerBytes).equals(
        fs.readFileSync(directory + "/node-default.snap").slice(format.headerBytes)),
        "optimized -g changes only snapshot binding metadata");
    check(fs.readFileSync(directory + "/node-g-o0.snap").slice(format.headerBytes).equals(
        fs.readFileSync(directory + "/node-o0.snap").slice(format.headerBytes)),
        "-O0 -g changes only snapshot binding metadata");
    var damagedPath = directory + "/damaged.dbg", damaged = fs.readFileSync(debugPath);
    damaged[damaged.length - 1] ^= 1; fs.writeFileSync(damagedPath, damaged);
    var rejectedOutput = directory + "/rejected.exe";
    if (fs.existsSync(rejectedOutput)) fs.unlinkSync(rejectedOutput);
    var rejected = cp.spawnSync(process.execPath, [tool, snapshotPath, rejectedOutput,
        "--debug-info", damagedPath], {encoding: "utf8"});
    check(rejected.status !== 0 && /sidecar does not match/.test(rejected.stderr) && !fs.existsSync(rejectedOutput),
        "same-size damaged sidecar rejected before output publication");
    var executableHash = hash(fs.readFileSync(executable));
    fs.unlinkSync(snapshotPath); fs.unlinkSync(debugPath);
    try {
        run("exe-no-inputs-hello", "./" + executable, ["hello.js"]);
        check(hash(fs.readFileSync(executable)) === executableHash,
            "executable runs without snapshot/sidecar and does not mutate itself");
    } finally {
        fs.writeFileSync(snapshotPath, snapshotBytes, {mode: 384});
        fs.writeFileSync(debugPath, debugBytes, {mode: 384});
    }
    var plain = directory + "/plain.exe";
    if (fs.existsSync(plain)) fs.unlinkSync(plain);
    fs.unlinkSync(debugPath);
    try {
        run("package-without-sidecar", process.execPath, [tool, snapshotPath, plain]);
        run("plain-hello", "./" + plain, ["hello.js"]);
    } finally { fs.writeFileSync(debugPath, debugBytes, {mode: 384}); }
    check(hash(fs.readFileSync(snapshotPath)) === debug.image.sha256 && hash(fs.readFileSync(debugPath)) === debug.debugSHA256,
        "packaging and execution leave input contents unchanged");
    var rejectDirectory = directory + "/resume-rejection";
    if (!fs.existsSync(rejectDirectory)) fs.mkdirSync(rejectDirectory);
    fs.writeFileSync(rejectDirectory + "/results.json", JSON.stringify({sourceSHA256: "changed", builds: []}));
    var resumeRejected = cp.spawnSync(process.execPath, ["guest_vm/tools/check_kernel_debug_artifacts.js",
        "--resume-builds", "--build-only", "--directory", rejectDirectory], {encoding: "utf8"});
    check(resumeRejected.status !== 0 && /cannot resume: source contents changed/.test(resumeRejected.stderr),
        "resume rejects changed source identity before running builds");
    if (allHosts) {
        var jsMin = process.env.JS_MIN_BINARY || "../../mmvm_v2/artifacts/js_min.exe";
        var minimal = build("js-min-g", jsMin, [], ["-g"]);
        check(debug.image.sha256 === minimal.image.sha256 && debug.debugSHA256 === minimal.debugSHA256,
            "Node/js_min snapshot and sidecar identity");
        var self = build("self-g", "./" + executable, [], ["-g"]);
        check(debug.image.sha256 === self.image.sha256 && debug.debugSHA256 === self.debugSHA256,
            "genuine self-hosted snapshot and sidecar identity");
        var shellExe = directory + "/shell.exe";
        if (fs.existsSync(shellExe)) fs.unlinkSync(shellExe);
        run("package-js-min", jsMin, [tool, directory + "/node-g.snap", shellExe,
            "--debug-info", directory + "/node-g.snap.dbg"]);
        check(hash(fs.readFileSync(executable)) === hash(fs.readFileSync(shellExe)), "Node/js_min executable identity");
        fs.unlinkSync(shellExe);
        run("package-self", "./" + executable, [tool, directory + "/node-g.snap", shellExe,
            "--debug-info", directory + "/node-g.snap.dbg"]);
        check(hash(fs.readFileSync(executable)) === hash(fs.readFileSync(shellExe)), "Node/self-hosted executable identity");
        var minimalO0 = build("js-min-g-o0", jsMin, [], ["-g", "-O0"]);
        check(debugO0.image.sha256 === minimalO0.image.sha256 && debugO0.debugSHA256 === minimalO0.debugSHA256,
            "Node/js_min -O0 snapshot and sidecar identity");
        var selfO0 = build("self-g-o0", "./" + executable, [], ["-g", "-O0"]);
        check(debugO0.image.sha256 === selfO0.image.sha256 && debugO0.debugSHA256 === selfO0.debugSHA256,
            "optimized host builds identical -O0 snapshot and sidecar");
        var o0Executable = directory + "/debug-o0.exe";
        if (fs.existsSync(o0Executable)) fs.unlinkSync(o0Executable);
        run("package-o0", process.execPath, [tool, directory + "/node-g-o0.snap", o0Executable,
            "--debug-info", directory + "/node-g-o0.snap.dbg"]);
        var ownO0 = build("self-o0-host", "./" + o0Executable, [], ["-g", "-O0"]);
        check(debugO0.image.sha256 === ownO0.image.sha256 && debugO0.debugSHA256 === ownO0.debugSHA256,
            "-O0 host genuinely rebuilds identical -O0 snapshot and sidecar");
    }
    if (buildOnly) { save(); console.log("kernel debug build checks passed: " + directory + "/results.json"); return; }
    var loader = process.env.JS_RUNNER_BINARY || "./artifacts/js_runner.exe";
    var policies = ["node-default", "node-g", "node-o0", "node-g-o0"];
    for (var p = 0; p < policies.length; p++) {
        var policy = policies[p];
        var workloads = [["hello", "hello.js"], ["core", "guest_vm/tests/run_tests.js"],
            ["gc", "guest_vm/tests/gc_stress_workload.js"],
            ["richards", "octane_runner.js", "--diagnostics", "Richards"]];
        for (var w = 0; w < workloads.length; w++) {
            var workload = workloads[w];
            report.executions.push(run(policy + "-" + workload[0], loader,
                [directory + "/" + policy + ".snap"].concat(workload.slice(1)))); save();
        }
    }
    /* The debug executable must also work with its input snapshot absent. */
    var snap = directory + "/node-g.snap";
    fs.unlinkSync(snap);
    try {
        report.executions.push(run("exe-no-snapshot-core", "./" + executable,
            ["guest_vm/tests/run_tests.js"]));
    } finally { fs.writeFileSync(snap, fs.readFileSync(directory + "/renamed.snap")); }
    save(); console.log("kernel debug artifact checks passed; results: " + directory + "/results.json");
}());
