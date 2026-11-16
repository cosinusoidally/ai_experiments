/* Start one small, software-emulated XP VM independently of an exec timeout.
 * Stop through qmp_control.js; never use the base disk as a writable drive.
 * node guest_vm/tools/xp_smoke/launch.js WORK_DIRECTORY [BASE_IMAGE]
 * WORK_DIRECTORY must contain cd.iso; an overlay is created if absent. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var args = process.argv.slice(2), directory = path.resolve(args[0] || "artifacts/xp-smoke");
    var base = path.resolve(args[1] || "../../xp/winxp.img");
    var artifacts = path.resolve("artifacts") + path.sep;
    if (directory.substring(0, artifacts.length) !== artifacts) throw new Error("work directory must be under artifacts");
    var available = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (!available || Number(available[1]) < 768 * 1024) throw new Error("insufficient available host memory for XP smoke test");
    var pidFile = directory + "/qemu.pid";
    if (fs.existsSync(pidFile)) {
        var oldPID = Number(fs.readFileSync(pidFile, "utf8"));
        try { process.kill(oldPID, 0); throw new Error("previous QEMU process still exists: " + oldPID); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    var overlay = directory + "/overlay.qcow2";
    if (!fs.existsSync(overlay)) {
        var result = cp.spawnSync("qemu-img", ["create", "-f", "qcow2", "-F", "raw", "-b", base, overlay],
            {stdio: "inherit"});
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error("overlay creation failed");
    }
    var metadata = cp.spawnSync("qemu-img", ["info", "--output=json", overlay], {encoding: "utf8"});
    if (metadata.error || metadata.status !== 0) throw new Error("cannot inspect overlay");
    var info = JSON.parse(metadata.stdout);
    if (info.format !== "qcow2" || info["backing-filename-format"] !== "raw" ||
            path.resolve(info["full-backing-filename"]) !== base) throw new Error("unexpected overlay backing chain");
    var log = fs.openSync(directory + "/qemu.log", "a");
    var child = cp.spawn("qemu-system-i386", ["-accel", "tcg,thread=single,tb-size=32",
        "-m", "256", "-smp", "1", "-drive", "file=" + overlay + ",format=qcow2,if=ide,index=0",
        "-cdrom", directory + "/cd.iso", "-boot", "c", "-vga", "cirrus", "-display", "none",
        "-monitor", "none", "-serial", "none", "-parallel", "none",
        "-qmp", "unix:" + directory + "/qmp.sock,server=on,wait=off",
        "-netdev", "user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:18080-:8000",
        "-device", "rtl8139,netdev=net0", "-no-reboot"], {detached: true, stdio: ["ignore", log, log]});
    fs.closeSync(log);
    child.on("error", function (error) { console.error(error.message); process.exitCode = 1; });
    child.on("spawn", function () {
        fs.writeFileSync(pidFile, String(child.pid) + "\n");
        console.log("QEMU PID " + child.pid + "; 256 MiB; single-vCPU TCG; only overlay writable");
        child.unref();
    });
}());
