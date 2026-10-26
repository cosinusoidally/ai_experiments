(function (root) {
    function runHeapRecordsTest(Heap, ValueCells, Records, Sweeper) {
        var heap = new Heap({heapBytes: 65536, collectorWorkspace: true});
        var cells = new ValueCells(heap);
        var records = new Records(heap, cells);
        try {
            var key = records.allocateString("answer");
            var stringSamples = ["", "a", "abc", "\u0000\u007f\u0080\u00ff",
                "\u0000\u00ff\u0100\ud800\udfff\uffff", "\ud800x\udfff"];
            var largeMixedString = "";
            for (var mixedIndex = 0; mixedIndex < 100; mixedIndex++) {
                largeMixedString += "\u00ff\u0100\ud800\udfff";
            }
            stringSamples.push(largeMixedString);
            var sampleIndex = 0;
            while (sampleIndex < stringSamples.length) {
                var sample = stringSamples[sampleIndex++];
                if (records.readString(records.allocateString(sample)) !== sample) {
                    throw new Error("heap string code-unit roundtrip failed");
                }
                var backing = records.allocateString("[" + sample + "]");
                var preparedBacking = records.prepareFlatStringSearch(backing);
                var preparedSample = records.prepareFlatStringSearch(
                    records.allocateString(sample));
                var expectedStart = sample.length ? 1 : 0;
                if (records.findPreparedFlatString(preparedBacking, preparedSample) !==
                        expectedStart ||
                        records.findPreparedFlatString(preparedBacking, preparedSample) !==
                        expectedStart) {
                    throw new Error("prepared flat string search failed");
                }
                var slice = records.allocateStringSlice(backing, 1, sample.length);
                var nestedSlice = records.allocateStringSlice(slice, 0,
                    sample.length ? sample.length - 1 : 0);
                if (records.readString(slice) !== sample ||
                        records.readString(nestedSlice) !==
                            sample.substring(0, sample.length ? sample.length - 1 : 0)) {
                    throw new Error("heap string slice roundtrip failed");
                }
                if (records.stringHash(slice) !==
                        records.stringHash(records.allocateString(sample))) {
                    throw new Error("string hash depends on backing representation");
                }
            }
            if (records.readString(key) !== "answer" ||
                records.stringLength(key) !== 6 || !records.stringHash(key)) {
                throw new Error("heap string layout failed");
            }
            var sharedBacking = records.allocateString("[answer]");
            if (records.flatStringIndexOf(sharedBacking, key) !== 1) {
                throw new Error("flat string backing search failed");
            }
            records.shareStringBackingInPlace(key, sharedBacking, 1);
            var sharedReference = 0;
            records.visitReferences(key, function (target) { sharedReference = target; });
            if (records.readString(key) !== "answer" ||
                    sharedReference !== sharedBacking) {
                throw new Error("shared string backing value/GC edge failed");
            }
            var sharedText = "a longer string with retired character storage";
            var sharedFlat = records.allocateString(sharedText);
            var sharedOwner = records.allocateString("[" + sharedText + "]");
            var oldSize = heap.recordSize(sharedFlat);
            records.shareStringBackingInPlace(sharedFlat, sharedOwner, 1);
            if (records.readString(sharedFlat) !== sharedText ||
                    heap.recordSize(sharedFlat) !== oldSize) {
                throw new Error("large backing sharing changed value/allocation");
            }
            var retiredOffset = Records.KernelConstants.STRING_SLICE_RECORD_BYTES;
            while (retiredOffset < oldSize) {
                if (heap.memory.readU8(sharedFlat + retiredOffset++) !== 0) {
                    throw new Error("retired string characters were not cleared");
                }
            }

            var object = records.allocateObject(0);
            var property = records.defineOwnPropertyEntry(object, key);
            cells.writePrimitiveAt(records.ownPropertyEntryValueCell(object, property), 42);
            var found = records.findOwnPropertyEntry(object, "answer");
            if (found !== property ||
                cells.readPrimitiveAt(records.ownPropertyEntryValueCell(object, found)) !== 42) {
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
            /* Storage semantics, not a particular allocation/index policy:
             * update retains position; deletion/reinsertion moves to the end;
             * growth/compaction preserve surviving values and order. */
            var storage = records.allocatePropertyStorage(2);
            var thirdKey = records.allocateString("third");
            var firstKey = records.allocateString("first");
            var secondKey = records.allocateString("second");
            var thirdEntry = records.definePropertyStorageEntry(storage, thirdKey);
            var firstEntry = records.definePropertyStorageEntry(storage, firstKey);
            var deletedChild = records.allocateObject(0);
            cells.writePrimitiveAt(records.propertyStorageValueCell(storage, thirdEntry), 1.25);
            cells.writeReferenceAt(records.propertyStorageValueCell(storage, firstEntry), deletedChild);
            storage = records.growPropertyStorage(storage, 3);
            var packedChild = records.allocateObject(0);
            var secondEntry = records.definePropertyStorageEntry(storage, secondKey);
            cells.writeReferenceAt(records.propertyStorageValueCell(storage, secondEntry), packedChild);
            if (records.definePropertyStorageEntry(storage, firstKey) !== firstEntry ||
                    records.propertyStorageLength(storage) !== 3) {
                throw new Error("property update changed insertion position");
            }
            records.deletePropertyStorageEntry(storage, firstEntry);
            storage = records.growPropertyStorage(storage, 4);
            var recreated = records.definePropertyStorageEntry(storage, firstKey);
            if (recreated <= secondEntry) throw new Error("recreated property did not append");
            var packedSetter = records.allocateFunction(false, 0, 0, 0);
            records.updatePropertyStorageDescriptor(storage, recreated,
                Records.Attributes.ACCESSOR | Records.Attributes.CONFIGURABLE, packedSetter);
            storage = records.compactPropertyStorage(storage);
            storage = records.growPropertyStorage(storage, 5);
            records.definePropertyStorageEntry(storage, records.allocateString("10"));
            records.definePropertyStorageEntry(storage, records.allocateString("2"));
            var keys = records.propertyStorageKeys(storage, false);
            var enumerableKeys = records.propertyStorageKeys(storage, true);
            if (records.vectorLength(keys) !== 5 || records.vectorLength(enumerableKeys) !== 4 ||
                    records.readString(cells.readReferenceAt(records.vectorCell(keys, 0))) !== "third" ||
                    records.readString(cells.readReferenceAt(records.vectorCell(keys, 1))) !== "second" ||
                    records.readString(cells.readReferenceAt(records.vectorCell(keys, 2))) !== "first" ||
                    records.readString(cells.readReferenceAt(records.vectorCell(keys, 3))) !== "10" ||
                    records.readString(cells.readReferenceAt(records.vectorCell(keys, 4))) !== "2" ||
                    cells.readPrimitiveAt(records.propertyStorageValueCell(storage, 1)) !== 1.25) {
                throw new Error("packed property order/value/attributes changed");
            }
            var holder = records.allocateObject(0);
            var storageProperty = records.defineOwnPropertyEntry(holder, records.allocateString("storage"));
            cells.writeReferenceAt(records.ownPropertyEntryValueCell(holder, storageProperty), storage);
            records.allocateContext(holder);
            var marker = new Sweeper(heap), markGeneration = 1;
            if (marker.mark(markGeneration) < 0 || heap.mark(storage) !== markGeneration ||
                    heap.mark(packedChild) !== markGeneration ||
                    heap.mark(packedSetter) !== markGeneration ||
                    heap.mark(deletedChild) === markGeneration) {
                throw new Error("packed property collector retained/lost an entry incorrectly");
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
