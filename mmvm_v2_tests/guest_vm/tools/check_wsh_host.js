/* One host-memory/serialization integration check. Node reference or WSH:
 * node guest_vm/tools/check_wsh_host.js artifacts/reference.bin
 * cscript //nologo guest_vm/tools/wsh_runner.js guest_vm/tools/check_wsh_host.js artifacts/wsh.bin
 * Compare files externally as well as the checked logical contents. */
(function (root) {
    var node = typeof module !== "undefined" && module.exports;
    var Host, args, out = node ? console.log : print;
    if (node) { Host = require("../host_memory.js"); args = process.argv.slice(2); }
    else {
        load("guest_vm/host_ffi.js"); load("guest_vm/byte_search_kernel.js"); load("guest_vm/host_memory.js");
        Host = GuestVMHostMemory; args = root.arguments;
    }
    if (!args[0]) throw new Error("expected new binary fixture path");
    var size = 131089, memory = new Host(), a = memory.allocate(size, true), b = memory.allocate(size, false);
    var expected = [], i, checks = 0;
    function check(value, message) { if (!value) throw new Error(message); checks++; }
    function expectedWord(offset, value) {
        for (var n = 0; n < 4; n++) expected[offset + n] = (value >>> (n * 8)) & 255;
    }
    try {
        for (i = 0; i < size; i++) expected[i] = 0;
        for (i = 0; i < size; i += 7) { memory.write8(a, i, i * 37); expected[i] = (i * 37) & 255; }
        for (i = 3; i + 4 <= size; i += 64) { memory.write32LE(a, i, (i * 65599) | 0); expectedWord(i, (i * 65599) | 0); }
        var text = "\x00\x80\xffABCD";
        memory.writeStringLatin1(a, 65533, text);
        for (i = 0; i < text.length; i++) expected[65533 + i] = text.charCodeAt(i);
        text = "A\ud800B\udfff\uffff";
        memory.writeStringUTF16LE(a, 131000, text);
        for (i = 0; i < text.length; i++) {
            expected[131000 + i * 2] = text.charCodeAt(i) & 255;
            expected[131001 + i * 2] = text.charCodeAt(i) >>> 8;
        }
        memory.copyAllocation(b, a, size);
        memory.fillAllocationRange(b, 65531, 71, 173);
        for (i = 65531; i < 65602; i++) expected[i] = 173;
        memory.moveAllocationRange(b, 9, 0, 1000);
        for (i = 999; i >= 0; i--) expected[9 + i] = expected[i];
        memory.moveAllocationRange(b, 0, 12, 996);
        for (i = 0; i < 996; i++) expected[i] = expected[12 + i];
        memory.copyAllocationRange(b, 65535, a, 65531, 7);
        for (i = 0; i < 7; i++) expected[65535 + i] = memory.read8(a, 65531 + i);
        var hash = 0;
        for (i = 0; i < size; i++) {
            var byte = memory.read8(b, i); check(byte === expected[i], "byte mismatch at " + i);
            hash = (hash * 65599 + byte) | 0;
        }
        if (node) {
            var bytes = Buffer.alloc(size);
            for (i = 0; i < size; i++) bytes[i] = expected[i];
            require("fs").writeFileSync(args[0], bytes);
        } else GuestVMWSHHost.writeSnapshot({host: memory, allocation: b, length: size}, args[0], null, 0);
        out("host memory/serialization passed: " + checks + " bytes; checksum=" + hash);
    } finally { memory.free(a); memory.free(b); }
}(this));
