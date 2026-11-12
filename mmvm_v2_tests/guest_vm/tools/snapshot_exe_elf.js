/* ELF32 packaging only: no compiler, host I/O, or snapshot relocation. */
(function (root) {
    var ELF = {base: 0x08048000, page: 4096, headerBytes: 52,
        programHeaderBytes: 32, programHeaderCount: 7, sectionHeaderBytes: 40,
        executable: 2, i386: 3, current: 1,
        load: 1, dynamic: 2, interpreter: 3, programHeaders: 6,
        stack: 0x6474e551, read: 4, write: 2, execute: 1,
        needed: 1, hash: 4, stringTable: 5, symbolTable: 6, stringSize: 10,
        symbolSize: 11, relocations: 17, relocationSize: 18,
        relocationEntrySize: 19, debug: 21, globalDataRelocation: 6,
        progbits: 1, symtab: 11, staticSymtab: 2, strtab: 3, hashSection: 5, rel: 9,
        dynamicSection: 6, alloc: 2, writable: 1, executableSection: 4,
        globalFunction: 0x12}; // STB_GLOBAL | STT_FUNC
    var EH = {type: 16, machine: 18, version: 20, entry: 24,
        programHeaders: 28, sectionHeaders: 32, headerSize: 40,
        programHeaderSize: 42, programHeaderCount: 44, sectionHeaderSize: 46,
        sectionHeaderCount: 48, sectionNamesIndex: 50};
    var PH = {type: 0, offset: 4, address: 8, physicalAddress: 12,
        fileSize: 16, memorySize: 20, flags: 24, alignment: 28};
    var SH = {name: 0, type: 4, flags: 8, address: 12, offset: 16,
        size: 20, link: 24, info: 28, alignment: 32, entrySize: 36};
    var SYM = {name: 0, value: 4, size: 8, info: 12, section: 14};
    var REL = {address: 0, info: 4};
    var DYN = {tag: 0, value: 4, bytes: 8};
    var LAYOUT = {interpreter: 512, start: 1024, main: 1280,
        metadata: 1536, got: 4096, dynamic: 4160, snapshot: 8192};
    var SYMBOL_BYTES = 16, RELOCATION_BYTES = 8, WORD_BYTES = 4;
    var START_MAIN_SYMBOL = 1, DLSYM_SYMBOL = 2;
    var START_MAIN_GOT = LAYOUT.got, DLSYM_GOT = LAYOUT.got + WORD_BYTES;

    function put16(bytes, at, value) {
        bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255;
    }
    function put32(bytes, at, value) {
        put16(bytes, at, value); put16(bytes, at + 2, value >>> 16);
    }
    function read32(bytes, at) {
        return (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 |
                bytes[at + 3] << 24) >>> 0;
    }
    function align(value, boundary) {
        return Math.ceil(value / boundary) * boundary;
    }
    function appendString(bytes, value) {
        var offset = bytes.length, i;
        for (i = 0; i < value.length; i++) bytes.push(value.charCodeAt(i));
        bytes.push(0);
        return offset;
    }
    function copy(bytes, offset, source) {
        var i;
        for (i = 0; i < source.length; i++) bytes[offset + i] = source[i];
    }
    function validate(header, length, format) {
        var f = format.fields;
        function field(name) { return read32(header, f[name]); }
        if (header.length !== format.headerBytes || length < format.headerBytes ||
                field("magic") !== format.magic || field("version") !== format.version ||
                field("fileLength") !== length ||
                field("entryOffset") < format.headerBytes ||
                field("entryOffset") >= field("codeOffset") ||
                field("codeOffset") >= field("heapOffset") ||
                field("codeLength") > field("heapOffset") - field("codeOffset") ||
                field("heapOffset") > length ||
                field("heapLength") !== length - field("heapOffset") ||
                field("heapLength") > field("heapCapacity")) {
            throw new Error("invalid standalone snapshot header");
        }
        /* Keep both ELF arithmetic and libc's 32-bit off_t representable. */
        if (length > 0x70000000 - ELF.base - LAYOUT.snapshot) {
            throw new Error("snapshot is too large for this i386 executable layout");
        }
        return field("entryOffset");
    }

    function launcher(Assembler, entryOffset) {
        var start = new Assembler(true), main = new Assembler(true), anchor;
        /* Linux i386 entry: ESP points to argc; EDX is ld.so's finalizer.
         * libc performs its normal initialization/exit path. No CRT objects. */
        start.movRegisterRegister("esi", "esp");
        start.movRegisterRegister("edi", "edx");
        start.callLabel("start_pc"); start.label("start_pc");
        anchor = LAYOUT.start + start.labels.start_pc;
        start.popInstructionPointerEcx();
        start.movRegisterRegister("ebx", "ecx");
        start.movRegisterRegister("eax", "esp"); start.andEaxImmediate(-16);
        start.movRegisterRegister("esp", "eax");
        start.subEspImmediate(WORD_BYTES);
        start.movRegisterRegister("eax", "esi"); start.pushEax();
        start.movRegisterRegister("eax", "edi"); start.pushEax();
        start.movEaxImmediate(0); start.pushEax(); start.pushEax();
        start.leaEaxRegisterDisplacement("esi", WORD_BYTES); start.pushEax();
        start.movEaxDwordPtrRegisterDisplacement("esi", 0); start.pushEax();
        start.leaEaxRegisterDisplacement("ebx", LAYOUT.main - anchor);
        start.pushEax();
        start.movEaxDwordPtrRegisterDisplacement("ebx", START_MAIN_GOT - anchor);
        start.callEax(); start.undefinedInstruction(); start.resolveLabels();

        main.pushEbp(); main.movEbpEsp(); main.pushEbx();
        main.subEspImmediate(2 * WORD_BYTES);
        main.callLabel("main_pc"); main.label("main_pc");
        anchor = LAYOUT.main + main.labels.main_pc;
        main.popInstructionPointerEcx(); main.movRegisterRegister("ebx", "ecx");
        main.movEaxEbpArgument(0); main.compareEaxImmediate(2);
        main.jumpLess("usage");
        main.movEaxDwordPtrRegisterDisplacement("ebx", DLSYM_GOT - anchor);
        main.pushEax();
        main.movEaxEbpArgument(1); main.addEaxImmediate(WORD_BYTES); main.pushEax();
        main.movEaxEbpArgument(0); main.subtractEaxImmediate(1); main.pushEax();
        main.leaEaxRegisterDisplacement("ebx", LAYOUT.snapshot + entryOffset - anchor);
        main.callEax();
        main.popEcx(); main.popEcx(); main.popEcx(); main.jump("done");
        main.label("usage"); main.movEaxImmediate(64);
        main.label("done"); main.addEspImmediate(2 * WORD_BYTES);
        main.popEbx(); main.leave(); main.ret(); main.resolveLabels();
        if (start.bytes.length > LAYOUT.main - LAYOUT.start ||
                main.bytes.length > LAYOUT.metadata - LAYOUT.main) {
            throw new Error("launcher exceeds its reserved text region");
        }
        return {start: start.bytes, main: main.bytes,
            assembly: "_start:\n" + start.dump() + "\nmain:\n" + main.dump()};
    }

    function kernelAddress(header, format) {
        return ELF.base + LAYOUT.snapshot + read32(header, format.fields.codeOffset);
    }

    function build(header, length, Assembler, format, debug) {
        var entryOffset = validate(header, length, format);
        var code = launcher(Assembler, entryOffset), prefix = [], suffix = [];
        var strings = [0], names = [0], sections = [], i, cursor = LAYOUT.metadata;
        var libraries = ["libc.so.6", "libm.so.6", "libdl.so.2"], needed = [];
        var interpreter = [], symbols, stringOffset, hashOffset, relocationOffset;
        var dynamicEntries = [], sectionTableOffset, suffixOffset;
        for (i = 0; i < LAYOUT.snapshot; i++) prefix.push(0);
        appendString(interpreter, "/lib/ld-linux.so.2");
        copy(prefix, LAYOUT.interpreter, interpreter);
        copy(prefix, LAYOUT.start, code.start); copy(prefix, LAYOUT.main, code.main);
        for (i = 0; i < libraries.length; i++) needed.push(appendString(strings, libraries[i]));
        symbols = [0, appendString(strings, "__libc_start_main"), appendString(strings, "dlsym")];
        stringOffset = cursor; copy(prefix, cursor, strings); cursor = align(cursor + strings.length, 4);
        var symbolOffset = cursor;
        for (i = 1; i < symbols.length; i++) {
            put32(prefix, cursor + i * SYMBOL_BYTES + SYM.name, symbols[i]);
            prefix[cursor + i * SYMBOL_BYTES + SYM.info] = ELF.globalFunction;
        }
        cursor += symbols.length * SYMBOL_BYTES;
        hashOffset = cursor;
        /* One bucket and a chain for the two imports: the SysV hash format
         * works on old dynamic loaders, without GNU hash/version extensions. */
        var hashWords = [1, symbols.length, START_MAIN_SYMBOL, 0, DLSYM_SYMBOL, 0];
        for (i = 0; i < hashWords.length; i++) put32(prefix, cursor + i * WORD_BYTES, hashWords[i]);
        cursor += hashWords.length * WORD_BYTES;
        relocationOffset = cursor;
        put32(prefix, cursor + REL.address, ELF.base + START_MAIN_GOT);
        put32(prefix, cursor + REL.info, START_MAIN_SYMBOL * 256 + ELF.globalDataRelocation);
        put32(prefix, cursor + RELOCATION_BYTES + REL.address, ELF.base + DLSYM_GOT);
        put32(prefix, cursor + RELOCATION_BYTES + REL.info, DLSYM_SYMBOL * 256 + ELF.globalDataRelocation);
        cursor += 2 * RELOCATION_BYTES;
        if (cursor > ELF.page) throw new Error("ELF metadata exceeds read-only segment");
        function dynamic(tag, value) { dynamicEntries.push([tag, value]); }
        for (i = 0; i < needed.length; i++) dynamic(ELF.needed, needed[i]);
        dynamic(ELF.hash, ELF.base + hashOffset);
        dynamic(ELF.stringTable, ELF.base + stringOffset);
        dynamic(ELF.symbolTable, ELF.base + symbolOffset);
        dynamic(ELF.stringSize, strings.length); dynamic(ELF.symbolSize, SYMBOL_BYTES);
        dynamic(ELF.relocations, ELF.base + relocationOffset);
        dynamic(ELF.relocationSize, 2 * RELOCATION_BYTES);
        dynamic(ELF.relocationEntrySize, RELOCATION_BYTES); dynamic(ELF.debug, 0); dynamic(0, 0);
        for (i = 0; i < dynamicEntries.length; i++) {
            put32(prefix, LAYOUT.dynamic + i * DYN.bytes + DYN.tag, dynamicEntries[i][0]);
            put32(prefix, LAYOUT.dynamic + i * DYN.bytes + DYN.value, dynamicEntries[i][1]);
        }
        function program(index, type, offset, size, flags, alignment) {
            var at = ELF.headerBytes + index * ELF.programHeaderBytes;
            put32(prefix, at + PH.type, type); put32(prefix, at + PH.offset, offset);
            put32(prefix, at + PH.address, ELF.base + offset);
            put32(prefix, at + PH.physicalAddress, ELF.base + offset);
            put32(prefix, at + PH.fileSize, size); put32(prefix, at + PH.memorySize, size);
            put32(prefix, at + PH.flags, flags); put32(prefix, at + PH.alignment, alignment);
        }
        program(0, ELF.programHeaders, ELF.headerBytes,
            ELF.programHeaderCount * ELF.programHeaderBytes, ELF.read, 4);
        program(1, ELF.interpreter, LAYOUT.interpreter, interpreter.length, ELF.read, 1);
        program(2, ELF.load, 0, ELF.page, ELF.read | ELF.execute, ELF.page);
        program(3, ELF.load, ELF.page, ELF.page, ELF.read | ELF.write, ELF.page);
        program(4, ELF.load, LAYOUT.snapshot, length, ELF.read | ELF.write | ELF.execute, ELF.page);
        program(5, ELF.dynamic, LAYOUT.dynamic, dynamicEntries.length * DYN.bytes, ELF.read | ELF.write, 4);
        program(6, ELF.stack, 0, 0, ELF.read | ELF.write, 16);

        function section(name, type, flags, offset, size, alignment, link, entrySize) {
            sections.push({name: appendString(names, name), type: type, flags: flags,
                offset: offset, size: size, alignment: alignment, link: link || 0,
                entrySize: entrySize || 0});
        }
        sections.push({}); // SHN_UNDEF
        section(".interp", ELF.progbits, ELF.alloc, LAYOUT.interpreter, interpreter.length, 1);
        section(".text", ELF.progbits, ELF.alloc | ELF.executableSection,
            LAYOUT.start, LAYOUT.main + code.main.length - LAYOUT.start, 16);
        section(".dynstr", ELF.strtab, ELF.alloc, stringOffset, strings.length, 1);
        section(".dynsym", ELF.symtab, ELF.alloc, symbolOffset, symbols.length * SYMBOL_BYTES, 4, 3, SYMBOL_BYTES);
        section(".hash", ELF.hashSection, ELF.alloc, hashOffset, hashWords.length * WORD_BYTES, 4, 4, 4);
        section(".rel.dyn", ELF.rel, ELF.alloc, relocationOffset, 2 * RELOCATION_BYTES, 4, 4, RELOCATION_BYTES);
        section(".got", ELF.progbits, ELF.alloc | ELF.writable, LAYOUT.got, 2 * WORD_BYTES, 4);
        section(".dynamic", ELF.dynamicSection, ELF.alloc | ELF.writable,
            LAYOUT.dynamic, dynamicEntries.length * DYN.bytes, 4, 3, DYN.bytes);
        suffixOffset = LAYOUT.snapshot + length;
        var suffixCursor = suffixOffset;
        if (!debug) {
            section(".snapshot", ELF.progbits, ELF.alloc | ELF.writable | ELF.executableSection,
                LAYOUT.snapshot, length, ELF.page);
        } else {
            var kernelOffset = read32(header, format.fields.codeOffset);
            var kernelLength = read32(header, format.fields.codeLength);
            var heapOffset = read32(header, format.fields.heapOffset);
            section(".snapshot.header", ELF.progbits, ELF.alloc | ELF.writable,
                LAYOUT.snapshot, format.headerBytes, 1);
            section(".snapshot.bootstrap", ELF.progbits, ELF.alloc | ELF.executableSection,
                LAYOUT.snapshot + format.headerBytes, kernelOffset - format.headerBytes, 1);
            var kernelSectionIndex = sections.length;
            section(".text.kernel", ELF.progbits, ELF.alloc | ELF.executableSection,
                LAYOUT.snapshot + kernelOffset, kernelLength, 1);
            section(".snapshot.heap", ELF.progbits, ELF.alloc | ELF.writable,
                LAYOUT.snapshot + heapOffset, length - heapOffset, 1);
            function appendSection(name, type, bytes, alignment, link, entrySize) {
                var position = align(suffixCursor, alignment);
                while (suffix.length < position - suffixOffset) suffix.push(0);
                copy(suffix, position - suffixOffset, bytes);
                section(name, type, 0, position, bytes.length, alignment, link, entrySize);
                suffixCursor = position + bytes.length;
            }
            for (i = 0; i < debug.sections.length; i++) {
                appendSection(debug.sections[i].name, ELF.progbits, debug.sections[i].bytes, 1);
            }
            var debugStrings = [0], debugSymbols = [];
            for (i = 0; i < SYMBOL_BYTES; i++) debugSymbols.push(0);
            for (i = 0; i < debug.functions.length; i++) {
                var fn = debug.functions[i], symbolAt = debugSymbols.length;
                var symbolName = appendString(debugStrings, fn.name);
                for (var j = 0; j < SYMBOL_BYTES; j++) debugSymbols.push(0);
                put32(debugSymbols, symbolAt, symbolName);
                put32(debugSymbols, symbolAt + SYM.value, fn.address);
                put32(debugSymbols, symbolAt + SYM.size, fn.length);
                debugSymbols[symbolAt + SYM.info] = ELF.globalFunction;
                put16(debugSymbols, symbolAt + SYM.section, kernelSectionIndex);
            }
            var debugStringIndex = sections.length;
            appendSection(".strtab", ELF.strtab, debugStrings, 1);
            appendSection(".symtab", ELF.staticSymtab, debugSymbols, 4, debugStringIndex, SYMBOL_BYTES);
        }
        section(".shstrtab", ELF.strtab, 0, suffixCursor, 0, 1);
        sections[sections.length - 1].size = names.length;
        sectionTableOffset = align(suffixCursor + names.length, 4);
        while (suffix.length < sectionTableOffset - suffixOffset + sections.length * ELF.sectionHeaderBytes) suffix.push(0);
        copy(suffix, suffixCursor - suffixOffset, names);
        for (i = 1; i < sections.length; i++) {
            var s = sections[i], at = sectionTableOffset - suffixOffset + i * ELF.sectionHeaderBytes;
            put32(suffix, at + SH.name, s.name); put32(suffix, at + SH.type, s.type);
            put32(suffix, at + SH.flags, s.flags);
            put32(suffix, at + SH.address, s.flags & ELF.alloc ? ELF.base + s.offset : 0);
            put32(suffix, at + SH.offset, s.offset); put32(suffix, at + SH.size, s.size);
            put32(suffix, at + SH.link, s.link);
            put32(suffix, at + SH.info, s.type === ELF.symtab || s.type === ELF.staticSymtab ? 1 : 0);
            put32(suffix, at + SH.alignment, s.alignment);
            put32(suffix, at + SH.entrySize, s.entrySize);
        }
        copy(prefix, 0, [127, 69, 76, 70, 1, 1, 1]);
        put16(prefix, EH.type, ELF.executable); put16(prefix, EH.machine, ELF.i386);
        put32(prefix, EH.version, ELF.current); put32(prefix, EH.entry, ELF.base + LAYOUT.start);
        put32(prefix, EH.programHeaders, ELF.headerBytes); put32(prefix, EH.sectionHeaders, sectionTableOffset);
        put16(prefix, EH.headerSize, ELF.headerBytes); put16(prefix, EH.programHeaderSize, ELF.programHeaderBytes);
        put16(prefix, EH.programHeaderCount, ELF.programHeaderCount);
        put16(prefix, EH.sectionHeaderSize, ELF.sectionHeaderBytes);
        put16(prefix, EH.sectionHeaderCount, sections.length);
        put16(prefix, EH.sectionNamesIndex, sections.length - 1);
        return {prefix: prefix, suffix: suffix, snapshotOffset: LAYOUT.snapshot,
            assembly: code.assembly};
    }
    var api = {build: build, read32: read32, kernelAddress: kernelAddress};
    root.GuestVMSnapshotExeELF = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
