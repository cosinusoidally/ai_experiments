(function (root) {
    var op = {
        CONST: 1,
        GET_GLOBAL: 2,
        SET_GLOBAL: 3,
        MOVE: 4,
        GET_PROPERTY: 5,
        SET_PROPERTY: 6,
        ADD: 7,
        SUBTRACT: 8,
        MULTIPLY: 9,
        DIVIDE: 10,
        REMAINDER: 11,
        STRICT_EQUAL: 12,
        EQUAL: 13,
        LESS: 14,
        LESS_EQUAL: 15,
        GREATER: 16,
        GREATER_EQUAL: 17,
        NOT: 18,
        NEGATE: 19,
        POSITIVE: 20,
        JUMP: 21,
        JUMP_IF_FALSE: 22,
        CALL: 23,
        RETURN: 24,
        MAKE_FUNCTION: 25,
        MAKE_OBJECT: 26,
        MAKE_ARRAY: 27,
        MAKE_REGEXP: 28,
        BIT_AND: 29,
        BIT_OR: 30,
        BIT_XOR: 31,
        SHIFT_LEFT: 32,
        SHIFT_RIGHT: 33,
        SHIFT_UNSIGNED_RIGHT: 34,
        THROW: 35,
        CONSTRUCT: 36,
        PUSH_CATCH: 37,
        POP_CATCH: 38,
        BIT_NOT: 39,
        TYPEOF: 40,
        DELETE_PROPERTY: 41,
        GET_KEYS: 42,
        GET_LOCAL: 43,
        SET_LOCAL: 44,
        GET_PROPERTY_CONST: 45,
        SET_PROPERTY_CONST: 46,
        DELETE_PROPERTY_CONST: 47,
        TYPEOF_GLOBAL: 48,
        IN: 49,
        INSTANCEOF: 50,
        GET_THIS: 51,
        DEFINE_GETTER: 52,
        DEFINE_SETTER: 53,
        ENTER_WITH: 54,
        LEAVE_WITH: 55,
        GET_NAME: 56,
        SET_NAME: 57,
        TYPEOF_NAME: 58,
        DELETE_NAME: 59,
        INVALID_ASSIGNMENT: 60
    };

    op.NAMES = [];
    var opcodeName;
    for (opcodeName in op) {
        if (opcodeName !== "NAMES" && typeof op[opcodeName] === "number") {
            op.NAMES[op[opcodeName]] = opcodeName;
        }
    }

    /* Shared instruction layout: consumers must not maintain their own opcode
     * width or destination lists. Operand zero is always the opcode itself. */
    op.WIDTHS = [];
    op.DESTINATION_OPERANDS = [];
    function layout(width, destination, instructions) {
        var index;
        for (index = 0; index < instructions.length; index++) {
            op.WIDTHS[instructions[index]] = width;
            op.DESTINATION_OPERANDS[instructions[index]] = destination;
        }
    }
    layout(1, 0, [op.POP_CATCH, op.LEAVE_WITH, op.INVALID_ASSIGNMENT]);
    layout(2, 0, [op.JUMP, op.RETURN, op.THROW, op.ENTER_WITH]);
    layout(2, 1, [op.MAKE_OBJECT, op.GET_THIS]);
    layout(3, 0, [op.SET_GLOBAL, op.SET_NAME, op.JUMP_IF_FALSE, op.PUSH_CATCH]);
    layout(3, 1, [op.CONST, op.GET_GLOBAL, op.MOVE, op.NOT, op.NEGATE,
        op.POSITIVE, op.MAKE_FUNCTION, op.MAKE_ARRAY, op.BIT_NOT, op.TYPEOF,
        op.TYPEOF_GLOBAL, op.GET_KEYS, op.GET_NAME, op.TYPEOF_NAME, op.DELETE_NAME]);
    layout(4, 0, [op.SET_PROPERTY, op.SET_LOCAL, op.SET_PROPERTY_CONST,
        op.DEFINE_GETTER, op.DEFINE_SETTER]);
    layout(4, 1, [op.GET_PROPERTY, op.GET_LOCAL, op.GET_PROPERTY_CONST,
        op.DELETE_PROPERTY_CONST, op.IN, op.INSTANCEOF, op.ADD, op.SUBTRACT,
        op.MULTIPLY, op.DIVIDE, op.REMAINDER, op.STRICT_EQUAL, op.EQUAL,
        op.LESS, op.LESS_EQUAL, op.GREATER, op.GREATER_EQUAL, op.BIT_AND,
        op.BIT_OR, op.BIT_XOR, op.SHIFT_LEFT, op.SHIFT_RIGHT,
        op.SHIFT_UNSIGNED_RIGHT, op.MAKE_REGEXP, op.DELETE_PROPERTY, op.CONSTRUCT]);
    layout(5, 1, [op.CALL]);

    root.GuestVMBytecode = op;
    if (typeof module !== "undefined" && module.exports) module.exports = op;
}(this));
