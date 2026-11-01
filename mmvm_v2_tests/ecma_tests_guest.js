/* Guest-executed embedding, reusing the Test262 realm lifecycle and bounded
 * execution primitives. No host Node engine supplies test semantics. */
exports.create = function (fs) {
    if (typeof GuestVM !== "function" || typeof GuestNodeEnvironment !== "function") {
        throw new Error("ECMA guest tests require a generic standalone snapshot");
    }
    var vm = new GuestVM({rawFFI: true, nativeInterpreter: true, gcThreshold: 16384,
        heapBytes: 8 * 1024 * 1024, maxHeapBytes: 128 * 1024 * 1024});
    var embedding = Object.create(GuestNodeEnvironment.prototype);
    embedding.vm = vm;
    embedding.runtime = vm.runtime;
    embedding.context = vm.context;
    embedding.hostFs = fs;
    embedding.test262ProgramCache = {};
    embedding.test262HarnessTemplate = null;
    embedding.test262Progress = null;
    var base = ["ecma_tests_harness.js", "../../js_tests/tests/shell.js"];
    function visible(result) {
        var value = {}, fields = ["status", "phase", "name", "message", "filename",
            "line", "column", "instructions"];
        for (var index = 0; index < fields.length; index++) {
            value[fields[index]] = vm.runtime.getProperty(result, fields[index]);
        }
        return value;
    }
    /* Prepare only trusted common harness code before workers are forked.
     * No test or directory-specific shell has executed in the supervisor. */
    var preparationFailure = embedding.prepareTest262Harness(base, 20000000);
    return {
        runTest: function (filename, source, harnessFiles, negative, limit) {
            if (preparationFailure) return visible(preparationFailure);
            /* Match Test262's baseline-restore path: merely creating another
             * context in this VM shares intrinsic objects and would let an
             * Array.prototype mutation poison subsequent tests. */
            var context = embedding.instantiateTest262Harness(false);
            var used = 0, loadTimeout = null;
            function execute(text, path, phase, cache, target) {
                var outcome = embedding.runTest262Source(target || context, text,
                    path, Math.max(1, limit - used), cache ? "$" + path : null);
                if (cache && embedding.test262ProgramCache["$" + path]) {
                    vm.runtime.retainProgram(embedding.test262ProgramCache["$" + path]);
                }
                var result = visible(outcome);
                used += Number(result.instructions) || 0;
                if (result.status !== "completed" && phase !== "test") result.phase = phase;
                result.instructions = used;
                return result;
            }
            vm.runtime.setProperty(context.globalObject, "load", vm.runtime.makeHostFunction(
                "load", function (receiver, args) {
                    for (var item = 0; item < args.length; item++) {
                        var relative = String(args[item]);
                        if (relative.charAt(0) === "/" || relative.indexOf("..") >= 0) {
                            throw new Error("load path must be relative to the corpus: " + relative);
                        }
                        var path = "../../js_tests/tests/" + relative;
                        var nested = vm.jsRuntime.createContext();
                        nested.shareGlobalObject(context);
                        try {
                            var result = execute(fs.readFileSync(path, "utf8"), path, "load", true, nested);
                            if (result.status !== "completed") {
                                if (result.status === "timeout") loadTimeout = result;
                                var error = new Error(result.message);
                                error.name = result.name;
                                error.guestFilename = result.filename;
                                error.guestLine = result.line;
                                error.guestColumn = result.column;
                                throw error;
                            }
                        } finally { nested.destroy(); }
                    }
                }));
            try {
                var index, path, result;
                for (index = 0; index < harnessFiles.length; index++) {
                    path = harnessFiles[index];
                    result = execute(fs.readFileSync(path, "utf8"), path, "harness", true);
                    if (result.status !== "completed") return result;
                }
                result = execute(source, filename, "test", false);
                if (loadTimeout) return loadTimeout;
                if (result.status !== "completed" || negative) return result;
                path = "ecma_tests_verify.js";
                return execute(fs.readFileSync(path, "utf8"), path, "assertions", true);
            } finally {
                context.execution = null;
                vm.runtime.heapRecords.setContextActiveFrame(context.heapAddress, 0);
            }
        },
        destroy: function () { vm.destroy(); }
    };
};
