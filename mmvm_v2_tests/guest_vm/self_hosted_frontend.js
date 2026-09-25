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

function adoptProgramDescriptor(program, contextAnchor) {
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
        bindings.length,
        !!program.strict,
        !!program.evalCode,
        contextAnchor,
        program.source || null);
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
            constant = adoptProgramDescriptor(constant, contextAnchor);
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

exports.compileExecutable = function (source, filename, contextAnchor,
                                      owningGlobal) {
    var program = exports.compile(source, filename);
    var executable = adoptProgramDescriptor(program, contextAnchor);
    var globalDeclarations = program.globalDeclarations || [];
    return function () {
        /* Adopted programs enter as guest bytecode calls rather than through
         * JSContext.startProgram. Reproduce global declaration
         * instantiation before their first instruction, including bindings
         * which are read by their own initializer. In sloppy script code an
         * unqualified call supplies the owning global as `this`. */
        var globalObject = owningGlobal || this;
        var declarationIndex = 0;
        while (declarationIndex < globalDeclarations.length) {
            var declarationName = globalDeclarations[declarationIndex++];
            if (typeof globalObject[declarationName] === "undefined") {
                globalObject[declarationName] = undefined;
            }
        }
        return executable();
    };
};

exports.compileEvalExecutable = function (source, filename, inheritedStrict) {
    var ast = new SelfHostedParser(source, filename,
        {strict: !!inheritedStrict, compactLiterals: true}).parseProgram();
    var dynamicOuter = [
        {bindings: {}, createsEnvironment: false, dynamic: true}
    ];
    var program = ast.strict ?
        SelfHostedCompiler.compileStrictEval(ast, dynamicOuter) :
        SelfHostedCompiler.compileSloppyDirectEval(ast, null);
    selfHostedVerify(program);
    var callable = adoptProgramDescriptor(program);
    callable.__guestVMEvalDeclarations = program.evalDeclarations || [];
    return callable;
};

exports.installEvalCompiler = function () {
    if (typeof __guestVMInstallEvalCompiler !== "function") {
        throw new Error("self-hosted eval installation is unavailable");
    }
    __guestVMInstallEvalCompiler(exports.compileEvalExecutable);
};
