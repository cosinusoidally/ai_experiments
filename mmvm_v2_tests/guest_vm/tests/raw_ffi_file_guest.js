/* Raw-FFI file-read regression used by the js_min-only demo8 path. */
if (typeof get_dlsym === "undefined") {
    assertEqual(true, true, "raw FFI file test skipped on non-MMVM host");
} else {
    var rawDlsym = get_dlsym();
    function rawSymbol(name) {
        var pointer = ffi_call(rawDlsym, 0, name);
        if (!pointer) throw new Error("missing libc symbol: " + name);
        return pointer;
    }

    var rawGetenv = rawSymbol("getenv");
    var rawFopen = rawSymbol("fopen");
    var rawFseek = rawSymbol("fseek");
    var rawFtell = rawSymbol("ftell");
    var rawFread = rawSymbol("fread");
    var rawFclose = rawSymbol("fclose");
    var rawCalloc = rawSymbol("calloc");
    var rawFree = rawSymbol("free");
    var rawPathPointer = ffi_call(rawGetenv, "XAUTHORITY");
    assertEqual(rawPathPointer !== 0, true, "XAUTHORITY is available");
    var rawPath = "";
    var rawPathIndex = 0;
    var rawPathByte;
    while ((rawPathByte = peek8(rawPathPointer + rawPathIndex++)) !== 0) {
        rawPath += String.fromCharCode(rawPathByte);
    }
    var rawFile = ffi_call(rawFopen, rawPath, "rb");
    assertEqual(rawFile !== 0, true, "Xauthority opens through raw FFI");
    assertEqual(ffi_call(rawFseek, rawFile, 0, 2), 0,
                "Xauthority seek to end");
    var rawLength = ffi_call(rawFtell, rawFile);
    assertEqual(rawLength > 0, true, "Xauthority has content");
    assertEqual(ffi_call(rawFseek, rawFile, 0, 0), 0,
                "Xauthority seek to start");
    var rawBytes = ffi_call(rawCalloc, rawLength, 1);
    assertEqual(rawBytes !== 0, true, "raw read buffer allocated");
    var rawCount = ffi_call(rawFread, rawBytes, 1, rawLength, rawFile);
    assertEqual(rawCount, rawLength, "raw FFI reads the complete Xauthority file");
    assertEqual(peek8(rawBytes) >= 0, true, "raw FFI read is addressable");
    var rawArray = [];
    var rawIndex;
    for (rawIndex = 0; rawIndex < rawCount; rawIndex++) {
        rawArray.push(peek8(rawBytes + rawIndex));
    }
    function RawNodeBuffer(value) {
        var bytes = [];
        var index;
        if (typeof value === "number") {
            for (index = 0; index < value; index++) bytes.push(0);
        } else if (typeof value === "string") {
            for (index = 0; index < value.length; index++) {
                bytes.push(value.charCodeAt(index) & 255);
            }
        } else if (value && value._nodeBytes) {
            bytes = value._nodeBytes.slice(0);
        } else if (value) {
            for (index = 0; index < value.length; index++) {
                bytes.push(value[index] & 255);
            }
        }
        this._nodeBytes = bytes;
        this.length = bytes.length;
    }
    RawNodeBuffer.prototype.readUInt16BE = function (offset) {
        return (this._nodeBytes[offset] << 8) |
               this._nodeBytes[offset + 1];
    };
    RawNodeBuffer.prototype.slice = function (start, end) {
        start = start || 0;
        end = end === undefined ? this.length : end;
        return new RawNodeBuffer(this._nodeBytes.slice(start, end));
    };
    RawNodeBuffer.prototype.toString = function (encoding, start, end) {
        start = start || 0;
        end = end === undefined ? this.length : end;
        var value = "";
        for (var index = start; index < end; index++) {
            value += String.fromCharCode(this._nodeBytes[index]);
        }
        return value;
    };
    var rawBuffer = new RawNodeBuffer(rawArray);
    assertEqual(rawBuffer.length, rawLength,
                "guest constructor preserves raw file bytes");
    assertEqual(rawBuffer.readUInt16BE(0) >= 0, true,
                "guest buffer can read the first authority field");
    function rawAuthorityField(data, state) {
        if (state.offset + 2 > data.length) throw new Error("truncated test authority");
        var length = data.readUInt16BE(state.offset);
        state.offset += 2;
        if (state.offset + length > data.length) {
            throw new Error("truncated test authority field");
        }
        var field = data.slice(state.offset, state.offset + length);
        state.offset += length;
        return field;
    }
    var rawState = {offset: 0};
    var rawEntries = 0;
    while (rawState.offset < rawBuffer.length) {
        rawState.offset += 2;
        rawAuthorityField(rawBuffer, rawState);
        rawAuthorityField(rawBuffer, rawState).toString("ascii");
        rawAuthorityField(rawBuffer, rawState);
        rawAuthorityField(rawBuffer, rawState);
        rawEntries++;
    }
    assertEqual(rawState.offset, rawBuffer.length,
                "guest buffer parses the complete authority file");
    assertEqual(rawEntries > 0, true, "authority contains at least one entry");
    Buffer = RawNodeBuffer;
    var rawGlobalBuffer = new Buffer(rawArray);
    assertEqual(rawGlobalBuffer.length, rawLength,
                "reassigned global Buffer constructs the complete file");
    function rawReadFileSync(path) {
        var file = ffi_call(rawFopen, path, "rb");
        ffi_call(rawFseek, file, 0, 2);
        var length = ffi_call(rawFtell, file);
        ffi_call(rawFseek, file, 0, 0);
        var pointer = ffi_call(rawCalloc, length, 1);
        var bytes = [];
        var remaining = length;
        while (remaining > 0) {
            var wanted = remaining > 65536 ? 65536 : remaining;
            var count = ffi_call(rawFread, pointer, 1, wanted, file);
            if (count <= 0) break;
            for (var index = 0; index < count; index++) {
                bytes.push(peek8(pointer + index));
            }
            remaining -= count;
        }
        ffi_call(rawFree, pointer);
        ffi_call(rawFclose, file);
        return new Buffer(bytes);
    }
    var rawFunctionBuffer = rawReadFileSync(rawPath);
    assertEqual(rawFunctionBuffer.length, rawLength,
                "compiled file helper preserves all authority bytes");
    ffi_call(rawFree, rawBytes);
    ffi_call(rawFclose, rawFile);
}
