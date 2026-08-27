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

            var comparison = {code: [bytecode.CONST, 0, 0,
                                     bytecode.CONST, 1, 1,
                                     bytecode.LESS, 2, 0, 1,
                                     bytecode.RETURN, 2],
                              constants: [2.5, 7], registerCount: 3};
            var comparisonAddress = vm.runtime.programAddress(comparison);
            var comparisonFrame = vm.runtime.heapRecords.allocateFrame(
                comparisonAddress, 0, 0, -1, comparison.registerCount);
            var comparisonExit = engine.run(comparisonFrame, comparison, 10);
            if (comparisonExit.reason !== NativeInterpreter.Exit.RETURN ||
                vm.runtime.readHeapValue(comparisonExit.resultCell) !== true) {
                throw new Error("native interpreter binary64 comparison mismatch");
            }
            vm.runtime.linearHeap.freeRecord(comparisonFrame);

            var nanComparison = {code: [bytecode.CONST, 0, 0,
                                        bytecode.CONST, 1, 0,
                                        bytecode.STRICT_EQUAL, 2, 0, 1,
                                        bytecode.RETURN, 2],
                                 constants: [NaN], registerCount: 3};
            var nanAddress = vm.runtime.programAddress(nanComparison);
            var nanFrame = vm.runtime.heapRecords.allocateFrame(
                nanAddress, 0, 0, -1, nanComparison.registerCount);
            var nanExit = engine.run(nanFrame, nanComparison, 10);
            if (nanExit.reason !== NativeInterpreter.Exit.RETURN ||
                vm.runtime.readHeapValue(nanExit.resultCell) !== false) {
                throw new Error("native interpreter NaN comparison mismatch");
            }
            vm.runtime.linearHeap.freeRecord(nanFrame);

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

            var integratedVM = new VM({heapBytes: 256 * 1024,
                                       nativeInterpreter: true});
            try {
                var context = integratedVM.context;
                var integratedProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.MOVE, 1, 0,
                           bytecode.RETURN, 1],
                    constants: [23], registerCount: 2
                };
                var execution = context.startProgram(integratedProgram);
                var integratedBudget = execution.resume(2);
                if (integratedBudget.status !== "budget" ||
                    integratedBudget.instructions !== 2) {
                    throw new Error("native Execution budget integration mismatch");
                }
                var integratedReturn = execution.resume(2);
                if (integratedReturn.status !== "completed" ||
                    integratedReturn.value !== 23 ||
                    integratedReturn.instructions !== 1) {
                    throw new Error("native Execution return integration mismatch");
                }

                var fallbackContext = integratedVM.jsRuntime.createContext();
                var fallbackProgram = {
                    code: [bytecode.MAKE_OBJECT, 0,
                           bytecode.RETURN, 0],
                    constants: [], registerCount: 1
                };
                var fallbackResult = fallbackContext.runProgram(fallbackProgram);
                if (!fallbackResult || fallbackResult.guestType !== "object") {
                    throw new Error("native Execution migration fallback mismatch");
                }
                if (integratedVM.runtime.nativeInterpreter.runCount < 4 ||
                    integratedVM.runtime.nativeInterpreter.unsupportedExitCount < 1) {
                    throw new Error("native Execution did not re-enter after fallback");
                }

                var globalContext = integratedVM.jsRuntime.createContext();
                globalContext.installGlobal("counter", 40);
                var globalProgram = {
                    code: [bytecode.GET_GLOBAL, 0, 0,
                           bytecode.CONST, 1, 1,
                           bytecode.ADD, 2, 0, 1,
                           bytecode.SET_GLOBAL, 0, 2,
                           bytecode.GET_GLOBAL, 3, 0,
                           bytecode.RETURN, 3],
                    constants: ["counter", 2], registerCount: 4
                };
                var globalResult = globalContext.runProgram(globalProgram);
                if (globalResult !== 42 ||
                    integratedVM.runtime.getGlobal(globalContext, "counter") !== 42) {
                    throw new Error("native global value-cell access mismatch");
                }

                var localContext = integratedVM.jsRuntime.createContext();
                var localProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.SET_LOCAL, 0, 0, 0,
                           bytecode.GET_LOCAL, 1, 0, 0,
                           bytecode.CONST, 2, 1,
                           bytecode.ADD, 3, 1, 2,
                           bytecode.SET_LOCAL, 0, 0, 3,
                           bytecode.GET_LOCAL, 4, 0, 0,
                           bytecode.RETURN, 4],
                    constants: [10, 5], registerCount: 5,
                    bindings: ["x", "arguments", "this"],
                    bindingSlots: {$x: 0, $arguments: 1, $this: 2},
                    parameters: [], parameterSlots: [], argumentsSlot: 1,
                    thisSlot: 2, functionNameSlot: -1
                };
                if (localContext.runProgram(localProgram) !== 15) {
                    throw new Error("native lexical environment access mismatch");
                }

                var unaryContext = integratedVM.jsRuntime.createContext();
                var unaryProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.NEGATE, 1, 0,
                           bytecode.POSITIVE, 2, 1,
                           bytecode.RETURN, 2],
                    constants: [5], registerCount: 3
                };
                if (unaryContext.runProgram(unaryProgram) !== -5) {
                    throw new Error("native numeric unary opcode mismatch");
                }

                var negativeZeroContext = integratedVM.jsRuntime.createContext();
                var negativeZeroProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.NEGATE, 1, 0,
                           bytecode.RETURN, 1],
                    constants: [0], registerCount: 2
                };
                var negativeZero = negativeZeroContext.runProgram(
                    negativeZeroProgram);
                if (negativeZero !== 0 || 1 / negativeZero !== -Infinity) {
                    throw new Error("native unary minus lost negative zero");
                }

                var notContext = integratedVM.jsRuntime.createContext();
                var notProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.NOT, 1, 0,
                           bytecode.RETURN, 1],
                    constants: [""], registerCount: 2
                };
                if (notContext.runProgram(notProgram) !== true) {
                    throw new Error("native string truthiness mismatch");
                }

                var nanBranchContext = integratedVM.jsRuntime.createContext();
                var nanBranchProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.JUMP_IF_FALSE, 0, 11,
                           bytecode.CONST, 1, 1,
                           bytecode.JUMP, 14,
                           bytecode.CONST, 1, 2,
                           bytecode.RETURN, 1],
                    constants: [NaN, 1, 2], registerCount: 2
                };
                if (nanBranchContext.runProgram(nanBranchProgram) !== 2) {
                    throw new Error("native NaN truthiness mismatch");
                }

                var propertyContext = integratedVM.jsRuntime.createContext();
                var propertyPrototype = integratedVM.runtime.makeObject();
                integratedVM.runtime.setProperty(propertyPrototype, "inherited", 20);
                var propertyObject = integratedVM.runtime.makeObject();
                integratedVM.runtime.setPrototype(propertyObject, propertyPrototype);
                integratedVM.runtime.setProperty(propertyObject, "own", 10);
                var propertyProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.GET_PROPERTY_CONST, 1, 0, 1,
                           bytecode.CONST, 2, 2,
                           bytecode.SET_PROPERTY_CONST, 0, 1, 2,
                           bytecode.GET_PROPERTY_CONST, 3, 0, 1,
                           bytecode.GET_PROPERTY_CONST, 4, 0, 3,
                           bytecode.ADD, 5, 3, 4,
                           bytecode.RETURN, 5],
                    constants: [propertyObject, "own", 15, "inherited"],
                    registerCount: 6
                };
                if (propertyContext.runProgram(propertyProgram) !== 35 ||
                    integratedVM.runtime.getProperty(propertyObject, "own") !== 15) {
                    throw new Error("native constant property access mismatch");
                }

                var arrayContext = integratedVM.jsRuntime.createContext();
                var propertyArray = integratedVM.runtime.makeArray();
                var arrayProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.CONST, 1, 1,
                           bytecode.CONST, 2, 2,
                           bytecode.SET_PROPERTY, 0, 1, 2,
                           bytecode.GET_PROPERTY, 3, 0, 1,
                           bytecode.GET_PROPERTY_CONST, 4, 0, 3,
                           bytecode.ADD, 5, 3, 4,
                           bytecode.RETURN, 5],
                    constants: [propertyArray, 1, 77, "length"],
                    registerCount: 6
                };
                if (arrayContext.runProgram(arrayProgram) !== 79 ||
                    integratedVM.runtime.arrayGet(propertyArray, 1) !== 77 ||
                    integratedVM.runtime.arrayLength(propertyArray) !== 2) {
                    throw new Error("native indexed array access mismatch");
                }

                var bitwiseContext = integratedVM.jsRuntime.createContext();
                var bitwiseProgram = {
                    code: [bytecode.CONST, 0, 0,
                           bytecode.CONST, 1, 1,
                           bytecode.BIT_AND, 2, 0, 1,
                           bytecode.CONST, 3, 2,
                           bytecode.SHIFT_LEFT, 4, 2, 3,
                           bytecode.BIT_NOT, 5, 4,
                           bytecode.RETURN, 5],
                    constants: [12.9, 5, 1], registerCount: 6
                };
                if (bitwiseContext.runProgram(bitwiseProgram) !== -9) {
                    throw new Error("native bitwise ToInt32 mismatch");
                }
            } finally {
                integratedVM.destroy();
            }
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
