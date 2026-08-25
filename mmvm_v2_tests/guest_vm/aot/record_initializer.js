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

    function RecordInitializer(heap) {
        this.heap = heap;
        if (!sharedJS) {
            var ir = new Compiler().compile(initializerKernel);
            sharedJS = new JSBackend().compile(ir);
            sharedX86 = new X86Backend().compile(ir);
        }
        this.compiled = heap.memory.nativeAddress(0) && sharedX86.fn ?
                        sharedX86 : sharedJS;
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

    root.GuestVMRecordInitializer = RecordInitializer;
    if (typeof module !== "undefined" && module.exports) module.exports = RecordInitializer;
}(this));
