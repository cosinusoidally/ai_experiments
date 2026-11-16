/* Structural acceptance without binutils or a PE SDK. Node is only the test
 * supervisor; executable generation itself also supports js_min/guest hosts.
 * Usage: node guest_vm/tools/check_snapshot_pe.js INPUT.snap OUTPUT.exe */
(function () {
    var fs = require("fs"), crypto = require("crypto");
    var input = fs.readFileSync(process.argv[2]), image = fs.readFileSync(process.argv[3]);
    var checks = 0;
    function check(condition, message) {
        if (!condition) throw new Error("PE acceptance: " + message);
        checks++;
    }
    function u16(p) { return image.readUInt16LE(p); }
    function u32(p) { return image.readUInt32LE(p); }
    function text(p) {
        var end = p;
        while (end < image.length && image[end]) end++;
        check(end < image.length, "terminated string");
        return image.toString("ascii", p, end);
    }
    check(u16(0) === 0x5a4d, "DOS signature");
    var pe = u32(60), optional = pe + 24;
    check(u32(pe) === 0x4550 && u16(pe + 4) === 0x14c, "PE/i386 signature");
    check(u32(pe + 8) === 0, "deterministic timestamp");
    check(u16(optional) === 0x10b && u16(optional + 68) === 3, "PE32 console");
    check(u32(optional + 28) === 0x00400000, "conventional preferred base");
    var sectionCount = u16(pe + 6), table = optional + u16(pe + 20), sections = [];
    var i, snapshot = null;
    for (i = 0; i < sectionCount; i++) {
        var at = table + 40 * i;
        var section = {name: text(at), virtualBytes: u32(at + 8), rva: u32(at + 12),
            bytes: u32(at + 16), offset: u32(at + 20)};
        check(section.offset + section.bytes <= image.length, "section file bounds");
        sections.push(section);
        if (section.name === ".snap") snapshot = section;
    }
    function fileOffset(rva) {
        for (var j = 0; j < sections.length; j++) {
            var s = sections[j];
            if (rva >= s.rva && rva - s.rva < s.virtualBytes) return s.offset + rva - s.rva;
        }
        throw new Error("unmapped PE RVA " + rva);
    }
    check(snapshot !== null && snapshot.virtualBytes === input.length, "snapshot extent");
    check(image.subarray(snapshot.offset, snapshot.offset + input.length).equals(input),
        "input snapshot is embedded without any changes");
    var descriptors = fileOffset(u32(optional + 104)), dlls = [];
    for (i = 0; u32(descriptors + i * 20 + 12); i++) {
        check(i < 8, "bounded import descriptor list");
        dlls.push(text(fileOffset(u32(descriptors + i * 20 + 12))));
    }
    check(dlls.join(",") === "kernel32.dll,msvcrt.dll,ws2_32.dll", "only the three intended DLL imports");
    console.log("PE snapshot acceptance passed: " + checks + " checks; snapshot SHA-256 " +
        crypto.createHash("sha256").update(input).digest("hex"));
}());
