/* Conservative bytecode register packing. Only single-definition temporaries
 * confined to one basic block share storage. Named bindings, constants and
 * values crossing an edge retain private slots. No exception-edge or alias
 * analysis is assumed. PCs and all observable execution order stay unchanged. */
(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");

    function pack(program, bindingCount) {
        var code = program.code, count = program.registerCount;
        var boundaries = {0: true}, first = [], last = [], blocks = [];
        var definitions = [], firstDefinition = [], firstRead = [], pinned = [];
        var pc, opcode, index, reads, destination, vector, argument;
        /* These constructs require exceptional/dynamic scope liveness. Leave
         * them unchanged until that analysis is available, not approximately
         * optimized. The normal compiler/verifier still handles them. */
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            if (!op.SOURCE_OPERANDS[opcode] || opcode === op.PUSH_CATCH ||
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
        function access(register, isDefinition) {
            /* CALL receivers also encode unqualified-call/direct-eval
             * sentinels. They are not storage locations. */
            if (register < 0) return;
            if (first[register] === undefined) {
                first[register] = pc;
                blocks[register] = block;
            } else if (blocks[register] !== block) blocks[register] = -1;
            last[register] = pc;
            if (isDefinition) {
                definitions[register] = (definitions[register] || 0) + 1;
                if (firstDefinition[register] === undefined) firstDefinition[register] = pc;
            } else if (firstRead[register] === undefined) firstRead[register] = pc;
        }
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            if (boundaries[pc]) block++;
            reads = op.SOURCE_OPERANDS[opcode];
            for (index = 0; index < reads.length; index++) access(code[pc + reads[index]], false);
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                vector = program.constants[code[pc + (opcode === op.CALL ? 4 : 3)]];
                for (index = 0; index < vector.length; index++) access(vector[index], false);
            }
            destination = op.DESTINATION_OPERANDS[opcode];
            if (destination) access(code[pc + destination], true);
        }
        var constantRegisters = program.constantRegisters || [];
        var hints = program.registerHints || [];
        for (index = 0; index < bindingCount; index++) pinned[index] = true;
        for (index = 0; index < constantRegisters.length; index++) {
            argument = constantRegisters[index];
            if (typeof argument === "number" && argument >= 0) pinned[argument] = true;
        }
        var mapping = [], intervals = [], privateCount = 0;
        for (index = 0; index < count; index++) {
            /* Preserve compiler hints without assigning a hint to another
             * temporary which later reuses the same slot. */
            if (pinned[index] || hints[index] !== undefined ||
                    (first[index] !== undefined && (blocks[index] < 0 ||
                     definitions[index] !== 1 ||
                     (firstRead[index] !== undefined &&
                      firstRead[index] <= firstDefinition[index])))) {
                mapping[index] = privateCount++;
            } else if (first[index] !== undefined) {
                intervals.push({register: index, start: first[index], end: last[index]});
            }
        }
        intervals.sort(function (a, b) { return a.start - b.start || a.register - b.register; });
        var active = [], available = [], temporaryCount = 0, interval, activeIndex;
        for (index = 0; index < intervals.length; index++) {
            interval = intervals[index];
            activeIndex = 0;
            while (activeIndex < active.length) {
                /* Do not alias a destination with an input of the same
                 * instruction: operations may suspend or enter an accessor. */
                if (active[activeIndex].end < interval.start) {
                    available.push(active[activeIndex].slot);
                    active[activeIndex] = active[active.length - 1];
                    active.pop();
                } else activeIndex++;
            }
            interval.slot = available.length ? available.pop() : temporaryCount++;
            mapping[interval.register] = privateCount + interval.slot;
            active.push(interval);
        }
        var packedCount = privateCount + temporaryCount;
        if (packedCount >= count) return program;
        var remappedVectors = {};
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            reads = op.SOURCE_OPERANDS[opcode];
            for (index = 0; index < reads.length; index++) {
                var operand = pc + reads[index];
                if (code[operand] >= 0) code[operand] = mapping[code[operand]];
            }
            destination = op.DESTINATION_OPERANDS[opcode];
            if (destination) code[pc + destination] = mapping[code[pc + destination]];
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                var constantIndex = code[pc + (opcode === op.CALL ? 4 : 3)];
                if (!remappedVectors[constantIndex]) {
                    vector = program.constants[constantIndex];
                    var remapped = [];
                    for (argument = 0; argument < vector.length; argument++) remapped.push(mapping[vector[argument]]);
                    program.constants[constantIndex] = remapped;
                    remappedVectors[constantIndex] = true;
                }
            }
        }
        for (index = 0; index < constantRegisters.length; index++) {
            argument = constantRegisters[index];
            if (typeof argument === "number" && argument >= 0) constantRegisters[index] = mapping[argument];
        }
        var remappedHints = [];
        for (index = 0; index < hints.length; index++) {
            if (hints[index] !== undefined) remappedHints[mapping[index]] = hints[index];
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
