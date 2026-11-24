/* Node-builtins-only integration supervisor. The server itself is the unchanged
 * node_web.js running in the chosen VM, with no Node host services.
 * From mmvm_v2_tests:
 *   node guest_vm/tools/check_node_web.js --wine artifacts/win.exe
 *   node guest_vm/tools/check_node_web.js --native artifacts/linux.exe
 *   node guest_vm/tools/check_node_web.js --js-min ../../mmvm_v2/artifacts/js_min.exe
 * --all-interfaces omits --bind and checks the existing default as well.
 * Fixtures/logs stay in an exclusively created directory under artifacts.
 * Guest executables run there with only node_web.js and fixtures, so the
 * source checkout cannot accidentally supply missing runtime modules. */
(function () {
    var fs = require("fs"), cp = require("child_process"), http = require("http"), net = require("net");
    var paths = require("path");
    var args = process.argv.slice(2), mode = args.shift(), binary = args.shift();
    if (!binary || ["--wine", "--native", "--js-min"].indexOf(mode) < 0 ||
            args.length > 1 || (args.length && args[0] !== "--all-interfaces")) {
        throw new Error("expected --wine|--native|--js-min EXECUTABLE [--all-interfaces]");
    }
    var root = fs.mkdtempSync("artifacts/network-web-"), log = "", checks = 0, stopping = false;
    var sockets = [], requests = [], port = 0, started = Date.now();
    var payload = Buffer.alloc(256 * 1024);
    for (var i = 0; i < payload.length; i++) payload[i] = (i * 37 + (i >>> 8)) & 255;
    fs.writeFileSync(root + "/bytes.bin", payload);
    fs.writeFileSync(root + "/hello.txt", "Hello, network!\r\n");
    fs.writeFileSync(root + "/space name.txt", "space\n");
    fs.mkdirSync(root + "/indexed"); fs.writeFileSync(root + "/indexed/index.html", "<h1>Index</h1>\n");
    fs.mkdirSync(root + "/listing"); fs.writeFileSync(root + "/listing/item.txt", "listed\n");
    fs.copyFileSync("node_web.js", root + "/node_web.js");
    binary = paths.resolve(binary);
    var command = mode === "--wine" ? "wine" : binary;
    var childArgs = mode === "--wine" ? [binary] : [];
    if (mode === "--js-min") childArgs.push("node_runner.js");
    childArgs.push("node_web.js", "--directory", mode === "--js-min" ? root : ".", "0");
    if (!args.length) childArgs.push("--bind", "127.0.0.1");
    var child = cp.spawn(command, childArgs, {cwd: mode === "--js-min" ? process.cwd() : paths.resolve(root),
        stdio: ["ignore", "pipe", "pipe"]});
    var watchdog = setTimeout(function () { finish(new Error("server acceptance exceeded 90 seconds")); }, 90000);
    function check(condition, message) {
        if (!condition) throw new Error(message);
        checks++;
    }
    function finish(error) {
        if (stopping) return;
        stopping = true; clearTimeout(watchdog);
        for (var j = 0; j < sockets.length; j++) sockets[j].destroy();
        for (j = 0; j < requests.length; j++) requests[j].destroy();
        child.kill("SIGTERM");
        fs.writeFileSync(root + "/server.log", log);
        if (error) {
            console.error(error.stack || String(error)); console.error(log); process.exitCode = 1;
        } else console.log("node_web acceptance passed: " + checks + " checks in " +
            ((Date.now() - started) / 1000).toFixed(2) + " s; " + root);
    }
    function series(tasks, done) {
        var next = 0;
        function step(error) {
            if (stopping) return;
            if (error || next === tasks.length) { done(error); return; }
            try { tasks[next++](step); } catch (failure) { done(failure); }
        }
        step();
    }
    function request(path, method, callback) {
        var req = http.request({host: "127.0.0.1", port: port, path: path, method: method,
            agent: false}, function (response) {
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("error", callback);
            response.on("end", function () {
                try { callback(null, response, Buffer.concat(chunks)); }
                catch (error) { finish(error); }
            });
        });
        requests.push(req); req.on("error", callback); req.end();
    }
    function responseTest(path, method, status, verify) {
        return function (done) {
            request(path, method, function (error, response, body) {
                if (error) { done(error); return; }
                check(response.statusCode === status, method + " " + path + " status " + response.statusCode);
                if (verify) verify(body, response); done();
            });
        };
    }
    function startTests() {
        console.log("server ready on " + port + "; " + mode + (args.length ? "; default bind" : "; loopback bind"));
        series([
            responseTest("/hello.txt", "GET", 200, function (body) { check(body.toString() === "Hello, network!\r\n", "text bytes"); }),
            responseTest("/bytes.bin", "GET", 200, function (body, response) {
                check(body.equals(payload), "all binary bytes, including NUL/CR/LF/high bytes");
                check(Number(response.headers["content-length"]) === payload.length, "binary content length");
            }),
            responseTest("/bytes.bin", "HEAD", 200, function (body, response) {
                check(body.length === 0 && Number(response.headers["content-length"]) === payload.length, "HEAD length without body");
            }),
            responseTest("/indexed", "GET", 301, function (body, response) { check(response.headers.location === "/indexed/", "directory redirect"); }),
            responseTest("/indexed/", "GET", 200, function (body) { check(body.toString() === "<h1>Index</h1>\n", "default index"); }),
            responseTest("/listing/", "GET", 200, function (body) { check(body.toString().indexOf("item.txt") >= 0, "directory listing"); }),
            responseTest("/space%20name.txt?ignored=yes", "GET", 200, function (body) { check(body.toString() === "space\n", "URL decoding and query"); }),
            responseTest("/missing", "GET", 404), responseTest("/hello.txt", "POST", 405),
            responseTest("/%ZZ", "GET", 400), responseTest("/../hello.txt", "GET", 400),
            responseTest("/bad%5cpath", "GET", 400),
            incompleteRequest, manyConnections, slowReader, abortedResponse,
            function (done) {
                check(log.indexOf('"GET /bytes.bin HTTP/1.1" 200') >= 0, "stdout request logging");
                done();
            }
        ], finish);
    }
    function incompleteRequest(done) {
        var socket = net.connect(port, "127.0.0.1", function () {
            socket.write("GET /hello.txt HTTP/1.1\r\nHost: localhost\r\n");
            request("/hello.txt", "GET", function (error, response) {
                if (error) { done(error); return; }
                check(response.statusCode === 200, "incomplete request does not block another client");
                socket.destroy(); done();
            });
        });
        sockets.push(socket); socket.on("error", done);
    }
    function manyConnections(done) {
        var opened = 0, completed = 0, group = [], count = 80;
        for (var j = 0; j < count; j++) {
            var socket = net.connect(port, "127.0.0.1"); group.push(socket); sockets.push(socket);
            socket.on("error", done);
            socket.on("connect", function () {
                if (++opened === count) {
                    for (var k = 0; k < group.length; k++) group[k].write("GET /hello.txt HTTP/1.0\r\n\r\n");
                }
            });
            collect(socket);
        }
        function collect(socket) {
            var chunks = [];
            socket.on("data", function (chunk) { chunks.push(chunk); });
            socket.on("end", function () {
                try {
                    var text = Buffer.concat(chunks).toString();
                    check(text.indexOf("200 OK") >= 0 && text.indexOf("Hello, network!") >= 0,
                        "response with more than 64 active sockets");
                    socket.destroy(); if (++completed === count) done();
                } catch (error) { done(error); }
            });
        }
    }
    function slowReader(done) {
        var chunks = [], socket = net.connect(port, "127.0.0.1", function () {
            socket.write("GET /bytes.bin HTTP/1.0\r\n\r\n"); socket.pause();
            request("/hello.txt", "GET", function (error, response) {
                if (error) { done(error); return; }
                check(response.statusCode === 200, "slow reader does not block another client");
                setTimeout(function () { socket.resume(); }, 100);
            });
        });
        sockets.push(socket); socket.on("error", done);
        socket.on("data", function (chunk) { chunks.push(chunk); });
        socket.on("end", function () {
            try {
                var bytes = Buffer.concat(chunks), header = bytes.indexOf("\r\n\r\n");
                check(header >= 0 && bytes.slice(header + 4).equals(payload), "slow reader binary response");
                socket.destroy(); done();
            } catch (error) { done(error); }
        });
    }
    function abortedResponse(done) {
        var socket = net.connect(port, "127.0.0.1", function () {
            socket.write("GET /bytes.bin HTTP/1.0\r\n\r\n");
        });
        sockets.push(socket); socket.on("error", done);
        socket.once("data", function () {
            socket.destroy();
            request("/hello.txt", "GET", function (error, response) {
                if (error) { done(error); return; }
                check(response.statusCode === 200, "aborted response does not kill server"); done();
            });
        });
    }
    function capture(data) {
        log += data.toString();
        if (!port) {
            var match = /at http:\/\/([^:]+):(\d+)\//.exec(log);
            if (match) {
                try { check(match[1] === (args.length ? "0.0.0.0" : "127.0.0.1"), "requested bind address"); }
                catch (error) { finish(error); return; }
                port = Number(match[2]); setTimeout(startTests, 0);
            }
        }
    }
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    child.on("error", finish);
    child.on("exit", function (code, signal) {
        if (!stopping) finish(new Error("server exited: " + code + ", " + signal));
    });
}());
