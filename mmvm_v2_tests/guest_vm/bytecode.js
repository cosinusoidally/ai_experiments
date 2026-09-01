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
        TYPEOF_GLOBAL: 48
    };

    op.NAMES = [];
    var opcodeName;
    for (opcodeName in op) {
        if (opcodeName !== "NAMES" && typeof op[opcodeName] === "number") {
            op.NAMES[op[opcodeName]] = opcodeName;
        }
    }

    root.GuestVMBytecode = op;
    if (typeof module !== "undefined" && module.exports) module.exports = op;
}(this));
