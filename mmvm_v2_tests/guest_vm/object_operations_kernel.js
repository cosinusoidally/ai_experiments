/* Shared native object operations. Representation-specific prototype fields
 * are selected here; consumers do not duplicate record offsets. */
(function (root) {
    /* ES5.1 [[Class]] is not inferred from an object's public prototype or
     * constructor. Date/Error identity lives in object-record flags; wrapper
     * primitives and Arguments already have dedicated internal storage. */
    function objectClassIndexKernel(heapBase, receiver, stringSupport) {
        var tag = valueCellTag(0, receiver);
        if (tag === VALUE_TAG_UNDEFINED) return OBJECT_CLASS_UNDEFINED;
        if (tag === VALUE_TAG_NULL) return OBJECT_CLASS_NULL;
        if (tag === VALUE_TAG_TRUE || tag === VALUE_TAG_FALSE) return OBJECT_CLASS_BOOLEAN;
        if (tag === VALUE_TAG_INT32 || tag === VALUE_TAG_DOUBLE) return OBJECT_CLASS_NUMBER;
        if (tag !== VALUE_TAG_REFERENCE) return OBJECT_CLASS_OBJECT;
        var object = valueCellReference(0, receiver), type = recordType(heapBase, object);
        if (type === HEAP_TYPE_STRING) return OBJECT_CLASS_STRING;
        if (type === HEAP_TYPE_ARRAY) {
            if (arrayReserved(heapBase, object) !== 0) return OBJECT_CLASS_ARGUMENTS;
            return OBJECT_CLASS_ARRAY;
        }
        if (type === HEAP_TYPE_NATIVE_FUNCTION || type === HEAP_TYPE_BYTECODE_FUNCTION) return OBJECT_CLASS_FUNCTION;
        if (type === HEAP_TYPE_REGEXP) return OBJECT_CLASS_REGEXP;
        if (type === HEAP_TYPE_OBJECT) {
            var classFlags = recordFlags(heapBase, object);
            if ((classFlags & OBJECT_CLASS_DATE_FLAG) !== 0) return OBJECT_CLASS_DATE;
            if ((classFlags & OBJECT_CLASS_ERROR_FLAG) !== 0) return OBJECT_CLASS_ERROR;
            var wrapped = primitiveWrapperValueCellKernel(heapBase, object, stringSupport);
            if (wrapped !== 0) {
                var wrappedTag = valueCellTag(0, wrapped);
                if (wrappedTag === VALUE_TAG_INT32 || wrappedTag === VALUE_TAG_DOUBLE) return OBJECT_CLASS_NUMBER;
                if (wrappedTag === VALUE_TAG_TRUE || wrappedTag === VALUE_TAG_FALSE) return OBJECT_CLASS_BOOLEAN;
                if (wrappedTag === VALUE_TAG_REFERENCE &&
                    recordType(heapBase, valueCellReference(0, wrapped)) === HEAP_TYPE_STRING) return OBJECT_CLASS_STRING;
            }
        }
        return OBJECT_CLASS_OBJECT;
    }

    function objectToStringKernel(heapBase, target, receiver, stringSupport) {
        var classIndex = objectClassIndexKernel(heapBase, receiver, stringSupport);
        copyValueCell(target, vectorCellAddress(heapBase, stringSupport,
            RUNTIME_SUPPORT_OBJECT_TAG_BASE + classIndex));
        return 1;
    }

    function dataMethodIntrinsicKernel(heapBase, object, key) {
        while (object !== 0) {
            var entry = lastOwnPropertyEntryKernel(heapBase, object);
            while (entry !== 0) {
                if (stringKeysEqualKernel(heapBase,
                    ownPropertyEntryKeyKernel(heapBase, object, entry), key) === 1) {
                    if ((ownPropertyEntryAttributesKernel(heapBase, object, entry) &
                         PROPERTY_ATTRIBUTE_ACCESSOR) !== 0) return -1;
                    var cell = ownPropertyEntryValueCellKernel(heapBase, object, entry);
                    if (valueCellTag(0, cell) !== VALUE_TAG_REFERENCE) return -1;
                    var method = valueCellReference(0, cell);
                    if (recordType(heapBase, method) !== HEAP_TYPE_NATIVE_FUNCTION) return -1;
                    return nativeFunctionMetadata(heapBase, method);
                }
                entry = previousOwnPropertyEntryKernel(heapBase, object, entry);
            }
            object = objectPrototypeReferenceKernel(heapBase, object);
        }
        return -1;
    }

    function arrayBuiltinStringKernel(heapBase, state, target, source, stringSupport) {
        if (valueCellTag(0, source) !== VALUE_TAG_REFERENCE) return 0;
        var array = valueCellReference(0, source);
        if (recordType(heapBase, array) !== HEAP_TYPE_ARRAY) return 0;
        /* Explicit indexed descriptors and holes may invoke guest getters.
         * Decline those rather than reading an unobservable dense shortcut. */
        if (arrayReserved(heapBase, array) !== 0 || arrayPropertyHead(heapBase, array) !== 0) return 0;
        var elements = arrayElements(heapBase, array), index = 0;
        while (index < vectorLength(heapBase, elements)) {
            if (valueCellTag(0, vectorCellAddress(heapBase, elements, index)) === 0) return 0;
            index++;
        }
        var joinKey = valueCellReference(0, vectorCellAddress(heapBase,
            stringSupport, RUNTIME_SUPPORT_JOIN_KEY));
        if (dataMethodIntrinsicKernel(heapBase, array, joinKey) !== INTRINSIC_ARRAY_JOIN) return 0;
        var separator = valueCellReference(0, vectorCellAddress(heapBase,
            stringSupport, RUNTIME_SUPPORT_COMMA_STRING));
        return arrayJoinKernel(heapBase, state, target, array, separator);
    }

    function arrayDefaultPrimitiveKernel(heapBase, state, target, source, stringSupport) {
        if (valueCellTag(0, source) !== VALUE_TAG_REFERENCE) return 0;
        var array = valueCellReference(0, source);
        if (recordType(heapBase, array) !== HEAP_TYPE_ARRAY) return 0;
        var valueOfKey = valueCellReference(0, vectorCellAddress(heapBase,
            stringSupport, RUNTIME_SUPPORT_VALUE_OF_KEY));
        var toStringKey = valueCellReference(0, vectorCellAddress(heapBase,
            stringSupport, RUNTIME_SUPPORT_TO_STRING_KEY));
        if (dataMethodIntrinsicKernel(heapBase, array, valueOfKey) !== INTRINSIC_OBJECT_VALUE_OF) return 0;
        if (dataMethodIntrinsicKernel(heapBase, array, toStringKey) !== INTRINSIC_ARRAY_TO_STRING) return 0;
        return arrayBuiltinStringKernel(heapBase, state, target, source, stringSupport);
    }

    /* Guarded string-hint conversion for String primitives/wrappers. Do not
     * unwrap an object with a custom/getter toString: its call is observable.
     * A zero result declines conversion without changing the key operand. */
    function propertyStringKeyReferenceKernel(heapBase, keyCell, stringSupport) {
        if (valueCellTag(0, keyCell) !== VALUE_TAG_REFERENCE) return 0;
        var key = valueCellReference(0, keyCell);
        if (recordType(heapBase, key) === HEAP_TYPE_STRING) return key;
        var wrapped = primitiveWrapperValueCellKernel(heapBase, key, stringSupport);
        if (wrapped === 0 || valueCellTag(0, wrapped) !== VALUE_TAG_REFERENCE) return 0;
        var string = valueCellReference(0, wrapped);
        if (recordType(heapBase, string) !== HEAP_TYPE_STRING) return 0;
        var methodKey = valueCellReference(0, vectorCellAddress(heapBase,
            stringSupport, RUNTIME_SUPPORT_TO_STRING_KEY));
        while (key !== 0) {
            var entry = lastOwnPropertyEntryKernel(heapBase, key);
            while (entry !== 0) {
                if (stringKeysEqualKernel(heapBase,
                    ownPropertyEntryKeyKernel(heapBase, key, entry), methodKey) === 1) {
                    if ((ownPropertyEntryAttributesKernel(heapBase, key, entry) &
                         PROPERTY_ATTRIBUTE_ACCESSOR) !== 0) return 0;
                    var methodCell = ownPropertyEntryValueCellKernel(heapBase, key, entry);
                    if (valueCellTag(0, methodCell) !== VALUE_TAG_REFERENCE) return 0;
                    var method = valueCellReference(0, methodCell);
                    if (recordType(heapBase, method) !== HEAP_TYPE_NATIVE_FUNCTION) return 0;
                    if (nativeFunctionMetadata(heapBase, method) !== INTRINSIC_STRING_VALUE_OF) return 0;
                    return string;
                }
                entry = previousOwnPropertyEntryKernel(heapBase, key, entry);
            }
            key = objectPrototypeReferenceKernel(heapBase, key);
        }
        return 0;
    }
    /* Numeric syntax must honor an explicit own descriptor before a dense
     * array cell. Resolve its insertion-order entry without allocating a
     * temporary decimal key string. The returned address is transient. */
    function indexedOwnPropertyDescriptorKernel(heapBase, state, owner, index) {
        var digits = integerDecimalLengthKernel(index);
        var hash = STRING_HASH_OFFSET_BASIS, digit = 0;
        while (digit < digits) {
            hash = stringHashStep(hash, integerDecimalCodeUnitKernel(index, digit));
            digit = digit + 1;
        }
        var entry = numericOwnPropertyEntryKernel(heapBase, state, owner, index, digits, hash);
        if (entry === 0) return 0;
        return ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
    }

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
        objectClassIndexKernel: objectClassIndexKernel,
        objectToStringKernel: objectToStringKernel,
        dataMethodIntrinsicKernel: dataMethodIntrinsicKernel,
        arrayBuiltinStringKernel: arrayBuiltinStringKernel,
        arrayDefaultPrimitiveKernel: arrayDefaultPrimitiveKernel,
        propertyStringKeyReferenceKernel: propertyStringKeyReferenceKernel,
        indexedOwnPropertyDescriptorKernel: indexedOwnPropertyDescriptorKernel,
        enumerationKeyVisibleKernel: enumerationKeyVisibleKernel,
        enumerationOwnCountKernel: enumerationOwnCountKernel,
        objectPrototypeReferenceKernel: objectPrototypeReferenceKernel,
        objectReferenceIsObjectKernel: objectReferenceIsObjectKernel,
        objectIsPrototypeOfKernel: objectIsPrototypeOfKernel
    }};
    root.GuestVMObjectOperationsKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
