/* Allocation-free guest string-key operations, shared by property lookup
 * and both interpreter backends. Accesses use named record primitives;
 * hashing may cache a hash but never allocates or invokes guest code. */
(function (root) {
    function stringKeysEqualKernel(heapBase, left, right) {
        if (left === right) return 1;
        var length = stringLength(heapBase, left);
        if (length !== stringLength(heapBase, right)) return 0;
        if (length === 0) return 1;
        if (stringKeyHashKernel(heapBase, left) !==
                stringKeyHashKernel(heapBase, right)) return 0;
        /* Views are immutable. Resolve their storage once, not once per code
         * unit. A rope still uses the general traversal below. Offsets stay
         * relative to the backing; no absolute pointer is retained. */
        var leftBacking = left;
        var rightBacking = right;
        var leftStart = 0;
        var rightStart = 0;
        var leftFlags = recordFlags(heapBase, leftBacking);
        var rightFlags = recordFlags(heapBase, rightBacking);
        while ((leftFlags & RecordLayout.STRING_SLICE_FLAG) !== 0) {
            leftStart = leftStart + stringSliceStart(heapBase, leftBacking);
            leftBacking = stringSliceBacking(heapBase, leftBacking);
            leftFlags = recordFlags(heapBase, leftBacking);
        }
        while ((rightFlags & RecordLayout.STRING_SLICE_FLAG) !== 0) {
            rightStart = rightStart + stringSliceStart(heapBase, rightBacking);
            rightBacking = stringSliceBacking(heapBase, rightBacking);
            rightFlags = recordFlags(heapBase, rightBacking);
        }
        if (leftBacking === rightBacking && leftStart === rightStart) return 1;
        var index = 0;
        if (((leftFlags | rightFlags) & RecordLayout.STRING_ROPE_FLAG) === 0) {
            var leftLatin1 = leftFlags & RecordLayout.STRING_LATIN1_FLAG;
            var rightLatin1 = rightFlags & RecordLayout.STRING_LATIN1_FLAG;
            if (leftLatin1 === rightLatin1) {
                var byteLength = length;
                if (leftLatin1 === 0) {
                    byteLength = byteLength * 2;
                    leftStart = leftStart * 2;
                    rightStart = rightStart * 2;
                }
                /* Both encodings are little-endian. Complete words are
                 * bounded by the view length; tail bytes never overread it. */
                while (index + 4 <= byteLength) {
                    if (flatStringStorageWord(heapBase, leftBacking, leftStart + index) !==
                            flatStringStorageWord(heapBase, rightBacking, rightStart + index)) return 0;
                    index = index + 4;
                }
                while (index < byteLength) {
                    if (flatStringStorageByte(heapBase, leftBacking, leftStart + index) !==
                            flatStringStorageByte(heapBase, rightBacking, rightStart + index)) return 0;
                    index = index + 1;
                }
            } else {
                while (index < length) {
                    var leftUnit = 0;
                    var rightUnit = 0;
                    if (leftLatin1 !== 0) leftUnit = latin1StringCharacterCodeUnit(
                        heapBase, leftBacking, leftStart + index);
                    else leftUnit = flatStringCharacterCodeUnit(
                        heapBase, leftBacking, leftStart + index) & 65535;
                    if (rightLatin1 !== 0) rightUnit = latin1StringCharacterCodeUnit(
                        heapBase, rightBacking, rightStart + index);
                    else rightUnit = flatStringCharacterCodeUnit(
                        heapBase, rightBacking, rightStart + index) & 65535;
                    if (leftUnit !== rightUnit) return 0;
                    index = index + 1;
                }
            }
            return 1;
        }
        while (index < length) {
            if ((stringCharacterCodeUnit(heapBase, left, index) & 65535) !==
                (stringCharacterCodeUnit(heapBase, right, index) & 65535)) {
                return 0;
            }
            index = index + 1;
        }
        return 1;
    }

    /* Hashes produced by other string constructors are not assumed canonical.
     * A separate validity flag distinguishes a cached zero hash from unknown
     * and guarantees identical key hashes under both kernel backends. Hash
     * collisions still take the exact code-unit comparison above. */
    function stringKeyHashKernel(heapBase, string) {
        if ((recordFlags(heapBase, string) & RecordLayout.STRING_KEY_HASH_FLAG) === 0) {
            return computeStringKeyHashKernel(heapBase, string);
        }
        return stringHash(heapBase, string) | 0;
    }

    function computeStringKeyHashKernel(heapBase, string) {
        var hash = RecordLayout.STRING_HASH_OFFSET_BASIS;
        var length = stringLength(heapBase, string);
        var index = 0;
        while (index < length) {
            hash = stringHashStep(hash,
                stringCharacterCodeUnit(heapBase, string, index) & 65535);
            index = index + 1;
        }
        setStringHash(heapBase, string, hash);
        setRecordFlags(heapBase, string,
            recordFlags(heapBase, string) | RecordLayout.STRING_KEY_HASH_FLAG);
        return hash;
    }

    /* Flat and rope strings share the ordinary STRING record type and length
     * field. Rope records are immutable internal nodes whose flag selects two
     * child references in place of inline UTF-16 data. Keeping traversal in a
     * kernel function gives the Node and i386 backends identical semantics. */
    function stringCharacterCodeUnit(heapBase, string, index) {
        var flags = recordFlags(heapBase, string);
        if ((flags & (RecordLayout.STRING_ROPE_FLAG | RecordLayout.STRING_SLICE_FLAG)) !== 0) {
            return indirectStringCharacterCodeUnitKernel(heapBase, string, index);
        }
        if ((flags & RecordLayout.STRING_LATIN1_FLAG) !== 0) {
            return latin1StringCharacterCodeUnit(heapBase, string, index);
        }
        /* The flat storage primitive reads a word. This logical accessor
         * must return only the requested UTF-16 code unit, independently of
         * the following character or unused bytes after the string. */
        return flatStringCharacterCodeUnit(heapBase, string, index) & 65535;
    }

    /* Keep the common flat load small enough for the normal, bounded kernel
     * inliner. Trees/views use this one shared traversal rather than copying
     * its loops and temporary registers into every character-reading site. */
    function indirectStringCharacterCodeUnitKernel(heapBase, string, index) {
        var flags = recordFlags(heapBase, string);
        while ((flags & (RecordLayout.STRING_ROPE_FLAG | RecordLayout.STRING_SLICE_FLAG)) !== 0) {
            if ((flags & RecordLayout.STRING_SLICE_FLAG) !== 0) {
                index = index + stringSliceStart(heapBase, string);
                string = stringSliceBacking(heapBase, string);
            } else {
                var left = stringRopeLeft(heapBase, string);
                var leftLength = stringLength(heapBase, left);
                if (index < leftLength) string = left;
                else {
                    index = index - leftLength;
                    string = stringRopeRight(heapBase, string);
                }
            }
            flags = recordFlags(heapBase, string);
        }
        if ((flags & RecordLayout.STRING_LATIN1_FLAG) !== 0) {
            return latin1StringCharacterCodeUnit(heapBase, string, index);
        }
        return flatStringCharacterCodeUnit(heapBase, string, index) & 65535;
    }

    var functions = {
        stringKeysEqualKernel: stringKeysEqualKernel,
        stringKeyHashKernel: stringKeyHashKernel,
        computeStringKeyHashKernel: computeStringKeyHashKernel,
        stringCharacterCodeUnit: stringCharacterCodeUnit,
        indirectStringCharacterCodeUnitKernel: indirectStringCharacterCodeUnitKernel
    };
    root.GuestVMStringKeyKernel = functions;
    if (typeof module !== "undefined" && module.exports) module.exports = functions;
}(this));
