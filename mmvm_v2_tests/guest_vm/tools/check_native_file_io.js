/* Bounded end-to-end binary I/O, including large initially demand-zero buffers.
 * Usage from mmvm_v2_tests, on Node, js_min, or a native guest executable:
 *   HOST guest_vm/tools/check_native_file_io.js artifacts/NEW_FIXTURE.bin
 * The fixture must not exist. Only the file created by this run is removed. */
(function (root, args) {
    var node = typeof process !== "undefined" && process.versions && process.versions.node;
    if (node) args = process.argv.slice(2);
    if (args.length !== 1) throw new Error("usage: check_native_file_io.js artifacts/NEW_FIXTURE.bin");
    var path = args[0], bytes = 2 * 1024 * 1024 + 37, middle = 1024 * 1024 + 17;
    var owned = false;
    function check(condition, message) { if (!condition) throw new Error("native file I/O: " + message); }
    function expected(index) { return index === 0 ? 127 : index === middle ? 128 : index === bytes - 1 ? 255 : 0; }
    if (node) {
        var fs = require("fs"), buffer = Buffer.alloc(bytes);
        buffer[0] = 127; buffer[middle] = 128; buffer[bytes - 1] = 255;
        try {
            fs.writeFileSync(path, buffer, {flag: "wx"}); owned = true;
            check(fs.readFileSync(path).equals(buffer), "Node reference binary round trip");
        } finally { if (owned) fs.unlinkSync(path); }
        console.log("large binary file I/O passed on Node"); return;
    }
    var resolver = get_dlsym(), symbols = {};
    function call(name, a, b, c, d) {
        var pointer = symbols[name];
        if (!pointer) {
            pointer = ffi_call(resolver, 0, name);
            check(pointer !== 0, "missing symbol " + name); symbols[name] = pointer;
        }
        if (arguments.length === 1) return ffi_call(pointer);
        if (arguments.length === 2) return ffi_call(pointer, a);
        if (arguments.length === 3) return ffi_call(pointer, a, b);
        if (arguments.length === 4) return ffi_call(pointer, a, b, c);
        return ffi_call(pointer, a, b, c, d);
    }
    var buffers = [], fd = -1, file = 0;
    function allocate() {
        var pointer = call("calloc", bytes, 1);
        check(pointer !== 0, "large allocation"); buffers.push(pointer); return pointer;
    }
    function verify(pointer) {
        check(peek8(pointer) === 127, "first byte");
        check(peek8(pointer + middle) === 128, "middle byte");
        check(peek8(pointer + bytes - 1) === 255, "last byte");
        for (var index = 4096; index < bytes; index += 4096) {
            check(peek8(pointer + index) === expected(index), "demand-zero interior byte " + index);
        }
    }
    try {
        var source = allocate();
        poke8(source, 127); poke8(source + middle, 128); poke8(source + bytes - 1, 255);
        /* Touch only three locations before the kernel reads the whole span. */
        fd = call("open", path, 1 | 64 | 128, 384);
        check(fd >= 0, "exclusive fixture creation"); owned = true;
        check(call("write", fd, source, bytes) === bytes, "complete descriptor write");
        check(call("close", fd) === 0, "close descriptor output"); fd = -1;
        var target = allocate();
        fd = call("open", path, 0, 0); check(fd >= 0, "descriptor input");
        check(call("read", fd, target, bytes) === bytes, "complete descriptor read into untouched allocation");
        verify(target); call("close", fd); fd = -1;
        var buffered = allocate();
        file = call("fopen", path, "rb"); check(file !== 0, "buffered input");
        check(call("fread", buffered, 1, bytes, file) === bytes, "complete buffered read into untouched allocation");
        verify(buffered); call("fclose", file); file = 0;
        /* fread/fwrite must also prepare unaligned interior subspans. */
        var bufferedSource = allocate();
        poke8(bufferedSource + middle, 128);
        file = call("fopen", path, "wb"); check(file !== 0, "buffered output");
        check(call("fwrite", bufferedSource + 1, 1, bytes - 2, file) === bytes - 2, "unaligned buffered write from mostly untouched allocation");
        call("fclose", file); file = 0;
        file = call("fopen", path, "rb"); check(file !== 0, "buffered verification input");
        check(call("fread", target + 1, 1, bytes - 2, file) === bytes - 2, "unaligned buffered read");
        check(peek8(target + middle) === 128 && peek8(target + 1) === 0, "interior buffered payload");
        call("fclose", file); file = 0;
        print("large binary file I/O passed (read/write/fread/fwrite, aligned and interior spans)");
    } finally {
        if (fd >= 0) call("close", fd);
        if (file) call("fclose", file);
        while (buffers.length) call("free", buffers.pop());
        if (owned) call("unlink", path);
    }
}(this, typeof arguments !== "undefined" ? arguments : []));
