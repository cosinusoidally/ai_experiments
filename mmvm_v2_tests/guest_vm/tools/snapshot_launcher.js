/* Ordinary integer kernel code. Only the libc-to-kernel argument bridge is
 * assembly; neither argument policy nor snapshot execution lives there. */
(function (root) {
    var Compiler = root.GuestVMKernelCompiler, Backend = root.GuestVMKernelX86Backend;
    var SOURCE_FILE = "guest_vm/tools/snapshot_launcher.js";
    var LAUNCHER_WORD_BYTES = 4, LAUNCHER_USAGE_STATUS = 64;
    var readSource = typeof read === "function" ? read : null;
    if (typeof module !== "undefined" && module.exports) {
        Compiler = require("../aot/kernel_compiler.js");
        Backend = require("../aot/backend_x86.js");
        readSource = function (path) { return require("fs").readFileSync(path, "utf8"); };
    }

    function main(argc, argv, snapshotEntry, dlsym) {
        if (argc < 2) return LAUNCHER_USAGE_STATUS;
        var guestArgc = argc - 1;
        var guestArgv = argv + LAUNCHER_WORD_BYTES;
        var status = callNativeI32(snapshotEntry, guestArgc, guestArgv, dlsym);
        return status;
    }

    function compile(optimization, debug) {
        var options = {optimization: optimization, constantBindings: {
            LAUNCHER_WORD_BYTES: LAUNCHER_WORD_BYTES,
            LAUNCHER_USAGE_STATUS: LAUNCHER_USAGE_STATUS}};
        if (debug) {
            var support = Backend.debugSupport();
            options.debugSources = new support.Sources(readSource, [SOURCE_FILE]);
        }
        var ir = new Compiler().compileGraph(main, {}, options);
        var result = new Backend({installExecutable: false}).compile(ir);
        try { return {bytes: result.bytes.slice(0), assembly: result.assembly, debug: result.debug}; }
        finally { result.destroy(); }
    }
    function appendDebug(kernel, compiled, address, sectionIndex, unwindFrames) {
        var support = Backend.debugSupport(), bases = {}, names = {
            ".debug_abbrev": "abbreviations", ".debug_line": "lines",
            ".debug_loc": "locations", ".debug_frame": "frames"};
        var i, section, present = {};
        for (i = 0; i < kernel.sections.length; i++) {
            section = kernel.sections[i];
            present["$" + section.name] = true;
            if (names[section.name]) bases[names[section.name]] = section.bytes.length;
        }
        var required = [".debug_info", ".debug_abbrev", ".debug_line", ".debug_loc", ".debug_frame"];
        for (i = 0; i < required.length; i++) {
            if (!present["$" + required[i]]) throw new Error("cannot link launcher DWARF: missing " + required[i]);
        }
        var dwarf = support.DWARF.build(compiled.debug, compiled.main.length, bases);
        var extra = support.ELF.relocate(support.ELF.build(dwarf), address, compiled.main.length);
        var sections = [];
        for (i = 0; i < kernel.sections.length; i++) {
            section = kernel.sections[i]; var addition = null;
            for (var j = 0; j < extra.sections.length; j++) if (extra.sections[j].name === section.name) addition = extra.sections[j];
            var bytes = addition ? section.bytes.concat(addition.bytes) : section.bytes;
            if (section.name === ".debug_frame" && unwindFrames) {
                bytes = bytes.concat(support.DWARF.buildFrames(unwindFrames, bytes.length).bytes);
            }
            sections.push({name: section.name, bytes: bytes});
        }
        for (i = 0; i < extra.functions.length; i++) extra.functions[i].sectionIndex = sectionIndex;
        return {sections: sections, functions: kernel.functions.concat(extra.functions)};
    }
    var api = {compile: compile, main: main, appendDebug: appendDebug};
    root.GuestVMSnapshotLauncher = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
