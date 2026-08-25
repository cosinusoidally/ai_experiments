(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) {
        op = require("./bytecode.js");
    }

    /* This dispatch loop is intentionally low-level kernel-dialect code: one
     * numeric pc, fixed opcode layouts, register arrays, and calls to named
     * semantic helpers on the runtime. */
    function interpret(program, runtime) {
        var code = program.code;
        var constants = program.constants;
        var registers = [];
        var pc = 0;
        var budget = 10000000;
        var opcode;
        var target;
        var left;
        var right;
        var index;
        var args;
        runtime.activeRegisters = registers;
        while (pc < code.length) {
            budget = budget - 1;
            if (budget < 0) throw new Error("guest instruction budget exhausted");
            opcode = code[pc];
            if (opcode === op.CONST) {
                registers[code[pc + 1]] = constants[code[pc + 2]];
                pc = pc + 3;
            } else if (opcode === op.GET_GLOBAL) {
                registers[code[pc + 1]] = runtime.getGlobal(constants[code[pc + 2]]);
                pc = pc + 3;
            } else if (opcode === op.SET_GLOBAL) {
                runtime.setGlobal(constants[code[pc + 1]], registers[code[pc + 2]]);
                pc = pc + 3;
            } else if (opcode === op.MOVE) {
                registers[code[pc + 1]] = registers[code[pc + 2]];
                pc = pc + 3;
            } else if (opcode === op.GET_PROPERTY) {
                registers[code[pc + 1]] = runtime.getProperty(
                    registers[code[pc + 2]], registers[code[pc + 3]]);
                pc = pc + 4;
            } else if (opcode === op.SET_PROPERTY) {
                runtime.setProperty(registers[code[pc + 1]],
                                    registers[code[pc + 2]],
                                    registers[code[pc + 3]]);
                pc = pc + 4;
            } else if (opcode >= op.ADD && opcode <= op.GREATER_EQUAL) {
                target = code[pc + 1];
                left = registers[code[pc + 2]];
                right = registers[code[pc + 3]];
                if (opcode === op.ADD) registers[target] = runtime.add(left, right);
                else if (opcode === op.SUBTRACT) registers[target] = Number(left) - Number(right);
                else if (opcode === op.MULTIPLY) registers[target] = Number(left) * Number(right);
                else if (opcode === op.DIVIDE) registers[target] = Number(left) / Number(right);
                else if (opcode === op.REMAINDER) registers[target] = Number(left) % Number(right);
                else if (opcode === op.STRICT_EQUAL) registers[target] = left === right;
                else if (opcode === op.EQUAL) registers[target] = runtime.equal(left, right);
                else if (opcode === op.LESS) registers[target] = left < right;
                else if (opcode === op.LESS_EQUAL) registers[target] = left <= right;
                else if (opcode === op.GREATER) registers[target] = left > right;
                else registers[target] = left >= right;
                pc = pc + 4;
            } else if (opcode === op.NOT) {
                registers[code[pc + 1]] = !runtime.truthy(registers[code[pc + 2]]);
                pc = pc + 3;
            } else if (opcode === op.NEGATE) {
                registers[code[pc + 1]] = -Number(registers[code[pc + 2]]);
                pc = pc + 3;
            } else if (opcode === op.POSITIVE) {
                registers[code[pc + 1]] = Number(registers[code[pc + 2]]);
                pc = pc + 3;
            } else if (opcode === op.JUMP) {
                pc = code[pc + 1];
            } else if (opcode === op.JUMP_IF_FALSE) {
                if (!runtime.truthy(registers[code[pc + 1]])) pc = code[pc + 2];
                else pc = pc + 3;
            } else if (opcode === op.CALL) {
                args = [];
                index = 0;
                while (index < code[pc + 5]) {
                    args[index] = registers[code[pc + 4] + index];
                    index = index + 1;
                }
                registers[code[pc + 1]] = runtime.call(
                    registers[code[pc + 2]],
                    code[pc + 3] < 0 ? undefined : registers[code[pc + 3]], args);
                pc = pc + 6;
            } else if (opcode === op.RETURN) {
                var returnValue = registers[code[pc + 1]];
                runtime.activeRegisters = null;
                return returnValue;
            } else {
                throw new Error("invalid guest opcode " + opcode + " at " + pc);
            }
        }
        runtime.activeRegisters = null;
        return undefined;
    }

    root.GuestVMInterpret = interpret;
    if (typeof module !== "undefined" && module.exports) module.exports = interpret;
}(this));
