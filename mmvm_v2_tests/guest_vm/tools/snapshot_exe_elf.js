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
        progbits: 1, symtab: 11, strtab: 3, hashSection: 5, rel: 9,
        dynamicSection: 6, alloc: 2, writable: 1, executableSection: 4};
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

    function build(header, length, Assembler, format) {
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
            put32(prefix, cursor + i * SYMBOL_BYTES, symbols[i]);
            prefix[cursor + i * SYMBOL_BYTES + 12] = 0x12; // STB_GLOBAL | STT_FUNC
        }
        cursor += symbols.length * SYMBOL_BYTES;
        hashOffset = cursor;
        /* One bucket and a chain for the two imports: the SysV hash format
         * works on old dynamic loaders, without GNU hash/version extensions. */
        var hashWords = [1, symbols.length, START_MAIN_SYMBOL, 0, DLSYM_SYMBOL, 0];
        for (i = 0; i < hashWords.length; i++) put32(prefix, cursor + i * WORD_BYTES, hashWords[i]);
        cursor += hashWords.length * WORD_BYTES;
        relocationOffset = cursor;
        put32(prefix, cursor, ELF.base + START_MAIN_GOT);
        put32(prefix, cursor + 4, START_MAIN_SYMBOL * 256 + ELF.globalDataRelocation);
        put32(prefix, cursor + RELOCATION_BYTES, ELF.base + DLSYM_GOT);
        put32(prefix, cursor + RELOCATION_BYTES + 4, DLSYM_SYMBOL * 256 + ELF.globalDataRelocation);
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
            put32(prefix, LAYOUT.dynamic + i * 8, dynamicEntries[i][0]);
            put32(prefix, LAYOUT.dynamic + i * 8 + 4, dynamicEntries[i][1]);
        }
        function program(index, type, offset, size, flags, alignment) {
            var at = ELF.headerBytes + index * ELF.programHeaderBytes;
            put32(prefix, at, type); put32(prefix, at + 4, offset);
            put32(prefix, at + 8, ELF.base + offset); put32(prefix, at + 12, ELF.base + offset);
            put32(prefix, at + 16, size); put32(prefix, at + 20, size);
            put32(prefix, at + 24, flags); put32(prefix, at + 28, alignment);
        }
        program(0, ELF.programHeaders, ELF.headerBytes,
            ELF.programHeaderCount * ELF.programHeaderBytes, ELF.read, 4);
        program(1, ELF.interpreter, LAYOUT.interpreter, interpreter.length, ELF.read, 1);
        program(2, ELF.load, 0, ELF.page, ELF.read | ELF.execute, ELF.page);
        program(3, ELF.load, ELF.page, ELF.page, ELF.read | ELF.write, ELF.page);
        program(4, ELF.load, LAYOUT.snapshot, length, ELF.read | ELF.write | ELF.execute, ELF.page);
        program(5, ELF.dynamic, LAYOUT.dynamic, dynamicEntries.length * 8, ELF.read | ELF.write, 4);
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
        section(".dynamic", ELF.dynamicSection, ELF.alloc | ELF.writable, LAYOUT.dynamic, dynamicEntries.length * 8, 4, 3, 8);
        section(".snapshot", ELF.progbits, ELF.alloc | ELF.writable | ELF.executableSection,
            LAYOUT.snapshot, length, ELF.page);
        suffixOffset = LAYOUT.snapshot + length;
        section(".shstrtab", ELF.strtab, 0, suffixOffset, 0, 1);
        sections[sections.length - 1].size = names.length;
        sectionTableOffset = align(suffixOffset + names.length, 4);
        for (i = 0; i < sectionTableOffset - suffixOffset + sections.length * ELF.sectionHeaderBytes; i++) suffix.push(0);
        copy(suffix, 0, names);
        for (i = 1; i < sections.length; i++) {
            var s = sections[i], at = sectionTableOffset - suffixOffset + i * ELF.sectionHeaderBytes;
            put32(suffix, at, s.name); put32(suffix, at + 4, s.type);
            put32(suffix, at + 8, s.flags);
            put32(suffix, at + 12, s.flags & ELF.alloc ? ELF.base + s.offset : 0);
            put32(suffix, at + 16, s.offset); put32(suffix, at + 20, s.size);
            put32(suffix, at + 24, s.link); put32(suffix, at + 28, s.type === ELF.symtab ? 1 : 0);
            put32(suffix, at + 32, s.alignment); put32(suffix, at + 36, s.entrySize);
        }
        copy(prefix, 0, [127, 69, 76, 70, 1, 1, 1]);
        put16(prefix, 16, ELF.executable); put16(prefix, 18, ELF.i386); put32(prefix, 20, ELF.current);
        put32(prefix, 24, ELF.base + LAYOUT.start); put32(prefix, 28, ELF.headerBytes);
        put32(prefix, 32, sectionTableOffset); put16(prefix, 40, ELF.headerBytes);
        put16(prefix, 42, ELF.programHeaderBytes); put16(prefix, 44, ELF.programHeaderCount);
        put16(prefix, 46, ELF.sectionHeaderBytes); put16(prefix, 48, sections.length);
        put16(prefix, 50, sections.length - 1);
        return {prefix: prefix, suffix: suffix, snapshotOffset: LAYOUT.snapshot,
            assembly: code.assembly};
    }
    var api = {build: build, read32: read32};
    root.GuestVMSnapshotExeELF = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
