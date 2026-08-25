/* i386 backend for shared kernel IR. It emits only macro-assembler calls and
 * optionally installs the result in executable memory on an MMVM host. */
(function (root) {
    var Assembler = root.GuestVMX86Assembler;
    var HostFFI = root.GuestVMHostFFI;
    if (typeof module !== "undefined" && module.exports) {
        Assembler = require("./x86_assembler.js");
        HostFFI = require("../host_ffi.js");
    }

    function X86Backend() {
        this.ffi = new HostFFI();
        this.mmap = this.ffi.isMMVM ? this.ffi.resolve("mmap") : 0;
        this.munmap = this.ffi.isMMVM ? this.ffi.resolve("munmap") : 0;
    }

    X86Backend.prototype.compile = function (ir) {
        var assembler = new Assembler();
        var instructionIndex = 0;
        while (instructionIndex < ir.instructions.length) {
            var instruction = ir.instructions[instructionIndex++];
            if (instruction.op === "store_f64") {
                emitExpression(assembler, instruction.address);
                assembler.pushEax();
                emitF64Expression(assembler, instruction.value);
                assembler.popEcx();
                assembler.storeF64EcxPop();
            } else if (instruction.op !== "store_u32") {
                throw new Error("unsupported i386 kernel instruction " + instruction.op);
            } else {
                emitExpression(assembler, instruction.address);
                assembler.pushEax();
                emitExpression(assembler, instruction.value);
                assembler.popEcx();
                assembler.movDwordPtrEcxEax();
            }
        }
        emitExpression(assembler, ir.expression);
        assembler.ret();
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      ir: ir, backend: "i386", destroy: function () {}};
        if (!this.ffi.isMMVM) return result;
        var allocationLength = 4096;
        var pointer = this.ffi.call(this.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        var index = 0;
        while (index < assembler.bytes.length) {
            poke8(pointer + index, assembler.bytes[index]);
            index++;
        }
        var ffi = this.ffi;
        var munmap = this.munmap;
        result.pointer = pointer;
        result.fn = function () {
            var args = [];
            var argumentIndex = 0;
            while (argumentIndex < arguments.length && argumentIndex < 8) {
                args[argumentIndex] = Number(arguments[argumentIndex]) | 0;
                argumentIndex++;
            }
            return ffi.call(pointer, args) | 0;
        };
        result.destroy = function () {
            if (!result.pointer) return;
            ffi.call(munmap, [result.pointer, allocationLength]);
            result.pointer = 0;
            result.fn = null;
        };
        return result;
    };

    function emitExpression(assembler, node) {
        if (node.op === "const_i32") assembler.movEaxImmediate(node.value);
        else if (node.op === "arg_i32") assembler.movEaxArgument(node.index);
        else if (node.op === "neg_i32" || node.op === "not_i32" ||
                 node.op === "as_i32") {
            emitExpression(assembler, node.value);
            if (node.op === "neg_i32") assembler.negEax();
            else if (node.op === "not_i32") assembler.notEax();
        } else {
            emitExpression(assembler, node.left);
            assembler.pushEax();
            emitExpression(assembler, node.right);
            assembler.popEcx();
            if (node.op === "add_i32") assembler.addEaxEcx();
            else if (node.op === "sub_i32") assembler.subEcxEaxMoveEax();
            else if (node.op === "mul_i32") assembler.imulEaxEcx();
            else if (node.op === "and_i32") assembler.andEaxEcx();
            else if (node.op === "or_i32") assembler.orEaxEcx();
            else if (node.op === "xor_i32") assembler.xorEaxEcx();
            else throw new Error("unsupported i386 kernel IR " + node.op);
        }
    }

    function emitF64Expression(assembler, node) {
        if (node.op === "load_f64") {
            emitExpression(assembler, node.address);
            assembler.loadF64Eax();
            return;
        }
        emitF64Expression(assembler, node.left);
        emitF64Expression(assembler, node.right);
        if (node.op === "add_f64") assembler.addF64Pop();
        else if (node.op === "sub_f64") assembler.subtractF64Pop();
        else if (node.op === "mul_f64") assembler.multiplyF64Pop();
        else if (node.op === "div_f64") assembler.divideF64Pop();
        else throw new Error("unsupported i386 f64 IR " + node.op);
    }

    root.GuestVMKernelX86Backend = X86Backend;
    if (typeof module !== "undefined" && module.exports) module.exports = X86Backend;
}(this));
