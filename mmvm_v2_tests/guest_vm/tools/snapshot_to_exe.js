/* Run from mmvm_v2_tests; no compiler, linker, npm, or development files. */
(function (root, shellArguments) {
    var node = typeof process !== "undefined" && process.versions &&
        process.versions.node && typeof get_dlsym !== "function";
    var ioModule, elf, Assembler, format, io, args, DebugELF, Digest;
    if (node) {
        ioModule = require("./snapshot_exe_io.js");
        elf = require("./snapshot_exe_elf.js");
        Assembler = require("../aot/x86_assembler.js");
        format = require("../aot/standalone_format.js");
        DebugELF = require("../aot/debug_elf.js");
        Digest = require("../aot/debug_digest.js");
        args = process.argv.slice(2);
    } else {
        load("guest_vm/host_ffi.js");
        load("guest_vm/aot/x86_assembler.js");
        load("guest_vm/aot/standalone_format.js");
        load("guest_vm/tools/snapshot_exe_elf.js");
        load("guest_vm/tools/snapshot_exe_io.js");
        load("guest_vm/aot/debug_binary.js");
        load("guest_vm/aot/debug_elf.js");
        load("guest_vm/aot/debug_digest.js");
        ioModule = root.GuestVMSnapshotExeIO;
        elf = root.GuestVMSnapshotExeELF;
        Assembler = root.GuestVMX86Assembler;
        format = root.GuestVMStandaloneFormat;
        DebugELF = root.GuestVMDebugELF;
        Digest = root.GuestVMDebugDigest;
        args = shellArguments;
    }
    if (args.length !== 2 && !(args.length === 4 && args[2] === "--debug-info")) {
        throw new Error("usage: snapshot_to_exe.js INPUT.snap OUTPUT.exe [--debug-info INPUT.snap.dbg] (output must not exist)");
    }
    io = node ? ioModule.nodeAdapter(require("fs")) :
        ioModule.nativeAdapter(root.GuestVMHostFFI);
    ioModule.convert(io, args[0], args[1], elf, Assembler, format, args[3], DebugELF, Digest);
    if (node) console.log("wrote executable: " + args[1]);
    else print("wrote executable: " + args[1]);
}(this, typeof arguments !== "undefined" ? arguments : []));
