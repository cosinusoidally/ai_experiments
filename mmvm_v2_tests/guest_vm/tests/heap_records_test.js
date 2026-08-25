(function (root) {
    function runHeapRecordsTest(Heap, ValueCells, Records) {
        var heap = new Heap({heapBytes: 65536});
        var cells = new ValueCells(heap);
        var records = new Records(heap, cells);
        try {
            var key = records.allocateString("answer");
            if (records.readString(key) !== "answer" ||
                records.stringLength(key) !== 6 || !records.stringHash(key)) {
                throw new Error("heap string layout failed");
            }

            var object = records.allocateObject(0);
            var property = records.defineOwnProperty(object, key);
            cells.writePrimitiveAt(records.propertyValueCell(property), 42);
            var found = records.findOwnProperty(object, "answer");
            if (found !== property ||
                cells.readPrimitiveAt(records.propertyValueCell(found)) !== 42) {
                throw new Error("heap object/property layout failed");
            }

            var array = records.allocateArray(0, 3);
            var elements = records.arrayElements(array);
            records.setVectorLength(elements, 3);
            cells.writePrimitiveAt(records.arrayElementCell(array, 0), 7);
            cells.writeReferenceAt(records.arrayElementCell(array, 1), object);
            cells.writePrimitiveAt(records.arrayElementCell(array, 2), Math.PI);
            if (records.arrayLength(array) !== 3 ||
                cells.readPrimitiveAt(records.arrayElementCell(array, 0)) !== 7 ||
                cells.readReferenceAt(records.arrayElementCell(array, 1),
                                      Heap.Types.OBJECT) !== object ||
                cells.readPrimitiveAt(records.arrayElementCell(array, 2)) !== Math.PI) {
                throw new Error("heap array/value-vector layout failed");
            }

            var outer = records.allocateEnvironment(0, 1);
            var inner = records.allocateEnvironment(outer, 2);
            cells.writeReferenceAt(records.environmentCell(outer, 0), object);
            cells.writePrimitiveAt(records.environmentCell(inner, 1), -3.5);
            if (records.environmentParent(inner) !== outer ||
                cells.readReferenceAt(records.environmentCell(outer, 0),
                                      Heap.Types.OBJECT) !== object ||
                cells.readPrimitiveAt(records.environmentCell(inner, 1)) !== -3.5) {
                throw new Error("heap environment layout failed");
            }

            var fn = records.allocateFunction(false, object, inner, 17);
            if (records.functionClosure(fn) !== inner) {
                throw new Error("heap function layout failed");
            }
            var frame = records.allocateFrame(0, inner, 0, -1, 2);
            records.setFramePC(frame, 29);
            cells.writeReferenceAt(records.frameRegisterCell(frame, 0), fn);
            cells.writePrimitiveAt(records.frameRegisterCell(frame, 1), 1.25);
            if (records.framePC(frame) !== 29 ||
                cells.readReferenceAt(records.frameRegisterCell(frame, 0),
                                      Heap.Types.BYTECODE_FUNCTION) !== fn ||
                cells.readPrimitiveAt(records.frameRegisterCell(frame, 1)) !== 1.25) {
                throw new Error("heap frame/register layout failed");
            }
            return "authoritative heap record layouts passed on " +
                   heap.memory.host.hostName();
        } finally {
            heap.destroy();
        }
    }

    root.GuestVMRunHeapRecordsTest = runHeapRecordsTest;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = runHeapRecordsTest;
    }
}(this));
