/* Explicit guest value cells. The tag is separate from the payload: this is
 * deliberately not NaN boxing. All field offsets remain private to this file. */
(function (root) {
    var Heap = root.GuestVMHeap;
    var Binary64 = root.GuestVMBinary64;
    if (typeof module !== "undefined" && module.exports) {
        Heap = require("./heap.js");
        Binary64 = require("./binary64.js");
    }

    var TAG_OFFSET = 0;
    var LOW_OFFSET = 4;
    var HIGH_OFFSET = 8;
    var AUX_OFFSET = 12;
    var PAYLOAD_BYTES = 16;
    var Tags = {UNDEFINED: 1, NULL: 2, FALSE: 3, TRUE: 4,
                INT32: 5, DOUBLE: 6, REFERENCE: 7};

    function ValueCells(heap) {
        if (!heap || !heap.memory) throw new TypeError("value cells require a guest heap");
        this.heap = heap;
    }

    ValueCells.Tags = Tags;
    ValueCells.PAYLOAD_BYTES = PAYLOAD_BYTES;

    ValueCells.prototype.allocate = function () {
        return this.heap.allocateRecord(Heap.Types.ROOT_SLOT, PAYLOAD_BYTES);
    };

    ValueCells.prototype.tag = function (cell) {
        return this.heap.readFieldU32(cell, TAG_OFFSET, Heap.Types.ROOT_SLOT);
    };

    ValueCells.prototype.tagAt = function (address) {
        return this.heap.memory.readU32(address + TAG_OFFSET);
    };

    ValueCells.prototype.setTag = function (cell, tag) {
        this.heap.writeFieldU32(cell, TAG_OFFSET, tag, Heap.Types.ROOT_SLOT);
    };

    ValueCells.prototype.setTagAt = function (address, tag) {
        this.heap.memory.writeU32(address + TAG_OFFSET, tag);
    };

    ValueCells.prototype.clearPayload = function (cell) {
        this.heap.writeFieldU32(cell, LOW_OFFSET, 0, Heap.Types.ROOT_SLOT);
        this.heap.writeFieldU32(cell, HIGH_OFFSET, 0, Heap.Types.ROOT_SLOT);
        this.heap.writeFieldU32(cell, AUX_OFFSET, 0, Heap.Types.ROOT_SLOT);
    };

    ValueCells.prototype.clearPayloadAt = function (address) {
        this.heap.memory.writeU32(address + LOW_OFFSET, 0);
        this.heap.memory.writeU32(address + HIGH_OFFSET, 0);
        this.heap.memory.writeU32(address + AUX_OFFSET, 0);
    };

    ValueCells.prototype.writePrimitiveAt = function (address, value) {
        this.clearPayloadAt(address);
        if (value === undefined) this.setTagAt(address, Tags.UNDEFINED);
        else if (value === null) this.setTagAt(address, Tags.NULL);
        else if (value === false) this.setTagAt(address, Tags.FALSE);
        else if (value === true) this.setTagAt(address, Tags.TRUE);
        else if (typeof value === "number") {
            if (isInt32(value)) {
                this.setTagAt(address, Tags.INT32);
                this.heap.memory.writeU32(address + LOW_OFFSET, value >>> 0);
            } else {
                var words = Binary64.encode(value);
                this.setTagAt(address, Tags.DOUBLE);
                this.heap.memory.writeU32(address + LOW_OFFSET, words.low);
                this.heap.memory.writeU32(address + HIGH_OFFSET, words.high);
            }
        } else throw new TypeError("value is not a primitive value-cell value");
        return address;
    };

    ValueCells.prototype.readPrimitiveAt = function (address) {
        var tag = this.tagAt(address);
        if (tag === 0 || tag === Tags.UNDEFINED) return undefined;
        if (tag === Tags.NULL) return null;
        if (tag === Tags.FALSE) return false;
        if (tag === Tags.TRUE) return true;
        if (tag === Tags.INT32) {
            var word = this.heap.memory.readU32(address + LOW_OFFSET);
            return word >= 2147483648 ? word - 4294967296 : word;
        }
        if (tag === Tags.DOUBLE) {
            return this.heap.memory.readF64(address + LOW_OFFSET);
        }
        throw new TypeError("value cell does not contain a primitive");
    };

    ValueCells.prototype.writeReferenceAt = function (address, reference) {
        this.heap.requireRecord(reference);
        this.clearPayloadAt(address);
        this.setTagAt(address, Tags.REFERENCE);
        this.heap.memory.writeU32(address + LOW_OFFSET, reference);
        return address;
    };

    ValueCells.prototype.readReferenceAt = function (address, expectedType) {
        if (this.tagAt(address) !== Tags.REFERENCE) {
            throw new TypeError("value cell does not contain a reference");
        }
        var reference = this.heap.memory.readU32(address + LOW_OFFSET);
        this.heap.requireRecord(reference, expectedType);
        return reference;
    };

    ValueCells.prototype.writePrimitive = function (cell, value) {
        this.clearPayload(cell);
        if (value === undefined) this.setTag(cell, Tags.UNDEFINED);
        else if (value === null) this.setTag(cell, Tags.NULL);
        else if (value === false) this.setTag(cell, Tags.FALSE);
        else if (value === true) this.setTag(cell, Tags.TRUE);
        else if (typeof value === "number") {
            if (isInt32(value)) {
                this.setTag(cell, Tags.INT32);
                this.heap.writeFieldU32(cell, LOW_OFFSET, value >>> 0,
                                        Heap.Types.ROOT_SLOT);
            } else {
                var words = Binary64.encode(value);
                this.setTag(cell, Tags.DOUBLE);
                this.heap.writeFieldU32(cell, LOW_OFFSET, words.low,
                                        Heap.Types.ROOT_SLOT);
                this.heap.writeFieldU32(cell, HIGH_OFFSET, words.high,
                                        Heap.Types.ROOT_SLOT);
            }
        } else throw new TypeError("value is not a primitive value-cell value");
        return cell;
    };

    ValueCells.prototype.readPrimitive = function (cell) {
        var tag = this.tag(cell);
        if (tag === Tags.UNDEFINED) return undefined;
        if (tag === Tags.NULL) return null;
        if (tag === Tags.FALSE) return false;
        if (tag === Tags.TRUE) return true;
        if (tag === Tags.INT32) {
            var word = this.heap.readFieldU32(cell, LOW_OFFSET,
                                              Heap.Types.ROOT_SLOT);
            return word >= 2147483648 ? word - 4294967296 : word;
        }
        if (tag === Tags.DOUBLE) {
            return this.heap.memory.readF64(
                this.heap.payloadAddress(cell, LOW_OFFSET, 8, Heap.Types.ROOT_SLOT));
        }
        throw new TypeError("value cell does not contain a primitive");
    };

    ValueCells.prototype.writeReference = function (cell, reference) {
        this.heap.requireRecord(reference);
        this.clearPayload(cell);
        this.setTag(cell, Tags.REFERENCE);
        this.heap.writeFieldU32(cell, LOW_OFFSET, reference, Heap.Types.ROOT_SLOT);
        return cell;
    };

    ValueCells.prototype.readReference = function (cell, expectedType) {
        if (this.tag(cell) !== Tags.REFERENCE) {
            throw new TypeError("value cell does not contain a reference");
        }
        var reference = this.heap.readFieldU32(cell, LOW_OFFSET,
                                               Heap.Types.ROOT_SLOT);
        this.heap.requireRecord(reference, expectedType);
        return reference;
    };

    function isInt32(value) {
        return value === (value | 0) && !(value === 0 && 1 / value < 0);
    }

    root.GuestVMValueCells = ValueCells;
    if (typeof module !== "undefined" && module.exports) module.exports = ValueCells;
}(this));
