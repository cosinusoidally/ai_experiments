/* Raw-memory bulk ingress for ordinary dense integer arrays. This is a
 * storage operation, not a compiler/benchmark shortcut. It neither allocates
 * nor invokes guest callbacks. A declined transfer makes no writes; callers
 * retain their ordinary element-by-element fallback. The destination must
 * be independently owned native storage, disjoint from the source array. */
(function (root) {
    function tryCopyInt32ArrayKernel(heapBase, pointer, source) {
        if (recordType(heapBase, source) !== HEAP_TYPE_ARRAY) return 0;
        if (arrayReserved(heapBase, source) !== 0) return 0;
        /* Descriptors/arguments can have observable indexed reads. Even an
         * unrelated named property conservatively declines this fast path. */
        if (arrayPropertyHead(heapBase, source) !== 0) return 0;
        var elements = arrayElements(heapBase, source);
        var length = vectorLength(heapBase, elements);
        if (length < 0 || length > vectorCapacity(heapBase, elements)) return 0;
        var index = 0;
        while (index < length) {
            var cell = vectorCellAddress(heapBase, elements, index);
            if (valueCellTag(0, cell) !== VALUE_TAG_INT32) return 0;
            index = index + 1;
        }
        index = 0;
        while (index < length) {
            var sourceCell = vectorCellAddress(heapBase, elements, index);
            storeRaw32(pointer + index * HEAP_WORD_BYTES,
                       valueCellInt32(0, sourceCell));
            index = index + 1;
        }
        return 1;
    }

    function copyInt32ArrayIntrinsicKernel(heapBase, target, registers,
                                           argumentsVector, argumentCount) {
        var copied = 0;
        if (argumentCount >= 2) {
            var pointerCell = programArgumentCellKernel(
                heapBase, argumentsVector, registers, 0);
            var arrayCell = programArgumentCellKernel(
                heapBase, argumentsVector, registers, 1);
            if (pointerCell !== 0 && arrayCell !== 0) {
                if (valueCellTag(0, pointerCell) === VALUE_TAG_INT32 &&
                    valueCellTag(0, arrayCell) === VALUE_TAG_REFERENCE) {
                    copied = tryCopyInt32ArrayKernel(heapBase,
                        valueCellInt32(0, pointerCell), valueCellReference(0, arrayCell));
                }
            }
        }
        /* A valid caller can reuse an input register as the result slot. */
        if (copied === 1) setValueCellTrue(target);
        else setValueCellFalse(target);
        return 1;
    }

    var exports = {functions: {
        tryCopyInt32ArrayKernel: tryCopyInt32ArrayKernel,
        copyInt32ArrayIntrinsicKernel: copyInt32ArrayIntrinsicKernel
    }};
    root.GuestVMMemoryTransferKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
