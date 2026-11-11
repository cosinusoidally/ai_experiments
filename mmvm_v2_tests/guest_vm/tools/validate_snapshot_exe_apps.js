/* Bounded serial graphical/HTTP acceptance. Node supervises; applications
 * themselves run wholly in the standalone guest VM. Run from mmvm_v2_tests:
 * node guest_vm/tools/validate_snapshot_exe_apps.js SNAP EXE OUTDIR
 * The source snapshot is deleted before the executable half starts. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var http = require("http"), crypto = require("crypto");
    var args = process.argv.slice(2), snapshot = args[0], executable = path.resolve(args[1] || "");
    var output = args[2], onlyPhase = null, programsOnly = false;
    for (var option = 3; option < args.length; option++) {
        if (args[option] === "--phase") onlyPhase = args[++option];
        else if (args[option] === "--only-programs") programsOnly = true;
        else throw new Error("unknown application validation option: " + args[option]);
    }
    var phase = onlyPhase || "snapshot", results = [], index = 0;
    if (args.length < 3 || onlyPhase && onlyPhase !== "snapshot" && onlyPhase !== "exe" ||
            path.resolve(output).indexOf(path.resolve("artifacts") + path.sep) !== 0) {
        throw new Error("usage: validate_snapshot_exe_apps.js SNAP EXE artifacts/NEW_DIRECTORY [--phase snapshot|exe] [--only-programs]");
    }
    fs.mkdirSync(output);
    function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
    if (phase === "exe" && fs.existsSync(snapshot)) throw new Error("source snapshot must be absent");
    var snapshotHash = phase === "snapshot" ? digest(snapshot) : null, exeHash = digest(executable);
    var www = path.join(output, "www"), text = "text <and> binary-safe\n";
    var html = "<!doctype html><title>index fixture</title>index fixture\n";
    var binary = Buffer.alloc(4096), i;
    for (i = 0; i < binary.length; i++) binary[i] = i * 73 + 19 & 255;
    fs.mkdirSync(www); fs.mkdirSync(path.join(www, "nested"));
    fs.writeFileSync(path.join(www, "hello.txt"), text);
    fs.writeFileSync(path.join(www, "binary.bin"), binary);
    fs.writeFileSync(path.join(www, "space name.txt"), text);
    fs.writeFileSync(path.join(www, "nested/index.html"), html);
    var titles = ["RGB framebuffer", "procedural anti-gravity racer", "full-frame blit benchmark",
        "procedural normal mapping", "normal-mapped anti-gravity racer", "Welsh upland rally",
        "Welsh upland rally", "Welsh upland rally"];
    var jobs = [];
    if (programsOnly) {
    jobs.push({name: "raw-ffi", program: ["guest_vm/tests/raw_ffi_file_guest.js"]});
    jobs.push({name: "frontend", program: ["guest_vm/tests/self_hosted_frontend_test.js"]});
    jobs.push({name: "frontend-net", program: ["guest_vm/tests/self_hosted_compile_file.js", "net.js"],
        expected: "self-hosted compile passed: net.js"});
    jobs.push({name: "native-dependencies", program: ["demo8_runner.js", "native_compiler_dependencies_test.js"],
        expected: "NativeCompiler dependency graph test passed: 7 functions"});
    jobs.push({name: "demo8-io", program: ["demo8_runner.js", "guest_vm/tests/demo8_runner_io_guest.js"],
        expected: "demo8 runner I/O probe:"});
    jobs.push({name: "contexts", program: ["guest_vm/demos/three_contexts.js"],
        expected: "[embedder] cx_a and cx_b shut down after 100 multiplexed calls"});
    } else {
    for (i = 1; i <= 8; i++) jobs.push({name: "demo" + i, demo: i});
    jobs.push({name: "net", server: "net.js"});
    jobs.push({name: "node-web", server: "node_web.js"});
    jobs.push({name: "node-hello", server: "node_hello.js"});
    }
    function save() {
        fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({phase: phase,
            snapshotSHA256: snapshotHash, exeSHA256: exeHash,
            sourceAbsent: !fs.existsSync(snapshot), results: results}, null, 2) + "\n");
    }
    function request(port, route, method, status, body, complete) {
        var req = http.request({host: "127.0.0.1", port: port, path: route, method: method}, function (response) {
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("end", function () {
                var bytes = Buffer.concat(chunks), error = null;
                if (response.statusCode !== status) error = new Error(route + " HTTP " + response.statusCode);
                else if (body !== null && !bytes.equals(Buffer.isBuffer(body) ? body : Buffer.from(body))) {
                    error = new Error(route + " content mismatch");
                } else if (method === "HEAD" && Number(response.headers["content-length"]) !== binary.length) {
                    error = new Error("HEAD Content-Length mismatch");
                } else if (route === "/" && status === 200 && body === null &&
                        bytes.toString("utf8").indexOf("hello.txt") < 0) {
                    error = new Error("directory listing missing file");
                }
                complete(error);
            });
        });
        req.setTimeout(10000, function () { req.destroy(new Error("HTTP request timeout")); });
        req.on("error", complete); req.end();
    }
    function next() {
        if (index === jobs.length) {
            if (onlyPhase || phase === "exe") {
                phase = "finished"; save();
                for (var resultIndex = 0; resultIndex < results.length; resultIndex++) {
                    if (!results[resultIndex].pass) process.exitCode = 1;
                }
                console.log("application matrix finished"); return;
            }
            if (phase === "snapshot") {
                if (digest(snapshot) !== snapshotHash || digest(executable) !== exeHash) throw new Error("input mutated");
                fs.unlinkSync(snapshot); phase = "exe"; index = 0;
                console.log("DELETED source snapshot before executable application runs"); save();
            }
        }
        if (phase === "exe" && fs.existsSync(snapshot)) throw new Error("source snapshot reappeared");
        var job = jobs[index++], stem = phase + "-" + job.name;
        var launch = phase === "snapshot" ? [snapshot] : [];
        if (job.program) launch = launch.concat(job.program);
        else if (job.demo) {
            launch = launch.concat(job.demo === 8 ? ["demo8_runner.js", "demo8.js"] : ["demo" + job.demo + ".js"]);
            launch = launch.concat(["--size", "320x240"]);
        } else if (job.server === "node_hello.js") launch = launch.concat([job.server, "0", "127.0.0.1"]);
        else launch = launch.concat([job.server, "--bind", "127.0.0.1", "--directory", www, "0"]);
        var logFile = path.join(output, stem + ".log"), fd = fs.openSync(logFile, "w");
        var started = Date.now(), stopped = false, recorded = false, problem = null, ready = false;
        var environment = {}, environmentName;
        for (environmentName in process.env) environment[environmentName] = process.env[environmentName];
        if (!environment.XAUTHORITY) environment.XAUTHORITY = path.join(environment.HOME, ".Xauthority");
        var child = cp.spawn(phase === "snapshot" ? "./artifacts/js_runner.exe" : executable,
            launch, {stdio: ["ignore", fd, fd], env: environment});
        fs.closeSync(fd); console.log("START " + stem + (phase === "exe" ? " (snapshot absent)" : ""));
        var timeout = setTimeout(function () { finish(new Error("application watchdog")); }, 120000);
        var killTimer = null;
        function finish(error, natural) {
            if (stopped) return;
            stopped = true; problem = error || null; clearInterval(poll); clearTimeout(timeout);
            if (natural) return record();
            child.kill("SIGTERM"); killTimer = setTimeout(function () { child.kill("SIGKILL"); }, 3000);
        }
        function record() {
            if (recorded) return;
            recorded = true;
            clearTimeout(killTimer);
            results.push({phase: phase, name: job.name, pass: !problem, error: problem && problem.message,
                elapsedMs: Date.now() - started, sourceAbsent: !fs.existsSync(snapshot)});
            save(); console.log("END " + stem + (problem ? " FAIL " + problem.message : " PASS"));
            next();
        }
        child.on("error", function (error) { finish(error, true); });
        child.on("close", function (status, signal) {
            if (!stopped) {
                if (job.program && status === 0) {
                    var log = fs.readFileSync(logFile, "utf8");
                    finish(job.expected && log.indexOf(job.expected) < 0 ? new Error("missing completion marker") : null, true);
                } else if (job.demo && ready && status === 0) finish(null, true);
                else finish(new Error("early exit status=" + status + " signal=" + signal), true);
            } else record();
        });
        function keys(sequence, delay) {
            var driver = cp.spawn(process.execPath, ["demo8_x11_test.js", "--title",
                "demo" + job.demo + ".js " + titles[job.demo - 1], "--keys", sequence,
                "--delay", String(delay)], {stdio: "ignore"});
            driver.on("error", finish);
            driver.on("close", function (status) { if (status !== 0 && !stopped) finish(new Error("X11 sender failed")); });
        }
        var poll = setInterval(function () {
            if (job.program || ready || stopped) return;
            var log = fs.readFileSync(logFile, "utf8"), match;
            if (job.demo) {
                if (log.indexOf("frame rate:") < 0) return;
                ready = true;
                if (job.demo === 8) keys("Escape,g,Escape,a,Escape,q", 2500);
                else keys("Escape", 100);
            } else {
                match = /http:\/\/127\.0\.0\.1:([0-9]+)\//.exec(log);
                if (!match) return;
                ready = true;
                var port = Number(match[1]);
                var requests = job.server === "node_hello.js" ? [["/", "GET", 200, "Hello, world!\n"]] : [
                    ["/", "GET", 200, null], ["/hello.txt", "GET", 200, text],
                    ["/binary.bin", "GET", 200, binary], ["/binary.bin", "HEAD", 200, ""],
                    ["/space%20name.txt", "GET", 200, text], ["/nested/", "GET", 200, html],
                    ["/missing", "GET", 404, null], ["/nested", "GET", 301, null], ["/", "POST", 405, null]
                ];
                var requestIndex = 0;
                function nextRequest(error) {
                    if (error || requestIndex === requests.length) return finish(error);
                    var item = requests[requestIndex++];
                    request(port, item[0], item[1], item[2], item[3], nextRequest);
                }
                nextRequest(null);
            }
        }, 200);
    }
    next();
}());
