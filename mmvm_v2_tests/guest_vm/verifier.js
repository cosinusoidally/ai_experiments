(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    function requireRegister(program, value, pc) {
        if (value < 0 || value >= program.registerCount || value !== Math.floor(value)) {
            throw new Error("invalid register " + value + " at bytecode " + pc);
        }
    }

    function verify(program) {
        var code = program.code;
        var boundaries = {};
        var jumps = [];
        var pc = 0;
        while (pc < code.length) {
            boundaries[pc] = true;
            var opcode = code[pc];
            var width;
            if (opcode === op.CONST || opcode === op.GET_GLOBAL ||
                opcode === op.SET_GLOBAL || opcode === op.MOVE ||
                opcode === op.NOT || opcode === op.NEGATE ||
                opcode === op.POSITIVE || opcode === op.MAKE_FUNCTION) width = 3;
            else if (opcode === op.GET_PROPERTY || opcode === op.SET_PROPERTY ||
                     (opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
                     (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
                     opcode === op.MAKE_REGEXP) width = 4;
            else if (opcode === op.JUMP || opcode === op.RETURN ||
                     opcode === op.MAKE_OBJECT || opcode === op.MAKE_ARRAY ||
                     opcode === op.THROW) width = 2;
            else if (opcode === op.PUSH_CATCH) width = 3;
            else if (opcode === op.POP_CATCH) width = 1;
            else if (opcode === op.JUMP_IF_FALSE) width = 3;
            else if (opcode === op.CALL) width = 6;
            else if (opcode === op.CONSTRUCT) width = 5;
            else throw new Error("invalid opcode " + opcode + " at bytecode " + pc);
            if (pc + width > code.length) throw new Error("truncated bytecode at " + pc);

            if (opcode === op.CONST || opcode === op.GET_GLOBAL ||
                opcode === op.MAKE_FUNCTION) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length) {
                    throw new Error("invalid constant at bytecode " + pc);
                }
            } else if (opcode === op.SET_GLOBAL) {
                if (code[pc + 1] < 0 || code[pc + 1] >= program.constants.length) {
                    throw new Error("invalid global name at bytecode " + pc);
                }
                requireRegister(program, code[pc + 2], pc);
            } else if (opcode === op.MOVE || opcode === op.NOT ||
                       opcode === op.NEGATE || opcode === op.POSITIVE) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                if (opcode === op.MAKE_FUNCTION) verify(program.constants[code[pc + 2]]);
            } else if (opcode === op.GET_PROPERTY || opcode === op.SET_PROPERTY ||
                       (opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
                       (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT)) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                requireRegister(program, code[pc + 3], pc);
            } else if (opcode === op.JUMP) {
                jumps.push(code[pc + 1]);
            } else if (opcode === op.PUSH_CATCH) {
                jumps.push(code[pc + 1]);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length) {
                    throw new Error("invalid catch binding at bytecode " + pc);
                }
            } else if (opcode === op.JUMP_IF_FALSE) {
                requireRegister(program, code[pc + 1], pc);
                jumps.push(code[pc + 2]);
            } else if (opcode === op.CALL) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                if (code[pc + 3] >= 0) requireRegister(program, code[pc + 3], pc);
                var count = code[pc + 5];
                if (count < 0 || code[pc + 4] < 0 ||
                    code[pc + 4] + count > program.registerCount) {
                    throw new Error("invalid call arguments at bytecode " + pc);
                }
            } else if (opcode === op.CONSTRUCT) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                var constructCount = code[pc + 4];
                if (constructCount < 0 || code[pc + 3] < 0 ||
                    code[pc + 3] + constructCount > program.registerCount) {
                    throw new Error("invalid constructor arguments at bytecode " + pc);
                }
            } else if (opcode === op.MAKE_REGEXP) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length ||
                    code[pc + 3] < 0 || code[pc + 3] >= program.constants.length) {
                    throw new Error("invalid regexp constant at bytecode " + pc);
                }
            } else if (opcode === op.RETURN || opcode === op.MAKE_OBJECT ||
                       opcode === op.MAKE_ARRAY || opcode === op.THROW) {
                requireRegister(program, code[pc + 1], pc);
            }
            pc += width;
        }
        if (pc !== code.length) throw new Error("bytecode has trailing partial instruction");
        var index = 0;
        while (index < jumps.length) {
            if (!boundaries[jumps[index]]) {
                throw new Error("jump target is not an instruction boundary: " + jumps[index]);
            }
            index++;
        }
        return program;
    }

    root.GuestVMVerify = verify;
    if (typeof module !== "undefined" && module.exports) module.exports = verify;
}(this));
