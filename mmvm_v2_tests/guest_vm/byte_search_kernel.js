/* Shared bounded binary substring search. Two-way critical factorization gives
 * linear worst-case work and constant auxiliary space. A four-byte rejection
 * filter skips only positions whose critical byte is definitely absent; it
 * does not change the matching algorithm or its periodic-needle guarantee.
 * Input may contain NULs. Return a relative index, not an owning pointer. */
(function (root) {
    var constants = {BYTE_REPEAT: 16843009, BYTE_HIGH_BITS: -2139062144,
        SEARCH_WORD_BYTES: 4, SEARCH_SHORT_MAX_BYTES: 256,
        SEARCH_PAIR_MASK: 255, SEARCH_PAIR_MULTIPLIER: 33,
        SEARCH_TABLE_ENTRIES: 256};

    /* Bounded-needle pair-Horspool search. Hash collisions only shorten skips.
     * Limiting this path to 256 bytes bounds comparison work by a constant;
     * unbounded needles use two-way below, preserving linear worst-case growth.
     * Caller-owned 256-byte scratch is transient, never part of the guest heap.
     * Distances fit in a byte because this path is length-bounded. */
    function findShortBytesKernel(haystack, length, needle, needleLength, table, memset) {
        var last = needleLength - 1, index = 0;
        if (memset !== 0) callNativeI32(memset, table, last, SEARCH_TABLE_ENTRIES);
        else while (index < SEARCH_TABLE_ENTRIES) {
            storeRaw8(table + index, last); index = index + 1;
        }
        index = 1;
        while (index < last) {
            var hash = ((loadRaw8(needle + index - 1) * SEARCH_PAIR_MULTIPLIER) ^
                loadRaw8(needle + index)) & SEARCH_PAIR_MASK;
            storeRaw8(table + hash, last - index);
            index = index + 1;
        }
        var finalHash = ((loadRaw8(needle + last - 1) * SEARCH_PAIR_MULTIPLIER) ^
            loadRaw8(needle + last)) & SEARCH_PAIR_MASK;
        var position = 0, limit = length - needleLength;
        while (position <= limit) {
            var pair = ((loadRaw8(haystack + position + last - 1) * SEARCH_PAIR_MULTIPLIER) ^
                loadRaw8(haystack + position + last)) & SEARCH_PAIR_MASK;
            if (pair === finalHash) {
                var compared = 0;
                while (compared + SEARCH_WORD_BYTES <= needleLength &&
                        loadRaw32(haystack + position + compared) === loadRaw32(needle + compared)) {
                    compared = compared + SEARCH_WORD_BYTES;
                }
                while (compared < needleLength &&
                        loadRaw8(haystack + position + compared) === loadRaw8(needle + compared)) compared = compared + 1;
                if (compared === needleLength) return position;
            }
            position = position + loadRaw8(table + pair);
        }
        return -1;
    }

    function findBytesKernel(haystack, length, needle, needleLength, memchr, scratch, memset) {
        if (needleLength === 0) return 0;
        if (needleLength > length) return -1;
        if (needleLength > 1 && needleLength <= SEARCH_SHORT_MAX_BYTES && scratch !== 0) {
            return findShortBytesKernel(haystack, length, needle, needleLength, scratch, memset);
        }
        var critical = -1, period = 1, reverse = 0;
        /* Maximal suffix in each lexicographic order. Choose the later
         * critical position and retain its associated candidate period. */
        while (reverse < 2) {
            var suffix = -1, candidate = 0, compared = 1, candidatePeriod = 1;
            while (candidate + compared < needleLength) {
                var a = loadRaw8(needle + suffix + compared);
                var b = loadRaw8(needle + candidate + compared);
                if (a === b) {
                    if (compared === candidatePeriod) {
                        candidate = candidate + candidatePeriod; compared = 1;
                    } else compared = compared + 1;
                } else if ((reverse === 0 && a > b) || (reverse !== 0 && a < b)) {
                    candidate = candidate + compared; compared = 1;
                    candidatePeriod = candidate - suffix;
                } else {
                    suffix = candidate; candidate = candidate + 1;
                    compared = 1; candidatePeriod = 1;
                }
            }
            if (reverse === 0 || suffix > critical) {
                critical = suffix; period = candidatePeriod;
            }
            reverse = reverse + 1;
        }
        var prefix = 0;
        while (prefix <= critical && loadRaw8(needle + prefix) === loadRaw8(needle + prefix + period)) {
            prefix = prefix + 1;
        }
        var rememberedAfterShift = 0;
        if (prefix > critical) rememberedAfterShift = needleLength - period;
        else {
            period = needleLength - critical - 1;
            if (critical > period) period = critical;
            period = period + 1;
        }
        var position = 0, remembered = 0, limit = length - needleLength;
        var criticalByte = loadRaw8(needle + critical + 1);
        var repeated = criticalByte * BYTE_REPEAT;
        while (position <= limit) {
            var rejectedWord = 0;
            /* A C90 byte-scan primitive can skip noncandidates in bulk without
             * outsourcing substring semantics or needing GNU memmem. Both
             * native platforms use it; emulated memory keeps the word filter. */
            if (remembered === 0 && memchr !== 0) {
                var next = callNativeI32(memchr, haystack + position + critical + 1,
                    criticalByte, limit - position + 1);
                if (next === 0) return -1;
                position = next - haystack - critical - 1;
            }
            /* Every skipped position fails at the critical byte. The last
             * candidate and all word loads remain inside the supplied range. */
            if (remembered === 0 && memchr === 0 && limit - position >= SEARCH_WORD_BYTES - 1) {
                var mismatch = loadRaw32(haystack + position + critical + 1) ^ repeated;
                if (((mismatch - BYTE_REPEAT) & ~mismatch & BYTE_HIGH_BITS) === 0) {
                    position = position + SEARCH_WORD_BYTES;
                    rejectedWord = 1;
                }
            }
            if (rejectedWord === 0) {
                var index = critical + 1;
                if (remembered > index) index = remembered;
                while (index < needleLength && loadRaw8(needle + index) === loadRaw8(haystack + position + index)) {
                    index = index + 1;
                }
                if (index < needleLength) {
                    position = position + index - critical; remembered = 0;
                } else {
                    index = critical + 1;
                    while (index > remembered && loadRaw8(needle + index - 1) ===
                            loadRaw8(haystack + position + index - 1)) index = index - 1;
                    if (index <= remembered) return position;
                    position = position + period; remembered = rememberedAfterShift;
                }
            }
        }
        return -1;
    }
    var api = {findBytesKernel: findBytesKernel, constants: constants,
        functions: {findShortBytesKernel: findShortBytesKernel}};
    root.GuestVMByteSearchKernel = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(this));
