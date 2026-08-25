(function (root) {
    var Tokenizer = root.GuestVMTokenizer;
    if (typeof module !== "undefined" && module.exports) {
        Tokenizer = require("./tokenizer.js");
    }

    function Parser(source, filename) {
        this.tokenizer = new Tokenizer(source, filename);
        this.current = this.tokenizer.next(true);
    }

    Parser.prototype.error = function (message) {
        this.tokenizer.error(message, this.current.line, this.current.column);
    };

    Parser.prototype.advance = function (allowRegexp) {
        var previous = this.current;
        this.current = this.tokenizer.next(!!allowRegexp);
        return previous;
    };

    Parser.prototype.isPunctuator = function (value) {
        return this.current.kind === "punctuator" && this.current.value === value;
    };

    Parser.prototype.isKeyword = function (value) {
        return this.current.kind === "keyword" && this.current.value === value;
    };

    Parser.prototype.expectPunctuator = function (value, allowRegexp) {
        if (!this.isPunctuator(value)) this.error("expected '" + value + "'");
        return this.advance(allowRegexp);
    };

    Parser.prototype.expectIdentifier = function () {
        if (this.current.kind !== "identifier") this.error("expected identifier");
        return this.advance(false);
    };

    Parser.prototype.parseProgram = function () {
        var body = [];
        while (this.current.kind !== "eof") body.push(this.parseStatement());
        return {type: "Program", body: body};
    };

    Parser.prototype.parseStatement = function () {
        if (this.isPunctuator(";")) {
            this.advance(true);
            return {type: "EmptyStatement"};
        }
        if (this.isPunctuator("{")) return this.parseBlock();
        if (this.isKeyword("var")) return this.parseVariableStatement(true);
        if (this.isKeyword("for")) return this.parseForStatement();
        if (this.isKeyword("while")) return this.parseWhileStatement();
        if (this.isKeyword("if")) return this.parseIfStatement();
        if (this.isKeyword("return")) return this.parseReturnStatement();
        var expression = this.parseExpression();
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "ExpressionStatement", expression: expression};
    };

    Parser.prototype.parseBlock = function () {
        this.expectPunctuator("{", true);
        var body = [];
        while (!this.isPunctuator("}")) {
            if (this.current.kind === "eof") this.error("unterminated block");
            body.push(this.parseStatement());
        }
        this.expectPunctuator("}", true);
        return {type: "BlockStatement", body: body};
    };

    Parser.prototype.parseVariableStatement = function (consumeSemicolon) {
        this.advance(false);
        var declarations = [];
        while (true) {
            var name = this.expectIdentifier().value;
            var initial = null;
            if (this.isPunctuator("=")) {
                this.advance(true);
                initial = this.parseAssignment();
            }
            declarations.push({name: name, initial: initial});
            if (!this.isPunctuator(",")) break;
            this.advance(false);
        }
        if (consumeSemicolon) {
            if (this.isPunctuator(";")) this.advance(true);
            else if (!this.current.lineBefore && !this.isPunctuator("}") &&
                     this.current.kind !== "eof") this.error("expected ';'");
        }
        return {type: "VariableStatement", declarations: declarations};
    };

    Parser.prototype.parseForStatement = function () {
        this.advance(false);
        this.expectPunctuator("(", true);
        var initial = null;
        if (this.isKeyword("var")) initial = this.parseVariableStatement(false);
        else if (!this.isPunctuator(";")) initial = this.parseExpression();
        this.expectPunctuator(";", true);
        var test = null;
        if (!this.isPunctuator(";")) test = this.parseExpression();
        this.expectPunctuator(";", true);
        var update = null;
        if (!this.isPunctuator(")")) update = this.parseExpression();
        this.expectPunctuator(")", true);
        return {type: "ForStatement", initial: initial, test: test,
                update: update, body: this.parseStatement()};
    };

    Parser.prototype.parseWhileStatement = function () {
        this.advance(false);
        this.expectPunctuator("(", true);
        var test = this.parseExpression();
        this.expectPunctuator(")", true);
        return {type: "WhileStatement", test: test, body: this.parseStatement()};
    };

    Parser.prototype.parseIfStatement = function () {
        this.advance(false);
        this.expectPunctuator("(", true);
        var test = this.parseExpression();
        this.expectPunctuator(")", true);
        var consequent = this.parseStatement();
        var alternate = null;
        if (this.isKeyword("else")) {
            this.advance(true);
            alternate = this.parseStatement();
        }
        return {type: "IfStatement", test: test, consequent: consequent,
                alternate: alternate};
    };

    Parser.prototype.parseReturnStatement = function () {
        this.advance(true);
        var argument = null;
        if (!this.current.lineBefore && !this.isPunctuator(";") &&
            !this.isPunctuator("}") && this.current.kind !== "eof") {
            argument = this.parseExpression();
        }
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "ReturnStatement", argument: argument};
    };

    Parser.prototype.parseExpression = function () {
        var expression = this.parseAssignment();
        while (this.isPunctuator(",")) {
            this.advance(true);
            expression = {type: "SequenceExpression", left: expression,
                          right: this.parseAssignment()};
        }
        return expression;
    };

    Parser.prototype.parseAssignment = function () {
        var left = this.parseLogicalOr();
        if (this.current.kind === "punctuator" &&
            (this.current.value === "=" || this.current.value === "+=" ||
             this.current.value === "-=" || this.current.value === "*=" ||
             this.current.value === "/=" || this.current.value === "%=")) {
            var operator = this.advance(true).value;
            return {type: "AssignmentExpression", operator: operator,
                    left: left, right: this.parseAssignment()};
        }
        return left;
    };

    Parser.prototype.parseBinary = function (next, operators) {
        var left = next.call(this);
        while (operators[this.current.value] &&
               (this.current.kind === "punctuator" ||
                this.current.kind === "keyword")) {
            var operator = this.advance(true).value;
            left = {type: "BinaryExpression", operator: operator,
                    left: left, right: next.call(this)};
        }
        return left;
    };

    Parser.prototype.parseLogicalOr = function () {
        return this.parseBinary(this.parseLogicalAnd, {"||": 1});
    };
    Parser.prototype.parseLogicalAnd = function () {
        return this.parseBinary(this.parseEquality, {"&&": 1});
    };
    Parser.prototype.parseEquality = function () {
        return this.parseBinary(this.parseRelational,
                                {"==": 1, "!=": 1, "===": 1, "!==": 1});
    };
    Parser.prototype.parseRelational = function () {
        return this.parseBinary(this.parseAdditive,
                                {"<": 1, "<=": 1, ">": 1, ">=": 1});
    };
    Parser.prototype.parseAdditive = function () {
        return this.parseBinary(this.parseMultiplicative, {"+": 1, "-": 1});
    };
    Parser.prototype.parseMultiplicative = function () {
        return this.parseBinary(this.parseUnary, {"*": 1, "/": 1, "%": 1});
    };

    Parser.prototype.parseUnary = function () {
        if ((this.current.kind === "punctuator" &&
             (this.current.value === "!" || this.current.value === "+" ||
              this.current.value === "-")) ||
            (this.current.kind === "keyword" &&
             (this.current.value === "typeof" || this.current.value === "void"))) {
            var operator = this.advance(true).value;
            return {type: "UnaryExpression", operator: operator,
                    argument: this.parseUnary()};
        }
        return this.parsePostfix();
    };

    Parser.prototype.parsePostfix = function () {
        var expression = this.parseLeftHandSide();
        if (!this.current.lineBefore && this.current.kind === "punctuator" &&
            (this.current.value === "++" || this.current.value === "--")) {
            return {type: "UpdateExpression", operator: this.advance(false).value,
                    argument: expression, prefix: false};
        }
        return expression;
    };

    Parser.prototype.parseLeftHandSide = function () {
        var expression = this.parsePrimary();
        while (true) {
            if (this.isPunctuator(".")) {
                this.advance(false);
                var property = this.expectIdentifier().value;
                expression = {type: "MemberExpression", object: expression,
                              property: {type: "Literal", value: property},
                              computed: false};
            } else if (this.isPunctuator("[")) {
                this.advance(true);
                var key = this.parseExpression();
                this.expectPunctuator("]", false);
                expression = {type: "MemberExpression", object: expression,
                              property: key, computed: true};
            } else if (this.isPunctuator("(")) {
                this.advance(true);
                var args = [];
                if (!this.isPunctuator(")")) {
                    while (true) {
                        args.push(this.parseAssignment());
                        if (!this.isPunctuator(",")) break;
                        this.advance(true);
                    }
                }
                this.expectPunctuator(")", false);
                expression = {type: "CallExpression", callee: expression,
                              arguments: args};
            } else {
                break;
            }
        }
        return expression;
    };

    Parser.prototype.parsePrimary = function () {
        var token = this.current;
        if (token.kind === "number" || token.kind === "string") {
            this.advance(false);
            return {type: "Literal", value: token.value};
        }
        if (token.kind === "keyword" &&
            (token.value === "true" || token.value === "false" ||
             token.value === "null")) {
            this.advance(false);
            return {type: "Literal", value: token.value === "true" ? true :
                    token.value === "false" ? false : null};
        }
        if (token.kind === "identifier") {
            this.advance(false);
            return {type: "Identifier", name: token.value};
        }
        if (this.isPunctuator("(")) {
            this.advance(true);
            var expression = this.parseExpression();
            this.expectPunctuator(")", false);
            return expression;
        }
        this.error("expected expression");
    };

    root.GuestVMParser = Parser;
    if (typeof module !== "undefined" && module.exports) module.exports = Parser;
}(this));
