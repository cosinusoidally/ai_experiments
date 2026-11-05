/* Ordinary ES5 descriptor decisions. Callers perform observable conversion,
 * SameValue and callable checks first. This layer never allocates, calls guest
 * code, dereferences a heap or constructs errors. It runs as ordinary JS and
 * is compiled unchanged for the native interpreter. */
(function (root) {
    var Records = root.GuestVMHeapRecords;
    if (typeof module !== "undefined" && module.exports) Records = require("./heap_records.js");
    var PropertyAttributes = Records.Attributes;
    var DescriptorFields = {VALUE: 1, WRITABLE: 2, ENUMERABLE: 4,
        CONFIGURABLE: 8, GET: 16, SET: 32};
    var DescriptorReject = {NOT_EXTENSIBLE: -1, RECONFIGURE: -2,
        CHANGE_KIND: -3, REPLACE_ACCESSOR: -4, NON_WRITABLE: -5, MIXED: -6};

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
        decision: ordinaryDescriptorDecisionKernel,
        functions: {ordinaryDescriptorDecisionKernel: ordinaryDescriptorDecisionKernel},
        namespaces: {DescriptorFields: DescriptorFields, PropertyAttributes: PropertyAttributes,
                     DescriptorReject: DescriptorReject},
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
