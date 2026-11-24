/* Debug-only canonical provenance. Never use a host decompiler's line numbers.
 * The structural check also accepts js_min's reformatted function source. */
(function (root) {
    var Parser = root.GuestVMParser, Compiler = root.GuestVMKernelCompiler;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("../parser.js");
        Compiler = require("./kernel_compiler.js");
    }
    var SOURCE_FILES = [
        "guest_vm/aot/native_interpreter.js", "guest_vm/aot/heap_sweeper.js",
        "guest_vm/aot/free_index_kernel.js", "guest_vm/native_free_index_kernel.js",
        "guest_vm/property_storage_kernel.js", "guest_vm/property_semantics_kernel.js",
        "guest_vm/string_key_kernel.js", "guest_vm/number_format_kernel.js",
        "guest_vm/object_operations_kernel.js", "guest_vm/memory_transfer_kernel.js",
        "guest_vm/lexical_environment_kernel.js", "guest_vm/heap_records.js",
        "guest_vm/value_cell.js", "guest_vm/binary64.js", "guest_vm/aot/record_initializer.js",
        "guest_vm/indexed_view_policy.js"
    ];
    var METADATA = {location: true, source: true, sourceEnd: true, filename: true};
    var own = Object.prototype.hasOwnProperty;

    function equivalent(left, right) {
        if (left === right) return true;
        if (!left || !right || typeof left !== "object" ||
            typeof right !== "object") return false;
        if (left.type === "BlockStatement" && left.body.length === 1) {
            return equivalent(left.body[0], right);
        }
        if (right.type === "BlockStatement" && right.body.length === 1) {
            return equivalent(left, right.body[0]);
        }
        var key;
        for (key in left) {
            if (own.call(left, key) && !METADATA[key] &&
                (!own.call(right, key) || !equivalent(left[key], right[key]))) return false;
        }
        for (key in right) {
            if (own.call(right, key) && !METADATA[key] && !own.call(left, key)) return false;
        }
        return true;
    }

    function Registry(readSource, files) {
        this.functions = {};
        var registry = this;
        function visit(node) {
            if (!node || typeof node !== "object") return;
            if ((node.type === "FunctionDeclaration" ||
                 node.type === "FunctionExpression") && node.name) {
                var expression = {type: "FunctionExpression", name: node.name,
                    parameters: node.parameters, body: node.body, strict: node.strict,
                    source: node.source, location: node.location};
                var key = "$" + node.name;
                if (!registry.functions[key]) registry.functions[key] = [];
                registry.functions[key].push(expression);
            }
            var field;
            for (field in node) {
                if (own.call(node, field) && !METADATA[field]) visit(node[field]);
            }
        }
        files = (files || SOURCE_FILES).slice(0);
        files.sort();
        var index = 0;
        while (index < files.length) {
            var filename = files[index++];
            if (!filename || filename.charAt(0) === "/" ||
                filename.indexOf(":") !== -1 || filename.indexOf("\\") !== -1 ||
                ("/" + filename + "/").indexOf("/../") !== -1) {
                throw new Error("kernel source path must be project relative: " + filename);
            }
            visit(new Parser(readSource(filename), filename, {
                captureRaw: false, captureLocations: true,
                captureFunctionSource: true, compactLiterals: true
            }).parseProgram());
        }
    }

    Registry.prototype.resolve = function (name, source) {
        var candidates = this.functions["$" + name] || [];
        var match = null, parsed = null, index = 0;
        while (index < candidates.length) {
            var candidate = candidates[index++];
            if (source !== candidate.source) {
                if (!parsed) parsed = Compiler.parseFunctionSource(source);
                if (!equivalent(parsed, candidate)) continue;
            }
            if (match) throw new Error("ambiguous canonical kernel source: " + name);
            match = candidate;
        }
        if (!match) throw new Error("missing canonical kernel source: " + name);
        return match;
    };
    root.GuestVMKernelSources = Registry;
    if (typeof module !== "undefined" && module.exports) module.exports = Registry;
}(this));
