(function (root) {
    var Parser = root.GuestVMParser;
    var Compiler = root.GuestVMCompiler;
    var SemanticRuntime = root.GuestVMRuntime;
    var Execution = root.GuestVMExecution;
    var verify = root.GuestVMVerify;
    if (typeof module !== "undefined" && module.exports) {
        Parser = require("./parser.js");
        Compiler = require("./compiler.js");
        SemanticRuntime = require("./runtime.js");
        Execution = require("./interpreter.js");
        verify = require("./verifier.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function JSRuntime(options) {
        this.runtime = new SemanticRuntime(options || {});
        this.contexts = [];
        this.destroyed = false;
        if (this.runtime.threadedCompiler) {
            var semanticRuntime = this.runtime;
            this.runtime.threadedCompiler.setFallback(function (
                    callable, receiver, args, context) {
                var execution = Execution.fromFunction(
                    callable, semanticRuntime, context, receiver, args);
                execution.compiledEntry = null;
                while (true) {
                    var result = execution.resume(Infinity);
                    if (result.status === "hostCall") execution.serviceHostCall();
                    else if (result.status === "completed") return result.value;
                    else if (result.status === "threw") throw result.exception;
                    else throw new Error("threaded fallback did not complete");
                }
            });
        }
    }

    JSRuntime.prototype.createContext = function () {
        if (this.destroyed) throw new Error("runtime has been destroyed");
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
        var key;
        var keys = this.runtime.keys(this.runtime.globalObject);
        var index = 0;
        while (index < this.runtime.arrayLength(keys)) {
            key = this.runtime.arrayGet(keys, index++);
            this.runtime.setProperty(this.globalObject, key,
                this.runtime.getProperty(this.runtime.globalObject, key));
        }
    }

    JSContext.prototype.compile = function (source, filename) {
        if (this.destroyed) throw new Error("context has been destroyed");
        var ast = new Parser(source, filename).parseProgram();
        var program = verify(new Compiler().compile(ast));
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
                this.runtime.setProperty(this.globalObject,
                                         declarationName, undefined);
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

    JSContext.prototype.run = function (source, filename) {
        return this.runExecutionToCompletion(this.start(source, filename));
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
