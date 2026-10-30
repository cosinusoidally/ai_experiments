/* Compare public mutable-AST compilation with consuming compilation using
 * current real source files. No golden bytecode, fixture edits or generated
 * files. This is a refactoring diagnostic, not a mandated optimizer shape.
 * Run from mmvm_v2_tests under Node or js_min, followed by source filenames. */
(function (shellArguments) {
    var node = typeof module !== "undefined" && module.exports;
    var Parser, Compiler, args, readSource, report;
    if (node) {
        Parser = require("../parser.js");
        Compiler = require("../compiler.js");
        args = process.argv.slice(2);
        readSource = function (path) { return require("fs").readFileSync(path, "utf8"); };
        report = function (line) { console.log(line); };
    } else {
        load("guest_vm/unicode_identifier_data.js");
        load("guest_vm/tokenizer.js");
        load("guest_vm/parser.js");
        load("guest_vm/bytecode.js");
        load("guest_vm/register_allocator.js");
        load("guest_vm/bytecode_optimizer.js");
        load("guest_vm/function_analysis.js");
        load("guest_vm/compiler.js");
        Parser = GuestVMParser;
        Compiler = GuestVMCompiler;
        args = shellArguments;
        readSource = read;
        report = print;
    }
    if (!args.length) throw new Error("expected source filenames");
    var own = Object.prototype.hasOwnProperty;
    var fields = ["code", "constantRegisters", "registerCount", "parameters", "locals",
        "bindings", "bindingSlots", "bindingRegisters", "parameterSlots", "argumentsSlot",
        "thisSlot", "functionNameSlot", "usesArguments", "strict", "evalCode", "name",
        "source", "returnKind", "nonlocalBindings", "globalDeclarations", "evalDeclarations",
        "outerEnvironmentScopes"];
    function compare(left, right, path) {
        if (left === right) {
            if (left === 0 && 1 / left !== 1 / right) throw new Error(path + ": zero sign differs");
            return;
        }
        if (typeof left === "number" && typeof right === "number" && left !== left && right !== right) return;
        if (!left || !right || typeof left !== "object" || typeof right !== "object") {
            throw new Error(path + ": " + left + " != " + right);
        }
        if (left.code && left.constants && right.code && right.constants) {
            compareProgram(left, right, path);
            return;
        }
        var key;
        for (key in left) {
            if (own.call(left, key)) {
                if (!own.call(right, key)) throw new Error(path + ": missing " + key);
                compare(left[key], right[key], path + "." + key);
            }
        }
        for (key in right) {
            if (own.call(right, key) && !own.call(left, key)) throw new Error(path + ": extra " + key);
        }
        if (left instanceof Array && left.length !== right.length) throw new Error(path + ": array lengths differ");
    }
    function compareProgram(left, right, path) {
        var index = 0;
        while (index < fields.length) {
            var field = fields[index++];
            compare(left[field], right[field], path + "." + field);
        }
        compare(left.constants, right.constants, path + ".constants");
    }
    function releaseAst(program) {
        delete program.astBody;
        var index = 0;
        while (index < program.constants.length) {
            var child = program.constants[index++];
            if (child && typeof child === "object" && child.code && child.constants) releaseAst(child);
        }
        return program;
    }
    function compile(source, filename, consume) {
        var ast = new Parser(source, filename,
            {compactLiterals: true, shareIdentifiers: true, captureLocations: false}).parseProgram();
        return releaseAst(new Compiler(null, null, null,
            {consumeAst: consume, captureLocations: false}).compile(ast));
    }
    var index = 0;
    while (index < args.length) {
        var filename = args[index++], source = readSource(filename);
        var reference = compile(source, filename, false);
        var consuming = compile(source, filename, true);
        compareProgram(reference, consuming, filename);
        report(filename + ": compilation paths agree");
        reference = consuming = source = null;
    }
}(typeof arguments !== "undefined" ? arguments : []));
