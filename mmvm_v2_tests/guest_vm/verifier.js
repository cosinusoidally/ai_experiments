(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    var MAX_ARRAY_CAPACITY = 67108860;

    function requireRegister(program, value, pc) {
        if (value < 0 || value >= program.registerCount || value !== Math.floor(value)) {
            throw new Error("invalid register " + value + " at bytecode " + pc);
        }
    }

    function verify(program) {
        var code = program.code;
        var jumps = [];
        var pc = 0;
        while (pc < code.length) {
            var opcode = code[pc];
            var width = op.WIDTHS[opcode];
            if (!width) throw new Error("invalid opcode " + opcode + " at bytecode " + pc);
            if (pc + width > code.length) throw new Error("truncated bytecode at " + pc);

            if (opcode === op.CONST || opcode === op.GET_GLOBAL ||
                opcode === op.TYPEOF_GLOBAL ||
                opcode === op.MAKE_FUNCTION) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length) {
                    throw new Error("invalid constant at bytecode " + pc);
                }
            } else if (opcode === op.GET_THIS) {
                requireRegister(program, code[pc + 1], pc);
            } else if (opcode === op.SET_GLOBAL) {
                if (code[pc + 1] < 0 || code[pc + 1] >= program.constants.length) {
                    throw new Error("invalid global name at bytecode " + pc);
                }
                requireRegister(program, code[pc + 2], pc);
            } else if (opcode === op.GET_NAME || opcode === op.TYPEOF_NAME ||
                       opcode === op.DELETE_NAME) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length) {
                    throw new Error("invalid name constant at bytecode " + pc);
                }
            } else if (opcode === op.SET_NAME) {
                if (code[pc + 1] < 0 || code[pc + 1] >= program.constants.length) {
                    throw new Error("invalid name constant at bytecode " + pc);
                }
                requireRegister(program, code[pc + 2], pc);
            } else if (opcode === op.ENTER_WITH) {
                requireRegister(program, code[pc + 1], pc);
            } else if (opcode === op.MOVE || opcode === op.NOT ||
                       opcode === op.TO_INT32 ||
                       opcode === op.NEGATE || opcode === op.POSITIVE ||
                       opcode === op.BIT_NOT || opcode === op.TYPEOF ||
                       opcode === op.GET_KEYS) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                if (opcode === op.MAKE_FUNCTION) verify(program.constants[code[pc + 2]]);
            } else if (opcode === op.GET_PROPERTY || opcode === op.SET_PROPERTY ||
                       opcode === op.ADD_INT32 || opcode === op.SUBTRACT_INT32 ||
                       (opcode >= op.ADD && opcode <= op.GREATER_EQUAL) ||
                       (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
                       opcode === op.DELETE_PROPERTY || opcode === op.IN ||
                       opcode === op.INSTANCEOF ||
                       opcode === op.DEFINE_GETTER ||
                       opcode === op.DEFINE_SETTER) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                requireRegister(program, code[pc + 3], pc);
            } else if (opcode === op.GET_LOCAL) {
                requireRegister(program, code[pc + 1], pc);
                requireLexicalOperand(code[pc + 2], "depth", pc);
                requireLexicalOperand(code[pc + 3], "slot", pc);
            } else if (opcode === op.SET_LOCAL) {
                requireLexicalOperand(code[pc + 1], "depth", pc);
                requireLexicalOperand(code[pc + 2], "slot", pc);
                requireRegister(program, code[pc + 3], pc);
            } else if (opcode === op.GET_PROPERTY_CONST ||
                       opcode === op.SET_PROPERTY_CONST ||
                       opcode === op.DELETE_PROPERTY_CONST) {
                requireRegister(program, code[pc + 1], pc);
                if (opcode === op.SET_PROPERTY_CONST) {
                    if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length) {
                        throw new Error("invalid property constant at bytecode " + pc);
                    }
                    requireRegister(program, code[pc + 3], pc);
                } else {
                    requireRegister(program, code[pc + 2], pc);
                    if (code[pc + 3] < 0 || code[pc + 3] >= program.constants.length) {
                        throw new Error("invalid property constant at bytecode " + pc);
                    }
                }
            } else if (opcode === op.JUMP) {
                jumps.push(code[pc + 1]);
            } else if (opcode === op.PUSH_CATCH_SCOPE) {
                jumps.push(code[pc + 1]);
                var scopeName = code[pc + 2];
                if (scopeName < 0 || scopeName >= program.constants.length ||
                        typeof program.constants[scopeName] !== "string") {
                    throw new Error("invalid catch name at bytecode " + pc);
                }
            } else if (opcode === op.PUSH_CATCH) {
                jumps.push(code[pc + 1]);
                var catchBinding = code[pc + 2];
                var catchBindingValid = false;
                if (catchBinding < 0) {
                    var catchNameConstant = -catchBinding - 1;
                    catchBindingValid = catchNameConstant >= 0 &&
                        catchNameConstant < program.constants.length;
                } else if (program.bindings) {
                    catchBindingValid = catchBinding < program.bindings.length;
                }
                if (!catchBindingValid) {
                    throw new Error("invalid catch binding at bytecode " + pc);
                }
            } else if (opcode === op.JUMP_IF_FALSE) {
                requireRegister(program, code[pc + 1], pc);
                jumps.push(code[pc + 2]);
            } else if (opcode === op.CALL) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                if (code[pc + 3] >= 0) requireRegister(program, code[pc + 3], pc);
                requireArgumentList(program, code[pc + 4], pc);
            } else if (opcode === op.CONSTRUCT) {
                requireRegister(program, code[pc + 1], pc);
                requireRegister(program, code[pc + 2], pc);
                requireArgumentList(program, code[pc + 3], pc);
            } else if (opcode === op.MAKE_REGEXP) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] >= program.constants.length ||
                    code[pc + 3] < 0 || code[pc + 3] >= program.constants.length) {
                    throw new Error("invalid regexp constant at bytecode " + pc);
                }
            } else if (opcode === op.MAKE_ARRAY) {
                requireRegister(program, code[pc + 1], pc);
                if (code[pc + 2] < 0 || code[pc + 2] > MAX_ARRAY_CAPACITY ||
                    code[pc + 2] !== Math.floor(code[pc + 2])) {
                    throw new Error("invalid initial Array capacity at bytecode " + pc);
                }
            } else if (opcode === op.RETURN || opcode === op.MAKE_OBJECT ||
                       opcode === op.THROW) {
                requireRegister(program, code[pc + 1], pc);
            }
            pc += width;
        }
        if (pc !== code.length) throw new Error("bytecode has trailing partial instruction");
        /* Validate the relatively small set of edges against a second linear
         * instruction walk. A property per instruction wastes substantial
         * space on large straight-line initializers and is unnecessary. */
        jumps.sort(function (left, right) { return left - right; });
        pc = 0;
        var index = 0;
        while (index < jumps.length) {
            var target = jumps[index];
            while (pc < target && pc < code.length) pc += op.WIDTHS[code[pc]];
            if (pc !== target || pc >= code.length) {
                throw new Error("jump target is not an instruction boundary: " + jumps[index]);
            }
            index++;
        }
        return program;
    }

    function requireLexicalOperand(value, name, pc) {
        if (value < 0 || value !== Math.floor(value)) {
            throw new Error("invalid lexical " + name + " at bytecode " + pc);
        }
    }

    function requireArgumentList(program, constantIndex, pc) {
        if (constantIndex < 0 || constantIndex >= program.constants.length) {
            throw new Error("invalid argument-list constant at bytecode " + pc);
        }
        var registers = program.constants[constantIndex];
        if (!registers || typeof registers.length !== "number") {
            throw new Error("invalid argument list at bytecode " + pc);
        }
        var index = 0;
        while (index < registers.length) {
            requireRegister(program, registers[index++], pc);
        }
    }

    root.GuestVMVerify = verify;
    if (typeof module !== "undefined" && module.exports) module.exports = verify;
}(this));
