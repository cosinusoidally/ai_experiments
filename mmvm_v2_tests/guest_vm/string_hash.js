/* Shared FNV-1a arithmetic. Property keys feed UTF-16 code units; compiler
 * fingerprints feed UTF-16LE bytes. Keep those input contracts explicit,
 * but use identical exact low-word multiplication on every execution host. */
(function (root) {
    var STRING_HASH_OFFSET_BASIS = -2128831035;
    var STRING_HASH_PRIME = 16777619;

    /* Also compiled as kernel code; the compiler binds STRING_HASH_PRIME
     * from the same exported constant, not a second numerical definition. */
    function stringHashStep(hash, code) {
        var word = (hash ^ code) | 0;
        return ((word & 65535) * STRING_HASH_PRIME +
            ((((word >>> 16) * STRING_HASH_PRIME) & 65535) << 16)) | 0;
    }

    function hashStringBytes(text) {
        var hash = STRING_HASH_OFFSET_BASIS, index = 0;
        while (index < text.length) {
            var code = text.charCodeAt(index++);
            hash = stringHashStep(hash, code & 255);
            hash = stringHashStep(hash, code >>> 8);
        }
        return hash;
    }

    var api = {offsetBasis: STRING_HASH_OFFSET_BASIS, prime: STRING_HASH_PRIME,
        step: stringHashStep, hashStringBytes: hashStringBytes};
    root.GuestVMStringHash = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
