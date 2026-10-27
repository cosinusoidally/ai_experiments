/* Linux-only, read-only parent-process profiler. Node supervises the native
 * executable; it provides no guest language support. ES3-compatible syntax.
 * node guest_vm/tools/profile_process_memory.js SNAPSHOT OUTPUT_PREFIX
 *      PROGRAM [ARGS...]
 * Brief SIGSTOP samples perturb timing; do not use this run as a stock score.
 * No heap dumps, forced collections, page advice or runtime changes. */
(function () {
    var fs = require("fs"), cp = require("child_process");
    var Heap = require("../heap.js"), Records = require("../heap_records.js");
    var Cells = require("../value_cell.js");
    var Backend = require("../aot/backend_x86.js");
    var args = process.argv.slice(2);
    if (args.length < 3) throw new Error("expected SNAPSHOT OUTPUT_PREFIX PROGRAM [ARGS...]");
    var snapshot = args.shift(), prefix = args.shift();
    var fields = Backend.StandaloneHeaderFields;
    var image = fs.readFileSync(snapshot);
    var imageHeapOffset = image.readUInt32LE(fields.heapOffset);
    var imageHeapLength = image.readUInt32LE(fields.heapLength);
    var heapCapacity = image.readUInt32LE(fields.heapCapacity);
    var engine = 0, offset = Heap.FIRST_RECORD;
    while (offset < imageHeapLength) {
        var type = image.readUInt32LE(imageHeapOffset + offset + Heap.HeaderFields.TYPE);
        var size = image.readUInt32LE(imageHeapOffset + offset + Heap.HeaderFields.SIZE);
        if (!size || size % Heap.RECORD_ALIGNMENT) throw new Error("invalid snapshot record");
        if (type === Heap.Types.ENGINE_STATE) {
            if (engine) throw new Error("ambiguous snapshot engine");
            engine = offset;
        }
        offset += size;
    }
    if (!engine) throw new Error("snapshot has no native engine");
    var signature = image.slice(imageHeapOffset + Heap.FIRST_RECORD,
        imageHeapOffset + Heap.FIRST_RECORD + Heap.HEADER_SIZE);
    image = null;
    var output = fs.openSync(prefix + ".jsonl", "wx");
    var log = fs.openSync(prefix + ".log", "wx");
    var child = cp.spawn("./artifacts/js_runner.exe", [snapshot].concat(args),
        {stdio: ["ignore", "pipe", "pipe"]});
    var started = Date.now(), samples = 0, pending = false, closed = false;
    var heapBase = 0, timer, interval = 5000;
    function record(value) {
        fs.writeSync(output, JSON.stringify(value) + "\n");
    }
    function readMappings() {
        var text = fs.readFileSync("/proc/" + child.pid + "/smaps", "utf8");
        var lines = text.split("\n"), maps = [], current, i, match;
        for (i = 0; i < lines.length; i++) {
            match = /^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)$/.exec(lines[i]);
            if (match) {
                current = {start: parseInt(match[1], 16), end: parseInt(match[2], 16),
                    permissions: match[3], name: match[4], rssKiB: 0,
                    anonymousKiB: 0, privateDirtyKiB: 0, pageBytes: 0};
                maps.push(current);
            } else if (current) {
                match = /^(Rss|Anonymous|Private_Dirty|KernelPageSize):\s+(\d+) kB/.exec(lines[i]);
                if (match && match[1] === "KernelPageSize") {
                    current.pageBytes = Number(match[2]) * 1024;
                    continue;
                }
                if (match) current[match[1] === "Rss" ? "rssKiB" :
                    match[1] === "Anonymous" ? "anonymousKiB" : "privateDirtyKiB"] = Number(match[2]);
            }
        }
        return maps;
    }
    function sample() {
        var descriptor = fs.openSync("/proc/" + child.pid + "/mem", "r");
        try {
            var maps = readMappings(), totalRSS = 0, heapMap, i;
            var small = Buffer.alloc(Heap.HEADER_SIZE);
            for (i = 0; i < maps.length; i++) {
                totalRSS += maps[i].rssKiB;
                if (maps[i].start === heapBase) heapMap = maps[i];
                if (!heapBase && !maps[i].name && maps[i].permissions.indexOf("rw") === 0 &&
                        maps[i].end - maps[i].start >= heapCapacity) {
                    fs.readSync(descriptor, small, 0, small.length, maps[i].start + Heap.FIRST_RECORD);
                    if (small.equals(signature)) {
                        fs.readSync(descriptor, small, 0, small.length, maps[i].start + engine);
                        if (small.readUInt32LE(Heap.HeaderFields.TYPE) === Heap.Types.ENGINE_STATE) {
                            heapBase = maps[i].start;
                            heapMap = maps[i];
                        }
                    }
                }
            }
            if (!heapMap) return; // bootstrap has not mapped its heap yet
            /* Pagemap's present bit needs no physical-frame-number access.
             * Count only pages wholly inside each record: shared boundary
             * pages are deliberately not attributed twice. No payload reads. */
            var pageBytes = heapMap.pageBytes;
            if (!pageBytes) throw new Error("mapping has no kernel page size");
            var pageMap = Buffer.alloc(Math.ceil(heapCapacity / pageBytes) * 8);
            var pageDescriptor = fs.openSync("/proc/" + child.pid + "/pagemap", "r");
            try {
                var got = fs.readSync(pageDescriptor, pageMap, 0, pageMap.length,
                    heapBase / pageBytes * 8);
                if (got !== pageMap.length) throw new Error("short pagemap read");
            } finally { fs.closeSync(pageDescriptor); }
            function residentInterior(start, end) {
                var first = Math.ceil(start / pageBytes), last = Math.floor(end / pageBytes);
                var present = 0;
                while (first < last) {
                    if (pageMap[first * 8 + 7] & 128) present += pageBytes;
                    first++;
                }
                return present;
            }
            /* Bounded read cache, not a second copy of the guest heap. Reuse
             * the authoritative Heap/Records accessors for payload fields. */
            var cache = Buffer.alloc(65536), cacheStart = -1, cacheLength = 0;
            function readWord(address) {
                if (address < 0 || address + 4 > heapCapacity) throw new Error("heap read outside mapping");
                if (address < cacheStart || address + 4 > cacheStart + cacheLength) {
                    cacheStart = Math.floor(address / cache.length) * cache.length;
                    cacheLength = fs.readSync(descriptor, cache, 0,
                        Math.min(cache.length, heapCapacity - cacheStart), heapBase + cacheStart);
                }
                return cache.readUInt32LE(address - cacheStart);
            }
            var heap = Object.create(Heap.prototype);
            function readByte(address) {
                return (readWord(address - address % 4) >>> ((address % 4) * 8)) & 255;
            }
            heap.memory = {readU32Trusted: readWord, readU32: readWord,
                readU8Trusted: readByte, readU8: readByte,
                readU16: function (address) { return readByte(address) + readByte(address + 1) * 256; }};
            heap.bump = heapCapacity;
            var records = new Records(heap, new Cells(heap));
            var arenaBump = records.engineHeapBump(engine);
            var activeArena = records.engineNativeRegionActive(engine);
            var regionEnd = records.engineNativeRegionEnd(engine);
            var tail = Math.max(arenaBump, records.engineNativeTailBump(engine));
            var counts = {}, bytes = {}, resident = {}, free = 0, occupied = 0, largest = 0;
            var spareValues = 0, spareProperties = 0;
            var position = Heap.FIRST_RECORD, recordCount = 0;
            while (position < tail) {
                if (activeArena && position === arenaBump) {
                    free += regionEnd - arenaBump;
                    position = regionEnd;
                    continue;
                }
                var header = heap.inspectRecordHeader(position);
                if (!header.size || header.size % Heap.RECORD_ALIGNMENT ||
                        header.type > Heap.LastRecordType || position + header.size > tail) {
                    throw new Error("sample interrupted a record update at " + position);
                }
                counts[header.type] = (counts[header.type] || 0) + 1;
                bytes[header.type] = (bytes[header.type] || 0) + header.size;
                resident[header.type] = (resident[header.type] || 0) +
                    residentInterior(position, position + header.size);
                if (header.type === Heap.Types.FREE) {
                    free += header.size;
                    largest = Math.max(largest, header.size);
                } else {
                    occupied += header.size;
                    if (header.type === Heap.Types.VALUE_VECTOR) {
                        spareValues += (records.vectorCapacity(position) -
                            records.vectorLength(position)) * Cells.PAYLOAD_BYTES;
                    } else if (header.type === Heap.Types.PROPERTY_STORAGE) {
                        spareProperties += (records.propertyStorageCapacity(position) -
                            records.propertyStorageLiveCount(position)) * Records.PropertyStorageLayout.ENTRY_BYTES;
                    }
                }
                recordCount++;
                position += header.size;
            }
            var namedTypes = {}, name;
            for (name in Heap.Types) {
                if (Object.prototype.hasOwnProperty.call(Heap.Types, name)) {
                    namedTypes[name] = {count: counts[Heap.Types[name]] || 0,
                        bytes: bytes[Heap.Types[name]] || 0,
                        residentInteriorBytes: resident[Heap.Types[name]] || 0};
                }
            }
            var sourcePrefix = "", frame = records.engineCurrentFrame(engine);
            if (frame && heap.recordType(frame) === Heap.Types.FRAME) {
                var program = records.frameProgram(frame), source = records.programSource(program);
                if (source) {
                    var length = Math.min(100, records.stringLength(source)), character = 0;
                    while (character < length) sourcePrefix += String.fromCharCode(
                        records.stringCharacterCodeUnit(source, character++));
                }
            }
            var result = {event: "sample", elapsedMs: Date.now() - started,
                currentFunctionSourcePrefix: sourcePrefix,
                rssKiB: totalRSS, heapRssKiB: heapMap.rssKiB,
                outsideHeapRssKiB: totalRSS - heapMap.rssKiB,
                heapCapacity: heapCapacity, tail: tail, occupiedBytes: occupied,
                freeBytes: free, largestFreeRecord: largest, recordCount: recordCount,
                spareValueBytes: spareValues, sparePropertyBytes: spareProperties,
                collectorWorkspaceResidentBytes: residentInterior(
                    records.engineGCStackBase(engine), records.engineGCStackLimit(engine)),
                collections: records.engineGCCollections(engine),
                lastPostGCOccupiedBytes: records.engineGCLiveBytes(engine), types: namedTypes};
            record(result);
            samples++;
            console.log("sample " + samples + ": RSS " + totalRSS + " KiB; occupied " +
                occupied + "; free " + free + "; collections " + result.collections);
        } finally { fs.closeSync(descriptor); }
    }
    function requestSample() {
        if (closed || pending) return;
        pending = true;
        child.kill("SIGSTOP");
        /* Wait until the kernel reports a stopped process before inspecting.
         * Sending SIGSTOP alone is not proof that all writes have stopped. */
        function stopped() {
            if (closed) return;
            var status;
            try { status = fs.readFileSync("/proc/" + child.pid + "/status", "utf8"); }
            catch (error) { pending = false; return; }
            if (!/^State:\s+T/m.test(status)) {
                setTimeout(stopped, 1);
                return;
            }
            try { sample(); }
            catch (error) { record({event: "sample-unavailable", message: error.message}); }
            finally { child.kill("SIGCONT"); pending = false; }
        }
        stopped();
    }
    function capture(data) {
        fs.writeSync(log, data);
        record({event: "output", elapsedMs: Date.now() - started, text: data.toString()});
        requestSample();
    }
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    timer = setInterval(requestSample, interval);
    child.on("error", function (error) { throw error; });
    child.on("close", function (code, signal) {
        closed = true;
        clearInterval(timer);
        record({event: "exit", elapsedMs: Date.now() - started, code: code, signal: signal, samples: samples});
        fs.closeSync(log);
        fs.closeSync(output);
        console.log("exit " + code + ", signal " + signal + "; " + samples + " samples");
        process.exitCode = code === 0 ? 0 : 1;
    });
    function terminate() { child.kill("SIGCONT"); child.kill("SIGTERM"); }
    process.on("SIGINT", terminate);
    process.on("SIGTERM", terminate);
}());
