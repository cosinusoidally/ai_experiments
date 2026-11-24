/* Shared compact guest-program source map. All positions are UTF-16 based. */
(function (root) {
    var layout = {FILENAME: 0, DEFAULT_LINE: 1, DEFAULT_COLUMN: 2,
        LOCATIONS: 3, LOCATION_PC: 0, LOCATION_LINE: 1,
        LOCATION_COLUMN: 2, LOCATION_WORDS: 3, MAX_FRAMES: 64,
        UTF8_SINGLE_LIMIT: 128, UTF8_PAIR_LIMIT: 2048,
        UTF8_PAIR_PREFIX: 192, UTF8_TRIPLE_PREFIX: 224,
        UTF8_QUAD_PREFIX: 240, UTF8_CONTINUATION: 128,
        UTF8_PAYLOAD_MASK: 63, UTF8_PAYLOAD_BITS: 6,
        SURROGATE_HIGH_START: 55296, SURROGATE_HIGH_END: 56319,
        SURROGATE_LOW_START: 56320, SURROGATE_LOW_END: 57343,
        SURROGATE_SHIFT: 10, SUPPLEMENTARY_START: 65536,
        REPLACEMENT_CHARACTER: 65533};
    root.GuestVMProgramDebugLayout = layout;
    if (typeof module !== "undefined" && module.exports) module.exports = layout;
}(this));
