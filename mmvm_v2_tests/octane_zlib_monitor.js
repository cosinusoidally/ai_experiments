/* ES3 diagnostic adapter. Does not modify the external benchmark or VM.
 * Node: node octane_zlib_monitor.js --record artifacts/zlib-reference
 * Guest: js_runner.exe snap octane_zlib_monitor.js --reference DIR [--iterations N]
 */
(function (root) {
    var node = typeof process !== "undefined" && process.versions &&
        process.versions.node;
    var fs = require("fs");
    var args;
    if (node) {
        var vm = require("vm");
        process.chdir(__dirname);
        root.require = require;
        root.print = function (s) { console.log(s); };
        root.load = function (name) {
            vm.runInThisContext(fs.readFileSync(name, "utf8"), {filename: name});
        };
        args = process.argv.slice(2);
    } else {
        args = root.arguments;
    }
    var directory = "", record = false, iterations = 1, i;
    for (i = 0; i < args.length; i++) {
        if (args[i] === "--record") { record = true; directory = args[++i]; }
        else if (args[i] === "--reference") { directory = args[++i]; }
        else if (args[i] === "--iterations") { iterations = Number(args[++i]); }
        else { throw new Error("Unknown option: " + args[i]); }
    }
    if (!directory || !(iterations >= 1) || iterations !== Math.floor(iterations)) {
        throw new Error("Use --record DIR (Node only) or --reference DIR [--iterations N]");
    }
    if (record && !node) { throw new Error("Reference generation requires Node"); }
    load("../../js_tests/octane/base.js");
    load("../../js_tests/octane/zlib.js");
    load("../../js_tests/octane/zlib-data.js");
    /* Capture, but do not change or cache, the source evaluated by the benchmark.
     * FNV-1a uses shift/add arithmetic to retain exact uint32 semantics on ES3. */
    var originalEval = root.zlibEval, sourceHash = 0, sourceLength = 0;
    root.zlibEval = function (source) {
        var hash = -2128831035, j;
        sourceLength = source.length;
        for (j = 0; j < source.length; j++) {
            hash ^= source.charCodeAt(j);
            hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) +
                (hash << 8) + (hash << 24)) | 0;
        }
        sourceHash = hash >>> 0;
        return originalEval(source);
    };
    print("zlib: initializing unchanged benchmark");
    var start = new Date().getTime();
    InitializeZlibBenchmark();
    root.zlibEval = originalEval;
    print("zlib: initialized in " + (new Date().getTime() - start) + " ms");
    /* These slots belong to this particular external generated C program,
     * NOT to the guest VM. Guard them against source drift with the fingerprint.
     * The benchmark retains its last completed round's two malloc buffers. */
    var layout = {compressedPointerSlot: 1046, decompressedPointerSlot: 1044,
        compressedCapacity: 100043, inputLength: 100000};
    var expectedInput, expectedCompressed, reference;
    if (!record) {
        load(directory + "/reference.js");
        reference = root.ZlibMonitorReference;
        if (reference.sourceHash !== sourceHash || reference.sourceLength !== sourceLength) {
            throw new Error("Reference belongs to different benchmark source");
        }
        layout = reference.layout;
        expectedInput = fs.readFileSync(directory + "/input.bin");
        expectedCompressed = fs.readFileSync(directory + "/compressed.bin");
    }
    function pointer(slot, length) {
        var address = Module.HEAP32[slot] >>> 0;
        if (!address || address + length > Module.HEAPU8.length) {
            throw new Error("Invalid diagnostic buffer address at pointer slot " + slot);
        }
        return address;
    }
    function compare(bytes, address, label) {
        var j, actual;
        for (j = 0; j < bytes.length; j++) {
            actual = Module.HEAPU8[address + j];
            if (actual !== bytes[j]) {
                throw new Error(label + " mismatch at byte " + j +
                    ": guest=" + actual + " reference=" + bytes[j]);
            }
        }
    }
    var opcodeNames = null;
    print("zlib: opcode counter query " + typeof root.__guestVMOpcodeCounterWord +
        (typeof root.__guestVMOpcodeCounterWord === "function" ?
            "; initial word=" + root.__guestVMOpcodeCounterWord(0 | 0) : ""));
    if (typeof root.__guestVMOpcodeCounterWord === "function" &&
        typeof root.__guestVMOpcodeCounterWord(0 | 0) === "number") {
        load("guest_vm/bytecode.js");
        opcodeNames = root.GuestVMBytecode.NAMES;
    }
    function counters() {
        var result = [], j;
        if (opcodeNames) {
            for (j = 0; j < opcodeNames.length; j++) {
                result[j] = root.__guestVMOpcodeCounterWord(j | 0) >>> 0;
            }
        }
        return result;
    }
    for (i = 0; i < iterations; i++) {
        print("zlib: batch " + (i + 1) + "/" + iterations + " started (60 rounds)");
        var before = counters();
        start = new Date().getTime();
        runZlib();
        var elapsed = new Date().getTime() - start;
        var after = counters();
        if (opcodeNames) {
            var counts = [], opcode;
            for (opcode = 1; opcode < opcodeNames.length; opcode++) {
                counts.push({name: opcodeNames[opcode],
                    count: (after[opcode] - before[opcode]) >>> 0});
            }
            counts.sort(function (a, b) { return b.count - a.count; });
            for (opcode = 0; opcode < counts.length; opcode++) {
                if (counts[opcode].count) {
                    print("zlib: opcode " + counts[opcode].name + "=" + counts[opcode].count);
                }
            }
        }
        var compressed = pointer(layout.compressedPointerSlot, layout.compressedCapacity);
        var decompressed = pointer(layout.decompressedPointerSlot, layout.inputLength);
        if (record && i === 0) {
            var BufferClass = require("buffer").Buffer;
            expectedInput = BufferClass.alloc(layout.inputLength);
            var repeats = 0, value = 17, j;
            for (j = 0; j < expectedInput.length; j++) {
                if (repeats > 0) { repeats--; }
                else if ((j & 7) === 0) { value = 0; repeats = j & 31; }
                else { value = (((j * j) >>> 0) % 6714) & 255; }
                expectedInput[j] = value;
            }
            var candidate = BufferClass.alloc(layout.compressedCapacity);
            for (j = 0; j < candidate.length; j++) {
                candidate[j] = Module.HEAPU8[compressed + j];
            }
            var inflated = require("zlib").inflateSync(candidate, {info: true});
            if (!inflated.buffer.equals(expectedInput)) {
                throw new Error("Node inflate does not reproduce independently generated input");
            }
            expectedCompressed = candidate.slice(0, inflated.engine.bytesWritten);
            reference = {sourceHash: sourceHash, sourceLength: sourceLength,
                layout: layout, nodeVersion: process.version,
                compressedLength: expectedCompressed.length};
            fs.mkdirSync(directory);
            fs.writeFileSync(directory + "/input.bin", expectedInput);
            fs.writeFileSync(directory + "/compressed.bin", expectedCompressed);
            fs.writeFileSync(directory + "/reference.js",
                "var ZlibMonitorReference = " + JSON.stringify(reference) + ";\n");
        }
        compare(expectedInput, decompressed, "decompressed data");
        compare(expectedCompressed, compressed, "compressed data");
        print("zlib: batch " + (i + 1) + " completed in " + elapsed +
            " ms; verified " + expectedInput.length + " decompressed and " +
            expectedCompressed.length + " compressed bytes against Node reference");
    }
    tearDownZlib();
    print("zlib: diagnostic complete (not an Octane score)");
}(typeof global !== "undefined" ? global : this));
