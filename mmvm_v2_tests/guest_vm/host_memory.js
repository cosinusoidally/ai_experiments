/* Host memory boundary. Node uses an ordinary-array emulation with the same API. */
(function (root) {
    var HostFFI = root.GuestVMHostFFI;
    if (typeof module !== "undefined" && module.exports) {
        HostFFI = require("./host_ffi.js");
    }

    function HostMemory() {
        this.ffi = new HostFFI();
        this.isMMVM = this.ffi.isMMVM;
        this.callocPointer = this.isMMVM ? this.ffi.resolve("calloc") : 0;
        this.freePointer = this.isMMVM ? this.ffi.resolve("free") : 0;
        this.allocations = 0;
        this.frees = 0;
    }

    HostMemory.prototype.allocate = function (length, sparse) {
        var actualLength = length > 0 ? length : 1;
        this.allocations++;
        if (this.isMMVM) {
            var pointer = this.ffi.call(this.callocPointer, [actualLength, 1]);
            if (!pointer) throw new Error("native buffer allocation failed");
            return {isNative: true, pointer: pointer, length: length, freed: false};
        }
        var bytes = sparse ? {} : [];
        if (!sparse) {
            var index = 0;
            while (index < actualLength) bytes[index++] = 0;
        }
        return {isNative: false, bytes: bytes, length: length, freed: false,
                sparse: !!sparse};
    };

    HostMemory.prototype.check = function (allocation, offset) {
        if (!allocation || allocation.freed) throw new Error("backing store is freed");
        if (offset < 0 || offset >= allocation.length) {
            throw new RangeError("native memory access is out of bounds");
        }
    };

    HostMemory.prototype.read8 = function (allocation, offset) {
        this.check(allocation, offset);
        if (allocation.isNative) return peek8(allocation.pointer + offset);
        var value = allocation.bytes[offset];
        return value === undefined ? 0 : value;
    };

    HostMemory.prototype.write8 = function (allocation, offset, value) {
        this.check(allocation, offset);
        value = Number(value) & 255;
        if (allocation.isNative) poke8(allocation.pointer + offset, value);
        else allocation.bytes[offset] = value;
    };

    HostMemory.prototype.read8Trusted = function (allocation, offset) {
        if (allocation.isNative) return peek8(allocation.pointer + offset);
        var value = allocation.bytes[offset];
        return value === undefined ? 0 : value;
    };

    HostMemory.prototype.write8Trusted = function (allocation, offset, value) {
        value = Number(value) & 255;
        if (allocation.isNative) poke8(allocation.pointer + offset, value);
        else allocation.bytes[offset] = value;
    };

    HostMemory.prototype.read32LE = function (allocation, offset) {
        if (offset < 0 || offset + 4 > allocation.length) {
            throw new RangeError("32-bit read is out of bounds");
        }
        if (allocation.isNative && ((allocation.pointer + offset) & 3) === 0) {
            return peek32(allocation.pointer + offset) >>> 0;
        }
        return (this.read8(allocation, offset) |
                (this.read8(allocation, offset + 1) << 8) |
                (this.read8(allocation, offset + 2) << 16) |
                (this.read8(allocation, offset + 3) << 24)) >>> 0;
    };

    HostMemory.prototype.write32LE = function (allocation, offset, value) {
        if (offset < 0 || offset + 4 > allocation.length) {
            throw new RangeError("32-bit write is out of bounds");
        }
        value = Number(value) % 4294967296;
        if (value < 0) value += 4294967296;
        if (allocation.isNative && ((allocation.pointer + offset) & 3) === 0) {
            /* Old SpiderMonkey saturates some uint32-to-native-int argument
             * conversions. Pass the identical bits through the signed range. */
            poke32(allocation.pointer + offset,
                   value >= 2147483648 ? value - 4294967296 : value);
            return;
        }
        this.write8(allocation, offset, value);
        this.write8(allocation, offset + 1, value >>> 8);
        this.write8(allocation, offset + 2, value >>> 16);
        this.write8(allocation, offset + 3, value >>> 24);
    };

    HostMemory.prototype.read32LETrusted = function (allocation, offset) {
        if (allocation.isNative) {
            return peek32(allocation.pointer + offset) >>> 0;
        }
        var bytes = allocation.bytes;
        return ((bytes[offset] || 0) |
                ((bytes[offset + 1] || 0) << 8) |
                ((bytes[offset + 2] || 0) << 16) |
                ((bytes[offset + 3] || 0) << 24)) >>> 0;
    };

    HostMemory.prototype.write32LETrusted = function (allocation, offset, value) {
        value = Number(value) % 4294967296;
        if (value < 0) value += 4294967296;
        if (allocation.isNative) {
            poke32(allocation.pointer + offset,
                   value >= 2147483648 ? value - 4294967296 : value);
            return;
        }
        var bytes = allocation.bytes;
        bytes[offset] = value & 255;
        bytes[offset + 1] = (value >>> 8) & 255;
        bytes[offset + 2] = (value >>> 16) & 255;
        bytes[offset + 3] = (value >>> 24) & 255;
    };

    HostMemory.prototype.free = function (allocation) {
        if (!allocation || allocation.freed) return;
        if (allocation.isNative) this.ffi.call(this.freePointer, [allocation.pointer]);
        allocation.freed = true;
        allocation.pointer = 0;
        allocation.bytes = null;
        this.frees++;
    };

    HostMemory.prototype.hostName = function () {
        return this.isMMVM ? "mmvm-native" : "node-array-emulation";
    };

    root.GuestVMHostMemory = HostMemory;
    if (typeof module !== "undefined" && module.exports) module.exports = HostMemory;
}(this));
