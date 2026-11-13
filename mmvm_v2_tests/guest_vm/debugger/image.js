/* Bounds-checked ELF32/i386 views. File storage stays in native memory. */
(function (root) {
    var E = {headerBytes: 52, type: 16, machine: 18, entry: 24, sectionOffset: 32,
        sectionSize: 46, sectionCount: 48, sectionNames: 50, executable: 2, i386: 3,
        sectionBytes: 40, name: 0, sectionType: 4, flags: 8, executableFlag: 4, address: 12, offset: 16,
        size: 20, link: 24, entrySize: 36, symbols: 2, symbolBytes: 16};
    function Reader(io, address, length) { this.io = io; this.address = address; this.length = length; this.pos = 0; }
    Reader.prototype.check = function (at, count) {
        if (at < 0 || count < 0 || at + count > this.length) throw new Error("truncated binary data at " + at);
    };
    Reader.prototype.u8 = function () { this.check(this.pos, 1); return this.io.ffi.peek8(this.address + this.pos++); };
    Reader.prototype.u16 = function () { var a = this.u8(); return a + this.u8() * 256; };
    Reader.prototype.u32 = function () { var a = this.u16(); return (a + this.u16() * 65536) >>> 0; };
    Reader.prototype.at16 = function (at) { this.pos = at; return this.u16(); };
    Reader.prototype.at32 = function (at) { this.pos = at; return this.u32(); };
    Reader.prototype.uleb = function () {
        var value = 0, scale = 1, octet, count = 0;
        do { octet = this.u8(); value += (octet & 127) * scale; scale *= 128;
            if (++count > 5) throw new Error("unsupported LEB128 width"); } while (octet & 128);
        return value;
    };
    Reader.prototype.sleb = function () {
        var value = 0, scale = 1, octet, count = 0;
        do { octet = this.u8(); value += (octet & 127) * scale; scale *= 128;
            if (++count > 5) throw new Error("unsupported signed LEB128 width"); } while (octet & 128);
        return octet & 64 ? value - scale : value;
    };
    Reader.prototype.string = function () {
        var text = "", c;
        while ((c = this.u8()) !== 0) text += String.fromCharCode(c);
        return text;
    };
    Reader.prototype.view = function (at, bytes) { this.check(at, bytes); return new Reader(this.io, this.address + at, bytes); };
    function Image(io, path) {
        this.io = io; this.file = io.readFile(path); this.path = path;
        this.reader = new Reader(io, this.file.address, this.file.length);
        this.sections = {}; this.symbols = []; this.byName = {}; this.codeSections = [];
        try { this.parse(); } catch (error) { this.destroy(); throw error; }
    }
    Image.prototype.parse = function () {
        var r = this.reader;
        r.check(0, E.headerBytes);
        if (r.at32(0) !== 0x464c457f || r.u8() !== 1 || r.u8() !== 1 ||
            r.at16(E.type) !== E.executable || r.at16(E.machine) !== E.i386) {
            throw new Error("expected little-endian ELF32 i386 ET_EXEC executable");
        }
        this.entry = r.at32(E.entry);
        var offset = r.at32(E.sectionOffset), count = r.at16(E.sectionCount);
        if (!count || r.at16(E.sectionSize) !== E.sectionBytes) throw new Error("unsupported ELF section table");
        r.check(offset, count * E.sectionBytes);
        var nameIndex = r.at16(E.sectionNames);
        if (nameIndex >= count) throw new Error("bad ELF section name index");
        var nameHeader = offset + nameIndex * E.sectionBytes;
        var names = r.view(r.at32(nameHeader + E.offset), r.at32(nameHeader + E.size));
        var list = [], i;
        for (i = 0; i < count; i++) {
            var h = offset + i * E.sectionBytes;
            names.pos = r.at32(h + E.name);
            var s = {name: names.string(), type: r.at32(h + E.sectionType), address: r.at32(h + E.address),
                offset: r.at32(h + E.offset), size: r.at32(h + E.size), link: r.at32(h + E.link),
                entrySize: r.at32(h + E.entrySize)};
            this.sections["$" + s.name] = s; list.push(s);
            if (r.at32(h + E.flags) & E.executableFlag) { r.check(s.offset, s.size); this.codeSections.push(s); }
        }
        for (i = 0; i < list.length; i++) {
            s = list[i]; if (s.type !== E.symbols) continue;
            if (s.entrySize !== E.symbolBytes || s.link >= count || s.size % E.symbolBytes) throw new Error("bad symbol table");
            var table = r.view(s.offset, s.size), strings = r.view(list[s.link].offset, list[s.link].size);
            for (var at = 0; at < table.length; at += E.symbolBytes) {
                strings.pos = table.at32(at);
                var symbol = {name: strings.string(), start: table.at32(at + 4), size: table.at32(at + 8)};
                if (symbol.name && symbol.size) { this.symbols.push(symbol); this.byName["$" + symbol.name] = symbol; }
            }
        }
        this.symbols.sort(function (a, b) { return a.start - b.start; });
    };
    Image.prototype.section = function (name) {
        var s = this.sections["$" + name];
        if (!s) throw new Error("missing " + name + "; incorporate the kernel -g sidecar when packaging");
        return this.reader.view(s.offset, s.size);
    };
    Image.prototype.symbol = function (pc) {
        for (var i = this.symbols.length - 1; i >= 0; i--) {
            var s = this.symbols[i]; if (s.start <= pc && pc < s.start + s.size) return s;
        }
        return null;
    };
    Image.prototype.codeByte = function (address) {
        var section = this.lastCodeSection;
        if (!section || address < section.address || address >= section.address + section.size) {
            section = null;
            for (var i = 0; i < this.codeSections.length; i++) {
                var candidate = this.codeSections[i];
                if (address >= candidate.address && address < candidate.address + candidate.size) { section = candidate; break; }
            }
            if (!section) throw new Error("address is outside executable code sections");
            this.lastCodeSection = section;
        }
        return this.io.ffi.peek8(this.file.address + section.offset + address - section.address);
    };
    Image.prototype.destroy = function () { if (this.file) { this.io.release(this.file.address); this.file = null; } };
    root.KernelDebuggerReader = Reader; root.KernelDebuggerImage = Image;
}(this));
