(function (root) {
    var BufferSupport = root.GuestVMBufferSupport;
    var HostFFI = root.GuestVMHostFFI;
    var Heap = root.GuestVMHeap;
    var ValueCells = root.GuestVMValueCells;
    var HeapRecords = root.GuestVMHeapRecords;
    var ThreadedCompiler = root.GuestVMThreadedCompiler;
    var RecordInitializer = root.GuestVMRecordInitializer;
    var HeapSweeper = root.GuestVMHeapSweeper;
    var NumericBytecodeBackend = root.GuestVMNumericBytecodeBackend;
    var NativeInterpreter = root.GuestVMNativeInterpreter;
    var NativeIntrinsics = root.GuestVMNativeIntrinsics;
    if (typeof module !== "undefined" && module.exports) {
        BufferSupport = require("./buffer.js");
        HostFFI = require("./host_ffi.js");
        Heap = require("./heap.js");
        ValueCells = require("./value_cell.js");
        HeapRecords = require("./heap_records.js");
        ThreadedCompiler = require("./threaded_compiler.js");
        RecordInitializer = require("./aot/record_initializer.js");
        HeapSweeper = require("./aot/heap_sweeper.js");
        NumericBytecodeBackend = require("./aot/bytecode_numeric_backend.js");
        NativeInterpreter = require("./aot/native_interpreter.js");
        NativeIntrinsics = require("./native_intrinsics.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function Runtime(options) {
        options = options || {};
        this.contexts = [];
        this.internedStrings = {};
        /* Strings are immutable. This is a decoded representation cache keyed
         * only by the authoritative heap address, never semantic storage. */
        this.decodedStrings = {};
        this.assertions = 0;
        this.heapObjects = [];
        this.heapHandles = {};
        this.functionMetadata = {};
        this.environmentMetadata = {};
        /* Derived lookup metadata only: cached entries name heap records and
         * never contain property values. */
        this.propertyAddressCache = {};
        this.programObjects = [];
        this.programAddresses = [];
        this.programMetadata = {};
        this.hostRoots = [];
        this.gcGeneration = 0;
        this.gcThreshold = options.gcStress ? 1 :
            normalizeGCThreshold(options.gcThreshold);
        this.gcAllocationDebt = 0;
        this.gcPending = false;
        this.gcCollecting = false;
        this.compiledDepth = 0;
        this.collectionCount = 0;
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        this.activeRegisters = null;
        this.interpretGuest = null;
        this.linearHeap = null;
        this.valueCells = null;
        this.heapSweeper = null;
        this.heapRecords = null;
        this.linearHeapBytes = options.heapBytes === undefined ?
            16 * 1024 * 1024 : Number(options.heapBytes);
        this.profileOpcodeCounts = options.profile ? [] : null;
        this.profileFunctionCounts = options.profile ? {} : null;
        this.profileInstructionCount = 0;
        this.profileNextReport = 1000000;
        this.heapNativeBuiltins = !!options.nativeInterpreter;
        this.threadedCompiler = options.threadedCompile ?
            new ThreadedCompiler(this) : null;
        this.ensureLinearHeap();
        this.globalObject = this.makeObject();
        this.numericBytecodeBackend = options.threadedCompile ?
            new NumericBytecodeBackend(this) : null;
        this.nativeCompilations = [];
        this.installBuiltins();
        this.bufferSupport = new BufferSupport(this);
        this.nativeInterpreter = options.nativeInterpreter ?
            new NativeInterpreter(this) : null;
        if (options.rawFFI) this.installRawFFI();
    }

    Runtime.prototype.ensureLinearHeap = function () {
        if (!this.linearHeap) {
            this.linearHeap = new Heap({heapBytes: this.linearHeapBytes,
                collectorWorkspace: true});
            this.valueCells = new ValueCells(this.linearHeap);
            this.heapRecords = new HeapRecords(this.linearHeap, this.valueCells);
            this.linearHeap.setRecordInitializer(
                new RecordInitializer(this.linearHeap));
            this.heapSweeper = new HeapSweeper(this.linearHeap);
        }
        return this.linearHeap;
    };

    Runtime.prototype.makeNativeFunction = function (name, callback, callMode,
                                                      intrinsicId) {
        this.ensureLinearHeap();
        var address = this.heapRecords.allocateFunction(
            true, 0, 0, intrinsicId || NativeIntrinsics.NONE);
        var callable = this.makeHeapHandle(address, "function");
        callable.name = name;
        callable.callback = callback;
        callable.callMode = callMode || "intrinsic";
        callable.nativeIntrinsic = intrinsicId || NativeIntrinsics.NONE;
        this.functionMetadata["$" + address] = callable;
        return callable;
    };

    Runtime.prototype.makeHostFunction = function (name, callback) {
        return this.makeNativeFunction(name, callback, "host");
    };

    Runtime.prototype.makeObject = function () {
        this.ensureLinearHeap();
        return this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateObject(
                this.objectPrototype ? this.objectPrototype.heapAddress : 0),
            "object"));
    };

    Runtime.prototype.makeArray = function () {
        this.ensureLinearHeap();
        return this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateArray(
                this.arrayPrototype ? this.arrayPrototype.heapAddress : 0, 4),
            "array"));
    };

    Runtime.prototype.makeObjectLiteral3 = function (
            k0, v0, k1, v1, k2, v2) {
        var object = this.makeObject();
        this.setProperty(object, k0, v0);
        this.setProperty(object, k1, v1);
        this.setProperty(object, k2, v2);
        return object;
    };

    Runtime.prototype.makeObjectLiteral5 = function (
            k0, v0, k1, v1, k2, v2, k3, v3, k4, v4) {
        var object = this.makeObject();
        this.setProperty(object, k0, v0);
        this.setProperty(object, k1, v1);
        this.setProperty(object, k2, v2);
        this.setProperty(object, k3, v3);
        this.setProperty(object, k4, v4);
        return object;
    };

    Runtime.prototype.makeArrayLiteral0 = function () {
        return this.makeArray();
    };

    Runtime.prototype.makeRegExp = function (pattern, flags) {
        this.ensureLinearHeap();
        return this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateRegExp(pattern, flags,
                this.regexpPrototype ? this.regexpPrototype.heapAddress : 0),
            "regexp"));
    };

    Runtime.prototype.makeGuestFunction = function (program, closure, homeContext) {
        this.ensureLinearHeap();
        /* Keep construction intermediates on the runtime. Firefox 1 does not
         * reliably preserve arbitrary JS locals across these re-entrant heap
         * allocation calls. Runtime fields are also visible to the guest GC. */
        this.functionConstructionProgram = this.programAddress(program);
        this.functionConstructionPrototype = this.makeObject();
        this.functionConstructionCallable = this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateFunction(false, 0,
                closure ? closure.heapAddress : 0,
                this.functionConstructionProgram,
                homeContext ? homeContext.heapAddress : 0),
            "bytecodeFunction"));
        var callable = this.functionConstructionCallable;
        callable.program = program;
        callable.name = program.name || "";
        callable.source = program.source || null;
        callable.homeContext = homeContext;
        this.functionMetadata["$" + callable.heapAddress] = callable;
        this.setProperty(this.functionConstructionCallable, "prototype",
                         this.functionConstructionPrototype);
        this.setProperty(this.functionConstructionPrototype, "constructor",
                         this.functionConstructionCallable);
        callable = this.functionConstructionCallable;
        this.functionConstructionCallable = null;
        this.functionConstructionPrototype = null;
        this.functionConstructionProgram = 0;
        return callable;
    };

    Runtime.prototype.makeCallEnvironment = function (program, receiver, args,
                                                       closure, callable) {
        if (program.bindingRegisters) return closure || null;
        if (!program.bindings && !closure && !callable) {
            return null;
        }
        var bindings = program.bindings || [];
        this.ensureLinearHeap();
        var environment = {heapAddress: this.heapRecords.allocateEnvironment(
                               closure ? closure.heapAddress : 0, bindings.length),
                           ownerRuntime: this};
        this.environmentMetadata["$" + environment.heapAddress] = {
            handle: environment, bindingSlots: program.bindingSlots || {}};
        var index = 0;
        index = 0;
        while (index < program.parameters.length) {
            this.writeHeapValue(this.heapRecords.environmentCell(
                environment.heapAddress, program.parameterSlots[index]),
                index < args.length ? args[index] : undefined);
            index++;
        }
        this.writeHeapValue(this.heapRecords.environmentCell(environment.heapAddress,
            program.argumentsSlot), this.arrayFrom(args));
        this.writeHeapValue(this.heapRecords.environmentCell(environment.heapAddress,
            program.thisSlot), receiver);
        if (program.functionNameSlot >= 0) this.writeHeapValue(
            this.heapRecords.environmentCell(environment.heapAddress,
                program.functionNameSlot), callable);
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
            var metadata = this.environmentMetadata["$" + current.heapAddress];
            var slot = metadata.bindingSlots["$" + name];
            if (slot !== undefined) return this.readHeapValue(
                this.heapRecords.environmentCell(current.heapAddress, slot));
            current = this.environmentParent(current);
        }
        return this.getGlobal(context, name);
    };

    Runtime.prototype.setBinding = function (context, environment, name, value) {
        var current = environment;
        while (current) {
            var metadata = this.environmentMetadata["$" + current.heapAddress];
            var slot = metadata.bindingSlots["$" + name];
            if (slot !== undefined) {
                this.writeHeapValue(this.heapRecords.environmentCell(
                    current.heapAddress, slot), value);
                return value;
            }
            current = this.environmentParent(current);
        }
        return this.setGlobal(context, name, value);
    };

    Runtime.prototype.getEnvironmentSlot = function (environment, depth, slot) {
        var requestedDepth = depth;
        while (depth > 0) {
            environment = this.environmentParent(environment);
            depth--;
        }
        var slotCount = environment ?
            this.heapRecords.environmentSlotCount(environment.heapAddress) : 0;
        if (!environment || slot < 0 || slot >= slotCount) {
            throw new Error("invalid lexical environment slot " + slot +
                            " of " + slotCount + " at depth " + requestedDepth);
        }
        return this.readHeapValue(
            this.heapRecords.environmentCell(environment.heapAddress, slot));
    };

    Runtime.prototype.environmentCellAddress = function (environment, depth, slot) {
        var requestedDepth = depth;
        while (depth > 0) {
            environment = this.environmentParent(environment);
            depth--;
        }
        if (!environment || slot < 0 ||
            slot >= this.heapRecords.environmentSlotCount(environment.heapAddress)) {
            throw new Error("invalid lexical environment slot depth=" +
                requestedDepth + " slot=" + slot +
                (environment ? " count=" +
                 this.heapRecords.environmentSlotCount(environment.heapAddress) :
                 " without environment"));
        }
        return this.heapRecords.environmentCell(environment.heapAddress, slot);
    };

    Runtime.prototype.setEnvironmentSlot = function (environment, depth, slot, value) {
        this.assertOwned(value);
        while (depth > 0) {
            environment = this.environmentParent(environment);
            depth--;
        }
        if (!environment || slot < 0 ||
            slot >= this.heapRecords.environmentSlotCount(environment.heapAddress)) {
            throw new Error("invalid lexical environment slot");
        }
        this.writeHeapValue(
            this.heapRecords.environmentCell(environment.heapAddress, slot), value);
        return value;
    };

    Runtime.prototype.updateEnvironmentSlot = function (
            environment, depth, slot, amount, prefix) {
        var old = Number(this.getEnvironmentSlot(environment, depth, slot));
        var value = old + amount;
        this.setEnvironmentSlot(environment, depth, slot, value);
        return prefix ? value : old;
    };

    Runtime.prototype.environmentParent = function (environment) {
        if (!environment) return null;
        var address = this.heapRecords.environmentParent(environment.heapAddress);
        if (!address) return null;
        var metadata = this.environmentMetadata["$" + address];
        if (!metadata) return this.adoptEnvironment(address, {}).handle;
        return metadata.handle;
    };

    /* Native frames create lexical environments without allocating host
     * objects.  Materialize the lightweight handle only if execution falls
     * back to the host interpreter; the authoritative slots remain entirely
     * in the guest heap. */
    Runtime.prototype.adoptEnvironment = function (address, bindingSlots) {
        var key = "$" + address;
        var metadata = this.environmentMetadata[key];
        if (metadata) return metadata;
        this.linearHeap.requireRecord(address, Heap.Types.ENVIRONMENT);
        var handle = {heapAddress: address, ownerRuntime: this};
        metadata = {handle: handle, bindingSlots: bindingSlots || {}};
        this.environmentMetadata[key] = metadata;
        return metadata;
    };

    Runtime.prototype.functionClosure = function (callable) {
        var address = this.heapRecords.functionClosure(callable.heapAddress);
        if (!address) return null;
        var metadata = this.environmentMetadata["$" + address];
        if (!metadata) throw new Error("guest function closure has no environment metadata");
        return metadata.handle;
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

    Runtime.prototype.makeHeapHandle = function (address, guestType) {
        var key = "$" + address;
        var existing = this.heapHandles[key];
        if (existing) return existing;
        var handle = {guestType: guestType, ownerRuntime: this,
                      heapAddress: address, gcMark: 0, propertyVersion: 0,
                      valueVersion: 0, arrayStructureVersion: 0};
        this.heapHandles[key] = handle;
        return handle;
    };

    Runtime.prototype.writeHeapValue = function (cell, value) {
        this.assertOwned(value);
        if (typeof value === "string") {
            this.valueCells.writeReferenceAt(cell, this.internStringAddress(value));
        } else if (value && value.guestType && value.heapAddress) {
            this.valueCells.writeReferenceAt(cell, value.heapAddress);
        } else if (value && typeof value === "object") {
            throw new TypeError("host object cannot be stored in guest heap" +
                (value.name ? ": " + value.name : ""));
        } else if (typeof value === "function") {
            throw new TypeError("host function cannot be stored in guest heap");
        } else this.valueCells.writePrimitiveAt(cell, value);
    };

    Runtime.prototype.readHeapValue = function (cell) {
        var tag = this.valueCells.tagAt(cell);
        if (tag !== ValueCells.Tags.REFERENCE) {
            return this.valueCells.readPrimitiveTaggedAt(cell, tag);
        }
        var address = this.valueCells.referenceAddressAt(cell);
        if (this.linearHeap.recordType(address) === Heap.Types.STRING) {
            return this.readHeapString(address);
        }
        var handle = this.heapHandles["$" + address];
        if (!handle) {
            var recordType = this.linearHeap.recordType(address);
            if (recordType === Heap.Types.BYTECODE_FUNCTION) {
                return this.adoptBytecodeFunction(address);
            }
            var guestType = recordType === Heap.Types.OBJECT ? "object" :
                recordType === Heap.Types.ARRAY ? "array" :
                recordType === Heap.Types.REGEXP ? "regexp" :
                recordType === Heap.Types.BUFFER_VIEW ? "buffer" : null;
            if (!guestType) {
                throw new Error("guest heap reference has no runtime handle: " +
                    "address=" + address + " type=" + recordType +
                    " cell=" + cell);
            }
            handle = this.makeHeapHandle(address, guestType);
            this.heapObjects.push(handle);
            this.noteAllocation(1);
        }
        return handle;
    };

    /* Functions created by the native MAKE_FUNCTION opcode acquire a host
     * handle only if a later semantic exit needs one.  Program, closure, and
     * context identity are reconstructed from authoritative heap fields. */
    Runtime.prototype.adoptBytecodeFunction = function (address) {
        var key = "$" + address;
        var existing = this.heapHandles[key];
        if (existing) return existing;
        this.linearHeap.requireRecord(address, Heap.Types.BYTECODE_FUNCTION);
        var programAddress = this.heapRecords.functionMetadata(address);
        var program = this.programMetadata["$" + programAddress];
        if (!program) {
            throw new Error("native function references unknown guest program " +
                            programAddress);
        }
        var callable = this.makeHeapHandle(address, "bytecodeFunction");
        callable.program = program;
        callable.name = program.name || "";
        callable.source = program.source || null;
        var contextAddress = this.heapRecords.functionHomeContext(address);
        callable.homeContext = null;
        var contextIndex = 0;
        while (contextIndex < this.contexts.length) {
            if (this.contexts[contextIndex].heapAddress === contextAddress) {
                callable.homeContext = this.contexts[contextIndex];
                break;
            }
            contextIndex++;
        }
        var closureAddress = this.heapRecords.functionClosure(address);
        if (closureAddress) this.adoptEnvironment(closureAddress, {});
        this.functionMetadata[key] = callable;
        this.heapObjects.push(callable);
        this.noteAllocation(1);
        return callable;
    };

    Runtime.prototype.heapOwnProperty = function (object, key, create) {
        var keyAddress = this.internStringAddress(key);
        var cacheKey = "$" + object.heapAddress + ":" + keyAddress;
        var property = this.propertyAddressCache[cacheKey] || 0;
        if (!property) {
            property = this.heapRecords.findOwnProperty(object.heapAddress, keyAddress);
            if (property) this.propertyAddressCache[cacheKey] = property;
        }
        if (!property && create) {
            property = this.heapRecords.defineOwnProperty(
                object.heapAddress, keyAddress,
                HeapRecords.Attributes.DEFAULT);
            this.propertyAddressCache[cacheKey] = property;
            object.propertyVersion++;
        }
        return property;
    };

    Runtime.prototype.setPrototype = function (object, prototype) {
        this.assertOwned(object);
        this.assertOwned(prototype);
        this.heapRecords.setObjectPrototype(object.heapAddress,
            prototype ? prototype.heapAddress : 0);
        object.propertyVersion++;
        object.valueVersion++;
    };

    Runtime.prototype.arrayLength = function (array) {
        return this.heapRecords.arrayLength(array.heapAddress);
    };

    Runtime.prototype.arrayHas = function (array, index) {
        if (index < 0 || index >= this.arrayLength(array)) return false;
        return this.valueCells.tagAt(
            this.heapRecords.arrayElementCell(array.heapAddress, index)) !== 0;
    };

    Runtime.prototype.arrayGet = function (array, index) {
        if (index < 0 || index !== Math.floor(index)) return undefined;
        var vector = this.heapRecords.arrayElements(array.heapAddress);
        if (index >= this.heapRecords.vectorLength(vector)) return undefined;
        var cell = this.heapRecords.vectorCellWithinLength(vector, index);
        if (this.valueCells.tagAt(cell) === 0) return undefined;
        return this.readHeapValue(cell);
    };

    Runtime.prototype.ensureArrayCapacity = function (array, required) {
        var oldVector = this.heapRecords.arrayElements(array.heapAddress);
        var oldCapacity = this.heapRecords.vectorCapacity(oldVector);
        if (required <= oldCapacity) return oldVector;
        var capacity = oldCapacity || 4;
        while (capacity < required) capacity *= 2;
        var newVector = this.heapRecords.allocateValueVector(capacity);
        var length = this.heapRecords.vectorLength(oldVector);
        var index = 0;
        while (index < length) {
            var oldCell = this.heapRecords.vectorCell(oldVector, index);
            var newCell = this.heapRecords.vectorCell(newVector, index);
            this.linearHeap.memory.writeU32(newCell,
                this.linearHeap.memory.readU32(oldCell));
            this.linearHeap.memory.writeU32(newCell + 4,
                this.linearHeap.memory.readU32(oldCell + 4));
            this.linearHeap.memory.writeU32(newCell + 8,
                this.linearHeap.memory.readU32(oldCell + 8));
            this.linearHeap.memory.writeU32(newCell + 12,
                this.linearHeap.memory.readU32(oldCell + 12));
            index++;
        }
        this.heapRecords.setVectorLength(newVector, length);
        this.heapRecords.setArrayElements(array.heapAddress, newVector);
        array.arrayStructureVersion++;
        this.linearHeap.freeRecord(oldVector);
        return newVector;
    };

    Runtime.prototype.arraySet = function (array, index, value) {
        this.assertOwned(value);
        index = Number(index);
        if (index < 0 || index >= 4294967295 || index !== Math.floor(index)) {
            throw new RangeError("invalid array index");
        }
        this.ensureArrayCapacity(array, index + 1);
        this.writeHeapValue(this.heapRecords.arrayElementCell(array.heapAddress, index),
                            value);
        if (index >= this.arrayLength(array)) {
            this.heapRecords.setArrayLength(array.heapAddress, index + 1);
            array.arrayStructureVersion++;
        }
        return value;
    };

    Runtime.prototype.arrayToHost = function (array) {
        var result = [];
        var length = this.arrayLength(array);
        var index = 0;
        while (index < length) {
            if (this.arrayHas(array, index)) result[index] = this.arrayGet(array, index);
            index++;
        }
        return result;
    };

    Runtime.prototype.replaceArray = function (array, values) {
        var oldVector = this.heapRecords.arrayElements(array.heapAddress);
        var capacity = values.length < 4 ? 4 : values.length;
        var vector = this.heapRecords.allocateValueVector(capacity);
        this.heapRecords.setArrayElements(array.heapAddress, vector);
        array.arrayStructureVersion++;
        var index = 0;
        while (index < values.length) {
            if (index in values) this.writeHeapValue(
                this.heapRecords.vectorCell(vector, index), values[index]);
            index++;
        }
        this.heapRecords.setVectorLength(vector, values.length);
        this.linearHeap.freeRecord(oldVector);
        return array;
    };

    Runtime.prototype.registerContext = function (context) {
        this.contexts.push(context);
    };

    Runtime.prototype.registerProgram = function (program) {
        var index = 0;
        while (index < this.programObjects.length) {
            if (this.programObjects[index] === program) return this.programAddresses[index];
            index++;
        }
        this.ensureLinearHeap();
        program.heapBytecodeAddress =
            this.heapRecords.allocateBytecode(program.code || []);
        program.heapConstantsAddress = this.heapRecords.allocateValueVector(
            program.constants ? program.constants.length : 0);
        program.heapConstantRegistersAddress =
            this.heapRecords.allocateValueVector(
            program.constants ? program.constants.length : 0);
        program.heapBindingRegistersAddress = program.bindingRegisters ?
            this.heapRecords.allocateValueVector(program.bindingRegisters.length) : 0;
        program.heapParameterSlotsAddress = this.heapRecords.allocateValueVector(
            program.parameterSlots ? program.parameterSlots.length : 0);
        var metadataId = this.programObjects.length + 1;
        var address = this.heapRecords.allocateProgram(
            program.heapBytecodeAddress, program.heapConstantsAddress, {
            constantRegisters: program.heapConstantRegistersAddress,
            bindingRegisters: program.heapBindingRegistersAddress,
            parameterSlots: program.heapParameterSlotsAddress,
            registerCount: program.registerCount || 0,
            argumentsSlot: program.argumentsSlot === undefined ?
                           -1 : program.argumentsSlot,
            thisSlot: program.thisSlot === undefined ? -1 : program.thisSlot,
            functionNameSlot: program.functionNameSlot === undefined ?
                              -1 : program.functionNameSlot,
            metadata: metadataId,
            flags: program.usesArguments ? 1 : 0,
            bindingCount: program.bindings ? program.bindings.length : 0
        });
        if (program.bindings && this.heapRecords.programBindingCount(address) !==
                program.bindings.length) {
            throw new Error("guest program binding layout was not preserved");
        }
        this.programObjects.push(program);
        this.programAddresses.push(address);
        this.programMetadata["$" + address] = program;
        index = 0;
        while (program.constants && index < program.constants.length) {
            var value = program.constants[index];
            var cell = this.heapRecords.vectorCell(
                program.heapConstantsAddress, index);
            if (value && typeof value === "object" && value.code && value.constants) {
                this.valueCells.writeReferenceAt(cell, this.registerProgram(value));
            } else if (value && typeof value === "object" &&
                       typeof value.length === "number") {
                this.writeHeapValue(cell, this.arrayFrom(value));
            } else this.writeHeapValue(cell, value);
            this.writeHeapValue(this.heapRecords.vectorCell(
                program.heapConstantRegistersAddress, index),
                program.constantRegisters &&
                program.constantRegisters[index] !== undefined ?
                program.constantRegisters[index] : -1);
            index++;
        }
        this.heapRecords.setVectorLength(program.heapConstantsAddress,
            program.constants ? program.constants.length : 0);
        this.heapRecords.setVectorLength(program.heapConstantRegistersAddress,
            program.constants ? program.constants.length : 0);
        index = 0;
        while (program.bindingRegisters && index < program.bindingRegisters.length) {
            this.writeHeapValue(this.heapRecords.vectorCell(
                                program.heapBindingRegistersAddress, index),
                                program.bindingRegisters[index]);
            index++;
        }
        if (program.heapBindingRegistersAddress) {
            this.heapRecords.setVectorLength(program.heapBindingRegistersAddress,
                program.bindingRegisters.length);
        }
        index = 0;
        while (program.parameterSlots && index < program.parameterSlots.length) {
            this.writeHeapValue(this.heapRecords.vectorCell(
                                program.heapParameterSlotsAddress, index),
                                program.parameterSlots[index]);
            index++;
        }
        this.heapRecords.setVectorLength(program.heapParameterSlotsAddress,
            program.parameterSlots ? program.parameterSlots.length : 0);
        return address;
    };

    Runtime.prototype.programAddress = function (program) {
        return this.registerProgram(program);
    };

    Runtime.prototype.spillFrame = function (frame) {
        if (!frame || !frame.heapAddress) return;
        this.heapRecords.setFramePC(frame.heapAddress, frame.pc);
        var count = this.heapRecords.frameRegisterCount(frame.heapAddress);
        var index = 0;
        while (index < count) {
            this.writeHeapValue(this.heapRecords.frameRegisterCell(
                frame.heapAddress, index), frame.registers[index]);
            index++;
        }
    };

    Runtime.prototype.reloadFrame = function (frame) {
        if (!frame || !frame.heapAddress) return;
        frame.pc = this.heapRecords.framePC(frame.heapAddress);
        var count = this.heapRecords.frameRegisterCount(frame.heapAddress);
        var index = 0;
        while (index < count) {
            frame.registers[index] = this.readHeapValue(
                this.heapRecords.frameRegisterCell(frame.heapAddress, index));
            index++;
        }
    };

    Runtime.prototype.reloadFrameRegister = function (frame, register) {
        frame.registers[register] = this.readHeapValue(
            this.heapRecords.frameRegisterCell(frame.heapAddress, register));
    };

    Runtime.prototype.spillFrameRegister = function (frame, register) {
        this.writeHeapValue(
            this.heapRecords.frameRegisterCell(frame.heapAddress, register),
            frame.registers[register]);
    };

    Runtime.prototype.spillFramePC = function (frame) {
        this.heapRecords.setFramePC(frame.heapAddress, frame.pc);
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
        var address = this.internedStrings[key];
        if (!address) {
            this.ensureLinearHeap();
            address = this.heapRecords.allocateString(value);
            this.internedStrings[key] = address;
            this.decodedStrings["$" + address] = value;
        }
        return this.readHeapString(address);
    };

    Runtime.prototype.readHeapString = function (address) {
        var key = "$" + address;
        var value = this.decodedStrings[key];
        if (value === undefined) {
            value = this.heapRecords.readString(address);
            this.decodedStrings[key] = value;
        }
        return value;
    };

    Runtime.prototype.internStringAddress = function (value) {
        value = String(value);
        var key = "$" + value;
        if (!this.internedStrings[key]) this.internString(value);
        return this.internedStrings[key];
    };

    Runtime.prototype.noteAllocation = function (units) {
        this.gcAllocationDebt += units > 0 ? units : 1;
        if (this.gcAllocationDebt >= this.gcThreshold) this.gcPending = true;
    };

    Runtime.prototype.noteNativeHeapBump = function (bump) {
        /* Native allocation cannot call back into the host collector while
         * registers and frame links are live. Request collection with ample
         * headroom; the interpreter services it only after publishing the
         * native frame at the next ordinary yield. */
        if (bump >= Math.floor(this.linearHeap.allocationLimit * 3 / 4)) {
            this.gcPending = true;
        }
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
        if (this.nativeInterpreter) this.nativeInterpreter.reportProfile();
    };

    Runtime.prototype.gcSafePoint = function () {
        if (this.gcPending && !this.gcCollecting && this.compiledDepth === 0) {
            this.collect();
        }
    };

    Runtime.prototype.synchronousExecutionBudget = function () {
        /* A synchronous embedder has no competing guest work to schedule.
         * Native execution already yields on semantic services and allocation
         * pressure, so a small artificial slice would only force expensive
         * frame materialization at otherwise unnecessary host boundaries. */
        return this.threadedCompiler || this.nativeInterpreter ?
               Infinity : 1000000;
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
        this.objectPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        this.stringPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        this.regexpPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        if (this.objectPrototype) {
            this.heapRecords.setObjectPrototype(
                this.globalObject.heapAddress, this.objectPrototype.heapAddress);
        }
        this.setGlobal("undefined", undefined);
        this.setGlobal("assertEqual", this.makeNativeFunction("assertEqual",
            function (receiver, args) {
                if (args[0] !== args[1]) {
                    throw new Error((args.length > 2 ? args[2] + ": " : "") +
                                    "expected " + args[1] + ", got " + args[0]);
                }
                runtime.assertions++;
                return undefined;
            }));
        this.setGlobal("print", this.makeHostFunction("print",
            function (receiver, args) {
                var text = args.length ? String(args[0]) : "";
                if (typeof print === "function") print(text);
                else console.log(text);
                return undefined;
            }));
        this.setGlobal("guestCollect", this.makeNativeFunction("guestCollect",
            function () {
                return runtime.collect();
            }));
        this.setGlobal("guestBackingStoreCount", this.makeNativeFunction(
            "guestBackingStoreCount", function () {
                return runtime.bufferSupport ?
                       runtime.bufferSupport.liveBackingCount() : 0;
            }));
        this.setGlobal("parseInt", this.makeNativeFunction("parseInt",
            function (receiver, args) {
                return parseInt(String(args[0]), args.length > 1 ? Number(args[1]) : undefined);
            }));
        this.stringMethods = {};
        this.stringMethods.charAt = this.makeNativeFunction("String.charAt",
            function (receiver, args) {
                return String(receiver).charAt(Number(args[0]) || 0);
            }, "intrinsic", NativeIntrinsics.STRING_CHAR_AT);
        this.stringMethods.charCodeAt = this.makeNativeFunction("String.charCodeAt",
            function (receiver, args) {
                return String(receiver).charCodeAt(Number(args[0]) || 0);
            }, "intrinsic", NativeIntrinsics.STRING_CHAR_CODE_AT);
        this.stringMethods.indexOf = this.makeNativeFunction("String.indexOf",
            function (receiver, args) {
                return String(receiver).indexOf(String(args[0]),
                    args.length > 1 ? Number(args[1]) : 0);
            }, "intrinsic", NativeIntrinsics.STRING_INDEX_OF);
        this.stringMethods.substring = this.makeNativeFunction("String.substring",
            function (receiver, args) {
                return args.length > 1 ? String(receiver).substring(Number(args[0]), Number(args[1])) :
                                         String(receiver).substring(Number(args[0]));
            });
        this.stringMethods.substr = this.makeNativeFunction("String.substr",
            function (receiver, args) {
                return args.length > 1 ? String(receiver).substr(Number(args[0]),
                    Number(args[1])) : String(receiver).substr(Number(args[0]));
            }, "intrinsic", NativeIntrinsics.STRING_SUBSTR);
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
                    search = new RegExp(runtime.heapRecords.regexpPattern(
                        search.heapAddress), runtime.heapRecords.regexpFlags(
                        search.heapAddress));
                }
                return String(receiver).replace(search, String(args[1]));
            });
        this.stringMethods.toUpperCase = this.makeNativeFunction("String.toUpperCase",
            function (receiver) { return String(receiver).toUpperCase(); });
        if (this.stringPrototype) {
            var stringMethodName;
            for (stringMethodName in this.stringMethods) {
                if (own(this.stringMethods, stringMethodName)) {
                    this.setProperty(this.stringPrototype, stringMethodName,
                                     this.stringMethods[stringMethodName]);
                }
            }
        }
        this.arrayMethods = {};
        this.arrayPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        this.arrayMethods.push = this.makeNativeFunction("Array.push",
            function (receiver, args) {
                var index = 0;
                while (index < args.length) {
                    runtime.arraySet(receiver, runtime.arrayLength(receiver),
                                     args[index++]);
                }
                return runtime.arrayLength(receiver);
            }, "intrinsic", NativeIntrinsics.ARRAY_PUSH);
        this.arrayMethods.sort = this.makeNativeFunction("Array.sort",
            function (receiver) {
                var values = runtime.arrayToHost(receiver);
                values.sort();
                runtime.replaceArray(receiver, values);
                return receiver;
            });
        this.arrayMethods.reverse = this.makeNativeFunction("Array.reverse",
            function (receiver) {
                var values = runtime.arrayToHost(receiver);
                values.reverse();
                runtime.replaceArray(receiver, values);
                return receiver;
            });
        this.arrayMethods.unshift = this.makeNativeFunction("Array.unshift",
            function (receiver, args) {
                var values = runtime.arrayToHost(receiver);
                var index = args.length - 1;
                while (index >= 0) values.unshift(args[index--]);
                runtime.replaceArray(receiver, values);
                return runtime.arrayLength(receiver);
            });
        this.arrayMethods.shift = this.makeNativeFunction("Array.shift",
            function (receiver) {
                var values = runtime.arrayToHost(receiver);
                var result = values.shift();
                runtime.replaceArray(receiver, values);
                return result;
            });
        this.arrayMethods.pop = this.makeNativeFunction("Array.pop",
            function (receiver) {
                var values = runtime.arrayToHost(receiver);
                var result = values.pop();
                runtime.replaceArray(receiver, values);
                return result;
            });
        this.arrayMethods.concat = this.makeNativeFunction("Array.concat",
            function (receiver, args) {
                var result = runtime.arrayFrom(runtime.arrayToHost(receiver));
                var argumentIndex = 0;
                while (argumentIndex < args.length) {
                    var value = args[argumentIndex++];
                    if (value && value.guestType === "array") {
                        var elementIndex = 0;
                        while (elementIndex < runtime.arrayLength(value)) {
                            runtime.arraySet(result, runtime.arrayLength(result),
                                runtime.arrayGet(value, elementIndex++));
                        }
                    } else runtime.arraySet(result, runtime.arrayLength(result), value);
                }
                return result;
            });
        this.arrayMethods.slice = this.makeNativeFunction("Array.slice",
            function (receiver, args) {
                var start = args.length ? Number(args[0]) : 0;
                var values = runtime.arrayToHost(receiver);
                var end = args.length > 1 ? Number(args[1]) : values.length;
                return runtime.arrayFrom(values.slice(start, end));
            });
        this.arrayMethods.join = this.makeNativeFunction("Array.join",
            function (receiver, args) {
                var separator = args.length && args[0] !== undefined ?
                                String(args[0]) : ",";
                var result = "";
                var index = 0;
                while (index < runtime.arrayLength(receiver)) {
                    if (index) result += separator;
                    var value = runtime.arrayGet(receiver, index++);
                    if (value !== undefined && value !== null) result += String(value);
                }
                return result;
            });
        this.objectMethods = {};
        this.objectMethods.hasOwnProperty = this.makeNativeFunction(
            "Object.hasOwnProperty", function (receiver, args) {
                return runtime.hasOwnProperty(receiver, String(args[0]));
            });
        if (this.objectPrototype) {
            this.setProperty(this.objectPrototype, "hasOwnProperty",
                             this.objectMethods.hasOwnProperty);
            var arrayMethodName;
            for (arrayMethodName in this.arrayMethods) {
                if (own(this.arrayMethods, arrayMethodName)) {
                    this.setProperty(this.arrayPrototype, arrayMethodName,
                                     this.arrayMethods[arrayMethodName]);
                }
            }
        }
        this.functionMethods = {};
        this.functionMethods.call = this.makeNativeFunction("Function.call",
            function () {
                throw new Error("Function.call must be dispatched by the VM");
            });
        this.functionMethods.call.intrinsicKind = "functionCall";
        this.functionMethods.apply = this.makeNativeFunction("Function.apply",
            function () {
                throw new Error("Function.apply must be dispatched by the VM");
            });
        this.functionMethods.apply.intrinsicKind = "functionApply";
        this.functionMethods.toString = this.makeNativeFunction("Function.toString",
            function (receiver) {
                if (receiver.guestType === "bytecodeFunction" && receiver.source) {
                    return receiver.source;
                }
                return "function " + (receiver.name || "") + "() { [native code] }";
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
                return new RegExp(runtime.heapRecords.regexpPattern(
                    receiver.heapAddress), runtime.heapRecords.regexpFlags(
                    receiver.heapAddress)).test(String(args[0]));
            }, "intrinsic", NativeIntrinsics.NONE);
        this.regexpMethods.exec = this.makeNativeFunction("RegExp.exec",
            function (receiver, args) {
                var match = new RegExp(runtime.heapRecords.regexpPattern(
                    receiver.heapAddress), runtime.heapRecords.regexpFlags(
                    receiver.heapAddress)).exec(String(args[0]));
                if (!match) return null;
                var result = runtime.arrayFrom(match);
                runtime.setProperty(result, "index", match.index);
                runtime.setProperty(result, "input", match.input);
                return result;
            });
        if (this.regexpPrototype) {
            var regexpMethodName;
            for (regexpMethodName in this.regexpMethods) {
                if (own(this.regexpMethods, regexpMethodName)) {
                    this.setProperty(this.regexpPrototype, regexpMethodName,
                                     this.regexpMethods[regexpMethodName]);
                }
            }
        }
        var stringConstructor = this.makeNativeFunction("String",
            function (receiver, args) {
                return args.length ? runtime.toString(args[0]) : "";
            });
        this.setProperty(stringConstructor, "fromCharCode", this.makeNativeFunction(
            "String.fromCharCode", function (receiver, args) {
                return String.fromCharCode.apply(String, args);
            }));
        this.setGlobal("String", stringConstructor);
        this.setGlobal("Number", this.makeNativeFunction("Number",
            function (receiver, args) { return args.length ? Number(args[0]) : 0; }));
        var arrayConstructor = this.makeNativeFunction("Array",
            function (receiver, args) {
                var array = runtime.makeArray();
                if (args.length === 1 && typeof args[0] === "number") {
                    var length = Number(args[0]);
                    if (length < 0 || length !== Math.floor(length)) {
                        throw new RangeError("invalid array length");
                    }
                    runtime.ensureArrayCapacity(array, length);
                    runtime.heapRecords.setArrayLength(array.heapAddress, length);
                } else {
                    var index = 0;
                    while (index < args.length) runtime.arraySet(array, index, args[index++]);
                }
                return array;
            });
        if (this.arrayPrototype) {
            this.setProperty(arrayConstructor, "prototype", this.arrayPrototype);
            this.setProperty(this.arrayPrototype, "constructor", arrayConstructor);
        }
        this.setGlobal("Array", arrayConstructor);
        var math = this.makeObject();
        function mathMethod(name, callback, intrinsicId) {
            runtime.setProperty(math, name,
                runtime.makeNativeFunction("Math." + name, callback,
                    "intrinsic", intrinsicId || NativeIntrinsics.NONE));
        }
        this.setProperty(math, "E", Math.E);
        this.setProperty(math, "LN2", Math.LN2);
        this.setProperty(math, "LN10", Math.LN10);
        this.setProperty(math, "LOG2E", Math.LOG2E);
        this.setProperty(math, "LOG10E", Math.LOG10E);
        this.setProperty(math, "PI", Math.PI);
        this.setProperty(math, "SQRT1_2", Math.SQRT1_2);
        this.setProperty(math, "SQRT2", Math.SQRT2);
        mathMethod("abs", function (receiver, args) {
            return Math.abs(Number(args[0]));
        }, NativeIntrinsics.MATH_ABS);
        mathMethod("acos", function (receiver, args) { return Math.acos(Number(args[0])); });
        mathMethod("asin", function (receiver, args) { return Math.asin(Number(args[0])); });
        mathMethod("atan", function (receiver, args) { return Math.atan(Number(args[0])); });
        mathMethod("atan2", function (receiver, args) {
            return Math.atan2(Number(args[0]), Number(args[1]));
        });
        mathMethod("ceil", function (receiver, args) {
            return Math.ceil(Number(args[0]));
        }, NativeIntrinsics.MATH_CEIL);
        mathMethod("floor", function (receiver, args) {
            return Math.floor(Number(args[0]));
        }, NativeIntrinsics.MATH_FLOOR);
        mathMethod("round", function (receiver, args) {
            return Math.round(Number(args[0]));
        }, NativeIntrinsics.MATH_ROUND);
        mathMethod("sqrt", function (receiver, args) {
            return Math.sqrt(Number(args[0]));
        }, NativeIntrinsics.MATH_SQRT);
        mathMethod("sin", function (receiver, args) {
            return Math.sin(Number(args[0]));
        }, NativeIntrinsics.MATH_SIN);
        mathMethod("cos", function (receiver, args) {
            return Math.cos(Number(args[0]));
        }, NativeIntrinsics.MATH_COS);
        mathMethod("exp", function (receiver, args) { return Math.exp(Number(args[0])); });
        mathMethod("log", function (receiver, args) { return Math.log(Number(args[0])); });
        mathMethod("pow", function (receiver, args) {
            return Math.pow(Number(args[0]), Number(args[1]));
        }, NativeIntrinsics.MATH_POW);
        mathMethod("random", function () { return Math.random(); });
        mathMethod("min", function (receiver, args) {
            return Math.min.apply(Math, args);
        }, NativeIntrinsics.MATH_MIN);
        mathMethod("max", function (receiver, args) {
            return Math.max.apply(Math, args);
        }, NativeIntrinsics.MATH_MAX);
        mathMethod("tan", function (receiver, args) { return Math.tan(Number(args[0])); });
        this.setGlobal("Math", math);
    };

    Runtime.prototype.installRawFFI = function () {
        var bridge = new HostFFI();
        if (!bridge.isMMVM) {
            throw new Error("raw guest FFI requires the js_min.exe host");
        }
        this.hostFFI = bridge;
        this.setGlobal("get_dlsym", this.makeNativeFunction("get_dlsym",
            function () {
                return bridge.getDlsym();
            }, "intrinsic", NativeIntrinsics.GET_DLSYM));
        this.setGlobal("ffi_call", this.makeNativeFunction("ffi_call",
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
            }, "intrinsic", NativeIntrinsics.FFI_CALL));
        this.linearHeap.memory.setNativeCaller(function (pointer, args) {
            return bridge.call(pointer, args);
        });
        if (this.nativeInterpreter) {
            this.nativeInterpreter.setDlsymPointer(bridge.getDlsym());
        }
        this.setGlobal("peek8", this.makeNativeFunction("peek8",
            function (receiver, args) { return bridge.peek8(args[0]); },
            "intrinsic", NativeIntrinsics.PEEK8));
        this.setGlobal("poke8", this.makeNativeFunction("poke8",
            function (receiver, args) { return bridge.poke8(args[0], args[1]); },
            "intrinsic", NativeIntrinsics.POKE8));
        this.setGlobal("peek32", this.makeNativeFunction("peek32",
            function (receiver, args) { return bridge.peek32(args[0]); },
            "intrinsic", NativeIntrinsics.PEEK32));
        this.setGlobal("poke32", this.makeNativeFunction("poke32",
            function (receiver, args) { return bridge.poke32(args[0], args[1]); },
            "intrinsic", NativeIntrinsics.POKE32));
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
        var globalObject = context ? context.globalObject : this.globalObject;
        if (!this.hasOwnProperty(globalObject, name)) {
            throw new ReferenceError(name + " is not defined");
        }
        return this.getProperty(globalObject, name);
    };

    Runtime.prototype.locateError = function (error, program, pc) {
        if (!error || (typeof error !== "object" && typeof error !== "function") ||
            error.guestFilename || (error.properties && error.properties.$fileName)) {
            return error;
        }
        var location = null;
        if (program && program.sourceLocations && pc !== undefined) {
            var scan = pc;
            while (scan >= 0 && !location) location = program.sourceLocations[scan--];
        }
        if (!location && program) location = program.location;
        if (!location) return error;
        if (error.guestType && error.properties) {
            var guestFilename = location.filename || program.filename || "<source>";
            var guestLine = location.line || 1;
            var guestColumn = location.column || 1;
            var guestName = error.properties.$name || "Error";
            var guestMessage = error.properties.$message || "";
            error.properties.$fileName = guestFilename;
            error.properties.$lineNumber = guestLine;
            error.properties.$columnNumber = guestColumn;
            error.properties.$stack = guestFilename + ":" + guestLine + ":" +
                guestColumn + ": " + guestName +
                (guestMessage ? ": " + guestMessage : "");
            return error;
        }
        error.guestFilename = location.filename || program.filename || "<source>";
        error.guestLine = location.line || 1;
        error.guestColumn = location.column || 1;
        var label = error.guestFilename + ":" + error.guestLine + ":" +
                    error.guestColumn;
        var description = error.name ? error.name + ": " + error.message : String(error);
        try {
            error.stack = label + ": " + description +
                (error.stack ? "\n" + error.stack : "");
        } catch (ignored) {}
        return error;
    };

    Runtime.prototype.importCaughtException = function (error) {
        if (!error || error.guestType ||
            (typeof error !== "object" && typeof error !== "function")) {
            return error;
        }
        var result = this.makeObject();
        this.setProperty(result, "name", error.name || "Error");
        this.setProperty(result, "message",
            error.message === undefined ? String(error) : String(error.message));
        if (error.guestFilename !== undefined) {
            this.setProperty(result, "fileName", error.guestFilename);
            this.setProperty(result, "lineNumber", error.guestLine || 1);
            this.setProperty(result, "columnNumber", error.guestColumn || 1);
        }
        if (error.stack !== undefined) {
            this.setProperty(result, "stack", String(error.stack));
        }
        return result;
    };

    Runtime.prototype.setGlobal = function (context, name, value) {
        if (arguments.length === 2) {
            value = name;
            name = context;
            context = null;
        }
        this.assertOwned(value);
        this.setProperty(context ? context.globalObject : this.globalObject,
                         name, value);
        return value;
    };

    Runtime.prototype.globalCellAddress = function (context, name) {
        var object = context ? context.globalObject : this.globalObject;
        var property = this.heapOwnProperty(object, this.propertyKey(name), false);
        return property ? this.heapRecords.propertyValueCell(property) : 0;
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
        if (!object.guestType && typeof object === "object" &&
            (object.guestFilename || (object.name && object.message !== undefined))) {
            key = this.propertyKey(key);
            if (key === "fileName") return object.guestFilename;
            if (key === "lineNumber") return object.guestLine;
            if (key === "columnNumber") return object.guestColumn;
            if (key === "name" || key === "message" || key === "stack") {
                return object[key];
            }
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.getProperty(object, key);
        }
        if (object.guestType === "array") {
            if (isDirectArrayIndex(key)) return this.arrayGet(object, key);
            key = this.propertyKey(key);
            if (key === "length") return this.arrayLength(object);
            if (isArrayIndex(key)) return this.arrayGet(object, Number(key));
            var arrayProperty = this.heapOwnProperty(object, key, false);
            if (arrayProperty) return this.readHeapValue(
                this.heapRecords.propertyValueCell(arrayProperty));
            return this.arrayMethods[key];
        }
        key = this.propertyKey(key);
        this.internStringAddress(key);
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            var property = this.heapOwnProperty(object, key, false);
            if (property) return this.readHeapValue(
                this.heapRecords.propertyValueCell(property));
            if (object.guestType === "regexp") return this.regexpMethods[key];
            var prototypeAddress = this.heapRecords.objectPrototype(object.heapAddress);
            if (prototypeAddress) {
                var inherited = this.getProperty(
                    this.heapHandles["$" + prototypeAddress], key);
                if (inherited !== undefined) return inherited;
            }
            if ((object.guestType === "function" ||
                 object.guestType === "bytecodeFunction") &&
                this.functionMethods[key]) return this.functionMethods[key];
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
            return this.arrayHas(object, Number(key));
        }
        if (object.guestType === "buffer" && isArrayIndex(key)) {
            return Number(key) < object.length;
        }
        if (object.heapAddress) {
            return !!this.heapOwnProperty(object, key, false);
        }
        return !!object.properties && own(object.properties, "$" + key);
    };

    Runtime.prototype.deleteProperty = function (object, key) {
        this.assertOwned(object);
        key = this.propertyKey(key);
        if (!object || !object.guestType) return true;
        if (object.guestType === "array" && isArrayIndex(key)) {
            var arrayCell = this.heapRecords.arrayElementCell(
                object.heapAddress, Number(key));
            this.linearHeap.memory.writeU32(arrayCell, 0);
            return true;
        }
        if (object.heapAddress) {
            var keyAddress = this.internStringAddress(key);
            var removedProperty = this.heapRecords.findOwnProperty(
                object.heapAddress, keyAddress);
            delete this.propertyAddressCache[
                "$" + object.heapAddress + ":" + keyAddress];
            var deleted = this.heapRecords.deleteOwnProperty(
                object.heapAddress, keyAddress);
            if (removedProperty) this.linearHeap.freeRecord(removedProperty);
            if (deleted) object.propertyVersion++;
            if (deleted) object.valueVersion++;
            return deleted;
        }
        if (object.properties) delete object.properties["$" + key];
        return true;
    };

    Runtime.prototype.keys = function (object) {
        this.assertOwned(object);
        var values = [];
        var index;
        if (object && object.guestType === "array") {
            for (index = 0; index < this.arrayLength(object); index++) {
                if (this.arrayHas(object, index)) values.push(String(index));
            }
        }
        var key;
        if (object && object.heapAddress) {
            var property = this.heapRecords.objectPropertyHead(object.heapAddress);
            var heapKeys = [];
            while (property) {
                heapKeys.push(this.heapRecords.readString(
                    this.heapRecords.propertyKey(property)));
                property = this.heapRecords.propertyNext(property);
            }
            var heapKeyIndex = heapKeys.length - 1;
            while (heapKeyIndex >= 0) values.push(heapKeys[heapKeyIndex--]);
        } else if (object && object.properties) {
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

    Runtime.prototype.toString = function (value) {
        if (value === undefined) return "undefined";
        if (value === null) return "null";
        if (!value || !value.guestType) return String(value);
        /* Error is currently installed by the embedding environment.  Keep
         * its ES5 observable string form in the semantic runtime so both the
         * Node and js_min hosts report guest failures alike. */
        if (this.hasOwnProperty(value, "name") &&
            this.hasOwnProperty(value, "message")) {
            var name = this.getProperty(value, "name");
            var message = this.getProperty(value, "message");
            name = name === undefined ? "Error" : String(name);
            message = message === undefined ? "" : String(message);
            if (!name) return message;
            if (!message) return name;
            return name + ": " + message;
        }
        return "[object Object]";
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
                return this.arraySet(object, key, value);
            }
            key = this.propertyKey(key);
            if (isArrayIndex(key)) return this.arraySet(object, Number(key), value);
            var arrayProperty = this.heapOwnProperty(object, key, true);
            this.writeHeapValue(this.heapRecords.propertyValueCell(arrayProperty), value);
            object.valueVersion++;
            return value;
        }
        key = this.propertyKey(key);
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            var property = this.heapOwnProperty(object, key, true);
            this.writeHeapValue(this.heapRecords.propertyValueCell(property), value);
            object.valueVersion++;
            return value;
        }
        throw new TypeError("property target is not an object");
    };

    Runtime.prototype.add = function (left, right) {
        if (typeof left === "string" || typeof right === "string") {
            return this.toString(left) + this.toString(right);
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
        if (value.heapAddress) this.linearHeap.setMark(value.heapAddress, generation);
        if (value.guestType === "buffer") {
            this.bufferSupport.markView(value, generation);
            this.markValue(value.prototype, generation);
        }
        if (value.guestType === "array") {
            this.linearHeap.setMark(
                this.heapRecords.arrayElements(value.heapAddress), generation);
            var elementIndex = 0;
            while (elementIndex < this.arrayLength(value)) {
                if (this.arrayHas(value, elementIndex)) {
                    this.markValue(this.arrayGet(value, elementIndex), generation);
                }
                elementIndex++;
            }
        }
        if (value.guestType === "bytecodeFunction") {
            this.markEnvironment(this.functionClosure(value), generation);
        }
        if (value.heapAddress) {
            var prototypeAddress = value.guestType === "buffer" ?
                this.linearHeap.readFieldU32(value.heapAddress, 12,
                                             Heap.Types.BUFFER_VIEW) :
                this.heapRecords.objectPrototype(value.heapAddress);
            if (prototypeAddress) {
                this.markValue(this.heapHandles["$" + prototypeAddress], generation);
            }
            var property = this.heapRecords.objectPropertyHead(value.heapAddress);
            while (property) {
                this.linearHeap.setMark(property, generation);
                this.linearHeap.setMark(this.heapRecords.propertyKey(property), generation);
                this.markHeapCell(
                    this.heapRecords.propertyValueCell(property), generation);
                property = this.heapRecords.propertyNext(property);
            }
        } else {
            if (value.prototype) this.markValue(value.prototype, generation);
            var properties = value.properties;
            var key;
            for (key in properties) {
                if (own(properties, key)) this.markValue(properties[key], generation);
            }
        }
    };

    Runtime.prototype.markHeapCell = function (cell, generation) {
        if (this.valueCells.tagAt(cell) !== ValueCells.Tags.REFERENCE) return;
        var address = this.valueCells.referenceAddressAt(cell);
        if (this.linearHeap.recordType(address) === Heap.Types.STRING) {
            this.linearHeap.setMark(address, generation);
            return;
        }
        this.markValue(this.heapHandles["$" + address], generation);
    };

    Runtime.prototype.releaseObjectRecords = function (object) {
        var address = object.heapAddress;
        var property = this.heapRecords.objectPropertyHead(address);
        while (property) {
            var next = this.heapRecords.propertyNext(property);
            this.linearHeap.freeRecord(property);
            property = next;
        }
        if (object.guestType === "array") {
            this.linearHeap.freeRecord(this.heapRecords.arrayElements(address));
        }
        delete this.heapHandles["$" + address];
        delete this.functionMetadata["$" + address];
        this.linearHeap.freeRecord(address);
    };

    Runtime.prototype.markAuthoritativeHeap = function (generation) {
        var runtime = this;
        var pending = [];
        function enqueue(address) {
            if (!address) return;
            if (runtime.linearHeap.mark(address) === generation) return;
            runtime.linearHeap.setMark(address, generation);
            pending.push(address);
        }

        /* Host semantic marking ran first. Put those records through the same
         * graph traversal so references created solely by native bytecode are
         * visible even when no host handle has ever existed for them. */
        this.linearHeap.visitRecords(function (address, type, size, mark) {
            if (type !== Heap.Types.FREE && mark === generation) {
                pending.push(address);
            }
        });
        enqueue(this.globalObject ? this.globalObject.heapAddress : 0);
        var index = 0;
        while (index < this.contexts.length) {
            enqueue(this.contexts[index++].heapAddress);
        }
        index = 0;
        while (index < this.programAddresses.length) {
            enqueue(this.programAddresses[index++]);
        }
        var stringKey;
        for (stringKey in this.internedStrings) {
            if (own(this.internedStrings, stringKey)) {
                enqueue(this.internedStrings[stringKey]);
            }
        }
        if (this.nativeInterpreter) {
            enqueue(this.nativeInterpreter.stateAddress);
        }
        enqueue(this.functionConstructionProgram || 0);
        enqueue(this.functionConstructionCallable ?
                this.functionConstructionCallable.heapAddress : 0);
        enqueue(this.functionConstructionPrototype ?
                this.functionConstructionPrototype.heapAddress : 0);

        index = 0;
        while (index < pending.length) {
            this.heapRecords.visitReferences(pending[index++], enqueue);
        }
    };

    Runtime.prototype.seedNativeCollectorRoots = function (generation) {
        var runtime = this;
        function value(candidate, source) {
            if (candidate && candidate.heapAddress) {
                if (runtime.linearHeap.isFreeRecord(candidate.heapAddress)) {
                    throw new Error("collector root contains freed reference: " +
                        (source || "value") + " type=" + candidate.guestType +
                        " reference=" + candidate.heapAddress);
                }
                runtime.linearHeap.setMark(candidate.heapAddress, generation);
            }
        }
        function environment(candidate) {
            if (candidate && candidate.heapAddress) {
                if (runtime.linearHeap.isFreeRecord(candidate.heapAddress)) {
                    throw new Error("collector environment root is freed: " +
                        candidate.heapAddress);
                }
                runtime.linearHeap.setMark(candidate.heapAddress, generation);
            }
        }
        value(this.globalObject);
        value(this.bufferSupport.prototype);
        if (this.nativeInterpreter) {
            this.linearHeap.setMark(
                this.nativeInterpreter.stringSupportAddress, generation);
        }
        var index = 0;
        while (index < this.hostRoots.length) {
            value(this.hostRoots[index], "hostRoots[" + index + "]");
            index++;
        }
        index = 0;
        while (index < this.activeRegisterFrames.length) {
            var registers = this.activeRegisterFrames[index++];
            var registerIndex = 0;
            while (registerIndex < registers.length) {
                value(registers[registerIndex], "activeRegisters[" + index +
                    "][" + registerIndex + "]");
                registerIndex++;
            }
        }
        index = 0;
        while (index < this.activeEnvironmentFrames.length) {
            environment(this.activeEnvironmentFrames[index++]);
        }
        index = 0;
        while (index < this.contexts.length) {
            var execution = this.contexts[index++].execution;
            if (execution) {
                var frameIndex = 0;
                while (frameIndex < execution.frames.length) {
                    var hostFrame = execution.frames[frameIndex++];
                    runtime.linearHeap.setMark(
                        hostFrame.heapAddress, generation);
                    if (!runtime.nativeInterpreter ||
                        !hostFrame.nativeHeapCurrent) {
                        var hostRegisterIndex = 0;
                        while (hostRegisterIndex < hostFrame.registers.length) {
                            value(hostFrame.registers[hostRegisterIndex],
                                "frame " + hostFrame.heapAddress + " register " +
                                hostRegisterIndex);
                            hostRegisterIndex++;
                        }
                    }
                    environment(hostFrame.environment);
                    value(hostFrame.constructReceiver);
                }
                if (execution.pendingHostCall) {
                    value(execution.pendingHostCall.receiver);
                    var argumentIndex = 0;
                    while (argumentIndex <
                           execution.pendingHostCall.args.length) {
                        value(execution.pendingHostCall.args[argumentIndex++]);
                    }
                }
            }
        }
        if (this.functionConstructionCallable) {
            value(this.functionConstructionCallable);
        }
        if (this.functionConstructionPrototype) {
            value(this.functionConstructionPrototype);
        }
        if (this.functionConstructionProgram) {
            this.linearHeap.setMark(
                this.functionConstructionProgram, generation);
        }
    };

    Runtime.prototype.verifyNativeFrameMarks = function (generation) {
        var contextIndex = 0;
        while (contextIndex < this.contexts.length) {
            var execution = this.contexts[contextIndex++].execution;
            if (!execution) continue;
            var frameIndex = 0;
            while (frameIndex < execution.frames.length) {
                var frameAddress = execution.frames[frameIndex++].heapAddress;
                var registerIndex = 0;
                var registerCount = this.heapRecords.frameRegisterCount(
                    frameAddress);
                while (registerIndex < registerCount) {
                    var cell = this.heapRecords.frameRegisterCell(
                        frameAddress, registerIndex);
                    if (this.valueCells.tagAt(cell) ===
                        ValueCells.Tags.REFERENCE) {
                        var reference = this.valueCells.referenceAddressAt(cell);
                        if (this.linearHeap.isFreeRecord(reference)) {
                            throw new Error("native frame contains freed reference: " +
                                "frame=" + frameAddress + " register=" +
                                registerIndex + " reference=" + reference);
                        }
                        if (this.linearHeap.mark(reference) !== generation) {
                            throw new Error("native marker missed frame reference: " +
                                "frame=" + frameAddress + " register=" +
                                registerIndex + " reference=" + reference);
                        }
                    }
                    registerIndex++;
                }
            }
        }
    };

    Runtime.prototype.collect = function () {
        if (this.gcCollecting) return this.heapObjects.length;
        this.gcCollecting = true;
        try {
            if (this.nativeInterpreter) {
                this.nativeInterpreter.releaseAllocationRegionForCollection();
                this.nativeInterpreter.releaseCachedFramesForCollection();
            }
            var heapBumpBeforeCollection = this.linearHeap.bump;
            var collectionStarted = this.profileOpcodeCounts ?
                new Date().getTime() : 0;
            this.gcGeneration++;
            var generation = this.gcGeneration;
            var key;
            var nativeMarking = this.heapSweeper &&
                this.heapSweeper.marker.backend === "i386";
            if (nativeMarking) {
                this.seedNativeCollectorRoots(generation);
                if (this.heapSweeper.mark(generation) !== 0) {
                    throw new Error("native guest marker exhausted its work stack");
                }
                this.verifyNativeFrameMarks(generation);
            } else {
            this.markValue(this.globalObject, generation);
            this.markValue(this.bufferSupport.prototype, generation);
            var builtinTables = [this.stringMethods, this.arrayMethods,
                this.objectMethods, this.functionMethods, this.numberMethods,
                this.regexpMethods];
            var builtinTableIndex = 0;
            while (builtinTableIndex < builtinTables.length) {
                var builtinTable = builtinTables[builtinTableIndex++];
                for (key in builtinTable) {
                    if (own(builtinTable, key)) {
                        this.markValue(builtinTable[key], generation);
                    }
                }
            }
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
                this.markValue(context.globalObject, generation);
                if (context.execution) markExecution(context.execution, generation, this);
                contextIndex++;
            }
            if (this.nativeInterpreter) {
                this.linearHeap.setMark(
                    this.nativeInterpreter.stringSupportAddress, generation);
            }
            this.markAuthoritativeHeap(generation);
            }
            var markingFinished = this.profileOpcodeCounts ?
                new Date().getTime() : 0;
            var survivors = [];
            var index = 0;
            while (index < this.heapObjects.length) {
                var heapObject = this.heapObjects[index];
                if (heapObject.heapAddress &&
                    !this.linearHeap.isFreeRecord(heapObject.heapAddress) &&
                    this.linearHeap.mark(heapObject.heapAddress) === generation) {
                    heapObject.gcMark = generation;
                    survivors.push(heapObject);
                }
                index++;
            }
            this.heapObjects = survivors;
            var environmentKey;
            for (environmentKey in this.environmentMetadata) {
                if (own(this.environmentMetadata, environmentKey)) {
                    var environmentMetadata = this.environmentMetadata[environmentKey];
                    if (this.linearHeap.isFreeRecord(
                            environmentMetadata.handle.heapAddress) ||
                        this.linearHeap.mark(
                            environmentMetadata.handle.heapAddress) !== generation) {
                        delete this.environmentMetadata[environmentKey];
                    } else {
                        environmentMetadata.gcMark = generation;
                    }
                }
            }
            var handleKey;
            for (handleKey in this.heapHandles) {
                if (own(this.heapHandles, handleKey) &&
                    (this.linearHeap.isFreeRecord(
                        this.heapHandles[handleKey].heapAddress) ||
                     this.linearHeap.mark(
                        this.heapHandles[handleKey].heapAddress) !== generation)) {
                    delete this.heapHandles[handleKey];
                    delete this.functionMetadata[handleKey];
                }
            }
            this.propertyAddressCache = {};
            var sweepResult;
            if (this.heapSweeper &&
                this.heapSweeper.compiled.backend === "i386") {
                sweepResult = {records: null,
                    bytes: this.heapSweeper.sweep(generation)};
                this.verifyNativeFrameMarks(generation);
                this.linearHeap.rebuildFreeBlocks();
            } else {
                sweepResult = this.linearHeap.sweepUnmarked(generation);
            }
            var sweepingFinished = this.profileOpcodeCounts ?
                new Date().getTime() : 0;
            this.gcAllocationDebt = 0;
            this.gcPending = false;
            this.collectionCount++;
            if (this.profileOpcodeCounts) {
                var collectionLine = "guest heap collection " +
                    this.collectionCount + ": bump=" +
                    heapBumpBeforeCollection + "->" + this.linearHeap.bump +
                    " reclaimedBytes=" + sweepResult.bytes +
                    (sweepResult.records === null ? "" :
                     " reclaimedRecords=" + sweepResult.records) +
                    " freeBlocks=" +
                    this.linearHeap.freeBlocks.length + " markMs=" +
                    (markingFinished - collectionStarted) + " sweepMs=" +
                    (sweepingFinished - markingFinished);
                if (typeof print === "function") print(collectionLine);
                else if (typeof console !== "undefined" && console.log) {
                    console.log(collectionLine);
                }
            }
            return survivors.length;
        } finally {
            this.gcCollecting = false;
        }
    };

    /* Read-only diagnostics deliberately go through the record accessor layer.
     * They expose authoritative guest state without making record offsets part
     * of the embedding API. */
    Runtime.prototype.inspectHeapRecord = function (address) {
        this.ensureLinearHeap();
        var type = this.linearHeap.recordType(address);
        var names = ["free", "object", "array", "native-function",
                     "bytecode-function", "environment", "property", "string",
                     "number", "regexp", "buffer-view", "buffer-backing",
                     "root-slot", "value-vector", "frame", "program", "bytecode",
                     "context", "handler", "engine-state"];
        var result = {address: address, type: type,
                      typeName: names[type] || "unknown",
                      size: this.linearHeap.recordSize(address),
                      mark: this.linearHeap.mark(address),
                      flags: this.linearHeap.flags(address)};
        if (type === Heap.Types.FRAME) {
            result.program = this.heapRecords.frameProgram(address);
            result.environment = this.heapRecords.frameEnvironment(address);
            result.caller = this.heapRecords.frameCaller(address);
            result.pc = this.heapRecords.framePC(address);
            result.returnSlot = this.heapRecords.frameReturnSlot(address);
            result.registerCount = this.heapRecords.frameRegisterCount(address);
            result.context = this.heapRecords.frameContext(address);
        } else if (type === Heap.Types.PROGRAM) {
            result.bytecode = this.heapRecords.programBytecode(address);
            result.constants = this.heapRecords.programConstants(address);
            result.constantRegisters =
                this.heapRecords.programConstantRegisters(address);
            result.bindingRegisters =
                this.heapRecords.programBindingRegisters(address);
            result.parameterSlots =
                this.heapRecords.programParameterSlots(address);
            result.registerCount =
                this.heapRecords.programRegisterCount(address);
            result.argumentsSlot =
                this.heapRecords.programArgumentsSlot(address);
            result.thisSlot = this.heapRecords.programThisSlot(address);
            result.functionNameSlot =
                this.heapRecords.programFunctionNameSlot(address);
        } else if (type === Heap.Types.NATIVE_FUNCTION ||
                   type === Heap.Types.BYTECODE_FUNCTION) {
            result.closure = this.heapRecords.functionClosure(address);
            result.metadata = this.heapRecords.functionMetadata(address);
            result.homeContext = this.heapRecords.functionHomeContext(address);
        }
        return result;
    };

    Runtime.prototype.inspectExecution = function (execution) {
        var result = {status: execution.status,
                      totalInstructions: execution.totalInstructions,
                      frames: []};
        var index = execution.frames.length - 1;
        while (index >= 0) {
            var hostFrame = execution.frames[index--];
            var frame = this.inspectHeapRecord(hostFrame.heapAddress);
            frame.name = hostFrame.program.name || "<script>";
            frame.filename = hostFrame.program.filename || "<guest>";
            frame.opcode = hostFrame.code[frame.pc];
            result.frames.push(frame);
        }
        if (this.nativeInterpreter) {
            result.nativeEngine = {
                runs: this.nativeInterpreter.runCount,
                instructions: this.nativeInterpreter.instructionCount,
                semanticExits: this.nativeInterpreter.unsupportedExitCount
            };
        }
        return result;
    };

    Runtime.prototype.destroy = function () {
        if (this.nativeInterpreter) this.nativeInterpreter.destroy();
        this.nativeInterpreter = null;
        this.bufferSupport.destroy();
        if (this.linearHeap) this.linearHeap.destroy();
        this.linearHeap = null;
        this.valueCells = null;
        this.heapSweeper = null;
        this.heapObjects = [];
        this.hostRoots = [];
        this.contexts = [];
        this.internedStrings = {};
        this.decodedStrings = {};
        this.globalObject = null;
        this.propertyAddressCache = {};
        var compilationIndex = 0;
        while (compilationIndex < this.nativeCompilations.length) {
            this.nativeCompilations[compilationIndex++].destroy();
        }
        this.nativeCompilations = [];
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        this.activeRegisters = null;
        this.gcPending = false;
        this.gcCollecting = false;
    };

    Runtime.prototype.markEnvironment = function (environment, generation) {
        var current = environment;
        while (current) {
            var metadata = this.environmentMetadata["$" + current.heapAddress];
            if (metadata && metadata.gcMark === generation) return;
            if (metadata) metadata.gcMark = generation;
            this.linearHeap.setMark(current.heapAddress, generation);
            var index = 0;
            var count = this.heapRecords.environmentSlotCount(current.heapAddress);
            while (index < count) {
                this.markHeapCell(
                    this.heapRecords.environmentCell(current.heapAddress, index),
                    generation);
                index++;
            }
            current = this.environmentParent(current);
        }
    };

    Runtime.prototype.arrayFrom = function (values) {
        var array = this.makeArray();
        var index = 0;
        while (index < values.length) {
            if (index in values) this.arraySet(array, index, values[index]);
            index++;
        }
        if (values.length && this.arrayLength(array) < values.length) {
            this.ensureArrayCapacity(array, values.length);
            this.heapRecords.setArrayLength(array.heapAddress, values.length);
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
            runtime.linearHeap.setMark(frame.heapAddress, generation);
            if (!runtime.nativeInterpreter || !frame.nativeHeapCurrent) {
                var registerIndex = 0;
                while (registerIndex < frame.registers.length) {
                    runtime.markValue(frame.registers[registerIndex], generation);
                    registerIndex++;
                }
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
