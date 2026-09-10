/* Character-by-character ECMAScript tokenizer.  This module deliberately
 * contains no regular-expression based token recognition. */
(function (root) {
    var unicodeIdentifiers = root.GuestVMUnicodeIdentifierData;
    if (typeof module !== "undefined" && module.exports) {
        unicodeIdentifiers = require("./unicode_identifier_data.js");
    }

    var keywords = {
        "$break": 1, "$case": 1, "$catch": 1, "$continue": 1, "$debugger": 1,
        "$default": 1, "$delete": 1, "$do": 1, "$else": 1, "$finally": 1,
        "$for": 1, "$function": 1, "$if": 1, "$in": 1, "$instanceof": 1,
        "$new": 1, "$return": 1, "$switch": 1, "$this": 1, "$throw": 1,
        "$try": 1, "$typeof": 1, "$var": 1, "$void": 1, "$while": 1,
        "$with": 1, "$null": 1, "$true": 1, "$false": 1,
        "$class": 1, "$const": 1, "$enum": 1, "$export": 1,
        "$extends": 1, "$import": 1, "$super": 1
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
               (code >= 97 && code <= 122) ||
               (code >= 128 &&
                (unicodeIdentifierFlags(code) &
                 unicodeIdentifiers.startFlag) !== 0);
    }

    function isIdentifierPart(code) {
        return isIdentifierStart(code) || isDecimalDigit(code) ||
               (code >= 128 &&
                (unicodeIdentifierFlags(code) &
                 unicodeIdentifiers.partFlag) !== 0);
    }

    function unicodeIdentifierFlags(code) {
        if (code < 0 || code > 65535) return 0;
        var block = unicodeIdentifiers.blockMap.charCodeAt(
            code >>> unicodeIdentifiers.blockSizeShift);
        return unicodeIdentifiers.characterFlags.charCodeAt(
            (block << unicodeIdentifiers.blockSizeShift) |
            (code & unicodeIdentifiers.blockSizeMask));
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

    function Tokenizer(source, filename, captureRaw, fastNumericConversion) {
        this.source = String(source);
        this.filename = filename || "<source>";
        this.length = this.source.length;
        this.index = 0;
        this.line = 1;
        this.column = 0;
        this.captureRaw = captureRaw !== false;
        this.fastNumericConversion = fastNumericConversion === true;
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
        if (this.index >= this.length) return -1;
        var code = this.source.charCodeAt(this.index);
        this.index++;
        if (code === 13) {
            if (this.index < this.length &&
                this.source.charCodeAt(this.index) === 10) this.index++;
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
            if (code === 32 || code === 9) {
                /* Spaces and tabs dominate formatted source.  Neither can
                 * affect line state, so consume a complete run directly. */
                do {
                    this.index++;
                    this.column++;
                    code = this.index < this.length ?
                        this.source.charCodeAt(this.index) : -1;
                } while (code === 32 || code === 9);
            } else if (isWhitespace(code)) {
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
        var token = this.targetToken || {};
        token.kind = kind;
        token.value = value;
        token.start = start;
        token.end = this.index;
        token.line = line;
        token.column = column;
        token.lineBefore = lineBefore;
        /* Tokens are recycled by Parser.advance(). Clear optional lexical
         * metadata so it cannot leak from a previous token. */
        token.legacyOctal = false;
        if (this.captureRaw) token.raw = this.source.substring(start, this.index);
        return token;
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
        var value = null;
        var segmentStart = this.index;
        var first = true;
        while (this.index < this.length) {
            var code = this.codeAt(0);
            if (code === 92) {
                if (value === null) value = this.source.substring(start, this.index);
                else value += this.source.substring(segmentStart, this.index);
                code = this.scanUnicodeEscape();
                if (first ? !isIdentifierStart(code) : !isIdentifierPart(code)) {
                    this.error("escaped character is not valid in identifier",
                               line, column);
                }
                value += String.fromCharCode(code);
                segmentStart = this.index;
            } else if (first ? isIdentifierStart(code) : isIdentifierPart(code)) {
                /* Identifiers cannot contain line terminators, so advancing the
                 * source position directly avoids several calls per character
                 * in the parser's hottest tokenization path. */
                this.index++;
                this.column++;
            } else {
                break;
            }
            first = false;
        }
        if (value === null) value = this.source.substring(start, this.index);
        else value += this.source.substring(segmentStart, this.index);
        /* The prefix makes inherited Object names impossible dictionary hits,
         * avoiding Function.call in the self-hosted tokenizer. */
        return this.makeToken(keywords["$" + value] === 1 ?
                              "keyword" : "identifier",
                              value, start, line, column, lineBefore);
    };

    Tokenizer.prototype.scanNumber = function (start, line, column,
                                                lineBefore) {
        /* Numeric literals never contain a line terminator.  Keep the source
         * cursor local while scanning them: large generated tables otherwise
         * pay several JS calls for every digit. */
        var source = this.source;
        var length = this.length;
        var index = this.index;
        var code = index < length ? source.charCodeAt(index) : -1;
        var next = index + 1 < length ? source.charCodeAt(index + 1) : -1;
        var numericValue = 0;
        var numericDigits = 0;
        var simpleInteger = true;
        if (code === 48 && (next === 120 || next === 88)) {
            index += 2;
            var digits = 0;
            code = index < length ? source.charCodeAt(index) : -1;
            while (isHexDigit(code)) {
                if (this.fastNumericConversion && digits < 7) {
                    numericValue = numericValue * 16 + hexValue(code);
                }
                index++;
                digits++;
                code = index < length ? source.charCodeAt(index) : -1;
            }
            numericDigits = digits;
            if (!digits) this.error("hexadecimal literal requires a digit",
                                    line, column);
        } else {
            if (code !== 46) {
                while (isDecimalDigit(code)) {
                    if (this.fastNumericConversion && numericDigits < 9) {
                        numericValue = numericValue * 10 + code - 48;
                    }
                    numericDigits++;
                    index++;
                    code = index < length ? source.charCodeAt(index) : -1;
                }
            }
            if (code === 46) {
                simpleInteger = false;
                index++;
                code = index < length ? source.charCodeAt(index) : -1;
                while (isDecimalDigit(code)) {
                    index++;
                    code = index < length ? source.charCodeAt(index) : -1;
                }
            }
            if (code === 101 || code === 69) {
                simpleInteger = false;
                index++;
                code = index < length ? source.charCodeAt(index) : -1;
                if (code === 43 || code === 45) {
                    index++;
                    code = index < length ? source.charCodeAt(index) : -1;
                }
                if (!isDecimalDigit(code)) {
                    this.error("exponent requires a digit", line, column);
                }
                while (isDecimalDigit(code)) {
                    index++;
                    code = index < length ? source.charCodeAt(index) : -1;
                }
            }
        }
        if (isIdentifierStart(code)) {
            this.error("identifier immediately follows numeric literal",
                       line, column);
        }
        this.column += index - this.index;
        this.index = index;
        var raw = source.substring(start, index);
        var legacyOctal = simpleInteger && raw.length > 1 &&
                          raw.charCodeAt(0) === 48 &&
                          raw.charCodeAt(1) !== 120 &&
                          raw.charCodeAt(1) !== 88;
        var octalIndex = 1;
        while (legacyOctal && octalIndex < raw.length) {
            var octalCode = raw.charCodeAt(octalIndex++);
            if (octalCode < 48 || octalCode > 55) legacyOctal = false;
        }
        var converted = this.fastNumericConversion && simpleInteger &&
            ((raw.length > 1 && (raw.charCodeAt(1) === 120 ||
                                 raw.charCodeAt(1) === 88)) ?
                numericDigits <= 7 : numericDigits <= 9) ?
            numericValue : Number(raw);
        if (legacyOctal) {
            converted = 0;
            octalIndex = 1;
            while (octalIndex < raw.length) {
                converted = converted * 8 + raw.charCodeAt(octalIndex++) - 48;
            }
        }
        var token = this.makeToken("number", converted, start, line, column,
                                   lineBefore);
        token.legacyOctal = legacyOctal;
        return token;
    };

    Tokenizer.prototype.scanString = function (start, line, column,
                                                lineBefore) {
        var quote = this.codeAt(0);
        /* Most strings, including embedded benchmark/document data, contain
         * no escape.  Materialize those with one substring instead of one
         * concatenation and two method calls per character. */
        var fastIndex = this.index + 1;
        while (fastIndex < this.length) {
            var fastCode = this.source.charCodeAt(fastIndex);
            if (fastCode === quote) {
                var fastValue = this.source.substring(this.index + 1, fastIndex);
                this.column += fastIndex + 1 - this.index;
                this.index = fastIndex + 1;
                return this.makeToken("string", fastValue, start, line, column,
                                      lineBefore);
            }
            if (fastCode === 92) break;
            if (isLineTerminator(fastCode)) {
                this.error("unterminated string literal", line, column);
            }
            fastIndex++;
        }
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
        if (first === "{" || first === "}" || first === "(" ||
            first === ")" || first === "[" || first === "]" ||
            first === "." || first === ";" || first === "," ||
            first === "?" || first === ":" || first === "~") {
            this.index++;
            this.column++;
            return this.makeToken("punctuator", first, start, line, column,
                                  lineBefore);
        }
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

    Tokenizer.prototype.next = function (allowRegexp, targetToken) {
        this.targetToken = targetToken || null;
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
        if (code === 47 && allowRegexp) {
            return this.scanRegexp(start, line, column, lineBefore);
        }
        return this.scanPunctuator(start, line, column, lineBefore);
    };

    root.GuestVMTokenizer = Tokenizer;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = Tokenizer;
    }
}(this));
