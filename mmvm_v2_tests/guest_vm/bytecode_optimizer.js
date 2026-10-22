/* Forward must-analysis over register bytecode. No source-name assumptions. */
(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) op = require("./bytecode.js");
    var UNKNOWN = 0, INT32 = 1, ZERO = 2;
    /* Bound analysis memory, not the size of programs accepted by the VM. */
    var MAX_STATE_ENTRIES = 262144;

    function numberKind(value) {
        if (typeof value !== "number" || value !== (value | 0)) return UNKNOWN;
        if (value === 0) return 1 / value > 0 ? ZERO : UNKNOWN;
        return INT32;
    }

    function transfer(program, pc, state) {
        var code = program.code, opcode = code[pc];
        var destination = op.DESTINATION_OPERANDS[opcode];
        if (!destination) return;
        var kind = UNKNOWN;
        if (opcode === op.CONST) kind = numberKind(program.constants[code[pc + 2]]);
        else if (opcode === op.MOVE || opcode === op.POSITIVE) {
            kind = state[code[pc + 2]];
        } else if (opcode === op.ADD_INT32 || opcode === op.SUBTRACT_INT32 ||
                   opcode === op.BIT_NOT || opcode === op.BIT_AND ||
                   opcode === op.BIT_OR || opcode === op.BIT_XOR ||
                   opcode === op.SHIFT_LEFT || opcode === op.SHIFT_RIGHT) {
            kind = INT32;
        }
        state[code[pc + destination]] = kind;
    }

    function optimize(program) {
        var code = program.code, boundaries = {}, blocks = [], byPC = {};
        var pc, opcode, index, block, target, candidate = false;
        var constantRegisters = program.constantRegisters || [], zeroRegisters = {};
        for (index = 0; index < constantRegisters.length; index++) {
            if (typeof constantRegisters[index] === "number" &&
                numberKind(program.constants[index]) === ZERO) {
                zeroRegisters[constantRegisters[index]] = true;
            }
        }
        /* Most implementation functions have no literal |0 conversion. Avoid
         * building a CFG at all unless this transformation can be useful. */
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            if (code[pc] === op.BIT_OR && zeroRegisters[code[pc + 3]]) {
                candidate = true;
                break;
            }
        }
        if (!candidate) return program;
        boundaries[0] = true;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[opcode]) {
            opcode = code[pc];
            /* Exception edges and dynamically exposed scopes need a richer
             * CFG. Leave these functions unchanged rather than guess. */
            if (opcode === op.PUSH_CATCH || opcode === op.POP_CATCH ||
                opcode === op.ENTER_WITH || opcode === op.LEAVE_WITH) return program;
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE) {
                target = code[pc + (opcode === op.JUMP ? 1 : 2)];
                boundaries[target] = true;
                boundaries[pc + op.WIDTHS[opcode]] = true;
            } else if (opcode === op.RETURN || opcode === op.THROW ||
                       opcode === op.INVALID_ASSIGNMENT) {
                boundaries[pc + op.WIDTHS[opcode]] = true;
            }
        }
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            if (boundaries[pc]) {
                if (blocks.length) blocks[blocks.length - 1].end = pc;
                block = {start: pc, end: code.length, input: null, queued: false};
                byPC[pc] = blocks.length;
                blocks.push(block);
            }
        }
        if (blocks.length * program.registerCount > MAX_STATE_ENTRIES) return program;
        var initial = [];
        for (index = 0; index < program.registerCount; index++) initial[index] = UNKNOWN;
        for (index = 0; index < constantRegisters.length; index++) {
            if (typeof constantRegisters[index] === "number") {
                initial[constantRegisters[index]] = numberKind(program.constants[index]);
            }
        }
        blocks[0].input = initial;
        blocks[0].queued = true;
        var queue = [0], head = 0;
        function propagate(next, state) {
            if (next === undefined) return;
            var successor = blocks[next], changed = false, register, old, value;
            if (!successor.input) {
                successor.input = state.slice(0);
                changed = true;
            } else {
                for (register = 0; register < state.length; register++) {
                    old = successor.input[register];
                    value = state[register];
                    /* ZERO is a subtype of INT32. Other disagreements lose
                     * the fact; joins never invent new information. */
                    value = old && value ? (old === value ? old : INT32) : UNKNOWN;
                    if (old !== value) {
                        successor.input[register] = value;
                        changed = true;
                    }
                }
            }
            if (changed && !successor.queued) {
                successor.queued = true;
                queue.push(next);
            }
        }
        var state, last;
        while (head < queue.length) {
            index = queue[head++];
            block = blocks[index];
            block.queued = false;
            state = block.input.slice(0);
            for (pc = block.start; pc < block.end; pc += op.WIDTHS[code[pc]]) {
                last = pc;
                transfer(program, pc, state);
            }
            opcode = code[last];
            if (opcode === op.JUMP) propagate(byPC[code[last + 1]], state);
            else if (opcode === op.JUMP_IF_FALSE) {
                propagate(byPC[code[last + 2]], state);
                propagate(byPC[block.end], state);
            } else if (opcode !== op.RETURN && opcode !== op.THROW &&
                       opcode !== op.INVALID_ASSIGNMENT) propagate(byPC[block.end], state);
        }

        /* Count every numeric operand conservatively, including non-register
         * operands. False uses merely prevent fusion. CALL argument vectors
         * hold register uses outside the instruction words. */
        var occurrences = [], operand, vector;
        function countUse(register) {
            if (typeof register === "number" && register >= 0 &&
                register < program.registerCount && register === (register | 0)) {
                occurrences[register] = (occurrences[register] || 0) + 1;
            }
        }
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            for (operand = 1; operand < op.WIDTHS[code[pc]]; operand++) {
                countUse(code[pc + operand]);
            }
            if (code[pc] === op.CALL || code[pc] === op.CONSTRUCT) {
                vector = program.constants[
                    code[pc + (code[pc] === op.CALL ? 4 : 3)]];
                for (operand = 0; operand < vector.length; operand++) {
                    countUse(vector[operand]);
                }
            }
        }
        var replacements = {}, removed = 0, fused = 0, next, temporary;
        for (index = 0; index < blocks.length; index++) {
            block = blocks[index];
            if (!block.input) continue;
            state = block.input.slice(0);
            for (pc = block.start; pc < block.end; pc += op.WIDTHS[code[pc]]) {
                next = pc + op.WIDTHS[code[pc]];
                temporary = code[pc + 1];
                if ((code[pc] === op.ADD || code[pc] === op.SUBTRACT) &&
                    state[code[pc + 2]] && state[code[pc + 3]] &&
                    next < block.end && code[next] === op.BIT_OR &&
                    code[next + 2] === temporary &&
                    code[next + 3] !== temporary &&
                    state[code[next + 3]] === ZERO && occurrences[temporary] === 2) {
                    /* int32 sums/differences are exact in binary64. Truncating
                     * their result is therefore exactly wrapping word math.
                     * No observer can see the single-use intermediate value. */
                    replacements[pc] = [code[pc] === op.ADD ? op.ADD_INT32 :
                        op.SUBTRACT_INT32, code[next + 1], code[pc + 2], code[pc + 3]];
                    replacements[next] = [];
                    fused++;
                } else if (replacements[pc] === undefined &&
                    code[pc] === op.BIT_OR && state[code[pc + 2]] &&
                    state[code[pc + 3]] === ZERO) {
                    replacements[pc] = code[pc + 1] === code[pc + 2] ? [] :
                        [op.MOVE, code[pc + 1], code[pc + 2]];
                    removed++;
                }
                transfer(program, pc, state);
            }
        }
        if (!removed && !fused) return program;
        var output = [], locations = [], relocated = {}, replacement;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            relocated[pc] = output.length;
            replacement = replacements[pc];
            if (!replacement) {
                replacement = code.slice(pc, pc + op.WIDTHS[code[pc]]);
            }
            if (replacement.length && program.sourceLocations) {
                locations[output.length] = program.sourceLocations[pc];
            }
            for (operand = 0; operand < replacement.length; operand++) {
                output.push(replacement[operand]);
            }
        }
        relocated[code.length] = output.length;
        for (pc = 0; pc < output.length; pc += op.WIDTHS[output[pc]]) {
            opcode = output[pc];
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE) {
                operand = pc + (opcode === op.JUMP ? 1 : 2);
                output[operand] = relocated[output[operand]];
            }
        }
        program.code = output;
        program.sourceLocations = locations;
        program.optimizationStats = {redundantInt32Conversions: removed,
                                    fusedInt32Arithmetic: fused};
        return program;
    }
    root.GuestVMBytecodeOptimizer = {optimize: optimize};
    if (typeof module !== "undefined" && module.exports) {
        module.exports = root.GuestVMBytecodeOptimizer;
    }
}(this));
