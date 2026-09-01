(function (root) {
    var op = root.GuestVMBytecode;
    if (typeof module !== "undefined" && module.exports) {
        op = require("./bytecode.js");
    }

    function Compiler(scopeBindings, outerScopes, registerBindings) {
        this.code = [];
        this.constants = [];
        this.registerCount = 0;
        this.breakTargets = [];
        this.continueTargets = [];
        this.constantRegisters = [];
        this.registerHints = [];
        this.sourceLocations = [];
        this.currentLocation = null;
        this.filename = "<source>";
        this.scopes = [];
        if (scopeBindings) {
            this.scopes.push(makeCompileScope(this, scopeBindings,
                                              !!registerBindings));
        }
        var scopeIndex = 0;
        while (outerScopes && scopeIndex < outerScopes.length) {
            this.scopes.push(outerScopes[scopeIndex++]);
        }
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
        if (this.currentLocation) this.sourceLocations[position] = this.currentLocation;
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
        this.filename = program.filename || this.filename;
        var globalDeclarations = [];
        if (this.scopes.length === 0) {
            collectVariableDeclarations(program.body, globalDeclarations);
        }
        var declarations = [];
        collectFunctionDeclarations(program.body, declarations);
        var declarationIndex = 0;
        while (declarationIndex < declarations.length) {
            var declaration = declarations[declarationIndex++];
            this.currentLocation = declaration.location || program.location;
            var declaredFunction = this.allocate();
            var declarationProgram = this.compileFunction(declaration);
            var declarationConstant = this.constant(declarationProgram);
            declaration.guestProgramConstant = declarationConstant;
            this.emit(op.MAKE_FUNCTION, declaredFunction,
                      declarationConstant);
            this.storeReference(this.referenceForName(declaration.name), declaredFunction);
        }
        var index = 0;
        while (index < program.body.length) {
            this.compileStatement(program.body[index]);
            index++;
        }
        var undefinedRegister = this.emitConstant(undefined);
        this.emit(op.RETURN, undefinedRegister);
        return {code: this.code, constants: this.constants,
                constantRegisters: this.constantRegisters,
                registerHints: this.registerHints,
                registerCount: this.registerCount, parameters: [], locals: [],
                filename: this.filename,
                location: program.location || {filename: this.filename,
                                                line: 1, column: 1},
                sourceLocations: this.sourceLocations,
                globalDeclarations: globalDeclarations};
    };

    Compiler.prototype.compileFunction = function (expression) {
        var locals = collectLocals(expression.body, expression.name);
        var bindings = makeFunctionBindings(expression.parameters, locals);
        var useRegisters = canUseRegisterBindings(expression.body);
        var nested = new Compiler(bindings, this.scopes, useRegisters);
        var bodyProgram = {body: expression.body.body,
                           filename: expression.location ?
                               expression.location.filename : this.filename,
                           location: expression.location || null};
        var program = nested.compile(bodyProgram);
        program.parameters = expression.parameters.slice(0);
        program.locals = locals;
        program.bindings = bindings;
        program.bindingSlots = makeBindingMap(bindings);
        program.bindingRegisters = useRegisters ?
            bindingRegisters(bindings, nested.scopes[0]) : null;
        program.parameterSlots = bindingSlots(expression.parameters,
                                               program.bindingSlots);
        program.argumentsSlot = program.bindingSlots.$arguments;
        program.thisSlot = program.bindingSlots.$this;
        program.functionNameSlot = expression.name ?
            program.bindingSlots["$" + expression.name] : -1;
        program.usesArguments = referencesArguments(expression.body);
        program.name = expression.name || "";
        program.source = expression.source || null;
        program.astBody = expression.body;
        program.returnKind = inferReturnKind(expression.body);
        program.nonlocalBindings = describeNonlocalBindings(expression.body, nested);
        return program;
    };

    Compiler.prototype.emitConstant = function (value) {
        var constant = this.constant(value);
        var target = this.constantRegisters[constant];
        if (target === undefined) {
            target = this.allocate();
            this.constantRegisters[constant] = target;
        }
        return target;
    };

    Compiler.prototype.compileStatement = function (statement) {
        if (statement.location) this.currentLocation = statement.location;
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
                /* Declaration instantiation has already created the binding.
                 * A var declaration without an initializer performs no
                 * assignment and must not erase an earlier value. */
                if (!declaration.initial) {
                    index++;
                    continue;
                }
                var declarationReference = this.referenceForName(declaration.name);
                var value;
                if (declarationReference.kind === "register" &&
                    this.compileExpressionInto(
                        declaration.initial, declarationReference.register)) {
                    value = declarationReference.register;
                } else {
                    value = this.compileExpression(declaration.initial);
                    this.storeReference(declarationReference, value);
                }
                index++;
            }
            return;
        }
        if (statement.type === "FunctionDeclaration") {
            /* Function declarations are instantiated at scope entry. */
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
            this.continueTargets.push(whileStart);
            this.compileStatement(statement.body);
            this.continueTargets.pop();
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
            var forContinues = [];
            this.breakTargets.push(forBreaks);
            this.continueTargets.push(forContinues);
            this.compileStatement(statement.body);
            this.continueTargets.pop();
            this.breakTargets.pop();
            patchBreaks(this, forContinues, this.code.length);
            if (statement.update) this.compileExpression(statement.update);
            this.emit(op.JUMP, forStart);
            if (forEnd >= 0) this.patch(forEnd + 2, this.code.length);
            patchBreaks(this, forBreaks, this.code.length);
            return;
        }
        if (statement.type === "DoWhileStatement") {
            var doStart = this.code.length;
            var doBreaks = [];
            var doContinues = [];
            this.breakTargets.push(doBreaks);
            this.continueTargets.push(doContinues);
            this.compileStatement(statement.body);
            this.continueTargets.pop();
            this.breakTargets.pop();
            patchBreaks(this, doContinues, this.code.length);
            condition = this.compileExpression(statement.test);
            var doEnd = this.emit(op.JUMP_IF_FALSE, condition, 0);
            this.emit(op.JUMP, doStart);
            this.patch(doEnd + 2, this.code.length);
            patchBreaks(this, doBreaks, this.code.length);
            return;
        }
        if (statement.type === "ForInStatement") {
            var forInReference;
            if (statement.left.type === "VariableStatement") {
                if (statement.left.declarations.length !== 1) {
                    throw new SyntaxError("for-in requires one variable");
                }
                forInReference = this.referenceForName(
                    statement.left.declarations[0].name);
            } else {
                forInReference = this.compileReference(statement.left);
            }
            var forInObject = this.compileExpression(statement.right);
            var forInKeys = this.allocate();
            this.emit(op.GET_KEYS, forInKeys, forInObject);
            var forInIndex = this.allocate();
            this.emit(op.MOVE, forInIndex, this.emitConstant(0));
            var forInStart = this.code.length;
            var lengthKey = this.emitConstant("length");
            var forInLength = this.allocate();
            this.emit(op.GET_PROPERTY, forInLength, forInKeys, lengthKey);
            var forInCondition = this.allocate();
            this.emit(op.LESS, forInCondition, forInIndex, forInLength);
            var forInEnd = this.emit(op.JUMP_IF_FALSE, forInCondition, 0);
            var forInKey = this.allocate();
            this.emit(op.GET_PROPERTY, forInKey, forInKeys, forInIndex);
            this.storeReference(forInReference, forInKey);
            var forInBreaks = [];
            var forInContinues = [];
            this.breakTargets.push(forInBreaks);
            this.continueTargets.push(forInContinues);
            this.compileStatement(statement.body);
            this.continueTargets.pop();
            this.breakTargets.pop();
            patchBreaks(this, forInContinues, this.code.length);
            var oneForIn = this.emitConstant(1);
            this.emit(op.ADD, forInIndex, forInIndex, oneForIn);
            this.emit(op.JUMP, forInStart);
            this.patch(forInEnd + 2, this.code.length);
            patchBreaks(this, forInBreaks, this.code.length);
            return;
        }
        if (statement.type === "BreakStatement") {
            if (!this.breakTargets.length) throw new SyntaxError("break outside loop");
            this.breakTargets[this.breakTargets.length - 1].push(this.emit(op.JUMP, 0));
            return;
        }
        if (statement.type === "ContinueStatement") {
            if (!this.continueTargets.length) throw new SyntaxError("continue outside loop");
            var continueTarget = this.continueTargets[this.continueTargets.length - 1];
            if (typeof continueTarget === "number") this.emit(op.JUMP, continueTarget);
            else continueTarget.push(this.emit(op.JUMP, 0));
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

    Compiler.prototype.compileReference = function (expression, future) {
        if (expression.type === "Identifier") {
            return this.referenceForName(expression.name);
        }
        if (expression.type === "MemberExpression") {
            var objectFuture = expression.computed ?
                [expression.property, future] : future;
            var object = this.compileExpression(expression.object, objectFuture);
            if (!expression.computed && expression.property.type === "Literal") {
                return {kind: "constantProperty", object: object,
                        key: this.constant(expression.property.value)};
            }
            return {kind: "property",
                    object: object,
                    key: this.compileExpression(expression.property, future)};
        }
        throw new SyntaxError("invalid assignment target");
    };

    Compiler.prototype.referenceForName = function (name) {
        var binding = this.resolveBinding(name);
        if (binding) {
            if (binding.kind === "register") return binding;
            return {kind: "local", depth: binding.depth, slot: binding.slot};
        }
        return {kind: "global", name: this.constant(name)};
    };

    Compiler.prototype.resolveBinding = function (name) {
        var key = "$" + name;
        var depth = 0;
        var scopeIndex = 0;
        while (scopeIndex < this.scopes.length) {
            var scope = this.scopes[scopeIndex];
            var binding = scope.bindings[key];
            if (binding !== undefined) {
                if (binding.kind === "register") return binding;
                return {kind: "environment", depth: depth, slot: binding.slot};
            }
            if (scope.createsEnvironment) depth++;
            scopeIndex++;
        }
        return null;
    };

    Compiler.prototype.loadReference = function (reference, requestedTarget) {
        var target = requestedTarget === undefined ?
            this.allocate() : requestedTarget;
        if (reference.kind === "global") {
            this.emit(op.GET_GLOBAL, target, reference.name);
            this.registerHints[target] = "global:" + this.constants[reference.name];
        } else if (reference.kind === "local") {
            this.emit(op.GET_LOCAL, target, reference.depth, reference.slot);
        } else if (reference.kind === "register") {
            this.emit(op.MOVE, target, reference.register);
        } else if (reference.kind === "constantProperty") {
            this.emit(op.GET_PROPERTY_CONST, target, reference.object, reference.key);
            var objectHint = this.registerHints[reference.object];
            var propertyName = this.constants[reference.key];
            this.registerHints[target] = objectHint === "global:Math" ?
                "math:" + propertyName : "property:" + propertyName;
        } else {
            this.emit(op.GET_PROPERTY, target, reference.object, reference.key);
        }
        return target;
    };

    Compiler.prototype.storeReference = function (reference, value) {
        if (reference.kind === "global") {
            this.emit(op.SET_GLOBAL, reference.name, value);
        } else if (reference.kind === "local") {
            this.emit(op.SET_LOCAL, reference.depth, reference.slot, value);
        } else if (reference.kind === "register") {
            if (reference.register !== value) this.emit(op.MOVE, reference.register, value);
        } else if (reference.kind === "constantProperty") {
            this.emit(op.SET_PROPERTY_CONST, reference.object, reference.key, value);
        } else {
            this.emit(op.SET_PROPERTY, reference.object, reference.key, value);
        }
    };

    /* Compile the common expression forms directly into an existing lexical
     * register. Operands are still fully evaluated before the destination is
     * written, so assignment evaluation order and self-references retain their
     * ECMAScript meaning. Returning false asks the ordinary expression path to
     * produce a value followed by a MOVE. */
    Compiler.prototype.compileExpressionInto = function (expression, target) {
        if (expression.type === "BinaryExpression" &&
            expression.operator !== "&&" && expression.operator !== "||") {
            var left = this.compileExpression(expression.left, expression.right);
            var right = this.compileExpression(expression.right);
            this.emitBinary(expression.operator, target, left, right);
            return true;
        }
        if (expression.type === "UnaryExpression" &&
            expression.operator !== "delete" && expression.operator !== "void") {
            var argument;
            if (expression.operator === "typeof" &&
                expression.argument.type === "Identifier") {
                var typeofReference = this.referenceForName(
                    expression.argument.name);
                if (typeofReference.kind === "global") {
                    this.emit(op.TYPEOF_GLOBAL, target, typeofReference.name);
                    return true;
                }
            }
            argument = this.compileExpression(expression.argument);
            if (expression.operator === "!") this.emit(op.NOT, target, argument);
            else if (expression.operator === "-") this.emit(op.NEGATE, target, argument);
            else if (expression.operator === "+") this.emit(op.POSITIVE, target, argument);
            else if (expression.operator === "~") this.emit(op.BIT_NOT, target, argument);
            else if (expression.operator === "typeof") {
                this.emit(op.TYPEOF, target, argument);
            } else return false;
            return true;
        }
        if (expression.type === "MemberExpression") {
            this.loadReference(this.compileReference(expression, null), target);
            return true;
        }
        return false;
    };

    Compiler.prototype.compileExpression = function (expression, future) {
        if (expression.type === "Literal") return this.emitConstant(expression.value);
        if (expression.type === "FunctionExpression") {
            var functionRegister = this.allocate();
            var functionProgram = this.compileFunction(expression);
            var functionConstant = this.constant(functionProgram);
            expression.guestProgramConstant = functionConstant;
            this.emit(op.MAKE_FUNCTION, functionRegister,
                      functionConstant);
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
                this.emit(op.SET_PROPERTY, objectRegister, propertyKey,
                          propertyValue);
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
            var identifierReference = this.referenceForName(expression.name);
            if (identifierReference.kind === "register" &&
                !this.expressionWritesRegister(future,
                                               identifierReference.register)) {
                return identifierReference.register;
            }
            return this.loadReference(identifierReference);
        }
        if (expression.type === "ThisExpression") {
            return this.loadReference(this.referenceForName("this"));
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
            var left = this.compileExpression(expression.left, expression.right);
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
            if (expression.operator === "delete") {
                if (expression.argument.type !== "MemberExpression") {
                    return this.emitConstant(true);
                }
                var deleteReference = this.compileReference(expression.argument, null);
                var deleteResult = this.allocate();
                if (deleteReference.kind === "constantProperty") {
                    this.emit(op.DELETE_PROPERTY_CONST, deleteResult,
                              deleteReference.object, deleteReference.key);
                } else {
                    this.emit(op.DELETE_PROPERTY, deleteResult,
                              deleteReference.object, deleteReference.key);
                }
                return deleteResult;
            }
            var unary = this.allocate();
            if (expression.operator === "typeof" &&
                expression.argument.type === "Identifier") {
                var typeofReference = this.referenceForName(
                    expression.argument.name);
                if (typeofReference.kind === "global") {
                    this.emit(op.TYPEOF_GLOBAL, unary, typeofReference.name);
                    return unary;
                }
            }
            var argument = this.compileExpression(expression.argument);
            if (expression.operator === "!") this.emit(op.NOT, unary, argument);
            else if (expression.operator === "-") this.emit(op.NEGATE, unary, argument);
            else if (expression.operator === "+") this.emit(op.POSITIVE, unary, argument);
            else if (expression.operator === "~") this.emit(op.BIT_NOT, unary, argument);
            else if (expression.operator === "typeof") this.emit(op.TYPEOF, unary, argument);
            else if (expression.operator === "void") {
                return this.emitConstant(undefined);
            } else throw new Error("unsupported unary operator: " + expression.operator);
            return unary;
        }
        if (expression.type === "MemberExpression") {
            return this.loadReference(this.compileReference(expression, future));
        }
        if (expression.type === "AssignmentExpression") {
            var reference = this.compileReference(expression.left, expression.right);
            var assigned;
            if (expression.operator === "=") {
                if (reference.kind === "register" &&
                    this.compileExpressionInto(expression.right,
                                               reference.register)) {
                    assigned = reference.register;
                } else assigned = this.compileExpression(expression.right);
            } else {
                var current = this.loadReference(reference);
                var assignmentRight = this.compileExpression(expression.right);
                assigned = reference.kind === "register" ?
                    reference.register : this.allocate();
                this.emitBinary(expression.operator.charAt(0), assigned,
                                current, assignmentRight);
            }
            this.storeReference(reference, assigned);
            if (this.expressionWritesRegister(future, assigned)) {
                var stableAssignment = this.allocate();
                this.emit(op.MOVE, stableAssignment, assigned);
                return stableAssignment;
            }
            return assigned;
        }
        if (expression.type === "UpdateExpression") {
            reference = this.compileReference(expression.argument, null);
            current = this.loadReference(reference);
            var one = this.emitConstant(1);
            var updated = reference.kind === "register" ?
                reference.register : this.allocate();
            this.emit(expression.operator === "++" ? op.ADD : op.SUBTRACT,
                      updated, current, one);
            this.storeReference(reference, updated);
            var updateResult = expression.prefix ? updated : current;
            if (this.expressionWritesRegister(future, updateResult)) {
                var stableUpdate = this.allocate();
                this.emit(op.MOVE, stableUpdate, updateResult);
                return stableUpdate;
            }
            return updateResult;
        }
        if (expression.type === "CallExpression") {
            var callee;
            var receiver = -1;
            if (expression.callee.type === "MemberExpression") {
                var callReference = this.compileReference(expression.callee,
                                                          expression.arguments);
                callee = this.loadReference(callReference);
                receiver = callReference.object;
            } else {
                callee = this.compileExpression(expression.callee,
                                                expression.arguments);
            }
            var values = [];
            var index = 0;
            while (index < expression.arguments.length) {
                values.push(this.compileExpression(expression.arguments[index],
                    expression.arguments.slice(index + 1)));
                index++;
            }
            var callResult = this.allocate();
            this.emit(op.CALL, callResult, callee, receiver,
                      this.constant(values));
            return callResult;
        }
        if (expression.type === "NewExpression") {
            var constructor = this.compileExpression(expression.callee,
                                                     expression.arguments);
            var constructorValues = [];
            var constructorIndex = 0;
            while (constructorIndex < expression.arguments.length) {
                constructorValues.push(this.compileExpression(
                    expression.arguments[constructorIndex],
                    expression.arguments.slice(constructorIndex + 1)));
                constructorIndex++;
            }
            var constructed = this.allocate();
            this.emit(op.CONSTRUCT, constructed, constructor,
                      this.constant(constructorValues));
            return constructed;
        }
        if (expression.type === "SequenceExpression") {
            this.compileExpression(expression.left);
            return this.compileExpression(expression.right);
        }
        throw new Error("unsupported expression: " + expression.type);
    };

    Compiler.prototype.expressionWritesRegister = function (node, register) {
        if (!node || typeof node !== "object") return false;
        if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
            return false;
        }
        if ((node.type === "AssignmentExpression" ||
             node.type === "UpdateExpression") &&
            node.left && node.left.type === "Identifier") {
            var assigned = this.resolveBinding(node.left.name);
            if (assigned && assigned.kind === "register" &&
                assigned.register === register) return true;
        }
        if (node.type === "UpdateExpression" && node.argument &&
            node.argument.type === "Identifier") {
            var updated = this.resolveBinding(node.argument.name);
            if (updated && updated.kind === "register" &&
                updated.register === register) return true;
        }
        if (typeof node.length === "number" && node.type === undefined) {
            var arrayIndex = 0;
            while (arrayIndex < node.length) {
                if (this.expressionWritesRegister(node[arrayIndex++], register)) return true;
            }
            return false;
        }
        var key;
        for (key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key) && key !== "type" &&
                this.expressionWritesRegister(node[key], register)) return true;
        }
        return false;
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
            } else if (statement.type === "WhileStatement" || statement.type === "ForStatement" ||
                       statement.type === "DoWhileStatement" ||
                       statement.type === "ForInStatement") {
                if (statement.initial && statement.initial.type === "VariableStatement") visit(statement.initial);
                if (statement.left && statement.left.type === "VariableStatement") visit(statement.left);
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

    function makeFunctionBindings(parameters, locals) {
        var result = [];
        var seen = {};
        function add(name) {
            var key = "$" + name;
            if (!seen[key]) {
                seen[key] = true;
                result.push(name);
            }
        }
        var index = 0;
        while (index < parameters.length) add(parameters[index++]);
        index = 0;
        while (index < locals.length) add(locals[index++]);
        add("arguments");
        add("this");
        return result;
    }

    function makeBindingMap(bindings) {
        var result = {};
        var index = 0;
        while (index < bindings.length) {
            result["$" + bindings[index]] = index;
            index++;
        }
        return result;
    }

    function makeCompileScope(compiler, bindings, useRegisters) {
        var map = {};
        var index = 0;
        while (index < bindings.length) {
            map["$" + bindings[index]] = useRegisters ?
                {kind: "register", register: compiler.allocate(), slot: index} :
                {kind: "environment", slot: index};
            index++;
        }
        return {bindings: map, createsEnvironment: !useRegisters};
    }

    function bindingRegisters(bindings, scope) {
        var result = [];
        var index = 0;
        while (index < bindings.length) {
            result[index] = scope.bindings["$" + bindings[index]].register;
            index++;
        }
        return result;
    }

    function canUseRegisterBindings(body) {
        return !containsNestedFunctionOrTry(body);
    }

    function containsNestedFunctionOrTry(node) {
        if (!node || typeof node !== "object") return false;
        if (node.type === "FunctionDeclaration" ||
            node.type === "FunctionExpression" || node.type === "TryStatement") {
            return true;
        }
        if (typeof node.length === "number" && node.type === undefined) {
            var arrayIndex = 0;
            while (arrayIndex < node.length) {
                if (containsNestedFunctionOrTry(node[arrayIndex++])) return true;
            }
            return false;
        }
        var key;
        for (key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key) && key !== "type" &&
                containsNestedFunctionOrTry(node[key])) return true;
        }
        return false;
    }

    function referencesArguments(node) {
        if (!node || typeof node !== "object") return false;
        if (node.type === "Identifier" && node.name === "arguments") return true;
        if (node.type === "FunctionDeclaration" ||
            node.type === "FunctionExpression") return false;
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                var value = node[key];
                if (value && typeof value === "object") {
                    if (typeof value.length === "number") {
                        var index = 0;
                        while (index < value.length) {
                            if (referencesArguments(value[index++])) return true;
                        }
                    } else if (referencesArguments(value)) return true;
                }
            }
        }
        return false;
    }

    function bindingSlots(names, map) {
        var result = [];
        var index = 0;
        while (index < names.length) {
            result[index] = map["$" + names[index]];
            index++;
        }
        return result;
    }

    function describeNonlocalBindings(body, compiler) {
        var result = {};
        function visit(node) {
            if (!node || typeof node !== "object") return;
            if (node.type === "FunctionExpression" ||
                node.type === "FunctionDeclaration") return;
            if (node.type === "Identifier") {
                var key = "$" + node.name;
                if (result[key] === undefined) {
                    var binding = compiler.resolveBinding(node.name);
                    if (!binding) result[key] = {kind: "global"};
                    else if (binding.kind === "environment") {
                        result[key] = {kind: "environment", depth: binding.depth,
                                       slot: binding.slot};
                    }
                }
                return;
            }
            var property;
            for (property in node) {
                if (property !== "loc" &&
                    Object.prototype.hasOwnProperty.call(node, property)) {
                    var value = node[property];
                    if (value && typeof value === "object") {
                        if (typeof value.length === "number") {
                            var index = 0;
                            while (index < value.length) visit(value[index++]);
                        } else visit(value);
                    }
                }
            }
        }
        visit(body);
        return result;
    }

    function inferReturnKind(body) {
        var kind = null;
        var invalid = false;
        function visit(node) {
            if (!node || typeof node !== "object" || invalid) return;
            if (node.type === "FunctionExpression" ||
                node.type === "FunctionDeclaration") return;
            if (node.type === "ReturnStatement" && node.argument) {
                var current = node.argument.type === "ObjectExpression" ? "properties" :
                              node.argument.type === "ArrayExpression" ? "array" : null;
                if (!current || (kind && kind !== current)) invalid = true;
                else kind = current;
                return;
            }
            var key;
            for (key in node) {
                if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                    var value = node[key];
                    if (value && typeof value === "object") {
                        if (typeof value.length === "number") {
                            var index = 0;
                            while (index < value.length) visit(value[index++]);
                        } else visit(value);
                    }
                }
            }
        }
        visit(body);
        return invalid ? null : kind;
    }

    function collectFunctionDeclarations(statements, result) {
        var index = 0;
        while (index < statements.length) {
            var statement = statements[index++];
            if (statement.type === "FunctionDeclaration") {
                result.push(statement);
            } else if (statement.type === "BlockStatement") {
                collectFunctionDeclarations(statement.body, result);
            } else if (statement.type === "IfStatement") {
                collectFunctionDeclarations([statement.consequent], result);
                if (statement.alternate) {
                    collectFunctionDeclarations([statement.alternate], result);
                }
            } else if (statement.type === "WhileStatement" ||
                       statement.type === "DoWhileStatement" ||
                       statement.type === "ForStatement" ||
                       statement.type === "ForInStatement") {
                collectFunctionDeclarations([statement.body], result);
            } else if (statement.type === "TryStatement") {
                collectFunctionDeclarations(statement.block.body, result);
                collectFunctionDeclarations(statement.handler.body, result);
            }
        }
    }

    function collectVariableDeclarations(statements, result) {
        var seen = {};
        function add(name) {
            var key = "$" + name;
            if (!seen[key]) {
                seen[key] = true;
                result.push(name);
            }
        }
        function visit(statement) {
            var index;
            if (!statement) return;
            if (statement.type === "VariableStatement") {
                index = 0;
                while (index < statement.declarations.length) {
                    add(statement.declarations[index++].name);
                }
            } else if (statement.type === "BlockStatement") {
                index = 0;
                while (index < statement.body.length) {
                    visit(statement.body[index++]);
                }
            } else if (statement.type === "IfStatement") {
                visit(statement.consequent);
                visit(statement.alternate);
            } else if (statement.type === "WhileStatement" ||
                       statement.type === "DoWhileStatement") {
                visit(statement.body);
            } else if (statement.type === "ForStatement") {
                visit(statement.initial);
                visit(statement.body);
            } else if (statement.type === "ForInStatement") {
                visit(statement.left);
                visit(statement.body);
            } else if (statement.type === "TryStatement") {
                visit(statement.block);
                visit(statement.handler);
            }
            /* Function bodies have their own variable environment. */
        }
        var statementIndex = 0;
        while (statementIndex < statements.length) {
            visit(statements[statementIndex++]);
        }
    }

    root.GuestVMCompiler = Compiler;
    if (typeof module !== "undefined" && module.exports) module.exports = Compiler;
}(this));
