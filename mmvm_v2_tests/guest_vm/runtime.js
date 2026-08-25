(function (root) {
    var BufferSupport = root.GuestVMBufferSupport;
    var HostFFI = root.GuestVMHostFFI;
    var Heap = root.GuestVMHeap;
    var ValueCells = root.GuestVMValueCells;
    var ThreadedCompiler = root.GuestVMThreadedCompiler;
    if (typeof module !== "undefined" && module.exports) {
        BufferSupport = require("./buffer.js");
        HostFFI = require("./host_ffi.js");
        Heap = require("./heap.js");
        ValueCells = require("./value_cell.js");
        ThreadedCompiler = require("./threaded_compiler.js");
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
        this.linearHeap = null;
        this.valueCells = null;
        this.linearHeapBytes = options.heapBytes === undefined ?
            16 * 1024 * 1024 : Number(options.heapBytes);
        this.profileOpcodeCounts = options.profile ? [] : null;
        this.profileFunctionCounts = options.profile ? {} : null;
        this.profileInstructionCount = 0;
        this.profileNextReport = 1000000;
        this.threadedCompiler = options.threadedCompile ?
            new ThreadedCompiler(this) : null;
        this.installBuiltins();
        this.bufferSupport = new BufferSupport(this);
        if (options.rawFFI) this.installRawFFI();
    }

    Runtime.prototype.ensureLinearHeap = function () {
        if (!this.linearHeap) {
            this.linearHeap = new Heap({heapBytes: this.linearHeapBytes});
            this.valueCells = new ValueCells(this.linearHeap);
        }
        return this.linearHeap;
    };

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
        var prototype = this.makeObject();
        var callable = this.trackObject({guestType: "bytecodeFunction", program: program,
                                 closure: closure, properties: {}, gcMark: 0,
                                 name: program.name || "",
                                 homeContext: homeContext});
        callable.properties.$prototype = prototype;
        prototype.properties.$constructor = callable;
        return callable;
    };

    Runtime.prototype.makeCallEnvironment = function (program, receiver, args,
                                                       closure, callable) {
        if (program.bindingRegisters) return closure || null;
        if (!program.bindings && !closure && !callable) {
            return null;
        }
        var bindings = program.bindings || [];
        var slots = [];
        var index = 0;
        while (index < bindings.length) slots[index++] = undefined;
        var environment = {slots: slots,
                           bindingSlots: program.bindingSlots || {},
                           parent: closure || null};
        index = 0;
        while (index < program.parameters.length) {
            slots[program.parameterSlots[index]] =
                index < args.length ? args[index] : undefined;
            index++;
        }
        slots[program.argumentsSlot] = this.arrayFrom(args);
        slots[program.thisSlot] = receiver;
        if (program.functionNameSlot >= 0) slots[program.functionNameSlot] = callable;
        return environment;
    };

    Runtime.prototype.initializeFrameRegisters = function (program, registers,
                                                            receiver, args, callable) {
        var constantRegisters = program.constantRegisters || [];
        var constantIndex = 0;
        while (constantIndex < constantRegisters.length) {
            if (constantRegisters[constantIndex] !== undefined) {
                registers[constantRegisters[constantIndex]] =
                    program.constants[constantIndex];
            }
            constantIndex++;
        }
        var bindingRegisters = program.bindingRegisters;
        if (!bindingRegisters) return;
        var index = 0;
        while (index < bindingRegisters.length) {
            registers[bindingRegisters[index++]] = undefined;
        }
        index = 0;
        while (index < program.parameterSlots.length) {
            registers[bindingRegisters[program.parameterSlots[index]]] =
                index < args.length ? args[index] : undefined;
            index++;
        }
        registers[bindingRegisters[program.argumentsSlot]] = this.arrayFrom(args);
        registers[bindingRegisters[program.thisSlot]] = receiver;
        if (program.functionNameSlot >= 0) {
            registers[bindingRegisters[program.functionNameSlot]] = callable;
        }
    };

    Runtime.prototype.getBinding = function (context, environment, name) {
        var current = environment;
        while (current) {
            var slot = current.bindingSlots["$" + name];
            if (slot !== undefined) return current.slots[slot];
            current = current.parent;
        }
        return this.getGlobal(context, name);
    };

    Runtime.prototype.setBinding = function (context, environment, name, value) {
        var current = environment;
        while (current) {
            var slot = current.bindingSlots["$" + name];
            if (slot !== undefined) {
                current.slots[slot] = value;
                return value;
            }
            current = current.parent;
        }
        return this.setGlobal(context, name, value);
    };

    Runtime.prototype.getEnvironmentSlot = function (environment, depth, slot) {
        while (depth > 0) {
            environment = environment.parent;
            depth--;
        }
        if (!environment || slot < 0 || slot >= environment.slots.length) {
            throw new Error("invalid lexical environment slot");
        }
        return environment.slots[slot];
    };

    Runtime.prototype.setEnvironmentSlot = function (environment, depth, slot, value) {
        this.assertOwned(value);
        while (depth > 0) {
            environment = environment.parent;
            depth--;
        }
        if (!environment || slot < 0 || slot >= environment.slots.length) {
            throw new Error("invalid lexical environment slot");
        }
        environment.slots[slot] = value;
        return value;
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

    Runtime.prototype.countOpcode = function (opcode, functionName) {
        var counts = this.profileOpcodeCounts;
        if (!counts) return;
        counts[opcode] = (counts[opcode] || 0) + 1;
        this.profileInstructionCount++;
        functionName = functionName || "<program>";
        this.profileFunctionCounts["$" + functionName] =
            (this.profileFunctionCounts["$" + functionName] || 0) + 1;
        if (this.profileInstructionCount >= this.profileNextReport) {
            this.reportProfile();
            this.profileNextReport += 1000000;
        }
    };

    Runtime.prototype.reportProfile = function () {
        if (!this.profileOpcodeCounts) return;
        var names = root.GuestVMBytecode && root.GuestVMBytecode.NAMES;
        if (!names && typeof require === "function") names = require("./bytecode.js").NAMES;
        var parts = [];
        var opcode = 1;
        while (opcode < this.profileOpcodeCounts.length) {
            if (this.profileOpcodeCounts[opcode]) {
                parts.push((names && names[opcode] ? names[opcode] : opcode) + "=" +
                           this.profileOpcodeCounts[opcode]);
            }
            opcode++;
        }
        var line = "guest VM profile: instructions=" + this.profileInstructionCount +
                   " " + parts.join(" ");
        if (typeof print === "function") print(line);
        else if (typeof console !== "undefined" && console.log) console.log(line);
        var functions = [];
        var functionKey;
        for (functionKey in this.profileFunctionCounts) {
            if (own(this.profileFunctionCounts, functionKey)) {
                functions.push({name: functionKey.substring(1),
                                count: this.profileFunctionCounts[functionKey]});
            }
        }
        functions.sort(function (left, right) { return right.count - left.count; });
        var functionParts = [];
        var functionIndex = 0;
        while (functionIndex < functions.length && functionIndex < 12) {
            functionParts.push(functions[functionIndex].name + "=" +
                               functions[functionIndex].count);
            functionIndex++;
        }
        var functionLine = "guest VM profile functions: " + functionParts.join(" ");
        if (typeof print === "function") print(functionLine);
        else if (typeof console !== "undefined" && console.log) console.log(functionLine);
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
        this.stringMethods.toLowerCase = this.makeNativeFunction("String.toLowerCase",
            function (receiver) { return String(receiver).toLowerCase(); });
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
        this.stringMethods.toUpperCase = this.makeNativeFunction("String.toUpperCase",
            function (receiver) { return String(receiver).toUpperCase(); });
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
        this.arrayMethods.reverse = this.makeNativeFunction("Array.reverse",
            function (receiver) {
                receiver.elements.reverse();
                return receiver;
            });
        this.arrayMethods.unshift = this.makeNativeFunction("Array.unshift",
            function (receiver, args) {
                var index = args.length - 1;
                while (index >= 0) receiver.elements.unshift(args[index--]);
                return receiver.elements.length;
            });
        this.arrayMethods.slice = this.makeNativeFunction("Array.slice",
            function (receiver, args) {
                var start = args.length ? Number(args[0]) : 0;
                var end = args.length > 1 ? Number(args[1]) : receiver.elements.length;
                return runtime.arrayFrom(receiver.elements.slice(start, end));
            });
        this.objectMethods = {};
        this.objectMethods.hasOwnProperty = this.makeNativeFunction(
            "Object.hasOwnProperty", function (receiver, args) {
                return runtime.hasOwnProperty(receiver, String(args[0]));
            });
        this.numberMethods = {};
        this.numberMethods.toString = this.makeNativeFunction("Number.toString",
            function (receiver, args) {
                return Number(receiver).toString(args.length ? Number(args[0]) : 10);
            });
        this.numberMethods.toFixed = this.makeNativeFunction("Number.toFixed",
            function (receiver, args) {
                return Number(receiver).toFixed(args.length ? Number(args[0]) : 0);
            });
        this.regexpMethods = {};
        this.regexpMethods.test = this.makeNativeFunction("RegExp.test",
            function (receiver, args) {
                return new RegExp(receiver.pattern, receiver.flags).test(String(args[0]));
            });
        this.regexpMethods.exec = this.makeNativeFunction("RegExp.exec",
            function (receiver, args) {
                var match = new RegExp(receiver.pattern, receiver.flags).exec(String(args[0]));
                if (!match) return null;
                var result = runtime.arrayFrom(match);
                result.properties.$index = match.index;
                result.properties.$input = match.input;
                return result;
            });
        var stringConstructor = this.makeNativeFunction("String",
            function (receiver, args) { return args.length ? String(args[0]) : ""; });
        stringConstructor.properties.$fromCharCode = this.makeNativeFunction(
            "String.fromCharCode", function (receiver, args) {
                return String.fromCharCode.apply(String, args);
            });
        this.globals.String = stringConstructor;
        this.globals.Number = this.makeNativeFunction("Number",
            function (receiver, args) { return args.length ? Number(args[0]) : 0; });
        this.globals.Array = this.makeNativeFunction("Array",
            function (receiver, args) {
                var array = runtime.makeArray();
                if (args.length === 1 && typeof args[0] === "number") {
                    var length = Number(args[0]);
                    if (length < 0 || length !== Math.floor(length)) {
                        throw new RangeError("invalid array length");
                    }
                    array.elements.length = length;
                } else {
                    var index = 0;
                    while (index < args.length) array.elements[index] = args[index++];
                }
                return array;
            });
        var math = this.makeObject();
        function mathMethod(name, callback) {
            runtime.setProperty(math, name,
                runtime.makeNativeFunction("Math." + name, callback));
        }
        mathMethod("floor", function (receiver, args) { return Math.floor(Number(args[0])); });
        mathMethod("ceil", function (receiver, args) { return Math.ceil(Number(args[0])); });
        mathMethod("round", function (receiver, args) { return Math.round(Number(args[0])); });
        mathMethod("sqrt", function (receiver, args) { return Math.sqrt(Number(args[0])); });
        mathMethod("sin", function (receiver, args) { return Math.sin(Number(args[0])); });
        mathMethod("cos", function (receiver, args) { return Math.cos(Number(args[0])); });
        mathMethod("exp", function (receiver, args) { return Math.exp(Number(args[0])); });
        mathMethod("abs", function (receiver, args) { return Math.abs(Number(args[0])); });
        mathMethod("pow", function (receiver, args) {
            return Math.pow(Number(args[0]), Number(args[1]));
        });
        mathMethod("min", function (receiver, args) { return Math.min.apply(Math, args); });
        mathMethod("max", function (receiver, args) { return Math.max.apply(Math, args); });
        this.globals.Math = math;
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
        /* Primitive strings have value identity. Avoid re-interning the already
         * canonical string constants used by almost every property opcode. */
        return typeof value === "string" ? value : String(value);
    };

    Runtime.prototype.getProperty = function (object, key) {
        this.assertOwned(object);
        if (object === null || object === undefined) {
            throw new TypeError("cannot read property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.getProperty(object, key);
        }
        if (object.guestType === "array") {
            if (isDirectArrayIndex(key)) return object.elements[key];
            key = this.propertyKey(key);
            if (key === "length") return object.elements.length;
            if (isArrayIndex(key)) return object.elements[Number(key)];
            if (own(object.properties, "$" + key)) return object.properties["$" + key];
            return this.arrayMethods[key];
        }
        key = this.propertyKey(key);
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            if (own(object.properties, "$" + key)) return object.properties["$" + key];
            if (object.guestType === "regexp") return this.regexpMethods[key];
            if (object.prototype) {
                var inherited = this.getProperty(object.prototype, key);
                if (inherited !== undefined) return inherited;
            }
            return this.objectMethods[key];
        }
        if (typeof object === "string") {
            if (key === "length") return object.length;
            if (isArrayIndex(key)) return object.charAt(Number(key));
            return this.stringMethods[key];
        }
        if (typeof object === "number") return this.numberMethods[key];
        return undefined;
    };

    Runtime.prototype.hasOwnProperty = function (object, key) {
        key = this.propertyKey(key);
        if (!object || !object.guestType) return false;
        if (object.guestType === "array" && isArrayIndex(key)) {
            return Number(key) < object.elements.length;
        }
        if (object.guestType === "buffer" && isArrayIndex(key)) {
            return Number(key) < object.length;
        }
        return !!object.properties && own(object.properties, "$" + key);
    };

    Runtime.prototype.deleteProperty = function (object, key) {
        this.assertOwned(object);
        key = this.propertyKey(key);
        if (!object || !object.guestType) return true;
        if (object.guestType === "array" && isArrayIndex(key)) {
            delete object.elements[Number(key)];
            return true;
        }
        if (object.properties) delete object.properties["$" + key];
        return true;
    };

    Runtime.prototype.keys = function (object) {
        this.assertOwned(object);
        var values = [];
        var index;
        if (object && object.guestType === "array") {
            for (index = 0; index < object.elements.length; index++) {
                if (index in object.elements) values.push(String(index));
            }
        }
        var key;
        if (object && object.properties) {
            for (key in object.properties) {
                if (own(object.properties, key) && key.charAt(0) === "$") {
                    values.push(key.substring(1));
                }
            }
        }
        return this.arrayFrom(values);
    };

    Runtime.prototype.typeOf = function (value) {
        if (value === undefined) return "undefined";
        if (value === null) return "object";
        if (value && (value.guestType === "function" ||
                      value.guestType === "bytecodeFunction")) return "function";
        if (value && value.guestType) return "object";
        return typeof value;
    };

    Runtime.prototype.setProperty = function (object, key, value) {
        this.assertOwned(object);
        this.assertOwned(value);
        if (object === null || object === undefined) {
            throw new TypeError("cannot set property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.setProperty(object, key, value);
        }
        if (object.guestType === "array") {
            if (isDirectArrayIndex(key)) {
                object.elements[key] = value;
                return value;
            }
            key = this.propertyKey(key);
            if (isArrayIndex(key)) object.elements[Number(key)] = value;
            else object.properties["$" + key] = value;
            return value;
        }
        key = this.propertyKey(key);
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

    Runtime.prototype.construct = function (callable, args) {
        this.assertOwned(callable);
        if (!callable || callable.guestType !== "function") {
            throw new TypeError("value is not a constructor");
        }
        if (callable.callMode === "host") {
            throw new Error("external host constructor must be serviced by the embedder");
        }
        var receiver = this.makeObject();
        var value = callable.constructCallback ?
            callable.constructCallback(args) : callable.callback(receiver, args);
        return value && value.guestType ? value : receiver;
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
        if (value.prototype) this.markValue(value.prototype, generation);
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
        if (this.linearHeap) this.linearHeap.destroy();
        this.linearHeap = null;
        this.valueCells = null;
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
            var index = 0;
            while (index < current.slots.length) {
                this.markValue(current.slots[index], generation);
                index++;
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
        if (isDirectArrayIndex(key)) return true;
        if (key === "") return false;
        var number = Number(key);
        return number >= 0 && number === Math.floor(number) && String(number) === key;
    }

    function isDirectArrayIndex(key) {
        return typeof key === "number" && key >= 0 &&
               key < 4294967295 && key === Math.floor(key);
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
