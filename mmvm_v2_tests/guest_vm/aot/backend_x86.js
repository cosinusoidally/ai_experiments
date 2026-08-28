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
        var state = {nextLabel: 0, returnLabel: "kernel_return",
                     registerMap: allocateKernelRegisters(ir)};
        assembler.pushEbp();
        assembler.movEbpEsp();
        if (ir.locals.length) assembler.subEspImmediate(ir.locals.length * 4);
        saveKernelRegisters(assembler);
        initializeKernelArgumentRegisters(assembler, state.registerMap);
        emitStatements(assembler, ir.body, state);
        assembler.movEaxImmediate(0);
        assembler.label(state.returnLabel);
        restoreKernelRegisters(assembler);
        assembler.leave();
        assembler.ret();
        assembler.resolveLabels();
        var result = {fn: null, pointer: 0, length: assembler.bytes.length,
                      bytes: assembler.bytes, assembly: assembler.dump(),
                      ir: ir, backend: "i386",
                      registerAllocation: describeRegisterAllocation(
                          ir, state.registerMap),
                      destroy: function () {}};
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

    function describeRegisterAllocation(ir, registerMap) {
        var description = {};
        var key;
        for (key in registerMap) {
            if (!Object.prototype.hasOwnProperty.call(registerMap, key)) continue;
            var separator = key.indexOf(":");
            var kind = key.substring(0, separator);
            var index = Number(key.substring(separator + 1));
            var name = kind === "argument" ? ir.parameters[index] : ir.locals[index];
            description[registerMap[key]] = kind + ":" + name;
        }
        return description;
    }

    /* i386 has only three callee-saved general registers available to a cdecl
     * kernel. Keep the most frequently referenced kernel values in them. This
     * is deliberately an IR-wide backend policy: kernels do not name physical
     * registers and semantic code remains identical in the JS backend. */
    function allocateKernelRegisters(ir) {
        var counts = {};
        countStatementUses(ir.body, counts);
        var values = [];
        var key;
        for (key in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                values.push({key: key, count: counts[key]});
            }
        }
        values.sort(function (left, right) {
            if (left.count !== right.count) return right.count - left.count;
            return left.key < right.key ? -1 : 1;
        });
        var names = ["ebx", "esi", "edi"];
        var result = {};
        var index = 0;
        var preferences = ir.registerPreferences || [];
        while (index < names.length && index < preferences.length) {
            result[preferences[index]] = names[index];
            index++;
        }
        var valueIndex = 0;
        while (index < names.length && valueIndex < values.length) {
            if (result[values[valueIndex].key] === undefined) {
                result[values[valueIndex].key] = names[index++];
            }
            valueIndex++;
        }
        return result;
    }

    function countStatementUses(node, counts) {
        if (!node) return;
        if (typeof node.length === "number") {
            var index = 0;
            while (index < node.length) countStatementUses(node[index++], counts);
            return;
        }
        if (node.op === "arg_i32") {
            incrementUse(counts, "argument:" + node.index);
            return;
        }
        if (node.op === "local_i32") {
            incrementUse(counts, "local:" + node.index);
            return;
        }
        var key;
        for (key in node) {
            if (key !== "op" && Object.prototype.hasOwnProperty.call(node, key) &&
                node[key] && typeof node[key] === "object") {
                countStatementUses(node[key], counts);
            }
        }
    }

    function incrementUse(counts, key) {
        counts[key] = (counts[key] || 0) + 1;
    }

    function saveKernelRegisters(assembler) {
        assembler.pushEbx();
        assembler.pushEsi();
        assembler.pushEdi();
    }

    function restoreKernelRegisters(assembler) {
        assembler.popEdi();
        assembler.popEsi();
        assembler.popEbx();
    }

    function initializeKernelArgumentRegisters(assembler, registerMap) {
        var key;
        for (key in registerMap) {
            if (Object.prototype.hasOwnProperty.call(registerMap, key) &&
                key.indexOf("argument:") === 0) {
                var index = Number(key.substring(9));
                moveEbpArgumentToRegister(assembler, index, registerMap[key]);
            }
        }
    }

    function moveEbpArgumentToRegister(assembler, index, registerName) {
        var displacement = 8 + index * 4;
        if (registerName === "ebx") assembler.movEbxEbpDisplacement(displacement);
        else if (registerName === "esi") assembler.movEsiEbpDisplacement(displacement);
        else assembler.movEdiEbpDisplacement(displacement);
    }

    function moveRegisterToEax(assembler, registerName) {
        if (registerName === "ebx") assembler.movEaxEbx();
        else if (registerName === "esi") assembler.movEaxEsi();
        else assembler.movEaxEdi();
    }

    function moveEaxToRegister(assembler, registerName) {
        if (registerName === "ebx") assembler.movEbxEax();
        else if (registerName === "esi") assembler.movEsiEax();
        else assembler.movEdiEax();
    }

    function isSimpleIntegerOperand(node) {
        return node.op === "const_i32" || node.op === "arg_i32" ||
               node.op === "local_i32";
    }

    function addSimpleOperandToEax(assembler, node, state) {
        if (node.op === "const_i32") {
            assembler.addEaxImmediate(node.value);
            return;
        }
        var key = (node.op === "arg_i32" ? "argument:" : "local:") + node.index;
        var registerName = state.registerMap[key];
        if (registerName === "ebx") assembler.addEaxEbx();
        else if (registerName === "esi") assembler.addEaxEsi();
        else if (registerName === "edi") assembler.addEaxEdi();
        else {
            var displacement = node.op === "arg_i32" ?
                8 + node.index * 4 : -(node.index + 1) * 4;
            assembler.addEaxEbpDisplacement(displacement);
        }
    }

    function compareEaxWithSimpleOperand(assembler, node, state) {
        if (node.op === "const_i32") {
            assembler.compareEaxImmediate(node.value);
            return;
        }
        var key = (node.op === "arg_i32" ? "argument:" : "local:") + node.index;
        var registerName = state.registerMap[key];
        if (registerName === "ebx") assembler.compareEaxEbx();
        else if (registerName === "esi") assembler.compareEaxEsi();
        else if (registerName === "edi") assembler.compareEaxEdi();
        else {
            var displacement = node.op === "arg_i32" ?
                8 + node.index * 4 : -(node.index + 1) * 4;
            assembler.compareEaxEbpDisplacement(displacement);
        }
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
            var valueKey = (node.op === "set_local" ? "local:" : "argument:") +
                           node.index;
            if (state.registerMap[valueKey]) {
                moveEaxToRegister(assembler, state.registerMap[valueKey]);
            } else if (node.op === "set_local") assembler.movLocalEax(node.index);
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
            if (node.test.op === "const_i32") {
                emitStatement(assembler, node.test.value ?
                    node.consequent : node.alternate, state);
                return;
            }
            var alternateLabel = "kernel_else_" + state.nextLabel;
            var endLabel = "kernel_if_end_" + state.nextLabel++;
            if (!emitIntegerComparisonFalseJump(
                    assembler, node.test, alternateLabel, state)) {
                emitControlExpression(assembler, node.test, state);
                assembler.testEaxEax();
                assembler.jumpEqual(alternateLabel);
            }
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
        if (node.op === "opcode_dispatch") {
            emitOpcodeDispatch(assembler, node, state);
            return;
        }
        throw new Error("unsupported i386 control-flow statement " + node.op);
    }

    function emitIntegerComparisonFalseJump(assembler, node, label, state) {
        if (node.op !== "eq_i32" && node.op !== "ne_i32" &&
            node.op !== "lt_i32" && node.op !== "le_i32" &&
            node.op !== "gt_i32" && node.op !== "ge_i32") return false;
        var operation = node.op;
        var expression;
        var immediate;
        if (isSimpleIntegerOperand(node.right)) {
            expression = node.left;
            immediate = node.right;
        } else if (isSimpleIntegerOperand(node.left)) {
            expression = node.right;
            immediate = node.left;
            operation = reverseIntegerComparison(operation);
        } else return false;
        emitControlExpression(assembler, expression, state);
        compareEaxWithSimpleOperand(assembler, immediate, state);
        if (operation === "eq_i32") assembler.jumpNotEqual(label);
        else if (operation === "ne_i32") assembler.jumpEqual(label);
        else if (operation === "lt_i32") assembler.jumpGreaterOrEqual(label);
        else if (operation === "le_i32") assembler.jumpGreater(label);
        else if (operation === "gt_i32") assembler.jumpLessOrEqual(label);
        else assembler.jumpLess(label);
        return true;
    }

    function reverseIntegerComparison(operation) {
        if (operation === "lt_i32") return "gt_i32";
        if (operation === "le_i32") return "ge_i32";
        if (operation === "gt_i32") return "lt_i32";
        if (operation === "ge_i32") return "le_i32";
        return operation;
    }

    function emitOpcodeDispatch(assembler, node, state) {
        if (node.value.op !== "local_i32") {
            throw new Error("i386 opcode dispatch requires a kernel local");
        }
        var dispatchId = state.nextLabel++;
        var defaultLabel = "kernel_dispatch_default_" + dispatchId;
        var endLabel = "kernel_dispatch_end_" + dispatchId;
        emitControlExpression(assembler, node.value, state);
        emitBalancedDispatch(assembler, node.minimum, node.maximum,
                             dispatchId, defaultLabel);
        var opcode = node.minimum;
        while (opcode <= node.maximum) {
            assembler.label(dispatchCaseLabel(dispatchId, opcode));
            emitStatement(assembler,
                specializeDispatchStatement(node.body, node.value.index, opcode),
                state);
            assembler.jump(endLabel);
            opcode++;
        }
        assembler.label(defaultLabel);
        emitStatement(assembler, node.body, state);
        assembler.label(endLabel);
    }

    function emitBalancedDispatch(assembler, minimum, maximum, id,
                                  defaultLabel) {
        if (minimum > maximum) {
            assembler.jump(defaultLabel);
            return;
        }
        if (minimum === maximum) {
            assembler.compareEaxImmediate(minimum);
            assembler.jumpEqual(dispatchCaseLabel(id, minimum));
            assembler.jump(defaultLabel);
            return;
        }
        var pivot = (minimum + maximum) >> 1;
        var leftLabel = "kernel_dispatch_left_" + id + "_" + minimum +
                        "_" + maximum;
        assembler.compareEaxImmediate(pivot);
        assembler.jumpLess(leftLabel);
        assembler.jumpEqual(dispatchCaseLabel(id, pivot));
        emitBalancedDispatch(assembler, pivot + 1, maximum, id, defaultLabel);
        assembler.label(leftLabel);
        emitBalancedDispatch(assembler, minimum, pivot - 1, id, defaultLabel);
    }

    function dispatchCaseLabel(id, opcode) {
        return "kernel_dispatch_case_" + id + "_" + opcode;
    }

    function specializeDispatchStatement(node, localIndex, value) {
        if (!node || typeof node !== "object") return node;
        if (node.op === "if") {
            var test = specializeDispatchExpression(node.test, localIndex, value);
            if (test.op === "const_i32") {
                return specializeDispatchStatement(test.value ? node.consequent :
                                                    node.alternate,
                                                    localIndex, value);
            }
            return {op: "if", test: test,
                consequent: specializeDispatchStatement(
                    node.consequent, localIndex, value),
                alternate: specializeDispatchStatement(
                    node.alternate, localIndex, value)};
        }
        if (node.op === "block") {
            var body = [];
            var index = 0;
            while (index < node.body.length) {
                body.push(specializeDispatchStatement(
                    node.body[index++], localIndex, value));
            }
            return {op: "block", body: body};
        }
        if (node.op === "while" || node.op === "opcode_dispatch") return node;
        var result = {};
        var key;
        for (key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            var child = node[key];
            result[key] = child && typeof child === "object" ?
                specializeDispatchExpression(child, localIndex, value) : child;
        }
        return result;
    }

    function specializeDispatchExpression(node, localIndex, value) {
        if (!node || typeof node !== "object") return node;
        if (node.op === "local_i32" && node.index === localIndex) {
            return {op: "const_i32", value: value, type: "i32"};
        }
        var result = {};
        var key;
        for (key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            var child = node[key];
            result[key] = child && typeof child === "object" ?
                specializeDispatchExpression(child, localIndex, value) : child;
        }
        if (result.left && result.right &&
            result.left.op === "const_i32" && result.right.op === "const_i32") {
            return foldSpecializedInteger(result.op, result.left.value,
                                          result.right.value);
        }
        return result;
    }

    function foldSpecializedInteger(operation, left, right) {
        var value;
        var comparison = 0;
        if (operation === "eq_i32") { value = left === right; comparison = 1; }
        else if (operation === "ne_i32") { value = left !== right; comparison = 1; }
        else if (operation === "lt_i32") { value = left < right; comparison = 1; }
        else if (operation === "le_i32") { value = left <= right; comparison = 1; }
        else if (operation === "gt_i32") { value = left > right; comparison = 1; }
        else if (operation === "ge_i32") { value = left >= right; comparison = 1; }
        else if (operation === "add_i32") value = (left + right) | 0;
        else if (operation === "sub_i32") value = (left - right) | 0;
        else if (operation === "mul_i32") value = (left * right) | 0;
        else return {op: operation,
            left: {op: "const_i32", value: left, type: "i32"},
            right: {op: "const_i32", value: right, type: "i32"}, type: "i32"};
        return {op: "const_i32", value: comparison ? (value ? 1 : 0) : value,
                type: "i32"};
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
        else if (node.op === "arg_i32") {
            var argumentRegister = state.registerMap["argument:" + node.index];
            if (argumentRegister) moveRegisterToEax(assembler, argumentRegister);
            else assembler.movEaxEbpArgument(node.index);
        }
        else if (node.op === "local_i32") {
            var localRegister = state.registerMap["local:" + node.index];
            if (localRegister) moveRegisterToEax(assembler, localRegister);
            else assembler.movEaxLocal(node.index);
        }
        else if ((node.op === "eq_i32" || node.op === "ne_i32" ||
                  node.op === "lt_i32" || node.op === "le_i32" ||
                  node.op === "gt_i32" || node.op === "ge_i32") &&
                 (isSimpleIntegerOperand(node.left) ||
                  isSimpleIntegerOperand(node.right))) {
            var immediateComparison = node.op;
            var immediateExpression;
            var immediateValue;
            if (isSimpleIntegerOperand(node.right)) {
                immediateExpression = node.left;
                immediateValue = node.right;
            } else {
                immediateExpression = node.right;
                immediateValue = node.left;
                immediateComparison = reverseIntegerComparison(
                    immediateComparison);
            }
            emitControlExpression(assembler, immediateExpression, state);
            compareEaxWithSimpleOperand(assembler, immediateValue, state);
            if (immediateComparison === "eq_i32") assembler.setEqualAl();
            else if (immediateComparison === "ne_i32") assembler.setNotEqualAl();
            else if (immediateComparison === "lt_i32") assembler.setLessAl();
            else if (immediateComparison === "le_i32") assembler.setLessOrEqualAl();
            else if (immediateComparison === "gt_i32") assembler.setGreaterAl();
            else assembler.setGreaterOrEqualAl();
            assembler.movzxEaxAl();
        }
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
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.right)) {
            emitControlExpression(assembler, node.left, state);
            addSimpleOperandToEax(assembler, node.right, state);
        } else if (node.op === "add_i32" && isSimpleIntegerOperand(node.left)) {
            emitControlExpression(assembler, node.right, state);
            addSimpleOperandToEax(assembler, node.left, state);
        } else if (node.op === "sub_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            assembler.subtractEaxImmediate(node.right.value);
        } else if (node.op === "mul_i32" && node.right.op === "const_i32") {
            emitControlExpression(assembler, node.left, state);
            assembler.multiplyEaxImmediate(node.right.value);
        } else if (node.op === "mul_i32" && node.left.op === "const_i32") {
            emitControlExpression(assembler, node.right, state);
            assembler.multiplyEaxImmediate(node.left.value);
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
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            emitControlF64(assembler, node.value, state);
            if (node.op === "sin_f64") assembler.sinF64();
            else assembler.cosF64();
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
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            emitF64Expression(assembler, node.value);
            if (node.op === "sin_f64") assembler.sinF64();
            else assembler.cosF64();
            return;
        }
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
