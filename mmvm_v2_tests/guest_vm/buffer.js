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
        this.prototype = {guestType: "object", properties: {},
                          ownerRuntime: runtime};
        this.installPrototype();
        this.installConstructor();
    }

    BufferSupport.prototype.makeNative = function (name, callback) {
        return this.runtime.makeNativeFunction(name, callback);
    };

    BufferSupport.prototype.installPrototype = function () {
        var support = this;
        var properties = this.prototype.properties;
        properties.$slice = this.makeNative("Buffer.prototype.slice",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var start = support.normalizeSliceIndex(args[0], receiver.length);
                var end = args.length > 1 ?
                    support.normalizeSliceIndex(args[1], receiver.length) : receiver.length;
                if (end < start) end = start;
                return support.makeView(receiver.backing,
                                        receiver.offset + start, end - start);
            });
        properties.$fill = this.makeNative("Buffer.prototype.fill",
            function (receiver, args) {
                support.requireBuffer(receiver);
                var value = Number(args[0]) & 255;
                var start = args.length > 1 ? integer(args[1]) : 0;
                var end = args.length > 2 ? integer(args[2]) : receiver.length;
                if (start < 0 || end < start || end > receiver.length) {
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
                var sourceEnd = args.length > 3 ? integer(args[3]) : receiver.length;
                if (targetStart < 0 || sourceStart < 0 || sourceEnd < sourceStart ||
                    sourceEnd > receiver.length || targetStart > target.length) {
                    throw new RangeError("Buffer.copy range is out of bounds");
                }
                var count = sourceEnd - sourceStart;
                if (count > target.length - targetStart) count = target.length - targetStart;
                var backwards = receiver.backing === target.backing &&
                    target.offset + targetStart > receiver.offset + sourceStart &&
                    target.offset + targetStart < receiver.offset + sourceStart + count;
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
    };

    BufferSupport.prototype.installConstructor = function () {
        var support = this;
        var constructor = this.makeNative("Buffer", function (receiver, args) {
            return support.allocate(args[0]);
        });
        constructor.properties.$alloc = this.makeNative("Buffer.alloc",
            function (receiver, args) {
                var buffer = support.allocate(args[0]);
                if (args.length > 1) {
                    var fill = support.runtime.getProperty(buffer, "fill");
                    support.runtime.call(fill, buffer, [args[1]]);
                }
                return buffer;
            });
        constructor.properties.$isBuffer = this.makeNative("Buffer.isBuffer",
            function (receiver, args) {
                return !!args[0] && args[0].guestType === "buffer";
            });
        constructor.properties.$prototype = this.prototype;
        this.constructor = constructor;
        this.runtime.setGlobal("Buffer", constructor);
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
        this.backings.push(backing);
        this.runtime.noteAllocation(Math.max(1, Math.ceil(size / 64)));
        return this.makeView(backing, 0, size);
    };

    BufferSupport.prototype.makeView = function (backing, offset, length) {
        if (backing.freed) throw new Error("cannot view a freed backing store");
        var view = {guestType: "buffer", properties: {}, prototype: this.prototype,
                    backing: backing, offset: offset, length: length, gcMark: 0};
        this.runtime.trackObject(view);
        return view;
    };

    BufferSupport.prototype.requireBuffer = function (value) {
        if (!value || value.guestType !== "buffer") {
            throw new TypeError("Buffer method receiver is not a Buffer");
        }
    };

    BufferSupport.prototype.read = function (view, index) {
        if (index < 0 || index >= view.length) throw new RangeError("Buffer index out of range");
        return this.memory.read8(view.backing.allocation, view.offset + index);
    };

    BufferSupport.prototype.write = function (view, index, value) {
        if (index < 0 || index >= view.length) throw new RangeError("Buffer index out of range");
        this.memory.write8(view.backing.allocation, view.offset + index, value);
    };

    BufferSupport.prototype.read32LE = function (view, index) {
        if (index < 0 || index + 4 > view.length) throw new RangeError("Buffer read out of range");
        return this.memory.read32LE(view.backing.allocation, view.offset + index);
    };

    BufferSupport.prototype.write32LE = function (view, index, value) {
        if (index < 0 || index + 4 > view.length) throw new RangeError("Buffer write out of range");
        this.memory.write32LE(view.backing.allocation, view.offset + index, value);
    };

    BufferSupport.prototype.getProperty = function (view, key) {
        if (key === "length") return view.length;
        var index = canonicalIndex(key);
        if (index >= 0) return index < view.length ? this.read(view, index) : undefined;
        if (Object.prototype.hasOwnProperty.call(view.properties, "$" + key)) {
            return view.properties["$" + key];
        }
        return Object.prototype.hasOwnProperty.call(this.prototype.properties, "$" + key) ?
               this.prototype.properties["$" + key] : undefined;
    };

    BufferSupport.prototype.setProperty = function (view, key, value) {
        var index = canonicalIndex(key);
        if (index >= 0) {
            if (index < view.length) this.write(view, index, value);
            return value;
        }
        if (key === "length") return value;
        view.properties["$" + key] = value;
        return value;
    };

    BufferSupport.prototype.markView = function (view, generation) {
        view.backing.gcMark = generation;
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
