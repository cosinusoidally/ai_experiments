/* Native kernel-JS Windows boundary. No guest interpreter or language semantics
 * live here. All platform pointers are supplied at process startup, not captured
 * while packaging. Normal functions use cdecl; PE bridges adapt Win32 stdcall. */
(function (root) {
    var L = {image: 0, crt: 4, kernel: 8, imports: 12, exports: 16,
        mappings: 20, faultActive: 24, faultHandler: 28, argc: 32, argv: 36,
        env: 40, startup: 44, clock: 64, protection: 80, message: 84,
        errno: 88, clockDouble: 96, memoryQuery: 112,
        integerMaximum: 160, wordRange: 168, halfWordRange: 176,
        fileTimeTicksPerSecond: 184, fileTimeEpochSeconds: 192,
        microsecondsPerSecond: 200, ioCommitMessage: 208, bytes: 212};
    var M = {base: 0, length: 4, protection: 8, next: 12, bytes: 16};
    var D = {handle: 0, first: 4, findData: 8, name: 44,
        findBytes: 320, entry: 328, entryName: 11, bytes: 608};
    var W = {reserve: 8192, commit: 4096, release: 32768, readWrite: 4,
        executeReadWrite: 64, executeRead: 32, readOnly: 2, noAccess: 1,
        page: 4096, allocationChunk: 65536, largeAllocation: 1048576,
        accessViolation: -1073741819, exceptionRecord: 0, exceptionCode: 0,
        exceptionAddress: 24, continueExecution: -1, continueSearch: 0,
        memoryInformationBytes: 28, memoryState: 16,
        invalidHandle: -1, directoryAttribute: 16, errnoNotImplemented: 38,
        linuxCreate: 64, linuxExclusive: 128, linuxTruncate: 512,
        linuxAppend: 1024, crtBinary: 32768, crtCreate: 256,
        crtExclusive: 1024, crtTruncate: 512, crtAppend: 8};
    var O = {resolve: 0, map: 1, unmap: 2, protect: 3, time: 4,
        format: 5, print: 6, openDirectory: 7, readDirectory: 8,
        closeDirectory: 9, unsupported: 10, open: 11, fault: 12,
        start: 13, openLibrary: 14, closeLibrary: 15, allocate: 16,
        zeroAllocate: 17, resize: 18, free: 19, link: 20, chmod: 21,
        signal: 22, poll: 23, read: 24, write: 25, fread: 26, fwrite: 27};
    /* API slots contain cdecl addresses: imported CRT functions or generated
     * cdecl-to-stdcall bridges. Keep one ordered declaration for both builder
     * and kernel so names/arity/offsets cannot drift. */
    var APIs = [
        ["VirtualAlloc", 4], ["VirtualFree", 3], ["VirtualProtect", 4],
        ["GetProcAddress", 2], ["LoadLibraryA", 1], ["FreeLibrary", 1],
        ["GetModuleHandleA", 1], ["AddVectoredExceptionHandler", 2],
        ["GetSystemTimeAsFileTime", 1], ["GetFileAttributesA", 1],
        ["FindFirstFileA", 2], ["FindNextFileA", 2], ["FindClose", 1],
        ["ExitProcess", 1], ["CreateHardLinkA", 3], ["Sleep", 1], ["VirtualQuery", 3],
        ["malloc", 1, "msvcrt.dll"], ["calloc", 2, "msvcrt.dll"],
        ["realloc", 2, "msvcrt.dll"], ["free", 1, "msvcrt.dll"],
        ["memcpy", 3, "msvcrt.dll"], ["_open", 3, "msvcrt.dll"],
        ["_write", 3, "msvcrt.dll"], ["_read", 3, "msvcrt.dll"],
        ["fread", 4, "msvcrt.dll"], ["fwrite", 4, "msvcrt.dll"],
        ["_errno", 0, "msvcrt.dll"],
        ["_vsnprintf", 4, "msvcrt.dll"], ["_vscprintf", 2, "msvcrt.dll"],
        ["__getmainargs", 5, "msvcrt.dll"], ["exit", 1, "msvcrt.dll"]
    ];
    var descriptorAliases = {close: "_close",
        lseek: "_lseek", getpid: "_getpid", unlink: "_unlink",
        __errno_location: "_errno"};
    var descriptorArities = {_read: 3, _close: 1, _lseek: 3, _getpid: 0, _unlink: 1};
    var alias;
    for (alias in descriptorAliases) if (Object.prototype.hasOwnProperty.call(descriptorAliases, alias)) {
        var nativeName = descriptorAliases[alias], present = false;
        for (i = 0; i < APIs.length; i++) if (APIs[i][0] === nativeName) present = true;
        if (!present) APIs.push([nativeName, descriptorArities[nativeName], "msvcrt.dll"]);
    }
    var A = {}, i;
    for (i = 0; i < APIs.length; i++) A[APIs[i][0]] = i * 4;

    function imageBase(s) { return load32(s + L.image); }
    function apiTable(s) { return load32(s + L.imports); }
    function crtModule(s) { return load32(s + L.crt); }
    function kernelModule(s) { return load32(s + L.kernel); }
    function mappingHead(s) { return load32(s + L.mappings); }
    function setMappingHead(s, v) { store32(s + L.mappings, v); return v; }
    function mappingBase(m) { return load32(m + M.base); }
    function mappingLength(m) { return load32(m + M.length); }
    function mappingProtection(m) { return load32(m + M.protection); }
    function mappingNext(m) { return load32(m + M.next); }
    function setMappingNext(m, n) { store32(m + M.next, n); return n; }
    function nativeAllocate(s, n) { return callNativeI32(load32(apiTable(s) + A.malloc), n); }
    function nativeFree(s, p) { return callNativeI32(load32(apiTable(s) + A.free), p); }
    function nativeCopy(s, dst, src, n) { return callNativeI32(load32(apiTable(s) + A.memcpy), dst, src, n); }
    function virtualAllocate(s, p, n, flags, protection) {
        return callNativeI32(load32(apiTable(s) + A.VirtualAlloc), p, n, flags, protection);
    }
    function virtualRelease(s, p) {
        return callNativeI32(load32(apiTable(s) + A.VirtualFree), p, 0, W.release);
    }
    function lookup(s, handle, name) {
        return callNativeI32(load32(apiTable(s) + A.GetProcAddress), handle, name);
    }
    function sameCString(a, b) {
        var x = loadRaw8(a), y = loadRaw8(b);
        while (x === y) {
            if (x === 0) return 1;
            a = a + 1; b = b + 1; x = loadRaw8(a); y = loadRaw8(b);
        }
        return 0;
    }
    function stringLength(p) {
        var n = 0;
        while (loadRaw8(p + n) !== 0) n = n + 1;
        return n;
    }
    function resolve(s, handle, name) {
        if (handle !== 0) return lookup(s, handle, name);
        var entries = load32(s + L.exports);
        var relativeName = load32(entries);
        while (relativeName !== 0) {
            if (sameCString(name, imageBase(s) + relativeName) === 1) {
                return imageBase(s) + load32(entries + 4);
            }
            entries = entries + 8; relativeName = load32(entries);
        }
        var pointer = lookup(s, crtModule(s), name);
        if (pointer === 0) pointer = lookup(s, kernelModule(s), name);
        return pointer;
    }
    function protection(flags) {
        if ((flags & 4) !== 0) {
            if ((flags & 2) !== 0) return W.executeReadWrite;
            return W.executeRead;
        }
        if ((flags & 2) !== 0) return W.readWrite;
        if ((flags & 1) !== 0) return W.readOnly;
        return W.noAccess;
    }
    function map(s, address, length, flags) {
        if (length <= 0 || address !== 0) return -1;
        var base = virtualAllocate(s, 0, length, W.reserve, protection(flags));
        if (base === 0) return -1;
        var record = nativeAllocate(s, M.bytes);
        if (record === 0) { virtualRelease(s, base); return -1; }
        store32(record + M.base, base); store32(record + M.length, length);
        store32(record + M.protection, protection(flags));
        setMappingNext(record, mappingHead(s)); setMappingHead(s, record);
        return base;
    }
    function findMapping(s, pointer) {
        var record = mappingHead(s);
        while (record !== 0) {
            if (mappingBase(record) === pointer) return record;
            record = mappingNext(record);
        }
        return 0;
    }
    /* Windows kernel I/O does not deliver a user-mode access violation for an
     * uncommitted user buffer. Commit the actual borrowed span before handing
     * it to CRT/kernel I/O; a fault handler alone cannot implement this contract.
     * Existing committed pages retain their data. CRT-owned allocations need
     * no action. Never commit an entire reservation just for a small transfer. */
    function commitNativeRange(s, pointer, bytes) {
        if (bytes < 0) return 0;
        if (bytes === 0) return 1;
        var record = mappingHead(s);
        while (record !== 0) {
            var offset = pointer - mappingBase(record);
            if (offset >= 0 && offset < mappingLength(record)) {
                if (bytes > mappingLength(record) - offset) return 0;
                var firstPage = offset & -W.page;
                if (virtualAllocate(s, mappingBase(record) + firstPage,
                        offset - firstPage + bytes, W.commit, mappingProtection(record)) === 0) return 0;
                return 1;
            }
            record = mappingNext(record);
        }
        return 1;
    }
    function nativeIO(s, buffered, writing, a, b, c, d) {
        var pointer = b, bytes = c;
        if (buffered !== 0) {
            pointer = a;
            store32(s + L.clock, b); store32(s + L.clock + 4, c);
            if (b < 0 || c < 0 || greaterF64(multiplyF64(loadI32F64(s + L.clock),
                    loadI32F64(s + L.clock + 4)), loadF64(s + L.integerMaximum)) === 1) {
                return platformFatal(s, load32(s + L.ioCommitMessage), 71);
            }
            bytes = b * c;
        }
        if (commitNativeRange(s, pointer, bytes) === 0) {
            /* Do not turn commitment failure into EOF: callers could snapshot
             * an incomplete program. Report a bounded resource failure. */
            return platformFatal(s, load32(s + L.ioCommitMessage), 71);
        }
        if (buffered !== 0) {
            if (writing !== 0) return callNativeI32(load32(apiTable(s) + A.fwrite), a, b, c, d);
            return callNativeI32(load32(apiTable(s) + A.fread), a, b, c, d);
        }
        if (writing !== 0) return callNativeI32(load32(apiTable(s) + A._write), a, b, c);
        return callNativeI32(load32(apiTable(s) + A._read), a, b, c);
    }
    function unmap(s, pointer, length) {
        var record = mappingHead(s), previous = 0;
        while (record !== 0) {
            if (mappingBase(record) === pointer) {
                if (mappingLength(record) !== length) return -1;
                if (virtualRelease(s, pointer) === 0) return -1;
                if (previous === 0) setMappingHead(s, mappingNext(record));
                else setMappingNext(previous, mappingNext(record));
                nativeFree(s, record); return 0;
            }
            previous = record; record = mappingNext(record);
        }
        return -1;
    }
    function fault(s, pointers) {
        if (load32(s + L.faultActive) !== 0) return W.continueSearch;
        var exception = load32(pointers + W.exceptionRecord);
        if (load32(exception + W.exceptionCode) !== W.accessViolation) return W.continueSearch;
        var address = load32(exception + W.exceptionAddress);
        var record = mappingHead(s);
        while (record !== 0) {
            var offset = address - mappingBase(record);
            if (offset >= 0 && offset < mappingLength(record) &&
                    mappingProtection(record) !== W.noAccess) {
                store32(s + L.faultActive, 1);
                /* An already committed page fault is a real protection/error
                 * fault, not demand-zero allocation. Never mask it. */
                if (callNativeI32(load32(apiTable(s) + A.VirtualQuery), address,
                        s + L.memoryQuery, W.memoryInformationBytes) === 0 ||
                        load32(s + L.memoryQuery + W.memoryState) !== W.reserve) {
                    store32(s + L.faultActive, 0); return W.continueSearch;
                }
                var page = offset & -W.allocationChunk;
                var count = mappingLength(record) - page;
                if (count > W.allocationChunk) count = W.allocationChunk;
                var committed = virtualAllocate(s, mappingBase(record) + page,
                    count, W.commit, mappingProtection(record));
                store32(s + L.faultActive, 0);
                if (committed !== 0) return W.continueExecution;
                return W.continueSearch;
            }
            record = mappingNext(record);
        }
        return W.continueSearch;
    }
    function allocate(s, size) {
        if (size < 0) return 0;
        if (size < W.largeAllocation) return nativeAllocate(s, size);
        var pointer = map(s, 0, size, 3);
        if (pointer === -1) return 0;
        return pointer;
    }
    function free(s, pointer) {
        var record = findMapping(s, pointer);
        if (record !== 0) return unmap(s, pointer, mappingLength(record));
        return nativeFree(s, pointer);
    }
    function zeroAllocate(s, count, size) {
        /* Reject signed overflow before delegating; all current VM allocation
         * lengths are restricted to the positive i386 signed range. */
        if (count < 0 || size < 0) return 0;
        store32(s + L.clock, count); store32(s + L.clock + 4, size);
        if (greaterF64(multiplyF64(loadI32F64(s + L.clock),
                loadI32F64(s + L.clock + 4)), loadF64(s + L.integerMaximum)) === 1) return 0;
        var bytes = count * size;
        if (bytes >= W.largeAllocation) return allocate(s, bytes);
        return callNativeI32(load32(apiTable(s) + A.calloc), count, size);
    }
    function resize(s, pointer, bytes) {
        if (pointer === 0) return allocate(s, bytes);
        if (bytes === 0) { free(s, pointer); return 0; }
        var record = findMapping(s, pointer);
        if (record === 0) return callNativeI32(load32(apiTable(s) + A.realloc), pointer, bytes);
        var next = allocate(s, bytes);
        if (next === 0) return 0;
        var count = mappingLength(record);
        if (count > bytes) count = bytes;
        nativeCopy(s, next, pointer, count); free(s, pointer);
        return next;
    }
    function protect(s, pointer, bytes, flags) {
        var record = findMapping(s, pointer);
        if (record === 0 || bytes > mappingLength(record)) return -1;
        /* Code allocations are populated before protection changes; commit
         * their complete span so a later execute fault cannot undo protection. */
        if (virtualAllocate(s, pointer, bytes, W.commit, mappingProtection(record)) === 0) return -1;
        if (callNativeI32(load32(apiTable(s) + A.VirtualProtect), pointer, bytes,
                protection(flags), s + L.protection) === 0) return -1;
        store32(record + M.protection, protection(flags));
        return 0;
    }
    function clock(s, tv) {
        callNativeI32(load32(apiTable(s) + A.GetSystemTimeAsFileTime), s + L.clock);
        store32(s + L.clock + 8, load32(s + L.clock) & 65535);
        store32(s + L.clock + 12, load32(s + L.clock) >>> 16);
        storeF64(s + L.clockDouble, subtractF64(divideF64(addF64(
            multiplyF64(loadI32F64(s + L.clock + 4), loadF64(s + L.wordRange)),
            addF64(multiplyF64(loadI32F64(s + L.clock + 12), loadF64(s + L.halfWordRange)),
                loadI32F64(s + L.clock + 8))), loadF64(s + L.fileTimeTicksPerSecond)),
            loadF64(s + L.fileTimeEpochSeconds)));
        var whole = toInt32F64(loadF64(s + L.clockDouble));
        store32(tv, whole);
        store32(tv + 4, toInt32F64(multiplyF64(subtractF64(loadF64(s + L.clockDouble), loadI32F64(tv)),
            loadF64(s + L.microsecondsPerSecond))));
        return 0;
    }
    function format(s, destination, size, text, argumentsPointer) {
        var count = callNativeI32(load32(apiTable(s) + A._vscprintf), text, argumentsPointer);
        if (size > 0) {
            callNativeI32(load32(apiTable(s) + A._vsnprintf), destination, size, text, argumentsPointer);
            storeRaw8(destination + size - 1, 0);
        }
        return count;
    }
    function print(s, fd, text, argumentsPointer) {
        var count = format(s, 0, 0, text, argumentsPointer);
        if (count < 0) return -1;
        var buffer = allocate(s, count + 1);
        if (buffer === 0) return -1;
        format(s, buffer, count + 1, text, argumentsPointer);
        var written = callNativeI32(load32(apiTable(s) + A._write), fd, buffer, count);
        free(s, buffer); return written;
    }
    function open(s, path, flags, mode) {
        var translated = (flags & 3) | W.crtBinary;
        if ((flags & W.linuxCreate) !== 0) translated = translated | W.crtCreate;
        if ((flags & W.linuxExclusive) !== 0) translated = translated | W.crtExclusive;
        if ((flags & W.linuxTruncate) !== 0) translated = translated | W.crtTruncate;
        if ((flags & W.linuxAppend) !== 0) translated = translated | W.crtAppend;
        return callNativeI32(load32(apiTable(s) + A._open), path, translated, mode);
    }
    function openDirectory(s, path) {
        var attributes = callNativeI32(load32(apiTable(s) + A.GetFileAttributesA), path);
        if (attributes === -1 || (attributes & W.directoryAttribute) === 0) return 0;
        var length = stringLength(path);
        var pattern = nativeAllocate(s, length + 4);
        if (pattern === 0) return 0;
        nativeCopy(s, pattern, path, length);
        storeRaw8(pattern + length, 47); storeRaw8(pattern + length + 1, 42);
        storeRaw8(pattern + length + 2, 0);
        var directory = nativeAllocate(s, D.bytes);
        if (directory === 0) { nativeFree(s, pattern); return 0; }
        var handle = callNativeI32(load32(apiTable(s) + A.FindFirstFileA), pattern, directory + D.findData);
        nativeFree(s, pattern);
        if (handle === W.invalidHandle) { nativeFree(s, directory); return 0; }
        store32(directory + D.handle, handle); store32(directory + D.first, 1);
        return directory;
    }
    function readDirectory(s, directory) {
        if (load32(directory + D.first) !== 0) store32(directory + D.first, 0);
        else if (callNativeI32(load32(apiTable(s) + A.FindNextFileA),
                load32(directory + D.handle), directory + D.findData) === 0) return 0;
        var source = directory + D.findData + D.name;
        var target = directory + D.entry + D.entryName;
        nativeCopy(s, target, source, stringLength(source) + 1);
        return directory + D.entry;
    }
    function closeDirectory(s, directory) {
        var result = callNativeI32(load32(apiTable(s) + A.FindClose), load32(directory + D.handle));
        nativeFree(s, directory);
        if (result === 0) return -1;
        return 0;
    }
    function platformFatal(s, message, status) {
        callNativeI32(load32(apiTable(s) + A._write), 2, message, stringLength(message));
        callNativeI32(load32(apiTable(s) + A.exit), status);
        return -1;
    }
    function unsupported(s) { return platformFatal(s, load32(s + L.message), 3); }
    function start(s, entry, resolver) {
        if (callNativeI32(load32(apiTable(s) + A.AddVectoredExceptionHandler),
                1, load32(s + L.faultHandler)) === 0) return 71;
        var result = callNativeI32(load32(apiTable(s) + A.__getmainargs),
            s + L.argc, s + L.argv, s + L.env, 0, s + L.startup);
        if (result !== 0) return 71;
        var argc = load32(s + L.argc);
        var argv = load32(s + L.argv);
        if (argc < 2) return 64;
        return callNativeI32(entry, argc - 1, argv + 4, resolver);
    }
    function dispatch(s, operation, a, b, c, d, e, f) {
        if (operation === O.resolve) return resolve(s, a, b);
        if (operation === O.map) {
            if (e !== -1 || f !== 0 || d !== 34) return -1;
            return map(s, a, b, c);
        }
        if (operation === O.unmap) return unmap(s, a, b);
        if (operation === O.protect) return protect(s, a, b, c);
        if (operation === O.time) return clock(s, a);
        if (operation === O.format) return format(s, a, b, c, d);
        if (operation === O.print) return print(s, a, b, c);
        if (operation === O.openDirectory) return openDirectory(s, a);
        if (operation === O.readDirectory) return readDirectory(s, a);
        if (operation === O.closeDirectory) return closeDirectory(s, a);
        if (operation === O.open) return open(s, a, b, c);
        if (operation === O.fault) return fault(s, a);
        if (operation === O.start) return start(s, a, b);
        if (operation === O.openLibrary) return callNativeI32(load32(apiTable(s) + A.LoadLibraryA), a);
        if (operation === O.closeLibrary) {
            if (callNativeI32(load32(apiTable(s) + A.FreeLibrary), a) !== 0) return 0;
            return -1;
        }
        if (operation === O.allocate) return allocate(s, a);
        if (operation === O.zeroAllocate) return zeroAllocate(s, a, b);
        if (operation === O.resize) return resize(s, a, b);
        if (operation === O.free) return free(s, a);
        if (operation === O.read) return nativeIO(s, 0, 0, a, b, c, 0);
        if (operation === O.write) return nativeIO(s, 0, 1, a, b, c, 0);
        if (operation === O.fread) return nativeIO(s, 1, 0, a, b, c, d);
        if (operation === O.fwrite) return nativeIO(s, 1, 1, a, b, c, d);
        if (operation === O.link) {
            if (callNativeI32(load32(apiTable(s) + A.CreateHardLinkA), b, a, 0) !== 0) return 0;
            return -1;
        }
        if (operation === O.chmod || operation === O.signal) return 0;
        if (operation === O.poll && b === 0) {
            callNativeI32(load32(apiTable(s) + A.Sleep), c); return 0;
        }
        return unsupported(s);
    }
    var functions = {imageBase: imageBase, apiTable: apiTable, crtModule: crtModule,
        kernelModule: kernelModule, mappingHead: mappingHead, setMappingHead: setMappingHead,
        mappingBase: mappingBase, mappingLength: mappingLength, mappingProtection: mappingProtection,
        mappingNext: mappingNext, setMappingNext: setMappingNext, nativeAllocate: nativeAllocate,
        nativeFree: nativeFree, nativeCopy: nativeCopy, virtualAllocate: virtualAllocate,
        virtualRelease: virtualRelease, lookup: lookup, sameCString: sameCString,
        stringLength: stringLength, resolve: resolve, protection: protection, map: map,
        findMapping: findMapping, commitNativeRange: commitNativeRange, nativeIO: nativeIO,
        unmap: unmap, fault: fault, allocate: allocate, free: free,
        zeroAllocate: zeroAllocate, resize: resize, protect: protect, clock: clock,
        format: format, print: print, open: open, openDirectory: openDirectory,
        readDirectory: readDirectory, closeDirectory: closeDirectory,
        unsupported: unsupported, platformFatal: platformFatal, start: start};
    var api = {entry: dispatch, functions: functions, state: L, operations: O,
        imports: APIs, aliases: descriptorAliases,
        constants: {L: L, M: M, D: D, W: W, O: O, A: A}};
    root.GuestVMWindowsPlatform = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
