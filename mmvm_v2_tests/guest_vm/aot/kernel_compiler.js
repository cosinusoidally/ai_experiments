/* Shared kernel front/middle end. It parses a deliberately small, statically
 * validated integer-function dialect and produces host-independent typed IR. */
(function (root) {
    var Parser = root.GuestVMParser;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("../parser.js");
    }

    function KernelCompiler() {}

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
