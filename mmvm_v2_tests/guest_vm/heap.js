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
        HANDLER: 18,
        ENGINE_STATE: 19,
        PLATFORM_SERVICES: 20
    };

    function align8(value) {
        return (value + 7) & ~7;
    }

    function Heap(options) {
        options = options || {};
        this.allocationLimit = options.heapBytes === undefined ?
            16 * 1024 * 1024 : Number(options.heapBytes);
        /* Native marking needs one 32-bit work-list entry per possible heap
         * record.  A record is at least one 16-byte header, so this reserved
         * suffix is sufficient without reducing the guest-visible capacity. */
        this.collectorStackBytes = options.collectorWorkspace ?
            Math.max(4096, align8(Math.ceil(this.allocationLimit / 4))) : 0;
        this.collectorStackBase = this.allocationLimit;
        this.byteLength = this.allocationLimit + this.collectorStackBytes;
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
        if (!Types || type <= Types.FREE || type > Types.PLATFORM_SERVICES) {
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
            if (candidate < 64 || candidate !== Math.floor(candidate)) {
                throw new Error("corrupt guest free-block index at " +
                                freeIndex + ": " + candidate);
            }
            var candidateSize = this.memory.readU32Trusted(
                candidate + HEADER_SIZE_FIELD);
            if (candidateSize >= size) {
                address = candidate;
                var remainder = candidateSize - size;
                if (remainder >= HEADER_SIZE + 8) {
                    var remainderAddress = address + size;
                    this.memory.writeU32Trusted(remainderAddress + HEADER_TYPE,
                                                Types.FREE);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_SIZE_FIELD,
                                                remainder);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_MARK, 0);
                    this.memory.writeU32Trusted(remainderAddress + HEADER_FLAGS, 0);
                    if (freeIndex === 0) {
                        this.freeBlocks[0] = remainderAddress;
                    } else {
                        this.freeBlocks[freeIndex] = this.freeBlocks[0];
                        this.freeBlocks[0] = remainderAddress;
                    }
                } else {
                    size = candidateSize;
                    this.freeBlocks.splice(freeIndex, 1);
                }
                break;
            }
            freeIndex++;
        }
        if (!address) {
            address = this.bump;
            if (address + size > this.allocationLimit) {
                throw new RangeError("guest heap exhausted: " +
                    this.exhaustionSummary(size));
            }
            this.bump += size;
        }
        /* A collection may lower the bump pointer over a dead tail, so even a
         * bump allocation can cover previously used bytes. Clear every host
         * allocation before publishing its header. */
        var clearOffset = 0;
        while (clearOffset < size) {
            this.memory.writeU32Trusted(address + clearOffset, 0);
            clearOffset += 4;
        }
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

    Heap.prototype.exhaustionSummary = function (requested) {
        var counts = [];
        var bytes = [];
        var flaggedFreeCounts = [];
        var flaggedFreeBytes = [];
        var address = 64;
        while (address < this.bump) {
            var type = this.memory.readU32Trusted(address + HEADER_TYPE);
            var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
            if (!size || size % 8 || address + size > this.bump) {
                return "corrupt record at " + address;
            }
            counts[type] = (counts[type] || 0) + 1;
            bytes[type] = (bytes[type] || 0) + size;
            if (type === Types.FREE) {
                var flags = this.memory.readU32Trusted(address + HEADER_FLAGS);
                if (flags) {
                    flaggedFreeCounts[flags] =
                        (flaggedFreeCounts[flags] || 0) + 1;
                    flaggedFreeBytes[flags] =
                        (flaggedFreeBytes[flags] || 0) + size;
                }
            }
            address += size;
        }
        var parts = [];
        var typeIndex = 0;
        while (typeIndex < counts.length) {
            if (counts[typeIndex]) {
                parts.push(typeIndex + "=" + counts[typeIndex] + "/" +
                           bytes[typeIndex]);
            }
            typeIndex++;
        }
        var flagParts = [];
        var flagIndex = 0;
        while (flagIndex < flaggedFreeCounts.length) {
            if (flaggedFreeCounts[flagIndex]) {
                flagParts.push(flagIndex + "=" + flaggedFreeCounts[flagIndex] +
                    "/" + flaggedFreeBytes[flagIndex]);
            }
            flagIndex++;
        }
        return "requested=" + requested + " bump=" + this.bump +
               " freeBlocks=" + this.freeBlocks.length +
               " flaggedFree(flag=count/bytes): " + flagParts.join(",") +
               " records(type=count/bytes): " + parts.join(",");
    };

    Heap.prototype.freeRecord = function (address) {
        address = Number(address);
        if (!address || address !== Math.floor(address) || address < 64 ||
            address + HEADER_SIZE > this.bump) {
            throw new TypeError("invalid guest heap reference " + address +
                                " (heap bump " + this.bump + ")");
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

    /* Rebuild the free-block index from authoritative record headers.  The
     * guest heap uses offsets rather than host objects, so this also lets a
     * native bump allocator reclaim an entirely dead tail without moving any
     * live record or rewriting references. */
    Heap.prototype.rebuildFreeBlocks = function () {
        var blocks = [];
        var address = 64;
        while (address < this.bump) {
            var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
            if (!size || size % 8 || address + size > this.bump) {
                throw new Error("corrupt guest heap record at " + address);
            }
            if (this.memory.readU32Trusted(address + HEADER_TYPE) === Types.FREE &&
                this.memory.readU32Trusted(address + HEADER_FLAGS) === 0) {
                if (blocks.length) {
                    var previous = blocks[blocks.length - 1];
                    var previousSize = this.memory.readU32Trusted(
                        previous + HEADER_SIZE_FIELD);
                    if (previous + previousSize === address) {
                        this.memory.writeU32Trusted(previous + HEADER_SIZE_FIELD,
                                                    previousSize + size);
                    } else blocks.push(address);
                } else blocks.push(address);
            }
            address += size;
        }
        while (blocks.length) {
            var tail = blocks[blocks.length - 1];
            var tailSize = this.memory.readU32Trusted(tail + HEADER_SIZE_FIELD);
            if (tail + tailSize !== this.bump) break;
            this.bump = tail;
            blocks.pop();
        }
        this.freeBlocks = blocks;
        return blocks.length;
    };

    Heap.prototype.claimLargestFreeBlock = function (minimumSize) {
        var bestIndex = -1;
        var bestSize = 0;
        var index = 0;
        while (index < this.freeBlocks.length) {
            var address = this.freeBlocks[index];
            var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
            if (size >= minimumSize && size > bestSize) {
                bestIndex = index;
                bestSize = size;
            }
            index++;
        }
        if (bestIndex < 0) return null;
        var claimedAddress = this.freeBlocks[bestIndex];
        this.freeBlocks.splice(bestIndex, 1);
        return {address: claimedAddress, size: bestSize};
    };

    Heap.prototype.largestFreeBlockSize = function () {
        var largest = 0;
        var index = 0;
        while (index < this.freeBlocks.length) {
            var size = this.memory.readU32Trusted(
                this.freeBlocks[index++] + HEADER_SIZE_FIELD);
            if (size > largest) largest = size;
        }
        return largest;
    };

    Heap.prototype.publishFreeRegion = function (address, size, flags) {
        if (address < 64 || address !== Math.floor(address) ||
            size < HEADER_SIZE || size % 8 || address + size > this.bump) {
            throw new Error("invalid published guest free region");
        }
        this.memory.writeU32Trusted(address + HEADER_TYPE, Types.FREE);
        this.memory.writeU32Trusted(address + HEADER_SIZE_FIELD, size);
        this.memory.writeU32Trusted(address + HEADER_MARK, 0);
        this.memory.writeU32Trusted(address + HEADER_FLAGS, flags || 0);
    };

    Heap.prototype.sweepUnmarked = function (generation) {
        var address = 64;
        var reclaimedRecords = 0;
        var reclaimedBytes = 0;
        while (address < this.bump) {
            var type = this.memory.readU32Trusted(address + HEADER_TYPE);
            var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
            if (!size || size % 8 || address + size > this.bump) {
                throw new Error("corrupt guest heap record at " + address);
            }
            if (type !== Types.FREE &&
                this.memory.readU32Trusted(address + HEADER_MARK) !== generation) {
                this.memory.writeU32Trusted(address + HEADER_TYPE, Types.FREE);
                this.memory.writeU32Trusted(address + HEADER_MARK, 0);
                this.memory.writeU32Trusted(address + HEADER_FLAGS, 0);
                reclaimedRecords++;
                reclaimedBytes += size;
            }
            address += size;
        }
        this.rebuildFreeBlocks();
        return {records: reclaimedRecords, bytes: reclaimedBytes};
    };

    Heap.prototype.visitRecords = function (visitor) {
        var address = 64;
        while (address < this.bump) {
            var type = this.memory.readU32Trusted(address + HEADER_TYPE);
            var size = this.memory.readU32Trusted(address + HEADER_SIZE_FIELD);
            if (!size || size % 8 || address + size > this.bump) {
                throw new Error("corrupt guest heap record at " + address);
            }
            visitor(address, type, size,
                    this.memory.readU32Trusted(address + HEADER_MARK));
            address += size;
        }
    };

    Heap.prototype.requireRecord = function (address, expectedType) {
        address = Number(address);
        if (!address || address !== Math.floor(address) || address < 64 ||
            address + HEADER_SIZE > this.bump) {
            throw new TypeError("invalid guest heap reference " + address +
                                " (heap bump " + this.bump + ")");
        }
        var type = this.memory.readU32(address + HEADER_TYPE);
        if (type === Types.FREE && expectedType !== Types.FREE) {
            throw new Error("guest heap reference " + address +
                " is freed (size " +
                this.memory.readU32(address + HEADER_SIZE_FIELD) +
                ", flags " + this.memory.readU32(address + HEADER_FLAGS) + ")");
        }
        if (expectedType !== undefined && type !== expectedType) {
            throw new TypeError("unexpected guest heap record type");
        }
        return address;
    };

    Heap.prototype.recordType = function (address) {
        this.requireRecord(address);
        return this.memory.readU32(address + HEADER_TYPE);
    };

    Heap.prototype.isFreeRecord = function (address) {
        address = Number(address);
        if (!address || address < 64 || address >= this.bump) return false;
        return this.memory.readU32Trusted(address + HEADER_TYPE) === Types.FREE;
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

    Heap.prototype.setFreeRecordFlags = function (address, flags) {
        this.requireRecord(address, Types.FREE);
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
