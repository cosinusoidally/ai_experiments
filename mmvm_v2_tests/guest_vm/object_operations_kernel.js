/* Shared native object operations. Representation-specific prototype fields
 * are selected here; consumers do not duplicate record offsets. */
(function (root) {
    function objectPrototypeReferenceKernel(heapBase, object) {
        var type = recordType(heapBase, object);
        if (type >= HEAP_TYPE_OBJECT && type <= HEAP_TYPE_BYTECODE_FUNCTION) {
            return objectPrototype(heapBase, object);
        }
        if (type === HEAP_TYPE_REGEXP) return regexpPrototype(heapBase, object);
        if (type === HEAP_TYPE_BUFFER_VIEW) return bufferViewPrototype(heapBase, object);
        return 0;
    }

    function objectReferenceIsObjectKernel(heapBase, object) {
        var type = recordType(heapBase, object);
        if (type >= HEAP_TYPE_OBJECT && type <= HEAP_TYPE_BYTECODE_FUNCTION) return 1;
        if (type === HEAP_TYPE_REGEXP || type === HEAP_TYPE_BUFFER_VIEW) return 1;
        return 0;
    }

    function objectIsPrototypeOfKernel(heapBase, target, receiver, argument) {
        /* ES5.1 15.2.4.6 tests the argument before ToObject(this). */
        if (argument === 0) {
            setValueCellFalse(target);
            return 1;
        }
        if (valueCellTag(0, argument) !== VALUE_TAG_REFERENCE) {
            setValueCellFalse(target);
            return 1;
        }
        var value = valueCellReference(0, argument);
        if (objectReferenceIsObjectKernel(heapBase, value) === 0) {
            setValueCellFalse(target);
            return 1;
        }
        if (receiver === 0) return 0;
        var receiverTag = valueCellTag(0, receiver);
        if (receiverTag === VALUE_TAG_NULL || receiverTag === VALUE_TAG_UNDEFINED) return 0;
        if (receiverTag !== VALUE_TAG_REFERENCE) {
            /* ToObject creates a fresh primitive wrapper. No existing object
             * can have that newly allocated identity in its prototype chain. */
            setValueCellFalse(target);
            return 1;
        }
        var expected = valueCellReference(0, receiver);
        if (objectReferenceIsObjectKernel(heapBase, expected) === 0) {
            setValueCellFalse(target);
            return 1;
        }
        value = objectPrototypeReferenceKernel(heapBase, value);
        while (value !== 0) {
            if (value === expected) {
                setValueCellTrue(target);
                return 1;
            }
            value = objectPrototypeReferenceKernel(heapBase, value);
        }
        setValueCellFalse(target);
        return 1;
    }

    function enumerationKeyVisibleKernel(heapBase, state, root, owner, key, lengthKey) {
        var nearer = root;
        while (nearer !== owner && nearer !== 0) {
            var type = recordType(heapBase, nearer);
            if (type === HEAP_TYPE_ARRAY) {
                if (arrayReserved(heapBase, nearer) === 0 &&
                    stringKeysEqualKernel(heapBase, key, lengthKey) === 1) return 0;
                var index = propertyKeyIndexKernel(heapBase, key);
                if (index >= 0) {
                    var elements = arrayElements(heapBase, nearer);
                    if (index < vectorLength(heapBase, elements) &&
                        valueCellTag(0, vectorCellAddress(heapBase, elements, index)) !== 0) return 0;
                }
            }
            if (type === HEAP_TYPE_OBJECT) {
                if (findCachedOwnObjectPropertyKernel(heapBase, state, nearer, key) !== 0) return 0;
            } else {
                var property = lastOwnPropertyEntryKernel(heapBase, nearer);
                while (property !== 0) {
                    if (stringKeysEqualKernel(heapBase, key,
                            ownPropertyEntryKeyKernel(heapBase, nearer, property)) === 1) return 0;
                    property = previousOwnPropertyEntryKernel(heapBase, nearer, property);
                }
            }
            nearer = objectPrototypeReferenceKernel(heapBase, nearer);
        }
        return 1;
    }

    function enumerationOwnCountKernel(heapBase, state, root, owner, lengthKey) {
        var count = 0;
        var property = lastOwnPropertyEntryKernel(heapBase, owner);
        while (property !== 0) {
            if ((ownPropertyEntryAttributesKernel(heapBase, owner, property) &
                    PROPERTY_ATTRIBUTE_ENUMERABLE) !== 0) {
                if (owner === root || enumerationKeyVisibleKernel(heapBase, state,
                        root, owner, ownPropertyEntryKeyKernel(heapBase, owner, property), lengthKey) === 1) {
                    count = count + 1;
                }
            }
            property = previousOwnPropertyEntryKernel(heapBase, owner, property);
        }
        return count;
    }

    var exports = {functions: {
        enumerationKeyVisibleKernel: enumerationKeyVisibleKernel,
        enumerationOwnCountKernel: enumerationOwnCountKernel,
        objectPrototypeReferenceKernel: objectPrototypeReferenceKernel,
        objectReferenceIsObjectKernel: objectReferenceIsObjectKernel,
        objectIsPrototypeOfKernel: objectIsPrototypeOfKernel
    }};
    root.GuestVMObjectOperationsKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
