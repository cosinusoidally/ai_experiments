/* Conservative bytecode register packing. Only single-definition temporaries
 * confined to one basic block share storage. Named bindings, constants and
 * values crossing an edge retain private slots. No exception-edge or alias
 * analysis is assumed. PCs and all observable execution order stay unchanged. */
(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    /* Packing is optional. Its per-register liveness vectors must not consume
     * an unbounded fraction of the heap for very large generated functions. */
    var MAX_PACKING_REGISTERS = 262144;
    /* Integer scratch records, not guest-heap object layouts. Resolve a page
     * once per register visit instead of dispatching a generic table accessor
     * for every field. Pages bound allocations even for generated functions.
     * First-PC fields store pc+1: zero (or an ES3 fallback hole) means unseen. */
    var PAGE_SHIFT = 10;
    var PAGE_ENTRIES = 1 << PAGE_SHIFT;
    var PAGE_MASK = PAGE_ENTRIES - 1;
    var FIRST_ACCESS = 0, LAST_ACCESS = 1, BLOCK_NUMBER = 2;
    var DEFINITION_COUNT = 3, FIRST_DEFINITION = 4, FIRST_READ = 5;
    var PINNED = 6, REGISTER_MAP = 7, ANALYSIS_WORDS = 8;

    function scratchPages(count, wordsPerEntry) {
        var pages = [], first = 0;
        while (first < count) {
            var words = Math.min(PAGE_ENTRIES, count - first) * wordsPerEntry;
            var page;
            if (typeof Int32Array === "function") page = new Int32Array(words);
            else page = new Array(words);
            pages.push(page);
            first += PAGE_ENTRIES;
        }
        return pages;
    }

    function pack(program, bindingCount) {
        var code = program.code, count = program.registerCount;
        if (count > MAX_PACKING_REGISTERS) return program;
        var boundaries = {0: true};
        var metadata;
        var data, entry;
        var pc, opcode, index, reads, destination, vector, argument;
        /* These constructs require exceptional/dynamic scope liveness. Leave
         * them unchanged until that analysis is available, not approximately
         * optimized. The normal compiler/verifier still handles them. */
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            if (!op.SOURCE_OPERANDS[opcode] || opcode === op.PUSH_CATCH || opcode === op.PUSH_CATCH_SCOPE ||
                    opcode === op.POP_CATCH || opcode === op.ENTER_WITH ||
                    opcode === op.LEAVE_WITH) return program;
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE) {
                boundaries[code[pc + (opcode === op.JUMP ? 1 : 2)]] = true;
                boundaries[pc + op.WIDTHS[opcode]] = true;
            } else if (opcode === op.RETURN || opcode === op.THROW ||
                    opcode === op.INVALID_ASSIGNMENT) {
                boundaries[pc + op.WIDTHS[opcode]] = true;
            }
        }
        metadata = scratchPages(count, ANALYSIS_WORDS);
        var block = -1;
        var register, isDefinition, callCount, accessCount;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            if (boundaries[pc]) block++;
            reads = op.SOURCE_OPERANDS[opcode];
            callCount = 0;
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                vector = op.tableGet(program.constants, code[pc + (opcode === op.CALL ? 4 : 3)]);
                callCount = vector.length;
            }
            destination = op.DESTINATION_OPERANDS[opcode];
            accessCount = reads.length + callCount + (destination ? 1 : 0);
            /* One operand walk avoids allocating a capturing callback and
             * entering a guest function for every storage access. */
            for (index = 0; index < accessCount; index++) {
                isDefinition = false;
                if (index < reads.length) register = code[pc + reads[index]];
                else if (index < reads.length + callCount) register = vector[index - reads.length];
                else {
                    register = code[pc + destination];
                    isDefinition = true;
                }
                /* Negative CALL receiver sentinels are not storage. */
                if (register < 0) continue;
                data = metadata[register >>> PAGE_SHIFT];
                entry = (register & PAGE_MASK) * ANALYSIS_WORDS;
                if (!data[entry + FIRST_ACCESS]) {
                    data[entry + FIRST_ACCESS] = pc + 1;
                    data[entry + BLOCK_NUMBER] = block;
                } else if (data[entry + BLOCK_NUMBER] !== block) data[entry + BLOCK_NUMBER] = -1;
                data[entry + LAST_ACCESS] = pc;
                if (isDefinition) {
                    data[entry + DEFINITION_COUNT] = (data[entry + DEFINITION_COUNT] || 0) + 1;
                    if (!data[entry + FIRST_DEFINITION]) data[entry + FIRST_DEFINITION] = pc + 1;
                } else if (!data[entry + FIRST_READ]) data[entry + FIRST_READ] = pc + 1;
            }
        }
        var constantRegisters = program.constantRegisters || [];
        var hints = program.registerHints || [];
        for (index = 0; index < bindingCount; index++) {
            metadata[index >>> PAGE_SHIFT][(index & PAGE_MASK) * ANALYSIS_WORDS + PINNED] = 1;
        }
        for (index = 0; index < constantRegisters.length; index++) {
            argument = op.tableGet(constantRegisters, index);
            if (typeof argument === "number" && argument >= 0) {
                metadata[argument >>> PAGE_SHIFT][(argument & PAGE_MASK) * ANALYSIS_WORDS + PINNED] = 1;
            }
        }
        var privateCount = 0;
        for (index = 0; index < count; index++) {
            /* Preserve compiler hints without assigning a hint to another
             * temporary which later reuses the same slot. */
            data = metadata[index >>> PAGE_SHIFT];
            entry = (index & PAGE_MASK) * ANALYSIS_WORDS;
            if (data[entry + PINNED] || hints[index] !== undefined ||
                    (data[entry + FIRST_ACCESS] && (data[entry + BLOCK_NUMBER] < 0 ||
                     data[entry + DEFINITION_COUNT] !== 1 ||
                     (data[entry + FIRST_READ] &&
                      data[entry + FIRST_READ] <= data[entry + FIRST_DEFINITION])))) {
                data[entry + REGISTER_MAP] = privateCount++;
            } else if (data[entry + FIRST_ACCESS]) {
                data[entry + REGISTER_MAP] = -1;
            }
        }
        /* Each eligible interval starts at its sole definition, and an
         * instruction has at most one destination. Instruction order is
         * therefore already the required allocation order: no interval
         * objects, comparison closure or sorting pass is necessary. */
        var active = [], available = [], temporaryCount = 0, activeIndex;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            destination = op.DESTINATION_OPERANDS[opcode];
            if (destination) {
                register = code[pc + destination];
                data = metadata[register >>> PAGE_SHIFT];
                entry = (register & PAGE_MASK) * ANALYSIS_WORDS;
                if (data[entry + REGISTER_MAP] === -1) {
                    activeIndex = 0;
                    while (activeIndex < active.length) {
                        /* Strictly before, never an input/output alias. */
                        var activeRegister = active[activeIndex];
                        var activeData = metadata[activeRegister >>> PAGE_SHIFT];
                        var activeEntry = (activeRegister & PAGE_MASK) * ANALYSIS_WORDS;
                        if (activeData[activeEntry + LAST_ACCESS] < pc) {
                            available.push(activeData[activeEntry + REGISTER_MAP]);
                            active[activeIndex] = active[active.length - 1];
                            active.pop();
                        } else activeIndex++;
                    }
                    data[entry + REGISTER_MAP] = available.length ? available.pop() :
                        privateCount + temporaryCount++;
                    active.push(register);
                }
            }
        }
        var packedCount = privateCount + temporaryCount;
        if (packedCount >= count) return program;
        var remappedVectors = scratchPages(program.constants.length, 1);
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            reads = op.SOURCE_OPERANDS[opcode];
            for (index = 0; index < reads.length; index++) {
                var operand = pc + reads[index];
                register = code[operand];
                if (register >= 0) code[operand] =
                    metadata[register >>> PAGE_SHIFT][(register & PAGE_MASK) * ANALYSIS_WORDS + REGISTER_MAP];
            }
            destination = op.DESTINATION_OPERANDS[opcode];
            if (destination) {
                register = code[pc + destination];
                code[pc + destination] =
                    metadata[register >>> PAGE_SHIFT][(register & PAGE_MASK) * ANALYSIS_WORDS + REGISTER_MAP];
            }
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                var constantIndex = code[pc + (opcode === op.CALL ? 4 : 3)];
                var flagPage = remappedVectors[constantIndex >>> PAGE_SHIFT];
                var flagIndex = constantIndex & PAGE_MASK;
                if (!flagPage[flagIndex]) {
                    vector = op.tableGet(program.constants, constantIndex);
                    var remapped = [];
                    for (argument = 0; argument < vector.length; argument++) {
                        register = vector[argument];
                        remapped.push(metadata[register >>> PAGE_SHIFT][
                            (register & PAGE_MASK) * ANALYSIS_WORDS + REGISTER_MAP]);
                    }
                    op.tableSet(program.constants, constantIndex, remapped);
                    flagPage[flagIndex] = 1;
                }
            }
        }
        for (index = 0; index < constantRegisters.length; index++) {
            argument = op.tableGet(constantRegisters, index);
            if (typeof argument === "number" && argument >= 0) {
                op.tableSet(constantRegisters, index,
                    metadata[argument >>> PAGE_SHIFT][(argument & PAGE_MASK) * ANALYSIS_WORDS + REGISTER_MAP]);
            }
        }
        var remappedHints = [];
        for (index = 0; index < hints.length; index++) {
            if (hints[index] !== undefined) {
                register = metadata[index >>> PAGE_SHIFT][(index & PAGE_MASK) * ANALYSIS_WORDS + REGISTER_MAP];
                remappedHints[register] = hints[index];
            }
        }
        program.registerHints = remappedHints;
        program.registerCount = packedCount;
        if (!program.optimizationStats) program.optimizationStats = {};
        program.optimizationStats.registersBeforePacking = count;
        program.optimizationStats.registersAfterPacking = packedCount;
        return program;
    }
    root.GuestVMRegisterAllocator = {pack: pack};
    if (typeof module !== "undefined" && module.exports) module.exports = root.GuestVMRegisterAllocator;
}(this));
