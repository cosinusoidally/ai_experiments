/* Freestanding Linux/i386 native kernel debugger. Run from mmvm_v2_tests. */
(function (root, args) {
    load("guest_vm/host_ffi.js");
    load("guest_vm/aot/debug_binary.js");
    load("guest_vm/aot/kernel_dwarf.js");
    load("guest_vm/debugger/linux_i386.js");
    load("guest_vm/debugger/image.js");
    load("guest_vm/debugger/dwarf.js");
    load("guest_vm/debugger/engine.js");
    load("guest_vm/debugger/commands.js");
    root.KernelDebuggerCommands.main(args);
}(this, arguments));
