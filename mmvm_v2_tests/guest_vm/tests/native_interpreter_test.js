(function (root) {
    function runNativeInterpreterTest(VM, NativeInterpreter, bytecode) {
        var vm = new VM({heapBytes: 256 * 1024});
        var engine = new NativeInterpreter(vm.runtime);
        try {
            var program = {code: [bytecode.CONST, 0, 0,
                                  bytecode.MOVE, 1, 0,
                                  bytecode.RETURN, 1],
                           constants: [17], registerCount: 2};
            var programAddress = vm.runtime.programAddress(program);
            var frame = vm.runtime.heapRecords.allocateFrame(
                programAddress, 0, 0, -1, program.registerCount);
            var first = engine.run(frame, program, 2);
            if (first.reason !== NativeInterpreter.Exit.BUDGET ||
                first.pc !== 6 || first.instructions !== 2) {
                throw new Error("native interpreter budget continuation mismatch");
            }
            var second = engine.run(frame, program, 2);
            if (second.reason !== NativeInterpreter.Exit.RETURN ||
                second.pc !== 6 || second.instructions !== 1 ||
                vm.runtime.readHeapValue(second.resultCell) !== 17) {
                throw new Error("native interpreter return mismatch");
            }
            vm.runtime.linearHeap.freeRecord(frame);

            var arithmetic = {code: [bytecode.CONST, 0, 0,
                                     bytecode.CONST, 1, 1,
                                     bytecode.ADD, 2, 0, 1,
                                     bytecode.RETURN, 2],
                              constants: [7, 2.5], registerCount: 3};
            var arithmeticAddress = vm.runtime.programAddress(arithmetic);
            var arithmeticFrame = vm.runtime.heapRecords.allocateFrame(
                arithmeticAddress, 0, 0, -1, arithmetic.registerCount);
            var arithmeticExit = engine.run(arithmeticFrame, arithmetic, 10);
            if (arithmeticExit.reason !== NativeInterpreter.Exit.RETURN ||
                vm.runtime.readHeapValue(arithmeticExit.resultCell) !== 9.5) {
                throw new Error("native interpreter binary64 arithmetic mismatch");
            }
            vm.runtime.linearHeap.freeRecord(arithmeticFrame);

            var unsupported = {code: [bytecode.MAKE_OBJECT, 0,
                                      bytecode.RETURN, 0],
                               constants: [], registerCount: 1};
            var unsupportedAddress = vm.runtime.programAddress(unsupported);
            var unsupportedFrame = vm.runtime.heapRecords.allocateFrame(
                unsupportedAddress, 0, 0, -1, unsupported.registerCount);
            var exit = engine.run(unsupportedFrame, unsupported, 10);
            if (exit.reason !== NativeInterpreter.Exit.UNSUPPORTED ||
                exit.pc !== 0) {
                throw new Error("native interpreter migration exit mismatch");
            }
            vm.runtime.linearHeap.freeRecord(unsupportedFrame);
            return "kernel-compiled bytecode interpreter passed on " +
                   second.backend;
        } finally {
            engine.destroy();
            vm.destroy();
        }
    }

    root.GuestVMRunNativeInterpreterTest = runNativeInterpreterTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runNativeInterpreterTest;
    }
}(this));
