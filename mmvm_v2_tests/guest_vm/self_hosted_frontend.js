/* Front-end entry point intended to execute inside a guest JSContext.  Parser
 * ASTs and compiler products created here are therefore ordinary guest
 * objects owned by that context's JSRuntime heap.  The bootstrap currently
 * still compiles these implementation modules before entering the context;
 * adopting the returned program record without materializing host objects is
 * the next integration boundary. */
var SelfHostedParser, SelfHostedCompiler, selfHostedVerify;

function ensureFrontend(frontend) {
    if (frontend) {
        SelfHostedParser = frontend.Parser;
        SelfHostedCompiler = frontend.Compiler;
        selfHostedVerify = frontend.verify;
    } else if (!SelfHostedParser) {
        SelfHostedParser = require("./parser.js");
        SelfHostedCompiler = require("./compiler.js");
        selfHostedVerify = require("./verifier.js");
    }
}

exports.parse = function (source, filename) {
    ensureFrontend();
    return new SelfHostedParser(source, filename,
        {compactLiterals: true}).parseProgram();
};

exports.compileAst = function (ast, consumeAst) {
    ensureFrontend();
    return selfHostedVerify(new SelfHostedCompiler(null, null, false,
        {consumeAst: !!consumeAst}).compile(ast));
};

exports.compile = function (source, filename, options) {
    ensureFrontend();
    var captureLocations = !options || options.captureLocations !== false;
    var ast = new SelfHostedParser(source, filename,
        {compactLiterals: true, shareIdentifiers: true,
         captureLocations: captureLocations}).parseProgram();
    return selfHostedVerify(new SelfHostedCompiler(null, null, false,
        {consumeAst: true, captureLocations: captureLocations,
         finishFunction: options && options.finishFunction}).compile(ast));
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
            __guestVMProgramSetCode(callable, 0, program.code);
            var index = 0;
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
    /* Adoption retains exact function source, but has no location-table input.
     * Do not build/retain a second, unused source-position graph here. Public
     * descriptor compilation still captures locations by default. */
    var program = exports.compile(source, filename, {
        captureLocations: false,
        finishFunction: function (nestedProgram) {
            return adoptProgramDescriptor(selfHostedVerify(nestedProgram), contextAnchor);
        }
    });
    var executable = adoptProgramDescriptor(program, contextAnchor);
    var globalDeclarations = program.globalDeclarations || [];
    /* The returned closure needs the adopted callable and declaration names,
     * not the compiler's temporary descriptor graph and numeric builders. */
    program = null;
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
    ensureFrontend();
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
 * bytecode frame. The returned executable carries declaration metadata;
 * the engine's continuation instantiates it in the caller's global realm. */
exports.compileIndirectEvalExecutable = function (source) {
    ensureFrontend();
    var ast = new SelfHostedParser(source, "<eval>",
        {compactLiterals: true, shareIdentifiers: true}).parseProgram();
    /* Eval returns the last non-empty statement completion, unlike load.
     * A strict indirect eval additionally owns its declarations; neither
     * form inherits the compiler module's lexical environment. */
    var program = ast.strict ? SelfHostedCompiler.compileStrictEval(ast, null) :
        new SelfHostedCompiler(null, null, false,
            {consumeAst: true}).compile(ast, true);
    selfHostedVerify(program);
    var callable = adoptProgramDescriptor(
        program, exports.compileIndirectEvalExecutable);
    callable.__guestVMGlobalDeclarations = program.globalDeclarations || [];
    return callable;
};

exports.installEvalCompiler = function (frontend) {
    ensureFrontend(frontend);
    if (typeof __guestVMInstallEvalCompiler !== "function") {
        throw new Error("self-hosted eval installation is unavailable");
    }
    __guestVMInstallEvalCompiler(exports.compileEvalExecutable,
                                 exports.compileIndirectEvalExecutable,
                                 exports.compileFunctionExecutable);
};

/* Ordinary Function-constructor arguments, including their observable
 * left-to-right ToString conversions. The parser/compiler run as guest code;
 * adoption returns a callable without executing its body. */
exports.compileFunctionExecutable = function () {
    ensureFrontend();
    var parameters = [];
    var index = 0;
    while (index + 1 < arguments.length) {
        parameters.push(String(arguments[index++]));
    }
    var body = arguments.length ? String(arguments[arguments.length - 1]) : "";
    var parameterSource = parameters.join(",");
    /* Validate the parameter grammar separately so a closing parenthesis in
     * an argument cannot inject a body into the combined source. */
    var parameterAst = new SelfHostedParser("function anonymous(" + parameterSource + "\n) {}",
        "<Function>", {compactLiterals: true}).parseProgram();
    if (parameterAst.body.length !== 1 ||
            parameterAst.body[0].type !== "FunctionDeclaration" ||
            parameterAst.body[0].body.body.length !== 0) {
        throw new SyntaxError("invalid Function constructor parameters");
    }
    var source = "function anonymous(" + parameterSource + "\n) {\n" + body + "\n}";
    var ast = new SelfHostedParser(source, "<Function>",
        {compactLiterals: true, shareIdentifiers: true}).parseProgram();
    if (ast.body.length !== 1 || ast.body[0].type !== "FunctionDeclaration") {
        throw new SyntaxError("invalid Function constructor source");
    }
    var compiler = new SelfHostedCompiler(null, null, false, {consumeAst: true});
    compiler.filename = "<Function>";
    return adoptProgramDescriptor(selfHostedVerify(compiler.compileFunction(ast.body[0])));
};
