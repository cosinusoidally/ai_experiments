/* Ordinary ES5 descriptor decisions. Callers perform observable conversion,
 * SameValue and callable checks first. This layer never allocates, calls guest
 * code, dereferences a heap or constructs errors. It runs as ordinary JS and
 * is compiled unchanged for the native interpreter. */
(function (root) {
    var Records = root.GuestVMHeapRecords;
    var indexedViewDescriptorAllowedKernel = root.GuestVMIndexedViewDescriptorAllowed;
    if (typeof module !== "undefined" && module.exports) {
        Records = require("./heap_records.js");
        indexedViewDescriptorAllowedKernel = require("./indexed_view_policy.js");
    }
    var PropertyAttributes = Records.Attributes;
    var DescriptorFields = {VALUE: 1, WRITABLE: 2, ENUMERABLE: 4,
        CONFIGURABLE: 8, GET: 16, SET: 32};
    var DescriptorReject = {NOT_EXTENSIBLE: -1, RECONFIGURE: -2,
        CHANGE_KIND: -3, REPLACE_ACCESSOR: -4, NON_WRITABLE: -5, MIXED: -6};
    var PropertyWriteAction = {WRITE_DATA: 0, CALL_SETTER: 1,
        NO_SETTER: -1, NON_WRITABLE: -2, NOT_EXTENSIBLE: -3};
    var VirtualPropertyKind = {ARRAY_LENGTH: 1, STRING_LENGTH: 2,
        STRING_INDEX: 3, INDEXED_ELEMENT: 4};
    var EnumerationMode = {OWN_ENUMERABLE: 0, INHERITED_ENUMERABLE: 1, OWN_NAMES: 2};

    function enumerationIncludeEntryKernel(mode, attributes, privateEntry, virtualEntry) {
        if (privateEntry !== 0 || virtualEntry !== 0) return 0;
        if (mode === EnumerationMode.OWN_NAMES || (attributes & PropertyAttributes.ENUMERABLE) !== 0) return 1;
        return 0;
    }

    function descriptorPresenceKernel(value, writable, enumerable, configurable, getter, setter) {
        var present = 0;
        if (value !== 0) present = present | DescriptorFields.VALUE;
        if (writable !== 0) present = present | DescriptorFields.WRITABLE;
        if (enumerable !== 0) present = present | DescriptorFields.ENUMERABLE;
        if (configurable !== 0) present = present | DescriptorFields.CONFIGURABLE;
        if (getter !== 0) present = present | DescriptorFields.GET;
        if (setter !== 0) present = present | DescriptorFields.SET;
        return present;
    }

    function descriptorRequestedAttributesKernel(writable, enumerable, configurable) {
        var requested = 0;
        if (writable !== 0) requested = requested | PropertyAttributes.WRITABLE;
        if (enumerable !== 0) requested = requested | PropertyAttributes.ENUMERABLE;
        if (configurable !== 0) requested = requested | PropertyAttributes.CONFIGURABLE;
        return requested;
    }

    function virtualPropertyAttributesKernel(kind, writableLength) {
        if (kind === VirtualPropertyKind.ARRAY_LENGTH) {
            if (writableLength !== 0) return PropertyAttributes.WRITABLE;
            return 0;
        }
        if (kind === VirtualPropertyKind.STRING_LENGTH) return 0;
        if (kind === VirtualPropertyKind.STRING_INDEX) return PropertyAttributes.ENUMERABLE;
        return PropertyAttributes.WRITABLE | PropertyAttributes.ENUMERABLE | PropertyAttributes.CONFIGURABLE;
    }

    function ordinaryWriteActionKernel(attributes, setter) {
        if ((attributes & PropertyAttributes.ACCESSOR) !== 0) {
            if (setter === 0) return PropertyWriteAction.NO_SETTER;
            return PropertyWriteAction.CALL_SETTER;
        }
        if ((attributes & PropertyAttributes.WRITABLE) === 0) return PropertyWriteAction.NON_WRITABLE;
        return PropertyWriteAction.WRITE_DATA;
    }

    /* Ordinary JS dependency injection: portable lookup binds checked/cached
     * record access; AOT binds the corresponding named kernel helpers. The
     * traversal itself is identical. Return a logical owner, never a cell
     * address or a newly allocated descriptor. Positive entry caches supply
     * the caller's subsequent entry read. No callback/GC occurs in this walk. */
    function createNamedPropertyOwnerResolver(findOwnPropertyEntryKernel,
            objectPrototypeReferenceKernel) {
        return function namedPropertyOwnerKernel(heapBase, state, owner, key) {
            while (owner !== 0) {
                if (findOwnPropertyEntryKernel(heapBase, state, owner, key) !== 0) return owner;
                owner = objectPrototypeReferenceKernel(heapBase, owner);
            }
            return 0;
        };
    }

    /* Returns new attributes or a named negative rejection. mismatches uses
     * VALUE/GET/SET presence bits only where SameValue has returned false. */
    function ordinaryDescriptorDecisionKernel(exists, extensible, attributes,
            present, requested, mismatches) {
        var accessor = present & (DescriptorFields.GET | DescriptorFields.SET);
        var data = present & (DescriptorFields.VALUE | DescriptorFields.WRITABLE);
        if (accessor !== 0 && data !== 0) return DescriptorReject.MIXED;
        var oldAccessor = attributes & PropertyAttributes.ACCESSOR;
        if (exists === 0) {
            if (extensible === 0) return DescriptorReject.NOT_EXTENSIBLE;
        } else if ((attributes & PropertyAttributes.CONFIGURABLE) === 0) {
            if ((requested & PropertyAttributes.CONFIGURABLE) !== 0 ||
                    ((present & DescriptorFields.ENUMERABLE) !== 0 &&
                     ((requested ^ attributes) & PropertyAttributes.ENUMERABLE) !== 0)) {
                return DescriptorReject.RECONFIGURE;
            }
            if ((accessor !== 0 && oldAccessor === 0) ||
                    (data !== 0 && oldAccessor !== 0)) return DescriptorReject.CHANGE_KIND;
            if (oldAccessor !== 0) {
                if ((mismatches & (DescriptorFields.GET | DescriptorFields.SET)) !== 0) {
                    return DescriptorReject.REPLACE_ACCESSOR;
                }
            } else if ((attributes & PropertyAttributes.WRITABLE) === 0) {
                if ((requested & PropertyAttributes.WRITABLE) !== 0 ||
                        (mismatches & DescriptorFields.VALUE) !== 0) return DescriptorReject.NON_WRITABLE;
            }
        }
        if ((accessor !== 0 && oldAccessor === 0) ||
                (data !== 0 && oldAccessor !== 0)) {
            attributes = attributes & ~(PropertyAttributes.ACCESSOR | PropertyAttributes.WRITABLE);
        }
        if (accessor !== 0) attributes = attributes | PropertyAttributes.ACCESSOR;
        var replace = 0;
        if ((present & DescriptorFields.WRITABLE) !== 0) replace = replace | PropertyAttributes.WRITABLE;
        if ((present & DescriptorFields.ENUMERABLE) !== 0) replace = replace | PropertyAttributes.ENUMERABLE;
        if ((present & DescriptorFields.CONFIGURABLE) !== 0) replace = replace | PropertyAttributes.CONFIGURABLE;
        return (attributes & ~replace) | (requested & replace);
    }

    var exports = {fields: DescriptorFields, reject: DescriptorReject,
        enumerationModes: EnumerationMode, includeEnumerationEntry: enumerationIncludeEntryKernel,
        indexedViewDescriptorAllowed: indexedViewDescriptorAllowedKernel,
        descriptorPresence: descriptorPresenceKernel,
        descriptorRequestedAttributes: descriptorRequestedAttributesKernel,
        virtualKinds: VirtualPropertyKind, virtualAttributes: virtualPropertyAttributesKernel,
        writeActions: PropertyWriteAction,
        writeAction: ordinaryWriteActionKernel,
        createNamedPropertyOwnerResolver: createNamedPropertyOwnerResolver,
        decision: ordinaryDescriptorDecisionKernel,
        functions: {ordinaryDescriptorDecisionKernel: ordinaryDescriptorDecisionKernel,
                    virtualPropertyAttributesKernel: virtualPropertyAttributesKernel,
                    enumerationIncludeEntryKernel: enumerationIncludeEntryKernel,
                    indexedViewDescriptorAllowedKernel: indexedViewDescriptorAllowedKernel,
                    descriptorPresenceKernel: descriptorPresenceKernel,
                    descriptorRequestedAttributesKernel: descriptorRequestedAttributesKernel,
                    ordinaryWriteActionKernel: ordinaryWriteActionKernel},
        namespaces: {DescriptorFields: DescriptorFields, PropertyAttributes: PropertyAttributes,
                     VirtualPropertyKind: VirtualPropertyKind,
                     EnumerationMode: EnumerationMode,
                     DescriptorReject: DescriptorReject, PropertyWriteAction: PropertyWriteAction},
        messages: {}};
    exports.messages[DescriptorReject.NOT_EXTENSIBLE] = "object is not extensible";
    exports.messages[DescriptorReject.RECONFIGURE] = "cannot reconfigure property";
    exports.messages[DescriptorReject.CHANGE_KIND] = "cannot change non-configurable property kind";
    exports.messages[DescriptorReject.REPLACE_ACCESSOR] = "cannot replace non-configurable accessor";
    exports.messages[DescriptorReject.NON_WRITABLE] = "cannot write non-writable property";
    exports.messages[DescriptorReject.MIXED] = "invalid mixed property descriptor";
    root.GuestVMPropertySemanticsKernel = exports;
    if (typeof module !== "undefined" && module.exports) module.exports = exports;
}(this));
