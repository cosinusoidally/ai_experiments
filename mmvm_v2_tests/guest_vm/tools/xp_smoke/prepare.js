/* Stage a small read-only CD payload; run from mmvm_v2_tests with Node.
 * The actual server runs inside XP without Node or other build tools. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var directory = process.argv[2];
    if (!directory) throw new Error("expected new staging directory under artifacts");
    var resolved = path.resolve(directory), artifacts = path.resolve("artifacts") + path.sep;
    if (resolved.substring(0, artifacts.length) !== artifacts) throw new Error("staging must be under artifacts");
    fs.mkdirSync(directory); fs.mkdirSync(directory + "/WWW");
    fs.copyFileSync("artifacts/guest_vm-win32.exe", directory + "/GUEST.EXE");
    fs.copyFileSync("node_web.js", directory + "/NODE_WEB.JS");
    fs.copyFileSync("guest_vm/tools/xp_smoke/start.bat", directory + "/START.BAT");
    fs.writeFileSync(directory + "/WWW/index.html", "<html><body>Guest VM on Windows XP: HTTP smoke test</body></html>\n");
    var payload = Buffer.alloc(4096);
    for (var i = 0; i < payload.length; i++) payload[i] = i & 255;
    fs.writeFileSync(directory + "/WWW/bytes.bin", payload);
    var result = cp.spawnSync("genisoimage", ["-quiet", "-J", "-R", "-V", "GVM_SMOKE",
        "-o", directory + ".iso", directory], {stdio: "inherit"});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("CD image generation failed");
    console.log("prepared smoke CD: " + directory + ".iso");
}());
