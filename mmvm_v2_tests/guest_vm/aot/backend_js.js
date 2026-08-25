/* JavaScript backend for shared kernel IR. This is Node's execution backend
 * and the semantic reference for native backend equivalence tests. */
(function (root) {
    function JSBackend() {}

    JSBackend.prototype.compile = function (ir) {
        var parameters = ir.parameters.slice(0);
        var source = "return function(" + parameters.join(",") + "){return (" +
                     emit(ir.expression, parameters) + ")|0;};";
        return {fn: Function(source)(), source: source, ir: ir, backend: "js"};
    };

    function emit(node, parameters) {
        if (node.op === "const_i32") return String(node.value | 0);
        if (node.op === "arg_i32") return "(" + parameters[node.index] + "|0)";
        if (node.op === "neg_i32") return "(-" + emit(node.value, parameters) + ")";
        if (node.op === "not_i32") return "(~" + emit(node.value, parameters) + ")";
        if (node.op === "as_i32") return "(" + emit(node.value, parameters) + "|0)";
        var operators = {add_i32: "+", sub_i32: "-", mul_i32: "*",
                         and_i32: "&", or_i32: "|", xor_i32: "^",
                         shl_i32: "<<", shr_i32: ">>"};
        if (!operators[node.op]) throw new Error("unsupported JS kernel IR " + node.op);
        return "((" + emit(node.left, parameters) + ")" + operators[node.op] +
               "(" + emit(node.right, parameters) + "))";
    }

    root.GuestVMKernelJSBackend = JSBackend;
    if (typeof module !== "undefined" && module.exports) module.exports = JSBackend;
}(this));
