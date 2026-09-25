/* High-level front-end diagnostic.  Run this through guest_runner.js to make
 * the guest-owned tokenizer, parser, compiler, and verifier compile one real
 * source file without executing it. */
var compileFs = require("fs");
var compileFrontend = require("../../guest_vm/self_hosted_frontend.js");

if (!arguments.length) {
    throw new Error("usage: self_hosted_compile_file.js source.js");
}

var compilePath = String(arguments[0]);
var compileSource = compileFs.readFileSync(compilePath).toString("utf8");
var compileProgram = compileFrontend.compile(compileSource, compilePath);
print("self-hosted compile passed: " + compilePath +
      " (" + compileProgram.code.length + " bytecode words, " +
      compileProgram.constants.length + " constants)");
