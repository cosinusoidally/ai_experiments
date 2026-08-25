(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) {
        op = require("./bytecode.js");
    }

    function Compiler() {
        this.code = [];
        this.constants = [];
        this.registerCount = 0;
        this.breakTargets = [];
    }

    Compiler.prototype.allocate = function () {
        var register = this.registerCount;
        this.registerCount++;
        return register;
    };

    Compiler.prototype.allocateBlock = function (count) {
        var first = this.registerCount;
        this.registerCount += count;
        return first;
    };

    Compiler.prototype.constant = function (value) {
        var index = 0;
        while (index < this.constants.length) {
            if (this.constants[index] === value) return index;
            index++;
        }
        this.constants.push(value);
        return this.constants.length - 1;
    };

    Compiler.prototype.emit = function () {
        var position = this.code.length;
        var index = 0;
        while (index < arguments.length) {
            this.code.push(arguments[index]);
            index++;
        }
        return position;
    };

    Compiler.prototype.patch = function (position, value) {
        this.code[position] = value;
    };

    Compiler.prototype.compile = function (program) {
        var index = 0;
        while (index < program.body.length) {
            this.compileStatement(program.body[index]);
            index++;
        }
        var undefinedRegister = this.emitConstant(undefined);
        this.emit(op.RETURN, undefinedRegister);
        return {code: this.code, constants: this.constants,
                registerCount: this.registerCount, parameters: [], locals: []};
    };

    Compiler.prototype.compileFunction = function (expression) {
        var nested = new Compiler();
        var bodyProgram = {body: expression.body.body};
        var program = nested.compile(bodyProgram);
        program.parameters = expression.parameters.slice(0);
        program.locals = collectLocals(expression.body, expression.name);
        program.name = expression.name || "";
        return program;
    };

    Compiler.prototype.emitConstant = function (value) {
        var target = this.allocate();
        this.emit(op.CONST, target, this.constant(value));
        return target;
    };

    Compiler.prototype.compileStatement = function (statement) {
        var index;
        if (statement.type === "EmptyStatement") return;
        if (statement.type === "ExpressionStatement") {
            this.compileExpression(statement.expression);
            return;
        }
        if (statement.type === "BlockStatement") {
            index = 0;
            while (index < statement.body.length) {
                this.compileStatement(statement.body[index]);
                index++;
            }
            return;
        }
        if (statement.type === "VariableStatement") {
            index = 0;
            while (index < statement.declarations.length) {
                var declaration = statement.declarations[index];
                var value = declaration.initial ?
                    this.compileExpression(declaration.initial) :
                    this.emitConstant(undefined);
                this.emit(op.SET_GLOBAL, this.constant(declaration.name), value);
                index++;
            }
            return;
        }
        if (statement.type === "FunctionDeclaration") {
            var declaredFunction = this.allocate();
            this.emit(op.MAKE_FUNCTION, declaredFunction,
                      this.constant(this.compileFunction(statement)));
            this.emit(op.SET_GLOBAL, this.constant(statement.name), declaredFunction);
            return;
        }
        if (statement.type === "IfStatement") {
            var condition = this.compileExpression(statement.test);
            var falseJump = this.emit(op.JUMP_IF_FALSE, condition, 0);
            this.compileStatement(statement.consequent);
            if (statement.alternate) {
                var endJump = this.emit(op.JUMP, 0);
                this.patch(falseJump + 2, this.code.length);
                this.compileStatement(statement.alternate);
                this.patch(endJump + 1, this.code.length);
            } else {
                this.patch(falseJump + 2, this.code.length);
            }
            return;
        }
        if (statement.type === "WhileStatement") {
            var whileStart = this.code.length;
            condition = this.compileExpression(statement.test);
            var whileEnd = this.emit(op.JUMP_IF_FALSE, condition, 0);
            var whileBreaks = [];
            this.breakTargets.push(whileBreaks);
            this.compileStatement(statement.body);
            this.breakTargets.pop();
            this.emit(op.JUMP, whileStart);
            this.patch(whileEnd + 2, this.code.length);
            patchBreaks(this, whileBreaks, this.code.length);
            return;
        }
        if (statement.type === "ForStatement") {
            if (statement.initial) {
                if (statement.initial.type === "VariableStatement") {
                    this.compileStatement(statement.initial);
                } else {
                    this.compileExpression(statement.initial);
                }
            }
            var forStart = this.code.length;
            var forEnd = -1;
            if (statement.test) {
                condition = this.compileExpression(statement.test);
                forEnd = this.emit(op.JUMP_IF_FALSE, condition, 0);
            }
            var forBreaks = [];
            this.breakTargets.push(forBreaks);
            this.compileStatement(statement.body);
            this.breakTargets.pop();
            if (statement.update) this.compileExpression(statement.update);
            this.emit(op.JUMP, forStart);
            if (forEnd >= 0) this.patch(forEnd + 2, this.code.length);
            patchBreaks(this, forBreaks, this.code.length);
            return;
        }
        if (statement.type === "BreakStatement") {
            if (!this.breakTargets.length) throw new SyntaxError("break outside loop");
            this.breakTargets[this.breakTargets.length - 1].push(this.emit(op.JUMP, 0));
            return;
        }
        if (statement.type === "ThrowStatement") {
            this.emit(op.THROW, this.compileExpression(statement.argument));
            return;
        }
        if (statement.type === "TryStatement") {
            var catchPush = this.emit(op.PUSH_CATCH, 0,
                                      this.constant(statement.parameter));
            this.compileStatement(statement.block);
            this.emit(op.POP_CATCH);
            var catchEnd = this.emit(op.JUMP, 0);
            this.patch(catchPush + 1, this.code.length);
            this.compileStatement(statement.handler);
            this.patch(catchEnd + 1, this.code.length);
            return;
        }
        if (statement.type === "ReturnStatement") {
            var returned = statement.argument ?
                this.compileExpression(statement.argument) :
                this.emitConstant(undefined);
            this.emit(op.RETURN, returned);
            return;
        }
        throw new Error("unsupported statement: " + statement.type);
    };

    Compiler.prototype.emitBinary = function (operator, target, left, right) {
        var opcode = operator === "+" ? op.ADD :
            operator === "-" ? op.SUBTRACT :
            operator === "*" ? op.MULTIPLY :
            operator === "/" ? op.DIVIDE :
            operator === "%" ? op.REMAINDER :
            operator === "===" ? op.STRICT_EQUAL :
            operator === "==" ? op.EQUAL :
            operator === "<" ? op.LESS :
            operator === "<=" ? op.LESS_EQUAL :
            operator === ">" ? op.GREATER :
            operator === ">=" ? op.GREATER_EQUAL : 0;
        if (operator === "&") opcode = op.BIT_AND;
        else if (operator === "|") opcode = op.BIT_OR;
        else if (operator === "^") opcode = op.BIT_XOR;
        else if (operator === "<<") opcode = op.SHIFT_LEFT;
        else if (operator === ">>") opcode = op.SHIFT_RIGHT;
        else if (operator === ">>>") opcode = op.SHIFT_UNSIGNED_RIGHT;
        if (operator === "!==" || operator === "!=") {
            var equalRegister = this.allocate();
            this.emit(operator === "!==" ? op.STRICT_EQUAL : op.EQUAL,
                      equalRegister, left, right);
            this.emit(op.NOT, target, equalRegister);
            return;
        }
        if (!opcode) throw new Error("unsupported binary operator: " + operator);
        this.emit(opcode, target, left, right);
    };

    Compiler.prototype.compileReference = function (expression) {
        if (expression.type === "Identifier") {
            return {kind: "global", name: this.constant(expression.name)};
        }
        if (expression.type === "MemberExpression") {
            return {kind: "property",
                    object: this.compileExpression(expression.object),
                    key: this.compileExpression(expression.property)};
        }
        throw new SyntaxError("invalid assignment target");
    };

    Compiler.prototype.loadReference = function (reference) {
        var target = this.allocate();
        if (reference.kind === "global") {
            this.emit(op.GET_GLOBAL, target, reference.name);
        } else {
            this.emit(op.GET_PROPERTY, target, reference.object, reference.key);
        }
        return target;
    };

    Compiler.prototype.storeReference = function (reference, value) {
        if (reference.kind === "global") {
            this.emit(op.SET_GLOBAL, reference.name, value);
        } else {
            this.emit(op.SET_PROPERTY, reference.object, reference.key, value);
        }
    };

    Compiler.prototype.compileExpression = function (expression) {
        if (expression.type === "Literal") return this.emitConstant(expression.value);
        if (expression.type === "FunctionExpression") {
            var functionRegister = this.allocate();
            this.emit(op.MAKE_FUNCTION, functionRegister,
                      this.constant(this.compileFunction(expression)));
            return functionRegister;
        }
        if (expression.type === "ObjectExpression") {
            var objectRegister = this.allocate();
            this.emit(op.MAKE_OBJECT, objectRegister);
            var propertyIndex = 0;
            while (propertyIndex < expression.properties.length) {
                var property = expression.properties[propertyIndex];
                var propertyKey = this.emitConstant(property.key);
                var propertyValue = this.compileExpression(property.value);
                this.emit(op.SET_PROPERTY, objectRegister, propertyKey, propertyValue);
                propertyIndex++;
            }
            return objectRegister;
        }
        if (expression.type === "ArrayExpression") {
            var arrayRegister = this.allocate();
            this.emit(op.MAKE_ARRAY, arrayRegister);
            var elementIndex = 0;
            while (elementIndex < expression.elements.length) {
                var elementKey = this.emitConstant(elementIndex);
                var elementValue = this.compileExpression(expression.elements[elementIndex]);
                this.emit(op.SET_PROPERTY, arrayRegister, elementKey, elementValue);
                elementIndex++;
            }
            return arrayRegister;
        }
        if (expression.type === "RegExpLiteral") {
            var regexpRegister = this.allocate();
            this.emit(op.MAKE_REGEXP, regexpRegister,
                      this.constant(expression.pattern), this.constant(expression.flags));
            return regexpRegister;
        }
        if (expression.type === "Identifier") {
            var identifier = this.allocate();
            this.emit(op.GET_GLOBAL, identifier, this.constant(expression.name));
            return identifier;
        }
        if (expression.type === "BinaryExpression") {
            if (expression.operator === "&&" || expression.operator === "||") {
                var logical = this.compileExpression(expression.left);
                var logicalResult = this.allocate();
                this.emit(op.MOVE, logicalResult, logical);
                var skip = this.emit(op.JUMP_IF_FALSE, logical, 0);
                if (expression.operator === "||") {
                    var endTrue = this.emit(op.JUMP, 0);
                    this.patch(skip + 2, this.code.length);
                    var orRight = this.compileExpression(expression.right);
                    this.emit(op.MOVE, logicalResult, orRight);
                    this.patch(endTrue + 1, this.code.length);
                } else {
                    var andRight = this.compileExpression(expression.right);
                    this.emit(op.MOVE, logicalResult, andRight);
                    this.patch(skip + 2, this.code.length);
                }
                return logicalResult;
            }
            var left = this.compileExpression(expression.left);
            var right = this.compileExpression(expression.right);
            var binary = this.allocate();
            this.emitBinary(expression.operator, binary, left, right);
            return binary;
        }
        if (expression.type === "ConditionalExpression") {
            var conditionalResult = this.allocate();
            var conditionalTest = this.compileExpression(expression.test);
            var alternateJump = this.emit(op.JUMP_IF_FALSE, conditionalTest, 0);
            var consequentValue = this.compileExpression(expression.consequent);
            this.emit(op.MOVE, conditionalResult, consequentValue);
            var conditionalEnd = this.emit(op.JUMP, 0);
            this.patch(alternateJump + 2, this.code.length);
            var alternateValue = this.compileExpression(expression.alternate);
            this.emit(op.MOVE, conditionalResult, alternateValue);
            this.patch(conditionalEnd + 1, this.code.length);
            return conditionalResult;
        }
        if (expression.type === "UnaryExpression") {
            var argument = this.compileExpression(expression.argument);
            var unary = this.allocate();
            if (expression.operator === "!") this.emit(op.NOT, unary, argument);
            else if (expression.operator === "-") this.emit(op.NEGATE, unary, argument);
            else if (expression.operator === "+") this.emit(op.POSITIVE, unary, argument);
            else if (expression.operator === "void") {
                this.emit(op.CONST, unary, this.constant(undefined));
            } else throw new Error("unsupported unary operator: " + expression.operator);
            return unary;
        }
        if (expression.type === "MemberExpression") {
            return this.loadReference(this.compileReference(expression));
        }
        if (expression.type === "AssignmentExpression") {
            var reference = this.compileReference(expression.left);
            var assigned;
            if (expression.operator === "=") {
                assigned = this.compileExpression(expression.right);
            } else {
                var current = this.loadReference(reference);
                var assignmentRight = this.compileExpression(expression.right);
                assigned = this.allocate();
                this.emitBinary(expression.operator.charAt(0), assigned,
                                current, assignmentRight);
            }
            this.storeReference(reference, assigned);
            return assigned;
        }
        if (expression.type === "UpdateExpression") {
            reference = this.compileReference(expression.argument);
            current = this.loadReference(reference);
            var one = this.emitConstant(1);
            var updated = this.allocate();
            this.emit(expression.operator === "++" ? op.ADD : op.SUBTRACT,
                      updated, current, one);
            this.storeReference(reference, updated);
            return expression.prefix ? updated : current;
        }
        if (expression.type === "CallExpression") {
            var callee;
            var receiver = -1;
            if (expression.callee.type === "MemberExpression") {
                var callReference = this.compileReference(expression.callee);
                callee = this.loadReference(callReference);
                receiver = callReference.object;
            } else {
                callee = this.compileExpression(expression.callee);
            }
            var values = [];
            var index = 0;
            while (index < expression.arguments.length) {
                values.push(this.compileExpression(expression.arguments[index]));
                index++;
            }
            var firstArgument = this.allocateBlock(values.length);
            index = 0;
            while (index < values.length) {
                this.emit(op.MOVE, firstArgument + index, values[index]);
                index++;
            }
            var callResult = this.allocate();
            this.emit(op.CALL, callResult, callee, receiver,
                      firstArgument, values.length);
            return callResult;
        }
        if (expression.type === "NewExpression") {
            var constructor = this.compileExpression(expression.callee);
            var constructorValues = [];
            var constructorIndex = 0;
            while (constructorIndex < expression.arguments.length) {
                constructorValues.push(this.compileExpression(
                    expression.arguments[constructorIndex]));
                constructorIndex++;
            }
            var firstConstructorArgument = this.allocateBlock(
                constructorValues.length);
            constructorIndex = 0;
            while (constructorIndex < constructorValues.length) {
                this.emit(op.MOVE, firstConstructorArgument + constructorIndex,
                          constructorValues[constructorIndex]);
                constructorIndex++;
            }
            var constructed = this.allocate();
            this.emit(op.CONSTRUCT, constructed, constructor,
                      firstConstructorArgument, constructorValues.length);
            return constructed;
        }
        if (expression.type === "SequenceExpression") {
            this.compileExpression(expression.left);
            return this.compileExpression(expression.right);
        }
        throw new Error("unsupported expression: " + expression.type);
    };

    function patchBreaks(compiler, breaks, target) {
        var index = 0;
        while (index < breaks.length) {
            compiler.patch(breaks[index] + 1, target);
            index++;
        }
    }

    function collectLocals(body, functionName) {
        var names = {};
        var result = [];
        function add(name) {
            if (name && !names["$" + name]) {
                names["$" + name] = true;
                result.push(name);
            }
        }
        function visit(statement) {
            var index;
            if (statement.type === "VariableStatement") {
                for (index = 0; index < statement.declarations.length; index++) {
                    add(statement.declarations[index].name);
                }
            } else if (statement.type === "FunctionDeclaration") {
                add(statement.name);
            } else if (statement.type === "BlockStatement") {
                for (index = 0; index < statement.body.length; index++) visit(statement.body[index]);
            } else if (statement.type === "IfStatement") {
                visit(statement.consequent);
                if (statement.alternate) visit(statement.alternate);
            } else if (statement.type === "WhileStatement" || statement.type === "ForStatement") {
                if (statement.initial && statement.initial.type === "VariableStatement") visit(statement.initial);
                visit(statement.body);
            } else if (statement.type === "TryStatement") {
                add(statement.parameter);
                visit(statement.block);
                visit(statement.handler);
            }
        }
        add(functionName);
        visit(body);
        return result;
    }

    root.GuestVMCompiler = Compiler;
    if (typeof module !== "undefined" && module.exports) module.exports = Compiler;
}(this));
