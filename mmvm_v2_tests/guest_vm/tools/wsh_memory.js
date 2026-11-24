/* WSH-only sparse word pages. Selected once by HostMemory, never a branch in
 * Node/native scalar access. Byte and unaligned operations preserve LE bits. */
(function (root) {
    var PAGE_SHIFT = 16, PAGE_MASK = 65535, WORD_SHIFT = 2, WORD_MASK = 3;
    function readWord(a, offset) {
        if ((offset & WORD_MASK) !== 0) return (readByte(a, offset) |
            (readByte(a, offset + 1) << 8) | (readByte(a, offset + 2) << 16) |
            (readByte(a, offset + 3) << 24)) >>> 0;
        var page = a.pages[offset >>> PAGE_SHIFT];
        return page ? page[(offset & PAGE_MASK) >>> WORD_SHIFT] >>> 0 : 0;
    }
    function writeWord(a, offset, value) {
        if ((offset & WORD_MASK) !== 0) {
            writeByte(a, offset, value); writeByte(a, offset + 1, value >>> 8);
            writeByte(a, offset + 2, value >>> 16); writeByte(a, offset + 3, value >>> 24); return;
        }
        var index = offset >>> PAGE_SHIFT, page = a.pages[index];
        if (!page) { if ((value | 0) === 0) return; page = a.pages[index] = []; }
        page[(offset & PAGE_MASK) >>> WORD_SHIFT] = value | 0;
    }
    function readByte(a, offset) {
        var page = a.pages[offset >>> PAGE_SHIFT];
        return page ? ((page[(offset & PAGE_MASK) >>> WORD_SHIFT] | 0) >>> ((offset & WORD_MASK) * 8)) & 255 : 0;
    }
    function writeByte(a, offset, value) {
        var index = offset >>> PAGE_SHIFT, page = a.pages[index]; value &= 255;
        if (!page) { if (value === 0) return; page = a.pages[index] = []; }
        var word = (offset & PAGE_MASK) >>> WORD_SHIFT, shift = (offset & WORD_MASK) * 8;
        page[word] = ((page[word] | 0) & ~(255 << shift)) | (value << shift);
    }
    function range(a, offset, length) {
        if (!a || a.freed || offset < 0 || length < 0 ||
                offset !== Math.floor(offset) || length !== Math.floor(length) || offset + length > a.length) {
            throw new RangeError("invalid WSH memory range");
        }
    }
    function copy(destination, destinationOffset, source, sourceOffset, length) {
        length = Number(length);
        range(destination, destinationOffset, length); range(source, sourceOffset, length);
        var i = 0;
        if (((destinationOffset | sourceOffset) & WORD_MASK) === 0) {
            while (i + 4 <= length) { writeWord(destination, destinationOffset + i, readWord(source, sourceOffset + i)); i += 4; }
        }
        while (i < length) { writeByte(destination, destinationOffset + i, readByte(source, sourceOffset + i)); i++; }
    }
    function fill(a, offset, length, value) {
        length = Number(length);
        range(a, offset, length); value = Number(value) & 255;
        var end = offset + length, word = (value * 16843009) | 0;
        while (offset < end && (offset & WORD_MASK)) writeByte(a, offset++, value);
        while (offset + 4 <= end) { writeWord(a, offset, word); offset += 4; }
        while (offset < end) writeByte(a, offset++, value);
    }
    root.GuestVMWSHMemory = {readByte: readByte, writeByte: writeByte,
        readWord: readWord, writeWord: writeWord, copy: copy, fill: fill};
}(this));
