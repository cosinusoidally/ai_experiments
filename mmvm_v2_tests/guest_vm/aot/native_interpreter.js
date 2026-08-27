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

    function interpreterKernel(heapBase, frame, bytecodeWords,
                               constantCells, globalObject, budget, state) {
        /* Upper-case integer declarations are compile-time kernel constants.
         * These names mirror bytecode.js, value_cell.js, and heap_records.js;
         * the compiler substitutes their values rather than allocating locals. */
        var WORD_BYTES = 4;
        var FIRST_OPERAND = 1;
        var SECOND_OPERAND = 2;
        var THIRD_OPERAND = 3;
        var TWO_WORD_INSTRUCTION = 2;
        var THREE_WORD_INSTRUCTION = 3;
        var FOUR_WORD_INSTRUCTION = 4;
        var VALUE_CELL_BYTES = 16;
        var VALUE_CELL_LOW = 4;
        var VALUE_CELL_HIGH = 8;
        var VALUE_CELL_AUX = 12;
        var VALUE_TAG_UNDEFINED = 1;
        var VALUE_TAG_NULL = 2;
        var VALUE_TAG_FALSE = 3;
        var VALUE_TAG_INT32 = 5;
        var VALUE_TAG_DOUBLE = 6;
        var VALUE_TAG_REFERENCE = 7;

        var FRAME_ENVIRONMENT = 20;
        var FRAME_PC = 28;
        var FRAME_REGISTERS = 48;
        var OBJECT_PROPERTY_HEAD = 20;
        var PROPERTY_NEXT = 16;
        var PROPERTY_KEY = 20;
        var PROPERTY_VALUE = 32;
        var ENVIRONMENT_PARENT = 16;
        var ENVIRONMENT_COUNT = 20;
        var ENVIRONMENT_CELLS = 24;
        var ENGINE_EXIT_REASON = 0;
        var ENGINE_PC = 4;
        var ENGINE_RESULT = 8;
        var ENGINE_INSTRUCTIONS = 12;

        var EXIT_BUDGET = 1;
        var EXIT_RETURN = 2;
        var EXIT_UNSUPPORTED = 3;
        var PROPERTY_FOUND_SENTINEL = -1;

        var OP_CONST = 1;
        var OP_GET_GLOBAL = 2;
        var OP_SET_GLOBAL = 3;
        var OP_MOVE = 4;
        var OP_ADD = 7;
        var OP_SUBTRACT = 8;
        var OP_MULTIPLY = 9;
        var OP_DIVIDE = 10;
        var OP_REMAINDER = 11;
        var OP_STRICT_EQUAL = 12;
        var OP_EQUAL = 13;
        var OP_LESS = 14;
        var OP_LESS_EQUAL = 15;
        var OP_GREATER = 16;
        var OP_GREATER_EQUAL = 17;
        var OP_JUMP = 21;
        var OP_JUMP_IF_FALSE = 22;
        var OP_RETURN = 24;
        var OP_GET_LOCAL = 43;
        var OP_SET_LOCAL = 44;

        var framePC = frame + FRAME_PC;
        var registerCells = frame + FRAME_REGISTERS;
        var environment = load32(heapBase + frame + FRAME_ENVIRONMENT);
        var pc = load32(heapBase + framePC);
        var instructions = 0;
        while (budget > 0) {
            var opcode = load32(heapBase + bytecodeWords + pc * WORD_BYTES);
            if (opcode === OP_CONST) {
                var constantTarget = load32(heapBase + bytecodeWords +
                                            (pc + FIRST_OPERAND) * WORD_BYTES);
                var constantIndex = load32(heapBase + bytecodeWords +
                                           (pc + SECOND_OPERAND) * WORD_BYTES);
                var constantSource = heapBase + constantCells +
                                     constantIndex * VALUE_CELL_BYTES;
                var constantDestination = heapBase + registerCells +
                                          constantTarget * VALUE_CELL_BYTES;
                store32(constantDestination, load32(constantSource));
                store32(constantDestination + VALUE_CELL_LOW,
                        load32(constantSource + VALUE_CELL_LOW));
                store32(constantDestination + VALUE_CELL_HIGH,
                        load32(constantSource + VALUE_CELL_HIGH));
                store32(constantDestination + VALUE_CELL_AUX,
                        load32(constantSource + VALUE_CELL_AUX));
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_GET_GLOBAL) {
                var globalTargetIndex = load32(
                    heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var globalConstantIndex = load32(
                    heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                var globalKeyCell = heapBase + constantCells +
                                    globalConstantIndex * VALUE_CELL_BYTES;
                if (load32(globalKeyCell) !== VALUE_TAG_REFERENCE) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var globalKey = load32(globalKeyCell + VALUE_CELL_LOW);
                var globalProperty = load32(
                    heapBase + globalObject + OBJECT_PROPERTY_HEAD);
                while (globalProperty !== 0) {
                    if (load32(heapBase + globalProperty + PROPERTY_KEY) ===
                        globalKey) {
                        var globalValue = heapBase + globalProperty + PROPERTY_VALUE;
                        var globalDestination = heapBase + registerCells +
                            globalTargetIndex * VALUE_CELL_BYTES;
                        store32(globalDestination, load32(globalValue));
                        store32(globalDestination + VALUE_CELL_LOW,
                                load32(globalValue + VALUE_CELL_LOW));
                        store32(globalDestination + VALUE_CELL_HIGH,
                                load32(globalValue + VALUE_CELL_HIGH));
                        store32(globalDestination + VALUE_CELL_AUX,
                                load32(globalValue + VALUE_CELL_AUX));
                        globalProperty = PROPERTY_FOUND_SENTINEL;
                    } else {
                        globalProperty = load32(
                            heapBase + globalProperty + PROPERTY_NEXT);
                    }
                }
                if (globalProperty === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_SET_GLOBAL) {
                var setGlobalConstantIndex = load32(
                    heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var setGlobalSourceIndex = load32(
                    heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                var setGlobalKeyCell = heapBase + constantCells +
                    setGlobalConstantIndex * VALUE_CELL_BYTES;
                if (load32(setGlobalKeyCell) !== VALUE_TAG_REFERENCE) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var setGlobalKey = load32(setGlobalKeyCell + VALUE_CELL_LOW);
                var setGlobalProperty = load32(
                    heapBase + globalObject + OBJECT_PROPERTY_HEAD);
                while (setGlobalProperty !== 0) {
                    if (load32(heapBase + setGlobalProperty + PROPERTY_KEY) ===
                        setGlobalKey) {
                        var setGlobalValue = heapBase + setGlobalProperty +
                                             PROPERTY_VALUE;
                        var setGlobalSource = heapBase + registerCells +
                            setGlobalSourceIndex * VALUE_CELL_BYTES;
                        store32(setGlobalValue, load32(setGlobalSource));
                        store32(setGlobalValue + VALUE_CELL_LOW,
                                load32(setGlobalSource + VALUE_CELL_LOW));
                        store32(setGlobalValue + VALUE_CELL_HIGH,
                                load32(setGlobalSource + VALUE_CELL_HIGH));
                        store32(setGlobalValue + VALUE_CELL_AUX,
                                load32(setGlobalSource + VALUE_CELL_AUX));
                        setGlobalProperty = PROPERTY_FOUND_SENTINEL;
                    } else {
                        setGlobalProperty = load32(
                            heapBase + setGlobalProperty + PROPERTY_NEXT);
                    }
                }
                if (setGlobalProperty === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_MOVE) {
                var moveTarget = load32(heapBase + bytecodeWords +
                                        (pc + FIRST_OPERAND) * WORD_BYTES);
                var moveSourceIndex = load32(heapBase + bytecodeWords +
                                             (pc + SECOND_OPERAND) * WORD_BYTES);
                var moveSource = heapBase + registerCells +
                                 moveSourceIndex * VALUE_CELL_BYTES;
                var moveDestination = heapBase + registerCells +
                                      moveTarget * VALUE_CELL_BYTES;
                store32(moveDestination, load32(moveSource));
                store32(moveDestination + VALUE_CELL_LOW,
                        load32(moveSource + VALUE_CELL_LOW));
                store32(moveDestination + VALUE_CELL_HIGH,
                        load32(moveSource + VALUE_CELL_HIGH));
                store32(moveDestination + VALUE_CELL_AUX,
                        load32(moveSource + VALUE_CELL_AUX));
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode < OP_REMAINDER) {
                if (opcode >= OP_ADD) {
                    var arithmeticTargetIndex = load32(
                        heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                    var arithmeticLeftIndex = load32(
                        heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                    var arithmeticRightIndex = load32(
                        heapBase + bytecodeWords + (pc + THIRD_OPERAND) * WORD_BYTES);
                    var arithmeticTarget = heapBase + registerCells +
                                           arithmeticTargetIndex * VALUE_CELL_BYTES;
                    var arithmeticLeft = heapBase + registerCells +
                                         arithmeticLeftIndex * VALUE_CELL_BYTES;
                    var arithmeticRight = heapBase + registerCells +
                                          arithmeticRightIndex * VALUE_CELL_BYTES;
                    var arithmeticLeftTag = load32(arithmeticLeft);
                    var arithmeticRightTag = load32(arithmeticRight);
                    var arithmeticValid = 0;
                    if (arithmeticLeftTag === VALUE_TAG_INT32) arithmeticValid = 1;
                    else if (arithmeticLeftTag === VALUE_TAG_DOUBLE) arithmeticValid = 1;
                    if (arithmeticRightTag !== VALUE_TAG_INT32) {
                        if (arithmeticRightTag !== VALUE_TAG_DOUBLE) arithmeticValid = 0;
                    }
                    if (arithmeticValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    store32(arithmeticTarget, VALUE_TAG_DOUBLE);
                    if (opcode === OP_ADD) {
                        storeF64(arithmeticTarget + VALUE_CELL_LOW,
                            addF64(loadNumberF64(arithmeticLeft + VALUE_CELL_LOW,
                                                 arithmeticLeftTag),
                                   loadNumberF64(arithmeticRight + VALUE_CELL_LOW,
                                                 arithmeticRightTag)));
                    } else if (opcode === OP_SUBTRACT) {
                        storeF64(arithmeticTarget + VALUE_CELL_LOW,
                            subtractF64(loadNumberF64(arithmeticLeft + VALUE_CELL_LOW,
                                                      arithmeticLeftTag),
                                        loadNumberF64(arithmeticRight + VALUE_CELL_LOW,
                                                      arithmeticRightTag)));
                    } else if (opcode === OP_MULTIPLY) {
                        storeF64(arithmeticTarget + VALUE_CELL_LOW,
                            multiplyF64(loadNumberF64(arithmeticLeft + VALUE_CELL_LOW,
                                                      arithmeticLeftTag),
                                        loadNumberF64(arithmeticRight + VALUE_CELL_LOW,
                                                      arithmeticRightTag)));
                    } else {
                        storeF64(arithmeticTarget + VALUE_CELL_LOW,
                            divideF64(loadNumberF64(arithmeticLeft + VALUE_CELL_LOW,
                                                    arithmeticLeftTag),
                                      loadNumberF64(arithmeticRight + VALUE_CELL_LOW,
                                                    arithmeticRightTag)));
                    }
                    store32(arithmeticTarget + VALUE_CELL_AUX, 0);
                    pc = pc + FOUR_WORD_INSTRUCTION;
                } else {
                    store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
            } else if (opcode <= OP_GREATER_EQUAL) {
                if (opcode >= OP_STRICT_EQUAL) {
                    var comparisonTargetIndex = load32(
                        heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                    var comparisonLeftIndex = load32(
                        heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                    var comparisonRightIndex = load32(
                        heapBase + bytecodeWords + (pc + THIRD_OPERAND) * WORD_BYTES);
                    var comparisonTarget = heapBase + registerCells +
                                           comparisonTargetIndex * VALUE_CELL_BYTES;
                    var comparisonLeft = heapBase + registerCells +
                                         comparisonLeftIndex * VALUE_CELL_BYTES;
                    var comparisonRight = heapBase + registerCells +
                                          comparisonRightIndex * VALUE_CELL_BYTES;
                    var comparisonLeftTag = load32(comparisonLeft);
                    var comparisonRightTag = load32(comparisonRight);
                    var comparisonValid = 0;
                    if (comparisonLeftTag === VALUE_TAG_INT32) comparisonValid = 1;
                    else if (comparisonLeftTag === VALUE_TAG_DOUBLE) comparisonValid = 1;
                    if (comparisonRightTag !== VALUE_TAG_INT32) {
                        if (comparisonRightTag !== VALUE_TAG_DOUBLE) comparisonValid = 0;
                    }
                    if (comparisonValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var comparisonValue = 0;
                    if (opcode === OP_STRICT_EQUAL) {
                        comparisonValue = equalF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    } else if (opcode === OP_EQUAL) {
                        comparisonValue = equalF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    } else if (opcode === OP_LESS) {
                        comparisonValue = lessF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    } else if (opcode === OP_LESS_EQUAL) {
                        comparisonValue = lessEqualF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    } else if (opcode === OP_GREATER) {
                        comparisonValue = greaterF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    } else {
                        comparisonValue = greaterEqualF64(
                            loadNumberF64(comparisonLeft + VALUE_CELL_LOW, comparisonLeftTag),
                            loadNumberF64(comparisonRight + VALUE_CELL_LOW, comparisonRightTag));
                    }
                    store32(comparisonTarget, comparisonValue + VALUE_TAG_FALSE);
                    store32(comparisonTarget + VALUE_CELL_LOW, 0);
                    store32(comparisonTarget + VALUE_CELL_HIGH, 0);
                    store32(comparisonTarget + VALUE_CELL_AUX, 0);
                    pc = pc + FOUR_WORD_INSTRUCTION;
                } else {
                    store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
            } else if (opcode === OP_JUMP) {
                pc = load32(heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
            } else if (opcode === OP_JUMP_IF_FALSE) {
                var conditionIndex = load32(heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var condition = heapBase + registerCells + conditionIndex * VALUE_CELL_BYTES;
                var conditionTag = load32(condition);
                var falseCondition = 0;
                if (conditionTag === VALUE_TAG_UNDEFINED) falseCondition = 1;
                else if (conditionTag === VALUE_TAG_NULL) falseCondition = 1;
                else if (conditionTag === VALUE_TAG_FALSE) falseCondition = 1;
                else if (conditionTag === VALUE_TAG_INT32) {
                    if (load32(condition + VALUE_CELL_LOW) === 0) falseCondition = 1;
                } else if (conditionTag === VALUE_TAG_DOUBLE) {
                    store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                if (falseCondition === 1) {
                    pc = load32(heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                } else pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_RETURN) {
                var returnIndex = load32(heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_RETURN);
                store32(heapBase + state + ENGINE_PC, pc);
                store32(heapBase + state + ENGINE_RESULT, registerCells + returnIndex * VALUE_CELL_BYTES);
                store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions + 1);
                store32(heapBase + framePC, pc);
                return EXIT_RETURN;
            } else if (opcode === OP_GET_LOCAL) {
                var localTargetIndex = load32(
                    heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var localDepth = load32(
                    heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                var localSlot = load32(
                    heapBase + bytecodeWords + (pc + THIRD_OPERAND) * WORD_BYTES);
                var localEnvironment = environment;
                while (localDepth > 0) {
                    if (localEnvironment === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    localEnvironment = load32(
                        heapBase + localEnvironment + ENVIRONMENT_PARENT);
                    localDepth = localDepth - 1;
                }
                var localInvalid = 0;
                if (localEnvironment === 0) localInvalid = 1;
                else if (localSlot >= load32(
                         heapBase + localEnvironment + ENVIRONMENT_COUNT)) localInvalid = 1;
                if (localInvalid === 1) {
                    store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var localSource = heapBase + localEnvironment + ENVIRONMENT_CELLS +
                                  localSlot * VALUE_CELL_BYTES;
                var localDestination = heapBase + registerCells +
                                       localTargetIndex * VALUE_CELL_BYTES;
                store32(localDestination, load32(localSource));
                store32(localDestination + VALUE_CELL_LOW, load32(localSource + VALUE_CELL_LOW));
                store32(localDestination + VALUE_CELL_HIGH, load32(localSource + VALUE_CELL_HIGH));
                store32(localDestination + VALUE_CELL_AUX, load32(localSource + VALUE_CELL_AUX));
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else if (opcode === OP_SET_LOCAL) {
                var setLocalDepth = load32(
                    heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var setLocalSlot = load32(
                    heapBase + bytecodeWords + (pc + SECOND_OPERAND) * WORD_BYTES);
                var setLocalSourceIndex = load32(
                    heapBase + bytecodeWords + (pc + THIRD_OPERAND) * WORD_BYTES);
                var setLocalEnvironment = environment;
                while (setLocalDepth > 0) {
                    if (setLocalEnvironment === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    setLocalEnvironment = load32(
                        heapBase + setLocalEnvironment + ENVIRONMENT_PARENT);
                    setLocalDepth = setLocalDepth - 1;
                }
                var setLocalInvalid = 0;
                if (setLocalEnvironment === 0) setLocalInvalid = 1;
                else if (setLocalSlot >= load32(
                         heapBase + setLocalEnvironment + ENVIRONMENT_COUNT)) setLocalInvalid = 1;
                if (setLocalInvalid === 1) {
                    store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var setLocalDestination = heapBase + setLocalEnvironment + ENVIRONMENT_CELLS +
                                          setLocalSlot * VALUE_CELL_BYTES;
                var setLocalSource = heapBase + registerCells +
                                     setLocalSourceIndex * VALUE_CELL_BYTES;
                store32(setLocalDestination, load32(setLocalSource));
                store32(setLocalDestination + VALUE_CELL_LOW, load32(setLocalSource + VALUE_CELL_LOW));
                store32(setLocalDestination + VALUE_CELL_HIGH, load32(setLocalSource + VALUE_CELL_HIGH));
                store32(setLocalDestination + VALUE_CELL_AUX, load32(setLocalSource + VALUE_CELL_AUX));
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else {
                store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                store32(heapBase + state + ENGINE_PC, pc);
                store32(heapBase + state + ENGINE_RESULT, opcode);
                store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                store32(heapBase + framePC, pc);
                return EXIT_UNSUPPORTED;
            }
            budget = budget - 1;
            instructions = instructions + 1;
        }
        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_BUDGET);
        store32(heapBase + state + ENGINE_PC, pc);
        store32(heapBase + state + ENGINE_RESULT, 0);
        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
        store32(heapBase + framePC, pc);
        return EXIT_BUDGET;
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

    NativeInterpreter.prototype.run = function (frame, program, budget, context) {
        var records = this.runtime.heapRecords;
        var programAddress = this.runtime.programAddress(program);
        var bytecode = records.programBytecode(programAddress);
        var constants = records.programConstants(programAddress);
        var bytecodeWords = records.bytecodeWordsAddress(bytecode);
        var constantCells = records.vectorCellsAddress(constants);
        var globalObject = context ? records.contextGlobal(context.heapAddress) : 0;
        var heapBase = this.runtime.linearHeap.memory.nativeAddress(0);
        var reason = this.nativeResult.fn ? this.nativeResult.fn(
            heapBase, frame, bytecodeWords, constantCells, globalObject,
            budget, this.statePayload) : this.js.fn(
            this.runtime.linearHeap.memory, 0, frame, bytecodeWords,
            constantCells, globalObject, budget, this.statePayload);
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
