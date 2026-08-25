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
        var threw = false;
        try { vm.run("missingGlobal;", "embedding-error.js"); }
        catch (error) { threw = error && error.name === "ReferenceError"; }
        if (!threw) throw new Error("guest runtime error did not reach embedder");
        if (vm.runtime.activeRegisters !== null) {
            throw new Error("exceptional execution retained active frame roots");
        }
        vm.destroy();
        return "embedding API passed";
    }

    root.GuestVMRunEmbeddingAPITest = runEmbeddingAPITest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runEmbeddingAPITest;
    }
}(this));
