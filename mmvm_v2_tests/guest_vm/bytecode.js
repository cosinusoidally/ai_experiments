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
        RETURN: 24
    };

    root.GuestVMBytecode = op;
    if (typeof module !== "undefined" && module.exports) module.exports = op;
}(this));
