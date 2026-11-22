/* Shared ES3 RegExp grammar. Used by source-literal validation and guest
 * construction/matching; never delegates parsing to a host RegExp engine. */
(function (root) {
    var PatternSyntaxError = SyntaxError;
    function syntax(message) {
        throw new PatternSyntaxError(message);
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

    function RegExpParser(source) {
        this.source = source;
        this.index = 0;
        this.captureCount = 0;
    }

    RegExpParser.prototype.peek = function () {
        return this.index < this.source.length ?
            this.source.charAt(this.index) : "";
    };

    RegExpParser.prototype.take = function () {
        return this.index < this.source.length ?
            this.source.charAt(this.index++) : "";
    };

    RegExpParser.prototype.number = function () {
        var value = 0;
        var digits = 0;
        while (decimal(this.source.charCodeAt(this.index))) {
            value = value * 10 + this.source.charCodeAt(this.index++) - 48;
            digits++;
        }
        return digits ? value : -1;
    };

    /* Speculate only inside this routine. Failed brace syntax is literal
     * text and leaves both the cursor and the preceding atom unchanged. */
    RegExpParser.prototype.braceQuantifier = function () {
        var saved = this.index++;
        var minimum = this.number(), maximum = minimum;
        if (minimum < 0) { this.index = saved; return null; }
        if (this.peek() === ",") {
            this.index++;
            maximum = this.number();
        }
        if (this.peek() !== "}") { this.index = saved; return null; }
        this.index++;
        if (maximum >= 0 && maximum < minimum) syntax("invalid regular expression quantifier");
        return {minimum: minimum, maximum: maximum};
    };

    RegExpParser.prototype.escape = function (inClass) {
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

    RegExpParser.prototype.classAtom = function () {
        if (this.index >= this.source.length) syntax("unterminated character class");
        if (this.peek() === "\\") {
            this.index++;
            return this.escape(true);
        }
        return {kind: "literal", code: this.take().charCodeAt(0)};
    };

    RegExpParser.prototype.characterClass = function () {
        var invert = false;
        var terms = [];
        if (this.peek() === "^") {
            invert = true;
            this.index++;
        }
        while (this.index < this.source.length) {
            if (this.peek() === "]") {
                this.index++;
                return {kind: "class", invert: invert, terms: terms};
            }
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

    RegExpParser.prototype.atom = function () {
        var character = this.take();
        if (!character) syntax("missing regular expression atom");
        if (character === "^") return {kind: "start"};
        if (character === "$") return {kind: "end"};
        if (character === ".") return {kind: "dot"};
        if (character === "[") return this.characterClass();
        if (character === "\\") return this.escape(false);
        if (character === "{") {
            var afterBrace = this.index;
            this.index--;
            var bounds = this.braceQuantifier();
            this.index = afterBrace;
            if (bounds) syntax("regular expression quantifier has no atom");
        }
        if (character === "(") {
            var firstCapture = this.captureCount + 1;
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
                    firstCapture: firstCapture, captureLimit: this.captureCount + 1,
                    alternatives: alternatives};
        }
        if (character === ")" || character === "|" ||
            character === "*" || character === "+" || character === "?") {
            syntax("unexpected regular expression character " + character);
        }
        return {kind: "literal", code: character.charCodeAt(0)};
    };

    RegExpParser.prototype.piece = function () {
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
            var bounds = this.braceQuantifier();
            if (bounds) {
                minimum = bounds.minimum;
                maximum = bounds.maximum;
                quantified = true;
            }
        }
        /* A failed brace-quantifier parse rewinds to a literal brace. Do not
         * retain its speculative repeat bounds on the preceding atom. */
        if (!quantified) { minimum = 1; maximum = 1; }
        var greedy = true;
        if (quantified && this.peek() === "?") {
            this.index++;
            greedy = false;
        }
        return {atom: atom, minimum: minimum, maximum: maximum,
                greedy: greedy};
    };

    RegExpParser.prototype.sequence = function (stop) {
        var pieces = [];
        while (this.index < this.source.length && this.peek() !== "|" &&
               (!stop || this.peek() !== stop)) {
            pieces.push(this.piece());
        }
        return pieces;
    };

    RegExpParser.prototype.alternatives = function (stop) {
        var result = [this.sequence(stop)];
        while (this.peek() === "|") {
            this.index++;
            result.push(this.sequence(stop));
        }
        return result;
    };

    RegExpParser.prototype.parse = function () {
        var alternatives = this.alternatives("");
        if (this.index !== this.source.length) syntax("invalid regular expression");
        return {alternatives: alternatives, captures: this.captureCount};
    };

    RegExpParser.decimal = decimal;
    RegExpParser.SyntaxError = PatternSyntaxError;
    RegExpParser.validateFlags = function (flags) {
        var seen = {g: false, i: false, m: false};
        for (var index = 0; index < flags.length; index++) {
            var flag = flags.charAt(index);
            if (flag !== "g" && flag !== "i" && flag !== "m" || seen[flag]) {
                syntax("invalid regular expression flags");
            }
            seen[flag] = true;
        }
    };
    root.GuestVMRegExpParser = RegExpParser;
    if (typeof module !== "undefined" && module.exports) module.exports = RegExpParser;
}(this));
