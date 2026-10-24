/* Optional compact indexes for ordinary objects with long property lists.
 * Lists remain authoritative for enumeration, descriptors and GC ownership.
 * An object strongly owns its index record; slots are derived offsets whose
 * properties are kept live by that object's list. Deletion must drop the
 * index before unlinking a property. Appended prefixes are caught up lazily.
 * All functions are compiled with the interpreter's shared kernel pipeline. */
(function (root) {
    /* An entry is interpreted with its owning object, never as a permanent
     * value-cell pointer. The legacy adapter uses record IDs for entries;
     * packed storage will resolve a slot here. These small functions are
     * compiled/inlined by the same kernel pipeline as their callers. */
    function ownPropertyEntryAttributesKernel(heapBase, owner, entry) {
        return propertyAttributes(heapBase, entry);
    }

    function ownPropertyEntryValueCellKernel(heapBase, owner, entry) {
        return propertyValueCellAddress(heapBase, entry);
    }

    function ownPropertyEntryKeyKernel(heapBase, owner, entry) {
        return propertyKey(heapBase, entry);
    }

    function ownPropertyEntrySetterKernel(heapBase, owner, entry) {
        return propertySetter(heapBase, entry);
    }

    function setOwnPropertyEntryAttributesKernel(heapBase, owner, entry, attributes) {
        setPropertyAttributes(heapBase, entry, attributes);
        return 0;
    }

    function setOwnPropertyEntrySetterKernel(heapBase, owner, entry, setter) {
        setPropertyReserved(heapBase, entry, setter);
        return 0;
    }

    function lastOwnPropertyEntryKernel(heapBase, owner) {
        var type = recordType(heapBase, owner);
        if (type === HEAP_TYPE_REGEXP) return regexpPropertyHead(heapBase, owner);
        if (type === HEAP_TYPE_BUFFER_VIEW) return bufferViewPropertyHead(heapBase, owner);
        return objectPropertyHead(heapBase, owner);
    }

    function previousOwnPropertyEntryKernel(heapBase, owner, entry) {
        return propertyNext(heapBase, entry);
    }

    function setOwnPropertyStorageKernel(heapBase, owner, storage) {
        var type = recordType(heapBase, owner);
        if (type === HEAP_TYPE_REGEXP) setRegexpPropertyHead(heapBase, owner, storage);
        else if (type === HEAP_TYPE_BUFFER_VIEW) setBufferViewPropertyHead(heapBase, owner, storage);
        else setObjectPropertyHead(heapBase, owner, storage);
        return 0;
    }

    function appendOwnPropertyEntryKernel(heapBase, state, owner, key, attributes) {
        if (reserveNativeAllocationKernel(heapBase, state, PROPERTY_RECORD_BYTES) === 0) return 0;
        var entry = engineHeapBump(heapBase, state);
        setRecordType(heapBase, entry, HEAP_TYPE_PROPERTY);
        setRecordSize(heapBase, entry, PROPERTY_RECORD_BYTES);
        setRecordMark(heapBase, entry, 0);
        setRecordFlags(heapBase, entry, 0);
        setPropertyNext(heapBase, entry, lastOwnPropertyEntryKernel(heapBase, owner));
        setPropertyKey(heapBase, entry, key);
        setPropertyAttributes(heapBase, entry, attributes);
        setPropertyReserved(heapBase, entry, 0);
        setValueCellUndefined(propertyValueCellAddress(heapBase, entry));
        setOwnPropertyStorageKernel(heapBase, owner, entry);
        setEngineHeapBump(heapBase, state, entry + PROPERTY_RECORD_BYTES);
        return entry;
    }

    function removeOwnPropertyEntryKernel(heapBase, owner, entry, previous) {
        var next = propertyNext(heapBase, entry);
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            setObjectPropertyIndex(heapBase, owner, 0);
        }
        if (previous !== 0) setPropertyNext(heapBase, previous, next);
        else setOwnPropertyStorageKernel(heapBase, owner, next);
        setRecordFlags(heapBase, owner, recordFlags(heapBase, owner) + 1);
        return 1;
    }

    function propertyIndexFindKernel(heapBase, index, key, hash) {
        var capacity = propertyIndexCapacity(heapBase, index);
        var slot = hash & (capacity - 1);
        var probes = 0;
        while (probes < capacity) {
            var property = propertyIndexSlot(heapBase, index, slot);
            if (property === 0) return 0;
            if (stringKeysEqualKernel(heapBase,
                    propertyKey(heapBase, property), key) === 1) return property;
            slot = (slot + 1) & (capacity - 1);
            probes = probes + 1;
        }
        return PROPERTY_INDEX_UNAVAILABLE;
    }

    function propertyIndexInsertKernel(heapBase, index, property) {
        var capacity = propertyIndexCapacity(heapBase, index);
        var slot = stringKeyHashKernel(heapBase,
            propertyKey(heapBase, property)) & (capacity - 1);
        var probes = 0;
        while (probes < capacity) {
            if (propertyIndexSlot(heapBase, index, slot) === 0) {
                setPropertyIndexSlot(heapBase, index, slot, property);
                return 1;
            }
            slot = (slot + 1) & (capacity - 1);
            probes = probes + 1;
        }
        return 0;
    }

    function buildObjectPropertyIndexKernel(heapBase, state, object, head) {
        var count = 0;
        var property = head;
        while (property !== 0) {
            count = count + 1;
            property = propertyNext(heapBase, property);
        }
        if (count < PROPERTY_INDEX_MINIMUM_PROPERTIES) return 0;
        var capacity = PROPERTY_INDEX_MINIMUM_PROPERTIES * 2;
        while (capacity < count * 2) capacity = capacity * 2;
        var bytes = PROPERTY_INDEX_RECORD_BYTES + capacity * HEAP_WORD_BYTES;
        var index = engineHeapBump(heapBase, state);
        /* An optimization must not force a collection or grow the heap.
         * Use only currently available arena storage; otherwise use the list. */
        if (index + bytes < index || index + bytes > engineHeapLimit(heapBase, state)) return 0;
        setRecordType(heapBase, index, HEAP_TYPE_PROPERTY_INDEX);
        setRecordSize(heapBase, index, bytes);
        setRecordMark(heapBase, index, 0);
        setRecordFlags(heapBase, index, 0);
        setPropertyIndexHead(heapBase, index, head);
        setPropertyIndexVersion(heapBase, index, recordFlags(heapBase, object));
        setPropertyIndexCount(heapBase, index, count);
        setPropertyIndexCapacity(heapBase, index, capacity);
        var memsetPointer = platformMemsetPointer(heapBase,
            enginePlatformServices(heapBase, state));
        if (memsetPointer !== 0) {
            callNativeI32(memsetPointer, propertyIndexSlotsAddress(heapBase, index),
                0, capacity * HEAP_WORD_BYTES);
        } else {
            var slot = 0;
            while (slot < capacity) {
                setPropertyIndexSlot(heapBase, index, slot, 0);
                slot = slot + 1;
            }
        }
        setEngineHeapBump(heapBase, state, index + bytes);
        property = head;
        while (property !== 0) {
            if (propertyIndexInsertKernel(heapBase, index, property) === 0) return 0;
            property = propertyNext(heapBase, property);
        }
        setObjectPropertyIndex(heapBase, object, index);
        return index;
    }

    function prepareObjectPropertyIndexKernel(heapBase, state, object) {
        var index = objectPropertyIndex(heapBase, object);
        var head = objectPropertyHead(heapBase, object);
        if (index !== 0) {
            var capacity = propertyIndexCapacity(heapBase, index);
            if (propertyIndexVersion(heapBase, index) === recordFlags(heapBase, object)) {
                var oldHead = propertyIndexHead(heapBase, index);
                if (oldHead === head) return index;
                /* Ordinary insertion prepends to the list. Catch up lazily
                 * without rebuilding a growing dictionary for every insert. */
                var additions = 0;
                var property = head;
                while (property !== 0 && property !== oldHead) {
                    additions = additions + 1;
                    property = propertyNext(heapBase, property);
                }
                var count = propertyIndexCount(heapBase, index) + additions;
                if (property === oldHead && count * 2 <= capacity) {
                    property = head;
                    while (property !== oldHead) {
                        if (propertyIndexInsertKernel(heapBase, index, property) === 0) {
                            setObjectPropertyIndex(heapBase, object, 0);
                            return 0;
                        }
                        property = propertyNext(heapBase, property);
                    }
                    setPropertyIndexHead(heapBase, index, head);
                    setPropertyIndexCount(heapBase, index, count);
                    return index;
                }
            }
            setObjectPropertyIndex(heapBase, object, 0);
        }
        return buildObjectPropertyIndexKernel(heapBase, state, object, head);
    }

    function indexedOwnObjectPropertyKernel(heapBase, state, object, key, hash) {
        var canIndex = recordType(heapBase, object) === HEAP_TYPE_OBJECT;
        var index = 0;
        if (canIndex) index = objectPropertyIndex(heapBase, object);
        if (index !== 0) {
            index = prepareObjectPropertyIndexKernel(heapBase, state, object);
            if (index !== 0) {
                var found = propertyIndexFindKernel(heapBase, index, key, hash);
                if (found !== PROPERTY_INDEX_UNAVAILABLE) return found;
                setObjectPropertyIndex(heapBase, object, 0);
            }
        }
        var property = objectPropertyHead(heapBase, object);
        var scanned = 0;
        while (property !== 0) {
            if (stringKeysEqualKernel(heapBase,
                    propertyKey(heapBase, property), key) === 1) return property;
            scanned = scanned + 1;
            if (canIndex && scanned === PROPERTY_INDEX_MINIMUM_PROPERTIES) {
                index = prepareObjectPropertyIndexKernel(heapBase, state, object);
                if (index !== 0) {
                    found = propertyIndexFindKernel(heapBase, index, key, hash);
                    if (found !== PROPERTY_INDEX_UNAVAILABLE) return found;
                    setObjectPropertyIndex(heapBase, object, 0);
                }
            }
            property = propertyNext(heapBase, property);
        }
        return 0;
    }

    var kernels = {
        lastOwnPropertyEntryKernel: lastOwnPropertyEntryKernel,
        previousOwnPropertyEntryKernel: previousOwnPropertyEntryKernel,
        ownPropertyEntryKeyKernel: ownPropertyEntryKeyKernel,
        ownPropertyEntrySetterKernel: ownPropertyEntrySetterKernel,
        setOwnPropertyEntryAttributesKernel: setOwnPropertyEntryAttributesKernel,
        setOwnPropertyEntrySetterKernel: setOwnPropertyEntrySetterKernel,
        setOwnPropertyStorageKernel: setOwnPropertyStorageKernel,
        appendOwnPropertyEntryKernel: appendOwnPropertyEntryKernel,
        removeOwnPropertyEntryKernel: removeOwnPropertyEntryKernel,
        ownPropertyEntryAttributesKernel: ownPropertyEntryAttributesKernel,
        ownPropertyEntryValueCellKernel: ownPropertyEntryValueCellKernel,
        propertyIndexFindKernel: propertyIndexFindKernel,
        propertyIndexInsertKernel: propertyIndexInsertKernel,
        buildObjectPropertyIndexKernel: buildObjectPropertyIndexKernel,
        prepareObjectPropertyIndexKernel: prepareObjectPropertyIndexKernel,
        indexedOwnObjectPropertyKernel: indexedOwnObjectPropertyKernel
    };
    root.GuestVMPropertyIndexKernel = kernels;
    if (typeof module !== "undefined" && module.exports) module.exports = kernels;
}(this));
