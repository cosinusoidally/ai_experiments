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
            first.writeFieldU32(object, 4, 0xffffffff, Heap.Types.OBJECT);
            if (first.readFieldU32(object, 4, Heap.Types.OBJECT) !== 0xffffffff) {
                throw new Error("high-bit 32-bit field access failed");
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
            /* Exercise the same scalar-memory contract on sparse and native
             * storage, including unaligned words and ToInt32 edge values. */
            var wordValues = [0, 0x80000000, 0xffffffff, 4294967297,
                              -1.75, Infinity, NaN];
            var wordAddress = object + Heap.HEADER_SIZE + 1, index;
            for (index = 0; index < wordValues.length; index++) {
                var expected = wordValues[index] >>> 0;
                first.memory.writeU32(wordAddress, wordValues[index]);
                if (first.memory.readU32(wordAddress) !== expected ||
                    first.memory.readU8(wordAddress) !== (expected & 255)) {
                    throw new Error("checked scalar-memory word contract failed");
                }
                first.memory.writeU32Trusted(wordAddress, wordValues[index]);
                if (first.memory.readU32Trusted(wordAddress) !== expected) {
                    throw new Error("trusted scalar-memory word contract failed");
                }
            }
            first.memory.writeWords32LE(wordAddress, [17, -17, 42]);
            if (first.memory.readU32(wordAddress) !== 17 ||
                first.memory.readU32(wordAddress + Heap.WORD_BYTES) !== (-17 >>> 0) ||
                first.memory.readU32(wordAddress + 2 * Heap.WORD_BYTES) !== 42) {
                throw new Error("bulk scalar-memory ingress failed");
            }
            var observedReads = 0;
            var accessorWords = [7, 0];
            var readAccessorWord = function () {
                observedReads++;
                return -9;
            };
            if (Object.defineProperty) {
                Object.defineProperty(accessorWords, "1", {get: readAccessorWord});
            } else accessorWords.__defineGetter__("1", readAccessorWord);
            if (first.memory.allocation.isNative &&
                typeof __guestVMTryCopyInt32Array === "function") {
                var copied = __guestVMTryCopyInt32Array(
                    first.memory.nativeAddress(wordAddress) | 0, accessorWords);
                if (copied || observedReads || first.memory.readU32(wordAddress) !== 17) {
                    throw new Error("declined bulk ingress made observable changes");
                }
            }
            first.memory.writeWords32LE(wordAddress, accessorWords);
            if (observedReads !== 1 ||
                first.memory.readU32(wordAddress) !== 7 ||
                first.memory.readU32(wordAddress + Heap.WORD_BYTES) !== (-9 >>> 0)) {
                throw new Error("bulk ingress fallback changed observable reads: count=" +
                    observedReads + " first=" + first.memory.readU32(wordAddress) +
                    " second=" + first.memory.readU32(wordAddress + Heap.WORD_BYTES));
            }
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
