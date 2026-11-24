/* Buffer utilities written in ordinary guest JavaScript. These are Node
 * compatibility services, not ECMAScript builtins or embedder callbacks. */
function __guestBufferByteLength(value, encoding) {
    if (Buffer.isBuffer(value)) return value.length;
    var text = String(value);
    if (encoding === "ascii" || encoding === "binary" || encoding === "latin1") {
        return text.length;
    }
    if (encoding === "utf16le" || encoding === "ucs2" || encoding === "ucs-2") {
        return text.length * 2;
    }
    var length = 0;
    var index = 0;
    while (index < text.length) {
        var code = text.charCodeAt(index++);
        if (code < 128) length++;
        else if (code < 2048) length += 2;
        else if (code >= 55296 && code <= 56319 && index < text.length &&
                 text.charCodeAt(index) >= 56320 && text.charCodeAt(index) <= 57343) {
            index++;
            length += 4;
        } else length += 3;
    }
    return length;
}
