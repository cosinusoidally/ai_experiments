(function (root) {
    var BufferSupport = root.GuestVMBufferSupport;
    var TypedArraySupport = root.GuestVMTypedArraySupport;
    var JSONSupport = root.GuestVMJSONSupport;
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
    var DateSupport = root.GuestVMDateSupport;
    var ErrorSupport = root.GuestVMErrorSupport;
    if (typeof module !== "undefined" && module.exports) {
        BufferSupport = require("./buffer.js");
        TypedArraySupport = require("./typed_array.js");
        JSONSupport = require("./json.js");
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
        DateSupport = require("./date.js");
        ErrorSupport = require("./error.js");
    }

    function own(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function hexDigitValue(code) {
        if (code >= 48 && code <= 57) return code - 48;
        if (code >= 65 && code <= 70) return code - 55;
        if (code >= 97 && code <= 102) return code - 87;
        return -1;
    }

    function legacyUnescape(value) {
        value = String(value);
        var result = "";
        var index = 0;
        while (index < value.length) {
            if (value.charCodeAt(index) === 37) {
                var unicode = index + 5 < value.length &&
                    value.charCodeAt(index + 1) === 117;
                var digits = unicode ? 4 : 2;
                var start = index + (unicode ? 2 : 1);
                if (start + digits <= value.length) {
                    var decoded = 0;
                    var digitIndex = 0;
                    while (digitIndex < digits) {
                        var digit = hexDigitValue(
                            value.charCodeAt(start + digitIndex));
                        if (digit < 0) break;
                        decoded = decoded * 16 + digit;
                        digitIndex++;
                    }
                    if (digitIndex === digits) {
                        result += String.fromCharCode(decoded);
                        index = start + digits;
                        continue;
                    }
                }
            }
            result += value.charAt(index++);
        }
        return result;
    }

    function uriHex(octet) {
        var digits = "0123456789ABCDEF";
        return "%" + digits.charAt((octet >> 4) & 15) +
            digits.charAt(octet & 15);
    }

    function uriUnescaped(code, component) {
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
            (code >= 48 && code <= 57) || code === 45 || code === 95 ||
            code === 46 || code === 33 || code === 126 || code === 42 ||
            code === 39 || code === 40 || code === 41) return true;
        if (component) return false;
        return code === 59 || code === 47 || code === 63 || code === 58 ||
            code === 64 || code === 38 || code === 61 || code === 43 ||
            code === 36 || code === 44 || code === 35;
    }

    function encodeURIValue(value, component) {
        value = String(value);
        var result = "";
        var index = 0;
        while (index < value.length) {
            var code = value.charCodeAt(index++);
            if (uriUnescaped(code, component)) {
                result += String.fromCharCode(code);
                continue;
            }
            var codePoint = code;
            if (code >= 55296 && code <= 56319) {
                if (index >= value.length) throw new URIError("invalid URI character");
                var low = value.charCodeAt(index++);
                if (low < 56320 || low > 57343) {
                    throw new URIError("invalid URI character");
                }
                codePoint = 65536 + (code - 55296) * 1024 + low - 56320;
            } else if (code >= 56320 && code <= 57343) {
                throw new URIError("invalid URI character");
            }
            if (codePoint < 128) {
                result += uriHex(codePoint);
            } else if (codePoint < 2048) {
                result += uriHex(192 | (codePoint >> 6));
                result += uriHex(128 | (codePoint & 63));
            } else if (codePoint < 65536) {
                result += uriHex(224 | (codePoint >> 12));
                result += uriHex(128 | ((codePoint >> 6) & 63));
                result += uriHex(128 | (codePoint & 63));
            } else {
                result += uriHex(240 | (codePoint >> 18));
                result += uriHex(128 | ((codePoint >> 12) & 63));
                result += uriHex(128 | ((codePoint >> 6) & 63));
                result += uriHex(128 | (codePoint & 63));
            }
        }
        return result;
    }

    function uriReserved(code) {
        return code === 59 || code === 47 || code === 63 || code === 58 ||
            code === 64 || code === 38 || code === 61 || code === 43 ||
            code === 36 || code === 44 || code === 35;
    }

    function uriByte(value, index) {
        if (index + 2 >= value.length || value.charCodeAt(index) !== 37) {
            return -1;
        }
        var high = hexDigitValue(value.charCodeAt(index + 1));
        var low = hexDigitValue(value.charCodeAt(index + 2));
        return high < 0 || low < 0 ? -1 : high * 16 + low;
    }

    function decodeURIValue(value, component) {
        value = String(value);
        var result = "";
        var index = 0;
        while (index < value.length) {
            if (value.charCodeAt(index) !== 37) {
                result += value.charAt(index++);
                continue;
            }
            var sequenceStart = index;
            var first = uriByte(value, index);
            if (first < 0) throw new URIError("malformed URI sequence");
            var count = 0;
            var codePoint = 0;
            var minimum = 0;
            if (first < 128) {
                count = 1;
                codePoint = first;
            } else if (first >= 194 && first <= 223) {
                count = 2;
                codePoint = first & 31;
                minimum = 128;
            } else if (first >= 224 && first <= 239) {
                count = 3;
                codePoint = first & 15;
                minimum = 2048;
            } else if (first >= 240 && first <= 244) {
                count = 4;
                codePoint = first & 7;
                minimum = 65536;
            } else throw new URIError("malformed URI sequence");
            var byteIndex = 1;
            while (byteIndex < count) {
                var next = uriByte(value, index + byteIndex * 3);
                if (next < 128 || next > 191) {
                    throw new URIError("malformed URI sequence");
                }
                codePoint = codePoint * 64 + (next & 63);
                byteIndex++;
            }
            if (codePoint < minimum || codePoint > 1114111 ||
                (codePoint >= 55296 && codePoint <= 57343)) {
                throw new URIError("malformed URI sequence");
            }
            index += count * 3;
            if (!component && codePoint < 128 && uriReserved(codePoint)) {
                result += value.substring(sequenceStart, index);
            } else if (codePoint < 65536) {
                result += String.fromCharCode(codePoint);
            } else {
                codePoint -= 65536;
                result += String.fromCharCode(55296 + (codePoint >> 10));
                result += String.fromCharCode(56320 + (codePoint & 1023));
            }
        }
        return result;
    }

    function expandStringReplacement(template, matched, prefix, suffix) {
        template = String(template);
        var result = "";
        var index = 0;
        while (index < template.length) {
            var character = template.charAt(index++);
            if (character !== "$" || index >= template.length) {
                result += character;
                continue;
            }
            var token = template.charAt(index);
            if (token === "$") {
                result += "$";
                index++;
            } else if (token === "&") {
                result += matched;
                index++;
            } else if (token === "`") {
                result += prefix;
                index++;
            } else if (token === "'") {
                result += suffix;
                index++;
            } else result += "$";
        }
        return result;
    }

    function hexadecimal(value, digits) {
        var alphabet = "0123456789ABCDEF";
        var result = "";
        while (digits-- > 0) {
            result = alphabet.charAt(value & 15) + result;
            value >>>= 4;
        }
        return result;
    }

    function legacyEscape(value) {
        value = String(value);
        var result = "";
        var safe = "@*_+-./";
        var index = 0;
        while (index < value.length) {
            var code = value.charCodeAt(index++);
            var alphaNumeric = code >= 48 && code <= 57 ||
                code >= 65 && code <= 90 || code >= 97 && code <= 122;
            if (alphaNumeric || safe.indexOf(String.fromCharCode(code)) >= 0) {
                result += String.fromCharCode(code);
            } else if (code < 256) result += "%" + hexadecimal(code, 2);
            else result += "%u" + hexadecimal(code, 4);
        }
        return result;
    }

    function isESWhiteSpace(code) {
        return code === 9 || code === 10 || code === 11 || code === 12 ||
               code === 13 || code === 32 || code === 160 || code === 5760 ||
               code === 6158 || (code >= 8192 && code <= 8202) ||
               code === 8232 || code === 8233 || code === 8239 ||
               code === 8287 || code === 12288 || code === 65279;
    }

    function trimESWhiteSpace(value) {
        var start = 0;
        var end = value.length;
        while (start < end && isESWhiteSpace(value.charCodeAt(start))) start++;
        while (end > start && isESWhiteSpace(value.charCodeAt(end - 1))) end--;
        return value.substring(start, end);
    }

    var MAX_ARRAY_CAPACITY = 67108860;

    function Runtime(options) {
        options = options || {};
        this.contexts = [];
        this.internedStrings = {};
        this.stringAddresses = {};
        /* Computed primitive strings need stable heap addresses while they are
         * being spilled and reloaded, but they are not language atoms. Keep a
         * generation-local reverse map so repeated spills share one record
         * without making every computed string an immortal interned root. */
        this.transientStringAddresses = {};
        /* Strings are immutable. This is a decoded representation cache keyed
         * only by the authoritative heap address, never semantic storage. */
        this.decodedStrings = {};
        /* Transitional compiled-pattern cache for semantic regexp calls.
         * Guest-visible state never lives here: lastIndex is reset before
         * each use, matching the current guest record semantics. */
        this.hostRegExpCache = {};
        this.assertions = 0;
        this.heapObjects = [];
        this.heapHandles = {};
        this.nextHeapIdentity = 1;
        this.functionMetadata = {};
        this.environmentMetadata = {};
        this.programObjects = [];
        this.programAddresses = [];
        this.programMetadata = {};
        this.retainedProgramAddresses = {};
        this.heapStateSnapshots = [];
        this.hostRoots = [];
        this.gcGeneration = 0;
        this.gcThreshold = options.gcStress ? 1 :
            normalizeGCThreshold(options.gcThreshold);
        this.gcAllocationDebt = 0;
        this.gcPending = false;
        this.gcCollecting = false;
        this.gcHeapPressureBump = 0;
        this.compiledDepth = 0;
        this.collectionCount = 0;
        this.activeRegisterFrames = [];
        this.activeEnvironmentFrames = [];
        /* Synchronous guest callbacks can be nested beneath a context's
         * published execution (for example while a module loader is serving
         * require). They are independent live call stacks and must remain GC
         * roots without replacing JSContext.execution. */
        this.activeExecutions = [];
        this.activeRegisters = null;
        this.interpretGuest = null;
        this.linearHeap = null;
        this.valueCells = null;
        this.heapSweeper = null;
        this.heapRecords = null;
        this.linearHeapBytes = options.heapBytes === undefined ?
            64 * 1024 * 1024 : Number(options.heapBytes);
        /* An explicit heapBytes without maxHeapBytes preserves the historical
         * fixed-capacity embedding behavior. The normal default runtime starts
         * small but reserves a stable native address range for automatic growth. */
        this.maximumLinearHeapBytes = options.maxHeapBytes === undefined ?
            (options.heapBytes === undefined ? 512 * 1024 * 1024 :
             this.linearHeapBytes) : Number(options.maxHeapBytes);
        this.profileOpcodeCounts = options.profile ? [] : null;
        this.traceExceptions = !!options.traceExceptions;
        this.forbidHostCalls = !!options.forbidHostCalls;
        this.verifyNativeHeap = !!options.verifyNativeHeap;
        this.nativeSnapshotWrite = options.snapshot || null;
        this.nativeSnapshotRead = options.withSnapshot || null;
        this.skipNativeSnapshotHash = !!options.skipSnapshotHash;
        if (this.nativeSnapshotWrite && this.nativeSnapshotRead) {
            throw new Error("snapshot and withSnapshot are mutually exclusive");
        }
        if ((this.nativeSnapshotWrite || this.nativeSnapshotRead) &&
            !options.nativeInterpreter) {
            throw new Error("native snapshots require nativeInterpreter");
        }
        if (this.skipNativeSnapshotHash && !this.nativeSnapshotRead) {
            throw new Error("skipSnapshotHash requires withSnapshot");
        }
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
        this.typedArraySupport = new TypedArraySupport(this);
        this.jsonSupport = new JSONSupport(this);
        this.nativeInterpreter = options.nativeInterpreter ?
            new NativeInterpreter(this) : null;
        if (this.nativeInterpreter && this.datePrototype) {
            this.nativeInterpreter.setDateSupport(
                this.datePrototype, this.dateValueKey);
        }
        this.installProgramBuilder();
        if (options.rawFFI) this.installRawFFI();
        this.finalizeBuiltinGlobals();
    }

    Runtime.prototype.finalizeBuiltinGlobals = function () {
        /* ES5.1 15.1 gives the initial global bindings DontEnum. This pass is
         * deliberately performed once, after every optional runtime facility
         * has installed itself. Guest declarations and embedder-installed
         * globals created later retain their requested ordinary attributes. */
        var property = this.heapRecords.objectPropertyHead(
            this.globalObject.heapAddress);
        while (property) {
            var key = this.heapRecords.readString(
                this.heapRecords.propertyKey(property));
            var attributes = this.heapRecords.propertyAttributes(property) &
                ~HeapRecords.Attributes.ENUMERABLE;
            if (key === "undefined" || key === "NaN" || key === "Infinity") {
                attributes = 0;
            }
            this.heapRecords.setPropertyAttributes(property, attributes);
            property = this.heapRecords.propertyNext(property);
        }
    };

    Runtime.prototype.ensureLinearHeap = function () {
        if (!this.linearHeap) {
            this.linearHeap = new Heap({heapBytes: this.linearHeapBytes,
                maxHeapBytes: this.maximumLinearHeapBytes,
                collectorWorkspace: true});
            this.valueCells = new ValueCells(this.linearHeap);
            this.heapRecords = new HeapRecords(this.linearHeap, this.valueCells);
            this.linearHeap.setRecordInitializer(
                new RecordInitializer(this.linearHeap));
            this.heapSweeper = new HeapSweeper(this.linearHeap);
            this.resetHeapPressureBump(0);
        }
        return this.linearHeap;
    };

    Runtime.prototype.resetHeapPressureBump = function (minimumBump) {
        var heap = this.linearHeap;
        var pressureBump = Math.floor(heap.allocationLimit * 3 / 4);
        minimumBump = Number(minimumBump) || 0;
        if (pressureBump < minimumBump) pressureBump = minimumBump;
        if (pressureBump > heap.maximumAllocationLimit) {
            pressureBump = heap.maximumAllocationLimit;
        }
        this.gcHeapPressureBump = pressureBump;
    };

    Runtime.prototype.rebuildFreeBlockIndex = function () {
        if (this.heapSweeper && this.heapSweeper.indexer) {
            return this.heapSweeper.rebuildFreeBlocks();
        }
        return this.linearHeap.rebuildFreeBlocks();
    };

    Runtime.prototype.makeNativeFunction = function (name, callback, callMode,
                                                      intrinsicId) {
        this.ensureLinearHeap();
        var address = this.heapRecords.allocateFunction(
            true,
            this.functionPrototype ? this.functionPrototype.heapAddress : 0,
            0, intrinsicId || NativeIntrinsics.NONE);
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

    Runtime.prototype.makeObjectWithPrototype = function (prototype) {
        if (prototype !== null) {
            this.assertOwned(prototype);
            if (!prototype || !prototype.guestType) {
                throw new TypeError("Object prototype must be an object or null");
            }
        }
        this.ensureLinearHeap();
        return this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateObject(
                prototype ? prototype.heapAddress : 0), "object"));
    };

    Runtime.prototype.cloneEnumerableOwnProperties = function (source, target) {
        this.assertOwned(source);
        this.assertOwned(target);
        var propertyCount;
        if (source === this.globalObject) {
            if (this.contextGlobalPropertyCount === undefined ||
                this.contextGlobalPropertyVersion !==
                    source.propertyVersion) {
                this.contextGlobalPropertyCount =
                    this.heapRecords.countEnumerableOwnProperties(
                        source.heapAddress);
                this.contextGlobalPropertyVersion = source.propertyVersion;
            }
            propertyCount = this.contextGlobalPropertyCount;
        }
        this.heapRecords.cloneEnumerableOwnProperties(
            source.heapAddress, target.heapAddress, propertyCount);
        target.propertyAddresses = {};
        target.propertyVersion++;
        target.valueVersion++;
        return target;
    };

    Runtime.prototype.cloneOwnProperties = function (source, target) {
        this.assertOwned(source);
        this.assertOwned(target);
        var propertyCount;
        if (source === this.globalObject) {
            if (this.contextGlobalOwnPropertyCount === undefined ||
                this.contextGlobalOwnPropertyVersion !== source.propertyVersion) {
                this.contextGlobalOwnPropertyCount =
                    this.heapRecords.countOwnProperties(source.heapAddress);
                this.contextGlobalOwnPropertyVersion = source.propertyVersion;
            }
            propertyCount = this.contextGlobalOwnPropertyCount;
        }
        this.heapRecords.cloneOwnProperties(
            source.heapAddress, target.heapAddress, propertyCount, false);
        target.propertyAddresses = {};
        target.propertyVersion++;
        target.valueVersion++;
        return target;
    };

    Runtime.prototype.defineInternalValue = function (object, key, value) {
        var keyAddress = this.internStringAddress(key);
        var property = this.heapRecords.defineOwnProperty(
            object.heapAddress, keyAddress, 0);
        this.heapRecords.setPropertySetter(property, 0);
        this.writeHeapValue(this.heapRecords.propertyValueCell(property), value);
        object.propertyAddresses["$" + keyAddress] = property;
        object.propertyVersion++;
        object.valueVersion++;
        return value;
    };

    Runtime.prototype.makePrimitiveWrapper = function (value, prototype) {
        var wrapper = this.makeObjectWithPrototype(prototype);
        this.defineInternalValue(wrapper, this.primitiveValueKey, value);
        return wrapper;
    };

    Runtime.prototype.makeArgumentsObject = function (
            values, callable, strict, environment) {
        var result = this.arrayFrom(values);
        this.heapRecords.setObjectPrototype(
            result.heapAddress, this.objectPrototype.heapAddress);
        this.heapRecords.setArrayReserved(result.heapAddress, strict ?
            4294967295 : environment ? environment.heapAddress : 0);
        this.defineDataProperty(result, "length", values.length,
            HeapRecords.Attributes.WRITABLE |
            HeapRecords.Attributes.CONFIGURABLE);
        if (strict) {
            this.defineAccessorProperty(result,
                this.internStringAddress("callee"),
                this.strictArgumentsThrower,
                this.strictArgumentsThrower, 0);
            this.defineAccessorProperty(result,
                this.internStringAddress("caller"),
                this.strictArgumentsThrower,
                this.strictArgumentsThrower, 0);
        } else {
            this.defineDataProperty(result, "callee", callable,
                HeapRecords.Attributes.WRITABLE |
                HeapRecords.Attributes.CONFIGURABLE);
        }
        return result;
    };

    Runtime.prototype.makeArray = function (capacity) {
        capacity = capacity === undefined ? 4 : Number(capacity);
        if (capacity < 0 || capacity > MAX_ARRAY_CAPACITY ||
            capacity !== Math.floor(capacity)) {
            throw new RangeError("invalid initial Array capacity");
        }
        this.ensureLinearHeap();
        return this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateArray(
                this.arrayPrototype ? this.arrayPrototype.heapAddress : 0,
                capacity),
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
        var regexp = this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateRegExp(pattern, flags,
                this.regexpPrototype ? this.regexpPrototype.heapAddress : 0),
            "regexp"));
        /* ES5.1 15.10.7: these are own properties of every RegExp instance.
         * Keeping them in ordinary guest property records makes descriptor,
         * enumeration, assignment and instanceof behaviour use the same path
         * as every other guest object. */
        this.defineDataProperty(regexp, "source",
            pattern.length ? pattern : "(?:)", 0);
        this.defineDataProperty(regexp, "global",
            flags.indexOf("g") >= 0, 0);
        this.defineDataProperty(regexp, "ignoreCase",
            flags.indexOf("i") >= 0, 0);
        this.defineDataProperty(regexp, "multiline",
            flags.indexOf("m") >= 0, 0);
        this.defineDataProperty(regexp, "lastIndex", 0,
            HeapRecords.Attributes.WRITABLE);
        return regexp;
    };

    Runtime.prototype.hostRegExp = function (regexp) {
        this.assertOwned(regexp);
        var pattern = this.heapRecords.regexpPattern(regexp.heapAddress);
        var flags = this.heapRecords.regexpFlags(regexp.heapAddress);
        var key = "$" + pattern.length + ":" + pattern + ":" + flags;
        var compiled = this.hostRegExpCache[key];
        if (!compiled) {
            compiled = new RegExp(pattern, flags);
            this.hostRegExpCache[key] = compiled;
        }
        compiled.lastIndex = 0;
        return compiled;
    };

    Runtime.prototype.makeGuestFunction = function (program, closure, homeContext) {
        this.ensureLinearHeap();
        /* Keep construction intermediates on the runtime. Firefox 1 does not
         * reliably preserve arbitrary JS locals across these re-entrant heap
         * allocation calls. Runtime fields are also visible to the guest GC. */
        this.functionConstructionProgram = this.programAddress(program);
        this.functionConstructionPrototype = this.makeObject();
        this.functionConstructionCallable = this.trackObject(this.makeHeapHandle(
            this.heapRecords.allocateFunction(false,
                this.functionPrototype ?
                    this.functionPrototype.heapAddress : 0,
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
        /* A top-level program adopted as an executable callable has no
         * function environment or argument/this slots.  The presence of the
         * callable handle does not manufacture slots that its program does
         * not describe. */
        if (!program.bindings) return null;
        var bindings = program.bindings || [];
        this.ensureLinearHeap();
        var environment = {heapAddress: this.heapRecords.allocateEnvironment(
                               closure ? closure.heapAddress : 0, bindings.length,
                               this.programAddress(program)),
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
            program.argumentsSlot),
            this.makeArgumentsObject(
                args, callable, !!program.strict, environment));
        this.writeHeapValue(this.heapRecords.environmentCell(environment.heapAddress,
            program.thisSlot), receiver);
        if (program.functionNameSlot >= 0) this.writeHeapValue(
            this.heapRecords.environmentCell(environment.heapAddress,
                program.functionNameSlot), callable);
        return environment;
    };

    Runtime.prototype.normalizeCallReceiver = function (
            context, receiver, strict) {
        if (strict) return receiver;
        /* ES5.1 10.4.3: non-strict calls substitute the callee realm's global
         * object for null/undefined and box primitive receivers. */
        if (receiver === null || receiver === undefined) {
            if (!context || !context.globalObject) {
                throw new Error("call receiver normalization needs a JSContext");
            }
            return context.globalObject;
        }
        return receiver && receiver.guestType ? receiver :
            this.toObject(receiver);
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
        registers[bindingRegisters[program.argumentsSlot]] =
            this.makeArgumentsObject(args, callable, !!program.strict);
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
                      valueVersion: 0, arrayStructureVersion: 0,
                      propertyAddresses: {},
                      heapIdentity: this.nextHeapIdentity++};
        this.heapHandles[key] = handle;
        return handle;
    };

    Runtime.prototype.writeHeapValue = function (cell, value) {
        this.assertOwned(value);
        if (typeof value === "string") {
            this.valueCells.writeReferenceAt(cell,
                this.computedStringAddress(value));
        } else if (value && value.guestType && value.heapAddress) {
            this.valueCells.writeReferenceAt(cell, value.heapAddress);
        } else if (value && typeof value === "object") {
            throw new TypeError("host object cannot be stored in guest heap" +
                (value.name ? ": " + value.name : ""));
        } else if (typeof value === "function") {
            throw new TypeError("host function cannot be stored in guest heap");
        } else this.valueCells.writePrimitiveAt(cell, value);
    };

    Runtime.prototype.writeConstantHeapValue = function (cell, value) {
        /* Bytecode property-name constants share the runtime atom address so
         * the native constant-property path may compare addresses directly. */
        if (typeof value === "string") {
            this.valueCells.writeReferenceAt(cell,
                this.internStringAddress(value));
        } else this.writeHeapValue(cell, value);
    };

    Runtime.prototype.readHeapValue = function (cell) {
        var tag = this.valueCells.tagAt(cell);
        if (tag !== ValueCells.Tags.REFERENCE) {
            return this.valueCells.readPrimitiveTaggedAt(cell, tag);
        }
        var address = this.valueCells.referenceAddressAt(cell);
        return this.readHeapReference(address, cell);
    };

    /* Native execution deliberately does not manufacture host wrappers for
     * every guest allocation.  Adopt one only when a semantic exit actually
     * needs to expose the reference to host-side runtime code. */
    Runtime.prototype.readHeapReference = function (address, sourceCell) {
        var handle = this.heapHandles["$" + address];
        if (!handle) {
            var recordType = this.linearHeap.recordType(address);
            if (recordType === Heap.Types.STRING) {
                return this.readHeapString(address);
            }
            if (recordType === Heap.Types.BYTECODE_FUNCTION) {
                return this.adoptBytecodeFunction(address);
            }
            var guestType = recordType === Heap.Types.OBJECT ? "object" :
                recordType === Heap.Types.ARRAY ? "array" :
                recordType === Heap.Types.REGEXP ? "regexp" :
                recordType === Heap.Types.BUFFER_VIEW ?
                    (this.heapRecords.bufferViewKind(address) === 0 ? "buffer" :
                     this.heapRecords.bufferViewKind(address) === 1 ?
                        "arrayBuffer" : "typedArray") : null;
            if (!guestType) {
                throw new Error("guest heap reference has no runtime handle: " +
                    "address=" + address + " type=" + recordType +
                    (sourceCell === undefined ? "" :
                     " cell=" + sourceCell));
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
        var program = this.adoptHeapProgram(programAddress);
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
        return this.heapOwnPropertyAddress(object, keyAddress, create);
    };

    Runtime.prototype.heapOwnPropertyAddress = function (
            object, keyAddress, create) {
        var cacheKey = "$" + keyAddress;
        var property = object.propertyAddresses[cacheKey] || 0;
        if (!property) {
            property = this.heapRecords.findOwnProperty(object.heapAddress, keyAddress);
            if (property) object.propertyAddresses[cacheKey] = property;
        }
        if (!property && create) {
            property = this.heapRecords.defineOwnProperty(
                object.heapAddress, keyAddress,
                HeapRecords.Attributes.DEFAULT);
            object.propertyAddresses[cacheKey] = property;
            object.propertyVersion++;
        }
        return property;
    };

    Runtime.prototype.defineAccessorProperty = function (
            object, keyAddress, getter, setter, attributes) {
        this.assertOwned(object);
        this.assertOwned(getter);
        this.assertOwned(setter);
        if (!object || !object.heapAddress) {
            throw new TypeError("accessor target is not an object");
        }
        if (getter !== undefined &&
            (!getter || (getter.guestType !== "function" &&
                         getter.guestType !== "bytecodeFunction"))) {
            throw new TypeError("property getter is not callable");
        }
        if (setter !== undefined &&
            (!setter || (setter.guestType !== "function" &&
                         setter.guestType !== "bytecodeFunction"))) {
            throw new TypeError("property setter is not callable");
        }
        var property = this.heapRecords.defineOwnProperty(
            object.heapAddress, keyAddress,
            (attributes || 0) | HeapRecords.Attributes.ACCESSOR);
        this.writeHeapValue(this.heapRecords.propertyValueCell(property),
                            getter);
        this.heapRecords.setPropertySetter(property,
            setter === undefined ? 0 : setter.heapAddress);
        object.propertyAddresses["$" + keyAddress] = property;
        object.propertyVersion++;
        object.valueVersion++;
        return property;
    };

    Runtime.prototype.defineDataProperty = function (
            object, key, value, attributes) {
        this.assertOwned(object);
        this.assertOwned(value);
        if (!object || !object.heapAddress) {
            throw new TypeError("data-property target is not an object");
        }
        var keyAddress = this.internStringAddress(this.propertyKey(key));
        var property = this.heapRecords.defineOwnProperty(
            object.heapAddress, keyAddress, attributes || 0);
        this.writeHeapValue(this.heapRecords.propertyValueCell(property), value);
        object.propertyAddresses["$" + keyAddress] = property;
        object.propertyVersion++;
        object.valueVersion++;
        return property;
    };

    Runtime.prototype.defineLiteralAccessor = function (
            object, key, callable, setterDefinition) {
        var keyAddress = this.internStringAddress(this.propertyKey(key));
        var property = this.heapRecords.findOwnProperty(
            object.heapAddress, keyAddress);
        var getter;
        var setter;
        if (property && (this.heapRecords.propertyAttributes(property) &
                         HeapRecords.Attributes.ACCESSOR)) {
            getter = this.readHeapValue(
                this.heapRecords.propertyValueCell(property));
            var setterAddress = this.heapRecords.propertySetter(property);
            setter = setterAddress ? this.readHeapReference(setterAddress) :
                                     undefined;
        }
        if (setterDefinition) setter = callable;
        else getter = callable;
        return this.defineAccessorProperty(object, keyAddress, getter, setter,
            HeapRecords.Attributes.ENUMERABLE |
            HeapRecords.Attributes.CONFIGURABLE);
    };

    Runtime.prototype.invokePropertyFunction = function (
            callable, receiver, args) {
        if (!callable) return undefined;
        if (callable.guestType === "bytecodeFunction") {
            if (!this.interpretGuest) {
                throw new Error("guest accessor execution is unavailable");
            }
            return this.interpretGuest(callable, receiver, args,
                                       callable.homeContext);
        }
        return this.call(callable, receiver, args);
    };

    Runtime.prototype.readPropertyRecord = function (
            property, receiver) {
        if (this.heapRecords.propertyAttributes(property) &
            HeapRecords.Attributes.ACCESSOR) {
            var getter = this.readHeapValue(
                this.heapRecords.propertyValueCell(property));
            return getter === undefined ? undefined :
                this.invokePropertyFunction(getter, receiver, []);
        }
        return this.readHeapValue(this.heapRecords.propertyValueCell(property));
    };

    Runtime.prototype.writePropertyRecord = function (
            property, receiver, value, strict) {
        var attributes = this.heapRecords.propertyAttributes(property);
        if (attributes & HeapRecords.Attributes.ACCESSOR) {
            var setterAddress = this.heapRecords.propertySetter(property);
            if (!setterAddress) {
                if (strict) throw new TypeError("property has no setter");
                return value;
            }
            var setter = this.readHeapReference(setterAddress);
            this.invokePropertyFunction(setter, receiver, [value]);
            return value;
        }
        if (!(attributes & HeapRecords.Attributes.WRITABLE)) {
            if (strict) throw new TypeError("property is not writable");
            return value;
        }
        this.writeHeapValue(this.heapRecords.propertyValueCell(property), value);
        return value;
    };

    Runtime.prototype.setNamedProperty = function (object, key, value, strict) {
        var property = this.heapOwnProperty(object, key, false);
        if (property) {
            this.writePropertyRecord(property, object, value, strict);
            object.valueVersion++;
            return value;
        }
        var inherited = this.findPrototypeProperty(object, key);
        if (inherited) {
            var inheritedAttributes =
                this.heapRecords.propertyAttributes(inherited);
            if ((inheritedAttributes & HeapRecords.Attributes.ACCESSOR) ||
                !(inheritedAttributes & HeapRecords.Attributes.WRITABLE)) {
                this.writePropertyRecord(inherited, object, value, strict);
                object.valueVersion++;
                return value;
            }
        }
        property = this.heapOwnProperty(object, key, true);
        this.writeHeapValue(this.heapRecords.propertyValueCell(property), value);
        object.valueVersion++;
        return value;
    };

    Runtime.prototype.findPrototypeProperty = function (object, key) {
        if (!object || !object.heapAddress) return 0;
        var prototypeAddress = this.heapRecords.objectPrototype(
            object.heapAddress);
        while (prototypeAddress) {
            var prototype = this.readHeapReference(prototypeAddress);
            var property = this.heapOwnProperty(prototype, key, false);
            if (property) return property;
            prototypeAddress = this.heapRecords.objectPrototype(
                prototype.heapAddress);
        }
        return 0;
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

    Runtime.prototype.isArgumentsObject = function (object) {
        return !!object && object.guestType === "array" &&
            this.heapRecords.arrayReserved(object.heapAddress) !== 0;
    };

    Runtime.prototype.argumentsMappedCell = function (array, index) {
        var environment = this.heapRecords.arrayReserved(array.heapAddress);
        if (!environment || environment === 4294967295 ||
            !this.arrayHas(array, index)) return 0;
        var program = this.heapRecords.environmentProgram(environment);
        if (!program) return 0;
        var parameterSlots = this.heapRecords.programParameterSlots(program);
        var parameterCount = this.heapRecords.vectorLength(parameterSlots);
        if (index < 0 || index >= parameterCount) return 0;
        var slot = this.readHeapValue(
            this.heapRecords.vectorCell(parameterSlots, index));
        var later = index + 1;
        while (later < parameterCount) {
            if (this.readHeapValue(
                    this.heapRecords.vectorCell(parameterSlots, later)) === slot) {
                return 0;
            }
            later++;
        }
        return this.heapRecords.environmentCell(environment, slot);
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
        var mappedCell = this.argumentsMappedCell(array, index);
        if (mappedCell) return this.readHeapValue(mappedCell);
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
        this.linearHeap.freeRecord(oldVector, "array growth");
        return newVector;
    };

    Runtime.prototype.arraySet = function (array, index, value) {
        this.assertOwned(value);
        index = Number(index);
        if (index < 0 || index >= 4294967295 || index !== Math.floor(index)) {
            throw new RangeError("invalid array index");
        }
        var mappedCell = this.argumentsMappedCell(array, index);
        this.ensureArrayCapacity(array, index + 1);
        this.writeHeapValue(this.heapRecords.arrayElementCell(array.heapAddress, index),
                            value);
        if (mappedCell) this.writeHeapValue(mappedCell, value);
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

    Runtime.prototype.joinArrayValues = function (array, separator) {
        /* Array.join is unusually hot in source-generating guest programs.
         * Resolve the backing vector once, then use the ordinary named
         * value-cell accessors.  Re-entering arrayLength/arrayGet for every
         * element repeats record validation and native-memory reads. */
        var vector = this.heapRecords.arrayElements(array.heapAddress);
        var length = this.heapRecords.vectorLength(vector);
        var parts = new Array(length);
        var index = 0;
        while (index < length) {
            var cell = this.heapRecords.vectorCellWithinLength(vector, index);
            if (this.valueCells.tagAt(cell) === 0) {
                parts[index] = "";
            } else {
                var value = this.readHeapValue(cell);
                parts[index] = value === undefined || value === null ?
                               "" : this.toString(value);
            }
            index++;
        }
        return parts.join(separator);
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
        this.linearHeap.freeRecord(oldVector, "array replacement");
        return array;
    };

    Runtime.prototype.registerContext = function (context) {
        this.contexts.push(context);
    };

    Runtime.prototype.prepareContextAllocation = function () {
        /* A native execution may reserve a free heap region between calls.
         * Context construction is host-side heap work, so publish the unused
         * tail before allocating its global and property records. */
        if (this.nativeInterpreter) {
            this.nativeInterpreter.releaseAllocationRegionForCollection();
        }
    };

    Runtime.prototype.registerProgram = function (program) {
        if (program && program.heapAddress) {
            this.linearHeap.requireRecord(program.heapAddress,
                                          Heap.Types.PROGRAM);
            return program.heapAddress;
        }
        var index = 0;
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
            flags: (program.usesArguments ? 1 : 0) |
                   (program.strict ? 2 : 0),
            bindingCount: program.bindings ? program.bindings.length : 0
        });
        if (program.bindings && this.heapRecords.programBindingCount(address) !==
                program.bindings.length) {
            throw new Error("guest program binding layout was not preserved");
        }
        this.programObjects.push(program);
        this.programAddresses.push(address);
        program.heapAddress = address;
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
            } else this.writeConstantHeapValue(cell, value);
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

    Runtime.prototype.retainProgram = function (program) {
        var address = this.registerProgram(program);
        this.retainedProgramAddresses["$" + address] = address;
        return program;
    };

    Runtime.prototype.releaseProgram = function (program) {
        if (program && program.heapAddress) {
            delete this.retainedProgramAddresses["$" + program.heapAddress];
        }
    };

    Runtime.prototype.createHeapStateSnapshot = function (rootAddress) {
        this.ensureLinearHeap();
        this.linearHeap.requireRecord(rootAddress);
        var visited = {};
        var queue = [rootAddress];
        var addresses = [];
        var queueIndex = 0;
        while (queueIndex < queue.length) {
            var address = queue[queueIndex++];
            var identity = "$" + address;
            if (visited[identity]) continue;
            visited[identity] = true;
            var type = this.linearHeap.recordType(address);
            /* Source, bytecode and atoms are immutable. Interpreter frames
             * and engine/platform state belong to the execution containing
             * the embedder call, not to the context being snapshotted. */
            if (type === Heap.Types.STRING || type === Heap.Types.PROGRAM ||
                type === Heap.Types.BYTECODE || type === Heap.Types.FRAME ||
                type === Heap.Types.HANDLER ||
                type === Heap.Types.ENGINE_STATE ||
                type === Heap.Types.PLATFORM_SERVICES) continue;
            addresses.push(address);
            this.heapRecords.visitReferences(address, function (target) {
                if (!visited["$" + target]) queue.push(target);
            });
        }
        addresses.sort(function (left, right) { return left - right; });
        var regions = [];
        var addressIndex = 0;
        while (addressIndex < addresses.length) {
            var start = addresses[addressIndex++];
            var length = this.linearHeap.recordSize(start);
            while (addressIndex < addresses.length &&
                   addresses[addressIndex] === start + length) {
                length += this.linearHeap.recordSize(
                    addresses[addressIndex++]);
            }
            regions.push({address: start, length: length});
        }
        var handles = [];
        var index = 0;
        while (index < this.heapObjects.length) {
            var handle = this.heapObjects[index++];
            if (handle && visited["$" + handle.heapAddress]) {
                handles.push({handle: handle,
                    propertyVersion: handle.propertyVersion,
                    valueVersion: handle.valueVersion,
                    arrayStructureVersion: handle.arrayStructureVersion});
            }
        }
        var snapshot = {
            memory: this.linearHeap.memory.createRegionSnapshot(regions),
            regions: regions, addresses: addresses,
            handles: handles, destroyed: false
        };
        this.heapStateSnapshots.push(snapshot);
        return snapshot;
    };

    Runtime.prototype.restoreHeapStateSnapshot = function (snapshot) {
        if (!snapshot || snapshot.destroyed) {
            throw new Error("invalid guest heap snapshot");
        }
        if (this.activeExecutions.length) {
            throw new Error("cannot restore a running guest heap");
        }
        this.linearHeap.memory.restoreRegionSnapshot(
            snapshot.memory, snapshot.regions);
        var index = 0;
        while (index < snapshot.handles.length) {
            var state = snapshot.handles[index++];
            state.handle.propertyAddresses = {};
            state.handle.propertyVersion = state.propertyVersion;
            state.handle.valueVersion = state.valueVersion;
            state.handle.arrayStructureVersion = state.arrayStructureVersion;
        }
    };

    Runtime.prototype.destroyHeapStateSnapshot = function (snapshot) {
        if (!snapshot || snapshot.destroyed) return;
        this.linearHeap.memory.destroySnapshot(snapshot.memory);
        snapshot.memory = null;
        snapshot.destroyed = true;
    };

    Runtime.prototype.programAddress = function (program) {
        if (program && program.heapAddress) {
            this.linearHeap.requireRecord(program.heapAddress,
                                          Heap.Types.PROGRAM);
            return program.heapAddress;
        }
        return this.registerProgram(program);
    };

    /* Materialize only the semantic adapter needed when heap-native bytecode
     * reaches the transitional JavaScript interpreter. The Program record and
     * its vectors remain authoritative; this object does not allocate or
     * register a second guest program. */
    Runtime.prototype.adoptHeapProgram = function (address) {
        var key = "$" + address;
        var existing = this.programMetadata[key];
        if (existing) return existing;
        this.linearHeap.requireRecord(address, Heap.Types.PROGRAM);
        var records = this.heapRecords;
        var bytecode = records.programBytecode(address);
        var codeLength = records.bytecodeLength(bytecode);
        var code = new Array(codeLength);
        var index = 0;
        while (index < codeLength) {
            code[index] = records.bytecodeWord(bytecode, index);
            index++;
        }
        var runtime = this;
        function integerVector(vector) {
            if (!vector) return null;
            var length = records.vectorLength(vector);
            var values = new Array(length);
            var vectorIndex = 0;
            while (vectorIndex < length) {
                values[vectorIndex] = runtime.readHeapValue(
                    records.vectorCell(vector, vectorIndex));
                vectorIndex++;
            }
            return values;
        }
        var constantsAddress = records.programConstants(address);
        var constantLength = records.vectorLength(constantsAddress);
        var constants = new Array(constantLength);
        index = 0;
        while (index < constantLength) {
            var cell = records.vectorCell(constantsAddress, index);
            if (this.valueCells.tagAt(cell) === ValueCells.Tags.REFERENCE) {
                var reference = this.valueCells.referenceAddressAt(cell);
                if (this.linearHeap.recordType(reference) ===
                    Heap.Types.PROGRAM) {
                    constants[index] = this.adoptHeapProgram(reference);
                } else constants[index] = this.readHeapReference(reference, cell);
            } else constants[index] = this.readHeapValue(cell);
            index++;
        }
        var bindingCount = records.programBindingCount(address);
        var parameterSlots = integerVector(
            records.programParameterSlots(address)) || [];
        var program = {
            heapAddress: address,
            heapBytecodeAddress: bytecode,
            heapConstantsAddress: constantsAddress,
            heapConstantRegistersAddress:
                records.programConstantRegisters(address),
            heapBindingRegistersAddress:
                records.programBindingRegisters(address),
            heapParameterSlotsAddress:
                records.programParameterSlots(address),
            code: code,
            constants: constants,
            constantRegisters: integerVector(
                records.programConstantRegisters(address)) || [],
            bindingRegisters: integerVector(
                records.programBindingRegisters(address)),
            parameterSlots: parameterSlots,
            parameters: new Array(parameterSlots.length),
            bindings: bindingCount ? new Array(bindingCount) : null,
            bindingSlots: {},
            registerCount: records.programRegisterCount(address),
            argumentsSlot: records.programArgumentsSlot(address),
            thisSlot: records.programThisSlot(address),
            functionNameSlot: records.programFunctionNameSlot(address),
            usesArguments: !!(records.programFlags(address) & 1),
            strict: !!(records.programFlags(address) & 2),
            globalDeclarations: [],
            filename: "<guest-heap-program>",
            name: ""
        };
        this.programMetadata[key] = program;
        return program;
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
        var address = this.stringAddresses[key];
        if (!address) {
            this.ensureLinearHeap();
            address = this.heapRecords.allocateString(value);
            this.decodedStrings["$" + address] = value;
        }
        this.stringAddresses[key] = address;
        this.internedStrings[key] = address;
        delete this.transientStringAddresses[key];
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

    Runtime.prototype.computedStringAddress = function (value) {
        value = String(value);
        var key = "$" + value;
        var address = this.stringAddresses[key];
        if (!address) {
            this.ensureLinearHeap();
            address = this.heapRecords.allocateString(value);
            this.stringAddresses[key] = address;
            this.transientStringAddresses[key] = address;
            this.decodedStrings["$" + address] = value;
            this.noteAllocation(1);
        }
        return address;
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
        if (bump >= this.gcHeapPressureBump) {
            if (this.linearHeap.allocationLimit <
                this.linearHeap.maximumAllocationLimit) {
                /* The backing reservation and all guest references are stable
                 * offsets, so logical growth is cheap and cannot invalidate a
                 * pointer. Prefer the fresh contiguous tail to repeatedly
                 * carving tiny regions out of a fragmented young heap. */
                this.linearHeap.growToFit(
                    this.linearHeap.allocationLimit + 1);
                this.resetHeapPressureBump(0);
            } else this.gcPending = true;
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
        /* The Object constructor and Object.create expose this record on both
         * execution backends. It is guest-heap state even when Node supplies
         * the low-level JavaScript backend. */
        this.objectPrototype = this.makeObject();
        this.functionPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        this.stringPrototype = this.makeObject();
        this.numberPrototype = this.makeObject();
        this.booleanPrototype = this.makeObject();
        this.regexpPrototype = this.heapNativeBuiltins ? this.makeObject() : null;
        this.strictArgumentsThrower = this.makeNativeFunction(
            "ThrowTypeError", function () {
                throw new TypeError("restricted arguments property");
            });
        if (this.functionPrototype) {
            this.defineInternalValue(this.functionPrototype,
                "\x00StrictArgumentsThrower", this.strictArgumentsThrower);
        }
        this.primitiveValueKey = "\x00PrimitiveValue";
        /* ES5.1 15.5.4: String.prototype is the empty String value and exposes
         * its immutable, non-enumerable length as an own data property. */
        this.defineDataProperty(this.stringPrototype, "length", 0, 0);
        if (this.objectPrototype) {
            this.heapRecords.setObjectPrototype(
                this.globalObject.heapAddress, this.objectPrototype.heapAddress);
        }
        this.setGlobal("undefined", undefined);
        this.setGlobal("NaN", NaN);
        this.setGlobal("Infinity", Infinity);
        ErrorSupport.install(this);
        this.installDateBuiltins();
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
        this.setGlobal("parseFloat", this.makeNativeFunction("parseFloat",
            function (receiver, args) {
                return parseFloat(String(args[0]));
            }));
        this.setGlobal("isNaN", this.makeNativeFunction("isNaN",
            function (receiver, args) {
                return isNaN(Number(args[0]));
            }));
        this.setGlobal("isFinite", this.makeNativeFunction("isFinite",
            function (receiver, args) {
                return isFinite(Number(args[0]));
            }));
        this.setGlobal("escape", this.makeNativeFunction("escape",
            function (receiver, args) {
                return legacyEscape(args.length ? args[0] : undefined);
            }));
        this.setGlobal("unescape", this.makeNativeFunction("unescape",
            function (receiver, args) {
                return legacyUnescape(args.length ? args[0] : undefined);
            }));
        function installURIFunction(name, encode, component) {
            var callable = runtime.makeNativeFunction(name,
                function (receiver, args) {
                    var value = args.length ? args[0] : undefined;
                    return encode ? encodeURIValue(value, component) :
                                    decodeURIValue(value, component);
                });
            runtime.defineDataProperty(callable, "length", 1, 0);
            runtime.setGlobal(name, callable);
        }
        installURIFunction("encodeURI", true, false);
        installURIFunction("encodeURIComponent", true, true);
        installURIFunction("decodeURI", false, false);
        installURIFunction("decodeURIComponent", false, true);
        this.stringMethods = {};
        this.stringMethods.charAt = this.makeNativeFunction("String.charAt",
            function (receiver, args) {
                return runtime.toString(receiver).charAt(Number(args[0]) || 0);
            }, "intrinsic", NativeIntrinsics.STRING_CHAR_AT);
        this.stringMethods.charCodeAt = this.makeNativeFunction("String.charCodeAt",
            function (receiver, args) {
                return runtime.toString(receiver).charCodeAt(Number(args[0]) || 0);
            }, "intrinsic", NativeIntrinsics.STRING_CHAR_CODE_AT);
        this.stringMethods.indexOf = this.makeNativeFunction("String.indexOf",
            function (receiver, args) {
                return runtime.toString(receiver).indexOf(String(args[0]),
                    args.length > 1 ? Number(args[1]) : 0);
            }, "intrinsic", NativeIntrinsics.STRING_INDEX_OF);
        this.stringMethods.lastIndexOf = this.makeNativeFunction("String.lastIndexOf",
            function (receiver, args) {
                var text = runtime.toString(receiver);
                return text.lastIndexOf(String(args[0]),
                    args.length > 1 ? Number(args[1]) : text.length);
            });
        this.stringMethods.substring = this.makeNativeFunction("String.substring",
            function (receiver, args) {
                return args.length > 1 ? runtime.toString(receiver).substring(Number(args[0]), Number(args[1])) :
                                         runtime.toString(receiver).substring(Number(args[0]));
            }, "intrinsic", NativeIntrinsics.STRING_SUBSTRING);
        this.stringMethods.substr = this.makeNativeFunction("String.substr",
            function (receiver, args) {
                return args.length > 1 ? runtime.toString(receiver).substr(Number(args[0]),
                    Number(args[1])) : runtime.toString(receiver).substr(Number(args[0]));
            }, "intrinsic", NativeIntrinsics.STRING_SUBSTR);
        this.stringMethods.toLowerCase = this.makeNativeFunction("String.toLowerCase",
            function (receiver) { return runtime.toString(receiver).toLowerCase(); });
        this.stringMethods.split = this.makeNativeFunction("String.split",
            function (receiver, args) {
                var separator = args.length ? args[0] : undefined;
                if (separator && separator.guestType === "regexp") {
                    separator = runtime.hostRegExp(separator);
                } else if (separator !== undefined) {
                    separator = String(separator);
                }
                var parts = args.length > 1 ?
                    runtime.toString(receiver).split(separator, Number(args[1])) :
                    runtime.toString(receiver).split(separator);
                return runtime.arrayFrom(parts);
            });
        this.stringMethods.match = this.makeNativeFunction("String.match",
            function (receiver, args) {
                var regexp = args.length ? args[0] : undefined;
                if (regexp && regexp.guestType === "regexp") {
                    regexp = runtime.hostRegExp(regexp);
                } else {
                    regexp = new RegExp(regexp === undefined ? "" :
                                        String(regexp));
                }
                var match = runtime.toString(receiver).match(regexp);
                if (!match) return null;
                var result = runtime.arrayFrom(match);
                if (match.index !== undefined) {
                    runtime.setProperty(result, "index", match.index);
                    runtime.setProperty(result, "input", match.input);
                }
                return result;
            });
        this.stringMethods.replace = this.makeNativeFunction("String.replace",
            function (receiver, args) {
                var search = args[0];
                var replacementInput = runtime.toString(receiver);
                var regexpSearch = false;
                if (search && search.guestType === "regexp") {
                    search = runtime.hostRegExp(search);
                    regexpSearch = true;
                }
                var replacement = args[1];
                var replaced;
                if (!regexpSearch) {
                    var searchText = String(search);
                    var matchIndex = replacementInput.indexOf(searchText);
                    if (matchIndex < 0) return replacementInput;
                    var prefix = replacementInput.substring(0, matchIndex);
                    var suffix = replacementInput.substring(
                        matchIndex + searchText.length);
                    var replacementText;
                    if (replacement &&
                        (replacement.guestType === "function" ||
                         replacement.guestType === "bytecodeFunction")) {
                        replacementText = runtime.toString(
                            runtime.invokePropertyFunction(replacement,
                                undefined,
                                [searchText, matchIndex, replacementInput]));
                    } else {
                        replacementText = expandStringReplacement(
                            replacement, searchText, prefix, suffix);
                    }
                    return prefix + replacementText + suffix;
                }
                if (replacement && (replacement.guestType === "function" ||
                                    replacement.guestType === "bytecodeFunction")) {
                    replaced = replacementInput.replace(search, function () {
                        var callbackArguments = [];
                        var callbackIndex = 0;
                        while (callbackIndex < arguments.length) {
                            callbackArguments.push(arguments[callbackIndex++]);
                        }
                        return runtime.toString(runtime.invokePropertyFunction(
                            replacement, undefined, callbackArguments));
                    });
                } else {
                    replaced = replacementInput.replace(search, String(replacement));
                }
                return replaced;
            }, "intrinsic", NativeIntrinsics.STRING_REPLACE);
        this.stringMethods.toUpperCase = this.makeNativeFunction("String.toUpperCase",
            function (receiver) { return runtime.toString(receiver).toUpperCase(); });
        this.stringMethods.trim = this.makeNativeFunction("String.trim",
            function (receiver) { return runtime.toString(receiver).replace(/^\s+|\s+$/g, ""); });
        if (this.stringPrototype) {
            var stringMethodName;
            for (stringMethodName in this.stringMethods) {
                if (own(this.stringMethods, stringMethodName)) {
                    this.setProperty(this.stringPrototype, stringMethodName,
                                     this.stringMethods[stringMethodName]);
                }
            }
        }
        this.stringMethods.toString = this.makeNativeFunction("String.toString",
            function (receiver) { return runtime.stringValue(receiver); });
        this.stringMethods.valueOf = this.makeNativeFunction("String.valueOf",
            function (receiver) { return runtime.stringValue(receiver); });
        this.setProperty(this.stringPrototype, "toString",
                         this.stringMethods.toString);
        this.setProperty(this.stringPrototype, "valueOf",
                         this.stringMethods.valueOf);
        this.arrayMethods = {};
        /* Array.prototype is observable through instanceof even on the
         * structured JS backend; it cannot be a host-only virtual method bag. */
        this.arrayPrototype = this.makeObject();
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
            function (receiver, args) {
                var values = runtime.arrayToHost(receiver);
                var comparator = args[0];
                if (comparator !== undefined) {
                    if (!comparator || (comparator.guestType !== "function" &&
                                        comparator.guestType !== "bytecodeFunction")) {
                        throw new TypeError("Array.sort comparator is not callable");
                    }
                    values.sort(function (left, right) {
                        return Number(runtime.invokePropertyFunction(
                            comparator, undefined, [left, right])) || 0;
                    });
                } else values.sort();
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
            }, "intrinsic", NativeIntrinsics.ARRAY_SHIFT);
        this.arrayMethods.pop = this.makeNativeFunction("Array.pop",
            function (receiver) {
                var values = runtime.arrayToHost(receiver);
                var result = values.pop();
                runtime.replaceArray(receiver, values);
                return result;
            }, "intrinsic", NativeIntrinsics.ARRAY_POP);
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
            }, "intrinsic", NativeIntrinsics.ARRAY_CONCAT);
        this.arrayMethods.slice = this.makeNativeFunction("Array.slice",
            function (receiver, args) {
                var start = args.length ? Number(args[0]) : 0;
                var values = runtime.arrayToHost(receiver);
                var end = args.length > 1 ? Number(args[1]) : values.length;
                return runtime.arrayFrom(values.slice(start, end));
            }, "intrinsic", NativeIntrinsics.ARRAY_SLICE);
        this.arrayMethods.splice = this.makeNativeFunction("Array.splice",
            function (receiver, args) {
                var values = runtime.arrayToHost(receiver);
                var length = values.length;
                var start = args.length ? Number(args[0]) : 0;
                start = start < 0 ? Math.ceil(start) : Math.floor(start);
                if (start < 0) start = Math.max(length + start, 0);
                else if (start > length) start = length;
                var deleteCount = args.length < 2 ? length - start : Number(args[1]);
                deleteCount = deleteCount < 0 ? 0 : Math.floor(deleteCount);
                if (deleteCount > length - start) deleteCount = length - start;
                var spliceArguments = [start, deleteCount];
                var argumentIndex = 2;
                while (argumentIndex < args.length) {
                    spliceArguments.push(args[argumentIndex++]);
                }
                var removed = Array.prototype.splice.apply(values, spliceArguments);
                runtime.replaceArray(receiver, values);
                return runtime.arrayFrom(removed);
            });
        this.arrayMethods.join = this.makeNativeFunction("Array.join",
            function (receiver, args) {
                var separator = args.length && args[0] !== undefined ?
                                String(args[0]) : ",";
                return runtime.joinArrayValues(receiver, separator);
            }, "intrinsic", NativeIntrinsics.ARRAY_JOIN);
        this.arrayMethods.forEach = this.makeNativeFunction("Array.forEach",
            function (receiver, args) {
                var callback = args[0];
                if (!callback || (callback.guestType !== "function" &&
                                  callback.guestType !== "bytecodeFunction")) {
                    throw new TypeError("Array.forEach callback is not callable");
                }
                var thisArgument = args.length > 1 ? args[1] : undefined;
                var length = runtime.arrayLength(receiver);
                var index = 0;
                while (index < length) {
                    if (runtime.arrayHas(receiver, index)) {
                        runtime.invokePropertyFunction(callback, thisArgument,
                            [runtime.arrayGet(receiver, index), index, receiver]);
                    }
                    index++;
                }
                return undefined;
            });
        this.arrayMethods.indexOf = this.makeNativeFunction("Array.indexOf",
            function (receiver, args) {
                var length = runtime.arrayLength(receiver);
                if (!length) return -1;
                var start = args.length > 1 ? Number(args[1]) : 0;
                if (start !== start) start = 0;
                else if (start !== 0 && start !== Infinity &&
                         start !== -Infinity) {
                    start = start < 0 ? Math.ceil(start) : Math.floor(start);
                }
                if (start >= length || start === Infinity) return -1;
                if (start < 0) start = Math.max(length + start, 0);
                var sought = args.length ? args[0] : undefined;
                while (start < length) {
                    if (runtime.arrayHas(receiver, start) &&
                        runtime.arrayGet(receiver, start) === sought) {
                        return start;
                    }
                    start++;
                }
                return -1;
            });
        this.objectMethods = {};
        this.objectMethods.hasOwnProperty = this.makeNativeFunction(
            "Object.hasOwnProperty", function (receiver, args) {
                return runtime.hasOwnProperty(receiver, String(args[0]));
            }, "intrinsic", NativeIntrinsics.OBJECT_HAS_OWN_PROPERTY);
        this.objectMethods.toString = this.makeNativeFunction(
            "Object.toString", function (receiver) {
                if (receiver === undefined) return "[object Undefined]";
                if (receiver === null) return "[object Null]";
                if (receiver && receiver.guestType === "array") {
                    return "[object Array]";
                }
                if (receiver && receiver.guestType === "regexp") {
                    return "[object RegExp]";
                }
                if (receiver && (receiver.guestType === "function" ||
                                 receiver.guestType === "bytecodeFunction")) {
                    return "[object Function]";
                }
                var boxedReceiver = runtime.primitiveWrapperValue(receiver);
                if (boxedReceiver.found) {
                    if (typeof boxedReceiver.value === "string") {
                        return "[object String]";
                    }
                    if (typeof boxedReceiver.value === "number") {
                        return "[object Number]";
                    }
                    if (typeof boxedReceiver.value === "boolean") {
                        return "[object Boolean]";
                    }
                }
                if (typeof receiver === "string") return "[object String]";
                if (typeof receiver === "number") return "[object Number]";
                if (typeof receiver === "boolean") return "[object Boolean]";
                return "[object Object]";
            });
        this.objectMethods.valueOf = this.makeNativeFunction(
            "Object.valueOf", function (receiver) {
                if (receiver === null || receiver === undefined) {
                    throw new TypeError("Object.valueOf receiver is null or undefined");
                }
                return receiver;
            });
        if (this.objectPrototype) {
            this.setProperty(this.objectPrototype, "hasOwnProperty",
                             this.objectMethods.hasOwnProperty);
            this.setProperty(this.objectPrototype, "toString",
                             this.objectMethods.toString);
            this.setProperty(this.objectPrototype, "valueOf",
                             this.objectMethods.valueOf);
        }
        if (this.arrayPrototype) {
            var arrayMethodName;
            for (arrayMethodName in this.arrayMethods) {
                if (own(this.arrayMethods, arrayMethodName)) {
                    this.setProperty(this.arrayPrototype, arrayMethodName,
                                     this.arrayMethods[arrayMethodName]);
                }
            }
            this.arrayMethods.toString = this.makeNativeFunction(
                "Array.toString", function (receiver) {
                    var join = runtime.getProperty(receiver, "join");
                    if (join && (join.guestType === "function" ||
                                 join.guestType === "bytecodeFunction")) {
                        return runtime.invokePropertyFunction(
                            join, receiver, []);
                    }
                    return runtime.invokePropertyFunction(
                        runtime.objectMethods.toString, receiver, []);
                });
            this.setProperty(this.arrayPrototype, "toString",
                             this.arrayMethods.toString);
        }
        var objectConstructor = this.makeNativeFunction("Object",
            function (receiver, args) {
                var value = args.length ? args[0] : undefined;
                if (value && value.guestType) return value;
                if (value === null || value === undefined) {
                    return runtime.makeObject();
                }
                return runtime.toObject(value);
            });
        objectConstructor.constructCallback = function (args) {
            var value = args.length ? args[0] : undefined;
            if (value && value.guestType) return value;
            if (value === null || value === undefined) {
                return runtime.makeObject();
            }
            return runtime.toObject(value);
        };
        if (this.objectPrototype) {
            this.setProperty(objectConstructor, "prototype",
                             this.objectPrototype);
            this.setProperty(this.objectPrototype, "constructor",
                             objectConstructor);
        }
        this.setProperty(objectConstructor, "defineProperty",
            this.makeNativeFunction("Object.defineProperty",
                function (receiver, args) {
                    var object = args[0];
                    var key = runtime.propertyKey(args[1]);
                    var descriptor = args[2];
                    if (!object || !object.guestType) {
                        throw new TypeError("Object.defineProperty target is not an object");
                    }
                    if (!descriptor || !descriptor.guestType) {
                        throw new TypeError("property descriptor is not an object");
                    }
                    var hasGetter = runtime.hasOwnProperty(descriptor, "get");
                    var hasSetter = runtime.hasOwnProperty(descriptor, "set");
                    var hasValue = runtime.hasOwnProperty(descriptor, "value");
                    var hasWritable = runtime.hasOwnProperty(
                        descriptor, "writable");
                    if ((hasGetter || hasSetter) &&
                        (hasValue || hasWritable)) {
                        throw new TypeError("invalid mixed property descriptor");
                    }
                    var attributes = 0;
                    if (hasWritable &&
                        runtime.getProperty(descriptor, "writable")) {
                        attributes |= 1;
                    }
                    if (runtime.getProperty(descriptor, "enumerable")) {
                        attributes |= 2;
                    }
                    if (runtime.getProperty(descriptor, "configurable")) {
                        attributes |= 4;
                    }
                    var keyAddress = runtime.internStringAddress(key);
                    if (hasGetter || hasSetter) {
                        var getter = hasGetter ?
                            runtime.getProperty(descriptor, "get") : undefined;
                        var setter = hasSetter ?
                            runtime.getProperty(descriptor, "set") : undefined;
                        runtime.defineAccessorProperty(object, keyAddress,
                            getter, setter, attributes);
                    } else {
                        var property = runtime.heapRecords.defineOwnProperty(
                            object.heapAddress, keyAddress, attributes);
                        runtime.heapRecords.setPropertySetter(property, 0);
                        var propertyValue = hasValue ?
                            runtime.getProperty(descriptor, "value") : undefined;
                        runtime.writeHeapValue(
                            runtime.heapRecords.propertyValueCell(property),
                            propertyValue);
                    }
                    object.propertyVersion++;
                    object.valueVersion++;
                    return object;
                }));
        this.setProperty(objectConstructor, "create",
            this.makeNativeFunction("Object.create", function (receiver, args) {
                return runtime.makeObjectWithPrototype(args[0]);
            }));
        this.setProperty(objectConstructor, "getPrototypeOf",
            this.makeNativeFunction("Object.getPrototypeOf",
                function (receiver, args) {
                    var object = args[0];
                    if (!object || !object.guestType || !object.heapAddress) {
                        throw new TypeError(
                            "Object.getPrototypeOf target is not an object");
                    }
                    var prototype = runtime.heapRecords.objectPrototype(
                        object.heapAddress);
                    return prototype ? runtime.readHeapReference(prototype) : null;
                }));
        this.setProperty(objectConstructor, "getOwnPropertyDescriptor",
            this.makeNativeFunction("Object.getOwnPropertyDescriptor",
                function (receiver, args) {
                    var object = args[0];
                    var key = runtime.propertyKey(args[1]);
                    if (!object || !object.guestType || !object.heapAddress) {
                        throw new TypeError(
                            "property descriptor target is not an object");
                    }
                    var descriptor = runtime.makeObject();
                    if (object.guestType === "array" && key === "length" &&
                        !runtime.isArgumentsObject(object)) {
                        runtime.setProperty(descriptor, "value",
                            runtime.arrayLength(object));
                        runtime.setProperty(descriptor, "writable", true);
                        runtime.setProperty(descriptor, "enumerable", false);
                        runtime.setProperty(descriptor, "configurable", false);
                        return descriptor;
                    }
                    if ((object.guestType === "array" ||
                         object.guestType === "buffer" ||
                         object.guestType === "typedArray") &&
                        isArrayIndex(key) &&
                        runtime.hasOwnProperty(object, key)) {
                        runtime.setProperty(descriptor, "value",
                            runtime.getProperty(object, key));
                        runtime.setProperty(descriptor, "writable", true);
                        runtime.setProperty(descriptor, "enumerable", true);
                        runtime.setProperty(descriptor, "configurable", true);
                        return descriptor;
                    }
                    var property = runtime.heapOwnProperty(object, key, false);
                    if (!property) return undefined;
                    var attributes = runtime.heapRecords.propertyAttributes(
                        property);
                    if (attributes & HeapRecords.Attributes.ACCESSOR) {
                        runtime.setProperty(descriptor, "get",
                            runtime.readHeapValue(
                                runtime.heapRecords.propertyValueCell(property)));
                        var setter = runtime.heapRecords.propertySetter(property);
                        runtime.setProperty(descriptor, "set", setter ?
                            runtime.readHeapReference(setter) : undefined);
                    } else {
                        runtime.setProperty(descriptor, "value",
                            runtime.readHeapValue(
                                runtime.heapRecords.propertyValueCell(property)));
                        runtime.setProperty(descriptor, "writable",
                            !!(attributes & HeapRecords.Attributes.WRITABLE));
                    }
                    runtime.setProperty(descriptor, "enumerable",
                        !!(attributes & HeapRecords.Attributes.ENUMERABLE));
                    runtime.setProperty(descriptor, "configurable",
                        !!(attributes & HeapRecords.Attributes.CONFIGURABLE));
                    return descriptor;
                }));
        this.setProperty(objectConstructor, "keys",
            this.makeNativeFunction("Object.keys", function (receiver, args) {
                if (!args[0] || !args[0].guestType) {
                    throw new TypeError("Object.keys target is not an object");
                }
                return runtime.keys(args[0]);
            }));
        this.setGlobal("Object", objectConstructor);
        this.functionMethods = {};
        this.functionMethods.call = this.makeNativeFunction("Function.call",
            function () {
                throw new Error("Function.call must be dispatched by the VM");
            }, "intrinsic", NativeIntrinsics.FUNCTION_CALL);
        this.functionMethods.call.intrinsicKind = "functionCall";
        this.functionMethods.apply = this.makeNativeFunction("Function.apply",
            function () {
                throw new Error("Function.apply must be dispatched by the VM");
            }, "intrinsic", NativeIntrinsics.FUNCTION_APPLY);
        this.functionMethods.apply.intrinsicKind = "functionApply";
        this.functionMethods.bind = this.makeNativeFunction("Function.bind",
            function (receiver, args) {
                if (!receiver || (receiver.guestType !== "function" &&
                                  receiver.guestType !== "bytecodeFunction")) {
                    throw new TypeError("Function.bind receiver is not callable");
                }
                var target = receiver;
                var boundReceiver = args.length ? args[0] : undefined;
                var boundArguments = runtime.arrayFrom(args.slice(1));
                var boundFunction = runtime.makeNativeFunction(
                    "bound " + (target.name || ""),
                    function (ignoredReceiver, callArguments) {
                        var storedTarget = runtime.getProperty(
                            boundFunction, "\x00boundTarget");
                        var storedReceiver = runtime.getProperty(
                            boundFunction, "\x00boundReceiver");
                        var combined = runtime.arrayToHost(runtime.getProperty(
                            boundFunction, "\x00boundArguments"));
                        var callIndex = 0;
                        while (callIndex < callArguments.length) {
                            combined.push(callArguments[callIndex++]);
                        }
                        return runtime.invokePropertyFunction(storedTarget,
                            storedReceiver, combined);
                    });
                runtime.setProperty(boundFunction, "\x00boundTarget", target);
                runtime.setProperty(boundFunction, "\x00boundReceiver", boundReceiver);
                runtime.setProperty(boundFunction, "\x00boundArguments", boundArguments);
                return boundFunction;
            });
        this.functionMethods.toString = this.makeNativeFunction("Function.toString",
            function (receiver) {
                if (receiver.guestType === "bytecodeFunction" && receiver.source) {
                    return receiver.source;
                }
                return "function " + (receiver.name || "") + "() { [native code] }";
            });
        if (this.functionPrototype) {
            var functionMethodName;
            for (functionMethodName in this.functionMethods) {
                if (own(this.functionMethods, functionMethodName)) {
                    this.setProperty(this.functionPrototype, functionMethodName,
                                     this.functionMethods[functionMethodName]);
                }
            }
        }
        this.numberMethods = {};
        this.numberMethods.valueOf = this.makeNativeFunction("Number.valueOf",
            function (receiver) { return runtime.numberValue(receiver); });
        this.numberMethods.toString = this.makeNativeFunction("Number.toString",
            function (receiver, args) {
                return runtime.numberValue(receiver).toString(
                    args.length ? runtime.toNumber(args[0]) : 10);
            });
        this.numberMethods.toFixed = this.makeNativeFunction("Number.toFixed",
            function (receiver, args) {
                return runtime.numberValue(receiver).toFixed(
                    args.length ? runtime.toNumber(args[0]) : 0);
            });
        this.numberMethods.toPrecision = this.makeNativeFunction(
            "Number.toPrecision", function (receiver, args) {
                var value = runtime.numberValue(receiver);
                if (!args.length || args[0] === undefined) {
                    return value.toString();
                }
                var precision = Number(args[0]);
                if (precision !== Math.floor(precision) ||
                    precision < 1 || precision > 21) {
                    throw new RangeError("precision out of range");
                }
                return value.toPrecision(precision);
            });
        this.setProperty(this.numberPrototype, "valueOf",
                         this.numberMethods.valueOf);
        this.setProperty(this.numberPrototype, "toString",
                         this.numberMethods.toString);
        this.setProperty(this.numberPrototype, "toFixed",
                         this.numberMethods.toFixed);
        this.setProperty(this.numberPrototype, "toPrecision",
                         this.numberMethods.toPrecision);
        this.regexpMethods = {};
        this.regexpMethods.test = this.makeNativeFunction("RegExp.test",
            function (receiver, args) {
                return runtime.hostRegExp(receiver).test(String(args[0]));
            }, "intrinsic", NativeIntrinsics.REGEXP_TEST);
        this.regexpMethods.exec = this.makeNativeFunction("RegExp.exec",
            function (receiver, args) {
                var match = runtime.hostRegExp(receiver).exec(String(args[0]));
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
        function regexpArguments(args, constructing) {
            var patternValue = args.length ? args[0] : undefined;
            var flagsValue = args.length > 1 ? args[1] : undefined;
            if (patternValue && patternValue.guestType === "regexp") {
                if (flagsValue !== undefined) {
                    throw new TypeError("flags supplied with a RegExp pattern");
                }
                if (!constructing) return {same: patternValue};
                return {
                    pattern: runtime.heapRecords.regexpPattern(
                        patternValue.heapAddress),
                    flags: runtime.heapRecords.regexpFlags(
                        patternValue.heapAddress)
                };
            }
            var pattern = patternValue === undefined ? "" :
                runtime.toString(patternValue);
            var flags = flagsValue === undefined ? "" :
                runtime.toString(flagsValue);
            var seenGlobal = false;
            var seenIgnoreCase = false;
            var seenMultiline = false;
            var flagIndex = 0;
            while (flagIndex < flags.length) {
                var flag = flags.charAt(flagIndex++);
                if (flag === "g" && !seenGlobal) seenGlobal = true;
                else if (flag === "i" && !seenIgnoreCase) seenIgnoreCase = true;
                else if (flag === "m" && !seenMultiline) seenMultiline = true;
                else throw new SyntaxError("invalid regular expression flags");
            }
            return {pattern: pattern, flags: flags};
        }
        var regexpConstructor = this.makeNativeFunction("RegExp",
            function (receiver, args) {
                var parsed = regexpArguments(args, false);
                return parsed.same || runtime.makeRegExp(
                    parsed.pattern, parsed.flags);
            }, "intrinsic", NativeIntrinsics.REGEXP_CONSTRUCTOR);
        regexpConstructor.constructCallback = function (args) {
            var parsed = regexpArguments(args, true);
            return runtime.makeRegExp(parsed.pattern, parsed.flags);
        };
        this.defineDataProperty(regexpConstructor, "length", 2, 0);
        if (this.regexpPrototype) {
            this.setProperty(regexpConstructor, "prototype", this.regexpPrototype);
            this.setProperty(this.regexpPrototype, "constructor", regexpConstructor);
        }
        this.setGlobal("RegExp", regexpConstructor);
        var stringConstructor = this.makeNativeFunction("String",
            function (receiver, args) {
                return args.length ? runtime.toString(args[0]) : "";
            }, "intrinsic", NativeIntrinsics.STRING_CONSTRUCTOR);
        stringConstructor.constructCallback = function (args) {
            return runtime.makePrimitiveWrapper(
                args.length ? runtime.toString(args[0]) : "",
                runtime.stringPrototype);
        };
        this.setProperty(stringConstructor, "prototype", this.stringPrototype);
        this.setProperty(this.stringPrototype, "constructor", stringConstructor);
        this.setProperty(stringConstructor, "fromCharCode", this.makeNativeFunction(
            "String.fromCharCode", function (receiver, args) {
                var codes = [];
                var codeIndex = 0;
                while (codeIndex < args.length) {
                    codes[codeIndex] = runtime.toNumber(args[codeIndex]);
                    codeIndex++;
                }
                return String.fromCharCode.apply(String, codes);
            }, "intrinsic", NativeIntrinsics.STRING_FROM_CHAR_CODE));
        this.setGlobal("String", stringConstructor);
        var numberConstructor = this.makeNativeFunction("Number",
            function (receiver, args) {
                return args.length ? runtime.toNumber(args[0]) : 0;
            }, "intrinsic", NativeIntrinsics.NUMBER_CONSTRUCTOR);
        numberConstructor.constructCallback = function (args) {
            return runtime.makePrimitiveWrapper(
                args.length ? runtime.toNumber(args[0]) : 0,
                runtime.numberPrototype);
        };
        this.setProperty(numberConstructor, "prototype", this.numberPrototype);
        this.setProperty(this.numberPrototype, "constructor", numberConstructor);
        /* ES5.1 15.7.3. These values are guest primitive cells attached to
         * the guest constructor object; they are not borrowed objects from
         * the host's Number constructor. */
        this.setProperty(numberConstructor, "MAX_VALUE",
                         1.7976931348623157e308);
        this.setProperty(numberConstructor, "MIN_VALUE", 5e-324);
        this.setProperty(numberConstructor, "NaN", NaN);
        this.setProperty(numberConstructor, "NEGATIVE_INFINITY", -Infinity);
        this.setProperty(numberConstructor, "POSITIVE_INFINITY", Infinity);
        this.setGlobal("Number", numberConstructor);
        this.booleanMethods = {};
        this.booleanMethods.toString = this.makeNativeFunction("Boolean.toString",
            function (receiver) {
                return runtime.booleanValue(receiver) ? "true" : "false";
            });
        this.booleanMethods.valueOf = this.makeNativeFunction("Boolean.valueOf",
            function (receiver) { return runtime.booleanValue(receiver); });
        this.setProperty(this.booleanPrototype, "toString",
                         this.booleanMethods.toString);
        this.setProperty(this.booleanPrototype, "valueOf",
                         this.booleanMethods.valueOf);
        var booleanConstructor = this.makeNativeFunction("Boolean",
            function (receiver, args) {
                return args.length ? runtime.truthy(args[0]) : false;
            });
        booleanConstructor.constructCallback = function (args) {
            return runtime.makePrimitiveWrapper(
                args.length ? runtime.truthy(args[0]) : false,
                runtime.booleanPrototype);
        };
        this.setProperty(booleanConstructor, "prototype", this.booleanPrototype);
        this.setProperty(this.booleanPrototype, "constructor", booleanConstructor);
        this.setGlobal("Boolean", booleanConstructor);
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
            }, "intrinsic", NativeIntrinsics.ARRAY_CONSTRUCTOR);
        /* ES5.1 15.4.3.2: the Array constructor's formal length is one. */
        this.defineDataProperty(arrayConstructor, "length", 1, 0);
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
        }, NativeIntrinsics.MATH_ATAN2);
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

    Runtime.prototype.installDateBuiltins = function () {
        var runtime = this;
        var dateValueKey = "\x00DateValue";
        this.dateValueKey = dateValueKey;
        this.datePrototype = this.makeObject();
        function dateValue(receiver) {
            return Number(runtime.getProperty(receiver, dateValueKey));
        }
        function method(name, field, intrinsicId) {
            runtime.setProperty(runtime.datePrototype, name,
                runtime.makeNativeFunction("Date." + name,
                    function (receiver) {
                        if (!field) return dateValue(receiver);
                        return DateSupport.field(dateValue(receiver), field);
                    }, "intrinsic", intrinsicId || NativeIntrinsics.NONE));
        }
        method("getDate", "Date", NativeIntrinsics.DATE_GET_DATE);
        method("getMonth", "Month", NativeIntrinsics.DATE_GET_MONTH);
        method("getFullYear", "FullYear",
               NativeIntrinsics.DATE_GET_FULL_YEAR);
        method("getHours", "Hours", NativeIntrinsics.DATE_GET_HOURS);
        method("getMinutes", "Minutes", NativeIntrinsics.DATE_GET_MINUTES);
        method("getSeconds", "Seconds", NativeIntrinsics.DATE_GET_SECONDS);
        method("getMilliseconds", "Milliseconds",
               NativeIntrinsics.DATE_GET_MILLISECONDS);
        method("getDay", "Day", NativeIntrinsics.DATE_GET_DAY);
        method("getTime", null, NativeIntrinsics.DATE_GET_TIME);
        method("valueOf", null, NativeIntrinsics.DATE_GET_TIME);
        this.setProperty(this.datePrototype, "getTimezoneOffset",
            this.makeNativeFunction("Date.getTimezoneOffset", function () {
                return DateSupport.localTimezoneOffset();
            }, "intrinsic", NativeIntrinsics.DATE_GET_TIMEZONE_OFFSET));
        var dateConstructor = this.makeNativeFunction("Date", function () {
            return String(DateSupport.construct([], runtime.nowMilliseconds ?
                runtime.nowMilliseconds() : 0));
        }, "intrinsic", NativeIntrinsics.DATE_CONSTRUCTOR);
        dateConstructor.constructCallback = function (args) {
            var date = runtime.makeObject();
            runtime.heapRecords.setObjectPrototype(
                date.heapAddress, runtime.datePrototype.heapAddress);
            runtime.setProperty(date, dateValueKey, DateSupport.construct(
                args, runtime.nowMilliseconds ? runtime.nowMilliseconds() : 0));
            return date;
        };
        this.setProperty(dateConstructor, "prototype", this.datePrototype);
        this.setProperty(this.datePrototype, "constructor", dateConstructor);
        this.setProperty(dateConstructor, "now",
            this.makeNativeFunction("Date.now", function () {
                return runtime.nowMilliseconds ? runtime.nowMilliseconds() : 0;
            }));
        this.setGlobal("Date", dateConstructor);
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
            this.nativeInterpreter.setGettimeofdayPointer(
                bridge.resolve("gettimeofday"));
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

    /* Private ABI used by the self-hosted compiler to turn its ordinary guest
     * descriptor objects into authoritative heap bytecode.  The native
     * interpreter will implement these IDs without entering host JavaScript.
     * The callbacks below define the reference-backend semantics. */
    Runtime.prototype.installProgramBuilder = function () {
        var runtime = this;
        function integer(value, name) {
            value = Number(value);
            if (value !== Math.floor(value)) {
                throw new TypeError(name + " must be an integer");
            }
            return value;
        }
        function programFor(callable) {
            if (!callable || callable.guestType !== "bytecodeFunction") {
                throw new TypeError("program handle is not callable bytecode");
            }
            runtime.assertOwned(callable);
            return callable.program;
        }
        this.setGlobal("__guestVMProgramCreate", this.makeNativeFunction(
            "__guestVMProgramCreate", function (receiver, args) {
                var codeLength = integer(args[0], "code length");
                var constantLength = integer(args[1], "constant length");
                var bindingLength = integer(args[2], "binding-register length");
                var parameterLength = integer(args[3], "parameter length");
                var bindingCount = integer(args[9], "binding count");
                if (codeLength < 0 || constantLength < 0 || bindingLength < 0 ||
                    parameterLength < 0 || bindingCount < 0) {
                    throw new RangeError("negative program length");
                }
                var program = {
                    code: new Array(codeLength),
                    constants: new Array(constantLength),
                    constantRegisters: new Array(constantLength),
                    bindingRegisters: bindingLength ? new Array(bindingLength) : null,
                    parameters: new Array(parameterLength),
                    parameterSlots: new Array(parameterLength),
                    registerCount: integer(args[4], "register count"),
                    argumentsSlot: integer(args[5], "arguments slot"),
                    thisSlot: integer(args[6], "this slot"),
                    functionNameSlot: integer(args[7], "function-name slot"),
                    usesArguments: !!args[8],
                    bindings: bindingCount ? new Array(bindingCount) : null,
                    globalDeclarations: []
                };
                var index = 0;
                while (index < constantLength) {
                    program.constants[index] = undefined;
                    program.constantRegisters[index] = -1;
                    index++;
                }
                index = 0;
                while (program.bindingRegisters &&
                       index < program.bindingRegisters.length) {
                    program.bindingRegisters[index++] = -1;
                }
                index = 0;
                while (index < parameterLength) program.parameterSlots[index++] = -1;
                runtime.registerProgram(program);
                return runtime.makeGuestFunction(program, null, null);
            }, "intrinsic", NativeIntrinsics.PROGRAM_CREATE));
        this.setGlobal("__guestVMProgramSetCode", this.makeNativeFunction(
            "__guestVMProgramSetCode", function (receiver, args) {
                var program = programFor(args[0]);
                var index = integer(args[1], "code index");
                var value = integer(args[2], "bytecode word");
                if (index < 0 || index >= program.code.length) {
                    throw new RangeError("bytecode index is out of bounds");
                }
                program.code[index] = value;
                runtime.heapRecords.setBytecodeWord(
                    program.heapBytecodeAddress, index, value);
                return args[0];
            }, "intrinsic", NativeIntrinsics.PROGRAM_SET_CODE));
        this.setGlobal("__guestVMProgramSetConstant", this.makeNativeFunction(
            "__guestVMProgramSetConstant", function (receiver, args) {
                var program = programFor(args[0]);
                var index = integer(args[1], "constant index");
                var value = args[2];
                if (index < 0 || index >= program.constants.length) {
                    throw new RangeError("constant index is out of bounds");
                }
                if (value && value.guestType === "bytecodeFunction") {
                    value = value.program;
                    runtime.valueCells.writeReferenceAt(
                        runtime.heapRecords.vectorCell(
                            program.heapConstantsAddress, index),
                        runtime.programAddress(value));
                } else {
                    runtime.writeConstantHeapValue(
                        runtime.heapRecords.vectorCell(
                            program.heapConstantsAddress, index), value);
                }
                program.constants[index] = value;
                return args[0];
            }, "intrinsic", NativeIntrinsics.PROGRAM_SET_CONSTANT));
        this.setGlobal("__guestVMProgramSetVector", this.makeNativeFunction(
            "__guestVMProgramSetVector", function (receiver, args) {
                var program = programFor(args[0]);
                var kind = integer(args[1], "program vector kind");
                var index = integer(args[2], "program vector index");
                var value = integer(args[3], "program vector value");
                var values;
                var address;
                if (kind === 0) {
                    values = program.constantRegisters;
                    address = program.heapConstantRegistersAddress;
                } else if (kind === 1) {
                    values = program.bindingRegisters;
                    address = program.heapBindingRegistersAddress;
                } else if (kind === 2) {
                    values = program.parameterSlots;
                    address = program.heapParameterSlotsAddress;
                } else throw new RangeError("unknown program vector kind");
                if (!values || index < 0 || index >= values.length) {
                    throw new RangeError("program vector index is out of bounds");
                }
                values[index] = value;
                runtime.writeHeapValue(
                    runtime.heapRecords.vectorCell(address, index), value);
                return args[0];
            }, "intrinsic", NativeIntrinsics.PROGRAM_SET_VECTOR));
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

    Runtime.prototype.reportExceptionState = function (error, frame) {
        if (!this.traceExceptions || !frame) return;
        var line = "guest exception " +
            (error.guestFilename || frame.program.filename || "<guest>") +
            ":" + (error.guestLine || 1) + ":" +
            (error.guestColumn || 1);
        var bindings = frame.program.bindings || [];
        var bindingSlots = frame.program.bindingSlots || {};
        var index = 0;
        while (index < bindings.length) {
            var name = bindings[index++];
            var value;
            try {
                var slot = bindingSlots["$" + name];
                var bindingRegister = frame.program.bindingRegisters &&
                    frame.program.bindingRegisters[slot];
                if (bindingRegister !== undefined && bindingRegister >= 0) {
                    value = this.readHeapValue(
                        this.heapRecords.frameRegisterCell(
                            frame.heapAddress, bindingRegister));
                } else {
                    value = this.getBinding(frame.context,
                                            frame.environment, name);
                }
                if (value && value.guestType) {
                    value = "<" + value.guestType + "@" +
                            value.heapAddress + ">";
                } else {
                    value = String(value);
                    if (value.length > 80) value = value.substring(0, 77) + "...";
                }
                line += " " + name + "=" + value;
            } catch (ignored) {
                line += " " + name + "=<unavailable>";
            }
        }
        if (typeof print === "function") print(line);
        else if (typeof console !== "undefined" && console.log) console.log(line);
    };

    Runtime.prototype.importCaughtException = function (error) {
        if (!error || error.guestType ||
            (typeof error !== "object" && typeof error !== "function")) {
            return error;
        }
        var name = error.name || "Error";
        var result = ErrorSupport.makeErrorObject(this, name,
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

    Runtime.prototype.setGlobal = function (context, name, value, strict) {
        if (arguments.length === 2) {
            value = name;
            name = context;
            context = null;
        }
        this.assertOwned(value);
        this.setProperty(context ? context.globalObject : this.globalObject,
                         name, value, strict);
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

    Runtime.prototype.getProperty = function (object, key, accessReceiver) {
        if (arguments.length < 3) accessReceiver = object;
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
        if (object.guestType === "typedArray" || object.guestType === "arrayBuffer") {
            return this.typedArraySupport.getProperty(object, key);
        }
        if (object.guestType === "array") {
            if (isDirectArrayIndex(key)) return this.arrayGet(object, key);
            key = this.propertyKey(key);
            if (key === "length" && !this.isArgumentsObject(object)) {
                return this.arrayLength(object);
            }
            if (isArrayIndex(key)) return this.arrayGet(object, Number(key));
            var arrayProperty = this.heapOwnProperty(object, key, false);
            if (arrayProperty) {
                return this.readPropertyRecord(arrayProperty, accessReceiver);
            }
            var arrayPrototypeAddress =
                this.heapRecords.objectPrototype(object.heapAddress);
            if (arrayPrototypeAddress) {
                var inheritedArrayValue = this.getProperty(
                    this.readHeapReference(arrayPrototypeAddress), key,
                    accessReceiver);
                if (inheritedArrayValue !== undefined) {
                    return inheritedArrayValue;
                }
            }
            return this.arrayMethods[key];
        }
        key = this.propertyKey(key);
        this.internStringAddress(key);
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            var property = this.heapOwnProperty(object, key, false);
            if (property) {
                return this.readPropertyRecord(property, accessReceiver);
            }
            if (object.guestType === "regexp") return this.regexpMethods[key];
            var prototypeAddress = this.heapRecords.objectPrototype(object.heapAddress);
            if (prototypeAddress) {
                var inherited = this.getProperty(
                    this.readHeapReference(prototypeAddress), key,
                    accessReceiver);
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
            if (this.stringPrototype) {
                return this.getProperty(
                    this.stringPrototype, key, accessReceiver);
            }
            return this.stringMethods[key];
        }
        if (typeof object === "number") {
            return this.getProperty(
                this.numberPrototype, key, accessReceiver);
        }
        if (typeof object === "boolean") {
            return this.getProperty(
                this.booleanPrototype, key, accessReceiver);
        }
        return undefined;
    };

    Runtime.prototype.hasOwnProperty = function (object, key) {
        key = this.propertyKey(key);
        if (!object || !object.guestType) return false;
        if (object.guestType === "array" && isArrayIndex(key)) {
            return this.arrayHas(object, Number(key));
        }
        if (object.guestType === "array" && key === "length" &&
            !this.isArgumentsObject(object)) return true;
        if (object.guestType === "buffer" && isArrayIndex(key)) {
            return Number(key) < this.bufferSupport.viewLength(object);
        }
        if (object.guestType === "typedArray" && isArrayIndex(key)) {
            return Number(key) < this.typedArraySupport.viewLength(object);
        }
        if (object.heapAddress) {
            return !!this.heapOwnProperty(object, key, false);
        }
        return !!object.properties && own(object.properties, "$" + key);
    };

    Runtime.prototype.hasProperty = function (object, key) {
        this.assertOwned(object);
        if (!object || !object.guestType) {
            throw new TypeError("right-hand side of 'in' is not an object");
        }
        key = this.propertyKey(key);
        if (this.hasOwnProperty(object, key)) return true;
        if (object.guestType === "array") {
            if (key === "length") return true;
            if (!this.arrayPrototype && this.arrayMethods[key]) return true;
        } else if (object.guestType === "buffer") {
            if (key === "length") return true;
        } else if (object.guestType === "typedArray") {
            if (key === "length" || key === "byteLength" ||
                key === "byteOffset" || key === "buffer") return true;
        } else if (object.guestType === "arrayBuffer") {
            if (key === "byteLength") return true;
        } else if (object.guestType === "regexp") {
            if (!this.regexpPrototype && this.regexpMethods[key]) return true;
        } else if (object.guestType === "function" ||
                   object.guestType === "bytecodeFunction") {
            if (!this.functionPrototype && this.functionMethods[key]) return true;
        }
        if (object.heapAddress) {
            var prototypeAddress = this.heapRecords.objectPrototype(
                object.heapAddress);
            if (prototypeAddress) {
                return this.hasProperty(
                    this.readHeapReference(prototypeAddress), key);
            }
        }
        return !!this.objectMethods[key];
    };

    Runtime.prototype.instanceOf = function (value, constructor) {
        this.assertOwned(value);
        this.assertOwned(constructor);
        if (!constructor ||
            (constructor.guestType !== "function" &&
             constructor.guestType !== "bytecodeFunction")) {
            throw new TypeError("right-hand side of 'instanceof' is not callable");
        }
        if (constructor.typedArrayKind !== undefined) {
            return !!value && value.guestType === "typedArray" &&
                this.heapRecords.bufferViewKind(value.heapAddress) ===
                    constructor.typedArrayKind;
        }
        if (constructor.arrayBufferConstructor) {
            return !!value && value.guestType === "arrayBuffer";
        }
        var expected = this.getProperty(constructor, "prototype");
        if (!expected || !expected.guestType) {
            throw new TypeError("constructor prototype is not an object");
        }
        if (!value || !value.guestType || !value.heapAddress) return false;
        var prototypeAddress = this.heapRecords.objectPrototype(
            value.heapAddress);
        while (prototypeAddress) {
            if (prototypeAddress === expected.heapAddress) return true;
            prototypeAddress = this.heapRecords.objectPrototype(
                prototypeAddress);
        }
        return false;
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
            if (removedProperty &&
                !(this.heapRecords.propertyAttributes(removedProperty) &
                  HeapRecords.Attributes.CONFIGURABLE)) return false;
            delete object.propertyAddresses["$" + keyAddress];
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
                if (this.heapRecords.propertyAttributes(property) & 2) {
                    heapKeys.push(this.heapRecords.readString(
                        this.heapRecords.propertyKey(property)));
                }
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

    Runtime.prototype.typeOfGlobal = function (context, name) {
        var globalObject = context ? context.globalObject : this.globalObject;
        if (!this.hasOwnProperty(globalObject, name)) return "undefined";
        return this.typeOf(this.getProperty(globalObject, name));
    };

    Runtime.prototype.primitiveWrapperValue = function (value) {
        if (!value || !value.guestType ||
            !this.hasOwnProperty(value, this.primitiveValueKey)) {
            return {found: false, value: undefined};
        }
        return {found: true,
                value: this.getProperty(value, this.primitiveValueKey)};
    };

    Runtime.prototype.numberValue = function (value) {
        if (typeof value === "number") return value;
        var boxed = this.primitiveWrapperValue(value);
        if (boxed.found && typeof boxed.value === "number") {
            return boxed.value;
        }
        throw new TypeError("Number method receiver is not a number");
    };

    Runtime.prototype.stringValue = function (value) {
        if (typeof value === "string") return value;
        var boxed = this.primitiveWrapperValue(value);
        if (boxed.found && typeof boxed.value === "string") {
            return boxed.value;
        }
        throw new TypeError("String method receiver is not a string");
    };

    Runtime.prototype.booleanValue = function (value) {
        if (typeof value === "boolean") return value;
        var boxed = this.primitiveWrapperValue(value);
        if (boxed.found && typeof boxed.value === "boolean") {
            return boxed.value;
        }
        throw new TypeError("Boolean method receiver is not a boolean");
    };

    Runtime.prototype.toObject = function (value) {
        if (value === null || value === undefined) {
            throw new TypeError("cannot convert null or undefined to object");
        }
        if (value && value.guestType) return value;
        if (typeof value === "string") {
            return this.makePrimitiveWrapper(value, this.stringPrototype);
        }
        if (typeof value === "number") {
            return this.makePrimitiveWrapper(value, this.numberPrototype);
        }
        if (typeof value === "boolean") {
            return this.makePrimitiveWrapper(value, this.booleanPrototype);
        }
        throw new TypeError("cannot convert value to object");
    };

    Runtime.prototype.toPrimitive = function (value, preferredType) {
        if (!value || !value.guestType) return value;
        var boxed = this.primitiveWrapperValue(value);
        if (boxed.found) return boxed.value;
        var stringFirst = preferredType === "string";
        if (!preferredType && this.dateValueKey !== undefined &&
            this.hasOwnProperty(value, this.dateValueKey)) stringFirst = true;
        var firstName = stringFirst ? "toString" : "valueOf";
        var secondName = stringFirst ? "valueOf" : "toString";
        var method = this.getProperty(value, firstName);
        if (method && (method.guestType === "function" ||
                       method.guestType === "bytecodeFunction")) {
            var firstResult = this.invokePropertyFunction(method, value, []);
            if (!firstResult || !firstResult.guestType) return firstResult;
        }
        method = this.getProperty(value, secondName);
        if (method && (method.guestType === "function" ||
                       method.guestType === "bytecodeFunction")) {
            var secondResult = this.invokePropertyFunction(method, value, []);
            if (!secondResult || !secondResult.guestType) return secondResult;
        }
        throw new TypeError("object cannot be converted to a primitive value");
    };

    Runtime.prototype.toNumber = function (value) {
        if (value && value.guestType) value = this.toPrimitive(value, "number");
        if (value === undefined) return NaN;
        if (value === null) return 0;
        if (value === false) return 0;
        if (value === true) return 1;
        if (typeof value === "number") return value;
        if (typeof value === "string") value = trimESWhiteSpace(value);
        return Number(value);
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
        return this.toString(this.toPrimitive(value, "string"));
    };

    Runtime.prototype.setProperty = function (object, key, value, strict) {
        this.assertOwned(object);
        this.assertOwned(value);
        if (object === null || object === undefined) {
            throw new TypeError("cannot set property '" + key + "'");
        }
        if (object.guestType === "buffer") {
            return this.bufferSupport.setProperty(object, key, value);
        }
        if (object.guestType === "typedArray" || object.guestType === "arrayBuffer") {
            return this.typedArraySupport.setProperty(object, key, value);
        }
        if (object.guestType === "array") {
            if (isDirectArrayIndex(key)) {
                return this.arraySet(object, key, value);
            }
            key = this.propertyKey(key);
            if (isArrayIndex(key)) return this.arraySet(object, Number(key), value);
            return this.setNamedProperty(object, key, value, strict);
        }
        key = this.propertyKey(key);
        if (object.guestType === "object" || object.guestType === "function" ||
            object.guestType === "bytecodeFunction" || object.guestType === "regexp") {
            return this.setNamedProperty(object, key, value, strict);
        }
        throw new TypeError("property target is not an object");
    };

    Runtime.prototype.add = function (left, right) {
        left = this.toPrimitive(left);
        right = this.toPrimitive(right);
        if (typeof left === "string" || typeof right === "string") {
            return this.toString(left) + this.toString(right);
        }
        return this.toNumber(left) + this.toNumber(right);
    };

    Runtime.prototype.relational = function (left, right, operation) {
        left = this.toPrimitive(left, "number");
        right = this.toPrimitive(right, "number");
        if (typeof left === "string" && typeof right === "string") {
            if (operation === "less") return left < right;
            if (operation === "lessEqual") return left <= right;
            if (operation === "greater") return left > right;
            return left >= right;
        }
        left = this.toNumber(left);
        right = this.toNumber(right);
        if (operation === "less") return left < right;
        if (operation === "lessEqual") return left <= right;
        if (operation === "greater") return left > right;
        return left >= right;
    };

    Runtime.prototype.equal = function (left, right) {
        if (left === right) return true;
        if (left === null && right === undefined) return true;
        if (left === undefined && right === null) return true;
        if (typeof left === "number" && typeof right === "string") {
            return left === this.toNumber(right);
        }
        if (typeof left === "string" && typeof right === "number") {
            return this.toNumber(left) === right;
        }
        if (typeof left === "boolean") return this.equal(this.toNumber(left), right);
        if (typeof right === "boolean") return this.equal(left, this.toNumber(right));
        if (left && left.guestType && (!right || !right.guestType)) {
            return this.equal(this.toPrimitive(left), right);
        }
        if (right && right.guestType && (!left || !left.guestType)) {
            return this.equal(left, this.toPrimitive(right));
        }
        return false;
    };

    Runtime.prototype.call = function (callable, receiver, args, context) {
        this.assertOwned(callable);
        this.assertOwned(receiver);
        if (!callable || callable.guestType !== "function") {
            var callableKind = callable === null ? "null" : typeof callable;
            var receiverKind = receiver && receiver.guestType ?
                receiver.guestType : typeof receiver;
            if (receiver && receiver.guestType === "typedArray") {
                receiverKind += " kind " +
                    this.heapRecords.bufferViewKind(receiver.heapAddress);
            }
            throw new TypeError("value is not callable (got " + callableKind +
                                "; receiver " + receiverKind + ")");
        }
        if (callable.callMode === "host") {
            throw new Error("external host function must be serviced by the embedder");
        }
        if (callable.errorConstructorName) {
            return ErrorSupport.makeErrorObject(this,
                callable.errorConstructorName,
                args.length ? args[0] : undefined);
        }
        if (callable.errorToString) {
            if (!receiver || !receiver.guestType) {
                throw new TypeError(
                    "Error.prototype.toString receiver is not an object");
            }
            var errorName = this.getProperty(receiver, "name");
            var errorMessage = this.getProperty(receiver, "message");
            errorName = errorName === undefined ? "Error" : String(errorName);
            errorMessage = errorMessage === undefined ? "" : String(errorMessage);
            if (!errorName) return errorMessage;
            if (!errorMessage) return errorName;
            return errorName + ": " + errorMessage;
        }
        return callable.callback(receiver, args, context || null);
    };

    Runtime.prototype.construct = function (callable, args, context) {
        this.assertOwned(callable);
        if (!callable || callable.guestType !== "function") {
            throw new TypeError("value is not a constructor");
        }
        if (callable.callMode === "host") {
            throw new Error("external host constructor must be serviced by the embedder");
        }
        if (callable.errorConstructorName) {
            return ErrorSupport.makeErrorObject(this,
                callable.errorConstructorName,
                args.length ? args[0] : undefined);
        }
        var receiver = this.makeObject();
        var value = callable.constructCallback ?
            callable.constructCallback(args, context || null) :
            callable.callback(receiver, args, context || null);
        return value && value.guestType ? value : receiver;
    };

    Runtime.prototype.truthy = function (value) {
        return !!value;
    };

    Runtime.prototype.markValue = function (value, generation) {
        if (typeof value === "string") {
            var stringAddress = this.stringAddresses["$" + value];
            if (stringAddress) this.linearHeap.setMark(stringAddress, generation);
            return;
        }
        if (!value || (value.guestType !== "object" && value.guestType !== "array" &&
                       value.guestType !== "function" &&
                       value.guestType !== "bytecodeFunction" && value.guestType !== "regexp" &&
                       value.guestType !== "buffer" &&
                       value.guestType !== "typedArray" &&
                       value.guestType !== "arrayBuffer")) return;
        if (value.gcMark === generation) return;
        value.gcMark = generation;
        if (value.heapAddress) this.linearHeap.setMark(value.heapAddress, generation);
        if (value.guestType === "buffer" || value.guestType === "typedArray" ||
            value.guestType === "arrayBuffer") {
            if (value.guestType === "buffer") this.bufferSupport.markView(value, generation);
            else this.typedArraySupport.markView(value, generation);
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
            var prototypeAddress = value.guestType === "buffer" ||
                value.guestType === "typedArray" || value.guestType === "arrayBuffer" ?
                this.heapRecords.objectPrototype(value.heapAddress) :
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
                if (this.heapRecords.propertyAttributes(property) &
                    HeapRecords.Attributes.ACCESSOR) {
                    var setterAddress = this.heapRecords.propertySetter(property);
                    if (setterAddress) {
                        this.linearHeap.setMark(setterAddress, generation);
                    }
                }
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
        function enqueue(address, source) {
            if (!address) return;
            try {
                if (runtime.linearHeap.mark(address) === generation) return;
            } catch (error) {
                throw new Error(error.message +
                    (source ? " referenced by " + source : ""));
            }
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
        var retainedProgramKey;
        for (retainedProgramKey in this.retainedProgramAddresses) {
            if (own(this.retainedProgramAddresses, retainedProgramKey)) {
                enqueue(this.retainedProgramAddresses[retainedProgramKey]);
            }
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
        var snapshotIndex = 0;
        while (snapshotIndex < this.heapStateSnapshots.length) {
            var snapshot = this.heapStateSnapshots[snapshotIndex++];
            if (!snapshot || snapshot.destroyed) continue;
            var snapshotAddressIndex = 0;
            while (snapshotAddressIndex < snapshot.addresses.length) {
                enqueue(snapshot.addresses[snapshotAddressIndex++],
                    "heap snapshot");
            }
        }
        enqueue(this.functionConstructionProgram || 0);
        enqueue(this.functionConstructionCallable ?
                this.functionConstructionCallable.heapAddress : 0);
        enqueue(this.functionConstructionPrototype ?
                this.functionConstructionPrototype.heapAddress : 0);

        index = 0;
        while (index < pending.length) {
            var owner = pending[index++];
            var ownerType = this.linearHeap.recordType(owner);
            this.heapRecords.visitReferences(owner, function (target) {
                enqueue(target, "heap record " + owner + " (type " +
                        ownerType + ")");
            });
        }
    };

    Runtime.prototype.seedNativeCollectorRoots = function (generation) {
        var runtime = this;
        function value(candidate, source) {
            if (typeof candidate === "string") {
                var stringAddress = runtime.stringAddresses["$" + candidate];
                if (stringAddress) {
                    runtime.linearHeap.setMark(stringAddress, generation);
                }
                return;
            }
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
        function execution(candidate) {
            if (!candidate) return;
            var frameIndex = 0;
            while (frameIndex < candidate.frames.length) {
                var hostFrame = candidate.frames[frameIndex++];
                runtime.linearHeap.setMark(hostFrame.heapAddress, generation);
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
            if (candidate.pendingHostCall) {
                value(candidate.pendingHostCall.receiver);
                var argumentIndex = 0;
                while (argumentIndex < candidate.pendingHostCall.args.length) {
                    value(candidate.pendingHostCall.args[argumentIndex++]);
                }
            }
        }
        value(this.globalObject);
        value(this.bufferSupport.prototype);
        value(this.typedArraySupport.arrayBufferPrototype,
              "typedArraySupport.arrayBufferPrototype");
        var typedPrototypeIndex = 0;
        while (typedPrototypeIndex < this.typedArraySupport.prototypes.length) {
            value(this.typedArraySupport.prototypes[typedPrototypeIndex],
                  "typedArraySupport.prototypes[" + typedPrototypeIndex + "]");
            typedPrototypeIndex++;
        }
        if (this.nativeInterpreter) {
            this.linearHeap.setMark(
                this.nativeInterpreter.stringSupportAddress, generation);
        }
        var snapshotIndex = 0;
        while (snapshotIndex < this.heapStateSnapshots.length) {
            var snapshot = this.heapStateSnapshots[snapshotIndex++];
            if (!snapshot || snapshot.destroyed) continue;
            var snapshotAddressIndex = 0;
            while (snapshotAddressIndex < snapshot.addresses.length) {
                this.linearHeap.setMark(
                    snapshot.addresses[snapshotAddressIndex++], generation);
            }
        }
        var retainedProgramKey;
        for (retainedProgramKey in this.retainedProgramAddresses) {
            if (own(this.retainedProgramAddresses, retainedProgramKey)) {
                this.linearHeap.setMark(
                    this.retainedProgramAddresses[retainedProgramKey],
                    generation);
            }
        }
        var contextRootIndex = 0;
        while (contextRootIndex < this.contexts.length) {
            this.linearHeap.setMark(
                this.contexts[contextRootIndex++].heapAddress, generation);
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
            execution(this.contexts[index++].execution);
        }
        index = 0;
        while (index < this.activeExecutions.length) {
            execution(this.activeExecutions[index++]);
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
        var internedStringKey;
        for (internedStringKey in this.internedStrings) {
            if (own(this.internedStrings, internedStringKey)) {
                this.linearHeap.setMark(
                    this.internedStrings[internedStringKey], generation);
            }
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

    Runtime.prototype.verifyNativeHeapGraph = function (generation) {
        var runtime = this;
        this.linearHeap.visitRecords(function (address, type, size, mark) {
            if (type === Heap.Types.FREE || mark !== generation) return;
            runtime.heapRecords.visitReferences(address, function (reference) {
                if (runtime.linearHeap.isFreeRecord(reference)) {
                    throw new Error("native marker retained a freed edge: " +
                        "source=" + address + " type=" + type +
                        " reference=" + reference);
                }
                if (runtime.linearHeap.mark(reference) !== generation) {
                    throw new Error("native marker missed heap edge: source=" +
                        address + " type=" + type + " reference=" +
                        reference);
                }
            });
        });
    };

    Runtime.prototype.releaseUnmarkedProgramMetadata = function (generation) {
        var index = 0;
        while (index < this.programAddresses.length) {
            var address = this.programAddresses[index];
            if (address &&
                (this.linearHeap.isFreeRecord(address) ||
                 this.linearHeap.mark(address) !== generation)) {
                var program = this.programObjects[index];
                if (program && program.heapAddress === address) {
                    program.heapAddress = 0;
                }
                delete this.programMetadata["$" + address];
                this.programObjects[index] = null;
                this.programAddresses[index] = 0;
            }
            index++;
        }
        var key;
        for (key in this.programMetadata) {
            if (own(this.programMetadata, key)) {
                var metadataAddress = Number(key.substring(1));
                if (this.linearHeap.isFreeRecord(metadataAddress) ||
                    this.linearHeap.mark(metadataAddress) !== generation) {
                    var metadataProgram = this.programMetadata[key];
                    if (metadataProgram &&
                        metadataProgram.heapAddress === metadataAddress) {
                        metadataProgram.heapAddress = 0;
                    }
                    delete this.programMetadata[key];
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
                if (this.verifyNativeHeap) {
                    this.verifyNativeHeapGraph(generation);
                }
            } else {
            this.markValue(this.globalObject, generation);
            this.markValue(this.bufferSupport.prototype, generation);
            this.markValue(this.typedArraySupport.arrayBufferPrototype,
                           generation);
            var typedPrototypeIndex = 0;
            while (typedPrototypeIndex <
                   this.typedArraySupport.prototypes.length) {
                this.markValue(
                    this.typedArraySupport.prototypes[typedPrototypeIndex++],
                    generation);
            }
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
                this.linearHeap.setMark(context.heapAddress, generation);
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
            this.releaseUnmarkedProgramMetadata(generation);
            var sweepResult;
            if (this.heapSweeper &&
                this.heapSweeper.compiled.backend === "i386") {
                sweepResult = {records: null,
                    bytes: this.heapSweeper.sweep(generation)};
                this.verifyNativeFrameMarks(generation);
                this.rebuildFreeBlockIndex();
            } else {
                sweepResult = this.linearHeap.sweepUnmarked(generation);
            }
            var sweepingFinished = this.profileOpcodeCounts ?
                new Date().getTime() : 0;
            this.gcAllocationDebt = 0;
            this.gcPending = false;
            this.transientStringAddresses = {};
            this.stringAddresses = {};
            this.decodedStrings = {};
            var retainedStringKey;
            for (retainedStringKey in this.internedStrings) {
                if (own(this.internedStrings, retainedStringKey)) {
                    this.stringAddresses[retainedStringKey] =
                        this.internedStrings[retainedStringKey];
                }
            }
            this.collectionCount++;
            /* A large live graph can leave the bump above the ordinary 75%
             * pressure mark.  Do not collect that same live graph again at
             * every native/semantic boundary.  Give it useful bump headroom;
             * an allocation exit still forces a collection if fragmented
             * free space or the remaining tail cannot satisfy a record. */
            var postCollectionHeadroom = Math.max(1024 * 1024,
                Math.floor(sweepResult.bytes / 2));
            this.resetHeapPressureBump(
                this.linearHeap.bump + postCollectionHeadroom);
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
                    (sweepingFinished - markingFinished) + " nextPressure=" +
                    this.gcHeapPressureBump + " limit=" +
                    this.linearHeap.allocationLimit;
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

    Runtime.prototype.inspectHeapStatistics = function () {
        this.ensureLinearHeap();
        var statistics = this.linearHeap.recordStatistics();
        var names = ["free", "object", "array", "native-function",
            "bytecode-function", "environment", "property", "string",
            "number", "regexp", "buffer-view", "buffer-backing",
            "root-slot", "value-vector", "frame", "program", "bytecode",
            "context", "handler", "engine-state", "platform-services"];
        var types = {};
        var type = 0;
        while (type < statistics.counts.length) {
            if (statistics.counts[type]) {
                types[names[type] || String(type)] = {
                    count: statistics.counts[type],
                    bytes: statistics.bytes[type]
                };
            }
            type++;
        }
        return {records: statistics.records, bytes: statistics.totalBytes,
                types: types};
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
        var snapshotIndex = 0;
        while (snapshotIndex < this.heapStateSnapshots.length) {
            this.destroyHeapStateSnapshot(
                this.heapStateSnapshots[snapshotIndex++]);
        }
        this.heapStateSnapshots = [];
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
        this.stringAddresses = {};
        this.transientStringAddresses = {};
        this.decodedStrings = {};
        this.globalObject = null;
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
        if (value === undefined) return 8192;
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
