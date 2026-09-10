/* Measures the uncached guest front end without constructing a JSRuntime or
 * executing the resulting program.  It works under both Node and js_min.exe.
 *
 *   node guest_vm/frontend_benchmark.js source.js
 *   js_min.exe guest_vm/frontend_benchmark.js source.js
 */
(function (root, commandArguments) {
    var isNode = typeof module !== "undefined" && module.exports;
    var Parser;
    var Compiler;
    var verify;
    var sourcePath;
    var source;
    if (isNode) {
        Parser = require("./parser.js");
        Compiler = require("./compiler.js");
        verify = require("./verifier.js");
        sourcePath = process.argv[2];
        if (sourcePath) source = require("fs").readFileSync(sourcePath, "utf8");
    } else {
        load("guest_vm/unicode_identifier_data.js");
        load("guest_vm/tokenizer.js");
        load("guest_vm/parser.js");
        load("guest_vm/bytecode.js");
        load("guest_vm/compiler.js");
        load("guest_vm/verifier.js");
        Parser = GuestVMParser;
        Compiler = GuestVMCompiler;
        verify = GuestVMVerify;
        sourcePath = commandArguments.length ? commandArguments[0] : null;
        if (sourcePath) source = read(sourcePath);
    }
    if (!sourcePath) throw new Error("usage: frontend_benchmark.js source.js");

    function milliseconds() { return new Date().getTime(); }
    function output(text) {
        if (typeof print === "function") print(text);
        else console.log(text);
    }

    var started = milliseconds();
    var ast = new Parser(source, sourcePath).parseProgram();
    var parsed = milliseconds();
    var program = new Compiler().compile(ast);
    var compiled = milliseconds();
    verify(program);
    var verified = milliseconds();
    output("frontend source bytes: " + source.length);
    output("frontend parse ms: " + (parsed - started));
    output("frontend compile ms: " + (compiled - parsed));
    output("frontend verify ms: " + (verified - compiled));
    output("frontend total ms: " + (verified - started));
}(this, typeof arguments === "undefined" ? [] : arguments));
