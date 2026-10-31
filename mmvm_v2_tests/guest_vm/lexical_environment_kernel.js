/* One-binding declarative environments, used for ES5 catch scope. The
 * environment's scope-data reference is a binding-name string, not a with
 * object. Header flags distinguish the two uses without widening every
 * function environment. Both references are traced by the collector. */
(function (root) {
    /* Return a binding's value-cell address, zero for an unresolved name, or
     * LEXICAL_LOOKUP_UNSUPPORTED if an object environment requires ordinary
     * HasProperty/Get processing. Never silently skip an unknown scope. */
    function resolveNamedBindingCellKernel(heapBase, environment, name) {
        while (environment !== 0) {
            var catchName = environmentBindingNameKernel(heapBase, environment);
            if (catchName !== 0) {
                if (stringKeysEqualKernel(heapBase, catchName, name) === 1) {
                    return environmentCellAddress(heapBase, environment, 0);
                }
            } else {
                if (environmentObjectKernel(heapBase, environment) !== 0) return LEXICAL_LOOKUP_UNSUPPORTED;
                var count = environmentCount(heapBase, environment);
                if (count > 0) {
                    var program = environmentProgram(heapBase, environment);
                    if (program === 0) return LEXICAL_LOOKUP_UNSUPPORTED;
                    var names = programBindingNames(heapBase, program);
                    if (names === 0 || vectorLength(heapBase, names) !== count) return LEXICAL_LOOKUP_UNSUPPORTED;
                    var index = 0;
                    while (index < count) {
                        var keyCell = vectorCellAddress(heapBase, names, index);
                        if (valueCellTag(0, keyCell) !== VALUE_TAG_REFERENCE) return LEXICAL_LOOKUP_UNSUPPORTED;
                        if (stringKeysEqualKernel(heapBase, valueCellReference(0, keyCell), name) === 1) {
                            return environmentCellAddress(heapBase, environment, index);
                        }
                        index = index + 1;
                    }
                }
            }
            environment = environmentParent(heapBase, environment);
        }
        return 0;
    }

    function environmentBindingNameKernel(heapBase, environment) {
        if ((recordFlags(heapBase, environment) & ENVIRONMENT_SINGLE_BINDING_FLAG) !== 0) {
            return environmentScopeData(heapBase, environment);
        }
        return 0;
    }

    function environmentObjectKernel(heapBase, environment) {
        if ((recordFlags(heapBase, environment) & (ENVIRONMENT_SINGLE_BINDING_FLAG |
                ENVIRONMENT_DETACHED_ARGUMENTS_FLAG)) !== 0) {
            return 0;
        }
        return environmentScopeData(heapBase, environment);
    }

    /* The caller keeps name/initialValue reachable until publication. No
     * collection happens during construction: an allocation failure returns
     * before any handler or active-environment state has been changed. */
    function allocateCatchEnvironmentKernel(heapBase, state, parent, name, initialValue) {
        var bytes = ENVIRONMENT_FIXED_BYTES + VALUE_CELL_BYTES;
        if (reserveNativeAllocationKernel(heapBase, state, bytes) === 0) return 0;
        var environment = engineHeapBump(heapBase, state);
        setRecordType(heapBase, environment, HEAP_TYPE_ENVIRONMENT);
        setRecordSize(heapBase, environment, bytes);
        setRecordMark(heapBase, environment, 0);
        setRecordFlags(heapBase, environment, ENVIRONMENT_SINGLE_BINDING_FLAG);
        setEnvironmentParent(heapBase, environment, parent);
        setEnvironmentCount(heapBase, environment, 1);
        setEnvironmentProgram(heapBase, environment, 0);
        setEnvironmentScopeData(heapBase, environment, name);
        copyValueCell(environmentCellAddress(heapBase, environment, 0), initialValue);
        setEngineHeapBump(heapBase, state, environment + bytes);
        return environment;
    }

    function argumentMappingDetachedKernel(heapBase, environment, index) {
        if ((recordFlags(heapBase, environment) & ENVIRONMENT_DETACHED_ARGUMENTS_FLAG) === 0) return 0;
        var map = environmentScopeData(heapBase, environment);
        var word = divideI32(index, ARGUMENT_MAPPING_WORD_BITS);
        if (word >= integerVectorLength(heapBase, map)) return 0;
        var bit = index % ARGUMENT_MAPPING_WORD_BITS;
        if ((integerVectorValue(heapBase, map, word) & (1 << bit)) !== 0) return 1;
        return 0;
    }

    /* Lazily create the detached-index set. Ordinary calls and unmodified
     * arguments objects pay no allocation or per-parameter map cost. */
    function detachArgumentMappingKernel(heapBase, state, array, index) {
        var environment = arrayReserved(heapBase, array);
        if (environment === 0 || environment === ARGUMENTS_UNMAPPED_ENVIRONMENT) return 1;
        if (index < 0) return 1;
        var program = environmentProgram(heapBase, environment);
        if (program === 0) return 1;
        var count = integerVectorLength(heapBase, programParameterSlots(heapBase, program));
        if (index >= count) return 1;
        var flags = recordFlags(heapBase, environment);
        var map = environmentScopeData(heapBase, environment);
        if ((flags & ENVIRONMENT_DETACHED_ARGUMENTS_FLAG) === 0) {
            var words = divideI32(count + ARGUMENT_MAPPING_WORD_BITS - 1, ARGUMENT_MAPPING_WORD_BITS);
            var bytes = integerVectorRecordBytesKernel(words);
            if (reserveNativeAllocationKernel(heapBase, state, bytes) === 0) return 0;
            map = engineHeapBump(heapBase, state);
            var initializedBytes = initializeIntegerVectorKernel(heapBase, map, words, 0);
            setEngineHeapBump(heapBase, state, map + initializedBytes);
            setEnvironmentScopeData(heapBase, environment, map);
            setRecordFlags(heapBase, environment, flags | ENVIRONMENT_DETACHED_ARGUMENTS_FLAG);
        }
        var word = divideI32(index, ARGUMENT_MAPPING_WORD_BITS);
        var bit = index % ARGUMENT_MAPPING_WORD_BITS;
        setIntegerVectorValue(heapBase, map, word,
            integerVectorValue(heapBase, map, word) | (1 << bit));
        return 1;
    }

    var exports = {functions: {
        resolveNamedBindingCellKernel: resolveNamedBindingCellKernel,
        argumentMappingDetachedKernel: argumentMappingDetachedKernel,
        detachArgumentMappingKernel: detachArgumentMappingKernel,
        environmentBindingNameKernel: environmentBindingNameKernel,
        environmentObjectKernel: environmentObjectKernel,
        allocateCatchEnvironmentKernel: allocateCatchEnvironmentKernel
    }};
    root.GuestVMLexicalEnvironmentKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
