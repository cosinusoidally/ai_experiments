(function (root) {
    var Parser = root.GuestVMParser;
    var Compiler = root.GuestVMCompiler;
    var SemanticRuntime = root.GuestVMRuntime;
    var Execution = root.GuestVMExecution;
    var verify = root.GuestVMVerify;
    var NativeIntrinsics = root.GuestVMNativeIntrinsics;
    var HeapRecords = root.GuestVMHeapRecords;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("./parser.js");
        Compiler = require("./compiler.js");
        SemanticRuntime = require("./runtime.js");
        Execution = require("./interpreter.js");
        verify = require("./verifier.js");
        NativeIntrinsics = require("./native_intrinsics.js");
        HeapRecords = require("./heap_records.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    var BUILTIN_GLOBAL_ATTRIBUTES = 5;

    function JSRuntime(options) {
        this.runtime = new SemanticRuntime(options || {});
        this.contexts = [];
        this.functionConstructorPrograms = {};
        this.destroyed = false;
        var semanticRuntime = this.runtime;
        this.runtime.interpretGuest = function (callable, receiver, args,
                                                context) {
            var execution = Execution.fromFunction(callable, semanticRuntime,
                callable.homeContext || context, receiver, args || []);
            execution.compiledEntry = null;
            semanticRuntime.activeExecutions.push(execution);
            try {
                while (true) {
                    var result = execution.resume(
                        semanticRuntime.synchronousExecutionBudget());
                    if (result.status === "hostCall") execution.serviceHostCall();
                    else if (result.status === "budget") {
                        semanticRuntime.gcSafePoint();
                    } else if (result.status === "completed") return result.value;
                    else if (result.status === "threw") throw result.exception;
                    else throw new Error("guest callback did not complete");
                }
            } finally {
                semanticRuntime.activeExecutions.pop();
            }
        };
        if (this.runtime.threadedCompiler) {
            this.runtime.threadedCompiler.setFallback(function (
                    callable, receiver, args, context) {
                var execution = Execution.fromFunction(
                    callable, semanticRuntime, context, receiver, args);
                execution.compiledEntry = null;
                semanticRuntime.activeExecutions.push(execution);
                try {
                    while (true) {
                        var result = execution.resume(Infinity);
                        if (result.status === "hostCall") execution.serviceHostCall();
                        else if (result.status === "completed") return result.value;
                        else if (result.status === "threw") throw result.exception;
                        else throw new Error("threaded fallback did not complete");
                    }
                } finally {
                    semanticRuntime.activeExecutions.pop();
                }
            });
        }
        this.installContextFunctions();
    }

    JSRuntime.prototype.installContextFunctions = function () {
        var jsRuntime = this;
        var semanticRuntime = this.runtime;
        var functionProgramCache = semanticRuntime.makeObject();
        this.functionProgramCache = functionProgramCache;
        if (semanticRuntime.nativeInterpreter) {
            semanticRuntime.nativeInterpreter.setFunctionProgramCache(
                functionProgramCache);
        }
        var functionConstructor = semanticRuntime.makeNativeFunction(
            "Function", function (receiver, args, callContext) {
                if (!callContext) {
                    throw new Error("Function constructor needs a JSContext");
                }
                var parameterParts = [];
                var argumentIndex = 0;
                while (argumentIndex + 1 < args.length) {
                    parameterParts.push(String(args[argumentIndex++]));
                }
                var body = args.length ? String(args[args.length - 1]) : "";
                var source = "function anonymous(" +
                    parameterParts.join(",") + ") {\n" + body + "\n}";
                var cacheKey = "$" + source;
                var program = own(jsRuntime.functionConstructorPrograms,
                                  cacheKey) ?
                    jsRuntime.functionConstructorPrograms[cacheKey] : null;
                if (!program) {
                    var parsed = new Parser(source, "<Function>").parseProgram();
                    if (!parsed.body.length ||
                        parsed.body[0].type !== "FunctionDeclaration") {
                        throw new SyntaxError(
                            "invalid Function constructor source");
                    }
                    var compiler = new Compiler();
                    compiler.filename = "<Function>";
                    program = verify(
                        compiler.compileFunction(parsed.body[0]));
                    semanticRuntime.retainProgram(program);
                    jsRuntime.functionConstructorPrograms[cacheKey] = program;
                    if (args.length === 1) {
                        var cacheProperty = semanticRuntime.heapRecords.
                            defineOwnProperty(functionProgramCache.heapAddress,
                                semanticRuntime.internStringAddress(body), 7);
                        semanticRuntime.valueCells.writeReferenceAt(
                            semanticRuntime.heapRecords.propertyValueCell(
                                cacheProperty), program.heapAddress);
                    }
                }
                return semanticRuntime.makeGuestFunction(
                    program, null, callContext);
            }, "intrinsic", NativeIntrinsics.FUNCTION_CONSTRUCTOR);
        functionConstructor.constructCallback = function (args, callContext) {
            return functionConstructor.callback(undefined, args, callContext);
        };
        if (semanticRuntime.functionPrototype) {
            semanticRuntime.setProperty(functionConstructor, "prototype",
                                        semanticRuntime.functionPrototype);
            semanticRuntime.setProperty(semanticRuntime.functionPrototype,
                                        "constructor", functionConstructor);
        }
        semanticRuntime.defineDataProperty(
            semanticRuntime.globalObject, "Function", functionConstructor,
            BUILTIN_GLOBAL_ATTRIBUTES);

        var evalFunction = semanticRuntime.makeNativeFunction(
            "eval", function (receiver, args, callContext) {
                var source = args.length ? args[0] : undefined;
                if (typeof source !== "string") return source;
                if (!callContext) {
                    throw new Error("indirect eval needs a JSContext");
                }
                var evalContext = jsRuntime.createContext();
                evalContext.shareGlobalObject(callContext);
                try {
                    return evalContext.runEval(source, "<eval>");
                } finally {
                    evalContext.destroy();
                }
            });
        evalFunction.directEval = true;
        semanticRuntime.defineDataProperty(
            semanticRuntime.globalObject, "eval", evalFunction,
            BUILTIN_GLOBAL_ATTRIBUTES);
    };

    JSRuntime.prototype.createContext = function () {
        if (this.destroyed) throw new Error("runtime has been destroyed");
        this.runtime.prepareContextAllocation();
        var context = new JSContext(this);
        this.contexts.push(context);
        this.runtime.registerContext(context);
        return context;
    };

    JSRuntime.prototype.internString = function (value) {
        return this.runtime.internString(value);
    };

    JSRuntime.prototype.retain = function (value) {
        return this.runtime.retain(value);
    };

    JSRuntime.prototype.retained = function (handle) {
        return this.runtime.retained(handle);
    };

    JSRuntime.prototype.release = function (handle) {
        return this.runtime.release(handle);
    };

    JSRuntime.prototype.collect = function () {
        return this.runtime.collect();
    };

    JSRuntime.prototype.inspectHeapRecord = function (address) {
        return this.runtime.inspectHeapRecord(address);
    };

    JSRuntime.prototype.inspectExecution = function (execution) {
        return this.runtime.inspectExecution(execution);
    };

    JSRuntime.prototype.destroy = function () {
        if (this.destroyed) return;
        while (this.contexts.length) this.contexts[0].destroy();
        this.runtime.destroy();
        this.destroyed = true;
    };

    function JSContext(jsRuntime) {
        this.jsRuntime = jsRuntime;
        this.runtime = jsRuntime.runtime;
        this.globalObject = this.runtime.makeObject();
        this.heapAddress = this.runtime.heapRecords.allocateContext(
            this.globalObject.heapAddress);
        this.execution = null;
        this.destroyed = false;
        this.runtime.cloneOwnProperties(
            this.runtime.globalObject, this.globalObject);
    }

    JSContext.prototype.compile = function (source, filename) {
        if (this.destroyed) throw new Error("context has been destroyed");
        var ast = new Parser(source, filename).parseProgram();
        var program = verify(new Compiler().compile(ast));
        this.runtime.registerProgram(program);
        return program;
    };

    JSContext.prototype.compileEval = function (source, filename, strict,
                                                callerProgram) {
        if (this.destroyed) throw new Error("context has been destroyed");
        var ast = new Parser(source, filename, {strict: !!strict}).parseProgram();
        var callerScope = Compiler.environmentScopeForProgram(callerProgram);
        var outerScopes = callerScope ? [callerScope] : null;
        var program = verify(
            new Compiler(null, outerScopes).compile(ast, true));
        this.runtime.registerProgram(program);
        return program;
    };

    JSContext.prototype.shareGlobalObject = function (otherContext) {
        if (this.destroyed) throw new Error("context has been destroyed");
        if (!otherContext || otherContext.destroyed ||
            otherContext.jsRuntime !== this.jsRuntime) {
            throw new TypeError("shared global must belong to the same JSRuntime");
        }
        this.globalObject = otherContext.globalObject;
        this.runtime.heapRecords.setContextGlobal(
            this.heapAddress, this.globalObject.heapAddress);
    };

    JSContext.prototype.start = function (source, filename) {
        return this.startProgram(this.compile(source, filename));
    };

    JSContext.prototype.startProgram = function (program) {
        if (this.destroyed) throw new Error("context has been destroyed");
        if (this.execution) throw new Error("context already has an active execution");
        var declarationIndex = 0;
        while (program.globalDeclarations &&
               declarationIndex < program.globalDeclarations.length) {
            var declarationName = program.globalDeclarations[declarationIndex++];
            if (!this.runtime.hasOwnProperty(this.globalObject,
                                             declarationName)) {
                this.runtime.defineDataProperty(this.globalObject,
                    declarationName, undefined,
                    HeapRecords.Attributes.WRITABLE |
                    HeapRecords.Attributes.ENUMERABLE);
            }
        }
        this.execution = new Execution(program, this.runtime, this);
        return this.execution;
    };

    JSContext.prototype.startFunction = function (callable, receiver, args) {
        if (this.destroyed) throw new Error("context has been destroyed");
        if (this.execution) throw new Error("context already has an active execution");
        this.execution = Execution.fromFunction(
            callable, this.runtime, this, receiver, args || []);
        return this.execution;
    };

    JSContext.prototype.runProgram = function (program) {
        return this.runExecutionToCompletion(this.startProgram(program));
    };

    JSContext.prototype.evaluateProgram = function (program) {
        if (this.execution) {
            throw new Error("context already has an active execution");
        }
        try {
            return this.runExecutionToCompletion(this.startProgram(program));
        } finally {
            if (this.execution && this.execution.status !== "completed" &&
                this.execution.status !== "threw") {
                this.execution.abort();
            }
            this.execution = null;
            this.runtime.heapRecords.setContextActiveFrame(
                this.heapAddress, 0);
        }
    };

    JSContext.prototype.createSnapshot = function () {
        if (this.destroyed || this.execution) {
            throw new Error("context must be idle before it is snapshotted");
        }
        return {context: this,
                heapState: this.runtime.createHeapStateSnapshot(
                    this.heapAddress)};
    };

    JSContext.prototype.restoreSnapshot = function (snapshot) {
        if (this.destroyed || this.execution || !snapshot ||
            snapshot.context !== this) {
            throw new Error("invalid context snapshot restore");
        }
        this.runtime.restoreHeapStateSnapshot(snapshot.heapState);
        this.runtime.heapRecords.setContextActiveFrame(this.heapAddress, 0);
        return this;
    };

    JSContext.prototype.run = function (source, filename) {
        return this.runExecutionToCompletion(this.start(source, filename));
    };

    JSContext.prototype.runEval = function (source, filename) {
        return this.runExecutionToCompletion(
            this.startProgram(this.compileEval(source, filename)));
    };

    JSContext.prototype.runExecutionToCompletion = function (execution) {
        /* Synchronous embedding does not imply an unbounded engine run.  A
         * finite slice publishes native frames and gives the runtime a safe
         * point at which to service pending collection before resuming. */
        var completionBudget = this.runtime.synchronousExecutionBudget();
        while (true) {
            var result = execution.resume(completionBudget);
            if (result.status === "hostCall") {
                execution.serviceHostCall();
                if (execution.status === "threw") throw execution.exception;
            } else if (result.status === "budget") {
                /* The synchronous embedder immediately grants another slice. */
                this.runtime.gcSafePoint();
            } else if (result.status === "completed") {
                return result.value;
            } else if (result.status === "threw") {
                throw result.exception;
            } else {
                throw new Error("unknown synchronous execution status: " +
                                result.status);
            }
        }
    };

    JSContext.prototype.installGlobal = function (name, value) {
        if (this.destroyed) throw new Error("context has been destroyed");
        return this.runtime.setGlobal(this, name, value);
    };

    JSContext.prototype.makeHostFunction = function (name, callback) {
        return this.runtime.makeHostFunction(name, callback);
    };

    JSContext.prototype.destroy = function () {
        if (this.destroyed) return;
        if (this.execution) this.execution.abort();
        this.runtime.unregisterContext(this);
        var survivors = [];
        var index = 0;
        while (index < this.jsRuntime.contexts.length) {
            if (this.jsRuntime.contexts[index] !== this) {
                survivors.push(this.jsRuntime.contexts[index]);
            }
            index++;
        }
        this.jsRuntime.contexts = survivors;
        this.globalObject = null;
        this.destroyed = true;
    };

    function VM(options) {
        this.jsRuntime = new JSRuntime(options || {});
        this.context = this.jsRuntime.createContext();
        this.runtime = this.jsRuntime.runtime;
    }

    VM.prototype.compile = function (source, filename) {
        return this.context.compile(source, filename);
    };

    VM.prototype.run = function (source, filename) {
        return this.context.run(source, filename);
    };

    VM.prototype.execute = function (program) {
        return this.context.runProgram(program);
    };

    VM.prototype.start = function (source, filename) {
        return this.context.start(source, filename);
    };

    VM.prototype.startProgram = function (program) {
        return this.context.startProgram(program);
    };

    VM.prototype.installGlobal = function (name, value) {
        return this.context.installGlobal(name, value);
    };

    VM.prototype.makeNativeFunction = function (name, callback) {
        return this.context.makeHostFunction(name, callback);
    };

    VM.prototype.retain = function (value) { return this.jsRuntime.retain(value); };
    VM.prototype.retained = function (handle) { return this.jsRuntime.retained(handle); };
    VM.prototype.release = function (handle) { return this.jsRuntime.release(handle); };
    VM.prototype.collect = function () { return this.jsRuntime.collect(); };
    VM.prototype.inspectHeapRecord = function (address) {
        return this.jsRuntime.inspectHeapRecord(address);
    };
    VM.prototype.inspectExecution = function (execution) {
        return this.jsRuntime.inspectExecution(execution);
    };
    VM.prototype.destroy = function () { this.jsRuntime.destroy(); };

    VM.JSRuntime = JSRuntime;
    VM.JSContext = JSContext;
    VM.Execution = Execution;
    root.GuestVM = VM;
    root.GuestVMJSRuntime = JSRuntime;
    root.GuestVMJSContext = JSContext;
    if (typeof module !== "undefined" && module.exports) module.exports = VM;
}(this));
