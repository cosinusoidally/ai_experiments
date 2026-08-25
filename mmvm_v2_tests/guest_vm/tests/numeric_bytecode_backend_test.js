(function (root) {
    function runNumericBytecodeBackendTest(VM, Backend, op) {
        var vm = new VM();
        var runtime = vm.runtime;
        var program = {name: "numericBackendProbe", registerCount: 5,
            constants: [1.25, 2.5],
            code: [op.CONST, 0, 0,
                   op.CONST, 1, 1,
                   op.ADD, 2, 0, 1,
                   op.MULTIPLY, 3, 2, 1,
                   op.NEGATE, 4, 3,
                   op.RETURN, 4]};
        var programAddress = runtime.registerProgram(program);
        var backend = new Backend(runtime);
        var compiled = backend.compile(program);
        if (!compiled) throw new Error("numeric bytecode probe did not compile");
        var jsFrame = runtime.heapRecords.allocateFrame(
            programAddress, 0, 0, -1, program.registerCount);
        compiled.jsFn(0, jsFrame);
        assertNumber(runtime.readHeapValue(
            runtime.heapRecords.frameRegisterCell(jsFrame, compiled.returnRegister)),
            -9.375, "JavaScript numeric bytecode backend");
        if (compiled.backend === "i386") {
            var nativeFrame = runtime.heapRecords.allocateFrame(
                programAddress, 0, 0, -1, program.registerCount);
            compiled.fn(runtime.linearHeap.memory.nativeAddress(0), nativeFrame);
            assertNumber(runtime.readHeapValue(
                runtime.heapRecords.frameRegisterCell(
                    nativeFrame, compiled.returnRegister)),
                -9.375, "i386 numeric bytecode backend");
            if (compiled.assembly.indexOf("fild_i32_frame") < 0 ||
                compiled.assembly.indexOf("fld_f64_frame") < 0 ||
                compiled.assembly.indexOf("fmulp_st1_st0") < 0) {
                throw new Error("numeric backend did not use named x87 macros");
            }
        }
        var label = compiled.backend === "i386" ?
            "shared bytecode numeric backend passed on JS and native i386" :
            "shared bytecode numeric backend passed on JS; i386 output validated";
        compiled.destroy();
        vm.destroy();
        return label;
    }

    function assertNumber(actual, expected, label) {
        if (actual !== expected) {
            throw new Error(label + ": expected " + expected + ", got " + actual);
        }
    }

    root.GuestVMRunNumericBytecodeBackendTest = runNumericBytecodeBackendTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runNumericBytecodeBackendTest;
    }
}(this));
