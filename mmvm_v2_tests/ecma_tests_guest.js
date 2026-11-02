/* Guest-executed embedding, reusing the Test262 realm lifecycle and bounded
 * execution primitives. No host Node engine supplies test semantics. */
exports.create = function (fs, options) {
    options = options || {};
    if (typeof GuestVM !== "function" || typeof GuestNodeEnvironment !== "function") {
        throw new Error("ECMA guest tests require a generic standalone snapshot");
    }
    if (typeof GuestVM.prototype.installStandardLibrary !== "function") {
        throw new Error("ECMA guest tests need the shared standard-library API; rebuild the snapshot");
    }
    var vm = new GuestVM({rawFFI: true, nativeInterpreter: true, gcThreshold: 16384,
        heapBytes: 8 * 1024 * 1024, maxHeapBytes: 128 * 1024 * 1024});
    vm.installStandardLibrary(function (filename) {
        return fs.readFileSync(filename, "utf8");
    });
    var embedding = Object.create(GuestNodeEnvironment.prototype);
    embedding.vm = vm;
    embedding.runtime = vm.runtime;
    embedding.context = vm.context;
    embedding.hostFs = fs;
    embedding.test262ProgramCache = {};
    embedding.test262HarnessTemplate = null;
    embedding.test262Progress = null;
    var functionSamples = {};
    var sampleReported = 0;
    if (options.sampleFunctions) {
        embedding.test262Sample = function (execution) {
            var frames = vm.inspectNativeFrames(1);
            if (!frames.length) return;
            var frame = frames[0], key = "$" + frame.program + ":" + frame.sourcePreview;
            if (!functionSamples[key]) functionSamples[key] = {
                source: frame.sourcePreview || frame.name || "<script>", count: 0, pcs: {}};
            functionSamples[key].count++;
            var pcKey = "$" + frame.pc;
            functionSamples[key].pcs[pcKey] = (functionSamples[key].pcs[pcKey] || 0) + 1;
            var now = new Date().getTime();
            if (now - sampleReported >= 5000) {
                sampleReported = now;
                console.log("  progress: instructions=" + execution.totalInstructions +
                    " collections=" + vm.runtime.collectionCount +
                    " heap=" + vm.runtime.linearHeap.bump +
                    " pc=" + frame.pc + " source=" + frame.sourcePreview.replace(/[\r\n]+/g, " "));
            }
        };
    }
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
    var harnessSources = {};
    function readHarness(filename) {
        var key = "$" + filename;
        return Object.prototype.hasOwnProperty.call(harnessSources, key) ?
            harnessSources[key] : fs.readFileSync(filename, "utf8");
    }
    return {
        /* Compile only shared support scripts, before fork. Do not execute
         * directory setup here: its side effects still belong to each test.
         * Retention keeps immutable programs alive across baseline restore.
         * A failed warmup is retried/reported normally inside each worker. */
        prepareHarnesses: function (filenames) {
            var compiled = 0;
            if (preparationFailure) return compiled;
            var context = embedding.test262HarnessTemplate.context;
            for (var index = 0; index < filenames.length; index++) {
                var filename = filenames[index], key = "$" + filename;
                if (Object.prototype.hasOwnProperty.call(harnessSources, key)) continue;
                try {
                    var source = fs.readFileSync(filename, "utf8");
                    var program = context.compile(source, filename);
                    vm.runtime.retainProgram(program);
                    embedding.test262ProgramCache[key] = program;
                    harnessSources[key] = source;
                    compiled++;
                } catch (error) {
                    /* Preserve per-file harness failure accounting. */
                }
            }
            return compiled;
        },
        runTest: function (filename, source, harnessFiles, negative, limit) {
            functionSamples = {};
            sampleReported = new Date().getTime();
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
                    result = execute(readHarness(path), path, "harness", true);
                    if (result.status !== "completed") return result;
                }
                result = execute(source, filename, "test", false);
                if (loadTimeout) return loadTimeout;
                if (result.status !== "completed" || negative) return result;
                path = "ecma_tests_verify.js";
                return execute(readHarness(path), path, "assertions", true);
            } finally {
                if (options.sampleFunctions) {
                    var samples = [], key;
                    for (key in functionSamples) {
                        if (Object.prototype.hasOwnProperty.call(functionSamples, key)) {
                            samples.push(functionSamples[key]);
                        }
                    }
                    samples.sort(function (a, b) { return b.count - a.count; });
                    var reportLimit = 10;
                    for (var sample = 0; sample < samples.length && sample < reportLimit; sample++) {
                        console.log("  function samples " + samples[sample].count + ": " +
                            samples[sample].source.replace(/[\r\n]+/g, " "));
                        var pcRows = [], pc;
                        for (pc in samples[sample].pcs) {
                            if (Object.prototype.hasOwnProperty.call(samples[sample].pcs, pc)) {
                                pcRows.push({pc: pc.substring(1), count: samples[sample].pcs[pc]});
                            }
                        }
                        pcRows.sort(function (a, b) { return b.count - a.count; });
                        for (var row = 0; row < pcRows.length && row < reportLimit; row++) {
                            console.log("    pc " + pcRows[row].pc + ": " + pcRows[row].count);
                        }
                    }
                }
                context.execution = null;
                vm.runtime.heapRecords.setContextActiveFrame(context.heapAddress, 0);
            }
        },
        destroy: function () { vm.destroy(); }
    };
};
