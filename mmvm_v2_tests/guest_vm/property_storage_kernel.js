/* Named properties in the compiled interpreter. Ordinary objects own packed,
 * insertion-ordered entries; other record kinds retain their legacy named
 * lists. Entry IDs are owner-relative slots, never persistent cell addresses.
 * Every function is ordinary kernel-dialect JS compiled by the shared pipeline. */
(function (root) {
    function ownPropertyEpochKernel(heapBase, owner) {
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            var storage = objectPropertyHead(heapBase, owner);
            if (storage === 0) return 0;
            return recordFlags(heapBase, storage);
        }
        return recordFlags(heapBase, owner);
    }

    function ownPropertyEntryDescriptorKernel(heapBase, owner, entry) {
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            return propertyStorageDescriptorAt(heapBase,
                objectPropertyHead(heapBase, owner), entry - 1);
        }
        return legacyPropertyDescriptorAddress(heapBase, entry);
    }

    function ownPropertyEntryAttributesKernel(heapBase, owner, entry) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        return propertyDescriptorAttributes(0, descriptor);
    }

    function ownPropertyEntryValueCellKernel(heapBase, owner, entry) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        return propertyDescriptorValueCell(0, descriptor);
    }

    function ownPropertyEntryKeyKernel(heapBase, owner, entry) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        return propertyDescriptorKey(0, descriptor);
    }

    function ownPropertyEntrySetterKernel(heapBase, owner, entry) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        return propertyDescriptorSetter(0, descriptor);
    }

    function setOwnPropertyEntryKeyKernel(heapBase, owner, entry, key) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        setPropertyDescriptorKey(0, descriptor, key);
        return 0;
    }

    function setOwnPropertyEntryAttributesKernel(heapBase, owner, entry, attributes) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        setPropertyDescriptorAttributes(0, descriptor, attributes);
        return 0;
    }

    function setOwnPropertyEntrySetterKernel(heapBase, owner, entry, setter) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        setPropertyDescriptorSetter(0, descriptor, setter);
        return 0;
    }

    function previousOwnPropertyEntryKernel(heapBase, owner, entry) {
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            var storage = objectPropertyHead(heapBase, owner);
            entry = entry - 1;
            while (entry > 0) {
                if (propertyStorageKeyAt(heapBase, storage, entry - 1) !== 0) return entry;
                entry = entry - 1;
            }
            return 0;
        }
        return propertyNext(heapBase, entry);
    }

    function lastOwnPropertyEntryKernel(heapBase, owner) {
        var type = recordType(heapBase, owner);
        if (type === HEAP_TYPE_OBJECT) {
            var storage = objectPropertyHead(heapBase, owner);
            if (storage === 0) return 0;
            return previousOwnPropertyEntryKernel(heapBase, owner,
                propertyStorageLength(heapBase, storage) + 1);
        }
        if (type === HEAP_TYPE_REGEXP) return regexpPropertyHead(heapBase, owner);
        if (type === HEAP_TYPE_BUFFER_VIEW) return bufferViewPropertyHead(heapBase, owner);
        return objectPropertyHead(heapBase, owner);
    }

    function setOwnPropertyStorageKernel(heapBase, owner, storage) {
        var type = recordType(heapBase, owner);
        if (type === HEAP_TYPE_REGEXP) setRegexpPropertyHead(heapBase, owner, storage);
        else if (type === HEAP_TYPE_BUFFER_VIEW) setBufferViewPropertyHead(heapBase, owner, storage);
        else setObjectPropertyHead(heapBase, owner, storage);
        return 0;
    }

    function initializePropertyStorageKernel(heapBase, storage, capacity, length) {
        setRecordType(heapBase, storage, HEAP_TYPE_PROPERTY_STORAGE);
        setRecordSize(heapBase, storage,
            PROPERTY_STORAGE_RECORD_BYTES + capacity * PROPERTY_STORAGE_ENTRY_BYTES);
        setRecordMark(heapBase, storage, 0);
        setRecordFlags(heapBase, storage, 0);
        setPropertyStorageLength(heapBase, storage, length);
        setPropertyStorageCapacity(heapBase, storage, capacity);
        setPropertyStorageLiveCount(heapBase, storage, length);
        setPropertyStorageHashIndex(heapBase, storage, 0);
        var index = 0;
        while (index < capacity) {
            setPropertyStorageKeyAt(heapBase, storage, index, 0);
            setPropertyStorageAttributesAt(heapBase, storage, index, 0);
            setPropertyStorageSetterAt(heapBase, storage, index, 0);
            setPropertyStoragePaddingAt(heapBase, storage, index, 0);
            setValueCellUndefined(propertyStorageValueCellAt(heapBase, storage, index));
            index = index + 1;
        }
        return storage;
    }

    /* Bulk constructors reserve the object and its entries together. Publish
     * a fully initialized backing before their owner-aware descriptor writes.
     * They use exact capacity, not individually allocated property records. */
    function initializeOwnPropertyStorageKernel(heapBase, owner, storage, count) {
        initializePropertyStorageKernel(heapBase, storage, count, count);
        setObjectPropertyHead(heapBase, owner, storage);
        return 1;
    }

    function initializeOwnDataEntryKernel(heapBase, owner, entry, keyCell,
                                          attributes, valueReference) {
        var descriptor = ownPropertyEntryDescriptorKernel(heapBase, owner, entry);
        setPropertyDescriptorKey(0, descriptor, valueCellReference(0, keyCell));
        setPropertyDescriptorAttributes(0, descriptor, attributes);
        setPropertyDescriptorSetter(0, descriptor, 0);
        setValueCellReference(propertyDescriptorValueCell(0, descriptor), valueReference);
        return 1;
    }

    /* Replaced private backings have no remaining owner. Clear their payload
     * before retiring them: copied FFI values must not survive as stale
     * process addresses in a ready-to-run heap image. They become ordinary
     * free records, reclaimed by the normal allocator/collector rebuild. */
    function retirePropertyRecordKernel(heapBase, state, record) {
        var bytes = recordSize(heapBase, record) - HEAP_HEADER_BYTES;
        var memsetPointer = platformMemsetPointer(heapBase,
            enginePlatformServices(heapBase, state));
        if (memsetPointer !== 0) {
            callNativeI32(memsetPointer, recordPayloadAddress(heapBase, record), 0, bytes);
        } else {
            var word = 0;
            while (word * HEAP_WORD_BYTES < bytes) {
                setRecordPayloadWord(heapBase, record, word, 0);
                word = word + 1;
            }
        }
        setRecordType(heapBase, record, HEAP_TYPE_FREE);
        setRecordMark(heapBase, record, 0);
        setRecordFlags(heapBase, record, 0);
        return 0;
    }

    function discardPropertyStorageIndexKernel(heapBase, state, storage) {
        var index = propertyStorageHashIndex(heapBase, storage);
        if (index !== 0) {
            setPropertyStorageHashIndex(heapBase, storage, 0);
            retirePropertyRecordKernel(heapBase, state, index);
        }
        return 0;
    }

    function propertyIndexFindKernel(heapBase, index, key, hash) {
        var storage = propertyIndexHead(heapBase, index);
        var capacity = propertyIndexCapacity(heapBase, index);
        var bucket = hash & (capacity - 1);
        var probes = 0;
        while (probes < capacity) {
            var entry = propertyIndexSlot(heapBase, index, bucket);
            if (entry === 0) return 0;
            if (stringKeysEqualKernel(heapBase,
                    propertyStorageKeyAt(heapBase, storage, entry - 1), key) === 1) return entry;
            bucket = (bucket + 1) & (capacity - 1);
            probes = probes + 1;
        }
        return PROPERTY_INDEX_UNAVAILABLE;
    }

    function propertyIndexInsertKernel(heapBase, index, entry) {
        var storage = propertyIndexHead(heapBase, index);
        var capacity = propertyIndexCapacity(heapBase, index);
        var key = propertyStorageKeyAt(heapBase, storage, entry - 1);
        var bucket = stringKeyHashKernel(heapBase, key) & (capacity - 1);
        var probes = 0;
        while (probes < capacity) {
            if (propertyIndexSlot(heapBase, index, bucket) === 0) {
                setPropertyIndexSlot(heapBase, index, bucket, entry);
                return 1;
            }
            bucket = (bucket + 1) & (capacity - 1);
            probes = probes + 1;
        }
        return 0;
    }

    function prepareObjectPropertyIndexKernel(heapBase, state, object) {
        var storage = objectPropertyHead(heapBase, object);
        if (storage === 0) return 0;
        var index = propertyStorageHashIndex(heapBase, storage);
        if (index !== 0) {
            if (propertyIndexVersion(heapBase, index) === recordFlags(heapBase, storage)) return index;
            discardPropertyStorageIndexKernel(heapBase, state, storage);
        }
        var count = propertyStorageLiveCount(heapBase, storage);
        if (count < PROPERTY_INDEX_MINIMUM_PROPERTIES) return 0;
        var capacity = PROPERTY_INDEX_MINIMUM_PROPERTIES * 2;
        while (capacity < count * 2) capacity = capacity * 2;
        var bytes = PROPERTY_INDEX_RECORD_BYTES + capacity * HEAP_WORD_BYTES;
        index = engineHeapBump(heapBase, state);
        /* An optional accelerator never forces growth or collection. */
        if (index + bytes < index || index + bytes > engineHeapLimit(heapBase, state)) return 0;
        setRecordType(heapBase, index, HEAP_TYPE_PROPERTY_INDEX);
        setRecordSize(heapBase, index, bytes);
        setRecordMark(heapBase, index, 0);
        setRecordFlags(heapBase, index, 0);
        setPropertyIndexHead(heapBase, index, storage);
        setPropertyIndexVersion(heapBase, index, recordFlags(heapBase, storage));
        setPropertyIndexCount(heapBase, index, count);
        setPropertyIndexCapacity(heapBase, index, capacity);
        var memsetPointer = platformMemsetPointer(heapBase,
            enginePlatformServices(heapBase, state));
        if (memsetPointer !== 0) {
            callNativeI32(memsetPointer, propertyIndexSlotsAddress(heapBase, index),
                0, capacity * HEAP_WORD_BYTES);
        } else {
            var bucket = 0;
            while (bucket < capacity) {
                setPropertyIndexSlot(heapBase, index, bucket, 0);
                bucket = bucket + 1;
            }
        }
        setEngineHeapBump(heapBase, state, index + bytes);
        var entry = 1;
        var length = propertyStorageLength(heapBase, storage);
        while (entry <= length) {
            if (propertyStorageKeyAt(heapBase, storage, entry - 1) !== 0) {
                if (propertyIndexInsertKernel(heapBase, index, entry) === 0) return 0;
            }
            entry = entry + 1;
        }
        setPropertyStorageHashIndex(heapBase, storage, index);
        return index;
    }

    function indexedOwnObjectPropertyKernel(heapBase, state, object, key, hash) {
        if (recordType(heapBase, object) === HEAP_TYPE_OBJECT) {
            var storage = objectPropertyHead(heapBase, object);
            if (storage === 0) return 0;
            var index = prepareObjectPropertyIndexKernel(heapBase, state, object);
            if (index !== 0) {
                var found = propertyIndexFindKernel(heapBase, index, key, hash);
                if (found !== PROPERTY_INDEX_UNAVAILABLE) return found;
                setPropertyStorageHashIndex(heapBase, storage, 0);
            }
            var slot = propertyStorageLength(heapBase, storage);
            while (slot > 0) {
                var candidate = propertyStorageKeyAt(heapBase, storage, slot - 1);
                if (candidate !== 0 && stringKeysEqualKernel(heapBase, candidate, key) === 1) return slot;
                slot = slot - 1;
            }
            return 0;
        }
        var entry = lastOwnPropertyEntryKernel(heapBase, object);
        while (entry !== 0) {
            if (stringKeysEqualKernel(heapBase,
                    ownPropertyEntryKeyKernel(heapBase, object, entry), key) === 1) return entry;
            entry = previousOwnPropertyEntryKernel(heapBase, object, entry);
        }
        return 0;
    }

    function growOwnPropertyStorageKernel(heapBase, state, owner) {
        var old = objectPropertyHead(heapBase, owner);
        var capacity = PROPERTY_STORAGE_INITIAL_CAPACITY;
        var length = 0;
        var live = 0;
        if (old !== 0) {
            capacity = propertyStorageCapacity(heapBase, old);
            length = propertyStorageLength(heapBase, old);
            live = propertyStorageLiveCount(heapBase, old);
            if (length < capacity) return old;
            if (capacity === 0) capacity = PROPERTY_STORAGE_INITIAL_CAPACITY;
            if (live * 2 > length) {
                var growth = capacity >> 1;
                if (growth < 1) growth = 1;
                capacity = capacity + growth;
            }
        }
        var bytes = PROPERTY_STORAGE_RECORD_BYTES + capacity * PROPERTY_STORAGE_ENTRY_BYTES;
        if (reserveNativeAllocationKernel(heapBase, state, bytes) === 0) return 0;
        var storage = engineHeapBump(heapBase, state);
        initializePropertyStorageKernel(heapBase, storage, capacity, live);
        var destination = 0;
        var source = 0;
        while (source < length) {
            var key = propertyStorageKeyAt(heapBase, old, source);
            if (key !== 0) {
                setPropertyStorageKeyAt(heapBase, storage, destination, key);
                setPropertyStorageAttributesAt(heapBase, storage, destination,
                    propertyStorageAttributesAt(heapBase, old, source));
                setPropertyStorageSetterAt(heapBase, storage, destination,
                    propertyStorageSetterAt(heapBase, old, source));
                copyValueCell(propertyStorageValueCellAt(heapBase, storage, destination),
                    propertyStorageValueCellAt(heapBase, old, source));
                destination = destination + 1;
            }
            source = source + 1;
        }
        if (old !== 0) setRecordFlags(heapBase, storage, recordFlags(heapBase, old) + 1);
        setEngineHeapBump(heapBase, state, storage + bytes);
        setObjectPropertyHead(heapBase, owner, storage);
        if (old !== 0) {
            discardPropertyStorageIndexKernel(heapBase, state, old);
            retirePropertyRecordKernel(heapBase, state, old);
        }
        return storage;
    }

    function appendOwnPropertyEntryKernel(heapBase, state, owner, key, attributes) {
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            var storage = growOwnPropertyStorageKernel(heapBase, state, owner);
            if (storage === 0) return 0;
            var entry = propertyStorageLength(heapBase, storage) + 1;
            var live = propertyStorageLiveCount(heapBase, storage) + 1;
            var epoch = recordFlags(heapBase, storage);
            setPropertyStorageKeyAt(heapBase, storage, entry - 1, key);
            setPropertyStorageAttributesAt(heapBase, storage, entry - 1, attributes);
            setPropertyStorageSetterAt(heapBase, storage, entry - 1, 0);
            setValueCellUndefined(propertyStorageValueCellAt(heapBase, storage, entry - 1));
            setPropertyStorageLength(heapBase, storage, entry);
            setPropertyStorageLiveCount(heapBase, storage, live);
            setRecordFlags(heapBase, storage, epoch + 1);
            var index = propertyStorageHashIndex(heapBase, storage);
            if (index !== 0) {
                if (propertyIndexVersion(heapBase, index) === epoch &&
                        live * 2 <= propertyIndexCapacity(heapBase, index) &&
                        propertyIndexInsertKernel(heapBase, index, entry) === 1) {
                    setPropertyIndexCount(heapBase, index, live);
                    setPropertyIndexVersion(heapBase, index, epoch + 1);
                } else discardPropertyStorageIndexKernel(heapBase, state, storage);
            }
            return entry;
        }
        if (reserveNativeAllocationKernel(heapBase, state, PROPERTY_RECORD_BYTES) === 0) return 0;
        var property = engineHeapBump(heapBase, state);
        setRecordType(heapBase, property, HEAP_TYPE_PROPERTY);
        setRecordSize(heapBase, property, PROPERTY_RECORD_BYTES);
        setRecordMark(heapBase, property, 0);
        setRecordFlags(heapBase, property, 0);
        setPropertyNext(heapBase, property, lastOwnPropertyEntryKernel(heapBase, owner));
        setPropertyKey(heapBase, property, key);
        setPropertyAttributes(heapBase, property, attributes);
        setPropertyReserved(heapBase, property, 0);
        setValueCellUndefined(propertyValueCellAddress(heapBase, property));
        setOwnPropertyStorageKernel(heapBase, owner, property);
        setEngineHeapBump(heapBase, state, property + PROPERTY_RECORD_BYTES);
        return property;
    }

    function removeOwnPropertyEntryKernel(heapBase, state, owner, entry, previous) {
        if (recordType(heapBase, owner) === HEAP_TYPE_OBJECT) {
            var storage = objectPropertyHead(heapBase, owner);
            setPropertyStorageKeyAt(heapBase, storage, entry - 1, 0);
            setPropertyStorageAttributesAt(heapBase, storage, entry - 1, 0);
            setPropertyStorageSetterAt(heapBase, storage, entry - 1, 0);
            setValueCellUndefined(propertyStorageValueCellAt(heapBase, storage, entry - 1));
            setPropertyStorageLiveCount(heapBase, storage,
                propertyStorageLiveCount(heapBase, storage) - 1);
            discardPropertyStorageIndexKernel(heapBase, state, storage);
            setRecordFlags(heapBase, storage, recordFlags(heapBase, storage) + 1);
        } else {
            var next = propertyNext(heapBase, entry);
            if (previous !== 0) setPropertyNext(heapBase, previous, next);
            else setOwnPropertyStorageKernel(heapBase, owner, next);
            setRecordFlags(heapBase, owner, recordFlags(heapBase, owner) + 1);
        }
        return 1;
    }

    var kernels = {
        ownPropertyEntryDescriptorKernel: ownPropertyEntryDescriptorKernel,
        ownPropertyEpochKernel: ownPropertyEpochKernel,
        ownPropertyEntryAttributesKernel: ownPropertyEntryAttributesKernel,
        ownPropertyEntryValueCellKernel: ownPropertyEntryValueCellKernel,
        ownPropertyEntryKeyKernel: ownPropertyEntryKeyKernel,
        ownPropertyEntrySetterKernel: ownPropertyEntrySetterKernel,
        setOwnPropertyEntryKeyKernel: setOwnPropertyEntryKeyKernel,
        setOwnPropertyEntryAttributesKernel: setOwnPropertyEntryAttributesKernel,
        setOwnPropertyEntrySetterKernel: setOwnPropertyEntrySetterKernel,
        lastOwnPropertyEntryKernel: lastOwnPropertyEntryKernel,
        previousOwnPropertyEntryKernel: previousOwnPropertyEntryKernel,
        setOwnPropertyStorageKernel: setOwnPropertyStorageKernel,
        initializePropertyStorageKernel: initializePropertyStorageKernel,
        initializeOwnPropertyStorageKernel: initializeOwnPropertyStorageKernel,
        initializeOwnDataEntryKernel: initializeOwnDataEntryKernel,
        retirePropertyRecordKernel: retirePropertyRecordKernel,
        discardPropertyStorageIndexKernel: discardPropertyStorageIndexKernel,
        propertyIndexFindKernel: propertyIndexFindKernel,
        propertyIndexInsertKernel: propertyIndexInsertKernel,
        prepareObjectPropertyIndexKernel: prepareObjectPropertyIndexKernel,
        indexedOwnObjectPropertyKernel: indexedOwnObjectPropertyKernel,
        growOwnPropertyStorageKernel: growOwnPropertyStorageKernel,
        appendOwnPropertyEntryKernel: appendOwnPropertyEntryKernel,
        removeOwnPropertyEntryKernel: removeOwnPropertyEntryKernel
    };
    root.GuestVMPropertyStorageKernel = kernels;
    if (typeof module !== "undefined" && module.exports) module.exports = kernels;
}(this));
