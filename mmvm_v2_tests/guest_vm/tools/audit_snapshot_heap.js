/* Compare the snapshot's reachable heap with the kernel collector.
 * Run from mmvm_v2_tests with Node or js_min, passing a standalone snapshot.
 * This is diagnostic tooling, not a language-feature test. */
(function (shellArguments) {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var Heap, Cells, Records, Sweeper, Compiler, Backend, FFI;
    var args, output;
    if (nodeHost) {
        Heap = require("../heap.js");
        Cells = require("../value_cell.js");
        Records = require("../heap_records.js");
        Sweeper = require("../aot/heap_sweeper.js");
        Compiler = require("../aot/kernel_compiler.js");
        Backend = require("../aot/backend_js.js");
        args = process.argv.slice(2);
        output = function (message) { console.log(message); };
    } else {
        load("guest_vm/guest_vm.js");
        Heap = GuestVMHeap;
        Cells = GuestVMValueCells;
        Records = GuestVMHeapRecords;
        Sweeper = GuestVMHeapSweeper;
        Compiler = GuestVMKernelCompiler;
        Backend = GuestVMKernelX86Backend;
        FFI = GuestVMHostFFI;
        args = shellArguments;
        output = print;
    }
    var statisticsOnly = args[0] === "--heap-stats";
    if (statisticsOnly) args = args.slice(1);
    if (!args.length) {
        throw new Error("usage: audit_snapshot_heap.js snapshot | " +
                        "--heap-stats raw-heap-dump");
    }
    var header, file, ffi, descriptor;
    if (nodeHost) {
        file = require("fs").readFileSync(args[0]);
        header = function (offset) { return file.readUInt32LE(offset); };
    } else {
        ffi = new FFI();
        descriptor = ffi.call(ffi.resolve("open"), [args[0], 0]);
        if (descriptor < 0) throw new Error("cannot open snapshot");
        var headerPointer = ffi.call(ffi.resolve("calloc"), [128, 1]);
        if (ffi.call(ffi.resolve("read"),
                [descriptor, headerPointer, 128]) !== 128) {
            throw new Error("truncated snapshot header");
        }
        header = function (offset) {
            return ffi.peek32(headerPointer + offset) >>> 0;
        };
    }
    var heapOffset = statisticsOnly ? 0 : header(28);
    var heapLength = statisticsOnly ? (nodeHost ? file.length :
        ffi.call(ffi.resolve("lseek"), [descriptor, 0, 2])) : header(32);
    if (statisticsOnly && nodeHost) {
        /* Inspect a debugger dump without expanding its bytes into the Node
         * emulated heap. Header interpretation still belongs to Heap. */
        var inspectionHeap = new Heap({heapBytes: 4096});
        inspectionHeap.memory.destroy();
        function inspectionWord(offset) {
            return file.readUInt32LE(offset);
        }
        inspectionHeap.memory = {
            readU32: inspectionWord,
            readU32Trusted: inspectionWord,
            byteLength: heapLength,
            destroy: function () {}
        };
        inspectionHeap.bump = heapLength;
        reportStatistics(inspectionHeap);
        inspectionHeap.destroy();
        return;
    }
    var heap = new Heap({heapBytes: heapLength + 1048576,
                         collectorWorkspace: true});
    if (nodeHost) {
        var copyOffset = 0;
        while (copyOffset < heapLength) {
            heap.memory.writeU32Trusted(copyOffset,
                file.readUInt32LE(heapOffset + copyOffset));
            copyOffset += 4;
        }
    } else {
        ffi.call(ffi.resolve("lseek"), [descriptor, heapOffset, 0]);
        var copied = 0;
        while (copied < heapLength) {
            var amount = ffi.call(ffi.resolve("read"),
                [descriptor, heap.memory.nativeAddress(copied),
                 heapLength - copied]);
            if (amount <= 0) throw new Error("truncated snapshot heap");
            copied += amount;
        }
        ffi.call(ffi.resolve("close"), [descriptor]);
        ffi.call(ffi.resolve("free"), [headerPointer]);
    }
    heap.bump = heapLength;
    if (statisticsOnly) {
        reportStatistics(heap);
        heap.destroy();
        return;
    }
    function reportStatistics(inspectedHeap) {
        var position = Heap.FIRST_RECORD;
        var totalLiveBytes = 0, totalFreeBytes = 0, protectedFreeBytes = 0;
        var largestFree = 0;
        var engineRecord = 0;
        var typeBytes = {}, typeCounts = {};
        while (position < inspectedHeap.bump) {
            var record = inspectedHeap.inspectRecordHeader(position);
            if (record.type === Heap.Types.ENGINE_STATE &&
                    record.size >= Heap.HEADER_SIZE +
                    Records.KernelConstants.ENGINE_GC_LIVE_BYTES + 4) {
                engineRecord = position;
            }
            if (record.type === Heap.Types.FREE) {
                totalFreeBytes += record.size;
                if (record.flags) protectedFreeBytes += record.size;
                else if (record.size > largestFree) largestFree = record.size;
            } else totalLiveBytes += record.size;
            typeBytes[record.type] = (typeBytes[record.type] || 0) + record.size;
            typeCounts[record.type] = (typeCounts[record.type] || 0) + 1;
            position += record.size;
        }
        output("heap bytes: " + inspectedHeap.bump + "; occupied: " +
            totalLiveBytes + "; free: " + totalFreeBytes +
            "; protected free: " + protectedFreeBytes +
            "; largest reusable region: " + largestFree);
        if (engineRecord) {
            var inspectionRecords = new Records(inspectedHeap, null);
            output("native GC: collections=" +
                inspectionRecords.engineGCCollections(engineRecord) +
                "; post-GC occupied=" +
                inspectionRecords.engineGCLiveBytes(engineRecord) +
                "; last phases (us): mark=" +
                inspectionRecords.engineGCMarkMicroseconds(engineRecord) +
                ", sweep=" +
                inspectionRecords.engineGCSweepMicroseconds(engineRecord) +
                ", index=" +
                inspectionRecords.engineGCIndexMicroseconds(engineRecord) +
                "; total=" +
                inspectionRecords.engineGCTotalMicroseconds(engineRecord) +
                "; maximum pause=" +
                inspectionRecords.engineGCMaximumPauseMicroseconds(engineRecord));
        }
        var name;
        for (name in Heap.Types) {
            if (Object.prototype.hasOwnProperty.call(Heap.Types, name)) {
                var type = Heap.Types[name];
                if (typeCounts[type]) output(name + ": " +
                    typeCounts[type] + " records, " + typeBytes[type] +
                    " bytes");
            }
        }
    }
    var records = new Records(heap, new Cells(heap));
    function recordKind(record) {
        return heap.inspectRecordHeader(record).type;
    }
    function recordBytes(record) {
        return heap.inspectRecordHeader(record).size;
    }
    function recordMark(record) {
        return heap.inspectRecordHeader(record).mark;
    }
    var state = 0;
    var address = Heap.FIRST_RECORD;
    var maximumMark = 0;
    while (address < heapLength) {
        if (recordKind(address) === Heap.Types.ENGINE_STATE) state = address;
        var mark = recordMark(address);
        if (mark > maximumMark) maximumMark = mark;
        address += recordBytes(address);
    }
    if (!state) throw new Error("snapshot has no engine state");
    var roots = [records.engineCurrentFrame(state),
        records.enginePlatformServices(state), records.engineGCRoot(state),
        records.engineGCContextHead(state),
        records.engineGCNativeFunctionHead(state), state,
        records.engineGCRootSlotHead(state)];
    var pending = roots.slice(0);
    var reachable = {};
    var reachableCount = 0;
    while (pending.length) {
        address = pending.pop();
        if (!address || reachable["$" + address]) continue;
        heap.requireRecord(address);
        reachable["$" + address] = true;
        reachableCount++;
        records.visitReferences(address, function (target) {
            pending.push(target);
        });
    }
    var generation = maximumMark + 1;
    var compiled = new Backend().compile(
        new Compiler().compileGraph(Sweeper.markKernel, {},
            {constantOverrides: Records.KernelConstants}));
    var parameters = [nodeHost ? 0 : heap.memory.nativeAddress(0),
        heapLength, heap.collectorStackBase, heap.byteLength, generation,
        roots[0], roots[1], 0, 0, 0, roots[2], roots[3], roots[4],
        roots[5], roots[6], 0];
    if (nodeHost) parameters.unshift(heap.memory);
    var result = compiled.fn.apply(null, parameters);
    if (result !== 0) throw new Error("marker failed: " + result);
    var missing = 0;
    address = Heap.FIRST_RECORD;
    while (address < heapLength) {
        if (reachable["$" + address] &&
                recordMark(address) !== generation) {
            output("unmarked reachable record " + address + " type " +
                   heap.recordType(address));
            missing++;
        }
        address += recordBytes(address);
    }
    output("heap audit: " + reachableCount + " reachable records, " +
           missing + " missing marks; backend " + compiled.backend);
    heap.destroy();
    if (missing) throw new Error("collector reachability mismatch");
}(typeof arguments !== "undefined" ? arguments : []));
