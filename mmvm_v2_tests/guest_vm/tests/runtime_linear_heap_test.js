(function (root) {
    function runRuntimeLinearHeapTest(VM) {
        /* This remains a deliberately small, fixed-capacity heap.  Do not tie
         * the isolation test to the exact byte footprint of the standard
         * library installed before the test's own allocations. */
        /* Own ES5.1 length descriptors on built-in functions are part of the
         * bootstrap now. Leave room for the standard library while keeping
         * the isolation check bounded; neither heap may grow past this cap. */
        var heapBytes = 64 * 1024;
        var first = new VM.JSRuntime({heapBytes: heapBytes});
        var second = new VM.JSRuntime({heapBytes: heapBytes});
        try {
            var firstHeap = first.runtime.ensureLinearHeap();
            var secondHeap = second.runtime.ensureLinearHeap();
            var firstCell = first.runtime.valueCells.allocate();
            var secondCell = second.runtime.valueCells.allocate();
            if (firstCell !== secondCell) {
                throw new Error("runtime heap offsets should be deterministic");
            }
            first.runtime.valueCells.writePrimitive(firstCell, Math.PI);
            second.runtime.valueCells.writePrimitive(secondCell, -2.75);
            if (first.runtime.valueCells.readPrimitive(firstCell) !== Math.PI ||
                second.runtime.valueCells.readPrimitive(secondCell) !== -2.75) {
                throw new Error("runtime-owned value-cell heaps alias");
            }
            if (firstHeap.memory.allocation === secondHeap.memory.allocation) {
                throw new Error("runtimes share a host-memory allocation");
            }
            var firstObject = first.runtime.heapRecords.allocateObject(0);
            var secondObject = second.runtime.heapRecords.allocateObject(0);
            if (firstObject !== secondObject ||
                first.runtime.heapRecords === second.runtime.heapRecords) {
                throw new Error("runtime-owned record accessors are not isolated");
            }
            return "JSRuntime-owned value-cell heaps are isolated on " +
                   firstHeap.memory.host.hostName();
        } finally {
            first.destroy();
            second.destroy();
        }
    }

    root.GuestVMRunRuntimeLinearHeapTest = runRuntimeLinearHeapTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runRuntimeLinearHeapTest;
    }
}(this));
