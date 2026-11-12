/* Serial developer acceptance/benchmark driver. Production builders themselves
 * need no Node or debugger. No compiler, binutils or external download is used
 * to generate an artifact; gdb/objdump are optional validation consumers. */
(function () {
    var fs = require("fs"), cp = require("child_process"), crypto = require("crypto");
    var directory = "artifacts/kernel-debug-acceptance";
    var allHosts = process.argv.indexOf("--all-hosts") !== -1;
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    var report = {builds: [], executions: [], checks: []};
    function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
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
        var offset = bytes.readUInt32LE(20), length = bytes.readUInt32LE(24);
        return {bytes: bytes.length, sha256: hash(bytes), codeBytes: length,
            codeSHA256: hash(bytes.slice(offset, offset + length))};
    }
    function build(name, host, prefix, options) {
        var path = directory + "/" + name + ".snap";
        var result = run(name, host, prefix.concat(["guest_runner.js", "--vm-native"], options,
            ["--snapshot", path]));
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
    }
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
    var snap = directory + "/node-g.snap", saved = snap + ".saved";
    fs.renameSync(snap, saved);
    try {
        report.executions.push(run("exe-no-snapshot-core", "./" + executable,
            ["guest_vm/tests/run_tests.js"]));
    } finally { fs.renameSync(saved, snap); }
    save(); console.log("kernel debug artifact checks passed; results: " + directory + "/results.json");
}());
