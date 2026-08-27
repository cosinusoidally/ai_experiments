/* Shared kernel-dialect bytecode dispatch engine. The JavaScript backend is
 * the Node/reference implementation; MMVM installs the same IR as native i386. */
(function (root) {
    var KernelCompiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    if (typeof module !== "undefined" && module.exports) {
        KernelCompiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
    }

    var Exit = {BUDGET: 1, RETURN: 2, UNSUPPORTED: 3};

    function interpreterKernel(heapBase, framePC, bytecodeWords,
                               constantCells, registerCells, budget, state) {
        var pc = load32(heapBase + framePC);
        var instructions = 0;
        while (budget > 0) {
            var opcode = load32(heapBase + bytecodeWords + pc * 4);
            if (opcode === 1) {
                var constantTarget = load32(heapBase + bytecodeWords + (pc + 1) * 4);
                var constantIndex = load32(heapBase + bytecodeWords + (pc + 2) * 4);
                var constantSource = heapBase + constantCells + constantIndex * 16;
                var constantDestination = heapBase + registerCells + constantTarget * 16;
                store32(constantDestination, load32(constantSource));
                store32(constantDestination + 4, load32(constantSource + 4));
                store32(constantDestination + 8, load32(constantSource + 8));
                store32(constantDestination + 12, load32(constantSource + 12));
                pc = pc + 3;
            } else if (opcode === 4) {
                var moveTarget = load32(heapBase + bytecodeWords + (pc + 1) * 4);
                var moveSourceIndex = load32(heapBase + bytecodeWords + (pc + 2) * 4);
                var moveSource = heapBase + registerCells + moveSourceIndex * 16;
                var moveDestination = heapBase + registerCells + moveTarget * 16;
                store32(moveDestination, load32(moveSource));
                store32(moveDestination + 4, load32(moveSource + 4));
                store32(moveDestination + 8, load32(moveSource + 8));
                store32(moveDestination + 12, load32(moveSource + 12));
                pc = pc + 3;
            } else if (opcode === 21) {
                pc = load32(heapBase + bytecodeWords + (pc + 1) * 4);
            } else if (opcode === 22) {
                var conditionIndex = load32(heapBase + bytecodeWords + (pc + 1) * 4);
                var condition = heapBase + registerCells + conditionIndex * 16;
                var conditionTag = load32(condition);
                var falseCondition = 0;
                if (conditionTag === 1) falseCondition = 1;
                else if (conditionTag === 2) falseCondition = 1;
                else if (conditionTag === 3) falseCondition = 1;
                else if (conditionTag === 5) {
                    if (load32(condition + 4) === 0) falseCondition = 1;
                } else if (conditionTag === 6) {
                    store32(heapBase + state, 3);
                    store32(heapBase + state + 4, pc);
                    store32(heapBase + state + 8, opcode);
                    store32(heapBase + state + 12, instructions);
                    store32(heapBase + framePC, pc);
                    return 3;
                }
                if (falseCondition === 1) {
                    pc = load32(heapBase + bytecodeWords + (pc + 2) * 4);
                } else pc = pc + 3;
            } else if (opcode === 24) {
                var returnIndex = load32(heapBase + bytecodeWords + (pc + 1) * 4);
                store32(heapBase + state, 2);
                store32(heapBase + state + 4, pc);
                store32(heapBase + state + 8, registerCells + returnIndex * 16);
                store32(heapBase + state + 12, instructions + 1);
                store32(heapBase + framePC, pc);
                return 2;
            } else {
                store32(heapBase + state, 3);
                store32(heapBase + state + 4, pc);
                store32(heapBase + state + 8, opcode);
                store32(heapBase + state + 12, instructions);
                store32(heapBase + framePC, pc);
                return 3;
            }
            budget = budget - 1;
            instructions = instructions + 1;
        }
        store32(heapBase + state, 1);
        store32(heapBase + state + 4, pc);
        store32(heapBase + state + 8, 0);
        store32(heapBase + state + 12, instructions);
        store32(heapBase + framePC, pc);
        return 1;
    }

    function NativeInterpreter(runtime) {
        this.runtime = runtime;
        this.ir = new KernelCompiler().compile(interpreterKernel);
        this.js = new JSBackend().compile(this.ir);
        this.nativeResult = new X86Backend().compile(this.ir);
        this.stateAddress = runtime.heapRecords.allocateEngineState();
        this.statePayload = runtime.heapRecords.engineStatePayloadAddress(
            this.stateAddress);
    }

    NativeInterpreter.Exit = Exit;

    NativeInterpreter.prototype.run = function (frame, program, budget) {
        var records = this.runtime.heapRecords;
        var programAddress = this.runtime.programAddress(program);
        var bytecode = records.programBytecode(programAddress);
        var constants = records.programConstants(programAddress);
        var framePC = records.framePCAddress(frame);
        var bytecodeWords = records.bytecodeWordsAddress(bytecode);
        var constantCells = records.vectorCellsAddress(constants);
        var registerCells = records.frameRegistersAddress(frame);
        var heapBase = this.runtime.linearHeap.memory.nativeAddress(0);
        var reason = this.nativeResult.fn ? this.nativeResult.fn(
            heapBase, framePC, bytecodeWords, constantCells,
            registerCells, budget, this.statePayload) : this.js.fn(
            this.runtime.linearHeap.memory, 0, framePC, bytecodeWords,
            constantCells, registerCells, budget, this.statePayload);
        return {reason: reason,
                pc: records.enginePC(this.stateAddress),
                resultCell: records.engineResultCell(this.stateAddress),
                instructions: records.engineInstructionCount(this.stateAddress),
                backend: this.nativeResult.fn ? "i386" : "js"};
    };

    NativeInterpreter.prototype.destroy = function () {
        if (this.nativeResult) this.nativeResult.destroy();
        this.nativeResult = null;
        this.js = null;
    };

    root.GuestVMNativeInterpreter = NativeInterpreter;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = NativeInterpreter;
    }
}(this));
