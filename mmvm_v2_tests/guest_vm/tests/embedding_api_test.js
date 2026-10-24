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
        vm.run("function metadataFirst(a) { return a; }" +
               "function metadataSecond(a) { return a; }" +
               "__guestVMProgramSetVector(metadataFirst, 2, 0, 1);" +
               "assertEqual(metadataSecond(42), 42, 'metadata mutation isolation');",
               "embedding-metadata-isolation.js");
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
        /* Heap-side mutations do not update a handle's host version counter.
         * Cached ownership must therefore be checked against the heap, just
         * as when native execution edits a property between embedding calls. */
        vm.run("var referenceTarget = {value: 17};", "embedding-property-owner.js");
        var target = vm.runtime.getGlobal("referenceTarget");
        var records = vm.runtime.heapRecords;
        var key = vm.runtime.internStringAddress("value");
        var entry = vm.runtime.heapOwnPropertyEntry(target, key, false);
        var reference = vm.runtime.captureOwnPropertyReference(target, key, entry);
        var hostVersion = target.propertyVersion;
        records.deleteOwnProperty(target.heapAddress, key);
        if (vm.runtime.ownPropertyReferenceIsCurrent(reference, target) ||
                vm.runtime.getProperty(target, "value") !== undefined ||
                target.propertyVersion !== hostVersion) {
            throw new Error("heap-side deletion left a stale property reference");
        }
        entry = records.defineOwnPropertyEntry(target.heapAddress, key);
        vm.runtime.writeHeapValue(records.ownPropertyEntryValueCell(target.heapAddress, entry), 42);
        if (vm.runtime.getProperty(target, "value") !== 42) {
            throw new Error("property reinsertion reused a stale cache entry");
        }
        reference = vm.runtime.captureOwnPropertyReference(target, key, entry);
        vm.collect();
        if (vm.runtime.ownPropertyReferenceIsCurrent(reference, target) ||
                vm.runtime.getProperty(target, "value") !== 42) {
            throw new Error("collection did not invalidate/recover an owner reference");
        }
        vm.destroy();
        var cachedVM = new VM({threadedCompile: true});
        try {
            cachedVM.run(
                "function cachedRead(o) { return o.value; }" +
                "function cachedWrite(o, v) { o.value = v; }" +
                "var target = {value: 1};" +
                "assertEqual(cachedRead(target), 1, 'cached own value');" +
                "delete target.value; target.value = 2;" +
                "assertEqual(cachedRead(target), 2, 'cached replacement');" +
                "Object.defineProperty(target, 'value', {get: function () { return this.other; }," +
                "set: function (v) { this.other = v; }});" +
                "cachedWrite(target, 42);" +
                "assertEqual(cachedRead(target), 42, 'cached accessor receiver');" +
                "var child = Object.create(target); cachedWrite(child, 19);" +
                "assertEqual(cachedRead(child), 19, 'inherited accessor receiver');" +
                "assertEqual(cachedRead(target), 42, 'inherited owner unchanged');",
                "embedding-cached-properties.js");
        } finally {
            cachedVM.destroy();
        }
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
