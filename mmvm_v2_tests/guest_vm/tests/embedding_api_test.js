(function (root) {
    function runEmbeddingAPITest(VM) {
        var vm = new VM();
        var hostAdd = vm.makeNativeFunction("hostAdd", function (receiver, args) {
            return Number(args[0]) + Number(args[1]);
        });
        vm.installGlobal("hostAdd", hostAdd);
        vm.run("assertEqual(hostAdd(20, 22), 42, 'native callback');",
               "embedding-native.js");
        var program = vm.compile("var cached = hostAdd(3, 4);",
                                 "embedding-compiled.js");
        vm.execute(program);
        if (vm.runtime.getGlobal("cached") !== 7) {
            throw new Error("compile/execute did not preserve the runtime global");
        }
        vm.run("var indirectEval = eval;" +
               "indirectEval('var evaluated = 6 * 7;');" +
               "assertEqual(evaluated, 42, 'indirect eval global');" +
               "assertEqual(indirectEval(19), 19, 'eval non-string');",
               "embedding-eval.js");
        vm.run("assertEqual(eval(\"'eval completion'\"), 'eval completion'," +
               " 'eval expression completion');", "embedding-eval-value.js");
        vm.run("function evalLocal() { var local = 20;" +
               " eval('local = local + 22;'); return local; }" +
               " assertEqual(evalLocal(), 42, 'direct eval lexical binding');",
               "embedding-direct-eval.js");
        var strictReservedThrew = false;
        try {
            vm.compile("'use strict'; var static = 1;",
                       "embedding-strict-reserved.js");
        } catch (strictReservedError) {
            strictReservedThrew = strictReservedError &&
                strictReservedError.name === "SyntaxError";
        }
        if (!strictReservedThrew) {
            throw new Error("strict future reserved word was accepted");
        }
        var threw = false;
        try { vm.run("missingGlobal;", "embedding-error.js"); }
        catch (error) { threw = error && error.name === "ReferenceError"; }
        if (!threw) throw new Error("guest runtime error did not reach embedder");
        if (vm.runtime.activeRegisters !== null) {
            throw new Error("exceptional execution retained active frame roots");
        }
        vm.destroy();
        var rawFFIAvailable = typeof ffi_call === "function" &&
                              typeof get_dlsym === "function";
        var rawVM = null;
        var rawError = null;
        try { rawVM = new VM({rawFFI: true}); }
        catch (error2) { rawError = error2; }
        if (rawFFIAvailable && !rawVM) {
            throw new Error("MMVM host did not allow explicit raw FFI opt-in");
        }
        if (!rawFFIAvailable && !rawError) {
            throw new Error("non-MMVM host unexpectedly emulated raw FFI");
        }
        if (rawVM) rawVM.destroy();
        return "embedding API passed";
    }

    root.GuestVMRunEmbeddingAPITest = runEmbeddingAPITest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runEmbeddingAPITest;
    }
}(this));
