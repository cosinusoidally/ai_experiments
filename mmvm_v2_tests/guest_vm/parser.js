(function (root) {
    var Tokenizer = root.GuestVMTokenizer;
    if (typeof module !== "undefined" && module.exports) {
        Tokenizer = require("./tokenizer.js");
    }

    function Parser(source, filename, options) {
        this.tokenizer = new Tokenizer(source, filename,
            !options || options.captureRaw !== false);
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
        return {type: "Program", body: body, filename: this.tokenizer.filename,
                location: body.length ? body[0].location :
                    {filename: this.tokenizer.filename, line: 1, column: 1}};
    };

    Parser.prototype.parseStatement = function () {
        var start = this.current;
        var statement = this.parseStatementWithoutLocation();
        if (!statement.location) {
            statement.location = {filename: this.tokenizer.filename,
                                  line: start.line, column: start.column + 1};
        }
        return statement;
    };

    Parser.prototype.parseStatementWithoutLocation = function () {
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
        if (this.isKeyword("function")) return this.parseFunction(true);
        if (this.isKeyword("break")) return this.parseBreakStatement();
        if (this.isKeyword("continue")) return this.parseContinueStatement();
        if (this.isKeyword("do")) return this.parseDoWhileStatement();
        if (this.isKeyword("throw")) return this.parseThrowStatement();
        if (this.isKeyword("try")) return this.parseTryStatement();
        if (this.isKeyword("switch")) return this.parseSwitchStatement();
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
        var close = this.expectPunctuator("}", true);
        return {type: "BlockStatement", body: body, sourceEnd: close.end};
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
        if (this.isKeyword("in")) {
            this.advance(true);
            var right = this.parseExpression();
            this.expectPunctuator(")", true);
            return {type: "ForInStatement", left: initial, right: right,
                    body: this.parseStatement()};
        }
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

    Parser.prototype.parseBreakStatement = function () {
        this.advance(false);
        if (this.current.kind === "identifier" && !this.current.lineBefore) {
            this.error("labelled break is not implemented");
        }
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "BreakStatement"};
    };

    Parser.prototype.parseContinueStatement = function () {
        this.advance(false);
        if (this.current.kind === "identifier" && !this.current.lineBefore) {
            this.error("labelled continue is not implemented");
        }
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "ContinueStatement"};
    };

    Parser.prototype.parseDoWhileStatement = function () {
        this.advance(true);
        var body = this.parseStatement();
        if (!this.isKeyword("while")) this.error("do statement requires while");
        this.advance(false);
        this.expectPunctuator("(", true);
        var test = this.parseExpression();
        this.expectPunctuator(")", false);
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "DoWhileStatement", body: body, test: test};
    };

    Parser.prototype.parseThrowStatement = function () {
        this.advance(true);
        if (this.current.lineBefore) this.error("line terminator after throw");
        var argument = this.parseExpression();
        if (this.isPunctuator(";")) this.advance(true);
        return {type: "ThrowStatement", argument: argument};
    };

    Parser.prototype.parseTryStatement = function () {
        this.advance(true);
        var block = this.parseBlock();
        if (!this.isKeyword("catch")) this.error("try requires catch");
        this.advance(false);
        this.expectPunctuator("(", false);
        var parameter = this.expectIdentifier().value;
        this.expectPunctuator(")", true);
        return {type: "TryStatement", block: block, parameter: parameter,
                handler: this.parseBlock()};
    };

    Parser.prototype.parseSwitchStatement = function () {
        this.advance(false);
        this.expectPunctuator("(", true);
        var discriminant = this.parseExpression();
        this.expectPunctuator(")", false);
        this.expectPunctuator("{", true);
        var cases = [];
        var sawDefault = false;
        while (!this.isPunctuator("}")) {
            var test = null;
            if (this.isKeyword("case")) {
                this.advance(true);
                test = this.parseExpression();
            } else if (this.isKeyword("default")) {
                if (sawDefault) this.error("duplicate default clause");
                sawDefault = true;
                this.advance(false);
            } else {
                this.error("expected case or default");
            }
            this.expectPunctuator(":", true);
            var consequent = [];
            while (!this.isKeyword("case") &&
                   !this.isKeyword("default") &&
                   !this.isPunctuator("}")) {
                consequent.push(this.parseStatement());
            }
            cases.push({type: "SwitchCase", test: test,
                        consequent: consequent});
        }
        this.expectPunctuator("}", true);
        return {type: "SwitchStatement", discriminant: discriminant,
                cases: cases};
    };

    Parser.prototype.parseFunction = function (declaration) {
        var start = this.current;
        this.advance(false);
        var name = null;
        if (this.current.kind === "identifier") name = this.advance(false).value;
        else if (declaration) this.error("function declaration requires a name");
        this.expectPunctuator("(", false);
        var parameters = [];
        if (!this.isPunctuator(")")) {
            while (true) {
                parameters.push(this.expectIdentifier().value);
                if (!this.isPunctuator(",")) break;
                this.advance(false);
            }
        }
        this.expectPunctuator(")", true);
        var body = this.parseBlock();
        return {type: declaration ? "FunctionDeclaration" : "FunctionExpression",
                name: name, parameters: parameters, body: body,
                source: this.tokenizer.source.substring(start.start, body.sourceEnd),
                location: {filename: this.tokenizer.filename,
                           line: start.line, column: start.column + 1}};
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
        var left = this.parseConditional();
        if (this.current.kind === "punctuator" &&
            (this.current.value === "=" || this.current.value === "+=" ||
             this.current.value === "-=" || this.current.value === "*=" ||
             this.current.value === "/=" || this.current.value === "%=" ||
             this.current.value === "|=" || this.current.value === "&=" ||
             this.current.value === "^=")) {
            var operator = this.advance(true).value;
            return {type: "AssignmentExpression", operator: operator,
                    left: left, right: this.parseAssignment()};
        }
        return left;
    };

    Parser.prototype.parseConditional = function () {
        var test = this.parseLogicalOr();
        if (!this.isPunctuator("?")) return test;
        this.advance(true);
        var consequent = this.parseAssignment();
        this.expectPunctuator(":", true);
        return {type: "ConditionalExpression", test: test,
                consequent: consequent, alternate: this.parseAssignment()};
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
        return this.parseBinary(this.parseBitwiseOr, {"&&": 1});
    };
    Parser.prototype.parseBitwiseOr = function () {
        return this.parseBinary(this.parseBitwiseXor, {"|": 1});
    };
    Parser.prototype.parseBitwiseXor = function () {
        return this.parseBinary(this.parseBitwiseAnd, {"^": 1});
    };
    Parser.prototype.parseBitwiseAnd = function () {
        return this.parseBinary(this.parseEquality, {"&": 1});
    };
    Parser.prototype.parseEquality = function () {
        return this.parseBinary(this.parseRelational,
                                {"==": 1, "!=": 1, "===": 1, "!==": 1});
    };
    Parser.prototype.parseRelational = function () {
        return this.parseBinary(this.parseShift,
                                {"<": 1, "<=": 1, ">": 1, ">=": 1});
    };
    Parser.prototype.parseShift = function () {
        return this.parseBinary(this.parseAdditive,
                                {"<<": 1, ">>": 1, ">>>": 1});
    };
    Parser.prototype.parseAdditive = function () {
        return this.parseBinary(this.parseMultiplicative, {"+": 1, "-": 1});
    };
    Parser.prototype.parseMultiplicative = function () {
        return this.parseBinary(this.parseUnary, {"*": 1, "/": 1, "%": 1});
    };

    Parser.prototype.parseUnary = function () {
        if (this.current.kind === "punctuator" &&
            (this.current.value === "++" || this.current.value === "--")) {
            var updateOperator = this.advance(true).value;
            return {type: "UpdateExpression", operator: updateOperator,
                    argument: this.parseUnary(), prefix: true};
        }
        if (this.isKeyword("new")) return this.parseNewExpression();
        if ((this.current.kind === "punctuator" &&
             (this.current.value === "!" || this.current.value === "+" ||
              this.current.value === "-" || this.current.value === "~")) ||
            (this.current.kind === "keyword" &&
             (this.current.value === "typeof" || this.current.value === "void" ||
              this.current.value === "delete"))) {
            var operator = this.advance(true).value;
            return {type: "UnaryExpression", operator: operator,
                    argument: this.parseUnary()};
        }
        return this.parsePostfix();
    };

    Parser.prototype.parseNewExpression = function () {
        this.advance(true);
        var callee = this.parsePrimary();
        while (this.isPunctuator(".")) {
            this.advance(false);
            callee = {type: "MemberExpression", object: callee,
                      property: {type: "Literal", value: this.expectIdentifier().value},
                      computed: false};
        }
        var args = [];
        if (this.isPunctuator("(")) {
            this.advance(true);
            if (!this.isPunctuator(")")) {
                while (true) {
                    args.push(this.parseAssignment());
                    if (!this.isPunctuator(",")) break;
                    this.advance(true);
                }
            }
            this.expectPunctuator(")", false);
        }
        var expression = {type: "NewExpression", callee: callee, arguments: args};
        while (true) {
            if (this.isPunctuator(".")) {
                this.advance(false);
                expression = {type: "MemberExpression", object: expression,
                              property: {type: "Literal",
                                         value: this.expectIdentifier().value},
                              computed: false};
            } else if (this.isPunctuator("(")) {
                this.advance(true);
                var callArgs = [];
                if (!this.isPunctuator(")")) {
                    while (true) {
                        callArgs.push(this.parseAssignment());
                        if (!this.isPunctuator(",")) break;
                        this.advance(true);
                    }
                }
                this.expectPunctuator(")", false);
                expression = {type: "CallExpression", callee: expression,
                              arguments: callArgs};
            } else break;
        }
        return expression;
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
        if (this.isKeyword("function")) return this.parseFunction(false);
        if (token.kind === "regexp") {
            this.advance(false);
            return {type: "RegExpLiteral", pattern: token.value.pattern,
                    flags: token.value.flags};
        }
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
        if (this.isKeyword("this")) {
            this.advance(false);
            return {type: "ThisExpression"};
        }
        if (this.isPunctuator("[")) {
            this.advance(true);
            var elements = [];
            while (!this.isPunctuator("]")) {
                elements.push(this.parseAssignment());
                if (!this.isPunctuator(",")) break;
                this.advance(true);
            }
            this.expectPunctuator("]", false);
            return {type: "ArrayExpression", elements: elements};
        }
        if (this.isPunctuator("{")) {
            this.advance(true);
            var properties = [];
            while (!this.isPunctuator("}")) {
                var keyToken = this.current;
                if (keyToken.kind !== "identifier" && keyToken.kind !== "keyword" &&
                    keyToken.kind !== "string" && keyToken.kind !== "number") {
                    this.error("expected object property name");
                }
                this.advance(false);
                this.expectPunctuator(":", true);
                properties.push({key: String(keyToken.value),
                                 value: this.parseAssignment()});
                if (!this.isPunctuator(",")) break;
                this.advance(true);
            }
            this.expectPunctuator("}", false);
            return {type: "ObjectExpression", properties: properties};
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
