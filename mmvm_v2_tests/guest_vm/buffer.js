(function (root) {
    var HostMemory = root.GuestVMHostMemory;
    if (typeof module !== "undefined" && module.exports) {
        HostMemory = require("./host_memory.js");
    }

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
        if (value < 0 || value !== Math.floor(value) || String(value) !== key) return -1;
        return value;
    }

    function BufferSupport(runtime) {
        this.runtime = runtime;
        this.memory = new HostMemory();
        this.backings = [];
        this.backingById = {};
        this.nextBackingId = 1;
        this.prototype = runtime.makeObject();
        this.installPrototype();
        this.installConstructor();
    }

    BufferSupport.prototype.makeNative = function (name, callback) {
        return this.runtime.makeNativeFunction(name, callback);
    };

    BufferSupport.prototype.installPrototype = function () {
        var support = this;
        var properties = {};
        properties.$slice = this.makeNative("Buffer.prototype.slice",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var receiverLength = support.viewLength(receiver);
                var start = support.normalizeSliceIndex(args[0], receiverLength);
                var end = args.length > 1 ?
                    support.normalizeSliceIndex(args[1], receiverLength) : receiverLength;
                if (end < start) end = start;
                return support.makeView(support.viewBacking(receiver),
                                        support.viewOffset(receiver) + start, end - start);
            });
        properties.$fill = this.makeNative("Buffer.prototype.fill",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var value = Number(args[0]) & 255;
                var start = args.length > 1 ? integer(args[1]) : 0;
                var receiverLength = support.viewLength(receiver);
                var end = args.length > 2 ? integer(args[2]) : receiverLength;
                if (start < 0 || end < start || end > receiverLength) {
                    throw new RangeError("Buffer.fill range is out of bounds");
                }
                var index = start;
                while (index < end) {
                    support.write(receiver, index, value);
                    index++;
                }
                return receiver;
            });
        properties.$copy = this.makeNative("Buffer.prototype.copy",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var target = args[0];
                support.requireBuffer(target);
                var targetStart = args.length > 1 ? integer(args[1]) : 0;
                var sourceStart = args.length > 2 ? integer(args[2]) : 0;
                var receiverLength = support.viewLength(receiver);
                var targetLength = support.viewLength(target);
                var sourceEnd = args.length > 3 ? integer(args[3]) : receiverLength;
                if (targetStart < 0 || sourceStart < 0 || sourceEnd < sourceStart ||
                    sourceEnd > receiverLength || targetStart > targetLength) {
                    throw new RangeError("Buffer.copy range is out of bounds");
                }
                var count = sourceEnd - sourceStart;
                if (count > targetLength - targetStart) count = targetLength - targetStart;
                var receiverOffset = support.viewOffset(receiver);
                var targetOffset = support.viewOffset(target);
                var backwards = support.viewBacking(receiver) === support.viewBacking(target) &&
                    targetOffset + targetStart > receiverOffset + sourceStart &&
                    targetOffset + targetStart < receiverOffset + sourceStart + count;
                var index = backwards ? count - 1 : 0;
                while (backwards ? index >= 0 : index < count) {
                    support.write(target, targetStart + index,
                                  support.read(receiver, sourceStart + index));
                    index += backwards ? -1 : 1;
                }
                return count;
            });
        properties.$readUInt8 = this.makeNative("Buffer.prototype.readUInt8",
            function (receiver, args) {
                support.requireBuffer(receiver);
                return support.read(receiver, integer(args[0]));
            });
        properties.$writeUInt8 = this.makeNative("Buffer.prototype.writeUInt8",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[1]);
                support.write(receiver, offset, args[0]);
                return offset + 1;
            });
        properties.$readUInt32LE = this.makeNative("Buffer.prototype.readUInt32LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                return support.read32LE(receiver, integer(args[0]));
            });
        properties.$writeUInt32LE = this.makeNative("Buffer.prototype.writeUInt32LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[1]);
                support.write32LE(receiver, offset, args[0]);
                return offset + 4;
            });
        properties.$readUInt16LE = this.makeNative("Buffer.prototype.readUInt16LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[0]);
                return support.read(receiver, offset) |
                       (support.read(receiver, offset + 1) << 8);
            });
        properties.$readUInt16BE = this.makeNative("Buffer.prototype.readUInt16BE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[0]);
                return (support.read(receiver, offset) << 8) |
                       support.read(receiver, offset + 1);
            });
        properties.$readInt16LE = this.makeNative("Buffer.prototype.readInt16LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[0]);
                var value = support.read(receiver, offset) |
                            (support.read(receiver, offset + 1) << 8);
                return value & 32768 ? value - 65536 : value;
            });
        properties.$writeUInt16LE = this.makeNative("Buffer.prototype.writeUInt16LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[1]);
                support.write(receiver, offset, args[0]);
                support.write(receiver, offset + 1, Number(args[0]) >>> 8);
                return offset + 2;
            });
        properties.$writeInt16LE = this.makeNative("Buffer.prototype.writeInt16LE",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var offset = integer(args[1]);
                support.write(receiver, offset, args[0]);
                support.write(receiver, offset + 1, Number(args[0]) >>> 8);
                return offset + 2;
            });
        properties.$toString = this.makeNative("Buffer.prototype.toString",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var encoding = args.length && args[0] !== undefined ?
                    String(args[0]).toLowerCase() : "utf8";
                var start = args.length > 1 ? integer(args[1]) : 0;
                var receiverLength = support.viewLength(receiver);
                var end = args.length > 2 ? integer(args[2]) : receiverLength;
                if (encoding !== "ascii" && encoding !== "binary" &&
                    encoding !== "utf8" && encoding !== "utf-8") {
                    throw new Error("unsupported Buffer encoding: " + encoding);
                }
                var result = "";
                var index = start;
                while (index < end && index < receiverLength) {
                    result += String.fromCharCode(support.read(receiver, index++));
                }
                return result;
            });
        var property;
        for (property in properties) {
            if (Object.prototype.hasOwnProperty.call(properties, property)) {
                this.runtime.setProperty(this.prototype, property.substring(1),
                                         properties[property]);
            }
        }
    };

    BufferSupport.prototype.installConstructor = function () {
        var support = this;
        var constructor = this.makeNative("Buffer", function (receiver, args) {
            return support.fromValue(args[0], args[1]);
        });
        this.runtime.setProperty(constructor, "alloc", this.makeNative("Buffer.alloc",
            function (receiver, args) {
                var buffer = support.allocate(args[0]);
                if (args.length > 1) {
                    var fill = support.runtime.getProperty(buffer, "fill");
                    support.runtime.call(fill, buffer, [args[1]]);
                }
                return buffer;
            }));
        this.runtime.setProperty(constructor, "isBuffer", this.makeNative("Buffer.isBuffer",
            function (receiver, args) {
                return !!args[0] && args[0].guestType === "buffer";
            }));
        this.runtime.setProperty(constructor, "from", this.makeNative("Buffer.from",
            function (receiver, args) { return support.fromValue(args[0], args[1]); }));
        this.runtime.setProperty(constructor, "allocNative", this.makeNative("Buffer.allocNative",
            function (receiver, args) {
                var buffer = support.allocate(args[0]);
                var allocation = support.viewBacking(buffer).allocation;
                if (allocation.isNative) {
                    support.runtime.setProperty(buffer, "_nodePointer",
                        allocation.pointer + support.viewOffset(buffer));
                }
                return buffer;
            }));
        this.runtime.setProperty(constructor, "prototype", this.prototype);
        this.constructor = constructor;
        this.runtime.setGlobal("Buffer", constructor);
    };

    BufferSupport.prototype.fromValue = function (value, encoding) {
        if (typeof value === "number") return this.allocate(value);
        var bytes = [];
        var index = 0;
        if (typeof value === "string") {
            encoding = encoding === undefined ? "utf8" : String(encoding).toLowerCase();
            if (encoding !== "ascii" && encoding !== "binary" &&
                encoding !== "utf8" && encoding !== "utf-8") {
                throw new Error("unsupported Buffer encoding: " + encoding);
            }
            if (encoding === "ascii" || encoding === "binary") {
                while (index < value.length) bytes.push(value.charCodeAt(index++) & 255);
            } else {
                while (index < value.length) {
                    var code = value.charCodeAt(index++);
                    if (code < 128) bytes.push(code);
                    else if (code < 2048) {
                        bytes.push(192 | (code >>> 6), 128 | (code & 63));
                    } else {
                        bytes.push(224 | (code >>> 12),
                                   128 | ((code >>> 6) & 63), 128 | (code & 63));
                    }
                }
            }
        } else if (value && value.guestType === "buffer") {
            while (index < this.viewLength(value)) bytes.push(this.read(value, index++));
        } else if (value && value.guestType === "array") {
            while (index < this.runtime.arrayLength(value)) {
                bytes.push(Number(this.runtime.arrayGet(value, index++)) & 255);
            }
        } else if (value === undefined) {
            return this.allocate(0);
        } else {
            throw new TypeError("unsupported Buffer input");
        }
        var buffer = this.allocate(bytes.length);
        index = 0;
        while (index < bytes.length) this.write(buffer, index, bytes[index++]);
        return buffer;
    };

    BufferSupport.prototype.normalizeSliceIndex = function (value, length) {
        var index = value === undefined ? 0 : integer(value);
        if (index < 0) index = length + index;
        if (index < 0) return 0;
        if (index > length) return length;
        return index;
    };

    BufferSupport.prototype.allocate = function (size) {
        size = integer(size);
        if (size < 0 || size > 0x3fffffff) throw new RangeError("invalid Buffer size");
        var backing = {allocation: this.memory.allocate(size), length: size,
                       freed: false, gcMark: 0};
        var backingId = this.nextBackingId++;
        this.backings.push(backing);
        this.backingById["$" + backingId] = backing;
        backing.heapAddress = this.runtime.heapRecords.allocateBufferBacking(
            backing.allocation.isNative ? backing.allocation.pointer : 0,
            size, backingId);
        this.runtime.noteAllocation(Math.max(1, Math.ceil(size / 64)));
        return this.makeView(backing, 0, size);
    };

    BufferSupport.prototype.makeView = function (backing, offset, length) {
        if (backing.freed) throw new Error("cannot view a freed backing store");
        var viewAddress = this.runtime.heapRecords.allocateBufferView(
            backing.heapAddress, offset, length, this.prototype.heapAddress);
        var view = this.runtime.makeHeapHandle(viewAddress, "buffer");
        this.runtime.trackObject(view);
        return view;
    };

    BufferSupport.prototype.viewBacking = function (view) {
        var backingAddress = this.runtime.heapRecords.bufferViewBacking(view.heapAddress);
        var id = this.runtime.heapRecords.bufferBackingMetadata(backingAddress);
        var backing = this.backingById["$" + id];
        if (!backing || backing.freed) throw new Error("Buffer backing store is freed");
        return backing;
    };

    BufferSupport.prototype.viewOffset = function (view) {
        return this.runtime.heapRecords.bufferViewOffset(view.heapAddress);
    };

    BufferSupport.prototype.viewLength = function (view) {
        return this.runtime.heapRecords.bufferViewLength(view.heapAddress);
    };

    BufferSupport.prototype.requireBuffer = function (value) {
        if (!value || value.guestType !== "buffer") {
            throw new TypeError("Buffer method receiver is not a Buffer");
        }
    };

    BufferSupport.prototype.read = function (view, index) {
        if (index < 0 || index >= this.viewLength(view)) throw new RangeError("Buffer index out of range");
        return this.memory.read8(this.viewBacking(view).allocation,
                                 this.viewOffset(view) + index);
    };

    BufferSupport.prototype.write = function (view, index, value) {
        if (index < 0 || index >= this.viewLength(view)) throw new RangeError("Buffer index out of range");
        this.memory.write8(this.viewBacking(view).allocation,
                           this.viewOffset(view) + index, value);
    };

    BufferSupport.prototype.read32LE = function (view, index) {
        if (index < 0 || index + 4 > this.viewLength(view)) throw new RangeError("Buffer read out of range");
        return this.memory.read32LE(this.viewBacking(view).allocation,
                                    this.viewOffset(view) + index);
    };

    BufferSupport.prototype.write32LE = function (view, index, value) {
        if (index < 0 || index + 4 > this.viewLength(view)) throw new RangeError("Buffer write out of range");
        this.memory.write32LE(this.viewBacking(view).allocation,
                              this.viewOffset(view) + index, value);
    };

    BufferSupport.prototype.getProperty = function (view, key) {
        if (key === "length") return this.viewLength(view);
        var index = canonicalIndex(key);
        if (index >= 0) return index < this.viewLength(view) ? this.read(view, index) : undefined;
        var property = this.runtime.heapOwnProperty(view, key, false);
        if (property) return this.runtime.readHeapValue(
            this.runtime.heapRecords.propertyValueCell(property));
        return this.runtime.getProperty(this.prototype, key);
    };

    BufferSupport.prototype.setProperty = function (view, key, value) {
        var index = canonicalIndex(key);
        if (index >= 0) {
            if (index < this.viewLength(view)) this.write(view, index, value);
            return value;
        }
        if (key === "length") return value;
        var property = this.runtime.heapOwnProperty(view, key, true);
        this.runtime.writeHeapValue(
            this.runtime.heapRecords.propertyValueCell(property), value);
        return value;
    };

    BufferSupport.prototype.markView = function (view, generation) {
        this.viewBacking(view).gcMark = generation;
    };

    BufferSupport.prototype.sweep = function (generation) {
        var survivors = [];
        var index = 0;
        while (index < this.backings.length) {
            var backing = this.backings[index];
            if (!backing.freed && backing.gcMark !== generation) {
                this.memory.free(backing.allocation);
                backing.freed = true;
            }
            if (!backing.freed) survivors.push(backing);
            index++;
        }
        this.backings = survivors;
        return survivors.length;
    };

    BufferSupport.prototype.liveBackingCount = function () {
        var count = 0;
        var index = 0;
        while (index < this.backings.length) {
            if (!this.backings[index].freed) count++;
            index++;
        }
        return count;
    };

    BufferSupport.prototype.destroy = function () {
        var index = 0;
        while (index < this.backings.length) {
            if (!this.backings[index].freed) {
                this.memory.free(this.backings[index].allocation);
                this.backings[index].freed = true;
            }
            index++;
        }
    };

    root.GuestVMBufferSupport = BufferSupport;
    if (typeof module !== "undefined" && module.exports) module.exports = BufferSupport;
}(this));
