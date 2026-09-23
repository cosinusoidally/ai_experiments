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

    function copyCaptures(captures) {
        var result = [];
        var index = 0;
        while (index < captures.length) {
            result[index] = captures[index];
            index++;
        }
        return result;
    }

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

    function alternatives(machine, branches, position, captures, done) {
        var index = 0;
        while (index < branches.length) {
            var result = sequence(machine, branches[index++], 0, position,
                                  copyCaptures(captures), done);
            if (result) return result;
        }
        return null;
    }

    function atom(machine, node, position, captures, done) {
        var input = machine.input;
        var code;
        if (node.kind === "start") {
            if (position === 0 || machine.multiline && position > 0 &&
                (input.charCodeAt(position - 1) === 10 ||
                 input.charCodeAt(position - 1) === 13)) {
                return done(position, captures);
            }
            return null;
        }
        if (node.kind === "end") {
            if (position === input.length || machine.multiline &&
                (input.charCodeAt(position) === 10 ||
                 input.charCodeAt(position) === 13)) {
                return done(position, captures);
            }
            return null;
        }
        if (node.kind === "boundary") {
            var before = position > 0 && word(input.charCodeAt(position - 1));
            var after = position < input.length && word(input.charCodeAt(position));
            return ((before !== after) !== node.invert) ?
                done(position, captures) : null;
        }
        if (node.kind === "lookahead") {
            var look = alternatives(machine, node.alternatives, position,
                copyCaptures(captures), function (end, resultCaptures) {
                    return {position: end, captures: resultCaptures};
                });
            if (node.positive) {
                return look ? done(position, look.captures) : null;
            }
            return look ? null : done(position, captures);
        }
        if (node.kind === "group") {
            var start = position;
            return alternatives(machine, node.alternatives, position, captures,
                function (end, resultCaptures) {
                    if (node.capture > 0) {
                        resultCaptures = copyCaptures(resultCaptures);
                        resultCaptures[node.capture * 2] = start;
                        resultCaptures[node.capture * 2 + 1] = end;
                    }
                    return done(end, resultCaptures);
                });
        }
        if (node.kind === "backref") {
            var captureStart = captures[node.capture * 2];
            var captureEnd = captures[node.capture * 2 + 1];
            if (captureStart === undefined || captureEnd === undefined) {
                return done(position, captures);
            }
            var length = captureEnd - captureStart;
            if (position + length > input.length) return null;
            var offset = 0;
            while (offset < length) {
                var left = input.charCodeAt(captureStart + offset);
                var right = input.charCodeAt(position + offset);
                if (machine.ignoreCase) {
                    left = lowerAscii(left);
                    right = lowerAscii(right);
                }
                if (left !== right) return null;
                offset++;
            }
            return done(position + length, captures);
        }
        if (position >= input.length) return null;
        code = input.charCodeAt(position);
        var matched = false;
        if (node.kind === "dot") matched = code !== 10 && code !== 13 &&
            code !== 8232 && code !== 8233;
        else if (node.kind === "class") matched = classMatches(node, code,
                                                                machine.ignoreCase);
        else if (node.kind === "classEscape") matched = classEscape(node.name, code);
        else {
            var expected = node.code;
            if (machine.ignoreCase) {
                code = lowerAscii(code);
                expected = lowerAscii(expected);
            }
            matched = code === expected;
        }
        return matched ? done(position + 1, captures) : null;
    }

    function repeat(machine, piece, count, position, captures, done) {
        function stop() {
            return count >= piece.minimum ? done(position, captures) : null;
        }
        function more() {
            if (piece.maximum >= 0 && count >= piece.maximum) return null;
            return atom(machine, piece.atom, position, copyCaptures(captures),
                function (end, resultCaptures) {
                    if (end === position) {
                        return count + 1 >= piece.minimum ?
                            done(end, resultCaptures) : null;
                    }
                    return repeat(machine, piece, count + 1, end,
                                  resultCaptures, done);
                });
        }
        return piece.greedy ? more() || stop() : stop() || more();
    }

    function sequence(machine, pieces, index, position, captures, done) {
        if (index >= pieces.length) return done(position, captures);
        return repeat(machine, pieces[index], 0, position, captures,
            function (end, resultCaptures) {
                return sequence(machine, pieces, index + 1, end,
                                resultCaptures, done);
            });
    }

    function execute(regexp, value) {
        var input = String(value);
        var parsed = new Parser(String(regexp.source)).parse();
        var global = !!regexp.global;
        var start = global ? Number(regexp.lastIndex) : 0;
        if (!(start >= 0)) start = 0;
        start = Math.floor(start);
        var machine = {input: input, ignoreCase: !!regexp.ignoreCase,
                       multiline: !!regexp.multiline};
        while (start <= input.length) {
            var captures = [];
            var result = alternatives(machine, parsed.alternatives, start,
                captures, function (end, resultCaptures) {
                    return {position: end, captures: resultCaptures};
                });
            if (result) {
                var match = [];
                match[0] = input.substring(start, result.position);
                var capture = 1;
                while (capture <= parsed.captures) {
                    var captureStart = result.captures[capture * 2];
                    var captureEnd = result.captures[capture * 2 + 1];
                    match[capture] = captureStart === undefined ? undefined :
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
    /* The snapshot embedder installs these bytecode functions on the guest
     * RegExp prototype after this bootstrap program returns.  Publishing the
     * functions also keeps this module independent of the bootstrap host: the
     * implementations and every object they retain already live in the guest
     * runtime heap. */
    this.__guestRegExpExec = guestExec;
    this.__guestRegExpTest = guestTest;
}());
