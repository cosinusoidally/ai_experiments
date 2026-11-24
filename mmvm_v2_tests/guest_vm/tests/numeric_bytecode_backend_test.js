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
        var loopProgram = {name: "numericLoopProbe", registerCount: 5,
            constants: [0, 1, 5],
            code: [op.CONST, 0, 0,
                   op.CONST, 1, 0,
                   op.CONST, 2, 1,
                   op.CONST, 3, 2,
                   op.LESS_EQUAL, 4, 1, 3,
                   op.JUMP_IF_FALSE, 4, 29,
                   op.ADD, 0, 0, 1,
                   op.ADD, 1, 1, 2,
                   op.JUMP, 12,
                   op.RETURN, 0]};
        var loopAddress = runtime.registerProgram(loopProgram);
        var compiledLoop = backend.compile(loopProgram);
        if (!compiledLoop) throw new Error("numeric control-flow probe did not compile");
        var loopFrame = runtime.heapRecords.allocateFrame(
            loopAddress, 0, 0, -1, loopProgram.registerCount);
        compiledLoop.jsFn(0, loopFrame);
        assertNumber(runtime.readHeapValue(runtime.heapRecords.frameRegisterCell(
            loopFrame, compiledLoop.returnRegister)), 15,
            "JavaScript numeric control-flow backend");
        if (compiledLoop.backend === "i386") {
            loopFrame = runtime.heapRecords.allocateFrame(
                loopAddress, 0, 0, -1, loopProgram.registerCount);
            compiledLoop.fn(runtime.linearHeap.memory.nativeAddress(0), loopFrame);
            assertNumber(runtime.readHeapValue(runtime.heapRecords.frameRegisterCell(
                loopFrame, compiledLoop.returnRegister)), 15,
                "i386 numeric control-flow backend");
            if (compiledLoop.assembly.indexOf("jne(bytecode_29)") < 0 ||
                compiledLoop.assembly.indexOf("jmp(bytecode_12)") < 0) {
                throw new Error("numeric loop did not use macro-assembler labels");
            }
            if (compiledLoop.assembly.indexOf(
                    "fucomip_st0_st1()\nfstp_st0()\n" +
                    "setae_al()\nmovzx_eax_al()") < 0 ||
                compiledLoop.assembly.indexOf(";") >= 0) {
                throw new Error("numeric comparison was not composed from " +
                    "individual instruction macros");
            }
        }
        var label = compiled.backend === "i386" ?
            "shared bytecode numeric backend passed on JS and native i386" :
            "shared bytecode numeric backend passed on JS; i386 output validated";
        compiled.destroy();
        compiledLoop.destroy();
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
