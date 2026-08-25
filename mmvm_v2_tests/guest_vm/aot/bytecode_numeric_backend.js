/* Shared-bytecode numeric leaf backend. Guest bytecode is the common IR. The
 * JS reference and i386/x87 implementation both read and write the same frame
 * value cells; unsupported semantic operations are rejected, never guessed. */
(function (root) {
    var op = root.GuestVMBytecode;
    var Assembler = root.GuestVMX86Assembler;
    var HostFFI = root.GuestVMHostFFI;
    var ValueCells = root.GuestVMValueCells;
    if (typeof module !== "undefined" && module.exports) {
        op = require("../bytecode.js");
        Assembler = require("./x86_assembler.js");
        HostFFI = require("../host_ffi.js");
        ValueCells = require("../value_cell.js");
    }

    function NumericBytecodeBackend(runtime) {
        this.runtime = runtime;
        this.ffi = new HostFFI();
        this.mmap = this.ffi.isMMVM ? this.ffi.resolve("mmap") : 0;
        this.munmap = this.ffi.isMMVM ? this.ffi.resolve("munmap") : 0;
    }

    NumericBytecodeBackend.prototype.compile = function (program) {
        var analysis = analyze(program);
        if (!analysis) return null;
        var js = makeJS(this.runtime, program, analysis.returnRegister);
        var assembler = new Assembler();
        var programAddress = this.runtime.programAddress(program);
        var constants = this.runtime.heapRecords.programConstants(programAddress);
        var targets = branchTargets(program);
        emitFrameKernelPrologue(assembler);
        var pc = 0;
        while (pc < program.code.length) {
            if (targets["$" + pc]) assembler.label("bytecode_" + pc);
            var opcode = program.code[pc];
            if (opcode === op.CONST) {
                emitCopyConstant(assembler, this.runtime, constants,
                    program.code[pc + 2], program.code[pc + 1]);
                pc += 3;
            } else if (opcode === op.MOVE) {
                emitCopyRegister(assembler, this.runtime,
                    program.code[pc + 2], program.code[pc + 1]);
                pc += 3;
            } else if (isBinary(opcode)) {
                emitLoadNumber(assembler, this.runtime, program.code[pc + 2], pc, "left");
                emitLoadNumber(assembler, this.runtime, program.code[pc + 3], pc, "right");
                if (opcode === op.ADD) assembler.addF64Pop();
                else if (opcode === op.SUBTRACT) assembler.subtractF64Pop();
                else if (opcode === op.MULTIPLY) assembler.multiplyF64Pop();
                else assembler.divideF64Pop();
                emitStoreNumber(assembler, this.runtime, program.code[pc + 1]);
                pc += 4;
            } else if (isComparison(opcode)) {
                var reverse = opcode === op.GREATER || opcode === op.GREATER_EQUAL;
                emitLoadNumber(assembler, this.runtime,
                    program.code[pc + (reverse ? 3 : 2)], pc, "compare_left");
                emitLoadNumber(assembler, this.runtime,
                    program.code[pc + (reverse ? 2 : 3)], pc, "compare_right");
                if (opcode === op.STRICT_EQUAL) emitCompareF64EqualToEax(assembler);
                else if (opcode === op.LESS_EQUAL || opcode === op.GREATER_EQUAL) {
                    emitCompareF64AboveOrEqualToEax(assembler);
                } else emitCompareF64AboveToEax(assembler);
                emitStoreFrameBoolean(assembler, registerOffset(
                    this.runtime, program.code[pc + 1]));
                pc += 4;
            } else if (opcode === op.NEGATE || opcode === op.POSITIVE) {
                emitLoadNumber(assembler, this.runtime, program.code[pc + 2], pc, "unary");
                if (opcode === op.NEGATE) assembler.negateF64();
                emitStoreNumber(assembler, this.runtime, program.code[pc + 1]);
                pc += 3;
            } else if (opcode === op.RETURN) {
                assembler.jump("numeric_epilogue");
                pc += 2;
            } else if (opcode === op.JUMP) {
                assembler.jump("bytecode_" + program.code[pc + 1]);
                pc += 2;
            } else if (opcode === op.JUMP_IF_FALSE) {
                assembler.compareFrameTag(registerOffset(this.runtime,
                    program.code[pc + 1]), ValueCells.Tags.TRUE);
                assembler.jumpNotEqual("bytecode_" + program.code[pc + 2]);
                pc += 3;
            }
        }
        if (targets["$" + program.code.length]) {
            assembler.label("bytecode_" + program.code.length);
        }
        assembler.label("numeric_epilogue");
        assembler.movEaxImmediate(0);
        emitFrameKernelEpilogue(assembler);
        assembler.resolveLabels();
        var nativeResult = install(this, assembler);
        return {backend: nativeResult.fn ? "i386" : "js",
                fn: nativeResult.fn || js, jsFn: js,
                pointer: nativeResult.pointer, destroy: nativeResult.destroy,
                assembly: assembler.dump(), returnRegister: analysis.returnRegister};
    };

    function analyze(program) {
        var pc = 0;
        var returnRegister = -1;
        var numeric = {};
        var booleanRegisters = {};
        var parameterIndex = 0;
        while (program.bindingRegisters &&
               parameterIndex < program.parameterSlots.length) {
            numeric["$" + program.bindingRegisters[
                program.parameterSlots[parameterIndex++]]] = true;
        }
        while (pc < program.code.length) {
            var opcode = program.code[pc];
            if (opcode === op.CONST) {
                if (typeof program.constants[program.code[pc + 2]] !== "number") return null;
                numeric["$" + program.code[pc + 1]] = true;
                pc += 3;
            } else if (opcode === op.MOVE) {
                if (!numeric["$" + program.code[pc + 2]]) return null;
                numeric["$" + program.code[pc + 1]] = true;
                pc += 3;
            } else if (opcode === op.NEGATE || opcode === op.POSITIVE) {
                if (!numeric["$" + program.code[pc + 2]]) return null;
                numeric["$" + program.code[pc + 1]] = true;
                pc += 3;
            } else if (isBinary(opcode)) {
                if (!numeric["$" + program.code[pc + 2]] ||
                    !numeric["$" + program.code[pc + 3]]) return null;
                numeric["$" + program.code[pc + 1]] = true;
                pc += 4;
            } else if (isComparison(opcode)) {
                if (!numeric["$" + program.code[pc + 2]] ||
                    !numeric["$" + program.code[pc + 3]]) return null;
                booleanRegisters["$" + program.code[pc + 1]] = true;
                pc += 4;
            } else if (opcode === op.JUMP) {
                pc += 2;
            } else if (opcode === op.JUMP_IF_FALSE) {
                if (!booleanRegisters["$" + program.code[pc + 1]]) return null;
                pc += 3;
            }
            else if (opcode === op.RETURN) {
                if (returnRegister >= 0 && returnRegister !== program.code[pc + 1]) {
                    return null;
                }
                returnRegister = program.code[pc + 1];
                if (!numeric["$" + returnRegister] &&
                    !booleanRegisters["$" + returnRegister]) return null;
                pc += 2;
            } else return null;
        }
        return returnRegister >= 0 ? {returnRegister: returnRegister} : null;
    }

    function isBinary(opcode) {
        return opcode === op.ADD || opcode === op.SUBTRACT ||
               opcode === op.MULTIPLY || opcode === op.DIVIDE;
    }

    function isComparison(opcode) {
        return opcode === op.STRICT_EQUAL || opcode === op.LESS ||
               opcode === op.LESS_EQUAL || opcode === op.GREATER ||
               opcode === op.GREATER_EQUAL;
    }

    function branchTargets(program) {
        var targets = {};
        var pc = 0;
        while (pc < program.code.length) {
            var opcode = program.code[pc];
            if (opcode === op.JUMP) {
                targets["$" + program.code[pc + 1]] = true;
                pc += 2;
            } else if (opcode === op.JUMP_IF_FALSE) {
                targets["$" + program.code[pc + 2]] = true;
                pc += 3;
            } else if (opcode === op.CONST || opcode === op.MOVE ||
                       opcode === op.NEGATE || opcode === op.POSITIVE) pc += 3;
            else if (isBinary(opcode) || isComparison(opcode)) pc += 4;
            else pc += 2;
        }
        return targets;
    }

    function registerOffset(runtime, register) {
        return runtime.heapRecords.frameRegisterDisplacement(register);
    }

    /* These are backend programs expressed entirely in instruction-sized
     * assembler operations. Encoding bytes belong only in x86_assembler.js. */
    function emitFrameKernelPrologue(assembler) {
        assembler.pushEbp();
        assembler.movEbpEsp();
        assembler.pushEbx();
        assembler.pushEsi();
        assembler.movEbxEbpDisplacement(8);
        assembler.movEsiEbpDisplacement(12);
        assembler.addEsiEbx();
    }

    function emitFrameKernelEpilogue(assembler) {
        assembler.popEsi();
        assembler.popEbx();
        assembler.leave();
        assembler.ret();
    }

    function emitCompareF64AboveToEax(assembler) {
        assembler.fucomipSt0St1();
        assembler.fstpSt0();
        assembler.setAboveAl();
        assembler.movzxEaxAl();
    }

    function emitCompareF64AboveOrEqualToEax(assembler) {
        assembler.fucomipSt0St1();
        assembler.fstpSt0();
        assembler.setAboveOrEqualAl();
        assembler.movzxEaxAl();
    }

    function emitCompareF64EqualToEax(assembler) {
        assembler.fucomipSt0St1();
        assembler.fstpSt0();
        assembler.setEqualAl();
        assembler.movzxEaxAl();
    }

    function emitStoreFrameBoolean(assembler, offset) {
        assembler.addEaxImmediate8(3);
        assembler.movFrameWordEax(offset);
        assembler.movFrameImmediate(offset + 4, 0);
        assembler.movFrameImmediate(offset + 8, 0);
        assembler.movFrameImmediate(offset + 12, 0);
    }

    function emitCopyConstant(assembler, runtime, vector, constant, target) {
        var source = runtime.heapRecords.vectorCell(vector, constant);
        var targetOffset = registerOffset(runtime, target);
        var word = 0;
        while (word < 4) {
            assembler.movEaxHeapWord(source + word * 4);
            assembler.movFrameWordEax(targetOffset + word * 4);
            word++;
        }
    }

    function emitCopyRegister(assembler, runtime, source, target) {
        var sourceOffset = registerOffset(runtime, source);
        var targetOffset = registerOffset(runtime, target);
        var word = 0;
        while (word < 4) {
            assembler.movEaxFrameWord(sourceOffset + word * 4);
            assembler.movFrameWordEax(targetOffset + word * 4);
            word++;
        }
    }

    function emitLoadNumber(assembler, runtime, register, pc, suffix) {
        var offset = registerOffset(runtime, register);
        var doubleLabel = "numeric_" + pc + "_" + suffix + "_double";
        var doneLabel = "numeric_" + pc + "_" + suffix + "_done";
        assembler.compareFrameTag(offset, ValueCells.Tags.INT32);
        assembler.jumpNotEqual(doubleLabel);
        assembler.loadFrameInt32AsF64(offset + 4);
        assembler.jump(doneLabel);
        assembler.label(doubleLabel);
        assembler.loadFrameF64(offset + 4);
        assembler.label(doneLabel);
    }

    function emitStoreNumber(assembler, runtime, register) {
        var offset = registerOffset(runtime, register);
        assembler.movFrameImmediate(offset, ValueCells.Tags.DOUBLE);
        assembler.fstpFrameF64(offset + 4);
        assembler.movFrameImmediate(offset + 12, 0);
    }

    function makeJS(runtime, program, returnRegister) {
        return function (heapBase, frameAddress) {
            var pc = 0;
            while (pc < program.code.length) {
                var opcode = program.code[pc];
                if (opcode === op.CONST) {
                    var constants = runtime.heapRecords.programConstants(
                        runtime.programAddress(program));
                    copyCell(runtime,
                        runtime.heapRecords.vectorCell(constants, program.code[pc + 2]),
                        runtime.heapRecords.frameRegisterCell(frameAddress,
                            program.code[pc + 1]));
                    pc += 3;
                } else if (opcode === op.MOVE) {
                    copyCell(runtime, runtime.heapRecords.frameRegisterCell(
                        frameAddress, program.code[pc + 2]),
                        runtime.heapRecords.frameRegisterCell(
                            frameAddress, program.code[pc + 1]));
                    pc += 3;
                } else if (isBinary(opcode)) {
                    var left = readNumber(runtime, frameAddress, program.code[pc + 2]);
                    var right = readNumber(runtime, frameAddress, program.code[pc + 3]);
                    var value = opcode === op.ADD ? left + right :
                                opcode === op.SUBTRACT ? left - right :
                                opcode === op.MULTIPLY ? left * right : left / right;
                    runtime.valueCells.writePrimitiveAt(
                        runtime.heapRecords.frameRegisterCell(
                            frameAddress, program.code[pc + 1]), value);
                    pc += 4;
                } else if (isComparison(opcode)) {
                    left = readNumber(runtime, frameAddress, program.code[pc + 2]);
                    right = readNumber(runtime, frameAddress, program.code[pc + 3]);
                    value = opcode === op.STRICT_EQUAL ? left === right :
                            opcode === op.LESS ? left < right :
                            opcode === op.LESS_EQUAL ? left <= right :
                            opcode === op.GREATER ? left > right : left >= right;
                    runtime.valueCells.writePrimitiveAt(
                        runtime.heapRecords.frameRegisterCell(
                            frameAddress, program.code[pc + 1]), value);
                    pc += 4;
                } else if (opcode === op.NEGATE || opcode === op.POSITIVE) {
                    value = readNumber(runtime, frameAddress, program.code[pc + 2]);
                    runtime.valueCells.writePrimitiveAt(
                        runtime.heapRecords.frameRegisterCell(
                            frameAddress, program.code[pc + 1]),
                        opcode === op.NEGATE ? -value : value);
                    pc += 3;
                } else if (opcode === op.JUMP) {
                    pc = program.code[pc + 1];
                } else if (opcode === op.JUMP_IF_FALSE) {
                    pc = runtime.readHeapValue(runtime.heapRecords.frameRegisterCell(
                        frameAddress, program.code[pc + 1])) ?
                        pc + 3 : program.code[pc + 2];
                } else if (opcode === op.RETURN) {
                    break;
                } else pc += 2;
            }
            return returnRegister;
        };
    }

    function readNumber(runtime, frame, register) {
        return Number(runtime.readHeapValue(
            runtime.heapRecords.frameRegisterCell(frame, register)));
    }

    function copyCell(runtime, source, target) {
        var word = 0;
        while (word < 4) {
            runtime.linearHeap.memory.writeU32(target + word * 4,
                runtime.linearHeap.memory.readU32(source + word * 4));
            word++;
        }
    }

    function install(backend, assembler) {
        var result = {fn: null, pointer: 0, destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var length = 4096;
        var pointer = backend.ffi.call(backend.mmap, [0, length, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("numeric backend mmap failed");
        var index = 0;
        while (index < assembler.bytes.length) poke8(pointer + index, assembler.bytes[index++]);
        var ffi = backend.ffi;
        var munmap = backend.munmap;
        result.pointer = pointer;
        result.fn = function (heapBase, frameAddress) {
            return ffi.call(pointer, [heapBase, frameAddress]) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, length]);
            result.pointer = 0;
            result.fn = null;
        };
        return result;
    }

    root.GuestVMNumericBytecodeBackend = NumericBytecodeBackend;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = NumericBytecodeBackend;
    }
}(this));
