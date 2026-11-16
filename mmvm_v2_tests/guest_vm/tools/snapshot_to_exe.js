/* Run from mmvm_v2_tests; no compiler, linker, npm, or development files. */
(function (root, shellArguments) {
    var node = typeof process !== "undefined" && process.versions &&
        process.versions.node && typeof get_dlsym !== "function";
    var ioModule, elf, Assembler, format, io, args, DebugELF, Digest, pe;
    if (node) {
        ioModule = require("./snapshot_exe_io.js");
        elf = require("./snapshot_exe_elf.js");
        pe = require("./snapshot_exe_pe.js");
        Assembler = require("../aot/x86_assembler.js");
        format = require("../aot/standalone_format.js");
        DebugELF = require("../aot/debug_elf.js");
        Digest = require("../aot/debug_digest.js");
        require("./snapshot_launcher.js");
        args = process.argv.slice(2);
    } else {
        load("guest_vm/host_ffi.js");
        load("guest_vm/aot/x86_assembler.js");
        load("guest_vm/aot/standalone_format.js");
        load("guest_vm/aot/snapshot_frames.js");
        load("guest_vm/tools/snapshot_exe_elf.js");
        load("guest_vm/tools/snapshot_exe_io.js");
        load("guest_vm/aot/debug_binary.js");
        load("guest_vm/aot/debug_elf.js");
        load("guest_vm/aot/debug_digest.js");
        load("guest_vm/unicode_identifier_data.js");
        load("guest_vm/tokenizer.js");
        load("guest_vm/parser.js");
        load("guest_vm/aot/kernel_slots.js");
        load("guest_vm/aot/kernel_compiler.js");
        load("guest_vm/aot/backend_x86.js");
        load("guest_vm/tools/snapshot_launcher.js");
        load("guest_vm/tools/windows_network.js");
        load("guest_vm/tools/windows_platform.js");
        load("guest_vm/binary64.js");
        load("guest_vm/tools/snapshot_exe_pe.js");
        ioModule = root.GuestVMSnapshotExeIO;
        elf = root.GuestVMSnapshotExeELF;
        Assembler = root.GuestVMX86Assembler;
        format = root.GuestVMStandaloneFormat;
        DebugELF = root.GuestVMDebugELF;
        Digest = root.GuestVMDebugDigest;
        pe = root.GuestVMSnapshotExePE;
        args = shellArguments;
    }
    var win32 = false, debugPath = null;
    for (var option = 2; option < args.length; option++) {
        if (args[option] === "--win32" && !win32) win32 = true;
        else if (args[option] === "--debug-info" && !debugPath && option + 1 < args.length) debugPath = args[++option];
        else throw new Error("unknown snapshot packager option: " + args[option]);
    }
    if (args.length < 2) throw new Error("usage: snapshot_to_exe.js INPUT.snap OUTPUT.exe [--win32] [--debug-info INPUT.snap.dbg] (output must not exist)");
    if (win32 && debugPath) throw new Error("PE debug incorporation is not implemented");
    io = node ? ioModule.nodeAdapter(require("fs")) :
        ioModule.nativeAdapter(root.GuestVMHostFFI);
    ioModule.convert(io, args[0], args[1], win32 ? pe : elf, Assembler, format, debugPath, DebugELF, Digest);
    if (node) console.log("wrote executable: " + args[1]);
    else print("wrote executable: " + args[1]);
}(this, typeof arguments !== "undefined" ? arguments : []));
