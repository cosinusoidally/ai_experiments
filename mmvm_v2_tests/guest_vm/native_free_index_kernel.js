/* Nonmoving native free-space index. The region chain remains authoritative
 * for ownership handoff; size bins are a disposable index into that chain.
 * No allocation, host callback or machine-code literal is used here. */
(function (root) {
    function lowestFreeBitKernel(bits) {
        var index = 0;
        if ((bits & 65535) === 0) { bits = bits >>> 16; index = index + 16; }
        if ((bits & 255) === 0) { bits = bits >>> 8; index = index + 8; }
        if ((bits & 15) === 0) { bits = bits >>> 4; index = index + 4; }
        if ((bits & 3) === 0) { bits = bits >>> 2; index = index + 2; }
        if ((bits & 1) === 0) index = index + 1;
        return index;
    }

    function nativeFreeBinKernel(bytes) {
        if (bytes <= MIN_NATIVE_REGION_BYTES) return 0;
        if (bytes <= NATIVE_FREE_SMALL_MAX) {
            return divideI32(bytes - MIN_NATIVE_REGION_BYTES, HEAP_RECORD_ALIGNMENT);
        }
        var level = NATIVE_FREE_LARGE_MIN_SHIFT;
        var remaining = bytes >>> NATIVE_FREE_LARGE_MIN_SHIFT;
        while (remaining > 1) { remaining = remaining >>> 1; level = level + 1; }
        var subclass = (bytes >>> (level - NATIVE_FREE_SUBCLASS_BITS)) &
            (NATIVE_FREE_SUBCLASS_COUNT - 1);
        return NATIVE_FREE_SMALL_COUNT +
            (level - NATIVE_FREE_LARGE_MIN_SHIFT) * NATIVE_FREE_SUBCLASS_COUNT + subclass;
    }

    function nativeFreeBinLowerBoundKernel(bin) {
        if (bin < NATIVE_FREE_SMALL_COUNT) {
            return MIN_NATIVE_REGION_BYTES + bin * HEAP_RECORD_ALIGNMENT;
        }
        var largeBin = bin - NATIVE_FREE_SMALL_COUNT;
        var level = (largeBin >>> NATIVE_FREE_SUBCLASS_BITS) + NATIVE_FREE_LARGE_MIN_SHIFT;
        var subclass = largeBin & (NATIVE_FREE_SUBCLASS_COUNT - 1);
        return (1 << level) + (subclass << (level - NATIVE_FREE_SUBCLASS_BITS));
    }

    function clearNativeFreeIndexKernel(heapBase, state) {
        var index = 0;
        while (index < NATIVE_FREE_BIN_COUNT) {
            setEngineFreeBinHead(heapBase, state, index, 0);
            index = index + 1;
        }
        index = 0;
        while (index < NATIVE_FREE_BITMAP_WORDS) {
            setEngineFreeBinBitmap(heapBase, state, index, 0);
            index = index + 1;
        }
        setEngineFreeBinSummary(heapBase, state, 0);
        setEngineFreeIndexValid(heapBase, state, 1);
        return 0;
    }

    function linkNativeFreeBinKernel(heapBase, state, region) {
        var bin = nativeFreeBinKernel(recordSize(heapBase, region));
        var head = engineFreeBinHead(heapBase, state, bin);
        setFreeBinPrevious(heapBase, region, 0);
        setFreeBinNext(heapBase, region, head);
        if (head !== 0) setFreeBinPrevious(heapBase, head, region);
        setEngineFreeBinHead(heapBase, state, bin, region);
        var word = bin >>> 5;
        setEngineFreeBinBitmap(heapBase, state, word,
            engineFreeBinBitmap(heapBase, state, word) | (1 << (bin & 31)));
        setEngineFreeBinSummary(heapBase, state,
            engineFreeBinSummary(heapBase, state) | (1 << word));
        return 0;
    }

    function ensureNativeFreeIndexKernel(heapBase, state) {
        if (engineFreeIndexValid(heapBase, state) !== 0) return 0;
        var cleared = clearNativeFreeIndexKernel(heapBase, state);
        var region = engineNativeFreeRegion(heapBase, state);
        var previous = 0;
        while (region !== 0) {
            setFreeRegionPrevious(heapBase, region, previous);
            var linked = linkNativeFreeBinKernel(heapBase, state, region);
            previous = region;
            region = recordMark(heapBase, region);
        }
        return 0;
    }

    function insertNativeFreeRegionKernel(heapBase, state, region) {
        var ensured = ensureNativeFreeIndexKernel(heapBase, state);
        var head = engineNativeFreeRegion(heapBase, state);
        setFreeRegionPrevious(heapBase, region, 0);
        setRecordMark(heapBase, region, head);
        if (head !== 0) setFreeRegionPrevious(heapBase, head, region);
        setEngineNativeFreeRegion(heapBase, state, region);
        return linkNativeFreeBinKernel(heapBase, state, region);
    }

    function nextNativeFreeBinKernel(heapBase, state, first) {
        if (first >= NATIVE_FREE_BIN_COUNT) return -1;
        var word = first >>> 5;
        var bits = engineFreeBinBitmap(heapBase, state, word) & (-1 << (first & 31));
        if (bits === 0) {
            var summary = engineFreeBinSummary(heapBase, state) & (-1 << (word + 1));
            if (summary === 0) return -1;
            word = lowestFreeBitKernel(summary);
            bits = engineFreeBinBitmap(heapBase, state, word);
        }
        return word * 32 + lowestFreeBitKernel(bits);
    }

    function takeNativeFreeRegionKernel(heapBase, state, bytes) {
        var ensured = ensureNativeFreeIndexKernel(heapBase, state);
        var required = bytes + FREE_RECORD_HEADER_BYTES;
        if (required < bytes) return 0;
        var containing = nativeFreeBinKernel(required);
        var preferred = containing;
        if (nativeFreeBinLowerBoundKernel(containing) < required) preferred = preferred + 1;
        var bin = nextNativeFreeBinKernel(heapBase, state, preferred);
        var region = 0;
        if (bin >= 0) region = engineFreeBinHead(heapBase, state, bin);
        else {
            /* Rounded-up classes avoid searching undersized fragments. If
             * they are empty, search the one partial class: usable capacity
             * must not be rejected merely because it falls inside a bucket. */
            bin = containing;
            region = engineFreeBinHead(heapBase, state, bin);
            while (region !== 0 && recordSize(heapBase, region) < required) {
                region = freeBinNext(heapBase, region);
            }
        }
        if (region === 0) return 0;
        var previous = freeRegionPrevious(heapBase, region);
        var next = recordMark(heapBase, region);
        if (previous === 0) setEngineNativeFreeRegion(heapBase, state, next);
        else setRecordMark(heapBase, previous, next);
        if (next !== 0) setFreeRegionPrevious(heapBase, next, previous);
        var binPrevious = freeBinPrevious(heapBase, region);
        var binNext = freeBinNext(heapBase, region);
        if (binPrevious === 0) setEngineFreeBinHead(heapBase, state, bin, binNext);
        else setFreeBinNext(heapBase, binPrevious, binNext);
        if (binNext !== 0) setFreeBinPrevious(heapBase, binNext, binPrevious);
        if (engineFreeBinHead(heapBase, state, bin) === 0) {
            var word = bin >>> 5;
            var bits = engineFreeBinBitmap(heapBase, state, word) & ~(1 << (bin & 31));
            setEngineFreeBinBitmap(heapBase, state, word, bits);
            if (bits === 0) setEngineFreeBinSummary(heapBase, state,
                engineFreeBinSummary(heapBase, state) & ~(1 << word));
        }
        return region;
    }

    function activateNativeFreeRegionKernel(heapBase, state, bytes) {
        var region = takeNativeFreeRegionKernel(heapBase, state, bytes);
        if (region === 0) return 0;
        var regionSize = recordSize(heapBase, region);
        var arenaBytes = bytes + FREE_RECORD_HEADER_BYTES;
        if (arenaBytes < PREFERRED_NATIVE_REGION_BYTES) arenaBytes = PREFERRED_NATIVE_REGION_BYTES;
        var end = region + regionSize;
        if (regionSize - arenaBytes >= MIN_NATIVE_REGION_BYTES) {
            var suffix = region + arenaBytes;
            setRecordType(heapBase, suffix, HEAP_TYPE_FREE);
            setRecordSize(heapBase, suffix, regionSize - arenaBytes);
            setRecordMark(heapBase, suffix, 0);
            setRecordFlags(heapBase, suffix, 0);
            var inserted = insertNativeFreeRegionKernel(heapBase, state, suffix);
            end = suffix;
        }
        setEngineNativeRegionEnd(heapBase, state, end);
        setEngineNativeRegionActive(heapBase, state, 1);
        setEngineHeapBump(heapBase, state, region);
        setEngineHeapLimit(heapBase, state, end - FREE_RECORD_HEADER_BYTES);
        return 1;
    }

    var exported = {
        lowestFreeBitKernel: lowestFreeBitKernel,
        nativeFreeBinKernel: nativeFreeBinKernel,
        nativeFreeBinLowerBoundKernel: nativeFreeBinLowerBoundKernel,
        clearNativeFreeIndexKernel: clearNativeFreeIndexKernel,
        linkNativeFreeBinKernel: linkNativeFreeBinKernel,
        ensureNativeFreeIndexKernel: ensureNativeFreeIndexKernel,
        insertNativeFreeRegionKernel: insertNativeFreeRegionKernel,
        nextNativeFreeBinKernel: nextNativeFreeBinKernel,
        takeNativeFreeRegionKernel: takeNativeFreeRegionKernel,
        activateNativeFreeRegionKernel: activateNativeFreeRegionKernel
    };
    root.GuestVMNativeFreeIndexKernel = exported;
    if (typeof module !== "undefined" && module.exports) module.exports = exported;
}(this));
