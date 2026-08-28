/* Shared kernel-dialect heap sweep. Marking establishes reachability; this
 * pass turns every remaining unmarked record into a normal free record. */
(function (root) {
    var KernelCompiler = root.GuestVMKernelCompiler;
    var JSBackend = root.GuestVMKernelJSBackend;
    var X86Backend = root.GuestVMKernelX86Backend;
    if (typeof module !== "undefined" && module.exports) {
        KernelCompiler = require("./kernel_compiler.js");
        JSBackend = require("./backend_js.js");
        X86Backend = require("./backend_x86.js");
    }

    var sharedJS = null;
    var sharedX86 = null;

    function sweepKernel(heapBase, heapBump, generation) {
        var HEAP_FIRST_RECORD = 64;
        var HEAP_TYPE_FREE = 0;
        var RECORD_TYPE = 0;
        var RECORD_SIZE = 4;
        var RECORD_MARK = 8;
        var RECORD_FLAGS = 12;
        var address = HEAP_FIRST_RECORD;
        var reclaimedBytes = 0;
        while (address < heapBump) {
            var type = recordType(heapBase, address);
            var size = recordSize(heapBase, address);
            if (type !== HEAP_TYPE_FREE) {
                if (recordMark(heapBase, address) !== generation) {
                    setRecordType(heapBase, address, HEAP_TYPE_FREE);
                    setRecordMark(heapBase, address, 0);
                    setRecordFlags(heapBase, address, 0);
                    reclaimedBytes = reclaimedBytes + size;
                }
            }
            address = address + size;
        }
        return reclaimedBytes;
    }

    function HeapSweeper(heap) {
        if (!sharedJS) {
            var ir = new KernelCompiler().compile(sweepKernel, {
                registerPreferences: ["heapBase", "heapBump", "address"]
            });
            sharedJS = new JSBackend().compile(ir);
            sharedX86 = new X86Backend().compile(ir);
        }
        this.heap = heap;
        this.compiled = heap.memory.nativeAddress(0) && sharedX86.fn ?
                        sharedX86 : sharedJS;
    }

    HeapSweeper.prototype.sweep = function (generation) {
        if (this.compiled.backend === "i386") {
            return this.compiled.fn(this.heap.memory.nativeAddress(0),
                                    this.heap.bump, generation) >>> 0;
        }
        return this.compiled.fn(this.heap.memory, 0,
                                this.heap.bump, generation) >>> 0;
    };

    root.GuestVMHeapSweeper = HeapSweeper;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = HeapSweeper;
    }
}(this));
