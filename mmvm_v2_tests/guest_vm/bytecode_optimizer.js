/* Forward must-analysis over register bytecode. No source-name assumptions. */
(function (root) {
    var op = root.GuestVMBytecode;
    var registerAllocator = root.GuestVMRegisterAllocator;
    if (typeof module !== "undefined" && module.exports) {
        op = require("./bytecode.js");
        registerAllocator = require("./register_allocator.js");
    }
    var UNKNOWN = 0, INT32 = 1, ZERO = 2;
    /* Bound analysis memory, not the size of programs accepted by the VM. */
    var MAX_STATE_ENTRIES = 262144;
    /* Bound repeated dataflow work as well as resident state. Two full
     * state-table visits permit ordinary loop convergence without allowing
     * an optional optimization to dominate compilation on a difficult CFG. */
    var MAX_ANALYSIS_WORK = MAX_STATE_ENTRIES * 2;

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
        } else if (opcode === op.TO_INT32 ||
                   opcode === op.ADD_INT32 || opcode === op.SUBTRACT_INT32 ||
                   opcode === op.BIT_NOT || opcode === op.BIT_AND ||
                   opcode === op.BIT_OR || opcode === op.BIT_XOR ||
                   opcode === op.SHIFT_LEFT || opcode === op.SHIFT_RIGHT) {
            kind = INT32;
        }
        state[code[pc + destination]] = kind;
    }

    function optimizeInt32(program) {
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
            if (code[pc] === op.TO_INT32 ||
                (code[pc] === op.BIT_OR && zeroRegisters[code[pc + 3]])) {
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
            if (opcode === op.PUSH_CATCH || opcode === op.PUSH_CATCH_SCOPE || opcode === op.POP_CATCH ||
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
        program.optimizationStats = {int32AnalysisBlocks: blocks.length,
            int32AnalysisRegisters: program.registerCount};
        if (blocks.length * program.registerCount > MAX_STATE_ENTRIES) {
            program.optimizationStats.int32AnalysisStateBudgetExceeded = true;
            return program;
        }
        var occurrences = [], definitions = [];
        if (!countRegisterUses(program, occurrences, definitions)) return program;
        var immutable = [];
        var initial = [];
        for (index = 0; index < program.registerCount; index++) initial[index] = UNKNOWN;
        for (index = 0; index < constantRegisters.length; index++) {
            if (typeof constantRegisters[index] === "number") {
                var constantRegister = constantRegisters[index];
                initial[constantRegister] = numberKind(program.constants[index]);
                if (!definitions[constantRegister]) immutable[constantRegister] = true;
            }
        }
        blocks[0].input = initial;
        blocks[0].queued = true;
        var queue = [0], head = 0;
        var state, last, analysisWork = 0;
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
            analysisWork += program.registerCount + block.end - block.start;
            if (opcode === op.JUMP) {
                analysisWork += propagateRegisterState(
                    blocks, queue, byPC[code[last + 1]], state, immutable);
            } else if (opcode === op.JUMP_IF_FALSE) {
                analysisWork += propagateRegisterState(
                    blocks, queue, byPC[code[last + 2]], state, immutable);
                analysisWork += propagateRegisterState(
                    blocks, queue, byPC[block.end], state, immutable);
            } else if (opcode !== op.RETURN && opcode !== op.THROW &&
                       opcode !== op.INVALID_ASSIGNMENT) {
                analysisWork += propagateRegisterState(
                    blocks, queue, byPC[block.end], state, immutable);
            }
            if (analysisWork > MAX_ANALYSIS_WORK) {
                program.optimizationStats.int32AnalysisBudgetExceeded = true;
                return program;
            }
        }

        var replacements = {}, removed = 0, fused = 0, conversions = 0;
        var next, temporary, coercion;
        for (index = 0; index < blocks.length; index++) {
            block = blocks[index];
            if (!block.input) continue;
            state = block.input.slice(0);
            for (pc = block.start; pc < block.end; pc += op.WIDTHS[code[pc]]) {
                next = pc + op.WIDTHS[code[pc]];
                temporary = code[pc + 1];
                coercion = next < block.end && (code[next] === op.TO_INT32 ||
                    (code[next] === op.BIT_OR && code[next + 3] !== temporary &&
                     state[code[next + 3]] === ZERO));
                if ((code[pc] === op.ADD || code[pc] === op.SUBTRACT) &&
                    state[code[pc + 2]] && state[code[pc + 3]] &&
                    coercion &&
                    code[next + 2] === temporary &&
                    occurrences[temporary] === 2) {
                    /* int32 sums/differences are exact in binary64. Truncating
                     * their result is therefore exactly wrapping word math.
                     * No observer can see the single-use intermediate value. */
                    replacements[pc] = [code[pc] === op.ADD ? op.ADD_INT32 :
                        op.SUBTRACT_INT32, code[next + 1], code[pc + 2], code[pc + 3]];
                    replacements[next] = [];
                    fused++;
                } else if (replacements[pc] === undefined &&
                    code[pc] === op.TO_INT32 && state[code[pc + 2]]) {
                    replacements[pc] = code[pc + 1] === code[pc + 2] ? [] :
                        [op.MOVE, code[pc + 1], code[pc + 2]];
                    removed++;
                } else if (replacements[pc] === undefined &&
                    code[pc] === op.BIT_OR && state[code[pc + 3]] === ZERO) {
                    if (state[code[pc + 2]]) {
                        replacements[pc] = code[pc + 1] === code[pc + 2] ? [] :
                            [op.MOVE, code[pc + 1], code[pc + 2]];
                        removed++;
                    } else {
                        replacements[pc] = [op.TO_INT32,
                            code[pc + 1], code[pc + 2]];
                        conversions++;
                    }
                }
                transfer(program, pc, state);
            }
        }
        if (!removed && !fused && !conversions) return program;
        rewriteInstructions(program, replacements);
        program.optimizationStats.redundantInt32Conversions = removed;
        program.optimizationStats.fusedInt32Arithmetic = fused;
        program.optimizationStats.unaryInt32Conversions = conversions;
        return program;
    }

    function propagateRegisterState(blocks, queue, next, state, immutable) {
        if (next === undefined) return 0;
        var successor = blocks[next], changed = false, register, old, value;
        var input = successor.input, work = 0;
        if (!input) {
            successor.input = state.slice(0);
            work = state.length;
            changed = true;
        } else {
            var facts = successor.mutableFacts;
            if (!facts) {
                /* Input facts only weaken. Unknown entries never become
                 * known at a join; proven unwritten constants never weaken.
                 * Build a sparse list once, at the first actual join. */
                facts = [];
                var count = state.length;
                work = count;
                for (register = 0; register < count; register++) {
                    old = input[register];
                    if (old && !immutable[register]) {
                        value = state[register];
                        value = value ? (old === value ? old : INT32) : UNKNOWN;
                        if (old !== value) {
                            input[register] = value;
                            changed = true;
                        }
                        if (value) facts.push(register);
                    }
                }
                successor.mutableFacts = facts;
            } else {
                var factIndex = 0, factCount = facts.length;
                work = factCount;
                while (factIndex < factCount) {
                    register = facts[factIndex];
                    old = input[register];
                    value = state[register];
                    value = value ? (old === value ? old : INT32) : UNKNOWN;
                    if (old !== value) {
                        input[register] = value;
                        changed = true;
                    }
                    if (value) factIndex++;
                    else {
                        factCount--;
                        facts[factIndex] = facts[factCount];
                        facts.length = factCount;
                    }
                }
            }
        }
        if (changed && !successor.queued) {
            successor.queued = true;
            queue.push(next);
        }
        return work;
    }

    function countRegisterOccurrence(occurrences, register, registerCount) {
        if (typeof register === "number" && register >= 0 &&
            register < registerCount && register === (register | 0)) {
            occurrences[register] = (occurrences[register] || 0) + 1;
        }
    }

    /* Count actual storage accesses, not integers which happen to have the
     * same value as a register index (constant indices, slots and targets).
     * Both analyses use the canonical bytecode operand description. */
    function countRegisterUses(program, occurrences, definitions) {
        var code = program.code, pc, opcode, reads, operand, index, vector;
        var registerCount = program.registerCount;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            opcode = code[pc];
            reads = op.SOURCE_OPERANDS[opcode];
            if (!reads) return false;
            for (operand = 0; operand < reads.length; operand++) {
                countRegisterOccurrence(occurrences, code[pc + reads[operand]], registerCount);
            }
            if (op.DESTINATION_OPERANDS[opcode]) {
                index = code[pc + op.DESTINATION_OPERANDS[opcode]];
                countRegisterOccurrence(occurrences, index, registerCount);
                definitions[index] = (definitions[index] || 0) + 1;
            }
            if (opcode === op.CALL || opcode === op.CONSTRUCT) {
                vector = program.constants[code[pc + (opcode === op.CALL ? 4 : 3)]];
                for (index = 0; index < vector.length; index++) {
                    countRegisterOccurrence(occurrences, vector[index], registerCount);
                }
            }
        }
        return true;
    }

    function rewriteInstructions(program, replacements) {
        var code = program.code, pc, opcode, operand;
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
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE ||
                opcode === op.PUSH_CATCH || opcode === op.PUSH_CATCH_SCOPE) {
                operand = pc + (opcode === op.JUMP_IF_FALSE ? 2 : 1);
                output[operand] = relocated[output[operand]];
            }
        }
        program.code = output;
        program.sourceLocations = locations;
    }

    /* Named bindings and preloaded constants retain their storage. A fresh
     * single-use temporary can share the following copy/coercion destination
     * if no branch can enter between the two instructions. This is ordinary
     * register coalescing, independent of source names or object shapes. */
    function coalesceCopies(program, bindingRegisterCount) {
        var code = program.code, targets = {}, occurrences = [], definitions = [];
        var constantRegisters = {}, replacements = {}, previous = -1;
        var pc, opcode, index, candidate = false, merged = 0;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            opcode = code[pc];
            if (opcode === op.MOVE && code[pc + 1] === code[pc + 2]) candidate = true;
            else if (previous >= 0 && (opcode === op.MOVE || opcode === op.TO_INT32) &&
                     code[pc + 2] >= bindingRegisterCount &&
                     code[previous + 1] === code[pc + 2] &&
                     coalescibleProducer(code[previous])) candidate = true;
            if (opcode === op.PUSH_CATCH || opcode === op.PUSH_CATCH_SCOPE || opcode === op.POP_CATCH ||
                opcode === op.ENTER_WITH || opcode === op.LEAVE_WITH) return program;
            if (opcode === op.JUMP || opcode === op.JUMP_IF_FALSE) {
                targets[code[pc + (opcode === op.JUMP ? 1 : 2)]] = true;
            }
            previous = pc;
        }
        if (!candidate) return program;
        var preloadedRegisters = program.constantRegisters || [];
        for (index = 0; index < preloadedRegisters.length; index++) {
            var constantRegister = preloadedRegisters[index];
            if (typeof constantRegister === "number") constantRegisters[constantRegister] = true;
        }
        if (!countRegisterUses(program, occurrences, definitions)) return program;
        previous = -1;
        for (pc = 0; pc < code.length; pc += op.WIDTHS[code[pc]]) {
            opcode = code[pc];
            if (targets[pc]) previous = -1;
            if (opcode === op.MOVE && code[pc + 1] === code[pc + 2]) {
                replacements[pc] = [];
                merged++;
                continue;
            }
            if (previous >= 0 && (opcode === op.MOVE || opcode === op.TO_INT32)) {
                var producer = code[previous], temporary = code[pc + 2];
                var destination = code[pc + 1];
                if (coalescibleProducer(producer) && code[previous + 1] === temporary &&
                    replacements[previous] === undefined &&
                    temporary >= bindingRegisterCount && !constantRegisters[temporary] &&
                    definitions[temporary] === 1 && occurrences[temporary] === 2 &&
                    /* ToInt32 can invoke user code or throw. Its intermediate
                     * value must not overwrite an observable named binding. */
                    (opcode !== op.TO_INT32 || destination >= bindingRegisterCount) &&
                    (producerSnapshotsInputs(producer) ||
                     (destination !== code[previous + 2] && destination !== code[previous + 3]))) {
                    var rewritten = replacements[previous] ||
                        code.slice(previous, previous + op.WIDTHS[producer]);
                    rewritten[1] = destination;
                    replacements[previous] = rewritten;
                    if (opcode === op.MOVE) replacements[pc] = [];
                    else replacements[pc] = [op.TO_INT32, destination, destination];
                    merged++;
                    if (opcode === op.MOVE) {
                        previous = -1;
                        continue;
                    }
                }
            }
            previous = pc;
        }
        if (merged) {
            rewriteInstructions(program, replacements);
            if (!program.optimizationStats) program.optimizationStats = {};
            program.optimizationStats.coalescedCopies = merged;
        }
        return program;
    }
    function optimize(program, bindingRegisterCount) {
        bindingRegisterCount = bindingRegisterCount || 0;
        return registerAllocator.pack(
            coalesceCopies(optimizeInt32(program), bindingRegisterCount),
            bindingRegisterCount);
    }

    function coalescibleProducer(opcode) {
        return opcode === op.CONST || opcode === op.MOVE || opcode === op.GET_LOCAL ||
            opcode === op.GET_THIS || opcode === op.GET_PROPERTY ||
            opcode === op.GET_PROPERTY_CONST ||
            (opcode >= op.ADD && opcode <= op.POSITIVE) ||
            (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
            opcode === op.BIT_NOT || opcode === op.TYPEOF ||
            opcode === op.ADD_INT32 || opcode === op.SUBTRACT_INT32 || opcode === op.TO_INT32;
    }

    function producerSnapshotsInputs(opcode) {
        return opcode === op.MOVE || opcode === op.CONST || opcode === op.GET_LOCAL ||
            (opcode >= op.BIT_AND && opcode <= op.SHIFT_UNSIGNED_RIGHT) ||
            opcode === op.BIT_NOT || opcode === op.ADD_INT32 || opcode === op.SUBTRACT_INT32;
    }
    root.GuestVMBytecodeOptimizer = {optimize: optimize};
    if (typeof module !== "undefined" && module.exports) {
        module.exports = root.GuestVMBytecodeOptimizer;
    }
}(this));
