/* Character-by-character ECMAScript tokenizer.  This module deliberately
 * contains no regular-expression based token recognition. */
(function (root) {
    var keywords = {
        "break": 1, "case": 1, "catch": 1, "continue": 1, "debugger": 1,
        "default": 1, "delete": 1, "do": 1, "else": 1, "finally": 1,
        "for": 1, "function": 1, "if": 1, "in": 1, "instanceof": 1,
        "new": 1, "return": 1, "switch": 1, "this": 1, "throw": 1,
        "try": 1, "typeof": 1, "var": 1, "void": 1, "while": 1,
        "with": 1, "null": 1, "true": 1, "false": 1
    };

    function isDecimalDigit(code) {
        return code >= 48 && code <= 57;
    }

    function isHexDigit(code) {
        return isDecimalDigit(code) ||
               (code >= 65 && code <= 70) ||
               (code >= 97 && code <= 102);
    }

    function hexValue(code) {
        if (code >= 48 && code <= 57) return code - 48;
        if (code >= 65 && code <= 70) return code - 55;
        return code - 87;
    }

    function isIdentifierStart(code) {
        return code === 36 || code === 95 ||
               (code >= 65 && code <= 90) ||
               (code >= 97 && code <= 122) || code >= 128;
    }

    function isIdentifierPart(code) {
        return isIdentifierStart(code) || isDecimalDigit(code) ||
               code === 8204 || code === 8205;
    }

    function isLineTerminator(code) {
        return code === 10 || code === 13 || code === 8232 || code === 8233;
    }

    function isWhitespace(code) {
        return code === 9 || code === 11 || code === 12 || code === 32 ||
               code === 160 || code === 5760 || code === 6158 ||
               (code >= 8192 && code <= 8202) || code === 8239 ||
               code === 8287 || code === 12288 || code === 65279;
    }

    function Tokenizer(source, filename) {
        this.source = String(source);
        this.filename = filename || "<source>";
        this.length = this.source.length;
        this.index = 0;
        this.line = 1;
        this.column = 0;
    }

    Tokenizer.prototype.error = function (message, line, column) {
        var errorLine = line === undefined ? this.line : line;
        var errorColumn = column === undefined ? this.column : column;
        throw new SyntaxError(this.filename + ":" + errorLine + ":" +
                              errorColumn + ": " + message);
    };

    Tokenizer.prototype.codeAt = function (offset) {
        var position = this.index + (offset || 0);
        if (position < 0 || position >= this.length) return -1;
        return this.source.charCodeAt(position);
    };

    Tokenizer.prototype.advance = function () {
        var code = this.codeAt(0);
        if (code < 0) return -1;
        this.index++;
        if (code === 13) {
            if (this.codeAt(0) === 10) this.index++;
            this.line++;
            this.column = 0;
            return 10;
        }
        if (code === 10 || code === 8232 || code === 8233) {
            this.line++;
            this.column = 0;
        } else {
            this.column++;
        }
        return code;
    };

    Tokenizer.prototype.skipTrivia = function () {
        var sawLine = false;
        while (this.index < this.length) {
            var code = this.codeAt(0);
            if (isWhitespace(code)) {
                this.advance();
            } else if (isLineTerminator(code)) {
                sawLine = true;
                this.advance();
            } else if (code === 47 && this.codeAt(1) === 47) {
                this.advance();
                this.advance();
                while (this.index < this.length &&
                       !isLineTerminator(this.codeAt(0))) this.advance();
            } else if (code === 47 && this.codeAt(1) === 42) {
                var commentLine = this.line;
                var commentColumn = this.column;
                this.advance();
                this.advance();
                var closed = false;
                while (this.index < this.length) {
                    if (this.codeAt(0) === 42 && this.codeAt(1) === 47) {
                        this.advance();
                        this.advance();
                        closed = true;
                        break;
                    }
                    if (isLineTerminator(this.codeAt(0))) sawLine = true;
                    this.advance();
                }
                if (!closed) this.error("unterminated block comment",
                                        commentLine, commentColumn);
            } else {
                break;
            }
        }
        return sawLine;
    };

    Tokenizer.prototype.makeToken = function (kind, value, start, line,
                                               column, lineBefore) {
        return {kind: kind, value: value,
                raw: this.source.substring(start, this.index),
                start: start, end: this.index,
                line: line, column: column, lineBefore: lineBefore};
    };

    Tokenizer.prototype.scanUnicodeEscape = function () {
        if (this.codeAt(0) !== 92 || this.codeAt(1) !== 117) {
            this.error("invalid identifier escape");
        }
        this.advance();
        this.advance();
        var value = 0;
        var count = 0;
        while (count < 4) {
            var code = this.codeAt(0);
            if (!isHexDigit(code)) this.error("invalid Unicode escape");
            value = value * 16 + hexValue(code);
            this.advance();
            count++;
        }
        return value;
    };

    Tokenizer.prototype.scanIdentifier = function (start, line, column,
                                                    lineBefore) {
        var value = "";
        var first = true;
        while (this.index < this.length) {
            var code = this.codeAt(0);
            if (code === 92) {
                code = this.scanUnicodeEscape();
                if (first ? !isIdentifierStart(code) : !isIdentifierPart(code)) {
                    this.error("escaped character is not valid in identifier",
                               line, column);
                }
                value += String.fromCharCode(code);
            } else if (first ? isIdentifierStart(code) : isIdentifierPart(code)) {
                value += this.source.charAt(this.index);
                this.advance();
            } else {
                break;
            }
            first = false;
        }
        return this.makeToken(keywords[value] ? "keyword" : "identifier",
                              value, start, line, column, lineBefore);
    };

    Tokenizer.prototype.scanNumber = function (start, line, column,
                                                lineBefore) {
        var code = this.codeAt(0);
        if (code === 48 && (this.codeAt(1) === 120 || this.codeAt(1) === 88)) {
            this.advance();
            this.advance();
            var digits = 0;
            while (isHexDigit(this.codeAt(0))) {
                this.advance();
                digits++;
            }
            if (!digits) this.error("hexadecimal literal requires a digit",
                                    line, column);
        } else {
            if (code !== 46) {
                while (isDecimalDigit(this.codeAt(0))) this.advance();
            }
            if (this.codeAt(0) === 46) {
                this.advance();
                while (isDecimalDigit(this.codeAt(0))) this.advance();
            }
            code = this.codeAt(0);
            if (code === 101 || code === 69) {
                this.advance();
                code = this.codeAt(0);
                if (code === 43 || code === 45) this.advance();
                if (!isDecimalDigit(this.codeAt(0))) {
                    this.error("exponent requires a digit", line, column);
                }
                while (isDecimalDigit(this.codeAt(0))) this.advance();
            }
        }
        if (isIdentifierStart(this.codeAt(0))) {
            this.error("identifier immediately follows numeric literal",
                       line, column);
        }
        var raw = this.source.substring(start, this.index);
        return this.makeToken("number", Number(raw), start, line, column,
                              lineBefore);
    };

    Tokenizer.prototype.scanString = function (start, line, column,
                                                lineBefore) {
        var quote = this.codeAt(0);
        this.advance();
        var value = "";
        while (this.index < this.length) {
            var code = this.codeAt(0);
            if (code === quote) {
                this.advance();
                return this.makeToken("string", value, start, line, column,
                                      lineBefore);
            }
            if (isLineTerminator(code)) {
                this.error("unterminated string literal", line, column);
            }
            if (code !== 92) {
                value += this.source.charAt(this.index);
                this.advance();
                continue;
            }
            this.advance();
            code = this.codeAt(0);
            if (isLineTerminator(code)) {
                this.advance();
                continue;
            }
            if (code < 0) this.error("unterminated string literal", line, column);
            this.advance();
            if (code === 110) value += "\n";
            else if (code === 114) value += "\r";
            else if (code === 116) value += "\t";
            else if (code === 98) value += "\b";
            else if (code === 102) value += "\f";
            else if (code === 118) value += "\v";
            else if (code === 48) value += "\0";
            else if (code === 120 || code === 117) {
                var required = code === 120 ? 2 : 4;
                var escaped = 0;
                var count = 0;
                while (count < required) {
                    code = this.codeAt(0);
                    if (!isHexDigit(code)) this.error("invalid string escape");
                    escaped = escaped * 16 + hexValue(code);
                    this.advance();
                    count++;
                }
                value += String.fromCharCode(escaped);
            } else {
                value += String.fromCharCode(code);
            }
        }
        this.error("unterminated string literal", line, column);
    };

    Tokenizer.prototype.scanRegexp = function (start, line, column,
                                                lineBefore) {
        this.advance();
        var pattern = "";
        var inClass = false;
        var escaped = false;
        while (this.index < this.length) {
            var code = this.codeAt(0);
            if (isLineTerminator(code)) {
                this.error("unterminated regular-expression literal",
                           line, column);
            }
            if (escaped) {
                pattern += this.source.charAt(this.index);
                this.advance();
                escaped = false;
            } else if (code === 92) {
                pattern += "\\";
                this.advance();
                escaped = true;
            } else if (code === 91) {
                inClass = true;
                pattern += "[";
                this.advance();
            } else if (code === 93 && inClass) {
                inClass = false;
                pattern += "]";
                this.advance();
            } else if (code === 47 && !inClass) {
                this.advance();
                var flags = "";
                while (isIdentifierPart(this.codeAt(0))) {
                    flags += this.source.charAt(this.index);
                    this.advance();
                }
                return this.makeToken("regexp", {pattern: pattern, flags: flags},
                                      start, line, column, lineBefore);
            } else {
                pattern += this.source.charAt(this.index);
                this.advance();
            }
        }
        this.error("unterminated regular-expression literal", line, column);
    };

    Tokenizer.prototype.scanPunctuator = function (start, line, column,
                                                    lineBefore) {
        var first = this.source.charAt(this.index);
        var second = this.source.charAt(this.index + 1);
        var third = this.source.charAt(this.index + 2);
        var four = first + second + third + this.source.charAt(this.index + 3);
        var three = first + second + third;
        var two = first + second;
        var value = "";
        if (four === ">>>=") value = four;
        else if (three === "===" || three === "!==" || three === ">>>" ||
                 three === "<<=" || three === ">>=") value = three;
        else if (two === "==" || two === "!=" || two === "<=" ||
                 two === ">=" || two === "++" || two === "--" ||
                 two === "<<" || two === ">>" || two === "&&" ||
                 two === "||" || two === "+=" || two === "-=" ||
                 two === "*=" || two === "/=" || two === "%=" ||
                 two === "&=" || two === "|=" || two === "^=") value = two;
        else if (first === "{" || first === "}" || first === "(" ||
                 first === ")" || first === "[" || first === "]" ||
                 first === "." || first === ";" || first === "," ||
                 first === "<" || first === ">" || first === "+" ||
                 first === "-" || first === "*" || first === "%" ||
                 first === "&" || first === "|" || first === "^" ||
                 first === "!" || first === "~" || first === "?" ||
                 first === ":" || first === "=" || first === "/") value = first;
        if (!value) this.error("unexpected character " + first, line, column);
        var count = value.length;
        while (count > 0) {
            this.advance();
            count--;
        }
        return this.makeToken("punctuator", value, start, line, column,
                              lineBefore);
    };

    Tokenizer.prototype.next = function (allowRegexp) {
        var lineBefore = this.skipTrivia();
        var start = this.index;
        var line = this.line;
        var column = this.column;
        var code = this.codeAt(0);
        if (code < 0) {
            return this.makeToken("eof", "", start, line, column, lineBefore);
        }
        if (isIdentifierStart(code) || code === 92) {
            return this.scanIdentifier(start, line, column, lineBefore);
        }
        if (isDecimalDigit(code) ||
            (code === 46 && isDecimalDigit(this.codeAt(1)))) {
            return this.scanNumber(start, line, column, lineBefore);
        }
        if (code === 34 || code === 39) {
            return this.scanString(start, line, column, lineBefore);
        }
        if (code === 47 && allowRegexp && this.codeAt(1) !== 61) {
            return this.scanRegexp(start, line, column, lineBefore);
        }
        return this.scanPunctuator(start, line, column, lineBefore);
    };

    root.GuestVMTokenizer = Tokenizer;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Tokenizer;
    }
}(this));
