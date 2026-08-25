(function (root) {
    function runHeapAccessTest(Heap) {
        var first = new Heap({heapBytes: 4096});
        var second = new Heap({heapBytes: 4096});
        try {
            var object = first.allocateRecord(Heap.Types.OBJECT, 16);
            var otherObject = second.allocateRecord(Heap.Types.OBJECT, 16);
            if (object !== otherObject) throw new Error("heap test expected deterministic offsets");
            first.writeFieldU32(object, 0, 0x12345678, Heap.Types.OBJECT);
            second.writeFieldU32(otherObject, 0, 0x76543210, Heap.Types.OBJECT);
            if (first.readFieldU32(object, 0, Heap.Types.OBJECT) !== 0x12345678) {
                throw new Error("first heap field access failed");
            }
            if (second.readFieldU32(otherObject, 0, Heap.Types.OBJECT) !== 0x76543210) {
                throw new Error("runtime heaps are not isolated");
            }
            first.writeFieldU8(object, 7, 211, Heap.Types.OBJECT);
            if (first.readFieldU8(object, 7, Heap.Types.OBJECT) !== 211) {
                throw new Error("byte field accessor failed");
            }
            first.setMark(object, 37);
            first.setFlags(object, 9);
            if (first.mark(object) !== 37 || first.flags(object) !== 9) {
                throw new Error("header accessor failed");
            }
            var rejected = false;
            try { first.readFieldU32(object, 16, Heap.Types.OBJECT); }
            catch (error) { rejected = true; }
            if (!rejected) throw new Error("out-of-record field access was accepted");
            rejected = false;
            try { first.readFieldU32(object, 0, Heap.Types.ARRAY); }
            catch (wrongTypeError) { rejected = true; }
            if (!rejected) throw new Error("wrong record type was accepted");
            return "linear heap access and runtime isolation passed on " +
                   first.memory.host.hostName();
        } finally {
            first.destroy();
            second.destroy();
        }
    }

    root.GuestVMRunHeapAccessTest = runHeapAccessTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runHeapAccessTest;
    }
}(this));
