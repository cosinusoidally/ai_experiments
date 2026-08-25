/* Runtime-owned byte-addressed memory. Only this module may translate heap
 * offsets into host-memory operations. Higher layers use Heap accessors. */
(function (root) {
    var HostMemory = root.GuestVMHostMemory;
    var Binary64 = root.GuestVMBinary64;
    if (typeof module !== "undefined" && module.exports) {
        HostMemory = require("./host_memory.js");
        Binary64 = require("./binary64.js");
    }

    function LinearMemory(byteLength) {
        byteLength = Number(byteLength);
        if (byteLength < 4096 || byteLength !== Math.floor(byteLength)) {
            throw new RangeError("linear memory size must be an integer of at least 4096 bytes");
        }
        this.host = new HostMemory();
        /* Node represents the large, sparsely touched guest heap as a zero-on-
         * read dictionary. Ordinary Buffer allocations retain dense arrays. */
        this.allocation = this.host.allocate(byteLength, true);
        this.byteLength = byteLength;
        this.destroyed = false;
    }

    LinearMemory.prototype.checkRange = function (address, length) {
        address = Number(address);
        length = Number(length);
        if (this.destroyed) throw new Error("linear memory is destroyed");
        if (address !== Math.floor(address) || length !== Math.floor(length) ||
            address < 0 || length < 0 || address + length > this.byteLength) {
            throw new RangeError("linear memory access is out of bounds");
        }
    };

    LinearMemory.prototype.readU8 = function (address) {
        this.checkRange(address, 1);
        return this.host.read8(this.allocation, address);
    };

    LinearMemory.prototype.writeU8 = function (address, value) {
        this.checkRange(address, 1);
        this.host.write8(this.allocation, address, value);
    };

    LinearMemory.prototype.readU16 = function (address) {
        this.checkRange(address, 2);
        return this.host.read8(this.allocation, address) |
               (this.host.read8(this.allocation, address + 1) << 8);
    };

    LinearMemory.prototype.writeU16 = function (address, value) {
        this.checkRange(address, 2);
        this.host.write8(this.allocation, address, value);
        this.host.write8(this.allocation, address + 1, Number(value) >>> 8);
    };

    LinearMemory.prototype.readU32 = function (address) {
        this.checkRange(address, 4);
        return this.host.read32LE(this.allocation, address);
    };

    LinearMemory.prototype.writeU32 = function (address, value) {
        this.checkRange(address, 4);
        this.host.write32LE(this.allocation, address, value);
    };

    LinearMemory.prototype.readU8Trusted = function (address) {
        return this.host.read8(this.allocation, address);
    };

    LinearMemory.prototype.writeU8Trusted = function (address, value) {
        this.host.write8(this.allocation, address, value);
    };

    LinearMemory.prototype.readU32Trusted = function (address) {
        return this.host.read32LE(this.allocation, address);
    };

    LinearMemory.prototype.writeU32Trusted = function (address, value) {
        this.host.write32LE(this.allocation, address, value);
    };

    LinearMemory.prototype.readF64 = function (address) {
        this.checkRange(address, 8);
        return Binary64.decode(this.host.read32LE(this.allocation, address),
            this.host.read32LE(this.allocation, address + 4));
    };

    LinearMemory.prototype.readF64Trusted = function (address) {
        return Binary64.decode(this.host.read32LE(this.allocation, address),
            this.host.read32LE(this.allocation, address + 4));
    };

    LinearMemory.prototype.writeF64 = function (address, value) {
        this.checkRange(address, 8);
        var words = Binary64.encode(Number(value));
        this.host.write32LE(this.allocation, address, words.low);
        this.host.write32LE(this.allocation, address + 4, words.high);
    };

    LinearMemory.prototype.fill = function (address, length, value) {
        this.checkRange(address, length);
        var index = 0;
        while (index < length) this.host.write8(this.allocation, address + index++, value);
    };

    LinearMemory.prototype.copy = function (destination, source, length) {
        this.checkRange(destination, length);
        this.checkRange(source, length);
        var backwards = destination > source && destination < source + length;
        var index = backwards ? length - 1 : 0;
        while (backwards ? index >= 0 : index < length) {
            this.host.write8(this.allocation, destination + index,
                this.host.read8(this.allocation, source + index));
            index += backwards ? -1 : 1;
        }
    };

    LinearMemory.prototype.nativeAddress = function (offset) {
        this.checkRange(offset, 0);
        return this.allocation.isNative ? this.allocation.pointer + offset : 0;
    };

    LinearMemory.prototype.destroy = function () {
        if (this.destroyed) return;
        this.host.free(this.allocation);
        this.destroyed = true;
    };

    root.GuestVMLinearMemory = LinearMemory;
    if (typeof module !== "undefined" && module.exports) module.exports = LinearMemory;
}(this));
