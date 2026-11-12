/* Broad debug/non-debug code-generation equivalence and source provenance.
 * Uses the actual interpreter/collector graph, not a miniature test dialect. */
(function () {
    var VM, readSource, report, DWARF, ELF, Digest;
    if (typeof module !== "undefined" && module.exports) {
        VM = require("../vm.js");
        DWARF = require("../aot/kernel_dwarf.js");
        ELF = require("../aot/debug_elf.js");
        Digest = require("../aot/debug_digest.js");
        readSource = function (path) { return require("fs").readFileSync(path, "utf8"); };
        report = function (message) { console.log(message); };
    } else {
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
        DWARF = GuestVMKernelDWARF;
        ELF = GuestVMDebugELF;
        Digest = GuestVMDebugDigest;
        readSource = read;
        report = print;
    }
    function check(policy) {
        var baseline = new VM({nativeInterpreter: true, kernelOptimization: policy});
        var result = baseline.runtime.nativeInterpreter.nativeResult;
        var bytes = [], index = 0;
        while (index < result.length) {
            bytes.push(result.pointer ? peek8(result.pointer + index) : result.bytes[index]);
            index++;
        }
        baseline.destroy();
        var debug = new VM({nativeInterpreter: true, kernelOptimization: policy,
            kernelSourceReader: readSource});
        try {
            result = debug.runtime.nativeInterpreter.nativeResult;
            if (result.length !== bytes.length) throw new Error("debug changed code size");
            index = 0;
            while (index < bytes.length) {
                if (bytes[index] !== (result.pointer ? peek8(result.pointer + index) : result.bytes[index])) {
                    throw new Error("debug changed instruction at " + index);
                }
                index++;
            }
            var functions = result.debug.functions, lines = 0;
            index = 0;
            while (index < functions.length) {
                var fn = functions[index++], row = 0;
                var sourceLines = readSource(fn.location.filename).split("\n");
                if (sourceLines[fn.location.line - 1].indexOf("function " + fn.name + "(") < 0) {
                    throw new Error("incorrect canonical declaration: " + fn.name);
                }
                if (!(fn.start < fn.bodyStart && fn.bodyStart < fn.bodyEnd && fn.bodyEnd < fn.end)) {
                    throw new Error("invalid native function range: " + fn.name);
                }
                while (row < fn.lines.length) {
                    var location = fn.lines[row++];
                    if (location.offset < fn.bodyStart || location.offset >= fn.bodyEnd ||
                        location.line < 1 || !location.filename || location.filename.charAt(0) === "/") {
                        throw new Error("invalid statement provenance: " + fn.name);
                    }
                    lines++;
                }
            }
            report(policy + ": unchanged " + result.length + " code bytes; " +
                functions.length + " canonical functions; " + lines + " statement positions");
            var dwarf = DWARF.build(result.debug, result.length);
            var sidecar = ELF.build(dwarf);
            var relocated = ELF.relocate(sidecar, 0x10000000, result.length);
            if (relocated.functions.length !== functions.length) throw new Error("missing ELF function symbols");
            var hash = Digest.bytes(sidecar), hex = "", h = 0;
            while (h < hash.length) hex += ("0" + hash[h++].toString(16)).slice(-2);
            report(policy + ": " + sidecar.length + " DWARF ELF bytes; SHA256 " + hex);
        } finally { debug.destroy(); }
    }
    check("default");
    check("none");
}());
