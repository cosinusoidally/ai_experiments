/* Compile a source file without executing it, reporting optimization coverage.
 * Run from mmvm_v2_tests on Node, js_min, or the standalone guest shell:
 *   node guest_vm/tools/inspect_bytecode_optimization.js [--functions] file.js
 * Use /dev/stdin to inspect source extracted by another trusted JS tool.
 * This inspects current compiler source, not a snapshot's embedded compiler.
 */
(function (shellArguments) {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var args, Compiler, Parser, readSource, report;
    if (nodeHost) {
        args = process.argv.slice(2);
        Compiler = require("../compiler.js");
        Parser = require("../parser.js");
        readSource = function (name) { return require("fs").readFileSync(name, "utf8"); };
        report = function (line) { console.log(line); };
    } else {
        args = shellArguments;
        load("guest_vm/unicode_identifier_data.js");
        load("guest_vm/tokenizer.js");
        load("guest_vm/parser.js");
        load("guest_vm/bytecode.js");
        load("guest_vm/register_allocator.js");
        load("guest_vm/bytecode_optimizer.js");
        load("guest_vm/compiler.js");
        Compiler = GuestVMCompiler;
        Parser = GuestVMParser;
        readSource = read;
        report = print;
    }
    var detailed = args[0] === "--functions";
    if (detailed) args = args.slice(1);
    if (args.length !== 1) throw new Error("expected [--functions] source-file");
    var totals = {programs: 0, analyzed: 0, stateLimited: 0, workLimited: 0,
                  fused: 0, redundant: 0, conversions: 0};
    function describe(record) {
        var fields = [], name;
        for (name in record) {
            if (Object.prototype.hasOwnProperty.call(record, name)) {
                fields.push(name + "=" + record[name]);
            }
        }
        return fields.join(" ");
    }
    function inspect(program) {
        var stats = program.optimizationStats || {};
        totals.programs++;
        if (stats.int32AnalysisBlocks) totals.analyzed++;
        if (stats.int32AnalysisStateBudgetExceeded) totals.stateLimited++;
        if (stats.int32AnalysisBudgetExceeded) totals.workLimited++;
        totals.fused += stats.fusedInt32Arithmetic || 0;
        totals.redundant += stats.redundantInt32Conversions || 0;
        totals.conversions += stats.unaryInt32Conversions || 0;
        if (detailed) report((program.name || "<script/anonymous>") + " " + describe(stats));
        return program;
    }
    var started = new Date().getTime();
    var ast = new Parser(readSource(args[0]), args[0]).parseProgram();
    inspect(new Compiler(null, null, null, {consumeAst: true,
        finishFunction: inspect}).compile(ast));
    report("optimization totals " + describe(totals));
    report("parse/compile ms " + (new Date().getTime() - started));
}(typeof arguments !== "undefined" ? arguments : []));
