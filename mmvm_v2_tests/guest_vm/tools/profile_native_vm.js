/* Bounded external reader for libc profil counters. This Node diagnostic is
 * the parent of the one measured process, so /proc memory access needs no
 * debugger, C helper, extra guest VM, or system configuration change.
 * Usage: node .../profile_native_vm.js IMAGE SECONDS PROGRAM [ARGS...] */
var fs = require("fs");
var spawn = require("child_process").spawn;
var image = process.argv[2];
var seconds = Number(process.argv[3]);
if (!(seconds > 0 && seconds <= 120)) throw new Error("seconds must be 1..120");
var metadata = JSON.parse(fs.readFileSync(image + ".symbols.json", "utf8"));
var child = spawn("./artifacts/js_runner.exe", [image,
    "guest_vm/tools/native_profile_entry.js"].concat(process.argv.slice(4)),
    {stdio: ["ignore", "pipe", "inherit"]});
var pending = "", started = false;
child.stdout.on("data", function (data) {
    process.stdout.write(data);
    pending += String(data);
    var match = /NATIVE_PROFILE (\d+) (\d+) (\d+)/.exec(pending);
    if (!match || started) return;
    started = true;
    if (Number(match[3]) !== metadata.sourceHash ||
            Number(match[2]) !== metadata.codeLength + 2) {
        child.kill(); throw new Error("symbol sidecar does not match image");
    }
    setTimeout(function () {
        child.kill("SIGSTOP");
        readStopped(Number(match[1]), Number(match[2]), 0);
    }, seconds * 1000);
});
function readStopped(address, length, attempt) {
    if (child.exitCode !== null) return;
    var status = fs.readFileSync("/proc/" + child.pid + "/status", "utf8");
    if (!/State:\s+T/.test(status)) {
        if (attempt > 100) { child.kill("SIGKILL"); return; }
        setTimeout(function () { readStopped(address, length, attempt + 1); }, 10);
        return;
    }
    try {
        var memory = fs.openSync("/proc/" + child.pid + "/mem", "r");
        var counters = Buffer.alloc(length);
        try { fs.readSync(memory, counters, 0, length, address); }
        finally { fs.closeSync(memory); }
        report(counters);
    } finally {
        child.kill("SIGCONT");
        child.kill("SIGTERM");
    }
}
function report(counters) {
    var functions = [], cases = [], name, index = 0, total = 0, offset;
    for (name in metadata.symbols) {
        if (name.indexOf("kernel_function_") === 0 && !/_return$/.test(name)) {
            functions.push({name: name, offset: metadata.symbols[name], samples: 0});
        }
        if (name.indexOf("kernel_dispatch_case_") === 0) {
            cases.push({name: name, offset: metadata.symbols[name], samples: 0});
        }
    }
    functions.sort(function (a, b) { return a.offset - b.offset; });
    cases.sort(function (a, b) { return a.offset - b.offset; });
    var caseIndex = 0;
    for (offset = 0; offset + 1 < counters.length; offset += 2) {
        while (index + 1 < functions.length && functions[index + 1].offset <= offset) index++;
        var count = counters.readUInt16LE(offset);
        if (functions.length) functions[index].samples += count;
        while (caseIndex + 1 < cases.length && cases[caseIndex + 1].offset <= offset) caseIndex++;
        if (functions.length && functions[index].name === "kernel_function_interpreterKernel" &&
                cases.length && cases[caseIndex].offset <= offset) cases[caseIndex].samples += count;
        total += count;
    }
    functions.sort(function (a, b) { return b.samples - a.samples; });
    console.log("Native samples: " + total);
    functions.slice(0, 25).forEach(function (item) {
        console.log((100 * item.samples / (total || 1)).toFixed(1) + "% " + item.name);
    });
    cases.sort(function (a, b) { return b.samples - a.samples; });
    console.log("Interpreter case regions (dispatch/loop overhead can fall between regions):");
    cases.slice(0, 15).forEach(function (item) {
        console.log((100 * item.samples / (total || 1)).toFixed(1) + "% " + item.name);
    });
}
/* Also bound failure to reach the profiling entry (e.g. a loader regression). */
var deadline = setTimeout(function () { child.kill("SIGKILL"); }, (seconds + 90) * 1000);
child.on("exit", function () { clearTimeout(deadline); });
