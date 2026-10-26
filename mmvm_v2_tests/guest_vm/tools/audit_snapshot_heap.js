/* Inspect snapshots or compare their reachable heap with the kernel collector.
 * Run from mmvm_v2_tests with Node or js_min, passing a standalone snapshot.
 * This is diagnostic tooling, not a language-feature test. */
(function (shellArguments) {
    var nodeHost = typeof module !== "undefined" && module.exports;
    var Heap, Cells, Records, Sweeper, Compiler, Backend, FFI, Runtime;
    var args, output;
    var SnapshotBackend;
    if (nodeHost) {
        SnapshotBackend = require("../aot/backend_x86.js");
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
        SnapshotBackend = GuestVMKernelX86Backend;
        FFI = GuestVMHostFFI;
        args = shellArguments;
        output = print;
    }
    var inspectString = args[0] === "--string";
    var shareBackings = args[0] === "--share-backings";
    if (shareBackings) {
        args = args.slice(1);
        Runtime = nodeHost ? require("../runtime.js") : GuestVMRuntime;
    }
    var inspectSources = args[0] === "--sources";
    var inspectSharing = args[0] === "--string-sharing";
    var inspectMetadata = args[0] === "--metadata-sharing";
    var stringAddress = inspectString ? Number(args[1]) : 0;
    if (inspectString) args = args.slice(2);
    else if (inspectSources || inspectSharing || inspectMetadata) args = args.slice(1);
    var propertiesOnly = args[0] === "--heap-properties";
    var snapshotStatistics = args[0] === "--snapshot-stats";
    var statisticsOnly = args[0] === "--heap-stats" || propertiesOnly || snapshotStatistics;
    var rawHeap = statisticsOnly && !snapshotStatistics;
    if (statisticsOnly) args = args.slice(1);
    var inspectionOnly = statisticsOnly || inspectString || inspectSources || inspectSharing || inspectMetadata;
    if (!args.length) {
        throw new Error("usage: audit_snapshot_heap.js snapshot | " +
                        "--snapshot-stats snapshot | " +
                        "--sources snapshot | --string ADDRESS snapshot | " +
                        "--string-sharing snapshot | " +
                        "--share-backings snapshot | " +
                        "--metadata-sharing snapshot | " +
                        "--heap-stats raw-heap-dump | " +
                        "--heap-properties raw-heap-dump");
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
    var headerFields = SnapshotBackend.StandaloneHeaderFields;
    var legacyPacked = !rawHeap && header(headerFields.compilerVersion) ===
        Records.LegacyPackedPropertyLayout.compilerVersion;
    function inspectionRecordsFor(inspectedHeap, cells) {
        var result = new Records(inspectedHeap, cells);
        result.legacyBytecodeFlags = !rawHeap && header(headerFields.compilerVersion) <
            Records.BytecodeLayout.wideCountContract;
        if (legacyPacked) {
            /* ABI 51 placed alignment padding before the value cell.
             * Inspection must follow the image ABI, not the running VM ABI. */
            result.propertyStorageValueCell = function (storage, entry) {
                return this.heap.trustedPayloadAddress(storage,
                    this.propertyStorageEntryOffset(storage, entry) +
                    Records.LegacyPackedPropertyLayout.VALUE);
            };
        }
        return result;
    }
    var markerConstants = {};
    for (var constantName in Records.KernelConstants) {
        if (Object.prototype.hasOwnProperty.call(Records.KernelConstants, constantName)) {
            markerConstants[constantName] = Records.KernelConstants[constantName];
        }
    }
    if (legacyPacked) markerConstants.PROPERTY_STORAGE_VALUE =
        markerConstants.PROPERTY_STORAGE_KEY + Records.LegacyPackedPropertyLayout.VALUE;
    var heapOffset = rawHeap ? 0 : header(headerFields.heapOffset);
    var heapLength = rawHeap ? (nodeHost ? file.length :
        ffi.call(ffi.resolve("lseek"), [descriptor, 0, 2])) : header(headerFields.heapLength);
    if (inspectionOnly && nodeHost) {
        /* Inspect a debugger dump without expanding its bytes into the Node
         * emulated heap. Header interpretation still belongs to Heap. */
        var inspectionHeap = new Heap({heapBytes: 4096});
        inspectionHeap.memory.destroy();
        function inspectionWord(offset) {
            return file.readUInt32LE(heapOffset + offset);
        }
        inspectionHeap.memory = {
            readU32: inspectionWord,
            readU32Trusted: inspectionWord,
            readU16: function (offset) { return file.readUInt16LE(heapOffset + offset); },
            readU8: function (offset) { return file[heapOffset + offset]; },
            readU8Trusted: function (offset) { return file[heapOffset + offset]; },
            byteLength: heapLength,
            destroy: function () {}
        };
        inspectionHeap.bump = heapLength;
        if (inspectMetadata) reportMetadataSharing(inspectionHeap);
        else if (inspectSharing) reportStringSharing(inspectionHeap);
        else if (inspectString || inspectSources) reportSource(inspectionHeap);
        else if (propertiesOnly) reportProperties(inspectionHeap);
        else reportStatistics(inspectionHeap);
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
    if (shareBackings) {
        var recordsForSharing = inspectionRecordsFor(heap, new Cells(heap));
        var startSharing = new Date().getTime();
        var sharedCount = Runtime.prototype.shareSnapshotStringBackings.call({
            heapRecords: recordsForSharing, linearHeap: heap
        });
        output("shared backings in private inspection copy: " + sharedCount +
            "; milliseconds=" + (new Date().getTime() - startSharing));
        reportStringSharing(heap);
    }
    if (inspectionOnly) {
        if (inspectMetadata) reportMetadataSharing(heap);
        else if (inspectSharing) reportStringSharing(heap);
        else if (inspectString || inspectSources) reportSource(heap);
        else if (propertiesOnly) reportProperties(heap);
        else reportStatistics(heap);
        heap.destroy();
        return;
    }
    function reportSource(inspectedHeap) {
        var sourceRecords = inspectionRecordsFor(inspectedHeap, new Cells(inspectedHeap));
        function describeString(address) {
            inspectedHeap.requireRecord(address, Heap.Types.STRING);
            return "string " + address + " encoding=" +
                (sourceRecords.stringIsSlice(address) ? "slice" :
                 sourceRecords.stringIsRope(address) ? "rope" :
                    sourceRecords.stringIsLatin1(address) ? "latin1" : "utf16") +
                " codeUnits=" + sourceRecords.stringLength(address) +
                (sourceRecords.stringIsSlice(address) ?
                    " backing=" + sourceRecords.stringSliceBacking(address) +
                    " start=" + sourceRecords.stringSliceStart(address) : "");
        }
        if (inspectString) {
            output(describeString(stringAddress));
            output(sourceRecords.readString(stringAddress));
            return;
        }
        var position = Heap.FIRST_RECORD;
        while (position < inspectedHeap.bump) {
            var record = inspectedHeap.inspectRecordHeader(position);
            if (record.type === Heap.Types.PROGRAM) {
                var source = sourceRecords.programSource(position);
                if (source) output("program " + position + " " + describeString(source));
            }
            position += record.size;
        }
    }

    /* A representation audit, not a source minifier. Count tiny inline leaves
     * separately: replacing them with views cannot shrink their allocation.
     * Largest-first
     * containment finds remaining duplicated backing text without guessing
     * from filenames, function names or source formatting. */
    function reportStringSharing(inspectedHeap) {
        var records = inspectionRecordsFor(inspectedHeap, new Cells(inspectedHeap));
        var flat = [], position = Heap.FIRST_RECORD;
        while (position < inspectedHeap.bump) {
            var record = inspectedHeap.inspectRecordHeader(position);
            if (record.type === Heap.Types.STRING &&
                    !records.stringIsRope(position) &&
                    !records.stringIsSlice(position)) {
                flat.push({address: position, bytes: record.size,
                    text: records.readString(position)});
            }
            position += record.size;
        }
        flat.sort(function (a, b) {
            return b.text.length - a.text.length || a.address - b.address;
        });
        var containers = [], count = 0, bytes = 0, index = 0, inlineSmall = 0;
        while (index < flat.length) {
            var candidate = flat[index++], owner = null, start = -1;
            var containerIndex = 0;
            if (candidate.bytes <= Records.KernelConstants.STRING_SLICE_RECORD_BYTES) {
                inlineSmall++;
                continue;
            }
            while (containerIndex < containers.length) {
                var container = containers[containerIndex++];
                start = container.text.indexOf(candidate.text);
                if (start >= 0) { owner = container; break; }
            }
            if (owner) {
                var saving = candidate.bytes -
                    Records.KernelConstants.STRING_SLICE_RECORD_BYTES;
                output("duplicated string " + candidate.address +
                    " backing=" + owner.address + " start=" + start +
                    " codeUnits=" + candidate.text.length +
                    " avoidableBytes=" + saving);
                count++;
                bytes += saving;
            } else containers.push(candidate);
        }
        output("remaining duplicated flat strings: " + count +
            "; avoidable backing bytes: " + bytes);
        output("retained inline small strings (no smaller as views): " + inlineSmall);
    }

    function reportMetadataSharing(inspectedHeap) {
        var bytecodeLayout = nodeHost ? require("../bytecode.js") : GuestVMBytecode;
        var cells = new Cells(inspectedHeap);
        var records = inspectionRecordsFor(inspectedHeap, cells);
        var roles = {}, seen = {}, reusedNonemptyArgumentEntries = 0;
        var constantPools = 0, constantPoolBytes = 0, constantCells = 0;
        var constantTags = {}, constantPoolSeen = {};
        function poolView(pool) {
            return inspectedHeap.recordType(pool) === Heap.Types.CONSTANT_POOL ?
                (records.constantPoolExecutionCache(pool) || pool) : pool;
        }
        function poolLength(pool) {
            return inspectedHeap.recordType(pool) === Heap.Types.CONSTANT_POOL ?
                records.constantPoolLength(pool) : records.vectorLength(pool);
        }
        function poolTag(pool, index) {
            return inspectedHeap.recordType(pool) === Heap.Types.CONSTANT_POOL ?
                records.constantPoolTag(pool, index) : cells.tagAt(records.vectorCell(pool, index));
        }
        function poolReference(pool, index) {
            return inspectedHeap.recordType(pool) === Heap.Types.CONSTANT_POOL ?
                records.constantPoolLow(pool, index) : cells.referenceAddressAt(records.vectorCell(pool, index));
        }
        function integerSignature(vector) {
            var values = [], index = 0;
            if (inspectedHeap.recordType(vector) === Heap.Types.INTEGER_VECTOR) {
                while (index < records.integerVectorLength(vector)) {
                    values.push(records.integerVectorValue(vector, index++));
                }
                return "$" + values.join(",");
            }
            while (index < records.vectorLength(vector)) {
                var cell = records.vectorCell(vector, index++);
                if (cells.tagAt(cell) !== Cells.Tags.INT32) return null;
                values.push(cells.readPrimitiveAt(cell));
            }
            return "$" + values.join(",");
        }
        function count(role, address, signature, bytes) {
            if (signature === null || seen[role + ":" + address]) return;
            seen[role + ":" + address] = true;
            var data = roles[role];
            if (!data) data = roles[role] = {keys: {}, count: 0, bytes: 0,
                duplicates: 0, duplicateBytes: 0};
            data.count++;
            data.bytes += bytes;
            if (data.keys[signature]) {
                data.duplicates++;
                data.duplicateBytes += bytes;
            } else data.keys[signature] = true;
        }
        function vector(role, address) {
            if (address) count(role, address, integerSignature(address),
                inspectedHeap.recordSize(address));
        }
        var position = Heap.FIRST_RECORD;
        while (position < inspectedHeap.bump) {
            var header = inspectedHeap.inspectRecordHeader(position);
            if (header.type === Heap.Types.PROGRAM) {
                vector("constant-register maps", records.programConstantRegisters(position));
                vector("binding-register maps", records.programBindingRegisters(position));
                vector("parameter-slot maps", records.programParameterSlots(position));
                var constants = records.programConstants(position), index = 0;
                if (!constantPoolSeen["$" + constants]) {
                    constantPoolSeen["$" + constants] = true;
                    constantPools++;
                    constantPoolBytes += inspectedHeap.recordSize(constants);
                    constantCells += poolLength(constants);
                    for (var constantIndex = 0; constantIndex < poolLength(constants); constantIndex++) {
                        var tag = poolTag(poolView(constants), constantIndex);
                        constantTags[tag] = (constantTags[tag] || 0) + 1;
                    }
                }
                constants = poolView(constants);
                while (index < poolLength(constants)) {
                    var constantSlot = index++;
                    if (poolTag(constants, constantSlot) === Cells.Tags.REFERENCE) {
                        var target = poolReference(constants, constantSlot);
                        if (inspectedHeap.recordType(target) === Heap.Types.INTEGER_VECTOR) {
                            count("argument-register descriptors", target,
                                integerSignature(target), inspectedHeap.recordSize(target));
                        } else if (inspectedHeap.recordType(target) === Heap.Types.ARRAY) {
                            var elements = records.arrayElements(target);
                            count("argument-register descriptors", target,
                                integerSignature(elements), inspectedHeap.recordSize(target) +
                                inspectedHeap.recordSize(elements));
                        }
                    }
                }
                var bytecode = records.programBytecode(position), words = [], word = 0;
                while (word < records.bytecodeLength(bytecode)) {
                    words.push(records.bytecodeWord(bytecode, word++));
                }
                var pc = 0, argumentEntries = {};
                while (pc < words.length) {
                    var opcode = words[pc], width = bytecodeLayout.WIDTHS[opcode];
                    if (!width) break;
                    if (opcode === bytecodeLayout.CALL || opcode === bytecodeLayout.CONSTRUCT) {
                        var argumentIndex = words[pc + (opcode === bytecodeLayout.CALL ? 4 : 3)];
                        if (poolTag(constants, argumentIndex) === Cells.Tags.REFERENCE) {
                            var argument = poolReference(constants, argumentIndex);
                            if (inspectedHeap.recordType(argument) === Heap.Types.ARRAY &&
                                    records.arrayLength(argument) > 0) {
                                if (argumentEntries["$" + argumentIndex]) reusedNonemptyArgumentEntries++;
                                argumentEntries["$" + argumentIndex] = true;
                            }
                        }
                    }
                    pc += width;
                }
                count("bytecode", bytecode, "$" + words.join(","),
                    inspectedHeap.recordSize(bytecode));
            }
            position += header.size;
        }
        var tagCounts = [];
        for (var constantTag in constantTags) {
            if (Object.prototype.hasOwnProperty.call(constantTags, constantTag)) {
                tagCounts.push(constantTag + ":" + constantTags[constantTag]);
            }
        }
        output("constant pools: " + constantPools + "; bytes=" + constantPoolBytes +
            "; cells=" + constantCells + "; tags=" + tagCounts.join(","));
        output("reused nonempty argument constant entries: " + reusedNonemptyArgumentEntries);
        for (var name in roles) {
            if (Object.prototype.hasOwnProperty.call(roles, name)) {
                var role = roles[name];
                output(name + ": " + role.count + " records, " + role.bytes +
                    " bytes; duplicates=" + role.duplicates +
                    ", shareableBytes=" + role.duplicateBytes);
            }
        }
    }

    function reportProperties(inspectedHeap) {
        var inspectionRecords = inspectionRecordsFor(
            inspectedHeap, new Cells(inspectedHeap));
        function propertyLine(key, attributes, owner, entry) {
            var printable = "";
            for (var index = 0; index < key.length; index++) {
                var code = key.charCodeAt(index);
                if (code < 32 || code === 127) {
                    printable += "\\u" + ("0000" + code.toString(16)).slice(-4);
                } else printable += String.fromCharCode(code);
            }
            output("property " + printable + " attributes=" + attributes +
                (owner ? " owner=" + owner + " entry=" + entry : ""));
        }
        var position = Heap.FIRST_RECORD;
        while (position < inspectedHeap.bump) {
            var record = inspectedHeap.inspectRecordHeader(position);
            if (record.type === Heap.Types.PROPERTY) {
                var key = inspectionRecords.readString(
                    inspectionRecords.propertyKey(position));
                propertyLine(key, inspectionRecords.propertyAttributes(position), 0, 0);
            } else if (record.type === Heap.Types.OBJECT) {
                var storage = inspectionRecords.ownPropertyStorage(position);
                /* Keep older linked snapshots inspectable too: their
                 * individual property records are printed by the case above. */
                if (storage && inspectedHeap.recordType(storage) === Heap.Types.PROPERTY_STORAGE) {
                    var entry = inspectionRecords.lastOwnPropertyEntry(position);
                    while (entry) {
                        propertyLine(inspectionRecords.readString(
                            inspectionRecords.ownPropertyEntryKey(position, entry)),
                            inspectionRecords.ownPropertyEntryAttributes(position, entry),
                            position, entry);
                        entry = inspectionRecords.previousOwnPropertyEntry(position, entry);
                    }
                }
            }
            position += record.size;
        }
    }
    function reportStatistics(inspectedHeap) {
        var position = Heap.FIRST_RECORD;
        var totalLiveBytes = 0, totalFreeBytes = 0, protectedFreeBytes = 0;
        var largestFree = 0;
        var engineRecord = 0;
        var typeBytes = {}, typeCounts = {};
        var packedLive = 0, packedCapacity = 0;
        var vectorSpareBytes = 0, integerElements = 0;
        var narrowBytecodeBytes = 0, narrowBytecodes = 0;
        var sliceSpareBytes = 0;
        var compactCodeBytes = 0, executionCodeBytes = 0, executionCodeCount = 0;
        var smallCodeBytes = 0, smallCodeCount = 0, poolViewBytes = 0, argumentViewBytes = 0;
        var stringRecords = inspectionRecordsFor(inspectedHeap, new Cells(inspectedHeap));
        var encodings = {latin1: {count: 0, bytes: 0},
            utf16: {count: 0, bytes: 0}, rope: {count: 0, bytes: 0},
            slice: {count: 0, bytes: 0}};
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
            if (record.type === Heap.Types.PROPERTY_STORAGE) {
                packedLive += stringRecords.propertyStorageLiveCount(position);
                packedCapacity += stringRecords.propertyStorageCapacity(position);
            }
            if (record.type === Heap.Types.VALUE_VECTOR) {
                vectorSpareBytes += (stringRecords.vectorCapacity(position) -
                    stringRecords.vectorLength(position)) * Cells.PAYLOAD_BYTES;
            } else if (record.type === Heap.Types.INTEGER_VECTOR) {
                integerElements += stringRecords.integerVectorLength(position);
                var argumentView = stringRecords.integerVectorExecutionCache(position);
                if (argumentView) argumentViewBytes += inspectedHeap.recordSize(argumentView);
            } else if (record.type === Heap.Types.CONSTANT_POOL) {
                var poolViewAddress = stringRecords.constantPoolExecutionCache(position);
                if (poolViewAddress) poolViewBytes += inspectedHeap.recordSize(poolViewAddress);
            } else if (record.type === Heap.Types.BYTECODE) {
                if (record.flags & Records.KernelConstants.BYTECODE_COMPACT_FLAG) {
                    compactCodeBytes += record.size;
                    if (record.flags & Records.KernelConstants.BYTECODE_COMPACT8_FLAG) {
                        smallCodeBytes += record.size;
                        smallCodeCount++;
                    }
                }
                var executionCode = stringRecords.bytecodeExecutionCache(position);
                if (executionCode) {
                    executionCodeBytes += inspectedHeap.recordSize(executionCode);
                    executionCodeCount++;
                }
                var fits16 = true, wordCount = stringRecords.bytecodeLength(position);
                for (var wordIndex = 0; wordIndex < wordCount; wordIndex++) {
                    var value = stringRecords.bytecodeWord(position, wordIndex);
                    if (value < 0 || value > 65535) { fits16 = false; break; }
                }
                if (fits16) { narrowBytecodes++; narrowBytecodeBytes += wordCount * 2; }
            }
            if (record.type === Heap.Types.STRING) {
                var encoding = stringRecords.stringIsSlice(position) ? "slice" :
                    stringRecords.stringIsRope(position) ? "rope" :
                    stringRecords.stringIsLatin1(position) ? "latin1" : "utf16";
                encodings[encoding].count++;
                encodings[encoding].bytes += record.size;
                if (encoding === "slice") sliceSpareBytes += record.size -
                    Records.KernelConstants.STRING_SLICE_RECORD_BYTES;
            }
            position += record.size;
        }
        output("heap bytes: " + inspectedHeap.bump + "; occupied: " +
            totalLiveBytes + "; free: " + totalFreeBytes +
            "; protected free: " + protectedFreeBytes +
            "; largest reusable region: " + largestFree);
        output("packed properties: live=" + packedLive + "; capacity=" +
            packedCapacity + "; unused/tombstone slot bytes=" +
            (packedCapacity - packedLive) * Records.PropertyStorageLayout.ENTRY_BYTES);
        output("value-vector spare bytes=" + vectorSpareBytes +
            "; integer-vector elements=" + integerElements +
            "; string-view spare bytes=" + sliceSpareBytes);
        output("logical unsigned-16-fit bytecodes=" + narrowBytecodes +
            "; operand-byte delta versus expanded 32-bit=" + narrowBytecodeBytes);
        output("compact canonical bytecode bytes=" + compactCodeBytes +
            "; execution views=" + executionCodeCount +
            "; execution-view bytes=" + executionCodeBytes);
        output("8-bit bytecode: records=" + smallCodeCount + "; bytes=" + smallCodeBytes +
            "; constant execution-view bytes=" + poolViewBytes +
            "; argument execution-view bytes=" + argumentViewBytes);
        if (engineRecord) {
            var inspectionRecords = inspectionRecordsFor(
                inspectedHeap, new Cells(inspectedHeap));
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
        for (name in encodings) {
            if (Object.prototype.hasOwnProperty.call(encodings, name)) {
                output("STRING " + name + ": " + encodings[name].count +
                    " records, " + encodings[name].bytes + " bytes");
            }
        }
    }
    var records = inspectionRecordsFor(heap, new Cells(heap));
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
            {legacyConstantLocals: true,
             constantBindings: markerConstants,
             constantOverrides: markerConstants}));
    var parameters = [nodeHost ? 0 : heap.memory.nativeAddress(0),
        heapLength, heap.collectorStackBase, heap.byteLength, generation,
        roots[0], roots[1], 0, 0, 0, roots[2], roots[3], roots[4],
        roots[5], roots[6], 0];
    if (nodeHost) parameters.unshift(heap.memory);
    var result = compiled.fn.apply(null, parameters);
    if (result !== 0) throw new Error("marker failed: " + result);
    var missing = 0;
    var unreachableCount = 0, unreachableBytes = 0, unreachableByType = {};
    address = Heap.FIRST_RECORD;
    while (address < heapLength) {
        if (reachable["$" + address] &&
                recordMark(address) !== generation) {
            output("unmarked reachable record " + address + " type " +
                   heap.recordType(address));
            missing++;
        }
        if (recordKind(address) !== Heap.Types.FREE && !reachable["$" + address]) {
            unreachableCount++;
            unreachableBytes += recordBytes(address);
            var unreachableType = recordKind(address);
            unreachableByType[unreachableType] = (unreachableByType[unreachableType] || 0) + recordBytes(address);
        }
        address += recordBytes(address);
    }
    output("heap audit: " + reachableCount + " reachable records, " +
           missing + " missing marks; backend " + compiled.backend);
    output("unreachable occupied records=" + unreachableCount + "; bytes=" + unreachableBytes);
    for (var unreachableName in Heap.Types) {
        if (Object.prototype.hasOwnProperty.call(Heap.Types, unreachableName) &&
                unreachableByType[Heap.Types[unreachableName]]) {
            output("unreachable " + unreachableName + ": " + unreachableByType[Heap.Types[unreachableName]] + " bytes");
        }
    }
    heap.destroy();
    if (missing) throw new Error("collector reachability mismatch");
}(typeof arguments !== "undefined" ? arguments : []));
