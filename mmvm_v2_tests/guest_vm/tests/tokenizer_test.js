(function () {
    var Tokenizer;
    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) Tokenizer = require("../tokenizer.js");
    else Tokenizer = GuestVMTokenizer;

    var passed = 0;

    function fail(message) {
        throw new Error(message);
    }

    function equal(actual, expected, message) {
        if (actual !== expected) {
            fail(message + ": expected " + expected + ", got " + actual);
        }
        passed++;
    }

    function throwsSyntax(action, message) {
        var threw = false;
        try { action(); }
        catch (error) { threw = error && error.name === "SyntaxError"; }
        if (!threw) fail(message + ": expected SyntaxError");
        passed++;
    }

    function token(tokenizer, allowRegexp, kind, value) {
        var current = tokenizer.next(allowRegexp);
        equal(current.kind, kind, "token kind");
        if (value !== undefined) equal(current.value, value, "token value");
        return current;
    }

    var basic = new Tokenizer("var total = 0; // add\nfor (i = .5; i < 0x10; i++) total += i;",
                              "basic.js");
    token(basic, true, "keyword", "var");
    token(basic, false, "identifier", "total");
    token(basic, false, "punctuator", "=");
    token(basic, true, "number", 0);
    token(basic, false, "punctuator", ";");
    var forToken = token(basic, true, "keyword", "for");
    equal(forToken.line, 2, "line comment advances line");
    equal(forToken.lineBefore, true, "line break metadata");
    token(basic, false, "punctuator", "(");
    token(basic, true, "identifier", "i");
    token(basic, false, "punctuator", "=");
    token(basic, true, "number", 0.5);

    var strings = new Tokenizer("'a\\n\\x42\\u0043' /* x\ny */ name", "strings.js");
    token(strings, true, "string", "a\nBC");
    var name = token(strings, false, "identifier", "name");
    equal(name.line, 2, "block comment line tracking");
    equal(name.lineBefore, true, "block comment line break metadata");

    var slash = new Tokenizer("/a\\/[b/]+/gi / 2 /= 3", "slash.js");
    var regexp = token(slash, true, "regexp");
    equal(regexp.value.pattern, "a\\/[b/]+", "regexp pattern text");
    equal(regexp.value.flags, "gi", "regexp flags");
    token(slash, false, "punctuator", "/");
    token(slash, true, "number", 2);
    token(slash, false, "punctuator", "/=");
    token(slash, true, "number", 3);

    var longest = new Tokenizer(">>>= === !== ++ -- && ||", "punct.js");
    token(longest, true, "punctuator", ">>>=");
    token(longest, true, "punctuator", "===");
    token(longest, true, "punctuator", "!==");
    token(longest, true, "punctuator", "++");
    token(longest, true, "punctuator", "--");
    token(longest, true, "punctuator", "&&");
    token(longest, true, "punctuator", "||");

    var escapedIdentifier = new Tokenizer("v\\u0061lue", "identifier.js");
    token(escapedIdentifier, true, "identifier", "value");

    throwsSyntax(function () {
        new Tokenizer("0x", "bad-number.js").next(true);
    }, "invalid hexadecimal literal");
    throwsSyntax(function () {
        new Tokenizer("'open", "bad-string.js").next(true);
    }, "unterminated string");
    throwsSyntax(function () {
        new Tokenizer("/* open", "bad-comment.js").next(true);
    }, "unterminated comment");
    throwsSyntax(function () {
        new Tokenizer("/[open/", "bad-regexp.js").next(true);
    }, "unterminated regexp class");

    function readTokenizerSource() {
        if (isNode) {
            return require("fs").readFileSync(__dirname + "/../tokenizer.js", "utf8");
        }
        return read("guest_vm/tokenizer.js");
    }

    var tokenizerSource = readTokenizerSource();
    var forbiddenConstructor = "Reg" + "Exp" + "(";
    var forbiddenMatch = ".mat" + "ch(";
    var forbiddenSearch = ".sear" + "ch(";
    equal(tokenizerSource.indexOf(forbiddenConstructor), -1,
          "tokenizer does not construct host regexp objects");
    equal(tokenizerSource.indexOf(forbiddenMatch), -1,
          "tokenizer does not call String.match");
    equal(tokenizerSource.indexOf(forbiddenSearch), -1,
          "tokenizer does not call String.search");

    var output = "tokenizer tests passed: " + passed;
    if (typeof print === "function") print(output);
    else console.log(output);
}());
