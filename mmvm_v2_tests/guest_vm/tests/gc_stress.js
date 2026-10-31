/* Run from mmvm_v2_tests with node or js_min.exe. No npm/Python dependencies.
 * The guest heap is capped at 8 MiB; compilation uses the host's own heap. */
(function (shellArguments) {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var VM, Heap, Cells, RecordLayouts, NativeIntrinsics, source, output;
    if (nodeHost) {
        VM = require("../vm.js");
        Heap = require("../heap.js");
        Cells = require("../value_cell.js");
        RecordLayouts = require("../heap_records.js");
        NativeIntrinsics = require("../native_intrinsics.js");
        source = require("fs").readFileSync(
            require("path").join(__dirname, "gc_stress_workload.js"), "utf8");
        output = function (text) { console.log(text); };
    } else {
        load("guest_vm/guest_vm.js");
        VM = GuestVM;
        Heap = GuestVMHeap;
        Cells = GuestVMValueCells;
        RecordLayouts = GuestVMHeapRecords;
        NativeIntrinsics = GuestVMNativeIntrinsics;
        source = read("guest_vm/tests/gc_stress_workload.js");
        output = print;
    }
    var heapCap = 8 * 1024 * 1024;
    var diagnosticArguments = nodeHost ? process.argv.slice(2) : shellArguments;
    var trace = false;
    for (var option = 0; option < diagnosticArguments.length; option++) {
        if (diagnosticArguments[option] === "--trace-host-calls") trace = true;
        else throw new Error("unknown GC stress option: " + diagnosticArguments[option]);
    }
    var constructionStarted = new Date().getTime();
    output("GC structural checks: constructing runtime");
    var vm = new VM({nativeInterpreter: true, verifyNativeHeap: true, logHostCalls: trace,
        compactProgramStorage: true,
        heapBytes: 512 * 1024, maxHeapBytes: heapCap, gcThreshold: 256});
    output("GC structural checks: runtime constructed in " +
        (new Date().getTime() - constructionStarted) + " ms");
    var audits = 0, edges = 0, indexAudits = 0, maximumBump = 0;
    var started = new Date().getTime();

    function checkEngineLinks() {
        var heap = vm.runtime.linearHeap, records = vm.runtime.heapRecords;
        var engine = vm.runtime.nativeInterpreter;
        if (records.enginePlatformServices(engine.stateAddress) !==
                engine.platformServicesAddress ||
                heap.recordType(engine.platformServicesAddress) !== Heap.Types.PLATFORM_SERVICES) {
            throw new Error("GC stress: engine platform-services link was corrupted: expected " +
                engine.platformServicesAddress + ", found " +
                records.enginePlatformServices(engine.stateAddress));
        }
        if (records.engineGCNativeFunctionHead(engine.stateAddress) !==
                vm.runtime.nativeCallbackRootHead) {
            throw new Error("GC stress: native callback root lists disagree");
        }
    }
    function auditHeap() {
        var heap = vm.runtime.linearHeap, records = vm.runtime.heapRecords;
        checkEngineLinks();
        var boundFunctions = 0;
        var boundaries = {}, position = Heap.FIRST_RECORD;
        var freeCount = 0, freeIndex = {}, index;
        while (position < heap.bump) {
            var header = heap.inspectRecordHeader(position);
            if (header.type < Heap.Types.FREE || header.type > Heap.LastRecordType) {
                throw new Error("GC stress: invalid record type at " + position);
            }
            boundaries["$" + position] = header.type + 1;
            if (header.type === Heap.Types.FREE && header.flags === 0) freeCount++;
            if (header.type === Heap.Types.VALUE_VECTOR) {
                var length = records.vectorLength(position);
                var capacity = records.vectorCapacity(position);
                if (length > capacity || records.vectorCellsAddress(position) +
                        capacity * Cells.PAYLOAD_BYTES > position + header.size) {
                    throw new Error("GC stress: corrupt vector bounds at " + position);
                }
            }
            if (header.type === Heap.Types.PROPERTY_INDEX) {
                indexAudits++;
                var indexCapacity = records.propertyIndexCapacity(position);
                var indexCount = records.propertyIndexCount(position);
                if (!indexCapacity || (indexCapacity & (indexCapacity - 1)) ||
                        indexCount * 2 > indexCapacity ||
                        RecordLayouts.KernelConstants.PROPERTY_INDEX_RECORD_BYTES +
                            indexCapacity * Heap.WORD_BYTES > header.size) {
                    throw new Error("GC stress: corrupt property-index bounds at " + position);
                }
            }
            if (header.type === Heap.Types.PROPERTY_STORAGE) {
                var packedLength = records.propertyStorageLength(position);
                var packedCapacity = records.propertyStorageCapacity(position);
                if (packedLength > packedCapacity ||
                        records.propertyStorageLiveCount(position) > packedLength ||
                        Heap.HEADER_SIZE + RecordLayouts.PropertyStorageLayout.ENTRIES +
                            packedCapacity * RecordLayouts.PropertyStorageLayout.ENTRY_BYTES > header.size) {
                    throw new Error("GC stress: corrupt packed property storage at " + position);
                }
            }
            position += header.size;
        }
        if (position !== heap.bump || heap.bump > heapCap) {
            throw new Error("GC stress: corrupt heap boundary/cap");
        }
        position = Heap.FIRST_RECORD;
        while (position < heap.bump) {
            var live = heap.inspectRecordHeader(position);
            if (live.type !== Heap.Types.FREE) {
                if (live.type === Heap.Types.ENVIRONMENT) {
                    var scopeFlags = heap.flags(position);
                    var scopeData = records.environmentScopeData(position);
                    if (scopeFlags & RecordLayouts.EnvironmentFlags.SINGLE_BINDING) {
                        if (records.environmentSlotCount(position) !== 1 ||
                                boundaries["$" + scopeData] !== Heap.Types.STRING + 1 ||
                                records.environmentObject(position)) {
                            throw new Error("GC stress: invalid catch environment at " + position);
                        }
                    } else if (scopeFlags & RecordLayouts.EnvironmentFlags.DETACHED_ARGUMENTS) {
                        if (boundaries["$" + scopeData] !== Heap.Types.INTEGER_VECTOR + 1 ||
                                records.environmentObject(position)) {
                            throw new Error("GC stress: invalid arguments-map environment at " + position);
                        }
                    }
                }
                if (live.type === Heap.Types.OBJECT) {
                    var backing = records.ownPropertyStorage(position);
                    if (backing && boundaries["$" + backing] !== Heap.Types.PROPERTY_STORAGE + 1) {
                        throw new Error("GC stress: ordinary object has non-packed properties at " + position);
                    }
                }
                records.visitReferences(position, function (target) {
                    var type = boundaries["$" + target];
                    if (!type || type === Heap.Types.FREE + 1) {
                        throw new Error("GC stress: dangling/interior edge from " +
                            position + " to " + target);
                    }
                    edges++;
                });
                if (live.type === Heap.Types.PROPERTY_INDEX) {
                    var occupied = 0, bucket = 0;
                    while (bucket < records.propertyIndexCapacity(position)) {
                        var entry = records.propertyIndexSlot(position, bucket++);
                        if (entry) {
                            occupied++;
                            var storage = records.propertyIndexStorage(position);
                            if (boundaries["$" + storage] !== Heap.Types.PROPERTY_STORAGE + 1 ||
                                    entry > records.propertyStorageLength(storage) ||
                                    !records.propertyStorageKey(storage, entry)) {
                                throw new Error("GC stress: invalid property-index entry ID at " +
                                    position + " (storage " + storage + ", entry " + entry + ")");
                            }
                        }
                    }
                    if (occupied !== records.propertyIndexCount(position)) {
                        throw new Error("GC stress: property-index occupancy mismatch at " + position);
                    }
                }
                if (live.type === Heap.Types.PROPERTY_STORAGE) {
                    var packedLive = 0, packedEntry = 1;
                    while (packedEntry <= records.propertyStorageLength(position)) {
                        if (records.propertyStorageKey(position, packedEntry++)) packedLive++;
                    }
                    if (packedLive !== records.propertyStorageLiveCount(position)) {
                        throw new Error("GC stress: packed live-count mismatch at " + position);
                    }
                }
            }
            if (live.type === Heap.Types.NATIVE_FUNCTION &&
                    records.functionMetadata(position) === NativeIntrinsics.BOUND_FUNCTION) {
                boundFunctions++;
            }
            position += live.size;
        }
        for (index = 0; index < heap.freeBlocks.length; index++) {
            var address = heap.freeBlocks[index], key = "$" + address;
            if (freeIndex[key] || boundaries[key] !== Heap.Types.FREE + 1) {
                throw new Error("GC stress: invalid/duplicate free-list entry " + address);
            }
            freeIndex[key] = true;
        }
        if (freeCount !== heap.freeBlocks.length) {
            throw new Error("GC stress: free-list/header count mismatch");
        }
        if (heap.bump > maximumBump) maximumBump = heap.bump;
        audits++;
        if (trace) output("GC structural audit " + audits + "; elapsed " +
            (new Date().getTime() - started) + " ms; edges " + edges);
        return boundFunctions;
    }
    try {
        vm.installGlobal("__gcStressCheckpoint", vm.makeNativeFunction(
            "gcStressCheckpoint", function () {
                checkEngineLinks();
                vm.collect();
                auditHeap();
            }));
        auditHeap();
        vm.run(source, "guest_vm/tests/gc_stress_workload.js");
        vm.collect();
        if (auditHeap() !== 0) throw new Error("GC stress: discarded bound functions remain rooted");
        output("GC structural checks passed: audits=" + audits + ", edges=" + edges +
            ", property-index audits=" + indexAudits +
            ", embedding collections=" + vm.runtime.collectionCount +
            ", maximum observed bump=" + maximumBump + ", guest heap cap=" + heapCap +
            ", workload/check time=" + (new Date().getTime() - started) + " ms");
    } finally { vm.destroy(); }
}(typeof arguments === "undefined" ? [] : arguments));
