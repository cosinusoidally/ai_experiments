/* Guest-owned ECMAScript regular-expression execution.
 *
 * The host is deliberately not used here.  The parser produces a small tree
 * and the continuation-based matcher keeps every capture/backtracking choice
 * on the guest heap.  This is ES3 source so the same implementation can be
 * bootstrapped by js_min and exercised by newer hosts.
 */
(function () {
    function syntax(message) {
        throw new SyntaxError(message);
    }

    function decimal(code) {
        return code >= 48 && code <= 57;
    }

    function hex(code) {
        if (code >= 48 && code <= 57) return code - 48;
        if (code >= 65 && code <= 70) return code - 55;
        if (code >= 97 && code <= 102) return code - 87;
        return -1;
    }

    function Parser(source) {
        this.source = source;
        this.index = 0;
        this.captureCount = 0;
    }

    Parser.prototype.peek = function () {
        return this.index < this.source.length ?
            this.source.charAt(this.index) : "";
    };

    Parser.prototype.take = function () {
        return this.index < this.source.length ?
            this.source.charAt(this.index++) : "";
    };

    Parser.prototype.number = function () {
        var value = 0;
        var digits = 0;
        while (decimal(this.source.charCodeAt(this.index))) {
            value = value * 10 + this.source.charCodeAt(this.index++) - 48;
            digits++;
        }
        return digits ? value : -1;
    };

    Parser.prototype.escape = function (inClass) {
        if (this.index >= this.source.length) syntax("trailing regular expression escape");
        var character = this.take();
        var code = character.charCodeAt(0);
        if (!inClass && decimal(code) && code !== 48) {
            var reference = code - 48;
            while (decimal(this.source.charCodeAt(this.index))) {
                reference = reference * 10 +
                    this.source.charCodeAt(this.index++) - 48;
            }
            return {kind: "backref", capture: reference};
        }
        if (character === "d" || character === "D" ||
            character === "w" || character === "W" ||
            character === "s" || character === "S") {
            return {kind: "classEscape", name: character};
        }
        if (!inClass && (character === "b" || character === "B")) {
            return {kind: "boundary", invert: character === "B"};
        }
        if (inClass && character === "b") return {kind: "literal", code: 8};
        if (character === "n") code = 10;
        else if (character === "r") code = 13;
        else if (character === "t") code = 9;
        else if (character === "v") code = 11;
        else if (character === "f") code = 12;
        else if (character === "c") {
            if (this.index >= this.source.length) syntax("invalid control escape");
            code = this.take().charCodeAt(0);
            if (code >= 97 && code <= 122) code -= 32;
            code &= 31;
        } else if (character === "x" || character === "u") {
            var count = character === "x" ? 2 : 4;
            var value = 0;
            while (count-- > 0) {
                if (this.index >= this.source.length) syntax("invalid hexadecimal escape");
                var digit = hex(this.source.charCodeAt(this.index++));
                if (digit < 0) syntax("invalid hexadecimal escape");
                value = value * 16 + digit;
            }
            code = value;
        }
        return {kind: "literal", code: code};
    };

    Parser.prototype.classAtom = function () {
        if (this.index >= this.source.length) syntax("unterminated character class");
        if (this.peek() === "\\") {
            this.index++;
            return this.escape(true);
        }
        return {kind: "literal", code: this.take().charCodeAt(0)};
    };

    Parser.prototype.characterClass = function () {
        var invert = false;
        var terms = [];
        if (this.peek() === "^") {
            invert = true;
            this.index++;
        }
        var first = true;
        while (this.index < this.source.length) {
            if (this.peek() === "]" && !first) {
                this.index++;
                return {kind: "class", invert: invert, terms: terms};
            }
            first = false;
            var left = this.classAtom();
            if (left.kind === "literal" && this.peek() === "-" &&
                this.index + 1 < this.source.length &&
                this.source.charAt(this.index + 1) !== "]") {
                this.index++;
                var right = this.classAtom();
                if (right.kind !== "literal") syntax("invalid character class range");
                if (right.code < left.code) syntax("out-of-order character class range");
                terms.push({kind: "range", start: left.code, end: right.code});
            } else terms.push(left);
        }
        syntax("unterminated character class");
    };

    Parser.prototype.atom = function () {
        var character = this.take();
        if (!character) syntax("missing regular expression atom");
        if (character === "^") return {kind: "start"};
        if (character === "$") return {kind: "end"};
        if (character === ".") return {kind: "dot"};
        if (character === "[") return this.characterClass();
        if (character === "\\") return this.escape(false);
        if (character === "(") {
            var capture = 0;
            var lookahead = 0;
            if (this.peek() === "?") {
                this.index++;
                var modifier = this.take();
                if (modifier === ":") capture = -1;
                else if (modifier === "=") {
                    capture = -1;
                    lookahead = 1;
                } else if (modifier === "!") {
                    capture = -1;
                    lookahead = -1;
                } else syntax("unsupported regular expression group");
            } else capture = ++this.captureCount;
            var alternatives = this.alternatives(")");
            if (this.take() !== ")") syntax("unterminated regular expression group");
            return {kind: lookahead ? "lookahead" : "group",
                    capture: capture, positive: lookahead > 0,
                    alternatives: alternatives};
        }
        if (character === ")" || character === "|" ||
            character === "*" || character === "+" || character === "?") {
            syntax("unexpected regular expression character " + character);
        }
        return {kind: "literal", code: character.charCodeAt(0)};
    };

    Parser.prototype.piece = function () {
        var atom = this.atom();
        var minimum = 1;
        var maximum = 1;
        var quantified = false;
        var character = this.peek();
        if (character === "*") {
            this.index++;
            minimum = 0;
            maximum = -1;
            quantified = true;
        } else if (character === "+") {
            this.index++;
            minimum = 1;
            maximum = -1;
            quantified = true;
        } else if (character === "?") {
            this.index++;
            minimum = 0;
            maximum = 1;
            quantified = true;
        } else if (character === "{") {
            var saved = this.index++;
            var parsedMinimum = this.number();
            if (parsedMinimum < 0) this.index = saved;
            else {
                minimum = parsedMinimum;
                maximum = minimum;
                if (this.peek() === ",") {
                    this.index++;
                    var parsedMaximum = this.number();
                    maximum = parsedMaximum < 0 ? -1 : parsedMaximum;
                }
                if (this.peek() !== "}") this.index = saved;
                else {
                    this.index++;
                    quantified = true;
                    if (maximum >= 0 && maximum < minimum) {
                        syntax("invalid regular expression quantifier");
                    }
                }
            }
        }
        var greedy = true;
        if (quantified && this.peek() === "?") {
            this.index++;
            greedy = false;
        }
        return {atom: atom, minimum: minimum, maximum: maximum,
                greedy: greedy};
    };

    Parser.prototype.sequence = function (stop) {
        var pieces = [];
        while (this.index < this.source.length && this.peek() !== "|" &&
               (!stop || this.peek() !== stop)) {
            pieces.push(this.piece());
        }
        return pieces;
    };

    Parser.prototype.alternatives = function (stop) {
        var result = [this.sequence(stop)];
        while (this.peek() === "|") {
            this.index++;
            result.push(this.sequence(stop));
        }
        return result;
    };

    Parser.prototype.parse = function () {
        var alternatives = this.alternatives("");
        if (this.index !== this.source.length) syntax("invalid regular expression");
        return {alternatives: alternatives, captures: this.captureCount};
    };

    function lowerAscii(code) {
        return code >= 65 && code <= 90 ? code + 32 : code;
    }

    function word(code) {
        return code === 95 || decimal(code) ||
               (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    function white(code) {
        return (code >= 9 && code <= 13) || code === 32 || code === 160 ||
               code === 5760 || code === 6158 ||
               (code >= 8192 && code <= 8202) || code === 8232 ||
               code === 8233 || code === 8239 || code === 8287 ||
               code === 12288 || code === 65279;
    }

    function classEscape(name, code) {
        var matched = name === "d" || name === "D" ? decimal(code) :
                      name === "w" || name === "W" ? word(code) : white(code);
        return name === "D" || name === "W" || name === "S" ? !matched : matched;
    }

    function classMatches(node, code, ignoreCase) {
        var matched = false;
        var compare = ignoreCase ? lowerAscii(code) : code;
        var index = 0;
        while (index < node.terms.length && !matched) {
            var term = node.terms[index++];
            if (term.kind === "classEscape") matched = classEscape(term.name, code);
            else if (term.kind === "literal") {
                matched = compare === (ignoreCase ? lowerAscii(term.code) : term.code);
            } else {
                var start = ignoreCase ? lowerAscii(term.start) : term.start;
                var end = ignoreCase ? lowerAscii(term.end) : term.end;
                matched = compare >= start && compare <= end;
            }
        }
        return node.invert ? !matched : matched;
    }

    var RX_MATCH = 0;
    var RX_LITERAL = 1;
    var RX_DOT = 2;
    var RX_CLASS = 3;
    var RX_CLASS_ESCAPE = 4;
    var RX_START = 5;
    var RX_END = 6;
    var RX_BOUNDARY = 7;
    var RX_BACKREF = 8;
    var RX_SAVE_START = 9;
    var RX_SAVE_END = 10;
    var RX_SPLIT = 11;
    var RX_JUMP = 12;
    var RX_LOOKAHEAD = 13;
    var RX_REPEAT_INIT = 14;
    var RX_REPEAT_DECIDE = 15;
    var RX_REPEAT_MARK = 16;
    var RX_REPEAT_NEXT = 17;
    var RX_INSTRUCTION_WORDS = 8;

    function emit(code, instruction) {
        code.push(instruction);
        return code.length - 1;
    }

    function compileAlternatives(branches, code, compiler) {
        var endJumps = [];
        var branchIndex = 0;
        while (branchIndex < branches.length) {
            var splitIndex = -1;
            if (branchIndex + 1 < branches.length) {
                splitIndex = emit(code, {opcode: RX_SPLIT, first: code.length + 1,
                                         second: 0});
            }
            compileSequence(branches[branchIndex++], code, compiler);
            if (branchIndex < branches.length) {
                endJumps.push(emit(code, {opcode: RX_JUMP, target: 0}));
                code[splitIndex].second = code.length;
            }
        }
        var end = code.length;
        var jumpIndex = 0;
        while (jumpIndex < endJumps.length) {
            code[endJumps[jumpIndex++]].target = end;
        }
    }

    function compileAtom(node, code, compiler) {
        if (node.kind === "group") {
            if (node.capture > 0) {
                emit(code, {opcode: RX_SAVE_START, capture: node.capture});
            }
            compileAlternatives(node.alternatives, code, compiler);
            if (node.capture > 0) {
                emit(code, {opcode: RX_SAVE_END, capture: node.capture});
            }
        } else if (node.kind === "lookahead") {
            var lookCode = [];
            compileAlternatives(node.alternatives, lookCode, compiler);
            emit(lookCode, {opcode: RX_MATCH});
            var lookProgram = {code: lookCode, stateSlots: 0, workspace: null};
            compiler.programs.push(lookProgram);
            emit(code, {opcode: RX_LOOKAHEAD, program: lookProgram,
                        positive: node.positive});
        } else {
            var opcodes = {literal: RX_LITERAL, dot: RX_DOT,
                "class": RX_CLASS, classEscape: RX_CLASS_ESCAPE,
                start: RX_START, end: RX_END, boundary: RX_BOUNDARY,
                backref: RX_BACKREF};
            emit(code, {opcode: opcodes[node.kind], node: node});
        }
    }

    function compilePiece(piece, code, compiler) {
        /* The overwhelmingly common case is an unquantified atom. Lower it
         * directly: routing every literal and assertion through the generic
         * repeat machine added four dispatches, two state slots, and much
         * larger backtracking snapshots without changing its meaning. */
        if (piece.minimum === 1 && piece.maximum === 1) {
            compileAtom(piece.atom, code, compiler);
            return;
        }
        var countSlot = compiler.nextStateSlot++;
        var positionSlot = compiler.nextStateSlot++;
        var initialize = emit(code, {opcode: RX_REPEAT_INIT,
                                     countSlot: countSlot});
        var decide = emit(code, {opcode: RX_REPEAT_DECIDE,
            countSlot: countSlot, minimum: piece.minimum,
            maximum: piece.maximum, greedy: piece.greedy,
            body: 0, exit: 0});
        code[initialize].target = decide;
        code[decide].body = code.length;
        emit(code, {opcode: RX_REPEAT_MARK, positionSlot: positionSlot});
        compileAtom(piece.atom, code, compiler);
        emit(code, {opcode: RX_REPEAT_NEXT, countSlot: countSlot,
            positionSlot: positionSlot, decide: decide, exit: 0});
        var exit = code.length;
        code[decide].exit = exit;
        code[code.length - 1].exit = exit;
    }

    function compileSequence(pieces, code, compiler) {
        var index = 0;
        while (index < pieces.length) {
            compilePiece(pieces[index++], code, compiler);
        }
    }

    function patternStartMetadata(parsed) {
        var anchored = true;
        var firstLiteralCode = -1;
        var literalKnown = true;
        var commonPrefix = null;
        var branchIndex = 0;
        while (branchIndex < parsed.alternatives.length) {
            var pieces = parsed.alternatives[branchIndex++];
            var pieceIndex = 0;
            var branchAnchored = false;
            if (pieceIndex < pieces.length && pieces[pieceIndex].minimum > 0 &&
                pieces[pieceIndex].atom.kind === "start") {
                branchAnchored = true;
                pieceIndex++;
            }
            if (!branchAnchored) anchored = false;
            var branchPrefix = "";
            var prefixIndex = pieceIndex;
            while (prefixIndex < pieces.length) {
                var prefixPiece = pieces[prefixIndex];
                if (prefixPiece.minimum !== 1 ||
                    prefixPiece.maximum !== 1 ||
                    prefixPiece.atom.kind !== "literal") break;
                branchPrefix += String.fromCharCode(prefixPiece.atom.code);
                prefixIndex++;
            }
            if (commonPrefix === null) {
                commonPrefix = branchPrefix;
            } else {
                var commonLength = commonPrefix.length;
                if (branchPrefix.length < commonLength) {
                    commonLength = branchPrefix.length;
                }
                var commonIndex = 0;
                while (commonIndex < commonLength &&
                       commonPrefix.charCodeAt(commonIndex) ===
                           branchPrefix.charCodeAt(commonIndex)) {
                    commonIndex++;
                }
                commonPrefix = commonPrefix.substring(0, commonIndex);
            }
            if (pieceIndex >= pieces.length ||
                pieces[pieceIndex].minimum <= 0 ||
                pieces[pieceIndex].atom.kind !== "literal") {
                literalKnown = false;
            } else if (firstLiteralCode < 0) {
                firstLiteralCode = pieces[pieceIndex].atom.code;
            } else if (firstLiteralCode !== pieces[pieceIndex].atom.code) {
                literalKnown = false;
            }
        }
        if (!literalKnown) firstLiteralCode = -1;
        if (!commonPrefix) commonPrefix = null;
        return {anchored: anchored, firstLiteralCode: firstLiteralCode,
                leadingLiteral: commonPrefix};
    }

    /* Convert the convenient compiler objects into a compact structure of
     * arrays. The matcher keeps these arrays in locals, so one dispatch does
     * not repeatedly resolve fields on an instruction object. Six integer
     * operands cover the largest instruction; nodeData is used only by the
     * few operations that genuinely need a class or nested program object. */
    function packProgram(program) {
        var source = program.code;
        var packed = new Int32Array(source.length * RX_INSTRUCTION_WORDS);
        var nodeData = [];
        var index = 0;
        while (index < source.length) {
            var instruction = source[index];
            var opcode = instruction.opcode;
            var base = index * RX_INSTRUCTION_WORDS;
            packed[base] = opcode;
            nodeData[index] = instruction.node || instruction.program || null;
            if (opcode === RX_SPLIT) {
                packed[base + 1] = instruction.first;
                packed[base + 2] = instruction.second;
            } else if (opcode === RX_JUMP) {
                packed[base + 1] = instruction.target;
            } else if (opcode === RX_REPEAT_INIT) {
                packed[base + 1] = instruction.countSlot;
                packed[base + 2] = instruction.target;
            } else if (opcode === RX_REPEAT_DECIDE) {
                packed[base + 1] = instruction.countSlot;
                packed[base + 2] = instruction.minimum;
                packed[base + 3] = instruction.maximum;
                packed[base + 4] = instruction.greedy ? 1 : 0;
                packed[base + 5] = instruction.body;
                packed[base + 6] = instruction.exit;
            } else if (opcode === RX_REPEAT_MARK) {
                packed[base + 1] = instruction.positionSlot;
            } else if (opcode === RX_REPEAT_NEXT) {
                packed[base + 1] = instruction.countSlot;
                packed[base + 2] = instruction.positionSlot;
                packed[base + 3] = instruction.decide;
                packed[base + 4] = instruction.exit;
            } else if (opcode === RX_SAVE_START || opcode === RX_SAVE_END) {
                packed[base + 1] = instruction.capture;
            } else if (opcode === RX_LOOKAHEAD) {
                packed[base + 1] = instruction.positive ? 1 : 0;
            } else if (opcode === RX_LITERAL) {
                packed[base + 1] = instruction.node.code;
            } else if (opcode === RX_BACKREF) {
                packed[base + 1] = instruction.node.capture;
            } else if (opcode === RX_BOUNDARY) {
                packed[base + 1] = instruction.node.invert ? 1 : 0;
            }
            index++;
        }
        program.packedCode = packed;
        program.nodeData = nodeData;
        program.code = null;
    }

    function compilePattern(parsed) {
        var compiler = {nextStateSlot: parsed.captures * 2 + 2, programs: []};
        var code = [];
        var startMetadata = patternStartMetadata(parsed);
        compileAlternatives(parsed.alternatives, code, compiler);
        emit(code, {opcode: RX_MATCH});
        var program = {code: code, captures: parsed.captures,
                stateSlots: compiler.nextStateSlot,
                anchored: startMetadata.anchored,
                firstLiteralCode: startMetadata.firstLiteralCode,
                leadingLiteral: startMetadata.leadingLiteral ||
                    (startMetadata.firstLiteralCode < 0 ? null :
                     String.fromCharCode(startMetadata.firstLiteralCode)),
                workspace: null};
        compiler.programs.push(program);
        var programIndex = 0;
        while (programIndex < compiler.programs.length) {
            var compiledProgram = compiler.programs[programIndex++];
            compiledProgram.stateSlots = compiler.nextStateSlot;
            packProgram(compiledProgram);
        }
        return program;
    }

    function makeMatcherWorkspace(stateSlots) {
        var stackCapacity = 16;
        return {state: new Int32Array(stateSlots),
                stackPc: new Int32Array(stackCapacity),
                stackPosition: new Int32Array(stackCapacity),
                stackState: new Int32Array(stackCapacity * stateSlots)};
    }

    function growMatcherWorkspace(workspace, stateSlots) {
        var oldCapacity = workspace.stackPc.length;
        var newCapacity = oldCapacity ? oldCapacity * 2 : 16;
        var newPc = new Int32Array(newCapacity);
        var newPosition = new Int32Array(newCapacity);
        var newState = new Int32Array(newCapacity * stateSlots);
        var index = 0;
        while (index < oldCapacity) {
            newPc[index] = workspace.stackPc[index];
            newPosition[index] = workspace.stackPosition[index];
            index++;
        }
        index = 0;
        var oldStateLength = oldCapacity * stateSlots;
        while (index < oldStateLength) {
            newState[index] = workspace.stackState[index];
            index++;
        }
        workspace.stackPc = newPc;
        workspace.stackPosition = newPosition;
        workspace.stackState = newState;
    }

    function runPattern(program, machine, start, initialState) {
        var packedCode = program.packedCode;
        var nodeData = program.nodeData;
        var stateSlots = program.stateSlots;
        var input = machine.input;
        var inputLength = input.length;
        var ignoreCase = machine.ignoreCase;
        var multiline = machine.multiline;
        var pc = 0;
        var position = start;
        var workspace = program.workspace;
        if (!workspace) {
            workspace = makeMatcherWorkspace(stateSlots);
            program.workspace = workspace;
        }
        var state = workspace.state;
        var stateIndex = 0;
        while (stateIndex < stateSlots) {
            state[stateIndex] = initialState ?
                initialState[stateIndex] : -1;
            stateIndex++;
        }
        var stackPc = workspace.stackPc;
        var stackPosition = workspace.stackPosition;
        var stackState = workspace.stackState;
        var stackCapacity = stackPc.length;
        var stackDepth = 0;

        while (true) {
            var instructionBase = pc * RX_INSTRUCTION_WORDS;
            var opcode = packedCode[instructionBase];
            var node = nodeData[pc];
            var matched = true;
            var characterCode;
            if (opcode === RX_MATCH) {
                return {position: position, state: state};
            } else if (opcode === RX_SPLIT) {
                if (stackDepth >= stackCapacity) {
                    growMatcherWorkspace(workspace, stateSlots);
                    stackPc = workspace.stackPc;
                    stackPosition = workspace.stackPosition;
                    stackState = workspace.stackState;
                    stackCapacity = stackPc.length;
                }
                stackPc[stackDepth] = packedCode[instructionBase + 2];
                stackPosition[stackDepth] = position;
                var splitStateOffset = stackDepth * stateSlots;
                var splitSaveIndex = 0;
                while (splitSaveIndex < stateSlots) {
                    stackState[splitStateOffset + splitSaveIndex] =
                        state[splitSaveIndex];
                    splitSaveIndex++;
                }
                stackDepth++;
                pc = packedCode[instructionBase + 1];
                continue;
            } else if (opcode === RX_JUMP) {
                pc = packedCode[instructionBase + 1];
                continue;
            } else if (opcode === RX_REPEAT_INIT) {
                state[packedCode[instructionBase + 1]] = 0;
                pc = packedCode[instructionBase + 2];
                continue;
            } else if (opcode === RX_REPEAT_DECIDE) {
                var repeatCount = state[packedCode[instructionBase + 1]];
                if (repeatCount < packedCode[instructionBase + 2]) {
                    pc = packedCode[instructionBase + 5];
                } else if (packedCode[instructionBase + 3] >= 0 &&
                           repeatCount >= packedCode[instructionBase + 3]) {
                    pc = packedCode[instructionBase + 6];
                } else if (packedCode[instructionBase + 4]) {
                    if (stackDepth >= stackCapacity) {
                        growMatcherWorkspace(workspace, stateSlots);
                        stackPc = workspace.stackPc;
                        stackPosition = workspace.stackPosition;
                        stackState = workspace.stackState;
                        stackCapacity = stackPc.length;
                    }
                    stackPc[stackDepth] = packedCode[instructionBase + 6];
                    stackPosition[stackDepth] = position;
                    var greedyStateOffset = stackDepth * stateSlots;
                    var greedySaveIndex = 0;
                    while (greedySaveIndex < stateSlots) {
                        stackState[greedyStateOffset + greedySaveIndex] =
                            state[greedySaveIndex];
                        greedySaveIndex++;
                    }
                    stackDepth++;
                    pc = packedCode[instructionBase + 5];
                } else {
                    if (stackDepth >= stackCapacity) {
                        growMatcherWorkspace(workspace, stateSlots);
                        stackPc = workspace.stackPc;
                        stackPosition = workspace.stackPosition;
                        stackState = workspace.stackState;
                        stackCapacity = stackPc.length;
                    }
                    stackPc[stackDepth] = packedCode[instructionBase + 5];
                    stackPosition[stackDepth] = position;
                    var lazyStateOffset = stackDepth * stateSlots;
                    var lazySaveIndex = 0;
                    while (lazySaveIndex < stateSlots) {
                        stackState[lazyStateOffset + lazySaveIndex] =
                            state[lazySaveIndex];
                        lazySaveIndex++;
                    }
                    stackDepth++;
                    pc = packedCode[instructionBase + 6];
                }
                continue;
            } else if (opcode === RX_REPEAT_MARK) {
                state[packedCode[instructionBase + 1]] = position;
                pc++;
                continue;
            } else if (opcode === RX_REPEAT_NEXT) {
                state[packedCode[instructionBase + 1]]++;
                pc = state[packedCode[instructionBase + 2]] === position ?
                    packedCode[instructionBase + 4] :
                    packedCode[instructionBase + 3];
                continue;
            } else if (opcode === RX_SAVE_START) {
                state[packedCode[instructionBase + 1] * 2] = position;
                pc++;
                continue;
            } else if (opcode === RX_SAVE_END) {
                state[packedCode[instructionBase + 1] * 2 + 1] = position;
                pc++;
                continue;
            } else if (opcode === RX_LOOKAHEAD) {
                var look = runPattern(
                    node, machine, position, state);
                if (!!look === !!packedCode[instructionBase + 1]) {
                    if (packedCode[instructionBase + 1]) {
                        var lookStateIndex = 0;
                        while (lookStateIndex < stateSlots) {
                            state[lookStateIndex] =
                                look.state[lookStateIndex];
                            lookStateIndex++;
                        }
                    }
                    pc++;
                    continue;
                }
                matched = false;
            } else if (opcode === RX_START) {
                matched = position === 0 || multiline && position > 0 &&
                    (input.charCodeAt(position - 1) === 10 ||
                     input.charCodeAt(position - 1) === 13);
            } else if (opcode === RX_END) {
                matched = position === inputLength || multiline &&
                    (input.charCodeAt(position) === 10 ||
                     input.charCodeAt(position) === 13);
            } else if (opcode === RX_BOUNDARY) {
                var before = position > 0 && word(input.charCodeAt(position - 1));
                var after = position < inputLength &&
                    word(input.charCodeAt(position));
                matched = (before !== after) !==
                    !!packedCode[instructionBase + 1];
            } else if (opcode === RX_BACKREF) {
                var captureSlot = packedCode[instructionBase + 1] * 2;
                var captureStart = state[captureSlot];
                var captureEnd = state[captureSlot + 1];
                if (captureStart >= 0 && captureEnd >= 0) {
                    var captureLength = captureEnd - captureStart;
                    matched = position + captureLength <= inputLength;
                    var captureOffset = 0;
                    while (matched && captureOffset < captureLength) {
                        var leftCode = input.charCodeAt(captureStart + captureOffset);
                        var rightCode = input.charCodeAt(position + captureOffset);
                        if (ignoreCase) {
                            leftCode = lowerAscii(leftCode);
                            rightCode = lowerAscii(rightCode);
                        }
                        matched = leftCode === rightCode;
                        captureOffset++;
                    }
                    if (matched) position += captureLength;
                }
            } else {
                matched = position < inputLength;
                if (matched) {
                    characterCode = input.charCodeAt(position);
                    if (opcode === RX_DOT) {
                        matched = characterCode !== 10 && characterCode !== 13 &&
                            characterCode !== 8232 && characterCode !== 8233;
                    } else if (opcode === RX_CLASS) {
                        matched = classMatches(node, characterCode,
                                               ignoreCase);
                    } else if (opcode === RX_CLASS_ESCAPE) {
                        matched = classEscape(node.name, characterCode);
                    } else {
                        var expectedCode =
                            packedCode[instructionBase + 1];
                        if (ignoreCase) {
                            characterCode = lowerAscii(characterCode);
                            expectedCode = lowerAscii(expectedCode);
                        }
                        matched = characterCode === expectedCode;
                    }
                    if (matched) position++;
                }
            }
            if (matched) pc++;
            else {
                if (stackDepth === 0) return null;
                stackDepth--;
                pc = stackPc[stackDepth];
                position = stackPosition[stackDepth];
                var restoreStateOffset = stackDepth * stateSlots;
                var restoreIndex = 0;
                while (restoreIndex < stateSlots) {
                    state[restoreIndex] =
                        stackState[restoreStateOffset + restoreIndex];
                    restoreIndex++;
                }
            }
        }
    }

    var PARSED_PATTERN_CACHE_LIMIT = 256;
    var parsedPatternSources = [];
    var parsedPatternTrees = [];
    var parsedPatternNext = 0;
    var mostRecentPatternSource = null;
    var mostRecentPatternTree = null;

    function parsedPattern(source) {
        if (source === mostRecentPatternSource && mostRecentPatternTree) {
            return mostRecentPatternTree;
        }
        var index = 0;
        while (index < parsedPatternSources.length) {
            if (parsedPatternSources[index] === source) {
                mostRecentPatternSource = source;
                mostRecentPatternTree = parsedPatternTrees[index];
                return mostRecentPatternTree;
            }
            index++;
        }
        var parsed = compilePattern(new Parser(source).parse());
        if (parsedPatternSources.length < PARSED_PATTERN_CACHE_LIMIT) {
            parsedPatternSources.push(source);
            parsedPatternTrees.push(parsed);
        } else {
            parsedPatternSources[parsedPatternNext] = source;
            parsedPatternTrees[parsedPatternNext] = parsed;
            parsedPatternNext++;
            if (parsedPatternNext === PARSED_PATTERN_CACHE_LIMIT) {
                parsedPatternNext = 0;
            }
        }
        mostRecentPatternSource = source;
        mostRecentPatternTree = parsed;
        return parsed;
    }

    function execute(regexp, value) {
        var input = String(value);
        /* RegExp source and flags are immutable in ES5.1. Parsed pattern trees
         * can therefore be shared by different RegExp instances with the same
         * source while lastIndex remains instance-local below. */
        var parsed = parsedPattern(String(regexp.source));
        var global = !!regexp.global;
        var start = global ? Number(regexp.lastIndex) : 0;
        if (!(start >= 0)) start = 0;
        start = Math.floor(start);
        var machine = {input: input, ignoreCase: !!regexp.ignoreCase,
                       multiline: !!regexp.multiline};
        while (start <= input.length) {
            if (parsed.anchored && !machine.multiline && start > 0) break;
            if (parsed.firstLiteralCode >= 0 && !machine.ignoreCase) {
                start = input.indexOf(parsed.leadingLiteral, start);
                if (start < 0) break;
            }
            if (parsed.firstLiteralCode >= 0 && machine.ignoreCase &&
                start < input.length) {
                var candidateCode = input.charCodeAt(start);
                var requiredCode = parsed.firstLiteralCode;
                candidateCode = lowerAscii(candidateCode);
                requiredCode = lowerAscii(requiredCode);
                if (candidateCode !== requiredCode) {
                    start++;
                    continue;
                }
            }
            var result = runPattern(parsed, machine, start, null);
            if (result) {
                var match = [];
                match[0] = input.substring(start, result.position);
                var capture = 1;
                while (capture <= parsed.captures) {
                    var captureStart = result.state[capture * 2];
                    var captureEnd = result.state[capture * 2 + 1];
                    match[capture] = captureStart < 0 ? undefined :
                        input.substring(captureStart, captureEnd);
                    capture++;
                }
                match.index = start;
                match.input = input;
                if (global) regexp.lastIndex = result.position;
                return match;
            }
            start++;
        }
        if (global) regexp.lastIndex = 0;
        return null;
    }

    var guestExec = function (value) {
        return execute(this, value);
    };
    var guestTest = function (value) {
        return execute(this, value) !== null;
    };

    function regexpFlags(regexp, forceGlobal) {
        var flags = "";
        if (regexp.global || forceGlobal) flags += "g";
        if (regexp.ignoreCase) flags += "i";
        if (regexp.multiline) flags += "m";
        return flags;
    }

    function asRegExp(value, forceGlobal) {
        if (value instanceof RegExp) {
            if (!forceGlobal || value.global) return value;
            return new RegExp(value.source, regexpFlags(value, true));
        }
        return new RegExp(value === undefined ? "" : String(value),
                          forceGlobal ? "g" : "");
    }

    function advanceEmptyMatch(regexp, match, inputLength) {
        if (match[0] !== "") return false;
        if (regexp.lastIndex > inputLength) return true;
        regexp.lastIndex = Number(regexp.lastIndex) + 1;
        return false;
    }

    function stringReceiver(value) {
        /* Non-strict guest calls box a primitive receiver. Unbox the ordinary
         * String wrapper before invoking the general String conversion, whose
         * object-to-primitive continuation is not needed for this hot path. */
        if (typeof value === "string") return value;
        if (value instanceof String) return value.valueOf();
        return String(value);
    }

    var guestStringMatch = function (value) {
        var input = stringReceiver(this);
        var regexp = asRegExp(value, false);
        if (!regexp.global) return execute(regexp, input);
        regexp.lastIndex = 0;
        var matches = [];
        var match;
        while ((match = execute(regexp, input)) !== null) {
            matches.push(match[0]);
            if (advanceEmptyMatch(regexp, match, input.length)) break;
        }
        regexp.lastIndex = 0;
        return matches.length ? matches : null;
    };

    function replacementText(template, match, input) {
        template = String(template);
        var output = "";
        var index = 0;
        while (index < template.length) {
            var character = template.charAt(index++);
            if (character !== "$" || index >= template.length) {
                output += character;
                continue;
            }
            var marker = template.charAt(index);
            if (marker === "$") {
                output += "$";
                index++;
            } else if (marker === "&") {
                output += match[0];
                index++;
            } else if (marker === "`") {
                output += input.substring(0, match.index);
                index++;
            } else if (marker === "'") {
                output += input.substring(match.index + match[0].length);
                index++;
            } else {
                var first = marker.charCodeAt(0) - 48;
                if (first < 0 || first > 9 || first === 0) {
                    output += "$";
                    continue;
                }
                var capture = first;
                var consumed = 1;
                if (index + 1 < template.length) {
                    var second = template.charCodeAt(index + 1) - 48;
                    var combined = capture * 10 + second;
                    if (second >= 0 && second <= 9 &&
                        combined < match.length) {
                        capture = combined;
                        consumed = 2;
                    }
                }
                if (capture < match.length) {
                    if (match[capture] !== undefined) {
                        output += match[capture];
                    }
                    index += consumed;
                } else output += "$";
            }
        }
        return output;
    }

    function replacementFor(replacement, match, input) {
        if (typeof replacement === "function") {
            var argumentsList = [];
            var index = 0;
            while (index < match.length) argumentsList.push(match[index++]);
            argumentsList.push(match.index);
            argumentsList.push(input);
            return String(replacement.apply(undefined, argumentsList));
        }
        return replacementText(replacement, match, input);
    }

    var guestStringReplace = function (searchValue, replacement) {
        var input = stringReceiver(this);
        if (!(searchValue instanceof RegExp)) {
            var searchText = String(searchValue);
            var position = input.indexOf(searchText);
            if (position < 0) return input;
            var plainMatch = [searchText];
            plainMatch.index = position;
            plainMatch.input = input;
            return input.substring(0, position) +
                replacementFor(replacement, plainMatch, input) +
                input.substring(position + searchText.length);
        }
        var regexp = searchValue;
        var global = !!regexp.global;
        if (global) regexp.lastIndex = 0;
        var output = "";
        var sourcePosition = 0;
        var match;
        while ((match = execute(regexp, input)) !== null) {
            output += input.substring(sourcePosition, match.index);
            output += replacementFor(replacement, match, input);
            sourcePosition = match.index + match[0].length;
            if (!global) break;
            if (advanceEmptyMatch(regexp, match, input.length)) break;
        }
        if (global) regexp.lastIndex = 0;
        return output + input.substring(sourcePosition);
    };

    function splitLimit(value) {
        if (value === undefined) return 4294967295;
        var number = Number(value);
        if (!(number === number) || number === 0 ||
            number === Infinity || number === -Infinity) return 0;
        number = number < 0 ? Math.ceil(number) : Math.floor(number);
        number %= 4294967296;
        if (number < 0) number += 4294967296;
        return number;
    }

    var guestStringSplit = function (separator, limitValue) {
        var input = stringReceiver(this);
        var limit = splitLimit(limitValue);
        var result = [];
        if (limit === 0) return result;
        if (separator === undefined) {
            result.push(input);
            return result;
        }
        if (!(separator instanceof RegExp)) {
            var separatorText = String(separator);
            if (separatorText === "") {
                var characterIndex = 0;
                while (characterIndex < input.length && result.length < limit) {
                    result.push(input.charAt(characterIndex++));
                }
                return result;
            }
            var stringStart = 0;
            var stringMatch;
            while (result.length < limit &&
                   (stringMatch = input.indexOf(separatorText, stringStart)) >= 0) {
                result.push(input.substring(stringStart, stringMatch));
                stringStart = stringMatch + separatorText.length;
            }
            if (result.length < limit) result.push(input.substring(stringStart));
            return result;
        }
        var splitter = asRegExp(separator, true);
        splitter.lastIndex = 0;
        var sourcePosition = 0;
        var match;
        while (result.length < limit &&
               (match = execute(splitter, input)) !== null) {
            var matchEnd = match.index + match[0].length;
            if (matchEnd === sourcePosition && match[0] === "") {
                if (advanceEmptyMatch(splitter, match, input.length)) break;
                continue;
            }
            result.push(input.substring(sourcePosition, match.index));
            var capture = 1;
            while (capture < match.length && result.length < limit) {
                result.push(match[capture++]);
            }
            sourcePosition = matchEnd;
            if (advanceEmptyMatch(splitter, match, input.length)) break;
        }
        if (result.length < limit) result.push(input.substring(sourcePosition));
        return result;
    };

    var guestStringSearch = function (value) {
        var regexp = asRegExp(value, false);
        var previousLastIndex = regexp.lastIndex;
        regexp.lastIndex = 0;
        var match = execute(regexp, stringReceiver(this));
        regexp.lastIndex = previousLastIndex;
        return match ? match.index : -1;
    };
    /* The snapshot embedder installs these bytecode functions on the guest
     * RegExp prototype after this bootstrap program returns.  Publishing the
     * functions also keeps this module independent of the bootstrap host: the
     * implementations and every object they retain already live in the guest
     * runtime heap. */
    this.__guestRegExpExec = guestExec;
    this.__guestRegExpTest = guestTest;
    this.__guestStringMatch = guestStringMatch;
    this.__guestStringReplace = guestStringReplace;
    this.__guestStringSplit = guestStringSplit;
    this.__guestStringSearch = guestStringSearch;
}());
