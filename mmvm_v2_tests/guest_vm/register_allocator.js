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
    var read = op.tableGet, write = op.tableSet;
    function analysisTable(program) {
        return program.constants.pages ? new op.PagedTable() : [];
    }

    function pack(program, bindingCount) {
        var code = program.code, count = program.registerCount;
        if (count > MAX_PACKING_REGISTERS) return program;
        var boundaries = {0: true};
        var first = analysisTable(program), last = analysisTable(program);
        var blocks = analysisTable(program), definitions = analysisTable(program);
        var firstDefinition = analysisTable(program), firstRead = analysisTable(program);
        var pinned = analysisTable(program);
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
                if (read(first, register) === undefined) {
                    write(first, register, pc);
                    write(blocks, register, block);
                } else if (read(blocks, register) !== block) write(blocks, register, -1);
                write(last, register, pc);
                if (isDefinition) {
                    write(definitions, register, (read(definitions, register) || 0) + 1);
                    if (read(firstDefinition, register) === undefined) write(firstDefinition, register, pc);
                } else if (read(firstRead, register) === undefined) write(firstRead, register, pc);
            }
        }
        var constantRegisters = program.constantRegisters || [];
        var hints = program.registerHints || [];
        for (index = 0; index < bindingCount; index++) write(pinned, index, true);
        for (index = 0; index < constantRegisters.length; index++) {
            argument = op.tableGet(constantRegisters, index);
            if (typeof argument === "number" && argument >= 0) write(pinned, argument, true);
        }
        var mapping = analysisTable(program), privateCount = 0;
        for (index = 0; index < count; index++) {
            /* Preserve compiler hints without assigning a hint to another
             * temporary which later reuses the same slot. */
            if (read(pinned, index) || hints[index] !== undefined ||
                    (read(first, index) !== undefined && (read(blocks, index) < 0 ||
                     read(definitions, index) !== 1 ||
                     (read(firstRead, index) !== undefined &&
                      read(firstRead, index) <= read(firstDefinition, index))))) {
                write(mapping, index, privateCount++);
            } else if (read(first, index) !== undefined) {
                write(mapping, index, -1);
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
                if (read(mapping, register) === -1) {
                    activeIndex = 0;
                    while (activeIndex < active.length) {
                        /* Strictly before, never an input/output alias. */
                        if (read(last, active[activeIndex]) < pc) {
                            available.push(read(mapping, active[activeIndex]));
                            active[activeIndex] = active[active.length - 1];
                            active.pop();
                        } else activeIndex++;
                    }
                    write(mapping, register, available.length ? available.pop() :
                        privateCount + temporaryCount++);
                    active.push(register);
                }
            }
        }
        var packedCount = privateCount + temporaryCount;
        if (packedCount >= count) return program;
        var remappedVectors = analysisTable(program);
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            reads = op.SOURCE_OPERANDS[opcode];
            for (index = 0; index < reads.length; index++) {
                var operand = pc + reads[index];
                if (code[operand] >= 0) code[operand] = read(mapping, code[operand]);
            }
            destination = op.DESTINATION_OPERANDS[opcode];
            if (destination) code[pc + destination] = read(mapping, code[pc + destination]);
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                var constantIndex = code[pc + (opcode === op.CALL ? 4 : 3)];
                if (!read(remappedVectors, constantIndex)) {
                    vector = op.tableGet(program.constants, constantIndex);
                    var remapped = [];
                    for (argument = 0; argument < vector.length; argument++) remapped.push(read(mapping, vector[argument]));
                    op.tableSet(program.constants, constantIndex, remapped);
                    write(remappedVectors, constantIndex, true);
                }
            }
        }
        for (index = 0; index < constantRegisters.length; index++) {
            argument = op.tableGet(constantRegisters, index);
            if (typeof argument === "number" && argument >= 0) {
                op.tableSet(constantRegisters, index, read(mapping, argument));
            }
        }
        var remappedHints = [];
        for (index = 0; index < hints.length; index++) {
            if (hints[index] !== undefined) remappedHints[read(mapping, index)] = hints[index];
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
