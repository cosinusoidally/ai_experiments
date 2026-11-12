/* Host-independent binary encoders shared by DWARF and its ELF container. */
(function (root) {
    function Writer() { this.bytes = []; }
    Writer.prototype.u8 = function (value) { this.bytes.push(value & 255); };
    Writer.prototype.u16 = function (value) { this.u8(value); this.u8(value >>> 8); };
    Writer.prototype.u32 = function (value) { this.u16(value); this.u16(value >>> 16); };
    Writer.prototype.patch32 = function (offset, value) {
        var index = 0;
        while (index < 4) { this.bytes[offset + index++] = value & 255; value >>>= 8; }
    };
    Writer.prototype.uleb = function (value) {
        do {
            var octet = value & 127;
            value >>>= 7;
            this.u8(octet | (value ? 128 : 0));
        } while (value);
    };
    Writer.prototype.sleb = function (value) {
        var more = true;
        while (more) {
            var octet = value & 127;
            value >>= 7;
            more = !((value === 0 && !(octet & 64)) || (value === -1 && (octet & 64)));
            this.u8(octet | (more ? 128 : 0));
        }
    };
    Writer.prototype.append = function (bytes) {
        var index = 0;
        while (index < bytes.length) this.u8(bytes[index++]);
    };
    Writer.prototype.string = function (value) {
        var index = 0;
        while (index < value.length) {
            var code = value.charCodeAt(index++);
            if (code < 128) this.u8(code);
            else if (code < 2048) { this.u8(192 | (code >>> 6)); this.u8(128 | (code & 63)); }
            else { this.u8(224 | (code >>> 12)); this.u8(128 | ((code >>> 6) & 63)); this.u8(128 | (code & 63)); }
        }
        this.u8(0);
    };
    Writer.prototype.align = function (alignment) {
        while (this.bytes.length % alignment) this.u8(0);
    };
    var api = {Writer: Writer};
    root.GuestVMDebugBinary = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
