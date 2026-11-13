/* Serial integration checks. This developer driver uses Node built-ins only;
 * the packager itself is tested on all three hosts and needs no Node at run time.
 * Usage: node guest_vm/tools/check_snapshot_exe.js INPUT.snap [--debug-info INPUT.snap.dbg]
 * Optional existing tools: JS_MIN_BINARY, FIREFOX_LIB_DIR, JS_RUNNER_BINARY.
 * Nothing here compiles a loader or invokes compiler/binutils programs. */
(function () {
    var fs = require("fs"), path = require("path"), cp = require("child_process");
    var crypto = require("crypto");
    var elf = require("./snapshot_exe_elf.js"), format = require("../aot/standalone_format.js");
    var Assembler = require("../aot/x86_assembler.js");
    var snapshot = process.argv[2], debugSidecar = process.argv[4];
    if (!snapshot || (process.argv.length !== 3 &&
            !(process.argv.length === 5 && process.argv[3] === "--debug-info"))) {
        throw new Error("usage: check_snapshot_exe.js INPUT.snap [--debug-info INPUT.snap.dbg]");
    }
    var input = fs.readFileSync(snapshot), originalHash = hash(input);
    var directory = "artifacts/snapshot-exe-check-" + process.pid;
    fs.mkdirSync(directory);
    var executable = path.resolve(directory, "node.exe");
    var tool = "guest_vm/tools/snapshot_to_exe.js";
    var jsMin = process.env.JS_MIN_BINARY || "../../mmvm_v2/artifacts/js_min.exe";
    var runner = process.env.JS_RUNNER_BINARY || "artifacts/js_runner.exe";
    var environment = {}, key, checks = 0;
    for (key in process.env) environment[key] = process.env[key];
    environment.LD_LIBRARY_PATH = (process.env.FIREFOX_LIB_DIR || "../../firefox-1.0.8/lib") +
        (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "");
    function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
    function packArguments(inputPath, outputPath) {
        var args = [tool, inputPath, outputPath];
        if (debugSidecar) args.push("--debug-info", debugSidecar);
        return args;
    }
    function check(condition, message) {
        if (!condition) throw new Error(message);
        checks++;
    }
    function run(binary, args, status, env) {
        var result = cp.spawnSync(binary, args, {encoding: "utf8", env: env || environment,
            timeout: 120000, maxBuffer: 4 * 1024 * 1024});
        if (result.error) throw result.error;
        if (result.signal || result.status !== (status || 0)) {
            throw new Error(binary + " failed: status=" + result.status +
                " signal=" + result.signal + "\n" + result.stdout + result.stderr);
        }
        return status ? result.stdout + result.stderr : result.stdout;
    }
    function verify(bytes) {
        var u32 = function (at) { return elf.read32(bytes, at); };
        var u16 = function (at) { return bytes[at] | bytes[at + 1] << 8; };
        check(bytes[0] === 127 && bytes.toString("ascii", 1, 4) === "ELF", "ELF magic");
        check(u16(16) === 2 && u16(18) === 3, "fixed i386 ET_EXEC");
        check(u32(24) === 0x08048400, "standard fixed load base");
        var ph = u32(28), count = u16(44), i, offset, size, type, flags;
        var payloadOffset = -1, dynamicOffset = -1, stackFound = false, loads = [];
        for (i = 0; i < count; i++) {
            offset = u32(ph + 4); size = u32(ph + 16);
            type = u32(ph); flags = u32(ph + 24);
            check(offset + size <= bytes.length, "program segment file bounds");
            if (type === 1) {
                loads.push({address: u32(ph + 8), offset: offset, size: size});
                check(u32(ph + 8) - offset === 0x08048000, "load address congruence");
                if (flags === 7) payloadOffset = offset;
            }
            if (type === 2) dynamicOffset = offset;
            if (type === 3) check(bytes.toString("ascii", offset, offset + size - 1) ===
                "/lib/ld-linux.so.2", "standard i386 interpreter");
            if (type === 0x6474e551) stackFound = flags === 6;
            ph += u16(42);
        }
        check(stackFound && dynamicOffset >= 0 && payloadOffset >= 0, "required segments");
        check(bytes.slice(payloadOffset, payloadOffset + input.length).equals(input), "unchanged snapshot payload");
        function fileOffset(address) {
            for (var j = 0; j < loads.length; j++) {
                var load = loads[j];
                if (address >= load.address && address < load.address + load.size) {
                    return load.offset + address - load.address;
                }
            }
            throw new Error("unmapped dynamic address");
        }
        var needed = [], strtab = 0, tag, value;
        do {
            tag = u32(dynamicOffset); value = u32(dynamicOffset + 4);
            if (tag === 1) needed.push(value);
            if (tag === 5) strtab = fileOffset(value);
            check(tag !== 22 && tag !== 0x6ffffffe, "no text relocations or version requirements");
            dynamicOffset += 8;
        } while (tag);
        for (i = 0; i < needed.length; i++) {
            var end = strtab + needed[i];
            while (bytes[end]) end++;
            needed[i] = bytes.toString("ascii", strtab + needed[i], end);
        }
        check(needed.join(",") === "libc.so.6,libm.so.6,libdl.so.2", "separate historical libraries");
        /* Reuse the debugger's bounded ELF reader for ordinary symbols too;
         * this check does not require incorporated DWARF or a tracing host. */
        var Image = require("../debugger/image.js").KernelDebuggerImage;
        var image = new Image({readFile: function () { return {address: 0, length: bytes.length}; },
            release: function () {}, ffi: {peek8: function (at) { return bytes[at]; }}}, "generated executable");
        try {
            check(image.byName.$_start && image.byName.$_start.start === u32(24), "entry symbol matches ELF entry");
            check(image.byName.$main && image.byName.$main.size > 0, "compiled main symbol exists without DWARF");
            check(image.byName.$_main_abi_entry && image.byName.$_main_abi_entry.start !== image.byName.$main.start,
                "libc ABI bridge is distinct from compiled main");
            check(image.codeByte(image.byName.$main.start) >= 0, "main lies in executable bytes");
            check(!!image.byName.$snapshot_bootstrap_entry, "snapshot bootstrap function symbol exists");
            var bootstrap = image.sections["$.text.bootstrap"], symbol = image.byName.$snapshot_bootstrap_entry;
            check(symbol.start === bootstrap.address && symbol.size === bootstrap.size, "bootstrap symbol covers its exact code section");
        } finally { image.destroy(); }
    }
    run(process.execPath, packArguments(snapshot, executable));
    var packed = fs.readFileSync(executable), packedHash = hash(packed);
    verify(packed);
    run(jsMin, packArguments(snapshot, directory + "/js-min.exe"));
    check(fs.readFileSync(directory + "/js-min.exe").equals(packed), "Node/js_min byte identity");
    run(runner, [snapshot].concat(packArguments(snapshot, directory + "/js-runner.exe")));
    check(fs.readFileSync(directory + "/js-runner.exe").equals(packed), "Node/js_runner byte identity");
    run(executable, packArguments(snapshot, directory + "/self.exe"));
    check(fs.readFileSync(directory + "/self.exe").equals(packed), "packager works inside generated executable");
    check(run(executable, ["hello.js"]) === "Hello, world!\n", "hello program");
    check(run(executable, ["guest_vm/tests/standalone_alternate_program.js"]) ===
        "Alternate standalone workload\n", "arbitrary program selection");
    environment.DISPLAY = ":exe-live"; environment.XAUTHORITY = "exe-live-auth";
    environment.HOME = "exe-live-home";
    check(run(executable, ["guest_vm/tests/standalone_alternate_program.js", "--environment"]) ===
        ":exe-live|exe-live-auth|exe-live-home\n", "live environment and argument forwarding");
    run(executable, [], 64);
    check(run(runner, [snapshot, "hello.js"]) === "Hello, world!\n", "normal loader unchanged");
    var bad = directory + "/invalid.snap";
    fs.writeFileSync(bad, "not a snapshot");
    run(process.execPath, [tool, bad, directory + "/invalid.exe"], 1);
    check(!fs.existsSync(directory + "/invalid.exe"), "bad input not published");
    run(process.execPath, packArguments(snapshot, executable), 1);
    check(hash(fs.readFileSync(executable)) === packedHash, "no clobber");
    run(process.execPath, packArguments(snapshot, snapshot), 1);
    check(hash(fs.readFileSync(snapshot)) === originalHash, "source never modified");
    check(hash(fs.readFileSync(executable)) === packedHash, "execution never modifies executable");
    if (debugSidecar) {
        var changed = Buffer.from ? Buffer.from(input) : new Buffer(input);
        changed[elf.read32(input, format.fields.entryOffset)] ^= 1;
        var unsupported = directory + "/unsupported-bootstrap.snap", rejected = directory + "/unsupported-bootstrap.exe";
        fs.writeFileSync(unsupported, changed);
        var failure = run(process.execPath, packArguments(unsupported, rejected), 1);
        check(failure.indexOf("unsupported snapshot ABI prologue") >= 0, "unknown bootstrap layout rejects guessed CFI");
        check(!fs.existsSync(rejected), "unsupported bootstrap output is not published");
    }
    var generated = elf.build(input.slice(0, format.headerBytes), input.length, Assembler, format);
    fs.writeFileSync(directory + "/launcher.asm.txt", generated.assembly + "\n");
    console.log(checks + " ELF/launch checks passed; artifacts: " + directory);
}());
