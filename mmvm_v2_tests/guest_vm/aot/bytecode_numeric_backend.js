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
        assembler.beginFrameKernel();
        var pc = 0;
        while (pc < program.code.length) {
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
            } else if (opcode === op.NEGATE || opcode === op.POSITIVE) {
                emitLoadNumber(assembler, this.runtime, program.code[pc + 2], pc, "unary");
                if (opcode === op.NEGATE) assembler.negateF64();
                emitStoreNumber(assembler, this.runtime, program.code[pc + 1]);
                pc += 3;
            } else if (opcode === op.RETURN) {
                pc += 2;
            }
        }
        assembler.movEaxImmediate(0);
        assembler.endFrameKernel();
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
        while (pc < program.code.length) {
            var opcode = program.code[pc];
            if (opcode === op.CONST || opcode === op.MOVE ||
                opcode === op.NEGATE || opcode === op.POSITIVE) pc += 3;
            else if (isBinary(opcode)) pc += 4;
            else if (opcode === op.RETURN) {
                returnRegister = program.code[pc + 1];
                pc += 2;
                if (pc !== program.code.length) return null;
            } else return null;
        }
        return returnRegister >= 0 ? {returnRegister: returnRegister} : null;
    }

    function isBinary(opcode) {
        return opcode === op.ADD || opcode === op.SUBTRACT ||
               opcode === op.MULTIPLY || opcode === op.DIVIDE;
    }

    function registerOffset(runtime, register) {
        return runtime.heapRecords.frameRegisterDisplacement(register);
    }

    function emitCopyConstant(assembler, runtime, vector, constant, target) {
        var source = runtime.heapRecords.vectorCell(vector, constant);
        var targetOffset = registerOffset(runtime, target);
        var word = 0;
        while (word < 4) {
            assembler.copyHeapWordToFrame(source + word * 4,
                                           targetOffset + word * 4);
            word++;
        }
    }

    function emitCopyRegister(assembler, runtime, source, target) {
        var sourceOffset = registerOffset(runtime, source);
        var targetOffset = registerOffset(runtime, target);
        var word = 0;
        while (word < 4) {
            assembler.copyFrameWord(sourceOffset + word * 4,
                                    targetOffset + word * 4);
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
        assembler.storeFrameF64(offset, offset + 4);
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
                } else if (opcode === op.NEGATE || opcode === op.POSITIVE) {
                    value = readNumber(runtime, frameAddress, program.code[pc + 2]);
                    runtime.valueCells.writePrimitiveAt(
                        runtime.heapRecords.frameRegisterCell(
                            frameAddress, program.code[pc + 1]),
                        opcode === op.NEGATE ? -value : value);
                    pc += 3;
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
