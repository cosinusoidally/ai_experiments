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
        if (ir.controlFlow) return compileControlFlow(this, ir);
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
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      ir: ir, backend: "i386", destroy: function () {}};
        if (!this.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.bytes.length / 4096) * 4096);
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

    function compileControlFlow(backend, ir) {
        var assembler = new Assembler();
        var state = {nextLabel: 0, returnLabel: "kernel_return"};
        assembler.pushEbp();
        assembler.movEbpEsp();
        if (ir.locals.length) assembler.subEspImmediate(ir.locals.length * 4);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        assembler.leave();
        assembler.ret();
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      ir: ir, backend: "i386", destroy: function () {}};
        if (!backend.ffi.isMMVM) return result;
        var allocationLength = Math.max(4096,
            Math.ceil(assembler.bytes.length / 4096) * 4096);
        var pointer = backend.ffi.call(backend.mmap,
            [0, allocationLength, 7, 0x22, -1, 0]);
        if (!pointer || pointer === -1) throw new Error("kernel mmap failed");
        var index = 0;
        while (index < assembler.bytes.length) {
            poke8(pointer + index, assembler.bytes[index]);
            index++;
        }
        var ffi = backend.ffi;
        var munmap = backend.munmap;
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
    }

    function emitStatements(assembler, statements, state) {
        var index = 0;
        while (index < statements.length) {
            emitStatement(assembler, statements[index++], state);
        }
    }

    function emitStatement(assembler, node, state) {
        if (node.op === "block") {
            emitStatements(assembler, node.body, state);
            return;
        }
        if (node.op === "set_local" || node.op === "set_argument") {
            emitControlExpression(assembler, node.value, state);
            if (node.op === "set_local") assembler.movLocalEax(node.index);
            else assembler.movEbpArgumentEax(node.index);
            return;
        }
        if (node.op === "store_u32") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.value, state);
            assembler.popEcx();
            assembler.movDwordPtrEcxEax();
            return;
        }
        if (node.op === "store_f64") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlF64(assembler, node.value, state);
            assembler.popEcx();
            assembler.storeF64EcxPop();
            return;
        }
        if (node.op === "store_raw_u8" || node.op === "store_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.value, state);
            assembler.popEcx();
            if (node.op === "store_raw_u8") assembler.movBytePtrEcxAl();
            else assembler.movDwordPtrEcxEax();
            return;
        }
        if (node.op === "return") {
            emitControlExpression(assembler, node.value, state);
            assembler.jump(state.returnLabel);
            return;
        }
        if (node.op === "if") {
            var alternateLabel = "kernel_else_" + state.nextLabel;
            var endLabel = "kernel_if_end_" + state.nextLabel++;
            emitControlExpression(assembler, node.test, state);
            assembler.testEaxEax();
            assembler.jumpEqual(alternateLabel);
            emitStatement(assembler, node.consequent, state);
            assembler.jump(endLabel);
            assembler.label(alternateLabel);
            emitStatement(assembler, node.alternate, state);
            assembler.label(endLabel);
            return;
        }
        if (node.op === "while") {
            var loopLabel = "kernel_loop_" + state.nextLabel;
            var exitLabel = "kernel_loop_exit_" + state.nextLabel++;
            assembler.label(loopLabel);
            emitControlExpression(assembler, node.test, state);
            assembler.testEaxEax();
            assembler.jumpEqual(exitLabel);
            emitStatement(assembler, node.body, state);
            assembler.jump(loopLabel);
            assembler.label(exitLabel);
            return;
        }
        throw new Error("unsupported i386 control-flow statement " + node.op);
    }

    function emitControlExpression(assembler, node, state) {
        if (node.op === "const_i32") assembler.movEaxImmediate(node.value);
        else if (node.op === "to_i32_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.reserveStackBytes(12);
            assembler.storeX87ControlWordAtStack(0);
            assembler.loadStackWordToEax(0);
            assembler.orEaxImmediate(0x0c00);
            assembler.storeAxAtStack(2);
            assembler.loadX87ControlWordFromStack(2);
            assembler.storeInt64AtStackFromF64Pop(4);
            assembler.loadX87ControlWordFromStack(0);
            assembler.loadStackDwordToEax(4);
            assembler.releaseStackBytes(12);
        }
        else if (node.op === "arg_i32") assembler.movEaxEbpArgument(node.index);
        else if (node.op === "local_i32") assembler.movEaxLocal(node.index);
        else if (node.op === "eq_f64" || node.op === "lt_f64" ||
                 node.op === "le_f64" || node.op === "gt_f64" ||
                 node.op === "ge_f64") {
            var reverse = node.op === "gt_f64" || node.op === "ge_f64";
            emitControlF64(assembler, reverse ? node.right : node.left, state);
            emitControlF64(assembler, reverse ? node.left : node.right, state);
            assembler.fucomipSt0St1();
            assembler.fstpSt0();
            if (node.op === "eq_f64") {
                var unorderedLabel = "kernel_compare_unordered_" + state.nextLabel;
                var compareEnd = "kernel_compare_end_" + state.nextLabel++;
                assembler.jumpParity(unorderedLabel);
                assembler.setEqualAl();
                assembler.movzxEaxAl();
                assembler.jump(compareEnd);
                assembler.label(unorderedLabel);
                assembler.movEaxImmediate(0);
                assembler.label(compareEnd);
            } else {
                if (node.op === "lt_f64" || node.op === "gt_f64") {
                    assembler.setAboveAl();
                } else assembler.setAboveOrEqualAl();
                assembler.movzxEaxAl();
            }
        }
        else if (node.op === "load_u32") {
            emitControlExpression(assembler, node.address, state);
            assembler.movEaxDwordPtrEax();
        } else if (node.op === "load_raw_u8" || node.op === "load_raw_u32") {
            emitControlExpression(assembler, node.address, state);
            if (node.op === "load_raw_u8") assembler.movzxEaxBytePtrEax();
            else assembler.movEaxDwordPtrEax();
        } else if (node.op === "neg_i32" || node.op === "not_i32" ||
                   node.op === "as_i32" || node.op === "logical_not_i32") {
            emitControlExpression(assembler, node.value, state);
            if (node.op === "neg_i32") assembler.negEax();
            else if (node.op === "not_i32") assembler.notEax();
            else if (node.op === "logical_not_i32") {
                assembler.testEaxEax();
                assembler.setEqualAl();
                assembler.movzxEaxAl();
            }
        } else {
            emitControlExpression(assembler, node.left, state);
            assembler.pushEax();
            emitControlExpression(assembler, node.right, state);
            assembler.popEcx();
            if (node.op === "add_i32") assembler.addEaxEcx();
            else if (node.op === "sub_i32") {
                assembler.subEcxEax(); assembler.movEaxEcx();
            } else if (node.op === "mul_i32") assembler.imulEaxEcx();
            else if (node.op === "rem_i32") assembler.remainderEcxEax();
            else if (node.op === "and_i32") assembler.andEaxEcx();
            else if (node.op === "or_i32") assembler.orEaxEcx();
            else if (node.op === "xor_i32") assembler.xorEaxEcx();
            else if (node.op === "shl_i32" || node.op === "shr_i32" ||
                     node.op === "ushr_i32") {
                assembler.movEdxEax();
                assembler.movEaxEcx();
                assembler.movEcxEdx();
                if (node.op === "shl_i32") assembler.shiftLeftEaxCl();
                else if (node.op === "shr_i32") assembler.shiftRightEaxCl();
                else assembler.shiftUnsignedRightEaxCl();
            }
            else if (node.op === "eq_i32" || node.op === "ne_i32" ||
                     node.op === "lt_i32" || node.op === "le_i32" ||
                     node.op === "gt_i32" || node.op === "ge_i32") {
                assembler.compareEcxEax();
                if (node.op === "eq_i32") assembler.setEqualAl();
                else if (node.op === "ne_i32") assembler.setNotEqualAl();
                else if (node.op === "lt_i32") assembler.setLessAl();
                else if (node.op === "le_i32") assembler.setLessOrEqualAl();
                else if (node.op === "gt_i32") assembler.setGreaterAl();
                else assembler.setGreaterOrEqualAl();
                assembler.movzxEaxAl();
            } else throw new Error("unsupported i386 control-flow expression " + node.op);
        }
    }

    function emitControlF64(assembler, node, state) {
        if (node.op === "abs_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.absF64();
            return;
        }
        if (node.op === "sqrt_f64") {
            emitControlF64(assembler, node.value, state);
            assembler.sqrtF64();
            return;
        }
        if (node.op === "load_f64" || node.op === "load_i32_f64") {
            emitControlExpression(assembler, node.address, state);
            if (node.op === "load_f64") assembler.loadF64Eax();
            else assembler.loadI32EaxAsF64();
            return;
        }
        if (node.op === "load_number_f64") {
            var doubleLabel = "kernel_number_double_" + state.nextLabel;
            var loadedLabel = "kernel_number_loaded_" + state.nextLabel++;
            emitControlExpression(assembler, node.tag, state);
            assembler.compareEaxImmediate(5);
            assembler.jumpNotEqual(doubleLabel);
            emitControlExpression(assembler, node.address, state);
            assembler.loadI32EaxAsF64();
            assembler.jump(loadedLabel);
            assembler.label(doubleLabel);
            emitControlExpression(assembler, node.address, state);
            assembler.loadF64Eax();
            assembler.label(loadedLabel);
            return;
        }
        emitControlF64(assembler, node.left, state);
        emitControlF64(assembler, node.right, state);
        if (node.op === "add_f64") assembler.addF64Pop();
        else if (node.op === "sub_f64") assembler.subtractF64Pop();
        else if (node.op === "mul_f64") assembler.multiplyF64Pop();
        else if (node.op === "div_f64") assembler.divideF64Pop();
        else throw new Error("unsupported i386 control-flow f64 expression " + node.op);
    }

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
            else if (node.op === "sub_i32") {
                assembler.subEcxEax();
                assembler.movEaxEcx();
            }
            else if (node.op === "mul_i32") assembler.imulEaxEcx();
            else if (node.op === "rem_i32") assembler.remainderEcxEax();
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
