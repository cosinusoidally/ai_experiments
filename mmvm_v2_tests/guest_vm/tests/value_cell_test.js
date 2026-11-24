(function (root) {
    function runValueCellTest(Heap, ValueCells) {
        var heap = new Heap({heapBytes: 8192});
        var cells = new ValueCells(heap);
        try {
            var cell = cells.allocate();
            var values = [undefined, null, false, true, 0, -1, 2147483647,
                          -2147483648, -0, 1.5, -2.75, Math.PI, 4294967296,
                          Number.MAX_VALUE, Number.MIN_VALUE,
                          Infinity, -Infinity, NaN];
            var index = 0;
            while (index < values.length) {
                var expected = values[index++];
                cells.writePrimitive(cell, expected);
                var actual = cells.readPrimitive(cell);
                if (expected !== expected) {
                    if (actual === actual) throw new Error("NaN value-cell round trip failed");
                } else if (expected === 0 && 1 / expected < 0) {
                    if (actual !== 0 || 1 / actual >= 0) {
                        throw new Error("negative-zero value-cell round trip failed");
                    }
                } else if (actual !== expected) {
                    throw new Error("value-cell round trip failed for " + expected +
                                    ": got " + actual);
                }
            }
            var object = heap.allocateRecord(Heap.Types.OBJECT, 8);
            cells.writeReference(cell, object);
            if (cells.readReference(cell, Heap.Types.OBJECT) !== object) {
                throw new Error("heap-reference value-cell round trip failed");
            }
            var rejected = false;
            try { cells.readPrimitive(cell); } catch (error) { rejected = true; }
            if (!rejected) throw new Error("reference read as primitive");
            return "explicit non-NaN-boxed value cells passed on " +
                   heap.memory.host.hostName();
        } finally {
            heap.destroy();
        }
    }

    root.GuestVMRunValueCellTest = runValueCellTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runValueCellTest;
    }
}(this));
