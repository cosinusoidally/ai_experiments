/* Fixed-width formatting without primitive boxing or host-specific helpers. */
(function (root) {
    function hex32(value) {
        var text = "", digits = "0123456789abcdef";
        for (var i = 7; i >= 0; i--) text += digits.charAt((value >>> (i * 4)) & 15);
        return "0x" + text;
    }
    function sourceLocation(text) {
        var colon = text.lastIndexOf(":");
        if (colon <= 0) return null;
        var line = Number(text.substring(colon + 1));
        if (!(line > 0 && line === Math.floor(line))) return null;
        return {file: text.substring(0, colon), line: line};
    }
    root.KernelDebuggerFormat = {hex32: hex32, sourceLocation: sourceLocation};
}(this));
