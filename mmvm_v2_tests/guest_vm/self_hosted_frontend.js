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

function adoptProgramDescriptor(program) {
    if (typeof __guestVMProgramCreate !== "function") {
        throw new Error("self-hosted program adoption is unavailable");
    }
    var bindingRegisters = program.bindingRegisters;
    var parameterSlots = program.parameterSlots || [];
    var bindings = program.bindings || [];
    var callable = __guestVMProgramCreate(
        program.code.length,
        program.constants.length,
        bindingRegisters ? bindingRegisters.length : 0,
        parameterSlots.length,
        program.registerCount || 0,
        program.argumentsSlot === undefined ? -1 : program.argumentsSlot,
        program.thisSlot === undefined ? -1 : program.thisSlot,
        program.functionNameSlot === undefined ? -1 : program.functionNameSlot,
        !!program.usesArguments,
        bindings.length);
    var index = 0;
    while (index < program.code.length) {
        __guestVMProgramSetCode(callable, index, program.code[index]);
        index++;
    }
    index = 0;
    while (index < program.constants.length) {
        var constant = program.constants[index];
        if (constant && typeof constant === "object" &&
            constant.code && constant.constants) {
            constant = adoptProgramDescriptor(constant);
        }
        __guestVMProgramSetConstant(callable, index, constant);
        index++;
    }
    index = 0;
    while (index < program.constantRegisters.length) {
        var constantRegister = program.constantRegisters[index];
        __guestVMProgramSetVector(callable, 0, index,
            constantRegister === undefined ? -1 : constantRegister);
        index++;
    }
    index = 0;
    while (bindingRegisters && index < bindingRegisters.length) {
        __guestVMProgramSetVector(callable, 1, index,
                                  bindingRegisters[index]);
        index++;
    }
    index = 0;
    while (index < parameterSlots.length) {
        __guestVMProgramSetVector(callable, 2, index, parameterSlots[index]);
        index++;
    }
    return callable;
}

exports.adoptProgram = adoptProgramDescriptor;

exports.compileExecutable = function (source, filename) {
    return adoptProgramDescriptor(exports.compile(source, filename));
};
