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
        var HEAP_TYPE_OBJECT = 1;
        var HEAP_TYPE_ARRAY = 2;
        var HEAP_TYPE_NATIVE_FUNCTION = 3;
        var HEAP_TYPE_BYTECODE_FUNCTION = 4;
        var HEAP_TYPE_STRING = 7;
        var HEAP_TYPE_REGEXP = 9;
        var HEAP_TYPE_BUFFER_VIEW = 10;
        var STRING_LENGTH = 16;
        var IEEE754_SIGN_BIT = -2147483648;
        var IEEE754_ABSOLUTE_MASK = 2147483647;
        var IEEE754_EXPONENT_MASK = 2146435072;
        var POSITIVE_2147483648_HIGH = 1105199104;

        var FRAME_ENVIRONMENT = 20;
        var FRAME_PC = 28;
        var FRAME_REGISTERS = 48;
        var OBJECT_PROPERTY_HEAD = 20;
        var OBJECT_PROTOTYPE = 16;
        var REGEXP_PROPERTY_HEAD = 28;
        var REGEXP_PROTOTYPE = 24;
        var BUFFER_VIEW_PROPERTY_HEAD = 32;
        var BUFFER_VIEW_PROTOTYPE = 28;
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
        var OP_NOT = 18;
        var OP_NEGATE = 19;
        var OP_POSITIVE = 20;
        var OP_JUMP = 21;
        var OP_JUMP_IF_FALSE = 22;
        var OP_RETURN = 24;
        var OP_GET_LOCAL = 43;
        var OP_SET_LOCAL = 44;
        var OP_GET_PROPERTY_CONST = 45;
        var OP_SET_PROPERTY_CONST = 46;

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
                    var integerArithmetic = 0;
                    if (arithmeticLeftTag === VALUE_TAG_INT32) {
                        if (arithmeticRightTag === VALUE_TAG_INT32) {
                            var integerLeft = load32(
                                arithmeticLeft + VALUE_CELL_LOW);
                            var integerRight = load32(
                                arithmeticRight + VALUE_CELL_LOW);
                            var integerResult = 0;
                            var integerOverflow = 1;
                            var integerOperation = 0;
                            if (opcode === OP_ADD) {
                                integerOperation = 1;
                                integerResult = integerLeft + integerRight;
                                integerOverflow = (integerLeft ^ integerResult) &
                                                  (integerRight ^ integerResult);
                            } else if (opcode === OP_SUBTRACT) {
                                integerOperation = 1;
                                integerResult = integerLeft - integerRight;
                                integerOverflow = (integerLeft ^ integerRight) &
                                                  (integerLeft ^ integerResult);
                            }
                            if (integerOperation === 1) {
                                if (integerOverflow >= 0) {
                                    integerArithmetic = 1;
                                    store32(arithmeticTarget, VALUE_TAG_INT32);
                                    store32(arithmeticTarget + VALUE_CELL_LOW,
                                            integerResult);
                                    store32(arithmeticTarget + VALUE_CELL_HIGH, 0);
                                    store32(arithmeticTarget + VALUE_CELL_AUX, 0);
                                }
                            }
                        }
                    }
                    if (integerArithmetic === 0) {
                        store32(arithmeticTarget, VALUE_TAG_DOUBLE);
                        if (opcode === OP_ADD) {
                            storeF64(arithmeticTarget + VALUE_CELL_LOW,
                                addF64(loadNumberF64(
                                           arithmeticLeft + VALUE_CELL_LOW,
                                           arithmeticLeftTag),
                                       loadNumberF64(
                                           arithmeticRight + VALUE_CELL_LOW,
                                           arithmeticRightTag)));
                        } else if (opcode === OP_SUBTRACT) {
                            storeF64(arithmeticTarget + VALUE_CELL_LOW,
                                subtractF64(loadNumberF64(
                                                arithmeticLeft + VALUE_CELL_LOW,
                                                arithmeticLeftTag),
                                            loadNumberF64(
                                                arithmeticRight + VALUE_CELL_LOW,
                                                arithmeticRightTag)));
                        } else if (opcode === OP_MULTIPLY) {
                            storeF64(arithmeticTarget + VALUE_CELL_LOW,
                                multiplyF64(loadNumberF64(
                                                arithmeticLeft + VALUE_CELL_LOW,
                                                arithmeticLeftTag),
                                            loadNumberF64(
                                                arithmeticRight + VALUE_CELL_LOW,
                                                arithmeticRightTag)));
                        } else {
                            storeF64(arithmeticTarget + VALUE_CELL_LOW,
                                divideF64(loadNumberF64(
                                              arithmeticLeft + VALUE_CELL_LOW,
                                              arithmeticLeftTag),
                                          loadNumberF64(
                                              arithmeticRight + VALUE_CELL_LOW,
                                              arithmeticRightTag)));
                        }
                        store32(arithmeticTarget + VALUE_CELL_AUX, 0);
                    }
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
            } else if (opcode === OP_NOT) {
                var notTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var notSourceIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var notSource = heapBase + registerCells +
                                notSourceIndex * VALUE_CELL_BYTES;
                var notTarget = heapBase + registerCells +
                                notTargetIndex * VALUE_CELL_BYTES;
                var notTag = load32(notSource);
                var notValue = 0;
                if (notTag === VALUE_TAG_UNDEFINED) notValue = 1;
                else if (notTag === VALUE_TAG_NULL) notValue = 1;
                else if (notTag === VALUE_TAG_FALSE) notValue = 1;
                else if (notTag === VALUE_TAG_INT32) {
                    if (load32(notSource + VALUE_CELL_LOW) === 0) notValue = 1;
                } else if (notTag === VALUE_TAG_DOUBLE) {
                    var notDoubleLow = load32(notSource + VALUE_CELL_LOW);
                    var notDoubleHigh = load32(notSource + VALUE_CELL_HIGH) &
                                        IEEE754_ABSOLUTE_MASK;
                    if (notDoubleHigh === 0) {
                        if (notDoubleLow === 0) notValue = 1;
                    } else if (notDoubleHigh > IEEE754_EXPONENT_MASK) {
                        notValue = 1;
                    } else if (notDoubleHigh === IEEE754_EXPONENT_MASK) {
                        if (notDoubleLow !== 0) notValue = 1;
                    }
                } else if (notTag === VALUE_TAG_REFERENCE) {
                    var notReference = load32(notSource + VALUE_CELL_LOW);
                    if (load32(heapBase + notReference) === HEAP_TYPE_STRING) {
                        if (load32(heapBase + notReference + STRING_LENGTH) === 0) {
                            notValue = 1;
                        }
                    }
                } else {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                store32(notTarget, VALUE_TAG_FALSE + notValue);
                store32(notTarget + VALUE_CELL_LOW, 0);
                store32(notTarget + VALUE_CELL_HIGH, 0);
                store32(notTarget + VALUE_CELL_AUX, 0);
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_NEGATE) {
                var negateTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var negateSourceIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var negateSource = heapBase + registerCells +
                                   negateSourceIndex * VALUE_CELL_BYTES;
                var negateTarget = heapBase + registerCells +
                                   negateTargetIndex * VALUE_CELL_BYTES;
                var negateTag = load32(negateSource);
                if (negateTag === VALUE_TAG_INT32) {
                    var negateInteger = load32(negateSource + VALUE_CELL_LOW);
                    if (negateInteger === 0) {
                        store32(negateTarget, VALUE_TAG_DOUBLE);
                        store32(negateTarget + VALUE_CELL_LOW, 0);
                        store32(negateTarget + VALUE_CELL_HIGH,
                                IEEE754_SIGN_BIT);
                    } else if (negateInteger === IEEE754_SIGN_BIT) {
                        store32(negateTarget, VALUE_TAG_DOUBLE);
                        store32(negateTarget + VALUE_CELL_LOW, 0);
                        store32(negateTarget + VALUE_CELL_HIGH,
                                POSITIVE_2147483648_HIGH);
                    } else {
                        store32(negateTarget, VALUE_TAG_INT32);
                        store32(negateTarget + VALUE_CELL_LOW, -negateInteger);
                        store32(negateTarget + VALUE_CELL_HIGH, 0);
                    }
                    store32(negateTarget + VALUE_CELL_AUX, 0);
                } else if (negateTag === VALUE_TAG_DOUBLE) {
                    store32(negateTarget, VALUE_TAG_DOUBLE);
                    store32(negateTarget + VALUE_CELL_LOW,
                            load32(negateSource + VALUE_CELL_LOW));
                    store32(negateTarget + VALUE_CELL_HIGH,
                            load32(negateSource + VALUE_CELL_HIGH) ^
                            IEEE754_SIGN_BIT);
                    store32(negateTarget + VALUE_CELL_AUX, 0);
                } else {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                pc = pc + THREE_WORD_INSTRUCTION;
            } else if (opcode === OP_POSITIVE) {
                var positiveTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var positiveSourceIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var positiveSource = heapBase + registerCells +
                                     positiveSourceIndex * VALUE_CELL_BYTES;
                var positiveTag = load32(positiveSource);
                if (positiveTag !== VALUE_TAG_INT32) {
                    if (positiveTag !== VALUE_TAG_DOUBLE) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                }
                var positiveTarget = heapBase + registerCells +
                                     positiveTargetIndex * VALUE_CELL_BYTES;
                store32(positiveTarget, load32(positiveSource));
                store32(positiveTarget + VALUE_CELL_LOW,
                        load32(positiveSource + VALUE_CELL_LOW));
                store32(positiveTarget + VALUE_CELL_HIGH,
                        load32(positiveSource + VALUE_CELL_HIGH));
                store32(positiveTarget + VALUE_CELL_AUX,
                        load32(positiveSource + VALUE_CELL_AUX));
                pc = pc + THREE_WORD_INSTRUCTION;
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
                    var conditionDoubleLow = load32(
                        condition + VALUE_CELL_LOW);
                    var conditionDoubleHigh = load32(
                        condition + VALUE_CELL_HIGH) & IEEE754_ABSOLUTE_MASK;
                    if (conditionDoubleHigh === 0) {
                        if (conditionDoubleLow === 0) falseCondition = 1;
                    } else if (conditionDoubleHigh > IEEE754_EXPONENT_MASK) {
                        falseCondition = 1;
                    } else if (conditionDoubleHigh === IEEE754_EXPONENT_MASK) {
                        if (conditionDoubleLow !== 0) falseCondition = 1;
                    }
                } else if (conditionTag === VALUE_TAG_REFERENCE) {
                    var conditionReference = load32(
                        condition + VALUE_CELL_LOW);
                    if (load32(heapBase + conditionReference) ===
                        HEAP_TYPE_STRING) {
                        if (load32(heapBase + conditionReference + STRING_LENGTH) ===
                            0) falseCondition = 1;
                    }
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
            } else if (opcode === OP_GET_PROPERTY_CONST) {
                var propertyTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var propertyObjectIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var propertyKeyIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var propertyObjectCell = heapBase + registerCells +
                    propertyObjectIndex * VALUE_CELL_BYTES;
                var propertyKeyCell = heapBase + constantCells +
                    propertyKeyIndex * VALUE_CELL_BYTES;
                var propertyOperandsValid = 1;
                if (load32(propertyObjectCell) !== VALUE_TAG_REFERENCE) {
                    propertyOperandsValid = 0;
                }
                if (load32(propertyKeyCell) !== VALUE_TAG_REFERENCE) {
                    propertyOperandsValid = 0;
                }
                if (propertyOperandsValid === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var propertyObject = load32(
                    propertyObjectCell + VALUE_CELL_LOW);
                var propertyKey = load32(propertyKeyCell + VALUE_CELL_LOW);
                var propertyRecord = 0;
                while (propertyObject !== 0) {
                    var propertyObjectType = load32(heapBase + propertyObject);
                    var propertyHead = 0;
                    var propertyPrototypeOffset = 0;
                    if (propertyObjectType >= HEAP_TYPE_OBJECT) {
                        if (propertyObjectType <= HEAP_TYPE_BYTECODE_FUNCTION) {
                            propertyHead = load32(
                                heapBase + propertyObject + OBJECT_PROPERTY_HEAD);
                            propertyPrototypeOffset = OBJECT_PROTOTYPE;
                        }
                    }
                    if (propertyObjectType === HEAP_TYPE_REGEXP) {
                        propertyHead = load32(
                            heapBase + propertyObject + REGEXP_PROPERTY_HEAD);
                        propertyPrototypeOffset = REGEXP_PROTOTYPE;
                    } else if (propertyObjectType === HEAP_TYPE_BUFFER_VIEW) {
                        propertyHead = load32(
                            heapBase + propertyObject + BUFFER_VIEW_PROPERTY_HEAD);
                        propertyPrototypeOffset = BUFFER_VIEW_PROTOTYPE;
                    }
                    if (propertyPrototypeOffset === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    while (propertyHead !== 0) {
                        if (load32(heapBase + propertyHead + PROPERTY_KEY) ===
                            propertyKey) {
                            propertyRecord = propertyHead;
                            propertyHead = 0;
                        } else {
                            propertyHead = load32(
                                heapBase + propertyHead + PROPERTY_NEXT);
                        }
                    }
                    if (propertyRecord !== 0) {
                        propertyObject = 0;
                    } else {
                        propertyObject = load32(
                            heapBase + propertyObject +
                            propertyPrototypeOffset);
                    }
                }
                if (propertyRecord === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var propertySource = heapBase + propertyRecord + PROPERTY_VALUE;
                var propertyTarget = heapBase + registerCells +
                    propertyTargetIndex * VALUE_CELL_BYTES;
                store32(propertyTarget, load32(propertySource));
                store32(propertyTarget + VALUE_CELL_LOW,
                        load32(propertySource + VALUE_CELL_LOW));
                store32(propertyTarget + VALUE_CELL_HIGH,
                        load32(propertySource + VALUE_CELL_HIGH));
                store32(propertyTarget + VALUE_CELL_AUX,
                        load32(propertySource + VALUE_CELL_AUX));
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else if (opcode === OP_SET_PROPERTY_CONST) {
                var setPropertyObjectIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var setPropertyKeyIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var setPropertySourceIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var setPropertyObjectCell = heapBase + registerCells +
                    setPropertyObjectIndex * VALUE_CELL_BYTES;
                var setPropertyKeyCell = heapBase + constantCells +
                    setPropertyKeyIndex * VALUE_CELL_BYTES;
                var setPropertyOperandsValid = 1;
                if (load32(setPropertyObjectCell) !== VALUE_TAG_REFERENCE) {
                    setPropertyOperandsValid = 0;
                }
                if (load32(setPropertyKeyCell) !== VALUE_TAG_REFERENCE) {
                    setPropertyOperandsValid = 0;
                }
                if (setPropertyOperandsValid === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var setPropertyObject = load32(
                    setPropertyObjectCell + VALUE_CELL_LOW);
                var setPropertyObjectType = load32(
                    heapBase + setPropertyObject);
                var setPropertyHead = 0;
                if (setPropertyObjectType >= HEAP_TYPE_OBJECT) {
                    if (setPropertyObjectType <= HEAP_TYPE_BYTECODE_FUNCTION) {
                        setPropertyHead = load32(
                            heapBase + setPropertyObject + OBJECT_PROPERTY_HEAD);
                    }
                }
                if (setPropertyObjectType === HEAP_TYPE_REGEXP) {
                    setPropertyHead = load32(
                        heapBase + setPropertyObject + REGEXP_PROPERTY_HEAD);
                } else if (setPropertyObjectType === HEAP_TYPE_BUFFER_VIEW) {
                    setPropertyHead = load32(
                        heapBase + setPropertyObject + BUFFER_VIEW_PROPERTY_HEAD);
                }
                var setPropertyKey = load32(
                    setPropertyKeyCell + VALUE_CELL_LOW);
                var setPropertyRecord = 0;
                while (setPropertyHead !== 0) {
                    if (load32(heapBase + setPropertyHead + PROPERTY_KEY) ===
                        setPropertyKey) {
                        setPropertyRecord = setPropertyHead;
                        setPropertyHead = 0;
                    } else {
                        setPropertyHead = load32(
                            heapBase + setPropertyHead + PROPERTY_NEXT);
                    }
                }
                if (setPropertyRecord === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var setPropertyDestination = heapBase + setPropertyRecord +
                                             PROPERTY_VALUE;
                var setPropertySource = heapBase + registerCells +
                    setPropertySourceIndex * VALUE_CELL_BYTES;
                store32(setPropertyDestination, load32(setPropertySource));
                store32(setPropertyDestination + VALUE_CELL_LOW,
                        load32(setPropertySource + VALUE_CELL_LOW));
                store32(setPropertyDestination + VALUE_CELL_HIGH,
                        load32(setPropertySource + VALUE_CELL_HIGH));
                store32(setPropertyDestination + VALUE_CELL_AUX,
                        load32(setPropertySource + VALUE_CELL_AUX));
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
        this.runCount = 0;
        this.instructionCount = 0;
        this.unsupportedExitCount = 0;
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
        var instructionCount = records.engineInstructionCount(this.stateAddress);
        this.runCount++;
        this.instructionCount += instructionCount;
        if (reason === Exit.UNSUPPORTED) this.unsupportedExitCount++;
        return {reason: reason,
                pc: records.enginePC(this.stateAddress),
                resultCell: records.engineResultCell(this.stateAddress),
                instructions: instructionCount,
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
