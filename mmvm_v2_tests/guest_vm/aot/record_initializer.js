/* Shared-IR bulk initializer for the common header plus four payload words. */
(function (root) {
    var Compiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    var Records = root.GuestVMHeapRecords;
    if (typeof module !== "undefined" && module.exports) {
        Compiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
        Records = require("../heap_records.js");
    }

    var sharedJS = null;
    var sharedX86 = null;
    var sharedPropertyCloneJS = null;
    var sharedPropertyCloneX86 = null;
    var HEAP_TYPE_PROPERTY = Records.KernelConstants.HEAP_TYPE_PROPERTY;
    var PROPERTY_RECORD_BYTES = Records.KernelConstants.PROPERTY_RECORD_BYTES;
    var PROPERTY_ENUMERABLE = Records.Attributes.ENUMERABLE;

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
        var source = sourceProperty;
        var previous = 0;
        var first = 0;
        var index = 0;
        while (source !== 0) {
            var attributes = propertyAttributes(base, source);
            var cloneProperty = 0;
            if (enumerableOnly === 0) cloneProperty = 1;
            else if ((attributes & PROPERTY_ENUMERABLE) !== 0) {
                cloneProperty = 1;
            }
            if (cloneProperty === 1) {
                var clone = block + index * PROPERTY_RECORD_BYTES;
                var size = PROPERTY_RECORD_BYTES;
                if (index + 1 === propertyCount) {
                    size = blockBytes - index * PROPERTY_RECORD_BYTES;
                }
                setRecordType(base, clone, HEAP_TYPE_PROPERTY);
                setRecordSize(base, clone, size);
                setRecordMark(base, clone, 0);
                setRecordFlags(base, clone, 0);
                setPropertyNext(base, clone, 0);
                setPropertyKey(base, clone, propertyKey(base, source));
                setPropertyAttributes(base, clone, attributes);
                setPropertySetter(base, clone, propertySetter(base, source));
                copyValueCell(propertyValueCellAddress(base, clone),
                              propertyValueCellAddress(base, source));
                if (first === 0) first = clone;
                if (previous !== 0) {
                    setPropertyNext(base, previous, clone);
                }
                previous = clone;
                index = index + 1;
            }
            source = propertyNext(base, source);
        }
        setObjectPropertyHead(base, targetObject, first);
        return first;
    }

    function RecordInitializer(heap) {
        this.heap = heap;
        if (!sharedJS) {
            var ir = new Compiler().compile(initializerKernel);
            sharedJS = new JSBackend().compile(ir);
            sharedX86 = new X86Backend().compile(ir);
            var cloneIR = new Compiler().compile(propertyCloneKernel,
                {constantBindings: Records.KernelConstants});
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
