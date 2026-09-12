/* Shared-IR bulk initializer for the common header plus four payload words. */
(function (root) {
    var Compiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    if (typeof module !== "undefined" && module.exports) {
        Compiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
    }

    var sharedJS = null;
    var sharedX86 = null;
    var sharedPropertyCloneJS = null;
    var sharedPropertyCloneX86 = null;

    function initializerKernel(base, address, type, size,
                               word0, word1, word2, word3) {
        store32(base + address, type);
        store32(base + address + 4, size);
        store32(base + address + 16, word0);
        store32(base + address + 20, word1);
        store32(base + address + 24, word2);
        store32(base + address + 28, word3);
        return address;
    }

    function propertyCloneKernel(base, sourceProperty, targetObject,
                                 block, blockBytes, propertyCount,
                                 enumerableOnly) {
        var HEAP_TYPE_PROPERTY = 6;
        var RECORD_BYTES = 48;
        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_MARK = 8;
        var RECORD_FLAGS = 12;
        var PROPERTY_NEXT = 16;
        var PROPERTY_KEY = 20;
        var PROPERTY_ATTRIBUTES = 24;
        var PROPERTY_SETTER = 28;
        var PROPERTY_VALUE_TAG = 32;
        var PROPERTY_VALUE_LOW = 36;
        var PROPERTY_VALUE_HIGH = 40;
        var PROPERTY_VALUE_AUX = 44;
        var OBJECT_PROPERTY_HEAD = 20;
        var PROPERTY_ENUMERABLE = 2;
        var source = sourceProperty;
        var previous = 0;
        var first = 0;
        var index = 0;
        while (source !== 0) {
            var attributes = load32(
                base + source + PROPERTY_ATTRIBUTES);
            var cloneProperty = 0;
            if (enumerableOnly === 0) cloneProperty = 1;
            else if ((attributes & PROPERTY_ENUMERABLE) !== 0) {
                cloneProperty = 1;
            }
            if (cloneProperty === 1) {
                var clone = block + index * RECORD_BYTES;
                var size = RECORD_BYTES;
                if (index + 1 === propertyCount) {
                    size = blockBytes - index * RECORD_BYTES;
                }
                store32(base + clone + RECORD_TYPE, HEAP_TYPE_PROPERTY);
                store32(base + clone + RECORD_SIZE, size);
                store32(base + clone + RECORD_MARK, 0);
                store32(base + clone + RECORD_FLAGS, 0);
                store32(base + clone + PROPERTY_NEXT, 0);
                store32(base + clone + PROPERTY_KEY,
                    load32(base + source + PROPERTY_KEY));
                store32(base + clone + PROPERTY_ATTRIBUTES, attributes);
                store32(base + clone + PROPERTY_SETTER,
                    load32(base + source + PROPERTY_SETTER));
                store32(base + clone + PROPERTY_VALUE_TAG,
                    load32(base + source + PROPERTY_VALUE_TAG));
                store32(base + clone + PROPERTY_VALUE_LOW,
                    load32(base + source + PROPERTY_VALUE_LOW));
                store32(base + clone + PROPERTY_VALUE_HIGH,
                    load32(base + source + PROPERTY_VALUE_HIGH));
                store32(base + clone + PROPERTY_VALUE_AUX,
                    load32(base + source + PROPERTY_VALUE_AUX));
                if (first === 0) first = clone;
                if (previous !== 0) {
                    store32(base + previous + PROPERTY_NEXT, clone);
                }
                previous = clone;
                index = index + 1;
            }
            source = load32(base + source + PROPERTY_NEXT);
        }
        store32(base + targetObject + OBJECT_PROPERTY_HEAD, first);
        return first;
    }

    function RecordInitializer(heap) {
        this.heap = heap;
        if (!sharedJS) {
            var ir = new Compiler().compile(initializerKernel);
            sharedJS = new JSBackend().compile(ir);
            sharedX86 = new X86Backend().compile(ir);
            var cloneIR = new Compiler().compile(propertyCloneKernel);
            sharedPropertyCloneJS = new JSBackend().compile(cloneIR);
            sharedPropertyCloneX86 = new X86Backend().compile(cloneIR);
        }
        this.compiled = heap.memory.nativeAddress(0) && sharedX86.fn ?
                        sharedX86 : sharedJS;
        this.propertyCloneCompiled =
            heap.memory.nativeAddress(0) && sharedPropertyCloneX86.fn ?
            sharedPropertyCloneX86 : sharedPropertyCloneJS;
    }

    RecordInitializer.prototype.initialize = function (
            address, type, size, word0, word1, word2, word3) {
        if (this.compiled.backend === "i386") {
            return this.compiled.fn(this.heap.memory.nativeAddress(0), address,
                type, size, word0 || 0, word1 || 0, word2 || 0, word3 || 0);
        }
        return this.compiled.fn(this.heap.memory, 0, address, type, size,
            word0 || 0, word1 || 0, word2 || 0, word3 || 0);
    };

    RecordInitializer.prototype.cloneEnumerableProperties = function (
            sourceProperty, targetObject, block, blockBytes, propertyCount) {
        return this.cloneProperties(sourceProperty, targetObject, block,
                                    blockBytes, propertyCount, 1);
    };

    RecordInitializer.prototype.cloneProperties = function (
            sourceProperty, targetObject, block, blockBytes, propertyCount,
            enumerableOnly) {
        if (this.propertyCloneCompiled.backend === "i386") {
            return this.propertyCloneCompiled.fn(
                this.heap.memory.nativeAddress(0), sourceProperty,
                targetObject, block, blockBytes, propertyCount,
                enumerableOnly ? 1 : 0);
        }
        return this.propertyCloneCompiled.fn(this.heap.memory, 0,
            sourceProperty, targetObject, block, blockBytes, propertyCount,
            enumerableOnly ? 1 : 0);
    };

    root.GuestVMRecordInitializer = RecordInitializer;
    if (typeof module !== "undefined" && module.exports) module.exports = RecordInitializer;
}(this));
