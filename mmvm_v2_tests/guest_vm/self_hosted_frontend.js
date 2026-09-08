/* Front-end entry point intended to execute inside a guest JSContext.  Parser
 * ASTs and compiler products created here are therefore ordinary guest
 * objects owned by that context's JSRuntime heap.  The bootstrap currently
 * still compiles these implementation modules before entering the context;
 * adopting the returned program record without materializing host objects is
 * the next integration boundary. */
var SelfHostedParser = require("./parser.js");
var SelfHostedCompiler = require("./compiler.js");
var selfHostedVerify = require("./verifier.js");

exports.parse = function (source, filename) {
    return new SelfHostedParser(source, filename,
        {compactLiterals: true}).parseProgram();
};

exports.compileAst = function (ast) {
    return selfHostedVerify(new SelfHostedCompiler().compile(ast));
};

exports.compile = function (source, filename) {
    return exports.compileAst(exports.parse(source, filename));
};
