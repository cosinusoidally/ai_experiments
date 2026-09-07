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

    var NODE_PAGE_SHIFT = 16;
    var NODE_PAGE_SIZE = 1 << NODE_PAGE_SHIFT;
    var NODE_PAGE_MASK = NODE_PAGE_SIZE - 1;

    function allocateNodePage() {
        if (typeof Buffer !== "undefined") {
            if (Buffer.alloc) return Buffer.alloc(NODE_PAGE_SIZE);
            var buffer = new Buffer(NODE_PAGE_SIZE);
            if (buffer.fill) buffer.fill(0);
            else {
                var bufferIndex = 0;
                while (bufferIndex < NODE_PAGE_SIZE) buffer[bufferIndex++] = 0;
            }
            return buffer;
        }
        var bytes = [];
        var index = 0;
        while (index < NODE_PAGE_SIZE) bytes[index++] = 0;
        return bytes;
    }

    function readPagedByte(allocation, offset) {
        var page = allocation.pages[offset >>> NODE_PAGE_SHIFT];
        return page ? page[offset & NODE_PAGE_MASK] : 0;
    }

    function writePagedByte(allocation, offset, value) {
        value = Number(value) & 255;
        var pageIndex = offset >>> NODE_PAGE_SHIFT;
        var page = allocation.pages[pageIndex];
        /* Record initialization writes many zeroes. Preserve sparse pages
         * until a non-zero byte actually needs storage. */
        if (!page) {
            if (value === 0) return;
            page = allocation.pages[pageIndex] = allocateNodePage();
        }
        page[offset & NODE_PAGE_MASK] = value;
    }

    HostMemory.prototype.allocate = function (length, sparse) {
        var actualLength = length > 0 ? length : 1;
        this.allocations++;
        if (this.isMMVM) {
            var pointer = this.ffi.call(this.callocPointer, [actualLength, 1]);
            if (!pointer) throw new Error("native buffer allocation failed");
            return {isNative: true, pointer: pointer, length: length, freed: false};
        }
        return {isNative: false, pages: {}, length: length, freed: false,
                sparse: true};
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
        return readPagedByte(allocation, offset);
    };

    HostMemory.prototype.write8 = function (allocation, offset, value) {
        this.check(allocation, offset);
        value = Number(value) & 255;
        if (allocation.isNative) poke8(allocation.pointer + offset, value);
        else writePagedByte(allocation, offset, value);
    };

    HostMemory.prototype.read8Trusted = function (allocation, offset) {
        if (allocation.isNative) return peek8(allocation.pointer + offset);
        return readPagedByte(allocation, offset);
    };

    HostMemory.prototype.write8Trusted = function (allocation, offset, value) {
        value = Number(value) & 255;
        if (allocation.isNative) poke8(allocation.pointer + offset, value);
        else writePagedByte(allocation, offset, value);
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
        return (readPagedByte(allocation, offset) |
                (readPagedByte(allocation, offset + 1) << 8) |
                (readPagedByte(allocation, offset + 2) << 16) |
                (readPagedByte(allocation, offset + 3) << 24)) >>> 0;
    };

    HostMemory.prototype.write32LETrusted = function (allocation, offset, value) {
        value = Number(value) % 4294967296;
        if (value < 0) value += 4294967296;
        if (allocation.isNative) {
            poke32(allocation.pointer + offset,
                   value >= 2147483648 ? value - 4294967296 : value);
            return;
        }
        writePagedByte(allocation, offset, value);
        writePagedByte(allocation, offset + 1, value >>> 8);
        writePagedByte(allocation, offset + 2, value >>> 16);
        writePagedByte(allocation, offset + 3, value >>> 24);
    };

    HostMemory.prototype.free = function (allocation) {
        if (!allocation || allocation.freed) return;
        if (allocation.isNative) this.ffi.call(this.freePointer, [allocation.pointer]);
        allocation.freed = true;
        allocation.pointer = 0;
        allocation.pages = null;
        this.frees++;
    };

    HostMemory.prototype.hostName = function () {
        return this.isMMVM ? "mmvm-native" : "node-array-emulation";
    };

    root.GuestVMHostMemory = HostMemory;
    if (typeof module !== "undefined" && module.exports) module.exports = HostMemory;
}(this));
