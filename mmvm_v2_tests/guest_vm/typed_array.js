/* ES5-era typed arrays backed entirely by the guest linear heap.  Buffer and
 * typed arrays deliberately share the byte-backing record, but each view has
 * an explicit kind so Buffer intrinsics cannot confuse element and byte
 * indexing. */
(function (root) {
    function integer(value) {
        value = Number(value);
        if (value !== value || value === 0) return 0;
        return value < 0 ? Math.ceil(value) : Math.floor(value);
    }

    function canonicalIndex(key) {
        if (typeof key === "number") {
            return key >= 0 && key < 4294967295 && key === Math.floor(key) ? key : -1;
        }
        if (key === "0") return 0;
        if (!key || key.charCodeAt(0) === 48) return -1;
        var value = Number(key);
        return value >= 0 && value < 4294967295 &&
            value === Math.floor(value) && String(value) === key ? value : -1;
    }

    var Kinds = {
        BUFFER: 0,
        ARRAY_BUFFER: 1,
        UINT8: 2,
        UINT16: 3,
        UINT32: 4,
        INT32: 5,
        FLOAT32: 6,
        FLOAT64: 7
    };

    var Descriptions = [
        null, null,
        {name: "Uint8Array", bytes: 1, kind: Kinds.UINT8},
        {name: "Uint16Array", bytes: 2, kind: Kinds.UINT16},
        {name: "Uint32Array", bytes: 4, kind: Kinds.UINT32},
        {name: "Int32Array", bytes: 4, kind: Kinds.INT32},
        {name: "Float32Array", bytes: 4, kind: Kinds.FLOAT32},
        {name: "Float64Array", bytes: 8, kind: Kinds.FLOAT64}
    ];

    function subarrayCallback(receiver, args) {
        var support = receiver.ownerRuntime.typedArraySupport;
        support.requireTyped(receiver);
        var description = support.description(receiver);
        var length = support.viewLength(receiver);
        var start = support.normalizeIndex(args[0], length, 0);
        var end = support.normalizeIndex(args[1], length, length);
        if (end < start) end = start;
        return support.makeTypedView(support.viewBacking(receiver),
            support.viewOffset(receiver) + start * description.bytes,
            end - start, description);
    }

    function setCallback(receiver, args) {
        var support = receiver.ownerRuntime.typedArraySupport;
        support.requireTyped(receiver);
        support.copyElements(receiver, args[0], args[1]);
    }

    function constructorCallback(receiver, args) {
        return this.ownerRuntime.typedArraySupport.constructTyped(
            Descriptions[this.typedArrayKind], args);
    }

    function constructorConstructCallback(args) {
        return this.ownerRuntime.typedArraySupport.constructTyped(
            Descriptions[this.typedArrayKind], args);
    }

    function arrayBufferCallback(receiver, args) {
        return this.ownerRuntime.typedArraySupport.allocateArrayBuffer(args[0]);
    }

    function arrayBufferConstructCallback(args) {
        return this.ownerRuntime.typedArraySupport.allocateArrayBuffer(args[0]);
    }

    function TypedArraySupport(runtime) {
        this.runtime = runtime;
        this.arrayBufferPrototype = runtime.makeObject();
        this.prototypes = [];
        this.install();
    }

    TypedArraySupport.Kinds = Kinds;

    TypedArraySupport.prototype.makeNative = function (name, callback) {
        return this.runtime.makeNativeFunction(name, callback);
    };

    TypedArraySupport.prototype.install = function () {
        var arrayBuffer = this.makeNative("ArrayBuffer", arrayBufferCallback);
        arrayBuffer.arrayBufferConstructor = true;
        arrayBuffer.constructCallback = arrayBufferConstructCallback;
        this.runtime.setProperty(arrayBuffer, "prototype", this.arrayBufferPrototype);
        this.runtime.setGlobal("ArrayBuffer", arrayBuffer);

        var kind = Kinds.UINT8;
        while (kind <= Kinds.FLOAT64) {
            this.installTypedConstructor(Descriptions[kind]);
            kind++;
        }
    };

    TypedArraySupport.prototype.installTypedConstructor = function (description) {
        var prototype = this.runtime.makeObject();
        this.prototypes[description.kind] = prototype;
        this.runtime.setProperty(prototype, "subarray",
            this.makeNative(description.name + ".prototype.subarray",
                subarrayCallback));
        this.runtime.setProperty(prototype, "set",
            this.makeNative(description.name + ".prototype.set",
                setCallback));
        var constructor = this.makeNative(description.name, constructorCallback);
        constructor.typedArrayKind = description.kind;
        constructor.constructCallback = constructorConstructCallback;
        this.runtime.setProperty(constructor, "prototype", prototype);
        this.runtime.setProperty(constructor, "BYTES_PER_ELEMENT", description.bytes);
        this.runtime.setProperty(prototype, "BYTES_PER_ELEMENT", description.bytes);
        this.runtime.setGlobal(description.name, constructor);
    };

    TypedArraySupport.prototype.allocateArrayBuffer = function (length) {
        length = integer(length);
        if (length < 0 || length > 0x3fffffff) {
            throw new RangeError("invalid ArrayBuffer length");
        }
        var backing = this.runtime.heapRecords.allocateBufferBacking(length);
        this.runtime.noteAllocation(Math.max(1, Math.ceil(length / 64)));
        var address = this.runtime.heapRecords.allocateBufferView(backing, 0,
            length, this.arrayBufferPrototype.heapAddress, Kinds.ARRAY_BUFFER);
        var buffer = this.runtime.trackObject(
            this.runtime.makeHeapHandle(address, "arrayBuffer"));
        this.runtime.heapRecords.setBufferBackingMetadata(backing, address);
        return buffer;
    };

    TypedArraySupport.prototype.constructTyped = function (description, args) {
        var source = args[0];
        var offset = 0;
        var length;
        var buffer;
        if (source && source.guestType === "arrayBuffer") {
            buffer = source;
            offset = args.length > 1 ? integer(args[1]) : 0;
            if (offset < 0 || offset % description.bytes !== 0 ||
                offset > this.viewLength(buffer)) {
                throw new RangeError("typed array byteOffset is invalid");
            }
            var available = this.viewLength(buffer) - offset;
            length = args.length > 2 ? integer(args[2]) :
                Math.floor(available / description.bytes);
            if (length < 0 || length * description.bytes > available) {
                throw new RangeError("typed array length is invalid");
            }
            return this.makeTypedView(this.viewBacking(buffer), offset,
                                      length, description);
        }
        if (typeof source === "number" || source === undefined) {
            length = source === undefined ? 0 : integer(source);
            if (length < 0 || length > Math.floor(0x3fffffff / description.bytes)) {
                throw new RangeError("typed array length is invalid");
            }
            buffer = this.allocateArrayBuffer(length * description.bytes);
            return this.makeTypedView(this.viewBacking(buffer), 0, length, description);
        }
        if (!source || (source.guestType !== "array" &&
                        source.guestType !== "typedArray" &&
                        source.guestType !== "buffer")) {
            throw new TypeError("unsupported typed array input");
        }
        length = source.guestType === "array" ?
            this.runtime.arrayLength(source) : this.viewLength(source);
        buffer = this.allocateArrayBuffer(length * description.bytes);
        var result = this.makeTypedView(this.viewBacking(buffer), 0, length, description);
        var index = 0;
        while (index < length) {
            this.write(result, index, source.guestType === "array" ?
                this.runtime.arrayGet(source, index) :
                (source.guestType === "buffer" ?
                 this.runtime.bufferSupport.read(source, index) : this.read(source, index)));
            index++;
        }
        return result;
    };

    TypedArraySupport.prototype.makeTypedView = function (backing, offset, length,
                                                           description) {
        var address = this.runtime.heapRecords.allocateBufferView(backing, offset,
            length, this.prototypes[description.kind].heapAddress, description.kind);
        return this.runtime.trackObject(
            this.runtime.makeHeapHandle(address, "typedArray"));
    };

    TypedArraySupport.prototype.viewKind = function (view) {
        return this.runtime.heapRecords.bufferViewKind(view.heapAddress);
    };
    TypedArraySupport.prototype.description = function (view) {
        return Descriptions[this.viewKind(view)];
    };
    TypedArraySupport.prototype.viewBacking = function (view) {
        return this.runtime.heapRecords.bufferViewBacking(view.heapAddress);
    };
    TypedArraySupport.prototype.viewOffset = function (view) {
        return this.runtime.heapRecords.bufferViewOffset(view.heapAddress);
    };
    TypedArraySupport.prototype.viewLength = function (view) {
        return this.runtime.heapRecords.bufferViewLength(view.heapAddress);
    };
    TypedArraySupport.prototype.requireTyped = function (view) {
        if (!view || view.guestType !== "typedArray") {
            throw new TypeError("typed array method receiver is invalid");
        }
    };
    TypedArraySupport.prototype.normalizeIndex = function (value, length, fallback) {
        var index = value === undefined ? fallback : integer(value);
        if (index < 0) index = length + index;
        if (index < 0) return 0;
        return index > length ? length : index;
    };
    TypedArraySupport.prototype.dataAddress = function (view, index) {
        var description = this.description(view);
        return this.runtime.heapRecords.bufferBackingDataAddress(
            this.viewBacking(view)) + this.viewOffset(view) + index * description.bytes;
    };

    TypedArraySupport.prototype.read = function (view, index) {
        var length = this.viewLength(view);
        if (index < 0 || index >= length) return undefined;
        var description = this.description(view);
        var memory = this.runtime.linearHeap.memory;
        var address = this.dataAddress(view, index);
        if (description.kind === Kinds.UINT8) return memory.readU8Trusted(address);
        if (description.kind === Kinds.UINT16) {
            return memory.readU8Trusted(address) |
                   (memory.readU8Trusted(address + 1) << 8);
        }
        if (description.kind === Kinds.UINT32) return memory.readU32Trusted(address) >>> 0;
        if (description.kind === Kinds.INT32) return memory.readU32Trusted(address) | 0;
        if (description.kind === Kinds.FLOAT64) return memory.readF64Trusted(address);
        return decodeFloat32(memory.readU32Trusted(address));
    };

    TypedArraySupport.prototype.write = function (view, index, value) {
        var length = this.viewLength(view);
        if (index < 0 || index >= length) return value;
        var description = this.description(view);
        var memory = this.runtime.linearHeap.memory;
        var address = this.dataAddress(view, index);
        value = Number(value);
        if (description.kind === Kinds.UINT8) memory.writeU8Trusted(address, value & 255);
        else if (description.kind === Kinds.UINT16) {
            memory.writeU8Trusted(address, value & 255);
            memory.writeU8Trusted(address + 1, (value >>> 8) & 255);
        } else if (description.kind === Kinds.UINT32 ||
                   description.kind === Kinds.INT32) {
            memory.writeU32Trusted(address, value);
        } else if (description.kind === Kinds.FLOAT64) memory.writeF64(address, value);
        else memory.writeU32Trusted(address, encodeFloat32(value));
        return value;
    };

    TypedArraySupport.prototype.copyElements = function (target, source, offsetValue) {
        if (!source || (source.guestType !== "array" &&
                        source.guestType !== "typedArray" &&
                        source.guestType !== "buffer")) {
            throw new TypeError("typed array set source is not array-like");
        }
        var offset = offsetValue === undefined ? 0 : integer(offsetValue);
        var sourceLength = source.guestType === "array" ?
            this.runtime.arrayLength(source) : this.viewLength(source);
        if (offset < 0 || offset + sourceLength > this.viewLength(target)) {
            throw new RangeError("typed array set exceeds target");
        }
        /* Snapshot first: source and target may overlap in either direction. */
        var values = [];
        var index = 0;
        while (index < sourceLength) {
            values[index] = source.guestType === "array" ?
                this.runtime.arrayGet(source, index) :
                (source.guestType === "buffer" ?
                 this.runtime.bufferSupport.read(source, index) : this.read(source, index));
            index++;
        }
        index = 0;
        while (index < sourceLength) this.write(target, offset + index, values[index++]);
    };

    TypedArraySupport.prototype.getArrayBuffer = function (view) {
        var address = this.runtime.heapRecords.bufferBackingMetadata(
            this.viewBacking(view));
        return this.runtime.readHeapReference(address);
    };

    TypedArraySupport.prototype.getProperty = function (view, key) {
        if (key === "length" && view.guestType === "typedArray") return this.viewLength(view);
        if (key === "byteLength") {
            return view.guestType === "arrayBuffer" ? this.viewLength(view) :
                this.viewLength(view) * this.description(view).bytes;
        }
        if (key === "byteOffset") return view.guestType === "arrayBuffer" ? 0 : this.viewOffset(view);
        if (key === "buffer" && view.guestType === "typedArray") return this.getArrayBuffer(view);
        if (key === "BYTES_PER_ELEMENT" && view.guestType === "typedArray") {
            return this.description(view).bytes;
        }
        var index = canonicalIndex(key);
        if (index >= 0 && view.guestType === "typedArray") return this.read(view, index);
        var property = this.runtime.heapOwnProperty(view, key, false);
        if (property) return this.runtime.readPropertyRecord(property, view);
        var prototype = view.guestType === "arrayBuffer" ?
            this.arrayBufferPrototype : this.prototypes[this.viewKind(view)];
        return this.runtime.getProperty(prototype, key, view);
    };

    TypedArraySupport.prototype.setProperty = function (view, key, value) {
        var index = canonicalIndex(key);
        if (index >= 0 && view.guestType === "typedArray") return this.write(view, index, value);
        if (key === "length" || key === "byteLength" || key === "byteOffset" || key === "buffer") {
            return value;
        }
        return this.runtime.setNamedProperty(view, String(key), value);
    };

    TypedArraySupport.prototype.markView = function (view, generation) {
        this.runtime.linearHeap.setMark(this.viewBacking(view), generation);
        var metadata = this.runtime.heapRecords.bufferBackingMetadata(this.viewBacking(view));
        if (metadata) this.runtime.linearHeap.setMark(metadata, generation);
    };

    function decodeFloat32(bits) {
        var sign = bits & 0x80000000 ? -1 : 1;
        var exponent = (bits >>> 23) & 255;
        var fraction = bits & 0x7fffff;
        if (exponent === 255) return fraction ? NaN : sign * Infinity;
        if (exponent === 0) return sign * fraction * Math.pow(2, -149);
        return sign * (1 + fraction / 8388608) * Math.pow(2, exponent - 127);
    }

    function encodeFloat32(value) {
        if (value !== value) return 0x7fc00000;
        var sign = value < 0 || (value === 0 && 1 / value < 0) ? 0x80000000 : 0;
        value = Math.abs(value);
        if (value === Infinity) return (sign | 0x7f800000) >>> 0;
        if (value === 0) return sign >>> 0;
        if (value < Math.pow(2, -126)) {
            return (sign | Math.round(value / Math.pow(2, -149))) >>> 0;
        }
        var exponent = Math.floor(Math.log(value) / Math.LN2);
        var fraction = Math.round((value / Math.pow(2, exponent) - 1) * 8388608);
        if (fraction === 8388608) {
            fraction = 0;
            exponent++;
        }
        if (exponent > 127) return (sign | 0x7f800000) >>> 0;
        return (sign | ((exponent + 127) << 23) | (fraction & 0x7fffff)) >>> 0;
    }

    root.GuestVMTypedArraySupport = TypedArraySupport;
    if (typeof module !== "undefined" && module.exports) module.exports = TypedArraySupport;
}(this));
