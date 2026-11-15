/* Deterministic PE32 container, with the exact same opaque snapshot payload as
 * ELF. Code uses runtime PC-relative addresses; import tables use PE RVAs.
 * Native tools, SDK files and import libraries are not build dependencies. */
(function (root) {
    var Platform = root.GuestVMWindowsPlatform, ELF = root.GuestVMSnapshotExeELF;
    var Compiler = root.GuestVMKernelCompiler, Backend = root.GuestVMKernelX86Backend;
    var Binary64 = root.GuestVMBinary64;
    if (typeof module !== "undefined" && module.exports) {
        Platform = require("./windows_platform.js"); ELF = require("./snapshot_exe_elf.js");
        Compiler = require("../aot/kernel_compiler.js"); Backend = require("../aot/backend_x86.js");
        Binary64 = require("../binary64.js");
    }
    var PE = {base: 0x00400000, alignment: 4096, signature: 128,
        machine: 0x14c, optionalBytes: 224, characteristics: 0x103,
        optionalMagic: 0x10b, console: 3, sectionBytes: 40,
        platformRVA: 4096, kernelRVA: 8192, codeFlags: 0xe0000060,
        snapshotFlags: 0xe0000060, word: 4};
    var COFF = {machine: 4, sections: 6, optionalBytes: 20, characteristics: 22};
    var OPT = {magic: 0, codeBytes: 4, dataBytes: 8, entry: 16, codeBase: 20,
        dataBase: 24, imageBase: 28, sectionAlignment: 32, fileAlignment: 36,
        osMajor: 40, subsystemMajor: 48, imageBytes: 56, headerBytes: 60,
        subsystem: 68, stackReserve: 72, stackCommit: 76, heapReserve: 80,
        heapCommit: 84, directories: 92, importRVA: 104, importBytes: 108};
    var SEC = {virtualBytes: 8, rva: 12, fileBytes: 16, fileOffset: 20, flags: 36};
    function align(n) { return Math.ceil(n / PE.alignment) * PE.alignment; }
    function put16(b, at, v) { b[at] = v & 255; b[at + 1] = v >>> 8 & 255; }
    function put32(b, at, v) { put16(b, at, v); put16(b, at + 2, v >>> 16); }
    function copy(b, at, a) { for (var i = 0; i < a.length; i++) b[at + i] = a[i]; }
    function string(b, at, text) {
        for (var i = 0; i < text.length; i++) b[at + i] = text.charCodeAt(i);
        b[at + text.length] = 0; return at + text.length + 1;
    }
    function compile() {
        var ir = new Compiler().compileGraph(Platform.entry, Platform.functions,
            {constantNamespaces: Platform.constants});
        var result = new Backend({installExecutable: false}).compile(ir);
        try { return result.bytes.slice(0); } finally { result.destroy(); }
    }
    function pc(a, offset, register) {
        a.callLabel("pc"); a.label("pc"); a.popInstructionPointerEcx();
        a.movRegisterRegister(register || "eax", "ecx");
        if (register && register !== "eax") a.movRegisterRegister("eax", register);
        a.subtractEaxImmediate(offset + a.labels.pc);
    }
    /* A cdecl caller owns all pushed arguments. Win32 callees pop their own;
     * restore ESP from the frame rather than applying cdecl cleanup twice. */
    function importBridge(Assembler, offset, iat, arity, stdcall) {
        var a = new Assembler(false);
        a.pushEbp(); a.movEbpEsp();
        for (var i = arity - 1; i >= 0; i--) { a.movEaxEbpArgument(i); a.pushEax(); }
        pc(a, offset); a.movEaxDwordPtrRegisterDisplacement("eax", iat); a.callEax();
        a.movRegisterRegister("esp", "ebp"); a.leave();
        a.stackWords = 0; a.ret(); a.resolveLabels(); return a.bytes;
    }
    function wrapper(Assembler, offset, state, operation, arity, variadic, calleePop) {
        var a = new Assembler(false);
        a.pushEbp(); a.movEbpEsp();
        /* dispatch has six ordinary argument slots, preceded by state/op. */
        for (var i = 5; i >= 0; i--) {
            if (variadic && i === arity) a.leaEaxRegisterDisplacement("ebp", 8 + arity * 4);
            else if (i < arity) a.movEaxEbpArgument(i);
            else a.movEaxImmediate(0);
            a.pushEax();
        }
        a.movEaxImmediate(operation); a.pushEax();
        pc(a, offset); a.addEaxImmediate(state); a.pushEax();
        a.callLabel("dispatch"); a.discardStackWords(8); a.leave();
        if (calleePop) a.retPopBytes(calleePop); else a.ret();
        a.labels.dispatch = PE.kernelRVA - offset; a.resolveLabels(); return a.bytes;
    }
    function build(header, length, Assembler, format, debug) {
        if (debug) throw new Error("PE debug incorporation is not implemented");
        var entry = ELF.validate(header, length, format), kernel = compile();
        var O = Platform.operations, specs = [
            ["dlsym", O.resolve, 2], ["mmap", O.map, 6], ["munmap", O.unmap, 2],
            ["mprotect", O.protect, 3], ["gettimeofday", O.time, 2],
            ["snprintf", O.format, 3, true], ["dprintf", O.print, 2, true],
            ["opendir", O.openDirectory, 1], ["readdir", O.readDirectory, 1],
            ["closedir", O.closeDirectory, 1], ["open", O.open, 3],
            ["dlopen", O.openLibrary, 2], ["dlclose", O.closeLibrary, 1],
            ["malloc", O.allocate, 1], ["calloc", O.zeroAllocate, 2],
            ["realloc", O.resize, 2], ["free", O.free, 1], ["link", O.link, 2],
            ["chmod", O.chmod, 2], ["signal", O.signal, 2], ["poll", O.poll, 3],
            ["$fault", O.fault, 1, false, 4], ["$start", O.start, 2]
        ];
        var network = ["socket", "connect", "setsockopt", "getsockopt", "bind",
            "listen", "accept", "getsockname", "inet_aton", "fcntl"];
        var i, key;
        for (i = 0; i < network.length; i++) specs.push([network[i], O.unsupported, 0]);
        var cursor = PE.kernelRVA + kernel.length, imports = [], apiRVA = [], stubs = {}, aliases = {};
        for (i = 0; i < Platform.imports.length; i++) {
            var spec = Platform.imports[i];
            imports.push({name: spec[0], arity: spec[1], dll: spec[2] || "kernel32.dll"});
        }
        /* First lay out fixed-width bridges. Re-emit after all RVAs are known. */
        for (i = 0; i < imports.length; i++) {
            imports[i].bridge = cursor;
            /* A zero displacement has a shorter x86 encoding. Use a full-width
             * placeholder so final IAT references cannot grow into a neighbor. */
            imports[i].bridgeBytes = importBridge(Assembler, cursor,
                PE.alignment, imports[i].arity, true).length;
            cursor += imports[i].bridgeBytes;
        }
        for (i = 0; i < specs.length; i++) {
            spec = specs[i]; stubs[spec[0]] = cursor;
            cursor += wrapper(Assembler, cursor, 0, spec[1], spec[2], spec[3], spec[4]).length;
        }
        for (key in Platform.aliases) if (Object.prototype.hasOwnProperty.call(Platform.aliases, key)) {
            for (i = 0; i < imports.length; i++) if (imports[i].name === Platform.aliases[key]) aliases[key] = imports[i].bridge;
        }
        cursor = (cursor + 3) & -4;
        var descriptors = cursor; cursor += 60; // two DLL descriptors plus terminator
        var groups = [{name: "kernel32.dll", functions: []}, {name: "msvcrt.dll", functions: []}];
        for (i = 0; i < imports.length; i++) groups[imports[i].dll === "kernel32.dll" ? 0 : 1].functions.push(imports[i]);
        for (i = 0; i < groups.length; i++) {
            groups[i].lookup = cursor; cursor += (groups[i].functions.length + 1) * 4;
            groups[i].iat = cursor; cursor += (groups[i].functions.length + 1) * 4;
        }
        var data = [];
        function append(text) { var at = cursor; cursor += text.length + 1; string(data, at, text); return at; }
        for (i = 0; i < groups.length; i++) {
            var group = groups[i]; group.nameRVA = append(group.name);
            for (var j = 0; j < group.functions.length; j++) {
                if (cursor & 1) cursor++;
                var item = group.functions[j]; item.hint = cursor; cursor += 2;
                item.nameRVA = append(item.name); item.iat = group.iat + j * 4;
            }
        }
        var exportEntries = [];
        for (i = 0; i < specs.length; i++) if (specs[i][0].charAt(0) !== "$") {
            exportEntries.push([append(specs[i][0]), stubs[specs[i][0]]]);
        }
        for (key in aliases) if (Object.prototype.hasOwnProperty.call(aliases, key)) exportEntries.push([append(key), aliases[key]]);
        var message = append("guest VM: networking or unsupported Windows platform operation attempted\n");
        cursor = (cursor + 3) & -4;
        var exportTable = cursor; cursor += (exportEntries.length + 1) * 8;
        var state = cursor; cursor += Platform.state.bytes;
        var apiTable = cursor; cursor += imports.length * 4;
        var snapshot = align(cursor), prefix = [], suffix = [];
        for (i = 0; i < snapshot; i++) prefix.push(data[i] || 0);
        for (i = length; i < align(length); i++) suffix.push(0);
        copy(prefix, PE.kernelRVA, kernel);
        for (i = 0; i < imports.length; i++) {
            var bridge = importBridge(Assembler, imports[i].bridge,
                imports[i].iat, imports[i].arity, imports[i].dll === "kernel32.dll");
            if (bridge.length !== imports[i].bridgeBytes) throw new Error("PE bridge layout changed during linking");
            copy(prefix, imports[i].bridge, bridge);
            apiRVA.push(imports[i].bridge);
        }
        for (i = 0; i < specs.length; i++) {
            spec = specs[i]; copy(prefix, stubs[spec[0]], wrapper(Assembler,
                stubs[spec[0]], state, spec[1], spec[2], spec[3], spec[4]));
        }
        for (i = 0; i < groups.length; i++) {
            group = groups[i]; var at = descriptors + i * 20;
            put32(prefix, at, group.lookup); put32(prefix, at + 12, group.nameRVA); put32(prefix, at + 16, group.iat);
            for (j = 0; j < group.functions.length; j++) {
                item = group.functions[j]; put32(prefix, group.lookup + j * 4, item.hint);
                put32(prefix, item.iat, item.hint);
            }
        }
        for (i = 0; i < exportEntries.length; i++) {
            put32(prefix, exportTable + i * 8, exportEntries[i][0]);
            put32(prefix, exportTable + i * 8 + 4, exportEntries[i][1]);
        }
        var numericConstants = {integerMaximum: 2147483647, wordRange: 4294967296,
            halfWordRange: 65536, fileTimeTicksPerSecond: 10000000,
            fileTimeEpochSeconds: 11644473600, microsecondsPerSecond: 1000000};
        for (key in numericConstants) if (Object.prototype.hasOwnProperty.call(numericConstants, key)) {
            var words = Binary64.encode(numericConstants[key]);
            put32(prefix, state + Platform.state[key], words.low);
            put32(prefix, state + Platform.state[key] + 4, words.high);
        }
        var a = new Assembler(false), L = Platform.state;
        a.pushEbp(); a.movEbpEsp(); a.pushEbx(); a.pushEsi(); a.pushEdi();
        pc(a, PE.platformRVA); a.movRegisterRegister("ebx", "eax");
        function address(rva) { a.leaEaxRegisterDisplacement("ebx", rva); }
        function storeAddress(field, rva) {
            address(rva); a.movRegisterRegister("edx", "eax");
            address(state + field); a.movRegisterRegister("ecx", "eax");
            a.movRegisterRegister("eax", "edx"); a.movDwordPtrEcxEax();
        }
        storeAddress(L.image, 0); storeAddress(L.imports, apiTable);
        storeAddress(L.exports, exportTable); storeAddress(L.message, message);
        storeAddress(L.faultHandler, stubs.$fault);
        for (i = 0; i < imports.length; i++) storeAddress(apiTable - state + i * 4, imports[i].bridge);
        for (i = 0; i < groups.length; i++) {
            address(groups[i].nameRVA); a.pushEax();
            var getModule;
            for (j = 0; j < imports.length; j++) if (imports[j].name === "GetModuleHandleA") getModule = imports[j];
            address(getModule.bridge); a.callEax(); a.discardStackWords(1);
            a.movRegisterRegister("edx", "eax"); address(state + (i === 0 ? L.kernel : L.crt));
            a.movRegisterRegister("ecx", "eax"); a.movRegisterRegister("eax", "edx"); a.movDwordPtrEcxEax();
        }
        address(stubs.dlsym); a.pushEax(); address(snapshot + entry); a.pushEax();
        address(stubs.$start); a.callEax(); a.discardStackWords(2);
        a.pushEax();
        for (i = 0; i < imports.length; i++) if (imports[i].name === "exit") { address(imports[i].bridge); a.callEax(); }
        a.undefinedInstruction(); a.resolveLabels();
        if (a.bytes.length > PE.kernelRVA - PE.platformRVA) throw new Error("PE entry exceeds reserved space");
        copy(prefix, PE.platformRVA, a.bytes);
        put16(prefix, 0, 0x5a4d); put32(prefix, 60, PE.signature); put32(prefix, PE.signature, 0x4550);
        var coff = PE.signature, opt = coff + 24;
        put16(prefix, coff + COFF.machine, PE.machine); put16(prefix, coff + COFF.sections, 2);
        put16(prefix, coff + COFF.optionalBytes, PE.optionalBytes);
        put16(prefix, coff + COFF.characteristics, PE.characteristics);
        put16(prefix, opt + OPT.magic, PE.optionalMagic);
        put32(prefix, opt + OPT.codeBytes, snapshot - PE.platformRVA + align(length));
        put32(prefix, opt + OPT.entry, PE.platformRVA); put32(prefix, opt + OPT.codeBase, PE.platformRVA);
        put32(prefix, opt + OPT.dataBase, PE.platformRVA); put32(prefix, opt + OPT.imageBase, PE.base);
        put32(prefix, opt + OPT.sectionAlignment, PE.alignment); put32(prefix, opt + OPT.fileAlignment, PE.alignment);
        put16(prefix, opt + OPT.osMajor, 5); put16(prefix, opt + OPT.subsystemMajor, 5);
        put32(prefix, opt + OPT.imageBytes, snapshot + align(length)); put32(prefix, opt + OPT.headerBytes, PE.alignment);
        put16(prefix, opt + OPT.subsystem, PE.console); put32(prefix, opt + OPT.stackReserve, 1048576);
        put32(prefix, opt + OPT.stackCommit, 4096); put32(prefix, opt + OPT.heapReserve, 1048576);
        put32(prefix, opt + OPT.heapCommit, 4096); put32(prefix, opt + OPT.directories, 16);
        put32(prefix, opt + OPT.importRVA, descriptors); put32(prefix, opt + OPT.importBytes, 60);
        function section(index, name, rva, bytes, flags) {
            var at = opt + PE.optionalBytes + index * PE.sectionBytes;
            string(prefix, at, name); put32(prefix, at + SEC.virtualBytes, bytes);
            put32(prefix, at + SEC.rva, rva); put32(prefix, at + SEC.fileBytes, align(bytes));
            put32(prefix, at + SEC.fileOffset, rva); put32(prefix, at + SEC.flags, flags);
        }
        section(0, ".winvm", PE.platformRVA, snapshot - PE.platformRVA, PE.codeFlags);
        section(1, ".snap", snapshot, length, PE.snapshotFlags);
        return {prefix: prefix, suffix: suffix, snapshotOffset: snapshot};
    }
    var api = {build: build, read32: ELF.read32};
    root.GuestVMSnapshotExePE = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
