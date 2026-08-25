(function (root) {
    var BufferSupport = root.GuestVMBufferSupport;
    var HostFFI = root.GuestVMHostFFI;
    if (typeof module !== "undefined" && module.exports) {
        BufferSupport = require("./buffer.js");
        HostFFI = require("./host_ffi.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function Runtime(options) {
        options = options || {};
        this.globals = {};
        this.contexts = [];
        this.internedStrings = {};
        this.assertions = 0;
        this.heapObjects = [];
        this.hostRoots = [];
        this.gcGeneration = 0;
        this.gcThreshold = options.gcStress ? 1 :
            normalizeGCThreshold(options.gcThreshold);
        this.gcAllocationDebt = 0;
        this.gcPending = false;
        this.gcCollecting = false;
        this.collectionCount = 0;
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        this.activeRegisters = null;
        this.interpretGuest = null;
        this.installBuiltins();
        this.bufferSupport = new BufferSupport(this);
        if (options.rawFFI) this.installRawFFI();
    }

    Runtime.prototype.makeNativeFunction = function (name, callback, callMode) {
        return {guestType: "function", name: name, callback: callback,
                callMode: callMode || "intrinsic", properties: {},
                ownerRuntime: this};
    };

    Runtime.prototype.makeHostFunction = function (name, callback) {
        return this.makeNativeFunction(name, callback, "host");
    };

    Runtime.prototype.makeObject = function () {
        var object = {guestType: "object", properties: {}, gcMark: 0};
        this.trackObject(object);
        return object;
    };

    Runtime.prototype.makeArray = function () {
        return this.trackObject({guestType: "array", elements: [],
                                 properties: {}, gcMark: 0});
    };

    Runtime.prototype.makeRegExp = function (pattern, flags) {
        return this.trackObject({guestType: "regexp", pattern: pattern,
                                 flags: flags, properties: {}, gcMark: 0});
    };

    Runtime.prototype.makeGuestFunction = function (program, closure, homeContext) {
        return this.trackObject({guestType: "bytecodeFunction", program: program,
                                 closure: closure, properties: {}, gcMark: 0,
                                 name: program.name || "",
                                 homeContext: homeContext});
    };

    Runtime.prototype.makeCallEnvironment = function (program, receiver, args,
                                                       closure, callable) {
        if (!program.parameters.length && !program.locals.length && !closure && !callable) {
            return null;
        }
        var environment = {bindings: {}, parent: closure || null};
        var index = 0;
        while (index < program.locals.length) {
            environment.bindings["$" + program.locals[index]] = undefined;
            index++;
        }
        index = 0;
        while (index < program.parameters.length) {
            environment.bindings["$" + program.parameters[index]] =
                index < args.length ? args[index] : undefined;
            index++;
        }
        environment.bindings.$arguments = this.arrayFrom(args);
        if (program.name) environment.bindings["$" + program.name] = callable;
        return environment;
    };

    Runtime.prototype.getBinding = function (context, environment, name) {
        var current = environment;
        while (current) {
            if (own(current.bindings, "$" + name)) return current.bindings["$" + name];
            current = current.parent;
        }
        return this.getGlobal(context, name);
    };

    Runtime.prototype.setBinding = function (context, environment, name, value) {
        var current = environment;
        while (current) {
            if (own(current.bindings, "$" + name)) {
                current.bindings["$" + name] = value;
                return value;
            }
            current = current.parent;
        }
        return this.setGlobal(context, name, value);
    };

    Runtime.prototype.pushActiveRegisters = function (registers, environment) {
        this.activeRegisterFrames.push(registers);
        this.activeEnvironmentFrames.push(environment);
        this.activeRegisters = registers;
    };

    Runtime.prototype.popActiveRegisters = function () {
        this.activeRegisterFrames.pop();
        this.activeEnvironmentFrames.pop();
        this.activeRegisters = this.activeRegisterFrames.length ?
            this.activeRegisterFrames[this.activeRegisterFrames.length - 1] : null;
    };

    Runtime.prototype.clearActiveRegisters = function () {
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        this.activeRegisters = null;
    };

    Runtime.prototype.trackObject = function (object) {
        object.ownerRuntime = this;
        this.heapObjects.push(object);
        this.noteAllocation(1);
        return object;
    };

    Runtime.prototype.registerContext = function (context) {
        this.contexts.push(context);
    };

    Runtime.prototype.unregisterContext = function (context) {
        var survivors = [];
        var index = 0;
        while (index < this.contexts.length) {
            if (this.contexts[index] !== context) survivors.push(this.contexts[index]);
            index++;
        }
        this.contexts = survivors;
    };

    Runtime.prototype.internString = function (value) {
        value = String(value);
        var key = "$" + value;
        if (!own(this.internedStrings, key)) this.internedStrings[key] = value;
        return this.internedStrings[key];
    };

    Runtime.prototype.noteAllocation = function (units) {
        this.gcAllocationDebt += units > 0 ? units : 1;
        if (this.gcAllocationDebt >= this.gcThreshold) this.gcPending = true;
    };

    Runtime.prototype.gcSafePoint = function () {
        if (this.gcPending && !this.gcCollecting) this.collect();
    };

    Runtime.prototype.retain = function (value) {
        var index = 0;
        while (index < this.hostRoots.length) {
            if (this.hostRoots[index] === null) {
                this.hostRoots[index] = value;
                return index + 1;
            }
            index++;
        }
        this.hostRoots.push(value);
        return this.hostRoots.length;
    };

    Runtime.prototype.retained = function (handle) {
        var index = integerHandle(handle, this.hostRoots.length);
        var value = this.hostRoots[index];
        if (value === null) throw new Error("guest host root has been released");
        return value;
    };

    Runtime.prototype.release = function (handle) {
        var index = integerHandle(handle, this.hostRoots.length);
        if (this.hostRoots[index] === null) {
            throw new Error("guest host root has already been released");
        }
        this.hostRoots[index] = null;
    };

    Runtime.prototype.installBuiltins = function () {
        var runtime = this;
        this.globals.undefined = undefined;
        this.globals.assertEqual = this.makeNativeFunction("assertEqual",
            function (receiver, args) {
                if (args[0] !== args[1]) {
                    throw new Error((args.length > 2 ? args[2] + ": " : "") +
                                    "expected " + args[1] + ", got " + args[0]);
                }
                runtime.assertions++;
                return undefined;
            });
        this.globals.print = this.makeHostFunction("print",
            function (receiver, args) {
                var text = args.length ? String(args[0]) : "";
                if (typeof print === "function") print(text);
                else console.log(text);
                return undefined;
            });
        this.globals.guestCollect = this.makeNativeFunction("guestCollect",
            function () {
                return runtime.collect();
            });
        this.globals.guestBackingStoreCount = this.makeNativeFunction(
            "guestBackingStoreCount", function () {
                return runtime.bufferSupport ?
                       runtime.bufferSupport.liveBackingCount() : 0;
            });
        this.globals.parseInt = this.makeNativeFunction("parseInt",
            function (receiver, args) {
                return parseInt(String(args[0]), args.length > 1 ? Number(args[1]) : undefined);
            });
        this.stringMethods = {};
        this.stringMethods.charAt = this.makeNativeFunction("String.charAt",
            function (receiver, args) { return String(receiver).charAt(Number(args[0]) || 0); });
        this.stringMethods.charCodeAt = this.makeNativeFunction("String.charCodeAt",
            function (receiver, args) { return String(receiver).charCodeAt(Number(args[0]) || 0); });
        this.stringMethods.indexOf = this.makeNativeFunction("String.indexOf",
            function (receiver, args) {
                return String(receiver).indexOf(String(args[0]),
                    args.length > 1 ? Number(args[1]) : 0);
            });
        this.stringMethods.substring = this.makeNativeFunction("String.substring",
            function (receiver, args) {
                return args.length > 1 ? String(receiver).substring(Number(args[0]), Number(args[1])) :
                                         String(receiver).substring(Number(args[0]));
            });
        this.stringMethods.split = this.makeNativeFunction("String.split",
            function (receiver, args) {
                var parts = String(receiver).split(args.length ? String(args[0]) : undefined);
                return runtime.arrayFrom(parts);
            });
        this.stringMethods.replace = this.makeNativeFunction("String.replace",
            function (receiver, args) {
                var search = args[0];
                if (search && search.guestType === "regexp") {
                    search = new RegExp(search.pattern, search.flags);
                }
                return String(receiver).replace(search, String(args[1]));
            });
        this.arrayMethods = {};
        this.arrayMethods.push = this.makeNativeFunction("Array.push",
            function (receiver, args) {
                var index = 0;
                while (index < args.length) receiver.elements.push(args[index++]);
                return receiver.elements.length;
            });
        this.arrayMethods.sort = this.makeNativeFunction("Array.sort",
            function (receiver) {
                receiver.elements.sort();
                return receiver;
            });
        this.regexpMethods = {};
        this.regexpMethods.test = this.makeNativeFunction("RegExp.test",
            function (receiver, args) {
                return new RegExp(receiver.pattern, receiver.flags).test(String(args[0]));
            });
        var stringConstructor = this.makeNativeFunction("String",
            function (receiver, args) { return args.length ? String(args[0]) : ""; });
        stringConstructor.properties.$fromCharCode = this.makeNativeFunction(
            "String.fromCharCode", function (receiver, args) {
                return String.fromCharCode.apply(String, args);
            });
        this.globals.String = stringConstructor;
    };

    Runtime.prototype.installRawFFI = function () {
        var bridge = new HostFFI();
        if (!bridge.isMMVM) {
            throw new Error("raw guest FFI requires the js_min.exe host");
        }
        this.hostFFI = bridge;
        this.setGlobal("get_dlsym", this.makeHostFunction("get_dlsym",
            function () {
                return bridge.getDlsym();
            }));
        this.setGlobal("ffi_call", this.makeHostFunction("ffi_call",
            function (receiver, args) {
                if (!args.length) throw new TypeError("ffi_call requires a pointer");
                var pointer = args[0];
                var callArguments = [];
                var index = 1;
                while (index < args.length) {
                    callArguments.push(args[index]);
                    index++;
                }
                return bridge.call(pointer, callArguments);
            }));
        this.setGlobal("peek8", this.makeNativeFunction("peek8",
            function (receiver, args) { return bridge.peek8(args[0]); }));
        this.setGlobal("poke8", this.makeNativeFunction("poke8",
            function (receiver, args) { return bridge.poke8(args[0], args[1]); }));
        this.setGlobal("peek32", this.makeNativeFunction("peek32",
            function (receiver, args) { return bridge.peek32(args[0]); }));
        this.setGlobal("poke32", this.makeNativeFunction("poke32",
            function (receiver, args) { return bridge.poke32(args[0], args[1]); }));
        this.setGlobal("quit", this.makeHostFunction("quit",
            function (receiver, args) {
                quit(args.length ? Number(args[0]) : 0);
                return undefined;
            }));
    };

    Runtime.prototype.getGlobal = function (context, name) {
        if (arguments.length === 1) {
            name = context;
            context = this.contexts.length ? this.contexts[0] : null;
        }
        var globals = context ? context.globals : this.globals;
        if (!own(globals, name)) throw new ReferenceError(name + " is not defined");
        return globals[name];
    };

    Runtime.prototype.setGlobal = function (context, name, value) {
        if (arguments.length === 2) {
            value = name;
            name = context;
            context = null;
        }
        this.assertOwned(value);
        (context ? context.globals : this.globals)[name] = value;
        return value;
    };

    Runtime.prototype.assertOwned = function (value) {
        if (value && value.guestType && value.ownerRuntime &&
            value.ownerRuntime !== this) {
            throw new TypeError("guest value belongs to a different JSRuntime");
        }
    };

    Runtime.prototype.propertyKey = function (value) {
        return this.internString(value);
    };

    Runtime.prototype.getProperty = function (object, key) {
        this.assertOwned(object);
        key = this.propertyKey(key);
        if (object === null || object === undefined) {
            throw new TypeError("cannot read property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.getProperty(object, key);
        }
        if (object.guestType === "array") {
            if (key === "length") return object.elements.length;
            if (isArrayIndex(key)) return object.elements[Number(key)];
            if (own(object.properties, "$" + key)) return object.properties["$" + key];
            return this.arrayMethods[key];
        }
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            if (own(object.properties, "$" + key)) return object.properties["$" + key];
            if (object.guestType === "regexp") return this.regexpMethods[key];
            return undefined;
        }
        if (typeof object === "string") {
            if (key === "length") return object.length;
            if (isArrayIndex(key)) return object.charAt(Number(key));
            return this.stringMethods[key];
        }
        return undefined;
    };

    Runtime.prototype.setProperty = function (object, key, value) {
        this.assertOwned(object);
        this.assertOwned(value);
        key = this.propertyKey(key);
        if (object === null || object === undefined) {
            throw new TypeError("cannot set property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.setProperty(object, key, value);
        }
        if (object.guestType === "array") {
            if (isArrayIndex(key)) object.elements[Number(key)] = value;
            else object.properties["$" + key] = value;
            return value;
        }
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            object.properties["$" + key] = value;
            return value;
        }
        throw new TypeError("property target is not an object");
    };

    Runtime.prototype.add = function (left, right) {
        if (typeof left === "string" || typeof right === "string") {
            return String(left) + String(right);
        }
        return Number(left) + Number(right);
    };

    Runtime.prototype.equal = function (left, right) {
        if (left === right) return true;
        if (left === null && right === undefined) return true;
        if (left === undefined && right === null) return true;
        if (typeof left === "number" && typeof right === "string") {
            return left === Number(right);
        }
        if (typeof left === "string" && typeof right === "number") {
            return Number(left) === right;
        }
        if (typeof left === "boolean") return Number(left) == right;
        if (typeof right === "boolean") return left == Number(right);
        return false;
    };

    Runtime.prototype.call = function (callable, receiver, args) {
        this.assertOwned(callable);
        this.assertOwned(receiver);
        if (!callable || callable.guestType !== "function") {
            throw new TypeError("value is not callable");
        }
        if (callable.callMode === "host") {
            throw new Error("external host function must be serviced by the embedder");
        }
        return callable.callback(receiver, args);
    };

    Runtime.prototype.truthy = function (value) {
        return !!value;
    };

    Runtime.prototype.markValue = function (value, generation) {
        if (!value || (value.guestType !== "object" && value.guestType !== "array" &&
                       value.guestType !== "function" &&
                       value.guestType !== "bytecodeFunction" && value.guestType !== "regexp" &&
                       value.guestType !== "buffer")) return;
        if (value.gcMark === generation) return;
        value.gcMark = generation;
        if (value.guestType === "buffer") {
            this.bufferSupport.markView(value, generation);
            this.markValue(value.prototype, generation);
        }
        if (value.guestType === "array") {
            var elementIndex = 0;
            while (elementIndex < value.elements.length) {
                this.markValue(value.elements[elementIndex], generation);
                elementIndex++;
            }
        }
        if (value.guestType === "bytecodeFunction") this.markEnvironment(value.closure, generation);
        var properties = value.properties;
        var key;
        for (key in properties) {
            if (own(properties, key)) this.markValue(properties[key], generation);
        }
    };

    Runtime.prototype.collect = function () {
        if (this.gcCollecting) return this.heapObjects.length;
        this.gcCollecting = true;
        try {
            this.gcGeneration++;
            var generation = this.gcGeneration;
            var key;
            for (key in this.globals) {
                if (own(this.globals, key)) this.markValue(this.globals[key], generation);
            }
            this.markValue(this.bufferSupport.prototype, generation);
            var hostRootIndex = 0;
            while (hostRootIndex < this.hostRoots.length) {
                if (this.hostRoots[hostRootIndex] !== null) {
                    this.markValue(this.hostRoots[hostRootIndex], generation);
                }
                hostRootIndex++;
            }
            var frameIndex = 0;
            while (frameIndex < this.activeRegisterFrames.length) {
                var registerIndex = 0;
                while (registerIndex < this.activeRegisterFrames[frameIndex].length) {
                    this.markValue(this.activeRegisterFrames[frameIndex][registerIndex], generation);
                    registerIndex++;
                }
                frameIndex++;
            }
            frameIndex = 0;
            while (frameIndex < this.activeEnvironmentFrames.length) {
                this.markEnvironment(this.activeEnvironmentFrames[frameIndex], generation);
                frameIndex++;
            }
            var contextIndex = 0;
            while (contextIndex < this.contexts.length) {
                var context = this.contexts[contextIndex];
                for (key in context.globals) {
                    if (own(context.globals, key)) {
                        this.markValue(context.globals[key], generation);
                    }
                }
                if (context.execution) markExecution(context.execution, generation, this);
                contextIndex++;
            }
            var survivors = [];
            var index = 0;
            while (index < this.heapObjects.length) {
                if (this.heapObjects[index].gcMark === generation) {
                    survivors.push(this.heapObjects[index]);
                }
                index++;
            }
            this.heapObjects = survivors;
            this.bufferSupport.sweep(generation);
            this.gcAllocationDebt = 0;
            this.gcPending = false;
            this.collectionCount++;
            return survivors.length;
        } finally {
            this.gcCollecting = false;
        }
    };

    Runtime.prototype.destroy = function () {
        this.bufferSupport.destroy();
        this.heapObjects = [];
        this.hostRoots = [];
        this.contexts = [];
        this.internedStrings = {};
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        this.activeRegisters = null;
        this.gcPending = false;
        this.gcCollecting = false;
    };

    Runtime.prototype.markEnvironment = function (environment, generation) {
        var current = environment;
        while (current) {
            var key;
            for (key in current.bindings) {
                if (own(current.bindings, key)) this.markValue(current.bindings[key], generation);
            }
            current = current.parent;
        }
    };

    Runtime.prototype.arrayFrom = function (values) {
        var array = this.makeArray();
        var index = 0;
        while (index < values.length) {
            array.elements[index] = values[index];
            index++;
        }
        return array;
    };

    function isArrayIndex(key) {
        if (key === "") return false;
        var number = Number(key);
        return number >= 0 && number === Math.floor(number) && String(number) === key;
    }

    function integerHandle(handle, length) {
        handle = Number(handle);
        if (handle !== Math.floor(handle) || handle < 1 || handle > length) {
            throw new Error("invalid guest host root handle");
        }
        return handle - 1;
    }

    function normalizeGCThreshold(value) {
        if (value === undefined) return 1024;
        value = Number(value);
        if (value < 1 || value !== Math.floor(value)) {
            throw new RangeError("gcThreshold must be a positive integer");
        }
        return value;
    }

    function markExecution(execution, generation, runtime) {
        var frameIndex = 0;
        while (frameIndex < execution.frames.length) {
            var frame = execution.frames[frameIndex];
            var registerIndex = 0;
            while (registerIndex < frame.registers.length) {
                runtime.markValue(frame.registers[registerIndex], generation);
                registerIndex++;
            }
            runtime.markEnvironment(frame.environment, generation);
            frameIndex++;
        }
        if (execution.pendingHostCall) {
            runtime.markValue(execution.pendingHostCall.receiver, generation);
            var index = 0;
            while (index < execution.pendingHostCall.args.length) {
                runtime.markValue(execution.pendingHostCall.args[index], generation);
                index++;
            }
        }
    }

    root.GuestVMRuntime = Runtime;
    if (typeof module !== "undefined" && module.exports) module.exports = Runtime;
}(this));
