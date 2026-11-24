/* Collector-workspace protocol shared by both free-index producers. Raw
 * workspace addressing is confined to these named layout accessors. */
(function (root) {
    var Heap = root.GuestVMHeap;
    if (typeof module !== "undefined" && module.exports) Heap = require("../heap.js");
    var layout = {COUNT_WORD: 0, BUMP_WORD: 1, FREE_BYTES_WORD: 2, FIRST_ADDRESS_WORD: 3};
    function setFreeIndexCountKernel(heapBase, output, count) {
        store32(heapBase + output + OUTPUT_COUNT_WORD * WORD_BYTES, count);
        return count;
    }
    function setFreeIndexBumpKernel(heapBase, output, bump) {
        store32(heapBase + output + OUTPUT_BUMP_WORD * WORD_BYTES, bump);
        return bump;
    }
    function setFreeIndexBytesKernel(heapBase, output, bytes) {
        store32(heapBase + output + OUTPUT_FREE_BYTES_WORD * WORD_BYTES, bytes);
        return bytes;
    }
    function setFreeIndexEntryKernel(heapBase, output, index, address) {
        store32(heapBase + output + (OUTPUT_FIRST_ADDRESS_WORD + index) * WORD_BYTES, address);
        return address;
    }
    function freeIndexEntryKernel(heapBase, output, index) {
        return load32(heapBase + output + (OUTPUT_FIRST_ADDRESS_WORD + index) * WORD_BYTES);
    }
    function recoverTrackedFreeBlocksKernel(heapBase, heapBump, output, outputLimit,
                                            freeHead, retiredHead, remainder, count) {
        var freeBytes = 0;
        var initial = 0;
        while (initial < count) {
            freeBytes = freeBytes + recordSize(heapBase, freeIndexEntryKernel(heapBase, output, initial));
            initial = initial + 1;
        }
        var pass = 0;
        var overflow = 0;
        while (pass < 3) {
            var region = freeHead;
            if (pass === 1) region = retiredHead;
            if (pass === 2) region = remainder;
            while (region !== 0) {
                if (region < HEAP_FIRST_RECORD || region > heapBump - RECORD_HEADER_BYTES ||
                        (region & RECORD_ALIGNMENT_MASK) !== 0) return -2;
                if (recordType(heapBase, region) !== HEAP_TYPE_FREE || recordFlags(heapBase, region) !== 0) return -2;
                var size = recordSize(heapBase, region);
                if (size < RECORD_HEADER_BYTES || (size & RECORD_ALIGNMENT_MASK) !== 0 ||
                        size > heapBump - region) return -2;
                var next = recordMark(heapBase, region);
                setRecordMark(heapBase, region, 0);
                freeBytes = freeBytes + size;
                if (output + (OUTPUT_FIRST_ADDRESS_WORD + count + 1) * WORD_BYTES > outputLimit) {
                    overflow = 1;
                } else {
                    setFreeIndexEntryKernel(heapBase, output, count, region);
                    count = count + 1;
                }
                if (pass === 2) next = 0;
                region = next;
            }
            pass = pass + 1;
        }
        /* All links were cleared even on workspace exhaustion, so the caller
         * can safely fall back to the complete record walk. Coalescing and
         * tail trimming remain the collector's responsibility. */
        if (overflow !== 0) return -1;
        setFreeIndexCountKernel(heapBase, output, count);
        setFreeIndexBumpKernel(heapBase, output, heapBump);
        setFreeIndexBytesKernel(heapBase, output, freeBytes);
        return count;
    }
    var exported = {layout: layout, constants: {
        WORD_BYTES: Heap.WORD_BYTES,
        OUTPUT_COUNT_WORD: layout.COUNT_WORD,
        OUTPUT_BUMP_WORD: layout.BUMP_WORD,
        OUTPUT_FREE_BYTES_WORD: layout.FREE_BYTES_WORD,
        OUTPUT_FIRST_ADDRESS_WORD: layout.FIRST_ADDRESS_WORD
    }, functions: {
        setFreeIndexCountKernel: setFreeIndexCountKernel,
        setFreeIndexBumpKernel: setFreeIndexBumpKernel,
        setFreeIndexBytesKernel: setFreeIndexBytesKernel,
        setFreeIndexEntryKernel: setFreeIndexEntryKernel,
        freeIndexEntryKernel: freeIndexEntryKernel,
        recoverTrackedFreeBlocksKernel: recoverTrackedFreeBlocksKernel
    }};
    root.GuestVMFreeIndexKernel = exported;
    if (typeof module !== "undefined" && module.exports) module.exports = exported;
}(this));
