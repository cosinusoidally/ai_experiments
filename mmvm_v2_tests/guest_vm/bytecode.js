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
        INVALID_ASSIGNMENT: 60,
        ADD_INT32: 61,
        SUBTRACT_INT32: 62,
        TO_INT32: 63,
        PUSH_CATCH_SCOPE: 64,
        DEFINE_DATA_PROPERTY: 65
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
    layout(3, 0, [op.SET_GLOBAL, op.SET_NAME, op.JUMP_IF_FALSE, op.PUSH_CATCH,
        op.PUSH_CATCH_SCOPE]);
    layout(3, 1, [op.CONST, op.GET_GLOBAL, op.MOVE, op.NOT, op.NEGATE,
        op.POSITIVE, op.MAKE_FUNCTION, op.MAKE_ARRAY, op.BIT_NOT, op.TYPEOF,
        op.TYPEOF_GLOBAL, op.GET_KEYS, op.GET_NAME, op.TYPEOF_NAME, op.DELETE_NAME,
        op.TO_INT32]);
    layout(4, 0, [op.SET_PROPERTY, op.SET_LOCAL, op.SET_PROPERTY_CONST,
        op.DEFINE_GETTER, op.DEFINE_SETTER, op.DEFINE_DATA_PROPERTY]);
    layout(4, 1, [op.GET_PROPERTY, op.GET_LOCAL, op.GET_PROPERTY_CONST,
        op.DELETE_PROPERTY_CONST, op.IN, op.INSTANCEOF, op.ADD, op.SUBTRACT,
        op.MULTIPLY, op.DIVIDE, op.REMAINDER, op.STRICT_EQUAL, op.EQUAL,
        op.LESS, op.LESS_EQUAL, op.GREATER, op.GREATER_EQUAL, op.BIT_AND,
        op.BIT_OR, op.BIT_XOR, op.SHIFT_LEFT, op.SHIFT_RIGHT,
        op.SHIFT_UNSIGNED_RIGHT, op.MAKE_REGEXP, op.DELETE_PROPERTY, op.CONSTRUCT,
        op.ADD_INT32, op.SUBTRACT_INT32]);
    layout(5, 1, [op.CALL]);

    /* Explicit register reads. Constant indices, lexical slots, jump targets
     * and CALL argument-vector indices are not register operands. CALL and
     * CONSTRUCT also read the registers listed in their constant vector. */
    op.SOURCE_OPERANDS = [];
    function inputs(positions, instructions) {
        var index;
        for (index = 0; index < instructions.length; index++) {
            op.SOURCE_OPERANDS[instructions[index]] = positions;
        }
    }
    inputs([], [op.CONST, op.GET_GLOBAL, op.GET_THIS, op.MAKE_FUNCTION,
        op.MAKE_OBJECT, op.MAKE_ARRAY, op.MAKE_REGEXP, op.GET_LOCAL,
        op.TYPEOF_GLOBAL, op.GET_NAME, op.TYPEOF_NAME, op.DELETE_NAME,
        op.JUMP, op.PUSH_CATCH, op.PUSH_CATCH_SCOPE, op.POP_CATCH,
        op.LEAVE_WITH, op.INVALID_ASSIGNMENT]);
    inputs([1], [op.RETURN, op.THROW, op.ENTER_WITH, op.JUMP_IF_FALSE]);
    inputs([2], [op.MOVE, op.NOT, op.NEGATE, op.POSITIVE, op.BIT_NOT,
        op.TYPEOF, op.GET_KEYS, op.TO_INT32, op.GET_PROPERTY_CONST,
        op.DELETE_PROPERTY_CONST, op.SET_GLOBAL, op.SET_NAME, op.CONSTRUCT]);
    inputs([2, 3], [op.GET_PROPERTY, op.DELETE_PROPERTY, op.ADD, op.SUBTRACT,
        op.MULTIPLY, op.DIVIDE, op.REMAINDER, op.STRICT_EQUAL, op.EQUAL,
        op.LESS, op.LESS_EQUAL, op.GREATER, op.GREATER_EQUAL,
        op.BIT_AND, op.BIT_OR, op.BIT_XOR, op.SHIFT_LEFT, op.SHIFT_RIGHT,
        op.SHIFT_UNSIGNED_RIGHT, op.IN, op.INSTANCEOF, op.ADD_INT32,
        op.SUBTRACT_INT32, op.CALL]);
    inputs([1, 2, 3], [op.SET_PROPERTY, op.DEFINE_GETTER, op.DEFINE_SETTER,
        op.DEFINE_DATA_PROPERTY]);
    inputs([1, 3], [op.SET_PROPERTY_CONST]);
    inputs([3], [op.SET_LOCAL]);

    /* Private execution-view layout. Canonical bytecode and public register
     * numbering remain unchanged. Initially predecode the value/storage
     * families; calls and their argument vectors keep canonical indices. */
    op.NATIVE_LAYOUT = {WIDTH: 0, REGISTER_MASK: 1, STRIDE: 2};
    op.NATIVE_REGISTER_MASKS = [];
    var offsetInstructions = [op.CONST, op.MOVE, op.GET_LOCAL, op.SET_LOCAL, op.GET_PROPERTY,
        op.TO_INT32, op.ADD_INT32, op.SUBTRACT_INT32,
        op.BIT_AND, op.BIT_OR, op.BIT_XOR, op.SHIFT_LEFT, op.SHIFT_RIGHT,
        op.SHIFT_UNSIGNED_RIGHT, op.BIT_NOT,
        op.ADD, op.SUBTRACT, op.MULTIPLY, op.DIVIDE, op.REMAINDER,
        op.STRICT_EQUAL, op.EQUAL, op.LESS, op.LESS_EQUAL, op.GREATER,
        op.GREATER_EQUAL, op.NOT, op.NEGATE, op.POSITIVE, op.JUMP_IF_FALSE];
    var offsetInstructionIndex, offsetOperandIndex;
    for (offsetInstructionIndex = 0; offsetInstructionIndex < offsetInstructions.length;
         offsetInstructionIndex++) {
        var offsetOpcode = offsetInstructions[offsetInstructionIndex];
        var registerMask = 0;
        var offsetSources = op.SOURCE_OPERANDS[offsetOpcode];
        for (offsetOperandIndex = 0; offsetOperandIndex < offsetSources.length;
             offsetOperandIndex++) registerMask |= 1 << offsetSources[offsetOperandIndex];
        if (op.DESTINATION_OPERANDS[offsetOpcode]) {
            registerMask |= 1 << op.DESTINATION_OPERANDS[offsetOpcode];
        }
        op.NATIVE_REGISTER_MASKS[offsetOpcode] = registerMask;
    }

    /* Compiler-owned integer streams. Public descriptors keep ordinary arrays
     * by default; self-hosted compilation can request compact word storage.
     * The builder's logical length is independent of its backing capacity. */
    var INITIAL_WORD_CAPACITY = 32;
    var MAX_WORKSPACE_WORDS = 4 * 1024 * 1024;
    /* Compiler-only tables must not demand a geometrically growing contiguous
     * tagged vector. Pages preserve indexed/sparse semantics while bounding
     * each allocation. Public descriptors still use ordinary arrays. */
    var TABLE_PAGE_SHIFT = 10;
    var TABLE_PAGE_SIZE = 1 << TABLE_PAGE_SHIFT;
    var TABLE_PAGE_MASK = TABLE_PAGE_SIZE - 1;
    function PagedTable() {
        this.pages = [];
        this.length = 0;
    }
    PagedTable.prototype.get = function (index) {
        var page = this.pages[index >>> TABLE_PAGE_SHIFT];
        return page ? page[index & TABLE_PAGE_MASK] : undefined;
    };
    PagedTable.prototype.set = function (index, value) {
        var pageIndex = index >>> TABLE_PAGE_SHIFT;
        var page = this.pages[pageIndex];
        if (!page) page = this.pages[pageIndex] = [];
        page[index & TABLE_PAGE_MASK] = value;
        if (index >= this.length) this.length = index + 1;
    };
    PagedTable.prototype.push = function (value) {
        this.set(this.length, value);
        return this.length;
    };
    op.PagedTable = PagedTable;
    op.tableGet = function (table, index) {
        return table.pages ? table.get(index) : table[index];
    };
    op.tableSet = function (table, index, value) {
        if (table.pages) table.set(index, value);
        else table[index] = value;
    };
    op.createWordArena = function (sourceLength) {
        if (typeof Int32Array !== "function") return null;
        var capacity = Math.max(INITIAL_WORD_CAPACITY,
            Math.min(sourceLength, MAX_WORKSPACE_WORDS));
        return {words: new Int32Array(capacity), used: 0};
    };
    function WordBuffer(packed, arena) {
        this.packed = !!packed && typeof Int32Array === "function";
        this.arena = this.packed ? arena || null : null;
        this.arenaStart = this.arena ? this.arena.used : 0;
        this.words = this.arena ? this.arena.words.subarray(this.arenaStart) :
            this.packed ? null : [];
        this.length = 0;
        this.capacity = this.arena ? this.words.length : 0;
        if (!this.packed) this.appendKnownWords = this.append;
    }
    WordBuffer.prototype.grow = function (required) {
        var capacity = this.capacity || INITIAL_WORD_CAPACITY;
        while (capacity < required) capacity *= 2;
        var replacement = new Int32Array(capacity);
        if (this.length) replacement.set(this.words.subarray(0, this.length));
        this.words = replacement;
        this.capacity = capacity;
        /* An underestimated workspace is not a language limit. Keep the
         * private prefix reserved until its function sink completes. */
        this.arena = null;
    };
    WordBuffer.prototype.append = function (values) {
        var index = 0;
        if (!this.packed) {
            while (index < values.length) this.words.push(values[index++]);
            this.length = this.words.length;
            return;
        }
        var required = this.length + values.length;
        if (required > this.capacity) this.grow(required);
        while (index < values.length) {
            var value = values[index++];
            if (value !== (value | 0)) throw new RangeError("invalid bytecode word");
            this.words[this.length++] = value;
        }
        if (this.arena) this.arena.used = this.arenaStart + this.length;
    };
    /* Instruction producers already supply canonical signed words (opcode,
     * allocated register/constant indices and bounded PCs). Batch those words
     * through the normal typed-array API rather than reinterpreting a JS loop
     * per word. Keep append's checked behavior for non-producer callers. */
    WordBuffer.prototype.appendKnownWords = function (values) {
        if (!values.length) return;
        var required = this.length + values.length;
        if (required > this.capacity) this.grow(required);
        this.words.set(values, this.length);
        this.length = required;
        if (this.arena) this.arena.used = this.arenaStart + this.length;
    };
    WordBuffer.prototype.finish = function () {
        if (!this.packed) return this.words;
        return this.words ? this.words.subarray(0, this.length) : new Int32Array(0);
    };
    WordBuffer.prototype.releaseWorkspace = function (arena) {
        if (arena) arena.used = this.arenaStart;
    };
    op.WordBuffer = WordBuffer;
    op.copyWords = function (words, start, end) {
        if (typeof words.slice === "function") return words.slice(start, end);
        var result = [], index = start;
        while (index < end) result.push(words[index++]);
        return result;
    };

    root.GuestVMBytecode = op;
    if (typeof module !== "undefined" && module.exports) module.exports = op;
}(this));
