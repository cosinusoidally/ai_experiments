/* Host-side HTTP smoke check against QEMU's loopback-only forwarded port.
 * node guest_vm/tools/xp_smoke/verify.js STAGING_DIRECTORY [PORT]
 * Does not provide any runtime support to the Windows guest. */
(function () {
    var fs = require("fs"), http = require("http"), args = process.argv.slice(2);
    if (!args[0]) throw new Error("expected CD staging directory [forwarded port]");
    var port = Number(args[1] || 18080), root = args[0], checks = 0;
    var tests = [
        {path: "/", status: 200, file: "index.html"},
        {path: "/bytes.bin", status: 200, file: "bytes.bin"},
        {path: "/bytes.bin", method: "HEAD", status: 200, file: "bytes.bin"},
        {path: "/missing", status: 404}
    ];
    function check(value, message) { if (!value) throw new Error(message); checks++; }
    function next() {
        if (!tests.length) { console.log("XP HTTP smoke passed: " + checks + " checks"); return; }
        var test = tests.shift(), req = http.request({host: "127.0.0.1", port: port,
            path: test.path, method: test.method || "GET", agent: false}, function (response) {
            var chunks = [];
            response.on("data", function (chunk) { chunks.push(chunk); });
            response.on("end", function () {
                try {
                    var body = Buffer.concat(chunks);
                    check(response.statusCode === test.status, test.path + " HTTP status " + response.statusCode);
                    if (test.file) {
                        var expected = fs.readFileSync(root + "/WWW/" + test.file);
                        check(Number(response.headers["content-length"]) === expected.length, "content length");
                        if (test.method === "HEAD") check(body.length === 0, "HEAD without body");
                        else check(body.equals(expected), "exact response bytes: " + test.path);
                    }
                    console.log("PASS " + (test.method || "GET") + " " + test.path + " " + response.statusCode);
                    next();
                } catch (error) { console.error(error.stack); process.exitCode = 1; }
            });
            response.on("error", fail);
        });
        req.setTimeout(20000, function () { req.destroy(new Error("XP response timed out")); });
        req.on("error", fail); req.end();
    }
    function fail(error) { console.error(error.message); process.exitCode = 1; }
    next();
}());
