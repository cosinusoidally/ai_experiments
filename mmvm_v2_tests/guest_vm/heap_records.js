/* Authoritative guest-record layouts. Consumers use these named accessors and
 * never calculate record offsets or touch linear memory directly. Host-side
 * handles contain only a runtime identity and a record address. */
(function (root) {
    var Heap = root.GuestVMHeap;
    var ValueCells = root.GuestVMValueCells;
    if (typeof module !== "undefined" && module.exports) {
        Heap = require("./heap.js");
        ValueCells = require("./value_cell.js");
    }

    var CELL_BYTES = ValueCells.PAYLOAD_BYTES;

    var OBJECT_PROTOTYPE = 0;
    var OBJECT_PROPERTIES = 4;
    var OBJECT_EXTENSIBLE = 8;
    var OBJECT_BYTES = 16;

    var PROPERTY_NEXT = 0;
    var PROPERTY_KEY = 4;
    var PROPERTY_ATTRIBUTES = 8;
    var PROPERTY_VALUE = 16;
    var PROPERTY_BYTES = PROPERTY_VALUE + CELL_BYTES;

    var STRING_LENGTH = 0;
    var STRING_HASH = 4;
    var STRING_CHARS = 8;

    var VECTOR_LENGTH = 0;
    var VECTOR_CAPACITY = 4;
    var VECTOR_CELLS = 8;

    var ARRAY_PROTOTYPE = 0;
    var ARRAY_PROPERTIES = 4;
    var ARRAY_ELEMENTS = 8;
    var ARRAY_BYTES = 16;

    var ENVIRONMENT_PARENT = 0;
    var ENVIRONMENT_COUNT = 4;
    var ENVIRONMENT_CELLS = 8;

    var FUNCTION_PROTOTYPE = 0;
    var FUNCTION_PROPERTIES = 4;
    var FUNCTION_CLOSURE = 8;
    var FUNCTION_METADATA = 12;
    var FUNCTION_BYTES = 16;

    var FRAME_PROGRAM = 0;
    var FRAME_ENVIRONMENT = 4;
    var FRAME_CALLER = 8;
    var FRAME_PC = 12;
    var FRAME_RETURN_SLOT = 16;
    var FRAME_REGISTER_COUNT = 20;
    var FRAME_REGISTERS = 24;

    var REGEXP_PATTERN = 0;
    var REGEXP_FLAGS = 4;
    var REGEXP_PROTOTYPE = 8;
    var REGEXP_BYTES = 16;

    var BUFFER_VIEW_BACKING = 0;
    var BUFFER_VIEW_OFFSET = 4;
    var BUFFER_VIEW_LENGTH = 8;
    var BUFFER_VIEW_PROTOTYPE = 12;
    var BUFFER_VIEW_BYTES = 16;

    var BUFFER_BACKING_POINTER = 0;
    var BUFFER_BACKING_LENGTH = 4;
    var BUFFER_BACKING_METADATA = 8;
    var BUFFER_BACKING_BYTES = 16;

    var ATTR_WRITABLE = 1;
    var ATTR_ENUMERABLE = 2;
    var ATTR_CONFIGURABLE = 4;
    var DEFAULT_ATTRIBUTES = ATTR_WRITABLE | ATTR_ENUMERABLE | ATTR_CONFIGURABLE;

    function Records(heap, cells) {
        if (!heap || !cells || cells.heap !== heap) {
            throw new TypeError("heap records require one heap and its value cells");
        }
        this.heap = heap;
        this.cells = cells;
    }

    Records.Attributes = {WRITABLE: ATTR_WRITABLE,
                          ENUMERABLE: ATTR_ENUMERABLE,
                          CONFIGURABLE: ATTR_CONFIGURABLE,
                          DEFAULT: DEFAULT_ATTRIBUTES};

    Records.prototype.makeHandle = function (runtime, address) {
        this.heap.requireRecord(address);
        return {ownerRuntime: runtime, heapAddress: address};
    };

    Records.prototype.addressOf = function (handle) {
        if (!handle || !handle.heapAddress) {
            throw new TypeError("value is not a guest heap handle");
        }
        return this.heap.requireRecord(handle.heapAddress);
    };

    Records.prototype.allocateString = function (value) {
        value = String(value);
        var address = this.heap.allocateRecord(
            Heap.Types.STRING, STRING_CHARS + value.length * 2);
        this.heap.writeFieldU32(address, STRING_LENGTH, value.length,
                                Heap.Types.STRING);
        var hash = 2166136261;
        var index = 0;
        while (index < value.length) {
            var code = value.charCodeAt(index);
            this.heap.writeFieldU8(address, STRING_CHARS + index * 2,
                                   code & 255, Heap.Types.STRING);
            this.heap.writeFieldU8(address, STRING_CHARS + index * 2 + 1,
                                   code >>> 8, Heap.Types.STRING);
            hash ^= code;
            hash = (hash * 16777619) >>> 0;
            index++;
        }
        this.heap.writeFieldU32(address, STRING_HASH, hash, Heap.Types.STRING);
        return address;
    };

    Records.prototype.stringLength = function (address) {
        return this.heap.readFieldU32(address, STRING_LENGTH, Heap.Types.STRING);
    };

    Records.prototype.stringHash = function (address) {
        return this.heap.readFieldU32(address, STRING_HASH, Heap.Types.STRING);
    };

    Records.prototype.readString = function (address) {
        var length = this.stringLength(address);
        var result = "";
        var index = 0;
        while (index < length) {
            var low = this.heap.readFieldU8(address, STRING_CHARS + index * 2,
                                            Heap.Types.STRING);
            var high = this.heap.readFieldU8(address, STRING_CHARS + index * 2 + 1,
                                             Heap.Types.STRING);
            result += String.fromCharCode(low | (high << 8));
            index++;
        }
        return result;
    };

    Records.prototype.allocateObject = function (prototype) {
        return this.heap.allocateRecordWords(Heap.Types.OBJECT, OBJECT_BYTES,
                                              prototype || 0, 0, 1, 0);
    };

    Records.prototype.objectPrototype = function (address) {
        return this.heap.readFieldU32(address, OBJECT_PROTOTYPE, Heap.Types.OBJECT);
    };

    Records.prototype.setObjectPrototype = function (address, prototype) {
        if (prototype) this.heap.requireRecord(prototype);
        this.heap.writeFieldU32(address, OBJECT_PROTOTYPE, prototype || 0,
                                Heap.Types.OBJECT);
    };

    Records.prototype.objectPropertyHead = function (address) {
        return this.heap.readFieldU32(address, OBJECT_PROPERTIES, Heap.Types.OBJECT);
    };

    Records.prototype.findOwnProperty = function (object, keyString) {
        var property = this.objectPropertyHead(object);
        while (property) {
            if (this.readString(this.heap.readFieldU32(
                    property, PROPERTY_KEY, Heap.Types.PROPERTY)) === keyString) {
                return property;
            }
            property = this.heap.readFieldU32(property, PROPERTY_NEXT,
                                              Heap.Types.PROPERTY);
        }
        return 0;
    };

    Records.prototype.defineOwnProperty = function (object, keyAddress, attributes) {
        this.heap.requireRecord(keyAddress, Heap.Types.STRING);
        var key = this.readString(keyAddress);
        var property = this.findOwnProperty(object, key);
        if (!property) {
            property = this.heap.allocateRecordWords(Heap.Types.PROPERTY,
                PROPERTY_BYTES, this.objectPropertyHead(object), keyAddress,
                attributes === undefined ? DEFAULT_ATTRIBUTES : attributes, 0);
            this.heap.writeFieldU32(object, OBJECT_PROPERTIES, property,
                                    Heap.Types.OBJECT);
            return property;
        }
        this.heap.writeFieldU32(property, PROPERTY_ATTRIBUTES,
            attributes === undefined ? DEFAULT_ATTRIBUTES : attributes,
            Heap.Types.PROPERTY);
        return property;
    };

    Records.prototype.propertyValueCell = function (property) {
        return this.heap.payloadAddress(property, PROPERTY_VALUE, CELL_BYTES,
                                        Heap.Types.PROPERTY);
    };

    Records.prototype.propertyAttributes = function (property) {
        return this.heap.readFieldU32(property, PROPERTY_ATTRIBUTES,
                                      Heap.Types.PROPERTY);
    };

    Records.prototype.allocateValueVector = function (capacity) {
        capacity = Number(capacity) || 0;
        if (capacity < 0 || capacity !== Math.floor(capacity)) {
            throw new RangeError("invalid value-vector capacity");
        }
        var address = this.heap.allocateRecordWords(Heap.Types.VALUE_VECTOR,
            VECTOR_CELLS + capacity * CELL_BYTES, 0, capacity, 0, 0);
        var index = 0;
        while (index < capacity) {
            this.cells.writePrimitiveAt(this.vectorCell(address, index), undefined);
            index++;
        }
        return address;
    };

    Records.prototype.vectorLength = function (vector) {
        return this.heap.readFieldU32(vector, VECTOR_LENGTH, Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.setVectorLength = function (vector, length) {
        if (length < 0 || length > this.vectorCapacity(vector) ||
            length !== Math.floor(length)) throw new RangeError("invalid vector length");
        this.heap.writeFieldU32(vector, VECTOR_LENGTH, length,
                                Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.vectorCapacity = function (vector) {
        return this.heap.readFieldU32(vector, VECTOR_CAPACITY,
                                      Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.vectorCell = function (vector, index) {
        var capacity = this.vectorCapacity(vector);
        if (index < 0 || index >= capacity || index !== Math.floor(index)) {
            throw new RangeError("value-vector index is out of bounds");
        }
        return this.heap.payloadAddress(vector, VECTOR_CELLS + index * CELL_BYTES,
                                        CELL_BYTES, Heap.Types.VALUE_VECTOR);
    };

    Records.prototype.allocateArray = function (prototype, capacity) {
        var elements = this.allocateValueVector(capacity || 0);
        return this.heap.allocateRecordWords(Heap.Types.ARRAY, ARRAY_BYTES,
                                              prototype || 0, 0, elements, 0);
    };

    Records.prototype.arrayElements = function (array) {
        return this.heap.readFieldU32(array, ARRAY_ELEMENTS, Heap.Types.ARRAY);
    };

    Records.prototype.arrayLength = function (array) {
        return this.vectorLength(this.arrayElements(array));
    };

    Records.prototype.arrayElementCell = function (array, index) {
        return this.vectorCell(this.arrayElements(array), index);
    };

    Records.prototype.allocateEnvironment = function (parent, slotCount) {
        if (parent) this.heap.requireRecord(parent, Heap.Types.ENVIRONMENT);
        slotCount = Number(slotCount);
        if (slotCount < 0 || slotCount !== Math.floor(slotCount)) {
            throw new RangeError("invalid environment slot count");
        }
        var address = this.heap.allocateRecordWords(Heap.Types.ENVIRONMENT,
            ENVIRONMENT_CELLS + slotCount * CELL_BYTES,
            parent || 0, slotCount, 0, 0);
        var index = 0;
        while (index < slotCount) {
            this.cells.writePrimitiveAt(this.environmentCell(address, index), undefined);
            index++;
        }
        return address;
    };

    Records.prototype.environmentParent = function (environment) {
        return this.heap.readFieldU32(environment, ENVIRONMENT_PARENT,
                                      Heap.Types.ENVIRONMENT);
    };

    Records.prototype.environmentSlotCount = function (environment) {
        return this.heap.readFieldU32(environment, ENVIRONMENT_COUNT,
                                      Heap.Types.ENVIRONMENT);
    };

    Records.prototype.environmentCell = function (environment, slot) {
        var count = this.environmentSlotCount(environment);
        if (slot < 0 || slot >= count || slot !== Math.floor(slot)) {
            throw new RangeError("environment slot is out of bounds");
        }
        return this.heap.payloadAddress(environment,
            ENVIRONMENT_CELLS + slot * CELL_BYTES, CELL_BYTES,
            Heap.Types.ENVIRONMENT);
    };

    Records.prototype.allocateFunction = function (nativeFunction, prototype,
                                                     closure, metadata) {
        var type = nativeFunction ? Heap.Types.NATIVE_FUNCTION :
                                    Heap.Types.BYTECODE_FUNCTION;
        return this.heap.allocateRecordWords(type, FUNCTION_BYTES,
            prototype || 0, 0, closure || 0, metadata || 0);
    };

    Records.prototype.allocateRegExp = function (pattern, flags, prototype) {
        var patternAddress = this.allocateString(pattern);
        var flagsAddress = this.allocateString(flags);
        return this.heap.allocateRecordWords(Heap.Types.REGEXP, REGEXP_BYTES,
            patternAddress, flagsAddress, prototype || 0, 0);
    };

    Records.prototype.allocateBufferBacking = function (pointer, length, metadata) {
        return this.heap.allocateRecordWords(Heap.Types.BUFFER_BACKING,
            BUFFER_BACKING_BYTES, pointer || 0, length, metadata || 0, 0);
    };

    Records.prototype.allocateBufferView = function (backing, offset, length,
                                                       prototype) {
        return this.heap.allocateRecordWords(Heap.Types.BUFFER_VIEW,
            BUFFER_VIEW_BYTES, backing, offset, length, prototype || 0);
    };

    Records.prototype.functionClosure = function (address) {
        var type = this.heap.recordType(address);
        if (type !== Heap.Types.NATIVE_FUNCTION &&
            type !== Heap.Types.BYTECODE_FUNCTION) {
            throw new TypeError("record is not a function");
        }
        return this.heap.readFieldU32(address, FUNCTION_CLOSURE, type);
    };

    Records.prototype.allocateFrame = function (program, environment, caller,
                                                  returnSlot, registerCount) {
        var address = this.heap.allocateRecordWords(Heap.Types.FRAME,
            FRAME_REGISTERS + registerCount * CELL_BYTES,
            program || 0, environment || 0, caller || 0, 0);
        this.heap.writeFieldU32(address, FRAME_RETURN_SLOT, returnSlot >>> 0,
                                Heap.Types.FRAME);
        this.heap.writeFieldU32(address, FRAME_REGISTER_COUNT, registerCount,
                                Heap.Types.FRAME);
        var index = 0;
        while (index < registerCount) {
            this.cells.writePrimitiveAt(this.frameRegisterCell(address, index), undefined);
            index++;
        }
        return address;
    };

    Records.prototype.framePC = function (frame) {
        return this.heap.readFieldU32(frame, FRAME_PC, Heap.Types.FRAME);
    };

    Records.prototype.setFramePC = function (frame, pc) {
        this.heap.writeFieldU32(frame, FRAME_PC, pc, Heap.Types.FRAME);
    };

    Records.prototype.frameRegisterCount = function (frame) {
        return this.heap.readFieldU32(frame, FRAME_REGISTER_COUNT, Heap.Types.FRAME);
    };

    Records.prototype.frameRegisterCell = function (frame, register) {
        var count = this.frameRegisterCount(frame);
        if (register < 0 || register >= count || register !== Math.floor(register)) {
            throw new RangeError("frame register is out of bounds");
        }
        return this.heap.payloadAddress(frame,
            FRAME_REGISTERS + register * CELL_BYTES, CELL_BYTES, Heap.Types.FRAME);
    };

    root.GuestVMHeapRecords = Records;
    if (typeof module !== "undefined" && module.exports) module.exports = Records;
}(this));
