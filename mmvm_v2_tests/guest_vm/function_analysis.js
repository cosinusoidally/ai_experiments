/* Scope-aware syntax summaries for consuming compilation. Bodies are still
 * parsed and lowered in full. Summaries avoid repeated tree walks; they never
 * cache source, bytecode or a resolution tied to a particular outer scope.
 * Only compiler-owned ASTs may receive this temporary memo. */
(function (root) {
    var own = Object.prototype.hasOwnProperty;
    var childFields = {
        ExpressionStatement: ["expression"],
        LabeledStatement: ["body"],
        IfStatement: ["test", "consequent", "alternate"],
        WhileStatement: ["test", "body"],
        DoWhileStatement: ["body", "test"],
        ForStatement: ["initial", "test", "update", "body"],
        ForInStatement: ["left", "right", "body"],
        ThrowStatement: ["argument"],
        UnaryExpression: ["argument"],
        UpdateExpression: ["argument"],
        BinaryExpression: ["left", "right"],
        AssignmentExpression: ["left", "right"],
        SequenceExpression: ["left", "right"],
        ConditionalExpression: ["test", "consequent", "alternate"],
        MemberExpression: ["object", "property"]
    };

    function addName(names, seen, name) {
        var key = "$" + name;
        if (!seen[key]) {
            seen[key] = true;
            names.push(name);
        }
    }

    function analyze(expression) {
        if (own.call(expression, "guestFunctionAnalysis")) return expression.guestFunctionAnalysis;
        var result = {locals: [], names: [], nestedNames: [], directEval: false,
            usesArguments: false, environmentRequired: false, hasWith: false,
            returnKind: null, supported: true};
        var localNames = {}, names = {}, nestedNames = {}, invalidReturn = false;
        if (expression.name) addName(result.locals, localNames, expression.name);

        function visitList(list) {
            var index = 0;
            while (list && index < list.length) visit(list[index++]);
        }

        function visit(node) {
            if (!node || typeof node !== "object") return;
            var type = node.type, index, child;
            if (type === "Identifier") {
                addName(result.names, names, node.name);
                if (node.name === "arguments") result.usesArguments = true;
                return;
            }
            if (type === "FunctionDeclaration" || type === "FunctionExpression") {
                if (type === "FunctionDeclaration") addName(result.locals, localNames, node.name);
                child = analyze(node);
                if (!child.supported) result.supported = false;
                if (child.environmentRequired) result.environmentRequired = true;
                index = 0;
                while (index < child.names.length) {
                    addName(result.nestedNames, nestedNames, child.names[index++]);
                }
                index = 0;
                while (index < child.nestedNames.length) {
                    addName(result.nestedNames, nestedNames, child.nestedNames[index++]);
                }
                return;
            }
            if (type === "VariableStatement") {
                index = 0;
                while (index < node.declarations.length) {
                    var declaration = node.declarations[index++];
                    addName(result.locals, localNames, declaration.name);
                    visit(declaration.initial);
                }
                return;
            }
            if (type === "BlockStatement" || type === "Program") {
                visitList(node.body);
                return;
            }
            if (type === "CallExpression" || type === "NewExpression") {
                if (type === "CallExpression" && node.callee.type === "Identifier" &&
                    node.callee.name === "eval") {
                    result.directEval = true;
                    result.environmentRequired = true;
                }
                visit(node.callee);
                visitList(node.arguments);
                return;
            }
            if (type === "ReturnStatement") {
                /* Match the compiler's existing coarse return annotation;
                 * all references/conversions in the argument still matter. */
                if (node.argument) {
                    var kind = node.argument.type === "ObjectExpression" ? "properties" :
                               node.argument.type === "ArrayExpression" ? "array" : null;
                    if (!kind || (result.returnKind && result.returnKind !== kind)) invalidReturn = true;
                    else result.returnKind = kind;
                }
                visit(node.argument);
                return;
            }
            if (type === "TryStatement") {
                result.environmentRequired = true;
                visit(node.block);
                visit(node.handler);
                visit(node.finalizer);
                return;
            }
            if (type === "WithStatement") {
                result.environmentRequired = true;
                result.hasWith = true;
                visit(node.object);
                visit(node.body);
                return;
            }
            if (type === "SwitchStatement") {
                visit(node.discriminant);
                index = 0;
                while (index < node.cases.length) {
                    var clause = node.cases[index++];
                    visit(clause.test);
                    visitList(clause.consequent);
                }
                return;
            }
            if (type === "ObjectExpression") {
                index = 0;
                while (index < node.properties.length) visit(node.properties[index++].value);
                return;
            }
            if (type === "ArrayExpression") {
                visitList(node.elements);
                return;
            }
            if (type === "Literal" || type === "RegExpLiteral" || type === "ThisExpression" ||
                type === "EmptyStatement" || type === "BreakStatement" || type === "ContinueStatement") return;
            var fields = childFields[type];
            if (!fields || !own.call(childFields, type)) {
                result.supported = false;
                return;
            }
            index = 0;
            while (index < fields.length) visit(node[fields[index++]]);
        }

        visit(expression.body);
        if (invalidReturn) result.returnKind = null;
        expression.guestFunctionAnalysis = result;
        return result;
    }

    var exports = {analyze: analyze};
    root.GuestVMFunctionAnalysis = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
