/* Central guest-heap allocator and field accessor layer. No consumer may add
 * a record offset to an address itself; layouts expose named accessors here. */
(function (root) {
    var LinearMemory = root.GuestVMLinearMemory;
    if (typeof module !== "undefined" && module.exports) {
        LinearMemory = require("./linear_memory.js");
    }

    var HEADER_SIZE = 16;
    var HEADER_TYPE = 0;
    var HEADER_SIZE_FIELD = 4;
    var HEADER_MARK = 8;
    var HEADER_FLAGS = 12;

    var Types = {
        FREE: 0,
        OBJECT: 1,
        ARRAY: 2,
        NATIVE_FUNCTION: 3,
        BYTECODE_FUNCTION: 4,
        ENVIRONMENT: 5,
        PROPERTY: 6,
        STRING: 7,
        NUMBER: 8,
        REGEXP: 9,
        BUFFER_VIEW: 10,
        BUFFER_BACKING: 11,
        ROOT_SLOT: 12,
        VALUE_VECTOR: 13,
        FRAME: 14,
        PROGRAM: 15,
        BYTECODE: 16,
        CONTEXT: 17,
        HANDLER: 18
    };

    function align8(value) {
        return (value + 7) & ~7;
    }

    function Heap(options) {
        options = options || {};
        this.byteLength = options.heapBytes === undefined ? 16 * 1024 * 1024 :
                          Number(options.heapBytes);
        this.memory = new LinearMemory(this.byteLength);
        /* Zero is the null reference. Keep the first cache line inaccessible. */
        this.bump = 64;
        this.freeBlocks = [];
        this.allocationCount = 0;
        this.destroyed = false;
        this.recordInitializer = null;
    }

    Heap.Types = Types;
    Heap.HEADER_SIZE = HEADER_SIZE;

    Heap.prototype.allocateRecord = function (type, payloadBytes) {
        return this.allocateRecordWords(type, payloadBytes, 0, 0, 0, 0);
    };

    Heap.prototype.setRecordInitializer = function (initializer) {
        this.recordInitializer = initializer;
    };

    Heap.prototype.allocateRecordWords = function (
            type, payloadBytes, word0, word1, word2, word3) {
        if (!Types || type <= Types.FREE || type > Types.HANDLER) {
            throw new TypeError("invalid heap record type");
        }
        payloadBytes = Number(payloadBytes);
        if (payloadBytes < 0 || payloadBytes !== Math.floor(payloadBytes)) {
            throw new RangeError("invalid heap record payload size");
        }
        var size = align8(HEADER_SIZE + payloadBytes);
        var address = 0;
        var freeIndex = 0;
        while (freeIndex < this.freeBlocks.length) {
            var candidate = this.freeBlocks[freeIndex];
            var candidateSize = this.memory.readU32Trusted(
                candidate + HEADER_SIZE_FIELD);
            if (candidateSize >= size) {
                address = candidate;
                this.freeBlocks.splice(freeIndex, 1);
                var remainder = candidateSize - size;
                if (remainder >= HEADER_SIZE + 8) {
                    var remainderAddress = address + size;
                    this.memory.writeU32Trusted(remainderAddress + HEADER_TYPE,
                                                Types.FREE);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_SIZE_FIELD,
                                                remainder);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_MARK, 0);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_FLAGS, 0);
                    this.freeBlocks.push(remainderAddress);
                } else size = candidateSize;
                break;
            }
            freeIndex++;
        }
        if (!address) {
            address = this.bump;
            if (address + size > this.byteLength) {
                throw new RangeError("guest heap exhausted");
            }
            this.bump += size;
        } else {
            var clearOffset = 0;
            while (clearOffset < size) {
                this.memory.writeU32Trusted(address + clearOffset, 0);
                clearOffset += 4;
            }
        }
        /* Fresh bump ranges are already zero-filled. Reused ranges were
         * cleared a word at a time above before the record was published. */
        if (this.recordInitializer && size >= HEADER_SIZE + 16) {
            this.recordInitializer.initialize(address, type, size,
                word0, word1, word2, word3);
        } else {
            this.memory.writeU32(address + HEADER_TYPE, type);
            this.memory.writeU32(address + HEADER_SIZE_FIELD, size);
            if (size >= HEADER_SIZE + 16) {
                this.memory.writeU32(address + HEADER_SIZE, word0 || 0);
                this.memory.writeU32(address + HEADER_SIZE + 4, word1 || 0);
                this.memory.writeU32(address + HEADER_SIZE + 8, word2 || 0);
                this.memory.writeU32(address + HEADER_SIZE + 12, word3 || 0);
            }
        }
        this.allocationCount++;
        return address;
    };

    Heap.prototype.freeRecord = function (address) {
        address = Number(address);
        if (!address || address !== Math.floor(address) || address < 64 ||
            address + HEADER_SIZE > this.bump) {
            throw new TypeError("invalid guest heap reference");
        }
        if (this.memory.readU32Trusted(address + HEADER_TYPE) === Types.FREE) {
            throw new Error("guest heap record is already freed");
        }
        var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
        this.memory.writeU32Trusted(address + HEADER_TYPE, Types.FREE);
        this.memory.writeU32Trusted(address + HEADER_MARK, 0);
        this.memory.writeU32Trusted(address + HEADER_FLAGS, 0);
        this.freeBlocks.push(address);
    };

    Heap.prototype.requireRecord = function (address, expectedType) {
        address = Number(address);
        if (!address || address !== Math.floor(address) || address < 64 ||
            address + HEADER_SIZE > this.bump) {
            throw new TypeError("invalid guest heap reference");
        }
        var type = this.memory.readU32(address + HEADER_TYPE);
        if (type === Types.FREE) throw new Error("guest heap reference is freed");
        if (expectedType !== undefined && type !== expectedType) {
            throw new TypeError("unexpected guest heap record type");
        }
        return address;
    };

    Heap.prototype.recordType = function (address) {
        this.requireRecord(address);
        return this.memory.readU32(address + HEADER_TYPE);
    };

    Heap.prototype.recordSize = function (address) {
        this.requireRecord(address);
        return this.memory.readU32(address + HEADER_SIZE_FIELD);
    };

    Heap.prototype.mark = function (address) {
        this.requireRecord(address);
        return this.memory.readU32(address + HEADER_MARK);
    };

    Heap.prototype.setMark = function (address, generation) {
        this.requireRecord(address);
        this.memory.writeU32(address + HEADER_MARK, generation);
    };

    Heap.prototype.flags = function (address) {
        this.requireRecord(address);
        return this.memory.readU32(address + HEADER_FLAGS);
    };

    Heap.prototype.setFlags = function (address, flags) {
        this.requireRecord(address);
        this.memory.writeU32(address + HEADER_FLAGS, flags);
    };

    Heap.prototype.checkPayload = function (address, offset, width, expectedType) {
        this.requireRecord(address, expectedType);
        offset = Number(offset);
        if (offset < 0 || offset !== Math.floor(offset) ||
            HEADER_SIZE + offset + width > this.recordSize(address)) {
            throw new RangeError("guest heap field is outside its record");
        }
        return address + HEADER_SIZE + offset;
    };

    Heap.prototype.readFieldU8 = function (address, offset, expectedType) {
        return this.memory.readU8(this.checkPayload(address, offset, 1, expectedType));
    };

    Heap.prototype.writeFieldU8 = function (address, offset, value, expectedType) {
        this.memory.writeU8(this.checkPayload(address, offset, 1, expectedType), value);
    };

    Heap.prototype.readFieldU32 = function (address, offset, expectedType) {
        return this.memory.readU32(this.checkPayload(address, offset, 4, expectedType));
    };

    Heap.prototype.writeFieldU32 = function (address, offset, value, expectedType) {
        this.memory.writeU32(this.checkPayload(address, offset, 4, expectedType), value);
    };

    /* Fixed-layout record accessors use these only after their public method
     * has established the record/index invariant. Keeping the unchecked
     * address arithmetic here preserves the layering boundary while avoiding
     * repeated type/size header reads for every field in one semantic access. */
    Heap.prototype.readTrustedFieldU8 = function (address, offset) {
        return this.memory.readU8Trusted(address + HEADER_SIZE + offset);
    };

    Heap.prototype.writeTrustedFieldU8 = function (address, offset, value) {
        this.memory.writeU8Trusted(address + HEADER_SIZE + offset, value);
    };

    Heap.prototype.readTrustedFieldU32 = function (address, offset) {
        return this.memory.readU32Trusted(address + HEADER_SIZE + offset);
    };

    Heap.prototype.writeTrustedFieldU32 = function (address, offset, value) {
        this.memory.writeU32Trusted(address + HEADER_SIZE + offset, value);
    };

    Heap.prototype.trustedPayloadAddress = function (address, offset) {
        return address + HEADER_SIZE + offset;
    };

    Heap.prototype.payloadAddress = function (address, offset, length, expectedType) {
        return this.checkPayload(address, offset, length, expectedType);
    };

    Heap.prototype.destroy = function () {
        if (this.destroyed) return;
        this.memory.destroy();
        this.destroyed = true;
        this.bump = 0;
    };

    root.GuestVMHeap = Heap;
    if (typeof module !== "undefined" && module.exports) module.exports = Heap;
}(this));
