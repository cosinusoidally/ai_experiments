/* Shared kernel-dialect bytecode dispatch engine. The JavaScript backend is
 * the Node/reference implementation; MMVM installs the same IR as native i386. */
(function (root) {
    var KernelCompiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    var Bytecode = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) {
        KernelCompiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
        Bytecode = require("../bytecode.js");
    }

    var Exit = {BUDGET: 1, RETURN: 2, UNSUPPORTED: 3, ALLOCATION: 4};
    var FREE_RECORD_HEADER_BYTES = 16;
    var MIN_NATIVE_ALLOCATION_REGION_BYTES = 4096 + FREE_RECORD_HEADER_BYTES;
    var NATIVE_ALLOCATION_REGION_FLAG = 2;
    var NATIVE_PROPERTY_RECORD_BYTES = 48;
    var CallReject = {HEAP_SPACE: 4};

    function interpreterKernel(heapBase, frame, globalObject, arrayLengthKey,
                               arrayPrototype, stringSupport, budget, state) {
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
        var FIVE_WORD_INSTRUCTION = 5;
        var VALUE_CELL_BYTES = 16;
        var VALUE_CELL_LOW = 4;
        var VALUE_CELL_HIGH = 8;
        var VALUE_CELL_AUX = 12;
        var VALUE_TAG_UNDEFINED = 1;
        var VALUE_TAG_NULL = 2;
        var VALUE_TAG_FALSE = 3;
        var VALUE_TAG_TRUE = 4;
        var VALUE_TAG_INT32 = 5;
        var VALUE_TAG_DOUBLE = 6;
        var VALUE_TAG_REFERENCE = 7;
        var HEAP_TYPE_OBJECT = 1;
        var HEAP_TYPE_FREE = 0;
        var HEAP_TYPE_ARRAY = 2;
        var HEAP_TYPE_NATIVE_FUNCTION = 3;
        var HEAP_TYPE_BYTECODE_FUNCTION = 4;
        var HEAP_TYPE_ENVIRONMENT = 5;
        var HEAP_TYPE_PROPERTY = 6;
        var HEAP_TYPE_STRING = 7;
        var HEAP_TYPE_REGEXP = 9;
        var HEAP_TYPE_BUFFER_VIEW = 10;
        var HEAP_TYPE_BUFFER_BACKING = 11;
        var HEAP_TYPE_VALUE_VECTOR = 13;
        var HEAP_TYPE_FRAME = 14;
        var STRING_LENGTH = 16;
        var STRING_HASH = 20;
        var STRING_CHARS = 24;
        var IEEE754_SIGN_BIT = -2147483648;
        var MINIMUM_INT32 = -2147483648;
        var IEEE754_ABSOLUTE_MASK = 2147483647;
        var IEEE754_EXPONENT_MASK = 2146435072;
        var POSITIVE_2147483648_HIGH = 1105199104;
        var UINT32_MANTISSA_LOW_SHIFT = 21;
        var UINT32_MANTISSA_HIGH_SHIFT = 11;

        var FRAME_ENVIRONMENT = 20;
        var FRAME_PROGRAM = 16;
        var FRAME_CALLER = 24;
        var FRAME_PC = 28;
        var FRAME_RETURN_SLOT = 32;
        var FRAME_REGISTER_COUNT = 36;
        var FRAME_HANDLER = 40;
        var FRAME_CONTEXT = 44;
        var FRAME_REGISTERS = 48;
        var PROGRAM_BYTECODE = 16;
        var PROGRAM_CONSTANTS = 20;
        var PROGRAM_CONSTANT_REGISTERS = 24;
        var PROGRAM_BINDING_REGISTERS = 28;
        var PROGRAM_PARAMETER_SLOTS = 32;
        var PROGRAM_REGISTER_COUNT = 36;
        var PROGRAM_ARGUMENTS_SLOT = 40;
        var PROGRAM_THIS_SLOT = 44;
        var PROGRAM_FUNCTION_NAME_SLOT = 48;
        var PROGRAM_FLAGS = 56;
        var PROGRAM_BINDING_COUNT = 60;
        var PROGRAM_FLAG_USES_ARGUMENTS = 1;
        var BYTECODE_WORDS = 24;
        var CONTEXT_GLOBAL = 16;
        var OBJECT_PROPERTY_HEAD = 20;
        var OBJECT_PROTOTYPE = 16;
        var OBJECT_EXTENSIBLE = 24;
        var OBJECT_RESERVED = 28;
        var REGEXP_PATTERN = 16;
        var REGEXP_FLAGS = 20;
        var REGEXP_PROPERTY_HEAD = 28;
        var REGEXP_PROTOTYPE = 24;
        var REGEXP_RECORD_BYTES = 32;
        var BUFFER_VIEW_PROPERTY_HEAD = 32;
        var BUFFER_VIEW_PROTOTYPE = 28;
        var BUFFER_VIEW_BACKING = 16;
        var BUFFER_VIEW_OFFSET = 20;
        var BUFFER_VIEW_LENGTH = 24;
        var BUFFER_VIEW_RECORD_BYTES = 40;
        var BUFFER_BACKING_POINTER = 16;
        var BUFFER_BACKING_LENGTH = 20;
        var BUFFER_BACKING_METADATA = 24;
        var BUFFER_BACKING_DATA = 32;
        var ARRAY_ELEMENTS = 24;
        var ARRAY_PROTOTYPE = 16;
        var ARRAY_PROPERTY_HEAD = 20;
        var ARRAY_RESERVED = 28;
        var VECTOR_LENGTH = 16;
        var VECTOR_CAPACITY = 20;
        var VECTOR_CELLS = 24;
        var NATIVE_FUNCTION_METADATA = 28;
        var FUNCTION_CLOSURE = 24;
        var FUNCTION_METADATA = 28;
        var FUNCTION_HOME_CONTEXT = 32;
        var BYTECODE_FUNCTION_CLOSURE = 24;
        var BYTECODE_FUNCTION_PROGRAM = 28;
        var BYTECODE_FUNCTION_HOME_CONTEXT = 32;
        var PROPERTY_NEXT = 16;
        var PROPERTY_KEY = 20;
        var PROPERTY_VALUE = 32;
        var PROPERTY_ATTRIBUTES = 24;
        var PROPERTY_RESERVED = 28;
        var DEFAULT_PROPERTY_ATTRIBUTES = 7;
        var PROPERTY_RECORD_BYTES = 48;
        var FRAME_FIXED_BYTES = 48;
        var FRAME_FLAG_NATIVE_CALL = 1;
        var ENVIRONMENT_PARENT = 16;
        var ENVIRONMENT_COUNT = 20;
        var ENVIRONMENT_CELLS = 24;
        var ENVIRONMENT_FIXED_BYTES = 24;
        var ENGINE_EXIT_REASON = 0;
        var ENGINE_PC = 4;
        var ENGINE_RESULT = 8;
        var ENGINE_INSTRUCTIONS = 12;
        var ENGINE_HEAP_BUMP = 16;
        var ENGINE_HEAP_LIMIT = 20;
        var ENGINE_CURRENT_FRAME = 24;
        var ENGINE_CALL_REJECT_REASON = 28;
        var ENGINE_FREE_FRAME = 32;
        var ENGINE_SCRATCH_LEFT = 36;
        var ENGINE_SCRATCH_RIGHT = 40;
        var ENGINE_PLATFORM_SERVICES = 44;
        var ENGINE_OPCODE_COUNTS = 48;
        var PLATFORM_DLSYM_POINTER = 16;
        var PROFILE_OPCODES = 0;
        var CALL_REJECT_NONE = 0;
        var CALL_REJECT_ARGUMENT_LIST = 1;
        var CALL_REJECT_ARGUMENT_REGISTER = 2;
        var CALL_REJECT_HEAP_ENVIRONMENT = 3;
        var CALL_REJECT_HEAP_SPACE = 4;

        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_MARK = 8;
        var RECORD_FLAGS = 12;
        var OBJECT_RECORD_BYTES = 32;
        var ARRAY_RECORD_BYTES = 32;
        var INITIAL_ARRAY_CAPACITY = 4;
        var INITIAL_VECTOR_RECORD_BYTES = 88;

        var EXIT_BUDGET = 1;
        var EXIT_RETURN = 2;
        var EXIT_UNSUPPORTED = 3;
        var PROPERTY_FOUND_SENTINEL = -1;

        var OP_CONST = 1;
        var OP_GET_GLOBAL = 2;
        var OP_SET_GLOBAL = 3;
        var OP_MOVE = 4;
        var OP_GET_PROPERTY = 5;
        var OP_SET_PROPERTY = 6;
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
        var OP_CALL = 23;
        var OP_RETURN = 24;
        var OP_MAKE_OBJECT = 26;
        var OP_MAKE_ARRAY = 27;
        var OP_MAKE_REGEXP = 28;
        var OP_BIT_AND = 29;
        var OP_BIT_OR = 30;
        var OP_BIT_XOR = 31;
        var OP_SHIFT_LEFT = 32;
        var OP_SHIFT_RIGHT = 33;
        var OP_SHIFT_UNSIGNED_RIGHT = 34;
        var OP_BIT_NOT = 39;
        var OP_GET_LOCAL = 43;
        var OP_SET_LOCAL = 44;
        var OP_GET_PROPERTY_CONST = 45;
        var OP_SET_PROPERTY_CONST = 46;

        /* Stable IDs from native_intrinsics.js. */
        var INTRINSIC_PEEK8 = 1;
        var INTRINSIC_POKE8 = 2;
        var INTRINSIC_PEEK32 = 3;
        var INTRINSIC_POKE32 = 4;
        var INTRINSIC_BUFFER_READ_U32_LE = 5;
        var INTRINSIC_BUFFER_WRITE_U32_LE = 6;
        var INTRINSIC_MATH_SQRT = 7;
        var INTRINSIC_MATH_MIN = 8;
        var INTRINSIC_MATH_ABS = 9;
        var INTRINSIC_MATH_MAX = 10;
        var INTRINSIC_ARRAY_PUSH = 11;
        var INTRINSIC_MATH_FLOOR = 12;
        var INTRINSIC_MATH_CEIL = 13;
        var INTRINSIC_MATH_ROUND = 14;
        var INTRINSIC_MATH_SIN = 15;
        var INTRINSIC_MATH_COS = 16;
        var INTRINSIC_BUFFER_READ_U16_LE = 17;
        var INTRINSIC_BUFFER_READ_U16_BE = 18;
        var INTRINSIC_BUFFER_WRITE_U16_LE = 19;
        var INTRINSIC_BUFFER_WRITE_I16_LE = 20;
        var INTRINSIC_BUFFER_SLICE = 21;
        var INTRINSIC_STRING_CHAR_AT = 22;
        var INTRINSIC_BUFFER_ALLOC = 23;
        var INTRINSIC_BUFFER_COPY = 24;
        var INTRINSIC_GET_DLSYM = 25;
        var INTRINSIC_FFI_CALL = 26;
        var INTRINSIC_STRING_CHAR_CODE_AT = 27;
        var INTRINSIC_MATH_POW = 28;
        var INTRINSIC_STRING_SUBSTR = 29;
        var INTRINSIC_STRING_INDEX_OF = 30;
        var INTRINSIC_REGEXP_TEST = 31;
        var ENABLE_NATIVE_REGEXP_TEST = 0;
        var STRING_SUPPORT_CHAR_AT_KEY = 0;
        var STRING_SUPPORT_CHAR_AT_FUNCTION = 1;
        var STRING_SUPPORT_EMPTY = 2;
        var STRING_SUPPORT_ASCII_BASE = 3;
        var RUNTIME_SUPPORT_BUFFER_PROTOTYPE = 259;
        var RUNTIME_SUPPORT_OBJECT_PROTOTYPE = 260;
        var RUNTIME_SUPPORT_STRING_PROTOTYPE = 261;
        var RUNTIME_SUPPORT_REGEXP_PROTOTYPE = 262;

        var currentContext = load32(heapBase + frame + FRAME_CONTEXT);
        var currentProgram = load32(heapBase + frame + FRAME_PROGRAM);
        var bytecodeWords = load32(
            heapBase + currentProgram + PROGRAM_BYTECODE) + BYTECODE_WORDS;
        var constantCells = load32(
            heapBase + currentProgram + PROGRAM_CONSTANTS) + VECTOR_CELLS;
        globalObject = load32(heapBase + currentContext + CONTEXT_GLOBAL);
        var framePC = frame + FRAME_PC;
        var registerCells = frame + FRAME_REGISTERS;
        var environment = load32(heapBase + frame + FRAME_ENVIRONMENT);
        var pc = load32(heapBase + framePC);
        var instructions = 0;
        store32(heapBase + state + ENGINE_CURRENT_FRAME, frame);
        while (budget > 0) {
            var opcode = load32(heapBase + bytecodeWords + pc * WORD_BYTES);
            if (PROFILE_OPCODES !== 0) {
                setOpcodeExecutionCount(heapBase, state, opcode,
                    opcodeExecutionCount(heapBase, state, opcode) + 1);
            }
            beginOpcodeDispatch(opcode, OP_CONST, OP_SET_PROPERTY_CONST);
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
                while (globalProperty > 0) {
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
                while (setGlobalProperty > 0) {
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
            } else if (opcode === OP_GET_PROPERTY) {
                var arrayGetTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var arrayGetObjectIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var arrayGetKeyIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var arrayGetObjectCell = heapBase + registerCells +
                    arrayGetObjectIndex * VALUE_CELL_BYTES;
                var arrayGetKeyCell = heapBase + registerCells +
                    arrayGetKeyIndex * VALUE_CELL_BYTES;
                var arrayGetSupported = 1;
                if (load32(arrayGetObjectCell) !== VALUE_TAG_REFERENCE) {
                    arrayGetSupported = 0;
                }
                var arrayGetKeyTag = load32(arrayGetKeyCell);
                var arrayGetIndex = 0;
                if (arrayGetKeyTag === VALUE_TAG_INT32) {
                    arrayGetIndex = load32(arrayGetKeyCell + VALUE_CELL_LOW);
                } else if (arrayGetKeyTag === VALUE_TAG_DOUBLE) {
                    arrayGetIndex = toInt32F64(loadNumberF64(
                        arrayGetKeyCell + VALUE_CELL_LOW, arrayGetKeyTag));
                    store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                            arrayGetIndex);
                    if (equalF64(loadNumberF64(
                            arrayGetKeyCell + VALUE_CELL_LOW, arrayGetKeyTag),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_LEFT)) === 0) {
                        arrayGetSupported = 0;
                    }
                } else if (arrayGetKeyTag === VALUE_TAG_REFERENCE) {
                    arrayGetSupported = 3;
                } else arrayGetSupported = 0;
                var arrayGetObject = load32(
                    arrayGetObjectCell + VALUE_CELL_LOW);
                var arrayGetOriginalObjectType = 0;
                if (load32(arrayGetObjectCell) === VALUE_TAG_REFERENCE) {
                    arrayGetOriginalObjectType = recordType(
                        heapBase, arrayGetObject);
                }
                if (arrayGetSupported === 1) {
                    var arrayGetObjectType = recordType(
                        heapBase, arrayGetObject);
                    if (arrayGetObjectType === HEAP_TYPE_BUFFER_VIEW) {
                        arrayGetSupported = 2;
                    } else if (arrayGetObjectType !== HEAP_TYPE_ARRAY) {
                        arrayGetSupported = 0;
                    }
                }
                if (arrayGetSupported === 3) {
                    var namedGetKey = load32(
                        arrayGetKeyCell + VALUE_CELL_LOW);
                    if (recordType(heapBase, namedGetKey) !==
                        HEAP_TYPE_STRING) arrayGetSupported = 0;
                }
                if (arrayGetSupported <= 2) {
                    if (arrayGetIndex < 0) arrayGetSupported = 0;
                }
                var arrayGetTarget = heapBase + registerCells +
                    arrayGetTargetIndex * VALUE_CELL_BYTES;
                if (arrayGetSupported === 3) {
                    var namedGetObject = arrayGetObject;
                    var namedGetProperty = 0;
                    if (namedGetKey === arrayLengthKey) {
                        var namedGetObjectType = recordType(
                            heapBase, namedGetObject);
                        if (namedGetObjectType === HEAP_TYPE_ARRAY) {
                            var namedGetVector = arrayElements(
                                heapBase, namedGetObject);
                            store32(arrayGetTarget, VALUE_TAG_INT32);
                            store32(arrayGetTarget + VALUE_CELL_LOW,
                                vectorLength(heapBase, namedGetVector));
                            store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                            store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                            namedGetProperty = PROPERTY_FOUND_SENTINEL;
                            namedGetObject = 0;
                        } else if (namedGetObjectType ===
                                   HEAP_TYPE_BUFFER_VIEW) {
                            store32(arrayGetTarget, VALUE_TAG_INT32);
                            store32(arrayGetTarget + VALUE_CELL_LOW,
                                bufferViewLength(heapBase, namedGetObject));
                            store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                            store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                            namedGetProperty = PROPERTY_FOUND_SENTINEL;
                            namedGetObject = 0;
                        }
                    }
                    if (namedGetObject !== 0) {
                        if (recordType(heapBase, namedGetObject) ===
                            HEAP_TYPE_STRING) {
                            var dynamicStringPrototypeCell = heapBase +
                                stringSupport + VECTOR_CELLS +
                                RUNTIME_SUPPORT_STRING_PROTOTYPE *
                                VALUE_CELL_BYTES;
                            namedGetObject = load32(
                                dynamicStringPrototypeCell + VALUE_CELL_LOW);
                        }
                    }
                    while (namedGetObject !== 0) {
                        var namedGetType = recordType(
                            heapBase, namedGetObject);
                        var namedGetHead = 0;
                        var namedGetPrototype = 0;
                        if (namedGetType >= HEAP_TYPE_OBJECT) {
                            if (namedGetType <= HEAP_TYPE_BYTECODE_FUNCTION) {
                                namedGetHead = objectPropertyHead(
                                    heapBase, namedGetObject);
                                namedGetPrototype = objectPrototype(
                                    heapBase, namedGetObject);
                            }
                        }
                        if (namedGetType === HEAP_TYPE_REGEXP) {
                            namedGetHead = regexpPropertyHead(
                                heapBase, namedGetObject);
                            namedGetPrototype = regexpPrototype(
                                heapBase, namedGetObject);
                        } else if (namedGetType === HEAP_TYPE_BUFFER_VIEW) {
                            namedGetHead = bufferViewPropertyHead(
                                heapBase, namedGetObject);
                            namedGetPrototype = bufferViewPrototype(
                                heapBase, namedGetObject);
                        }
                        if (namedGetHead === 0) {
                            if (namedGetPrototype === 0) namedGetObject = 0;
                            else namedGetObject = namedGetPrototype;
                        } else {
                            while (namedGetHead !== 0) {
                                var namedGetStoredKey = propertyKey(
                                    heapBase, namedGetHead);
                                var namedGetKeyMatches = 0;
                                if (namedGetStoredKey === namedGetKey) {
                                    namedGetKeyMatches = 1;
                                } else if (stringLength(heapBase,
                                    namedGetStoredKey) === stringLength(
                                    heapBase, namedGetKey)) {
                                    namedGetKeyMatches = 1;
                                    var namedGetCharacterIndex = 0;
                                    var namedGetCharacterLength = stringLength(
                                        heapBase, namedGetKey);
                                    while (namedGetCharacterIndex <
                                           namedGetCharacterLength) {
                                        if ((stringCharacterCodeUnit(heapBase,
                                            namedGetStoredKey,
                                            namedGetCharacterIndex) & 65535) !==
                                            (stringCharacterCodeUnit(heapBase,
                                            namedGetKey,
                                            namedGetCharacterIndex) & 65535)) {
                                            namedGetKeyMatches = 0;
                                            namedGetCharacterIndex =
                                                namedGetCharacterLength;
                                        } else namedGetCharacterIndex =
                                            namedGetCharacterIndex + 1;
                                    }
                                }
                                if (namedGetKeyMatches === 1) {
                                    namedGetProperty = namedGetHead;
                                    namedGetHead = 0;
                                    namedGetObject = 0;
                                } else {
                                    namedGetHead = propertyNext(
                                        heapBase, namedGetHead);
                                }
                            }
                            if (namedGetObject !== 0) {
                                namedGetObject = namedGetPrototype;
                            }
                        }
                    }
                    if (namedGetProperty === 0) {
                        if (arrayGetOriginalObjectType === HEAP_TYPE_OBJECT) {
                            store32(arrayGetTarget, VALUE_TAG_UNDEFINED);
                            store32(arrayGetTarget + VALUE_CELL_LOW, 0);
                            store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                            store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                            namedGetProperty = PROPERTY_FOUND_SENTINEL;
                        } else if (arrayGetOriginalObjectType ===
                                   HEAP_TYPE_ARRAY) {
                            store32(arrayGetTarget, VALUE_TAG_UNDEFINED);
                            store32(arrayGetTarget + VALUE_CELL_LOW, 0);
                            store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                            store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                            namedGetProperty = PROPERTY_FOUND_SENTINEL;
                        } else arrayGetSupported = 0;
                    } else if (namedGetProperty !== PROPERTY_FOUND_SENTINEL) {
                        var namedGetSource = heapBase + namedGetProperty +
                            PROPERTY_VALUE;
                        store32(arrayGetTarget, load32(namedGetSource));
                        store32(arrayGetTarget + VALUE_CELL_LOW,
                            load32(namedGetSource + VALUE_CELL_LOW));
                        store32(arrayGetTarget + VALUE_CELL_HIGH,
                            load32(namedGetSource + VALUE_CELL_HIGH));
                        store32(arrayGetTarget + VALUE_CELL_AUX,
                            load32(namedGetSource + VALUE_CELL_AUX));
                    }
                    if (arrayGetSupported === 3) arrayGetSupported = 4;
                }
                if (arrayGetSupported === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                if (arrayGetSupported === 4) {
                    /* Named lookup already populated the target cell. */
                } else if (arrayGetSupported === 2) {
                    var indexedBufferLength = bufferViewLength(
                        heapBase, arrayGetObject);
                    if (arrayGetIndex >= indexedBufferLength) {
                        store32(arrayGetTarget, VALUE_TAG_UNDEFINED);
                        store32(arrayGetTarget + VALUE_CELL_LOW, 0);
                        store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                        store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                    } else {
                        var indexedBufferBacking = bufferViewBacking(
                            heapBase, arrayGetObject);
                        var indexedBufferPointer = bufferBackingPointer(
                            heapBase, indexedBufferBacking);
                        if (indexedBufferPointer === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        store32(arrayGetTarget, VALUE_TAG_INT32);
                        store32(arrayGetTarget + VALUE_CELL_LOW, loadRaw8(
                            indexedBufferPointer + bufferViewOffset(
                                heapBase, arrayGetObject) + arrayGetIndex));
                        store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                        store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                    }
                } else {
                var arrayGetVector = arrayElements(heapBase, arrayGetObject);
                var arrayGetLength = vectorLength(heapBase, arrayGetVector);
                if (arrayGetIndex >= arrayGetLength) {
                    store32(arrayGetTarget, VALUE_TAG_UNDEFINED);
                    store32(arrayGetTarget + VALUE_CELL_LOW, 0);
                    store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                    store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                } else {
                    var arrayGetSource = heapBase + arrayGetVector +
                        VECTOR_CELLS + arrayGetIndex * VALUE_CELL_BYTES;
                    var arrayGetTag = load32(arrayGetSource);
                    if (arrayGetTag === 0) {
                        store32(arrayGetTarget, VALUE_TAG_UNDEFINED);
                        store32(arrayGetTarget + VALUE_CELL_LOW, 0);
                        store32(arrayGetTarget + VALUE_CELL_HIGH, 0);
                        store32(arrayGetTarget + VALUE_CELL_AUX, 0);
                    } else {
                        store32(arrayGetTarget, arrayGetTag);
                        store32(arrayGetTarget + VALUE_CELL_LOW,
                                load32(arrayGetSource + VALUE_CELL_LOW));
                        store32(arrayGetTarget + VALUE_CELL_HIGH,
                                load32(arrayGetSource + VALUE_CELL_HIGH));
                        store32(arrayGetTarget + VALUE_CELL_AUX,
                                load32(arrayGetSource + VALUE_CELL_AUX));
                    }
                }
                }
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else if (opcode === OP_SET_PROPERTY) {
                var arraySetObjectIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var arraySetKeyIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var arraySetSourceIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var arraySetObjectCell = heapBase + registerCells +
                    arraySetObjectIndex * VALUE_CELL_BYTES;
                var arraySetKeyCell = heapBase + registerCells +
                    arraySetKeyIndex * VALUE_CELL_BYTES;
                var arraySetSupported = 1;
                if (load32(arraySetObjectCell) !== VALUE_TAG_REFERENCE) {
                    arraySetSupported = 0;
                }
                var arraySetKeyTag = load32(arraySetKeyCell);
                var arraySetIndex = 0;
                if (arraySetKeyTag === VALUE_TAG_INT32) {
                    arraySetIndex = load32(arraySetKeyCell + VALUE_CELL_LOW);
                } else if (arraySetKeyTag === VALUE_TAG_DOUBLE) {
                    arraySetIndex = toInt32F64(loadNumberF64(
                        arraySetKeyCell + VALUE_CELL_LOW, arraySetKeyTag));
                    store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                            arraySetIndex);
                    if (equalF64(loadNumberF64(
                            arraySetKeyCell + VALUE_CELL_LOW, arraySetKeyTag),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_LEFT)) === 0) {
                        arraySetSupported = 0;
                    }
                } else arraySetSupported = 0;
                var arraySetObject = load32(
                    arraySetObjectCell + VALUE_CELL_LOW);
                if (arraySetSupported === 1) {
                    var arraySetObjectType = recordType(
                        heapBase, arraySetObject);
                    if (arraySetObjectType === HEAP_TYPE_BUFFER_VIEW) {
                        arraySetSupported = 2;
                    } else if (arraySetObjectType !== HEAP_TYPE_ARRAY) {
                        arraySetSupported = 0;
                    }
                }
                if (arraySetIndex < 0) arraySetSupported = 0;
                var arraySetVector = 0;
                if (arraySetSupported === 1) {
                    arraySetVector = arrayElements(heapBase, arraySetObject);
                    var arraySetCapacity = vectorCapacity(
                        heapBase, arraySetVector);
                    if (arraySetIndex >= arraySetCapacity) {
                        var grownArrayCapacity = arraySetCapacity;
                        if (grownArrayCapacity === 0) {
                            grownArrayCapacity = INITIAL_ARRAY_CAPACITY;
                        }
                        while (grownArrayCapacity <= arraySetIndex) {
                            grownArrayCapacity = grownArrayCapacity * 2;
                        }
                        var grownVectorBytes = VECTOR_CELLS +
                            grownArrayCapacity * VALUE_CELL_BYTES;
                        var grownVector = engineHeapBump(heapBase, state);
                        if (grownVector + grownVectorBytes >
                            engineHeapLimit(heapBase, state)) {
                            arraySetSupported = 0;
                        } else {
                            setRecordType(heapBase, grownVector,
                                          HEAP_TYPE_VALUE_VECTOR);
                            setRecordSize(heapBase, grownVector,
                                          grownVectorBytes);
                            setRecordMark(heapBase, grownVector, 0);
                            setRecordFlags(heapBase, grownVector, 0);
                            var grownArrayLength = vectorLength(
                                heapBase, arraySetVector);
                            setVectorLength(heapBase, grownVector,
                                            grownArrayLength);
                            setVectorCapacity(heapBase, grownVector,
                                              grownArrayCapacity);
                            var grownCellIndex = 0;
                            while (grownCellIndex < grownArrayLength) {
                                var oldArrayCell = heapBase + arraySetVector +
                                    VECTOR_CELLS +
                                    grownCellIndex * VALUE_CELL_BYTES;
                                var newArrayCell = heapBase + grownVector +
                                    VECTOR_CELLS +
                                    grownCellIndex * VALUE_CELL_BYTES;
                                store32(newArrayCell, load32(oldArrayCell));
                                store32(newArrayCell + VALUE_CELL_LOW,
                                    load32(oldArrayCell + VALUE_CELL_LOW));
                                store32(newArrayCell + VALUE_CELL_HIGH,
                                    load32(oldArrayCell + VALUE_CELL_HIGH));
                                store32(newArrayCell + VALUE_CELL_AUX,
                                    load32(oldArrayCell + VALUE_CELL_AUX));
                                grownCellIndex = grownCellIndex + 1;
                            }
                            setArrayElements(heapBase, arraySetObject,
                                             grownVector);
                            setEngineHeapBump(heapBase, state,
                                              grownVector + grownVectorBytes);
                            arraySetVector = grownVector;
                        }
                    }
                }
                var arraySetSource = heapBase + registerCells +
                    arraySetSourceIndex * VALUE_CELL_BYTES;
                if (arraySetSupported === 1) {
                    var arraySetDestination = heapBase + arraySetVector +
                        VECTOR_CELLS + arraySetIndex * VALUE_CELL_BYTES;
                    store32(arraySetDestination, load32(arraySetSource));
                    store32(arraySetDestination + VALUE_CELL_LOW,
                            load32(arraySetSource + VALUE_CELL_LOW));
                    store32(arraySetDestination + VALUE_CELL_HIGH,
                            load32(arraySetSource + VALUE_CELL_HIGH));
                    store32(arraySetDestination + VALUE_CELL_AUX,
                            load32(arraySetSource + VALUE_CELL_AUX));
                    var arraySetLength = vectorLength(heapBase, arraySetVector);
                    if (arraySetIndex >= arraySetLength) {
                        setVectorLength(heapBase, arraySetVector,
                                        arraySetIndex + 1);
                    }
                } else if (arraySetSupported === 2) {
                    var indexedSetBufferLength = bufferViewLength(
                        heapBase, arraySetObject);
                    var indexedSetBufferValid = 1;
                    if (arraySetIndex >= indexedSetBufferLength) {
                        /* Node silently ignores an indexed write outside the
                         * Buffer view. */
                        indexedSetBufferValid = 2;
                    }
                    var indexedSetBufferBacking = bufferViewBacking(
                        heapBase, arraySetObject);
                    var indexedSetBufferPointer = bufferBackingPointer(
                        heapBase, indexedSetBufferBacking);
                    if (indexedSetBufferPointer === 0) {
                        indexedSetBufferValid = 0;
                    }
                    var indexedSetBufferTag = load32(arraySetSource);
                    if (indexedSetBufferTag !== VALUE_TAG_INT32) {
                        if (indexedSetBufferTag !== VALUE_TAG_DOUBLE) {
                            indexedSetBufferValid = 0;
                        }
                    }
                    if (indexedSetBufferValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    if (indexedSetBufferValid === 1) {
                        storeRaw8(indexedSetBufferPointer + bufferViewOffset(
                            heapBase, arraySetObject) + arraySetIndex,
                            toInt32F64(loadNumberF64(
                                arraySetSource + VALUE_CELL_LOW,
                                indexedSetBufferTag)));
                    }
                } else {
                    var dynamicPropertyValid = 1;
                    if (load32(arraySetObjectCell) !== VALUE_TAG_REFERENCE) {
                        dynamicPropertyValid = 0;
                    }
                    if (arraySetKeyTag !== VALUE_TAG_REFERENCE) {
                        dynamicPropertyValid = 0;
                    }
                    var dynamicPropertyKey = load32(
                        arraySetKeyCell + VALUE_CELL_LOW);
                    if (dynamicPropertyValid === 1) {
                        if (recordType(heapBase, dynamicPropertyKey) !==
                            HEAP_TYPE_STRING) dynamicPropertyValid = 0;
                    }
                    var dynamicPropertyObjectType = 0;
                    if (dynamicPropertyValid === 1) {
                        dynamicPropertyObjectType = recordType(
                            heapBase, arraySetObject);
                    }
                    var dynamicPropertyHead = 0;
                    var dynamicPropertyHeadOffset = 0;
                    if (dynamicPropertyObjectType >= HEAP_TYPE_OBJECT) {
                        if (dynamicPropertyObjectType <=
                            HEAP_TYPE_BYTECODE_FUNCTION) {
                            dynamicPropertyHead = objectPropertyHead(
                                heapBase, arraySetObject);
                            dynamicPropertyHeadOffset = OBJECT_PROPERTY_HEAD;
                        }
                    }
                    if (dynamicPropertyObjectType === HEAP_TYPE_REGEXP) {
                        dynamicPropertyHead = regexpPropertyHead(
                            heapBase, arraySetObject);
                        dynamicPropertyHeadOffset = REGEXP_PROPERTY_HEAD;
                    } else if (dynamicPropertyObjectType ===
                               HEAP_TYPE_BUFFER_VIEW) {
                        dynamicPropertyHead = bufferViewPropertyHead(
                            heapBase, arraySetObject);
                        dynamicPropertyHeadOffset = BUFFER_VIEW_PROPERTY_HEAD;
                    }
                    if (dynamicPropertyHeadOffset === 0) {
                        dynamicPropertyValid = 0;
                    }
                    if (dynamicPropertyValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var dynamicPropertyFirst = dynamicPropertyHead;
                    var dynamicPropertyRecord = 0;
                    while (dynamicPropertyHead !== 0) {
                        var dynamicStoredKey = propertyKey(
                            heapBase, dynamicPropertyHead);
                        var dynamicKeyMatches = 0;
                        if (dynamicStoredKey === dynamicPropertyKey) {
                            dynamicKeyMatches = 1;
                        } else if (stringLength(heapBase,
                            dynamicStoredKey) === stringLength(heapBase,
                            dynamicPropertyKey)) {
                            dynamicKeyMatches = 1;
                            var dynamicKeyIndex = 0;
                            var dynamicKeyLength = stringLength(
                                heapBase, dynamicPropertyKey);
                            while (dynamicKeyIndex < dynamicKeyLength) {
                                if ((stringCharacterCodeUnit(heapBase,
                                    dynamicStoredKey, dynamicKeyIndex) &
                                    65535) !== (stringCharacterCodeUnit(
                                    heapBase, dynamicPropertyKey,
                                    dynamicKeyIndex) & 65535)) {
                                    dynamicKeyMatches = 0;
                                    dynamicKeyIndex = dynamicKeyLength;
                                } else dynamicKeyIndex = dynamicKeyIndex + 1;
                            }
                        }
                        if (dynamicKeyMatches === 1) {
                            dynamicPropertyRecord = dynamicPropertyHead;
                            dynamicPropertyHead = 0;
                        } else {
                            dynamicPropertyHead = propertyNext(
                                heapBase, dynamicPropertyHead);
                        }
                    }
                    if (dynamicPropertyRecord === 0) {
                        dynamicPropertyRecord = engineHeapBump(heapBase, state);
                        if (dynamicPropertyRecord + PROPERTY_RECORD_BYTES >
                            engineHeapLimit(heapBase, state)) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        setRecordType(heapBase, dynamicPropertyRecord,
                                      HEAP_TYPE_PROPERTY);
                        setRecordSize(heapBase, dynamicPropertyRecord,
                                      PROPERTY_RECORD_BYTES);
                        setRecordMark(heapBase, dynamicPropertyRecord, 0);
                        setRecordFlags(heapBase, dynamicPropertyRecord, 0);
                        setPropertyNext(heapBase, dynamicPropertyRecord,
                                        dynamicPropertyFirst);
                        setPropertyKey(heapBase, dynamicPropertyRecord,
                                       dynamicPropertyKey);
                        setPropertyAttributes(heapBase, dynamicPropertyRecord,
                                              DEFAULT_PROPERTY_ATTRIBUTES);
                        setPropertyReserved(heapBase, dynamicPropertyRecord, 0);
                        if (dynamicPropertyObjectType === HEAP_TYPE_REGEXP) {
                            setRegexpPropertyHead(heapBase, arraySetObject,
                                                  dynamicPropertyRecord);
                        } else if (dynamicPropertyObjectType ===
                                   HEAP_TYPE_BUFFER_VIEW) {
                            setBufferViewPropertyHead(heapBase, arraySetObject,
                                                      dynamicPropertyRecord);
                        } else {
                            setObjectPropertyHead(heapBase, arraySetObject,
                                                  dynamicPropertyRecord);
                        }
                        setEngineHeapBump(heapBase, state,
                                          dynamicPropertyRecord +
                                          PROPERTY_RECORD_BYTES);
                    }
                    var dynamicPropertyDestination = heapBase +
                        dynamicPropertyRecord + PROPERTY_VALUE;
                    store32(dynamicPropertyDestination, load32(arraySetSource));
                    store32(dynamicPropertyDestination + VALUE_CELL_LOW,
                            load32(arraySetSource + VALUE_CELL_LOW));
                    store32(dynamicPropertyDestination + VALUE_CELL_HIGH,
                            load32(arraySetSource + VALUE_CELL_HIGH));
                    store32(dynamicPropertyDestination + VALUE_CELL_AUX,
                            load32(arraySetSource + VALUE_CELL_AUX));
                }
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else if (opcode === OP_REMAINDER) {
                var remainderTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var remainderLeftIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var remainderRightIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var remainderLeft = heapBase + registerCells +
                    remainderLeftIndex * VALUE_CELL_BYTES;
                var remainderRight = heapBase + registerCells +
                    remainderRightIndex * VALUE_CELL_BYTES;
                var remainderSupported = 1;
                var remainderLeftTag = load32(remainderLeft);
                var remainderRightTag = load32(remainderRight);
                var remainderLeftValue = 0;
                var remainderRightValue = 0;
                if (remainderLeftTag === VALUE_TAG_INT32) {
                    remainderLeftValue = load32(
                        remainderLeft + VALUE_CELL_LOW);
                } else if (remainderLeftTag === VALUE_TAG_DOUBLE) {
                    remainderLeftValue = toInt32F64(loadNumberF64(
                        remainderLeft + VALUE_CELL_LOW, remainderLeftTag));
                    store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                            remainderLeftValue);
                    if (equalF64(loadNumberF64(
                            remainderLeft + VALUE_CELL_LOW, remainderLeftTag),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_LEFT)) === 0) {
                        remainderSupported = 0;
                    }
                } else remainderSupported = 0;
                if (remainderRightTag === VALUE_TAG_INT32) {
                    remainderRightValue = load32(
                        remainderRight + VALUE_CELL_LOW);
                } else if (remainderRightTag === VALUE_TAG_DOUBLE) {
                    remainderRightValue = toInt32F64(loadNumberF64(
                        remainderRight + VALUE_CELL_LOW, remainderRightTag));
                    store32(heapBase + state + ENGINE_SCRATCH_RIGHT,
                            remainderRightValue);
                    if (equalF64(loadNumberF64(
                            remainderRight + VALUE_CELL_LOW, remainderRightTag),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_RIGHT)) === 0) {
                        remainderSupported = 0;
                    }
                } else remainderSupported = 0;
                if (remainderRightValue === 0) remainderSupported = 0;
                if (remainderLeftValue === MINIMUM_INT32) {
                    if (remainderRightValue === -1) remainderSupported = 0;
                }
                if (remainderLeftValue < 0) {
                    if (remainderRightValue !== 0) {
                        if (remainderLeftValue % remainderRightValue === 0) {
                            remainderSupported = 0;
                        }
                    }
                }
                if (remainderSupported === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS,
                            instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var remainderTarget = heapBase + registerCells +
                    remainderTargetIndex * VALUE_CELL_BYTES;
                store32(remainderTarget, VALUE_TAG_INT32);
                store32(remainderTarget + VALUE_CELL_LOW,
                        remainderLeftValue % remainderRightValue);
                store32(remainderTarget + VALUE_CELL_HIGH, 0);
                store32(remainderTarget + VALUE_CELL_AUX, 0);
                pc = pc + FOUR_WORD_INSTRUCTION;
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
                    var stringConcatenation = 0;
                    if (opcode === OP_ADD) {
                        if (arithmeticLeftTag === VALUE_TAG_REFERENCE) {
                            if (arithmeticRightTag === VALUE_TAG_REFERENCE) {
                                var concatenationLeft = load32(
                                    arithmeticLeft + VALUE_CELL_LOW);
                                var concatenationRight = load32(
                                    arithmeticRight + VALUE_CELL_LOW);
                                if (recordType(heapBase, concatenationLeft) ===
                                    HEAP_TYPE_STRING) {
                                    if (recordType(heapBase,
                                        concatenationRight) ===
                                        HEAP_TYPE_STRING) {
                                        stringConcatenation = 1;
                                    }
                                }
                            }
                        }
                    }
                    if (stringConcatenation === 1) {
                        var concatenationLeftLength = stringLength(
                            heapBase, concatenationLeft);
                        var concatenationRightLength = stringLength(
                            heapBase, concatenationRight);
                        var concatenationLength = concatenationLeftLength +
                                                  concatenationRightLength;
                        var concatenationValid = 1;
                        if (concatenationLength < concatenationLeftLength) {
                            concatenationValid = 0;
                        }
                        var concatenationBytes =
                            (STRING_CHARS + concatenationLength * 2 + 7) & -8;
                        var concatenationAddress = engineHeapBump(
                            heapBase, state);
                        if (concatenationBytes < STRING_CHARS) {
                            concatenationValid = 0;
                        }
                        if (concatenationAddress + concatenationBytes >
                            engineHeapLimit(heapBase, state)) {
                            concatenationValid = 0;
                        }
                        if (concatenationValid === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        setRecordType(heapBase, concatenationAddress,
                                      HEAP_TYPE_STRING);
                        setRecordSize(heapBase, concatenationAddress,
                                      concatenationBytes);
                        setRecordMark(heapBase, concatenationAddress, 0);
                        setRecordFlags(heapBase, concatenationAddress, 0);
                        setStringLength(heapBase, concatenationAddress,
                                        concatenationLength);
                        var concatenationHash = -2128831035;
                        var concatenationIndex = 0;
                        while (concatenationIndex < concatenationLength) {
                            var concatenationCode = 0;
                            if (concatenationIndex < concatenationLeftLength) {
                                concatenationCode = stringCharacterCodeUnit(
                                    heapBase, concatenationLeft,
                                    concatenationIndex) & 65535;
                            } else {
                                concatenationCode = stringCharacterCodeUnit(
                                    heapBase, concatenationRight,
                                    concatenationIndex -
                                    concatenationLeftLength) & 65535;
                            }
                            setStringCharacterByte(heapBase,
                                concatenationAddress, concatenationIndex * 2,
                                concatenationCode & 255);
                            setStringCharacterByte(heapBase,
                                concatenationAddress,
                                concatenationIndex * 2 + 1,
                                (concatenationCode >>> 8) & 255);
                            concatenationHash = (concatenationHash ^
                                concatenationCode) * 16777619;
                            concatenationIndex = concatenationIndex + 1;
                        }
                        setStringHash(heapBase, concatenationAddress,
                                      concatenationHash);
                        store32(arithmeticTarget, VALUE_TAG_REFERENCE);
                        store32(arithmeticTarget + VALUE_CELL_LOW,
                                concatenationAddress);
                        store32(arithmeticTarget + VALUE_CELL_HIGH, 0);
                        store32(arithmeticTarget + VALUE_CELL_AUX, 0);
                        setEngineHeapBump(heapBase, state,
                            concatenationAddress + concatenationBytes);
                    } else {
                    if (arithmeticLeftTag !== VALUE_TAG_INT32) {
                        if (arithmeticLeftTag !== VALUE_TAG_DOUBLE) {
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
                    if (arithmeticRightTag !== VALUE_TAG_INT32) {
                        if (arithmeticRightTag !== VALUE_TAG_DOUBLE) {
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
                    var comparisonValue = 0;
                    if (opcode === OP_STRICT_EQUAL) {
                        comparisonValid = 1;
                        if (comparisonLeftTag === VALUE_TAG_INT32) {
                            if (comparisonRightTag === VALUE_TAG_INT32) {
                                comparisonValue = equalF64(loadNumberF64(
                                    comparisonLeft + VALUE_CELL_LOW,
                                    comparisonLeftTag), loadNumberF64(
                                    comparisonRight + VALUE_CELL_LOW,
                                    comparisonRightTag));
                            } else if (comparisonRightTag === VALUE_TAG_DOUBLE) {
                                comparisonValue = equalF64(loadNumberF64(
                                    comparisonLeft + VALUE_CELL_LOW,
                                    comparisonLeftTag), loadNumberF64(
                                    comparisonRight + VALUE_CELL_LOW,
                                    comparisonRightTag));
                            }
                        } else if (comparisonLeftTag === VALUE_TAG_DOUBLE) {
                            if (comparisonRightTag === VALUE_TAG_INT32) {
                                comparisonValue = equalF64(loadNumberF64(
                                    comparisonLeft + VALUE_CELL_LOW,
                                    comparisonLeftTag), loadNumberF64(
                                    comparisonRight + VALUE_CELL_LOW,
                                    comparisonRightTag));
                            } else if (comparisonRightTag === VALUE_TAG_DOUBLE) {
                                comparisonValue = equalF64(loadNumberF64(
                                    comparisonLeft + VALUE_CELL_LOW,
                                    comparisonLeftTag), loadNumberF64(
                                    comparisonRight + VALUE_CELL_LOW,
                                    comparisonRightTag));
                            }
                        } else if (comparisonLeftTag === comparisonRightTag) {
                            if (comparisonLeftTag === VALUE_TAG_REFERENCE) {
                                var strictLeftReference = load32(
                                    comparisonLeft + VALUE_CELL_LOW);
                                var strictRightReference = load32(
                                    comparisonRight + VALUE_CELL_LOW);
                                if (strictLeftReference ===
                                    strictRightReference) {
                                    comparisonValue = 1;
                                } else if (recordType(heapBase,
                                    strictLeftReference) === HEAP_TYPE_STRING) {
                                    if (recordType(heapBase,
                                        strictRightReference) ===
                                        HEAP_TYPE_STRING) {
                                        var strictStringLength = stringLength(
                                            heapBase, strictLeftReference);
                                        if (strictStringLength === stringLength(
                                            heapBase, strictRightReference)) {
                                            comparisonValue = 1;
                                            var strictStringIndex = 0;
                                            while (strictStringIndex <
                                                   strictStringLength) {
                                                if ((stringCharacterCodeUnit(
                                                    heapBase,
                                                    strictLeftReference,
                                                    strictStringIndex) &
                                                    65535) !==
                                                    (stringCharacterCodeUnit(
                                                    heapBase,
                                                    strictRightReference,
                                                    strictStringIndex) &
                                                    65535)) {
                                                    comparisonValue = 0;
                                                    strictStringIndex =
                                                        strictStringLength;
                                                } else strictStringIndex =
                                                    strictStringIndex + 1;
                                            }
                                        }
                                    }
                                }
                            } else comparisonValue = 1;
                        }
                    } else {
                        if (comparisonLeftTag === VALUE_TAG_INT32) comparisonValid = 1;
                        else if (comparisonLeftTag === VALUE_TAG_DOUBLE) comparisonValid = 1;
                        if (comparisonRightTag !== VALUE_TAG_INT32) {
                            if (comparisonRightTag !== VALUE_TAG_DOUBLE) {
                                comparisonValid = 0;
                            }
                        }
                    }
                    if (comparisonValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    if (opcode === OP_STRICT_EQUAL) {
                        /* Strict equality was completed above for all tags. */
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
                    var comparisonNextPC = pc + FOUR_WORD_INSTRUCTION;
                    var comparisonNextOpcode = load32(
                        heapBase + bytecodeWords +
                        comparisonNextPC * WORD_BYTES);
                    if (budget > 1) {
                        if (comparisonNextOpcode === OP_JUMP_IF_FALSE) {
                            var comparisonConditionIndex = load32(
                                heapBase + bytecodeWords +
                                (comparisonNextPC + FIRST_OPERAND) * WORD_BYTES);
                            if (comparisonConditionIndex === comparisonTargetIndex) {
                                if (comparisonValue === 0) {
                                    pc = load32(heapBase + bytecodeWords +
                                        (comparisonNextPC + SECOND_OPERAND) *
                                        WORD_BYTES);
                                } else {
                                    pc = comparisonNextPC +
                                         THREE_WORD_INSTRUCTION;
                                }
                                budget = budget - 1;
                                instructions = instructions + 1;
                            } else pc = comparisonNextPC;
                        } else pc = comparisonNextPC;
                    } else pc = comparisonNextPC;
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
                else if (notTag === VALUE_TAG_TRUE) notValue = 0;
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
                    if (recordType(heapBase, notReference) === HEAP_TYPE_STRING) {
                        if (stringLength(heapBase, notReference) === 0) {
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
            } else if (opcode === OP_CALL) {
                store32(heapBase + state + ENGINE_CALL_REJECT_REASON,
                        CALL_REJECT_NONE);
                var callTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var callFunctionIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var callArgumentsIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FOUR_WORD_INSTRUCTION) * WORD_BYTES);
                var callFunctionCell = heapBase + registerCells +
                    callFunctionIndex * VALUE_CELL_BYTES;
                var callArgumentsCell = heapBase + constantCells +
                    callArgumentsIndex * VALUE_CELL_BYTES;
                var bytecodeCallHandled = 0;
                if (load32(callFunctionCell) === VALUE_TAG_REFERENCE) {
                    var bytecodeCallable = load32(
                        callFunctionCell + VALUE_CELL_LOW);
                    if (load32(heapBase + bytecodeCallable) ===
                        HEAP_TYPE_BYTECODE_FUNCTION) {
                        var bytecodeCallValid = 1;
                        if (load32(callArgumentsCell) !== VALUE_TAG_REFERENCE) {
                            bytecodeCallValid = 0;
                            store32(heapBase + state +
                                ENGINE_CALL_REJECT_REASON,
                                CALL_REJECT_ARGUMENT_LIST);
                        }
                        var bytecodeArgumentRegisters = load32(
                            callArgumentsCell + VALUE_CELL_LOW);
                        if (bytecodeCallValid === 1) {
                            if (load32(heapBase + bytecodeArgumentRegisters) !==
                                HEAP_TYPE_ARRAY) {
                                bytecodeCallValid = 0;
                                store32(heapBase + state +
                                    ENGINE_CALL_REJECT_REASON,
                                    CALL_REJECT_ARGUMENT_LIST);
                            }
                        }
                        var bytecodeArgumentVector = 0;
                        var bytecodeArgumentCount = 0;
                        if (bytecodeCallValid === 1) {
                            bytecodeArgumentVector = load32(
                                heapBase + bytecodeArgumentRegisters +
                                ARRAY_ELEMENTS);
                            bytecodeArgumentCount = load32(
                                heapBase + bytecodeArgumentVector + VECTOR_LENGTH);
                        }
                        var calleeProgram = functionMetadata(
                            heapBase, bytecodeCallable);
                        var calleeBindingRegisters = programBindingRegisters(
                            heapBase, calleeProgram);
                        var argumentCheckIndex = 0;
                        while (argumentCheckIndex < bytecodeArgumentCount) {
                            var argumentRegisterCell = heapBase +
                                bytecodeArgumentVector + VECTOR_CELLS +
                                argumentCheckIndex * VALUE_CELL_BYTES;
                            if (load32(argumentRegisterCell) !== VALUE_TAG_INT32) {
                                bytecodeCallValid = 0;
                                store32(heapBase + state +
                                    ENGINE_CALL_REJECT_REASON,
                                    CALL_REJECT_ARGUMENT_REGISTER);
                            }
                            argumentCheckIndex = argumentCheckIndex + 1;
                        }
                        var calleeRegisterCount = programRegisterCount(
                            heapBase, calleeProgram);
                        var calleeFrameBytes = FRAME_FIXED_BYTES +
                            calleeRegisterCount * VALUE_CELL_BYTES;
                        var calleeFrame = 0;
                        var calleeFrameReused = 0;
                        var bytecodeAllocationEnd = load32(
                            heapBase + state + ENGINE_HEAP_BUMP);
                        if (bytecodeCallValid === 1) {
                        var reusableFrame = load32(
                            heapBase + state + ENGINE_FREE_FRAME);
                        var reusableFramePrevious = 0;
                        while (reusableFrame > 0) {
                            var reusableFrameNext = load32(
                                heapBase + reusableFrame + FRAME_PROGRAM);
                            if (load32(heapBase + reusableFrame + RECORD_SIZE) >=
                                calleeFrameBytes) {
                                calleeFrame = reusableFrame;
                                calleeFrameReused = 1;
                                if (reusableFramePrevious === 0) {
                                    store32(heapBase + state + ENGINE_FREE_FRAME,
                                            reusableFrameNext);
                                } else {
                                    store32(heapBase + reusableFramePrevious +
                                            FRAME_PROGRAM, reusableFrameNext);
                                }
                                reusableFrame = -1;
                            } else {
                                reusableFramePrevious = reusableFrame;
                                reusableFrame = reusableFrameNext;
                            }
                        }
                        if (calleeFrame === 0) {
                            calleeFrame = bytecodeAllocationEnd;
                            bytecodeAllocationEnd = bytecodeAllocationEnd +
                                                    calleeFrameBytes;
                        }
                        var calleeEnvironment = functionClosure(
                            heapBase, bytecodeCallable);
                        var calleeArgumentsArray = 0;
                        var calleeArgumentsVector = 0;
                        var calleeBindingCount = 0;
                        var calleeNeedsArguments = 0;
                        if ((programFlags(heapBase, calleeProgram) &
                             PROGRAM_FLAG_USES_ARGUMENTS) !== 0) {
                            calleeNeedsArguments = 1;
                        }
                        if (calleeBindingRegisters === 0) {
                            calleeBindingCount = programBindingCount(
                                heapBase, calleeProgram);
                            calleeEnvironment = bytecodeAllocationEnd;
                            bytecodeAllocationEnd = bytecodeAllocationEnd +
                                ENVIRONMENT_FIXED_BYTES +
                                calleeBindingCount * VALUE_CELL_BYTES;
                        }
                        if (calleeNeedsArguments === 1) {
                            calleeArgumentsArray = bytecodeAllocationEnd;
                            bytecodeAllocationEnd = bytecodeAllocationEnd +
                                ARRAY_RECORD_BYTES;
                            calleeArgumentsVector = bytecodeAllocationEnd;
                            bytecodeAllocationEnd = bytecodeAllocationEnd +
                                VECTOR_CELLS + bytecodeArgumentCount *
                                VALUE_CELL_BYTES;
                        }
                        if (bytecodeAllocationEnd > load32(
                                heapBase + state + ENGINE_HEAP_LIMIT)) {
                            bytecodeCallValid = 0;
                            store32(heapBase + state +
                                ENGINE_CALL_REJECT_REASON,
                                CALL_REJECT_HEAP_SPACE);
                        }
                        }
                        if (bytecodeCallValid === 1) {
                            if (calleeBindingRegisters === 0) {
                                setRecordType(heapBase, calleeEnvironment,
                                              HEAP_TYPE_ENVIRONMENT);
                                setRecordSize(heapBase, calleeEnvironment,
                                    ENVIRONMENT_FIXED_BYTES +
                                    calleeBindingCount * VALUE_CELL_BYTES);
                                setRecordMark(heapBase, calleeEnvironment, 0);
                                setRecordFlags(heapBase, calleeEnvironment, 0);
                                setEnvironmentParent(heapBase,
                                    calleeEnvironment,
                                    functionClosure(heapBase,
                                                    bytecodeCallable));
                                setEnvironmentCount(heapBase,
                                    calleeEnvironment, calleeBindingCount);
                                var clearEnvironmentSlot = 0;
                                while (clearEnvironmentSlot <
                                       calleeBindingCount) {
                                    var clearEnvironmentCell = heapBase +
                                        calleeEnvironment + ENVIRONMENT_CELLS +
                                        clearEnvironmentSlot * VALUE_CELL_BYTES;
                                    store32(clearEnvironmentCell,
                                            VALUE_TAG_UNDEFINED);
                                    store32(clearEnvironmentCell + VALUE_CELL_LOW,
                                            0);
                                    store32(clearEnvironmentCell + VALUE_CELL_HIGH,
                                            0);
                                    store32(clearEnvironmentCell + VALUE_CELL_AUX,
                                            0);
                                    clearEnvironmentSlot =
                                        clearEnvironmentSlot + 1;
                                }
                            }
                            if (calleeNeedsArguments === 1) {
                                setRecordType(heapBase, calleeArgumentsArray,
                                              HEAP_TYPE_ARRAY);
                                setRecordSize(heapBase, calleeArgumentsArray,
                                              ARRAY_RECORD_BYTES);
                                setRecordMark(heapBase, calleeArgumentsArray, 0);
                                setRecordFlags(heapBase, calleeArgumentsArray, 0);
                                setArrayPrototype(heapBase,
                                    calleeArgumentsArray, arrayPrototype);
                                setArrayPropertyHead(heapBase,
                                    calleeArgumentsArray, 0);
                                setArrayElements(heapBase, calleeArgumentsArray,
                                                 calleeArgumentsVector);
                                setArrayReserved(heapBase,
                                                 calleeArgumentsArray, 0);
                                setRecordType(heapBase, calleeArgumentsVector,
                                              HEAP_TYPE_VALUE_VECTOR);
                                setRecordSize(heapBase, calleeArgumentsVector,
                                    VECTOR_CELLS + bytecodeArgumentCount *
                                    VALUE_CELL_BYTES);
                                setRecordMark(heapBase, calleeArgumentsVector, 0);
                                setRecordFlags(heapBase,
                                               calleeArgumentsVector, 0);
                                setVectorLength(heapBase,
                                                calleeArgumentsVector,
                                                bytecodeArgumentCount);
                                setVectorCapacity(heapBase,
                                                  calleeArgumentsVector,
                                                  bytecodeArgumentCount);
                                var copyArgumentIndex = 0;
                                while (copyArgumentIndex <
                                       bytecodeArgumentCount) {
                                    var copiedArgumentRegisterCell = heapBase +
                                        bytecodeArgumentVector + VECTOR_CELLS +
                                        copyArgumentIndex * VALUE_CELL_BYTES;
                                    var copiedArgumentRegister = load32(
                                        copiedArgumentRegisterCell +
                                        VALUE_CELL_LOW);
                                    var copiedArgumentSource = heapBase +
                                        registerCells + copiedArgumentRegister *
                                        VALUE_CELL_BYTES;
                                    var copiedArgumentTarget = heapBase +
                                        calleeArgumentsVector + VECTOR_CELLS +
                                        copyArgumentIndex * VALUE_CELL_BYTES;
                                    store32(copiedArgumentTarget,
                                            load32(copiedArgumentSource));
                                    store32(copiedArgumentTarget + VALUE_CELL_LOW,
                                        load32(copiedArgumentSource +
                                               VALUE_CELL_LOW));
                                    store32(copiedArgumentTarget + VALUE_CELL_HIGH,
                                        load32(copiedArgumentSource +
                                               VALUE_CELL_HIGH));
                                    store32(copiedArgumentTarget + VALUE_CELL_AUX,
                                        load32(copiedArgumentSource +
                                               VALUE_CELL_AUX));
                                    copyArgumentIndex = copyArgumentIndex + 1;
                                }
                            }
                            store32(heapBase + calleeFrame + RECORD_TYPE,
                                    HEAP_TYPE_FRAME);
                            if (calleeFrameReused === 0) {
                                store32(heapBase + calleeFrame + RECORD_SIZE,
                                        calleeFrameBytes);
                            }
                            store32(heapBase + calleeFrame + RECORD_MARK, 0);
                            store32(heapBase + calleeFrame + RECORD_FLAGS,
                                    FRAME_FLAG_NATIVE_CALL);
                            store32(heapBase + calleeFrame + FRAME_PROGRAM,
                                    calleeProgram);
                            store32(heapBase + calleeFrame + FRAME_ENVIRONMENT,
                                calleeEnvironment);
                            store32(heapBase + calleeFrame + FRAME_CALLER, frame);
                            store32(heapBase + calleeFrame + FRAME_PC, 0);
                            store32(heapBase + calleeFrame + FRAME_RETURN_SLOT,
                                    callTargetIndex);
                            store32(heapBase + calleeFrame +
                                    FRAME_REGISTER_COUNT, calleeRegisterCount);
                            store32(heapBase + calleeFrame + FRAME_HANDLER, 0);
                            var calleeContext = functionHomeContext(
                                heapBase, bytecodeCallable);
                            if (calleeContext === 0) calleeContext = currentContext;
                            store32(heapBase + calleeFrame + FRAME_CONTEXT,
                                    calleeContext);
                            var clearCalleeRegister = 0;
                            while (clearCalleeRegister < calleeRegisterCount) {
                                var clearCalleeCell = heapBase + calleeFrame +
                                    FRAME_REGISTERS + clearCalleeRegister *
                                    VALUE_CELL_BYTES;
                                store32(clearCalleeCell, VALUE_TAG_UNDEFINED);
                                store32(clearCalleeCell + VALUE_CELL_LOW, 0);
                                store32(clearCalleeCell + VALUE_CELL_HIGH, 0);
                                store32(clearCalleeCell + VALUE_CELL_AUX, 0);
                                clearCalleeRegister = clearCalleeRegister + 1;
                            }
                            var calleeConstants = programConstants(
                                heapBase, calleeProgram);
                            var calleeConstantRegisters =
                                programConstantRegisters(
                                    heapBase, calleeProgram);
                            var calleeConstantCount = load32(
                                heapBase + calleeConstantRegisters + VECTOR_LENGTH);
                            var initializeConstant = 0;
                            while (initializeConstant < calleeConstantCount) {
                                var constantRegisterCell = heapBase +
                                    calleeConstantRegisters + VECTOR_CELLS +
                                    initializeConstant * VALUE_CELL_BYTES;
                                var constantRegister = load32(
                                    constantRegisterCell + VALUE_CELL_LOW);
                                if (constantRegister >= 0) {
                                    var initializedConstantSource = heapBase +
                                        calleeConstants + VECTOR_CELLS +
                                        initializeConstant * VALUE_CELL_BYTES;
                                    var initializedConstantTarget = heapBase +
                                        calleeFrame + FRAME_REGISTERS +
                                        constantRegister * VALUE_CELL_BYTES;
                                    store32(initializedConstantTarget,
                                        load32(initializedConstantSource));
                                    store32(initializedConstantTarget +
                                            VALUE_CELL_LOW,
                                        load32(initializedConstantSource +
                                               VALUE_CELL_LOW));
                                    store32(initializedConstantTarget +
                                            VALUE_CELL_HIGH,
                                        load32(initializedConstantSource +
                                               VALUE_CELL_HIGH));
                                    store32(initializedConstantTarget +
                                            VALUE_CELL_AUX,
                                        load32(initializedConstantSource +
                                               VALUE_CELL_AUX));
                                }
                                initializeConstant = initializeConstant + 1;
                            }
                            var calleeParameterSlots = programParameterSlots(
                                heapBase, calleeProgram);
                            var calleeParameterCount = load32(
                                heapBase + calleeParameterSlots + VECTOR_LENGTH);
                            var initializeParameter = 0;
                            while (initializeParameter < calleeParameterCount) {
                                if (initializeParameter < bytecodeArgumentCount) {
                                    var parameterSlotCell = heapBase +
                                        calleeParameterSlots + VECTOR_CELLS +
                                        initializeParameter * VALUE_CELL_BYTES;
                                    var parameterSlot = load32(
                                        parameterSlotCell + VALUE_CELL_LOW);
                                    var parameterArgumentRegisterCell = heapBase +
                                        bytecodeArgumentVector + VECTOR_CELLS +
                                        initializeParameter * VALUE_CELL_BYTES;
                                    var parameterArgumentRegister = load32(
                                        parameterArgumentRegisterCell +
                                        VALUE_CELL_LOW);
                                    var parameterSource = heapBase + registerCells +
                                        parameterArgumentRegister *
                                        VALUE_CELL_BYTES;
                                    var parameterTarget = 0;
                                    if (calleeBindingRegisters === 0) {
                                        parameterTarget = heapBase +
                                            calleeEnvironment +
                                            ENVIRONMENT_CELLS + parameterSlot *
                                            VALUE_CELL_BYTES;
                                    } else {
                                        var parameterRegisterCell = heapBase +
                                            calleeBindingRegisters + VECTOR_CELLS +
                                            parameterSlot * VALUE_CELL_BYTES;
                                        var parameterRegister = load32(
                                            parameterRegisterCell +
                                            VALUE_CELL_LOW);
                                        parameterTarget = heapBase + calleeFrame +
                                            FRAME_REGISTERS + parameterRegister *
                                            VALUE_CELL_BYTES;
                                    }
                                    store32(parameterTarget, load32(parameterSource));
                                    store32(parameterTarget + VALUE_CELL_LOW,
                                        load32(parameterSource + VALUE_CELL_LOW));
                                    store32(parameterTarget + VALUE_CELL_HIGH,
                                        load32(parameterSource + VALUE_CELL_HIGH));
                                    store32(parameterTarget + VALUE_CELL_AUX,
                                        load32(parameterSource + VALUE_CELL_AUX));
                                }
                                initializeParameter = initializeParameter + 1;
                            }
                            var thisSlot = programThisSlot(
                                heapBase, calleeProgram);
                            var thisTarget = 0;
                            if (calleeBindingRegisters === 0) {
                                if (calleeNeedsArguments === 1) {
                                    var argumentsSlot = programArgumentsSlot(
                                        heapBase, calleeProgram);
                                    var argumentsTarget = heapBase +
                                        calleeEnvironment + ENVIRONMENT_CELLS +
                                        argumentsSlot * VALUE_CELL_BYTES;
                                    store32(argumentsTarget,
                                            VALUE_TAG_REFERENCE);
                                    store32(argumentsTarget + VALUE_CELL_LOW,
                                            calleeArgumentsArray);
                                    store32(argumentsTarget + VALUE_CELL_HIGH,
                                            0);
                                    store32(argumentsTarget + VALUE_CELL_AUX, 0);
                                }
                                thisTarget = heapBase + calleeEnvironment +
                                    ENVIRONMENT_CELLS + thisSlot *
                                    VALUE_CELL_BYTES;
                            } else {
                                if (calleeNeedsArguments === 1) {
                                    var registerArgumentsSlot =
                                        programArgumentsSlot(
                                            heapBase, calleeProgram);
                                    var argumentsRegisterCell = heapBase +
                                        calleeBindingRegisters + VECTOR_CELLS +
                                        registerArgumentsSlot * VALUE_CELL_BYTES;
                                    var argumentsRegister = load32(
                                        argumentsRegisterCell + VALUE_CELL_LOW);
                                    var registerArgumentsTarget = heapBase +
                                        calleeFrame + FRAME_REGISTERS +
                                        argumentsRegister * VALUE_CELL_BYTES;
                                    store32(registerArgumentsTarget,
                                            VALUE_TAG_REFERENCE);
                                    store32(registerArgumentsTarget +
                                            VALUE_CELL_LOW,
                                            calleeArgumentsArray);
                                    store32(registerArgumentsTarget +
                                            VALUE_CELL_HIGH, 0);
                                    store32(registerArgumentsTarget +
                                            VALUE_CELL_AUX, 0);
                                }
                                var thisRegisterCell = heapBase +
                                    calleeBindingRegisters + VECTOR_CELLS +
                                    thisSlot * VALUE_CELL_BYTES;
                                var thisRegister = load32(
                                    thisRegisterCell + VALUE_CELL_LOW);
                                thisTarget = heapBase + calleeFrame +
                                    FRAME_REGISTERS + thisRegister *
                                    VALUE_CELL_BYTES;
                            }
                            var receiverIndex = load32(
                                heapBase + bytecodeWords +
                                (pc + THIRD_OPERAND) * WORD_BYTES);
                            if (receiverIndex >= 0) {
                                var thisSource = heapBase + registerCells +
                                    receiverIndex * VALUE_CELL_BYTES;
                                store32(thisTarget, load32(thisSource));
                                store32(thisTarget + VALUE_CELL_LOW,
                                    load32(thisSource + VALUE_CELL_LOW));
                                store32(thisTarget + VALUE_CELL_HIGH,
                                    load32(thisSource + VALUE_CELL_HIGH));
                                store32(thisTarget + VALUE_CELL_AUX,
                                    load32(thisSource + VALUE_CELL_AUX));
                            }
                            var functionNameSlot = programFunctionNameSlot(
                                heapBase, calleeProgram);
                            if (functionNameSlot >= 0) {
                                var functionNameTarget = 0;
                                if (calleeBindingRegisters === 0) {
                                    functionNameTarget = heapBase +
                                        calleeEnvironment + ENVIRONMENT_CELLS +
                                        functionNameSlot * VALUE_CELL_BYTES;
                                } else {
                                    var functionNameRegisterCell = heapBase +
                                        calleeBindingRegisters + VECTOR_CELLS +
                                        functionNameSlot * VALUE_CELL_BYTES;
                                    var functionNameRegister = load32(
                                        functionNameRegisterCell +
                                        VALUE_CELL_LOW);
                                    functionNameTarget = heapBase + calleeFrame +
                                        FRAME_REGISTERS + functionNameRegister *
                                        VALUE_CELL_BYTES;
                                }
                                store32(functionNameTarget, VALUE_TAG_REFERENCE);
                                store32(functionNameTarget + VALUE_CELL_LOW,
                                        bytecodeCallable);
                                store32(functionNameTarget + VALUE_CELL_HIGH, 0);
                                store32(functionNameTarget + VALUE_CELL_AUX, 0);
                            }
                            store32(heapBase + framePC,
                                    pc + FIVE_WORD_INSTRUCTION);
                            store32(heapBase + state + ENGINE_HEAP_BUMP,
                                    bytecodeAllocationEnd);
                            frame = calleeFrame;
                            store32(heapBase + state + ENGINE_CURRENT_FRAME,
                                    frame);
                            currentContext = calleeContext;
                            currentProgram = calleeProgram;
                            bytecodeWords = load32(
                                heapBase + currentProgram + PROGRAM_BYTECODE) +
                                BYTECODE_WORDS;
                            constantCells = load32(
                                heapBase + currentProgram + PROGRAM_CONSTANTS) +
                                VECTOR_CELLS;
                            globalObject = load32(
                                heapBase + currentContext + CONTEXT_GLOBAL);
                            framePC = frame + FRAME_PC;
                            registerCells = frame + FRAME_REGISTERS;
                            environment = load32(
                                heapBase + frame + FRAME_ENVIRONMENT);
                            pc = 0;
                            bytecodeCallHandled = 1;
                        }
                    }
                }
                if (bytecodeCallHandled === 0) {
                var intrinsicCallValid = 1;
                if (load32(callFunctionCell) !== VALUE_TAG_REFERENCE) {
                    intrinsicCallValid = 0;
                }
                if (load32(callArgumentsCell) !== VALUE_TAG_REFERENCE) {
                    intrinsicCallValid = 0;
                }
                var intrinsicFunction = load32(
                    callFunctionCell + VALUE_CELL_LOW);
                if (intrinsicCallValid === 1) {
                    if (load32(heapBase + intrinsicFunction) !==
                        HEAP_TYPE_NATIVE_FUNCTION) intrinsicCallValid = 0;
                }
                var intrinsicId = 0;
                if (intrinsicCallValid === 1) {
                    intrinsicId = load32(
                        heapBase + intrinsicFunction + NATIVE_FUNCTION_METADATA);
                    if (intrinsicId < INTRINSIC_PEEK8) intrinsicCallValid = 0;
                    else if (intrinsicId > INTRINSIC_REGEXP_TEST) {
                        intrinsicCallValid = 0;
                    }
                }
                var intrinsicArgumentsArray = load32(
                    callArgumentsCell + VALUE_CELL_LOW);
                var intrinsicArgumentsVector = 0;
                var intrinsicArgumentCount = 0;
                if (intrinsicCallValid === 1) {
                    if (load32(heapBase + intrinsicArgumentsArray) !==
                        HEAP_TYPE_ARRAY) intrinsicCallValid = 0;
                    else {
                        intrinsicArgumentsVector = load32(
                            heapBase + intrinsicArgumentsArray + ARRAY_ELEMENTS);
                        intrinsicArgumentCount = load32(
                            heapBase + intrinsicArgumentsVector + VECTOR_LENGTH);
                    }
                }
                var requiredIntrinsicArguments = 1;
                if (intrinsicId === INTRINSIC_GET_DLSYM) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_ARRAY_PUSH) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_BUFFER_SLICE) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_STRING_CHAR_AT) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_STRING_CHAR_CODE_AT) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_STRING_SUBSTR) {
                    requiredIntrinsicArguments = 0;
                } else if (intrinsicId === INTRINSIC_STRING_INDEX_OF) {
                    requiredIntrinsicArguments = 1;
                } else if (intrinsicId === INTRINSIC_REGEXP_TEST) {
                    requiredIntrinsicArguments = 1;
                } else if (intrinsicId === INTRINSIC_MATH_POW) {
                    requiredIntrinsicArguments = 2;
                } else if (intrinsicId === INTRINSIC_POKE8) {
                    requiredIntrinsicArguments = 2;
                } else if (intrinsicId === INTRINSIC_POKE32) {
                    requiredIntrinsicArguments = 2;
                } else if (intrinsicId === INTRINSIC_BUFFER_WRITE_U32_LE) {
                    requiredIntrinsicArguments = 2;
                } else if (intrinsicId >= INTRINSIC_BUFFER_WRITE_U16_LE) {
                    if (intrinsicId <= INTRINSIC_BUFFER_WRITE_I16_LE) {
                        requiredIntrinsicArguments = 2;
                    }
                }
                if (intrinsicArgumentCount < requiredIntrinsicArguments) {
                    intrinsicCallValid = 0;
                }
                if (intrinsicCallValid === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var intrinsicTarget = heapBase + registerCells +
                    callTargetIndex * VALUE_CELL_BYTES;
                var intrinsicHandled = 0;
                if (intrinsicId === INTRINSIC_GET_DLSYM) {
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW,
                        platformDlsymPointer(heapBase,
                            enginePlatformServices(heapBase, state)));
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_FFI_CALL) {
                    var ffiValid = 1;
                    if (intrinsicArgumentCount < 1) ffiValid = 0;
                    if (intrinsicArgumentCount > 9) ffiValid = 0;
                    var ffiPointer = 0;
                    var ffiArg0 = 0;
                    var ffiArg1 = 0;
                    var ffiArg2 = 0;
                    var ffiArg3 = 0;
                    var ffiArg4 = 0;
                    var ffiArg5 = 0;
                    var ffiArg6 = 0;
                    var ffiArg7 = 0;
                    var ffiConvertIndex = 0;
                    while (ffiConvertIndex < intrinsicArgumentCount) {
                        var ffiRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            ffiConvertIndex * VALUE_CELL_BYTES;
                        if (load32(ffiRegisterCell) !== VALUE_TAG_INT32) {
                            ffiValid = 0;
                        }
                        var ffiRegister = load32(
                            ffiRegisterCell + VALUE_CELL_LOW);
                        var ffiValueCell = heapBase + registerCells +
                            ffiRegister * VALUE_CELL_BYTES;
                        var ffiValueTag = load32(ffiValueCell);
                        var ffiValue = 0;
                        if (ffiValueTag === VALUE_TAG_INT32) {
                            ffiValue = load32(ffiValueCell + VALUE_CELL_LOW);
                        } else if (ffiValueTag === VALUE_TAG_DOUBLE) {
                            ffiValue = toInt32F64(loadF64(
                                ffiValueCell + VALUE_CELL_LOW));
                        } else if (ffiValueTag === VALUE_TAG_NULL) {
                            ffiValue = 0;
                        } else if (ffiValueTag === VALUE_TAG_UNDEFINED) {
                            ffiValue = 0;
                        } else if (ffiValueTag === VALUE_TAG_REFERENCE) {
                            var ffiReference = load32(
                                ffiValueCell + VALUE_CELL_LOW);
                            if (recordType(heapBase, ffiReference) ===
                                HEAP_TYPE_STRING) {
                                var ffiStringLength = stringLength(
                                    heapBase, ffiReference);
                                var ffiStringBytes =
                                    (BUFFER_BACKING_DATA + ffiStringLength +
                                     1 + 7) & -8;
                                var ffiStringBacking = engineHeapBump(
                                    heapBase, state);
                                if (ffiStringBacking + ffiStringBytes >
                                    engineHeapLimit(heapBase, state)) {
                                    ffiValid = 0;
                                } else {
                                    setRecordType(heapBase, ffiStringBacking,
                                                  HEAP_TYPE_BUFFER_BACKING);
                                    setRecordSize(heapBase, ffiStringBacking,
                                                  ffiStringBytes);
                                    setRecordMark(heapBase, ffiStringBacking, 0);
                                    setRecordFlags(heapBase, ffiStringBacking, 0);
                                    ffiValue = heapBase + ffiStringBacking +
                                               BUFFER_BACKING_DATA;
                                    setBufferBackingPointer(
                                        heapBase, ffiStringBacking, ffiValue);
                                    setBufferBackingLength(
                                        heapBase, ffiStringBacking,
                                        ffiStringLength + 1);
                                    setBufferBackingMetadata(
                                        heapBase, ffiStringBacking, 0);
                                    var ffiCharacterIndex = 0;
                                    while (ffiCharacterIndex < ffiStringLength) {
                                        storeRaw8(ffiValue + ffiCharacterIndex,
                                            stringCharacterCodeUnit(
                                                heapBase, ffiReference,
                                                ffiCharacterIndex) & 255);
                                        ffiCharacterIndex =
                                            ffiCharacterIndex + 1;
                                    }
                                    storeRaw8(ffiValue + ffiStringLength, 0);
                                    setEngineHeapBump(heapBase, state,
                                        ffiStringBacking + ffiStringBytes);
                                }
                            } else ffiValid = 0;
                        } else ffiValid = 0;
                        if (ffiConvertIndex === 0) ffiPointer = ffiValue;
                        else if (ffiConvertIndex === 1) ffiArg0 = ffiValue;
                        else if (ffiConvertIndex === 2) ffiArg1 = ffiValue;
                        else if (ffiConvertIndex === 3) ffiArg2 = ffiValue;
                        else if (ffiConvertIndex === 4) ffiArg3 = ffiValue;
                        else if (ffiConvertIndex === 5) ffiArg4 = ffiValue;
                        else if (ffiConvertIndex === 6) ffiArg5 = ffiValue;
                        else if (ffiConvertIndex === 7) ffiArg6 = ffiValue;
                        else if (ffiConvertIndex === 8) ffiArg7 = ffiValue;
                        ffiConvertIndex = ffiConvertIndex + 1;
                    }
                    if (ffiPointer === 0) ffiValid = 0;
                    if (ffiValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var ffiResult = 0;
                    if (intrinsicArgumentCount === 1) {
                        ffiResult = callNativeI32(ffiPointer);
                    } else if (intrinsicArgumentCount === 2) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0);
                    } else if (intrinsicArgumentCount === 3) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1);
                    } else if (intrinsicArgumentCount === 4) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2);
                    } else if (intrinsicArgumentCount === 5) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2, ffiArg3);
                    } else if (intrinsicArgumentCount === 6) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2, ffiArg3, ffiArg4);
                    } else if (intrinsicArgumentCount === 7) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2, ffiArg3, ffiArg4,
                                                  ffiArg5);
                    } else if (intrinsicArgumentCount === 8) {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2, ffiArg3, ffiArg4,
                                                  ffiArg5, ffiArg6);
                    } else {
                        ffiResult = callNativeI32(ffiPointer, ffiArg0, ffiArg1,
                                                  ffiArg2, ffiArg3, ffiArg4,
                                                  ffiArg5, ffiArg6, ffiArg7);
                    }
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW, ffiResult);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicId === INTRINSIC_ARRAY_PUSH) {
                    var pushReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var pushValid = 1;
                    if (pushReceiverIndex < 0) pushValid = 0;
                    var pushReceiverCell = heapBase + registerCells +
                        pushReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(pushReceiverCell) !== VALUE_TAG_REFERENCE) {
                        pushValid = 0;
                    }
                    var pushArray = load32(pushReceiverCell + VALUE_CELL_LOW);
                    if (pushValid === 1) {
                        if (load32(heapBase + pushArray) !== HEAP_TYPE_ARRAY) {
                            pushValid = 0;
                        }
                    }
                    var pushVector = 0;
                    var pushLength = 0;
                    if (pushValid === 1) {
                        pushVector = arrayElements(heapBase, pushArray);
                        pushLength = vectorLength(heapBase, pushVector);
                        var pushCapacity = vectorCapacity(heapBase, pushVector);
                        if (pushLength + intrinsicArgumentCount > pushCapacity) {
                            var grownPushCapacity = pushCapacity;
                            if (grownPushCapacity < INITIAL_ARRAY_CAPACITY) {
                                grownPushCapacity = INITIAL_ARRAY_CAPACITY;
                            }
                            while (grownPushCapacity <
                                   pushLength + intrinsicArgumentCount) {
                                grownPushCapacity = grownPushCapacity * 2;
                            }
                            var grownPushVectorBytes = VECTOR_CELLS +
                                grownPushCapacity * VALUE_CELL_BYTES;
                            var grownPushVector = engineHeapBump(heapBase, state);
                            if (grownPushVector + grownPushVectorBytes >
                                engineHeapLimit(heapBase, state)) {
                                pushValid = 0;
                            } else {
                                setRecordType(heapBase, grownPushVector,
                                              HEAP_TYPE_VALUE_VECTOR);
                                setRecordSize(heapBase, grownPushVector,
                                              grownPushVectorBytes);
                                setRecordMark(heapBase, grownPushVector, 0);
                                setRecordFlags(heapBase, grownPushVector, 0);
                                setVectorLength(heapBase, grownPushVector,
                                                pushLength);
                                setVectorCapacity(heapBase, grownPushVector,
                                                  grownPushCapacity);
                                var grownPushIndex = 0;
                                while (grownPushIndex < grownPushCapacity) {
                                    var grownPushTarget = heapBase +
                                        grownPushVector + VECTOR_CELLS +
                                        grownPushIndex * VALUE_CELL_BYTES;
                                    if (grownPushIndex < pushLength) {
                                        var grownPushSource = heapBase +
                                            pushVector + VECTOR_CELLS +
                                            grownPushIndex * VALUE_CELL_BYTES;
                                        store32(grownPushTarget,
                                                load32(grownPushSource));
                                        store32(grownPushTarget + VALUE_CELL_LOW,
                                            load32(grownPushSource +
                                                   VALUE_CELL_LOW));
                                        store32(grownPushTarget + VALUE_CELL_HIGH,
                                            load32(grownPushSource +
                                                   VALUE_CELL_HIGH));
                                        store32(grownPushTarget + VALUE_CELL_AUX,
                                            load32(grownPushSource +
                                                   VALUE_CELL_AUX));
                                    } else {
                                        store32(grownPushTarget, 0);
                                        store32(grownPushTarget + VALUE_CELL_LOW, 0);
                                        store32(grownPushTarget + VALUE_CELL_HIGH, 0);
                                        store32(grownPushTarget + VALUE_CELL_AUX, 0);
                                    }
                                    grownPushIndex = grownPushIndex + 1;
                                }
                                setArrayElements(heapBase, pushArray,
                                                 grownPushVector);
                                setEngineHeapBump(heapBase, state,
                                    grownPushVector + grownPushVectorBytes);
                                pushVector = grownPushVector;
                            }
                        }
                    }
                    var pushIndex = 0;
                    while (pushIndex < intrinsicArgumentCount) {
                        var pushRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            pushIndex * VALUE_CELL_BYTES;
                        if (load32(pushRegisterCell) !== VALUE_TAG_INT32) {
                            pushValid = 0;
                        }
                        pushIndex = pushIndex + 1;
                    }
                    if (pushValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    pushIndex = 0;
                    while (pushIndex < intrinsicArgumentCount) {
                        var pushSourceRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            pushIndex * VALUE_CELL_BYTES;
                        var pushSourceRegister = load32(
                            pushSourceRegisterCell + VALUE_CELL_LOW);
                        var pushSource = heapBase + registerCells +
                            pushSourceRegister * VALUE_CELL_BYTES;
                        var pushTarget = heapBase + pushVector + VECTOR_CELLS +
                            (pushLength + pushIndex) * VALUE_CELL_BYTES;
                        store32(pushTarget, load32(pushSource));
                        store32(pushTarget + VALUE_CELL_LOW,
                                load32(pushSource + VALUE_CELL_LOW));
                        store32(pushTarget + VALUE_CELL_HIGH,
                                load32(pushSource + VALUE_CELL_HIGH));
                        store32(pushTarget + VALUE_CELL_AUX,
                                load32(pushSource + VALUE_CELL_AUX));
                        pushIndex = pushIndex + 1;
                    }
                    pushLength = pushLength + intrinsicArgumentCount;
                    setVectorLength(heapBase, pushVector, pushLength);
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW, pushLength);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                if (intrinsicHandled === 0) {
                var isMathIntrinsic = 0;
                if (intrinsicId >= INTRINSIC_MATH_SQRT) {
                    if (intrinsicId <= INTRINSIC_MATH_COS) {
                        isMathIntrinsic = 1;
                    }
                }
                if (intrinsicId === INTRINSIC_MATH_POW) {
                    isMathIntrinsic = 1;
                }
                if (isMathIntrinsic === 1) {
                    var mathArgumentsValid = 1;
                    var mathArgumentIndex = 0;
                    var minimumCell = 0;
                    var unaryMathCell = 0;
                    var powerExponentCell = 0;
                    var selectExtreme = 0;
                    if (intrinsicId === INTRINSIC_MATH_MIN) selectExtreme = 1;
                    else if (intrinsicId === INTRINSIC_MATH_MAX) {
                        selectExtreme = 1;
                    }
                    while (mathArgumentIndex < intrinsicArgumentCount) {
                        var mathRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            mathArgumentIndex * VALUE_CELL_BYTES;
                        if (load32(mathRegisterCell) !== VALUE_TAG_INT32) {
                            mathArgumentsValid = 0;
                        }
                        var mathRegister = load32(
                            mathRegisterCell + VALUE_CELL_LOW);
                        var mathValueCell = heapBase + registerCells +
                            mathRegister * VALUE_CELL_BYTES;
                        var mathValueTag = load32(mathValueCell);
                        if (mathArgumentIndex === 0) unaryMathCell = mathValueCell;
                        else if (mathArgumentIndex === 1) {
                            powerExponentCell = mathValueCell;
                        }
                        if (mathValueTag !== VALUE_TAG_INT32) {
                            if (mathValueTag !== VALUE_TAG_DOUBLE) {
                                mathArgumentsValid = 0;
                            }
                        }
                        if (selectExtreme === 1) {
                            if (mathValueTag === VALUE_TAG_DOUBLE) {
                                if (load32(mathValueCell + VALUE_CELL_LOW) === 0) {
                                    if ((load32(mathValueCell + VALUE_CELL_HIGH) &
                                        IEEE754_ABSOLUTE_MASK) === 0) {
                                        if (load32(mathValueCell +
                                            VALUE_CELL_HIGH) < 0) {
                                            mathArgumentsValid = 0;
                                        }
                                    }
                                }
                            }
                            if (mathArgumentIndex === 0) {
                                minimumCell = mathValueCell;
                            } else {
                                var minimumTag = load32(minimumCell);
                                if (equalF64(loadNumberF64(
                                        mathValueCell + VALUE_CELL_LOW,
                                        mathValueTag), loadNumberF64(
                                        mathValueCell + VALUE_CELL_LOW,
                                        mathValueTag)) === 0) {
                                    minimumCell = mathValueCell;
                                } else if (intrinsicId === INTRINSIC_MATH_MIN) {
                                    if (lessF64(loadNumberF64(
                                            mathValueCell + VALUE_CELL_LOW,
                                            mathValueTag), loadNumberF64(
                                            minimumCell + VALUE_CELL_LOW,
                                            minimumTag)) === 1) {
                                        minimumCell = mathValueCell;
                                    }
                                } else {
                                    if (greaterF64(loadNumberF64(
                                            mathValueCell + VALUE_CELL_LOW,
                                            mathValueTag), loadNumberF64(
                                            minimumCell + VALUE_CELL_LOW,
                                            minimumTag)) === 1) {
                                        minimumCell = mathValueCell;
                                    }
                                }
                            }
                        }
                        mathArgumentIndex = mathArgumentIndex + 1;
                    }
                    if (mathArgumentsValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    if (intrinsicId === INTRINSIC_MATH_POW) {
                        if (intrinsicArgumentCount !== 2) {
                            mathArgumentsValid = 0;
                        }
                        var powerBaseTag = load32(unaryMathCell);
                        var powerExponentTag = load32(powerExponentCell);
                        store32(heapBase + state + ENGINE_SCRATCH_LEFT, 0);
                        if (greaterF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, powerBaseTag),
                                loadI32F64(heapBase + state +
                                           ENGINE_SCRATCH_LEFT)) === 0) {
                            mathArgumentsValid = 0;
                        }
                        if (equalF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, powerBaseTag),
                                loadNumberF64(unaryMathCell + VALUE_CELL_LOW,
                                              powerBaseTag)) === 0) {
                            mathArgumentsValid = 0;
                        }
                        if (equalF64(loadNumberF64(
                                powerExponentCell + VALUE_CELL_LOW,
                                powerExponentTag), loadNumberF64(
                                powerExponentCell + VALUE_CELL_LOW,
                                powerExponentTag)) === 0) {
                            mathArgumentsValid = 0;
                        }
                        if (mathArgumentsValid === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                        storeF64(intrinsicTarget + VALUE_CELL_LOW,
                            powF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, powerBaseTag),
                                loadNumberF64(
                                    powerExponentCell + VALUE_CELL_LOW,
                                    powerExponentTag)));
                    } else if (intrinsicId >= INTRINSIC_MATH_SIN) {
                        var trigTag = load32(unaryMathCell);
                        var trigSupported = 1;
                        if (trigTag === VALUE_TAG_DOUBLE) {
                            if ((load32(unaryMathCell + VALUE_CELL_HIGH) &
                                 IEEE754_ABSOLUTE_MASK) >= 1138753536) {
                                trigSupported = 0;
                            }
                        }
                        if (trigSupported === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                        if (intrinsicId === INTRINSIC_MATH_SIN) {
                            storeF64(intrinsicTarget + VALUE_CELL_LOW,
                                sinF64(loadNumberF64(
                                    unaryMathCell + VALUE_CELL_LOW, trigTag)));
                        } else {
                            storeF64(intrinsicTarget + VALUE_CELL_LOW,
                                cosF64(loadNumberF64(
                                    unaryMathCell + VALUE_CELL_LOW, trigTag)));
                        }
                    } else if (intrinsicId === INTRINSIC_MATH_SQRT) {
                        var sqrtRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS;
                        var sqrtRegister = load32(
                            sqrtRegisterCell + VALUE_CELL_LOW);
                        var sqrtValueCell = heapBase + registerCells +
                            sqrtRegister * VALUE_CELL_BYTES;
                        var sqrtValueTag = load32(sqrtValueCell);
                        store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                        storeF64(intrinsicTarget + VALUE_CELL_LOW,
                            sqrtF64(loadNumberF64(
                                sqrtValueCell + VALUE_CELL_LOW, sqrtValueTag)));
                    } else if (intrinsicId === INTRINSIC_MATH_ABS) {
                        var absRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS;
                        var absRegister = load32(
                            absRegisterCell + VALUE_CELL_LOW);
                        var absValueCell = heapBase + registerCells +
                            absRegister * VALUE_CELL_BYTES;
                        var absValueTag = load32(absValueCell);
                        store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                        storeF64(intrinsicTarget + VALUE_CELL_LOW,
                            absF64(loadNumberF64(
                                absValueCell + VALUE_CELL_LOW, absValueTag)));
                    } else if (intrinsicId === INTRINSIC_MATH_ROUND) {
                        /* Doubling makes the half-way boundary integral, so
                         * common-range Math.round needs no host callback or
                         * embedded floating-point constant. Arithmetic right
                         * shift supplies floor division for a negative,
                         * non-tie odd value. Exact negative odd values are the
                         * ES tie case and round toward positive infinity. */
                        var roundTag = load32(unaryMathCell);
                        var roundTwiceInteger = toInt32F64(addF64(
                            loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundTag),
                            loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundTag)));
                        store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                                roundTwiceInteger);
                        var roundTwiceExact = equalF64(addF64(
                            loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundTag),
                            loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundTag)),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_LEFT));
                        var roundSafe = 1;
                        if (roundTwiceInteger === MINIMUM_INT32) {
                            if (roundTwiceExact === 0) roundSafe = 0;
                        }
                        if (equalF64(loadNumberF64(
                            unaryMathCell + VALUE_CELL_LOW, roundTag),
                            loadNumberF64(
                            unaryMathCell + VALUE_CELL_LOW, roundTag)) === 0) {
                            roundSafe = 0;
                        }
                        if (roundSafe === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        var roundResult = roundTwiceInteger >> 1;
                        if (roundTwiceInteger >= 0) {
                            roundResult = roundResult +
                                          (roundTwiceInteger & 1);
                        } else if ((roundTwiceInteger & 1) !== 0) {
                            if (roundTwiceExact === 1) {
                                roundResult = roundResult + 1;
                            }
                        }
                        var roundNegativeZero = 0;
                        if (roundResult === 0) {
                            store32(heapBase + state + ENGINE_SCRATCH_RIGHT, 0);
                            if (lessF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundTag),
                                loadI32F64(heapBase + state +
                                           ENGINE_SCRATCH_RIGHT)) === 1) {
                                roundNegativeZero = 1;
                            } else if (roundTag === VALUE_TAG_DOUBLE) {
                                if (load32(unaryMathCell + VALUE_CELL_LOW) === 0) {
                                    if ((load32(unaryMathCell + VALUE_CELL_HIGH) &
                                         IEEE754_ABSOLUTE_MASK) === 0) {
                                        if (load32(unaryMathCell +
                                                   VALUE_CELL_HIGH) < 0) {
                                            roundNegativeZero = 1;
                                        }
                                    }
                                }
                            }
                        }
                        if (roundNegativeZero === 1) {
                            store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                            store32(intrinsicTarget + VALUE_CELL_LOW, 0);
                            store32(intrinsicTarget + VALUE_CELL_HIGH,
                                    MINIMUM_INT32);
                        } else {
                            store32(intrinsicTarget, VALUE_TAG_INT32);
                            store32(intrinsicTarget + VALUE_CELL_LOW,
                                    roundResult);
                            store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                        }
                    } else if (intrinsicId >= INTRINSIC_MATH_FLOOR) {
                        var roundingTag = load32(unaryMathCell);
                        var roundingValue = toInt32F64(loadNumberF64(
                            unaryMathCell + VALUE_CELL_LOW, roundingTag));
                        store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                                roundingValue);
                        store32(heapBase + state + ENGINE_SCRATCH_RIGHT, 0);
                        var roundingExact = equalF64(loadNumberF64(
                            unaryMathCell + VALUE_CELL_LOW, roundingTag),
                            loadI32F64(heapBase + state +
                                       ENGINE_SCRATCH_LEFT));
                        var roundingSafe = 1;
                        if (roundingTag === VALUE_TAG_DOUBLE) {
                            if (load32(unaryMathCell + VALUE_CELL_LOW) === 0) {
                                if ((load32(unaryMathCell + VALUE_CELL_HIGH) &
                                     IEEE754_ABSOLUTE_MASK) === 0) {
                                    if (load32(unaryMathCell +
                                               VALUE_CELL_HIGH) < 0) {
                                        roundingSafe = 0;
                                    }
                                }
                            }
                        }
                        if (roundingExact === 0) {
                            if (roundingValue === MINIMUM_INT32) {
                                roundingSafe = 0;
                            } else if (equalF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundingTag),
                                loadNumberF64(unaryMathCell + VALUE_CELL_LOW,
                                              roundingTag)) === 0) {
                                roundingSafe = 0;
                            } else if (greaterF64(loadNumberF64(
                                unaryMathCell + VALUE_CELL_LOW, roundingTag),
                                loadI32F64(heapBase + state +
                                           ENGINE_SCRATCH_RIGHT)) === 1) {
                                if (roundingValue < 0) roundingSafe = 0;
                                else if (intrinsicId === INTRINSIC_MATH_CEIL) {
                                    if (roundingValue === 2147483647) {
                                        roundingSafe = 0;
                                    } else roundingValue = roundingValue + 1;
                                }
                            } else {
                                if (roundingValue > 0) roundingSafe = 0;
                                else if (intrinsicId === INTRINSIC_MATH_FLOOR) {
                                    roundingValue = roundingValue - 1;
                                }
                            }
                        }
                        if (roundingSafe === 0) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        store32(intrinsicTarget, VALUE_TAG_INT32);
                        store32(intrinsicTarget + VALUE_CELL_LOW, roundingValue);
                        store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    } else {
                        store32(intrinsicTarget, load32(minimumCell));
                        store32(intrinsicTarget + VALUE_CELL_LOW,
                                load32(minimumCell + VALUE_CELL_LOW));
                        store32(intrinsicTarget + VALUE_CELL_HIGH,
                                load32(minimumCell + VALUE_CELL_HIGH));
                    }
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_BUFFER_COPY) {
                    var copyValid = 1;
                    var copyReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    if (copyReceiverIndex < 0) copyValid = 0;
                    var copyReceiverCell = heapBase + registerCells +
                        copyReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(copyReceiverCell) !== VALUE_TAG_REFERENCE) {
                        copyValid = 0;
                    }
                    var copyReceiver = load32(
                        copyReceiverCell + VALUE_CELL_LOW);
                    if (copyValid === 1) {
                        if (recordType(heapBase, copyReceiver) !==
                            HEAP_TYPE_BUFFER_VIEW) copyValid = 0;
                    }
                    var copyTargetRegisterCell = heapBase +
                        intrinsicArgumentsVector + VECTOR_CELLS;
                    if (load32(copyTargetRegisterCell) !== VALUE_TAG_INT32) {
                        copyValid = 0;
                    }
                    var copyTargetRegister = load32(
                        copyTargetRegisterCell + VALUE_CELL_LOW);
                    var copyTargetCell = heapBase + registerCells +
                        copyTargetRegister * VALUE_CELL_BYTES;
                    if (load32(copyTargetCell) !== VALUE_TAG_REFERENCE) {
                        copyValid = 0;
                    }
                    var copyTarget = load32(copyTargetCell + VALUE_CELL_LOW);
                    if (copyValid === 1) {
                        if (recordType(heapBase, copyTarget) !==
                            HEAP_TYPE_BUFFER_VIEW) copyValid = 0;
                    }
                    var copyReceiverLength = 0;
                    var copyTargetLength = 0;
                    if (copyValid === 1) {
                        copyReceiverLength = bufferViewLength(
                            heapBase, copyReceiver);
                        copyTargetLength = bufferViewLength(
                            heapBase, copyTarget);
                    }
                    var copyTargetStart = 0;
                    var copySourceStart = 0;
                    var copySourceEnd = copyReceiverLength;
                    var copyArgumentIndex = 1;
                    while (copyArgumentIndex < intrinsicArgumentCount) {
                        if (copyArgumentIndex < 4) {
                            var copyValueRegisterCell = heapBase +
                                intrinsicArgumentsVector + VECTOR_CELLS +
                                copyArgumentIndex * VALUE_CELL_BYTES;
                            if (load32(copyValueRegisterCell) !==
                                VALUE_TAG_INT32) copyValid = 0;
                            var copyValueRegister = load32(
                                copyValueRegisterCell + VALUE_CELL_LOW);
                            var copyValueCell = heapBase + registerCells +
                                copyValueRegister * VALUE_CELL_BYTES;
                            var copyValueTag = load32(copyValueCell);
                            if (copyValueTag !== VALUE_TAG_INT32) {
                                if (copyValueTag !== VALUE_TAG_DOUBLE) {
                                    copyValid = 0;
                                }
                            }
                            var copyValue = 0;
                            if (copyValid === 1) {
                                copyValue = toInt32F64(loadNumberF64(
                                    copyValueCell + VALUE_CELL_LOW,
                                    copyValueTag));
                            }
                            if (copyArgumentIndex === 1) {
                                copyTargetStart = copyValue;
                            } else if (copyArgumentIndex === 2) {
                                copySourceStart = copyValue;
                            } else copySourceEnd = copyValue;
                        }
                        copyArgumentIndex = copyArgumentIndex + 1;
                    }
                    if (copyTargetStart < 0) copyValid = 0;
                    if (copySourceStart < 0) copyValid = 0;
                    if (copySourceEnd < copySourceStart) copyValid = 0;
                    if (copySourceEnd > copyReceiverLength) copyValid = 0;
                    if (copyTargetStart > copyTargetLength) copyValid = 0;
                    var copyCount = copySourceEnd - copySourceStart;
                    if (copyCount > copyTargetLength - copyTargetStart) {
                        copyCount = copyTargetLength - copyTargetStart;
                    }
                    var copyReceiverBacking = 0;
                    var copyTargetBacking = 0;
                    var copyReceiverPointer = 0;
                    var copyTargetPointer = 0;
                    if (copyValid === 1) {
                        copyReceiverBacking = bufferViewBacking(
                            heapBase, copyReceiver);
                        copyTargetBacking = bufferViewBacking(
                            heapBase, copyTarget);
                        copyReceiverPointer = bufferBackingPointer(
                            heapBase, copyReceiverBacking);
                        copyTargetPointer = bufferBackingPointer(
                            heapBase, copyTargetBacking);
                        if (copyReceiverPointer === 0) copyValid = 0;
                        if (copyTargetPointer === 0) copyValid = 0;
                    }
                    if (copyValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var copySourceAddress = copyReceiverPointer +
                        bufferViewOffset(heapBase, copyReceiver) +
                        copySourceStart;
                    var copyTargetAddress = copyTargetPointer +
                        bufferViewOffset(heapBase, copyTarget) + copyTargetStart;
                    var copyBackwards = 0;
                    if (copyTargetAddress > copySourceAddress) {
                        if (copyTargetAddress < copySourceAddress + copyCount) {
                            copyBackwards = 1;
                        }
                    }
                    var copyIndex = 0;
                    if (copyBackwards === 1) copyIndex = copyCount - 1;
                    while (copyIndex >= 0) {
                        if (copyIndex >= copyCount) copyIndex = -1;
                        else {
                            storeRaw8(copyTargetAddress + copyIndex,
                                loadRaw8(copySourceAddress + copyIndex));
                            if (copyBackwards === 1) copyIndex = copyIndex - 1;
                            else copyIndex = copyIndex + 1;
                        }
                    }
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW, copyCount);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_BUFFER_ALLOC) {
                    var bufferAllocValid = 1;
                    /* A fill value has additional observable semantics. Keep
                     * that uncommon form on the reference path until the
                     * kernel fill operation is shared with Buffer.fill. */
                    if (intrinsicArgumentCount !== 1) bufferAllocValid = 0;
                    var bufferAllocRegisterCell = heapBase +
                        intrinsicArgumentsVector + VECTOR_CELLS;
                    if (load32(bufferAllocRegisterCell) !== VALUE_TAG_INT32) {
                        bufferAllocValid = 0;
                    }
                    var bufferAllocRegister = load32(
                        bufferAllocRegisterCell + VALUE_CELL_LOW);
                    var bufferAllocSizeCell = heapBase + registerCells +
                        bufferAllocRegister * VALUE_CELL_BYTES;
                    var bufferAllocSizeTag = load32(bufferAllocSizeCell);
                    if (bufferAllocSizeTag !== VALUE_TAG_INT32) {
                        if (bufferAllocSizeTag !== VALUE_TAG_DOUBLE) {
                            bufferAllocValid = 0;
                        }
                    }
                    var bufferAllocSize = 0;
                    if (bufferAllocValid === 1) {
                        bufferAllocSize = toInt32F64(loadNumberF64(
                            bufferAllocSizeCell + VALUE_CELL_LOW,
                            bufferAllocSizeTag));
                        store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                                bufferAllocSize);
                        if (equalF64(loadNumberF64(
                            bufferAllocSizeCell + VALUE_CELL_LOW,
                            bufferAllocSizeTag), loadI32F64(
                            heapBase + state + ENGINE_SCRATCH_LEFT)) === 0) {
                            bufferAllocValid = 0;
                        }
                        if (bufferAllocSize < 0) bufferAllocValid = 0;
                    }
                    var bufferBackingBytes =
                        (BUFFER_BACKING_DATA + bufferAllocSize + 7) & -8;
                    var allocatedBacking = engineHeapBump(heapBase, state);
                    var allocatedView = allocatedBacking + bufferBackingBytes;
                    if (allocatedView + BUFFER_VIEW_RECORD_BYTES >
                        engineHeapLimit(heapBase, state)) bufferAllocValid = 0;
                    if (bufferAllocValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var bufferClearOffset = 0;
                    while (bufferClearOffset < bufferBackingBytes) {
                        store32(heapBase + allocatedBacking + bufferClearOffset,
                                0);
                        bufferClearOffset = bufferClearOffset + 4;
                    }
                    setRecordType(heapBase, allocatedBacking,
                                  HEAP_TYPE_BUFFER_BACKING);
                    setRecordSize(heapBase, allocatedBacking,
                                  bufferBackingBytes);
                    setRecordMark(heapBase, allocatedBacking, 0);
                    setRecordFlags(heapBase, allocatedBacking, 0);
                    if (heapBase === 0) {
                        setBufferBackingPointer(
                            heapBase, allocatedBacking, 0);
                    } else {
                        setBufferBackingPointer(heapBase, allocatedBacking,
                            heapBase + allocatedBacking + BUFFER_BACKING_DATA);
                    }
                    setBufferBackingLength(heapBase, allocatedBacking,
                                           bufferAllocSize);
                    setBufferBackingMetadata(heapBase, allocatedBacking, 0);
                    setRecordType(heapBase, allocatedView,
                                  HEAP_TYPE_BUFFER_VIEW);
                    setRecordSize(heapBase, allocatedView,
                                  BUFFER_VIEW_RECORD_BYTES);
                    setRecordMark(heapBase, allocatedView, 0);
                    setRecordFlags(heapBase, allocatedView, 0);
                    setBufferViewBacking(heapBase, allocatedView,
                                         allocatedBacking);
                    setBufferViewOffset(heapBase, allocatedView, 0);
                    setBufferViewLength(heapBase, allocatedView,
                                        bufferAllocSize);
                    var bufferPrototypeCell = heapBase + stringSupport +
                        VECTOR_CELLS + RUNTIME_SUPPORT_BUFFER_PROTOTYPE *
                        VALUE_CELL_BYTES;
                    setBufferViewPrototype(heapBase, allocatedView,
                        load32(bufferPrototypeCell + VALUE_CELL_LOW));
                    setBufferViewPropertyHead(heapBase, allocatedView, 0);
                    setEngineHeapBump(heapBase, state,
                        allocatedView + BUFFER_VIEW_RECORD_BYTES);
                    store32(intrinsicTarget, VALUE_TAG_REFERENCE);
                    store32(intrinsicTarget + VALUE_CELL_LOW, allocatedView);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (ENABLE_NATIVE_REGEXP_TEST === 1) {
                if (intrinsicId === INTRINSIC_REGEXP_TEST) {
                    var regexpTestReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var regexpTestValid = 1;
                    if (regexpTestReceiverIndex < 0) regexpTestValid = 0;
                    var regexpTestReceiverCell = heapBase + registerCells +
                        regexpTestReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(regexpTestReceiverCell) !==
                        VALUE_TAG_REFERENCE) regexpTestValid = 0;
                    var regexpTestObject = load32(
                        regexpTestReceiverCell + VALUE_CELL_LOW);
                    if (regexpTestValid === 1) {
                        if (recordType(heapBase, regexpTestObject) !==
                            HEAP_TYPE_REGEXP) regexpTestValid = 0;
                    }
                    var regexpTestArgumentRegisterCell = heapBase +
                        intrinsicArgumentsVector + VECTOR_CELLS;
                    if (load32(regexpTestArgumentRegisterCell) !==
                        VALUE_TAG_INT32) regexpTestValid = 0;
                    var regexpTestArgumentRegister = load32(
                        regexpTestArgumentRegisterCell + VALUE_CELL_LOW);
                    var regexpTestArgumentCell = heapBase + registerCells +
                        regexpTestArgumentRegister * VALUE_CELL_BYTES;
                    if (load32(regexpTestArgumentCell) !==
                        VALUE_TAG_REFERENCE) regexpTestValid = 0;
                    var regexpTestSource = load32(
                        regexpTestArgumentCell + VALUE_CELL_LOW);
                    if (regexpTestValid === 1) {
                        if (recordType(heapBase, regexpTestSource) !==
                            HEAP_TYPE_STRING) regexpTestValid = 0;
                    }
                    var regexpTestPattern = 0;
                    var regexpTestFlags = 0;
                    if (regexpTestValid === 1) {
                        regexpTestPattern = regexpPattern(
                            heapBase, regexpTestObject);
                        regexpTestFlags = regexpFlags(
                            heapBase, regexpTestObject);
                        if (stringLength(heapBase, regexpTestFlags) !== 0) {
                            regexpTestValid = 0;
                        }
                    }
                    var regexpTestPatternLength = 0;
                    if (regexpTestValid === 1) {
                        regexpTestPatternLength = stringLength(
                            heapBase, regexpTestPattern);
                    }
                    var regexpTestSourceLength = 0;
                    var regexpTestResult = 1;
                    var regexpTestSourceIndex = 0;
                    if (regexpTestValid === 1) {
                        regexpTestSourceLength = stringLength(
                            heapBase, regexpTestSource);
                        if (regexpTestPatternLength === 2) {
                            if ((stringCharacterCodeUnit(heapBase,
                                regexpTestPattern, 0) & 65535) === 92) {
                                if ((stringCharacterCodeUnit(heapBase,
                                    regexpTestPattern, 1) & 65535) === 115) {
                                    var regexpWhitespaceIndex = 0;
                                    var regexpWhitespaceResult = 0;
                                    while (regexpWhitespaceIndex <
                                           regexpTestSourceLength) {
                                        var regexpWhitespaceCharacter =
                                            stringCharacterCodeUnit(heapBase,
                                            regexpTestSource,
                                            regexpWhitespaceIndex) & 65535;
                                        if (regexpWhitespaceCharacter >= 9) {
                                            if (regexpWhitespaceCharacter <=
                                                13) {
                                                regexpWhitespaceResult = 1;
                                            }
                                        }
                                        if (regexpWhitespaceCharacter === 32) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   160) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   5760) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   6158) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter >=
                                                   8192) {
                                            if (regexpWhitespaceCharacter <=
                                                8202) {
                                                regexpWhitespaceResult = 1;
                                            }
                                        }
                                        if (regexpWhitespaceCharacter ===
                                            8232) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   8233) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   8239) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   8287) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   12288) {
                                            regexpWhitespaceResult = 1;
                                        } else if (regexpWhitespaceCharacter ===
                                                   65279) {
                                            regexpWhitespaceResult = 1;
                                        }
                                        if (regexpWhitespaceResult === 1) {
                                            regexpWhitespaceIndex =
                                                regexpTestSourceLength;
                                        } else regexpWhitespaceIndex =
                                            regexpWhitespaceIndex + 1;
                                    }
                                    regexpTestResult = regexpWhitespaceResult;
                                    regexpTestSourceIndex =
                                        regexpTestSourceLength;
                                    regexpTestValid = 2;
                                }
                            }
                        }
                    }
                    if (regexpTestValid === 1) {
                        if (regexpTestPatternLength >= 3) {
                            if ((stringCharacterCodeUnit(heapBase,
                                regexpTestPattern, 0) & 65535) === 91) {
                                if ((stringCharacterCodeUnit(heapBase,
                                    regexpTestPattern,
                                    regexpTestPatternLength - 1) &
                                    65535) === 93) {
                                    var simpleClassStart = 1;
                                    var simpleClassEnd =
                                        regexpTestPatternLength - 1;
                                    var simpleClassNegated = 0;
                                    if ((stringCharacterCodeUnit(heapBase,
                                        regexpTestPattern,
                                        simpleClassStart) & 65535) === 94) {
                                        simpleClassNegated = 1;
                                        simpleClassStart = simpleClassStart + 1;
                                    }
                                    var simpleClassSourceIndex = 0;
                                    var simpleClassResult = 0;
                                    while (simpleClassSourceIndex <
                                           regexpTestSourceLength) {
                                        var simpleClassCharacter =
                                            stringCharacterCodeUnit(heapBase,
                                            regexpTestSource,
                                            simpleClassSourceIndex) & 65535;
                                        var simpleClassPatternIndex =
                                            simpleClassStart;
                                        var simpleClassMatches = 0;
                                        while (simpleClassPatternIndex <
                                               simpleClassEnd) {
                                            var simpleClassLow =
                                                stringCharacterCodeUnit(
                                                heapBase, regexpTestPattern,
                                                simpleClassPatternIndex) &
                                                65535;
                                            var simpleClassHigh = simpleClassLow;
                                            if (simpleClassPatternIndex + 2 <
                                                simpleClassEnd) {
                                                if ((stringCharacterCodeUnit(
                                                    heapBase,
                                                    regexpTestPattern,
                                                    simpleClassPatternIndex +
                                                    1) & 65535) === 45) {
                                                    simpleClassHigh =
                                                        stringCharacterCodeUnit(
                                                        heapBase,
                                                        regexpTestPattern,
                                                        simpleClassPatternIndex +
                                                        2) & 65535;
                                                    simpleClassPatternIndex =
                                                        simpleClassPatternIndex +
                                                        2;
                                                }
                                            }
                                            if (simpleClassCharacter >=
                                                simpleClassLow) {
                                                if (simpleClassCharacter <=
                                                    simpleClassHigh) {
                                                    simpleClassMatches = 1;
                                                }
                                            }
                                            simpleClassPatternIndex =
                                                simpleClassPatternIndex + 1;
                                        }
                                        if (simpleClassNegated === 1) {
                                            simpleClassMatches =
                                                1 - simpleClassMatches;
                                        }
                                        if (simpleClassMatches === 1) {
                                            simpleClassResult = 1;
                                            simpleClassSourceIndex =
                                                regexpTestSourceLength;
                                        } else simpleClassSourceIndex =
                                            simpleClassSourceIndex + 1;
                                    }
                                    regexpTestResult = simpleClassResult;
                                    regexpTestSourceIndex =
                                        regexpTestSourceLength;
                                    regexpTestValid = 2;
                                }
                            }
                        }
                    }
                    if (regexpTestValid === 1) {
                        if (regexpTestPatternLength < 4) regexpTestValid = 0;
                    }
                    if (regexpTestValid === 1) {
                        if ((stringCharacterCodeUnit(heapBase,
                            regexpTestPattern, 0) & 65535) !== 94) {
                            regexpTestValid = 0;
                        }
                        if ((stringCharacterCodeUnit(heapBase,
                            regexpTestPattern,
                            regexpTestPatternLength - 1) & 65535) !== 36) {
                            regexpTestValid = 0;
                        }
                    }
                    var regexpTestPatternIndex = 1;
                    if (regexpTestValid === 1) {
                        regexpTestSourceLength = stringLength(
                            heapBase, regexpTestSource);
                    }
                    while (regexpTestValid === 1) {
                        if (regexpTestPatternIndex >=
                            regexpTestPatternLength - 1) {
                            regexpTestValid = 2;
                        } else {
                            if ((stringCharacterCodeUnit(heapBase,
                                regexpTestPattern,
                                regexpTestPatternIndex) & 65535) !== 91) {
                                regexpTestValid = 0;
                            }
                            var regexpClassStart =
                                regexpTestPatternIndex + 1;
                            var regexpClassEnd = regexpClassStart;
                            var regexpClassSearching = 1;
                            while (regexpClassSearching === 1) {
                                if (regexpClassEnd >=
                                    regexpTestPatternLength - 1) {
                                    regexpClassSearching = 0;
                                } else if ((stringCharacterCodeUnit(heapBase,
                                    regexpTestPattern, regexpClassEnd) &
                                    65535) === 93) {
                                    regexpClassSearching = 0;
                                } else regexpClassEnd = regexpClassEnd + 1;
                            }
                            if (regexpClassEnd <= regexpClassStart) {
                                regexpTestValid = 0;
                            }
                            regexpTestPatternIndex = regexpClassEnd + 1;
                            var regexpClassRepeats = 0;
                            if (regexpTestPatternIndex <
                                regexpTestPatternLength - 1) {
                                if ((stringCharacterCodeUnit(heapBase,
                                    regexpTestPattern,
                                    regexpTestPatternIndex) & 65535) === 42) {
                                    regexpClassRepeats = 1;
                                    regexpTestPatternIndex =
                                        regexpTestPatternIndex + 1;
                                    if (regexpTestPatternIndex !==
                                        regexpTestPatternLength - 1) {
                                        regexpTestValid = 0;
                                    }
                                }
                            }
                            var regexpClassNeedsCharacter = 1;
                            if (regexpClassRepeats === 1) {
                                regexpClassNeedsCharacter = 0;
                            }
                            if (regexpClassNeedsCharacter === 1) {
                                if (regexpTestSourceIndex >=
                                    regexpTestSourceLength) {
                                    regexpTestResult = 0;
                                }
                            }
                            var regexpClassContinue = 1;
                            while (regexpClassContinue === 1) {
                                if (regexpTestSourceIndex >=
                                    regexpTestSourceLength) {
                                    regexpClassContinue = 0;
                                } else {
                                    var regexpClassCharacter =
                                        stringCharacterCodeUnit(heapBase,
                                        regexpTestSource,
                                        regexpTestSourceIndex) & 65535;
                                    var regexpClassNegated = 0;
                                    var regexpClassIndex = regexpClassStart;
                                    if ((stringCharacterCodeUnit(heapBase,
                                        regexpTestPattern,
                                        regexpClassIndex) & 65535) === 94) {
                                        regexpClassNegated = 1;
                                        regexpClassIndex =
                                            regexpClassIndex + 1;
                                    }
                                    var regexpClassMatches = 0;
                                    while (regexpClassIndex < regexpClassEnd) {
                                        var regexpClassLow =
                                            stringCharacterCodeUnit(heapBase,
                                            regexpTestPattern,
                                            regexpClassIndex) & 65535;
                                        var regexpClassHigh = regexpClassLow;
                                        if (regexpClassIndex + 2 <
                                            regexpClassEnd) {
                                            if ((stringCharacterCodeUnit(
                                                heapBase, regexpTestPattern,
                                                regexpClassIndex + 1) &
                                                65535) === 45) {
                                                regexpClassHigh =
                                                    stringCharacterCodeUnit(
                                                    heapBase,
                                                    regexpTestPattern,
                                                    regexpClassIndex + 2) &
                                                    65535;
                                                regexpClassIndex =
                                                    regexpClassIndex + 2;
                                            }
                                        }
                                        if (regexpClassCharacter >=
                                            regexpClassLow) {
                                            if (regexpClassCharacter <=
                                                regexpClassHigh) {
                                                regexpClassMatches = 1;
                                            }
                                        }
                                        regexpClassIndex =
                                            regexpClassIndex + 1;
                                    }
                                    if (regexpClassNegated === 1) {
                                        regexpClassMatches =
                                            1 - regexpClassMatches;
                                    }
                                    if (regexpClassMatches === 1) {
                                        regexpTestSourceIndex =
                                            regexpTestSourceIndex + 1;
                                        if (regexpClassRepeats === 0) {
                                            regexpClassContinue = 0;
                                        }
                                    } else {
                                        if (regexpClassRepeats === 0) {
                                            regexpTestResult = 0;
                                        }
                                        regexpClassContinue = 0;
                                    }
                                }
                            }
                        }
                    }
                    if (regexpTestValid !== 2) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    if (regexpTestSourceIndex !== regexpTestSourceLength) {
                        regexpTestResult = 0;
                    }
                    store32(intrinsicTarget,
                        VALUE_TAG_FALSE + regexpTestResult);
                    store32(intrinsicTarget + VALUE_CELL_LOW, 0);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_STRING_INDEX_OF) {
                    var indexOfReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var indexOfValid = 1;
                    if (indexOfReceiverIndex < 0) indexOfValid = 0;
                    var indexOfReceiverCell = heapBase + registerCells +
                        indexOfReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(indexOfReceiverCell) !== VALUE_TAG_REFERENCE) {
                        indexOfValid = 0;
                    }
                    var indexOfSource = load32(
                        indexOfReceiverCell + VALUE_CELL_LOW);
                    if (indexOfValid === 1) {
                        if (recordType(heapBase, indexOfSource) !==
                            HEAP_TYPE_STRING) indexOfValid = 0;
                    }
                    var indexOfSearchRegisterCell = heapBase +
                        intrinsicArgumentsVector + VECTOR_CELLS;
                    if (load32(indexOfSearchRegisterCell) !==
                        VALUE_TAG_INT32) indexOfValid = 0;
                    var indexOfSearchRegister = load32(
                        indexOfSearchRegisterCell + VALUE_CELL_LOW);
                    var indexOfSearchCell = heapBase + registerCells +
                        indexOfSearchRegister * VALUE_CELL_BYTES;
                    if (load32(indexOfSearchCell) !== VALUE_TAG_REFERENCE) {
                        indexOfValid = 0;
                    }
                    var indexOfSearch = load32(
                        indexOfSearchCell + VALUE_CELL_LOW);
                    if (indexOfValid === 1) {
                        if (recordType(heapBase, indexOfSearch) !==
                            HEAP_TYPE_STRING) indexOfValid = 0;
                    }
                    var indexOfStart = 0;
                    if (intrinsicArgumentCount > 1) {
                        var indexOfStartRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            VALUE_CELL_BYTES;
                        if (load32(indexOfStartRegisterCell) !==
                            VALUE_TAG_INT32) indexOfValid = 0;
                        var indexOfStartRegister = load32(
                            indexOfStartRegisterCell + VALUE_CELL_LOW);
                        var indexOfStartCell = heapBase + registerCells +
                            indexOfStartRegister * VALUE_CELL_BYTES;
                        var indexOfStartTag = load32(indexOfStartCell);
                        if (indexOfStartTag !== VALUE_TAG_INT32) {
                            if (indexOfStartTag !== VALUE_TAG_DOUBLE) {
                                indexOfValid = 0;
                            }
                        }
                        if (indexOfValid === 1) {
                            indexOfStart = toInt32F64(loadNumberF64(
                                indexOfStartCell + VALUE_CELL_LOW,
                                indexOfStartTag));
                            store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                                    indexOfStart);
                            if (equalF64(loadNumberF64(
                                indexOfStartCell + VALUE_CELL_LOW,
                                indexOfStartTag), loadI32F64(heapBase + state +
                                ENGINE_SCRATCH_LEFT)) === 0) {
                                indexOfValid = 0;
                            }
                        }
                    }
                    if (indexOfValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var indexOfSourceLength = stringLength(
                        heapBase, indexOfSource);
                    var indexOfSearchLength = stringLength(
                        heapBase, indexOfSearch);
                    if (indexOfStart < 0) indexOfStart = 0;
                    if (indexOfStart > indexOfSourceLength) {
                        indexOfStart = indexOfSourceLength;
                    }
                    var indexOfResult = -1;
                    var indexOfCandidate = indexOfStart;
                    while (indexOfCandidate <= indexOfSourceLength -
                           indexOfSearchLength) {
                        var indexOfMatches = 1;
                        var indexOfCharacter = 0;
                        while (indexOfCharacter < indexOfSearchLength) {
                            if ((stringCharacterCodeUnit(heapBase,
                                indexOfSource, indexOfCandidate +
                                indexOfCharacter) & 65535) !==
                                (stringCharacterCodeUnit(heapBase,
                                indexOfSearch, indexOfCharacter) & 65535)) {
                                indexOfMatches = 0;
                                indexOfCharacter = indexOfSearchLength;
                            } else indexOfCharacter = indexOfCharacter + 1;
                        }
                        if (indexOfMatches === 1) {
                            indexOfResult = indexOfCandidate;
                            indexOfCandidate = indexOfSourceLength + 1;
                        } else indexOfCandidate = indexOfCandidate + 1;
                    }
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW, indexOfResult);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_STRING_SUBSTR) {
                    var substrReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var substrValid = 1;
                    if (substrReceiverIndex < 0) substrValid = 0;
                    var substrReceiverCell = heapBase + registerCells +
                        substrReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(substrReceiverCell) !== VALUE_TAG_REFERENCE) {
                        substrValid = 0;
                    }
                    var substrSource = load32(
                        substrReceiverCell + VALUE_CELL_LOW);
                    if (substrValid === 1) {
                        if (recordType(heapBase, substrSource) !==
                            HEAP_TYPE_STRING) substrValid = 0;
                    }
                    var substrSourceLength = 0;
                    if (substrValid === 1) {
                        substrSourceLength = stringLength(
                            heapBase, substrSource);
                    }
                    var substrStart = 0;
                    var substrLength = substrSourceLength;
                    var substrArgumentIndex = 0;
                    while (substrArgumentIndex < intrinsicArgumentCount) {
                        if (substrArgumentIndex < 2) {
                            var substrRegisterCell = heapBase +
                                intrinsicArgumentsVector + VECTOR_CELLS +
                                substrArgumentIndex * VALUE_CELL_BYTES;
                            if (load32(substrRegisterCell) !== VALUE_TAG_INT32) {
                                substrValid = 0;
                            }
                            var substrRegister = load32(
                                substrRegisterCell + VALUE_CELL_LOW);
                            var substrValueCell = heapBase + registerCells +
                                substrRegister * VALUE_CELL_BYTES;
                            var substrValueTag = load32(substrValueCell);
                            if (substrValueTag !== VALUE_TAG_INT32) {
                                if (substrValueTag !== VALUE_TAG_DOUBLE) {
                                    substrValid = 0;
                                }
                            }
                            var substrValue = 0;
                            if (substrValid === 1) {
                                substrValue = toInt32F64(loadNumberF64(
                                    substrValueCell + VALUE_CELL_LOW,
                                    substrValueTag));
                                store32(heapBase + state + ENGINE_SCRATCH_LEFT,
                                        substrValue);
                                if (equalF64(loadNumberF64(
                                    substrValueCell + VALUE_CELL_LOW,
                                    substrValueTag), loadI32F64(heapBase +
                                    state + ENGINE_SCRATCH_LEFT)) === 0) {
                                    substrValid = 0;
                                }
                            }
                            if (substrArgumentIndex === 0) {
                                substrStart = substrValue;
                            } else substrLength = substrValue;
                        }
                        substrArgumentIndex = substrArgumentIndex + 1;
                    }
                    if (substrValid === 1) {
                        if (substrStart < 0) {
                            substrStart = substrSourceLength + substrStart;
                            if (substrStart < 0) substrStart = 0;
                        } else if (substrStart > substrSourceLength) {
                            substrStart = substrSourceLength;
                        }
                        if (substrLength < 0) substrLength = 0;
                        if (substrLength > substrSourceLength - substrStart) {
                            substrLength = substrSourceLength - substrStart;
                        }
                    }
                    if (substrValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var substrResultAddress = 0;
                    if (substrLength === 0) {
                        var substrEmptyCell = heapBase + stringSupport +
                            VECTOR_CELLS + STRING_SUPPORT_EMPTY *
                            VALUE_CELL_BYTES;
                        substrResultAddress = load32(
                            substrEmptyCell + VALUE_CELL_LOW);
                    } else if (substrStart === 0) {
                        if (substrLength === substrSourceLength) {
                            substrResultAddress = substrSource;
                        }
                    }
                    if (substrResultAddress === 0) {
                        var substrBytes =
                            (STRING_CHARS + substrLength * 2 + 7) & -8;
                        substrResultAddress = engineHeapBump(heapBase, state);
                        if (substrResultAddress + substrBytes >
                            engineHeapLimit(heapBase, state)) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        setRecordType(heapBase, substrResultAddress,
                                      HEAP_TYPE_STRING);
                        setRecordSize(heapBase, substrResultAddress,
                                      substrBytes);
                        setRecordMark(heapBase, substrResultAddress, 0);
                        setRecordFlags(heapBase, substrResultAddress, 0);
                        setStringLength(heapBase, substrResultAddress,
                                        substrLength);
                        var substrHash = -2128831035;
                        var substrCopyIndex = 0;
                        while (substrCopyIndex < substrLength) {
                            var substrCode = stringCharacterCodeUnit(
                                heapBase, substrSource,
                                substrStart + substrCopyIndex) & 65535;
                            setStringCharacterByte(heapBase,
                                substrResultAddress, substrCopyIndex * 2,
                                substrCode & 255);
                            setStringCharacterByte(heapBase,
                                substrResultAddress,
                                substrCopyIndex * 2 + 1,
                                (substrCode >>> 8) & 255);
                            substrHash = (substrHash ^ substrCode) * 16777619;
                            substrCopyIndex = substrCopyIndex + 1;
                        }
                        setStringHash(heapBase, substrResultAddress,
                                      substrHash);
                        setEngineHeapBump(heapBase, state,
                            substrResultAddress + substrBytes);
                    }
                    store32(intrinsicTarget, VALUE_TAG_REFERENCE);
                    store32(intrinsicTarget + VALUE_CELL_LOW,
                            substrResultAddress);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                var isCharacterIntrinsic = 0;
                if (intrinsicId === INTRINSIC_STRING_CHAR_AT) {
                    isCharacterIntrinsic = 1;
                } else if (intrinsicId === INTRINSIC_STRING_CHAR_CODE_AT) {
                    isCharacterIntrinsic = 1;
                }
                if (isCharacterIntrinsic === 1) {
                    var charAtReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var charAtValid = 1;
                    if (charAtReceiverIndex < 0) charAtValid = 0;
                    var charAtReceiverCell = heapBase + registerCells +
                        charAtReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(charAtReceiverCell) !== VALUE_TAG_REFERENCE) {
                        charAtValid = 0;
                    }
                    var charAtString = load32(
                        charAtReceiverCell + VALUE_CELL_LOW);
                    if (charAtValid === 1) {
                        if (recordType(heapBase, charAtString) !==
                            HEAP_TYPE_STRING) charAtValid = 0;
                    }
                    var charAtIndex = 0;
                    if (intrinsicArgumentCount > 0) {
                        var charAtRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS;
                        if (load32(charAtRegisterCell) !== VALUE_TAG_INT32) {
                            charAtValid = 0;
                        }
                        var charAtRegister = load32(
                            charAtRegisterCell + VALUE_CELL_LOW);
                        var charAtIndexCell = heapBase + registerCells +
                            charAtRegister * VALUE_CELL_BYTES;
                        var charAtIndexTag = load32(charAtIndexCell);
                        if (charAtIndexTag !== VALUE_TAG_INT32) {
                            if (charAtIndexTag !== VALUE_TAG_DOUBLE) {
                                charAtValid = 0;
                            }
                        }
                        if (charAtValid === 1) {
                            if (equalF64(loadNumberF64(
                                charAtIndexCell + VALUE_CELL_LOW,
                                charAtIndexTag), loadNumberF64(
                                charAtIndexCell + VALUE_CELL_LOW,
                                charAtIndexTag)) === 0) {
                                charAtIndex = 0;
                            } else {
                                charAtIndex = toInt32F64(loadNumberF64(
                                    charAtIndexCell + VALUE_CELL_LOW,
                                    charAtIndexTag));
                            }
                        }
                    }
                    var charAtSupportIndex = STRING_SUPPORT_EMPTY;
                    var charAtInRange = 0;
                    var charAtCode = 0;
                    if (charAtValid === 1) {
                        if (charAtIndex >= 0) {
                            if (charAtIndex < stringLength(
                                heapBase, charAtString)) {
                                charAtInRange = 1;
                                charAtCode = stringCharacterCodeUnit(
                                    heapBase, charAtString, charAtIndex) & 65535;
                                if (intrinsicId === INTRINSIC_STRING_CHAR_AT) {
                                    if (charAtCode > 255) charAtValid = 0;
                                    else charAtSupportIndex =
                                        STRING_SUPPORT_ASCII_BASE + charAtCode;
                                }
                            }
                        }
                    }
                    if (charAtValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    if (intrinsicId === INTRINSIC_STRING_CHAR_CODE_AT) {
                        if (charAtInRange === 1) {
                            store32(intrinsicTarget, VALUE_TAG_INT32);
                            store32(intrinsicTarget + VALUE_CELL_LOW,
                                    charAtCode);
                            store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                        } else {
                            store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                            store32(intrinsicTarget + VALUE_CELL_LOW, 0);
                            store32(intrinsicTarget + VALUE_CELL_HIGH,
                                    2146959360);
                        }
                    } else {
                        var charAtResultCell = heapBase + stringSupport +
                            VECTOR_CELLS + charAtSupportIndex * VALUE_CELL_BYTES;
                        store32(intrinsicTarget, VALUE_TAG_REFERENCE);
                        store32(intrinsicTarget + VALUE_CELL_LOW,
                            load32(charAtResultCell + VALUE_CELL_LOW));
                        store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    }
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId === INTRINSIC_BUFFER_SLICE) {
                    var sliceReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var sliceValid = 1;
                    if (sliceReceiverIndex < 0) sliceValid = 0;
                    var sliceReceiverCell = heapBase + registerCells +
                        sliceReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(sliceReceiverCell) !== VALUE_TAG_REFERENCE) {
                        sliceValid = 0;
                    }
                    var sliceReceiver = load32(
                        sliceReceiverCell + VALUE_CELL_LOW);
                    if (sliceValid === 1) {
                        if (recordType(heapBase, sliceReceiver) !==
                            HEAP_TYPE_BUFFER_VIEW) sliceValid = 0;
                    }
                    var sliceLength = 0;
                    if (sliceValid === 1) {
                        sliceLength = bufferViewLength(
                            heapBase, sliceReceiver);
                    }
                    var sliceStart = 0;
                    var sliceEnd = sliceLength;
                    var sliceArgumentIndex = 0;
                    while (sliceArgumentIndex < intrinsicArgumentCount) {
                        if (sliceArgumentIndex >= 2) sliceValid = 0;
                        var sliceRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS +
                            sliceArgumentIndex * VALUE_CELL_BYTES;
                        if (load32(sliceRegisterCell) !== VALUE_TAG_INT32) {
                            sliceValid = 0;
                        }
                        var sliceRegister = load32(
                            sliceRegisterCell + VALUE_CELL_LOW);
                        var sliceValueCell = heapBase + registerCells +
                            sliceRegister * VALUE_CELL_BYTES;
                        var sliceValueTag = load32(sliceValueCell);
                        if (sliceValueTag !== VALUE_TAG_INT32) {
                            if (sliceValueTag !== VALUE_TAG_DOUBLE) {
                                sliceValid = 0;
                            }
                        }
                        var sliceValue = toInt32F64(loadNumberF64(
                            sliceValueCell + VALUE_CELL_LOW, sliceValueTag));
                        if (sliceValue < 0) sliceValue = sliceLength + sliceValue;
                        if (sliceValue < 0) sliceValue = 0;
                        else if (sliceValue > sliceLength) {
                            sliceValue = sliceLength;
                        }
                        if (sliceArgumentIndex === 0) sliceStart = sliceValue;
                        else sliceEnd = sliceValue;
                        sliceArgumentIndex = sliceArgumentIndex + 1;
                    }
                    if (sliceEnd < sliceStart) sliceEnd = sliceStart;
                    var sliceView = engineHeapBump(heapBase, state);
                    if (sliceView + BUFFER_VIEW_RECORD_BYTES >
                        engineHeapLimit(heapBase, state)) sliceValid = 0;
                    if (sliceValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    setRecordType(heapBase, sliceView, HEAP_TYPE_BUFFER_VIEW);
                    setRecordSize(heapBase, sliceView, BUFFER_VIEW_RECORD_BYTES);
                    setRecordMark(heapBase, sliceView, 0);
                    setRecordFlags(heapBase, sliceView, 0);
                    setBufferViewBacking(heapBase, sliceView,
                        bufferViewBacking(heapBase, sliceReceiver));
                    setBufferViewOffset(heapBase, sliceView,
                        bufferViewOffset(heapBase, sliceReceiver) + sliceStart);
                    setBufferViewLength(heapBase, sliceView,
                        sliceEnd - sliceStart);
                    setBufferViewPrototype(heapBase, sliceView,
                        bufferViewPrototype(heapBase, sliceReceiver));
                    setBufferViewPropertyHead(heapBase, sliceView, 0);
                    setEngineHeapBump(heapBase, state,
                        sliceView + BUFFER_VIEW_RECORD_BYTES);
                    store32(intrinsicTarget, VALUE_TAG_REFERENCE);
                    store32(intrinsicTarget + VALUE_CELL_LOW, sliceView);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                if (intrinsicId >= INTRINSIC_BUFFER_READ_U32_LE) {
                    var bufferReceiverIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var bufferReceiverValid = 1;
                    if (bufferReceiverIndex < 0) bufferReceiverValid = 0;
                    var bufferReceiverCell = heapBase + registerCells +
                        bufferReceiverIndex * VALUE_CELL_BYTES;
                    if (load32(bufferReceiverCell) !== VALUE_TAG_REFERENCE) {
                        bufferReceiverValid = 0;
                    }
                    var bufferView = load32(
                        bufferReceiverCell + VALUE_CELL_LOW);
                    if (bufferReceiverValid === 1) {
                        if (load32(heapBase + bufferView) !==
                            HEAP_TYPE_BUFFER_VIEW) bufferReceiverValid = 0;
                    }
                    var bufferOffsetRegisterCell = heapBase +
                        intrinsicArgumentsVector + VECTOR_CELLS;
                    var bufferWriteAccess = 0;
                    if (intrinsicId === INTRINSIC_BUFFER_WRITE_U32_LE) {
                        bufferWriteAccess = 1;
                    } else if (intrinsicId >=
                               INTRINSIC_BUFFER_WRITE_U16_LE) {
                        bufferWriteAccess = 1;
                    }
                    if (bufferWriteAccess === 1) {
                        bufferOffsetRegisterCell = bufferOffsetRegisterCell +
                                                   VALUE_CELL_BYTES;
                    }
                    if (load32(bufferOffsetRegisterCell) !== VALUE_TAG_INT32) {
                        bufferReceiverValid = 0;
                    }
                    var bufferOffsetRegister = load32(
                        bufferOffsetRegisterCell + VALUE_CELL_LOW);
                    var bufferOffsetCell = heapBase + registerCells +
                        bufferOffsetRegister * VALUE_CELL_BYTES;
                    var bufferOffsetTag = load32(bufferOffsetCell);
                    if (bufferOffsetTag !== VALUE_TAG_INT32) {
                        if (bufferOffsetTag !== VALUE_TAG_DOUBLE) {
                            bufferReceiverValid = 0;
                        }
                    }
                    var bufferOffset = toInt32F64(loadNumberF64(
                        bufferOffsetCell + VALUE_CELL_LOW, bufferOffsetTag));
                    var bufferLength = bufferViewLength(heapBase, bufferView);
                    var bufferAccessBytes = WORD_BYTES;
                    if (intrinsicId >= INTRINSIC_BUFFER_READ_U16_LE) {
                        bufferAccessBytes = 2;
                    }
                    if (bufferOffset < 0) bufferReceiverValid = 0;
                    else if (bufferOffset + bufferAccessBytes > bufferLength) {
                        bufferReceiverValid = 0;
                    }
                    var bufferBacking = bufferViewBacking(heapBase, bufferView);
                    var bufferPointer = bufferBackingPointer(
                        heapBase, bufferBacking);
                    if (bufferPointer === 0) bufferReceiverValid = 0;
                    if (bufferReceiverValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var bufferAddress = bufferPointer + bufferViewOffset(
                        heapBase, bufferView) + bufferOffset;
                    if (intrinsicId === INTRINSIC_BUFFER_READ_U32_LE) {
                        var bufferReadValue = loadRaw32(bufferAddress);
                        if (bufferReadValue < 0) {
                            var bufferReadMantissa = bufferReadValue &
                                                     IEEE754_ABSOLUTE_MASK;
                            store32(intrinsicTarget, VALUE_TAG_DOUBLE);
                            store32(intrinsicTarget + VALUE_CELL_LOW,
                                bufferReadMantissa <<
                                UINT32_MANTISSA_LOW_SHIFT);
                            store32(intrinsicTarget + VALUE_CELL_HIGH,
                                POSITIVE_2147483648_HIGH |
                                (bufferReadMantissa >>>
                                 UINT32_MANTISSA_HIGH_SHIFT));
                        } else {
                            store32(intrinsicTarget, VALUE_TAG_INT32);
                            store32(intrinsicTarget + VALUE_CELL_LOW,
                                    bufferReadValue);
                            store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                        }
                    } else if (intrinsicId ===
                               INTRINSIC_BUFFER_READ_U16_LE) {
                        store32(intrinsicTarget, VALUE_TAG_INT32);
                        store32(intrinsicTarget + VALUE_CELL_LOW,
                            loadRaw8(bufferAddress) |
                            (loadRaw8(bufferAddress + 1) << 8));
                        store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    } else if (intrinsicId ===
                               INTRINSIC_BUFFER_READ_U16_BE) {
                        store32(intrinsicTarget, VALUE_TAG_INT32);
                        store32(intrinsicTarget + VALUE_CELL_LOW,
                            (loadRaw8(bufferAddress) << 8) |
                            loadRaw8(bufferAddress + 1));
                        store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    } else {
                        var bufferValueRegisterCell = heapBase +
                            intrinsicArgumentsVector + VECTOR_CELLS;
                        if (load32(bufferValueRegisterCell) !== VALUE_TAG_INT32) {
                            store32(heapBase + state + ENGINE_EXIT_REASON,
                                    EXIT_UNSUPPORTED);
                            store32(heapBase + state + ENGINE_PC, pc);
                            store32(heapBase + state + ENGINE_RESULT, opcode);
                            store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                    instructions);
                            store32(heapBase + framePC, pc);
                            return EXIT_UNSUPPORTED;
                        }
                        var bufferValueRegister = load32(
                            bufferValueRegisterCell + VALUE_CELL_LOW);
                        var bufferValueCell = heapBase + registerCells +
                            bufferValueRegister * VALUE_CELL_BYTES;
                        var bufferValueTag = load32(bufferValueCell);
                        if (bufferValueTag !== VALUE_TAG_INT32) {
                            if (bufferValueTag !== VALUE_TAG_DOUBLE) {
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
                        var bufferWriteValue = toInt32F64(loadNumberF64(
                            bufferValueCell + VALUE_CELL_LOW, bufferValueTag));
                        if (intrinsicId ===
                            INTRINSIC_BUFFER_WRITE_U32_LE) {
                            storeRaw32(bufferAddress, bufferWriteValue);
                        } else {
                            storeRaw8(bufferAddress, bufferWriteValue);
                            storeRaw8(bufferAddress + 1,
                                      bufferWriteValue >> 8);
                        }
                        store32(intrinsicTarget, VALUE_TAG_INT32);
                        store32(intrinsicTarget + VALUE_CELL_LOW,
                                bufferOffset + bufferAccessBytes);
                        store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    }
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                    intrinsicHandled = 1;
                }
                }
                if (intrinsicHandled === 0) {
                var intrinsicPointerRegisterCell = heapBase +
                    intrinsicArgumentsVector + VECTOR_CELLS;
                if (load32(intrinsicPointerRegisterCell) !== VALUE_TAG_INT32) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var intrinsicPointerRegister = load32(
                    intrinsicPointerRegisterCell + VALUE_CELL_LOW);
                var intrinsicPointerCell = heapBase + registerCells +
                    intrinsicPointerRegister * VALUE_CELL_BYTES;
                var intrinsicPointerTag = load32(intrinsicPointerCell);
                if (intrinsicPointerTag !== VALUE_TAG_INT32) {
                    if (intrinsicPointerTag !== VALUE_TAG_DOUBLE) {
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
                var intrinsicPointer = toInt32F64(loadNumberF64(
                    intrinsicPointerCell + VALUE_CELL_LOW,
                    intrinsicPointerTag));
                if (intrinsicId === INTRINSIC_PEEK8) {
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW,
                            loadRaw8(intrinsicPointer));
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                } else if (intrinsicId === INTRINSIC_PEEK32) {
                    store32(intrinsicTarget, VALUE_TAG_INT32);
                    store32(intrinsicTarget + VALUE_CELL_LOW,
                            loadRaw32(intrinsicPointer));
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                } else {
                    var intrinsicValueRegisterCell =
                        intrinsicPointerRegisterCell + VALUE_CELL_BYTES;
                    if (load32(intrinsicValueRegisterCell) !== VALUE_TAG_INT32) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var intrinsicValueRegister = load32(
                        intrinsicValueRegisterCell + VALUE_CELL_LOW);
                    var intrinsicValueCell = heapBase + registerCells +
                        intrinsicValueRegister * VALUE_CELL_BYTES;
                    var intrinsicValueTag = load32(intrinsicValueCell);
                    if (intrinsicValueTag !== VALUE_TAG_INT32) {
                        if (intrinsicValueTag !== VALUE_TAG_DOUBLE) {
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
                    var intrinsicValue = toInt32F64(loadNumberF64(
                        intrinsicValueCell + VALUE_CELL_LOW,
                        intrinsicValueTag));
                    if (intrinsicId === INTRINSIC_POKE8) {
                        storeRaw8(intrinsicPointer, intrinsicValue);
                    } else storeRaw32(intrinsicPointer, intrinsicValue);
                    store32(intrinsicTarget, VALUE_TAG_UNDEFINED);
                    store32(intrinsicTarget + VALUE_CELL_LOW, 0);
                    store32(intrinsicTarget + VALUE_CELL_HIGH, 0);
                    store32(intrinsicTarget + VALUE_CELL_AUX, 0);
                }
                }
                pc = pc + FIVE_WORD_INSTRUCTION;
                }
            } else if (opcode === OP_RETURN) {
                var returnIndex = load32(heapBase + bytecodeWords + (pc + FIRST_OPERAND) * WORD_BYTES);
                var nativeCallerFrame = load32(
                    heapBase + frame + FRAME_CALLER);
                var nativeFrameFlags = load32(
                    heapBase + frame + RECORD_FLAGS);
                var returnInsideNativeEngine = 0;
                if (nativeCallerFrame !== 0) {
                    if (nativeFrameFlags === FRAME_FLAG_NATIVE_CALL) {
                        returnInsideNativeEngine = 1;
                    }
                }
                if (returnInsideNativeEngine === 1) {
                    var nativeReturnSlot = load32(
                        heapBase + frame + FRAME_RETURN_SLOT);
                    var nativeReturnSource = heapBase + registerCells +
                        returnIndex * VALUE_CELL_BYTES;
                    var nativeReturnTarget = heapBase + nativeCallerFrame +
                        FRAME_REGISTERS + nativeReturnSlot * VALUE_CELL_BYTES;
                    store32(nativeReturnTarget, load32(nativeReturnSource));
                    store32(nativeReturnTarget + VALUE_CELL_LOW,
                            load32(nativeReturnSource + VALUE_CELL_LOW));
                    store32(nativeReturnTarget + VALUE_CELL_HIGH,
                            load32(nativeReturnSource + VALUE_CELL_HIGH));
                    store32(nativeReturnTarget + VALUE_CELL_AUX,
                            load32(nativeReturnSource + VALUE_CELL_AUX));
                    var returnedNativeFrame = frame;
                    var nativeFreeFrame = load32(
                        heapBase + state + ENGINE_FREE_FRAME);
                    store32(heapBase + returnedNativeFrame + RECORD_TYPE,
                            HEAP_TYPE_FREE);
                    store32(heapBase + returnedNativeFrame + FRAME_PROGRAM,
                            nativeFreeFrame);
                    store32(heapBase + state + ENGINE_FREE_FRAME,
                            returnedNativeFrame);
                    frame = nativeCallerFrame;
                    store32(heapBase + state + ENGINE_CURRENT_FRAME, frame);
                    currentContext = load32(
                        heapBase + frame + FRAME_CONTEXT);
                    currentProgram = load32(
                        heapBase + frame + FRAME_PROGRAM);
                    bytecodeWords = load32(
                        heapBase + currentProgram + PROGRAM_BYTECODE) +
                        BYTECODE_WORDS;
                    constantCells = load32(
                        heapBase + currentProgram + PROGRAM_CONSTANTS) +
                        VECTOR_CELLS;
                    globalObject = load32(
                        heapBase + currentContext + CONTEXT_GLOBAL);
                    framePC = frame + FRAME_PC;
                    registerCells = frame + FRAME_REGISTERS;
                    environment = load32(
                        heapBase + frame + FRAME_ENVIRONMENT);
                    pc = load32(heapBase + framePC);
                } else {
                store32(heapBase + state + ENGINE_EXIT_REASON, EXIT_RETURN);
                store32(heapBase + state + ENGINE_PC, pc);
                store32(heapBase + state + ENGINE_RESULT, registerCells + returnIndex * VALUE_CELL_BYTES);
                store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions + 1);
                store32(heapBase + framePC, pc);
                return EXIT_RETURN;
                }
            } else if (opcode === OP_MAKE_OBJECT) {
                var makeObjectTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var makeObjectAddress = load32(
                    heapBase + state + ENGINE_HEAP_BUMP);
                var makeObjectLimit = load32(
                    heapBase + state + ENGINE_HEAP_LIMIT);
                if (makeObjectAddress + OBJECT_RECORD_BYTES > makeObjectLimit) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                store32(heapBase + makeObjectAddress + RECORD_TYPE,
                        HEAP_TYPE_OBJECT);
                store32(heapBase + makeObjectAddress + RECORD_SIZE,
                        OBJECT_RECORD_BYTES);
                store32(heapBase + makeObjectAddress + RECORD_MARK, 0);
                store32(heapBase + makeObjectAddress + RECORD_FLAGS, 0);
                var makeObjectPrototypeCell = heapBase + stringSupport +
                    VECTOR_CELLS + RUNTIME_SUPPORT_OBJECT_PROTOTYPE *
                    VALUE_CELL_BYTES;
                store32(heapBase + makeObjectAddress + OBJECT_PROTOTYPE,
                    load32(makeObjectPrototypeCell + VALUE_CELL_LOW));
                store32(heapBase + makeObjectAddress + OBJECT_PROPERTY_HEAD, 0);
                store32(heapBase + makeObjectAddress + OBJECT_EXTENSIBLE, 1);
                store32(heapBase + makeObjectAddress + OBJECT_RESERVED, 0);
                var makeObjectTarget = heapBase + registerCells +
                    makeObjectTargetIndex * VALUE_CELL_BYTES;
                store32(makeObjectTarget, VALUE_TAG_REFERENCE);
                store32(makeObjectTarget + VALUE_CELL_LOW, makeObjectAddress);
                store32(makeObjectTarget + VALUE_CELL_HIGH, 0);
                store32(makeObjectTarget + VALUE_CELL_AUX, 0);
                store32(heapBase + state + ENGINE_HEAP_BUMP,
                        makeObjectAddress + OBJECT_RECORD_BYTES);
                pc = pc + TWO_WORD_INSTRUCTION;
            } else if (opcode === OP_MAKE_ARRAY) {
                var makeArrayTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var makeVectorAddress = engineHeapBump(heapBase, state);
                var makeArrayAddress = makeVectorAddress +
                                       INITIAL_VECTOR_RECORD_BYTES;
                var makeArrayLimit = engineHeapLimit(heapBase, state);
                if (makeArrayAddress + ARRAY_RECORD_BYTES > makeArrayLimit) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                setRecordType(heapBase, makeVectorAddress,
                              HEAP_TYPE_VALUE_VECTOR);
                setRecordSize(heapBase, makeVectorAddress,
                              INITIAL_VECTOR_RECORD_BYTES);
                setRecordMark(heapBase, makeVectorAddress, 0);
                setRecordFlags(heapBase, makeVectorAddress, 0);
                setVectorLength(heapBase, makeVectorAddress, 0);
                setVectorCapacity(heapBase, makeVectorAddress,
                                  INITIAL_ARRAY_CAPACITY);
                setRecordType(heapBase, makeArrayAddress, HEAP_TYPE_ARRAY);
                setRecordSize(heapBase, makeArrayAddress, ARRAY_RECORD_BYTES);
                setRecordMark(heapBase, makeArrayAddress, 0);
                setRecordFlags(heapBase, makeArrayAddress, 0);
                setArrayPrototype(heapBase, makeArrayAddress, arrayPrototype);
                setArrayPropertyHead(heapBase, makeArrayAddress, 0);
                setArrayElements(heapBase, makeArrayAddress, makeVectorAddress);
                setArrayReserved(heapBase, makeArrayAddress, 0);
                var makeArrayTarget = heapBase + registerCells +
                    makeArrayTargetIndex * VALUE_CELL_BYTES;
                store32(makeArrayTarget, VALUE_TAG_REFERENCE);
                store32(makeArrayTarget + VALUE_CELL_LOW, makeArrayAddress);
                store32(makeArrayTarget + VALUE_CELL_HIGH, 0);
                store32(makeArrayTarget + VALUE_CELL_AUX, 0);
                setEngineHeapBump(heapBase, state,
                                  makeArrayAddress + ARRAY_RECORD_BYTES);
                pc = pc + TWO_WORD_INSTRUCTION;
            } else if (opcode === OP_MAKE_REGEXP) {
                var makeRegexpTargetIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + FIRST_OPERAND) * WORD_BYTES);
                var makeRegexpPatternIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + SECOND_OPERAND) * WORD_BYTES);
                var makeRegexpFlagsIndex = load32(
                    heapBase + bytecodeWords +
                    (pc + THIRD_OPERAND) * WORD_BYTES);
                var makeRegexpAddress = engineHeapBump(heapBase, state);
                if (makeRegexpAddress + REGEXP_RECORD_BYTES >
                    engineHeapLimit(heapBase, state)) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS,
                            instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                var makeRegexpPatternCell = heapBase + constantCells +
                    makeRegexpPatternIndex * VALUE_CELL_BYTES;
                var makeRegexpFlagsCell = heapBase + constantCells +
                    makeRegexpFlagsIndex * VALUE_CELL_BYTES;
                var makeRegexpConstantsValid = 1;
                if (load32(makeRegexpPatternCell) !== VALUE_TAG_REFERENCE) {
                    makeRegexpConstantsValid = 0;
                }
                if (load32(makeRegexpFlagsCell) !== VALUE_TAG_REFERENCE) {
                    makeRegexpConstantsValid = 0;
                }
                if (makeRegexpConstantsValid === 0) {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS,
                            instructions);
                    store32(heapBase + framePC, pc);
                    return EXIT_UNSUPPORTED;
                }
                setRecordType(heapBase, makeRegexpAddress, HEAP_TYPE_REGEXP);
                setRecordSize(heapBase, makeRegexpAddress,
                              REGEXP_RECORD_BYTES);
                setRecordMark(heapBase, makeRegexpAddress, 0);
                setRecordFlags(heapBase, makeRegexpAddress, 0);
                setRegexpPattern(heapBase, makeRegexpAddress,
                    load32(makeRegexpPatternCell + VALUE_CELL_LOW));
                setRegexpFlags(heapBase, makeRegexpAddress,
                    load32(makeRegexpFlagsCell + VALUE_CELL_LOW));
                var makeRegexpPrototypeCell = heapBase + stringSupport +
                    VECTOR_CELLS + RUNTIME_SUPPORT_REGEXP_PROTOTYPE *
                    VALUE_CELL_BYTES;
                setRegexpPrototype(heapBase, makeRegexpAddress,
                    load32(makeRegexpPrototypeCell + VALUE_CELL_LOW));
                setRegexpPropertyHead(heapBase, makeRegexpAddress, 0);
                var makeRegexpTarget = heapBase + registerCells +
                    makeRegexpTargetIndex * VALUE_CELL_BYTES;
                store32(makeRegexpTarget, VALUE_TAG_REFERENCE);
                store32(makeRegexpTarget + VALUE_CELL_LOW,
                        makeRegexpAddress);
                store32(makeRegexpTarget + VALUE_CELL_HIGH, 0);
                store32(makeRegexpTarget + VALUE_CELL_AUX, 0);
                setEngineHeapBump(heapBase, state,
                    makeRegexpAddress + REGEXP_RECORD_BYTES);
                pc = pc + FOUR_WORD_INSTRUCTION;
            } else if (opcode <= OP_BIT_NOT) {
                if (opcode >= OP_BIT_AND) {
                    if (opcode <= OP_SHIFT_UNSIGNED_RIGHT) {
                    var bitTargetIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + FIRST_OPERAND) * WORD_BYTES);
                    var bitLeftIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + SECOND_OPERAND) * WORD_BYTES);
                    var bitRightIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + THIRD_OPERAND) * WORD_BYTES);
                    var bitTarget = heapBase + registerCells +
                                    bitTargetIndex * VALUE_CELL_BYTES;
                    var bitLeft = heapBase + registerCells +
                                  bitLeftIndex * VALUE_CELL_BYTES;
                    var bitRight = heapBase + registerCells +
                                   bitRightIndex * VALUE_CELL_BYTES;
                    var bitLeftTag = load32(bitLeft);
                    var bitRightTag = load32(bitRight);
                    var bitValid = 0;
                    if (bitLeftTag === VALUE_TAG_INT32) bitValid = 1;
                    else if (bitLeftTag === VALUE_TAG_DOUBLE) bitValid = 1;
                    if (bitRightTag !== VALUE_TAG_INT32) {
                        if (bitRightTag !== VALUE_TAG_DOUBLE) bitValid = 0;
                    }
                    if (bitValid === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    var bitLeftValue = toInt32F64(loadNumberF64(
                        bitLeft + VALUE_CELL_LOW, bitLeftTag));
                    var bitRightValue = toInt32F64(loadNumberF64(
                        bitRight + VALUE_CELL_LOW, bitRightTag));
                    var bitResult = 0;
                    if (opcode === OP_BIT_AND) {
                        bitResult = bitLeftValue & bitRightValue;
                    } else if (opcode === OP_BIT_OR) {
                        bitResult = bitLeftValue | bitRightValue;
                    } else if (opcode === OP_BIT_XOR) {
                        bitResult = bitLeftValue ^ bitRightValue;
                    } else if (opcode === OP_SHIFT_LEFT) {
                        bitResult = bitLeftValue << bitRightValue;
                    } else if (opcode === OP_SHIFT_RIGHT) {
                        bitResult = bitLeftValue >> bitRightValue;
                    } else {
                        bitResult = bitLeftValue >>> bitRightValue;
                    }
                    if (opcode === OP_SHIFT_UNSIGNED_RIGHT) {
                        if (bitResult < 0) {
                            var unsignedMantissa = bitResult &
                                                   IEEE754_ABSOLUTE_MASK;
                            store32(bitTarget, VALUE_TAG_DOUBLE);
                            store32(bitTarget + VALUE_CELL_LOW,
                                    unsignedMantissa <<
                                    UINT32_MANTISSA_LOW_SHIFT);
                            store32(bitTarget + VALUE_CELL_HIGH,
                                    POSITIVE_2147483648_HIGH |
                                    (unsignedMantissa >>>
                                     UINT32_MANTISSA_HIGH_SHIFT));
                        } else {
                            store32(bitTarget, VALUE_TAG_INT32);
                            store32(bitTarget + VALUE_CELL_LOW, bitResult);
                            store32(bitTarget + VALUE_CELL_HIGH, 0);
                        }
                    } else {
                        store32(bitTarget, VALUE_TAG_INT32);
                        store32(bitTarget + VALUE_CELL_LOW, bitResult);
                        store32(bitTarget + VALUE_CELL_HIGH, 0);
                    }
                    store32(bitTarget + VALUE_CELL_AUX, 0);
                    pc = pc + FOUR_WORD_INSTRUCTION;
                    } else if (opcode === OP_BIT_NOT) {
                    var bitNotTargetIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + FIRST_OPERAND) * WORD_BYTES);
                    var bitNotSourceIndex = load32(
                        heapBase + bytecodeWords +
                        (pc + SECOND_OPERAND) * WORD_BYTES);
                    var bitNotSource = heapBase + registerCells +
                        bitNotSourceIndex * VALUE_CELL_BYTES;
                    var bitNotTag = load32(bitNotSource);
                    if (bitNotTag !== VALUE_TAG_INT32) {
                        if (bitNotTag !== VALUE_TAG_DOUBLE) {
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
                    var bitNotTarget = heapBase + registerCells +
                        bitNotTargetIndex * VALUE_CELL_BYTES;
                    store32(bitNotTarget, VALUE_TAG_INT32);
                    store32(bitNotTarget + VALUE_CELL_LOW,
                        ~toInt32F64(loadNumberF64(
                            bitNotSource + VALUE_CELL_LOW, bitNotTag)));
                    store32(bitNotTarget + VALUE_CELL_HIGH, 0);
                    store32(bitNotTarget + VALUE_CELL_AUX, 0);
                    pc = pc + THREE_WORD_INSTRUCTION;
                    } else {
                    store32(heapBase + state + ENGINE_EXIT_REASON,
                            EXIT_UNSUPPORTED);
                    store32(heapBase + state + ENGINE_PC, pc);
                    store32(heapBase + state + ENGINE_RESULT, opcode);
                    store32(heapBase + state + ENGINE_INSTRUCTIONS, instructions);
                    store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
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
                var virtualPropertyObjectType = recordType(
                    heapBase, propertyObject);
                if (virtualPropertyObjectType === HEAP_TYPE_ARRAY) {
                    if (propertyKey === arrayLengthKey) {
                        var propertyArrayVector = arrayElements(
                            heapBase, propertyObject);
                        var propertyLengthTarget = heapBase + registerCells +
                            propertyTargetIndex * VALUE_CELL_BYTES;
                        store32(propertyLengthTarget, VALUE_TAG_INT32);
                        store32(propertyLengthTarget + VALUE_CELL_LOW,
                            vectorLength(heapBase, propertyArrayVector));
                        store32(propertyLengthTarget + VALUE_CELL_HIGH, 0);
                        store32(propertyLengthTarget + VALUE_CELL_AUX, 0);
                        propertyRecord = PROPERTY_FOUND_SENTINEL;
                        propertyObject = 0;
                    }
                } else if (virtualPropertyObjectType ===
                           HEAP_TYPE_BUFFER_VIEW) {
                    if (propertyKey === arrayLengthKey) {
                        var bufferLengthTarget = heapBase + registerCells +
                            propertyTargetIndex * VALUE_CELL_BYTES;
                        store32(bufferLengthTarget, VALUE_TAG_INT32);
                        store32(bufferLengthTarget + VALUE_CELL_LOW,
                            bufferViewLength(heapBase, propertyObject));
                        store32(bufferLengthTarget + VALUE_CELL_HIGH, 0);
                        store32(bufferLengthTarget + VALUE_CELL_AUX, 0);
                        propertyRecord = PROPERTY_FOUND_SENTINEL;
                        propertyObject = 0;
                    }
                } else if (virtualPropertyObjectType === HEAP_TYPE_STRING) {
                    if (propertyKey === arrayLengthKey) {
                        var stringLengthTarget = heapBase + registerCells +
                            propertyTargetIndex * VALUE_CELL_BYTES;
                        store32(stringLengthTarget, VALUE_TAG_INT32);
                        store32(stringLengthTarget + VALUE_CELL_LOW,
                            stringLength(heapBase, propertyObject));
                        store32(stringLengthTarget + VALUE_CELL_HIGH, 0);
                        store32(stringLengthTarget + VALUE_CELL_AUX, 0);
                        propertyRecord = PROPERTY_FOUND_SENTINEL;
                        propertyObject = 0;
                    } else {
                        var constantStringPrototypeCell = heapBase +
                            stringSupport + VECTOR_CELLS +
                            RUNTIME_SUPPORT_STRING_PROTOTYPE *
                            VALUE_CELL_BYTES;
                        propertyObject = load32(
                            constantStringPrototypeCell + VALUE_CELL_LOW);
                    }
                }
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
                if (propertyRecord !== PROPERTY_FOUND_SENTINEL) {
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
                }
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
                var setPropertyHeadOffset = 0;
                if (setPropertyObjectType >= HEAP_TYPE_OBJECT) {
                    if (setPropertyObjectType <= HEAP_TYPE_BYTECODE_FUNCTION) {
                        setPropertyHead = load32(
                            heapBase + setPropertyObject + OBJECT_PROPERTY_HEAD);
                        setPropertyHeadOffset = OBJECT_PROPERTY_HEAD;
                    }
                }
                if (setPropertyObjectType === HEAP_TYPE_REGEXP) {
                    setPropertyHead = load32(
                        heapBase + setPropertyObject + REGEXP_PROPERTY_HEAD);
                    setPropertyHeadOffset = REGEXP_PROPERTY_HEAD;
                } else if (setPropertyObjectType === HEAP_TYPE_BUFFER_VIEW) {
                    setPropertyHead = load32(
                        heapBase + setPropertyObject + BUFFER_VIEW_PROPERTY_HEAD);
                    setPropertyHeadOffset = BUFFER_VIEW_PROPERTY_HEAD;
                }
                var setPropertyKey = load32(
                    setPropertyKeyCell + VALUE_CELL_LOW);
                var setPropertyRecord = 0;
                var setPropertyFirst = setPropertyHead;
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
                    if (setPropertyHeadOffset === 0) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    setPropertyRecord = load32(
                        heapBase + state + ENGINE_HEAP_BUMP);
                    if (setPropertyRecord + PROPERTY_RECORD_BYTES > load32(
                        heapBase + state + ENGINE_HEAP_LIMIT)) {
                        store32(heapBase + state + ENGINE_EXIT_REASON,
                                EXIT_UNSUPPORTED);
                        store32(heapBase + state + ENGINE_PC, pc);
                        store32(heapBase + state + ENGINE_RESULT, opcode);
                        store32(heapBase + state + ENGINE_INSTRUCTIONS,
                                instructions);
                        store32(heapBase + framePC, pc);
                        return EXIT_UNSUPPORTED;
                    }
                    store32(heapBase + setPropertyRecord + RECORD_TYPE,
                            HEAP_TYPE_PROPERTY);
                    store32(heapBase + setPropertyRecord + RECORD_SIZE,
                            PROPERTY_RECORD_BYTES);
                    store32(heapBase + setPropertyRecord + RECORD_MARK, 0);
                    store32(heapBase + setPropertyRecord + RECORD_FLAGS, 0);
                    store32(heapBase + setPropertyRecord + PROPERTY_NEXT,
                            setPropertyFirst);
                    store32(heapBase + setPropertyRecord + PROPERTY_KEY,
                            setPropertyKey);
                    store32(heapBase + setPropertyRecord + PROPERTY_ATTRIBUTES,
                            DEFAULT_PROPERTY_ATTRIBUTES);
                    store32(heapBase + setPropertyRecord + PROPERTY_RESERVED, 0);
                    store32(heapBase + setPropertyObject + setPropertyHeadOffset,
                            setPropertyRecord);
                    store32(heapBase + state + ENGINE_HEAP_BUMP,
                            setPropertyRecord + PROPERTY_RECORD_BYTES);
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
        this.ir = new KernelCompiler().compile(interpreterKernel, {
            registerPreferences: ["heapBase", "pc", "bytecodeWords"],
            constantOverrides: {
                PROFILE_OPCODES: runtime.profileOpcodeCounts ? 1 : 0
            }
        });
        this.js = new JSBackend().compile(this.ir);
        this.nativeResult = new X86Backend().compile(this.ir);
        this.stateAddress = runtime.heapRecords.allocateEngineState();
        this.statePayload = runtime.heapRecords.engineStatePayloadAddress(
            this.stateAddress);
        this.platformServicesAddress =
            runtime.heapRecords.allocatePlatformServices();
        runtime.heapRecords.setEnginePlatformServices(
            this.stateAddress, this.platformServicesAddress);
        this.stringSupportAddress = runtime.heapRecords.allocateValueVector(263);
        runtime.valueCells.writeReferenceAt(runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 0), runtime.internStringAddress("charAt"));
        runtime.valueCells.writeReferenceAt(runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 1),
            runtime.stringMethods.charAt.heapAddress);
        runtime.valueCells.writeReferenceAt(runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 2), runtime.internStringAddress(""));
        var characterIndex = 0;
        while (characterIndex < 256) {
            runtime.valueCells.writeReferenceAt(runtime.heapRecords.vectorCell(
                this.stringSupportAddress, characterIndex + 3),
                runtime.internStringAddress(
                    String.fromCharCode(characterIndex)));
            characterIndex++;
        }
        runtime.valueCells.writeReferenceAt(runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 259),
            runtime.bufferSupport.prototype.heapAddress);
        var objectPrototypeSupportCell = runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 260);
        if (runtime.objectPrototype) {
            runtime.valueCells.writeReferenceAt(objectPrototypeSupportCell,
                runtime.objectPrototype.heapAddress);
        } else runtime.writeHeapValue(objectPrototypeSupportCell, undefined);
        var stringPrototypeSupportCell = runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 261);
        if (runtime.stringPrototype) {
            runtime.valueCells.writeReferenceAt(stringPrototypeSupportCell,
                runtime.stringPrototype.heapAddress);
        } else runtime.writeHeapValue(stringPrototypeSupportCell, undefined);
        var regexpPrototypeSupportCell = runtime.heapRecords.vectorCell(
            this.stringSupportAddress, 262);
        if (runtime.regexpPrototype) {
            runtime.valueCells.writeReferenceAt(regexpPrototypeSupportCell,
                runtime.regexpPrototype.heapAddress);
        } else runtime.writeHeapValue(regexpPrototypeSupportCell, undefined);
        runtime.heapRecords.setVectorLength(this.stringSupportAddress, 263);
        this.runCount = 0;
        this.instructionCount = 0;
        this.nativeElapsedMs = 0;
        this.nextInstructionProfileReport = 5000000;
        this.unsupportedExitCount = 0;
        this.unsupportedOpcodeCounts = [];
        this.unsupportedLocationCounts = {};
        this.fallbackCallCounts = {};
        this.fallbackCallLayouts = {};
        this.callRejectCounts = [];
        this.propertyFallbackCounts = {};
        this.allocationRegion = null;
        if (runtime.profileOpcodeCounts) {
            var codeLine = "native guest code: pointer=" +
                this.nativeResult.pointer + " bytes=" + this.nativeResult.length;
            var allocation = this.nativeResult.registerAllocation;
            if (allocation) {
                codeLine += " registers=" +
                    "ebx:" + allocation.ebx + "," +
                    "esi:" + allocation.esi + "," +
                    "edi:" + allocation.edi;
            }
            if (typeof print === "function") print(codeLine);
            else if (typeof console !== "undefined" && console.log) {
                console.log(codeLine);
            }
        }
    }

    NativeInterpreter.Exit = Exit;

    NativeInterpreter.prototype.setDlsymPointer = function (pointer) {
        this.runtime.heapRecords.setPlatformDlsymPointer(
            this.platformServicesAddress, Number(pointer) | 0);
    };

    /* A published native allocation suffix is private only between
     * collections.  Collection rebuilds and coalesces the authoritative free
     * record graph, so retaining its old cursor across that operation would
     * both fragment the heap and leave this object describing pre-collection
     * layout. */
    NativeInterpreter.prototype.releaseAllocationRegionForCollection =
            function () {
        if (!this.allocationRegion) return;
        var heap = this.runtime.linearHeap;
        var remaining = this.allocationRegion.end -
                        this.allocationRegion.cursor;
        if (remaining >= FREE_RECORD_HEADER_BYTES) {
            heap.publishFreeRegion(this.allocationRegion.cursor, remaining, 0);
        }
        this.allocationRegion = null;
        heap.rebuildFreeBlocks();
    };

    NativeInterpreter.prototype.prepareSemanticFallback = function () {
        if (!this.allocationRegion) return;
        var heap = this.runtime.linearHeap;
        /* Most semantic operations allocate nothing and should not disturb
         * the native bump region. If the ordinary allocator has neither tail
         * room nor a useful free block, however, return the reserved suffix
         * before entering host semantics so allocating fallbacks cannot see a
         * false out-of-memory condition. */
        if (heap.bump + MIN_NATIVE_ALLOCATION_REGION_BYTES <=
                heap.allocationLimit ||
            heap.largestFreeBlockSize() >= MIN_NATIVE_ALLOCATION_REGION_BYTES) {
            return;
        }
        this.releaseAllocationRegionForCollection();
    };

    NativeInterpreter.prototype.releaseCachedFramesForCollection = function () {
        var records = this.runtime.heapRecords;
        var heap = this.runtime.linearHeap;
        var frame = records.engineFreeFrame(this.stateAddress);
        records.setEngineFreeFrame(this.stateAddress, 0);
        while (frame) {
            var next = records.cachedFrameNext(frame);
            heap.setFreeRecordFlags(frame, 0);
            frame = next;
        }
        heap.rebuildFreeBlocks();
    };

    NativeInterpreter.prototype.run = function (frame, program, budget, context) {
        var records = this.runtime.heapRecords;
        var contextAddress = context ? context.heapAddress : 0;
        var arrayLengthKey = this.runtime.internStringAddress("length");
        var arrayPrototype = this.runtime.arrayPrototype ?
            this.runtime.arrayPrototype.heapAddress : 0;
        var heap = this.runtime.linearHeap;
        var allocationBump = heap.bump;
        var allocationLimit = heap.allocationLimit;
        if (!this.allocationRegion &&
            heap.bump >= Math.floor(heap.allocationLimit * 3 / 4)) {
            var claimedRegion = heap.claimLargestFreeBlock(
                MIN_NATIVE_ALLOCATION_REGION_BYTES);
            if (claimedRegion) {
                this.allocationRegion = {
                    cursor: claimedRegion.address,
                    end: claimedRegion.address + claimedRegion.size
                };
            }
        }
        if (this.allocationRegion) {
            allocationBump = this.allocationRegion.cursor;
            /* Keep space for a valid free-record header at every yield. */
            allocationLimit = this.allocationRegion.end -
                              FREE_RECORD_HEADER_BYTES;
        }
        records.setEngineHeapBounds(this.stateAddress,
                                    allocationBump, allocationLimit);
        var heapBase = this.runtime.linearHeap.memory.nativeAddress(0);
        var nativeStarted = this.runtime.profileOpcodeCounts ?
            new Date().getTime() : 0;
        var reason = this.nativeResult.fn ? this.nativeResult.fn(
            heapBase, frame, contextAddress, arrayLengthKey, arrayPrototype,
            this.stringSupportAddress, budget, this.statePayload) : this.js.fn(
            this.runtime.linearHeap.memory, 0, frame, contextAddress,
            arrayLengthKey, arrayPrototype, this.stringSupportAddress, budget,
            this.statePayload);
        if (nativeStarted) {
            this.nativeElapsedMs += new Date().getTime() - nativeStarted;
        }
        var nativeHeapBump = records.engineHeapBump(this.stateAddress);
        if (this.allocationRegion) {
            this.allocationRegion.cursor = nativeHeapBump;
            var regionRemaining = this.allocationRegion.end - nativeHeapBump;
            heap.publishFreeRegion(nativeHeapBump, regionRemaining,
                                   NATIVE_ALLOCATION_REGION_FLAG);
            if (regionRemaining < MIN_NATIVE_ALLOCATION_REGION_BYTES) {
                heap.publishFreeRegion(nativeHeapBump, regionRemaining, 0);
                this.allocationRegion = null;
                heap.rebuildFreeBlocks();
            }
        } else if (nativeHeapBump > heap.bump) {
            heap.bump = nativeHeapBump;
            this.runtime.noteNativeHeapBump(nativeHeapBump);
        }
        var instructionCount = records.engineInstructionCount(this.stateAddress);
        this.runCount++;
        this.instructionCount += instructionCount;
        if (this.runtime.profileOpcodeCounts &&
            this.instructionCount >= this.nextInstructionProfileReport) {
            this.reportProfile();
            while (this.instructionCount >= this.nextInstructionProfileReport) {
                this.nextInstructionProfileReport += 5000000;
            }
        }
        if (reason === Exit.UNSUPPORTED) {
            var allocationOpcode = records.engineResultCell(this.stateAddress);
            var allocationRemaining = records.engineHeapLimit(this.stateAddress) -
                                      records.engineHeapBump(this.stateAddress);
            var allocationExit = allocationRemaining <
                    NATIVE_PROPERTY_RECORD_BYTES ||
                allocationOpcode === Bytecode.MAKE_OBJECT ||
                allocationOpcode === Bytecode.MAKE_ARRAY ||
                allocationOpcode === Bytecode.MAKE_REGEXP ||
                (allocationOpcode === Bytecode.CALL &&
                 records.engineCallRejectReason(this.stateAddress) ===
                 CallReject.HEAP_SPACE);
            if (allocationExit) reason = Exit.ALLOCATION;
        }
        if (reason === Exit.UNSUPPORTED) {
            this.unsupportedExitCount++;
            var unsupportedOpcode = records.engineResultCell(this.stateAddress);
            this.unsupportedOpcodeCounts[unsupportedOpcode] =
                (this.unsupportedOpcodeCounts[unsupportedOpcode] || 0) + 1;
            if (this.runtime.profileOpcodeCounts) {
                this.noteUnsupportedLocation(
                    records.engineCurrentFrame(this.stateAddress),
                    records.enginePC(this.stateAddress), unsupportedOpcode);
            }
            var callRejectReason = records.engineCallRejectReason(
                this.stateAddress);
            if (unsupportedOpcode === Bytecode.CALL && callRejectReason) {
                this.callRejectCounts[callRejectReason] =
                    (this.callRejectCounts[callRejectReason] || 0) + 1;
            }
            if (this.runtime.profileOpcodeCounts &&
                this.unsupportedExitCount % 1000 === 0) {
                this.reportProfile();
            }
        }
        return {reason: reason,
                frame: records.engineCurrentFrame(this.stateAddress),
                pc: records.enginePC(this.stateAddress),
                resultCell: records.engineResultCell(this.stateAddress),
                opcode: reason === Exit.UNSUPPORTED ||
                        reason === Exit.ALLOCATION ?
                    records.engineResultCell(this.stateAddress) : 0,
                instructions: instructionCount,
                backend: this.nativeResult.fn ? "i386" : "js"};
    };

    NativeInterpreter.prototype.reportProfile = function () {
        var executionParts = [];
        var executedOpcode = 1;
        while (executedOpcode < Bytecode.NAMES.length) {
            var executedCount = this.runtime.heapRecords.engineOpcodeCount(
                this.stateAddress, executedOpcode);
            if (executedCount) {
                executionParts.push((Bytecode.NAMES[executedOpcode] ||
                    executedOpcode) + "=" + executedCount);
            }
            executedOpcode++;
        }
        if (executionParts.length) {
            var executionLine = "native guest executed opcodes: " +
                                executionParts.join(" ");
            if (typeof print === "function") print(executionLine);
            else if (typeof console !== "undefined" && console.log) {
                console.log(executionLine);
            }
        }
        var parts = [];
        var opcode = 1;
        while (opcode < this.unsupportedOpcodeCounts.length) {
            if (this.unsupportedOpcodeCounts[opcode]) {
                parts.push((Bytecode.NAMES[opcode] || opcode) + "=" +
                           this.unsupportedOpcodeCounts[opcode]);
            }
            opcode++;
        }
        var line = "native guest profile: bytecodes=" + this.instructionCount +
                   " exits=" + this.unsupportedExitCount +
                   " nativeMs=" + this.nativeElapsedMs +
                   " runs=" + this.runCount + " " +
                   parts.join(" ");
        if (typeof print === "function") print(line);
        else if (typeof console !== "undefined" && console.log) console.log(line);
        var locationEntries = [];
        var locationKey;
        for (locationKey in this.unsupportedLocationCounts) {
            if (Object.prototype.hasOwnProperty.call(
                    this.unsupportedLocationCounts, locationKey)) {
                locationEntries.push({name: locationKey,
                    count: this.unsupportedLocationCounts[locationKey]});
            }
        }
        locationEntries.sort(function (left, right) {
            return right.count - left.count;
        });
        var locationParts = [];
        var locationIndex = 0;
        while (locationIndex < locationEntries.length && locationIndex < 12) {
            locationParts.push(locationEntries[locationIndex].name + "=" +
                               locationEntries[locationIndex].count);
            locationIndex++;
        }
        if (locationParts.length) {
            line = "native guest exit locations: " + locationParts.join(" ");
            if (typeof print === "function") print(line);
            else if (typeof console !== "undefined" && console.log) {
                console.log(line);
            }
        }
        var rejectNames = ["none", "argument-list", "argument-register",
                           "heap-environment", "heap-space"];
        var rejectParts = [];
        var rejectIndex = 1;
        while (rejectIndex < this.callRejectCounts.length) {
            if (this.callRejectCounts[rejectIndex]) {
                rejectParts.push(rejectNames[rejectIndex] + "=" +
                                 this.callRejectCounts[rejectIndex]);
            }
            rejectIndex++;
        }
        if (rejectParts.length) {
            line = "native guest call rejects: " + rejectParts.join(" ");
            if (typeof print === "function") print(line);
            else if (typeof console !== "undefined" && console.log) console.log(line);
        }
        var propertyParts = [];
        var propertyReason;
        for (propertyReason in this.propertyFallbackCounts) {
            if (Object.prototype.hasOwnProperty.call(
                    this.propertyFallbackCounts, propertyReason)) {
                propertyParts.push(propertyReason + "=" +
                                   this.propertyFallbackCounts[propertyReason]);
            }
        }
        propertyParts.sort();
        if (propertyParts.length) {
            line = "native guest property rejects: " + propertyParts.join(" ");
            if (typeof print === "function") print(line);
            else if (typeof console !== "undefined" && console.log) {
                console.log(line);
            }
        }
        var callParts = [];
        var callName;
        for (callName in this.fallbackCallCounts) {
            if (Object.prototype.hasOwnProperty.call(
                    this.fallbackCallCounts, callName)) {
                callParts.push(callName + "=" +
                               this.fallbackCallCounts[callName]);
            }
        }
        callParts.sort();
        var callLine = "native guest fallback calls: " + callParts.join(" ");
        if (typeof print === "function") print(callLine);
        else if (typeof console !== "undefined" && console.log) {
            console.log(callLine);
        }
        var layoutParts = [];
        for (callName in this.fallbackCallLayouts) {
            if (Object.prototype.hasOwnProperty.call(
                    this.fallbackCallLayouts, callName)) {
                layoutParts.push(callName + "=" +
                                 this.fallbackCallLayouts[callName]);
            }
        }
        layoutParts.sort();
        if (layoutParts.length) {
            callLine = "native guest bytecode layouts: " +
                       layoutParts.join(" ");
            if (typeof print === "function") print(callLine);
            else if (typeof console !== "undefined" && console.log) {
                console.log(callLine);
            }
        }
    };

    NativeInterpreter.prototype.noteUnsupportedLocation = function (
            frameAddress, pc, opcode) {
        var records = this.runtime.heapRecords;
        var programAddress = records.frameProgram(frameAddress);
        var program = this.runtime.programMetadata["$" + programAddress];
        if (!program) return;
        var location = null;
        var scan = pc;
        while (scan >= 0 && !location) {
            location = program.sourceLocations && program.sourceLocations[scan];
            scan--;
        }
        var name = Bytecode.NAMES[opcode] || String(opcode);
        var filename = location && location.filename || program.filename ||
                       "<source>";
        var line = location && location.line || 1;
        var column = location && location.column || 1;
        var detail = "";
        if (opcode === Bytecode.ADD || opcode === Bytecode.GET_PROPERTY) {
            var leftRegister = program.code[pc + 2];
            var rightRegister = program.code[pc + 3];
            var leftCell = records.frameRegisterCell(frameAddress, leftRegister);
            var rightCell = records.frameRegisterCell(frameAddress, rightRegister);
            detail = "[tags:" + this.runtime.valueCells.tagAt(leftCell) + "," +
                     this.runtime.valueCells.tagAt(rightCell) + "]";
        }
        var key = name + "@" + filename + ":" + line + ":" + column + detail;
        this.unsupportedLocationCounts[key] =
            (this.unsupportedLocationCounts[key] || 0) + 1;
    };

    NativeInterpreter.prototype.notePropertyFallback = function (frame, pc) {
        var code = frame.code;
        var object = frame.registers[code[pc + 1]];
        var key = frame.registers[code[pc + 2]];
        var reason;
        if (!object || object.guestType !== "array") {
            reason = "target-" + (object && object.guestType ?
                                  object.guestType : typeof object);
            reason += "@" + (frame.program.name || "<anonymous>");
            if (typeof key === "string" && key.length < 24) {
                reason += ":" + key;
            } else {
                reason += ":key-" + typeof key;
            }
        } else if (typeof key !== "number") {
            reason = "key-" + typeof key;
        } else if (key < 0 || key !== Math.floor(key)) {
            reason = "non-index-number";
        } else {
            var vector = this.runtime.heapRecords.arrayElements(
                object.heapAddress);
            var capacity = this.runtime.heapRecords.vectorCapacity(vector);
            reason = key >= capacity ? "array-capacity" : "array-other";
        }
        this.propertyFallbackCounts[reason] =
            (this.propertyFallbackCounts[reason] || 0) + 1;
    };

    NativeInterpreter.prototype.noteConstantPropertyFallback = function (
            frame, pc) {
        var code = frame.code;
        var object = frame.registers[code[pc + 2]];
        var key = frame.constants[code[pc + 3]];
        var objectKind = object && object.guestType ? object.guestType :
                         typeof object;
        var reason = "get-" + objectKind + "@" +
                     (frame.program.name || "<anonymous>");
        if (typeof key === "string" && key.length < 32) reason += ":" + key;
        this.propertyFallbackCounts[reason] =
            (this.propertyFallbackCounts[reason] || 0) + 1;
    };

    NativeInterpreter.prototype.noteFallbackCall = function (callable) {
        var name = callable && callable.name || "<anonymous>";
        this.fallbackCallCounts[name] =
            (this.fallbackCallCounts[name] || 0) + 1;
        if (callable && callable.guestType === "bytecodeFunction") {
            var programAddress = this.runtime.heapRecords.functionMetadata(
                callable.heapAddress);
            var bindingRegisters = this.runtime.heapRecords.programBindingRegisters(
                programAddress);
            this.fallbackCallLayouts[name] =
                (bindingRegisters ? "heap-registers" : "heap-environment") +
                "/" + (callable.program && callable.program.bindingRegisters ?
                         "host-registers" : "host-environment");
        }
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
