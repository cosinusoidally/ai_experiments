/* Shared kernel front/middle end. It parses a deliberately small, statically
 * validated integer-function dialect and produces host-independent typed IR. */
(function (root) {
    var Parser = root.GuestVMParser;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("../parser.js");
    }

    function KernelCompiler() {}

    var READ_FIELD_ACCESSORS = {
        recordType: "RECORD_TYPE",
        arrayElements: "ARRAY_ELEMENTS",
        vectorLength: "VECTOR_LENGTH",
        vectorCapacity: "VECTOR_CAPACITY",
        objectPropertyHead: "OBJECT_PROPERTY_HEAD",
        regexpPropertyHead: "REGEXP_PROPERTY_HEAD",
        bufferViewPropertyHead: "BUFFER_VIEW_PROPERTY_HEAD",
        propertyNext: "PROPERTY_NEXT",
        propertyKey: "PROPERTY_KEY",
        engineHeapBump: "ENGINE_HEAP_BUMP",
        engineHeapLimit: "ENGINE_HEAP_LIMIT"
    };

    var WRITE_FIELD_ACCESSORS = {
        setVectorLength: "VECTOR_LENGTH",
        setRecordType: "RECORD_TYPE",
        setRecordSize: "RECORD_SIZE",
        setRecordMark: "RECORD_MARK",
        setRecordFlags: "RECORD_FLAGS",
        setArrayPrototype: "ARRAY_PROTOTYPE",
        setArrayPropertyHead: "ARRAY_PROPERTY_HEAD",
        setArrayElements: "ARRAY_ELEMENTS",
        setArrayReserved: "ARRAY_RESERVED",
        setObjectPropertyHead: "OBJECT_PROPERTY_HEAD",
        setRegexpPropertyHead: "REGEXP_PROPERTY_HEAD",
        setBufferViewPropertyHead: "BUFFER_VIEW_PROPERTY_HEAD",
        setPropertyNext: "PROPERTY_NEXT",
        setPropertyKey: "PROPERTY_KEY",
        setPropertyAttributes: "PROPERTY_ATTRIBUTES",
        setPropertyReserved: "PROPERTY_RESERVED",
        setVectorCapacity: "VECTOR_CAPACITY",
        setEngineHeapBump: "ENGINE_HEAP_BUMP"
    };

    KernelCompiler.prototype.compile = function (functionObject) {
        if (typeof functionObject !== "function") {
            throw new TypeError("kernel compiler requires a function");
        }
        var source = functionObject.toString();
        var parser = new Parser("var __kernel = " + source + ";", "<kernel>");
        var program = parser.parseProgram();
        var declaration = program.body[0];
        var fn = declaration && declaration.declarations &&
                 declaration.declarations[0].initial;
        if (!fn || fn.type !== "FunctionExpression") {
            throw new SyntaxError("kernel source must contain one function");
        }
        if (needsControlFlow(fn.body.body)) {
            return compileControlFlow(fn, source);
        }
        var locals = {};
        var parameterIndex = 0;
        while (parameterIndex < fn.parameters.length) {
            locals["$" + fn.parameters[parameterIndex]] = parameterIndex;
            parameterIndex++;
        }
        var instructions = [];
        var resultExpression = null;
        var statementIndex = 0;
        while (statementIndex < fn.body.body.length) {
            var statement = fn.body.body[statementIndex++];
            if (statement.type === "ExpressionStatement" &&
                statement.expression.type === "CallExpression" &&
                statement.expression.callee.type === "Identifier" &&
                statement.expression.callee.name === "store32" &&
                statement.expression.arguments.length === 2) {
                instructions.push({op: "store_u32",
                    address: lower(statement.expression.arguments[0], locals),
                    value: lower(statement.expression.arguments[1], locals)});
            } else if (statement.type === "ExpressionStatement" &&
                statement.expression.type === "CallExpression" &&
                statement.expression.callee.type === "Identifier" &&
                statement.expression.callee.name === "storeF64" &&
                statement.expression.arguments.length === 2) {
                instructions.push({op: "store_f64",
                    address: lower(statement.expression.arguments[0], locals),
                    value: lowerF64(statement.expression.arguments[1], locals)});
            } else if (statement.type === "ReturnStatement" && statement.argument &&
                       statementIndex === fn.body.body.length) {
                resultExpression = lower(statement.argument, locals);
            } else throw new SyntaxError("unsupported kernel statement " + statement.type);
        }
        if (!resultExpression) throw new SyntaxError("kernel function must return a value");
        return {name: fn.name || "kernel", parameters: fn.parameters.slice(0),
                resultType: "i32", instructions: instructions,
                expression: resultExpression,
                source: source};
    };

    function needsControlFlow(statements) {
        var index = 0;
        while (index < statements.length) {
            var statement = statements[index++];
            if (statement.type === "VariableStatement" ||
                statement.type === "IfStatement" ||
                statement.type === "WhileStatement" ||
                statement.type === "BlockStatement") return true;
            if (statement.type === "ExpressionStatement" &&
                statement.expression.type === "AssignmentExpression") return true;
        }
        return false;
    }

    function compileControlFlow(fn, source) {
        var symbols = {};
        var parameterIndex = 0;
        while (parameterIndex < fn.parameters.length) {
            symbols["$" + fn.parameters[parameterIndex]] =
                {kind: "argument", index: parameterIndex};
            parameterIndex++;
        }
        var localNames = [];
        collectLocals(fn.body, symbols, localNames);
        var body = lowerStatements(fn.body.body, symbols);
        return {name: fn.name || "kernel", parameters: fn.parameters.slice(0),
                locals: localNames, resultType: "i32", body: body,
                controlFlow: true, source: source};
    }

    function collectLocals(node, symbols, names) {
        if (!node || typeof node !== "object") return;
        if (node.type === "VariableStatement") {
            var declarationIndex = 0;
            while (declarationIndex < node.declarations.length) {
                var declaration = node.declarations[declarationIndex++];
                var name = declaration.name;
                if (symbols["$" + name] === undefined) {
                    if (isKernelConstantDeclaration(declaration)) {
                        symbols["$" + name] = {
                            kind: "constant",
                            value: kernelConstantValue(declaration.initial)
                        };
                    } else {
                        symbols["$" + name] = {kind: "local", index: names.length};
                        names.push(name);
                    }
                }
            }
        }
        var key;
        for (key in node) {
            if (key !== "loc" && Object.prototype.hasOwnProperty.call(node, key)) {
                var value = node[key];
                if (value && typeof value === "object") {
                    if (typeof value.length === "number") {
                        var index = 0;
                        while (index < value.length) collectLocals(value[index++], symbols, names);
                    } else collectLocals(value, symbols, names);
                }
            }
        }
    }

    function isKernelConstantDeclaration(declaration) {
        return /^[A-Z][A-Z0-9_]*$/.test(declaration.name) &&
               kernelConstantValue(declaration.initial) !== null;
    }

    function kernelConstantValue(expression) {
        if (expression && expression.type === "Literal" &&
            typeof expression.value === "number" &&
            expression.value === (expression.value | 0)) {
            return expression.value | 0;
        }
        if (expression && expression.type === "UnaryExpression" &&
            expression.operator === "-" && expression.argument &&
            expression.argument.type === "Literal" &&
            typeof expression.argument.value === "number" &&
            -expression.argument.value === (-expression.argument.value | 0)) {
            return -expression.argument.value | 0;
        }
        return null;
    }

    function lowerStatements(statements, symbols) {
        var body = [];
        var index = 0;
        while (index < statements.length) {
            var lowered = lowerStatement(statements[index++], symbols);
            if (lowered.op === "block") {
                var child = 0;
                while (child < lowered.body.length) body.push(lowered.body[child++]);
            } else body.push(lowered);
        }
        return body;
    }

    function lowerStatement(statement, symbols) {
        if (statement.type === "BlockStatement") {
            return {op: "block", body: lowerStatements(statement.body, symbols)};
        }
        if (statement.type === "VariableStatement") {
            var declarations = [];
            var index = 0;
            while (index < statement.declarations.length) {
                var declaration = statement.declarations[index++];
                if (declaration.initial) {
                    var declarationSymbol = symbols["$" + declaration.name];
                    if (!declarationSymbol) {
                        throw new SyntaxError("unknown kernel declaration " +
                                              declaration.name);
                    }
                    if (declarationSymbol.kind !== "constant") {
                        declarations.push({op: "set_local",
                            index: requireLocal(symbols, declaration.name).index,
                            value: lowerKernelExpression(
                                declaration.initial, symbols)});
                    }
                }
            }
            return {op: "block", body: declarations};
        }
        if (statement.type === "ExpressionStatement") {
            var expression = statement.expression;
            if (expression.type === "AssignmentExpression" &&
                expression.operator === "=" &&
                expression.left.type === "Identifier") {
                var target = symbols["$" + expression.left.name];
                if (!target) throw new SyntaxError("unknown kernel assignment " +
                                                   expression.left.name);
                if (target.kind === "constant") {
                    throw new SyntaxError("kernel constant cannot be assigned: " +
                                          expression.left.name);
                }
                return {op: target.kind === "local" ? "set_local" : "set_argument",
                        index: target.index,
                        value: lowerKernelExpression(expression.right, symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                WRITE_FIELD_ACCESSORS[expression.callee.name] &&
                expression.arguments.length === 3) {
                return {op: "store_u32",
                    address: namedFieldAddress(expression.callee.name,
                        expression.arguments, symbols, WRITE_FIELD_ACCESSORS),
                    value: lowerKernelExpression(expression.arguments[2], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "store32" &&
                expression.arguments.length === 2) {
                return {op: "store_u32",
                    address: lowerKernelExpression(expression.arguments[0], symbols),
                    value: lowerKernelExpression(expression.arguments[1], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                expression.callee.name === "storeF64" &&
                expression.arguments.length === 2) {
                return {op: "store_f64",
                    address: lowerKernelExpression(expression.arguments[0], symbols),
                    value: lowerKernelF64Expression(expression.arguments[1], symbols)};
            }
            if (expression.type === "CallExpression" &&
                expression.callee.type === "Identifier" &&
                (expression.callee.name === "storeRaw8" ||
                 expression.callee.name === "storeRaw32") &&
                expression.arguments.length === 2) {
                return {op: expression.callee.name === "storeRaw8" ?
                            "store_raw_u8" : "store_raw_u32",
                    address: lowerKernelExpression(
                        expression.arguments[0], symbols),
                    value: lowerKernelExpression(
                        expression.arguments[1], symbols)};
            }
            throw new SyntaxError("unsupported kernel expression statement");
        }
        if (statement.type === "IfStatement") {
            return {op: "if", test: lowerKernelExpression(statement.test, symbols),
                    consequent: lowerStatement(statement.consequent, symbols),
                    alternate: statement.alternate ?
                        lowerStatement(statement.alternate, symbols) :
                        {op: "block", body: []}};
        }
        if (statement.type === "WhileStatement") {
            return {op: "while", test: lowerKernelExpression(statement.test, symbols),
                    body: lowerStatement(statement.body, symbols)};
        }
        if (statement.type === "ReturnStatement" && statement.argument) {
            return {op: "return",
                    value: lowerKernelExpression(statement.argument, symbols)};
        }
        throw new SyntaxError("unsupported control-flow kernel statement " +
                              statement.type);
    }

    function requireLocal(symbols, name) {
        var symbol = symbols["$" + name];
        if (!symbol || symbol.kind !== "local") {
            throw new SyntaxError("kernel local is not declared: " + name);
        }
        return symbol;
    }

    function lowerKernelExpression(node, symbols) {
        if (node.type === "Literal" && typeof node.value === "number" &&
            node.value === (node.value | 0)) {
            return {op: "const_i32", value: node.value | 0, type: "i32"};
        }
        if (node.type === "Identifier") {
            var symbol = symbols["$" + node.name];
            if (!symbol) throw new SyntaxError("unknown kernel identifier " + node.name);
            if (symbol.kind === "constant") {
                return {op: "const_i32", value: symbol.value, type: "i32"};
            }
            return {op: symbol.kind === "local" ? "local_i32" : "arg_i32",
                    index: symbol.index, type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            READ_FIELD_ACCESSORS[node.callee.name] &&
            node.arguments.length === 2) {
            return {op: "load_u32",
                    address: namedFieldAddress(node.callee.name,
                        node.arguments, symbols, READ_FIELD_ACCESSORS),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "load32" && node.arguments.length === 1) {
            return {op: "load_u32",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier" &&
            (node.callee.name === "loadRaw8" ||
             node.callee.name === "loadRaw32") && node.arguments.length === 1) {
            return {op: node.callee.name === "loadRaw8" ?
                        "load_raw_u8" : "load_raw_u32",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "i32"};
        }
        if (node.type === "CallExpression" &&
            node.callee.type === "Identifier") {
            if (node.callee.name === "toInt32F64" &&
                node.arguments.length === 1) {
                return {op: "to_i32_f64",
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "i32"};
            }
            var comparisons = {equalF64: "eq_f64", lessF64: "lt_f64",
                lessEqualF64: "le_f64", greaterF64: "gt_f64",
                greaterEqualF64: "ge_f64"};
            var comparison = comparisons[node.callee.name];
            if (comparison && node.arguments.length === 2) {
                return {op: comparison,
                    left: lowerKernelF64Expression(node.arguments[0], symbols),
                    right: lowerKernelF64Expression(node.arguments[1], symbols),
                    type: "i32"};
            }
        }
        if (node.type === "UnaryExpression" &&
            (node.operator === "-" || node.operator === "~" ||
             node.operator === "+" || node.operator === "!")) {
            return {op: node.operator === "-" ? "neg_i32" :
                        node.operator === "~" ? "not_i32" :
                        node.operator === "!" ? "logical_not_i32" : "as_i32",
                    value: lowerKernelExpression(node.argument, symbols), type: "i32"};
        }
        if (node.type === "BinaryExpression") {
            var operations = {"+": "add_i32", "-": "sub_i32", "*": "mul_i32",
                "%": "rem_i32",
                "&": "and_i32", "|": "or_i32", "^": "xor_i32",
                "<<": "shl_i32", ">>": "shr_i32", ">>>": "ushr_i32",
                "===": "eq_i32", "!==": "ne_i32", "<": "lt_i32",
                "<=": "le_i32", ">": "gt_i32", ">=": "ge_i32"};
            var operation = operations[node.operator];
            if (!operation) throw new SyntaxError("unsupported kernel operator " +
                                                  node.operator);
            return {op: operation,
                    left: lowerKernelExpression(node.left, symbols),
                    right: lowerKernelExpression(node.right, symbols), type: "i32"};
        }
        throw new SyntaxError("unsupported control-flow kernel expression " + node.type);
    }

    function namedFieldAddress(name, argumentsList, symbols, accessors) {
        var fieldName = accessors[name];
        var field = symbols["$" + fieldName];
        if (!field || field.kind !== "constant") {
            throw new SyntaxError("kernel field accessor " + name +
                                  " requires " + fieldName);
        }
        return {op: "add_i32",
            left: {op: "add_i32",
                left: lowerKernelExpression(argumentsList[0], symbols),
                right: lowerKernelExpression(argumentsList[1], symbols),
                type: "i32"},
            right: {op: "const_i32", value: field.value, type: "i32"},
            type: "i32"};
    }

    function lowerKernelF64Expression(node, symbols) {
        if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
            throw new SyntaxError("kernel binary64 value must be an intrinsic call");
        }
        var name = node.callee.name;
        if ((name === "loadF64" || name === "loadI32F64") &&
            node.arguments.length === 1) {
            return {op: name === "loadF64" ? "load_f64" : "load_i32_f64",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    type: "f64"};
        }
        if (name === "loadNumberF64" && node.arguments.length === 2) {
            return {op: "load_number_f64",
                    address: lowerKernelExpression(node.arguments[0], symbols),
                    tag: lowerKernelExpression(node.arguments[1], symbols),
                    type: "f64"};
        }
        if (name === "sqrtF64" && node.arguments.length === 1) {
            return {op: "sqrt_f64",
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "f64"};
        }
        if (name === "absF64" && node.arguments.length === 1) {
            return {op: "abs_f64",
                    value: lowerKernelF64Expression(node.arguments[0], symbols),
                    type: "f64"};
        }
        var operations = {addF64: "add_f64", subtractF64: "sub_f64",
                          multiplyF64: "mul_f64", divideF64: "div_f64"};
        if (operations[name] && node.arguments.length === 2) {
            return {op: operations[name],
                    left: lowerKernelF64Expression(node.arguments[0], symbols),
                    right: lowerKernelF64Expression(node.arguments[1], symbols),
                    type: "f64"};
        }
        throw new SyntaxError("unsupported control-flow binary64 intrinsic " + name);
    }

    function lower(node, locals) {
        if (node.type === "Literal" && typeof node.value === "number" &&
            node.value === (node.value | 0)) {
            return {op: "const_i32", value: node.value | 0, type: "i32"};
        }
        if (node.type === "Identifier" && locals["$" + node.name] !== undefined) {
            return {op: "arg_i32", index: locals["$" + node.name], type: "i32"};
        }
        if (node.type === "UnaryExpression" &&
            (node.operator === "-" || node.operator === "~" ||
             node.operator === "+")) {
            return {op: node.operator === "-" ? "neg_i32" :
                        node.operator === "~" ? "not_i32" : "as_i32",
                    value: lower(node.argument, locals), type: "i32"};
        }
        if (node.type === "BinaryExpression") {
            var operations = {"+": "add_i32", "-": "sub_i32", "*": "mul_i32",
                "%": "rem_i32",
                              "&": "and_i32", "|": "or_i32", "^": "xor_i32",
                              "<<": "shl_i32", ">>": "shr_i32"};
            var operation = operations[node.operator];
            if (!operation) throw new SyntaxError("unsupported kernel operator " +
                                                  node.operator);
            return {op: operation, left: lower(node.left, locals),
                    right: lower(node.right, locals), type: "i32"};
        }
        throw new SyntaxError("unsupported kernel expression " + node.type);
    }

    function lowerF64(node, locals) {
        if (node.type !== "CallExpression" ||
            node.callee.type !== "Identifier") {
            throw new SyntaxError("binary64 kernel expression must be an intrinsic call");
        }
        var name = node.callee.name;
        if (name === "loadF64" && node.arguments.length === 1) {
            return {op: "load_f64", address: lower(node.arguments[0], locals),
                    type: "f64"};
        }
        var operations = {addF64: "add_f64", subtractF64: "sub_f64",
                          multiplyF64: "mul_f64", divideF64: "div_f64"};
        if (operations[name] && node.arguments.length === 2) {
            return {op: operations[name],
                    left: lowerF64(node.arguments[0], locals),
                    right: lowerF64(node.arguments[1], locals), type: "f64"};
        }
        throw new SyntaxError("unsupported binary64 kernel intrinsic " + name);
    }

    root.GuestVMKernelCompiler = KernelCompiler;
    if (typeof module !== "undefined" && module.exports) module.exports = KernelCompiler;
}(this));
