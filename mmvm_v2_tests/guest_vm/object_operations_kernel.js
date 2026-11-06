/* Shared native object operations. Representation-specific prototype fields
 * are selected here; consumers do not duplicate record offsets. */
(function (root) {
    var DESCRIPTOR_KIND_FIELDS = 2;
    var DESCRIPTOR_RESULT_FIELDS = 4;
    var STRING_PROPERTY_KEY_UNSUPPORTED = -1;
    var descriptorFieldNames = ["value", "writable", "enumerable", "configurable", "get", "set"];
    var descriptorFieldIndices = {};
    for (var descriptorIndex = 0; descriptorIndex < descriptorFieldNames.length; descriptorIndex++) {
        descriptorFieldIndices[descriptorFieldNames[descriptorIndex].toUpperCase()] = descriptorIndex;
    }
    var DESCRIPTOR_FIELD_NEEDS_CALLBACK = -1;
    var EnumerationMode = {OWN_ENUMERABLE: 0, INHERITED_ENUMERABLE: 1, OWN_NAMES: 2};

    /* Resolve the nearest definition. An ancestor accessor shadowed by a
     * nearer data field must neither be invoked nor force a semantic exit.
     * Zero means absent; the named sentinel means a guest call is required.
     * A returned cell is temporary: no callback/GC may precede its use. */
    function descriptorDataFieldCellKernel(heapBase, state, descriptor,
            stringSupport, fieldIndex) {
        var key = valueCellReference(0, vectorCellAddress(heapBase, stringSupport,
            RUNTIME_SUPPORT_DESCRIPTOR_KEYS_BASE + fieldIndex));
        var owner = namedPropertyOwnerKernel(heapBase, state, descriptor, key);
        if (owner === 0) return 0;
        var entry = findOwnPropertyEntryKernel(heapBase, state, owner, key);
        if ((ownPropertyEntryAttributesKernel(heapBase, owner, entry) & PROPERTY_ATTRIBUTE_ACCESSOR) !== 0) {
            return DESCRIPTOR_FIELD_NEEDS_CALLBACK;
        }
        return ownPropertyEntryValueCellKernel(heapBase, owner, entry);
    }

    /* String primitives expose immutable virtual own properties without
     * allocating a boxed object or one descriptor per character. */
    function stringOwnPropertyKeyKernel(heapBase, string, keyCell, lengthKey) {
        var tag = valueCellTag(0, keyCell), index = -1;
        if (tag === VALUE_TAG_INT32) index = valueCellInt32(0, keyCell);
        else if (tag === VALUE_TAG_REFERENCE) {
            var key = valueCellReference(0, keyCell);
            if (recordType(heapBase, key) !== HEAP_TYPE_STRING) return STRING_PROPERTY_KEY_UNSUPPORTED;
            if (stringKeysEqualKernel(heapBase, key, lengthKey) === 1) return 1;
            index = propertyKeyIndexKernel(heapBase, key);
        } else return STRING_PROPERTY_KEY_UNSUPPORTED;
        if (index >= 0 && index < stringLength(heapBase, string)) return 1;
        return 0;
    }

    function objectIsExtensibleKernel(heapBase, object) {
        if (recordType(heapBase, object) === HEAP_TYPE_OBJECT) return objectExtensible(heapBase, object);
        if ((recordFlags(heapBase, object) & EXOTIC_OBJECT_NON_EXTENSIBLE) !== 0) return 0;
        return 1;
    }

    function objectExtensibilityKernel(heapBase, target, source, prevent) {
        if (source === 0 || valueCellTag(0, source) !== VALUE_TAG_REFERENCE) return 0;
        var object = valueCellReference(0, source);
        if (objectReferenceIsObjectKernel(heapBase, object) === 0) return 0;
        if (prevent !== 0) {
            if (recordType(heapBase, object) === HEAP_TYPE_OBJECT) setObjectExtensible(heapBase, object, 0);
            else setRecordFlags(heapBase, object, recordFlags(heapBase, object) | EXOTIC_OBJECT_NON_EXTENSIBLE);
            copyValueCell(target, source);
        } else if (objectIsExtensibleKernel(heapBase, object) !== 0) setValueCellTrue(target);
        else setValueCellFalse(target);
        return 1;
    }

    /* Build an ordinary descriptor object directly on the guest heap. Dense
     * indexed/exotic properties remain with their specialized semantic path;
     * ordinary objects and function named properties share this operation. */
    function objectOwnPropertyDescriptorKernel(heapBase, state, target,
            registers, argumentsVector, argumentCount, stringSupport, keysBase) {
        if (argumentCount < 2) return 0;
        var ownerCell = programArgumentCellKernel(heapBase, argumentsVector, registers, 0);
        var keyCell = programArgumentCellKernel(heapBase, argumentsVector, registers, 1);
        if (ownerCell === 0 || keyCell === 0) return 0;
        if (valueCellTag(0, ownerCell) !== VALUE_TAG_REFERENCE) return 0;
        var owner = valueCellReference(0, ownerCell), type = recordType(heapBase, owner);
        if (type !== HEAP_TYPE_OBJECT && type !== HEAP_TYPE_NATIVE_FUNCTION &&
            type !== HEAP_TYPE_BYTECODE_FUNCTION) return 0;
        var key = propertyStringKeyReferenceKernel(heapBase, keyCell, stringSupport);
        if (key === 0) return 0;
        var entry = findOwnPropertyEntryKernel(heapBase, state, owner, key);
        if (entry === 0) {
            setValueCellUndefined(target);
            return 1;
        }
        var attributes = ownPropertyEntryAttributesKernel(heapBase, owner, entry);
        var bytes = OBJECT_RECORD_BYTES + PROPERTY_STORAGE_RECORD_BYTES +
            DESCRIPTOR_RESULT_FIELDS * PROPERTY_STORAGE_ENTRY_BYTES;
        if (reserveNativeAllocationKernel(heapBase, state, bytes) === 0) return 0;
        var object = engineHeapBump(heapBase, state), storage = object + OBJECT_RECORD_BYTES;
        setRecordType(heapBase, object, HEAP_TYPE_OBJECT);
        setRecordSize(heapBase, object, OBJECT_RECORD_BYTES);
        setRecordMark(heapBase, object, 0);
        setRecordFlags(heapBase, object, 0);
        setObjectPrototype(heapBase, object, valueCellReference(0,
            vectorCellAddress(heapBase, stringSupport, RUNTIME_SUPPORT_OBJECT_PROTOTYPE)));
        setObjectExtensible(heapBase, object, 1);
        setObjectReserved(heapBase, object, 0);
        initializeOwnPropertyStorageKernel(heapBase, object, storage, DESCRIPTOR_RESULT_FIELDS);
        var accessor = attributes & PROPERTY_ATTRIBUTE_ACCESSOR;
        var index = 0;
        while (index < DESCRIPTOR_RESULT_FIELDS) {
            var keyIndex = index;
            if (accessor !== 0 && index < DESCRIPTOR_KIND_FIELDS) keyIndex = index + DESCRIPTOR_RESULT_FIELDS;
            var resultEntry = ownPropertyEntryDescriptorKernel(heapBase, object, index + 1);
            setPropertyDescriptorKey(0, resultEntry, valueCellReference(0,
                vectorCellAddress(heapBase, stringSupport, keysBase + keyIndex)));
            setPropertyDescriptorAttributes(0, resultEntry, DEFAULT_PROPERTY_ATTRIBUTES);
            setPropertyDescriptorSetter(0, resultEntry, 0);
            var resultCell = propertyDescriptorValueCell(0, resultEntry);
            if (index === 0) copyValueCell(resultCell,
                ownPropertyEntryValueCellKernel(heapBase, owner, entry));
            else if (accessor !== 0 && index === 1) {
                var setter = ownPropertyEntrySetterKernel(heapBase, owner, entry);
                if (setter === 0) setValueCellUndefined(resultCell);
                else setValueCellReference(resultCell, setter);
            } else {
                var flag = PROPERTY_ATTRIBUTE_WRITABLE;
                if (index === DESCRIPTOR_KIND_FIELDS) flag = PROPERTY_ATTRIBUTE_ENUMERABLE;
                else if (index > DESCRIPTOR_KIND_FIELDS) flag = PROPERTY_ATTRIBUTE_CONFIGURABLE;
                if ((attributes & flag) !== 0) setValueCellTrue(resultCell);
                else setValueCellFalse(resultCell);
            }
            index = index + 1;
        }
        setEngineHeapBump(heapBase, state, object + bytes);
        setValueCellReference(target, object);
        return 1;
    }
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

    /* Object-literal data initialization is [[DefineOwnProperty]], not Put.
     * Inherited setters/read-only properties must not affect the new own
     * definition. Duplicate literals may replace a configurable accessor. */
    function defineLiteralDataKernel(heapBase, state, objectCell, keyCell, source) {
        if (valueCellTag(0, objectCell) !== VALUE_TAG_REFERENCE ||
            valueCellTag(0, keyCell) !== VALUE_TAG_REFERENCE) return 0;
        var object = valueCellReference(0, objectCell), key = valueCellReference(0, keyCell);
        if (recordType(heapBase, object) !== HEAP_TYPE_OBJECT ||
            recordType(heapBase, key) !== HEAP_TYPE_STRING) return 0;
        var entry = findCachedOwnObjectPropertyKernel(heapBase, state, object, key);
        if (entry === 0) entry = appendOwnPropertyEntryKernel(heapBase, state,
            object, key, DEFAULT_PROPERTY_ATTRIBUTES);
        if (entry === 0) return 0;
        setOwnPropertyEntryAttributesKernel(heapBase, object, entry, DEFAULT_PROPERTY_ATTRIBUTES);
        setOwnPropertyEntrySetterKernel(heapBase, object, entry, 0);
        copyValueCell(ownPropertyEntryValueCellKernel(heapBase, object, entry), source);
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
        return arrayJoinKernel(heapBase, state, target, array, separator, stringSupport);
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

    var exports = {descriptorFieldNames: descriptorFieldNames,
      EnumerationMode: EnumerationMode,
      descriptorFieldIndices: descriptorFieldIndices,
      constants: {STRING_PROPERTY_KEY_UNSUPPORTED: STRING_PROPERTY_KEY_UNSUPPORTED,
                  DESCRIPTOR_FIELD_NEEDS_CALLBACK: DESCRIPTOR_FIELD_NEEDS_CALLBACK,
                  DESCRIPTOR_KIND_FIELDS: DESCRIPTOR_KIND_FIELDS,
                  DESCRIPTOR_RESULT_FIELDS: DESCRIPTOR_RESULT_FIELDS}, functions: {
        objectIsExtensibleKernel: objectIsExtensibleKernel,
        descriptorDataFieldCellKernel: descriptorDataFieldCellKernel,
        stringOwnPropertyKeyKernel: stringOwnPropertyKeyKernel,
        objectExtensibilityKernel: objectExtensibilityKernel,
        objectOwnPropertyDescriptorKernel: objectOwnPropertyDescriptorKernel,
        objectClassIndexKernel: objectClassIndexKernel,
        objectToStringKernel: objectToStringKernel,
        defineLiteralDataKernel: defineLiteralDataKernel,
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
