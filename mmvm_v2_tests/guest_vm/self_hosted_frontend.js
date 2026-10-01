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
    /* Adoption allocates before the destination callable exists. Keep the
     * descriptor graph itself in an explicit guest root first: its strings
     * and nested descriptors are the source from which the permanent program
     * records are populated. Relying only on a suspended function-local
     * value makes their construction lifetime an accidental property of the
     * bytecode compiler's register allocation.
     *
     * Once created, root the incomplete callable as well. Recursive adoption
     * can then collect safely while both the source graph and destination
     * graph are only partially traversed and published. */
    retainAdoptionRoot(program);
    try {
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
        retainAdoptionRoot(callable);
        try {
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
                    constant = adoptProgramDescriptor(
                        constant, contextAnchor);
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
                __guestVMProgramSetVector(callable, 2, index,
                                          parameterSlots[index]);
                index++;
            }
        } finally {
            releaseAdoptionRoot();
        }
        return callable;
    } finally {
        releaseAdoptionRoot();
    }
}

var selfHostedAdoptionRoots = [];

function retainAdoptionRoot(value) {
    selfHostedAdoptionRoots.push(value);
}

function releaseAdoptionRoot() {
    if (selfHostedAdoptionRoots.length <= 0) {
        throw new Error("program adoption root stack underflow");
    }
    selfHostedAdoptionRoots.pop();
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

/* Indirect eval is global code rather than a direct-eval extension of the
 * caller's lexical environment. Keep this as a guest function so the native
 * engine enters the existing self-hosted front end through an ordinary
 * bytecode frame. The returned executable owns declaration instantiation;
 * the engine's eval continuation only has to invoke it. */
exports.compileIndirectEvalExecutable = function (source) {
    var program = exports.compile(source, "<eval>");
    var callable = adoptProgramDescriptor(
        program, exports.compileIndirectEvalExecutable);
    callable.__guestVMGlobalDeclarations = program.globalDeclarations || [];
    return callable;
};

exports.installEvalCompiler = function () {
    if (typeof __guestVMInstallEvalCompiler !== "function") {
        throw new Error("self-hosted eval installation is unavailable");
    }
    __guestVMInstallEvalCompiler(exports.compileEvalExecutable,
                                 exports.compileIndirectEvalExecutable);
};
