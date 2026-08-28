/* JavaScript backend for shared kernel IR. This is Node's execution backend
 * and the semantic reference for native backend equivalence tests. */
(function (root) {
    function JSBackend() {}

    JSBackend.prototype.compile = function (ir) {
        if (ir.controlFlow) return compileControlFlow(ir);
        var parameters = ir.parameters.slice(0);
        var body = "";
        var index = 0;
        while (index < ir.instructions.length) {
            var instruction = ir.instructions[index++];
            if (instruction.op === "store_f64") {
                body += "memory.writeF64(" + emit(instruction.address, parameters) +
                        "," + emitF64(instruction.value, parameters) + ");";
            } else if (instruction.op !== "store_u32") {
                throw new Error("unsupported JS kernel instruction " + instruction.op);
            } else {
                body += "memory.writeU32(" + emit(instruction.address, parameters) +
                        "," + emit(instruction.value, parameters) + ");";
            }
        }
        var source = "return function(memory," + parameters.join(",") + "){" +
                     body + "return (" + emit(ir.expression, parameters) + ")|0;};";
        return {fn: Function(source)(), source: source, ir: ir, backend: "js"};
    };

    function compileControlFlow(ir) {
        var parameters = ir.parameters.slice(0);
        var body = "";
        if (ir.locals.length) body += "var " + ir.locals.join(",") + ";";
        body += emitStatements(ir.body, parameters, ir.locals);
        var source = "return function(memory," + parameters.join(",") + "){" +
                     body + "};";
        return {fn: Function(source)(), source: source, ir: ir, backend: "js"};
    }

    function emitStatements(statements, parameters, locals) {
        var source = "";
        var index = 0;
        while (index < statements.length) {
            source += emitStatement(statements[index++], parameters, locals);
        }
        return source;
    }

    function emitStatement(node, parameters, locals) {
        if (node.op === "block") {
            return "{" + emitStatements(node.body, parameters, locals) + "}";
        }
        if (node.op === "set_local") {
            return locals[node.index] + "=" +
                   emitControlExpression(node.value, parameters, locals) + ";";
        }
        if (node.op === "set_argument") {
            return parameters[node.index] + "=" +
                   emitControlExpression(node.value, parameters, locals) + ";";
        }
        if (node.op === "store_u32") {
            return "memory.writeU32(" +
                emitControlExpression(node.address, parameters, locals) + "," +
                emitControlExpression(node.value, parameters, locals) + ");";
        }
        if (node.op === "store_f64") {
            return "memory.writeF64(" +
                emitControlExpression(node.address, parameters, locals) + "," +
                emitControlF64(node.value, parameters, locals) + ");";
        }
        if (node.op === "store_raw_u8" || node.op === "store_raw_u32") {
            return "memory." + (node.op === "store_raw_u8" ?
                "writeRawU8" : "writeRawU32") + "(" +
                emitControlExpression(node.address, parameters, locals) + "," +
                emitControlExpression(node.value, parameters, locals) + ");";
        }
        if (node.op === "if") {
            if (node.test.op === "const_i32") {
                return emitNested(node.test.value ? node.consequent :
                                  node.alternate, parameters, locals);
            }
            return "if(" + emitControlExpression(node.test, parameters, locals) + "){" +
                   emitNested(node.consequent, parameters, locals) + "}else{" +
                   emitNested(node.alternate, parameters, locals) + "}";
        }
        if (node.op === "while") {
            return "while(" + emitControlExpression(node.test, parameters, locals) + "){" +
                   emitNested(node.body, parameters, locals) + "}";
        }
        if (node.op === "opcode_dispatch") {
            return emitStatement(node.body, parameters, locals);
        }
        if (node.op === "return") {
            return "return (" + emitControlExpression(
                node.value, parameters, locals) + ")|0;";
        }
        throw new Error("unsupported JS control-flow kernel statement " + node.op);
    }

    function emitNested(node, parameters, locals) {
        return node.op === "block" ?
            emitStatements(node.body, parameters, locals) :
            emitStatement(node, parameters, locals);
    }

    function emitControlExpression(node, parameters, locals) {
        if (node.op === "local_i32") return "(" + locals[node.index] + "|0)";
        if (node.op === "call_native_i32") {
            var nativeArguments = [];
            var nativeArgumentIndex = 0;
            while (nativeArgumentIndex < node.arguments.length) {
                nativeArguments.push(emitControlExpression(
                    node.arguments[nativeArgumentIndex++], parameters, locals));
            }
            return "(memory.callNativeI32(" +
                emitControlExpression(node.pointer, parameters, locals) +
                ",[" + nativeArguments.join(",") + "])|0)";
        }
        if (node.op === "load_u32") return "(memory.readU32(" +
            emitControlExpression(node.address, parameters, locals) + ")|0)";
        if (node.op === "load_raw_u8" || node.op === "load_raw_u32") {
            return "(memory." + (node.op === "load_raw_u8" ?
                "readRawU8" : "readRawU32") + "(" +
                emitControlExpression(node.address, parameters, locals) + ")|0)";
        }
        if (node.op === "logical_not_i32") return "(!" +
            emitControlExpression(node.value, parameters, locals) + "|0)";
        if (node.op === "arg_i32") return "(" + parameters[node.index] + "|0)";
        if (node.op === "const_i32") return String(node.value | 0);
        if (node.op === "to_i32_f64") return "(" +
            emitControlF64(node.value, parameters, locals) + "|0)";
        var f64Comparisons = {eq_f64: "===", lt_f64: "<", le_f64: "<=",
                              gt_f64: ">", ge_f64: ">="};
        if (f64Comparisons[node.op]) {
            return "((" + emitControlF64(node.left, parameters, locals) + ")" +
                   f64Comparisons[node.op] + "(" +
                   emitControlF64(node.right, parameters, locals) + ")|0)";
        }
        if (node.op === "neg_i32") return "(-" +
            emitControlExpression(node.value, parameters, locals) + ")";
        if (node.op === "not_i32") return "(~" +
            emitControlExpression(node.value, parameters, locals) + ")";
        if (node.op === "as_i32") return "(" +
            emitControlExpression(node.value, parameters, locals) + "|0)";
        var operators = {add_i32: "+", sub_i32: "-", mul_i32: "*", rem_i32: "%",
            and_i32: "&", or_i32: "|", xor_i32: "^", shl_i32: "<<", shr_i32: ">>",
            ushr_i32: ">>>",
            eq_i32: "===", ne_i32: "!==", lt_i32: "<", le_i32: "<=",
            gt_i32: ">", ge_i32: ">="};
        if (!operators[node.op]) {
            throw new Error("unsupported JS control-flow kernel expression " + node.op);
        }
        return "((" + emitControlExpression(node.left, parameters, locals) + ")" +
               operators[node.op] + "(" +
               emitControlExpression(node.right, parameters, locals) + "))";
    }

    function emitControlF64(node, parameters, locals) {
        if (node.op === "abs_f64") {
            return "Math.abs(" +
                emitControlF64(node.value, parameters, locals) + ")";
        }
        if (node.op === "sqrt_f64") {
            return "Math.sqrt(" +
                emitControlF64(node.value, parameters, locals) + ")";
        }
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            return "Math." + (node.op === "sin_f64" ? "sin" : "cos") + "(" +
                emitControlF64(node.value, parameters, locals) + ")";
        }
        if (node.op === "load_f64") {
            return "memory.readF64(" +
                emitControlExpression(node.address, parameters, locals) + ")";
        }
        if (node.op === "load_i32_f64") {
            return "(memory.readU32(" +
                emitControlExpression(node.address, parameters, locals) + ")|0)";
        }
        if (node.op === "load_number_f64") {
            var numberAddress = emitControlExpression(
                node.address, parameters, locals);
            return "(" + emitControlExpression(node.tag, parameters, locals) +
                "===5?(memory.readU32(" + numberAddress + ")|0):" +
                "memory.readF64(" + numberAddress + "))";
        }
        if (node.op === "pow_f64") {
            return "Math.pow(" + emitControlF64(node.left, parameters, locals) +
                   "," + emitControlF64(node.right, parameters, locals) + ")";
        }
        var operators = {add_f64: "+", sub_f64: "-", mul_f64: "*", div_f64: "/"};
        if (!operators[node.op]) {
            throw new Error("unsupported JS control-flow f64 expression " + node.op);
        }
        return "((" + emitControlF64(node.left, parameters, locals) + ")" +
               operators[node.op] + "(" +
               emitControlF64(node.right, parameters, locals) + "))";
    }

    function emit(node, parameters) {
        if (node.op === "const_i32") return String(node.value | 0);
        if (node.op === "arg_i32") return "(" + parameters[node.index] + "|0)";
        if (node.op === "call_native_i32") {
            var nativeArguments = [];
            var nativeArgumentIndex = 0;
            while (nativeArgumentIndex < node.arguments.length) {
                nativeArguments.push(emit(
                    node.arguments[nativeArgumentIndex++], parameters));
            }
            return "(memory.callNativeI32(" + emit(node.pointer, parameters) +
                   ",[" + nativeArguments.join(",") + "])|0)";
        }
        if (node.op === "neg_i32") return "(-" + emit(node.value, parameters) + ")";
        if (node.op === "not_i32") return "(~" + emit(node.value, parameters) + ")";
        if (node.op === "as_i32") return "(" + emit(node.value, parameters) + "|0)";
        var operators = {add_i32: "+", sub_i32: "-", mul_i32: "*", rem_i32: "%",
                         and_i32: "&", or_i32: "|", xor_i32: "^",
                         shl_i32: "<<", shr_i32: ">>"};
        if (!operators[node.op]) throw new Error("unsupported JS kernel IR " + node.op);
        return "((" + emit(node.left, parameters) + ")" + operators[node.op] +
               "(" + emit(node.right, parameters) + "))";
    }

    function emitF64(node, parameters) {
        if (node.op === "sin_f64" || node.op === "cos_f64") {
            return "Math." + (node.op === "sin_f64" ? "sin" : "cos") + "(" +
                emitF64(node.value, parameters) + ")";
        }
        if (node.op === "load_f64") {
            return "memory.readF64(" + emit(node.address, parameters) + ")";
        }
        var operators = {add_f64: "+", sub_f64: "-", mul_f64: "*", div_f64: "/"};
        if (!operators[node.op]) throw new Error("unsupported JS f64 IR " + node.op);
        return "((" + emitF64(node.left, parameters) + ")" + operators[node.op] +
               "(" + emitF64(node.right, parameters) + "))";
    }

    root.GuestVMKernelJSBackend = JSBackend;
    if (typeof module !== "undefined" && module.exports) module.exports = JSBackend;
}(this));
